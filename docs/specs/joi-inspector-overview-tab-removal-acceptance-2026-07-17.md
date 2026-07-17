# Joi Inspector Overview Tab Removal Acceptance — 2026-07-17

## Scope

- Project: Joi Desktop Electron app.
- Target: installed chat screen and right inspector in `/Applications/Joi.app`.
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`, and the focused frontend contract test.
- User job: reach branches, runs, assets, and memory without a redundant overview tab, while retaining an obvious path to conversation/profile settings.

## Reference

- Primary reference: current installed app captured before implementation at `01-before-installed.png` in the task visualization folder.
- Product decision: keep `分支` and `运行` as separate concepts; remove `概览` from the permanent tab strip.
- Preserve the existing inspector dimensions, density, typography, colors, and tab styling.

## Information Structure

- Keep permanent tabs in this order: `分支`, `运行`, `产物`, `记忆`.
- Keep the existing overview/profile content and open it from the chat avatar or conversation identity.
- The normal inspector button defaults to `分支` when no explicit inspector destination has been chosen.
- Temporary member detail tabs keep their existing behavior.
- Remove only the permanent `概览` tab; do not merge branch structure with execution history.
- Do not add helper banners, new settings pages, or duplicate profile controls.

## Interaction Rules

- Clicking the avatar or conversation identity opens the inspector directly on the existing overview/profile content.
- The identity control is an explicit Electron `no-drag` click target and supports keyboard/accessibility activation.
- Blank space remaining in the first titlebar column stays draggable.
- Clicking the inspector toggle only expands/collapses it and preserves the selected visible tab.
- Collapsed-sidebar safe spacing, immersive mode, and right-panel preference remain unchanged.
- Switching among `分支`, `运行`, `产物`, and `记忆` remains functional and does not collapse the left sidebar.

## Verification

- Target: freshly packaged `/Applications/Joi.app`.
- Desktop viewport: current installed app window size.
- Mobile: not applicable to the Electron-only surface.
- Required screenshots: before state, four-tab inspector, and avatar-opened profile state.
- Required accessibility checks: no `概览` tab; four permanent tabs are exposed; `打开会话资料` is a button; profile and normal tabs are reachable.
- Required interaction checks: profile button opens profile; `分支` and `运行` still switch; inspector collapse/reopen is stable.
- Required commands:

```bash
pnpm --filter @joi/desktop-frontend test:single-agent-workspace
pnpm --filter @joi/desktop-frontend build
pnpm --filter @joi/electron build
git diff --check
codesign --verify --deep --strict /Applications/Joi.app
```

## Done Means

- [x] The inspector tab strip contains exactly `分支 / 运行 / 产物 / 记忆` plus any temporary member tab.
- [x] Avatar/name opens the preserved profile surface without interfering with the surrounding window drag region.
- [x] Normal inspector opening defaults to `分支`; the profile surface is directly reachable from the identity button.
- [x] Existing branch, run, asset, memory, collapsed-sidebar, and immersive contracts remain intact.
- [x] Fresh installed-app screenshots and accessibility evidence are captured.
- [x] Installed bundle proof and strict codesign pass without touching `~/Library/Application Support/Joi`.

## Installed Evidence

- Fresh package installed at `/Applications/Joi.app` on `2026-07-17 17:52:42 +0800`; the active main process was restarted from that exact bundle at `17:53:54 +0800`.
- Accessibility inspection exposes `打开会话资料` as a button and exactly four permanent tabs: `分支`, `运行`, `产物`, and `记忆`. No `概览` tab remains.
- Opening the inspector from a fresh renderer lands on `分支`. Switching to `运行`, collapsing, and reopening retains `运行`.
- Clicking the avatar/name while the inspector is collapsed expands the inspector directly onto the preserved profile/model/memory surface.
- The profile button and descendants are explicit `no-drag` controls; the surrounding identity column retains the Electron drag region. Pointer activation uses the existing titlebar-safe pointer-up path.
- The left sidebar remained expanded through all tab and profile interactions.
- Frontend focused test, frontend build, Electron build, and `git diff --check` passed.
- Installed and release `app.asar` SHA-256 both equal `619f19a91dfd4ee71a7972959c7623baed30cf710e35a2d04ef74ada5f46586c`.
- Extracted installed renderer contains `打开会话资料`, `分支`, `运行`, `产物`, and `记忆`, and does not contain the permanent `["overview","概览"]` tuple.
- Strict deep codesign verification passed. SQLite `PRAGMA quick_check` returned `ok`; the user data directory was not replaced or removed.
- Only the superseded app archive created by this install, `.local/app-archive-20260717-175242`, was moved to Trash after verification; earlier archives were left untouched.
- Screenshots:
  - `joi-overview-tab-removal/02-four-tabs-installed.png`
  - `joi-overview-tab-removal/03-profile-from-header-installed.png`
  - `joi-overview-tab-removal/04-final-run-installed.png`
