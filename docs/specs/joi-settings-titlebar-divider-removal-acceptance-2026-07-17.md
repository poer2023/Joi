# Joi Settings Titlebar Divider Removal Acceptance

## Scope

- Project: Joi Desktop at `/Users/hao/project/Joi`.
- Target screen: installed app Settings title bar, especially Models.
- Files likely to change: `apps/joi-desktop/frontend/src/styles.css`.
- User job: read Settings content without a horizontal separator between the title bar and detail surface.

## Reference

- Primary reference: user screenshot `截屏2026-07-17 21.25.15.png`.
- Remove only the full-width 1px line below the Settings title bar.
- Preserve the existing title-bar tabs, selected-tab fill, Settings sidebar, traffic lights, and back/menu controls.

## Visual Rules

- `.settings-window-titlebar` has no bottom border.
- The title bar and Settings content meet without a separator line.
- Title-bar height, background split, spacing, typography, and tab styling do not change.
- Sidebar item borders and content-owned dividers remain unchanged.

## Interaction Rules

- Tab buttons and the tab scroller remain `no-drag`.
- The trailing blank handle and uncovered title-bar space remain draggable.
- Back, menu collapse/expand, and object-tab selection remain usable.

## Verification

- Build the desktop frontend.
- Package and install from clean `main`.
- Verify the installed bundle signature and source-to-`app.asar` hash.
- Inspect the installed Models Settings screen at desktop width and capture an after screenshot.
- Confirm the divider is absent while tabs, controls, and the Settings sidebar remain visible.

## Done Means

- [x] The full-width title-bar divider is absent in `/Applications/Joi.app`.
- [x] No unrelated divider or navigation styling changed.
- [x] Installed-app interaction and packaging checks pass.

## Evidence

- `.settings-window-titlebar` now resolves with `border-bottom: 0`; title-bar height, background split, tabs, controls, and drag-region rules are unchanged.
- Settings completion and ACP model-selection contract tests passed.
- The desktop frontend production build passed.
- `/Applications/Joi.app` was rebuilt and relaunched from the current working tree; its `app.asar` SHA-256 matches the source build candidate.
- Strict codesign verification passed.
- Installed renderer URL: `file:///Applications/Joi.app/Contents/Resources/app.asar/dist/renderer/index.html`.
- Installed screenshot: `/Users/hao/.codex/visualizations/2026/07/17/019f6f9a-c21f-7410-a7f3-f985637738cf/joi-titlebar-divider/02-after-installed.png`.
- Computer Use initially saw only the native window shell while the renderer accessibility tree was starting. Process and system-log probes showed a live renderer with no load failure or crash; the next bounded refresh exposed the full installed Settings UI.
