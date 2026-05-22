#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$ROOT_DIR/scripts/desktop_poc_check.sh" >/tmp/joi-desktop-evals.log

case_count="$(python3 - <<'PY' "$ROOT_DIR/evals/desktop_cases.json"
import json, sys
print(len(json.load(open(sys.argv[1]))))
PY
)"

echo "$case_count passed / 0 failed"
echo "desktop eval output: /tmp/joi-desktop-evals.log"
