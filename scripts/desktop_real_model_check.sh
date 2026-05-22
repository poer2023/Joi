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

"$ROOT_DIR/scripts/desktop_poc_check.sh" | tee "$OUT"

grep -q '"real_model": true' "$OUT"
grep -q '"fallback_to_mock": false' "$OUT"
grep -q '"model_call_provider": "openai_compatible"' "$OUT"

echo "Desktop real model check passed: no mock fallback."
