'use strict';
// Diagnostic only. Uses unmodified Talk/model HTTP modules in one Node process.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {runTalkTurn}=require('../dist/intelligence/loop'),{emptyThread}=require('../dist/intelligence/store'),{chatComplete}=require('../dist/infrastructure/model-http');
const mode=process.argv[2],root=path.resolve(process.env.DM_DIAG_ROOT||'build/evidence/tool-thinking-inprocess-20261006');
const folder=path.join(root,'authorized'),journalPath=path.join(root,'supplier-journal.json');
const compareText='请比较所选两门历史课程，沿用发现里的原需求和时间约束，推荐先学哪门及理由。保留来源链接，把历史材料与未核实项说清，不要联网、报名或付费。';
let journal=[],config,actualFetch=global.fetch,live=false,currentStage,activeRow;
const baseHashes={'dist/relay-service/server.js':'bdb8b00462897aa1bd44cc8f9d2ce3b6b360b8233a4edd4c7a22f0628443c080','dist/relay-service/ai-inference-gateway.js':'deaa14bb42f067ab50aa2ac22117bd07a58dbe45e83277fd8d135a52ba16c370','dist/infrastructure/model-http.js':'aa57a97fdaf47ca1db87f2b06784a5bda51826a1aefc5a97c8d04c563f0c77b1'};
async function save(file,obj){await fs.writeFile(path.join(root,file),JSON.stringify(obj,null,2));}
async function hashes(){const r={};for(const p of Object.keys(baseHashes))r[p]=crypto.createHash('sha256').update(await fs.readFile(path.join('/opt/digitalme-v2',p))).digest('hex');assert.deepEqual(r,baseHashes,'online product drift');return r;}
function plainStop(message){const e=new Error(message);e.name='DiagnosticStop';return e;}
async function initLive(){
 await hashes();journal=await fs.readFile(journalPath,'utf8').then(JSON.parse,e=>{if(e.code==='ENOENT')return [];throw e;});
 const env={};for(const line of (await fs.readFile('/etc/digitalme-relay.env','utf8')).split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
 config={baseUrl:env.MANAGED_AI_PROVIDER_BASE_URL||'https://api.deepseek.com/v1',apiKey:env.MANAGED_AI_PROVIDER_API_KEY,model:env.MANAGED_AI_PROVIDER_MODEL||'deepseek-v4-flash'};
 assert.equal(config.baseUrl.replace(/\/$/,''),'https://api.deepseek.com/v1');assert.ok(config.apiKey);live=true;
 // Restrict transport to the existing model endpoint. No search or other hosts.
 global.fetch=async (url,options)=>{assert.equal(String(url),config.baseUrl.replace(/\/$/,'')+'/chat/completions');activeRow.httpStartedAt=new Date().toISOString();return actualFetch(url,options);};
}
function rawTool(name,args,id='tool_1'){return {id,type:'function',function:{name,arguments:JSON.stringify(args)}};}
function fixtureResponse(text,toolCalls){return new Response(JSON.stringify({id:'fixture',model:'fixture-model',choices:[{finish_reason:toolCalls?.length?'tool_calls':'stop',message:{content:text,...(toolCalls?.length?{tool_calls:toolCalls}:{})}}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}),{status:200,headers:{'content-type':'application/json'}});}
async function one(stage,{fixture,deadlineMs=90000,cancelBoundary,denyWrite=false}={}){
 if(live)assert.equal(await fs.stat(path.join(root,'live-'+stage+(cancelBoundary?'-'+cancelBoundary:'')+'.json')).then(()=>true,()=>false),false,'no repeated stage');
 currentStage=stage;const start=performance.now(),expires=start+deadlineMs,controller=new AbortController(),events=[],rows=[];
 const timer=setTimeout(()=>controller.abort(new Error('shared_deadline')),deadlineMs);timer.unref();
 const stat=fs.stat,writeFile=fs.writeFile;let boundaryTriggered=false;
 const cancelPath=path.join(folder,'cancelled.txt'),writtenPath=path.join(folder,'neutral-result.txt'),readPath=path.join(folder,'neutral.txt');
 const original=JSON.parse(await fs.readFile(path.join(root,'input.json'),'utf8'));
 const thread=emptyThread(new Date().toISOString());if(stage==='compare')thread.discoveryGoal=original.goal;
 const prompts={compare:compareText,read:`请调用 read_file 读取 ${readPath}，告诉我蓝色和绿色文件夹总数与核验码。不写文件、不联网。`,write:'我明确授权你用 write_file 在已授权目录新建 neutral-result.txt，内容为“库存核验完成：总计10个，核验码Q7R3。”，然后用 read_file 回读并交付。不联网、不读目录外文件。',cancel:'我明确授权你用 write_file 在已授权目录新建 cancelled.txt，内容为“取消边界测试”。只写这个文件，不联网。',recovery:'这是隔离测试，请在对话中说明核验结果，不读写文件、不联网。'};
 if(stage==='read')await fs.writeFile(readPath,'离线库存样本：蓝色文件夹7个，绿色文件夹3个。核验码Q7R3。\n');
 if(cancelBoundary==='before_write')fs.stat=async function(p,...args){try{return await stat.call(fs,p,...args);}finally{if(path.resolve(String(p))===cancelPath){boundaryTriggered=true;controller.abort(new Error('user_cancel_after_async_stat_before_write'));events.push({type:'cancel',source:'user',boundary:cancelBoundary});}}};
 if(cancelBoundary==='after_write')fs.writeFile=async function(p,...args){const r=await writeFile.call(fs,p,...args);if(path.resolve(String(p))===cancelPath){boundaryTriggered=true;controller.abort(new Error('user_cancel_after_actual_write'));events.push({type:'cancel',source:'user',boundary:cancelBoundary});}return r;};
 let stageCalls=0;let transportAttemptedAfterStop=0;let output;
 try{
  const result=await runTalkTurn({thread,userText:prompts[stage],selfContext:stage==='compare'?original.selfContext:'没有本人认识，这是隔离测试样本。',agents:[],workRoot:folder,writeFolders:denyWrite?[]:[folder],contextPaths:stage==='read'?[readPath]:[],now:new Date().toISOString(),signal:controller.signal,deadlineAt:Date.now()+deadlineMs,onExecution:e=>events.push(e),
   chat:async input=>{
    controller.signal.throwIfAborted();const left=Math.floor(expires-performance.now());if(left<=0)throw plainStop('shared deadline exhausted');
    if(live&&journal.length>=7)throw plainStop('supplier call budget exhausted');
    assert.ok(++stageCalls<=8,'tool round budget');
    const id=crypto.randomUUID(),row={requestId:id,stage,startedAt:new Date().toISOString(),remainingMs:left,configuredModel:live?config.model:'fixture-model',maxTokens:2048,thinking:'disabled',toolCount:input.tools?.length||0,inputHash:crypto.createHash('sha256').update(JSON.stringify({messages:input.messages,tools:input.tools})).digest('hex')};
    const t=performance.now();rows.push(row);
    activeRow=row;
    if(live){journal.push(row);await save('supplier-journal.json',journal);}
    else global.fetch=async (url,options)=>{const body=JSON.parse(options.body);assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.max_tokens,2048);assert.deepEqual(body.tools||[],input.tools||[]);return fixture(input,stageCalls);};
    try{
     if(controller.signal.aborted||performance.now()>=expires){transportAttemptedAfterStop++;throw plainStop('stopped before HTTP');}
     const response=await chatComplete({...config,baseUrl:live?config.baseUrl:'https://fixture.invalid/v1',apiKey:live?config.apiKey:'fixture',model:live?config.model:'fixture-model',messages:input.messages,tools:input.tools,maxTokens:2048,thinking:{type:'disabled'},timeoutMs:Math.max(1,Math.floor(expires-performance.now())),signal:controller.signal});
     Object.assign(row,{elapsedMs:Math.round(performance.now()-t),httpStatus:response.providerMeta?.httpStatus,finishReason:response.finishReason,outputLength:response.text.length,toolCallCount:response.toolCalls?.length||0,reasoningLength:response.providerMeta?.reasoningLength,reasoningTokens:response.providerMeta?.reasoningTokens??null,returnedModel:response.providerMeta?.model,usage:response.usage||null,usageSource:live?'provider':'fixture',text:response.text,rawToolCalls:response.toolCalls||[]});
     if(response.truncated||response.finishReason==='length')throw plainStop('truncated');
     if(!response.text.trim()&&!response.toolCalls?.length)throw plainStop('empty_body');
     return {text:response.text,toolCalls:response.toolCalls?.map(t=>({id:t.id,name:t.function.name,arguments:t.function.arguments}))};
    }catch(e){row.error=e.name;row.failureKind=e.kind||e.message;row.httpStatus=typeof e.status==='number'?e.status:row.httpStatus;row.elapsedMs=Math.round(performance.now()-t);row.cancelSource=controller.signal.aborted?(controller.signal.reason?.message||'cancelled'):null;throw plainStop(row.cancelSource||'supplier_failed');}
    finally{if(live)await save('supplier-journal.json',journal);}
   }});
  const text=result.thread.turns.at(-1)?.text||'';assert.ok(text.trim()&&text!=='我在。请再说一次你想让我做什么。','no valid final');
  output={status:'completed',elapsedMs:Math.round(performance.now()-start),stageCalls,text,events,rows};
  if(stage==='compare'){for(const obj of original.goal.objects)assert.ok(text.includes(obj.url),'final lacks source URL');assert.ok(text.length>200,'comparison incomplete');}
  if(stage==='read'){assert.ok(events.some(e=>e.capabilityId==='read_file'&&e.ok),'no actual read');assert.ok(text.includes('Q7R3')&&text.includes('10'),'read answer incorrect');}
  if(stage==='write'){const disk=await fs.readFile(writtenPath,'utf8');assert.equal(disk,'库存核验完成：总计10个，核验码Q7R3。');assert.ok(events.some(e=>e.capabilityId==='read_file'&&e.ok),'explicit readback missing');output.disk={text:disk,bytes:Buffer.byteLength(disk),sha256:crypto.createHash('sha256').update(disk).digest('hex')};}
 }catch(e){output={status:'stopped',error:e.message,elapsedMs:Math.round(performance.now()-start),stageCalls,cancelled:controller.signal.aborted,cancelSource:controller.signal.reason?.message,events,rows};}
 finally{clearTimeout(timer);fs.stat=stat;fs.writeFile=writeFile;if(!live)global.fetch=actualFetch;}
 if(stage==='cancel'){const exists=await stat(cancelPath).then(()=>true,()=>false);Object.assign(output,{cancelFileExists:exists,boundaryTriggered,transportAttemptedAfterStop});if(cancelBoundary==='before_write')assert.ok(boundaryTriggered&&output.cancelled&&!exists&&stageCalls===1,'before-write cancellation failed');if(cancelBoundary==='after_write')assert.ok(boundaryTriggered&&output.cancelled&&exists&&events.some(e=>e.observedEffect?.mutated),'actual pre-cancel effect lost');}
 await save((live?'live-':'fixture-')+stage+(cancelBoundary?'-'+cancelBoundary:'')+'.json',output);return output;
}
async function fixtures(){
 const recovery=await one('recovery',{fixture:(input,n)=>{
  if(n===1){const d=input.tools.find(t=>t.function.name==='set_expected_effects');assert.equal(d.function.parameters.properties.effects.minItems,undefined);return fixtureResponse('',[rawTool('set_expected_effects',{effects:[]},'empty')]);}
  if(n===2){assert.ok(input.messages.some(m=>m.role==='tool'&&String(m.content).includes('effects 不能为空')));return fixtureResponse('',[rawTool('set_expected_effects',{effects:[{effect:'observation',expectedState:'已完成核验'}]},'corrected')]);}
  return fixtureResponse('已收到空参数错误，修正核验点后完成说明。');}});
 assert.equal(recovery.status,'completed');assert.deepEqual(recovery.events.filter(e=>e.capabilityId==='set_expected_effects').map(e=>e.ok),[false,true]);assert.equal(recovery.stageCalls,4);
 await save('fixture-recovery-success.json',recovery);
 const read=await one('read',{fixture:(input,n)=>n===1?fixtureResponse('',[rawTool('read_file',{path:path.join(folder,'neutral.txt')})]):fixtureResponse('文件夹总数10个，核验码Q7R3。')});assert.equal(read.status,'completed');
 const write=await one('write',{fixture:(input,n)=>n===1?fixtureResponse('',[rawTool('write_file',{relativePath:'neutral-result.txt',content:'库存核验完成：总计10个，核验码Q7R3。'},'write'),rawTool('read_file',{path:path.join(folder,'neutral-result.txt')},'read')]):fixtureResponse('已写入并回读，总计10个，核验码Q7R3。')});assert.equal(write.status,'completed');
 const cancelFixture=()=>fixtureResponse('',[rawTool('write_file',{relativePath:'cancelled.txt',content:'取消边界测试'})]);
 const failed=await one('recovery',{fixture:()=>new Response('{}',{status:503})});assert.equal(failed.status,'stopped');assert.equal(failed.stageCalls,1,'HTTP failure must not retry');
 await save('fixture-network-failure.json',failed);
 const deadline=await one('recovery',{deadlineMs:25,fixture:input=>new Promise((resolve,reject)=>input.signal.addEventListener('abort',()=>reject(input.signal.reason),{once:true}))});assert.equal(deadline.status,'stopped');assert.ok(deadline.cancelled);assert.equal(deadline.stageCalls,1);await save('fixture-deadline.json',deadline);
 live=true;journal=Array.from({length:7},()=>({fixture:true}));const budget=await one('recovery',{fixture:()=>{throw Error('must not reach transport');}});live=false;journal=[];assert.equal(budget.status,'stopped');assert.equal(budget.stageCalls,0);await save('fixture-budget.json',budget);
 const before=await one('cancel',{fixture:cancelFixture,cancelBoundary:'before_write'});const after=await one('cancel',{fixture:cancelFixture,cancelBoundary:'after_write'});
 // Files remain evidence; live run uses a separate root.
 await save('fixture-summary.json',{passed:true,realSupplierCalls:0,cases:['error_return_continue_final','real_read','authorized_write_readback','HTTP_error_no_retry','deadline_no_next_call','budget_no_next_call','cancel_before_write','cancel_after_write'],recoveryCalls:recovery.stageCalls,before:before.cancelFileExists,after:after.cancelFileExists});console.log('FIXTURE_PASS');
}
(async()=>{
 await fs.mkdir(folder,{recursive:true});
 if(mode==='fixture'){await fixtures();return;}
 assert.ok(['compare','tools'].includes(mode));await initLive();
 const evidence=path.join(root,'live-'+mode+'.json');assert.equal(await fs.stat(evidence).then(()=>true,()=>false),false,'no rerun');
 let stages=[];
 if(mode==='compare'){stages.push(await one('compare'));}
 else{
  const prior=JSON.parse(await fs.readFile(path.join(root,'live-compare.json')));assert.equal(prior.status,'completed','comparison failed; stop');
  for(const stage of ['read','write','cancel']){if(journal.length>=7){stages.push({stage,status:'not_run',reason:'supplier call budget exhausted'});break;}const result=await one(stage,stage==='cancel'?{cancelBoundary:'before_write'}:{});stages.push(result);if(stage!=='cancel'&&result.status!=='completed')break;}
 }
 const summary={mode,stages,supplierCalls:journal.length,searchCalls:0,automaticRetries:0,onlineHashesUnchanged:!!(await hashes()),usage:journal.reduce((a,r)=>{if(r.usage){a.inputTokens+=r.usage.inputTokens;a.outputTokens+=r.usage.outputTokens;a.totalTokens+=r.usage.totalTokens;}else a.unknownCalls++;return a;},{inputTokens:0,outputTokens:0,totalTokens:0,unknownCalls:0})};await save('summary-'+mode+'.json',summary);console.log('SAFE_INPROCESS_RESULT '+Buffer.from(JSON.stringify(summary)).toString('base64'));
})().catch(e=>{console.error('DIAGNOSTIC_STOP '+e.message);process.exitCode=1;}).finally(()=>{global.fetch=actualFetch;});
