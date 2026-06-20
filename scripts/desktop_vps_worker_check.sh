#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT_DIR/configs/secrets.local.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/configs/secrets.local.env"
  set +a
fi

cd "$ROOT_DIR"
pnpm --filter @joi/runtime test

echo "Desktop worker gateway check passed through TS runtime protocol coverage."
