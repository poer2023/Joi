# Joi Stale Processing Timer Acceptance Contract

## Scope

- Project: `/Users/hao/project/Joi`
- Target app: `/Applications/Joi.app` → `Joi` desktop conversation
- User job: trust that a process card stops immediately when its run completes, fails, or is cancelled, and never shows another conversation's run.
- Files likely to change: chat run-event normalization/projection, process-stack rendering, `App.tsx` conversation scoping, and focused frontend regressions.

## Reference

- Primary reference: installed-app state captured on 2026-07-16 with two cards still increasing past `466m` after one run was cancelled and another had completed.
- Preserve: the current compact process card, disclosure interactions, tool summaries, assistant messages, conversation navigation, and Run Trace access.
- Do not add: new panels, settings, destructive cleanup, database rewrites, or unrelated visual redesign.

## Information Structure

- A terminal run outcome is authoritative over stale child events that still say `running`.
- Cancelled runs render as cancelled, not as actively processing or as a fabricated multi-item failure.
- A completed run renders as completed even if late automation or model events retain historical `running` statuses.
- Messages and process cards from another `conversation_id` must never appear in the selected conversation.
- Adjacent transcript lines from different run IDs must not be merged into one process stack.

## Interaction Rules

- Live runs keep a ticking duration.
- Completed, failed, cancelled, redirected, blocked, and skipped runs use a fixed duration; missing terminal timestamps must never fall back to the current clock.
- Expanding and collapsing process cards continues to work.
- Switching conversations cannot inherit the previous conversation's active run, streaming assistant, pending message, trace, or duration.

## Verification

- Focused projection/render tests cover terminal-over-running precedence, fixed terminal duration, run-boundary grouping, and foreign-conversation rejection.
- Existing frontend tests and production build pass.
- Installed bundle contains the changed projection/render logic and passes deep strict codesign verification.
- Installed UI no longer contains `正在处理` or a growing hundreds-of-minutes duration for the reproduced cancelled run, and the foreign daily-report assistant message is absent from `conv_joi_dm`.
- `~/Library/Application Support/Joi` remains preserved; no production records are deleted or rewritten.

## Done Means

- [x] Cancelled run `run_mrmj516bmfbhzf` displays a fixed duration near its real 20-second lifetime.
- [x] Completed run `run_mrmsyammj7318m` cannot appear inside `conv_joi_dm`.
- [x] No terminal process card continues ticking.
- [x] Process stacks never span multiple run IDs.
- [x] Focused tests, build/package, installed-bundle proof, codesign, and installed visual verification pass.

## Final Evidence

- Live SQLite truth: `run_mrmj516bmfbhzf` is `cancelled`, started at `2026-07-15 20:25:36`, finished at `20:25:56`, and has `duration_ms=20229`; `run_mrmsyammj7318m` belongs to `conv_mrmsyammtn4haq`, not `conv_joi_dm`.
- Tests: chat projection, execution-action projection, single-agent workspace, frontend TypeScript/Vite build, and the full Electron contract suite passed.
- Installed app: `/Applications/Joi.app`, modified `2026-07-16 12:29:52 +0800`; fresh main/renderer processes started at `12:30:08`.
- Installed and release `app.asar` SHA-256: `40d9db4f4284c02407ec1251373501403cea00b4fd49d7b4e6499174f7c81661`; deep/strict codesign passed.
- Installed screenshot: `/Users/hao/.codex/visualizations/2026/07/16/019f6920-0a56-76c2-82a7-382bc593207c/joi-stale-processing-fixed-installed.jpeg`.
- Data preservation: database inode remained `149176276`; SQLite `quick_check` returned `ok`, foreign-key check returned no rows, and no production record was deleted or rewritten by this repair.
- Cleanup: only the two app archives superseded during this repair (`app-archive-20260716-122653` and `app-archive-20260716-122952`) were removed after the final installed version passed verification.
