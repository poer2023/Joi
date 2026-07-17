import assert from 'node:assert/strict';
import {
  compileElectronCapabilityTools,
  electronCapabilityRequiresConfirmation,
  electronCapabilityRisk,
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
  assert(names.includes('request_user_input'));
  assert(names.includes('automation_update'));
  for (const name of ['memory_recall', 'session_search', 'session_summary', 'project_list', 'skills_list', 'skill_view', 'tool_search', 'task_list', 'task_view', 'shell_output']) {
    assert(names.includes(name));
  }
  assert(!names.includes('memory_write_candidate'));
  assert(!names.includes('task_update'));
  assert(!names.includes('shell_start'));
  assert(!names.includes('search_files'));
  assert(!names.includes('x_search'));
  assert(names.includes('image_generate'));
  for (const name of ['video_generate', 'text_to_speech', 'speech_transcribe', 'lsp_definition', 'lsp_references', 'lsp_diagnostics']) {
    assert(names.includes(name));
  }
  assert(!names.includes('apply_patch'));
  assert(!names.includes('write_file'));
  assert(!names.includes('execute_code'));
  assert(!names.includes('delegate_task'));
  assert(!names.includes('browser_click'));
  assert(!names.includes('browser_type'));
  for (const name of ['find_roots', 'observe_ui', 'search_ui', 'expand_ui', 'inspect_ui', 'read_text', 'wait_for']) assert(names.includes(name));
  assert(!names.includes('act_ui'));
  for (const name of ['browser_scroll', 'browser_back', 'browser_forward', 'browser_reload', 'browser_console', 'browser_network', 'browser_get_images', 'browser_screenshot', 'browser_tabs']) assert(names.includes(name));
  assert(!names.includes('debugger_attach'));
}

{
  const names = namesFor('workspace_write');
  assert(names.includes('apply_patch'));
  assert(names.includes('memory_write_candidate'));
  assert(names.includes('task_update'));
  for (const name of ['delegate_task', 'session_branch', 'session_compact']) assert(names.includes(name));
  assert(!names.includes('shell_start'));
  assert(!names.includes('patch'));
  assert(names.includes('execute_code'));
  assert(names.includes('sandbox_run'));
  assert(!names.includes('browser_click'));
  assert(!names.includes('browser_type'));
  assert(names.includes('browser_scroll'));
  assert(!names.includes('debugger_attach'));
}

{
  const names = namesFor('danger_full_access');
  assert(names.includes('apply_patch'));
  assert(names.includes('browser_click'));
  assert(names.includes('browser_type'));
  assert(names.includes('act_ui'));
  for (const name of ['shell_start', 'shell_write', 'shell_output', 'shell_kill']) assert(names.includes(name));
  for (const name of ['debugger_attach', 'debugger_breakpoint', 'debugger_step', 'debugger_evaluate', 'debugger_threads', 'debugger_stack', 'debugger_locals', 'debugger_watchpoint', 'debugger_memory', 'debugger_stop']) assert(names.includes(name));
  for (const name of ['browser_scroll', 'browser_upload', 'browser_evaluate', 'browser_cdp']) assert(names.includes(name));
  assert(!names.includes('computer_use'));
}

