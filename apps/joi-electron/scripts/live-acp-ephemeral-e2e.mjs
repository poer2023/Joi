import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { compileACPProviderCapabilityAllowlist, runACPChatTurn } from '../../../packages/runtime/src/acp.ts';

const adapter = String(process.env.JOI_ACP_ADAPTER || '').trim()
  || join(process.env.HOME || '', 'Library/Application Support/Joi/plugins/joi.provider.codex-acp/node_modules/@agentclientprotocol/codex-acp/dist/index.js');
const launcher = String(process.env.JOI_ACP_EPHEMERAL_LAUNCHER || '').trim()
  || new URL('../resources/acp-ephemeral-launcher/index.mjs', import.meta.url).pathname;
if (!existsSync(adapter)) throw new Error(`codex-acp adapter not found: ${adapter}`);
if (!existsSync(launcher)) throw new Error(`ephemeral launcher not found: ${launcher}`);

const cleanupEvents = [];
const permissionProfile = String(process.env.JOI_ACP_PERMISSION_PROFILE || 'read_only').trim();
const prompt = String(process.env.JOI_ACP_PROMPT || 'Reply with exactly JOI_ACP_EPHEMERAL_OK.');
const systemMessage = String(process.env.JOI_ACP_SYSTEM_MESSAGE || 'Do not use tools. Reply with exactly JOI_ACP_EPHEMERAL_OK.');
const result = await runACPChatTurn({
  provider_id: 'acp_codex_cli',
  command: process.execPath,
  args: [launcher, adapter],
  cwd: process.cwd(),
  env: {
    ELECTRON_RUN_AS_NODE: '1',
    DISABLE_MCP_CONFIG_FILTERING: 'true',
    JOI_ACP_EPHEMERAL: '1',
  },
  timeout_seconds: 180,
  permission_profile: permissionProfile,
  capability_allowlist: compileACPProviderCapabilityAllowlist({
    permission_profile: permissionProfile,
    allowed_roots: [process.cwd()],
  }),
  model: process.env.JOI_ACP_MODEL || 'gpt-5.6-terra[medium]',
  ephemeral_session: true,
  system_message: systemMessage,
  messages: [{ role: 'user', content: prompt }],
  callbacks: {
    onModelDelta: (event) => {
      if (event.payload?.session_cleanup) cleanupEvents.push(event.payload.session_cleanup);
    },
  },
});

process.stdout.write(`${JSON.stringify({
  status: result.status,
  final_message: result.final_message,
  session_id: result.model_responses[0]?.session_id,
  requested_model: result.model_responses[0]?.requested_model,
  effective_model: result.model_responses[0]?.effective_model,
  permission_profile: permissionProfile,
  tool_results: result.tool_results,
  cleanup_events: cleanupEvents,
})}\n`);
