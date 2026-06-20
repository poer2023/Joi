#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pnpm test:store
pnpm --filter @joi/runtime test

echo "Desktop diagnostics export check passed with TS store/runtime redaction coverage."
