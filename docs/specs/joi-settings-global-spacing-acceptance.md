# Joi Settings Global Spacing Acceptance

## Scope

- Project: Joi desktop frontend
- Target URL or app screen: `http://127.0.0.1:5173/`, Settings surfaces across 模型、聊天入口、自动化、节点与执行、数据与记忆、能力与工具、高级.
- Files likely to change: `apps/joi-desktop/frontend/src/styles.css`; small JSX class adjustments only if shared CSS cannot cover the issue.
- User job: Fix the recurring cramped layout where form rows, action buttons, and advanced/detail sections are visually squeezed together.

## Reference

- Primary reference: Browser screenshots of Telegram settings and Worker Gateway settings.
- What to copy: Keep the existing compact Tolaria-style table rows and neutral settings theme.
- What not to copy: Do not keep action buttons and advanced/detail blocks visually glued to the bordered field table.

## Information Structure

- Must keep: Existing setting fields, buttons, status rows, advanced/details disclosure sections, and object navigation.
- Must remove: Cramped action/detail placement inside the field table.
- Must not add: New settings, new explanatory copy, new settings categories, or unrelated chat UI changes.

## Visual Rules

- Layout density: Compact but readable; fields can stay table-like.
- Spacing: Direct child action rows and disclosure/detail panels under a settings form must have clear vertical spacing from field rows.
- Typography: Keep current settings typography.
- Color: Keep the current neutral Tolaria palette.
- Borders/shadows: Field rows can remain one shared panel; action rows must be unframed; advanced/detail disclosures must read as separate panels.
- Icon/button style: Keep existing button styling.

## Interaction Rules

- Required interactions: Category/object navigation still works; disclosure sections can expand/collapse; buttons remain reachable.
- Hover/focus/active states: Keep current treatments.
- Mobile behavior: Form rows stack on narrow widths without clipped buttons or inputs.

## Verification

- Browser target: `http://127.0.0.1:5173/`
- Viewports:
  - Desktop: `1560x1314`
  - Narrow: `820x920`
- Required surfaces:
  - 模型 / DeepSeek
  - 聊天入口 / Telegram
  - 节点与执行 / Worker Gateway
  - 自动化 / one automation detail or creation page
  - 数据与记忆 / 本地数据
- Required DOM checks: Action rows and advanced/detail sections have positive vertical gaps from preceding field rows; no horizontal overflow.
- Console/network requirements: No new browser console errors.
- Commands:

```bash
cd apps/joi-desktop/frontend && npm run build
```

## Done Means

- [x] Shared settings layout fixes the recurring form/action/details crowding.
- [x] No forbidden helper copy, extra modules, or unrelated features were added.
- [x] Desktop and narrow evidence was collected.
- [x] Console errors and request failures were checked.
- [x] Verification artifacts are linked in the final response.
