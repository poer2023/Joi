import assert from 'node:assert/strict';
import {
  compileElectronCapabilityTools,
  listElectronCapabilityToolDefinitions,
  maxRiskForPermission,
} from '../src/capability-compiler.ts';

function namesFor(permissionProfile, options) {
  return compileElectronCapabilityTools(permissionProfile, options).map((tool) => tool.name).sort();
}

{
  const names = namesFor('read_only');
  assert(names.includes('workspace_search'));
  assert(names.includes('file_read'));
  assert(names.includes('web_research'));
  assert(names.includes('browser_navigate'));
  assert(!names.includes('search_files'));
  assert(!names.includes('x_search'));
  assert(names.includes('image_generate'));
  assert(!names.includes('apply_patch'));
  assert(!names.includes('write_file'));
  assert(!names.includes('execute_code'));
  assert(!names.includes('delegate_task'));
  assert(!names.includes('browser_click'));
  assert(!names.includes('browser_type'));
  assert(!names.includes('browser_scroll'));
  assert(!names.includes('debugger_attach'));
}

{
  const names = namesFor('workspace_write');
  assert(names.includes('apply_patch'));
  assert(!names.includes('patch'));
  assert(!names.includes('execute_code'));
  assert(!names.includes('browser_click'));
  assert(!names.includes('browser_type'));
  assert(!names.includes('browser_scroll'));
  assert(!names.includes('debugger_attach'));
}

{
  const names = namesFor('danger_full_access');
  assert(names.includes('apply_patch'));
  assert(names.includes('browser_click'));
  assert(names.includes('browser_type'));
  assert(!names.includes('browser_scroll'));
  assert(!names.includes('computer_use'));
}

{
  const aliases = namesFor('danger_full_access', { include_aliases: true });
  assert(aliases.includes('search_files'));
  assert(aliases.includes('read_file'));
  assert(aliases.includes('web_search'));
  assert(aliases.includes('bash'));
  assert(aliases.includes('patch'));
  assert(aliases.includes('browser_snapshot'));
}

{
  const inventory = namesFor('danger_full_access', { include_aliases: true, include_planned: true });
  assert(inventory.includes('x_search'));
  assert(inventory.includes('execute_code'));
  assert(inventory.includes('browser_scroll'));
  assert(inventory.includes('debugger_attach'));
}

{
  const research = namesFor('danger_full_access', { allowed_capabilities: ['web_research'] });
  assert.deepEqual(research, ['web_research']);
  const researchWithAliases = namesFor('danger_full_access', { allowed_capabilities: ['web_research'], include_aliases: true });
  assert.deepEqual(researchWithAliases, ['web_extract', 'web_research', 'web_search']);
  assert.deepEqual(namesFor('danger_full_access', { allowed_capabilities: [] }), []);
}

{
  assert.equal(maxRiskForPermission(undefined), 'read_only');
  assert.equal(maxRiskForPermission('workspace_write'), 'workspace_write');
  assert.equal(maxRiskForPermission('danger_full_access'), 'browser_interaction');
}

{
  const workspaceSearch = compileElectronCapabilityTools('read_only').find((tool) => tool.name === 'workspace_search');
  assert(workspaceSearch);
  assert.equal(workspaceSearch.parameters.type, 'object');
  assert.equal(workspaceSearch.parameters.properties.query.type, 'string');
  assert.equal(workspaceSearch.parameters.properties.max_results.type, 'number');
  assert.deepEqual(workspaceSearch.parameters.required, ['query']);
}

{
  const webResearch = compileElectronCapabilityTools('read_only').find((tool) => tool.name === 'web_research');
  assert(webResearch);
  assert.equal(webResearch.parameters.properties.query.type, 'string');
  assert.equal(webResearch.parameters.properties.url.type, 'string');
  assert.equal(webResearch.parameters.properties.max_results.type, 'number');
}

{
  const imageGenerate = compileElectronCapabilityTools('read_only').find((tool) => tool.name === 'image_generate');
  assert(imageGenerate);
  assert.equal(imageGenerate.parameters.properties.prompt.type, 'string');
  assert.equal(imageGenerate.parameters.properties.aspect_ratio.type, 'string');
  assert.deepEqual(imageGenerate.parameters.required, ['prompt']);
}

{
  const shellCommand = compileElectronCapabilityTools('read_only').find((tool) => tool.name === 'shell_command');
  assert(shellCommand);
  assert.equal(shellCommand.parameters.properties.cmd.type, 'array');
  assert.equal(shellCommand.parameters.properties.cmd.items.type, 'string');
}

{
  const definitions = listElectronCapabilityToolDefinitions();
  assert.ok(definitions.length > 50);
  assert.ok(definitions.some((definition) => definition.name === 'browser_scroll' && definition.backend === 'planned'));
  assert.ok(definitions.some((definition) => definition.name === 'read_file' && definition.backend === 'alias'));
  assert.ok(definitions.some((definition) => definition.name === 'workspace_search' && !definition.backend));
  assert.ok(definitions.some((definition) => definition.name === 'image_generate' && definition.backend === 'implemented'));
}

console.log('capability compiler runtime ok');
