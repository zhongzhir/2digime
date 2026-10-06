'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const stage=path.resolve(__dirname), out=path.join(stage,'validation.json');
const {runTalkTurn}=require('/tmp/dm-tool-thinking-inprocess-20261006-b7/dist/intelligence/loop');
const {emptyThread}=require('/tmp/dm-tool-thinking-inprocess-20261006-b7/dist/intelligence/store');
const {SubjectService}=require('/opt/digitalme-v2/dist/subject-core/subject-service');
let rows=[],results=[],controller=new AbortController();
for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>controller.abort(s));
async function save(){await fs.writeFile(out,JSON.stringify({success:results.length===2&&results.every(r=>r.success),results,applicationRequests:rows.length,maxApplicationRequests:6,maxUpstreamAttempts:18,searchCalls:0,rows},null,2));}
const start=Date.now();
async function chat(input){
 controller.signal.throwIfAborted();assert.ok(rows.length<6,'application budget exhausted');
 const row={requestId:crypto.randomUUID(),startedAt:new Date().toISOString(),toolCount:input.tools?.length||0};rows.push(row);await save();
 const ac=new AbortController(),abort=()=>ac.abort(controller.signal.reason);controller.signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>ac.abort('deadline'),Math.max(1,Math.min(90000,input.deadlineAt?input.deadlineAt-Date.now():90000)));const t=Date.now();
 try{
 const body={messages:input.messages,maxTokens:2048,idempotencyKey:row.requestId,...(input.tools?.length?{tools:input.tools}:{}),...(input.responseFormat?{responseFormat:input.responseFormat}:{})};
 const res=await fetch('http://127.0.0.1:8787/v1/ai/inference',{method:'POST',headers:{'content-type':'application/json','x-install-capability-token':await fs.readFile(path.join(stage,'isolation-install-token'),'utf8'),'x-request-id':row.requestId},body:JSON.stringify(body),signal:ac.signal});const j=await res.json();Object.assign(row,{elapsedMs:Date.now()-t,httpStatus:res.status,status:j.status,finishReason:j.finishReason,outputLength:j.text?.length||0,toolCallCount:j.toolCalls?.length||0,usage:j.usage||null});
 assert.ok(res.ok&&j.ok&&!j.truncated&&j.finishReason!=='length','managed failure');assert.ok(j.text?.trim()||j.toolCalls?.length,'empty body');
 return{text:j.text||'',finishReason:j.finishReason,usage:j.usage,toolCalls:j.toolCalls?.map(x=>({id:x.id,name:x.function.name,arguments:x.function.arguments}))};
 }catch(e){row.failure=e.message;row.cancelSource=ac.signal.aborted?String(ac.signal.reason):null;throw e;}
 finally{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);await save();}
}
(async()=>{
 assert.equal(await fs.stat(out).then(()=>true,()=>false),false,'no repeat');
 const historical=JSON.parse(await fs.readFile(path.join(stage,'historical-input.json')));
 const thread=emptyThread(new Date().toISOString());thread.discoveryGoal=historical.goal;
 const t=Date.now();const r=await runTalkTurn({thread,userText:'请比较所选两门历史课程，沿用发现里的原需求和时间约束，推荐先学哪门及理由。保留来源链接，把历史材料与未核实项说清，不要联网、报名或付费。',selfContext:historical.selfContext,agents:[],workRoot:path.join(stage,'isolated-work'),writeFolders:[],contextPaths:[],now:new Date().toISOString(),signal:controller.signal,deadlineAt:Date.now()+90000,chat});
 const text=r.thread.turns.at(-1)?.text||'';assert.ok(text.length>200,'comparison incomplete');for(const o of historical.goal.objects)assert.ok(text.includes(o.url),'source missing');assert.ok(/历史/.test(text)&&/小时/.test(text),'scope missing');results.push({phase:'historical_comparison',success:true,text,elapsedMs:Date.now()-t});await save();
 const self=new SubjectService();self.setDistillModelRuntime({enabled:true,model:{providerId:'managed-ai',baseUrl:'http://127.0.0.1:8787',model:'managed-ai'},chatComplete:chat});
 const t2=Date.now();const answer=await self.completeSemanticJson('仅返回JSON: weekdayMinutes:number, weekendMinutes:number, scope:string。临时目标作用范围current_goal，保留工作日与周末差异，不写长期本人事实。','隔离测试：这次学习计划改为工作日半小时、周末一小时，只对当前学习目标生效。');const parsed=JSON.parse(answer||'null');assert.ok(parsed?.weekdayMinutes===30&&parsed?.weekendMinutes===60&&parsed?.scope==='current_goal','Self schedule mismatch');results.push({phase:'isolated_self',success:true,parsed,elapsedMs:Date.now()-t2,formalSubjectRead:false,formalSubjectWritten:false});await save();console.log('VALIDATION_SUCCESS');
})().catch(async e=>{results.push({phase:results.length?'isolated_self':'historical_comparison',success:false,error:e.message});await save();console.error('VALIDATION_FAILED');process.exitCode=2;}).finally(async()=>{await fs.writeFile(path.join(stage,'validation-elapsed.json'),JSON.stringify({elapsedMs:Date.now()-start}));});
