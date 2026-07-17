# Joi Codex Automation Parity Acceptance Contract

Date: 2026-07-14

## Objective

Reproduce the externally observable automation creation, execution, recovery, and interaction model of the installed Codex Desktop automation surface in Joi Desktop. The implementation must use Joi's real SQLite store and real tool-calling runtime; static demo data does not satisfy this contract.

Codex reference evidence was taken from the installed Codex 26.707.72221 bundle refreshed into `/Users/hao/project/recodex/ref`, especially `webview/assets/automations-page-Do8tpdFV.js`, plus the live local automation definitions under `~/.codex/automations`.

## Surface and states

- Surface: Settings -> Automations / Scheduled tasks.
- List states: loading, empty with suggestions, populated, search-empty, active filter, paused filter, running, unread, save/run/delete error.
- Detail states: manual create, AI-assisted create, active edit, paused edit, missing task, unsaved draft, failed save with retry, delete confirmation.
- History states: no runs, running, unread, read, succeeded, failed, waiting for confirmation, archived, partial archive failure.
- Narrow layout must remain usable without horizontal clipping.

## Required behavior

1. Creation and editing
   - Manual creation and "Create with Joi" are both available.
   - Suggestions cover daily brief, weekly review, and follow-up monitor.
   - A task has a name, prompt, recurrence rule, status, execution kind, model, reasoning effort, permission profile, and target context.
   - `cron` creates a new task conversation for each run and supports a working directory.
   - `heartbeat` continues an existing Joi conversation and requires a target conversation.
   - AI-assisted creation uses a real model conversation and the real `automation_update` tool to create a paused review draft; it never silently activates a schedule.
   - Unsaved creation changes require discard confirmation.

2. Scheduling and execution
   - Recurrence data round-trips as an RRULE-compatible string and executes using the local timezone.
   - The runtime supports hourly, daily, weekdays, weekly, and custom recurrence modes.
   - Pause/resume, run now, edit, and permanent delete are available from both list and detail contexts.
   - The runner persists triggers and runs, enforces per-automation concurrency, deduplicates scheduled fires, retries eligible failures, and coalesces a missed fire after restart.
   - A run uses the automation's selected model, reasoning effort, permission profile, working directory context, and target conversation semantics.
   - Scheduled tasks run only while Joi is running; quitting with active schedules shows an explicit warning.

3. Run interaction
   - Every run is attached to a real Joi conversation and can be opened from Previous runs.
   - New run results are unread until opened or explicitly marked read.
   - One run or all runs can be marked read.
   - One run or all eligible runs can be archived, with partial failure reported instead of hidden.
   - Running, succeeded, failed, waiting-confirmation, unread, and archived states remain distinguishable.

4. Compatibility
   - Existing Joi schedule records remain readable and editable.
   - Existing Joi Webhook/HMAC tasks and Telegram completion notifications remain available as Joi extensions.
   - Existing user conversations, automations, runs, secrets, and settings are not reset or replaced.

## Visual acceptance

- The main page has one clear title/subtitle, search, status filter, mark-all-read action, and create split action.
- Rows expose status, schedule summary, next run or running state, unread state, and contextual actions without requiring a detail open.
- Selecting a task opens a stable detail panel with editor and Previous runs; the list remains navigable.
- Focus, hover, disabled, loading, error, destructive, and selected states are visible and keyboard reachable.
- At desktop widths the list/detail/history relationship is immediately legible; at narrow widths the detail becomes a single-column surface.

## Verification gates

### Gate 0 — reference and gap matrix

- Evidence: installed Codex source, local Codex automation TOML shapes, current Joi automation store/runtime/UI.
- Pass condition: the required behaviors above map to a concrete Joi implementation point.

### Gate 1 — source implementation

- Evidence: type/store/runtime/tool/UI tests and a production build.
- Pass condition: no mock-only path is needed for any required behavior.

### Gate 2 — real app proof

- Evidence: real clock run, run-now, pause/resume, restart recovery, failure/retry or waiting-confirmation, history read/archive, installed bundle inspection, visible installed-app UI.
- Pass condition: the installed `/Applications/Joi.app` contains and executes the verified implementation without losing the existing Joi database.

## Non-goals

- Copying Codex branding, account/billing UI, analytics identifiers, or unavailable server-private internals.
- Removing Joi's Webhook, Telegram, worker routing, or Run Trace extensions.
- Claiming background execution while the Joi process is not running.
