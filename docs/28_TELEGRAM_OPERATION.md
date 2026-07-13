# Telegram Operation

## Current State

Joi uses the dedicated Telegram bot `@claude2mebot` for private inbound text and proactive completion notifications.

- Current bot username: `claude2mebot`
- Supported mode: allow-listed private text chat and proactive rich-text delivery
- Unsupported: group chat, images, files, voice, buttons, WeChat
- Gateway boundary: Telegram Gateway only calls the Orchestrator API.

## Production Recommendation

Keep Joi on its dedicated bot. Store the token in macOS Keychain, keep private-user allow-listing enabled, and do not copy production IDs into source files, fixtures, screenshots, or shareable reports.

## Required Config

```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USER_IDS=<telegram-user-id>
PUBLIC_CONSOLE_URL=https://<stable-tunnel-or-domain>
ADMIN_TOKEN=...
```

Do not print bot tokens or admin tokens in logs.

## Allowlist

Only IDs in `TELEGRAM_ALLOWED_USER_IDS` can use the bot. Non-allowlisted private users receive a refusal. Group chats are refused.

## Trace URL

Replies include a Trace URL derived from `PUBLIC_CONSOLE_URL`. Do not use `localhost` for real Telegram use because the phone cannot open it.

## Message Formatting

Telegram Bot API 10.1 provides Rich Messages and GFM-compatible Rich Markdown, but clients released before Telegram's June 11, 2026 rich-text update can accept those messages and display an empty bubble. Joi therefore uses the broadly compatible regular `sendMessage` route with `parse_mode: "HTML"`. It translates the model's Markdown structure into Telegram's documented HTML subset while preserving paragraphs and line breaks; headings become bold text, lists retain their markers, quotes use `blockquote`, code uses `code`/`pre`, links remain links, and tables are preserved as aligned preformatted text.

Joi must not collapse source whitespace before delivery. An unformatted `sendMessage` fallback is allowed only after Telegram explicitly rejects the HTML-formatted message with HTTP 400/404; ambiguous network, timeout, rate-limit, or server failures must not cause a second send.

## Daily Command

`/joi_status` triggers Joi self-check through `system_health_check_v1` and returns a compact operations summary plus Trace link.

## Troubleshooting

- `Unauthorized`: confirm `TELEGRAM_ALLOWED_USER_IDS`.
- Trace link is localhost: set `PUBLIC_CONSOLE_URL`.
- Bot does not respond: check telegram-gateway logs and `getMe`.
- Run Trace lookup fails after enabling auth: ensure telegram-gateway has `ADMIN_TOKEN`.
