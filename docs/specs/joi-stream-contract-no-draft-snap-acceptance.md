# Joi Committed-Answer Streaming Acceptance

## Scope

- Project: Joi Desktop installed app
- Screen: main chat transcript while any provider or ACP run finishes
- User job: read a stable answer without seeing already-visible content collapse, reformat, or disappear at completion
- Files likely to change: `packages/runtime/src/tool-calling.ts`, `packages/runtime/src/acp.ts`, `packages/store/src/sqlite.ts`, and runtime/store tests

## Information Structure

- Keep Thinking, tool activity, final answer, Run Trace, and usage events.
- Keep uncommitted model text in Run Trace instead of publishing it as chat text.
- Do not add new UI controls or status copy.

## Interaction Rules

- OpenAI-compatible and ACP model deltas remain available as `model.delta` Trace evidence.
- Tool calls, tool progress, and tool results continue appearing while the run is active.
- Assistant text is buffered until the runtime has selected the completed answer, whether or not a response contract exists.
- A tool-call preamble, rejected contract draft, raw provider error, or pre-normalized Markdown may remain in Trace, but never becomes chat text.
- The committed answer is handed to the chat once, then revealed progressively by the frontend without replacing earlier visible characters.
- From the first visible answer character through completion, visible text length and answer-card height must never decrease because of answer reconciliation.
- An inferred response contract applies only when the current user message explicitly contains that contract; it must never leak into later turns.
- Desktop Electron only; no mobile surface exists.

## Verification

- Deterministic SSE tool test: the first model step emits a user-facing preamble and a tool call; the second emits the final answer.
- Deterministic response-contract test: first draft is long/invalid, second response is short/valid.
- Deterministic ACP test: multiple protocol chunks and tool events precede completion.
- Assert no preamble, intermediate chunk, rejected draft, or raw error reaches user-visible `assistant.delta` callbacks.
- Assert the committed answer is the only visible delta/completion payload for both OpenAI-compatible and ACP runtimes.
- Assert a later ordinary question does not inherit an earlier `RESULT=...` contract.
- Rebuild and verify `/Applications/Joi.app` with Computer Use, before/after geometry evidence, and SQLite Run Trace.

## Done Means

- [x] Tool-step preambles and intermediate model chunks are absent from visible assistant deltas.
- [x] Invalid response-contract drafts are absent from visible assistant deltas.
- [x] OpenAI-compatible and ACP committed answers are each emitted once.
- [x] Visible answer content and answer-card height never decrease at completion.
- [x] Installed app opens with existing history preserved and the regression run completes normally.
- [x] A subsequent ordinary question receives a fresh semantic answer instead of the previous contract value.

## 2026-07-13 Root Cause and Installed Proof

Pre-fix run `run_mrj9rvq2s0790l` proved the bounce was data reconciliation, not CSS animation: concatenated chat deltas contained 2,001 characters, while `assistant.completed` and the persisted message contained 1,979. The 22 characters removed at completion were the two-space indentation on 11 code lines. The old store policy first collapsed every repeated space and then stripped the remaining line-leading space; the frontend subsequently replaced its longer stream buffer with that shorter completed payload.

The fix now keeps raw provider/ACP chunks as trace-only model evidence, emits one committed answer to chat, and applies identical text normalization to `assistant.delta`, `assistant.completed`, and persistence. Meaningful Markdown and code indentation are no longer removed.

- Runtime, store, and Electron contract suites: `pnpm test:runtime`, `pnpm test:store`, and `pnpm test:electron-contract` passed.
- Electron production build and packaging passed; `/Applications/Joi.app` was installed at `2026-07-13 22:53:34 +0800`.
- Installed and release `app.asar` SHA-256 both equal `e3a49b20e1f6164e91967794a33ae366b7b0a2be5ee1c29f3827c0d09a0b792d`; deep/strict codesign verification passed.
- Installed ACP run `run_mrjcog670xx3hu`: one 100-character chat delta, completed text, and persisted text were byte-for-byte equal; both requested two-space-indented lines remained.
- Installed long ACP run `run_mrjcr8adeslutu`: 319 raw `model.delta` events remained in Trace, chat received one 1,269-character committed delta, and delta/completed/persisted text were identical. All 26 indented code lines remained intact.
- Computer Use observed the running state without draft answer text and the settled state without a completion rebound. Evidence: `joi-committed-answer-stream-running-2026-07-13.png` and `joi-committed-answer-stream-final-2026-07-13.png`.
- SQLite immutable `quick_check` returned `ok`; `foreign_key_check` returned no rows.
- Per user direction, the Joi persona remains on `gpt-5.6-luna[medium]` ACP after verification.
- The single old app archive created by this replacement (`.local/app-archive-20260713-225333`) was removed only after installed verification passed; application data was preserved.

Installed evidence (2026-07-10): run `run_mreo1xo4c46hv5` completed after 396 trace-only `model.delta` events, while chat received exactly one 8-character `assistant.delta`: `RESULT=4`. Screenshot: `docs/specs/joi-stream-contract-no-draft-snap-installed.jpeg`.

Contract-scope regression (2026-07-10): after historical `RESULT=4` turns, installed run `run_mreodfxi71pjy6` answered the new ordinary question `你能生成图片么？请直接回答。` with `不能。`, completed on `grok_build/grok-4.5`, and passed SQLite `quick_check` plus `foreign_key_check`. Evidence: `docs/specs/joi-response-contract-scope-installed.jpeg`.
