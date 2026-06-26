# Joi Sidebar Footer Settings Restore Acceptance

- [x] Chat sidebar top controls contain only create, search, and collapse/expand.
- [x] Settings is moved to the chat sidebar footer.
- [x] Chat sidebar footer restores the self avatar and user label.
- [x] Footer status dot and settings button align at the bottom using the existing footer styling.
- [x] Build completes.
- [x] Browser preview confirms the top settings button is absent and the footer settings button is present.

Verified in the in-app browser at `http://127.0.0.1:5173/`: top controls expose 3 buttons, `topSettingsCount` is `0`, `.sidebar-footer` is present, `.footer-settings-button` count is `1`, and the footer settings button opens settings then returns to chat.
