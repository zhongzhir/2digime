# Shared deployment / rollback phase recording and bounded readiness.
operation_start=$(date +%s%3N)
operation_log=${GATEWAY_OPERATION_LOG:-"$stage/operations-$(date -u +%Y%m%dT%H%M%S)-$$.jsonl"}
log_phase() {
  local now; now=$(date +%s%3N)
  printf '{"operation":"%s","phase":"%s","epochMs":%s,"elapsedMs":%s,"rc":%s}\n' "$operation" "$1" "$now" "$((now-operation_start))" "${2:-0}" | tee -a "$operation_log"
}
run_phase() {
  local name=$1 rc=0; shift
  log_phase "$name.begin"
  "$@" || rc=$?
  log_phase "$name.end" "$rc"
  return "$rc"
}
check_ready() {
  python3 "$stage/gateway-ready.py" | tee -a "$operation_log"
}
log_phase script.begin
