#!/usr/bin/env bash
set -euo pipefail

: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN is required}"
: "${TELEGRAM_ALLOWED_USER_IDS:?TELEGRAM_ALLOWED_USER_IDS is required}"
API="${ORCHESTRATOR_URL:-http://localhost:8080}"
APP_MODE="${APP_MODE:-desktop}"
DATA_STORE="${DATA_STORE:-sqlite}"

curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" >/dev/null

if [[ "$APP_MODE" != "desktop" && "$DATA_STORE" != "sqlite" ]]; then
  : "${PUBLIC_CONSOLE_URL:?PUBLIC_CONSOLE_URL is required outside desktop/sqlite mode}"
  if [[ "$PUBLIC_CONSOLE_URL" == *"localhost"* || "$PUBLIC_CONSOLE_URL" == *"127.0.0.1"* ]]; then
    echo "PUBLIC_CONSOLE_URL must be a Tailscale or Cloudflare Tunnel URL, not localhost" >&2
    exit 1
  fi
  curl -k -L -fsS "$PUBLIC_CONSOLE_URL" >/dev/null
  curl -fsS "$API/ready" >/dev/null
else
  echo "desktop mode: skipped public console and server /ready checks"
fi

echo "telegram config ok"
echo "Manual verification still required: send private text from an allowed user, verify @agent route, Trace link, and non-whitelist rejection."
