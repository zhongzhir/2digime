'use strict';
const fs=require('node:fs/promises');
const {createManagedAiChatComplete}=require('../dist/capability/managed-ai-client');
const {classifyCandidateRoles,defaultDiscoverIntent,judgmentsFromModelText}=require('../dist/subject-comm/discover-intent');
const {SubjectService}=require('../dist/subject-core/subject-service');
(async()=>{
 const phase=process.argv[2];if(!['courses','self'].includes(phase))throw Error('explicit phase required');
 const output=`review/core-link-02/evidence/deploy-23da0db-${phase}.json`;
 const reservation=await fs.open(output+'.reserved','wx');await reservation.close();
 if(phase==='self'){const course=JSON.parse(await fs.readFile('review/core-link-02/evidence/deploy-23da0db-courses.json'));if(!course.success)throw Error('course gate failed')}
 const archive=JSON.parse(await fs.readFile('review/core-link-02/evidence/offline-downstream-replay-fixed.json')).archive;
 const token=JSON.parse(await fs.readFile('build/evidence/core-link-managed-clean/private-user-data/install-capability-token.json')).token;
 const gatewayUrl=require('../electron/brand.cjs').loadBrand().webDiscoveryGatewayUrl;
 let applicationRequests=0,responseMetadata=null,requestId=null;
 const chat=createManagedAiChatComplete({gatewayUrl,installToken:token,timeoutMs:95000,fetchImpl:async(u,o)=>{
  if(applicationRequests>=1)throw Object.assign(Error('validation call budget'),{diagnostic:{failure:'truncated'}});
  applicationRequests++;const payload=JSON.parse(o.body);requestId=payload.idempotencyKey;
  const res=await fetch(u,o);const j=await res.clone().json();
  responseMetadata={httpStatus:res.status,status:j.status,finishReason:j.finishReason||null,outputLength:typeof j.text==='string'?j.text.length:null,usage:j.usage||null,truncated:j.truncated===true};return res;
 }});
 const startedAt=new Date().toISOString(),start=Date.now();let success=false,diagnostic=null,validation=null;
 try{
  if(phase==='courses'){
   let request;const candidates=archive.cards.map(c=>({id:c.itemId,title:c.title,summary:c.text||'',url:c.url}));
   await classifyCandidateRoles({query:archive.query,intent:defaultDiscoverIntent(archive.query),candidates,model:{baseUrl:'https://offline.invalid',model:'managed-ai'},chatComplete:async o=>{request=o;throw Error('capture only')}});
   if(!request)throw Error('prompt capture failed');
   const r=await chat({...request,stage:'discover.judgment',timeoutMs:95000,deadlineAt:Date.now()+95000});diagnostic=r.diagnostic;
   const judgments=judgmentsFromModelText(r.text,candidates.map(c=>c.id));
   validation={judged:judgments.size,expected:2,judgments:Array.from(judgments.entries()),historicalCandidates:true,retrievedAt:archive.retrievedAt};
   success=!r.truncated&&r.finishReason!=='length'&&judgments.size===2;
  }else{
   const service=new SubjectService();service.setDistillModelRuntime({enabled:true,model:{providerId:'managed-ai',baseUrl:'https://offline.invalid',model:'managed-ai'},chatComplete:chat});
   const text=await service.completeSemanticJson('你是数字之我的结构化理解入口。只返回JSON，字段 durationMinutes:number 与 scope:string。一次性任务时间条件使用 current_goal，不写成长期本人事实。','隔离测试样本：这次学习计划改为每天30分钟，仅对当前目标生效。');
   const parsed=text?JSON.parse(text):null;validation={jsonParsed:!!parsed,durationMinutes:parsed?.durationMinutes,scope:parsed?.scope,formalSubjectRead:false,formalSubjectWritten:false};
   success=!!parsed&&parsed.durationMinutes===30&&parsed.scope==='current_goal'&&responseMetadata?.finishReason!=='length';
  }
 }catch(e){diagnostic=e.diagnostic||null;validation={failure:diagnostic?.failure||'validation_error'}}
 const result={phase,startedAt,endedAt:new Date().toISOString(),elapsedMs:Date.now()-start,applicationRequests,searchCalls:0,requestId,responseMetadata,diagnostic,validation,success};
 await fs.writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!success)process.exitCode=2;
})().catch(e=>{console.error(e.name+': '+(e.code||'validation setup failed'));process.exitCode=3});
