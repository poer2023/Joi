import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildACPChildEnvironment,
  compileACPProviderCapabilityAllowlist,
  extractACPSystemErrorNotice,
  inspectACPProvider,
  runACPChatTurn,
  safeACPErrorMessage,
} from '../src/acp.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fakeAgent = join(here, 'fixtures', 'fake-acp-agent.mjs');
const lifecycleDir = await mkdtemp(join(tmpdir(), 'joi-acp-lifecycle-'));
const lifecycleMarker = join(lifecycleDir, 'events.jsonl');
const agentArgs = (...args) => [fakeAgent, '--lifecycle-marker', lifecycleMarker, ...args];
const config = {
  provider_id: 'fake-acp',
  command: process.execPath,
  args: agentArgs(),
  cwd: process.cwd(),
  timeout_seconds: 10,
  permission_profile: 'read_only',
  capability_allowlist: compileACPProviderCapabilityAllowlist({
    permission_profile: 'read_only',
    allowed_roots: [process.cwd()],
    trusted_mcp_tools: [
      { server: 'joi_web', tool: 'web_search' },
      { server: 'joi_web', tool: 'web_extract' },
    ],
  }),
  ephemeral_session: true,
};

assert.equal(safeACPErrorMessage({ message: 'direct structured message', code: 'DIRECT' }), 'direct structured message');
assert.equal(safeACPErrorMessage({ error: { message: 'nested provider message' }, code: 'NESTED' }), 'nested provider message');
assert.equal(safeACPErrorMessage({ code: 'USAGE_LIMIT' }), 'USAGE_LIMIT');
const fallbackObject = { reason: 'bounded JSON fallback', token: 'secret-value', stderr: 'raw-provider-stderr' };
const fallbackMessage = safeACPErrorMessage(fallbackObject);
assert.match(fallbackMessage, /bounded JSON fallback/);
assert.match(fallbackMessage, /\[REDACTED\]/);
assert.match(fallbackMessage, /\[REDACTED STDERR\]/);
assert.doesNotMatch(fallbackMessage, /secret-value|raw-provider-stderr|\[object Object\]/);
const circularError = { reason: 'cycle-safe' };
circularError.self = circularError;
assert.match(safeACPErrorMessage(circularError), /cycle-safe/);
assert.match(safeACPErrorMessage(circularError), /circular/);
const deepError = { payload: { next: { next: { next: { secret: 'too-deep' } } } }, detail: 'x'.repeat(10_000) };
const boundedMessage = safeACPErrorMessage(deepError);
assert(boundedMessage.length <= 4_096);
assert.match(boundedMessage, /max-depth/);
assert.doesNotMatch(boundedMessage, /too-deep/);
let getterRead = false;
const accessorError = {};
Object.defineProperty(accessorError, 'message', { get() { getterRead = true; return 'unsafe getter'; }, enumerable: true });
assert.doesNotMatch(safeACPErrorMessage(accessorError), /unsafe getter/);
assert.equal(getterRead, false, 'ACP error normalization must not invoke unknown getters');
const usageLimitNotice = "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 6:28 AM.";
assert.equal(extractACPSystemErrorNotice(`${usageLimitNotice}\n\n`), usageLimitNotice);

const sanitizedEnv = buildACPChildEnvironment(
  { ELECTRON_RUN_AS_NODE: '1', JOI_ACP_EPHEMERAL: '1', JOI_TEST_CONFIG_SECRET: 'config-secret' },
  { HOME: process.env.HOME, PATH: process.env.PATH, JOI_TEST_PARENT_SECRET: 'parent-secret', OPENAI_API_KEY: 'sk-parent-secret' },
);
assert.equal(sanitizedEnv.ELECTRON_RUN_AS_NODE, '1');
assert.equal(sanitizedEnv.JOI_ACP_EPHEMERAL, '1');
assert.equal(sanitizedEnv.JOI_TEST_CONFIG_SECRET, undefined);
assert.equal(sanitizedEnv.JOI_TEST_PARENT_SECRET, undefined);
assert.equal(sanitizedEnv.OPENAI_API_KEY, undefined);

const originalParentSecret = process.env.JOI_TEST_PARENT_SECRET;
process.env.JOI_TEST_PARENT_SECRET = 'parent-secret-must-not-leak';
const minimalEnvInspection = await inspectACPProvider({
  ...config,
  args: agentArgs('--assert-minimal-env'),
  env: { ELECTRON_RUN_AS_NODE: '1', JOI_TEST_CONFIG_SECRET: 'config-secret-must-not-leak' },
});
if (originalParentSecret === undefined) delete process.env.JOI_TEST_PARENT_SECRET;
else process.env.JOI_TEST_PARENT_SECRET = originalParentSecret;
assert.equal(minimalEnvInspection.ok, true, minimalEnvInspection.error_summary);

