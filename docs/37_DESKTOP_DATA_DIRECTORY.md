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

## Move-App Verification

To verify that app data survives moving the app:

1. Build or package `Joi.app`.
2. Launch it once and send a chat message.
3. Confirm `~/Library/Application Support/Joi/joi.db` exists.
4. Move `Joi.app` to a different folder.
5. Launch it again.
6. Confirm the previous run trace and memory data remain visible.
