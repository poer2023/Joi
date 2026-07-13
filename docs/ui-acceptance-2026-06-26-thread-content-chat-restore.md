# UI Acceptance Contract

## Scope

- Project: Joi Desktop browser preview
- Target URL or app screen: `http://127.0.0.1:5173/`, Joi private chat main transcript
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`
- User job: the current Joi room has thread content, and the main chat area should render that actual thread content in chronological order.

## Reference

- Primary reference: current right inspector `线程` tab for the Joi room.
- What to copy: real source message content behind each visible thread.
- What not to copy: thread cards, metrics, raw `history.*` event rows, right-inspector layout.

## Information Structure

- Must keep: normal `MessageList` chat bubbles in the main content area.
- Must add: fallback restoration from visible thread source messages when the current room conversation is empty.
- Must not add: a second thread card feed in the main area, synthetic project dashboard, or global thread inventory from unrelated rooms.

## Interaction Rules

- Required interactions: opening Joi room shows restored thread messages without clicking each thread.
- Existing interaction: `定位原聊天` still loads and highlights the original message.
- Ordering: restored messages are sorted by `created_at` ascending, with stable fallback order.

## Verification

- Browser target: `http://127.0.0.1:5173/`
- Screenshot: `docs/ui-acceptance-2026-06-26-thread-content-chat-restore.png`
- Required DOM checks:
  - Joi main content area rendered `135` `.message-row` nodes after restoration.
  - Early rows include older source messages such as `Joi run trace` and local app-list exchanges.
  - Later rows include newer source messages such as the memory conversation and screenshot approval task.
  - Main content has no `.thread-observer-card`, so right-inspector thread cards are not duplicated as main cards.
- Console/network requirements: no browser console errors.
- Commands:

```bash
pnpm --dir apps/joi-desktop/frontend build
```

## Done Means

- [x] Joi main content area renders actual restored thread messages.
- [x] Restored messages are sorted oldest to newest.
- [x] Normal non-empty conversations continue using their own messages.
- [x] Build and browser verification pass.
