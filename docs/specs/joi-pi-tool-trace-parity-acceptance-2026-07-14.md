# Joi Pi-style Tool Trace Acceptance

## Scope

- Project: Joi Desktop
- Target screen: the inline execution process attached to assistant replies in `/Applications/Joi.app`
- Files likely to change:
  - `apps/joi-desktop/frontend/src/features/chat/components/MessageList.tsx`
  - `apps/joi-desktop/frontend/src/features/chat/conversationProjector.ts`
  - `apps/joi-desktop/frontend/src/styles.css`
  - `apps/joi-desktop/frontend/scripts/test-chat-projection.mjs`
- User job: understand what each capability received, what it actually returned, and where it failed without leaving the conversation.

## Reference

- Primary reference: the installed Joi screenshot from 2026-07-14 where tool outputs collapse to `已完成处理` and inputs are absent.
- Behavioral reference: local `@earendil-works/pi-coding-agent@0.80.6` `ToolExecutionComponent` and its built-in tool renderer contract.
- Copy from Pi:
  - render a meaningful tool-call/input summary before a result exists;
  - update the same stable row as partial and terminal results arrive;
  - retain a compact terminal summary;
  - expose the real redacted input and output on expansion.
- Do not copy:
  - terminal colors, keybindings, boxes, or tool-specific visual branding;
  - direct tool execution or any Pi runtime/permission semantics.

## Information Structure

- Must keep: run status, duration, step count, tool name, failure state, approval controls, and the final assistant answer.
- Must add:
  - a useful input target on every tool row when one exists;
  - `输入`, `输出`, and `错误` detail sections backed by the stored event values;
  - readable structured JSON instead of `已完成处理`;
  - explicit `无返回内容` only when the terminal event truly has no result.
- Must not add: raw call IDs, secrets, cookies, authorization headers, model internals, duplicate tool rows, or a second execution panel.

## Visual Rules

- Keep the current lightweight transcript hierarchy and density.
- Input/output sections use selectable monospace text with preserved whitespace.
- Long content stays inside a bounded scroll region so one tool cannot destabilize the whole conversation layout.
- Status color and existing Joi typography remain unchanged.

## Interaction Rules

- A live process opens on first render so new tool activity is visible; it must not snap closed when the run completes.
- A historical completed process starts collapsed.
- User-controlled expansion survives appended steps and partial-result updates.
- Each tool row expands independently; repeated tools may remain clustered, but every invocation retains its own input and output.
- Running, failed, empty, structured, multiline, and redacted values all have deterministic rendering.
- Reduced-motion settings continue disabling decorative animation.

## Verification

- Projection tests assert:
  - input is rendered and secret values remain redacted;
  - object and array outputs show their actual fields/items and never `已完成处理`;
  - empty terminal output says `无返回内容`;
  - live process markup starts open and completed historical markup starts closed;
  - process/group identities do not depend on current step counts.
- Frontend TypeScript/Vite production build passes.
- `/Applications/Joi.app` is rebuilt, signed, reopened, and visually inspected against a real or deterministic multi-tool run.

## Done Means

- [x] No visible tool result is replaced by the generic `已完成处理` placeholder.
- [x] Input and useful output/error data are readable from the inline process.
- [x] Appended events update existing rows without resetting disclosure state.
- [x] Long content is bounded without discarding the stored result.
- [x] Installed-app evidence proves the behavior outside preview/dev mode.
- [x] Existing Joi application data is preserved.

## Evidence

- Before: `docs/specs/evidence/joi-pi-tool-trace/before-installed-2026-07-14.png`
- After: `docs/specs/evidence/joi-pi-tool-trace/after-installed-2026-07-14.png`
- `pnpm --filter @joi/desktop-frontend test:chat-projection`
- `pnpm --filter @joi/desktop-frontend build`
- Installed bundle: `/Applications/Joi.app`; strict deep signature verification passed.
- Existing `joi.db`: read-only `quick_check = ok`; `foreign_key_check` returned no rows.
