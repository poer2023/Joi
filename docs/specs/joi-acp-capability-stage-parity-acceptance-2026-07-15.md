# Joi ACP Capability and Stage Parity Acceptance

## Scope

- Project: Joi Desktop
- Target: ACP-backed chat and automation runs rendered in `/Applications/Joi.app`
- Baseline: the selected Agent can declare workspace, file, UI-observation, browser-observation, and health capabilities, but the ACP session currently receives only `joi_web.web_search` and `joi_web.web_extract`.
- User job: see what Joi prepared and executed, use the selected Agent's effective safe capabilities, and distinguish a partially failed tool call from a failed run.

## Gate 0 — Current Truth and Safety Boundary

- Keep the existing `joi_web` MCP names for prompt and automation compatibility.
- Preserve the selected Agent capability scope; do not expose capabilities that the Agent does not own.
- Only bridge implemented capabilities that compile under the read-only policy without confirmation.
- Do not expose workspace writes, UI actions, browser clicks/types, planned backends, raw secrets, or unrestricted shell execution through this change.
- Keep raw ACP/provider events in Run Trace instead of dumping them into the conversation.

## Gate 1 — Effective ACP Capability Bridge

- Add a scoped `joi_capabilities` MCP server beside `joi_web` when the selected Agent has eligible capabilities.
- Generate the MCP schema from Joi's canonical capability compiler, not from a second handwritten capability catalog.
- Bind every bridge descriptor to an owner-only token whose server-side grant contains the exact capability names and read-only permission profile.
- Reject a valid token used with a capability outside its grant.
- Continue executing through Joi's existing capability runtime so registry enablement, workspace roots, policy checks, logging, and Run Trace remain authoritative.
- Tell the ACP agent the exact full MCP names and the required `tool_search` discovery path.

## Gate 2 — Semantic Stages and Mixed Outcome

- Emit a compact, user-visible “prepared” stage with the effective delegated capability count.
- Emit a compact “verified” stage with distinct tool success/failure counts.
- A terminal successful run remains completed when one or more individual tools failed; the failure count remains visible in the collapsed execution summary.
- A terminal failed/cancelled run still wins over individual tool success.
- Generic completed model progress remains hidden; only explicitly user-visible semantic stage summaries are retained in the conversation.

## Visual and Interaction Contract

- Reuse the existing Codex-aligned execution disclosure; do not add a new card or second trace surface.
- Prepared/verified stages are short text rows inside the same disclosure and remain collapsed with historical work.
- Individual failed calls keep their red status and expandable details without turning the whole disclosure into a failed run.
- Historical execution starts collapsed; live execution keeps its existing stable expansion behavior.

## Verification

- Unit/contract coverage:
  - scoped MCP tool listing and invocation;
  - out-of-grant capability rejection;
  - ACP prompt discovery instructions;
  - completed run plus failed tool projects as completed with a failure count;
  - terminal run failure still projects as failed;
  - user-visible semantic stages render while generic completed thinking stays hidden.
- Build the affected runtime, Electron, store, and frontend packages.
- Rebuild and replace `/Applications/Joi.app` only after tests and package validation pass.
- Preserve `~/Library/Application Support/Joi` and cold-open the installed app.
- Visually verify one mixed-outcome execution disclosure and the new semantic stages in the installed app.

## Non-goals

- Implementing all planned capabilities or new external backends.
- Exposing write or interaction tools before ACP approval correlation is implemented.
- Showing private chain-of-thought or every ACP session notification.
- Replacing the current Run Trace or execution disclosure design.

## Done Means

- [x] ACP receives the selected Agent's eligible implemented read-only Joi capabilities, not only web search/read.
- [x] Capability grants are exact, owner-only, and server-side enforced.
- [x] Prepared and verified semantic stages are persisted and visible compactly.
- [x] Mixed tool outcomes no longer mark a successful run as failed.
- [x] Targeted tests and production builds pass.
- [x] The installed `/Applications/Joi.app` is signed, cold-opened, and visibly verified without losing user data.

Verified on 2026-07-15 against installed PID `75363`. Installed run `run_mrm97t9cm16kec` discovered and successfully invoked `mcp__joi_capabilities__system_health_check` and `mcp__joi_capabilities__workspace_search`; the expanded execution disclosure showed `能力已就绪 · 已准备 22 项 Joi 能力` and `结果已核对 · 执行完成 · 2 项成功`. Historical run `run_mrlg3x22vio8fj` remained completed while exposing `2 项失败`. Code signing and `joi health --compact --no-start` passed with SQLite and Electron running.
