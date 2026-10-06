
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { createManagedAiGateway, type ManagedAiGatewayOptions } from '../../relay-service/ai-inference-gateway';
import { createFileAiAllowanceStore } from '../../relay-service/ai-allowance';
import { createRelayServer } from '../../relay-service/server';
import { chatComplete, ModelHttpError } from '../../infrastructure/model-http';
const token='neutral-fixture-install-token-at-least-32';
const body={messages:[{role:'user',content:'neutral fixture'}],idempotencyKey:'review-1'};
async function gateway(extra:Partial<ManagedAiGatewayOptions>={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dm-gateway-review-'));
 return createManagedAiGateway({store:createFileAiAllowanceStore(root),provider:{provider:'fixture',baseUrl:'https://offline.invalid',apiKey:'fixture',model:'fixture'},retryBackoffMs:0,...extra});
}
test('retry only receives remaining total deadline; third attempt never starts',async()=>{
 let now=1000;const budgets:number[]=[];const g=await gateway({now:()=>now,timeoutMs:100,complete:async o=>{budgets.push(o.timeoutMs!);now+=80;throw new ModelHttpError('server_error','fixture',503)}});
 const r=await g.infer({body,installToken:token});assert.deepEqual(budgets,[100,20]);assert.equal(r.body.status,'PROVIDER_TIMEOUT');
});
test('deadline interrupts backoff and no next provider attempt starts',async()=>{
 let calls=0;const g=await gateway({timeoutMs:20,retryBackoffMs:100,complete:async()=>{calls++;throw new ModelHttpError('server_error','fixture',503)}});
 const r=await g.infer({body,installToken:token});assert.equal(calls,1);assert.equal(r.body.ok,false);
});
test('late successful fixture cannot become AVAILABLE after deadline',async()=>{
 let now=1000,calls=0;const g=await gateway({now:()=>now,timeoutMs:100,complete:async()=>{calls++;now+=101;return{text:'late'}}});
 const r=await g.infer({body,installToken:token});assert.equal(calls,1);assert.equal(r.body.status,'PROVIDER_TIMEOUT');
});
test('caller cancellation propagates to active provider; stopping is not supplier confirmation',async()=>{
 const ac=new AbortController();const logs:Record<string,unknown>[]=[];let calls=0;
 const g=await gateway({log:(_e,f)=>logs.push(f),complete:async o=>{calls++;ac.abort('user');assert.equal(o.signal?.aborted,true);throw new ModelHttpError('aborted','fixture')}});
 const r=await g.infer({body,installToken:token,signal:ac.signal});assert.equal(calls,1);assert.equal(r.body.ok,false);const failure=logs.find(l=>l.stage==='provider_failure')!;assert.equal(failure.cancelSent,true);assert.equal(failure.supplierStopConfirmed,false);assert.equal(failure.requestId,'review-1');
});
test('truncated failure preserves provider usage and cached response stays failed',async()=>{
 let calls=0;const logs:Record<string,unknown>[]=[];const g=await gateway({log:(_e,f)=>logs.push(f),complete:async()=>{calls++;return{text:'',truncated:true,finishReason:'length',usage:{inputTokens:10,outputTokens:2048,totalTokens:2058}}}});
 for(let i=0;i<2;i++){const r=await g.infer({body,installToken:token});assert.equal(r.statusCode,502);assert.equal(r.body.ok,false);assert.equal(r.body.error,'truncated');assert.equal(r.body.usage?.totalTokens,2058)}assert.equal(calls,1);assert.equal(logs.at(-1)?.usageSource,'provider');assert.equal(logs.at(-1)?.status,'PROVIDER_ERROR');
});
test('provider parser retains usage on empty length finish without reasoning body',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({id:'fixture-response-id',model:'fixture-returned',choices:[{message:{content:'',reasoning_content:'PRIVATE'},finish_reason:'length'}],usage:{prompt_tokens:10,completion_tokens:2048,total_tokens:2058}})));
 const r=await chatComplete({baseUrl:'https://offline.invalid',model:'fixture',messages:[]});assert.equal(r.usage?.outputTokens,2048);assert.equal(r.text,'');assert.equal(r.providerMeta?.responseId,'fixture-response-id');assert.equal(r.providerMeta?.httpStatus,200);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
});
test('server-owned disabled thinking applies only to structured JSON without tools; cap remains 2048',async()=>{
 const seen:unknown[]=[];const g=await gateway({structuredThinking:{type:'disabled'},complete:async o=>{seen.push(o.thinking);assert.equal(o.maxTokens,2048);return{text:'{}'}}});
 await g.infer({body:{...body,maxTokens:4096,responseFormat:{type:'json_object'}},installToken:token});
 await g.infer({body:{...body,idempotencyKey:'review-2',maxTokens:4096,tools:[{type:'function',function:{name:'fixture',parameters:{}}}]},installToken:token});assert.deepEqual(seen,[{type:'disabled'},undefined]);
});
test('request correlation and rejected payload logs contain no material',async()=>{
 const logs:Record<string,unknown>[]=[];const g=await gateway({log:(_e,f)=>logs.push(f)});const r=await g.infer({body:{...body,thinking:{type:'disabled'},private:'PRIVATE'},installToken:token,requestId:'safe-uuid'});assert.equal(r.statusCode,400);assert.equal(logs.at(-1)?.requestId,'safe-uuid');assert.doesNotMatch(JSON.stringify(logs),/PRIVATE|neutral fixture|install-token/);
});
test('whole-body socket disconnect cancels provider; normal response never cancels it',async()=>{
 for(const disconnect of [true,false]){
 let reached!:()=>void,release!:()=>void,signal!:AbortSignal;const enter=new Promise<void>(r=>reached=r),gate=new Promise<void>(r=>release=r);
 const relay=createRelayServer({store:{} as never,port:0,aiInference:{ready:true,infer:async i=>{signal=i.signal!;reached();await gate;return{statusCode:200,body:{ok:true,status:'AVAILABLE' as const,text:'ok'}}},allowance:async()=>({statusCode:200,body:{ok:true}})}});
 const address=await relay.start();let done!:()=>void;const received=new Promise<void>(r=>done=r);const req=http.request({host:address.host,port:address.port,path:'/v1/ai/inference',method:'POST'},res=>{res.resume();res.on('end',done)});req.on('error',()=>{});req.end(JSON.stringify(body));
 try{await enter;if(disconnect){req.destroy();await new Promise(r=>setTimeout(r,30));assert.equal(signal.aborted,true);release()}else{release();await received;await new Promise(r=>setTimeout(r,10));assert.equal(signal.aborted,false)}}finally{release();relay.server.closeAllConnections();await new Promise<void>(r=>relay.server.close(()=>r()))}
 }
});
