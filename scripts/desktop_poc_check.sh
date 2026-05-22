#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

export APP_MODE=desktop
export DATA_STORE=sqlite
export TASK_QUEUE_DRIVER=sqlite
export SQLITE_PATH="$TMP_DIR/joi.db"
export SQLITE_SCHEMA_PATH="$ROOT_DIR/database/sqlite/001_init_schema.sql"
export RUNTIME_CONFIG_PATH="$ROOT_DIR/configs/runtime.example.yaml"
export DOCKER_REQUIRED=false

cd "$ROOT_DIR/services/orchestrator-core"
go run ./cmd/desktop-poc-check | tee "$TMP_DIR/result.json"

test -f "$SQLITE_PATH"
grep -q '"ok": true' "$TMP_DIR/result.json"
grep -q '"data_store": "sqlite"' "$TMP_DIR/result.json"
grep -q '"task_queue": "sqlite"' "$TMP_DIR/result.json"
grep -q '"docker_required": false' "$TMP_DIR/result.json"
grep -q '"prompt_assemblies": 1' "$TMP_DIR/result.json"
grep -q '"model_calls": 1' "$TMP_DIR/result.json"
grep -q '"memory_context_packs": 1' "$TMP_DIR/result.json"
grep -q '"persisted_run_steps":' "$TMP_DIR/result.json"

echo "Desktop PoC passed: SQLite AppCore wrote chat, run trace, health, and backup without Docker/Postgres/NATS."
