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
  { name: 'shell_command', description: 'Run a bounded command. Read-only and workspace-write profiles stay sandboxed; danger-full-access runs on the host with the destructive-command blacklist.', risk: 'read_only', fields: { cmd: 'array', cwd: 'string', timeout_seconds: 'number', max_output_bytes: 'number' } },
  { name: 'bash', description: 'Pi-style alias for shell_command. Pass cmd as argv, not a raw shell string.', risk: 'read_only', fields: { cmd: 'array', cwd: 'string', timeout_seconds: 'number', max_output_bytes: 'number' }, backend: 'alias' },
  { name: 'ls', description: 'List authorized workspace paths with the read-only command sandbox.', risk: 'read_only', fields: { path: 'string', cwd: 'string', max_output_bytes: 'number' }, backend: 'alias' },
  { name: 'test_command', description: 'Run an allowlisted test or build command.', risk: 'read_only', fields: { cmd: 'array', cwd: 'string', timeout_seconds: 'number', max_output_bytes: 'number' } },
  { name: 'shell_start', description: 'Start a persistent local shell session. Available only with danger-full-access.', risk: 'browser_interaction', fields: { cwd: 'string', shell: 'string', cols: 'number', rows: 'number', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'shell_write', description: 'Write a validated command or control input to a persistent shell session. Available only with danger-full-access.', risk: 'browser_interaction', fields: { session_id: 'string', data: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'shell_output', description: 'Read bounded recent output and status from a persistent shell session.', risk: 'read_only', fields: { session_id: 'string', max_chars: 'number' }, backend: 'implemented' },
  { name: 'shell_kill', description: 'Terminate a persistent local shell session. Available only with danger-full-access.', risk: 'browser_interaction', fields: { session_id: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'computer_observe', description: 'Observe bounded frontmost-window metadata and visible text.', risk: 'read_only', fields: { target: 'string', include_text: 'boolean', max_text_bytes: 'number' } },
  { name: 'find_roots', description: 'Pi computer-use: find controllable application windows and return stable root references.', risk: 'read_only', fields: { query: 'string', app: 'string', bundleId: 'string', pid: 'number', kind: 'string' }, backend: 'implemented' },
  { name: 'observe_ui', description: 'Pi computer-use: observe a window into an immutable stateId and semantic outline.', risk: 'read_only', fields: { app: 'string', windowTitle: 'string', root: 'string', image: 'string', mode: 'string', readText: 'string' }, backend: 'implemented' },
  { name: 'search_ui', description: 'Pi computer-use: search a previously observed UI state by text, role, or action.', risk: 'read_only', fields: { stateId: 'string', text: 'string', role: 'string', action: 'string', limit: 'number', image: 'string' }, backend: 'implemented' },
  { name: 'expand_ui', description: 'Pi computer-use: expand one ref from an immutable UI state to a bounded depth.', risk: 'read_only', fields: { stateId: 'string', ref: 'string', depth: 'number', image: 'string' }, backend: 'implemented' },
  { name: 'inspect_ui', description: 'Pi computer-use: inspect one ref from an immutable UI state.', risk: 'read_only', fields: { stateId: 'string', ref: 'string', includeRaw: 'boolean', image: 'string' }, backend: 'implemented' },
  { name: 'read_text', description: 'Pi computer-use: read a bounded text range from an observed state or ref.', risk: 'read_only', fields: { stateId: 'string', ref: 'string', offset: 'number', limit: 'number', image: 'string' }, backend: 'implemented' },
  { name: 'wait_for', description: 'Pi computer-use: wait for a semantic postcondition and return a successor state.', risk: 'read_only', fields: { stateId: 'string', text: 'string', role: 'string', gone: 'boolean', timeoutMs: 'number', image: 'string' }, backend: 'implemented' },
  { name: 'act_ui', description: 'Pi computer-use: execute a serialized UI action transaction against stateId and verify an optional postcondition.', risk: 'browser_interaction', fields: { stateId: 'string', actions: 'object_array', headless: 'boolean', expect: 'object', image: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'computer_use', description: 'Compatibility alias for Pi computer-use tools. Pass tool plus input, or a direct UI action.', risk: 'browser_interaction', fields: { tool: 'string', action: 'string', stateId: 'string', input: 'object', actions: 'object_array', expect: 'object', permission_profile: 'string' }, backend: 'alias' },
  { name: 'browser_observe', description: 'Observe bounded frontmost-browser metadata and visible text.', risk: 'read_only', fields: { target: 'string', include_text: 'boolean', max_text_bytes: 'number' } },
  { name: 'browser_snapshot', description: 'Hermes-style alias for observing bounded frontmost-browser metadata and visible text.', risk: 'read_only', fields: { target: 'string', include_text: 'boolean', max_text_bytes: 'number' }, backend: 'alias' },
  { name: 'browser_navigate', description: 'Navigate a policy-allowed URL in the frontmost/default browser.', risk: 'read_only', fields: { url: 'string', target: 'string' } },
  { name: 'browser_back', description: 'Navigate the managed browser tab back while preserving its session.', risk: 'read_only', fields: { session_id: 'string', tab_id: 'number' }, backend: 'implemented' },
  { name: 'browser_forward', description: 'Navigate the managed browser tab forward while preserving its session.', risk: 'read_only', fields: { session_id: 'string', tab_id: 'number' }, backend: 'implemented' },
  { name: 'browser_reload', description: 'Reload the active managed browser tab.', risk: 'read_only', fields: { session_id: 'string', tab_id: 'number' }, backend: 'implemented' },
  { name: 'browser_scroll', description: 'Scroll the active managed browser tab.', risk: 'read_only', fields: { direction: 'string', amount: 'number', delta_x: 'number', delta_y: 'number', session_id: 'string', tab_id: 'number' }, backend: 'implemented' },
  { name: 'browser_press', description: 'Press a key in the active managed browser tab.', risk: 'browser_interaction', fields: { key: 'string', session_id: 'string', tab_id: 'number', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'browser_console', description: 'Read bounded console output captured from the active managed browser tab.', risk: 'read_only', fields: { session_id: 'string', tab_id: 'number', max_entries: 'number' }, backend: 'implemented' },
  { name: 'browser_network', description: 'Read bounded network request and response events captured from the managed browser tab.', risk: 'read_only', fields: { session_id: 'string', tab_id: 'number', max_entries: 'number' }, backend: 'implemented' },
  { name: 'browser_dialog', description: 'Accept, dismiss, or answer a JavaScript dialog in the managed browser.', risk: 'browser_interaction', fields: { action: 'string', text: 'string', session_id: 'string', tab_id: 'number', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'browser_get_images', description: 'Collect source, alt text, and dimensions for page images in the managed browser.', risk: 'read_only', fields: { session_id: 'string', tab_id: 'number', max_results: 'number' }, backend: 'implemented' },
  { name: 'browser_screenshot', description: 'Capture the current managed browser tab to a local PNG artifact.', risk: 'read_only', fields: { session_id: 'string', tab_id: 'number' }, backend: 'implemented' },
  { name: 'browser_tabs', description: 'List, create, activate, or close managed browser tabs.', risk: 'read_only', fields: { action: 'string', session_id: 'string', tab_id: 'number', url: 'string' }, backend: 'implemented' },
  { name: 'browser_upload', description: 'Attach authorized local files to a file input in the managed browser.', risk: 'browser_interaction', fields: { selector: 'string', paths: 'array', session_id: 'string', tab_id: 'number', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'browser_evaluate', description: 'Evaluate a bounded JavaScript expression in the managed browser page.', risk: 'browser_interaction', fields: { expression: 'string', session_id: 'string', tab_id: 'number', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'browser_vision', description: 'Capture and analyze the current managed browser page visually.', risk: 'read_only', fields: { session_id: 'string', tab_id: 'number', question: 'string' }, backend: 'implemented' },
  { name: 'browser_cdp', description: 'Run a controlled Chrome DevTools Protocol request against the managed browser tab.', risk: 'browser_interaction', fields: { method: 'string', params: 'object', session_id: 'string', tab_id: 'number', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'desktop_app_list', description: 'List installed macOS application bundle metadata.', risk: 'read_only', fields: { max_results: 'number' } },
  { name: 'desktop_app_inspect', description: 'Inspect one macOS app bundle by name, bundle_id, or path.', risk: 'read_only', fields: { name: 'string', bundle_id: 'string', path: 'string' } },
  { name: 'system_health_check', description: 'Inspect local Joi Electron SQLite runtime health.', risk: 'read_only', fields: {} },
  { name: 'server_diagnose', description: 'Run lightweight read-only service diagnosis.', risk: 'read_only', fields: { service_name: 'string', host: 'string', port: 'number', url: 'string' } },
  { name: 'request_user_input', description: 'Ask one concise scheduling clarification and present two or three mutually exclusive choices before proposing an automation.', risk: 'read_only', fields: { question: 'string', options: 'array', header: 'string' }, backend: 'implemented' },
  { name: 'automation_update', description: 'Create a paused scheduled-task proposal for user review. Use mode suggested_create; never activate, update, or delete a scheduled task without review in the Scheduled tasks UI.', risk: 'read_only', fields: { mode: 'string', automation_id: 'string', kind: 'string', name: 'string', prompt: 'string', rrule: 'string', target_thread_id: 'string', model: 'string', reasoning_effort: 'string', cwds: 'array', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'apply_patch', description: 'Apply a bounded patch inside authorized workspace roots.', risk: 'workspace_write', fields: { patch: 'string', permission_profile: 'string' } },
  { name: 'patch', description: 'Pi-style alias for applying a bounded patch inside authorized workspace roots.', risk: 'workspace_write', fields: { patch: 'string', permission_profile: 'string' }, backend: 'alias' },
  { name: 'edit_file', description: 'Apply a bounded edit patch inside authorized workspace roots.', risk: 'workspace_write', fields: { path: 'string', patch: 'string', permission_profile: 'string' }, backend: 'alias' },
  { name: 'edit', description: 'Pi-style alias for applying a bounded edit patch inside authorized workspace roots.', risk: 'workspace_write', fields: { path: 'string', patch: 'string', permission_profile: 'string' }, backend: 'alias' },
  { name: 'write_file', description: 'Write file content through the bounded patch pipeline. Requires a unified patch payload.', risk: 'workspace_write', fields: { path: 'string', content: 'string', patch: 'string', permission_profile: 'string' }, backend: 'alias' },
  { name: 'write', description: 'Pi-style alias for writing file content through the bounded patch pipeline. Requires a unified patch payload.', risk: 'workspace_write', fields: { path: 'string', content: 'string', patch: 'string', permission_profile: 'string' }, backend: 'alias' },
  { name: 'browser_click', description: 'Click an element in the frontmost browser.', risk: 'browser_interaction', fields: { selector: 'string', target: 'string', permission_profile: 'string' } },
  { name: 'browser_type', description: 'Type into an element in the frontmost browser.', risk: 'browser_interaction', fields: { selector: 'string', text: 'string', target: 'string', permission_profile: 'string' } },
  { name: 'execute_code', description: 'Run JavaScript, TypeScript, Python, Swift, or shell code in an ephemeral local kernel.', risk: 'workspace_write', fields: { language: 'string', code: 'string', cwd: 'string', timeout_seconds: 'number', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'code_execution', description: 'Compatibility alias for the ephemeral local code kernel.', risk: 'workspace_write', fields: { language: 'string', code: 'string', cwd: 'string', timeout_seconds: 'number', permission_profile: 'string' }, backend: 'alias' },
  { name: 'sandbox_run', description: 'Run an argv command inside a macOS sandbox-exec profile scoped to the authorized workspace.', risk: 'workspace_write', fields: { cmd: 'array', cwd: 'string', timeout_seconds: 'number', network: 'boolean', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'delegate_task', description: 'Create one bounded child-agent run with an independent conversation, run trace, agent capability set, and parent-run provenance.', risk: 'workspace_write', fields: { prompt: 'string', agent: 'string', title: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'subagent_delegate', description: 'Compatibility alias for creating a bounded child-agent run.', risk: 'workspace_write', fields: { prompt: 'string', agent: 'string', title: 'string', permission_profile: 'string' }, backend: 'alias' },
  { name: 'mcp_tool_call', description: 'Call an enabled, wrapped MCP tool through the managed stdio/Streamable HTTP/SSE runtime.', risk: 'workspace_write', fields: { server_id: 'string', tool_name: 'string', input: 'object', timeout_ms: 'number', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'extension_register_tool', description: 'Register and wrap a tool exposed by an installed extension MCP server.', risk: 'workspace_write', fields: { extension_id: 'string', server_id: 'string', tool_name: 'string', description: 'string', risk_level: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'lsp_definition', description: 'Resolve a symbol definition with the native language server for an authorized source file.', risk: 'read_only', fields: { path: 'string', line: 'number', character: 'number' }, backend: 'implemented' },
  { name: 'lsp_references', description: 'Resolve symbol references with the native language server for an authorized source file.', risk: 'read_only', fields: { path: 'string', line: 'number', character: 'number', include_declaration: 'boolean' }, backend: 'implemented' },
  { name: 'lsp_diagnostics', description: 'Read native language-server diagnostics for an authorized source file.', risk: 'read_only', fields: { path: 'string' }, backend: 'implemented' },
  { name: 'lsp_hover', description: 'Read hover and type documentation from the native language server.', risk: 'read_only', fields: { path: 'string', line: 'number', character: 'number' }, backend: 'implemented' },
  { name: 'lsp_symbols', description: 'List hierarchical document symbols from the native language server.', risk: 'read_only', fields: { path: 'string' }, backend: 'implemented' },
  { name: 'lsp_code_actions', description: 'List native language-server quick fixes and refactors for a source range.', risk: 'read_only', fields: { path: 'string', line: 'number', character: 'number', end_line: 'number', end_character: 'number', only: 'array' }, backend: 'implemented' },
  { name: 'lsp_rename', description: 'Rename a symbol and apply the resulting authorized workspace edits.', risk: 'workspace_write', fields: { path: 'string', line: 'number', character: 'number', new_name: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'lsp_format', description: 'Format a source file and apply the resulting authorized workspace edits.', risk: 'workspace_write', fields: { path: 'string', tab_size: 'number', insert_spaces: 'boolean', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'debugger_attach', description: 'Start a native LLDB session for an authorized local executable.', risk: 'browser_interaction', fields: { target: 'string', args: 'array', cwd: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'debugger_breakpoint', description: 'Set a source-line or symbol breakpoint in an active LLDB session.', risk: 'browser_interaction', fields: { session_id: 'string', path: 'string', line: 'number', symbol: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'debugger_step', description: 'Run, continue, or step an active native LLDB session.', risk: 'browser_interaction', fields: { action: 'string', session_id: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'debugger_evaluate', description: 'Evaluate a bounded expression in an active native LLDB session.', risk: 'browser_interaction', fields: { expression: 'string', session_id: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'debugger_threads', description: 'List native threads in an active LLDB session.', risk: 'browser_interaction', fields: { session_id: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'debugger_stack', description: 'Read the selected or all-thread native stack trace from LLDB.', risk: 'browser_interaction', fields: { session_id: 'string', all_threads: 'boolean', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'debugger_locals', description: 'Read local variables from the selected LLDB frame.', risk: 'browser_interaction', fields: { session_id: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'debugger_watchpoint', description: 'Set a native variable or expression watchpoint in LLDB.', risk: 'browser_interaction', fields: { session_id: 'string', variable: 'string', expression: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'debugger_memory', description: 'Read a bounded native memory range from LLDB.', risk: 'browser_interaction', fields: { session_id: 'string', address: 'string', count: 'number', format: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'debugger_stop', description: 'Terminate and dispose an active native LLDB session.', risk: 'browser_interaction', fields: { session_id: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'image_analyze', description: 'Analyze an authorized local image with macOS Vision OCR and ffprobe metadata.', risk: 'read_only', fields: { path: 'string', image_path: 'string', question: 'string' }, backend: 'implemented' },
  { name: 'vision_analyze', description: 'Compatibility alias for local image analysis with macOS Vision OCR.', risk: 'read_only', fields: { path: 'string', image_path: 'string', question: 'string' }, backend: 'alias' },
  { name: 'image_generate', description: 'Generate a new image with the authenticated Grok Build native image_gen tool and persist it as a Joi attachment.', risk: 'read_only', fields: { prompt: 'string', aspect_ratio: 'string', size: 'string', style: 'string' }, backend: 'implemented' },
  { name: 'video_generate', description: 'Generate a real video with the authenticated xAI video model, download it locally, and persist it as a Joi attachment.', risk: 'read_only', fields: { prompt: 'string', duration_seconds: 'number', aspect_ratio: 'string', resolution: 'string' }, backend: 'implemented' },
  { name: 'video_analyze', description: 'Analyze an authorized local video with ffprobe, FFmpeg keyframes/contact sheet, and macOS Vision OCR.', risk: 'read_only', fields: { path: 'string', video_path: 'string', question: 'string', max_frames: 'number', transcribe: 'boolean', language: 'string', model: 'string' }, backend: 'implemented' },
  { name: 'text_to_speech', description: 'Generate a playable local speech artifact with the native macOS speech engine and FFmpeg. Set format explicitly to mp3, wav, or aiff when the user requests one; the default is mp3.', risk: 'read_only', fields: { text: 'string', voice: 'string', format: 'string', rate: 'number' }, backend: 'implemented' },
  { name: 'speech_transcribe', description: 'Transcribe an authorized local audio artifact with the local Whisper runtime. Pass the generated audio path as path; file_path is accepted as a compatibility alias.', risk: 'read_only', fields: { path: 'string', file_path: 'string', language: 'string', model: 'string' }, backend: 'implemented' },
  { name: 'assistant_workspace', description: 'Read the local personal-assistant workspace: activity capture, calendar drafts, evidence plans, and configured channels.', risk: 'read_only', fields: {}, backend: 'implemented' },
  { name: 'assistant_action', description: 'Operate the local personal-assistant loop: capture activity, draft or publish calendar items, maintain evidence-backed plans, configure channels, or send a requested channel message.', risk: 'browser_interaction', fields: { action: 'string', id: 'string', session_id: 'string', conversation_id: 'string', title: 'string', objective: 'string', text: 'string', start_at: 'string', end_at: 'string', interval_seconds: 'number', provider: 'string', enabled: 'boolean', path: 'string', metadata: 'object', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'memory_recall', description: 'Recall confirmed local memory within the current room, project, and user scope.', risk: 'read_only', fields: { query: 'string', max_results: 'number' }, backend: 'implemented' },
  { name: 'memory_search', description: 'Compatibility alias for scoped local memory recall.', risk: 'read_only', fields: { query: 'string', max_results: 'number' }, backend: 'alias' },
  { name: 'memory_write_candidate', description: 'Create a pending local memory candidate for user review; it is not activated automatically.', risk: 'workspace_write', fields: { content: 'string', summary: 'string', type: 'string', scope: 'string', source: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'memory', description: 'Generic memory operation. Returns not_configured until memory tool dispatch is connected.', risk: 'workspace_write', fields: { action: 'string', query: 'string', content: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'session_search', description: 'Search local Joi conversations and transcript history.', risk: 'read_only', fields: { query: 'string', max_results: 'number' }, backend: 'implemented' },
  { name: 'session_summary', description: 'Load a bounded conversation overview and recent transcript so the model can summarize or resume it.', risk: 'read_only', fields: { session_id: 'string', thread_id: 'string', max_messages: 'number', max_chars: 'number' }, backend: 'implemented' },
  { name: 'session_branch', description: 'Fork a local conversation at a selected message while keeping the source transcript unchanged and recording branch provenance.', risk: 'workspace_write', fields: { session_id: 'string', from_message_id: 'string', title: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'session_compact', description: 'Persist a model-authored conversation checkpoint, keep the original transcript, and reduce future prompt context.', risk: 'workspace_write', fields: { session_id: 'string', summary: 'string', keep_recent_messages: 'number', reason: 'string', permission_profile: 'string' }, backend: 'implemented' },
  { name: 'compaction_run', description: 'Compatibility alias for persistent conversation compaction.', risk: 'workspace_write', fields: { session_id: 'string', summary: 'string', keep_recent_messages: 'number', reason: 'string', permission_profile: 'string' }, backend: 'alias' },
  { name: 'queue_followup', description: 'Queue a follow-up task or reminder. Returns not_configured until queue integration is connected.', risk: 'workspace_write', fields: { title: 'string', prompt: 'string', due_at: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'clarify', description: 'Ask for a concise clarification instead of executing unsafe assumptions.', risk: 'read_only', fields: { question: 'string', options: 'array' }, backend: 'planned' },
  { name: 'todo', description: 'Create or update an execution todo list. Returns not_configured until todo persistence is connected.', risk: 'read_only', fields: { items: 'array', status: 'string' }, backend: 'planned' },
  { name: 'cronjob', description: 'Create or inspect a recurring task. Returns not_configured until automation scheduling is connected.', risk: 'workspace_write', fields: { action: 'string', schedule: 'string', prompt: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'project_list', description: 'List local Joi projects and their active personas.', risk: 'read_only', fields: { query: 'string', max_results: 'number' }, backend: 'implemented' },
  { name: 'project_create', description: 'Create a local Joi project. Returns not_configured until project registry tools are connected.', risk: 'workspace_write', fields: { name: 'string', description: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'project_switch', description: 'Switch the active local Joi project. Returns not_configured until project registry tools are connected.', risk: 'workspace_write', fields: { project_id: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'skills_list', description: 'List enabled local Codex-compatible skills from Joi\'s live skill registry.', risk: 'read_only', fields: { query: 'string', max_results: 'number' }, backend: 'implemented' },
  { name: 'skill_view', description: 'Read one local skill definition and bounded instructions.', risk: 'read_only', fields: { skill_id: 'string', max_chars: 'number' }, backend: 'implemented' },
  { name: 'skill_manage', description: 'Install, update, or remove a local skill. Returns not_configured until skill management tools are connected.', risk: 'workspace_write', fields: { action: 'string', skill_id: 'string', permission_profile: 'string' }, backend: 'planned' },
  { name: 'tool_search', description: 'Search Joi native capabilities, installed MCP tools, and enabled skills available on this machine.', risk: 'read_only', fields: { query: 'string', max_results: 'number' }, backend: 'implemented' },
  { name: 'task_list', description: 'List persisted Joi product tasks, optionally filtered by status or conversation.', risk: 'read_only', fields: { status: 'string', conversation_id: 'string', max_results: 'number' }, backend: 'implemented' },
  { name: 'task_view', description: 'Read one persisted Joi product task with steps and deliverables.', risk: 'read_only', fields: { task_id: 'string' }, backend: 'implemented' },
  { name: 'task_update', description: 'Close or reopen one persisted Joi product task after confirmation.', risk: 'workspace_write', fields: { task_id: 'string', action: 'string', outcome: 'string', reason: 'string', permission_profile: 'string' }, backend: 'implemented' },
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
    case 'memory_search':
      return 'memory_recall';
    case 'test_command_v1':
      return 'test_command';
    case 'image_gen':
      return 'image_generate';
    case 'vision_analyze':
      return 'image_analyze';
    case 'subagent_delegate':
      return 'delegate_task';
    case 'compaction_run':
      return 'session_compact';
    case 'apply_patch_v1':
    case 'patch':
    case 'edit_file':
    case 'edit':
    case 'write_file':
    case 'write':
      return 'apply_patch';
    case 'browser_snapshot':
      return 'browser_observe';
    case 'computer_use':
      return 'act_ui';
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

export function electronCapabilityRisk(capability: string): CapabilityToolDefinition['risk'] {
  const canonical = canonicalElectronCapabilityName(capability);
  return capabilityToolDefinitions.find((definition) => definition.name === capability || definition.name === canonical)?.risk || 'read_only';
}

export function electronCapabilityRequiresConfirmation(capability: string): boolean {
  return electronCapabilityRisk(capability) !== 'read_only';
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
      : type === 'object_array'
        ? { type: 'array', items: { type: 'object', additionalProperties: true } }
      : { type };
  }
  const required = requiredFieldsForCapability(definition.name);
  return {
    name: definition.name,
    description: definition.description,
    execution_mode: definition.risk === 'read_only' ? 'parallel' : 'sequential',
    timeout_seconds: ['image_generate', 'video_generate', 'image_analyze', 'video_analyze', 'speech_transcribe'].includes(definition.name)
      ? 180
      : ['find_roots', 'observe_ui', 'search_ui', 'expand_ui', 'inspect_ui', 'read_text', 'wait_for', 'act_ui', 'computer_use'].includes(definition.name)
        ? 90
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
    case 'video_generate':
      return ['prompt'];
    case 'image_analyze':
    case 'vision_analyze':
      return ['path'];
    case 'video_analyze':
      return ['path'];
    case 'text_to_speech':
      return ['text'];
    case 'execute_code':
    case 'code_execution':
      return ['language', 'code'];
    case 'sandbox_run':
      return ['cmd'];
    case 'speech_transcribe':
      return ['path'];
    case 'delegate_task':
    case 'subagent_delegate':
      return ['prompt'];
    case 'session_branch':
      return ['session_id'];
    case 'session_compact':
    case 'compaction_run':
      return ['session_id', 'summary'];
    case 'lsp_definition':
    case 'lsp_references':
    case 'lsp_hover':
      return ['path', 'line', 'character'];
    case 'lsp_rename':
      return ['path', 'line', 'character', 'new_name'];
    case 'lsp_diagnostics':
    case 'lsp_symbols':
    case 'lsp_code_actions':
    case 'lsp_format':
      return ['path'];
    case 'mcp_tool_call':
      return ['server_id', 'tool_name', 'input'];
    case 'extension_register_tool':
      return ['extension_id', 'server_id', 'tool_name'];
    case 'debugger_attach':
      return ['target'];
    case 'debugger_breakpoint':
      return ['session_id'];
    case 'debugger_step':
      return ['session_id', 'action'];
    case 'debugger_evaluate':
      return ['session_id', 'expression'];
    case 'debugger_threads':
    case 'debugger_stack':
    case 'debugger_locals':
      return ['session_id'];
    case 'debugger_watchpoint':
      return ['session_id'];
    case 'debugger_memory':
      return ['session_id', 'address'];
    case 'debugger_stop':
      return ['session_id'];
    case 'shell_command':
    case 'bash':
    case 'test_command':
      return ['cmd'];
    case 'shell_write':
      return ['session_id', 'data'];
    case 'shell_output':
    case 'shell_kill':
      return ['session_id'];
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
    case 'browser_press':
      return ['key'];
    case 'browser_upload':
      return ['selector', 'paths'];
    case 'browser_evaluate':
      return ['expression'];
    case 'browser_cdp':
      return ['method'];
    case 'expand_ui':
    case 'inspect_ui':
      return ['ref'];
    case 'act_ui':
      return ['actions'];
    case 'request_user_input':
      return ['question', 'options'];
    case 'automation_update':
      return ['mode', 'name', 'prompt', 'rrule'];
    case 'assistant_action':
      return ['action'];
    case 'memory_write_candidate':
      return ['content'];
    case 'skill_view':
      return ['skill_id'];
    case 'task_view':
      return ['task_id'];
    case 'task_update':
      return ['task_id', 'action'];
    default:
      return [];
  }
}
