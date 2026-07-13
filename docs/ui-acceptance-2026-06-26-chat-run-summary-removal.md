# Chat Run Summary Removal UI Acceptance

## Reference

- Browser comment selected the inline chip below an assistant response: `1 次模型 · 1 个工具 · 1,620 · $0.0020`.
- The right inspector already has a fixed `运行` tab for run events, model/tool spans, tokens, and cost.

## Scope

- Remove the legacy run summary chip from the main chat transcript.
- Keep assistant content, expanded `Thinking` / tool process lines, and the right `运行` inspector available.
- Do not remove run event data, trace span summaries, or run detail cards from the right inspector.

## Constraints

- Main chat should not show model count, tool count, token count, or cost as a pill under assistant messages.
- There should be no `.message-run-summary` element in the chat DOM.
- Existing process transcript rows must remain visible and expanded for the selected mock conversation.
- The right inspector `运行` tab must still be reachable and keep run detail content.

## Verification

- Run the frontend build.
- Verify in the in-app browser at `http://127.0.0.1:5173/`:
  - `.chat-main-column .message-run-summary` count is `0`.
  - `.assistant-response-stack .process-group[open]` count is greater than `0` for the mock run message.
  - `#right-inspector-tab-runs` exists and the `运行` panel can render its cards.

## Result

- `pnpm --dir apps/joi-desktop/frontend build` passed.
- Browser DOM after reload and opening Gate:
  - `.chat-main-column .message-run-summary`: `0`
  - `.assistant-response-stack .process-group[open]`: `1`
  - `#right-inspector-tab-runs`: present and selectable.
- After selecting `运行`, the panel rendered `run_gateway_capability_scan` event details and browser console errors were empty.
