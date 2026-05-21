#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${JOI_LOG_DIR:-$ROOT/logs}"
mkdir -p "$LOG_DIR"

if [[ -f "$ROOT/configs/secrets.local.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/configs/secrets.local.env"
  set +a
fi

export CONFIG_DIR="$ROOT/configs"
export MIGRATIONS_DIR="$ROOT/database/migrations"
export RUNTIME_CONFIG_PATH="$ROOT/configs/runtime.yaml"
export ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:8080}"
export CONSOLE_BASE_URL="${CONSOLE_BASE_URL:-http://localhost:3000}"
export ALLOW_MOCK_PROVIDER="${ALLOW_MOCK_PROVIDER:-false}"
export REQUIRE_REAL_MODEL="${REQUIRE_REAL_MODEL:-true}"

children=()

ts() {
  date '+%Y-%m-%dT%H:%M:%S%z'
}

cleanup() {
  for pid in "${children[@]:-}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT INT TERM

start_docker_infra() {
  docker start agentos-postgres >/dev/null 2>&1 || docker run -d \
    --name agentos-postgres \
    -e POSTGRES_DB=agentos \
    -e POSTGRES_USER=agentos \
    -e POSTGRES_PASSWORD=agentos_password \
    -p 5432:5432 \
    pgvector/pgvector:pg16 >/dev/null
  docker update --restart unless-stopped agentos-postgres >/dev/null 2>&1 || true

  if docker ps -a --format '{{.Names}}' | grep -qx agentos-nats; then
    docker start agentos-nats >/dev/null
  else
    docker run -d --name agentos-nats -p 4222:4222 -p 8222:8222 nats:2.10-alpine -js -m 8222 -sd /data >/dev/null
  fi
  docker update --restart unless-stopped agentos-nats >/dev/null 2>&1 || true
}

wait_for_port() {
  local port="$1"
  local deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if nc -z 127.0.0.1 "$port" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_if_port_free() {
  local port="$1"
  local name="$2"
  shift 2
  if nc -z 127.0.0.1 "$port" >/dev/null 2>&1; then
    echo "$(ts) $name already listening on $port" >> "$LOG_DIR/launchd_stack.log"
    return 0
  fi
  "$@" >> "$LOG_DIR/$name.log" 2>&1 &
  children+=("$!")
}

start_if_process_missing() {
  local pattern="$1"
  local name="$2"
  shift 2
  if pgrep -f "$pattern" >/dev/null 2>&1; then
    echo "$(ts) $name already running" >> "$LOG_DIR/launchd_stack.log"
    return 0
  fi
  "$@" >> "$LOG_DIR/$name.log" 2>&1 &
  children+=("$!")
}

start_cloudflared() {
  if pgrep -f 'cloudflared tunnel --url http://localhost:3000' >/dev/null 2>&1; then
    return 0
  fi
  /opt/homebrew/bin/cloudflared tunnel --url http://localhost:3000 >> "$LOG_DIR/cloudflared.log" 2>&1 &
  children+=("$!")
  for _ in $(seq 1 45); do
    public_url="$(grep -Eo 'https://[-a-zA-Z0-9]+\\.trycloudflare\\.com' "$LOG_DIR/cloudflared.log" | tail -1 || true)"
    if [[ -n "$public_url" ]]; then
      printf 'PUBLIC_CONSOLE_URL=%s\nPUBLIC_BASE_URL=%s\nCONSOLE_BASE_URL=%s\n' "$public_url" "$public_url" "$public_url" > /tmp/joi-public-url.env
      export PUBLIC_CONSOLE_URL="$public_url"
      export PUBLIC_BASE_URL="$public_url"
      export CONSOLE_BASE_URL="$public_url"
      return 0
    fi
    sleep 1
  done
}

start_ssh_tunnel() {
  if pgrep -f 'ssh .* -R 15432:127.0.0.1:5432 .*racknerd-e0ccce3' >/dev/null 2>&1; then
    return 0
  fi
  /usr/bin/ssh -N \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -R 15432:127.0.0.1:5432 \
    -R 14222:127.0.0.1:4222 \
    racknerd-e0ccce3 >> "$LOG_DIR/ssh_reverse_tunnel.log" 2>&1 &
  children+=("$!")
}

start_docker_infra
wait_for_port 5432 || echo "$(ts) postgres did not become ready before timeout" >> "$LOG_DIR/launchd_stack.log"
wait_for_port 4222 || echo "$(ts) nats did not become ready before timeout" >> "$LOG_DIR/launchd_stack.log"

start_if_port_free 3000 console-web bash -lc "cd '$ROOT/apps/console-web' && /opt/homebrew/bin/npm run dev -- --hostname 0.0.0.0 --port 3000"
start_cloudflared
start_ssh_tunnel

start_if_port_free 8080 orchestrator-core bash -lc "cd '$ROOT/services/orchestrator-core' && /opt/homebrew/bin/go run ./cmd/orchestrator"
sleep 5
start_if_process_missing 'go run ./cmd/worker|/exe/worker|/tmp/joi-worker' worker-runtime bash -lc "cd '$ROOT/services/worker-runtime' && /opt/homebrew/bin/go run ./cmd/worker"
start_if_process_missing 'go run ./cmd/gateway|/exe/gateway|/tmp/joi-telegram-gateway' telegram-gateway bash -lc "cd '$ROOT/services/telegram-gateway' && /opt/homebrew/bin/go run ./cmd/gateway"

echo "$(ts) Joi launchd stack started with ${#children[@]} child process(es)" >> "$LOG_DIR/launchd_stack.log"
if [[ "${#children[@]}" == "0" ]]; then
  while true; do
    sleep 3600
  done
fi
wait
