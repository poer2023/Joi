import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveAutomationModelRuntimeRoute, resolveAutomationModelSettings } from '../src/main/automation-runtime-route.ts';
import {
  TelegramOutboundService,
  isProactiveTelegramDeliveryRequested,
  resolveTelegramNotificationPolicy,
} from '../src/main/telegram-outbound.ts';

const allowedChatID = '1234567890';
const token = 'test-token-must-be-redacted';
const store = createStore();
const secrets = { resolve: async (name) => name === 'TELEGRAM_BOT_TOKEN' ? token : '' };
let fetchCalls = 0;
const successFetch = async (url, init) => {
  fetchCalls += 1;
  const body = JSON.parse(String(init?.body || '{}'));
  assert.match(String(url), /\/sendMessage$/);
  assert.equal(body.chat_id, allowedChatID);
  assert.equal(body.parse_mode, 'HTML');
  assert.equal(typeof body.text, 'string');
  if (fetchCalls === 1) {
    assert.equal(body.text.includes('\n\n'), true, 'Telegram HTML output must preserve source paragraph breaks');
    assert.equal(body.text.includes('<b>保留粗体</b>'), true, 'CommonMark bold must be represented in Telegram HTML');
  }
  return response(200, { ok: true, result: { message_id: 101 } });
};
const service = new TelegramOutboundService({ store, secrets, fetchImpl: successFetch, apiBaseURL: 'https://telegram.test' });

const automation = automationFixture({ channel: 'telegram', chat_id: allowedChatID });
const trigger = triggerFixture('trigger_success');
const chatResponse = {
  conversation_id: 'conv_automation',
  user_message_id: 'msg_user',
  assistant_message_id: 'msg_assistant',
  run_id: 'run_automation',
  selected_agent_id: 'general_agent',
  response: '# 自动化已完成\n\n1. **保留粗体**\n2. `保留代码`',
};

assert.equal(resolveTelegramNotificationPolicy({}).enabled, false, 'empty notification policy must not send');
assert.equal(resolveTelegramNotificationPolicy({ channels: ['desktop', 'telegram'], events: ['completed'] }).enabled, true);
assert.equal(resolveTelegramNotificationPolicy({ channel: 'telegram', on_success: false }).enabled, false);
assert.equal(resolveTelegramNotificationPolicy({ channel: 'telegram' }).disableLinkPreview, false);
assert.equal(resolveTelegramNotificationPolicy({ channel: 'telegram', disable_link_preview: true }).disableLinkPreview, true);

const skipped = await service.deliverAutomationCompletion({
  automation: automationFixture({}),
  trigger: triggerFixture('trigger_skipped'),
  response: chatResponse,
  automation_run_id: 'autorun_skipped',
});
assert.equal(skipped.status, 'skipped');
assert.equal(fetchCalls, 0);

const delivered = await service.deliverAutomationCompletion({ automation, trigger, response: chatResponse, automation_run_id: 'autorun_success' });
assert.equal(delivered.status, 'delivered');
assert.equal(delivered.external_delivery_id, `telegram:${allowedChatID}:101`);
assert.equal(fetchCalls, 1);
assert.equal(store.deliveries.get(delivered.notification_id).status, 'delivered');
assert.equal(store.logs.some((entry) => entry.feature_key === 'telegram.outbound.sent'), true);

const auditFailureStore = createStore();
auditFailureStore.completeOutboundNotificationDelivery = () => {
  throw new Error('sqlite completion write failed');
};
const auditFailureService = new TelegramOutboundService({
  store: auditFailureStore,
  secrets,
  fetchImpl: async () => response(200, { ok: true, result: { message_id: 150 } }),
  apiBaseURL: 'https://telegram.test',
});
const auditFailure = await auditFailureService.deliverAutomationCompletion({
  automation,
  trigger: triggerFixture('trigger_audit_failure'),
  response: { ...chatResponse, run_id: 'run_audit_failure' },
  automation_run_id: 'autorun_audit_failure',
});
assert.equal(auditFailure.status, 'failed');
assert.equal(auditFailure.reason, 'telegram_acceptance_unknown');
assert.equal(auditFailureStore.deliveries.get(auditFailure.notification_id).status, 'acceptance_unknown');
assert.equal(auditFailureStore.deliveries.get(auditFailure.notification_id).external_delivery_id, `telegram:${allowedChatID}:150`);
assert.equal((await auditFailureService.drainFailedDeliveries()).length, 0, 'a Telegram-accepted message with a local audit failure must never be resent');

