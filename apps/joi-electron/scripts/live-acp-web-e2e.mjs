import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compileACPProviderCapabilityAllowlist,
  runACPChatTurn,
} from '../../../packages/runtime/src/acp.ts';
import {
  executePublicWebExtract,
  executeWebResearch,
} from '../../../packages/runtime/src/capabilities.ts';
import {
  acpWebBridgeToken,
  createACPWebMCPServer,
} from '../src/main/acp-web-bridge.ts';
import {
  startJoiCommandHost,
  stopJoiCommandHost,
} from '../src/main/command-host.ts';

const cwd = process.cwd();
const sourceRunID = `source_acp_web_${randomUUID().replaceAll('-', '')}`;
const runtimeRoot = join(tmpdir(), sourceRunID);
// AF_UNIX paths are short on macOS; keep the socket out of the long system
// temporary-directory prefix so the kernel cannot silently truncate it.
const socketPath = join('/tmp', `jaw-${process.pid}-${sourceRunID.slice(-12)}.sock`);
const outputIndex = process.argv.indexOf('--out');
const outputPath = outputIndex >= 0 ? String(process.argv[outputIndex + 1] || '').trim() : '';
const agentPath = String(process.env.JOI_ACP_AGENT || '').trim()
  || join(process.env.HOME || '', 'Library/Application Support/Joi/plugins/joi.provider.codex-acp/node_modules/@agentclientprotocol/codex-acp/dist/index.js');
const settings = {
  allowed_roots: [cwd],
  default_root: cwd,
  browser_allowed_hosts: [],
  web_research_allow_private_hosts: false,
  web_search_provider: 'duckduckgo',
  file_analyze_max_bytes: 1_048_576,
  workspace_search_max_results: 100,
};
const trace = [];
let result;

process.env.JOI_CLI_SOCKET = socketPath;
const mcpServer = createACPWebMCPServer(runtimeRoot);
delete process.env.JOI_CLI_SOCKET;

try {
  await startJoiCommandHost({
    socketPath,
    handlers: {},
    acpWeb: {
      token: acpWebBridgeToken(),
      async execute({ capability, payload, request_id }) {
        trace.push({ type: 'bridge.started', capability, request_id });
        const output = capability === 'web_search'
          ? await executeWebResearch({ query: String(payload.query || ''), max_results: Number(payload.max_results || 5) }, settings)
          : await executePublicWebExtract({ url: String(payload.url || '') }, settings);
        trace.push({
          type: 'bridge.completed',
          capability,
          request_id,
          status: output.status,
          mode: output.mode,
          result_count: output.result_count,
          final_url: output.final_url,
        });
        return output;
      },
    },
    logger: { info() {}, warn() {}, error() {} },
  });

  result = await runACPChatTurn({
    provider_id: 'acp_codex_cli',
    command: process.execPath,
    args: [agentPath],
    cwd,
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      DISABLE_MCP_CONFIG_FILTERING: 'true',
    },
    model: 'gpt-5.6-terra[medium]',
    timeout_seconds: 180,
    permission_profile: 'read_only',
    mcp_servers: [mcpServer],
    capability_allowlist: compileACPProviderCapabilityAllowlist({
      permission_profile: 'read_only',
      allowed_roots: [cwd],
      trusted_mcp_tools: [
        { server: 'joi_web', tool: 'web_search' },
        { server: 'joi_web', tool: 'web_extract' },
      ],
    }),
    system_message: 'This is an end-to-end source verification. Use the requested Joi MCP tools and report only evidence returned by them.',
    messages: [{
      role: 'user',
      content: 'You must perform both steps: (1) call mcp__joi_web__web_search for "IANA Example Domain" with max_results 3; (2) call mcp__joi_web__web_extract for https://example.com/. If those MCP schemas are deferred, first call tool_search for "joi_web web_search web_extract". Then answer in one short line with the extracted page title and URL, ending with JOI_ACP_WEB_E2E_OK. Do not answer from memory and do not claim unavailable before tool_search.',
    }],
    callbacks: {
      onModelStarted: (event) => trace.push({ type: 'model.started', model: event.model }),
      onModelDelta: (event) => {
        const update = event.payload?.session_update;
        if (update?.sessionUpdate === 'available_commands_update') {
          trace.push({ type: 'acp.available_commands', command_count: update.availableCommands?.length || 0 });
        }
        if (update?.sessionUpdate === 'tool_call' || update?.sessionUpdate === 'tool_call_update') {
          trace.push({
            type: `acp.${update.sessionUpdate}`,
            tool_call_id: update.toolCallId,
            title: update.title,
            status: update.status,
          });
        }
      },
      onToolCallRequested: (event) => trace.push({ type: 'tool.requested', id: event.call.id, name: event.call.name }),
      onToolStarted: (event) => trace.push({ type: 'tool.started', id: event.call.id, name: event.call.name }),
      onToolCompleted: (event) => trace.push({ type: 'tool.completed', id: event.call.id, name: event.call.name, status: event.result.output.status }),
      onToolFailed: (event) => trace.push({ type: 'tool.failed', id: event.call.id, name: event.call.name }),
    },
  });

  const calledTools = result.tool_results.map((item) => item.name);
  if (!calledTools.some((name) => name === 'mcp.joi_web.web_search')) throw new Error('live ACP run did not call web_search');
  if (!calledTools.some((name) => name === 'mcp.joi_web.web_extract')) throw new Error('live ACP run did not call web_extract');
  if (!trace.some((event) => event.type === 'bridge.completed' && event.capability === 'web_search')) throw new Error('web_search did not reach the Joi bridge');
  if (!trace.some((event) => event.type === 'bridge.completed' && event.capability === 'web_extract')) throw new Error('web_extract did not reach the Joi bridge');
} finally {
  await stopJoiCommandHost(socketPath);
  await rm(runtimeRoot, { recursive: true, force: true });
}

const evidence = {
  source_run_id: sourceRunID,
  status: result?.status,
  final_message: result?.final_message,
  provider_id: result?.model_responses?.[0]?.provider_id,
  requested_model: result?.model_responses?.[0]?.requested_model,
  effective_model: result?.model_responses?.[0]?.effective_model,
  acp_session_id: result?.model_responses?.[0]?.session_id,
  tools: result?.tool_results?.map((item) => ({ call_id: item.call_id, name: item.name, status: item.output.status })),
  trace,
};
if (outputPath) await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence, null, 2));
