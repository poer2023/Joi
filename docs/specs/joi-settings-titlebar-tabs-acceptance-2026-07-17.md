# Joi Settings Titlebar Tabs Acceptance

## Scope

- Project: Joi Desktop settings surface in the active `2596` worktree.
- Target app screen: every Settings category that already exposes horizontal object tabs.
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`, and `apps/joi-electron/src/main/index.ts`.
- User job: switch Settings objects from the native top bar while retaining a reliable blank area for dragging the Electron window.

## Reference

- Primary reference: user screenshot `截屏2026-07-17 14.27.41.png` and clarification that “顶栏” means the physical topmost bar containing the macOS traffic lights and Settings controls.
- Rejected first interpretation: moving the tabs into the renderer's first 36px row still left them below the native titlebar because `titleBarStyle: 'hiddenInset'` preserved a content offset in the installed app.
- Existing interaction contract to preserve: `joi-settings-titlebar-drag-acceptance-2026-07-15.md`.
- Existing navigation contract to preserve: `joi-settings-single-rail-tabs-acceptance-2026-07-15.md`.

## Information Structure

- Keep the primary Settings category rail unchanged.
- Move the existing secondary object tab strip from the Settings content grid into the 36px Settings title bar.
- Keep the selected object, detail content, and routes unchanged.
- Preserve the current primary-rail state when switching object tabs in the title bar; only the primary menu and its explicit expand/collapse control may change that state.
- Keep Automations' purpose-built console unchanged; it has no existing horizontal object-tab strip to move.
- Do not add breadcrumbs, helper copy, icons, tab reordering, or another navigation layer.

## Visual Rules

- The renderer uses a full-size Electron content view, and the title bar remains one 36px row physically shared with the macOS traffic lights.
- Object tabs remain one line, compact, and horizontally scrollable when they exceed available width.
- The active tab keeps the existing selected background treatment.
- Tabs start after the native traffic lights and Settings controls, whether the primary rail is expanded or collapsed.
- Preserve a visible blank drag handle at the trailing edge of the title bar.
- There must be no blank native-titlebar row above the horizontal tabs.

## Interaction Rules

- Every tab button and its scroll viewport resolves to `-webkit-app-region: no-drag`.
- A click, keyboard activation, or horizontal scroll inside the tab strip only affects tab navigation; it never starts a native window drag.
- Switching a title-bar tab never changes `sidebarPreference`: an expanded Settings menu stays expanded, and a collapsed menu stays collapsed.
- Pointer movement that starts on a tab does not move the window.
- The explicit trailing blank handle and other uncovered title-bar space resolve to `-webkit-app-region: drag` and move the native window.
- Return, explicit primary-menu expand/collapse, and selected-object persistence remain functional.

## Verification

- Browser/preview DOM checks at `1280x820` and `900x720`:
  - `.settings-window-titlebar > .settings-titlebar-tabs` exists for non-Automations categories.
  - `.settings-console > .settings-object-tabs` no longer exists.
  - `.settings-titlebar-tabs .settings-object-tabs` is one-line, horizontally scrollable, and `no-drag`.
  - `.settings-titlebar-drag-handle` is at least 64px wide and resolves to `drag`.
  - Tab buttons resolve to `no-drag`; return/menu buttons remain `no-drag`.
- Installed-app pointer checks:
  - Confirm tab centers and traffic-light centers share the same physical 36px top row.
  - Confirm the Settings detail begins immediately below that row, with no second tab bar or native-titlebar spacer.
  - Click at the visible center of at least two object tabs.
  - With the primary Settings menu expanded, click at least two title-bar tabs and confirm the menu remains expanded.
  - With the primary Settings menu collapsed, click a title-bar tab and confirm the menu remains collapsed.
  - Drag beginning on a tab and confirm the window does not move.
  - Drag beginning on the trailing blank handle and confirm the window does move.
  - Click return, collapse, and expand with real pointer coordinates.
- Build/package checks:

```bash
pnpm --filter @joi/desktop-frontend build
JOI_ALLOW_NON_MAIN_INSTALL=1 /bin/bash scripts/package_desktop_macos.sh
codesign --verify --deep --strict --verbose=2 /Applications/Joi.app
```

## Done Means

- [x] Every existing Settings horizontal object-tab strip shares the physical topmost row with the macOS traffic lights.
- [x] There is no duplicate object-tab row in Settings content.
- [x] Tab click, keyboard focus, and horizontal overflow remain usable.
- [x] Title-bar tab switching preserves the current primary-menu state.
- [ ] Tab-origin drags do not move the window; blank-handle drags do. Preview hit-map evidence passes, but current Computer Use cannot move even Joi's pre-existing draggable chat header, so installed native movement remains tooling-blocked.
- [x] Return/menu controls and progressive Settings navigation still work.
- [x] Preview and freshly installed app evidence are captured.
- [x] No unrelated source or user data is removed.

## Evidence

- Frontend build passed and emitted `index-CJNZygxt.css` / `index-DLLg9siN.js`.
- Settings completion and ACP model-selection contract tests passed.
- Preview at `1280x820`: title bar is `1280x36` and `drag`; the ten-tab strip is `737px`, `overflow-x: auto`, `nowrap`, and `no-drag`; each tested button is `no-drag`; the trailing handle is `277px` and `drag`; content-owned tab rows count is zero.
- Preview at `900x720`: the tab strip overflows (`scrollWidth=737`, `clientWidth=570`) while preserving a `64px` `drag` handle. Selecting the rightmost `自定义兼容` tab scrolls it into view and collapses the primary rail.
- All nine primary categories were opened. Every category with an existing object-tab strip rendered it under `.settings-window-titlebar`; Automations retained its purpose-built console without adding a redundant strip.
- Preview console errors: none.
- Preview screenshots: `joi-settings-titlebar-tabs-preview-1280x820-2026-07-17.png` and `joi-settings-titlebar-tabs-preview-900x720-2026-07-17.png`.
- The first installed build exposed the interpretation bug from the user's screenshot: the DOM titlebar was `top: 0`, but `hiddenInset` placed that renderer row beneath the native traffic-light row. Its screenshot is superseded and was removed.
- Corrected installed `/Applications/Joi.app` uses `titleBarStyle: 'hidden'`, was rebuilt from this worktree, relaunched, and passed strict codesign verification. `app.asar` contains both the full-size window configuration and the titlebar-tab/drag-handle markers.
- Corrected installed screenshot shows the traffic lights, Settings controls, and horizontal object tabs centered in the same topmost row; Settings detail begins immediately below it with no second tab row.
- Installed pointer clicks selected the top-row `Codex ACP` tab. Physical-coordinate expand, collapse, and return clicks passed at `y=18` in that same row.
- Corrected interaction regression: the shared object-selection function accepts `preserveSidebar`, and title-bar tabs explicitly enable it. In the freshly installed app, selecting `Codex ACP` while the Settings menu was expanded kept all nine primary categories visible; after explicitly collapsing the menu, selecting `OpenAI` kept it collapsed and retained the `展开设置菜单` control.
- Sidebar-state installed screenshot: `joi-settings-titlebar-tabs-preserve-sidebar-installed-2026-07-17.jpeg`.
- Installed tab-origin drag left the selected tab and UI unchanged. CoreGraphics measured the main Joi window at `(320,66) 1280x820` before and after.
- Installed blank-handle movement could not be certified: Computer Use also left the known draggable chat header at `(320,66)`, classifying the remaining failure as tooling rather than product state. Bundle-identifier fallback was ambiguous because several archived/build Joi bundles share `com.hao.joi.desktop`; the exact `/Applications/Joi.app` path was already the active target.
- Corrected installed screenshot: `joi-settings-native-titlebar-tabs-installed-2026-07-17.png`.
- Joi user data was preserved. The two replaced App archives from this task are retained until native drag is manually or tool-independently confirmed.
