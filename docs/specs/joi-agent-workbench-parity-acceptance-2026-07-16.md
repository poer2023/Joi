# Joi Agent Workbench Parity Acceptance — 2026-07-16

## Objective

Turn the existing Joi Desktop runtime into a complete, locally verifiable agent workbench across the eight requested domains: in-run message control, session tree/compaction, MCP/extensions, browser control, model routing, developer tooling, voice/video productization, and Alma-style personal-assistant closure. A registered name, disabled card, mock result, or `not_configured` response does not count as implementation.

## Gate 0 — Baseline and contract

- Real repo: `/Users/hao/project/Joi`; installed target: `/Applications/Joi.app`.
- Preserve `~/Library/Application Support/Joi` and all existing conversations, runs, memories, tasks, plugins, and settings.
- Baseline screenshots:
  - `docs/specs/evidence/joi-agent-workbench-parity-2026-07-16/baseline/chat.jpeg`
  - `docs/specs/evidence/joi-agent-workbench-parity-2026-07-16/baseline/settings-model.jpeg`
  - `docs/specs/evidence/joi-agent-workbench-parity-2026-07-16/baseline/settings-capabilities.jpeg`
- Current truth: session branch/compaction, one bounded child agent, TTS/STT, image/video generation, basic browser tools, three LSP reads, and a basic LLDB session already have real installed-app evidence. This work extends those backends instead of replacing them.

## Gate 1 — Runtime and developer workbench

| Area | Required real behavior | Required proof |
| --- | --- | --- |
| In-run messages | Persist separate steering and follow-up queues. Steering is injected after the active tool batch without aborting the run; follow-up is injected as the next prompt only after the current model turn settles. Users can inspect and remove pending items. | Runtime/store tests and installed runs proving steering and follow-up are delivered under the original visible run ID, plus a real cancellation terminal trace. |
| Session tree | Return parent/child branches as a navigable tree; switch branches without mutation; create a branch from a selected message; persist branch labels and summaries; auto-compact above a configurable threshold; export/import JSONL without losing the original transcript. | Store round-trip test, prompt-assembly test, UI tree interaction, exported file, re-imported independent conversation. |
| MCP runtime | Keep stdio MCP processes under a managed runtime, perform initialize/list/call, execute wrapped tools through the normal policy/runtime/Run Trace path, and support Streamable HTTP/SSE where configured. | Fixture MCP server invoked from an installed Joi model run with matching input, output, duration, error and trace rows. |
| Extensions | Load trusted local plugin entrypoints, register/unregister tools and commands at runtime, reload after file change or explicit refresh, and expose only schema-validated tools through the capability compiler. | Fixture extension hot reload changes a callable tool result without rebuilding Joi; disabled/uninstalled extension becomes unavailable. |
| Browser | Provide managed tabs plus navigate/back/forward/reload, click/type/press/scroll/upload, screenshot/DOM/images, console/dialog/network inspection, bounded JavaScript evaluation, and controlled CDP. | Local fixture page exercises every operation; console/network/dialog/upload outcomes are asserted and visible in Run Trace. |
| Model routing | Persist per-agent default/fallback/cheap models and a routing policy for quality, cost and latency. Allow a delegated child to override model/reasoning. Retry an eligible model failure on the configured fallback while recording every attempt. | Deterministic router tests plus one installed child run with an explicit model and one forced fallback trace. |
| Developer tools | Add LSP hover, workspace symbols, document symbols, rename, format and code actions; support available C/C++, Swift, TypeScript/JavaScript, Python and Rust servers. Add real code execution/sandbox runs. Extend LLDB with PID attach, threads, frames, stack, locals, watch expressions/watchpoints and conditional breakpoints. | Language fixtures, debugger fixture and installed tool calls with normalized results and clean process disposal. |

## Gate 2 — Media and personal assistant

