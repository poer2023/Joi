#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-manual}"
STAMP="$(date +%Y%m%d-%H%M%S)"
EVIDENCE_DIR_INPUT="${JOI_E2E_EVIDENCE_DIR:-"$ROOT_DIR/.e2e/joi-desktop-$STAMP"}"
mkdir -p "$EVIDENCE_DIR_INPUT"
EVIDENCE_DIR="$(cd "$EVIDENCE_DIR_INPUT" && pwd)"
USER_DATA_DIR="$EVIDENCE_DIR/user-data"
LOG_DIR="$EVIDENCE_DIR/logs"
BACKUP_DIR="$EVIDENCE_DIR/backups"
DB_PATH="$USER_DATA_DIR/joi.db"
APP_LOG="$EVIDENCE_DIR/electron-dev.log"
CHECKLIST="$EVIDENCE_DIR/manual-checklist.md"
MANUAL_EVIDENCE="$EVIDENCE_DIR/manual-e2e-evidence.json"
MANUAL_AUDIT="$EVIDENCE_DIR/manual-e2e-audit.json"
ENV_FILE="$EVIDENCE_DIR/env.txt"
HANDOFF_EVIDENCE="$EVIDENCE_DIR/handoff-fixture.json"
SMOKE_AUDIT="$EVIDENCE_DIR/closure-smoke-audit.json"
SKIP_ONBOARDING="${JOI_E2E_SKIP_ONBOARDING:-1}"
SEED_HANDOFF="${JOI_E2E_SEED_HANDOFF:-1}"
APP_PID=""

usage() {
  cat <<'USAGE'
Usage: bash scripts/desktop_conversation_flow_e2e.sh [manual|smoke|checklist]

manual    Launch current Electron app with isolated data and keep it open.
smoke     Launch isolated app, wait for SQLite initialization, then stop it.
checklist Create the evidence checklist without launching Electron.
USAGE
}

