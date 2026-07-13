# UI Acceptance Contract

## Scope

- Project: Joi desktop frontend preview
- Target URL or app screen: `http://127.0.0.1:5173/`, right inspector overview member list
- Files likely to change: `apps/joi-desktop/frontend/src/styles.css`
- User job: fix border and content spacing in the joined-member list

## Reference

- Primary reference: user browser comment selecting `.overview-member-list`
- What to copy: keep the current avatar, name, description, and status layout
- What not to copy: do not add new member data, extra labels, or another container card

## Layout Constraints

- The member list must render as one stable bordered group with rounded outer corners.
- Each member row must have clear horizontal and vertical padding between the row border and its contents.
- Adjacent member rows should use a single internal divider, not doubled borders.
- Avatar, text stack, and status badge must be vertically centered and must not touch row borders.
- The selected/browser outline should reveal visible breathing room inside the group.

## Verification

- Browser target: `http://127.0.0.1:5173/`
- Required DOM checks: list has at least 8px content inset; each row has at least 8px horizontal and 7px vertical internal padding; no row content touches row/group border
- Console/network requirements: no console errors from the edited surface
- Commands: `pnpm --dir apps/joi-desktop/frontend build`

## Done Means

- [x] Member list has a stable outer border and rounded corners.
- [x] Member row content has correct horizontal and vertical padding.
- [x] Rows are separated by a single internal divider.
- [x] Avatar/text/status remain vertically centered without clipping.
- [x] Build and browser verification pass.
