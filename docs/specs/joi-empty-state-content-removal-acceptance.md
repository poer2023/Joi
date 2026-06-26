# Joi Empty State Content Removal Acceptance

## Scope

- Project: Joi desktop frontend browser preview.
- Target URL or app screen: `http://127.0.0.1:5173/`, empty room chat surface.
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`.
- User job: remove the central empty-state avatar/title/description/action block from the chat surface.

## Reference

- Primary reference: current Tolaria-based Joi browser preview.
- What to copy: quiet transcript-first empty chat surface with top room identity and bottom composer.
- What not to copy: centered onboarding hero, quick action buttons, duplicate room title in the main canvas.

## Information Structure

- Must keep: top room header, sidebar room list, right inspector toggle, bottom composer and send controls.
- Must remove: center avatar, room heading, explanatory paragraph, and quick action buttons from the empty room state.
- Must not add: replacement empty-state copy, new placeholder cards, or extra controls.

## Visual Rules

- Layout density: unchanged outside the selected region.
- Spacing: empty message area remains blank and does not affect composer position.
- Typography: no central empty-state text.
- Color: unchanged.
- Borders/shadows: unchanged.
- Icon/button style: unchanged for remaining controls.

## Verification

- Browser target: `http://127.0.0.1:5173/`.
- Viewports:
  - Desktop: current in-app browser viewport.
- Required DOM checks:
  - `.hero-brand-lockup`, `.hero-avatar`, and `.quick-actions` are absent.
  - Empty chat surface does not contain the duplicate central room heading.
  - `.messenger-chat-header`, `.conversation-chat-item`, and `.composer` remain visible.
- Console/network requirements: no browser console errors.
- Commands:

```bash
pnpm --dir apps/joi-desktop/frontend build
```

## Done Means

- [x] Central empty-state content is removed.
- [x] Top room header, sidebar, and composer remain visible.
- [x] Build passes.
- [x] Browser verification shows no console errors or blank layout.
