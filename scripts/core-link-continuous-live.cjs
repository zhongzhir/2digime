'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {launchDigitalMeElectron,skipWelcomeAndEnterShell}=require('../dist/runtime/tests/electron-harness');
const {readThread}=require('../dist/intelligence/store');const {readDigitalSelf}=require('../dist/subject-core/digital-self/store');
const prior=path.resolve('build/evidence/core-link-historical-20261006'),out=path.resolve('build/evidence/core-link-continuous-20261006');
const ud=path.join(prior,'private-user-data'),pkg=path.join(prior,'package'),artifacts=path.join(out,'artifacts'),journal=path.join(out,'transport.json');
let h,pollTimer,journalChain=Promise.resolve(),stage='setup',baseline,final={success:false,startedAt:new Date().toISOString(),phases:[],maxApplicationRequests:16,maxUpstreamAttempts:48};
async function save(n,v){await fs.writeFile(path.join(out,n+'.json'),JSON.stringify(v,null,2));}
async function cmd(name,input){return h.page.evaluate(({name,input})=>window.digitalMe.invoke(name,input),{name,input});}
async function persistTrace(t){if(!t||!Array.isArray(t.requests))return;journalChain=journalChain.then(()=>fs.writeFile(journal,JSON.stringify(t,null,2)));await journalChain;}
async function trace(){const t=await h.app.evaluate(()=>global.__chainTrace);await persistTrace(t);if(t.failed)throw Error('transport failed; no next stage');return t;}
async function state(label){const thread=await readThread(pkg,new Date().toISOString()),self=await readDigitalSelf(pkg,'',new Date().toISOString());await save(label,{thread,self});return{thread,self};}
async function boot(){
 if(pollTimer)clearInterval(pollTimer);await journalChain;
 h=await launchDigitalMeElectron({userData:ud,realProduct:true,extraEnv:{DIGITALME_V2_ALLOW_DEV_CREDENTIAL:'0',DIGITALME_V2_CREDENTIAL_IMPORT:'',DIGITALME_V2_SEARCH_ENABLED:'0',GEMINI_API_KEY:'',GEMINI_MODEL:'',GEMINI_SEARCH_MODEL:'',DEEPSEEK_API_KEY:'',OPENAI_API_KEY:''}});await skipWelcomeAndEnterShell(h.page);
 await h.app.evaluate(async ({app},args)=>{
 global.__chainTrace=args.initial;global.__chainStage='setup';const original=global.fetch;
 function persist(){}
 global.fetch=async function(url,options){const u=new URL(String(url)),t=global.__chainTrace;
 if(u.pathname==='/v1/ai/allowance'){t.allowanceRequests++;persist();return original(url,options);}
 if(u.pathname!=='/v1/ai/inference'){if(/search|discovery/.test(u.pathname))t.blockedSearchCalls++;else t.blockedOtherNetwork++;persist();throw Error('external supply disabled');}
 if(t.failed||t.requests.length>=16)throw Error('shared validation budget/stop');
 const body=JSON.parse(options.body),r={requestId:body.idempotencyKey,phase:global.__chainStage,startedAt:new Date().toISOString(),maxTokens:body.maxTokens,toolCount:body.tools?.length||0,responseFormat:body.responseFormat?.type||null};t.requests.push(r);persist();const start=Date.now();
 try{const res=await original(url,options),j=await res.clone().json();Object.assign(r,{httpStatus:res.status,status:j.status,finishReason:j.finishReason,outputLength:j.text?.length||0,toolCallCount:j.toolCalls?.length||0,usage:j.usage||null,elapsedMs:Date.now()-start});
 if(!res.ok||!j.ok||j.truncated||j.finishReason==='length'||(!j.text?.trim()&&!j.toolCalls?.length)){t.failed=true;r.failure=j.truncated||j.finishReason==='length'?'truncated':!res.ok?'service_error':'empty_body';}
 if(!t.failed&&!j.toolCalls?.length&&body.responseFormat?.type==='json_object'){try{JSON.parse(j.text);}catch{r.failure='invalid_json';t.failed=true;}}
 return res;
 }catch(e){t.failed=true;r.failure=e.name;r.elapsedMs=Date.now()-start;throw e;}finally{persist();}
 };
 },{initial:JSON.parse(await fs.readFile(journal))});
 if(pollTimer)clearInterval(pollTimer);pollTimer=setInterval(()=>{const app=h?.app;if(app)app.evaluate(()=>global.__chainTrace).then(persistTrace).catch(()=>{});},500);pollTimer.unref();
 const model=await h.page.evaluate(()=>window.digitalMe.saveAiCapabilitySettings({path:'managed'}));assert.equal(model.modelReady,true);await cmd('subject.openPackage',{dir:pkg});
}
async function phase(name){stage=name;await h.app.evaluate((_electron,s)=>{global.__chainStage=s;},name);return (await trace()).requests.length;}
async function send(name,text){const n=await phase(name),t=Date.now();await h.page.locator('#nav-chat').click();await h.page.locator('#chat-input').fill(text);await h.page.locator('#btn-chat-send').click();await h.page.locator('#btn-chat-send:not([disabled])').waitFor({state:'visible',timeout:240000});const view=(await cmd('talk',{})).view;const tr=await trace();await save(name,{input:text,elapsedMs:Date.now()-t,view});await h.page.screenshot({path:path.join(out,name+'.png')});assert.ok(view.turns.at(-1)?.text?.trim(),'empty final answer');final.phases.push({stage:name,modelRequests:tr.requests.length-n,elapsedMs:Date.now()-t});console.log(JSON.stringify(final.phases.at(-1)));return view;}
async function fileProof(name,revised){
 const p=path.join(artifacts,name),bytes=await fs.readFile(p),text=bytes.toString();const s=await state(name+'-state');const execs=s.thread.executions.filter(e=>e.outputPath===p);
 assert.ok(execs.some(e=>e.capabilityId==='write_file'&&e.ok&&e.observedEffect?.mutated),'no actual write');assert.ok(execs.some(e=>e.capabilityId==='read_file'&&e.ok),'no explicit read_file');
 for(const o of baseline.thread.discoveryGoal.objects)assert.ok(text.includes(o.url),'file lacks source');
 const rows=text.split(/\r?\n/).filter(l=>/^\s*\|/.test(l)&&/周[一二三四五六日天]/.test(l)&&/\d+\s*(?:分钟)?/.test(l));assert.equal(rows.length,14,'14 daily table rows required');
 for(const row of rows){const cols=row.split('|').map(x=>x.trim()).filter(Boolean);const minutes=cols.find(x=>/^(?:30|60)(?:\s*分钟)?$/.test(x));assert.ok(minutes,'minute column missing');assert.ok(minutes.startsWith(revised&&/周[一二三四五]/.test(row)?'30':'60'),'duration mismatch');}
 const proof={path:p,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),text,dayRows:rows.length,revised,executions:execs};await save(name+'-proof',proof);return proof;
}
function noTemporarySelf(before,after){const ids=new Set(before.understandings.map(x=>x.id));assert.ok(!after.understandings.filter(x=>!ids.has(x.id)).some(x=>/工作日|周末|半小时|30分钟|60分钟|两周学习计划/.test(x.text)&&x.status==='current'),'temporary condition became current self fact');}
(async()=>{
 const resume=process.argv.includes('--resume-after-correction');
 if(resume){
  const lock=await fs.open(path.join(out,'resume-after-correction.reserved'),'wx');await lock.close();
  const ledger=JSON.parse(await fs.readFile(journal));assert.equal(ledger.requests.length,9,'resume exact completed prefix');assert.ok(!ledger.failed&&ledger.requests.every(r=>r.httpStatus===200),'cannot resume model failure');
  for(let i=0;i<ledger.requests.length;i++)ledger.requests[i].phase=i<5?'01-plan':'02-correction';await persistTrace(ledger);
  baseline=JSON.parse(await fs.readFile(path.join(out,'00-existing-goal.json')));
  const corrected=JSON.parse(await fs.readFile(path.join(out,'02-corrected.json')));
  assert.match(corrected.thread.discoveryGoal.request,/工作日/);assert.match(corrected.thread.discoveryGoal.request,/周末/);noTemporarySelf(baseline.self,corrected.self);
  final.startedAt=ledger.requests[0].startedAt;final.testHarnessInterruption={after:'correction and first restart',modelCallsDuringInterruption:0,successfulStagesNotRepeated:true};
  for(const [name,count] of [['01-plan',5],['02-correction',4]]){const phase=JSON.parse(await fs.readFile(path.join(out,name+'.json')));final.phases.push({stage:name,modelRequests:count,elapsedMs:phase.elapsedMs});}
  const t=Date.now();await boot();const restored=await state('03-restored-resume');assert.deepEqual(restored.thread.discoveryGoal,corrected.thread.discoveryGoal);assert.equal((await trace()).requests.length,9,'restart consumed model');final.phases.push({stage:'03-restart',modelRequests:0,elapsedMs:Date.now()-t});
 }else{
  assert.equal(await fs.stat(out).then(()=>true,()=>false),false,'no repeated continuous run');await fs.mkdir(artifacts,{recursive:true});await fs.writeFile(journal,JSON.stringify({requests:[],allowanceRequests:0,blockedSearchCalls:0,blockedOtherNetwork:0,failed:false,budget:16}));
  await boot();baseline=await state('00-existing-goal');assert.equal(baseline.thread.discoveryGoal.objects.length,2);assert.match(baseline.thread.discoveryGoal.request,/每天.*一小时/);
  const overview=await cmd('subject.getOverview',{});const {saveFilesystemGrant}=require('../dist/authorization/filesystem-grant');await saveFilesystemGrant({packageRoot:pkg,subjectId:overview.subjectId,folder:artifacts,now:new Date().toISOString()});
  await send('01-plan','我明确委托你根据当前目标与已保存的两门历史课程制作两周学习计划，不重复比较、不联网、不报名或付费。用Markdown表格列14天，从周一开始，每天一行：天数、星期（周一至周日）、分钟、练习、可交付成果。每天一小时，正文尽量精简，保留两个来源与未知项，不假设购买课程。请用write_file在已授权目录新建learning-plan.md，再用read_file回读后交付。');await fileProof('learning-plan.md',false);
  await send('02-correction','更正同一个学习目标：工作日只有半小时，周末仍有一小时。请更新现有发现目标，保留原学习方向和两门课程；这个时长只适用于当前目标，不是长期本人事实。现在不写新文件、不联网。');const corrected=await state('02-corrected');assert.match(corrected.thread.discoveryGoal.request,/工作日/);assert.match(corrected.thread.discoveryGoal.request,/周末/);noTemporarySelf(baseline.self,corrected.self);
  const beforeRestart=(await trace()).requests.length,t=Date.now();await h.close();h=null;await boot();const restored=await state('03-restored');assert.deepEqual(restored.thread.discoveryGoal,corrected.thread.discoveryGoal);assert.equal((await trace()).requests.length,beforeRestart,'restart consumed model call');final.phases.push({stage:'03-restart',modelRequests:0,elapsedMs:Date.now()-t});
 }
 const n=await phase('04-discover');const view=(await cmd('content',{action:'asked'})).view;const tr=await trace();await save('04-discover',view);assert.match(view.adjustment.text,/工作日/);assert.match(view.adjustment.text,/周末/);assert.ok(view.cards.length+ (view.relatedCards?.length||0)>0,'no candidate delivered');final.phases.push({stage:'04-discover',modelRequests:tr.requests.length-n});
 await send('05-revised-plan','根据同一个学习目标的最新条件重新制作两周计划，沿用原表格结构，从周一开始逐天列星期、分钟、练习和成果。先说明采用的最新时长条件，保存为已授权目录的learning-plan-revised.md，并用read_file回读确认。保留两个课程来源和未知项，正文精简，不联网、不报名或付费。');const revised=await fileProof('learning-plan-revised.md',true);const ending=await state('06-final');noTemporarySelf(baseline.self,ending.self);final.success=true;final.artifact=revised.path;
})().catch(async e=>{final.failedStage=stage;final.error=e.message;process.exitCode=1;console.error(JSON.stringify({failedStage:stage,error:e.message}));}).finally(async()=>{if(pollTimer)clearInterval(pollTimer);if(h){await trace().catch(()=>{});await h.close();}await journalChain;final.endedAt=new Date().toISOString();final.elapsedMs=Date.parse(final.endedAt)-Date.parse(final.startedAt);const tr=JSON.parse(await fs.readFile(journal));final.applicationRequests=tr.requests.length;final.usage=tr.requests.reduce((a,r)=>{if(r.usage){a.inputTokens+=r.usage.inputTokens;a.outputTokens+=r.usage.outputTokens;a.totalTokens+=r.usage.totalTokens;}else a.unknownCalls++;return a;},{inputTokens:0,outputTokens:0,totalTokens:0,unknownCalls:0});final.searchCalls=0;final.blockedSearchCalls=tr.blockedSearchCalls;await save('result',final);console.log(JSON.stringify(final));});