const failedInspection = await inspectACPProvider({ ...config, args: agentArgs('--fail-with-secret') });
assert.equal(failedInspection.ok, false);
assert.match(failedInspection.error_summary || '', /ACP (process failure|stderr summary)/);
assert.match(failedInspection.error_summary || '', /sensitive_content_redacted/);
assert.doesNotMatch(failedInspection.error_summary || '', /super-secret|123456789:top-secret|sk-test/);

const inspection = await inspectACPProvider(config);
assert.equal(inspection.ok, true, inspection.error_summary);
assert.equal(inspection.agent_name, 'Fake ACP Agent');
assert.equal(inspection.current_model, 'fake-model[low]');
assert.deepEqual(inspection.models.map((model) => model.id), ['fake-model[low]', 'fake-model[medium]']);

const events = [];
const result = await runACPChatTurn({
  ...config,
  model: 'fake-model[medium]',
  mcp_servers: [{
    name: 'joi_web',
    command: process.execPath,
    args: ['fake-mcp.mjs'],
    env: [],
  }, {
    name: 'joi_capabilities',
    command: process.execPath,
    args: ['fake-capabilities-mcp.mjs'],
    env: [],
  }],
  joi_capability_tools: ['workspace_search', 'file_read'],
  system_message: 'Keep output exact.',
  messages: [{ role: 'user', content: 'Return the smoke marker.' }],
  callbacks: {
    onAssistantDelta: (event) => events.push(['delta', event.text]),
    onAssistantCompleted: (event) => events.push(['completed', event.text]),
    onModelStarted: (event) => events.push(['model', event.model]),
    onModelDelta: (event) => events.push(['model-delta', event.payload]),
    onToolCallRequested: (event) => events.push(['tool', event.call.name]),
    onToolCompleted: (event) => events.push(['tool-completed', event.call.name]),
    onEvent: (event) => events.push(['kernel-event', event]),
  },
});
assert.equal(result.status, 'completed');
assert.equal(result.final_message, 'FAKE_ACP_OK');
assert.equal(result.usage.input_tokens, 14);
assert.equal(result.usage.cached_input_tokens, 4);
assert.equal(result.usage.output_tokens, 3);
assert.equal(result.usage.total_tokens, 17);
assert.equal(result.tool_results[0]?.output.status, 'succeeded');
assert.deepEqual(result.tool_results[0]?.output.raw_output?.mcp_server_names, ['joi_web', 'joi_capabilities']);
assert.equal(result.tool_results[0]?.output.raw_output?.prompt_has_full_joi_web_names, true);
assert.equal(result.tool_results[0]?.output.raw_output?.prompt_has_tool_search_fallback, true);
assert.equal(result.tool_results[0]?.output.raw_output?.prompt_has_joi_capability_names, true);
assert.equal(result.tool_results[0]?.output.raw_output?.prompt_has_joi_capability_discovery, true);
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-joi-web')?.output.status, 'succeeded');
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-unknown-mcp')?.output.status, 'policy_blocked');
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-spoofed-web-title')?.output.status, 'policy_blocked');
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-web-bad-args')?.output.status, 'policy_blocked');
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-workspace-write')?.output.status, 'policy_blocked');
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-outside-write')?.output.status, 'policy_blocked');
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-delete-diff')?.output.status, 'policy_blocked');
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-safe-command')?.output.status, 'succeeded');
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-test-command')?.output.status, 'policy_blocked');
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-dangerous-command')?.output.status, 'policy_blocked');
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-wrapped-dangerous-command')?.output.status, 'policy_blocked');
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-test-command-smuggle')?.output.status, 'policy_blocked');
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-permission-read')?.output.status, 'succeeded');
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-permission-outside-write')?.output.status, 'policy_blocked');
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-permission-network')?.output.status, 'policy_blocked');
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-no-reject-option')?.output.status, 'policy_blocked');
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-read')?.output.capability, 'file_read');
assert.equal(result.tool_results.find((tool) => tool.call_id === 'fake-read')?.output.policy_allowed, true);
assert(Number(result.tool_results.find((tool) => tool.call_id === 'fake-read')?.output.duration_ms) >= 1);
assert.match(String(result.tool_results.find((tool) => tool.call_id === 'fake-dangerous-command')?.output.error), /command_/);
assert.equal(result.model_responses[0]?.requested_model, 'fake-model[medium]');
assert.equal(result.model_responses[0]?.effective_model, 'fake-model[medium]');
assert(events.some(([type, model]) => type === 'model' && model === 'fake-model[medium]'));
assert(events.some(([type, payload]) => type === 'model-delta' && payload.model_selection?.effective_model === 'fake-model[medium]'));
assert(events.some(([type]) => type === 'tool-completed'));
const semanticEvents = events.filter(([type]) => type === 'kernel-event').map(([, event]) => event);
assert.equal(semanticEvents.find((event) => event.detail?.phase === 'prepared')?.detail?.capability_count, 4);
assert(semanticEvents.some((event) => event.detail?.phase === 'verified' && event.detail.failed_tool_count > 0));
assert.deepEqual(
  events.filter(([type]) => type === 'delta' || type === 'completed'),
  [
    ['delta', 'FAKE_ACP_OK'],
    ['completed', 'FAKE_ACP_OK'],
  ],
);
assert(events.findIndex(([type]) => type === 'delta') > events.findIndex(([type]) => type === 'tool-completed'));

