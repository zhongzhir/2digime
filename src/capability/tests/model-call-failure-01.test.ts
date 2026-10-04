import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createManagedAiChatComplete, ManagedAiError } from '../managed-ai-client';
import { createManagedWebDiscoveryConnector } from '../web-discovery-client';
import { completeStructured, type StructuredAttempt } from '../../subject-comm/structured-call';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';

const request = { baseUrl: 'https://offline.invalid', model: 'fixture', messages: [{ role: 'user' as const, content: 'PRIVATE MATERIAL SECRET' }] };
function client(status: number, body: unknown) {
  return createManagedAiChatComplete({ gatewayUrl: 'https://offline.invalid', installToken: 'SECRET_TOKEN', fetchImpl: async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }) });
}
test('empty truncated response preserves finish reason and HTTP without becoming empty failure', async () => {
  const r = await client(200, { ok: true, status: 'AVAILABLE', text: '', finishReason: 'length', truncated: true })(request);
  assert.equal(r.truncated, true); assert.equal(r.finishReason, 'length'); assert.equal(r.diagnostic?.httpStatus, 200);
  assert.equal(r.diagnostic?.outputLength, 0); assert.equal(r.diagnostic?.failure, 'truncated');
});
for (const [name, status, body, failure, parse] of [
  ['empty',200,{ok:true,status:'AVAILABLE',text:''},'empty',null],
  ['json',200,'NOT JSON PRIVATE MATERIAL','format','json'],
  ['envelope',200,null,'format','envelope'],
  ['http',502,{ok:false,status:'PROVIDER_5XX',error:'SECRET_TOKEN'},'http',null],
] as const) test(`transport distinguishes ${name} and redacts diagnostic`, async () => {
  await assert.rejects(client(status,body)(request), (e: unknown) => {
    const d=(e as ManagedAiError).diagnostic!; assert.equal(d.failure,failure); assert.equal(d.httpStatus,status);assert.equal(d.parseError,parse);
    assert.doesNotMatch(JSON.stringify(d),/PRIVATE|SECRET_TOKEN/); return true;
  });
});
test('network failure has unknown HTTP; user cancellation prevents even the first call',async()=>{
 const ac=new AbortController();let calls=0;
 const chat=createManagedAiChatComplete({gatewayUrl:'https://offline.invalid',installToken:'fixture',fetchImpl:async()=>{calls++;throw new Error('PRIVATE SECRET_TOKEN')}});
 await assert.rejects(chat(request),(e:unknown)=>{const d=(e as ManagedAiError).diagnostic!;assert.equal(d.failure,'network');assert.equal(d.httpStatus,null);return true});
 ac.abort('user');await assert.rejects(chat({...request,signal:ac.signal}),(e:unknown)=>{assert.equal((e as ManagedAiError).diagnostic?.cancellation,'user');return true});assert.equal(calls,1);
});
test('deadline includes response body reading; no second structured attempt after timeout',async()=>{
 let calls=0;const notes:StructuredAttempt[]=[];
 const chat=createManagedAiChatComplete({gatewayUrl:'https://offline.invalid',installToken:'fixture',fetchImpl:async(_url,opts)=>{
   calls++;const stream=new ReadableStream({start(c){opts!.signal!.addEventListener('abort',()=>c.error(new Error('aborted')),{once:true})}});return new Response(stream,{status:200});
 }});
 const outcome=await completeStructured({chat,request,deadlineAt:Date.now()+30,parse:()=>null,onAttempt:a=>notes.push(a)});
 assert.equal(calls,1);assert.equal(outcome.attempts,1);assert.equal(notes[0]?.cancellation,'deadline');assert.equal(notes[0]?.httpStatus,200);
});
test('remaining deadline is passed downstream and expired success is discarded',async()=>{
 let calls=0;const deadlineAt=Date.now()+25;const notes:StructuredAttempt[]=[];
 const result=await completeStructured({request,deadlineAt,chat:async o=>{calls++;assert.ok(o.timeoutMs!<=25);assert.equal(o.deadlineAt,deadlineAt);await new Promise(r=>setTimeout(r,40));return{text:'{}'}},parse:()=>({ok:true}),onAttempt:a=>notes.push(a)});
 assert.equal(result.value,null);assert.equal(calls,1);assert.equal(notes[0]?.cancellation,'deadline');
});
test('active cancellation after a response prevents parse and retry; no raw parser error in log',async()=>{
 const ac=new AbortController();let calls=0,parses=0;const notes:StructuredAttempt[]=[];
 const result=await completeStructured({request,signal:ac.signal,chat:async()=>{calls++;ac.abort('user');return{text:'{}'}},parse:()=>{parses++;return{}},onAttempt:a=>notes.push(a)});
 assert.equal(result.value,null);assert.equal(calls,1);assert.equal(parses,0);assert.equal(notes[0]?.cancellation,'user');
 const parsed=await completeStructured({request,passes:[{maxTokens:10,timeoutMs:50,disableThinking:false}],chat:async()=>({text:'{}'}),parse:()=>{throw new Error('SECRET_TOKEN PRIVATE MATERIAL')},onAttempt:a=>notes.push(a)});
 assert.equal(parsed.value,null);assert.equal(notes.at(-1)?.parseError,'schema');assert.doesNotMatch(JSON.stringify(notes),/PRIVATE|SECRET_TOKEN/);
});
test('search preserves actual HTTP and distinguishes bad format',async()=>{
 for(const [status,body,kind] of [[500,{ok:false,status:'PROVIDER_ERROR'},'http'],[200,'not-json','format']] as const){
  const c=createManagedWebDiscoveryConnector({gatewayUrl:'https://offline.invalid',installToken:'fixture',fetchImpl:async()=>new Response(typeof body==='string'?body:JSON.stringify(body),{status})});
  await assert.rejects(c.search('course'),(e:unknown)=>{const d=(e as {diagnostic:{httpStatus:number;failure:string}}).diagnostic;assert.equal(d.httpStatus,status);assert.equal(d.failure,kind);return true});
 }
});
test('formal runtime failure retains same-request candidates, reaches terminal and logs no material',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dm-failure-'));
 const runtime=createDigitalMeRuntime({contentOpenMediaFetch:false,contentChat:async()=>{throw Object.assign(new ManagedAiError('PROVIDER_ERROR','空正文'),{diagnostic:{stage:'discover.intent',httpStatus:200,finishReason:'stop',outputLength:0,parseError:null,cancellation:null,failure:'empty'}})}});
 const bus=createCommandBus(runtime);await bus.invoke('subject.createPackage',{displayName:'failure fixture',targetDir:root});
 const query='fixture course';const card={itemId:'historical',title:'Historical course',url:'https://example.com/course',text:'PRIVATE MATERIAL'};
 const internal=runtime as unknown as {lastIntentView:unknown;runContentSeek:(root:string,query:string)=>Promise<{cards:unknown[];unjudgedCards:unknown[];replenishing:boolean}>};
 internal.lastIntentView={searchQuery:query,cards:[card],relatedCards:[],unjudgedCards:[card]};
 const view=await internal.runContentSeek(root,query);assert.equal(view.replenishing,false);assert.equal(view.cards.length,1);assert.equal(view.unjudgedCards.length,1);
 await new Promise(r=>setTimeout(r,20));const log=await fs.readFile(path.join(root,'content/discovery-diagnostics.ndjson'),'utf8');assert.doesNotMatch(log,/PRIVATE MATERIAL|SECRET_TOKEN/);assert.match(log,/discover.intent/);assert.match(log,/"httpStatus":200/);
});