const duplicate = await service.deliverAutomationCompletion({ automation, trigger, response: chatResponse, automation_run_id: 'autorun_success' });
assert.equal(duplicate.status, 'deduped');
assert.equal(fetchCalls, 1, 'a repeated automation completion must not call Telegram twice');

let previewOptOutObserved = false;
let previewFallbackCalls = 0;
const previewOptOutService = new TelegramOutboundService({
  store: createStore(),
  secrets,
  fetchImpl: async (url, init) => {
    previewFallbackCalls += 1;
    const body = JSON.parse(String(init?.body || '{}'));
    assert.match(String(url), /\/sendMessage$/);
    if (previewFallbackCalls === 1) {
      assert.equal(body.parse_mode, 'HTML');
      assert.equal(body.text.includes('\n'), true, 'formatted request must preserve line breaks');
      return response(400, { ok: false, description: 'Bad Request: formatted message rejected' });
    }
    previewOptOutObserved = body.link_preview_options?.is_disabled === true;
    assert.equal(body.text.includes('\n'), true, 'plain fallback must preserve line breaks');
    assert.equal('parse_mode' in body, false, 'plain fallback must not claim a formatting mode');
    return response(200, { ok: true, result: { message_id: 102 } });
  },
  apiBaseURL: 'https://telegram.test',
});
assert.equal((await previewOptOutService.deliverAutomationCompletion({
  automation: automationFixture({ channel: 'telegram', chat_id: allowedChatID, disable_link_preview: true }),
  trigger: triggerFixture('trigger_preview_opt_out'),
  response: { ...chatResponse, run_id: 'run_preview_opt_out' },
  automation_run_id: 'autorun_preview_opt_out',
})).status, 'delivered');
assert.equal(previewOptOutObserved, true, 'an explicit policy may disable Telegram link previews');
assert.equal(previewFallbackCalls, 2, 'only an explicit format rejection may trigger a plain-text fallback');

const rejectedDestination = await service.deliverAutomationCompletion({
  automation: automationFixture({ channel: 'telegram', chat_id: '9000000000' }),
  trigger: triggerFixture('trigger_bad_destination'),
  response: { ...chatResponse, run_id: 'run_bad_destination' },
  automation_run_id: 'autorun_bad_destination',
});
assert.equal(rejectedDestination.status, 'failed');
assert.match(rejectedDestination.error_summary, /allow-listed private user/i);
assert.equal(fetchCalls, 1, 'a non-allow-listed destination must fail before network I/O');

const failingStore = createStore();
const failingService = new TelegramOutboundService({
  store: failingStore,
  secrets,
  fetchImpl: async () => response(401, { ok: false, description: `Unauthorized ${token}` }),
  apiBaseURL: 'https://telegram.test',
});
const failed = await failingService.deliverAutomationCompletion({
  automation,
  trigger: triggerFixture('trigger_api_failure'),
  response: { ...chatResponse, run_id: 'run_api_failure' },
  automation_run_id: 'autorun_api_failure',
});
assert.equal(failed.status, 'failed');
assert.equal(failed.error_summary.includes(token), false, 'returned errors must redact the bot token');
const failedRecord = failingStore.deliveries.get(failed.notification_id);
assert.equal(failedRecord.status, 'send_failed');
assert.equal(JSON.stringify(failedRecord.metadata).includes(token), false, 'notification audit metadata must redact the bot token');
assert.equal(JSON.stringify(failingStore.logs).includes(token), false, 'app logs must redact the bot token');
const repeatedFailure = await failingService.deliverAutomationCompletion({
  automation,
  trigger: triggerFixture('trigger_api_failure'),
  response: { ...chatResponse, run_id: 'run_api_failure' },
  automation_run_id: 'autorun_api_failure',
});
assert.equal(repeatedFailure.status, 'failed');
assert.equal(repeatedFailure.reason, 'previous_attempt_failed');

