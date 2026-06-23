# Joi Right Inspector Tabs Acceptance

## Scope

- Project: `/Users/hao/project/Joi`
- Target app screen: installed Electron Desktop chat screen with the right panel expanded.
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`
- User job: keep one unified right inspector that can switch between Terminal and Memory from the right-panel topbar, and let the expanded right inspector be resized wider by dragging.

## Reference

- Primary reference: current Codex/Hermes-style compact right inspector behavior: narrow right rail, topbar tabs, low visual noise.
- Secondary references: existing Joi chat shell, existing run trace and memory feedback UI.
- What to copy: tabbed inspector structure, compact typography, no marketing copy, and topbar blank-space drag behavior.
- What not to copy: exposing all memory categories by default, nested card stacks, double-layer segmented tab cards, extra onboarding/helper explanations.

## Information Structure

- Must keep: Terminal and Memory as the two topbar tabs, used memories, confirmed memories, pending memory feedback, and the right-side resize affordance.
- Must remove: default right-side page that starts with "Joi 对你的理解" and fills the rail with memory sections.
- Must not add: unrelated settings, new model controls, extra product education text.

## Visual Rules

- Layout density: compact and scan-friendly.
- Spacing: 8-12px internal gaps; no oversized sections.
- Typography: small section labels and 13-14px body text inside the rail.
- Color: reuse Joi surface tokens, neutral low-contrast rail, no new dominant palette.
- Borders/shadows: 1px subtle borders where needed, radius 8px or less, no nested floating cards and no tab card inside another tab card.
- Icon/button style: reuse existing small buttons only where they perform visible actions.

## Interaction Rules

- Required interactions: right panel toggle still works; Terminal and Memory tabs switch in-place from the topbar; tabs have no numeric badges and are only as wide as their labels; dragging the right panel's left edge changes its width; topbar blank space drags the window while tabs/buttons remain clickable.
- Hover/focus/active states: active tab is clear; buttons keep existing hover affordance.
- Mobile behavior: existing auto-collapse behavior remains the source of truth.
- Empty/loading/error states: empty Terminal and Memory tabs show compact empty states.

## Verification

- Browser target: installed app or local Electron renderer after build.
- Viewports:
  - Desktop: expanded app window.
  - Mobile: not required for installed macOS MVP, but narrow width must still auto-collapse.
- Required screenshots: final installed app with right panel expanded and both tabs checked when possible.
- Required DOM checks: "Terminal" and "Memory" tab buttons exist; right rail no longer starts with the standalone memory wall; right resize separator exists.
- Console/network requirements: no renderer build or preload contract errors.
- Commands:

```bash
pnpm --filter @joi/electron build
pnpm test:electron-contract
/usr/bin/codesign --verify --deep --strict --verbose=2 /Applications/Joi.app
```

## Done Means

- [ ] The UI matches the accepted information structure.
- [ ] The expanded right inspector can be resized by dragging its left edge beyond the old narrow cap.
- [ ] No forbidden helper copy, extra modules, or unrelated features were added.
- [ ] Desktop visual state was checked against the installed app.
- [ ] Console/build errors and preload contract failures were checked.
- [ ] Verification artifacts are linked in the final response.
