# Joi Sidebar And Settings Title Cleanup Acceptance

- [x] Chat sidebar footer removes the green status dot while keeping avatar, user label, and settings button.
- [x] Chat room section labels such as `私人总群` and `项目人格私聊` are removed.
- [x] Settings sidebar footer status text and dot are removed.
- [x] Settings left category navigation and object navigation keep only primary labels.
- [x] Settings detail pages remove the redundant topbar title/description while keeping the actual detail content title.
- [x] Build completes.
- [x] In-app browser preview confirms the removed labels and dots are absent in chat and settings views.

Verified in the in-app browser at `http://127.0.0.1:5173/`: chat sidebar reports `railSectionTitleCount: 0` and `chatFooterStatusDotCount: 0`; settings reports `settingsSidebarFooterCount: 0`, `settingsSidebarStatusDotCount: 0`, `settingsMenuSmallCount: 0`, `settingsObjectSmallCount: 0`, and `settingsDetailTopbarCount: 0`.
