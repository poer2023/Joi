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

Date:

```text
desktop_only:
system_health_check:
memory_write:
memory_recall:
web_research:
server_diagnose:
costs_visible:
backup_created:
confirmation_flow:
remote_worker:
```

Issues:

```text
must_return_to_cli:
must_open_web_console:
env_config_problem:
memory_false_positive:
memory_false_negative:
trace_gap:
ui_missing_function:
worker_instability:
```

## Day 2

Date:

```text
desktop_only:
system_health_check:
memory_write:
memory_recall:
web_research:
server_diagnose:
costs_visible:
backup_created:
confirmation_flow:
remote_worker:
```

Issues:

```text
must_return_to_cli:
must_open_web_console:
env_config_problem:
memory_false_positive:
memory_false_negative:
trace_gap:
ui_missing_function:
worker_instability:
```

## Day 3

Date:

```text
desktop_only:
system_health_check:
memory_write:
memory_recall:
web_research:
server_diagnose:
costs_visible:
backup_created:
confirmation_flow:
remote_worker:
```

Issues:

```text
must_return_to_cli:
must_open_web_console:
env_config_problem:
memory_false_positive:
memory_false_negative:
trace_gap:
ui_missing_function:
worker_instability:
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
