#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

if [[ -f "$ROOT_DIR/configs/secrets.local.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/configs/secrets.local.env"
  set +a
fi

export ALLOW_MOCK_PROVIDER=false
export REQUIRE_REAL_MODEL=true

cd "$ROOT_DIR"
pnpm test:runtime | tee "$OUT"
pnpm test:electron-contract | tee -a "$OUT"

grep -q 'model runtime tests passed' "$OUT"
grep -q 'preload contract ok' "$OUT"

echo "Desktop real model gate passed: mock provider is disabled in runtime tests and Electron chat has no mock fallback."
