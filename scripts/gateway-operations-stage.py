"""Produce an operations-only update command; approved product bytes stay fixed."""
import pathlib,hashlib,json,zlib,base64,shlex
base=pathlib.Path(__file__).resolve().parents[1]/'review/core-link-02'
names=['DEPLOY-AFTER-APPROVAL.sh','ROLLBACK-AFTER-APPROVAL.sh','GATEWAY-OPERATIONS.sh','gateway-ready.py']
files={n:(base/n).read_bytes() for n in names}
manifest=''.join(hashlib.sha256(b).hexdigest()+'  '+n+'\n' for n,b in files.items())
files['operations-files.sha256']=manifest.encode()
payload={n:b.decode() for n,b in files.items()}
code='''import pathlib,base64,hashlib,subprocess
p=pathlib.Path('/opt/digitalme-review-gateway-20261006')
subprocess.run(['sha256sum','--check','candidate.sha256'],cwd=p,check=True)
subprocess.run(['sha256sum','--check',str(p/'deployed-before.sha256')],cwd='/opt/digitalme-v2',check=True)
expected={'DEPLOY-AFTER-APPROVAL.sh':'e6ad6355f9351972fc2140c15a30931b561ee59dc124a28a2706a4edd4c7a22f0628443c080'}
'''
# Exact old operation hashes obtained from the unchanged local staged manifest.
old={}
for line in (base/'staged-gateway/staged-files.sha256').read_text().splitlines():
    digest,name=line.split(None,1);name=name.strip().lstrip('*')
    if name in names:old[name]=digest
code=code[:code.index('expected=')]+'expected='+repr(old)+'\n'
code+='for n,h in expected.items():\n assert hashlib.sha256((p/n).read_bytes()).hexdigest()==h, n\n'
code+='files='+repr(payload)+'\n'
code+='for n,b in files.items():\n target=p/n\n if target.exists():\n  previous=p/(n+".v1")\n  assert not previous.exists(), n\n  previous.write_bytes(target.read_bytes())\n target.write_text(b)\n'
code+="subprocess.run(['sha256sum','--check','operations-files.sha256'],cwd=p,check=True)\nprint('OPERATIONS_STAGED_PRODUCT_UNCHANGED')\n"
compressed=base64.b64encode(zlib.compress(code.encode())).decode()
command='python3 -c '+shlex.quote('import base64,zlib;exec(zlib.decompress(base64.b64decode('+repr(compressed)+')))')
(base/'evidence/operations-stage-command.txt').write_text(command)
(base/'evidence/operations-files.sha256').write_text(manifest)
print(command)
