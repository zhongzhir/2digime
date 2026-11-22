'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {runTalkTurn}=require('../dist/intelligence/loop'),{emptyThread}=require('../dist/intelligence/store');
const out=path.resolve(__dirname,'../build/evidence/rel-do-01-fixed');
(async()=>{
 await fs.mkdir(out,{recursive:true});const results=[];
 for(const format of ['md','docx','pptx'])for(const overwrite of [false,true])for(const boundary of ['prewrite-mkdir','after-write','preflight-stat']){
  const file=path.join(out,`${format}-${overwrite}-${boundary}.${format}`),old=Buffer.from('ORIGINAL CONTENT MUST SURVIVE');
  await fs.rm(file,{force:true});if(overwrite)await fs.writeFile(file,old);
  const ac=new AbortController(),records=[],timeline=[];
  const originals={stat:fs.stat,mkdir:fs.mkdir,writeFile:fs.writeFile};
  const cancel=()=>{timeline.push('cancel requested');ac.abort(Object.assign(Error('cancel'),{name:'TalkCancelled'}))};
  fs.stat=async(...args)=>{let value,error;try{value=await originals.stat(...args)}catch(e){error=e};if(boundary==='preflight-stat'&&String(args[0])===file&&!ac.signal.aborted)cancel();if(error)throw error;return value};
  fs.mkdir=async(...args)=>{const result=await originals.mkdir(...args);if(boundary==='prewrite-mkdir'&&String(args[0])===out&&!ac.signal.aborted)cancel();return result};
  fs.writeFile=async(...args)=>{assert.equal(ac.signal.aborted,false,'no file write may start after cancel');const result=await originals.writeFile(...args);if(String(args[0])===file){timeline.push('file write completed');if(boundary==='after-write')cancel();}return result};
  let stopped;
  try{await runTalkTurn({thread:emptyThread(new Date().toISOString()),userText:'取消边界验证',selfContext:'',agents:[],workRoot:out,writeFolders:[out],now:new Date().toISOString(),signal:ac.signal,
   chat:async()=>({text:'',toolCalls:[{id:'write',name:format==='md'?'write_file':'export_file',arguments:JSON.stringify({relativePath:path.basename(file),content:'# Real cancellation test\nActual file effect',...(format==='md'?{}:{format})})}]}),
   onExecution:r=>{records.push(r);if(r.observedEffect?.mutated)timeline.push('actual mutation recorded')}
  });}catch(e){stopped=e.name;}finally{Object.assign(fs,originals)}
  assert.equal(stopped,'TalkCancelled');
  const bytes=await fs.readFile(file).catch(e=>{if(e.code==='ENOENT')return null;throw e});
  const committed=boundary==='after-write';
  if(committed){assert.ok(bytes?.length);assert.ok(!bytes.equals(old));assert.equal(records.some(r=>r.observedEffect?.mutated),true)}
  else{assert.equal(records.some(r=>r.observedEffect?.mutated),false);if(overwrite)assert.deepEqual(bytes,old);else assert.equal(bytes,null)}
  results.push({format,overwrite,boundary,stopped,fileExists:!!bytes,oldContentPreserved:overwrite&&!committed,timeline,executions:records});
 }
 await fs.writeFile(path.join(out,'regression.json'),JSON.stringify({kind:'scripted model, controlled async boundaries, real filesystem; no rollback claimed',results},null,2));
 console.log(`${results.length} cancellation boundary cases passed; new/overwrite/docx/pptx; committed effects retained.`);
})().catch(e=>{console.error(e);process.exitCode=1});
