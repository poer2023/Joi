# Joi Settings Titlebar Drag Acceptance

## Scope

- Project: Joi Desktop settings surface.
- Target: installed `/Applications/Joi.app` and the matching canonical renderer source.
- User job: Drag the window from blank space in the Settings top bar without losing access to the back or menu toggle controls.
- Files changed: `apps/joi-desktop/frontend/src/App.tsx` and `apps/joi-desktop/frontend/src/styles.css`.

## Reference

- Primary reference: User report on 2026-07-15 that the Settings top bar can no longer grab and drag the window.
- Reproduction: Computer Use drag from `(600, 18)` to `(720, 78)` selected Settings detail text instead of moving the installed Joi window.
- Reopened regression: after the first drag fix, accessibility activation could trigger the top controls but a real coordinate click on `返回对话` or the menu toggle did nothing because the draggable surface still overlapped their physical hit area.
- Existing contract to preserve: `joi-settings-top-controls-hit-testing-acceptance.md`.

## Information Structure

- Must keep: Primary/secondary Settings navigation, automatic primary-menu collapse, selected object, and all detail content.
- Must not add: A visible title bar, helper copy, new controls, or spacing beyond the existing native-titlebar safe area.
- Required hit map: the native titlebar is a separate 36px layout row; only actual button rectangles are `no-drag`, while the remaining row is draggable.

## Visual Rules

- Keep the current transparent native titlebar appearance.
- The drag row is limited to the existing 36px top-bar safe area and occupies its own grid row above Settings content.
- The native traffic-light controls and the two Settings buttons remain explicit `no-drag` hit targets; the gap between Settings buttons and all other blank titlebar space remain draggable.

## Interaction Rules

- Blank Settings top-bar space drags the native Electron window.
- Dragging the top bar does not select Settings text.
- `返回对话` and `展开/折叠设置菜单` remain single-clickable and keyboard-accessible.
- Selecting a secondary Settings object still collapses the primary menu.

## Verification

- Browser DOM checks:
  - Settings titlebar is the first 36px grid row and resolves to `drag`.
  - Settings controls are children of that titlebar; each button resolves to `no-drag` while the controls gap resolves to `drag`.
  - Settings sidebar and console occupy the second grid row and resolve to `no-drag`.
- Installed-app checks:
  - Use a real coordinate click at the visible center of return, collapse, and expand controls; accessibility activation alone is insufficient.
  - Use a native mouse drag from blank titlebar space and verify the real Joi window position changes without selecting text.
- Build/package checks:
  - Frontend build passes.
  - Electron package installs to `/Applications/Joi.app`.
  - Installed bundle passes strict codesign verification and contains the drag-region CSS.

## Done Means

- [x] Settings top-bar blank space drags the freshly relaunched installed app.
- [x] Return, collapse, and expand controls work with physical pointer clicks.
- [x] Progressive Settings menu behavior remains intact.
- [x] No Settings content or user data changed.

## Evidence (initial drag fix)

The control evidence below used accessibility activation and is superseded for physical hit testing by the regression-closure evidence that follows.

- Pre-fix installed-app reproduction: the `(600, 18)` to `(720, 78)` gesture selected `Codex ACP使用本机 Codex 登录...` instead of grabbing the window.
- Failure-layer probe: both overlay attempts were present in the freshly installed `app.asar`, but the full-page `no-drag` Settings console still removed the overlapping drag region. The final structure reserves the existing top 36px as a real drag row and starts the `no-drag` console below it.
- Browser preview: Settings stage was `drag` at y=0; Settings console was `no-drag` at y=36; expanded Settings sidebar was `drag` at y=0 and its `no-drag` menu began at y=46. Secondary selection collapsed the primary menu, the expand button reopened it, and the console error log was empty.
- Installed app: after a fresh relaunch, a native mouse drag across the Settings top row moved the Joi window from `(320, 66)` to `(400, 106)` and the accessibility state reported no selected text.
- Installed controls: expand, collapse, and return-to-chat each worked with one click. Reopening Settings and selecting `Codex ACP` collapsed the primary menu while preserving the active secondary item.
- Builds: canonical and worktree frontend builds passed. Packaging installed renderer asset `dist/renderer/assets/index-BMQqwKjY.css` into `/Applications/Joi.app/Contents/Resources/app.asar`.
- Integrity: `/usr/bin/codesign --verify --deep --strict --verbose=2 /Applications/Joi.app` passed.
- Visual proof: `docs/specs/joi-settings-titlebar-drag-installed-2026-07-15.jpeg`.

## 2026-07-15 Pointer Regression Closure

- Root cause: the first acceptance pass treated accessibility activation as equivalent to a real mouse hit. The callbacks existed, but the Electron drag region still intercepted physical pointer input over the controls.
- Structure: Settings now reserves a dedicated 36px grid row for the draggable titlebar; Settings content begins in row 2. Return and menu-toggle buttons are direct `no-drag` descendants, while the titlebar wrapper and the 6px gap between the expanded controls remain `drag`.
- Browser hit map: titlebar `top=0`, `height=36`, `width=1280`, `app-region=drag`; return button `left=166`, `top=8`, `30x30`, `no-drag`; collapse button `left=202`, `top=8`, `30x30`, `no-drag`; controls wrapper `left=166`, `width=66`, `drag`. Sidebar and workspace begin at `top=36` and are `no-drag`.
- Installed physical clicks: return passed at local coordinate `(170, 21)`; collapse passed at `(204, 22)`; expand passed at `(115, 22)`. These were coordinate clicks against the freshly relaunched `/Applications/Joi.app`, not accessibility activation.
- Installed native drag: with the Joi window at `(320, 66)`, a native mouse drag from blank titlebar screen coordinate `(920, 84)` to `(1000, 124)` moved the window to `(400, 106)`, exactly `(+80, +40)`. The accessibility state contained no selected text after the drag.
- Progressive navigation: a physical click on secondary item `Codex ACP` at `(280, 59)` automatically collapsed the primary menu and preserved `Codex ACP` as the active object.
- Builds: canonical frontend emitted `index-ChJdw43M.css` / `index-BReNlW6O.js`; worktree frontend emitted `index-BchU9JCn.css` / `index-BIo-MR77.js`.
- Installed renderer: `/Applications/Joi.app` contains `dist/renderer/assets/index-lR77-MnJ.css` and `dist/renderer/assets/index-DMBQwnYR.js`; strict codesign verification passed.
- Current visual proof: `docs/specs/joi-settings-titlebar-hit-map-installed-2026-07-15.jpeg`.