const transientStore = createStore();
let transientFetchCalls = 0;
const transientService = new TelegramOutboundService({
  store: transientStore,
  secrets,
  fetchImpl: async () => {
    transientFetchCalls += 1;
    if (transientFetchCalls === 1) throw new Error('network temporarily offline');
    return response(200, { ok: true, result: { message_id: 202 } });
  },
  apiBaseURL: 'https://telegram.test',
});
const retryAutomation = automationFixture({
  channel: 'telegram',
  chat_id: allowedChatID,
  retry_policy: { max_attempts: 2, backoff_seconds: [0] },
});
const transientFirst = await transientService.deliverAutomationCompletion({
  automation: retryAutomation,
  trigger: triggerFixture('trigger_transient'),
  response: { ...chatResponse, run_id: 'run_transient' },
  automation_run_id: 'autorun_transient',
});
assert.equal(transientFirst.status, 'failed');
assert.equal(transientStore.deliveries.size, 1);
assert.equal(transientFirst.reason, 'telegram_acceptance_unknown');
assert.equal(transientStore.deliveries.get(transientFirst.notification_id).status, 'acceptance_unknown');
const retried = await transientService.drainFailedDeliveries();
assert.equal(retried.length, 0, 'ambiguous network acceptance must never be retried automatically');
assert.equal(transientFetchCalls, 1);
assert.equal(transientStore.deliveries.size, 1);
const afterDelivered = await transientService.deliverAutomationCompletion({
  automation: retryAutomation,
  trigger: triggerFixture('trigger_transient'),
  response: { ...chatResponse, run_id: 'run_transient' },
  automation_run_id: 'autorun_transient',
});
assert.equal(afterDelivered.status, 'deduped');
assert.equal(transientFetchCalls, 1, 'an acceptance-unknown record must never be sent again');

const rateLimitStore = createStore();
let rateLimitFetchCalls = 0;
const rateLimitService = new TelegramOutboundService({
  store: rateLimitStore,
  secrets,
  fetchImpl: async () => {
    rateLimitFetchCalls += 1;
    if (rateLimitFetchCalls === 1) return response(429, { ok: false, description: 'Too Many Requests' });
    return response(200, { ok: true, result: { message_id: 202 } });
  },
  apiBaseURL: 'https://telegram.test',
});
const rateLimited = await rateLimitService.deliverAutomationCompletion({
  automation: retryAutomation,
  trigger: triggerFixture('trigger_rate_limited'),
  response: { ...chatResponse, run_id: 'run_rate_limited' },
  automation_run_id: 'autorun_rate_limited',
});
assert.equal(rateLimited.status, 'failed');
assert.equal(rateLimitStore.deliveries.get(rateLimited.notification_id).status, 'send_failed');
const rateLimitRetry = await rateLimitService.drainFailedDeliveries();
assert.equal(rateLimitRetry[0].status, 'delivered', 'an explicit 429 rejection is safe to retry');
assert.equal(rateLimitFetchCalls, 2);

store.contexts.set('pmsg_telegram', {
  id: 'pmsg_telegram',
  title: '关注内容更新',
  body: '你关注的网站有一条新内容。',
  reason: 'subscription_update',
  status: 'authorized',
  channel: 'telegram',
  metadata: {},
  run_id: 'run_proactive',
  conversation_id: 'conv_proactive',
});
assert.equal(isProactiveTelegramDeliveryRequested(store.contexts.get('pmsg_telegram')), true);
const proactive = await service.deliverProactiveMessage('pmsg_telegram');
assert.equal(proactive.status, 'delivered');
assert.equal(store.deliveries.get(proactive.notification_id).metadata.proactive_message_id, 'pmsg_telegram');

