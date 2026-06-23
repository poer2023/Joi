# Desktop Install Dogfood Check

Date: 2026-05-23

Current installed package note, updated 2026-06-23: the latest local Electron package installed during launch repair is `dist/desktop/Joi-0.1.0-20260623.1115-macos-arm64.zip`. The original dogfood evidence below is historical and still refers to the package that was actually tested on 2026-05-23.

Package under test:

```text
dist/desktop/Joi-0.1.0-rc0-macos-arm64.zip
```

## Required Flow

```text
unzip package
move Joi.app to /Applications
open from Finder
complete First-run Onboarding
configure DeepSeek in Keychain
send first message
create pending memory and confirm it in Memory Inbox
run Joi self-check
run web page summary
create backup
export diagnostics package
quit and reopen
verify data, settings, and Keychain secrets still work
```

## Result

```text
status: passed on owner Mac
finder_open: passed via Finder opening /Applications/Joi.app
app_version: 0.1.0-rc0
first_run_onboarding: passed
deepseek_keychain: passed; MODEL_API_KEY was read from Keychain without printing the value
first_message: passed, run_eddb1c1e1939ebdab96c4ee4
pending_memory_created: passed, run_9617cae0cb615f2dc312069b
memory_inbox_confirmed: passed
joi_self_check: passed, run_a52f867c150f20bbdca5adb9
web_page_summary: passed, run_c06caaed2552da85bbca0695
backup_created: passed, joi-backup-20260523-043339.joibak
diagnostics_exported: passed, joi-diagnostics-20260523-043350.zip
quit_reopen_persistence: passed
settings_after_reopen: passed
keychain_after_reopen: passed; MODEL_API_KEY / TELEGRAM_BOT_TOKEN / WORKER_TOKEN remained configured
```

## Evidence

```text
active data directory was moved aside, not deleted
backup copy was created before the test
package was unzipped from dist/desktop/Joi-0.1.0-rc0-macos-arm64.zip
Joi.app was copied to /Applications
App was opened through Finder
test data directory survived app quit/reopen
```

## Original Data Handling

Original owner data directory was moved to:

```text
~/Library/Application Support/Joi.before-install-test-20260523043108
```

A second copy was created before moving:

```text
~/Library/Application Support/Joi.before-install-test-20260523043108.copy
```

Secrets stayed in Keychain and were not exported into this report.

After the install pass, the original owner data directory was restored to:

```text
~/Library/Application Support/Joi
```

The install-test data directory was preserved separately:

```text
~/Library/Application Support/Joi.install-test-20260523043507
```