test('search cancellation during body read discards success', async () => {
 const ac=new AbortController();let calls=0;
 const connector=createManagedWebDiscoveryConnector({gatewayUrl:'https://offline.invalid',installToken:'fixture',fetchImpl:async()=>{
  calls++;return {status:200,ok:true,json:async()=>{ac.abort('user');return {ok:true,status:'AVAILABLE',results:[]}}} as Response;
 }});
 await assert.rejects(connector.search('course',{signal:ac.signal}), (e:unknown)=>{assert.equal((e as {diagnostic:{cancellation:string}}).diagnostic.cancellation,'user');return true});assert.equal(calls,1);
});


test('public page redirects cannot start after cancellation or shared deadline',async()=>{
 const {safePublicHttpGet}=await import('../../work-runtime/public-http-safety');
 for(const mode of ['user','deadline']){
  const ac=new AbortController();let calls=0;
  await assert.rejects(safePublicHttpGet('https://fixture.example/start',{},3,{signal:ac.signal,deadlineAt:Date.now()+15,lookupAddresses:async()=>['8.8.8.8'],transport:async()=>{calls++;if(mode==='user')ac.abort('user');else await new Promise(r=>setTimeout(r,25));return {status:302,headers:{location:'https://fixture.example/next'},body:''}}}));
  assert.equal(calls,1);
 }
});
