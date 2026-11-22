'use strict';
// Historical candidates + injected transport outcomes. No network or live acceptance.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createManagedAiChatComplete}=require('../dist/capability/managed-ai-client');
const {seekContent}=require('../dist/subject-comm/content-seek');
const {defaultDiscoverIntent}=require('../dist/subject-comm/discover-intent');
const {settleBackgroundSeek}=require('../dist/subject-comm/discover-search-generation');
const {completeStructured}=require('../dist/subject-comm/structured-call');
(async()=>{
 const source=path.resolve('build/evidence/core-link-managed/01-discover.json');
 const view=JSON.parse(await fs.readFile(source,'utf8')),stat=await fs.stat(source);
 const cards=(view.unjudgedCards||[]).filter(c=>c.url.includes('coding.imooc.com/class/')).slice(0,2);
 assert.equal(cards.length,2);
 const archive={kind:'historical candidate replay; not live acceptance',sourceFile:path.relative(process.cwd(),source),recordedAt:stat.mtime.toISOString(),retrievedAt:null,timeNote:'Original acquisition timestamp not captured; recordedAt is file save time, not publication or exact retrieval time.',query:view.searchQuery,cards};
 const cases=[];
 for(const [name,http,body] of [['empty-truncated',200,{ok:true,status:'AVAILABLE',text:'',finishReason:'length',truncated:true}],['invalid-envelope',200,'not-json'],['service-error',503,{ok:false,status:'PROVIDER_5XX'}]]){
  let payload;
  const chat=createManagedAiChatComplete({gatewayUrl:'https://offline.invalid',installToken:'fixture',fetchImpl:async(_url,opts)=>{payload=JSON.parse(opts.body);return new Response(typeof body==='string'?body:JSON.stringify(body),{status:http})}});
  try{const r=await chat({messages:[],thinking:{type:'disabled'}});assert.equal(name,'empty-truncated');assert.equal(r.truncated,true);cases.push({name,diagnostic:r.diagnostic,thinkingForwarded:!!payload.thinking})}catch(e){if(name==='empty-truncated')throw e;cases.push({name,errorStatus:e.status,diagnostic:e.diagnostic,thinkingForwarded:!!payload.thinking})}
 }
 const items=cards.map(c=>({schemaVersion:1,itemId:c.itemId,publisherSubjectId:'historical_imooc',kind:'content',createdAt:archive.recordedAt,visibility:'public',content:{title:c.title,text:c.text,url:c.url,contentType:'article'},provenance:{origin:'publisher',actor:'owner',statedAt:archive.recordedAt,via:'historical-replay'}}));
 const counts={search:0,externalNetwork:0,modelFixture:0};
 const replay=await seekContent({query:archive.query,items,intent:defaultDiscoverIntent(archive.query),skipWeb:true,skipOpenMedia:true,model:{baseUrl:'https://offline.invalid',model:'fixture'},chatComplete:async()=>{counts.modelFixture++;return {text:'',finishReason:'length',truncated:true}}});
 assert.equal(replay.unjudgedCards.length,2);assert.equal(replay.cards.length,0);
 const notes=[];await completeStructured({chat:async()=>({text:'',finishReason:'length',truncated:true}),request:{messages:[]},parse:()=>null,onAttempt:n=>notes.push(n)});
 const ac=new AbortController();const terminal=await settleBackgroundSeek(new Promise(()=>{}),10,ac);assert.equal(terminal,null);assert.equal(ac.signal.aborted,true);
 const out={archive,cases,counts,downstream:{retainedCandidates:replay.unjudgedCards.length,primary:replay.cards.length,notice:replay.notice},structuredAttempts:notes,deadline:{settled:true,signalAborted:ac.signal.aborted,reason:ac.signal.reason},limitations:'Injected empty/truncated outcome checks repaired local handling; does not establish historical provider finish_reason or HTTP body.'};
 await fs.writeFile('review/core-link-02/evidence/offline-downstream-replay-fixed.json',JSON.stringify(out,null,2));console.log(JSON.stringify({cases,counts,downstream:out.downstream,deadline:out.deadline}));
})().catch(e=>{console.error(e);process.exitCode=1});
