# UI Acceptance Contract

## Scope

- Project: Joi desktop frontend preview
- Target URL or app screen: `http://127.0.0.1:5173/`, chat composer
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`
- User job: remove model choosing/configuration from the message composer

## Reference

- Primary reference: user browser comment selecting the `deepseek-v4-flash` composer control
- What to copy: keep the compact composer and existing input-mode segmented control
- What not to copy: do not show a model dropdown in the composer

## Information Structure

- Must keep: message textarea, Auto/Chat/Task/Bg mode control, send/stop button
- Must remove: composer model selector trigger and menu
- Must not add: replacement text explaining model configuration, new composer settings entry

## Verification

- Browser target: `http://127.0.0.1:5173/`
- Required DOM checks: no `.composer-model-control`, no `.composer-model-trigger`, no `.composer-model-menu`
- Console/network requirements: no console errors from the edited surface
- Commands: `pnpm --dir apps/joi-desktop/frontend build`

## Done Means

- [x] Composer no longer shows model selection/configuration.
- [x] Input mode buttons still render and work.
- [x] Build and browser verification pass.
