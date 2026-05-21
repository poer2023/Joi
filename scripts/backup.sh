#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${BACKUP_DIR:-$ROOT/backups}/joi-$STAMP"
ARCHIVE="$OUT_DIR.tar.gz"
DATABASE_URL="${DATABASE_URL:-postgres://agentos:agentos_password@localhost:5432/agentos?sslmode=disable}"

mkdir -p "$OUT_DIR"

if command -v pg_dump >/dev/null 2>&1; then
  pg_dump "$DATABASE_URL" > "$OUT_DIR/postgres.sql"
else
  echo "pg_dump not found; skipping postgres.sql" > "$OUT_DIR/postgres.SKIPPED.txt"
fi

mkdir -p "$OUT_DIR/configs" "$OUT_DIR/prompts" "$OUT_DIR/database"
rsync -a --exclude='*.env' --exclude='secrets*.env' "$ROOT/configs/" "$OUT_DIR/configs/" 2>/dev/null || true
rsync -a "$ROOT/prompts/" "$OUT_DIR/prompts/" 2>/dev/null || true
rsync -a "$ROOT/database/migrations/" "$OUT_DIR/database/migrations/" 2>/dev/null || true

if command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -Atc "SELECT row_to_json(memories)::text FROM memories ORDER BY created_at" > "$OUT_DIR/memory.jsonl" 2>/dev/null || true
  psql "$DATABASE_URL" -Atc "SELECT row_to_json(agents)::text FROM agents ORDER BY id" > "$OUT_DIR/agent_configs.jsonl" 2>/dev/null || true
  psql "$DATABASE_URL" -Atc "SELECT row_to_json(capabilities)::text FROM capabilities ORDER BY id" > "$OUT_DIR/capability_configs.jsonl" 2>/dev/null || true
fi

cat > "$OUT_DIR/README.txt" <<EOF
Joi backup $STAMP

Includes PostgreSQL dump when pg_dump is available, non-secret configs, prompts,
migrations, memory jsonl, agent configs, and capability configs.
Secrets are intentionally excluded. Restore secrets from your secret manager or
configs/secrets.example.env.
EOF

tar -C "$(dirname "$OUT_DIR")" -czf "$ARCHIVE" "$(basename "$OUT_DIR")"
echo "$ARCHIVE"
