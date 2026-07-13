# UI Acceptance Contract

## Scope

- Project: Joi desktop frontend preview
- Target URL or app screen: `http://127.0.0.1:5173/`, right inspector overview room profile
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`
- User job: simplify room profile editing and make avatar upload direct

## Reference

- Primary reference: user browser comments on avatar label/input, avatar preview, and group name input
- What to copy: keep the compact overview layout and same room avatar placement
- What not to copy: no separate avatar text input and no explicit save button

## Information Structure

- Must keep: group avatar preview, group name field, metrics, member list
- Must remove: avatar label/input, visible save button
- Must not add: explanatory helper copy or new settings panel

## Interaction Rules

- Required interactions: clicking avatar opens image upload; uploaded avatar saves through room profile API; group name enters edit mode only from the icon; blur saves
- Hover/focus/active states: avatar and edit icon use existing Tolaria hover/focus behavior
- Empty/loading/error states: disabled while room is unavailable or saving

## Verification

- Browser target: `http://127.0.0.1:5173/`
- Required DOM checks: no avatar text input/label, no visible save button, file input accepts `image/*`, group name has an edit button
- Console/network requirements: no console errors from the edited surface
- Commands: `pnpm --dir apps/joi-desktop/frontend build`

## Done Means

- [x] Avatar text field is removed.
- [x] Avatar upload affordance is attached to the avatar.
- [x] Group name edit icon gates edit mode and blur-save behavior.
- [x] Build and browser verification pass.
