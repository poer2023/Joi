# UI Acceptance Contract

## Scope

- Project: Joi Desktop browser preview
- Target URL or app screen: `http://127.0.0.1:5173/`, chat header and composer
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`
- User job: fix the upload button placement/visual language and remove the useless lock button.

## Reference

- Primary reference: browser comments on `上传文件、图片或视频` and `锁定`.
- What to copy: the send button's compact square icon-button language.
- What not to copy: the current attachment button's separate low-left floating treatment or the `锁定` text button.

## Information Structure

- Must keep: file upload affordance and send affordance.
- Must remove: header `锁定` / `解除锁定` button.
- Must not remove: observe/inspector button, room identity, composer upload functionality.

## Visual Rules

- Attachment button is a 32px icon square with 8px radius, aligned to composer left bottom.
- Send button remains aligned to composer right bottom.
- Both composer action buttons use consistent dimensions, border radius, vertical alignment, and hover behavior.

## Verification

- Browser target: `http://127.0.0.1:5173/`
- Screenshot: `docs/ui-acceptance-2026-06-26-composer-upload-and-lock-cleanup.png`
- Required DOM checks:
  - `.route-lock-button` count is `0`.
  - Joi header text is `Joi · Joi Desktop · active` with only the inspector icon on the right.
  - `.composer-attachment-button` and `.send-button` both measure `32x32`.
  - Their bottom positions are aligned exactly: `bottomDelta = 0`, `topDelta = 0`.
- Console/network requirements: no browser console errors.
- Commands:

```bash
pnpm --dir apps/joi-desktop/frontend build
```

## Done Means

- [x] Lock button is gone from the chat header.
- [x] Upload button matches send button's control language.
- [x] Upload still opens through the same hidden file input.
- [x] Build and browser verification pass.
