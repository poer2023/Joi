import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const outDir = mkdtempSync(join(tmpdir(), 'joi-automation-ui-state-'));
const esbuildBin = [
  join(root, '..', '..', '..', 'node_modules', '.pnpm', 'esbuild@0.27.7', 'node_modules', '@esbuild', 'darwin-arm64', 'bin', 'esbuild'),
  join(root, '..', '..', '..', 'node_modules', '.pnpm', 'node_modules', '.bin', 'esbuild'),
  join(root, 'node_modules', '.bin', 'esbuild'),
].find((candidate) => existsSync(candidate)) || 'node_modules/.bin/esbuild';

try {
  const entry = join(outDir, 'entry.ts');
  const bundle = join(outDir, 'bundle.mjs');
  writeFileSync(entry, `
    export {
      buildAutomationTelegramNotificationPolicy,
      getAutomationDetailState,
      getAutomationSettingsObjects,
      getAutomationTelegramNotificationDraft,
      getAutomationTelegramReadiness,
      getAutomationTelegramTargetError,
    } from '${root}/src/features/automation/automationUiState.ts';
  `);
  execFileSync(esbuildBin, [
    entry,
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--target=es2020',
    '--outfile=' + bundle,
  ], { cwd: root, stdio: 'inherit' });

  const {
    buildAutomationTelegramNotificationPolicy,
    getAutomationDetailState,
    getAutomationSettingsObjects,
    getAutomationTelegramNotificationDraft,
    getAutomationTelegramReadiness,
    getAutomationTelegramTargetError,
  } = await import(pathToFileURL(bundle).href);
  const schedule = {
    id: 'auto_schedule',
    kind: 'schedule',
    slug: 'daily-build',
    name: 'Daily build',
    enabled: true,
    trigger_config: { type: 'daily', time: '09:00' },
    prompt_template: 'Run daily build',
    input_mode: 'background_task',
    permission_profile: 'read_only',
    preferred_node: 'main-node',
    allow_worker: false,
    dedup_policy: {},
    retry_policy: {},
    max_concurrency: 1,
    notification_policy: {},
    metadata: {},
  };
  const webhook = {
    ...schedule,
    id: 'auto_webhook',
    kind: 'webhook',
    slug: 'deploy-hook',
    name: 'Deploy hook',
    enabled: false,
  };

  const objects = getAutomationSettingsObjects([schedule, webhook]);
  assert.deepEqual(objects.slice(0, 2).map((item) => item.id), ['new-schedule', 'new-webhook']);
  assert.equal(objects.find((item) => item.id === schedule.id).description, '定时运行 · 已启用');
  assert.equal(objects.find((item) => item.id === webhook.id).description, '外部触发 · 已停用');

  const failedState = getAutomationDetailState({
    automation: webhook,
    endpoint: {
      automation_id: webhook.id,
      slug: webhook.slug,
      url: 'http://127.0.0.1:18082/automation/webhooks/deploy-hook',
      secret_ref: 'JOI_AUTOMATION_WEBHOOK_SECRET_auto_webhook',
      secret_configured: true,
      secret_value_once: 'joi_whsec_once',
    },
    triggers: [{
      id: 'trig_failed',
      automation_id: webhook.id,
      trigger_type: 'webhook',
      dedup_key: 'delivery:1',
      payload: {},
      status: 'failed',
      attempt_count: 1,
      error_code: 'BAD_SIGNATURE',
      error_message: 'Webhook signature mismatch',
    }],
    runs: [{
      id: 'run_failed',
      automation_id: webhook.id,
      trigger_id: 'trig_failed',
      run_id: 'run_1',
      product_task_id: 'task_1',
      status: 'failed',
      attempt_number: 1,
      error_code: 'RUNTIME_FAILED',
      error_message: 'model failed',
      metadata: {},
    }],
  });
  assert.equal(failedState.webhookUrl, 'http://127.0.0.1:18082/automation/webhooks/deploy-hook');
  assert.equal(failedState.secretConfigured, true);
  assert.equal(failedState.secretValueAvailable, true);
  assert.equal(failedState.lastRunStatus, 'failed');
  assert.deepEqual(failedState.banner, {
    tone: 'error',
    title: '最近一次自动化失败',
    message: 'RUNTIME_FAILED · model failed',
  });

  const succeededState = getAutomationDetailState({
    automation: schedule,
    triggers: [],
    runs: [{
      id: 'run_ok',
      automation_id: schedule.id,
      trigger_id: 'trig_ok',
      run_id: 'run_2',
      status: 'succeeded',
      attempt_number: 1,
      metadata: {},
    }],
  });
  assert.equal(succeededState.lastRunStatus, 'succeeded');
  assert.equal(succeededState.banner.title, '最近一次运行');
  assert.equal(succeededState.banner.message, 'succeeded');

  const allowedUserIDs = '1234567890,8123456789';
  assert.deepEqual(getAutomationTelegramNotificationDraft(undefined, allowedUserIDs), {
    enabled: false,
    chatID: '1234567890',
  });
  const notifyingSchedule = {
    ...schedule,
    notification_policy: { channel: 'telegram', on_success: true, events: ['completed'], chat_id: '8123456789' },
  };
  assert.deepEqual(getAutomationTelegramNotificationDraft(notifyingSchedule, allowedUserIDs), {
    enabled: true,
    chatID: '8123456789',
  });
  assert.deepEqual(buildAutomationTelegramNotificationPolicy({ enabled: true, chatID: '', allowedUserIDs }), {
    channel: 'telegram',
    on_success: true,
    events: ['completed'],
    chat_id: '1234567890',
  });
  assert.deepEqual(buildAutomationTelegramNotificationPolicy({ enabled: false, chatID: '1234567890', allowedUserIDs }), {});

  const ready = getAutomationTelegramReadiness({
    telegramEnabled: true,
    tokenStatusKnown: true,
    tokenConfigured: true,
    allowedUserIDs,
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.defaultChatID, '1234567890');
  assert.match(ready.message, /白名单/);
  assert.match(getAutomationTelegramReadiness({
    telegramEnabled: false,
    tokenStatusKnown: true,
    tokenConfigured: true,
    allowedUserIDs,
  }).message, /聊天入口/);
  assert.match(getAutomationTelegramReadiness({
    telegramEnabled: true,
    tokenStatusKnown: true,
    tokenConfigured: false,
    allowedUserIDs,
  }).message, /Bot Token/);
  assert.match(getAutomationTelegramReadiness({
    telegramEnabled: true,
    tokenStatusKnown: true,
    tokenConfigured: true,
    allowedUserIDs: '',
  }).message, /允许用户 ID/);
  assert.equal(getAutomationTelegramTargetError({ enabled: true, chatID: '8123456789', allowedChatIDs: ready.allowedChatIDs }), '');
  assert.match(getAutomationTelegramTargetError({ enabled: true, chatID: '9000000000', allowedChatIDs: ready.allowedChatIDs }), /不在 Telegram 白名单/);

  const appSource = readFileSync(join(root, 'src/App.tsx'), 'utf8');
  for (const marker of ['完成后推送到 Telegram', '目标用户 / Chat ID', 'notification_policy: buildAutomationTelegramNotificationPolicy']) {
    assert.equal(appSource.includes(marker), true, `Automation UI must contain ${marker}`);
  }

  console.log('automation UI state tests passed');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
