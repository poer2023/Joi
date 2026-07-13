import type { PermissionProfile } from '../../shared-types/src/desktop-api';
import type { ToolSpec } from './tool-calling.ts';

export type CapabilityToolDefinition = {
  name: string;
  description: string;
  risk: 'read_only' | 'workspace_write' | 'browser_interaction';
  fields: Record<string, string>;
  backend?: 'implemented' | 'alias' | 'planned';
};

export type CapabilityCompileOptions = {
  allowed_capabilities?: Iterable<string>;
  include_aliases?: boolean;
  include_planned?: boolean;
};

const capabilityToolDefinitions: CapabilityToolDefinition[] = [
  { name: 'workspace_search', description: 'Search authorized workspace text files.', risk: 'read_only', fields: { query: 'string', root: 'string', max_results: 'number' } },
  { name: 'search_files', description: 'Pi-style alias for searching authorized workspace text files.', risk: 'read_only', fields: { query: 'string', pattern: 'string', root: 'string', glob: 'string', max_results: 'number' }, backend: 'alias' },
  { name: 'grep', description: 'Search authorized workspace files for a text pattern.', risk: 'read_only', fields: { pattern: 'string', query: 'string', root: 'string', glob: 'string', max_results: 'number' }, backend: 'alias' },
  { name: 'find', description: 'Find authorized workspace files by name or text query.', risk: 'read_only', fields: { query: 'string', name: 'string', root: 'string', glob: 'string', max_results: 'number' }, backend: 'alias' },
  { name: 'file_read', description: 'Read a bounded range from an authorized workspace file.', risk: 'read_only', fields: { path: 'string', start_line: 'number', end_line: 'number', max_bytes: 'number' } },
  { name: 'read_file', description: 'Pi-style alias for reading a bounded authorized workspace file range.', risk: 'read_only', fields: { path: 'string', start_line: 'number', end_line: 'number', max_bytes: 'number' }, backend: 'alias' },
  { name: 'read', description: 'Pi-style alias for reading a bounded authorized workspace file range.', risk: 'read_only', fields: { path: 'string', start_line: 'number', end_line: 'number', max_bytes: 'number' }, backend: 'alias' },
  { name: 'file_analyze', description: 'Analyze an authorized workspace file and return excerpts.', risk: 'read_only', fields: { path: 'string', question: 'string' } },
  { name: 'web_research', description: 'Search the public web with query, or fetch and summarize a policy-allowed HTTP(S) URL with url. Use query for user requests like "search", "look up", or when a direct URL fetch fails.', risk: 'read_only', fields: { query: 'string', url: 'string', max_results: 'number' } },
  { name: 'web_search', description: 'Search the public web through the configured provider.', risk: 'read_only', fields: { query: 'string', max_results: 'number' }, backend: 'alias' },
  { name: 'web_extract', description: 'Fetch and extract readable text from a policy-allowed HTTP(S) URL.', risk: 'read_only', fields: { url: 'string', max_bytes: 'number' }, backend: 'alias' },
  { name: 'x_search', description: 'Search X/Twitter through a configured provider. Returns not_configured until an X search backend is connected.', risk: 'read_only', fields: { query: 'string', max_results: 'number' }, backend: 'planned' },
  { name: 'shell_command', description: 'Run a tightly allowlisted read-only workspace command.', risk: 'read_only', fields: { cmd: 'array', cwd: 'string', timeout_seconds: 'number', max_output_bytes: 'number' } },
  { name: 'bash', description: 'Pi-style alias for a tightly allowlisted read-only workspace command. Pass cmd as argv, not a raw shell string.', risk: 'read_only', fields: { cmd: 'array', cwd: 'string', timeout_seconds: 'number', max_output_bytes: 'number' }, backend: 'alias' },
  { name: 'ls', description: 'List authorized workspace paths with the read-only command sandbox.', risk: 'read_only', fields: { path: 'string', cwd: 'string', max_output_bytes: 'number' }, backend: 'alias' },
  { name: 'test_command', description: 'Run an allowlisted test or build command.', risk: 'read_only', fields: { cmd: 'array', cwd: 'string', timeout_seconds: 'number', max_output_bytes: 'number' } },
  { name: 'computer_observe', description: 'Observe bounded frontmost-window metadata and visible text.', risk: 'read_only', fields: { target: 'string', include_text: 'boolean', max_text_bytes: 'number' } },
  { name: 'computer_use', description: 'Interactive computer-use action. Returns not_configured until a controlled computer-use backend is connected.', risk: 'browser_interaction', fields: { action: 'string', target: 'string', input: 'object', permission_profile: 'string' }, backend: 'planned' },
  { name: 'browser_observe', description: 'Observe bounded frontmost-browser metadata and visible text.', risk: 'read_only', fields: { target: 'string', include_text: 'boolean', max_text_bytes: 'number' } },
  { name: 'browser_snapshot', description: 'Hermes-style alias for observing bounded frontmost-browser metadata and visible text.', risk: 'read_only', fields: { target: 'string', include_text: 'boolean', max_text_bytes: 'number' }, backend: 'alias' },
  { name: 'browser_navigate', description: 'Navigate a policy-allowed URL in the frontmost/default browser.', risk: 'read_only', fields: { url: 'string', target: 'string' } },
  { name: 'browser_back', description: 'Navigate the frontmost browser back. Returns not_configured until browser history control is connected.', risk: 'browser_interaction', fields: { target: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'browser_scroll', description: 'Scroll the frontmost browser. Returns not_configured until browser scroll control is connected.', risk: 'browser_interaction', fields: { direction: 'string', amount: 'number', target: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'browser_press', description: 'Press a key in the frontmost browser. Returns not_configured until browser key control is connected.', risk: 'browser_interaction', fields: { key: 'string', target: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'browser_console', description: 'Read browser console output. Returns not_configured until DevTools console capture is connected.', risk: 'read_only', fields: { target: 'string', max_entries: 'number' }, backend: 'planned' },
  { name: 'browser_dialog', description: 'Handle a browser dialog. Returns not_configured until browser dialog control is connected.', risk: 'browser_interaction', fields: { action: 'string', text: 'string', target: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'browser_get_images', description: 'Collect image metadata from the current browser page. Returns not_configured until page image extraction is connected.', risk: 'read_only', fields: { target: 'string', max_results: 'number' }, backend: 'planned' },
  { name: 'browser_vision', description: 'Analyze the current browser page visually. Returns not_configured until visual browser analysis is connected.', risk: 'read_only', fields: { target: 'string', question: 'string' }, backend: 'planned' },
  { name: 'browser_cdp', description: 'Run a controlled Chrome DevTools Protocol request. Returns not_configured until CDP control is connected.', risk: 'browser_interaction', fields: { method: 'string', params: 'object', target: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'desktop_app_list', description: 'List installed macOS application bundle metadata.', risk: 'read_only', fields: { max_results: 'number' } },
  { name: 'desktop_app_inspect', description: 'Inspect one macOS app bundle by name, bundle_id, or path.', risk: 'read_only', fields: { name: 'string', bundle_id: 'string', path: 'string' } },
  { name: 'system_health_check', description: 'Inspect local Joi Electron SQLite runtime health.', risk: 'read_only', fields: {} },
  { name: 'server_diagnose', description: 'Run lightweight read-only service diagnosis.', risk: 'read_only', fields: { service_name: 'string', host: 'string', port: 'number', url: 'string' } },
  { name: 'apply_patch', description: 'Apply a bounded patch inside authorized workspace roots.', risk: 'workspace_write', fields: { patch: 'string', permission_profile: 'string' } },
  { name: 'patch', description: 'Pi-style alias for applying a bounded patch inside authorized workspace roots.', risk: 'workspace_write', fields: { patch: 'string', permission_profile: 'string' }, backend: 'alias' },
  { name: 'edit_file', description: 'Apply a bounded edit patch inside authorized workspace roots.', risk: 'workspace_write', fields: { path: 'string', patch: 'string', permission_profile: 'string' }, backend: 'alias' },
  { name: 'edit', description: 'Pi-style alias for applying a bounded edit patch inside authorized workspace roots.', risk: 'workspace_write', fields: { path: 'string', patch: 'string', permission_profile: 'string' }, backend: 'alias' },
  { name: 'write_file', description: 'Write file content through the bounded patch pipeline. Requires a unified patch payload.', risk: 'workspace_write', fields: { path: 'string', content: 'string', patch: 'string', permission_profile: 'string' }, backend: 'alias' },
  { name: 'write', description: 'Pi-style alias for writing file content through the bounded patch pipeline. Requires a unified patch payload.', risk: 'workspace_write', fields: { path: 'string', content: 'string', patch: 'string', permission_profile: 'string' }, backend: 'alias' },
  { name: 'browser_click', description: 'Click an element in the frontmost browser.', risk: 'browser_interaction', fields: { selector: 'string', target: 'string', permission_profile: 'string' } },
  { name: 'browser_type', description: 'Type into an element in the frontmost browser.', risk: 'browser_interaction', fields: { selector: 'string', text: 'string', target: 'string', permission_profile: 'string' } },
  { name: 'execute_code', description: 'Run code in a controlled kernel. Returns not_configured until a code kernel is connected.', risk: 'workspace_write', fields: { language: 'string', code: 'string', timeout_seconds: 'number', permission_profile: 'string' }, backend: 'planned' },
  { name: 'code_execution', description: 'Alias for a controlled code kernel. Returns not_configured until a code kernel is connected.', risk: 'workspace_write', fields: { language: 'string', code: 'string', timeout_seconds: 'number', permission_profile: 'string' }, backend: 'planned' },
  { name: 'sandbox_run', description: 'Run a command in an isolated sandbox. Returns not_configured until a sandbox backend is connected.', risk: 'workspace_write', fields: { cmd: 'array', cwd: 'string', timeout_seconds: 'number', permission_profile: 'string' }, backend: 'planned' },
  { name: 'delegate_task', description: 'Delegate a task to a subagent or worker. Returns not_configured until subagent orchestration is connected.', risk: 'workspace_write', fields: { prompt: 'string', agent: 'string', capability: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'subagent_delegate', description: 'Alias for delegating a task to a subagent or worker.', risk: 'workspace_write', fields: { prompt: 'string', agent: 'string', capability: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'mcp_tool_call', description: 'Call a wrapped MCP tool through the local runtime. Returns not_configured until the selected MCP tool is wrapped.', risk: 'workspace_write', fields: { server_id: 'string', tool_name: 'string', input: 'object', permission_profile: 'string' }, backend: 'planned' },
  { name: 'extension_register_tool', description: 'Register an extension-provided tool. Returns not_configured until the extension tool registry is enabled.', risk: 'workspace_write', fields: { extension_id: 'string', tool: 'object', permission_profile: 'string' }, backend: 'planned' },
  { name: 'lsp_definition', description: 'Resolve symbol definition through an LSP backend. Returns not_configured until LSP is connected.', risk: 'read_only', fields: { path: 'string', line: 'number', character: 'number', symbol: 'string' }, backend: 'planned' },
  { name: 'lsp_references', description: 'Resolve symbol references through an LSP backend. Returns not_configured until LSP is connected.', risk: 'read_only', fields: { path: 'string', line: 'number', character: 'number', symbol: 'string' }, backend: 'planned' },
  { name: 'lsp_diagnostics', description: 'Read diagnostics through an LSP backend. Returns not_configured until LSP is connected.', risk: 'read_only', fields: { path: 'string' }, backend: 'planned' },
  { name: 'lsp_rename', description: 'Rename a symbol through an LSP backend. Returns not_configured until LSP edit support is connected.', risk: 'workspace_write', fields: { path: 'string', line: 'number', character: 'number', new_name: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'lsp_format', description: 'Format a file through an LSP backend. Returns not_configured until LSP edit support is connected.', risk: 'workspace_write', fields: { path: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'debugger_attach', description: 'Attach a debugger. Returns not_configured until debugger integration is connected.', risk: 'browser_interaction', fields: { target: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'debugger_breakpoint', description: 'Set or clear a debugger breakpoint. Returns not_configured until debugger integration is connected.', risk: 'browser_interaction', fields: { path: 'string', line: 'number', enabled: 'boolean', permission_profile: 'string' }, backend: 'planned' },
  { name: 'debugger_step', description: 'Step a debugger session. Returns not_configured until debugger integration is connected.', risk: 'browser_interaction', fields: { action: 'string', session_id: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'debugger_evaluate', description: 'Evaluate an expression in a debugger session. Returns not_configured until debugger integration is connected.', risk: 'browser_interaction', fields: { expression: 'string', session_id: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'vision_analyze', description: 'Analyze an image or screenshot. Returns not_configured until a vision backend is connected.', risk: 'read_only', fields: { image_path: 'string', url: 'string', question: 'string' }, backend: 'planned' },
  { name: 'image_generate', description: 'Generate a new image with the authenticated Grok Build native image_gen tool and persist it as a Joi attachment.', risk: 'read_only', fields: { prompt: 'string', aspect_ratio: 'string', size: 'string', style: 'string' }, backend: 'implemented' },
  { name: 'video_generate', description: 'Generate a video. Returns not_configured until a video generation backend is connected.', risk: 'read_only', fields: { prompt: 'string', duration_seconds: 'number', style: 'string' }, backend: 'planned' },
  { name: 'video_analyze', description: 'Analyze a video. Returns not_configured until a video analysis backend is connected.', risk: 'read_only', fields: { video_path: 'string', url: 'string', question: 'string' }, backend: 'planned' },
  { name: 'text_to_speech', description: 'Generate speech audio. Returns not_configured until a TTS backend is connected.', risk: 'read_only', fields: { text: 'string', voice: 'string', format: 'string' }, backend: 'planned' },
  { name: 'memory_recall', description: 'Recall local memory context. Returns not_configured until memory recall is exposed to model tools.', risk: 'read_only', fields: { query: 'string', max_results: 'number' }, backend: 'planned' },
  { name: 'memory_write_candidate', description: 'Create a memory write candidate for user review. Returns not_configured until memory write review is connected.', risk: 'workspace_write', fields: { content: 'string', source: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'memory', description: 'Generic memory operation. Returns not_configured until memory tool dispatch is connected.', risk: 'workspace_write', fields: { action: 'string', query: 'string', content: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'session_search', description: 'Search local sessions or transcript history. Returns not_configured until session search is connected.', risk: 'read_only', fields: { query: 'string', max_results: 'number' }, backend: 'planned' },
  { name: 'session_summary', description: 'Summarize a local session. Returns not_configured until session summary is connected.', risk: 'read_only', fields: { session_id: 'string', thread_id: 'string' }, backend: 'planned' },
  { name: 'session_branch', description: 'Create or switch a session branch. Returns not_configured until session branching is connected.', risk: 'workspace_write', fields: { session_id: 'string', from_message_id: 'string', title: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'compaction_run', description: 'Request context compaction. Returns not_configured until compaction is connected.', risk: 'read_only', fields: { run_id: 'string', reason: 'string' }, backend: 'planned' },
  { name: 'queue_followup', description: 'Queue a follow-up task or reminder. Returns not_configured until queue integration is connected.', risk: 'workspace_write', fields: { title: 'string', prompt: 'string', due_at: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'clarify', description: 'Ask for a concise clarification instead of executing unsafe assumptions.', risk: 'read_only', fields: { question: 'string', options: 'array' }, backend: 'planned' },
  { name: 'todo', description: 'Create or update an execution todo list. Returns not_configured until todo persistence is connected.', risk: 'read_only', fields: { items: 'array', status: 'string' }, backend: 'planned' },
  { name: 'cronjob', description: 'Create or inspect a recurring task. Returns not_configured until automation scheduling is connected.', risk: 'workspace_write', fields: { action: 'string', schedule: 'string', prompt: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'project_list', description: 'List local Joi projects. Returns not_configured until project registry tools are connected.', risk: 'read_only', fields: {}, backend: 'planned' },
  { name: 'project_create', description: 'Create a local Joi project. Returns not_configured until project registry tools are connected.', risk: 'workspace_write', fields: { name: 'string', description: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'project_switch', description: 'Switch the active local Joi project. Returns not_configured until project registry tools are connected.', risk: 'workspace_write', fields: { project_id: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'skills_list', description: 'List available local skills. Returns not_configured until skill registry tools are connected.', risk: 'read_only', fields: { query: 'string' }, backend: 'planned' },
  { name: 'skill_view', description: 'View a local skill. Returns not_configured until skill registry tools are connected.', risk: 'read_only', fields: { skill_id: 'string' }, backend: 'planned' },
  { name: 'skill_manage', description: 'Install, update, or remove a local skill. Returns not_configured until skill management tools are connected.', risk: 'workspace_write', fields: { action: 'string', skill_id: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'ha_list_entities', description: 'List Home Assistant entities. Returns not_configured until Home Assistant integration is connected.', risk: 'read_only', fields: { domain: 'string' }, backend: 'planned' },
  { name: 'ha_get_state', description: 'Read a Home Assistant entity state. Returns not_configured until Home Assistant integration is connected.', risk: 'read_only', fields: { entity_id: 'string' }, backend: 'planned' },
  { name: 'ha_list_services', description: 'List Home Assistant services. Returns not_configured until Home Assistant integration is connected.', risk: 'read_only', fields: { domain: 'string' }, backend: 'planned' },
  { name: 'ha_call_service', description: 'Call a Home Assistant service. Returns not_configured until Home Assistant integration is connected.', risk: 'browser_interaction', fields: { domain: 'string', service: 'string', data: 'object', permission_profile: 'string' }, backend: 'planned' },
];

export function listElectronCapabilityToolDefinitions(): CapabilityToolDefinition[] {
  return capabilityToolDefinitions.map((definition) => ({ ...definition, fields: { ...definition.fields } }));
}

export function compileElectronCapabilityTools(
  permissionProfile: PermissionProfile | string | undefined,
  options: CapabilityCompileOptions = {},
): ToolSpec[] {
  const maxRisk = maxRiskForPermission(permissionProfile);
  const allowed = options.allowed_capabilities === undefined
    ? undefined
    : new Set([...options.allowed_capabilities].map((item) => canonicalElectronCapabilityName(String(item))).filter(Boolean));
  return capabilityToolDefinitions
    .filter((definition) => riskAllowed(definition.risk, maxRisk))
    .filter((definition) => options.include_planned || definition.backend !== 'planned')
    .filter((definition) => options.include_aliases || definition.backend !== 'alias')
    .filter((definition) => allowed === undefined
      || allowed.has('*')
      || allowed.has(canonicalElectronCapabilityName(definition.name)))
    .map((definition) => toolSpec(definition));
}

export function canonicalElectronCapabilityName(capability: string): string {
  const normalized = capability.trim();
  switch (normalized) {
    case 'workspace_search_v1':
    case 'search_files':
    case 'grep':
    case 'find':
      return 'workspace_search';
    case 'file_read_v1':
    case 'read_file':
    case 'read':
      return 'file_read';
    case 'file_analyze_v1':
      return 'file_analyze';
    case 'web_research_v1':
    case 'web_research_v2':
    case 'web_search':
    case 'web_extract':
    case 'fetch_url':
      return 'web_research';
    case 'shell_command_v1':
    case 'bash':
    case 'ls':
      return 'shell_command';
    case 'test_command_v1':
      return 'test_command';
    case 'image_gen':
      return 'image_generate';
    case 'apply_patch_v1':
    case 'patch':
    case 'edit_file':
    case 'edit':
    case 'write_file':
    case 'write':
      return 'apply_patch';
    case 'browser_snapshot':
      return 'browser_observe';
    case 'server_diagnose_v1':
    case 'server_diagnose_self':
      return 'server_diagnose';
    case 'system_health_check_v1':
    case 'system_health_check_self':
      return 'system_health_check';
    default:
      return normalized;
  }
}

export function maxRiskForPermission(permissionProfile: PermissionProfile | string | undefined): CapabilityToolDefinition['risk'] {
  const profile = String(permissionProfile || '').trim();
  if (profile === 'danger_full_access') return 'browser_interaction';
  if (profile === 'workspace_write') return 'workspace_write';
  return 'read_only';
}

function riskAllowed(risk: CapabilityToolDefinition['risk'], maxRisk: CapabilityToolDefinition['risk']): boolean {
  const order = { read_only: 1, workspace_write: 2, browser_interaction: 3 };
  return order[risk] <= order[maxRisk];
}

function toolSpec(definition: CapabilityToolDefinition): ToolSpec {
  const properties: Record<string, unknown> = {};
  for (const [field, type] of Object.entries(definition.fields)) {
    properties[field] = type === 'array'
      ? { type: 'array', items: { type: 'string' } }
      : { type };
  }
  const required = requiredFieldsForCapability(definition.name);
  return {
    name: definition.name,
    description: definition.description,
    execution_mode: definition.risk === 'read_only' ? 'parallel' : 'sequential',
    timeout_seconds: definition.name === 'image_generate'
      ? 180
      : definition.name === 'web_research' || definition.name === 'web_search' || definition.name === 'web_extract'
        ? 45
        : 60,
    parameters: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: true,
    },
  };
}

function requiredFieldsForCapability(capability: string): string[] {
  switch (capability) {
    case 'workspace_search':
      return ['query'];
    case 'grep':
      return ['pattern'];
    case 'file_read':
    case 'read_file':
    case 'read':
    case 'file_analyze':
      return ['path'];
    case 'web_search':
      return ['query'];
    case 'web_extract':
      return ['url'];
    case 'image_generate':
      return ['prompt'];
    case 'shell_command':
    case 'bash':
    case 'test_command':
      return ['cmd'];
    case 'apply_patch':
    case 'patch':
    case 'edit_file':
    case 'edit':
    case 'write_file':
    case 'write':
      return ['patch'];
    case 'browser_navigate':
      return ['url'];
    case 'browser_click':
      return ['selector'];
    case 'browser_type':
      return ['selector', 'text'];
    default:
      return [];
  }
}
