# Joi Conversation-Native Execution UX v1.1 Acceptance

## Scope

- Project: `/Users/hao/project/Joi`
- Target app screen: installed Joi Desktop main conversation, Trace drawer/page, and existing `Terminal / Memory / Logs` inspector.
- Files likely to change: `apps/joi-desktop/frontend`, `apps/joi-electron`, `packages/store`, `packages/runtime`, `packages/shared-types`, and focused tests/scripts.
- User job: start a task, understand real execution in the original conversation, approve or deny risky actions inline, steer/stop the run, and review current-run learning suggestions without opening Logs.

## Reference

- Primary reference: `/Users/hao/Downloads/Joi-Conversation-Native-Execution-UX-v1.1-spec.md`
- Secondary references: existing Joi Desktop UI, `docs/54_LOCAL_REPO_AND_APP_STATE.md`
- What to copy: current three-column layout, compact `Thinking / Process` sections, existing Trace surface, existing `Terminal / Memory / Logs` inspector, restrained spacing and low-emphasis surfaces.
- What not to copy: raw `confirmation_required` assistant bubbles, failed red status for waiting approval, internal context/memory events in main Process, new permanent Run cards, new main navigation, or a fourth permanent inspector tab.

## Information Structure

- Must keep: main conversation as the control surface; `Thinking` for short work summaries; `Process` for real user-understandable runtime actions; Trace/Logs for complete audit; Memory inspector for current-run use and suggestions.
- Must remove: raw internal approval strings from assistant chat; Memory/context payloads from Process; manual terminal history ambiguity; duplicate visible facts across assistant bubble and Process.
- Must not add: global/master model concepts, worker as a default dependency, large task-card IA, or model-authored facts without canonical run events.

## Visual Rules

- Layout density: compact rows, collapsible sections, current inspector width behavior.
- Spacing: match current Joi Desktop row and strip rhythm; approval may use a light inline surface only under the relevant Process item.
- Typography: reuse current font scale; no hero-sized text or marketing copy.
- Color: neutral for queued/running/waiting; red only for true failure or policy block.
- Borders/shadows: thin borders and shallow surfaces only; no heavy cards or shadows for normal execution.
- Icon/button style: status must be expressed by icon plus text; approval buttons are `允许一次`, `本任务内允许`, and `拒绝`.

## Interaction Rules

- Required interactions: inline approval approve/deny/resume, current-run Process details, active-run composer steering, stop, current-run Memory actions, current-run terminal/log scoping.
- Hover/focus/active states: existing button/focus behavior must remain accessible and not shift layout.
- Mobile behavior: not a primary target for desktop app; narrow widths must not overflow text in rows, buttons, or strips.
- Empty/loading/error states: waiting approval is not failure; pending approval persists after app restart; destructive or blocked actions explain the block without offering a normal approval path.

## Verification

- Browser target: local preview is acceptable for renderer projection checks; installed `/Applications/Joi.app` is required before app-level completion.
- Viewports:
  - Desktop: installed app default desktop window, plus renderer preview if used for repeatable screenshots.
  - Mobile: not required for desktop app, but narrow layout should not overflow in component checks.
- Required screenshots: pending approval Process row, approved/resumed Process row, Memory inspector current-run state, Terminal source label if browser/app verification is available.
- Required DOM checks: no visible raw `confirmation_required`; Process count equals visible actions; waiting approval row is not marked failed; Memory proposals are scoped to current run.
- Console/network requirements: no renderer console errors in verification target.
- Commands:

```bash
pnpm --filter @joi/electron build
pnpm test:electron-contract
pnpm test:conversation-native-execution
/usr/bin/codesign --verify --deep --strict --verbose=2 /Applications/Joi.app
```

## Done Means

- [ ] The screenshot apply_patch task can wait for approval in the main conversation without a raw error bubble.
- [ ] Trace and conversation agree that waiting approval is not failure.
- [ ] `Thinking` contains summaries, not tool events or memory text.
- [ ] `Process` contains localized runtime actions, not internal context events.
- [ ] Approve/deny never starts the risky tool before approval.
- [ ] Active-run composer can steer or stop the current run.
- [ ] Memory inspector shows current-run recalled memories and at most scoped suggestions.
- [ ] Temporary or negated memory text does not become a long-term proposal.
- [ ] No new main navigation, permanent inspector tab, or large task card system was added.
