# Joi Collapsed Header Safe Area Acceptance — 2026-07-17

## Reference and scope

- Primary reference: user screenshot `截屏2026-07-17 15.25.10.png`.
- Surface: the chat header when the primary sidebar is collapsed outside Settings.
- Problem: the avatar starts at `16px`, underneath the macOS traffic lights, while the sidebar-expand control remains at `108px`.
- Change only the collapsed chat-header geometry. Expanded chat layout, Settings titlebar tabs, conversation content, and inspector layout remain unchanged.

## Locked geometry

- Preserve the native traffic-light row and the sidebar-expand control at `left: 108px`, width `30px`.
- In collapsed chat mode, reserve the first `148px` of the header for native window controls plus the sidebar-expand control.
- The Joi avatar begins at or after `x=148px`; the task title and source line follow it without overlap.
- The right inspector control remains visible and clickable.
- The identity area keeps its existing native window-drag behavior; interactive controls remain `no-drag`.

## Verification

- Source regression asserts the collapsed chat header uses `padding-left: 148px`.
- Frontend TypeScript/Vite build and existing single-agent workspace contract pass.
- Freshly installed `/Applications/Joi.app` is inspected with the sidebar collapsed.
- Installed screenshot confirms the traffic lights, expand control, avatar, title, and inspector control occupy separate hit areas.
- Real pointer click on the sidebar-expand control expands the menu, and collapsing it again restores the safe geometry.
- Strict codesign and installed `app.asar` source marker checks pass.

## Done means

- [x] Collapsed avatar and task identity begin after the sidebar-expand control.
- [x] No header identity content overlaps the macOS traffic lights.
- [x] Collapse/expand remains clickable in the installed app.
- [x] Expanded-state geometry is unchanged.
- [x] Installed screenshot and bundle evidence are captured.

## Installed evidence

- Fresh `/Applications/Joi.app` build installed at `2026-07-17 15:27:53 +0800`; strict codesign verification passed.
- With the sidebar collapsed, the installed screenshot shows the expand control first, then the Joi avatar and task identity beginning after the `148px` safe area.
- Computer Use clicked the collapsed `展开侧边栏` control successfully, then clicked `折叠侧边栏` and returned to the same safe geometry.
- Installed `app.asar` contains the scoped `.im-app-shell.sidebar-collapsed .messenger-chat-header { padding-left: 148px; }` rule.
- Screenshot: `joi-collapsed-header-safe-area-installed-2026-07-17.jpeg`.
