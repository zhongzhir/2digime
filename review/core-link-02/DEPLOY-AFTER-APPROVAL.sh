#!/usr/bin/env bash
# REVIEW ONLY. Do not run until Owner authorizes deployment AND structured thinking setting.
set -Eeuo pipefail
app=/opt/digitalme-v2
stage=/opt/digitalme-review-gateway-20261006
backup="$stage/backup"
mutation_started=0
rollback_on_exit() {
  local rc=$?
  trap - EXIT ERR INT TERM
  if (( rc != 0 && mutation_started == 1 )); then
    printf '%s\n' 'Deployment failed; restoring backup.' >&2
    if bash "$stage/ROLLBACK-AFTER-APPROVAL.sh"; then
      printf '%s\n' 'Rollback completed.' >&2
    else
      printf '%s\n' 'ROLLBACK FAILED: manual recovery required; backup retained.' >&2
    fi
  fi
  exit "$rc"
}
trap rollback_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cd "$app"
sha256sum --check "$stage/deployed-before.sha256"
(cd "$stage" && sha256sum --check candidate.sha256)
test ! -e "$backup"
install -d -m 700 "$backup"
cp -a --parents dist/relay-service/server.js dist/relay-service/ai-inference-gateway.js dist/infrastructure/model-http.js "$backup/"
cp -a /etc/digitalme-relay.env "$backup/relay.env"
mutation_started=1
install -m 644 "$stage/dist/relay-service/server.js" dist/relay-service/server.js
install -m 644 "$stage/dist/relay-service/ai-inference-gateway.js" dist/relay-service/ai-inference-gateway.js
install -m 644 "$stage/dist/infrastructure/model-http.js" dist/infrastructure/model-http.js
python3 - <<'PY'
import os,pathlib,tempfile,stat
p=pathlib.Path('/etc/digitalme-relay.env')
original=p.stat()
lines=p.read_text().splitlines()
key='MANAGED_AI_STRUCTURED_THINKING='
lines=[s for s in lines if not s.startswith(key)]
lines.append(key+'disabled')
fd,name=tempfile.mkstemp(dir='/etc',prefix='.digitalme-relay-review-')
with os.fdopen(fd,'w') as f:
    f.write(chr(10).join(lines)+chr(10))
os.chown(name,original.st_uid,original.st_gid)
os.chmod(name,stat.S_IMODE(original.st_mode))
os.replace(name,p)
PY
systemctl restart digitalme-relay.service
systemctl is-active --quiet digitalme-relay.service
curl --fail --silent http://127.0.0.1:8787/health
