"""Offline Linux fixture only: no real service, network, environment or application paths."""
import hashlib,json,os,pathlib,subprocess,tempfile,sys,base64,zlib,shlex

def run(sources):
    results=[]
    for fault in ('copy1','copy2','copy3','environment','restart','health','baseline','none'):
        with tempfile.TemporaryDirectory(prefix='dm-deploy-fixture-') as tmp:
            root=pathlib.Path(tmp);app=root/'app';stage=root/'stage';bin_dir=root/'bin'
            bin_dir.mkdir();stage.mkdir();env=root/'relay.env';env.write_text('ORIGINAL=fixture\n')
            os.chmod(env,0o640);os.chown(env,65534,65534)
            before=env.stat();old={};new={}
            for i,f in enumerate(('dist/relay-service/server.js','dist/relay-service/ai-inference-gateway.js','dist/infrastructure/model-http.js')):
                old[f]=f'old-{i}\n';new[f]=f'new-{i}\n'
                for directory,content in ((app,old[f]),(stage,new[f])):
                    p=directory/f;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(content)
            for name,values in (('deployed-before.sha256',old),('candidate.sha256',new)):
                (stage/name).write_text(''.join(hashlib.sha256(v.encode()).hexdigest()+'  '+k+'\n' for k,v in values.items()))
            for name,source in sources.items():
                source=source.replace('app=/opt/digitalme-v2',f'app={app}').replace('stage=/opt/digitalme-review-gateway-20261006',f'stage={stage}')
                source=source.replace('/etc/digitalme-relay.env',str(env)).replace('/etc/.digitalme-relay.rollback.env',str(root/'rollback.env'))
                source=source.replace("dir='/etc'",f"dir='{root}'")
                (stage/name).write_text(source)
            marker=root/'failed-once';calls=root/'calls'
            wrapper='''#!/usr/bin/env bash
set -eu
name=$(basename "$0")
printf '%s\\n' "$name $*" >> "$FIXTURE_CALLS"
target=none
case "$name" in
install) case "${*: -1}" in dist/relay-service/server.js) target=copy1;; dist/relay-service/ai-inference-gateway.js) target=copy2;; dist/infrastructure/model-http.js) target=copy3;; esac;;
python3) target=environment;;
systemctl) [[ "$1" == restart ]] && target=restart;;
curl) target=health;;
esac
if [[ "$FIXTURE_FAULT" != none && "$target" == "$FIXTURE_FAULT" && ! -e "$FIXTURE_MARKER" ]]; then touch "$FIXTURE_MARKER"; exit 77; fi
case "$name" in systemctl|curl) exit 0;; *) exec "$REAL_BIN/$name" "$@";; esac
'''
            for name in ('install','python3','systemctl','curl'):
                p=bin_dir/name;p.write_text(wrapper);p.chmod(0o755)
            if fault=='baseline':(app/next(iter(old))).write_text('changed-baseline')
            variables=dict(os.environ,PATH=str(bin_dir)+':'+os.environ['PATH'],FIXTURE_CALLS=str(calls),FIXTURE_MARKER=str(marker),FIXTURE_FAULT=fault,REAL_BIN='/usr/bin')
            p=subprocess.run(['bash',str(stage/'DEPLOY-AFTER-APPROVAL.sh')],env=variables,capture_output=True,text=True)
            if fault=='none':
                assert p.returncode==0,p.stderr
                assert 'MANAGED_AI_STRUCTURED_THINKING=disabled' in env.read_text()
                p=subprocess.run(['bash',str(stage/'ROLLBACK-AFTER-APPROVAL.sh')],env=variables,capture_output=True,text=True)
                assert p.returncode==0,p.stderr
            else:assert p.returncode!=0,fault
            if fault!='baseline':assert all((app/f).read_text()==v for f,v in old.items()),fault
            else:assert not (stage/'backup').exists() and not calls.exists(),fault
            after=env.stat()
            assert env.read_text()=='ORIGINAL=fixture\n',fault
            assert (after.st_mode & 0o777,after.st_uid,after.st_gid)==(before.st_mode & 0o777,before.st_uid,before.st_gid),fault
            results.append({'fault':fault,'passed':True,'environmentMode':'0640','ownerPreserved':True})
    return {'fixtureOnly':True,'realServiceCommands':0,'searchCalls':0,'tests':results}

if __name__=='__main__':
    base=pathlib.Path(__file__).resolve().parents[1]/'review/core-link-02'
    sources={n:(base/n).read_text() for n in ('DEPLOY-AFTER-APPROVAL.sh','ROLLBACK-AFTER-APPROVAL.sh')}
    if '--emit-runner' in sys.argv or '--emit-command' in sys.argv:
        code=pathlib.Path(__file__).read_text().split("if __name__==")[0]+'\nprint(json.dumps(run('+repr(sources)+')))\n'
        (base/'evidence/gateway-fixture-runner.py').write_text(code)
        if '--emit-command' in sys.argv:
            payload=base64.b64encode(zlib.compress(code.encode())).decode()
            print('python3 -c '+shlex.quote('import base64,zlib;exec(zlib.decompress(base64.b64decode('+repr(payload)+')))'))
    else:print(json.dumps(run(sources)))
