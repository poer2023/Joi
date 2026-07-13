# Joi ACP ephemeral session acceptance — 2026-07-11

## Bug

Every Joi `codex-acp` request created a normal Codex thread. Because the request prompt begins with `You are running as a delegated ACP coding agent inside Joi Desktop`, Codex Desktop showed 19 internal execution threads in its sidebar.

## Acceptance contract

1. A new Joi Codex ACP call must use an app-server `thread/start` request with `ephemeral: true`.
2. Success, provider inspection, failure, timeout, and cancellation must release the ACP session and child process.
3. A successful real `gpt-5.6-terra[medium]` call must return its answer without creating a row in `~/.codex/state_5.sqlite`.
4. Existing polluted threads may be archived, but not deleted.
5. The same behavior must be proven from `/Applications/Joi.app`, not only the source runtime.

## Implementation

- `apps/joi-electron/resources/acp-ephemeral-launcher/index.mjs` applies one fail-closed compatibility patch to the pinned `codex-acp` bundle. It injects `ephemeral: process.env.JOI_ACP_EPHEMERAL !== "0"` into the adapter's single `threadStart` call. An upstream shape mismatch aborts instead of silently creating a normal thread.
- `apps/joi-electron/src/main/plugin-manager.ts` routes only `acp_codex_cli` through that packaged launcher and sets `JOI_ACP_EPHEMERAL=1`.
- `packages/runtime/src/acp.ts` closes every opened ACP session in `finally`, including provider inspection, failure, and cancellation. Cancellation waits for the ACP cancel notification before release.
- The runtime uses ACP SDK `1.2.1` session close/config APIs and retains the Joi model ID form `model[reasoning_effort]` over ACP `configOptions`.

## Evidence

- Runtime and contract suites passed, including lifecycle parity (`new == close`), cancellation, launcher exact-match and cache tests.
- Source live calls:
  - `019f4f43-b15a-74b0-a490-1ce5965055a7` -> `JOI_ACP_EPHEMERAL_OK`
  - `019f4f44-5948-7ea3-a621-be9753ac457f` -> `JOI_ACP_EPHEMERAL_OK`
  - both session IDs had zero rows in `state_5.sqlite`; the second call reported no cleanup error.
- Existing pollution: `visible_prefix=0`, `archived_prefix=19`; all 19 were archived through Codex thread APIs, not deleted.
- Installed app:
  - packaged launcher present at `/Applications/Joi.app/Contents/Resources/acp-ephemeral-launcher/index.mjs`
  - health: SQLite ready, Electron running
  - selected route: `acp_codex_cli / gpt-5.6-terra[medium] / medium`
  - installed run `run_mrftqs852ihzxo` succeeded with `JOI_INSTALLED_EPHEMERAL_OK`
  - Codex visible prefix count stayed `0 -> 0`

## Failure-layer note

The Codex Desktop wrapper used for bulk archive applied 11 archive writes but did not finish its response stream. The failure layer was the wrapper tooling, not persistence. The remaining eight archives were sent through the same local Codex app-server `thread/archive` API and verified read-only from SQLite.
