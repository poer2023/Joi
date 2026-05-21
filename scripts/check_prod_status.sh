#!/usr/bin/env bash
set -euo pipefail

if [[ -f /tmp/joi-public-url.env ]]; then
  set -a
  # shellcheck source=/dev/null
  source /tmp/joi-public-url.env
  set +a
fi

API="${ORCHESTRATOR_URL:-http://localhost:8080}"
CONSOLE="${CONSOLE_BASE_URL:-http://localhost:3000}"
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

check orchestrator curl -fsS "$API/ready"
check console curl -fsS "$CONSOLE"
check metrics curl -fsS "${ADMIN_HEADER[@]}" "$API/metrics"
check postgres psql "${DATABASE_URL:-postgres://agentos:agentos_password@localhost:5432/agentos?sslmode=disable}" -tAc "select 1"
check nodes bash -c "curl -fsS ${ADMIN_TOKEN:+-H \"X-Admin-Token: $ADMIN_TOKEN\"} '$API/api/system-health' | grep -q 'main-node' && curl -fsS ${ADMIN_TOKEN:+-H \"X-Admin-Token: $ADMIN_TOKEN\"} '$API/api/system-health' | grep -q 'local-worker-1'"
check self_check bash -c "curl -fsS -X POST '$API/api/chat/send' -H 'Content-Type: application/json' -d '{\"channel\":\"prod_check\",\"message\":\"Joi 自检\",\"options\":{\"allow_tools\":true}}' | grep -q 'run_id'"

if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  check telegram curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
else
  echo "SKIP telegram TELEGRAM_BOT_TOKEN missing"
fi

if [[ "$failures" != "0" ]]; then
  exit 1
fi