if [[ "$MODE" == "-h" || "$MODE" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$MODE" != "manual" && "$MODE" != "smoke" && "$MODE" != "checklist" ]]; then
  usage >&2
  exit 2
fi

mkdir -p "$USER_DATA_DIR" "$LOG_DIR" "$BACKUP_DIR"

cat >"$CHECKLIST" <<EOF
# Joi desktop conversation-flow E2E checklist

Evidence directory: $EVIDENCE_DIR
SQLite path: $DB_PATH
Electron log: $APP_LOG
Manual evidence JSON: $MANUAL_EVIDENCE

This harness is intentionally isolated from production user data. It sets
JOI_DESKTOP_E2E=1, disables secret loading, disables inbound Telegram/iMessage
services, disables the worker gateway, and uses deterministic desktop chat so
UI lifecycle checks can run without external side effects.

Required local checks:

1. Open Settings > Advanced > Diagnostics and confirm the SQLite path is the
   path above.
2. Confirm the seeded Telegram-to-Desktop handoff is visible in the recent-run
   closure report. Evidence JSON: $HANDOFF_EVIDENCE
   Smoke audit JSON: $SMOKE_AUDIT
3. Ask a pure chat question. Confirm the message appears, no Product Task is
   created, and the run reaches a terminal state.
4. Ask a serious repo task. Confirm Task Card, tool/activity status,
   artifact/evidence summary, and terminal state.
5. Trigger approval-denied or approval-cancelled fixture coverage via
   pnpm --filter @joi/store test and inspect the recent-run closure report.
6. Trigger redirect/cancel fixture coverage via pnpm eval:desktop:ts and
   inspect inline banners in the conversation replay.
7. Correct a memory candidate in Settings/Memory and verify stale memory is not
   recalled in the next deterministic turn.
8. Create or inspect a reminder/proactive fixture and verify delivery state is
   terminal or explicitly suppressed/expired.
9. Export diagnostics and keep the generated zip path with this evidence.
10. Update $MANUAL_EVIDENCE with the observed actor/time/notes or artifact
   paths, then run:
   node --experimental-strip-types scripts/conversation_flow_manual_e2e_audit.mjs --evidence="$MANUAL_EVIDENCE"

External checks that require live credentials/channels:

1. Run a live provider stream with JOI_DETERMINISTIC_CHAT unset.
2. Start or continue one task from Telegram or iMessage and verify Desktop
   shows the same conversation/task.
EOF

node --experimental-strip-types "$ROOT_DIR/scripts/conversation_flow_manual_e2e_audit.mjs" --init --evidence="$MANUAL_EVIDENCE" --out="$MANUAL_AUDIT" >/dev/null

cat >"$ENV_FILE" <<EOF
JOI_DESKTOP_E2E=1
JOI_USER_DATA_DIR=$USER_DATA_DIR
JOI_SQLITE_PATH=$DB_PATH
JOI_LOG_DIR=$LOG_DIR
JOI_BACKUP_DIR=$BACKUP_DIR
JOI_KEYCHAIN_SERVICE=Joi Desktop E2E $STAMP
JOI_DISABLE_SECRET_LOAD=1
JOI_DISABLE_INBOUND_SERVICES=1
JOI_DISABLE_SINGLE_INSTANCE_LOCK=1
JOI_DISABLE_WORKER_GATEWAY=1
JOI_DETERMINISTIC_CHAT=1
JOI_E2E_SKIP_ONBOARDING=$SKIP_ONBOARDING
JOI_E2E_SEED_HANDOFF=$SEED_HANDOFF
WORKER_GATEWAY_ENABLED=false
EOF

echo "Evidence directory: $EVIDENCE_DIR"
echo "Checklist: $CHECKLIST"

if [[ "$MODE" == "checklist" ]]; then
  exit 0
fi

export JOI_DESKTOP_E2E=1
export JOI_USER_DATA_DIR="$USER_DATA_DIR"
export JOI_SQLITE_PATH="$DB_PATH"
export JOI_LOG_DIR="$LOG_DIR"
export JOI_BACKUP_DIR="$BACKUP_DIR"
export JOI_KEYCHAIN_SERVICE="Joi Desktop E2E $STAMP"
export JOI_DISABLE_SECRET_LOAD=1
export JOI_DISABLE_INBOUND_SERVICES=1
export JOI_DISABLE_SINGLE_INSTANCE_LOCK=1
export JOI_DISABLE_WORKER_GATEWAY=1
export JOI_DETERMINISTIC_CHAT=1
export JOI_E2E_SKIP_ONBOARDING="$SKIP_ONBOARDING"
export JOI_E2E_SEED_HANDOFF="$SEED_HANDOFF"
export WORKER_GATEWAY_ENABLED=false

launch_app() {
  (
    cd "$ROOT_DIR"
    pnpm dev:electron
  ) >"$APP_LOG" 2>&1 &
  APP_PID=$!
  echo "Electron dev PID: $APP_PID"
  echo "Electron log: $APP_LOG"
}

cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi
}

wait_for_sqlite() {
  for _ in $(seq 1 80); do
    if [[ -s "$DB_PATH" ]]; then
      echo "SQLite initialized: $DB_PATH"
      return 0
    fi
    if ! kill -0 "$APP_PID" >/dev/null 2>&1; then
      echo "Electron exited before SQLite initialized. Last log lines:" >&2
      tail -n 80 "$APP_LOG" >&2 || true
      exit 1
    fi
    sleep 0.5
  done

  echo "Timed out waiting for SQLite initialization. Last log lines:" >&2
  tail -n 80 "$APP_LOG" >&2 || true
  exit 1
}

complete_onboarding_for_e2e() {
  if [[ "$SKIP_ONBOARDING" != "1" && "$SKIP_ONBOARDING" != "true" ]]; then
    return 0
  fi
  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "sqlite3 is not available; onboarding skip was not applied." >&2
    return 0
  fi
  sqlite3 "$DB_PATH" "PRAGMA busy_timeout=5000; INSERT INTO desktop_settings(key,value,updated_at) VALUES('onboarding.completed','true',datetime('now')) ON CONFLICT(key) DO UPDATE SET value='true', updated_at=datetime('now');" >/dev/null
  echo "E2E onboarding skip applied."
}

wait_for_db_writable() {
  if ! command -v sqlite3 >/dev/null 2>&1; then
    sleep 1
    return 0
  fi
  for _ in $(seq 1 40); do
    if sqlite3 "$DB_PATH" "PRAGMA busy_timeout=1000; BEGIN IMMEDIATE; COMMIT;" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  echo "Timed out waiting for SQLite write lock to clear: $DB_PATH" >&2
  tail -n 80 "$APP_LOG" >&2 || true
  exit 1
}

seed_handoff_for_e2e() {
  if [[ "$SEED_HANDOFF" != "1" && "$SEED_HANDOFF" != "true" ]]; then
    return 0
  fi
  node --experimental-strip-types "$ROOT_DIR/scripts/seed_desktop_handoff_fixture.mjs" "$DB_PATH" "$HANDOFF_EVIDENCE" >"$EVIDENCE_DIR/handoff-fixture.stdout.json"
  echo "E2E handoff fixture seeded: $HANDOFF_EVIDENCE"
}

assert_smoke_closure_for_e2e() {
  if [[ "$SEED_HANDOFF" != "1" && "$SEED_HANDOFF" != "true" ]]; then
    return 0
  fi
  node --experimental-strip-types "$ROOT_DIR/scripts/assert_desktop_conversation_flow_smoke.mjs" "$DB_PATH" "$HANDOFF_EVIDENCE" "$SMOKE_AUDIT" >"$EVIDENCE_DIR/closure-smoke-audit.stdout.json"
  echo "E2E closure smoke audit passed: $SMOKE_AUDIT"
}

if [[ "$MODE" == "smoke" ]]; then
  trap cleanup EXIT
fi

launch_app
wait_for_sqlite
cleanup
wait_for_db_writable
complete_onboarding_for_e2e
seed_handoff_for_e2e
assert_smoke_closure_for_e2e

if [[ "$MODE" == "smoke" ]]; then
  echo "Smoke passed."
  exit 0
fi

if [[ "$MODE" == "manual" ]]; then
  launch_app
  wait_for_sqlite
fi

cat <<EOF

Manual E2E app is running with isolated data.
Use the checklist at:
$CHECKLIST

Press Ctrl-C here to stop the isolated Electron instance.
EOF

wait "$APP_PID"