let steeringClaims = 0;
let followUpClaims = 0;
const queueEvents = [];
const queuedResult = await runACPChatTurn({
  ...config,
  model: 'fake-model[medium]',
  system_message: 'Keep output exact.',
  messages: [{ role: 'user', content: 'Start one visible run.' }],
  getSteeringMessages: () => {
    steeringClaims += 1;
    return steeringClaims === 1 ? [{ id: 'queue-steer', kind: 'steering', content: 'Apply this steering message in the same run.' }] : [];
  },
  getFollowUpMessages: () => {
    followUpClaims += 1;
    return followUpClaims === 1 ? [{ id: 'queue-follow', kind: 'follow_up', content: 'Now process the queued follow-up in the same run.' }] : [];
  },
  callbacks: { onEvent: (event) => queueEvents.push(event) },
});
assert.equal(queuedResult.status, 'completed');
assert.equal(queuedResult.final_message, 'FAKE_ACP_OK\n\nFAKE_ACP_OK\n\nFAKE_ACP_OK');
assert.equal(queueEvents.filter((event) => event.type === 'run.message_queue_drained').length, 2);
assert.equal(steeringClaims, 3);
assert.equal(followUpClaims, 2);

const workspaceWriteResult = await runACPChatTurn({
  ...config,
  permission_profile: 'workspace_write',
  capability_allowlist: compileACPProviderCapabilityAllowlist({
    permission_profile: 'workspace_write',
    allowed_roots: [process.cwd()],
    trusted_mcp_tools: [{ server: 'joi_web', tool: 'web_search' }],
  }),
  model: 'fake-model[medium]',
  system_message: 'Keep output exact.',
  messages: [{ role: 'user', content: 'Exercise workspace-write permission policy.' }],
});
assert.equal(workspaceWriteResult.tool_results.find((tool) => tool.call_id === 'fake-workspace-write')?.output.status, 'succeeded');
assert.equal(workspaceWriteResult.tool_results.find((tool) => tool.call_id === 'fake-outside-write')?.output.status, 'policy_blocked');
assert.equal(workspaceWriteResult.tool_results.find((tool) => tool.call_id === 'fake-delete-diff')?.output.status, 'policy_blocked');
assert.equal(workspaceWriteResult.tool_results.find((tool) => tool.call_id === 'fake-test-command')?.output.status, 'succeeded');
assert.equal(workspaceWriteResult.tool_results.find((tool) => tool.call_id === 'fake-dangerous-command')?.output.status, 'policy_blocked');
assert.equal(workspaceWriteResult.tool_results.find((tool) => tool.call_id === 'fake-wrapped-dangerous-command')?.output.status, 'policy_blocked');
assert.equal(workspaceWriteResult.tool_results.find((tool) => tool.call_id === 'fake-test-command-smuggle')?.output.status, 'policy_blocked');
assert.equal(workspaceWriteResult.tool_results.find((tool) => tool.call_id === 'fake-permission-read')?.output.status, 'succeeded');
assert.equal(workspaceWriteResult.tool_results.find((tool) => tool.call_id === 'fake-permission-outside-write')?.output.status, 'policy_blocked');
assert.equal(workspaceWriteResult.tool_results.find((tool) => tool.call_id === 'fake-permission-network')?.output.status, 'policy_blocked');

