# Joi Sidebar Footer Removal Acceptance

## Scope

- Project: Joi desktop frontend browser preview.
- Target URL or app screen: `http://127.0.0.1:5173/`, left sidebar bottom footer.
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`.
- User job: remove the marked bottom-left sidebar footer area and the marked status/settings controls.

## Reference

- Marked region 1: bottom sidebar footer band and divider.
- Marked region 2: sidebar status dot and settings gear.

## Information Structure

- Must remove: bottom user footer row, self avatar/name, SQLite status dot, footer settings button, and the footer divider created by that row.
- Must keep: room list, room selection state, top sidebar controls, chat composer, and main header actions.
- Must not add: replacement footer, new settings entry, or new bottom spacing.

## Visual Rules

- The left sidebar should end cleanly after the scrollable room list.
- No `.sidebar-footer` element should exist in the chat sidebar DOM.
- No bottom status dot or footer settings button should be visible.
- Existing settings sidebar footer styles may remain for settings mode; this change targets only the chat sidebar footer.

## Verification

- Browser target: `http://127.0.0.1:5173/`.
- Required DOM checks:
  - `.im-sidebar > .sidebar-footer` is absent.
  - `.im-sidebar .sidebar-status-dot` is absent.
  - `.im-sidebar .footer-settings-button` is absent.
  - `.conversation-list` remains visible.
  - Console has no browser errors after reload.
- Commands:

```bash
pnpm --dir apps/joi-desktop/frontend build
```

## Done Means

- [x] Sidebar footer row is removed.
- [x] Status dot and footer settings button are removed.
- [x] Build passes.
- [x] Browser verification shows no console errors or blank layout.
