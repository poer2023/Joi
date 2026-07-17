# Joi Advanced Agent Capabilities Acceptance — 2026-07-16

## Scope

- Project: `/Users/hao/project/Joi`
- Installed target: `/Applications/Joi.app`
- Screens: existing Desktop chat transcript, tool execution disclosure, and Run Trace inspector
- User job: let Joi perform session branching/compaction, bounded child-agent work, speech/TTS, and native LSP/debugger operations through real tool backends.

## References

- Codex: session resume/fork/compact, multi-agent/tool trace, skills/plugins, native development workflow.
- Pi: session tree/fork/compact/export, extension-first tools, persistent interactive execution.
- Alma: task delegation, plan/todo flow, Whisper/TTS/media settings, file/shell/MCP tool trace.
- Copy: capability boundaries, structured results, independent child state, progressive disclosure, and truthful trace status.
- Do not copy: product-specific branding, global-master-agent semantics, fake success, or opaque raw JSON as the primary UI.

## Information Structure

- Keep the existing single-agent chat layout and existing right-side inspector.
- Represent every new operation as an ordinary capability run with input, output, duration, status, and artifact links.
- Do not add a second navigation rail, a separate developer console, provider marketing, or unrelated settings.

## Capability Contract

| Area | Required real behavior | Required proof |
| --- | --- | --- |
| Session branch | Create a new independent Joi conversation from a chosen source conversation/message while preserving parent provenance; later messages must not mutate the source. | Store test plus installed-app call returning distinct source/child IDs and copied-message count. |
| Session compact | Produce and persist a bounded summary/checkpoint for a real conversation, with covered message range and token/character reduction metadata; original transcript remains recoverable. | Store/runtime test plus installed-app call showing persisted compaction and reduced context size. |
| Child Agent | Code Orchestrator creates a bounded child job with its own agent/run/context, executes it through an existing configured model runtime, and returns child status/result/trace to the parent. No global master model. | Deterministic runtime test plus installed-app parent call and separate child run/tool trace. |
| Speech transcription | Transcribe a real audio file through an available local or configured speech backend and return text plus backend/artifact metadata. | Generated speech fixture, transcription assertion, and installed-app tool call. |
| Text to speech | Render supplied text into a real audio file and expose a playable artifact without claiming delivery. | File signature/duration check and installed-app artifact link. |
| LSP | Start/use a real language server for diagnostics, definition, and references against workspace files; return normalized locations/diagnostics. | Fixture project with expected diagnostic/definition/reference results and installed-app calls. |
| Debugger | Start a real LLDB/native debug session, set/run at least one breakpoint or equivalent stop, read structured output/status, then terminate cleanly. | Compiled fixture, debugger transcript/status assertions, and installed-app call sequence. |

## Interaction Rules

- Tool execution summaries use concise Chinese verbs: 分支会话、压缩会话、委派子任务、转写语音、生成语音、查询代码、调试程序.
- Running, success, partial, cancelled, and failure states remain visible; one failed child/tool does not relabel an otherwise successful parent run as entirely failed.
- Destructive host commands remain blocked even under `danger_full_access`.
- Empty, missing-backend, timeout, invalid-path, and unsupported-language states return explicit errors and never simulated output.

## Visual Rules

- Preserve current transcript width, typography, neutral colors, disclosure controls, and unified hidden-scrollbar component.
- New media artifacts use the existing attachment/artifact presentation; no oversized cards or raw payload wall.

## Verification Matrix

- Automated: runtime compiler tests, store tests, Electron contract tests, focused frontend projection/action tests, and dedicated backend fixtures.
- Installed app: launch `/Applications/Joi.app` fresh, invoke every capability through the model/tool bridge, inspect SQLite `runs`/`tool_runs`, verify artifacts on disk, and capture Computer Use screenshots.
- Bundle: verify timestamp, source-to-`app.asar` inclusion, and `codesign --verify --deep --strict`.
- Data safety: preserve `~/Library/Application Support/Joi`; branching and compaction are additive.

## Done Means

- [x] Every row in the capability contract has a real backend and deterministic automated proof.
- [x] Every row is called from the freshly installed app and has matching Run Trace evidence.
- [x] Audio artifacts pass format/duration inspection.
- [x] Session and child-agent provenance can be queried from SQLite.
- [x] Existing chat, settings, window lifecycle, and previous 43-tool acceptance remain passing.
- [x] Screenshots and a machine-readable comparison report are saved under `docs/specs/evidence/joi-advanced-agent-capabilities-2026-07-16/`.

## Installed-App Result

The final installed bundle was built at `2026-07-15T17:55:59Z`, installed at `/Applications/Joi.app`, passed deep strict code-sign verification, and was relaunched after a full process exit. The existing `~/Library/Application Support/Joi` data directory was preserved.

| Area | Installed proof |
| --- | --- |
| Session branch | `run_mrmdgjl2f3f390` created `conv_mrmdgu2xzgxh7h` with 3 copied messages; the source later grew to 20 messages while the branch remained at 3. |
| Session compact | `compact_mrmdhqkwum8dik` covered 3 messages, retained the transcript, and reduced the bounded context from 690 to 502 characters; later prompt assemblies contain the persistent checkpoint. |
| Child Agent | Natural delegation created child `run_mrmdj4615ery5r`; the final friendly-name retry used `Research Agent` once and resolved directly to `research_agent` in `run_mrmduntjc8q1b3`. |
| Speech | `run_mrmdvgkq75ub1o` generated a 4.505-second WAV, transcribed the full sentence exactly, and persisted an `audio` message attachment plus `art_mrmdvywpxctnoi`. |
| LSP | `run_mrmdqvhn7hrynm` used native `clangd` for a real definition and the `missing_native_symbol` diagnostic. |
| Debugger | `run_mrmdrr8sg1voh2` used LLDB to break in `twice`, evaluate `value=21`, step, and dispose the session. |

Machine-readable proof: `docs/specs/evidence/joi-advanced-agent-capabilities-2026-07-16/installed-app/installed-app-comparison-report.json`.
