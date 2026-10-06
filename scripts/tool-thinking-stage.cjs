'use strict';
// Prepare diagnostic-only modules for /tmp; does not build or package a client.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
require('../dist/intelligence/loop');require('../dist/infrastructure/model-http');require('../dist/intelligence/store');require('../dist/intelligence/self-context');
const root=path.resolve('build/evidence/tool-thinking-inprocess-20261006'),files={};
for(const p of Object.keys(require.cache).filter(p=>p.startsWith(path.resolve('dist')+path.sep)))files[path.relative(process.cwd(),p).split(path.sep).join('/')]=fs.readFileSync(p,'utf8');
files['scripts/tool-thinking-inprocess.cjs']=fs.readFileSync('scripts/tool-thinking-inprocess.cjs','utf8');files['input.json']=fs.readFileSync(path.join(root,'input.json'),'utf8');
const encoded=zlib.deflateSync(Buffer.from(JSON.stringify(files))).toString('base64');
const stage='/tmp/dm-tool-thinking-inprocess-20261006-b7';
const commands=[`python3 -c 'import pathlib; p=pathlib.Path("${stage}"); assert not p.exists(); p.mkdir(mode=0o700); print("DIAG_STAGE_CREATED")'`];
for(let i=0;i<encoded.length;i+=18000)commands.push("printf '%s' '"+encoded.slice(i,i+18000)+"' >> "+stage+'/payload.b64');
const py=`import pathlib,json,base64,zlib,hashlib
p=pathlib.Path('${stage}')
b=p.joinpath('payload.b64').read_text()
assert hashlib.sha256(b.encode()).hexdigest()=='${crypto.createHash('sha256').update(encoded).digest('hex')}'
files=json.loads(zlib.decompress(base64.b64decode(b)))
for name,content in files.items():
 t=p.joinpath(name); assert t.resolve().is_relative_to(p); t.parent.mkdir(parents=True,exist_ok=True); t.write_bytes(content.encode())
for mode in ['fixture','live']:
 d=p.joinpath(mode); d.mkdir(); d.joinpath('input.json').write_bytes(p.joinpath('input.json').read_bytes())
print('DIAG_MODULES_VERIFIED',len(files))`;
commands.push("python3 -c 'import base64;exec(base64.b64decode(\""+Buffer.from(py).toString('base64')+"\"))'");
commands.push(`cd ${stage} && NODE_PATH=/opt/digitalme-v2/node_modules DM_DIAG_ROOT=${stage}/fixture node scripts/tool-thinking-inprocess.cjs fixture`);
fs.writeFileSync(path.join(root,'stage-commands.json'),JSON.stringify(commands));
fs.writeFileSync(path.join(root,'module-manifest.json'),JSON.stringify(Object.fromEntries(Object.entries(files).map(([n,s])=>[n,crypto.createHash('sha256').update(s).digest('hex')])),null,2));
console.log(JSON.stringify({modules:Object.keys(files).length,transferCharacters:encoded.length,commands:commands.length}));
