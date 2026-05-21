#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
docker start agentos-postgres >/dev/null 2>&1 || docker run -d --name agentos-postgres -e POSTGRES_DB=agentos -e POSTGRES_USER=agentos -e POSTGRES_PASSWORD=agentos_password -p 5432:5432 pgvector/pgvector:pg16 >/dev/null
if docker ps -a --format '{{.Names}}' | grep -qx agentos-nats; then
  docker start agentos-nats >/dev/null
  if ! curl -fsS http://localhost:8222/varz >/dev/null 2>&1; then
    docker rm -f agentos-nats >/dev/null
    docker run -d --name agentos-nats -p 4222:4222 -p 8222:8222 nats:2.10-alpine -js -m 8222 -sd /data >/dev/null
  fi
else
  docker run -d --name agentos-nats -p 4222:4222 -p 8222:8222 nats:2.10-alpine -js -m 8222 -sd /data >/dev/null
fi
printf 'dev infra is up. Start services with:\n'
printf '  cd %s/services/orchestrator-core && go run ./cmd/orchestrator\n' "$ROOT"
printf '  cd %s/services/worker-runtime && go run ./cmd/worker\n' "$ROOT"
printf '  cd %s/apps/console-web && npm run dev -- --hostname 0.0.0.0 --port 3000\n' "$ROOT"
