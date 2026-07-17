import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizePluginInstallRequest, parseGitHubPluginSource, providerRuntimeConfig } from '../src/main/plugin-manager.ts';

assert.deepEqual(normalizePluginInstallRequest({ source: 'poer2023/joi-codex-acp-plugin', ref: 'main' }), {
  source: 'poer2023/joi-codex-acp-plugin',
  ref: 'main',
});
assert.deepEqual(normalizePluginInstallRequest({ url: 'https://github.com/poer2023/joi-codex-acp-plugin' }), {
  source: 'https://github.com/poer2023/joi-codex-acp-plugin',
  ref: undefined,
});

assert.deepEqual(parseGitHubPluginSource('poer2023/joi-codex-acp-plugin'), {
  owner: 'poer2023',
  repo: 'joi-codex-acp-plugin',
  ref: undefined,
  clone_url: 'https://github.com/poer2023/joi-codex-acp-plugin.git',
  source_url: 'https://github.com/poer2023/joi-codex-acp-plugin',
});
assert.equal(parseGitHubPluginSource('https://github.com/poer2023/joi-codex-acp-plugin/tree/main').ref, 'main');
assert.throws(() => parseGitHubPluginSource('http://github.com/poer2023/joi-codex-acp-plugin'), /Only HTTPS/);
assert.throws(() => parseGitHubPluginSource('https://example.com/poer2023/joi-codex-acp-plugin'), /github.com/);

const provider = {
  id: 'acp-test',
  name: 'ACP Test',
  protocol: 'acp',
  runtime: 'node',
  command: '/tmp/fake-agent.mjs',
  args: [],
  env: { ELECTRON_RUN_AS_NODE: '0', DISABLE_MCP_CONFIG_FILTERING: 'false' },
};
const userDataDir = await mkdtemp(join(tmpdir(), 'joi-plugin-manager-'));
try {
  const readOnlyRuntime = providerRuntimeConfig(provider, process.cwd(), [process.cwd()], 'read_only', userDataDir);
  assert.equal(readOnlyRuntime.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(readOnlyRuntime.env.DISABLE_MCP_CONFIG_FILTERING, 'true');
  assert.equal(readOnlyRuntime.ephemeral_session, true);
  assert.equal(readOnlyRuntime.env.JOI_ACP_EPHEMERAL, undefined);
  assert.deepEqual(readOnlyRuntime.mcp_servers.map((server) => server.name), ['joi_web']);
  assert(readOnlyRuntime.capability_allowlist.some((item) => item.capability_id === 'mcp.joi_web.web_search'));
  assert(readOnlyRuntime.capability_allowlist.some((item) => item.capability_id === 'mcp.joi_web.web_extract'));
  assert(!readOnlyRuntime.capability_allowlist.some((item) => item.operation === 'workspace_write'));

  const scopedRuntime = providerRuntimeConfig(
    provider,
    process.cwd(),
    [process.cwd()],
    'danger_full_access',
    userDataDir,
    ['workspace_search_v1', 'file_read_v1', 'web_research_v2', 'apply_patch_v1', 'browser_click', 'x_search'],
  );
  assert.deepEqual(scopedRuntime.mcp_servers.map((server) => server.name), ['joi_web', 'joi_capabilities']);
  assert.deepEqual(scopedRuntime.joi_capability_tools, ['workspace_search', 'file_read', 'apply_patch', 'browser_click']);
  assert(scopedRuntime.capability_allowlist.some((item) => item.capability_id === 'mcp.joi_capabilities.workspace_search'));
  assert(scopedRuntime.capability_allowlist.some((item) => item.capability_id === 'mcp.joi_capabilities.file_read'));
  assert(scopedRuntime.capability_allowlist.some((item) => item.capability_id === 'mcp.joi_capabilities.apply_patch'));
  assert(scopedRuntime.capability_allowlist.some((item) => item.capability_id === 'mcp.joi_capabilities.browser_click'));
  assert(!scopedRuntime.capability_allowlist.some((item) => item.capability_id === 'mcp.joi_capabilities.x_search'));

  const fullAgentRuntime = providerRuntimeConfig(
    provider,
    process.cwd(),
    [process.cwd()],
    'danger_full_access',
    userDataDir,
    ['*'],
  );
  for (const capability of ['tool_search', 'file_read', 'workspace_search', 'shell_start', 'browser_tabs', 'browser_console', 'browser_network']) {
    assert(fullAgentRuntime.joi_capability_tools.includes(capability), `full agent bridge is missing ${capability}`);
    assert(fullAgentRuntime.capability_allowlist.some((item) => item.capability_id === `mcp.joi_capabilities.${capability}`));
  }
  assert(!fullAgentRuntime.joi_capability_tools.includes('x_search'), 'planned tools must not be exposed as executable');

  const workspaceWriteRuntime = providerRuntimeConfig(provider, process.cwd(), [process.cwd()], 'workspace_write', userDataDir);
  assert(workspaceWriteRuntime.capability_allowlist.some((item) => item.operation === 'workspace_write'));
  assert(workspaceWriteRuntime.capability_allowlist.some((item) => item.command_policy === 'workspace_test'));

  const codexRuntime = providerRuntimeConfig({ ...provider, id: 'acp_codex_cli' }, process.cwd(), [process.cwd()], 'read_only', userDataDir);
  assert.match(codexRuntime.args[0], /acp-ephemeral-launcher\/index\.mjs$/);
  assert.equal(codexRuntime.args[1], provider.command);
  assert.equal(codexRuntime.env.JOI_ACP_EPHEMERAL, '1');
} finally {
  await rm(userDataDir, { recursive: true, force: true });
}

console.log('Plugin manager tests passed');
