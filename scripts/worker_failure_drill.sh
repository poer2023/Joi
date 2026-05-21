#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-check_only}"
API="${ORCHESTRATOR_URL:-http://localhost:8080}"
NODE_ID="${NODE_ID:-vps-la-1}"
ADMIN_HEADER=()
if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  ADMIN_HEADER=(-H "X-Admin-Token: ${ADMIN_TOKEN}")
fi

usage() {
  cat <<USAGE
Usage:
  $0 check_only
  DRILL_CONFIRM=YES $0 kill_worker
  DRILL_CONFIRM=YES $0 restart_vps

This script avoids destructive actions unless DRILL_CONFIRM=YES is set.
USAGE
}

node_status() {
  curl -fsS "${ADMIN_HEADER[@]}" "$API/api/nodes" | python3 - "$NODE_ID" <<'PY'
import json, sys
payload = json.load(sys.stdin).get("data", {})
target = sys.argv[1]
for node in payload.get("nodes", []):
    if node.get("id") == target:
        print(json.dumps(node, ensure_ascii=False))
        break
else:
    raise SystemExit(1)
PY
}

case "$MODE" in
  check_only)
    node_status
    ;;
  kill_worker)
    [[ "${DRILL_CONFIRM:-}" == "YES" ]] || { usage; exit 2; }
    ssh "${VPS_SSH_TARGET:-racknerd-e0ccce3}" "pkill -f '/opt/joi-worker/worker' || true"
    sleep 10
    node_status
    ;;
  restart_vps)
    [[ "${DRILL_CONFIRM:-}" == "YES" ]] || { usage; exit 2; }
    ssh "${VPS_SSH_TARGET:-racknerd-e0ccce3}" "sudo reboot"
    ;;
  *)
    usage
    exit 2
    ;;
esac
