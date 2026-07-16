# Joi Run Record Truth Acceptance Contract

## Scope

- Project: `/Users/hao/project/Joi`
- Target: `/Applications/Joi.app` → 运行与用量 → 运行记录
- User job: distinguish normal activity, in-progress work, degraded/partial results, and genuine failures without reading raw JSON.
- Files likely to change: log mapping/filtering in the store, run-record rendering in the desktop frontend, task verification semantics, and focused regression tests.

## Reference

- Primary reference: installed Joi 0.1.1 screenshot captured on 2026-07-15 around 02:13 UTC.
- Preserve: current navigation, filters, refresh/export actions, compact card layout, and Run Trace data.
- Remove: false red failure copy on empty error objects and routine IPC lifecycle noise from the default view.
- Do not add: new settings sections, destructive cleanup, source-specific scraping bypasses, or unrelated UI redesign.

## Information Structure

- Default view must show useful normal, warning, degraded, and failed activity.
- Routine `electron_ipc` debug `started`/`succeeded` events remain queryable by selecting the debug level, but are hidden by default.
- A red failure summary/banner requires a non-empty structured error, an error/fatal level, or a failed/error/fatal/blocked/denied status.
- A handled optional tool failure may complete the product task with warnings when the final response explicitly discloses the limitation; unacknowledged failures still block completion.

## Interaction Rules

- Refresh must not manufacture visible failures.
- Selecting `调试` must surface routine IPC lifecycle records.
- Existing search, risk, type, run-only, and export interactions must continue to work.
- No production records are deleted during verification.

## Verification

- Store regression: empty errors map to `undefined`; real errors remain present; default logs omit routine IPC debug; explicit debug returns them.
- Task regression: acknowledged read-only web extraction failure completes with warnings; unacknowledged or state-changing tool failure remains blocked.
- Frontend regression: normal/running rows do not render failure copy; genuine failed rows do.
- Installed-app checks: bundle contains the fixed predicates, codesign passes, default list is visually clean, debug filter remains usable, and `~/Library/Application Support/Joi` is preserved.

## Done Means

- [x] Empty `{}` no longer marks normal records as failures.
- [x] Real failures remain visually distinct.
- [x] Routine IPC lifecycle noise is hidden by default and recoverable through the debug filter.
- [x] Partial read-only source failures have coherent task/automation semantics.
- [x] Focused tests, Electron build/package, and installed-app visual verification pass.

## Evidence

- Installed default view: `/Users/hao/.codex/visualizations/2026/07/15/019f638d-1fa0-7732-9baf-b40e550f49eb/joi-observability-default-final.png`
- Installed debug filter: `/Users/hao/.codex/visualizations/2026/07/15/019f638d-1fa0-7732-9baf-b40e550f49eb/joi-observability-debug-installed-fixed.png`
- Installed error filter: `/Users/hao/.codex/visualizations/2026/07/15/019f638d-1fa0-7732-9baf-b40e550f49eb/joi-observability-error-installed-fixed.png`
- Installed app: `/Applications/Joi.app`, modified `2026-07-15 12:57:15 +0800`, deep strict codesign verification passed.
- User database inode remained `149176276`; SQLite quick check passed before and after install, and no production records were deleted.
