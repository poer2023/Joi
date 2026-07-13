# UI Acceptance Contract

## Scope

- Project: Joi Desktop browser preview
- Target URL or app screen: `http://127.0.0.1:5173/`, chat view with right inspector `线程`
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/features/chat/components/MessageList.tsx`, `apps/joi-desktop/frontend/src/styles.css`
- User job: keep the main agent chat as an uninterrupted private-chat transcript while letting threads open as focused detail views and jump back to their source messages.

## Reference

- Primary reference: user screenshot showing current right inspector thread cards.
- What to copy: the existing calm, dense inspector layout and the idea that chat is not owned by threads.
- What not to copy: large disruptive thread separators inside the main chat, extra marketing/explainer sections, or schema-level changes for this UI pass.

## Information Structure

- Must keep: main chat as the canonical waterfall transcript, right inspector tabs, existing thread card metrics, source ids from `MessengerThread`.
- Must add: selected thread detail state, source-message jump action, subtle source-message highlight in the main transcript.
- Must not add: a separate chat backend, global master-agent concepts, or new persistent schema in this pass.

## Visual Rules

- Layout density: right inspector remains compact and scan-friendly.
- Spacing: no nested cards inside cards; thread detail uses unframed sections within the existing panel.
- Typography: compact panel headings; no hero-scale text.
- Color: reuse current neutral surface/border tokens with one restrained highlight.
- Borders/shadows: no new heavy shadows.
- Icon/button style: small text buttons are acceptable for clear commands in inspector rows.

## Interaction Rules

- Required interactions: clicking a thread opens its detail; "在聊天中定位" switches focus to the source message and scrolls it into view; thread detail can return to the list.
- Hover/focus/active states: selected thread cards and highlighted source messages must be visually distinct.
- Mobile behavior: inspector may collapse as it does today; changes must not break the chat transcript.
- Empty/loading/error states: if a thread has no source messages, show that it cannot yet be located.

## Verification

- Browser target: `http://127.0.0.1:5173/`
- Viewports:
  - Desktop: current in-app browser viewport
  - Mobile: not required for this focused desktop inspector pass
- Required screenshots: current desktop viewport after opening thread detail and source highlight
- Required DOM checks: thread detail heading, locate button/empty locate text, highlighted message attribute/class when source exists
- Console/network requirements: no new console errors
- Commands:

```bash
pnpm --dir apps/joi-desktop/frontend build
```

## Done Means

- [ ] The UI matches the accepted information structure.
- [ ] No forbidden helper copy, extra modules, or unrelated features were added.
- [ ] Desktop screenshot was captured.
- [ ] Console errors were checked.
- [ ] Verification artifacts are linked in the final response.
