
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
import { createManagedAiChatComplete } from '../../capability/managed-ai-client';
import { SubjectService } from '../../subject-core/subject-service';
import { completeStructured } from '../../subject-comm/structured-call';
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

test('deadline timer and caller listener are released on early return and store exception',async t=>{
 const originalSet=setTimeout,originalClear=clearTimeout;const created:unknown[]=[],cleared:unknown[]=[];
 t.mock.method(globalThis,'setTimeout',((...args:Parameters<typeof setTimeout>)=>{const h=originalSet(...args);created.push(h);return h}) as typeof setTimeout);
 t.mock.method(globalThis,'clearTimeout',((h:Parameters<typeof clearTimeout>[0])=>{cleared.push(h);return originalClear(h)}) as typeof clearTimeout);
 for(const mode of ['ceiling','exception','success']){
  const ac=new AbortController();let added=0,removed=0;const add=ac.signal.addEventListener.bind(ac.signal),remove=ac.signal.removeEventListener.bind(ac.signal);
  t.mock.method(ac.signal,'addEventListener',(...args:Parameters<typeof add>)=>{added++;return add(...args)});
  t.mock.method(ac.signal,'removeEventListener',(...args:Parameters<typeof remove>)=>{removed++;return remove(...args)});
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dm-cleanup-'));const store=createFileAiAllowanceStore(root);
  if(mode==='ceiling')store.readGlobal=async()=>({version:1,tokensUsed:100,inputTokens:0,outputTokens:0,requestCount:0,dayRequests:0,day:''});
  if(mode==='exception')store.readGlobal=async()=>{throw Error('fixture store failure')};
  const g=await gateway({store,globalTokenCeiling:10,complete:async()=>({text:'{}'})});
  const run=g.infer({body,installToken:token,signal:ac.signal});
  if(mode==='exception'){
   await assert.rejects(run,/fixture store failure/);
   const replacement=createFileAiAllowanceStore(root);store.readGlobal=replacement.readGlobal;
   assert.equal((await g.infer({body:{...body,idempotencyKey:'after-queue-rejection'},installToken:token})).body.ok,true);
  }else await run;
  assert.equal(added,removed);assert.equal(added,1);
 }
 assert.equal(created.length,4);assert.deepEqual(cleared,created);
});

test('queue survives rejection; expired or cancelled queued requests start no provider',async()=>{
 let release!:()=>void,entered!:()=>void,calls=0,clock=1000;
 const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 const g=await gateway({now:()=>clock,timeoutMs:100,complete:async()=>{calls++;entered();await gate;throw new ModelHttpError('aborted','fixture')}});
 const first=g.infer({body,installToken:token});await started;
 const ac=new AbortController();const cancelled=g.infer({body:{...body,idempotencyKey:'queued-cancel'},installToken:token,signal:ac.signal});
 const expired=g.infer({body:{...body,idempotencyKey:'queued-expired'},installToken:token});ac.abort('user');clock+=101;release();
 await first;assert.equal((await cancelled).body.error,'aborted');assert.equal((await expired).body.status,'PROVIDER_TIMEOUT');assert.equal(calls,1);
});

test('Self JSON uses server-owned configuration; truncated managed failure never falls back or retries',async()=>{
 let calls=0;const g=await gateway({structuredThinking:{type:'disabled'},complete:async o=>{calls++;assert.deepEqual(o.thinking,{type:'disabled'});return{text:'',finishReason:'length',truncated:true}}});
 const chat=createManagedAiChatComplete({gatewayUrl:'https://offline.invalid',installToken:token,fetchImpl:async(_u,o)=>{const r=await g.infer({body:JSON.parse(String(o?.body)),installToken:token});return new Response(JSON.stringify(r.body),{status:r.statusCode})}});
 const self=new SubjectService();self.setDistillModelRuntime({enabled:true,model:{providerId:'managed-ai',baseUrl:'https://offline.invalid',model:'managed-ai'},chatComplete:chat});
 assert.equal(await self.completeSemanticJson('Return JSON','neutral fixture'),null);assert.equal(calls,1);
 const r=await completeStructured({chat,request:{baseUrl:'https://offline.invalid',model:'managed-ai',messages:[{role:'user',content:'neutral fixture'}],responseFormat:{type:'json_object'}},parse:JSON.parse});
 assert.equal(r.value,null);assert.equal(r.attempts,1);assert.equal(calls,2);
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
 await g.infer({body:{...body,idempotencyKey:'review-2',maxTokens:4096,responseFormat:{type:'json_object'},tools:[{type:'function',function:{name:'fixture',parameters:{}}}]},installToken:token});
 await g.infer({body:{...body,idempotencyKey:'review-3',maxTokens:4096},installToken:token});assert.deepEqual(seen,[{type:'disabled'},undefined,undefined]);
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
