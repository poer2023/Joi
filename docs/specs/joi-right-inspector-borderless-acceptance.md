# Joi Right Inspector Borderless Acceptance

## Scope

- Project: Joi desktop frontend browser preview.
- Target URL or app screen: `http://127.0.0.1:5173/`, right inspector panel.
- Files likely to change: `apps/joi-desktop/frontend/src/styles.css`.
- User job: remove the border/divider from the right inspector header and remove the card border from the overview tabpanel.

## Reference

- Primary reference: current Tolaria-based Joi browser preview.
- What to copy: quiet inspector sidebar, tab controls as lightweight inline controls, content as unframed inspector body.
- What not to copy: framed cards around the whole tabpanel, header separator lines, nested card shells for the inspector frame.

## Information Structure

- Must keep: right inspector tabs, overview metrics, export button, preview checkpoint copy.
- Must remove: `.right-inspector-header` bottom divider and card-like border around `#right-inspector-overview`.
- Must not add: new controls, new layout sections, extra spacing, or additional explanatory copy.

## Visual Rules

- Layout density: unchanged.
- Spacing: inspector header and overview content keep the same compact rhythm.
- Typography: unchanged.
- Color: remain on Tolaria white inspector surface.
- Borders/shadows: no header divider; no outer overview card border or shadow.
- Icon/button style: unchanged.

## Verification

- Browser target: `http://127.0.0.1:5173/`.
- Viewports:
  - Desktop: current in-app browser viewport.
- Required DOM checks:
  - `.right-inspector-header` computed bottom border is `0px none`.
  - `#right-inspector-overview` computed border widths are `0px`.
  - Right inspector tabs, overview metrics, export button, and checkpoint copy remain visible.
- Console/network requirements: no browser console errors.
- Commands:

```bash
pnpm --dir apps/joi-desktop/frontend build
```

## Done Means

- [x] Header border/divider is removed.
- [x] Overview tabpanel card border is removed.
- [x] Build passes.
- [x] Browser verification shows no console errors or blank layout.
