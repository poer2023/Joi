# Desktop RC0 Release Checklist

Version: `0.1.0-rc0`

Historical note: the original RC0 checklist was written for the Wails desktop bundle. The current desktop release path is Electron-native; use `docs/36_DESKTOP_INSTALLATION.md` and `docs/53_ELECTRON_NATIVE_REFACTOR.md` for current build/package commands.

## Required Checks

```text
Electron build: passed
App bundle: apps/joi-electron/release-desktop/mac-arm64/Joi.app
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
Crash/restart recovery: scripts/desktop_crash_recovery_check.sh passed
SQLite migration/upgrade: scripts/sqlite_migration_check.sh passed
Package install dogfood: /Applications/Joi.app opened from Finder and completed first-run flow
Install dogfood first message: run_eddb1c1e1939ebdab96c4ee4
Install dogfood memory confirmation: run_9617cae0cb615f2dc312069b
Install dogfood self-check: run_a52f867c150f20bbdca5adb9
Install dogfood web summary: run_c06caaed2552da85bbca0695
Docker dependency: none in Desktop Mode
Postgres dependency: none in Desktop Mode
NATS dependency: none in Desktop Mode
```

## Package Verification

```text
App version: 0.1.0-rc0
Bundle name: Joi
Bundle path: apps/joi-electron/release-desktop/mac-arm64/Joi.app
Executable: apps/joi-electron/release-desktop/mac-arm64/Joi.app/Contents/MacOS/Joi
Data directory: verified
Logs directory: verified
Backups directory: verified
Diagnostics directory: verified
Keychain MODEL_API_KEY: present without printing value
Keychain WORKER_TOKEN: present without printing value
Remote worker config: code path preserved through Worker Gateway token header, timestamp, nonce, and node allowlist
vps-la-1 redeploy: current worker-runtime from 43143d9+local hardening build deployed to cloudcone-la
vps-la-1 binary sha256: a3f9b7ea522bc5ddf82cda9b37a1f98cb020029977bdab630cf04af1532ee3ac
vps-la-1 manual dispatch: run_018c5bf5c332b888e74e2910 / task_2351883e21eb7768ca8d0ee9 succeeded
vps-la-1 post-install-restore dispatch: run_88ccbab2c5961780ab212953 / task_bc1ea6d08221e3d757ddc435 succeeded
vps-la-1 assignment: node_id=vps-la-1, assignment_reason=user_selected
vps-la-1 gateway protocol: timestamp and nonce headers used by remote_gateway worker
Gateway security negatives: wrong token rejected, old token rejected after rotation, duplicate nonce rejected, disabled node claim denied, duplicate ack ineffective
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
desktop_rc0_hardened_commit=43143d9
desktop_rc0_hardened_tag=desktop-rc0-hardened
diagnostics_export_verified=true
keychain_settings_verified=true
memory_inbox_verified=true
package_created=true
desktop_crash_recovery_verified=true
sqlite_migration_verified=true
vps_la_1_redeployed=true
vps_la_1_remote_gateway_verified=true
vps_la_1_manual_dispatch_verified=true
worker_gateway_duplicate_nonce_verified=true
desktop_package_install_dogfood_verified=true
desktop_package_quit_reopen_verified=true
desktop_package_keychain_after_reopen_verified=true
```

## Release Gate

Before handing to another person:

```text
run go test for all Go modules
run console-web build
run joi-desktop frontend build
run electron build
run electron macOS package
run golden/security/memory/agent/desktop evals
run desktop_backup_restore_drill.sh
verify no secrets, SQLite DBs, logs, backups, build output, or joibak files are staged
```
