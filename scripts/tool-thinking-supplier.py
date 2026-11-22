"""Isolated one-shot supplier call; credentials never leave the ECS process."""
import base64,hashlib,json,pathlib,shlex,time,urllib.request,urllib.error,uuid
ROOT=pathlib.Path('/tmp/dm-tool-thinking-20261006')
BASELINE={
 'dist/relay-service/server.js':'bdb8b00462897aa1bd44cc8f9d2ce3b6b360b8233a4edd4c7a22f0628443c080',
 'dist/relay-service/ai-inference-gateway.js':'deaa14bb42f067ab50aa2ac22117bd07a58dbe45e83277fd8d135a52ba16c370',
 'dist/infrastructure/model-http.js':'aa57a97fdaf47ca1db87f2b06784a5bda51826a1aefc5a97c8d04c563f0c77b1'}
def hashes():
 actual={p:hashlib.sha256((pathlib.Path('/opt/digitalme-v2')/p).read_bytes()).hexdigest() for p in BASELINE}
 assert actual==BASELINE,'online product drift; no call'
 return actual
def main(request,variant):
 before=hashes();ROOT.mkdir(mode=0o700,exist_ok=True)
 journal=ROOT/'calls.jsonl';rows=journal.read_text().splitlines() if journal.exists() else []
 assert len(rows)<10,'supplier budget exhausted'
 label=request['id']+'-'+variant
 assert not any(json.loads(r)['label']==label for r in rows),'no repeated attempt'
 env={}
 for line in pathlib.Path('/etc/digitalme-relay.env').read_text().splitlines():
  if line.strip() and not line.lstrip().startswith('#') and '=' in line:
   k,v=line.split('=',1);values=shlex.split(v);env[k]=values[0] if values else ''
 base=env.get('MANAGED_AI_PROVIDER_BASE_URL','https://api.deepseek.com/v1').rstrip('/')
 assert base=='https://api.deepseek.com/v1','unexpected supplier'
 payload=dict(request['payload']);payload['model']=env.get('MANAGED_AI_PROVIDER_MODEL','deepseek-v4-flash')
 assert payload['max_tokens']==2048 and payload['stream'] is False
 same_hash=hashlib.sha256(json.dumps(payload,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 if variant=='B':payload['thinking']={'type':'disabled'}
 else:assert variant=='A'
 row={'label':label,'attempt':len(rows)+1,'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'requestId':str(uuid.uuid4()),'variant':variant,'inputHashExcludingThinking':same_hash,'configuredModel':payload['model'],'maxTokens':2048,'reasoningConfig':payload.get('thinking','provider_default'),'usage':None}
 with journal.open('a') as f:f.write(json.dumps(row)+'\n')
 started=time.monotonic()
 try:
  # Deadline is supplied as a duration to avoid client/server clock skew.
  remaining=min(90,request['remainingMs']/1000)
  assert remaining>0,'deadline exhausted before attempt'
  req=urllib.request.Request(base+'/chat/completions',data=json.dumps(payload,ensure_ascii=False).encode(),headers={'Authorization':'Bearer '+env['MANAGED_AI_PROVIDER_API_KEY'],'Content-Type':'application/json','X-Request-ID':row['requestId']})
  with urllib.request.urlopen(req,timeout=remaining) as response:status=response.status;raw=json.loads(response.read())
  choice=(raw.get('choices') or [{}])[0];message=choice.get('message') or {};text=message.get('content') or '';tools=message.get('tool_calls') or []
  row.update(httpStatus=status,finishReason=choice.get('finish_reason'),text=text,outputLength=len(text),toolCalls=[{'id':t['id'],'name':t['function']['name'],'arguments':t['function']['arguments']} for t in tools],toolCallCount=len(tools),reasoningLength=len(message.get('reasoning_content') or ''),usage=raw.get('usage'),returnedModel=raw.get('model'),responseId=raw.get('id'))
  row['truncated']=row['finishReason']=='length'
 except urllib.error.HTTPError as e:row.update(httpStatus=e.code,error='provider_http_error')
 except Exception as e:row.update(error=type(e).__name__)
 row.update(elapsedMs=round((time.monotonic()-started)*1000),onlineHashesUnchanged=hashes()==before)
 (ROOT/(label+'.json')).write_text(json.dumps(row,ensure_ascii=False))
 print('SAFE_RESULT_'+label+' '+base64.b64encode(json.dumps(row,ensure_ascii=False).encode()).decode(),flush=True)
