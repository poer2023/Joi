# Joi Model Settings Spacing Acceptance

## Scope

- Project: Joi desktop frontend
- Target URL or app screen: `http://127.0.0.1:5173/`, settings -> 模型 -> DeepSeek
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`
- User job: Fix the cramped DeepSeek model settings area, especially the reset/save controls and advanced parameters.

## Reference

- Primary reference: Browser comment on the DeepSeek settings detail content.
- What to copy: Keep the existing compact Tolaria-style settings surface and provider fields.
- What not to copy: Do not preserve the cramped single-block spacing around actions and advanced parameters.

## Information Structure

- Must keep: API URL, API Key, connection status, available models, reset/save actions, advanced parameters.
- Must remove: Visual crowding between the model list, action buttons, and advanced parameters.
- Must not add: New provider settings, new explanatory copy, or unrelated settings groups.

## Visual Rules

- Layout density: Compact, but separated into readable sections.
- Spacing: Reset/save controls and advanced parameters must have clear vertical spacing from the previous fields.
- Typography: Keep existing settings typography scale.
- Color: Keep existing neutral settings theme.
- Borders/shadows: Keep soft panel borders; advanced parameters should read as a separate section.
- Icon/button style: Keep existing button styling.

## Interaction Rules

- Required interactions: DeepSeek settings can be opened, advanced parameters can expand/collapse, model configure buttons remain clickable.
- Hover/focus/active states: Keep current hover/focus treatments.
- Mobile behavior: Form rows can stack without clipped buttons or inputs.

## Verification

- Browser target: `http://127.0.0.1:5173/`
- Viewports:
  - Desktop: `1560x1314`
  - Narrow: `820x920`
- Required screenshots: DeepSeek model settings content after fix.
- Required DOM checks: Action row and advanced section have distinct vertical bounds; no overlap.
- Console/network requirements: No new browser console errors.
- Commands:

```bash
pnpm --dir apps/joi-desktop/frontend build
```

## Done Means

- [x] The UI matches the accepted information structure.
- [x] No forbidden helper copy, extra modules, or unrelated features were added.
- [x] Desktop and narrow screenshots were captured or DOM/visual evidence was collected.
- [x] Console errors and request failures were checked.
- [x] Verification artifacts are linked in the final response.
