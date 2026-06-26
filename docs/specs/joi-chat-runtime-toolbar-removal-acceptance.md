# Joi Chat Runtime Toolbar Removal Acceptance

## Scope

- Project: Joi desktop frontend browser preview.
- Target URL or app screen: `http://127.0.0.1:5173/`, primary chat room screen.
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`.
- User job: remove the fixed runtime toolbar that exposes scope and execution location in the chat surface.

## Reference

- Primary reference: current Tolaria-based desktop UI direction.
- What to copy: compact room identity header, sidebar room list, floating composer, plain transcript surface.
- What not to copy: fixed operational controls for scope, task mode, cross-project routing, or execution node in the main chat chrome.

## Information Structure

- Must keep: room header, sidebar room rows, chat transcript, preview fallback messages, composer controls, settings and observe entry points.
- Must remove: `.chat-statusbar` and its visible copy: `作用域`, `写入当前项目`, `临时任务`, `跨项目`, `执行位置`, `本机`.
- Must not add: replacement banners, helper explanations, extra navigation, or new runtime controls.

## Visual Rules

- Layout density: message area starts directly below the room identity header.
- Spacing: no empty 44px toolbar band remains after removal.
- Typography: no runtime routing labels in the primary chat chrome.
- Color: continue to use Tolaria neutral surfaces and selected sidebar state.
- Borders/shadows: no new separator line introduced between header and transcript.
- Icon/button style: unchanged for existing header and composer controls.

## Interaction Rules

- Required interactions: chat input remains visible and send controls remain usable.
- Hover/focus/active states: existing sidebar and composer states remain unchanged.
- Mobile behavior: no horizontal overflow from toolbar removal.
- Empty/loading/error states: preview fallback still renders when data is unavailable.

## Verification

- Browser target: `http://127.0.0.1:5173/`.
- Viewports:
  - Desktop: current in-app browser viewport.
- Required DOM checks:
  - `.chat-statusbar` count is `0`.
  - Removed labels are absent from the main chat column.
  - `.messenger-chat-header`, `.conversation-chat-item`, and `.composer` remain visible.
  - Header bottom border remains `0px none`.
- Console/network requirements: no browser console errors.
- Commands:

```bash
pnpm --dir apps/joi-desktop/frontend build
```

## Done Means

- [x] Runtime toolbar is removed from rendered DOM.
- [x] Chat header, transcript, sidebar rows, and composer remain visible.
- [x] Build passes.
- [x] Browser verification shows no console errors or blank layout.
