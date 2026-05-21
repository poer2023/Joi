#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP="${BACKUP:-${1:-}}"
DATABASE_URL="${DATABASE_URL:-postgres://agentos:agentos_password@localhost:5432/agentos?sslmode=disable}"

if [[ -z "$BACKUP" ]]; then
  echo "Usage: BACKUP=/path/to/joi-backup.tar.gz $0" >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [[ -d "$BACKUP" ]]; then
  SRC="$BACKUP"
else
  tar -xzf "$BACKUP" -C "$TMP"
  SRC="$(find "$TMP" -maxdepth 1 -type d -name 'joi-*' | head -n1)"
fi

if [[ -z "${SRC:-}" || ! -d "$SRC" ]]; then
  echo "Backup payload not found" >&2
  exit 1
fi

if [[ -f "$SRC/postgres.sql" ]]; then
  if ! command -v psql >/dev/null 2>&1; then
    echo "psql not found; cannot restore postgres.sql" >&2
    exit 1
  fi
  psql "$DATABASE_URL" < "$SRC/postgres.sql"
else
  echo "postgres.sql not found; skipped database restore" >&2
fi

if [[ -d "$SRC/configs" ]]; then
  rsync -a --exclude='*.env' --exclude='secrets*.env' "$SRC/configs/" "$ROOT/configs/"
fi
if [[ -d "$SRC/prompts" ]]; then
  rsync -a "$SRC/prompts/" "$ROOT/prompts/"
fi

echo "Restored $SRC"
