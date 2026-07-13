# UI Acceptance Contract

## Scope

- Project: Joi Desktop frontend in `/Users/hao/project/Joi`.
- Target URL or app screen: `http://127.0.0.1:5173/`, main chat process transcript.
- Files likely to change: `apps/joi-desktop/frontend/src/features/chat/components/MessageList.tsx`, `apps/joi-desktop/frontend/src/features/chat/conversationProjector.ts`.
- User job: Tool-call rows in chat should expand in place; they must not open the run/trace page from the inline process area.

## Reference

- Primary reference: Browser comment on the `网页搜索 Trace` row.
- What to copy: Other `网页搜索` rows that show inline Input/Output inside the row details.
- What not to copy: A separate `Trace` action inside the chat transcript summary.

## Information Structure

- Must keep: `已完成` / `失败` process stack summary, each tool-call row, and full tool input/output details.
- Must remove: Inline `Trace` button from transcript tool rows.
- Must not add: New navigation links, duplicated diagnostic buttons, or a separate page transition from the tool row.

## Interaction Rules

- Clicking a tool row summary toggles its own details below the summary.
- Failed tool rows still expose local details with Input and Output; an Error row appears only when it adds separate information.
- Dedicated run/trace navigation remains outside this inline transcript surface.

## Verification

- Browser target: `http://127.0.0.1:5173/`.
- Required DOM checks:
  - `.transcript-line-link` count is `0` inside the chat transcript.
  - Failed `.transcript-tool` details contain local `Input` and `Output`.
  - Clicking a failed tool summary toggles the `open` state without changing the selected tab/page.
- Commands:

```bash
pnpm --filter @joi/desktop-frontend build
```

## Done Means

- [x] The inline transcript no longer renders `Trace` as a row action.
- [x] Tool rows expand in place with full details.
- [x] Build passes.
- [x] Browser DOM verifies the expected interaction.
