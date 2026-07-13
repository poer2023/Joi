# Joi Chat Scroller & Streaming Performance Acceptance

## Scope

- Project: `/Users/hao/project/Joi`
- Target app screen: `/Applications/Joi.app` main chat transcript
- Files likely to change: Electron IPC event delivery, chat projection/rendering components, chat-only scroll container, frontend package manifest/lockfile, shared chat CSS, focused tests
- User job: long and streaming conversations remain responsive, keep the reader's chosen position, and gain restrained status/motion polish without changing Joi's runtime contract

## Reference

- Primary reference: shadcn/ui June 2026 chat components and the headless `@shadcn/react/message-scroller` behavior
- Secondary reference: current installed Joi chat screen captured before implementation on 2026-07-11
- Copy: anchored turns, live-edge follow, prepend preservation, jump-to-latest, `content-visibility`, transcript accessibility, scroll fade, restrained status shimmer
- Do not copy: the demo's `@ai-sdk/react` transport, `motion/react` dependency, Tailwind visual system, demo card/composer styling, or AI Elements state model

## Information Structure

- Must keep: current sidebar, header, conversation model identity, composer, message copy/time actions, attachments, thread markers, process/tool stack, approval controls, Run Trace links
- Must remove: no user-facing feature
- Must not add: a second chat transport, direct model execution, a global Tailwind/shadcn migration, new runtime permissions, decorative panels, reactions, or unrelated settings

## Visual Rules

- Layout density: preserve the current Tolaria desktop density and chat rail width
- Spacing: preserve existing message/avatar/composer spacing; new controls may occupy only the transcript overlay area
- Typography: preserve existing system typography and Markdown styles
- Color: use existing Joi surface, border, primary, muted, and error tokens
- Borders/shadows: no new card nesting or elevated glass effects
- Icon/button style: quiet, compact, existing token colors; jump-to-latest is a single unobtrusive circular control

## Interaction Rules

- Auto-follow only while the reader is already at the live edge
- Wheel, touch, keyboard scrolling, scrollbar drag, message jump, or reading older content must not be overridden by new streamed chunks
- Reopening a saved transcript lands at the latest meaningful user turn when possible
- Prepending history preserves the visible row
- Stable message ids support source/thread jumps
- User-message entrance may animate only opacity/transform; assistant streaming rows do not animate layout
- Running status may shimmer; completed/failed/static rows do not shimmer
- `prefers-reduced-motion` disables shimmer and entrance motion
- Existing message selection, copy, attachment and approval actions remain operable

## Performance Contract

- Persist all Run Trace events, but do not reread the complete Run Trace for every appended delta solely to publish the newest event
- Do not publish trace-only `model.delta` events to the chat renderer
- Batch/coalesce visible assistant delta work so prior transcript rows and Markdown do not rerender for every provider fragment
- Completed historical messages and Markdown renderers use stable memo boundaries
- Off-screen transcript rows use `content-visibility: auto`
- Virtualization is not required in this change; the boundary is documented for later very large transcripts

## Verification

- Browser target: local preview only for fast diagnostics; it is not completion proof
- Installed target: `/Applications/Joi.app`
- Viewports:
  - Desktop: current installed window, approximately 1031x768 or larger
  - Narrow desktop: smallest practical Joi window without clipping the transcript or composer
  - Mobile: not applicable; Joi Desktop is the scoped product surface
- Required screenshots:
  - Installed chat before implementation
  - Installed chat after implementation at the live edge
  - Installed chat after scrolling away from the live edge with jump control visible
- Required DOM/runtime checks:
  - transcript viewport exposes `role="region"`, content exposes `role="log"`
  - rows expose stable message ids and off-screen containment CSS
  - no console-level renderer crash during restore, scroll, or streaming smoke
- Commands:

```bash
pnpm --filter @joi/desktop-frontend test:chat-projection
pnpm --filter @joi/desktop-frontend build
pnpm --filter @joi/electron test:contract
pnpm --filter @joi/electron build
pnpm package:electron:mac
codesign --verify --deep --strict /Applications/Joi.app
```

## Done Means

- [ ] Event delivery avoids complete Run Trace rereads per delta while preserving persisted trace data.
- [ ] The chat transcript uses the headless MessageScroller behavior without changing Joi transport or projector semantics.
- [ ] Completed message and Markdown work is isolated from streaming updates.
- [ ] Existing message/process/attachment/approval interactions still work.
- [ ] Reduced-motion behavior is present.
- [ ] Installed-app screenshots and source-to-bundle proof are captured.
- [ ] No forbidden helper copy, extra modules, or unrelated features were added.
