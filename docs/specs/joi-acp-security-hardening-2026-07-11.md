# Joi ACP security hardening verification — 2026-07-11

Scope: the ACP provider boundary in the source tree only. No installed app, Joi production database, Keychain item, or production channel configuration was modified.

## Security contract

- ACP child processes receive a minimal environment. Joi/API/channel secrets and unknown provider variables are not inherited. Local Codex account authentication remains available through the user home and Codex home/path settings; proxy URLs containing credentials are rejected.
- Permission decisions require a host-compiled capability entry. An agent-provided `kind` or `title` is display metadata, not authority.
- MCP approval is correlated by `toolCallId` and requires the structured `server`, `tool`, arguments, MCP marker, and the exact compiled server/tool grant. Joi currently grants only `joi_web.web_search` and `joi_web.web_extract` from this bridge.
- File reads/writes and requested filesystem permissions require concrete paths inside a compiled workspace root. Symlink-resolved escapes and sensitive paths such as `.env`, `.ssh`, `.codex`, Keychains, and Git credential configuration are rejected. Delete operations remain denied.
- Command approval requires a concrete command and cwd. Read-only commands use a narrow executable/argument policy; test/build commands additionally require `workspace_write`. Shell control operators, substitutions, traversal, dangerous executables, and unknown commands are rejected.
- A denial never falls back to the first permission option. If the agent supplies no reject option, Joi returns `cancelled`.
- Raw ACP stderr is neither retained nor returned. Failures expose only a structured summary containing exit state, byte/line/chunk counts, truncation state, and non-content categories.

## Regression evidence

Targeted ACP tests cover:

- inherited and provider-supplied secret environment variables are absent while `ELECTRON_RUN_AS_NODE` remains available;
- a child that writes API keys and Telegram-like tokens to stderr fails without those values appearing in `error_summary`;
- exact Joi web capability succeeds, while spoofed title, unknown MCP tool, and invalid extra arguments fail;
- workspace read succeeds only in scope; workspace write and test commands require `workspace_write` and remain scoped;
- outside-root writes, `rm -rf`, unknown `other`, network permission, and allow-only denial paths fail closed.

Verification commands and results:

```text
pnpm test:runtime                                               PASS
pnpm test:electron-contract                                     PASS
pnpm --filter @joi/electron exec tsc -p tsconfig.json --noEmit  PASS
git diff --check                                                PASS
```

A read-only live handshake using the hardened environment completed against the installed Codex ACP package:

```json
{
  "ok": true,
  "status": "ready",
  "agent_name": "Codex",
  "agent_version": "1.1.2",
  "model_count": 33,
  "terra_medium": true
}
```
