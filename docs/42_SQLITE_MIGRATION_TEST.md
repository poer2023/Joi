# SQLite Migration Test

Date: 2026-05-23

## Scope

This check verifies that a Desktop SQLite database created by an older RC0 fixture can be opened by the current app, migrated idempotently, and still expose the core user data needed by Desktop Mode.

The fixture is generated at runtime instead of committing a binary database file.

## Command

```bash
cd /Users/hao/project/Joi
./scripts/sqlite_migration_check.sh
```

## Coverage

```text
old version fixture generated in a temporary directory
current SQLite schema applied twice
SQLite PRAGMAs applied
memory FTS5 rebuilt for pre-existing memories
memories readable
runs readable
desktop settings readable
agents readable
capabilities readable
worker_gateway_nonces table created
worker_gateway_audit_logs table created
PRAGMA integrity_check returns ok
```

## Latest Result

```json
{
  "agents_readable": 1,
  "capabilities_readable": 1,
  "fts_hit_count": 1,
  "gateway_tables": 2,
  "memories_readable": 1,
  "ok": true,
  "runs_readable": 1,
  "settings_readable": 1,
  "sqlite_integrity": "ok"
}
```

## Notes

SQLite migration is currently schema-initialization based, with compatibility repair for memory FTS. If a future release changes existing table columns, add explicit idempotent `ALTER TABLE` migrations and extend this fixture before shipping that release.
