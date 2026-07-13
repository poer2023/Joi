# Sidebar Remove Room Archive UI Acceptance

## Scope

- Project: Joi desktop frontend preview
- Target URL: `http://127.0.0.1:5173/`
- Surface: left Messenger room list

## Reference

- User selected the hover `归档` button on a project DM row.
- Required change: remove this row-level archive action from Messenger rooms.

## Constraints

- Project DM rows must not render a visible `归档` button.
- Row layout must keep the same hover/active styling after the action is removed.
- Legacy/archive management surfaces outside the Messenger room list are out of scope.

## Done Means

- [x] Project DM row no longer shows `归档`.
- [x] No `.messenger-room-wrap .conversation-row-actions` actions remain for room rows.
- [x] Sidebar row has no horizontal overflow.
- [x] `pnpm --dir apps/joi-desktop/frontend build` passes.
- [x] Browser preview verifies the button is gone and console has no errors.
