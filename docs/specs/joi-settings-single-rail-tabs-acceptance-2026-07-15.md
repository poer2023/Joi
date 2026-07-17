# Joi Settings Single-Rail Tabs Acceptance

## Scope

- Project: Joi Desktop settings.
- Target app screen: `/Applications/Joi.app` Settings pages and matching canonical renderer preview.
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`.
- User job: Move quickly between a Settings category and its objects without paying for two permanent vertical menus.

## Reference

- Primary reference: user clarification on 2026-07-15 asking to remove or narrow the second-level menu, place it in the content area, or use horizontal tabs.
- Current-state evidence: `docs/specs/joi-settings-single-rail-tabs-before-2026-07-15.jpeg`.
- Preserve: the progressive behavior where selecting a secondary object collapses the primary category rail.
- Do not preserve: the permanent vertical secondary-object column.

## Information Structure

- Keep one primary category rail on the left while expanded.
- Move secondary objects into a single horizontal tab row at the top of the right content area.
- Keep the active secondary object and its detail content unchanged.
- Keep Automations' purpose-built full-width console unchanged; do not add a redundant tab row there.
- Do not add breadcrumbs, helper copy, cards, icons, or another navigation layer.

## Visual Rules

- Expanded primary rail: fixed `160px`, without a resize handle in Settings.
- Secondary tabs: one row, content-width buttons, horizontally scrollable when needed, never wrapping into a second row.
- Active tab: existing selected background treatment; inactive tabs remain quiet text buttons.
- Right detail panel starts below the tab row and uses the reclaimed width.
- Existing 36px draggable titlebar row and button-only `no-drag` hit map remain unchanged.

## Interaction Rules

- Selecting a primary category keeps the rail open and replaces the tab set in the content area.
- Selecting a secondary tab updates the detail and automatically collapses the primary rail.
- The expand control restores only the primary rail; it must not recreate a vertical secondary column.
- Return, collapse, expand, keyboard focus, and blank-titlebar dragging remain functional.
- Horizontal overflow is available by trackpad/mouse wheel and does not scroll the detail panel.

## Verification

- Browser target: local renderer preview.
- Viewports:
  - Desktop: `1280x820`.
  - Narrow desktop: `900x720`.
  - Mobile: not applicable; Joi Desktop enforces a desktop minimum window size.
- Required screenshots:
  - Expanded 160px primary rail with secondary horizontal tabs.
  - Collapsed primary rail after selecting a secondary tab.
  - Freshly relaunched installed app.
- Required DOM checks:
  - `.settings-console` has one column and two rows.
  - `.settings-object-tabs` is horizontal, single-line, and `overflow-x: auto`.
  - No `.settings-object-column` vertical sidebar remains.
  - Settings shell sidebar resolves to `160px` expanded and `0px` collapsed.
  - Titlebar blank region resolves to `drag`; top buttons resolve to `no-drag`.
- Console/network requirements: no new console errors; existing local-data failures, if any, must be reported rather than hidden.
- Commands:

```bash
pnpm --filter @joi/desktop-frontend build
JOI_ALLOW_NON_MAIN_INSTALL=1 /bin/bash scripts/package_desktop_macos.sh
codesign --verify --deep --strict --verbose=2 /Applications/Joi.app
```

## Done Means

- [x] There is no permanent vertical secondary menu.
- [x] The expanded primary rail is 160px and secondary tabs live in the content area.
- [x] Selecting a secondary tab collapses the primary rail and preserves the active detail.
- [x] Return/menu buttons and blank-titlebar drag still work with physical pointer input.
- [x] Browser and installed-app screenshots are captured and linked.
- [x] No user data or unrelated source changes are removed.

## Evidence

- Browser at `1280x720`: the Settings shell resolved to `160px 1120px`; `.settings-console` resolved to one `1120px` column and rows `46px 638px`; `.settings-object-tabs` resolved to `overflow-x: auto`; the tab list resolved to `display: flex` and `flex-wrap: nowrap`; `.settings-object-column` count was `0`.
- Browser interaction: selecting `OpenAI` changed the shell to `0px 1280px`, kept the horizontal tab row at full width, selected the `OpenAI` detail, and exposed the primary-menu expand control. Selecting `记忆搜索` repeated the same progressive collapse. Browser console contained no errors.
- Browser screenshots: `docs/specs/joi-settings-single-rail-tabs-expanded-preview-2026-07-15.png` and `docs/specs/joi-settings-single-rail-tabs-collapsed-preview-2026-07-15.png`.
- Installed app at `1280x820`: a physical pointer click on the visible `OpenAI` tab selected it and removed the primary rail while preserving the full tab row and matching detail.
- Installed app controls: physical clicks passed for expand at `(115, 22)`, collapse at `(123, 22)`, and return at `(86, 20)` after the rail width changed.
- Installed app at `900x720`: the primary rail remained 160px; tabs remained one line and overflowed horizontally instead of recreating a vertical column or wrapping. Selecting the rightmost `自定义兼容` tab kept it reachable, selected its detail, and collapsed the primary rail.
- Installed titlebar: a native blank-titlebar drag moved the 900px-wide Joi window from `(320, 66)` to `(420, 106)` and did not select text.
- Installed screenshots: `docs/specs/joi-settings-single-rail-tabs-installed-900px-2026-07-15.jpeg`, `docs/specs/joi-settings-single-rail-tabs-installed-collapsed-2026-07-15.jpeg`, and `docs/specs/joi-settings-single-rail-tabs-installed-900px-collapsed-2026-07-15.jpeg`.
- Synthetic horizontal-scroll injection could not target the non-semantic overflow parent, so that tooling gesture is not claimed. Installed visual overflow, CSS `overflow-x: auto`, single-line layout, and offscreen-tab reachability were verified independently.
- Builds: canonical renderer emitted `index-MSWKC_qm.css` / `index-DVRD3ZZh.js`; worktree renderer emitted `index-aOpXmgFM.css` / `index-CeHo9XPN.js`.
- Installed renderer: `/Applications/Joi.app` contains `dist/renderer/assets/index-BRfsrNNH.css` and `dist/renderer/assets/index-B_qSmRdd.js`; the bundle includes `.settings-object-tabs`, the horizontal overflow rules, and `tablist` semantics.
- Installed integrity: strict codesign verification passed; the freshly relaunched installed process is PID `44326`; `~/Library/Application Support/Joi/joi.db` remains present. The package archive created for this replacement was removed after verification, while the three pre-existing 2026-07-14 archives were preserved.
