import assert from 'node:assert/strict';
import {
  compileElectronCapabilityTools,
  maxRiskForPermission,
} from '../src/capability-compiler.ts';

function namesFor(permissionProfile) {
  return compileElectronCapabilityTools(permissionProfile).map((tool) => tool.name).sort();
}

{
  const names = namesFor('read_only');
  assert(names.includes('workspace_search'));
  assert(names.includes('file_read'));
  assert(names.includes('browser_navigate'));
  assert(!names.includes('apply_patch'));
  assert(!names.includes('browser_click'));
  assert(!names.includes('browser_type'));
}

{
  const names = namesFor('workspace_write');
  assert(names.includes('apply_patch'));
  assert(!names.includes('browser_click'));
  assert(!names.includes('browser_type'));
}

{
  const names = namesFor('danger_full_access');
  assert(names.includes('apply_patch'));
  assert(names.includes('browser_click'));
  assert(names.includes('browser_type'));
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
}

{
  const shellCommand = compileElectronCapabilityTools('read_only').find((tool) => tool.name === 'shell_command');
  assert(shellCommand);
  assert.equal(shellCommand.parameters.properties.cmd.type, 'array');
  assert.equal(shellCommand.parameters.properties.cmd.items.type, 'string');
}

console.log('capability compiler runtime ok');
