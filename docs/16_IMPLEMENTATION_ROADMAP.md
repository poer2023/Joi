# 16 实施路线图

本路线图按当前 Desktop-first 产品形态整理。早期 Docker/Postgres/NATS/Web Console 路线已经降级为 Server Mode，不再是本机默认交付路径。

## Completed Foundations

- Electron-native desktop shell.
- Controlled preload bridge.
- SQLite store and schema bootstrapping.
- Keychain-backed secret adapter.
- Shared React renderer embedded in Desktop.
- Run Trace and run events.
- Memory OS local persistence.
- Tool-calling runtime core.
- Workspace/file/web/diagnostics capability executors.
- Worker Gateway protocol.
- Telegram and iMessage inbound paths.
- Desktop package/install path for `/Applications/Joi.app`.

## Current P0

- Keep installed app launch/reopen behavior stable.
- Keep source of truth pinned to `/Users/hao/project/Joi`.
- Keep `/Users/hao/Documents/Joi` from being treated as source.
- Ensure package/install flow preserves `~/Library/Application Support/Joi`.
- Continue widening real-chain verification for Desktop chat, external handoff, Worker Gateway, diagnostics, backup/restore, and model provider settings.

## Next P1

- Move shared renderer source out of the historical `apps/joi-desktop/frontend` name when runtime parity risk is low.
- Add stronger installed-app smoke tests around close/reopen, renderer presence, and IPC availability.
- Harden external handoff visibility for Telegram/iMessage pending tasks.
- Broaden deterministic and real-model eval coverage for tool-calling turns.
- Improve diagnostics around Keychain, Worker Gateway, and external sidecars.

## Server Mode Backlog

- Web Console modernization.
- Postgres/NATS deployment hardening.
- Multi-worker high-concurrency scheduling.
- Managed Linux/server install path.

## Non-goals For Current Desktop P0

- No Docker/Postgres/NATS dependency for normal app startup.
- No full browser automation without explicit permission gates.
- No high-risk automatic execution.
- No multi-tenant SaaS.
