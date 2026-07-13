# Joi Grok Build / Grok 4.5 UI Acceptance Contract

## Scope

- Project: Joi Desktop installed app
- Screen: Settings > Models > Grok Build
- User job: confirm the active provider strategy and model without exposing credentials
- Files: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/api/desktop.ts`

## Information Structure

- Keep the existing model settings layout and controls.
- Rename only the Grok provider entry to `Grok Build`.
- Show `grok_build`, `https://api.x.ai/v1`, and `grok-4.5` from persisted settings.
- Do not add proxy controls, benchmark controls, or secret values to the UI.

## Visual and Interaction Rules

- Preserve current spacing, typography, colors, borders, and responsive behavior.
- Existing login, model refresh, save, and connection-test interactions remain available.
- Desktop installed-app verification only; no mobile surface exists for this Electron settings screen.

## Verification

- Open `/Applications/Joi.app` with the existing user-data directory.
- Navigate to Settings > Models > Grok Build using Computer Use.
- Capture one installed-app screenshot showing the provider entry and `grok-4.5`.
- Verify persisted settings independently from SQLite and verify no blank window or visible error.

## Done Means

- [x] Installed app renders normally with existing conversations preserved.
- [x] `Grok Build` is visible and selected for persisted `grok_build` settings.
- [x] `grok-4.5` and official xAI base URL are visible.
- [x] No credential value or unrelated new UI is visible.

Evidence: `docs/specs/joi-grok-build-grok45-installed.jpeg` and installed-app AX inspection on 2026-07-10.
