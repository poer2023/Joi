# UI Acceptance Contract

## Scope

- Project: Joi desktop frontend preview
- Target URL or app screen: `http://127.0.0.1:5173/`, right inspector overview member list
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`
- User job: make member rows read as avatar, name, description, status

## Reference

- Primary reference: user browser comment selecting the joined-member list
- What to copy: keep the current dense inspector list shape
- What not to copy: do not keep role text mixed into the description line when it is the member status

## Information Structure

- Must keep: overview member list and click-through member detail
- Must remove: old two-line `name + type/role/status` row structure
- Must not add: extra member management actions or another member tab

## Verification

- Browser target: `http://127.0.0.1:5173/`
- Required DOM checks: each member row has avatar, name, description, and status badge; logged-in user row shows Owner status
- Console/network requirements: no console errors from the edited surface
- Commands: `pnpm --dir apps/joi-desktop/frontend build`

## Done Means

- [x] Member rows render avatar, name, description, and status.
- [x] Logged-in user row is shown as Owner.
- [x] Build and browser verification pass.
