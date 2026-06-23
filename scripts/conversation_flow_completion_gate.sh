#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
EVIDENCE_DIR_INPUT="${JOI_CONVERSATION_FLOW_EVIDENCE_DIR:-"$ROOT_DIR/.e2e/joi-conversation-flow-gate-$STAMP"}"
mkdir -p "$EVIDENCE_DIR_INPUT"
EVIDENCE_DIR="$(cd "$EVIDENCE_DIR_INPUT" && pwd)"
SUMMARY="$EVIDENCE_DIR/summary.txt"
EXTERNAL_STATUS="$EVIDENCE_DIR/external-status.txt"
MANUAL_E2E_EVIDENCE="$EVIDENCE_DIR/desktop-smoke/manual-e2e-evidence.json"
REQUIRE_EXTERNAL="${JOI_REQUIRE_EXTERNAL:-0}"
REQUIRE_LIVE_EXTERNAL="${JOI_REQUIRE_LIVE_EXTERNAL:-0}"
LIVE_HANDOFF_TOKEN="${JOI_LIVE_HANDOFF_TOKEN:-}"

: >"$SUMMARY"

cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/configs/secrets.local.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/configs/secrets.local.env"
  set +a
fi

record() {
  printf '%s\n' "$*" | tee -a "$SUMMARY"
}

run_step() {
  local name="$1"
  shift
  local log="$EVIDENCE_DIR/${name}.log"
  record "START $name"
  if "$@" > >(tee "$log") 2>&1; then
    record "PASS  $name log=$log"
  else
    local status=$?
    record "FAIL  $name status=$status log=$log"
    exit "$status"
  fi
}

run_step store pnpm test:store
run_step runtime pnpm test:runtime
run_step secrets pnpm test:secrets
run_step electron-contract pnpm test:electron-contract
run_step desktop-evals pnpm eval:desktop:ts
run_step frontend-chat-projection bash -lc "cd '$ROOT_DIR/apps/joi-desktop/frontend' && npm run test:chat-projection"
run_step frontend-execution-actions bash -lc "cd '$ROOT_DIR/apps/joi-desktop/frontend' && npm run test:execution-actions"
run_step frontend-task-mini-list bash -lc "cd '$ROOT_DIR/apps/joi-desktop/frontend' && npm run test:task-mini-list"
run_step frontend-build bash -lc "cd '$ROOT_DIR/apps/joi-desktop/frontend' && npm run build"
run_step electron-build pnpm build:electron
run_step live-handoff-audit-fixture node --experimental-strip-types scripts/test_desktop_live_external_handoff_audit.mjs
run_step desktop-crash-recovery bash scripts/desktop_crash_recovery_check.sh
run_step desktop-real-model bash scripts/desktop_real_model_check.sh
run_step desktop-conversation-flow-smoke env JOI_E2E_EVIDENCE_DIR="$EVIDENCE_DIR/desktop-smoke" bash scripts/desktop_conversation_flow_e2e.sh smoke
run_step diff-check git diff --check

node --experimental-strip-types scripts/desktop_external_status.mjs --text | tee "$EXTERNAL_STATUS"
node --experimental-strip-types scripts/desktop_external_status.mjs >"$EVIDENCE_DIR/external-status.json"
node --experimental-strip-types scripts/desktop_production_schema_migration.mjs >"$EVIDENCE_DIR/prod-schema-migration-check.json" || true
if [[ -n "$LIVE_HANDOFF_TOKEN" ]]; then
  node --experimental-strip-types scripts/desktop_live_external_handoff_audit.mjs --token="$LIVE_HANDOFF_TOKEN" --out="$EVIDENCE_DIR/live-external-handoff-audit.json" >"$EVIDENCE_DIR/live-external-handoff-audit.log" || true
else
  node --experimental-strip-types scripts/desktop_live_external_handoff_audit.mjs --out="$EVIDENCE_DIR/live-external-handoff-audit.json" >"$EVIDENCE_DIR/live-external-handoff-audit.log" || true
fi

if [[ "$REQUIRE_EXTERNAL" == "1" || "$REQUIRE_EXTERNAL" == "true" ]]; then
  run_step external-preflight node --experimental-strip-types scripts/desktop_external_status.mjs --require-external --check-connections
  record "EXTERNAL_PREFLIGHT passed"
else
  record "EXTERNAL_PREFLIGHT skipped require_external=$REQUIRE_EXTERNAL status=$EXTERNAL_STATUS"
fi

if [[ "$REQUIRE_LIVE_EXTERNAL" == "1" || "$REQUIRE_LIVE_EXTERNAL" == "true" ]]; then
  if [[ -n "$LIVE_HANDOFF_TOKEN" ]]; then
    run_step live-external-handoff node --experimental-strip-types scripts/desktop_live_external_handoff_audit.mjs --require-live --token="$LIVE_HANDOFF_TOKEN" --out="$EVIDENCE_DIR/live-external-handoff-audit.json"
  else
    run_step live-external-handoff node --experimental-strip-types scripts/desktop_live_external_handoff_audit.mjs --require-live --out="$EVIDENCE_DIR/live-external-handoff-audit.json"
  fi
  record "LIVE_EXTERNAL_HANDOFF passed"
else
  record "LIVE_EXTERNAL_HANDOFF skipped require_live_external=$REQUIRE_LIVE_EXTERNAL audit=$EVIDENCE_DIR/live-external-handoff-audit.json"
fi

record "CONVERSATION_FLOW_LOCAL_GATE passed evidence=$EVIDENCE_DIR"
node --experimental-strip-types scripts/conversation_flow_manual_e2e_collect.mjs --gate-dir="$EVIDENCE_DIR" --evidence="$MANUAL_E2E_EVIDENCE" --out="$EVIDENCE_DIR/desktop-smoke/manual-e2e-collect.json" >"$EVIDENCE_DIR/desktop-smoke/manual-e2e-collect.log" || true
if [[ -n "$LIVE_HANDOFF_TOKEN" ]]; then
  JOI_MANUAL_E2E_EVIDENCE="$MANUAL_E2E_EVIDENCE" node --experimental-strip-types scripts/conversation_flow_dod_audit.mjs --token="$LIVE_HANDOFF_TOKEN" --out="$EVIDENCE_DIR/dod-audit.json" >"$EVIDENCE_DIR/dod-audit.log" || true
else
  JOI_MANUAL_E2E_EVIDENCE="$MANUAL_E2E_EVIDENCE" node --experimental-strip-types scripts/conversation_flow_dod_audit.mjs --out="$EVIDENCE_DIR/dod-audit.json" >"$EVIDENCE_DIR/dod-audit.log" || true
fi
record "DOD_AUDIT recorded audit=$EVIDENCE_DIR/dod-audit.json"
