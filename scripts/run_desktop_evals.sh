#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"
pnpm eval:desktop:ts | tee /tmp/joi-desktop-evals.log
echo "desktop eval output: /tmp/joi-desktop-evals.log"
