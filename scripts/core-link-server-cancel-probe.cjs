
'use strict';const http=require('http'),fs=require('fs');
async function probe(){
 const {createRelayServer}=require('../dist/relay-service/server');let entered,release,signal;
 const reached=new Promise(r=>entered=r);const gate=new Promise(r=>release=r);
 const s=createRelayServer({store:{},port:0,aiInference:{ready:true,infer:async input=>{signal=input.signal;entered();await gate;return{statusCode:200,body:{ok:true}}}}});const a=await s.start();
 const req=http.request({host:a.host,port:a.port,path:'/v1/ai/inference',method:'POST',headers:{'Content-Type':'application/json'}},()=>{});req.on('error',()=>{});req.end(JSON.stringify({messages:[{role:'user',content:'neutral fixture'}]}));await reached;req.destroy();await new Promise(r=>setTimeout(r,100));const out={requestBodyComplete:true,clientDisconnected:true,providerSignalAborted:signal.aborted};release();await new Promise(r=>setTimeout(r,25));s.server.closeAllConnections();await new Promise(r=>s.server.close(r));return out;
}
(async()=>{const p='dist/relay-service/server.js',original=fs.readFileSync(p);const current=await probe();let proposed;try{let s=original.toString().replace("req.once('aborted', abortIfClientGone);","req.once('aborted', abortIfClientGone);res.once('close', abortIfClientGone);").replace("req.off('aborted', abortIfClientGone);","req.off('aborted', abortIfClientGone);res.off('close', abortIfClientGone);");fs.writeFileSync(p,s);delete require.cache[require.resolve('../dist/relay-service/server')];proposed=await probe()}finally{fs.writeFileSync(p,original)}
 if(current.providerSignalAborted||!proposed.providerSignalAborted)throw Error('unexpected probe outcome');const out={kind:'local HTTP fixture, real socket disconnect; proposed compiled-only change restored',current,proposed,restored:true};fs.writeFileSync('review/core-link-02/evidence/server-disconnect-probe.json',JSON.stringify(out,null,2));console.log(out);
})().catch(e=>{console.error(e);process.exitCode=1});
