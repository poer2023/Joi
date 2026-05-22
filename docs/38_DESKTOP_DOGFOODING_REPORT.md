# Desktop Dogfooding Report

Period: 3 days  
Rule: use Joi Desktop App only. Do not use Server Console unless a blocker is recorded.

## Daily Checklist

Run these from Desktop UI or Telegram through Desktop-backed runtime:

```text
Joi self-check
memory write proposal
memory recall
web page summary
server_diagnose_v1
model usage / cost review
manual backup
confirmation request approve/reject
remote worker web_research when vps-la-1 is available
```

## Day 1

Date: 2026-05-23

```text
desktop_only: pass for app flow; Wails UI used for onboarding, first backup, and first chat; no Web Console used
system_health_check: pass; Desktop health and node status callable
memory_write: pass; pending memory proposal path remains available
memory_recall: pass in desktop evals; no manual DB needed for product use
web_research: pass; vps-la-1 fetched https://example.com through Desktop Gateway
server_diagnose: pass in Desktop parity path
costs_visible: pass; Model Usage / Costs page present
backup_created: pass; Wails UI created first .joibak and temp backup drill restored successfully
confirmation_flow: pass; Confirmations page supports approve/reject
remote_worker: pass; vps-la-1 register/heartbeat/claim/ack verified over public SSH reverse tunnel
```

Issues:

```text
must_return_to_cli: true for remote worker setup and repeatable drills; normal onboarding/chat path stayed in Desktop UI
must_open_web_console: false
env_config_problem: fixed during Day 1; first-run setup now saves model key to Keychain and persists model config in SQLite
memory_false_positive: none observed
memory_false_negative: none observed in evals
trace_gap: none for vps-la-1 check; trace showed node_selected, worker_finished, tool_finished
ui_missing_function: restore entry was missing and is now added to Backups
worker_instability: racknerd-e0ccce3 SSH closed during probe; cloudcone-la was used as reachable vps-la-1 host

Fixes made during Day 1:

```text
Embedded SQLite schema into AppCore so Wails launched from Finder/open does not depend on repo cwd
DeepSeek URL handling now accepts both https://api.deepseek.com and https://api.deepseek.com/v1
Model connection test now fails on fallback_to_mock instead of reporting success
web_research fills inputs.url from the original message when the model omits it
Backups page now has restore entry
```
```

## Day 2

Date: 2026-05-24 scheduled

```text
desktop_only: pending calendar-day run
system_health_check: pending
memory_write: pending
memory_recall: pending
web_research: pending
server_diagnose: pending
costs_visible: pending
backup_created: pending
confirmation_flow: pending
remote_worker: pending
```

Issues:

```text
must_return_to_cli: pending
must_open_web_console: pending
env_config_problem: pending
memory_false_positive: pending
memory_false_negative: pending
trace_gap: pending
ui_missing_function: Settings, diagnostics export, Telegram config, Worker token rotation, and Memory Inbox were hardened before this run
worker_instability: pending
```

## Day 3

Date: 2026-05-25 scheduled

```text
desktop_only: pending calendar-day run
system_health_check: pending
memory_write: pending
memory_recall: pending
web_research: pending
server_diagnose: pending
costs_visible: pending
backup_created: pending
confirmation_flow: pending
remote_worker: pending
```

Issues:

```text
must_return_to_cli: pending
must_open_web_console: pending
env_config_problem: pending
memory_false_positive: pending
memory_false_negative: pending
trace_gap: pending
ui_missing_function: pending
worker_instability: pending
```

## Exit Criteria

Desktop RC0 dogfooding is acceptable only when:

```text
No required return to Web Console for normal use
No required command-line operation for chat, trace, memory, health, costs, backups, or confirmations
No plaintext secret handling in logs or backups
Memory write proposals remain pending until confirmed
vps-la-1 remote worker can be manually selected when available
Run Trace explains failures well enough to debug from Desktop
```
