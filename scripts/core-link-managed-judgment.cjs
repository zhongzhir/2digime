
'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {createManagedAiChatComplete}=require('../dist/capability/managed-ai-client');
const {classifyCandidateRoles,defaultDiscoverIntent}=require('../dist/subject-comm/discover-intent');
(async()=>{
 const archive=JSON.parse(await fs.readFile('review/core-link-02/evidence/offline-downstream-replay-fixed.json','utf8')).archive;
 const ud='build/evidence/core-link-managed-clean/private-user-data';
 const token=JSON.parse(await fs.readFile(path.join(ud,'install-capability-token.json'),'utf8')).token;
 const gateway=require('../electron/brand.cjs').loadBrand().webDiscoveryGatewayUrl;
 const chat=createManagedAiChatComplete({gatewayUrl:gateway,installToken:token});const rows=[];let calls=0;
 for(const mode of (process.argv[2]==='boundaries'?['deadline','user']:['normal'])){
  const ac=new AbortController();const start=Date.now();const deadlineAt=start+(mode==='deadline'?1500:60000);
  const timer=mode==='user'?setTimeout(()=>ac.abort('user'),1500):null;
  try{
   const result=await classifyCandidateRoles({query:archive.query,intent:defaultDiscoverIntent(archive.query),candidates:archive.cards.map(c=>({id:c.itemId,title:c.title,summary:c.text||'',url:c.url,medium:'unknown'})),model:{baseUrl:gateway,model:'managed'},deadlineAt,signal:ac.signal,onAttempt:a=>rows.push({mode,kind:'attempt',...a}),chatComplete:async o=>{
    if(++calls>3)throw Error('budget exhausted');
    try{const r=await chat(o);rows.push({mode,kind:'transport',at:new Date().toISOString(),...r.diagnostic});return r;}catch(e){rows.push({mode,kind:'transport',at:new Date().toISOString(),status:e.status,...e.diagnostic});throw e;}
   }});
   rows.push({mode,kind:'outcome',startedAt:new Date(start).toISOString(),ms:Date.now()-start,attempts:result.attempts,judged:result.judgments.size,unjudged:result.unjudgedIds.length});
  }finally{if(timer)clearTimeout(timer)}
  if(mode==='normal'&&!rows.some(r=>r.mode==='normal'&&r.kind==='outcome'&&r.judged===2))break;
 }
 const report={kind:'real managed judgment of historical candidates; no search; no live course acceptance',source:archive.sourceFile,retrievedAt:archive.retrievedAt,recordedAt:archive.recordedAt,searchCalls:0,clientModelCalls:calls,rows};
 await fs.writeFile('review/core-link-02/evidence/managed-judgment-'+(process.argv[2]==='boundaries'?'boundaries-':'')+'20261006.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.name+': '+(e.code||'failed'));process.exitCode=1});
