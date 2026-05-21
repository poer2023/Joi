#!/usr/bin/env bash
set -euo pipefail
pkill -f '/tmp/joi-orchestrator|go run ./cmd/orchestrator|go run ./cmd/worker' 2>/dev/null || true
docker stop agentos-nats >/dev/null 2>&1 || true
docker stop agentos-postgres >/dev/null 2>&1 || true
printf 'dev services stopped\n'
