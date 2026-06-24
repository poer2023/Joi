import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    export { getAutomationDetailState, getAutomationSettingsObjects } from '${root}/src/features/automation/automationUiState.ts';
  `);
  execFileSync(esbuildBin, [
    entry,
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--target=es2020',
    '--outfile=' + bundle,
  ], { cwd: root, stdio: 'inherit' });

  const { getAutomationDetailState, getAutomationSettingsObjects } = await import(pathToFileURL(bundle).href);
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
  assert.equal(objects.find((item) => item.id === schedule.id).description, '定时 · 已启用');
  assert.equal(objects.find((item) => item.id === webhook.id).description, 'Webhook · 已停用');

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

  console.log('automation UI state tests passed');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
