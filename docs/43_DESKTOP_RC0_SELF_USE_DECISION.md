# Desktop RC0 Self-Use Decision

Date: 2026-05-23

Historical note: this RC0 decision predates the Electron-native cutover. The current default desktop path is tracked in `docs/53_ELECTRON_NATIVE_REFACTOR.md`.

## Summary

Desktop RC0 is acceptable as an owner-only dogfooding build, not as a build for other people.

## Evidence

```text
desktop_rc0_hardened_tag=desktop-rc0-hardened
desktop_rc0_hardened_commit=43143d9
diagnostics_export_verified=true
worker_gateway_security_verified=true
keychain_settings_verified=true
memory_inbox_verified=true
package_created=true
crash_recovery_check=passed
sqlite_migration_check=passed
package_install_dogfood=passed
vps_la_1_redeploy=passed
vps_la_1_post_restore_dispatch=passed
```

## Current Decision

```text
self_use_status: provisional_yes
scope: owner daily dogfooding only
default_entry_at_rc0: Legacy Wails Desktop App
current_default_entry: Electron-native Desktop App
server_console_required_for_normal_use: no
docker_required_for_desktop: no
postgres_required_for_desktop: no
nats_required_for_desktop: no
```

The decision remains provisional until Day 2 and Day 3 dogfooding are completed on their actual calendar days.

## Why Not Ship To Others Yet

```text
macOS app is not signed or notarized
no external user install test
no automatic update mechanism
first-run onboarding needs more mileage outside the owner machine
remote worker setup is still operator-managed
Day 2 and Day 3 dogfooding are pending real cross-day execution
```

## Required Before Public Sharing

```text
complete Day 2 / Day 3 dogfooding
run full release gate from docs/39_DESKTOP_RC0_RELEASE_CHECKLIST.md
sign and notarize macOS app
test clean install on a second Mac
document automatic update or explicit manual upgrade flow
document remote worker setup without relying on local operator memory
```
