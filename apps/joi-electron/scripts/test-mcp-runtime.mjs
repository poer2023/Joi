import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { MCPRuntimeManager } from '../src/main/mcp-runtime.ts';

const fixture = fileURLToPath(new URL('./fixtures/mcp-runtime-server.mjs', import.meta.url));
const manager = new MCPRuntimeManager();
const server = {
  id: 'fixture',
  name: 'Fixture',
  transport: 'stdio',
  command: process.execPath,
  args: [fixture],
  enabled: true,
  status: 'configured',
  trust: 'trusted',
  tools: [],
  resources: [],
  prompts: [],
};

try {
  const inventory = await manager.inspect(server);
  assert(inventory.tools.some((tool) => tool.name === 'echo'));
  assert(inventory.resources.some((resource) => resource.uri === 'fixture://root'));
  assert(inventory.prompts.some((prompt) => prompt.name === 'summarize'));
  const result = await manager.callTool(server, 'echo', { text: 'real-call' }, 10_000);
  assert.equal(result.is_error, false);
  assert.equal(result.structured_content?.echoed, 'real-call');
  assert.equal(result.content[0]?.text, 'echo:real-call');
  assert.equal(manager.connectionStatus().length, 1);
} finally {
  await manager.closeAll();
}

console.log('MCP runtime tests passed');