let resolvedAPIKey = false;
let readinessACPFlag = false;
const acpProvider = {
  provider_id: 'acp_codex_cli',
  command: '/tmp/fake-acp',
  cwd: '/tmp',
  permission_profile: 'read_only',
};
const acpRoute = await resolveAutomationModelRuntimeRoute({
  settings: { model_provider: 'acp_codex_cli', model_name: 'gpt-5.6-terra[medium]' },
  request: { message: 'automation ACP smoke', permission_profile: 'read_only', runtime_mode: 'tool_calling' },
  localProxyAPIKey: 'joi-local-model-proxy',
  resolveACPProvider: () => acpProvider,
  resolveAPIKey: async () => {
    resolvedAPIKey = true;
    return 'must-not-be-used';
  },
  canRun: (_settings, apiKey, _request, configured) => {
    readinessACPFlag = configured;
    return configured && apiKey === 'joi-local-model-proxy';
  },
});
assert.equal(acpRoute.acpProvider, acpProvider);
assert.equal(acpRoute.ready, true);
assert.equal(acpRoute.model_selection_policy, 'settings_preferred');
assert.equal(resolvedAPIKey, false, 'ACP automation routing must not require an API key');
assert.equal(readinessACPFlag, true, 'ACP automation readiness must use the configured-provider flag');

const activeACPSettings = {
  model_provider: 'acp_codex_cli',
  model_name: 'gpt-5.6-luna[medium]',
  model_base_url: '',
  model_reasoning_effort: 'medium',
};
const duplicateDeepSeekModels = [
  {
    provider: 'acp_codex_cli',
    id: 'deepseek-v4-flash',
    supports_tool_calling: true,
    metadata: { observed_from_request: true },
  },
  {
    provider: 'openai_compatible',
    base_url: 'https://api.deepseek.com/v1',
    id: 'deepseek-v4-flash',
    metadata: { source: 'provider_model_list' },
    config: { enabled: true, temperature: 0.7, timeout_seconds: 75, max_retries: 2, supports_json_mode: false, supports_tool_calling: false, supports_reasoning: false },
  },
];
const inferredDeepSeekSettings = resolveAutomationModelSettings({
  settings: activeACPSettings,
  request: { message: 'scheduled deepseek task', model_name: 'deepseek-v4-flash', reasoning_effort: 'low' },
  availableModels: duplicateDeepSeekModels,
});
assert.equal(inferredDeepSeekSettings.model_provider, 'openai_compatible');
assert.equal(inferredDeepSeekSettings.model_base_url, 'https://api.deepseek.com/v1');
assert.equal(inferredDeepSeekSettings.model_name, 'deepseek-v4-flash');
assert.equal(inferredDeepSeekSettings.model_reasoning_effort, 'low');
assert.equal(inferredDeepSeekSettings.model_timeout_seconds, 75);
assert.equal(inferredDeepSeekSettings.model_max_retries, 2);

const explicitACPDeepSeekSettings = resolveAutomationModelSettings({
  settings: activeACPSettings,
  request: { message: 'explicit ACP task', model_name: 'deepseek-v4-flash', model_provider: 'acp_codex_cli' },
  availableModels: duplicateDeepSeekModels,
});
assert.equal(explicitACPDeepSeekSettings.model_provider, 'acp_codex_cli');
assert.equal(explicitACPDeepSeekSettings.model_base_url, '');

