#!/usr/bin/env bash
# Run if approved deployment fails health or the single-candidate judgment acceptance.
set -euo pipefail
app=/opt/digitalme-v2
stage=/opt/digitalme-review-gateway-20261006
backup="$stage/backup"
test -s "$backup/relay.env"
install -m 644 "$backup/dist/relay-service/server.js" "$app/dist/relay-service/server.js"
install -m 644 "$backup/dist/relay-service/ai-inference-gateway.js" "$app/dist/relay-service/ai-inference-gateway.js"
install -m 644 "$backup/dist/infrastructure/model-http.js" "$app/dist/infrastructure/model-http.js"
install -m 600 "$backup/relay.env" /etc/digitalme-relay.env
(cd "$app" && sha256sum --check "$stage/deployed-before.sha256")
systemctl restart digitalme-relay.service
systemctl is-active --quiet digitalme-relay.service
curl --fail --silent http://127.0.0.1:8787/health
