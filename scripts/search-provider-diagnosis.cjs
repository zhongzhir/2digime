'use strict';
// Existing credentials remain inside the Electron process; only safe status
// and provider quota metric names leave it. One neutral query, no retries.
const fs=require('node:fs/promises'),path=require('node:path');
const {launchDigitalMeElectron}=require('../dist/runtime/tests/electron-harness');
(async()=>{
 const root=path.resolve(__dirname,'..'),ud=path.join(root,'build/evidence/core-link-01/private-user-data');
 const h=await launchDigitalMeElectron({userData:ud,realProduct:true});
 try{
 const result=await h.app.evaluate(async ({app,safeStorage},{root,ud})=>{
  const require=process.getBuiltinModule('module').createRequire(root+'/package.json');
  const fs=process.getBuiltinModule('fs').promises;
  const {resolveModelConfig}=require(root+'/electron/bootstrap-secrets.cjs');
  const cfg=await resolveModelConfig({safeStorage,userDataPath:ud,isPackaged:false,allowDevRuntimeFile:false});
  const brand=require(root+'/electron/brand.cjs').loadBrand();
  const token=JSON.parse(await fs.readFile(ud+'/install-capability-token.json','utf8')).token;
  const redact=s=>String(s||'').replaceAll(cfg.geminiSearchApiKey||'__none__','[redacted]').replaceAll(token||'__none__','[redacted]');
  const pref=JSON.parse(await fs.readFile(ud+'/web-discovery.json','utf8'));
  const model=cfg.geminiSearchModel||'gemini-3.5-flash';
  const result={at:new Date().toISOString(),config:{searchPath:pref.path,geminiKeyPresent:!!cfg.geminiSearchApiKey,geminiModel:model,managedGatewayHost:new URL(brand.webDiscoveryGatewayUrl).hostname,installationIdentityChanged:false},managed:null,gemini:null};
  try{const hits=await require(root+'/dist/capability/web-discovery-client').createManagedWebDiscoveryConnector({gatewayUrl:brand.webDiscoveryGatewayUrl,installToken:token}).search('AI 产品课程');result.managed={status:'AVAILABLE',count:hits.length};}
  catch(e){result.managed={status:e.status,httpStatus:e.httpStatus,kind:e.kind,message:redact(e.message)}}
  if(cfg.geminiSearchApiKey){
   let raw;
   const fetchImpl=async(...args)=>{const r=await fetch(...args);if(!r.ok){const body=await r.clone().json().catch(()=>({}));const e=body.error||{};raw={httpStatus:r.status,providerStatus:e.status,message:redact(e.message),quotaViolations:(e.details||[]).flatMap(d=>(d.violations||[]).map(v=>({quotaMetric:v.quotaMetric,quotaId:v.quotaId,model:v.quotaDimensions?.model,quotaValue:v.quotaValue}))),retryDelay:(e.details||[]).find(d=>d.retryDelay)?.retryDelay};}return r;};
   try{const hits=await require(root+'/dist/capability/adapters/gemini-search').createGeminiSearchConnector({apiKey:cfg.geminiSearchApiKey,model,maxRetries:0,fetchImpl}).search('AI 产品课程');result.gemini={status:'AVAILABLE',count:hits.length};}
   catch(e){result.gemini={kind:e.kind,status:e.status,...raw,message:redact(raw?.message||e.message)}}
  }
  return result;
 },{root,ud});
 const dir=path.join(root,'review/core-link-02');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'provider-diagnosis.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await h.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
