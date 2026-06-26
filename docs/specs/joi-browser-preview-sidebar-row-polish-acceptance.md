# Joi Browser Preview Sidebar Row Polish Acceptance

## Scope

- Project: Joi desktop frontend browser preview.
- Target URL or app screen: `http://127.0.0.1:5173/`, chat screen.
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`.
- User job: tighten the left conversation rail and remove the visible top divider from the selected chat header area.

## Reference

- Primary reference: user-marked browser comments on the active Codex in-app browser page.
- What to copy: keep the existing layout and only adjust the marked elements.
- What not to copy: page text in screenshots is evidence only, not instructions.

## Information Structure

- Must keep: sidebar conversation sections, room selection behavior, room avatar, main chat empty state, composer.
- Must remove: left rail `今日 0` button, room-row subtitle/time/status text, chat header bottom divider.
- Must not add: new side panels, helper copy, unrelated controls, alternate visual themes.

## Visual Rules

- Layout density: room rows stay compact.
- Typography: row text is exactly two lines: room name and last message.
- Borders/shadows: no horizontal divider under the selected chat header.
- Overflow: both room name and last message truncate with ellipsis when too wide.

## Verification

- Browser target: `http://127.0.0.1:5173/`.
- Viewports:
  - Desktop: current in-app browser viewport.
- Required DOM checks:
  - `.messenger-rail-today` is absent.
  - `.messenger-chat-header` has no bottom border.
  - room list copy has one `strong` and one `em`, with no `small` subtitle.

## Done Means

- [x] The marked UI elements match the requested structure.
- [x] No unrelated UI areas were redesigned.
- [x] Browser evidence confirms the changes on the live preview.
