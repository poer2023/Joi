# Joi automation Telegram notification UI acceptance

Date: 2026-07-11

## Scope

- Project: `/Users/hao/project/Joi`
- Target screen: Joi Desktop → 设置 → 自动化 → 新建/编辑定时任务或外部触发任务
- Files: `apps/joi-desktop/frontend/src/App.tsx` plus one focused UI-state test
- User job: explicitly opt an automation into a Telegram completion push without editing JSON or SQLite.

## Current reference

- Preserve the installed app's current single-column form: name → schedule/webhook fields → task description → save/actions.
- Add notification controls inside that same form, immediately after task description and before save/actions.
- Do not add a new settings category, modal, notification center, or broad layout/style refactor.

## Information and interaction contract

- Checkbox label: `完成后推送到 Telegram`.
- When enabled and Telegram is ready, show one optional `目标用户 / Chat ID` text field.
- Default the target to the first configured `telegram_allowed_user_ids` entry; blank continues to mean the first allow-listed ID.
- Saving must persist an explicit `notification_policy` with Telegram success delivery and the optional target.
- Editing an existing automation must restore the checkbox and target from `notification_policy`.
- If Telegram is disabled or no allow-list exists, keep the checkbox disabled and show one concise reason plus the route to `设置 → 聊天入口 → Telegram`.
- Never show, request, or persist the bot token in this form.

## Visual rules

- Reuse existing `settings-form`, `checkbox-row`, field label/input, hint, and error/disabled styles.
- Keep existing density, typography, border, and button treatment.
- Normal desktop width and the existing 560 px minimum window must keep every control reachable without horizontal clipping.

## Verification

- Focused state test: new automation defaults, existing-policy hydration, saved policy shape, disabled/readiness copy.
- `pnpm --filter @joi/electron exec tsc --noEmit` and frontend build/contract checks.
- Visual check in Joi Desktop/dev UI at normal and narrow window widths; required text and field visibility must be present with no console error.

## Done means

- [x] The two controls appear only in the existing automation detail form.
- [x] Empty policy remains no-send; enabled policy persists Telegram success delivery explicitly.
- [x] Target defaults safely to the configured allow-list and cannot imply an arbitrary unallow-listed destination.
- [x] Disabled/readiness copy is visible before the user presses Save.
- [x] Normal and narrow UI checks pass without clipping or unrelated visual changes.
