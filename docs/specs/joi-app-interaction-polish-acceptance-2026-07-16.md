# Joi App Interaction Polish Acceptance — 2026-07-16

## Objective

Make Joi Desktop feel continuous and responsive across its existing interaction surfaces without changing its visual language, data routing, or product behavior. The only information-architecture change in this pass is the explicitly requested relocation of the conversation tree from a floating chat popover into the existing right inspector.

## Scope

- Project: Joi Desktop frontend and installed macOS app.
- Primary surfaces: chat, conversation sidebar, settings, right inspector, conversation tree, dialogs, notifications, scroll regions, loading and async action feedback.
- Source baseline: `main@c2f2d3a` plus the current installed renderer's already-proven uncommitted approval-state behavior.
- Installed target: `/Applications/Joi.app`.
- Likely source files: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/components/ScrollArea.tsx`, `apps/joi-desktop/frontend/src/styles.css`, and focused interaction-contract tests.

## Locked Visual Contract

- Keep all current layout proportions, colors, typography, spacing, borders, shadows, radii, icons, and labels. The conversation-tree header control stays in place, but its content opens as an existing right-inspector tab instead of a floating chat popover.
- Do not add decorative motion, spring overshoot, blur, parallax, new helper copy, new panels, or new controls.
- Motion may only explain an existing state change or preserve spatial continuity.
- Existing Tolaria/Joi tokens remain the visual source of truth.

## Interaction Contract

### Structural regions

- Main sidebar, settings menu, and right inspector retain their mounted state while opening or closing so scroll position, selected tabs, and in-progress local UI state do not reset.
- Collapsed regions are removed from pointer and keyboard interaction with `inert`/`aria-hidden`, not merely made transparent.
- Collapsed regions also contribute no Electron draggable area; a hidden inspector header must never cover visible chat-header controls.
- Right-inspector open and close both animate; the main chat column and panel resize as one transition with no one-frame jump.
- Resize drags remain immediate and disable layout transitions until pointer release.
- Repeated open/close clicks during a transition settle on the final requested state without stale timers.

### Navigation and content

- Chat, trace, and settings entry transitions are brief and do not move the fixed window chrome or side rails.
- The three chat-header controls (Today, conversation tree, right inspector) accept ordinary primary-pointer clicks in every current or historical conversation, including long tool-result threads inside Electron's draggable title bar.
- Pointer activation and keyboard/accessibility activation each run the header action exactly once; the surrounding identity area remains draggable.
- The conversation-tree control expands the right inspector and selects a first-class “会话树” tab; activating it again while that tab is visible collapses the right inspector.
- The conversation tree never opens as a floating layer over the transcript. Its tree navigation, branch metadata, manual compaction, import, export, refresh, busy state, and status feedback remain available inside the tab.
- Switching between “会话树” and the other inspector tabs preserves conversation-tree drafts and the selected inspector state. Changing conversations while the tab is visible refreshes the tree in place.
- Today remains a separate global drawer and does not become an inspector tab.
- Switching a settings category or object resets only that detail scroll viewport to the top; unrelated sidebar and inspector scroll positions remain unchanged.
- Conversation changes preserve the chat scroller's existing live-edge, prepend-anchor, and jump-to-latest behavior.
- Tab and disclosure changes keep the current content hierarchy and use the same motion rhythm.

### Dialogs and popovers

- Existing dialogs and remaining popovers support Escape to close when dismissal is safe. The conversation tree is no longer a popover and follows the right inspector's open/close behavior.
- Opening focuses the dialog/popover or its first intended control; closing returns focus to the invoking control when it still exists.
- Modal backdrops prevent interaction with underlying content. Destructive or save-bearing dialogs do not close through an accidental inside click.
- Dialog appearance and dismissal use the existing surface geometry; no visual redesign.

### Async feedback

- Loading, success, failure, disabled, and queued states remain visible and do not cause surrounding controls to jump.
- Toasts and transient status surfaces enter and leave without blocking pointer input outside their own bounds.
- Buttons acknowledge press immediately and cannot double-submit while already busy.

### Transcript signal density

- A completed reply with no tool call, approval, artifact, task, or failure renders no process stack above the answer.
- Terminal successful `prepared` / `verified` work summaries such as “能力已就绪” and “结果已核对” never render as standalone transcript rows.
- Running work summaries and failed or blocked summaries remain visible when they communicate an active or actionable state.
- Real tool calls, approvals, artifacts, tasks, failures, and their trace affordances remain unchanged.
- A disclosure affordance is shown only when there is actual detail to reveal.

## Motion Budget

- Direct press/hover feedback: 90–140ms.
- Small content/disclosure change: 140–180ms.
- Sidebar, inspector, dialog, and page-region transition: 180–220ms.
- Use one standard ease-out curve for entering and a slightly faster ease-in curve for leaving; no bounce or overshoot.
- Prefer compositor-safe `transform` and `opacity`; layout animation is limited to the existing grid column transitions.
- No permanent `will-change` on large surfaces.
- Under `prefers-reduced-motion: reduce`, structural and decorative animation completes immediately while state, focus, and accessibility behavior remain intact.

## Functional Boundaries

- No changes to models, providers, runtime routing, tool policy, persistence, SQLite schema, automation semantics, Telegram/iMessage, or worker behavior.
- Do not seed, rewrite, or delete real Joi user data.
- Preserve the current installed approval flow: actor `desktop_user`, error handling, and approved/rejected transcript states.
- Narrow windows may auto-collapse side regions, but the explicit user preference and the reopen control remain functional.

## Verification

- Source checks:
  - focused frontend interaction contract tests
  - all existing frontend tests
  - TypeScript/Vite frontend build
  - `git diff --check`
- Browser/local renderer checks:
  - desktop around 1200×768
  - narrow desktop around 900×720
  - computed transition timing and `prefers-reduced-motion`
  - console error count remains zero for tested paths
- Isolated Electron checks:
  - use the existing manual conversation-flow fixture with isolated user data when needed
  - do not use the real-data preview seeder
- Installed App checks with Computer Use:
  - sidebar collapse/expand
  - settings menu collapse/expand and category/object navigation
  - right inspector open/close, tabs, retained scroll/selection state
  - conversation-tree header control opens the right inspector directly on the “会话树” tab
  - conversation-tree content is contained by the right inspector, keeps all existing actions, and never overlays the transcript
  - switch from “会话树” to another inspector tab and back without losing the local branch/summary drafts
  - collapse and reopen the conversation-tree tab through the header control
  - real pointer-coordinate clicks on Today, conversation tree, and right inspector in the historical `/Users/hao/project/Joi/.local/joi-tool-stress/config.json` conversation
  - one safe dialog open/Escape close/focus return
  - repeated toggle stress and narrow-window auto-collapse
- Bundle checks:
  - strict codesign
  - source-to-renderer/app.asar proof
  - installed process path points to `/Applications/Joi.app`
  - existing `~/Library/Application Support/Joi` remains present and untouched by test setup

## Done Means

- [ ] Core structural regions animate in both directions without layout flashes or input leaks.
- [ ] Navigation, scroll, focus, and async state behavior match this contract.
- [x] Historical chat-header controls are pointer-clickable and do not double-toggle.
- [x] Conversation tree is a retained right-inspector tab with no transcript popover or lost actions.
- [ ] Existing visual geometry and styling are unchanged in before/after comparisons.
- [x] Plain no-tool replies contain no empty “能力已就绪” / “结果已核对” rows or empty disclosure affordances.
- [ ] Reduced-motion behavior is complete and accessible.
- [ ] Focused and existing frontend tests plus build pass.
- [ ] Browser/local evidence and real installed-app evidence both pass.
- [ ] Any unverified low-frequency surface is listed explicitly instead of being implied complete.

## Non-goals

- Visual redesign or component-library migration.
- New product features, copywriting, or information architecture.
- Runtime/performance work outside the renderer interaction path.
- Publishing, committing, or pushing unless separately requested.

## Conversation Tree Tab Evidence — 2026-07-17

- Source contract test and every existing frontend test pass; the TypeScript/Vite production build and `git diff --check` pass.
- `/Applications/Joi.app` opens the historical `/Users/hao/project/Joi/.local/joi-tool-stress/config.json` conversation and the chat-header tree control selects the right-inspector “会话树” tab.
- The installed tab exposes refresh, tree navigation, branch metadata, manual compaction, export, and import without rendering a transcript popover.
- An unsaved branch-name draft survives “会话树 → 概览 → 会话树” and collapse/reopen cycles; switching to another conversation remains the automatic refresh boundary.
- Today still opens and closes as its separate global drawer.
- Strict codesign passes. The installed `app.asar` renderer JS/CSS hashes match the packaged renderer assets and contain the conversation-tree tab identifiers.