{
  const act = compileElectronCapabilityTools('danger_full_access').find((tool) => tool.name === 'act_ui');
  assert(act);
  assert.equal(act.execution_mode, 'sequential');
  assert.equal(act.parameters.properties.actions.type, 'array');
  assert.equal(act.parameters.properties.actions.items.type, 'object');
  assert.deepEqual(act.parameters.required, ['actions']);
  assert.equal(electronCapabilityRisk('act_ui'), 'browser_interaction');
  assert.equal(electronCapabilityRisk('computer_use'), 'browser_interaction');
  assert.equal(electronCapabilityRisk('observe_ui'), 'read_only');
  assert.equal(electronCapabilityRequiresConfirmation('act_ui'), true);
  assert.equal(electronCapabilityRequiresConfirmation('computer_use'), true);
  assert.equal(electronCapabilityRequiresConfirmation('observe_ui'), false);
  assert.equal(electronCapabilityRequiresConfirmation('write_file'), true);
  assert.equal(electronCapabilityRequiresConfirmation('memory_write_candidate'), true);
  assert.equal(electronCapabilityRequiresConfirmation('task_update'), true);
  assert.equal(electronCapabilityRequiresConfirmation('shell_start'), true);
  assert.equal(electronCapabilityRequiresConfirmation('shell_write'), true);
  assert.equal(electronCapabilityRequiresConfirmation('browser_evaluate'), true);
  assert.equal(electronCapabilityRequiresConfirmation('execute_code'), true);
}

{
  const aliases = namesFor('danger_full_access', { include_aliases: true });
  assert(aliases.includes('search_files'));
  assert(aliases.includes('read_file'));
  assert(aliases.includes('web_search'));
  assert(aliases.includes('bash'));
  assert(aliases.includes('patch'));
  assert(aliases.includes('browser_snapshot'));
  assert(aliases.includes('memory_search'));
  assert(aliases.includes('subagent_delegate'));
  assert(aliases.includes('compaction_run'));
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
  const requestUserInput = compileElectronCapabilityTools('read_only').find((tool) => tool.name === 'request_user_input');
  const automationUpdate = compileElectronCapabilityTools('read_only').find((tool) => tool.name === 'automation_update');
  assert(requestUserInput);
  assert(automationUpdate);
  assert.deepEqual(requestUserInput.parameters.required, ['question', 'options']);
  assert.equal(requestUserInput.parameters.properties.options.type, 'array');
  assert.deepEqual(automationUpdate.parameters.required, ['mode', 'name', 'prompt', 'rrule']);
  assert.equal(automationUpdate.parameters.properties.cwds.type, 'array');
  assert.equal(electronCapabilityRisk('automation_update'), 'read_only');
  assert.equal(electronCapabilityRequiresConfirmation('automation_update'), false);
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
  assert.ok(definitions.some((definition) => definition.name === 'browser_scroll' && definition.backend === 'implemented'));
  assert.ok(definitions.some((definition) => definition.name === 'mcp_tool_call' && definition.backend === 'implemented'));
  assert.ok(definitions.some((definition) => definition.name === 'lsp_rename' && definition.backend === 'implemented'));
  assert.ok(definitions.some((definition) => definition.name === 'read_file' && definition.backend === 'alias'));
  assert.ok(definitions.some((definition) => definition.name === 'workspace_search' && !definition.backend));
  assert.ok(definitions.some((definition) => definition.name === 'image_generate' && definition.backend === 'implemented'));
  assert.ok(definitions.some((definition) => definition.name === 'request_user_input' && definition.backend === 'implemented'));
  assert.ok(definitions.some((definition) => definition.name === 'automation_update' && definition.backend === 'implemented'));
  assert.ok(definitions.some((definition) => definition.name === 'memory_recall' && definition.backend === 'implemented'));
  assert.ok(definitions.some((definition) => definition.name === 'session_search' && definition.backend === 'implemented'));
  assert.ok(definitions.some((definition) => definition.name === 'shell_start' && definition.backend === 'implemented'));
  assert.ok(definitions.some((definition) => definition.name === 'tool_search' && definition.backend === 'implemented'));
  for (const name of ['delegate_task', 'session_branch', 'session_compact', 'video_generate', 'text_to_speech', 'speech_transcribe', 'lsp_definition', 'lsp_references', 'lsp_diagnostics', 'debugger_attach', 'debugger_breakpoint', 'debugger_step', 'debugger_evaluate', 'debugger_stop']) {
    assert.ok(definitions.some((definition) => definition.name === name && definition.backend === 'implemented'), `${name} should be implemented`);
  }
}

console.log('capability compiler runtime ok');
