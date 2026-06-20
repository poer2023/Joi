#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"
pnpm test:electron-contract
pnpm test:store
pnpm eval:desktop:ts

echo "Desktop PoC passed: Electron IPC, TS SQLite store, run trace, task/artifact flow, and desktop evals pass without Docker/Postgres/NATS."
