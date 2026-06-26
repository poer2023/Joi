# Joi Tolaria Theme Integration Acceptance

## Scope

- Project: Joi desktop frontend browser preview.
- Target URL or app screen: `http://127.0.0.1:5173/`, primary chat screen and sidebar.
- Files likely to change: `apps/joi-desktop/frontend/src/main.tsx`, `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`, `apps/joi-desktop/frontend/src/styles/tolaria-electron-theme.css`.
- User job: use `import "./styles/tolaria-electron-theme.css"` as the guiding design system and allow current Joi UI to be restructured visually where it conflicts.

## Reference

- Primary reference: Tolaria style kit `tolaria-electron-theme.css`.
- What to copy: Tolaria tokens, neutral editor/sidebar surfaces, dense list rows, compact buttons, panel headers, card/list rhythm.
- What not to copy: Tolaria business logic or unrelated app-specific behavior.

## Information Structure

- Must keep: chat routing, sidebar room selection, composer controls, right inspector, settings entry, browser preview fallback behavior.
- Must change: Joi visual tokens should be mapped to Tolaria tokens; primary shell/sidebars/panels/composer/buttons should follow Tolaria density and color.
- Must not add: new product features, marketing surfaces, external dependencies.

## Visual Rules

- Layout density: compact desktop app, closer to an editor/workbench than a hero-first app.
- Spacing: smaller row heights and consistent 4/6/8/12px gaps.
- Typography: Tolaria font token and 13-14px operational text dominate; no oversized interior labels except the empty-state room title.
- Color: Tolaria neutral white/sidebar surfaces and blue selected state take priority over the previous beige/material palette.
- Borders/shadows: thin Tolaria borders for structure; restrained shadows only for floating composer/menus/modals.
- Icon/button style: square-ish 4-8px radius buttons and compact pills from Tolaria.

## Verification

- Browser target: `http://127.0.0.1:5173/`.
- Viewports:
  - Desktop: current in-app browser viewport.
- Required DOM checks:
  - `tolaria-electron-theme.css` is loaded.
  - `--tk-surface-app` and Joi `--color-surface` resolve to the same Tolaria surface.
  - Primary shell/sidebar/workspace expose Tolaria-compatible classes.
  - Composer and room rows remain visible and usable.
- Commands:

```bash
pnpm --dir apps/joi-desktop/frontend build
```

## Done Means

- [x] Theme import is present and resolves.
- [x] Browser preview reflects Tolaria tokens and layout density.
- [x] Build passes.
- [x] Browser verification shows no console errors or blank layout.