const automationSource = await readFile(new URL('../src/main/automation.ts', import.meta.url), 'utf8');
const ipcSource = await readFile(new URL('../src/main/ipc.ts', import.meta.url), 'utf8');
assert.match(
  automationSource,
  /this\.pluginManager,\s*\{\s*model_selection_policy: route\.model_selection_policy,\s*selected_agent_id: selectedAgentID,\s*\}/,
  'AutomationRunner must pass its settings-preferred model policy into the live run',
);
assert.match(
  automationSource,
  /this\.executeChat\(chatRequest, automation\.agent_role_id \|\| 'general_agent'\)/,
  'AutomationRunner must pass the configured Agent instead of re-routing the prompt by keywords',
);
assert.match(
  ipcSource,
  /selected_agent_id: routeOptions\.selected_agent_id/,
  'The live Electron chat bridge must forward the configured Agent into store routing',
);
assert.doesNotMatch(
  automationSource,
  /new JoiPluginManager\(/,
  'AutomationRunner must reuse the app-owned JoiPluginManager',
);

console.log('Telegram outbound and automation ACP routing tests passed');

function createStore() {
  const deliveries = new Map();
  const contexts = new Map();
  const logs = [];
  const automationRuns = new Map();
  return {
    deliveries,
    contexts,
    logs,
    automationRuns,
    getSettings() {
      return { telegram_enabled: true, telegram_allowed_user_ids: allowedChatID };
    },
    recordAutomationRunCompleted(req) {
      automationRuns.set(req.automation_run_id, { status: 'succeeded', run_id: req.run_id });
      const queued = req.notification_delivery;
      if (queued && !deliveries.has(queued.id)) {
        deliveries.set(queued.id, {
          id: queued.id,
          channel: queued.channel,
          status: 'pending',
          external_delivery_id: '',
          metadata: {
            ...(queued.metadata || {}),
            dedup_key: queued.dedup_key,
            target: queued.target,
            proactive_message_id: queued.proactive_message_id || '',
            attempt_count: 0,
            max_attempts: queued.max_attempts || 3,
            backoff_seconds: queued.backoff_seconds || [30, 120],
            retryable: false,
            next_attempt_at: '',
            run_id: queued.run_id || '',
            summary: queued.summary || '',
          },
        });
      }
      return automationRuns.get(req.automation_run_id);
    },
    claimOutboundNotificationDelivery(req) {
      const existing = deliveries.get(req.id);
      if (existing) {
        const due = !existing.metadata.next_attempt_at || Date.parse(existing.metadata.next_attempt_at) <= Date.now();
        if (existing.status === 'pending') {
          existing.status = 'sending';
          existing.metadata.attempt_count += 1;
          existing.metadata.lease_expires_at = new Date(Date.now() + 120_000).toISOString();
          return { claimed: true, status: existing.status, delivery: existing };
        }
        if (existing.status === 'send_failed'
          && existing.metadata.retryable === true
          && existing.metadata.attempt_count < existing.metadata.max_attempts
          && due) {
          existing.status = 'sending';
          existing.metadata.attempt_count += 1;
          existing.metadata.retryable = false;
          existing.metadata.next_attempt_at = '';
          return { claimed: true, status: existing.status, delivery: existing };
        }
        return { claimed: false, status: existing.status, delivery: existing };
      }
      const delivery = {
        id: req.id,
        channel: req.channel,
        status: 'sending',
        external_delivery_id: '',
        metadata: {
          ...(req.metadata || {}),
          dedup_key: req.dedup_key,
          target: req.target,
          proactive_message_id: req.proactive_message_id || '',
          attempt_count: 1,
          max_attempts: req.max_attempts || 3,
          backoff_seconds: req.backoff_seconds || [30, 120],
          retryable: false,
          next_attempt_at: '',
          run_id: req.run_id || '',
          summary: req.summary || '',
        },
      };
      deliveries.set(req.id, delivery);
      return { claimed: true, status: delivery.status, delivery };
    },
    completeOutboundNotificationDelivery(req) {
      const delivery = deliveries.get(req.id);
      delivery.status = 'delivered';
      delivery.external_delivery_id = req.external_delivery_id;
      delivery.metadata.external_delivery_id = req.external_delivery_id;
      return delivery;
    },
    failOutboundNotificationDelivery(req) {
      const delivery = deliveries.get(req.id);
      delivery.status = req.acceptance_unknown ? 'acceptance_unknown' : 'send_failed';
      delivery.metadata.error_code = req.error_code;
      delivery.metadata.error_message = req.error_message;
      delivery.external_delivery_id = req.external_delivery_id || delivery.external_delivery_id;
      delivery.metadata.external_delivery_id = req.external_delivery_id || delivery.metadata.external_delivery_id || '';
      const attemptIndex = Math.max(0, delivery.metadata.attempt_count - 1);
      const backoff = delivery.metadata.backoff_seconds[Math.min(attemptIndex, delivery.metadata.backoff_seconds.length - 1)] || 0;
      delivery.metadata.retryable = !req.acceptance_unknown && Boolean(req.retryable) && delivery.metadata.attempt_count < delivery.metadata.max_attempts;
      delivery.metadata.next_attempt_at = delivery.metadata.retryable ? new Date(Date.now() + backoff * 1_000).toISOString() : '';
      return delivery;
    },
    reclaimExpiredOutboundNotificationLeases() {
      const reclaimed = [];
      for (const delivery of deliveries.values()) {
        if (delivery.status !== 'sending') continue;
        if (!delivery.metadata.lease_expires_at || Date.parse(delivery.metadata.lease_expires_at) > Date.now()) continue;
        delivery.status = 'acceptance_unknown';
        delivery.metadata.error_code = 'TELEGRAM_LEASE_EXPIRED';
        delivery.metadata.retryable = false;
        reclaimed.push(delivery);
      }
      return reclaimed;
    },
    getProactiveOutboundContext(id) {
      const context = contexts.get(id);
      if (!context) throw new Error(`missing proactive context: ${id}`);
      return context;
    },
    listProactiveOutboundContexts() {
      return [...contexts.values()].filter((context) => ['authorized', 'scheduled'].includes(context.status));
    },
    listDueOutboundNotificationRetries() {
      return [...deliveries.values()].filter((delivery) => (
        delivery.status === 'pending'
        || (delivery.status === 'send_failed'
          && delivery.metadata.retryable === true
          && (!delivery.metadata.next_attempt_at || Date.parse(delivery.metadata.next_attempt_at) <= Date.now()))
      )).map((delivery) => ({
        id: delivery.id,
        dedup_key: delivery.metadata.dedup_key,
        channel: delivery.channel,
        target: delivery.metadata.target,
        text: delivery.metadata.delivery_payload.text,
        disable_link_preview: Boolean(delivery.metadata.delivery_payload.disable_link_preview),
        run_id: delivery.metadata.run_id,
        summary: delivery.metadata.summary,
        metadata: delivery.metadata,
        max_attempts: delivery.metadata.max_attempts,
        backoff_seconds: delivery.metadata.backoff_seconds,
      }));
    },
    recordAppLog(input) {
      logs.push(input);
      return input;
    },
  };
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

function automationFixture(notificationPolicy) {
  return {
    id: 'auto_watch',
    kind: 'schedule',
    slug: 'watch',
    name: '关注内容巡检',
    enabled: true,
    trigger_config: { type: 'interval', every_minutes: 60 },
    prompt_template: '检查关注内容',
    input_mode: 'background_task',
    permission_profile: 'read_only',
    preferred_node: 'main-node',
    allow_worker: false,
    dedup_policy: {},
    retry_policy: {},
    max_concurrency: 1,
    notification_policy: notificationPolicy,
    metadata: {},
  };
}

function triggerFixture(id) {
  return {
    id,
    automation_id: 'auto_watch',
    trigger_type: 'manual',
    dedup_key: id,
    payload: {},
    status: 'running',
    attempt_count: 1,
  };
}
