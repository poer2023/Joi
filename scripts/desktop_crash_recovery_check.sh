#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export APP_MODE=desktop
export DATA_STORE=sqlite
export TASK_QUEUE_DRIVER=sqlite
export MODEL_PROVIDER=mock_provider
export ALLOW_MOCK_PROVIDER=true

cd "$ROOT_DIR/services/orchestrator-core"
go run ./cmd/desktop-crash-recovery-check
