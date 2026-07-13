# Member Tab Width And Room Title Save UI Acceptance

## Reference

- Temporary member tab appears to the right of fixed inspector tabs.
- Overview room name input should persist edits and update related room surfaces.

## Scope

- Temporary member tab must use the same 40px visual width as fixed inspector tabs.
- The hover close button may overlap the member tab label.
- Browser preview room title edits must update Overview, chat header, sidebar row, and conversation-derived data.
- Browser preview room title edits must survive reloads in the same browser profile.

## Forbidden Changes

- Do not reintroduce a fixed top-level member category.
- Do not widen fixed inspector tabs or add extra text affordances.
- Do not move run/thread/asset/memory tabs.

## Verification

- Open a member detail tab and compare `#right-inspector-tab-member` width with the fixed tabs.
- Edit the Overview room title, blur outside the input, and verify:
  - input value equals the new title
  - Overview heading equals the new title
  - chat header includes the new title
  - active sidebar row includes the new title
- Reload and verify the browser-preview title remains the new title.

## Result

- `pnpm --dir apps/joi-desktop/frontend build` passed.
- `git diff --check` passed.
- Browser DOM after editing title to `私人总群保存9956`:
  - before reload: input, Overview heading, chat header, and active sidebar row all showed the new title.
  - after reload: input, Overview heading, chat header, and active sidebar row still showed the new title.
- Browser DOM after opening Joi member detail:
  - fixed tab widths: `40, 40, 40, 40, 40`
  - `#right-inspector-tab-member` width: `40`
  - close button vertical center delta: `0`
  - browser console errors: none
