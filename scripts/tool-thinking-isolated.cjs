'use strict';
// Real supplier responses bridged from an isolated ECS process; real local Talk tools.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {runTalkTurn}=require('../dist/intelligence/loop'),{emptyThread}=require('../dist/intelligence/store');
const {selectSelfContext,formatSelfContext}=require('../dist/intelligence/self-context');
const mode=process.argv[2],root=path.resolve('build/evidence/tool-thinking-20261006'),folder=path.join(root,'authorized');
let count=0;const began=Date.now(),deadlineAt=began+90000,controller=new AbortController();
const stat=fs.stat,events=[];
async function save(name,obj){await fs.writeFile(path.join(root,name+'.json'),JSON.stringify(obj,null,2));}
(async()=>{
 await fs.mkdir(folder,{recursive:true});
 const stored=JSON.parse(await fs.readFile('build/evidence/core-link-historical-20261006/02-failed-persisted-state.json'));
 const compare='请比较所选两门历史课程，沿用发现里的原需求和时间约束，推荐先学哪门及理由。保留来源链接，把历史材料与未核实项说清，不要联网、报名或付费。';
 const thread=emptyThread(new Date().toISOString());if(mode==='compare')thread.discoveryGoal=stored.thread.discoveryGoal;
 const readPath=path.join(folder,'neutral.txt'),cancelPath=path.join(folder,'cancelled.txt');
 if(mode==='read')await fs.writeFile(readPath,'离线库存样本：蓝色文件夹 7 个，绿色文件夹 3 个。核验码 Q7R3。\n');
 if(mode==='cancel')fs.stat=async function(p,...args){try{return await stat.call(fs,p,...args);}finally{if(path.resolve(String(p))===cancelPath){controller.abort(new Error('user_cancel_after_async_stat_before_write'));events.push({type:'user_cancel',boundary:'after_async_stat_before_write'});}}};
 const prompts={compare,read:`请用 read_file 读取已授权文件 ${readPath}，告诉我两种文件夹总数和核验码。不联网，不写文件。`,write:'我授权你在已授权目录用 write_file 新建 neutral-result.txt，内容为“库存核验完成：总计10个，核验码Q7R3。”，再用 read_file 回读后告诉我实际结果。不联网，不读目录外文件。',cancel:'我授权你用 write_file 在已授权目录新建 cancelled.txt，内容为“取消边界测试”。只写这一个文件，不联网。'};
 assert.ok(prompts[mode]);
 const result=await runTalkTurn({thread,userText:prompts[mode],selfContext:mode==='compare'?formatSelfContext(selectSelfContext(stored.self,compare)):'当前没有本人认识；这是隔离工具验证。',agents:[],workRoot:folder,writeFolders:[folder],contextPaths:mode==='read'?[readPath]:[],now:new Date().toISOString(),signal:controller.signal,deadlineAt,
 onExecution:e=>events.push(e),chat:async input=>{
  controller.signal.throwIfAborted();assert.ok(Date.now()<deadlineAt,'shared deadline exhausted');assert.ok(++count<=3,'per-case limit');
  const id=mode+'-'+count;
  if(mode==='compare'&&count===1){const frozen=JSON.parse(await fs.readFile(path.join(root,'frozen-compare.json')));input.messages.splice(0,input.messages.length,...frozen.payload.messages);input.tools=frozen.payload.tools;}
  await save(id+'-request',{id,mode,deadlineAt,payload:{messages:input.messages,tools:input.tools||[],max_tokens:2048,stream:false},remainingMs:deadlineAt-Date.now()});
  console.log('WAIT_RESPONSE '+id);
  let response;while(Date.now()<deadlineAt){try{response=JSON.parse(await fs.readFile(path.join(root,id+'-response.json')));break;}catch(e){if(e.code!=='ENOENT')throw e;}await new Promise(r=>setTimeout(r,200));}
  assert.ok(response,'deadline awaiting isolated supplier');
  if(response.error||response.finishReason==='length'||(!response.text&&!response.toolCalls?.length))throw Error('supplier comparison/tool failure: '+(response.error||response.finishReason||'empty'));
  events.push({type:'supplier_response',id,toolCount:input.tools?.length||0,finishReason:response.finishReason});return response;
 }});
 const disk=mode==='write'?{path:path.join(folder,'neutral-result.txt'),text:await fs.readFile(path.join(folder,'neutral-result.txt'),'utf8')}:undefined;
 if(mode==='write')assert.equal(disk.text,'库存核验完成：总计10个，核验码Q7R3。');
 await save(mode+'-result',{elapsedMs:Date.now()-began,calls:count,result,events,disk});console.log('DONE '+mode);
})().catch(async e=>{const exists=mode==='cancel'?await stat(cancelPathSafe()).then(()=>true,()=>false):undefined;await save(mode+'-result',{elapsedMs:Date.now()-began,calls:count,error:e.message,cancelled:controller.signal.aborted,cancelFileExists:exists,events});console.log('STOP '+mode+' '+e.message);if(mode!=='cancel'||!controller.signal.aborted)process.exitCode=1;}).finally(()=>{fs.stat=stat;});
function cancelPathSafe(){return path.join(folder,'cancelled.txt');}
