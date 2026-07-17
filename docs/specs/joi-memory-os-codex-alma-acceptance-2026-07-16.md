# Joi Memory OS · Codex + Alma acceptance contract

## Scope

- Project: `/Users/hao/project/Joi`
- Target screen: installed `/Applications/Joi.app` → 设置 → 数据与记忆 → 记忆健康
- Files likely to change: store memory runtime/schema, shared Desktop API, Electron IPC, the existing memory-health panel, and focused regression tests
- User job: keep long-term memory useful, controllable, explainable, and compatible with the current local database

## Reference

- Primary reference: the installed Joi memory-health screen captured before implementation on 2026-07-16
- Behavioral references: Codex local-memory controls/lifecycle and Alma layered profile + relevant-memory recall
- Copy: separate read/generate controls, external-context guard, layered recall, background maintenance, retrieval/influence evidence
- Preserve exactly: the user-authored `Joi Persona Constitution v2`, including Joi's authored identity, character profile, relationship, and fixed default-user fields
- Do not copy: private or undocumented Codex internals, Alma branding, automatically inferred demographics, third-party facts, or Memory OS v2's unrelated UI/Telegram/time changes

## Information structure

- Keep the current `记忆健康` route, metrics grid, scope distribution, and lifecycle hints
- Restore one compact `硬记忆 · 人格宪法` block with active version, identity, provenance, and an expandable full-text view
- Add one compact `记忆控制` block above metrics with three switches and one maintenance action
- Add layer and maintenance metrics without creating a second memory navigation surface
- Do not remove candidate confirmation, correction, disable, feedback, conflict, or deletion controls
- Do not automatically physically delete memories

## Visual rules

- Reuse existing settings cards, form rows, buttons, typography, spacing, borders, and colors
- Keep the panel dense enough to fit a normal desktop window without a new full-screen dashboard
- No decorative illustrations, gradients, badges, or unrelated navigation

## Interaction rules

- `在回答中使用记忆` immediately controls whether subsequent tasks inject stored memories
- `从任务中生成记忆` immediately controls whether subsequent tasks become memory-generation inputs
- `使用外部内容时停止生成` prevents web/MCP/tool-search runs from becoming generation inputs
- `立即整理记忆` runs non-destructive maintenance and refreshes visible metrics/status
- The user-authored Persona Constitution remains in the stable prompt even when learned-memory recall is disabled; it never enters automatic decay, ranking, merge, or deletion
- Loading disables the changed control; errors remain visible and do not silently flip stored state
- Mobile is not in scope because Joi Desktop is the MVP surface

## Runtime acceptance gates

1. Existing SQLite files open without reset or data deletion; legacy memories receive compatible layer/lifecycle defaults.
2. Prompt assembly separates stable profile, current state, relevant knowledge, and episodes; exact FTS matches remain recallable and unrelated memories may abstain.
3. Hybrid retrieval records score components and later marks influence as `inferred_used` or `not_used` without claiming deterministic causal proof.
4. Per-task request overrides can independently disable memory use or generation; global controls remain defaults.
5. Background maintenance is deduplicated, non-blocking, uses an unreferenced timer, and never leaves a chat run in a running state.
6. Installed app passes codesign, bundle-content proof, database integrity, and visible UI verification.
7. Fresh databases seed the exact authored v2 constitution; existing databases preserve newer constitutions and never overwrite later user-authored versions.

## Verification

- Target: installed `/Applications/Joi.app`
- Required screenshots: memory-health before and after
- Required accessibility checks: active v2 constitution identity, expandable full text, three switches, maintenance button, five layer metrics, latest maintenance state
- Required commands:

```bash
pnpm --filter @joi/store test
pnpm --filter @joi/desktop-frontend test:settings-completion
JOI_ALLOW_NON_MAIN_INSTALL=1 pnpm package:electron:mac
codesign --verify --deep --strict /Applications/Joi.app
```

## Done means

- [ ] Runtime gates 1–6 are backed by tests or installed-app evidence.
- [ ] Existing user data remains present and SQLite integrity is `ok`.
- [ ] The installed memory-health screen exposes the controls without duplicating navigation.
- [ ] The exact user-authored v2 hard memory is active and visible; no automatically inferred demographics, third-party facts, or unrelated v2 changes were merged.
