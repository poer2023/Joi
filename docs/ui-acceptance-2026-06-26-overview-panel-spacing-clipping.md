# UI Acceptance Contract

## Scope

- Project: Joi desktop frontend preview
- Target URL or app screen: `http://127.0.0.1:5173/`, right inspector overview panel
- Files likely to change: `apps/joi-desktop/frontend/src/styles.css`
- User job: fix clipping and incorrect spacing in the overview panel

## Reference

- Primary reference: user browser comment selecting the overview panel region
- What to copy: keep the current overview information and inline room/profile editing controls
- What not to copy: do not add new cards, helper text, or unrelated redesign

## Layout Constraints

- The overview panel must have stable inner gutters on both left and right edges.
- Interactive controls, member rows, metric grid, export button, and checkpoint cards must not extend outside the visible right panel.
- The edit icon must remain fully visible inside the name input.
- Member rows and checkpoint cards must preserve their border radius without being clipped by the panel edge.

## Verification

- Browser target: `http://127.0.0.1:5173/`
- Required DOM checks: every direct overview surface stays inside the right panel with at least 10px right gutter
- Console/network requirements: no console errors from the edited surface
- Commands: `pnpm --dir apps/joi-desktop/frontend build`

## Done Means

- [x] Overview content has stable left/right gutters.
- [x] No overview child surface overflows or clips at the right edge.
- [x] Edit icon, member rows, export button, and checkpoint card are fully visible.
- [x] Build and browser verification pass.
