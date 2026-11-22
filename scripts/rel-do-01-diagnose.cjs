'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {runTalkTurn}=require('../dist/intelligence/loop');
const {emptyThread}=require('../dist/intelligence/store');
const out=path.resolve(__dirname,'../build/evidence/rel-do-01');
(async()=>{
 await fs.mkdir(out,{recursive:true});
 const results=[];
 for(const atBoundary of [false,true]){
  const ac=new AbortController();const file=path.join(out,atBoundary?'late.md':'early.md');
  await fs.rm(file,{force:true});const timeline=[],execs=[];
  let calls=0;
  const originalStat=fs.stat;
  if(atBoundary)fs.stat=async function(p,...rest){
    if(String(p)===file && !ac.signal.aborted){
      timeline.push('write preflight stat entered');
      let result,error;try{result=await originalStat(p,...rest)}catch(e){error=e}
      timeline.push('cancel requested before mkdir/write');ac.abort(Object.assign(Error('cancel'),{name:'TalkCancelled'}));
      if(error)throw error;return result;
    }return originalStat(p,...rest);
  };
  if(!atBoundary){timeline.push('cancel requested before model/tool');ac.abort(Object.assign(Error('cancel'),{name:'TalkCancelled'}));}
  try{
   await runTalkTurn({thread:emptyThread(new Date().toISOString()),userText:'写一个诊断文件',selfContext:'无本人事实',agents:[],workRoot:out,writeFolders:[out],now:new Date().toISOString(),signal:ac.signal,
    chat:async()=>{calls++;return {text:'',toolCalls:[{id:'write',name:'write_file',arguments:JSON.stringify({relativePath:path.basename(file),content:'REL-DO-01 actual file write boundary evidence'})}]};},
    onExecution:r=>{execs.push(r);if(r.observedEffect?.mutated)timeline.push('actual mutation recorded after cancel='+ac.signal.aborted);}
   });
  }catch(e){timeline.push('turn stopped: '+e.name)}finally{fs.stat=originalStat}
  const exists=await fs.stat(file).then(()=>true,()=>false);
  results.push({case:atBoundary?'cancel during prewrite await':'cancel before turn',exists,modelCalls:calls,timeline,executions:execs.map(({capabilityId,ok,outputPath,observedEffect})=>({capabilityId,ok,outputPath,observedEffect}))});
 }
 const report={kind:'current Talk runtime, deterministic scheduling probe, real filesystem; model output scripted',results};
 await fs.writeFile(path.join(out,'diagnosis.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
