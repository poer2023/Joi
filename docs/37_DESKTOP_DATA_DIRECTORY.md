# Joi Desktop Data Directory

Joi Desktop stores user data outside the app bundle so moving `Joi.app` does not move or delete data.

## macOS Paths

```text
Data:
~/Library/Application Support/Joi

SQLite:
~/Library/Application Support/Joi/joi.db

SQLite WAL:
~/Library/Application Support/Joi/joi.db-wal
~/Library/Application Support/Joi/joi.db-shm

Backups:
~/Library/Application Support/Joi/backups

Logs:
~/Library/Application Support/Joi/logs

Diagnostics:
~/Library/Application Support/Joi/diagnostics
```

## Secrets

Desktop secrets are stored in macOS Keychain under service:

```text
Joi Desktop
```

Supported secret names:

```text
MODEL_API_KEY
TELEGRAM_BOT_TOKEN
WORKER_TOKEN
NODE_SECRET
ADMIN_TOKEN
```

Secrets are not written to logs, normal backups, package manifests, or `.joibak` archives.

Diagnostics exports are written as:

```text
joi-diagnostics-YYYYMMDD-HHMMSS.zip
```

They include version, mode, OS, SQLite health, recent run summaries, recent errors, worker status, model provider status, Telegram configured state, backup status, last 100 run steps, last 100 tool runs, and last 100 model calls. They redact API keys, Telegram bot tokens, worker/node secrets, prompt bodies, raw model responses, and full memory text.

## Backup Contents

Manual backups include:

```text
SQLite database
SQLite WAL/SHM when present
configs without local secret env files
prompts
manifest.json
```

Manual backups exclude:

```text
.env
secrets.local.env
MODEL_API_KEY
TELEGRAM_BOT_TOKEN
WORKER_TOKEN
NODE_SECRET
ADMIN_TOKEN
```

## Restore Behavior

Desktop restore is available from the Backups page. Restoring a `.joibak`:

```text
closes the current SQLite connection
extracts SQLite/config/prompt files from the backup
reopens SQLite
re-runs schema initialization
refreshes AppCore state
```

Secrets are not restored from `.joibak`. After restore, verify model, Telegram, and worker tokens from Settings because they must come from Keychain or be re-entered.

## Restore Drill

The non-destructive local drill uses a temporary data directory:

```bash
cd /Users/hao/project/Joi
./scripts/desktop_backup_restore_drill.sh
```

Expected result:

```text
Desktop backup/restore drill passed without restoring plaintext secrets.
```

## Move-App Verification

To verify that app data survives moving the app:

1. Build or package `Joi.app`.
2. Launch it once and send a chat message.
3. Confirm `~/Library/Application Support/Joi/joi.db` exists.
4. Move `Joi.app` to a different folder.
5. Launch it again.
6. Confirm the previous run trace and memory data remain visible.

The live package install dogfood checklist is tracked in:

```text
docs/41_DESKTOP_INSTALL_DOGFOOD_CHECK.md
```
