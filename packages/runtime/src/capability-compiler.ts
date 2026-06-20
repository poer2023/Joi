import type { PermissionProfile } from '../../shared-types/src/desktop-api';
import type { ToolSpec } from './tool-calling.ts';

export type CapabilityToolDefinition = {
  name: string;
  description: string;
  risk: 'read_only' | 'workspace_write' | 'browser_interaction';
  fields: Record<string, string>;
};

const capabilityToolDefinitions: CapabilityToolDefinition[] = [
  { name: 'workspace_search', description: 'Search authorized workspace text files.', risk: 'read_only', fields: { query: 'string', root: 'string', max_results: 'number' } },
  { name: 'file_read', description: 'Read a bounded range from an authorized workspace file.', risk: 'read_only', fields: { path: 'string', start_line: 'number', end_line: 'number', max_bytes: 'number' } },
  { name: 'file_analyze', description: 'Analyze an authorized workspace file and return excerpts.', risk: 'read_only', fields: { path: 'string', question: 'string' } },
  { name: 'web_research', description: 'Fetch and summarize a policy-allowed HTTP(S) URL.', risk: 'read_only', fields: { url: 'string' } },
  { name: 'shell_command', description: 'Run a tightly allowlisted read-only workspace command.', risk: 'read_only', fields: { cmd: 'array', cwd: 'string', timeout_seconds: 'number', max_output_bytes: 'number' } },
  { name: 'test_command', description: 'Run an allowlisted test or build command.', risk: 'read_only', fields: { cmd: 'array', cwd: 'string', timeout_seconds: 'number', max_output_bytes: 'number' } },
  { name: 'computer_observe', description: 'Observe bounded frontmost-window metadata and visible text.', risk: 'read_only', fields: { target: 'string', include_text: 'boolean', max_text_bytes: 'number' } },
  { name: 'browser_observe', description: 'Observe bounded frontmost-browser metadata and visible text.', risk: 'read_only', fields: { target: 'string', include_text: 'boolean', max_text_bytes: 'number' } },
  { name: 'browser_navigate', description: 'Navigate a policy-allowed URL in the frontmost/default browser.', risk: 'read_only', fields: { url: 'string', target: 'string' } },
  { name: 'desktop_app_list', description: 'List installed macOS application bundle metadata.', risk: 'read_only', fields: { max_results: 'number' } },
  { name: 'desktop_app_inspect', description: 'Inspect one macOS app bundle by name, bundle_id, or path.', risk: 'read_only', fields: { name: 'string', bundle_id: 'string', path: 'string' } },
  { name: 'system_health_check', description: 'Inspect local Joi Electron SQLite runtime health.', risk: 'read_only', fields: {} },
  { name: 'server_diagnose', description: 'Run lightweight read-only service diagnosis.', risk: 'read_only', fields: { service_name: 'string', host: 'string', port: 'number', url: 'string' } },
  { name: 'apply_patch', description: 'Apply a bounded patch inside authorized workspace roots.', risk: 'workspace_write', fields: { patch: 'string', permission_profile: 'string' } },
  { name: 'browser_click', description: 'Click an element in the frontmost browser.', risk: 'browser_interaction', fields: { selector: 'string', target: 'string', permission_profile: 'string' } },
  { name: 'browser_type', description: 'Type into an element in the frontmost browser.', risk: 'browser_interaction', fields: { selector: 'string', text: 'string', target: 'string', permission_profile: 'string' } },
];

export function compileElectronCapabilityTools(permissionProfile: PermissionProfile | string | undefined): ToolSpec[] {
  const maxRisk = maxRiskForPermission(permissionProfile);
  return capabilityToolDefinitions
    .filter((definition) => riskAllowed(definition.risk, maxRisk))
    .map((definition) => toolSpec(definition.name, definition.description, definition.fields));
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

function toolSpec(name: string, description: string, fields: Record<string, string>): ToolSpec {
  const properties: Record<string, unknown> = {};
  for (const [field, type] of Object.entries(fields)) {
    properties[field] = type === 'array'
      ? { type: 'array', items: { type: 'string' } }
      : { type };
  }
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      additionalProperties: true,
    },
  };
}
