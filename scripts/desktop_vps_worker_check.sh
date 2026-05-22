#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT_DIR/configs/secrets.local.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/configs/secrets.local.env"
  set +a
fi

export APP_MODE="${APP_MODE:-desktop}"
export DATA_STORE="${DATA_STORE:-sqlite}"
export TASK_QUEUE_DRIVER="${TASK_QUEUE_DRIVER:-sqlite}"
export DESKTOP_WORKER_NODE_ID="${DESKTOP_WORKER_NODE_ID:-vps-la-1}"
export DESKTOP_WORKER_CHECK_TIMEOUT_SECONDS="${DESKTOP_WORKER_CHECK_TIMEOUT_SECONDS:-150}"
export DESKTOP_WORKER_CHECK_MESSAGE="${DESKTOP_WORKER_CHECK_MESSAGE:-@research 请读取 https://example.com 并用两句话总结页面内容。}"

cd "$ROOT_DIR/services/orchestrator-core"
go run ./cmd/desktop-worker-check
