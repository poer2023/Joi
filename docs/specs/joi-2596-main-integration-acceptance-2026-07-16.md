# Joi 2596 → Main Integration Acceptance

## Scope

- Project: Joi Desktop
- Target screen: installed `/Applications/Joi.app`, chat and Settings
- Integration source: `codex/exploration-ui-state-2596-20260714`
- User job: keep the current branch's accepted UI work while preserving the newer runtime, tool trace, settings, and installed-app behavior already on `main`.

## Reference

- Primary reference: `docs/specs/joi-settings-progressive-menu-acceptance.md` from the integration source branch.
- Secondary reference: the installed Joi baseline observed before integration on 2026-07-16.
- Keep: current labels, active states, one-column focused settings navigation, chat transcript projection, inspector boundaries, and all newer Desktop capability wiring.
- Do not copy: stale implementations from the archived exploration when `main` already contains a newer compatible implementation.

## Information Structure

- Must keep: every current Settings category and object, current chat/channel/thread structure, current inspector pages, and current preload/API operations.
- Must integrate: secondary-object selection collapses the primary Settings menu; expanding restores it without losing selection.
- Must not add: duplicate navigation rails, duplicate settings objects, replacement runtime concepts, or unrelated Memory OS v2 work.

## Visual Rules

- Keep the existing Joi/Tolaria color, typography, border, radius, and motion system.
- Keep the secondary Settings column between `168px` and `196px` at supported widths.
- Preserve current narrow-window behavior and prevent detail-panel overflow.

## Interaction Rules

- Primary category selection keeps the primary menu open.
- Secondary object selection collapses the primary menu and keeps the selected object visible.
- The expand control restores the primary menu without changing category or object.
- Chat cancellation, queued follow-up rendering, tool-result scrolling, and inspector controls must retain current `main` behavior.

## Verification

- Frontend build and chat/settings contract tests.
- Runtime, store, secrets, and Electron contract tests.
- Installed-app build/package replacement only after source verification succeeds.
- Computer Use inspection of installed chat and Settings, including collapse/expand behavior.

## Done Means

- [ ] All merge conflicts are resolved without conflict markers.
- [ ] The progressive Settings menu contract passes.
- [ ] Current `main` runtime and tool contracts pass.
- [ ] Installed Joi visually preserves the chat baseline and accepted Settings behavior.
- [ ] `codex/memory-os-v2-20260714` remains unchanged and unmerged.
