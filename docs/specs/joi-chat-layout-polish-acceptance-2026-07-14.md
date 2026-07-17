# Joi Chat Layout Polish Acceptance — 2026-07-14

## Scope

- Project: Joi Desktop frontend
- Target: `http://127.0.0.1:5173/`, single-agent chat workspace
- User job: visually tune the Telegram/thread sidebar and the central chat composition without changing behavior or data routing.

## Reference

- Primary reference: the in-app Browser comments supplied on 2026-07-14.
- Keep the existing neutral Joi visual language, message ordering, composer actions, channel grouping, resize behavior, and responsive breakpoints.
- Do not add new copy, controls, panels, data fields, or animations.

## Information Structure

- Keep: channel/thread sections, message history, header identity, composer controls, footer avatar, settings button.
- Remove: the duplicated `你` text beside the footer avatar and the channel-row conversation-title subtitle; the footer avatar remains and the conversation title remains in the chat header.
- Do not remove the chat history scroll region or its interaction behavior.

## Visual Rules

- Sidebar: channel and thread sections, headings, and rows use one shared usable width and horizontal inset.
- Channel row: render only the source badge and time on one compact row; do not repeat the conversation title or last-message preview beneath it.
- Chat column: the composer aligns to the message-bubble content column, excluding the `30px` avatar and `10px` gap on each side of the outer message row.
- Avatars: header and assistant-message Joi avatars are circular (`border-radius: 50%`).
- Existing colors, typography, message-bubble styles, and button treatment remain unchanged.

## Responsive Rules

- Desktop verification: 1546 × 1371 and 1280 × 800.
- Narrow verification: 900 × 800, above the automatic sidebar-collapse threshold when possible.
- Composer left edge must equal the assistant-bubble column left edge; composer right edge must equal the user-bubble column right edge within 1 CSS pixel after resizing.
- Composer must retain safe side gutters and never overflow the chat main column.

## Verification

- Browser DOM checks:
  - Channel and thread rows have equal width and x-position.
  - Channel row contains no `<small>` conversation-title subtitle and returns to the compact `32px` row height.
  - Composer width equals message-row width minus both `40px` avatar rails, and its x-position equals message-row x-position plus `40px` at all verification viewports.
  - Both Joi avatar computed border radii equal half their rendered width.
  - `.sidebar-user-name` is absent.
- Visual checks: desktop and narrower Browser screenshots after hot reload.
- Console: no new error-level messages.
- Commands:

```bash
pnpm --filter @joi/desktop-frontend test:single-agent-workspace
pnpm --filter @joi/desktop-frontend build
```

## Done Means

- [x] All Browser comments are reflected in the live preview, including removal of the channel-row subtitle.
- [x] Desktop and narrower layouts satisfy the corrected measured alignment rules.
- [x] No unrelated behavior or information structure changed.
- [x] Frontend tests and build pass.
- [x] Browser visual and console verification pass.

## Verification Evidence

- Live Browser target: `http://127.0.0.1:5173/`
- Superseded measurement: the prior composer incorrectly matched the outer message row and therefore exceeded the bubble column by `40px` on each side.
- 1395 × 1317: message row `x=476.5`, `width=692`; composer and bubble column `x=516.5`, `width=612`, `right=1128.5`.
- 1181 × 514: message row `x=369.5`, `width=692`; composer and bubble column `x=409.5`, `width=612`, `right=1021.5`.
- 900 × 514: message row `x=274`, `width=602`; composer and bubble column `x=314`, `width=522`, `right=836`.
- Header avatar: `40 × 40`, computed radius `50%`; message avatar: `30 × 30`, computed radius `50%`.
- `.sidebar-user-name` count: `0`.
- Telegram channel row: `32px` height, subtitle `<small>` count `0`; chat header still shows the conversation title.
- Browser screenshots captured at desktop and narrow verification sizes; error-level console log count: `0`.
- `pnpm --filter @joi/desktop-frontend test:single-agent-workspace`: passed.
- `pnpm --filter @joi/desktop-frontend build`: passed.
