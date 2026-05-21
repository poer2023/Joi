# Backup, Restore, and Migration

Joi backups are operational snapshots for the single-controller system. They
include database state and non-secret runtime assets, but never copy `.env`
secret files into ordinary archives.

## Backup

```bash
make backup
```

The backup includes:

- PostgreSQL dump (`postgres.sql`) when `pg_dump` is installed.
- `configs/` excluding `*.env` and `secrets*.env`.
- `prompts/`.
- `database/migrations/`.
- `memory.jsonl`.
- `agent_configs.jsonl`.
- `capability_configs.jsonl`.

Use `DATABASE_URL` to select a non-default database.

## Restore

```bash
make restore BACKUP=/absolute/path/to/joi-YYYYmmdd-HHMMSS.tar.gz
```

Restore loads `postgres.sql` with `psql` and copies non-secret configs and
prompts back into the workspace. Secrets must be restored separately from a
secret manager or a local `.env` file derived from
`configs/secrets.example.env`.

## Migration Safety

1. Stop orchestrator, workers, and gateway.
2. Run `make backup`.
3. Apply migrations or deploy new binaries.
4. Start the stack.
5. Run `./evals/run_evals.sh`, `scripts/run_security_evals.sh`, and targeted
   memory/agent evals.

For destructive recovery drills, restore into a disposable database first. After
restore, run the golden evals before pointing Telegram or remote workers back at
the controller.
