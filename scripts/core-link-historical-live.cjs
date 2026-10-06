'use strict';
// Historical supply restored into an isolated Package; downstream uses real Electron Talk and managed AI.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {launchDigitalMeElectron,skipWelcomeAndEnterShell}=require('../dist/runtime/tests/electron-harness');
const {FileNetworkItemStore}=require('../dist/relay-service/network-item-store');
const {saveRecommendationAdjustment}=require('../dist/subject-comm/recommendation-adjustment');
const {readThread}=require('../dist/intelligence/store');
const {readDigitalSelf}=require('../dist/subject-core/digital-self/store');
const out=path.resolve('build/evidence/core-link-historical-20261006'),ud=path.join(out,'private-user-data'),pkg=path.join(out,'package'),artifacts=path.join(out,'artifacts');
const phase=process.argv[2];if(!['before','after'].includes(phase))throw Error('phase required');
let h;
async function save(name,value){await fs.writeFile(path.join(out,name+'.json'),JSON.stringify(value,null,2));}
async function cmd(name,input){return h.page.evaluate(({name,input})=>window.digitalMe.invoke(name,input),{name,input});}
async function snapshot(label){const thread=await readThread(pkg,new Date().toISOString()),self=await readDigitalSelf(pkg,'',new Date().toISOString());await save(label,{thread,self});return thread;}
async function send(label,text){
 const started=Date.now();await h.page.locator('#nav-chat').click();await h.page.locator('#chat-input').fill(text);await h.page.locator('#btn-chat-send').click();
 await h.page.locator('#btn-chat-send:not([disabled])').waitFor({state:'visible',timeout:240000});
 const view=(await cmd('talk',{})).view;await save(label,{elapsedMs:Date.now()-started,input:text,view});
 await h.page.screenshot({path:path.join(out,label+'.png')});
 const trace=await h.app.evaluate(()=>global.__historicalTrace);await save('transport-'+phase,trace);
 console.log(JSON.stringify({phase:label,elapsedMs:Date.now()-started,lastAssistant:view.turns.at(-1)?.text,requests:trace.requests.length}));
 if(trace.failed)throw Error('transport failure; stop without rerun');
 return view;
}
async function readActual(label,name){
 const absolute=path.join(artifacts,name),bytes=await fs.readFile(absolute),thread=await readThread(pkg,new Date().toISOString());
 const evidence={path:absolute,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),text:bytes.toString(),executions:thread.executions.filter(e=>e.outputPath===absolute||JSON.stringify(e).includes(name))};
 await save(label,evidence);console.log(JSON.stringify({phase:label,bytes:evidence.bytes,sha256:evidence.sha256}));return evidence;
}
(async()=>{
 await fs.mkdir(ud,{recursive:true});await fs.mkdir(artifacts,{recursive:true});
 if(phase==='before'){
  assert.equal(await fs.stat(pkg).then(()=>true,()=>false),false,'do not reset or repeat a paid chain');
  await fs.copyFile('build/evidence/core-link-managed-clean/private-user-data/install-capability-token.json',path.join(ud,'install-capability-token.json'));
 }
 await fs.writeFile(path.join(ud,'ai-capability.json'),JSON.stringify({version:1,path:'managed'}));
 await fs.writeFile(path.join(ud,'web-discovery.json'),JSON.stringify({version:1,enabled:false,path:'managed'}));
 const previous=phase==='after'?JSON.parse(await fs.readFile(path.join(out,'transport-before.json'))).requests.length:0;
 h=await launchDigitalMeElectron({userData:ud,realProduct:true,extraEnv:{DIGITALME_V2_ALLOW_DEV_CREDENTIAL:'0',DIGITALME_V2_CREDENTIAL_IMPORT:'',DIGITALME_V2_SEARCH_ENABLED:'0',GEMINI_API_KEY:'',GEMINI_MODEL:'',GEMINI_SEARCH_MODEL:'',DEEPSEEK_API_KEY:'',OPENAI_API_KEY:''}});
 await skipWelcomeAndEnterShell(h.page);
 await h.app.evaluate(({app},args)=>{
  global.__historicalTrace={requests:[],blockedSearchCalls:0,blockedOtherNetwork:0,failed:false,budget:24,previousRequests:args.previous};
  const original=global.fetch;
  global.fetch=async function(url,options){
   const u=new URL(String(url)),t=global.__historicalTrace;
   if(u.pathname!=='/v1/ai/inference'&&u.pathname!=='/v1/ai/allowance'){
    if(/search|discovery/.test(u.pathname))t.blockedSearchCalls++;else t.blockedOtherNetwork++;
    throw Error('Historical replay: external supply disabled');
   }
   if(u.pathname==='/v1/ai/allowance')return original(url,options);
   if(t.failed||args.previous+t.requests.length>=t.budget)throw Error('Historical validation budget/stop boundary');
   const body=JSON.parse(options.body),entry={startedAt:new Date().toISOString(),requestId:body.idempotencyKey,stage:body.stage||null,maxTokens:body.maxTokens||null,toolCount:body.tools?.length||0,responseFormat:body.responseFormat?.type||null};t.requests.push(entry);const start=Date.now();
   try{const res=await original(url,options),json=await res.clone().json();Object.assign(entry,{httpStatus:res.status,status:json.status,finishReason:json.finishReason||null,outputLength:typeof json.text==='string'?json.text.length:null,toolCallCount:json.toolCalls?.length||0,usage:json.usage||null,elapsedMs:Date.now()-start,truncated:json.truncated===true});if(!res.ok||json.truncated||json.finishReason==='length'||(!json.text&&!json.toolCalls?.length))t.failed=true;return res;}
   catch(e){entry.failure=e.name;entry.elapsedMs=Date.now()-start;t.failed=true;throw e;}
  };
 },{previous});
 // Rebind the same ordinary managed capability after transport observation is installed.
 const model=await h.page.evaluate(()=>window.digitalMe.saveAiCapabilitySettings({path:'managed'}));assert.equal(model.modelReady,true);
 await save('model-'+phase,{modelReady:model.modelReady,geminiSearchConfigured:model.status?.geminiSearchConfigured,webDiscoveryEnabled:model.status?.webDiscoveryEnabled,realProduct:true,previousRequests:previous});
 if(phase==='before'){
  await cmd('subject.createPackage',{displayName:'历史课程下游隔离验收',targetDir:pkg});
  const archive=JSON.parse(await fs.readFile('review/core-link-02/evidence/offline-downstream-replay-fixed.json')).archive;
  const store=new FileNetworkItemStore(path.join(pkg,'content'));
  for(const c of archive.cards)await store.put({schemaVersion:1,itemId:c.itemId,publisherSubjectId:'historical_imooc',publisherDisplayName:'慕课网（历史候选）',kind:'content',visibility:'public',createdAt:archive.recordedAt,content:{title:c.title,text:c.text,url:c.url,contentType:'article'},provenance:{origin:'publisher',actor:'owner',statedAt:archive.recordedAt,via:'search',excerpt:'历史公开候选回放；原获取时间未保存，未重新搜索或核实。'}});
  // Restore historical supply and its recorded request, never fabricate a thread, correction, model output or self fact.
  await saveRecommendationAdjustment(pkg,{text:archive.query,summary:'历史原需求：学习 AI 产品落地，每天一小时',scope:'session',runtimeId:'historical-replay'});
  await fs.writeFile(path.join(pkg,'content/personal-feed-cache.json'),JSON.stringify({version:1,personal:{itemIds:archive.cards.map(c=>c.itemId),generatedAt:new Date().toISOString(),mode:'personal'},lastView:{itemIds:archive.cards.map(c=>c.itemId),generatedAt:new Date().toISOString(),mode:'personal'},rankedIds:archive.cards.map(c=>c.itemId)}));
  await save('00-history',{archive,setupOnly:['existing candidate storage','recorded historical request','derived display cache'],liveSearch:false,initialInterpretationTested:false});
  const view=(await cmd('content',{action:'asked'})).view;await save('01-historical-view',view);assert.equal(view.cards.length,2);
  await h.page.locator('#nav-discover').click();await h.page.evaluate(v=>window.ContentDiscoverPage.renderView({...v,notice:'历史候选回放，未执行实时搜索；获取时间未保存。'}),view);
  for(const c of archive.cards)await h.page.locator('li').filter({hasText:c.title}).getByRole('button',{name:'选择 / 取消比较'}).click();
  await h.page.locator('#content-discover-selection').getByRole('button',{name:'一起比较'}).click();
  await send('02-compare','请比较所选两门历史课程，沿用发现里的原需求和时间约束，推荐先学哪门及理由。保留来源链接，把历史材料与未核实项说清，不要联网、报名或付费。');
  const thread=await snapshot('02-goal');assert.equal(thread.discoveryGoal.objects.length,2);assert.match(thread.discoveryGoal.originalRequest,/每天.*一小时/);
  const overview=await cmd('subject.getOverview',{});const {saveFilesystemGrant}=require('../dist/authorization/filesystem-grant');await saveFilesystemGrant({packageRoot:pkg,subjectId:overview.subjectId,folder:artifacts,now:new Date().toISOString()});
  await send('03-plan','我明确委托你依据刚比较的两门历史课程和当前目标，制作两周学习计划。逐天列出分钟数、练习和可交付成果，保留来源和未知项；只选必要片段，不假设买课。请用 write_file 写到已授权目录的 learning-plan.md，再用 read_file 回读后交付，不联网。');
  await readActual('04-independent-read','learning-plan.md');
  await send('05-correct','更正同一个学习目标：工作日只有半小时，周末仍有一小时。请更新现有发现目标，保留原学习方向和两门课程；这个时长只适用于当前目标，不是长期本人事实。现在不写新文件、不联网。');
  const corrected=await snapshot('05-corrected-state');assert.match(corrected.discoveryGoal.request,/工作日/);assert.match(corrected.discoveryGoal.request,/周末/);
 }else{
  await cmd('subject.openPackage',{dir:pkg});
  const restored=await snapshot('06-restarted-state');assert.match(restored.discoveryGoal.request,/工作日/);assert.match(restored.discoveryGoal.request,/周末/);
  const view=(await cmd('content',{action:'asked'})).view;await save('06-discover-after-restart',view);assert.match(view.adjustment.text,/工作日/);assert.match(view.adjustment.text,/周末/);
  await send('07-revised-plan','根据同一个学习目标的最新条件重新制作两周计划，逐天列分钟数、练习和成果。先说明采用的时长条件，保存为已授权目录的 learning-plan-revised.md，并用 read_file 回读确认。不联网，不报名或付费。');
  await readActual('08-independent-revised-read','learning-plan-revised.md');await snapshot('08-final-state');
 }
 await save('transport-'+phase,await h.app.evaluate(()=>global.__historicalTrace));
})().catch(async e=>{console.error(e.message);await save('failure-'+phase,{message:e.message,at:new Date().toISOString()});process.exitCode=1;}).finally(async()=>{if(h){await save('transport-'+phase,await h.app.evaluate(()=>global.__historicalTrace).catch(()=>({unavailable:true})));await h.close();}});
