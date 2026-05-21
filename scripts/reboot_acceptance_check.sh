#!/usr/bin/env bash
set -euo pipefail

API="${ORCHESTRATOR_URL:-http://localhost:8080}"
CONSOLE="${CONSOLE_BASE_URL:-${PUBLIC_CONSOLE_URL:-http://localhost:3000}}"
DATABASE="${DATABASE_URL:-postgres://agentos:agentos_password@localhost:5432/agentos?sslmode=disable}"
ADMIN_HEADER=()
if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  ADMIN_HEADER=(-H "X-Admin-Token: ${ADMIN_TOKEN}")
fi

failures=0
check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS $name"
  else
    echo "FAIL $name"
    failures=$((failures+1))
  fi
}

json_get() {
  python3 -c "import json,sys; data=json.load(sys.stdin); print($1)"
}

check orchestrator curl -fsS "$API/ready"
check console curl -fsS "$CONSOLE"
check postgres psql "$DATABASE" -tAc "select 1"

if [[ "${TASK_QUEUE_DRIVER:-postgres}" == "nats" || -n "${NATS_URL:-}" ]]; then
  check nats curl -fsS "${NATS_MONITOR_URL:-http://localhost:8222/varz}"
else
  echo "PASS nats_skipped_postgres_queue"
fi

if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  check telegram curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
else
  echo "FAIL telegram"
  failures=$((failures+1))
fi

NODES="$(curl -fsS "${ADMIN_HEADER[@]}" "$API/api/nodes" || true)"
printf '%s' "$NODES" | grep -q '"id":"main-node"' && echo "PASS main-node" || { echo "FAIL main-node"; failures=$((failures+1)); }
printf '%s' "$NODES" | grep -q '"id":"local-worker-1"' && echo "PASS local-worker-1" || { echo "FAIL local-worker-1"; failures=$((failures+1)); }
printf '%s' "$NODES" | grep -q '"id":"vps-la-1"' && echo "PASS vps-la-1" || { echo "FAIL vps-la-1"; failures=$((failures+1)); }

RUN_ID="$(curl -fsS -X POST "$API/api/chat/send" \
  -H 'Content-Type: application/json' \
  -d '{"channel":"reboot_acceptance","message":"Joi 自检","options":{"allow_tools":true,"preferred_node":"main-node","allow_worker":false}}' \
  | json_get 'data["data"]["run_id"]')"
curl -fsS "${ADMIN_HEADER[@]}" "$API/api/runs/$RUN_ID/steps" | grep -q 'system_health_check_v1' && echo "PASS system_health_check_v1" || { echo "FAIL system_health_check_v1"; failures=$((failures+1)); }

if [[ "$failures" != "0" ]]; then
  echo "reboot acceptance failed: $failures failure(s)" >&2
  exit 1
fi

echo "reboot acceptance passed: $RUN_ID"
