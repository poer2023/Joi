# UI Acceptance Contract

## Scope

- Project: Joi desktop frontend preview
- Target URL or app screen: `http://127.0.0.1:5173/`, right inspector overview panel
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`
- User job: remove runtime/checkpoint noise from overview

## Reference

- Primary reference: user browser comments selecting the overview runtime metrics and preview checkpoint card
- What to keep: room avatar/name editor, joined members, export data action
- What to remove: runtime metric grid (`当前运行`, `待审批`, `失败`, `成本`) and preview placeholder/checkpoint card

## Verification

- Browser target: `http://127.0.0.1:5173/`
- Required DOM checks: overview no longer contains runtime metrics or `预览模式暂无需要检查的变化`; member list remains visible
- Console/network requirements: no console errors from the edited surface
- Commands: `pnpm --dir apps/joi-desktop/frontend build`

## Done Means

- [x] Runtime metrics are absent from overview.
- [x] Preview checkpoint placeholder is absent from overview.
- [x] Room profile, joined members, and export action remain visible.
- [x] Build and browser verification pass.
