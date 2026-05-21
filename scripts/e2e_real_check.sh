#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="${ORCHESTRATOR_URL:-http://localhost:8080}"
CONSOLE="${CONSOLE_BASE_URL:-http://localhost:3000}"
ALLOW_MOCK_PROVIDER="${ALLOW_MOCK_PROVIDER:-false}"
REQUIRE_REAL_MODEL="${REQUIRE_REAL_MODEL:-true}"
REQUIRE_REAL_TELEGRAM="${REQUIRE_REAL_TELEGRAM:-true}"
ADMIN_HEADER=()
if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  ADMIN_HEADER=(-H "X-Admin-Token: ${ADMIN_TOKEN}")
fi

pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s: %s\n' "$1" "$2" >&2; exit 1; }
json_get() { python3 -c "import json,sys; data=json.load(sys.stdin); print($1)"; }

curl -fsS "$API/ready" >/dev/null || fail orchestrator "not ready"
pass orchestrator

curl -fsS "$CONSOLE" >/dev/null || fail console "not reachable"
pass console

psql "${DATABASE_URL:-postgres://agentos:agentos_password@localhost:5432/agentos?sslmode=disable}" -tAc "select 1" >/dev/null || fail postgres "query failed"
pass postgres

if [[ "${TASK_QUEUE_DRIVER:-postgres}" == "nats" || -n "${NATS_URL:-}" ]]; then
  curl -fsS "${NATS_MONITOR_URL:-http://localhost:8222/varz}" >/dev/null || fail nats "monitor not reachable"
  pass nats
else
  pass nats_skipped_postgres_queue
fi

HEALTH="$(curl -fsS "${ADMIN_HEADER[@]}" "$API/api/model-provider/health")"
PROVIDER="$(printf '%s' "$HEALTH" | json_get 'data["data"]["provider"]')"
AVAILABLE="$(printf '%s' "$HEALTH" | json_get 'data["data"]["available"]')"
if [[ "$REQUIRE_REAL_MODEL" == "true" ]]; then
  [[ "$PROVIDER" != "mock_provider" && "$AVAILABLE" == "True" ]] || fail model_provider "real provider unavailable"
fi
pass model_provider

if [[ "$REQUIRE_REAL_TELEGRAM" == "true" ]]; then
  [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]] || fail telegram "TELEGRAM_BOT_TOKEN missing"
  curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" >/dev/null || fail telegram "getMe failed"
fi
pass telegram

NODES="$(curl -fsS "${ADMIN_HEADER[@]}" "$API/api/nodes")"
printf '%s' "$NODES" | grep -q 'main-node' || fail main_node "missing"
printf '%s' "$NODES" | grep -q 'local-worker-1' || fail local_worker "missing"
pass nodes

WEB_RUN="$(curl -fsS -X POST "$API/api/chat/send" -H 'Content-Type: application/json' -d '{"channel":"e2e","message":"@research 请读取 https://example.com 并总结来源","options":{"preferred_node":"main-node","allow_worker":false,"allow_tools":true}}' | json_get 'data["data"]["run_id"]')"
curl -fsS "${ADMIN_HEADER[@]}" "$API/api/runs/$WEB_RUN/steps" | grep -q 'web_research_v1' || fail web_research "trace missing web_research_v1"
pass web_research

DIAG_RUN="$(curl -fsS -X POST "$API/api/chat/send" -H 'Content-Type: application/json' -d '{"channel":"e2e","message":"@devops 帮我检查 cloudflared 服务是否正常","options":{"preferred_node":"main-node","allow_worker":false,"allow_tools":true}}' | json_get 'data["data"]["run_id"]')"
curl -fsS "${ADMIN_HEADER[@]}" "$API/api/runs/$DIAG_RUN/steps" | grep -q 'server_diagnose_v1' || fail server_diagnose "trace missing server_diagnose_v1"
pass server_diagnose

if [[ "$ALLOW_MOCK_PROVIDER" == "false" ]]; then
  RUN_PAYLOAD="$(curl -fsS "${ADMIN_HEADER[@]}" "$API/api/runs/$WEB_RUN")"
  RUN_PAYLOAD="$RUN_PAYLOAD" python3 - <<'PY' || fail no_mock "mock provider or fallback model call detected"
import json, sys
import os
payload = json.loads(os.environ["RUN_PAYLOAD"])["data"]
for call in payload.get("model_calls") or []:
    meta = call.get("metadata") or {}
    if call.get("provider") == "mock_provider" or meta.get("fallback_to_mock") is True or meta.get("real_model") is not True:
        raise SystemExit(1)
PY
fi
pass run_trace

printf 'real world e2e passed\n'
