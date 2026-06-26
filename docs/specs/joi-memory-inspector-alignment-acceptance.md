# Joi Memory Inspector Alignment Acceptance

## Scope

- Project: Joi desktop frontend browser preview.
- Target URL or app screen: `http://127.0.0.1:5173/`, right inspector `记忆` tab.
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`.
- User job: align the memory inspector tab with the other right-inspector pages in position, typography, and spacing.

## Reference

- Primary reference: right inspector overview/run/thread/assets tabs in the current Tolaria-based preview.
- What to copy: same top padding, same section title scale, same compact body text scale, same unframed inspector body rhythm.
- What not to copy: legacy `Memory` eyebrow, duplicate large `记忆` title, extra 12px margin/card offset.

## Information Structure

- Must keep: memory tab, used-memory section, suggested-memory section, list actions.
- Must remove: legacy header block and extra margin that make this tab visually misaligned.
- Must not add: new copy, new controls, or new panels.

## Visual Rules

- Layout density: memory tab starts at the same x/y rhythm as overview.
- Spacing: no extra outer margin beyond shared right-panel section padding.
- Typography: section headings use the same 14px inspector heading style.
- Color: unchanged.
- Borders/shadows: follows the borderless right-panel section style.
- Icon/button style: unchanged.

## Verification

- Browser target: `http://127.0.0.1:5173/`.
- Viewports:
  - Desktop: current in-app browser viewport.
- Required DOM checks:
  - `#right-inspector-memory` has no extra outer margin.
  - `#right-inspector-memory > header` is absent.
  - Memory tab headings use the same font size/weight as other `.right-panel-section h3`.
  - Memory tab remains visible and contains both memory sections.
- Console/network requirements: no browser console errors.
- Commands:

```bash
pnpm --dir apps/joi-desktop/frontend build
```

## Done Means

- [x] Memory tab position aligns with other right-inspector pages.
- [x] Memory tab typography aligns with other right-inspector pages.
- [x] Build passes.
- [x] Browser verification shows no console errors or blank layout.
