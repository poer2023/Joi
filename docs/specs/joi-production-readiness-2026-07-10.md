# Joi Desktop Production Readiness Acceptance

## Scope

- Project: `/Users/hao/project/Joi`
- Product truth: installed `/Applications/Joi.app`
- Core jobs: open/reopen Desktop, chat and stream replies, attach files, inspect tool/run evidence, manage project personas and rooms, use settings without clipped or ambiguous controls.
- Files in scope: current Desktop, Electron, runtime, store, shared type, test, packaging, and root command-entry changes.

## Product and UI Contract

- Keep the current three-surface structure: messenger sidebar, conversation, optional inspector/settings.
- Keep local SQLite data and `window.joi` preload compatibility.
- Show implemented, alias, planned, loading, empty, blocked, and failed states honestly; never present a planned backend as executed.
- Keep the compact neutral visual system, readable spacing, keyboard focus, and usable narrow-window behavior.
- Do not add Server Mode, mandatory external gateways, a global master model, or unreviewed destructive actions.

## Required Verification

- Root Joi commands exist and the local conversation-flow gate can start from the documented entrypoint.
- Runtime, store, secrets, frontend projection/state tests, Electron preload/webhook contracts, desktop evals, frontend build, and Electron build pass.
- Production SQLite schema check passes without modifying user data.
- Packaged app replaces the old installed build only after source verification; `~/Library/Application Support/Joi` remains intact.
- Installed app passes codesign, bundle/source proof, bridge health, close/reopen, main chat, settings, and inspector visual checks.
- Desktop and narrow-window screenshots show no clipping, horizontal overflow, or broken primary controls.

## Done Means

- [x] Gate 0 evidence and this contract are complete.
- [x] Gate 1 code and command-entry gaps pass automated verification.
- [x] Gate 2 installed-app and visual verification pass; superseded app archives are removed only afterward.

## Production Regression Follow-up

- Reference: installed `/Applications/Joi.app`, private hub conversation, failed run `run_mreke0u3gm7ojf` and the successful replacement run.
- Failed terminal runs must render as `失败`; an earlier provider `assistant.completed` event must not override `run.failed`.
- When the selected task is terminal and the room has no active task, the composer must return to `发到私人总群，或 @ 指定项目人格...`.
- Keep the current layout and copy density; add no new panels, controls, or helper text.
- Verify both states in the installed app with Computer Use after packaging, alongside SQLite terminal status and foreign-key checks.
