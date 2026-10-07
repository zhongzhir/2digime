'use strict';
const fs=require('node:fs'),cp=require('node:child_process');
const out='build/evidence/goal-scope-live-20261007';
function api(action,args){const r=cp.spawnSync('C:/AliyunCLI/aliyun.exe',['ecs',action,'--profile','2digime-clean-validation','--RegionId','cn-beijing',...args],{encoding:'utf8',timeout:30000,maxBuffer:4e6,windowsHide:true});if(r.status!==0)throw Error('Aliyun API failed '+action+' '+(r.stderr.match(/ERROR:\s*([A-Za-z.]+)/)||[])[1]);return JSON.parse(r.stdout);}
const old=JSON.parse(fs.readFileSync('review/core-link-02/final-review/gateway-window.json'));const prior=JSON.parse(fs.readFileSync('build/evidence/goal-persistence-20261007/transport.json')).requests;const now=JSON.parse(fs.readFileSync(out+'/transport.json')).requests;const ids=[...new Set([...old,...prior,...now].map(x=>x.requestId))];
const cmd=`python3 - <<'PY'
import subprocess,json,zlib,base64
ids=set(${JSON.stringify(ids)})
fields=['ts','event','requestId','stage','attempt','timeoutMs','maxTokens','model','thinking','status','gatewayHttpStatus','providerHttpStatus','providerResponseId','returnedModel','reasoningLength','reasoningTokens','finishReason','outputLength','usageSource','inputTokens','outputTokens','totalTokens','latencyMs','cancelSent','supplierStopConfirmed','cancellation']
raw=subprocess.check_output(['journalctl','-u','digitalme-relay.service','--since','2026-10-06 00:00:00 UTC','--no-pager','-o','cat'],text=True)
rows=[]
for line in raw.splitlines():
 try: d=json.loads(line[line.index('{'):])
 except (ValueError,json.JSONDecodeError): continue
 if d.get('requestId') in ids: rows.append({k:d[k] for k in fields if k in d})
print('GATEWAY_SAFE_JSON_ZLIB='+base64.b64encode(zlib.compress(json.dumps({'requestedIds':sorted(ids),'rows':rows}).encode())).decode())
PY
`;
fs.writeFileSync(out+'/gateway-readonly-command.sh',cmd);
const r=api('RunCommand',['--Type','RunShellScript','--InstanceId.1','i-2zedlw82hph3c2lxd3w7','--ContentEncoding','Base64','--CommandContent',Buffer.from(cmd).toString('base64'),'--KeepCommand','false','--Timeout','20']);fs.writeFileSync(out+'/gateway-invocation.json',JSON.stringify({invokeId:r.InvokeId,commandId:r.CommandId,requestId:r.RequestId,instanceId:'i-2zedlw82hph3c2lxd3w7',profile:'2digime-clean-validation',commandReadOnly:true},null,2));console.log(JSON.stringify({invokeId:r.InvokeId,commandReadOnly:true}));
