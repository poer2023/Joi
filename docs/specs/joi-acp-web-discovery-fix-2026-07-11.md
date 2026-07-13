# Joi ACP web discovery fix — 2026-07-11

## Primary failure layer

The failed installed run `run_mrfe2uwvj81ts1` used `acp_codex_cli` with `gpt-5.6-terra[medium]`, but produced no tool run and incorrectly answered that Joi web tools were unavailable.

Codex `logs_2.sqlite` disproves an MCP startup or inventory failure for that run: `joi_web` initialized, `tools/list` returned `web_search` and `web_extract`, and the Terra turn listed `joi_web tool_count=2`. The active Codex feature set included `ToolSearchAlwaysDeferMcpTools`. The old Joi ACP system prompt used only the short names `web_search` and `web_extract`, so Terra did not discover the deferred schemas before answering.

The primary fix is therefore the discovery contract in `packages/runtime/src/acp.ts`:

- identify the full Codex tool names `mcp__joi_web__web_search` and `mcp__joi_web__web_extract`;
- tell the agent that MCP schemas may be deferred behind `tool_search`;
- require a `tool_search` discovery attempt for `joi_web web_search web_extract` before claiming the tools are unavailable;
- continue to prohibit substituting an unrelated Browser tool.

The installed live rerun `run_mrfefiur3vwk9m` validated this diagnosis without changing the model or provider: both `mcp.joi_web.web_search` and `mcp.joi_web.web_extract` succeeded. Search returned three Brave results and extract fetched an OpenAI documentation result through its final public URL with HTTP 200.

## Independent ACP 1.1.2 compatibility hardening

Codex ACP 1.1.2's session config conversion does not copy `McpServer.env`. This was not the primary cause of `run_mrfe2uwvj81ts1`, because that run did initialize and list the MCP tools. It is still a real latent failure for the eventual bridge call because the socket and bridge token previously existed only in the omitted per-server environment.

`apps/joi-electron/src/main/acp-web-bridge.ts` now writes only the socket path and random bridge token to an atomic, owner-only `0600` runtime descriptor. The MCP launch command uses `/usr/bin/env ELECTRON_RUN_AS_NODE=1 ... --bridge-config <path>`, so it does not depend on Codex ACP preserving `McpServer.env` and does not expose the token in process arguments. The MCP process rejects symlinked, non-owner, group/world-readable, oversized, or malformed descriptors.

`DISABLE_MCP_CONFIG_FILTERING=true` is forced only on the ACP provider child so the explicitly supplied, policy-controlled `joi_web` server cannot be silently shadowed by a same-name Codex configuration entry. Joi still passes only its two web tools and its compiled capability allowlist accepts only those exact server/tool pairs.

## Source live evidence

Reproducible entrypoint:

```text
node --experimental-strip-types apps/joi-electron/scripts/live-acp-web-e2e.mjs --out /tmp/joi-acp-web-live-evidence.json
```

Result:

```text
source_run_id: source_acp_web_a81a49b2dc0a49ecb233e888bcfbd878
ACP session: 019f4dc3-68ef-7392-bb7f-f358ba215ed3
provider: acp_codex_cli
requested/effective model: gpt-5.6-terra[medium]
mcp.joi_web.web_search: succeeded, DuckDuckGo mode, 3 results
mcp.joi_web.web_extract: succeeded, pinned public fetch, https://example.com/
final marker: JOI_ACP_WEB_E2E_OK
```

The source trace contains both ACP `tool_call`/`tool_call_update` sequences and both Joi bridge `started`/`completed` pairs. The matching Codex thread log records `listed MCP server tools ... server_name=joi_web tool_count=2` followed by calls to the full names.

## Regression gates

```text
pnpm test:runtime                                               PASS
pnpm test:electron-contract                                     PASS
pnpm --filter @joi/electron exec tsc -p tsconfig.json --noEmit  PASS
git diff --check                                                PASS
```

The ACP runtime fixture asserts that every Joi-web prompt contains both full tool names, the `tool_search` fallback query, and the rule forbidding an unavailable claim before discovery. The Electron bridge test launches the MCP specification with all `McpServer.env` entries deliberately absent and verifies a real bridge call through the owner-only descriptor.
