import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const outDir = mkdtempSync(join(tmpdir(), 'joi-automation-parity-'));
const esbuildBin = [
  join(root, '..', '..', '..', 'node_modules', '.pnpm', 'esbuild@0.27.7', 'node_modules', '@esbuild', 'darwin-arm64', 'bin', 'esbuild'),
  join(root, '..', '..', '..', 'node_modules', '.pnpm', 'node_modules', '.bin', 'esbuild'),
  join(root, 'node_modules', '.bin', 'esbuild'),
].find((candidate) => existsSync(candidate)) || 'node_modules/.bin/esbuild';

try {
  const entry = join(outDir, 'entry.ts');
  const bundle = join(outDir, 'bundle.mjs');
  writeFileSync(entry, `export * from '${root}/src/features/automation/automationParity.ts';`);
  execFileSync(esbuildBin, [entry, '--bundle', '--format=esm', '--platform=node', '--target=es2020', '--outfile=' + bundle], { cwd: root, stdio: 'inherit' });
  const parity = await import(pathToFileURL(bundle).href);

  const weekdays = parity.scheduleDraft({ mode: 'weekdays', time: '08:15', timezone: 'Asia/Shanghai' });
  assert.equal(parity.rruleFromScheduleDraft(weekdays), 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8;BYMINUTE=15;BYSECOND=0');
  assert.deepEqual(parity.triggerConfigFromScheduleDraft(weekdays), {
    type: 'rrule',
    rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8;BYMINUTE=15;BYSECOND=0',
    timezone: 'Asia/Shanghai',
  });

  const automation = {
    id: 'auto_1', kind: 'schedule', execution_kind: 'heartbeat', status: 'ACTIVE', slug: 'monitor', name: 'Monitor', enabled: true,
    trigger_config: { type: 'rrule', rrule: 'FREQ=HOURLY;INTERVAL=2;BYMINUTE=20;BYSECOND=0', timezone: 'Asia/Shanghai' },
    prompt_template: 'Monitor', input_mode: 'background_task', permission_profile: 'read_only', preferred_node: 'main-node', allow_worker: false,
    dedup_policy: {}, retry_policy: {}, max_concurrency: 1, notification_policy: {}, rrule: 'FREQ=HOURLY;INTERVAL=2;BYMINUTE=20;BYSECOND=0', cwds: [], metadata: {},
  };
  assert.equal(parity.summarizeAutomationSchedule(automation), '每 2 小时');
  assert.equal(parity.automationExecutionLabel(automation.execution_kind), '继续现有任务');
  assert.equal(parity.automationSuggestions.length, 3);
  assert.match(parity.automationSearchText(automation), /monitor/);

  const legacy = { ...automation, execution_kind: 'cron', rrule: undefined, trigger_config: { type: 'cron', expression: '0 9 * * *', timezone: 'UTC' } };
  const legacyDraft = parity.scheduleDraftFromAutomation(legacy);
  assert.equal(legacyDraft.customRrule, 'CRON:0 9 * * *');
  assert.deepEqual(parity.triggerConfigFromScheduleDraft(legacyDraft), { type: 'cron', expression: '0 9 * * *', timezone: 'UTC' });

  const setupRoute = parity.automationSetupModelRoute({
    model_provider: 'acp_codex_cli',
    model_name: 'gpt-5.6-luna[medium]',
    model_base_url: '',
    model_reasoning_effort: 'medium',
  }, [
    { provider: 'acp_codex_cli', id: 'deepseek-v4-flash', metadata: { observed_from_request: true } },
    { provider: 'xai_oauth', base_url: 'https://api.x.ai/v1', id: 'grok-4.3', supports_tool_calling: true },
    { provider: 'openai_compatible', base_url: 'https://api.deepseek.com/v1', id: 'deepseek-v4-pro' },
    { provider: 'openai_compatible', base_url: 'https://api.deepseek.com/v1', id: 'deepseek-v4-flash' },
  ]);
  assert.deepEqual(setupRoute, {
    provider: 'openai_compatible',
    model: 'deepseek-v4-flash',
    baseURL: 'https://api.deepseek.com/v1',
    reasoningEffort: 'low',
    hostToolRuntime: true,
  });

  const missingHostRoute = parity.automationSetupModelRoute({
    model_provider: 'acp_codex_cli',
    model_name: 'gpt-5.6-luna[medium]',
    model_base_url: '',
    model_reasoning_effort: 'medium',
  }, []);
  assert.equal(missingHostRoute.hostToolRuntime, false);

  console.log('automation parity UI helpers passed');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
