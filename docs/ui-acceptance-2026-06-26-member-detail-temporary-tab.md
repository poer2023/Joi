# UI Acceptance Contract

## Scope

- Project: Joi desktop frontend preview
- Target URL or app screen: `http://127.0.0.1:5173/`, right inspector overview member list
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`
- User job: open member details in a temporary top tab with a hover close button

## Reference

- Primary reference: user browser comment selecting the first joined-member row
- What to keep: fixed tabs (`概览`, `运行`, `线程`, `资产`, `记忆`), joined-member list, existing member detail content
- What to change: clicking a member opens a temporary member tab in the top tab bar instead of replacing overview in-place
- Follow-up reference: user selected the temporary `Gate` tab and required temporary tabs to sit to the right of all fixed tabs, with the close button vertically centered.

## Layout And Interaction Constraints

- The temporary tab should appear in the top tab bar when a member is selected.
- The temporary tab should appear after all fixed tabs: `概览`, `运行`, `线程`, `资产`, `记忆`, then the member tab.
- The temporary tab should become the selected tab and display the member detail page.
- The temporary tab should have a small close button that appears on hover or keyboard focus.
- The temporary tab close button should be vertically centered against the tab height.
- Closing the temporary tab should remove it and return to overview.
- The detail page should not need an in-page back button.

## Verification

- Browser target: `http://127.0.0.1:5173/`
- Required DOM checks: click member row, temporary tab appears after fixed tabs and is selected; hover/focus exposes close button; close button center aligns with tab center; close returns to overview and removes tab
- Console/network requirements: no console errors from the edited surface
- Commands: `pnpm --dir apps/joi-desktop/frontend build`

## Done Means

- [x] Member click opens a temporary top tab.
- [x] Temporary tab renders the member detail page.
- [x] Temporary tab close button appears on hover/focus.
- [x] Closing the tab returns to overview and removes the temporary tab.
- [x] Build and browser verification pass.
- [x] Temporary member tab appears to the right of all fixed tabs.
- [x] Temporary member tab close button is vertically centered.
