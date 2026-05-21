#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:8080}"
PYTHON="${PYTHON:-/usr/bin/python3}"

"$PYTHON" "$ROOT_DIR/evals/run_evals.py" "$ROOT_DIR/evals/golden_cases.json" "$ORCHESTRATOR_URL"
