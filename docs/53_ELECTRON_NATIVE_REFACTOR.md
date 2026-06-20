# Joi Electron-Native Refactor

## Current Target

The active target repo is `/Users/hao/project/Joi`. The older `/Users/hao/Documents/Joi` tree is not used for new Electron work.

The cutover has moved the default desktop app to Electron-native:

- `apps/joi-electron` is the Electron-native app shell.
- The current React renderer routes through `window.joi.invoke` under Electron.
- Browser preview keeps a deterministic local fallback for UI development.
- The Wails `window.go`/`window.runtime` renderer fallback, generated `wailsjs` files, Wails app entrypoint, and Wails packaging scripts are removed from the default tree.

## Entrypoints

From the repo root:

```bash
pnpm dev:electron
pnpm build:electron
pnpm build:desktop
pnpm package:desktop:mac
pnpm package:electron:mac
```

The default packaging wrapper is:

```bash
scripts/package_desktop_macos.sh
```

`scripts/package_electron_macos.sh` remains as a compatibility alias for the Electron package path.

## Phase 1 Scope

The Electron shell currently provides:

- Electron main/preload/renderer app under `apps/joi-electron`.
- `contextIsolation=true` and `nodeIntegration=false`.
- Single-instance lock.
- macOS hidden-inset title bar.
- Joi data/log/backup directories under `~/Library/Application Support/Joi`.
- Controlled preload API: `window.joi.invoke`, `window.joi.onRunEvent`, `window.joi.app.getVersion`, and `window.joi.app.openExternal`.
- Zod validation on IPC method names.
- Shared DesktopApi contracts in `packages/shared-types`.
- TS SQLite store in `packages/store` using the existing `database/sqlite/001_init_schema.sql` schema through Electron's `node:sqlite`.
- SQLite-backed Electron handlers for chat, conversations, messages, runs, run events, run trace, settings, saved models, and health.
- SQLite-backed Electron handlers for capabilities, MCP inventory/wrapping records, skills, tool workflows/runs, memories/governance actions, nodes, worker audit logs, model usage, confirmation decisions, interrupting runs, workspace/model/operational settings, onboarding state, backups, and diagnostics export.
- SQLite-backed Electron handlers for backup restore, product tasks, product task steps, artifacts, open loops, proactive messages, and proactive feedback decisions.
- macOS Keychain secret adapter in `packages/secrets` using service `Joi Desktop`, with env fallback and startup env hydration for `MODEL_API_KEY`, `TELEGRAM_BOT_TOKEN`, `WORKER_TOKEN`, `NODE_SECRET`, and `ADMIN_TOKEN`.
- OpenAI-compatible model integration helpers in `packages/runtime`, covering `/chat/completions` ping, `/models` fetch, model-list parsing, and SQLite model registry updates through Electron IPC.
- Telegram getMe/test-message integration in `packages/runtime`, using the Keychain-backed `TELEGRAM_BOT_TOKEN` and SQLite operational settings through Electron IPC.
- Worker Gateway HTTP protocol integration in `packages/runtime`, covering worker register, heartbeat, claim, ack/fail, token rotation, node allowlist, nonce replay protection, disabled-node rejection, SQLite audit logs, and sanitized worker output.
- TS desktop eval runner entrypoint: `pnpm eval:desktop:ts`, using the same `evals/desktop_cases.json` as the Go desktop eval runner.
- Diagnostics export redaction coverage in `packages/store`, verifying secrets, prompt text, raw model output, and tool output are redacted from exported ZIP payloads.
- TS workspace/file capability core in `packages/runtime`, covering `workspace_search`, `file_read`, and `file_analyze` with allowed-root enforcement, symlink escape rejection, UTF-8 bounded reads, extension allowlists, result limits, excerpts, and sensitive-text redaction.
- TS web research capability core in `packages/runtime`, covering read-only HTTP(S) fetches, private-host allowlist policy, metadata-IP blocking, bounded response reads, readable text extraction, link collection, and policy-blocked outputs.
- TS workspace execution capability core in `packages/runtime`, covering allowlisted read-only shell commands, allowlisted test/build commands, and permission-gated workspace patches inside authorized roots.
- TS browser/computer capability core in `packages/runtime`, covering macOS frontmost-window observation, frontmost-browser observation, URL-policy-checked browser navigation, and `danger_full_access`-gated browser click/type interactions without Playwright.
- TS desktop app inventory capability core in `packages/runtime`, covering local `.app` bundle metadata scanning and targeted name/bundle/path inspection without reading app content.
- TS diagnostics capability core in `packages/runtime`, covering TS store-backed system health and lightweight read-only server diagnosis without Docker as a default dependency.
- TS capability tool schema compiler in `packages/runtime`, deriving model-visible tools from the current permission profile so Electron and runtime tests share one capability contract.
- TS tool-calling turn loop core in `packages/runtime`, covering OpenAI-compatible Chat Completions tool calls, streamed SSE delta parsing, JSON argument reconstruction, executor dispatch, tool-result messages, final response extraction, and usage aggregation.
- TS prompt and memory assembly in `packages/store`, injecting confirmed memories into the real Electron tool-calling system prompt and persisting matching `memory_context_packs`, `prompt_assemblies`, prefix/dynamic hashes, and `used_memories` in Run Trace.
- Electron `SendChat` now uses the TS Chat Completions tool-calling loop when an OpenAI-compatible model, base URL, model name, and `MODEL_API_KEY` are configured, then persists the completed turn into SQLite `turns`, `turn_items`, `model_calls`, `tool_runs`, Run Trace steps, and run events.
- Electron `SendChat` now injects the real TS workspace/file/web/exec/browser/computer/desktop-app/diagnostics capability executor for `workspace_search`, `file_analyze`, `file_read`, URL-backed `web_research`, `shell_command`, `test_command`, permission-gated `apply_patch`, `computer_observe`, `browser_observe`, `browser_navigate`, permission-gated `browser_click`/`browser_type`, `desktop_app_list`/`desktop_app_inspect`, `system_health_check`, and `server_diagnose`, and persists the real output into Run Trace `tool_finished` and `tool_runs`.
- Electron real tool-calling now pauses `apply_patch` before execution, records `waiting_confirmation` runs with anchored `confirmation_requests`, marks rejected confirmations as failed runs, resumes approved confirmations by executing the original tool call and appending a final model response, and cancels waiting runs without leaving pending confirmations behind.
- Electron real tool-calling now creates the SQLite run before the model request, emits `run.started` immediately, keeps an active `AbortController` per run, and lets the renderer stop an in-flight request through `InterruptRun`.
- Deterministic preview/eval handlers remain outside the Electron SendChat product fallback; unconfigured real model settings fail fast.

## Remaining Cutover Work

- Keep widening real-chain verification for public release readiness: real model, Telegram, Worker Gateway, diagnostics, backup restore, and long-running daily use.
- Move the shared renderer source out of the historical `apps/joi-desktop/frontend` directory when that no longer risks distracting from runtime parity.

## Current Verification

```bash
pnpm test:electron-contract
pnpm test:secrets
pnpm test:runtime
pnpm test:store
pnpm eval:desktop:ts
pnpm build:electron
./scripts/package_desktop_macos.sh
npm run test:chat-projection --prefix apps/joi-desktop/frontend
npm run test:execution-actions --prefix apps/joi-desktop/frontend
npm run build --prefix apps/joi-desktop/frontend
```

The current package output is `dist/desktop/Joi-0.1.0-rc0-macos-arm64.zip`, with installed app path `/Applications/Joi.app` and source app path `apps/joi-electron/release-desktop/mac-arm64/Joi.app`.

Manual Electron verification should target `/Applications/Joi.app` or the running `Electron` dev runtime, not a static browser preview.
