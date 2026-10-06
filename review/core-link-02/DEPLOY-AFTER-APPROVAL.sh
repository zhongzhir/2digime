#!/usr/bin/env bash
# REVIEW ONLY. Do not run until Owner authorizes deployment AND structured thinking setting.
set -Eeuo pipefail
app=/opt/digitalme-v2
stage=/opt/digitalme-review-gateway-20261006
operation=deploy
source "$stage/GATEWAY-OPERATIONS.sh"
backup="$stage/backup-$(date -u +%Y%m%dT%H%M%S)-$$"
mutation_started=0
rollback_on_exit() {
  local rc=$?
  trap - EXIT ERR INT TERM
  if (( rc != 0 && mutation_started == 1 )); then
    printf '%s\n' 'Deployment failed; restoring backup.' >&2
    if GATEWAY_OPERATION_LOG="$operation_log" bash "$stage/ROLLBACK-AFTER-APPROVAL.sh" "$backup"; then
      printf '%s\n' 'Rollback completed.' >&2
    else
      printf '%s\n' 'ROLLBACK FAILED: manual recovery required; backup retained.' >&2
    fi
  fi
  log_phase script.end "$rc"
  exit "$rc"
}
trap rollback_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cd "$app"
run_phase baseline sha256sum --check "$stage/deployed-before.sha256"
run_phase candidate bash -c 'cd "$1" && sha256sum --check candidate.sha256 && sha256sum --check operations-files.sha256' _ "$stage"
test ! -e "$backup"
install -d -m 700 "$backup"
cp -a --parents dist/relay-service/server.js dist/relay-service/ai-inference-gateway.js dist/infrastructure/model-http.js "$backup/"
cp -a /etc/digitalme-relay.env "$backup/relay.env"
printf 'BACKUP=%s\n' "$backup"
log_phase backup.complete
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
log_phase copy_and_environment.complete
run_phase restart systemctl restart digitalme-relay.service
run_phase readiness check_ready
