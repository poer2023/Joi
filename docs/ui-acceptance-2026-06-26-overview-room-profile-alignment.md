# UI Acceptance Contract

## Scope

- Project: Joi desktop frontend preview
- Target URL or app screen: `http://127.0.0.1:5173/`, right inspector overview room profile
- Files likely to change: `apps/joi-desktop/frontend/src/styles.css`
- User job: fix misalignment in the room profile editor

## Reference

- Primary reference: user browser comment selecting the overview room profile region
- What to copy: keep the current avatar upload and inline edit interaction
- What not to copy: do not move controls into a new panel or add helper text

## Information Structure

- Must keep: avatar upload button, group name input, edit icon, metrics below
- Must remove: vertical mismatch between avatar and group name input row
- Must not add: visible save button or avatar text field

## Verification

- Browser target: `http://127.0.0.1:5173/`
- Required DOM checks: avatar visual and group name input share the same top y-coordinate and 30px height
- Console/network requirements: no console errors from the edited surface
- Commands: `pnpm --dir apps/joi-desktop/frontend build`

## Done Means

- [x] Avatar and input are aligned on the same row.
- [x] Edit icon remains inside the input without overflow.
- [x] Build and browser verification pass.
