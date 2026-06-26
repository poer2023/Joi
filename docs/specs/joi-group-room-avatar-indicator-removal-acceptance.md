# Joi Group Room Avatar Indicator Removal Acceptance

## Scope

- Project: Joi desktop frontend browser preview.
- Target URL or app screen: `http://127.0.0.1:5173/`, private hub and group room avatars in the chat header and left sidebar.
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`.
- User job: remove the status/indicator dot from the group chat avatar.

## Visual Rules

- Private hub avatar (`私人总群`) must not render the small bottom-right indicator dot.
- Shared/external group room avatars must not render the small bottom-right indicator dot.
- Project DM avatars may keep the project-persona indicator dot.
- No sidebar footer, settings-page, composer, or right-inspector layout changes.

## Verification

- Browser target: `http://127.0.0.1:5173/`.
- Required DOM checks:
  - `.room-avatar-private_hub i` is absent in the sidebar.
  - `.messenger-chat-identity .room-avatar-private_hub i` is absent in the header.
  - The private hub avatar itself remains visible in both locations.
  - Console has no browser errors after reload.
- Commands:

```bash
pnpm --dir apps/joi-desktop/frontend build
```

## Done Means

- [x] Private hub/group avatar indicator dot is removed.
- [x] Avatar label and sizing remain intact.
- [x] Build passes.
- [x] Browser verification shows no console errors or blank layout.
