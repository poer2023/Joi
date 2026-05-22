#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

export APP_MODE=desktop
export DATA_STORE=sqlite
export TASK_QUEUE_DRIVER=sqlite
export SQLITE_PATH="$TMP_DIR/joi-desktop-evals.db"
export SQLITE_SCHEMA_PATH="$ROOT_DIR/database/sqlite/001_init_schema.sql"
export RUNTIME_CONFIG_PATH="$ROOT_DIR/configs/runtime.example.yaml"
export DOCKER_REQUIRED=false
export MODEL_PROVIDER=mock_provider
export ALLOW_MOCK_PROVIDER=true

cd "$ROOT_DIR/services/orchestrator-core"
go run ./cmd/desktop-evals "$ROOT_DIR/evals/desktop_cases.json" | tee /tmp/joi-desktop-evals.log
echo "desktop eval output: /tmp/joi-desktop-evals.log"
