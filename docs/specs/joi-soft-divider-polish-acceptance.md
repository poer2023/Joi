# Joi Soft Divider Polish Acceptance

## Scope

- Project: Joi desktop frontend browser preview.
- Target URL or app screen: `http://127.0.0.1:5173/`, chat screen with sidebar and optional right inspector.
- Files likely to change: `apps/joi-desktop/frontend/src/styles.css`.
- User job: remove the hard divider between the left sidebar and editor, and soften the divider between the editor and right inspector.

## Reference

- Primary reference: current Tolaria-based Joi browser preview.
- What to copy: neutral surfaces, background separation, quiet inspector boundary.
- What not to copy: hard editor-divider rails or extra visible handles.

## Information Structure

- Must keep: sidebar, chat transcript, floating composer, right inspector and its resize behavior.
- Must remove: visible hard line between left sidebar and main editor.
- Must soften: visible line between main editor and right inspector.
- Must not add: new spacing, new controls, new panels, or layout reflow.

## Visual Rules

- Layout density: unchanged.
- Spacing: sidebar width and right inspector width remain unchanged.
- Typography: unchanged.
- Color: left boundary should read as surface change only; right boundary should be lower contrast than Tolaria default border.
- Borders/shadows: no dark/strong divider on the left; right panel divider uses a very light border/handle.
- Icon/button style: unchanged.

## Verification

- Browser target: `http://127.0.0.1:5173/`.
- Viewports:
  - Desktop: current in-app browser viewport.
- Required DOM checks:
  - `.app__sidebar` computed right border is `0px none`.
  - `.sidebar-resizer::before` background is transparent.
  - `.companion-right-panel` remains visible when inspector is open.
  - `.companion-right-panel` left border is lighter than the default Tolaria border.
  - `.right-panel-resizer::before` background is lighter than the previous strong border.
- Console/network requirements: no browser console errors.
- Commands:

```bash
pnpm --dir apps/joi-desktop/frontend build
```

## Done Means

- [x] Left sidebar hard divider is removed.
- [x] Right inspector divider is visually softer.
- [x] Build passes.
- [x] Browser verification shows no console errors or blank layout.
