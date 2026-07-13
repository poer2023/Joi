import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveTelegramModelRuntimeRoute, telegramOwnerPermissionProfile } from '../src/main/telegram-runtime-route.ts';
import { telegramConversationID } from '../src/main/telegram-thread.ts';

const ownerChatConversation = telegramConversationID(123456789);
assert.equal(ownerChatConversation, telegramConversationID('123456789'), 'the same Telegram chat must reuse one conversation');
assert.notEqual(ownerChatConversation, telegramConversationID(987654321), 'different Telegram chats must stay isolated');
assert.notEqual(ownerChatConversation, telegramConversationID(123456789, 42), 'a Telegram topic must not overwrite its parent chat thread');
assert.equal(telegramConversationID(123456789, 42), telegramConversationID('123456789', '42'), 'the same Telegram topic must be stable');

const request = {
  message: 'Telegram ACP routing smoke',
  channel: 'telegram',
  runtime_mode: 'tool_calling',
  permission_profile: telegramOwnerPermissionProfile,
};

const acpProvider = {
  provider_id: 'acp_codex_cli',
  command: '/tmp/fake-acp-agent',
  cwd: '/tmp',
  permission_profile: telegramOwnerPermissionProfile,
};

let resolvedAPIKey = false;
let acpReadinessFlag = false;
let resolvedPermissionProfile = '';
const acpRoute = await resolveTelegramModelRuntimeRoute({
  settings: { model_provider: 'acp_codex_cli', model_name: 'gpt-5.6-terra[medium]' },
  request,
  localProxyAPIKey: 'joi-local-model-proxy',
  resolveACPProvider: (providerID, permissionProfile) => {
    resolvedPermissionProfile = permissionProfile;
    return providerID === 'acp_codex_cli' ? acpProvider : undefined;
  },
  resolveAPIKey: async () => {
    resolvedAPIKey = true;
    return 'should-not-be-used';
  },
  canRun: (_settings, apiKey, _request, configured) => {
    acpReadinessFlag = configured;
    return configured && apiKey === 'joi-local-model-proxy';
  },
});

assert.equal(acpRoute.acpProvider, acpProvider);
assert.equal(acpRoute.apiKey, 'joi-local-model-proxy');
assert.equal(acpRoute.ready, true);
assert.equal(acpRoute.model_selection_policy, 'settings_preferred');
assert.equal(resolvedAPIKey, false, 'ACP routing must not require an API key');
assert.equal(acpReadinessFlag, true, 'ACP readiness must be checked with the ACP provider flag');
assert.equal(resolvedPermissionProfile, 'danger_full_access', 'Telegram owner route must request ACP full access');

let openAIReadinessFlag = true;
const openAIRoute = await resolveTelegramModelRuntimeRoute({
  settings: { model_provider: 'openai_compatible', model_name: 'test-model' },
  request,
  localProxyAPIKey: 'joi-local-model-proxy',
  resolveACPProvider: () => undefined,
  resolveAPIKey: async () => 'real-api-key',
  canRun: (_settings, apiKey, _request, configured) => {
    openAIReadinessFlag = configured;
    return !configured && apiKey === 'real-api-key';
  },
});

assert.equal(openAIRoute.acpProvider, undefined);
assert.equal(openAIRoute.apiKey, 'real-api-key');
assert.equal(openAIRoute.ready, true);
assert.equal(openAIRoute.model_selection_policy, 'settings_preferred');
assert.equal(openAIReadinessFlag, false, 'non-ACP readiness must retain the existing provider path');

const telegramInboundSource = await readFile(new URL('../src/main/telegram-inbound.ts', import.meta.url), 'utf8');
assert.match(
  telegramInboundSource,
  /this\.pluginManager,\s*\{ model_selection_policy: runtimeRoute\.model_selection_policy \}/,
  'Telegram inbound must pass its settings-preferred policy into the live run',
);
assert.doesNotMatch(
  telegramInboundSource,
  /new JoiPluginManager\(/,
  'Telegram inbound must reuse the app-owned JoiPluginManager',
);
assert.match(
  telegramInboundSource,
  /permission_profile: telegramOwnerPermissionProfile/,
  'Telegram inbound must use the owner full-access profile guarded by the command blacklist',
);
assert.match(
  telegramInboundSource,
  /Remote mode: danger_full_access \+ full_access_blacklist_v1/,
  'Telegram status must report the effective remote permission policy',
);
assert.match(
  telegramInboundSource,
  /postTelegramMessage\(\{/,
  'Telegram inbound replies must use the native text-and-media sender',
);
assert.doesNotMatch(
  telegramInboundSource,
  /text:\s*compactText\(text,/,
  'Telegram inbound replies must not collapse Markdown and line breaks before delivery',
);
assert.match(
  telegramInboundSource,
  /conversation_id: telegramConversationID\(message\.chat\.id, message\.message_thread_id\)/,
  'Telegram inbound must route each chat/topic to its stable conversation',
);
assert.match(
  telegramInboundSource,
  /external_thread_id: update\.message\?\.message_thread_id/,
  'Telegram inbound must preserve a topic identity across its durable inbox',
);

console.log('Telegram ACP routing tests passed');