const fullAccessEvents = [];
const fullAccessResult = await runACPChatTurn({
  ...config,
  permission_profile: 'danger_full_access',
  capability_allowlist: compileACPProviderCapabilityAllowlist({
    permission_profile: 'danger_full_access',
    allowed_roots: [process.cwd()],
    trusted_mcp_tools: [{ server: 'joi_web', tool: 'web_search' }],
  }),
  model: 'fake-model[medium]',
  system_message: 'Keep output exact.',
  messages: [{ role: 'user', content: 'Exercise full-access blacklist policy.' }],
  callbacks: {
    onModelDelta: (event) => fullAccessEvents.push(event.payload),
  },
});
assert.equal(fullAccessResult.tool_results.find((tool) => tool.call_id === 'fake-workspace-write')?.output.status, 'succeeded');
assert.equal(fullAccessResult.tool_results.find((tool) => tool.call_id === 'fake-outside-write')?.output.status, 'succeeded');
assert.equal(fullAccessResult.tool_results.find((tool) => tool.call_id === 'fake-delete-diff')?.output.status, 'succeeded');
assert.equal(fullAccessResult.tool_results.find((tool) => tool.call_id === 'fake-safe-command')?.output.status, 'succeeded');
assert.equal(fullAccessResult.tool_results.find((tool) => tool.call_id === 'fake-test-command')?.output.status, 'succeeded');
assert.equal(fullAccessResult.tool_results.find((tool) => tool.call_id === 'fake-dangerous-command')?.output.status, 'policy_blocked');
assert.equal(fullAccessResult.tool_results.find((tool) => tool.call_id === 'fake-wrapped-dangerous-command')?.output.status, 'policy_blocked');
assert.match(String(fullAccessResult.tool_results.find((tool) => tool.call_id === 'fake-dangerous-command')?.output.error), /command_blacklisted_by_full_access_blacklist_v1/);
assert.equal(fullAccessResult.tool_results.find((tool) => tool.call_id === 'fake-permission-read')?.output.status, 'succeeded');
assert.equal(fullAccessResult.tool_results.find((tool) => tool.call_id === 'fake-permission-outside-write')?.output.status, 'succeeded');
assert.equal(fullAccessResult.tool_results.find((tool) => tool.call_id === 'fake-permission-network')?.output.status, 'succeeded');
assert(fullAccessEvents.some((payload) => payload.permission_mode?.effective_mode === 'agent-full-access'));
assert(fullAccessEvents.some((payload) => payload.permission_mode?.command_policy === 'full_access_blacklist_v1'));

let streamedUsageLimit = '';
await assert.rejects(
  runACPChatTurn({
    ...config,
    args: agentArgs('--usage-limit-object-error'),
    model: 'fake-model[medium]',
    system_message: 'Exercise usage-limit error preservation.',
    messages: [{ role: 'user', content: 'Trigger the structured provider failure.' }],
    callbacks: {
      onAssistantDelta: (event) => { streamedUsageLimit += event.text; },
    },
  }),
  (error) => {
    assert.equal(error.message, usageLimitNotice);
    assert.doesNotMatch(error.message, /\[object Object\]|secret-must-not-leak|raw stderr/);
    return true;
  },
);
assert.equal(streamedUsageLimit, '', 'uncommitted provider errors must not enter chat deltas');

const symlinkRoot = await mkdtemp(join(tmpdir(), 'joi-acp-policy-'));
try {
  await symlink('/tmp', join(symlinkRoot, 'escape-link'));
  const symlinkResult = await runACPChatTurn({
    ...config,
    cwd: symlinkRoot,
    permission_profile: 'workspace_write',
    capability_allowlist: compileACPProviderCapabilityAllowlist({
      permission_profile: 'workspace_write',
      allowed_roots: [symlinkRoot],
      trusted_mcp_tools: [{ server: 'joi_web', tool: 'web_search' }],
    }),
    model: 'fake-model[medium]',
    system_message: 'Keep output exact.',
    messages: [{ role: 'user', content: 'Exercise symlink boundary policy.' }],
  });
  assert.equal(symlinkResult.tool_results.find((tool) => tool.call_id === 'fake-symlink-escape-write')?.output.status, 'policy_blocked');
} finally {
  await rm(symlinkRoot, { recursive: true, force: true });
}

await assert.rejects(
  runACPChatTurn({
    ...config,
    model: 'fake-model[midum]',
    system_message: 'Keep output exact.',
    messages: [{ role: 'user', content: 'This prompt must not run.' }],
  }),
  /ACP model is not available: fake-model\[midum\].*fake-model\[medium\]/,
);

const cancelController = new AbortController();
const cancelledTurn = runACPChatTurn({
  ...config,
  args: agentArgs('--wait-for-cancel'),
  model: 'fake-model[medium]',
  system_message: 'Exercise cancellation cleanup.',
  messages: [{ role: 'user', content: 'Wait until cancelled.' }],
  signal: cancelController.signal,
});
setTimeout(() => cancelController.abort(), 20).unref?.();
await assert.rejects(cancelledTurn, (error) => error?.name === 'AbortError');

const lifecycleEvents = (await readFile(lifecycleMarker, 'utf8'))
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line).event);
assert.equal(lifecycleEvents.filter((event) => event === 'new').length, lifecycleEvents.filter((event) => event === 'close').length);
assert(lifecycleEvents.includes('cancel'));
assert.equal(lifecycleEvents.includes('delete'), false, 'ephemeral ACP sessions must not request deletion after a non-materialized thread closes');
await rm(lifecycleDir, { recursive: true, force: true });

console.log('ACP runtime tests passed');
