# Joi Room Avatar Size Acceptance

## Scope

- Project: Joi desktop frontend browser preview.
- Target URL or app screen: `http://127.0.0.1:5173/`, chat header room avatar and sidebar room-list avatar.
- Files likely to change: `apps/joi-desktop/frontend/src/styles.css`.
- User job: apply annotated avatar sizing without widening the change to unrelated avatars.

## Reference

- Header room avatar annotation: `24px` to `40px`.
- Sidebar room avatar annotation: `24px` to `32px`, then `32px` to `34px` on the same element.
- Conflict rule: later annotation wins for the same sidebar element, so sidebar room avatars use `34px`.

## Visual Rules

- Header `.messenger-chat-identity .room-avatar` is `40px` square.
- Sidebar `.messenger-room-item .room-avatar` is `34px` square.
- Sidebar row grid reserves the same `34px` avatar column.
- Base `.room-avatar` remains unchanged for other contexts.
- No breakpoint-specific behavior is required; the annotated elements live in fixed-density shell regions.

## Verification

- Browser target: `http://127.0.0.1:5173/`.
- Required DOM checks:
  - Header avatar computed width and height are `40px`.
  - Sidebar selected room avatar computed width and height are `34px`.
  - Sidebar room grid first column is `34px`.
  - Console has no browser errors after reload.
- Commands:

```bash
pnpm --dir apps/joi-desktop/frontend build
```

## Done Means

- [x] Header avatar is `40px`.
- [x] Sidebar room avatar is `34px`.
- [x] Build passes.
- [x] Browser verification shows no console errors or blank layout.
