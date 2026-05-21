# Telegram Operation

## Current State

Joi currently reuses the existing OpenClaw Telegram bot as a temporary RC0 operations shortcut.

- Current bot username: `dybz2bot`
- Supported mode: private text chat only
- Unsupported: group chat, images, files, voice, buttons, WeChat
- Gateway boundary: Telegram Gateway only calls the Orchestrator API.

## Production Recommendation

Before production use, migrate to a Joi-specific Telegram bot. Reusing the OpenClaw bot mixes operational ownership, logs, and user expectations.

## Required Config

```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USER_IDS=7991996397
PUBLIC_CONSOLE_URL=https://<stable-tunnel-or-domain>
ADMIN_TOKEN=...
```

Do not print bot tokens or admin tokens in logs.

## Allowlist

Only IDs in `TELEGRAM_ALLOWED_USER_IDS` can use the bot. Non-allowlisted private users receive a refusal. Group chats are refused.

## Trace URL

Replies include a Trace URL derived from `PUBLIC_CONSOLE_URL`. Do not use `localhost` for real Telegram use because the phone cannot open it.

## Daily Command

`/joi_status` triggers Joi self-check through `system_health_check_v1` and returns a compact operations summary plus Trace link.

## Troubleshooting

- `Unauthorized`: confirm `TELEGRAM_ALLOWED_USER_IDS`.
- Trace link is localhost: set `PUBLIC_CONSOLE_URL`.
- Bot does not respond: check telegram-gateway logs and `getMe`.
- Run Trace lookup fails after enabling auth: ensure telegram-gateway has `ADMIN_TOKEN`.
