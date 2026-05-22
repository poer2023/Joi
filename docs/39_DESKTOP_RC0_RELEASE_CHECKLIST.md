# Desktop RC0 Release Checklist

Version: `0.1.0-rc0`

## Required Checks

```text
Wails build: passed
App bundle: apps/joi-desktop/build/bin/joi-desktop.app
Data directory: ~/Library/Application Support/Joi
SQLite: ~/Library/Application Support/Joi/joi.db
Logs directory: ~/Library/Application Support/Joi/logs
Backups directory: ~/Library/Application Support/Joi/backups
Keychain service: Joi Desktop
First-run onboarding: implemented and completed once on this Mac
Exit and reopen persistence: covered by desktop_poc_check
Real model: DeepSeek through openai_compatible verified with real_model=true and fallback_to_mock=false
Telegram: optional, Keychain-backed token
Remote worker: optional, Desktop Worker Gateway verified with vps-la-1
Confirmation flow: available in Desktop Confirmations page
Security eval: required before release
Desktop eval: required before release
Backup restore: temporary data drill passed; UI first backup created
Docker dependency: none in Desktop Mode
Postgres dependency: none in Desktop Mode
NATS dependency: none in Desktop Mode
```

## Current Verdict

Ready for the owner to dogfood daily on this Mac.

Not ready for other users yet. Remaining reasons:

```text
No signed/notarized macOS release
First-run onboarding needs more UX mileage after the first owner pass
Desktop remote worker is verified, but not packaged as a managed installer
Backup restore works, but should be repeated against a real app data copy before wider distribution
```

## Release Gate

Before handing to another person:

```text
run go test for all Go modules
run console-web build
run joi-desktop frontend build
run wails build
run golden/security/memory/agent/desktop evals
run desktop_backup_restore_drill.sh
verify no secrets, SQLite DBs, logs, backups, build output, or joibak files are staged
```
