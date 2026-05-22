# Desktop RC0 Release Checklist

Version: `0.1.0-rc0`

## Required Checks

```text
Wails build: passed
App bundle: apps/joi-desktop/build/bin/Joi.app
Data directory: ~/Library/Application Support/Joi
SQLite: ~/Library/Application Support/Joi/joi.db
Logs directory: ~/Library/Application Support/Joi/logs
Backups directory: ~/Library/Application Support/Joi/backups
Keychain service: Joi Desktop
Diagnostics export: Settings can create joi-diagnostics-YYYYMMDD-HHMMSS.zip with secret redaction
First-run onboarding: implemented and completed once on this Mac
Exit and reopen persistence: covered by desktop_poc_check
Real model: DeepSeek through openai_compatible verified with real_model=true and fallback_to_mock=false
Telegram: optional, Keychain-backed token
Remote worker: optional, Desktop Worker Gateway verified with vps-la-1
Worker Gateway security: token rotation, node allowlist, timestamp, nonce replay protection, rate limits, disabled-node enforcement, capability whitelist, and audit log implemented
Confirmation flow: available in Desktop Confirmations page
Security eval: required before release
Desktop eval: required before release
Backup restore: temporary data drill passed; UI first backup created
Package: dist/desktop/Joi-0.1.0-rc0-macos-arm64.zip
Package manifest: dist/desktop/Joi-0.1.0-rc0-macos-arm64.manifest.json
Docker dependency: none in Desktop Mode
Postgres dependency: none in Desktop Mode
NATS dependency: none in Desktop Mode
```

## Package Verification

```text
App version: 0.1.0-rc0
Bundle name: Joi
Bundle path: apps/joi-desktop/build/bin/Joi.app
Executable: apps/joi-desktop/build/bin/Joi.app/Contents/MacOS/Joi
Data directory: verified
Logs directory: verified
Backups directory: verified
Diagnostics directory: verified
Keychain MODEL_API_KEY: present without printing value
Keychain WORKER_TOKEN: present without printing value
Remote worker config: code path preserved through Worker Gateway token header, timestamp, nonce, and node allowlist
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

## Validation Markers

```text
desktop_gateway_vps_verified=true
first_run_onboarding_verified=true
desktop_backup_restore_verified=true
desktop_rc0_validation_commit=2634854
desktop_rc0_validation_tag=desktop-rc0-validation
app_version=0.1.0-rc0
desktop_diagnostics_export_verified=true
worker_gateway_security_verified=true
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