| Area | Required real behavior | Required proof |
| --- | --- | --- |
| Voice | Record microphone audio from the composer, show recording duration, stop/cancel safely, persist the recording as an attachment, transcribe it locally, and optionally speak assistant replies with selected system voice/rate. | Installed UI recording, playable artifact, transcription assertion, permission/error state and TTS playback. |
| Video/vision | Inspect image/video metadata, extract bounded representative frames and audio, transcribe speech, and return a model-ready analysis package. Support image-to-video/extend/edit only when the configured backend advertises it; otherwise show an explicit unsupported operation rather than fake success. | Real MP4 fixture with frame/contact-sheet/audio transcript evidence and an installed analysis call. |
| Activity memory | Opt-in local activity capture with explicit start/stop, bounded screenshot cadence, local OCR, application/title metadata, retention controls, search, and daily/weekly summaries. It is off by default. | Start/stop capture, OCR fixture hit, search result, retention cleanup preview and summary artifact. |
| Calendar | List calendars/events and create a draft event through macOS EventKit. Final creation remains a reviewed state change. | Read test and installed draft/create flow with a dedicated test calendar where available. |
| Channels | Add Discord webhook/bot and Feishu webhook/app configuration, connection tests, outbound delivery trace, and room-connector mapping while retaining Telegram/iMessage. | Local mocked HTTP delivery tests; live delivery only when credentials already exist and the user explicitly requests it. |
| Plan graph | Persist task dependencies, claims, submissions, review gates, feedback and resolution. Render dependency/review state inside the existing task/inspector surface. | Store state-machine tests and an installed plan with blocked, submitted, needs-changes and passed nodes. |
| Artifacts | Preview Markdown, text, image, audio, video, HTML, JSON, CSV and PDF artifacts in the existing right inspector, with safe local-file boundaries and an explicit open action. | Fixture artifact gallery and installed visual evidence; unsupported formats remain downloadable/openable without raw-payload walls. |

## UI Acceptance Contract

### Scope

- Target screens: main conversation, conversation header/session tree, composer, right inspector, Settings → Model, Chat Entrances, Data & Memory, Capabilities & Tools, and Nodes & Execution.
- Likely files: frontend `App.tsx`, focused feature components/styles, desktop API/types, Electron IPC/runtime modules and SQLite store/schema.
- User job: control a long-running task without losing it, navigate conversation history, connect real tools/providers, debug software, speak/listen, and operate a local personal-assistant workflow from one coherent desktop surface.

### Information structure

- Keep the existing left conversation rail at the same width and gray background, the single central transcript, the optional right inspector, and the existing Settings left menu with horizontal tabs.
- Put session tree access in the conversation header/right inspector, not in a second navigation rail.
- Put steering/follow-up mode and pending messages next to the composer; do not replace the transcript with a task console.
- Put MCP/extensions and browser/developer controls under existing Capabilities & Tools tabs.
- Put per-agent routing under the existing Model page.
- Put activity, calendar, plan/review and artifact controls under existing Data & Memory/Chat Entrances/Run surfaces.
- Remove disabled placeholder cards once their backend is implemented; remaining genuinely unsupported items must be labeled as unavailable with a reason.
- Do not add provider marketing, fake success counters, raw JSON as the primary UI, or a second settings sidebar.

### Visual rules

- Match the current compact macOS density, typography, neutral colors, 8–12 px control spacing, subtle 1 px borders and existing rounded controls.
- Reuse the shared `ScrollArea`; native scrollbars must not appear inside tool results, session trees or artifact previews.
- New status colors are semantic and restrained: running blue, waiting amber, success green, failed red, neutral queued gray.
- Controls need visible hover, focus, pressed and disabled states without layout movement.

### Interaction rules

- Sending while a run is active defaults to steering; a nearby mode selector chooses follow-up. Neither action silently aborts the current run.
- Pending queue items are visible, removable and survive renderer reload.
- Session-tree expansion and horizontal settings tabs never collapse the left rail automatically.
- Microphone, calendar creation, external channel delivery and write-capable MCP/browser/developer actions surface the existing confirmation/error semantics.
- Empty, loading, permission-denied, backend-missing, disconnected, partial and failed states are all explicit.

### Viewports and visual proof

