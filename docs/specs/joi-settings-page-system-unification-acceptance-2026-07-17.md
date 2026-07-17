# Joi Settings Page System Unification Acceptance

## Scope

- Project: Joi Desktop at `/Users/hao/project/Joi`.
- Target screen: every object page under the nine Settings categories.
- Visual source of truth: the installed app's `能力与工具 → 能力概览` page.
- User job: move between Settings pages without the title, content column, controls, cards, or density visibly changing design language.
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`, and focused Settings UI tests when needed.

## Reference

- Primary reference: installed `/Applications/Joi.app`, `能力与工具 → 能力概览`, captured at 1199 × 768 on 2026-07-17 21:32.
- Problem references: the four user screenshots from 2026-07-17 21:29 showing inconsistent Automation, Run History, Token Usage, and Log Cleanup layouts.
- Copy from the reference: one shared content origin, compact heading block, 18px page title, 12px supporting copy, 14px vertical rhythm, 8px surfaces, quiet 1px borders, compact controls, and content-owned scrolling.
- Do not copy the capability page's information structure or two-column capability grid into pages whose content needs another structure.

## Information Structure

- Keep all nine Settings categories, all existing object tabs, actions, fields, data, empty/loading/error states, and preload/API contracts.
- Every object page has exactly one page heading region at the same horizontal and vertical origin.
- Page-specific content starts after the same heading gap and uses shared surfaces and controls.
- Do not add new navigation levels, helper panels, dashboard modules, or explanatory copy.
- Do not change feature behavior, data coverage, filters, business windows, or destructive-action confirmation rules.

## Visual Rules

- Content viewport: a single scroll surface with `8px clamp(18px, 3vw, 40px) 34px` inset; no page-specific outer padding.
- Reading column: `max-width: 1040px`, aligned to the left; no full-window stretched cards.
- Header: title 18px/650/1.25; description 12px/1.4 with 4px title gap; no enclosing card or divider.
- Main vertical rhythm: 14px between peer sections; no large page-specific top gaps.
- Section title: consistent 14px/600 treatment and spacing.
- Surfaces: panel background, 1px quiet border, 8px radius, no shadow; nested surfaces must not create a second oversized container around the full page.
- Fields and buttons: 30px minimum height, 6px radius, 12px text; labels use the same 12px semibold secondary style.
- Lists and metrics: 8px gaps; cards use 9–11px internal padding and the same border/radius/background tokens.
- The existing borderless Settings titlebar, titlebar tabs, sidebar, drag/no-drag regions, and selected states remain unchanged.

## Interaction Rules

- Object tabs remain keyboard/click accessible and horizontally scrollable when needed.
- Each page owns its content scroll; changing object tabs returns a coherent page top rather than preserving a misleading mid-page offset.
- Existing hover, focus, active, disabled, loading, empty, error, and destructive action behavior remains available.
- Responsive behavior may collapse grids to one column, but it must preserve the shared content inset and hierarchy.

## Verification

- Source inventory: all objects returned by `getSettingsObjects` are reachable and render through the shared page shell.
- Automated checks: Settings completion/contract tests, frontend production build, Electron contract tests.
- Installed app checks: Models, Automation, all three Run & Usage objects, Data & Memory, Capability Overview, Nodes, Privacy, and Support at minimum; sample both form-heavy and list-heavy pages.
- Visual checks at the installed app's normal desktop size and one narrower desktop width.
- Confirm no renderer crash/load error and no missing Settings object content.
- Confirm `/Applications/Joi.app` signature, provenance, source-to-`app.asar` evidence, and preserved `~/Library/Application Support/Joi`.

## Done Means

- [x] Every Settings object uses the same outer content origin, reading width, heading typography, and vertical rhythm as Capability Overview.
- [x] Automation, Run History, Token Usage, and Log Cleanup no longer use page-specific outer framing or title offsets.
- [x] Shared cards, inputs, selects, buttons, filters, metrics, lists, and empty states use the same tokens.
- [x] No existing Settings object, action, or state has been removed or functionally changed by this settings-design change.
- [x] The production build and focused contracts pass.
- [x] The installed app is rebuilt, signed, opened, and visually checked with evidence.
- [x] Only superseded old app build artifacts are removed after the replacement is verified.

## Evidence

- Focused tests passed: `test:settings-completion`, ACP plugin model selection, and `test:automation-ui-state`.
- Frontend production build and Electron production/package builds passed.
- Installed app: `/Applications/Joi.app`, updated 2026-07-17 21:44:42 Asia/Shanghai.
- Installed `app.asar` SHA-256 matches the source build candidate: `87e95d2bc246f47d654fe1ad880344dddf48cf5d09fb5d9b5776512606bcea2d`.
- Strict installed-app codesign verification passed outside the filesystem sandbox.
- Installed renderer proof: `file:///Applications/Joi.app/Contents/Resources/app.asar/dist/renderer/index.html`.
- Visual evidence directory: `/Users/hao/.codex/visualizations/2026/07/17/019f7044-0b73-7f30-aa1d-6126d5a70a63/joi-settings-unification`.
- Installed screenshots: `10-installed-capability.jpeg` through `14-installed-automation.jpeg`; additional category samples cover Data & Memory, Nodes, Privacy, and Support.
- The replaced app archive `.local/app-archive-20260717-214441` was deleted only after installed-app verification.
- `~/Library/Application Support/Joi` was preserved; no cleanup, save, secret, or security actions were invoked during visual verification.
- Full Electron contract execution reached `test-acp-web-mcp` and stopped at an unrelated concurrent capability inventory drift (`87` actual vs `89` expected) after two retired video capabilities were removed by another in-progress change; this settings-design patch did not modify that runtime or test.
