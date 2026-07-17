# Joi Settings Progressive Menu Acceptance

## Scope

- Project: Joi desktop frontend
- Target URL or app screen: `http://127.0.0.1:5173/`, Settings
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`
- User job: Keep the two-level settings navigation usable without letting both menu columns occupy the workspace after a secondary item is chosen.

## Reference

- Primary reference: The current Settings layout and its existing manual primary-menu collapse behavior.
- What to keep: Current category/object labels, active states, back control, and expand/collapse control.
- What not to copy: The current always-visible primary column plus secondary column after object selection.

## Information Structure

- Must keep: All primary categories, all secondary objects, the selected object, and the detail content.
- Must remove: Persistent primary-menu width after an explicit secondary-object selection.
- Must not add: New settings, helper copy, categories, floating panels, or unrelated controls.

## Visual Rules

- Layout density: One navigation column should be the normal focused state while editing an object.
- Spacing: The secondary column is `168px` to `196px` wide at supported desktop widths.
- Typography, color, borders/shadows, and button style: Keep the current Tolaria settings treatment.
- Motion: Reuse the existing sidebar grid transition; do not add decorative animation.

## Interaction Rules

- Selecting a primary category updates its secondary list and keeps the primary menu open for category browsing.
- Selecting any secondary object automatically collapses the primary menu and leaves that object selected and visible.
- The existing expand control restores the primary menu without changing the selected category or object.
- The existing manual collapse/expand control and return-to-chat action remain keyboard- and pointer-accessible.
- Narrow-window automatic collapse remains intact.

## Verification

- Browser target: `http://127.0.0.1:5173/`
- Viewports:
  - Desktop: `1280x720`
  - Narrow: `820x900`
- Required screenshots:
  - Primary plus secondary navigation before object selection.
  - Primary collapsed after object selection.
  - Narrow settings view after object selection.
- Required DOM checks:
  - A primary-category click does not add `sidebar-collapsed`.
  - A secondary-object click adds `sidebar-collapsed`.
  - The clicked secondary object retains `.active` and remains visible.
  - `.settings-object-column` computes between `168px` and `196px` at both verification widths.
- Console requirements: No new browser console errors.
- Commands:

```bash
cd apps/joi-desktop/frontend
pnpm build
```

## Done Means

- [x] Secondary selection collapses the primary navigation while preserving context.
- [x] Primary navigation can be restored without losing the current selection.
- [x] Secondary navigation uses no more than `196px`.
- [x] No settings content or unrelated behavior changed.
- [x] Desktop and narrow browser evidence was captured and console errors were checked.

## Evidence

- Desktop expanded: `joi-settings-progressive-menu-expanded.png` (`secondaryWidth=196`, primary visible).
- Desktop collapsed: `joi-settings-progressive-menu-collapsed.png` (`secondaryWidth=196`, primary hidden, selected object retained).
- Narrow collapsed: `joi-settings-progressive-menu-narrow.png` (`820x900`, `secondaryWidth=168`, no detail overflow).
- Installed app: `joi-settings-progressive-menu-installed.png` (`/Applications/Joi.app`, primary hidden after selecting OpenAI).
- Installed interaction: selecting 聊天入口 kept the primary menu visible; selecting iMessage collapsed it; expanding restored 聊天入口 / iMessage.
- Build checks: worktree frontend build and canonical-repo frontend/Electron package builds passed.
- Browser console: no errors.
