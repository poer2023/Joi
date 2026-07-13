# UI Acceptance Contract

## Scope

- Project: Joi desktop frontend preview
- Target URL or app screen: `http://127.0.0.1:5173/`, right inspector overview
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`, desktop API/store bindings
- User job: edit and inspect group profile from overview

## Reference

- Primary reference: user browser comment selecting the overview panel
- What to copy: keep the dense inspector style and make group name/avatar/member status directly available
- What not to copy: do not restore the removed standalone `成员` tab

## Information Structure

- Must keep: overview tab, run metrics, export action, member detail drill-in
- Must remove: no separate member category tab
- Must not add: marketing copy, unrelated room management modules, extra navigation

## Interaction Rules

- Required interactions: edit group name, edit avatar value, save changes, view all joined members, open member detail
- Hover/focus/active states: controls use existing Tolaria hover/focus treatment
- Empty/loading/error states: disable save when no room or unchanged; retain current empty checkpoint behavior

## Verification

- Browser target: `http://127.0.0.1:5173/`
- Viewports: current desktop browser viewport
- Required DOM checks: no `成员` tab, overview has `群名` and `头像` controls, member rows expose activity badges
- Console/network requirements: no console errors from the edited surface
- Commands: `pnpm --dir apps/joi-desktop/frontend build`

## Done Means

- [x] Overview supports viewing and editing group name/avatar.
- [x] Overview lists all joined members visible in the room snapshot.
- [x] Member rows show current active state and still open detail pages.
- [x] Browser verification confirms the right inspector behavior.
