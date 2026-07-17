import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { executionRoutingForSettings } from '../src/features/settings/settingsRuntime.ts';

const root = resolve(import.meta.dirname, '../../../..');
const app = readFileSync(resolve(root, 'apps/joi-desktop/frontend/src/App.tsx'), 'utf8');
const api = readFileSync(resolve(root, 'apps/joi-desktop/frontend/src/api/desktop.ts'), 'utf8');
const contract = readFileSync(resolve(root, 'packages/shared-types/src/desktop-api.ts'), 'utf8');
const schema = readFileSync(resolve(root, 'database/sqlite/001_init_schema.sql'), 'utf8');
const store = readFileSync(resolve(root, 'packages/store/src/sqlite.ts'), 'utf8');

const routedObjects = [
  'desktop-notify', 'webhook',
  'builtin', 'skills', 'plugins', 'mcp', 'web-search', 'filesystem', 'browser', 'github', 'custom-tools',
  'assignment-policy',
];

for (const id of routedObjects) {
  assert.match(app, new RegExp(`activeObject\\.id === '${id}'`), `missing independent settings renderer: ${id}`);
}

assert.match(app, /function renderPrivacyDetail\(\)/);
assert.match(app, /id: 'privacy-policy', label: '安全策略'/);
assert.match(app, /<DetailHeader title="安全策略"/);
assert.doesNotMatch(app, /id: 'remote-permission'/);
assert.match(app, /if \(objectID && !options\?\.preserveSidebar\) \{\s*setSidebarPreference\('collapsed'\);\s*\}/);
assert.match(app, /onClick=\{\(\) => selectSettingsObject\(section\.id\)\}/);
assert.match(app, /onClick=\{\(\) => selectSettingsObject\(activeCategory, item\.id, \{ preserveSidebar: true \}\)\}/);

for (const method of [
  'SetCapabilityEnabled', 'SaveMCPServer', 'DeleteMCPServer', 'SetMCPServerEnabled',
  'SetSkillEnabled', 'TestGitHubConnection', 'ListPlugins', 'InstallPluginFromManifest', 'InstallPluginFromGitHub', 'TestPluginProvider', 'SetPluginEnabled', 'RemovePlugin',
]) {
  assert.match(contract, new RegExp(`\\b${method}\\b`), `missing DesktopBindings contract: ${method}`);
  const camel = method[0].toLowerCase() + method.slice(1);
  assert.match(api.toLowerCase(), new RegExp(camel.toLowerCase()), `missing renderer API binding: ${camel}`);
}

assert.match(schema, /CREATE TABLE IF NOT EXISTS plugin_definitions/);
assert.doesNotMatch(app, /该入口后续接入真实配置项/);
assert.doesNotMatch(app, /defaultValue="main-first"/);
assert.doesNotMatch(app, /id: 'wechat-claw'/);
assert.doesNotMatch(app, /id: 'cli', label: 'CLI'/);
assert.doesNotMatch(app, /webhookChatEnabled|webhookChatPath|modelTemperature/);
assert.match(app, /安装本地插件/);
assert.match(app, /从 GitHub 安装/);
assert.match(app, /设为当前/);
assert.match(app, /id: 'plugins', label: 'Plugins'/);
assert.match(app, /aria-label={`\$\{provider\.name\} 模型`}/);
assert.match(app, /saveModelConfig\(acpPluginModelConfig\(provider\.id, selectedModel\)\)/);
assert.match(app, /受管插件目录/);
assert.match(app, /包装为 Capability/);
assert.match(app, /id: 'memory-health', label: '记忆健康'/);
assert.match(app, /召回 \/ 注入/);
assert.match(app, /作用域分布/);
assert.match(app, /生命周期提示/);
assert.match(contract, /export type MemoryQualityMetrics/);
assert.match(store, /memory\.scope_resolved/);
assert.match(store, /FROM memory_fts/);
assert.match(app, /节点分配策略已保存/);
assert.match(app, /function renderAdvancedDetail\(\)/);
assert.match(app, /<DetailHeader title="支持与诊断"/);
assert.match(app, /导出脱敏诊断包/);
assert.match(app, /<DetailHeader title="成本用量" description="查看模型用量、缓存命中和预估成本" \/>/);
assert.match(app, /className="logs-inspector-panel settings-logs-panel"/);
assert.doesNotMatch(app, /className="right-panel-section logs-inspector-panel"/);
assert.match(app, /className="settings-costs-panel"/);
assert.doesNotMatch(app, /<section className="panel wide">\s*<h2>成本用量<\/h2>/);
assert.doesNotMatch(app, /id: 'diagnostic-redaction'/);
assert.match(app, /id: 'voice', label: '语音', description: '聊天录音、转写与回复朗读设置'/);
assert.match(app, /<VoiceSettingsPanel settings=\{workspaceSettings\}/);
assert.match(app, /action: 'speech_status', model/);
assert.match(app, /Small（推荐 · 中英均衡）/);
assert.match(app, /本地转写引擎/);
assert.match(api, /Apple Metal/);
assert.match(store, /speech_transcription_model: settings\['speech\.transcription_model'\] \|\| 'small'/);
assert.match(app, /className=\{`composer-attachment-button composer-voice-button/);
assert.match(app, /onSpeak=\{\(messageID, content\) => void speakAssistantMessage/);
assert.doesNotMatch(app, /return <MediaWorkbenchPanel/);
assert.match(app, /executionRoutingForSettings\(workspaceSettings\)/);
assert.match(app, /new-webhook/);
assert.deepEqual(executionRoutingForSettings(null), { preferredNode: 'main-node', allowWorker: false, reason: 'privacy_local_only' });
assert.equal(executionRoutingForSettings({ privacy_local_only: true }).allowWorker, false);
assert.deepEqual(executionRoutingForSettings({
  privacy_local_only: false,
  allow_remote_execution: true,
  node_assignment_policy: 'auto',
  remote_execution_requires_confirmation: false,
}), { preferredNode: 'auto', allowWorker: true, reason: 'auto_worker_allowed' });
assert.equal(executionRoutingForSettings({
  privacy_local_only: false,
  allow_remote_execution: true,
  node_assignment_policy: 'auto',
  remote_execution_requires_confirmation: true,
}).allowWorker, false);
assert.match(store, /removeLegacyMCPPlaceholders/);
assert.doesNotMatch(api, /Local MCP Registry/);

console.log(`settings completion contract passed: ${routedObjects.length} explicit routes plus current privacy/support fallback covered`);
