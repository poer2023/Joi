# Logs UI Acceptance

## Scope

- Add a `Logs` tab to the existing right-side Joi Inspector.
- Keep the main chat pane focused on natural conversation and compact execution transcript.
- Add diagnostics cleanup controls under Settings -> Advanced -> Diagnostics.

## Required Behavior

- Logs tab lists recent unified logs from `ListLogs`.
- Filters include text query, level, risk, category, run id, trace delta visibility, and worker heartbeat visibility.
- Default view hides trace streaming delta and worker heartbeat or claim noise.
- Each log row shows time, level, risk, category/source, message, and supports opening folded payload details.
- Cleanup requires `PreviewLogCleanup` before `ClearLogs`.
- Cleanup controls must not imply conversations, memories, settings, or secrets are deleted.

## Verification

- Type and preload contracts must compile through existing Electron/frontend checks.
- Store tests must cover list, detail, cleanup preview, cleanup execution, and secret redaction.
- UI must remain usable at desktop widths where the right inspector is visible and degrade to the existing mobile layout.
