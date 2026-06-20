# UI Acceptance Contract

## Scope

- Project: Joi Desktop frontend.
- Target app screen: Chat conversation area in `/Applications/Joi.app`.
- Files likely to change: `apps/joi-desktop/frontend/src/features/chat/components/*`, `apps/joi-desktop/frontend/src/styles.css`.
- User job: Render Markdown in chat bubbles instead of showing raw Markdown characters.

## Reference

- Primary reference: Existing Joi conversation screen.
- What to preserve: Current avatars, bubble layout, message ordering, mode controls, task/status cards.
- What not to add: New side panels, composer behavior, backend changes, external Markdown dependencies.

## Information Structure

- Must keep: User/assistant messages as chat bubbles.
- Must add: Safe Markdown rendering for headings, paragraphs, lists, blockquotes, code, tables, links, emphasis.
- Must not add: Raw HTML execution or unrelated helper copy.

## Visual Rules

- Layout density: Keep current compact chat rhythm.
- Spacing: Markdown blocks should have readable spacing inside bubbles without expanding the overall rail.
- Typography: Use current app font and color tokens.
- Color: Use existing surface, border, and text variables.
- Borders/shadows: Only table/code styling inside bubbles.

## Interaction Rules

- Required interactions: Links open as normal links; code and tables are readable.
- Empty/loading/error states: Keep existing skeleton text.

## Verification

- Browser target: `http://127.0.0.1:5179`.
- Viewports:
  - Desktop: existing app window.
- Required DOM checks: Markdown component renders block elements instead of a single text paragraph.
- Note: Vite preview fallback currently replaces submitted text with fixed `Preview request` / `Preview response`, so component rendering was verified directly with the same React component used by chat bubbles.
- Commands:

```bash
npm run test:chat-projection
npm run build
```

## Done Means

- [x] Markdown syntax renders as structured elements in chat bubbles.
- [x] Plain text still renders as normal paragraphs.
- [x] No raw HTML is executed.
- [x] Frontend build passes.