- Desktop: 1280×820.
- Narrow desktop: 900×720; no mobile-only layout is required for this Electron app.
- Required final screenshots: conversation with queued messages, session tree, MCP/extension tab, model-routing tab, browser/developer tools, voice recording, activity/calendar/plan/artifact surfaces.
- Required checks: no uncaught renderer errors; keyboard focus works; left rail stays visible unless manually collapsed; top drag regions exclude buttons; installed-app screenshots come from `/Applications/Joi.app`.

## Non-goals and boundaries

- No global master model or model-owned orchestration.
- No direct model-to-shell/MCP/browser execution outside the capability runtime and Run Trace.
- No deletion of current user data, no weakening of the irreversible-command blacklist, and no automatic transmission of personal activity/calendar data.
- No live Discord/Feishu message, real calendar event, or external upload without the existing user review/confirmation boundary.
- Product-specific Alma branding, emotion simulation, soul files and music generation are not required for the requested personal-assistant closure.

## Final verification — 2026-07-16

- Installed artifact: `/Applications/Joi.app`; package: `dist/desktop/Joi-0.1.1-macos-arm64.zip`; deep/strict code-signature verification passed.
- User data remained in `~/Library/Application Support/Joi`; the existing SQLite database was reused rather than replaced.
- Full automated suites passed after the final runtime implementation: runtime, store, Electron contract, frontend type/build, and chat projection regression tests.
- Real MCP fixture covered initialize, pagination, tools/resources/prompts, invocation, stdio, Streamable HTTP/SSE, timeout and reconnect. Plugin-manager tests covered discovery, activation, reload, disable and schema-controlled capability exposure.
- Real browser harness covered isolated session/tabs, navigation, DOM observation, click/type/press/scroll, upload, screenshot + Vision, console, network, CDP evaluation and popup handling. The installed app separately opened and controlled `https://example.com`.
- Real developer fixtures covered clangd diagnostics/definition/references/hover/symbols/code actions/rename/format, LLDB attach/breakpoint/threads/stack/locals/evaluate/memory/watchpoint/step/stop, and JS/TS/Python/Swift/macOS-sandbox execution.
- Real media proof includes local macOS TTS, local Whisper transcription, FFmpeg/ffprobe keyframes/contact sheet/Vision OCR and a live xAI MP4 generation.
- Real assistant proof includes installed start/capture/stop activity flow with a persisted screenshot/OCR record, EventKit draft boundary, evidence-backed plan/review state, and local channel/runtime tests. No external message or calendar event was published during acceptance.
- Installed steering run `run_mrmis4gzbcj2uk` delivered `rqm_mrmisifvo4b2b6` and returned `RUN_QUEUE_READY STEER_OK` without replacing the Run.
- Installed follow-up run `run_mrmj1mtvvcrcom` delivered `rqm_mrmj273jqavui7` and returned `FIRST_DONE FOLLOW_UP_DONE` under the same Run after the first turn settled.
- Installed cancellation run `run_mrmj516bmfbhzf` ended as `cancelled` with `run.cancel_requested`, `run.cancelled` and `run.interrupted`; the composer then returned to the normal send state.
- Queue lifecycle events remain in Run Trace but no longer render a stale pending transcript row after delivery. The composer remounts across idle/steering/follow-up modes so visual and macOS accessibility placeholders stay aligned.
- Closing the main window kept the Electron process alive; reopening `/Applications/Joi.app` restored the window and current conversation from the installed bundle.
- Machine-readable and visual evidence is under `docs/specs/evidence/joi-agent-workbench-parity-2026-07-16/`.

## Done means

- [x] Every requested area has a real backend and schema-validated capability/API surface.
- [x] Focused deterministic tests cover success, partial, cancellation, timeout and backend-missing behavior.
- [x] The full existing runtime/store/Electron/frontend suites still pass.
- [x] `/Applications/Joi.app` is freshly rebuilt, installed, deep-strict codesign verified and relaunched after a full exit.
- [x] Installed-app model/tool calls and visible UI plus real-runtime fixtures prove every row above.
- [x] Existing `~/Library/Application Support/Joi` data is preserved.
