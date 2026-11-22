#!/usr/bin/env bash
# Run if approved deployment fails health or the single-candidate judgment acceptance.
set -euo pipefail
app=/opt/digitalme-v2
stage=/opt/digitalme-review-tool-thinking-20261006
operation=rollback
source "$stage/GATEWAY-OPERATIONS.sh"
backup=${1:-"$stage/backup"}
case "$backup" in "$stage"/backup|"$stage"/backup-*) ;; *) exit 64;; esac
trap 'rc=$?; log_phase script.end "$rc"' EXIT
test -s "$backup/relay.env"
install -m 644 "$backup/dist/relay-service/server.js" "$app/dist/relay-service/server.js"
install -m 644 "$backup/dist/relay-service/ai-inference-gateway.js" "$app/dist/relay-service/ai-inference-gateway.js"
cp -a "$backup/relay.env" /etc/.digitalme-relay.rollback.env
mv -f /etc/.digitalme-relay.rollback.env /etc/digitalme-relay.env
(cd "$app" && sha256sum --check "$stage/deployed-before.sha256")
log_phase restore.complete
run_phase restart systemctl restart digitalme-relay.service
run_phase readiness check_ready
