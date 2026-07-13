import assert from 'node:assert/strict';
import {
  acpPluginModelConfig,
  mergeACPPluginModels,
  reasoningEffortFromACPModel,
  selectACPPluginModel,
} from '../src/features/settings/acpPluginModels.ts';
import { readFileSync } from 'node:fs';

const tested = mergeACPPluginModels(
  [{ id: 'default', name: 'Account default' }],
  [
    { id: 'gpt-5.6-terra[medium]', name: 'GPT-5.6-Terra (medium)' },
    { id: 'gpt-5.6-sol[xhigh]', name: 'GPT-5.6-Sol (xhigh)' },
  ],
  [{ id: 'gpt-5.6-terra[medium]', name: 'duplicate' }],
);

assert.deepEqual(tested.map((model) => model.id), [
  'default',
  'gpt-5.6-terra[medium]',
  'gpt-5.6-sol[xhigh]',
]);
assert.equal(selectACPPluginModel(tested, ['gpt-5.6-terra[medium]', 'default']), 'gpt-5.6-terra[medium]');
assert.equal(selectACPPluginModel(tested, ['missing-model', 'default']), 'default');
assert.equal(reasoningEffortFromACPModel('gpt-5.6-terra[medium]'), 'medium');
assert.equal(reasoningEffortFromACPModel('gpt-5.6-sol[xhigh]'), undefined);
assert.deepEqual(acpPluginModelConfig('acp_codex_cli', 'gpt-5.6-terra[medium]'), {
  provider: 'acp_codex_cli',
  base_url: '',
  name: 'gpt-5.6-terra[medium]',
  reasoning_effort: 'medium',
  timeout_seconds: 300,
  max_retries: 0,
});

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.match(appSource, /id: 'codex-acp', label: 'Codex ACP'/);
assert.match(appSource, /activeObject\.id === 'codex-acp'/);
assert.match(appSource, />测试连接<\/button>/);
assert.match(appSource, />获取模型<\/button>/);
assert.match(appSource, /testPluginProvider\(plugin, provider\)/);

console.log('ACP plugin model selection tests passed');
