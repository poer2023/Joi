# Composer Attachments UI Acceptance

## Scope

- Project: Joi desktop frontend preview
- Target URL: `http://127.0.0.1:5173/`
- Surface: bottom chat composer

## Reference

- User selected the visible input mode group `Auto / Chat / Task / Bg`.
- Required change: remove the visible mode selector and support uploading files, images, and videos.

## Constraints

- No visible input mode buttons remain in the composer.
- Composer has one icon button for choosing local files.
- File input accepts multiple selections and does not visually occupy layout space.
- Selected attachments render as compact chips with image/video previews when available.
- Each selected attachment can be removed before sending.
- Sending is enabled when either text or at least one attachment exists.
- Attachment metadata is included in `SendChat` and persisted by the local store message attachment field.
- Composer layout must not overlap the send button or clip attachment chips.

## Done Means

- [x] Mode selector group is gone from the browser preview.
- [x] Upload button is visible and accessible by label/title.
- [x] Multiple image/video/file selections render as attachment chips.
- [x] Remove button deletes a selected attachment.
- [x] Textless attachment send is allowed.
- [x] `pnpm --dir apps/joi-desktop/frontend build` passes.
- [x] Browser preview verifies layout and console has no errors.
