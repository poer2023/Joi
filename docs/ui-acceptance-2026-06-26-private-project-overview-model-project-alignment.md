# Private Project Overview Alignment Contract

Date: 2026-06-26
Surface: `http://127.0.0.1:5173/`, `Joi` project private chat, right inspector Overview.

## Scope

- Fix visible alignment and hit-area defects in the private project overview header/editor area.
- Keep private chat overview separate from group chat overview.
- Add editable project/local association for the project private chat.
- Replace free-text model strategy with a model selector backed by saved/connected models.
- Keep model provider/API-key/model fetching configuration in Settings.

## Current Evidence

- Browser DOM measurement showed `.private-project-overview-panel`.
- Hidden avatar file input still occupied a `519px` wide layout box inside `.private-project-identity`, causing an invalid hit/layout footprint.
- Current private overview labels were `名称`, `描述`, `自述`, `规则`, `模型`.
- Current private overview incorrectly exposed `项目` only as a read-only metric and `版本` as a metric without user-facing action.
- `ListSavedModels` returned connected models including DeepSeek and xAI/Grok; current global settings were `xai_oauth / grok-4.3`.

## Acceptance

- The private overview must not include `群名` or `已加入成员`.
- The avatar upload input must have a zero layout footprint; only the avatar button can be visible/clickable.
- The avatar upload control must remain visible in the private overview header, left of the private-chat title. It must not participate in the field grid: `名称` itself must be a normal full-width field whose label/input align with `项目名`, `本地路径`, and the other private overview fields.
- Project association must be editable or link-like in the private overview; for this pass it should expose editable local project name/path fields.
- Version should not occupy main overview metric space unless it answers an actionable user question; move it to subtle metadata or remove it from the visible metrics.
- Model selection must use a native/select-like control listing saved connected models. The overview must not expose provider/API-key setup fields.
- A Settings affordance for model setup may be present, but actual model connection remains in Settings.

## Verification

- Browser DOM check for `Joi` private overview:
  - `hasGroupName === false`
  - `hasMembers === false`
  - `fileInputRect.width <= 1 && fileInputRect.height <= 1`
  - `名称` label and `项目关联` heading left edges differ by no more than 1px
  - `名称` input and project input left edges differ by no more than 1px
  - `名称` input and project input right edges differ by no more than 1px
  - avatar button exists inside the private overview header and is visually separate from `.private-project-name-field`
  - model control is a `select`
  - project name/path controls exist
- `pnpm --filter @joi/store test`
- `pnpm --dir apps/joi-desktop/frontend build`

## 2026-06-26 Alignment Follow-up

- Updated the private identity editor so the avatar upload is visible in the header while remaining outside the field grid, and `名称` is a full-width field.
- Browser DOM measurement on `http://127.0.0.1:5173/` after selecting `Joi`:
  - `labelToProject = 0`
  - `nameInputLeftToProject = 0`
  - `nameInputRightToProject = 0`
  - `nameInputWidthToProject = 0`
  - `.private-project-name-row` count is `0`
  - hidden avatar file input remains `1px x 1px`
- Avatar restore follow-up:
  - avatar button is inside `.private-project-overview-header`
  - avatar button is not inside `.private-project-name-field`
  - `nameInputLeftToProject = 0`
  - `nameInputRightToProject = 0`
- Evidence screenshot: `docs/ui-evidence-2026-06-26-private-project-overview-avatar-restored.jpg`.
