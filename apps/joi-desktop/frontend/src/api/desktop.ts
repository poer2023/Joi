import {
  desktopBindingMethods,
  type DesktopBindings,
  type JoiPreloadApi,
  type ApprovalDecisionRequest,
  type ApprovalResumeRunRequest,
  type ArtifactDetail,
  type ArtifactSummary,
  type AvailableModel,
  type BackupRecord,
  type CapabilityRecord,
  type ChatRequest,
  type ChatResponse,
  type ConfirmationRecord,
  type ConversationActionRequest,
  type ConversationActionResponse,
  type ConversationDetail,
  type ConversationFilter,
  type ConversationGroup,
  type ConversationGroupRequest,
  type ConversationMessage,
  type ConversationSummary,
  type ConnectionTest,
  type ExternalHandoffAudit,
  type InputMode,
  type InterruptRunRequest,
  type MCPServerRecord,
  type MCPWrapToolRequest,
  type MemoryCandidateDecisionRequest,
  type MemoryCandidateFilter,
  type MemoryCorrectionRequest,
  type MemoryDeleteRequest,
  type MemoryRecord,
  type MemorySearchResult,
  type ModelCall,
  type ModelConfigRequest,
  type ModelConnectionTestRequest,
  type ModelListRequest,
  type ModelRuntimeConfig,
  type ModelSettingsRequest,
  type NodeRecord,
  type OnboardingStatus,
  type OpenLoop,
  type PermissionProfile,
  type PhotonIMessageSetupRequest,
  type PhotonIMessageSetupResult,
  type PhotonIMessageStatus,
  type ProactiveMessage,
  type ProductTask,
  type ProductTaskCloseRequest,
  type ProductTaskDetail,
  type ProductTaskFilter,
  type ProductTaskReopenRequest,
  type ReflectionResult,
  type RecordNotificationOpenedRequest,
  type RecoverableRunRecord,
  type RedirectRunRequest,
  type RedirectRunResponse,
  type RunClosureReport,
  type RunEvent,
  type RunTrace,
  type RuntimeMode,
  type SecretStatus,
  type SettingsRecord,
  type SkillRecord,
  type SystemHealth,
  type TerminalSessionEvent,
  type TerminalSessionInfo,
  type TerminalSessionInputRequest,
  type TerminalSessionKillRequest,
  type TerminalSessionResizeRequest,
  type TerminalSessionSnapshot,
  type TerminalSessionStartRequest,
  type ToolRunRecord,
  type ToolWorkflowRecord,
  type WorkerGatewayAuditRecord,
  type WorkspaceSettings,
} from '../../../../../packages/shared-types/src/desktop-api';
export type {
  ApprovalDecisionRequest,
  ApprovalResumeRunRequest,
  ArtifactDetail,
  ArtifactSummary,
  AvailableModel,
  BackupRecord,
  CapabilityRecord,
  ChatRequest,
  ChatResponse,
  ConfirmationRecord,
  ConversationActionRequest,
  ConversationActionResponse,
  ConversationDetail,
  ConversationFilter,
  ConversationGroup,
  ConversationGroupRequest,
  ConversationMessage,
  ConversationSummary,
  ConnectionTest,
  ExternalHandoffAudit,
  InputMode,
  InterruptRunRequest,
  MCPServerRecord,
  MCPWrapToolRequest,
  MemoryCandidateDecisionRequest,
  MemoryCandidateFilter,
  MemoryCorrectionRequest,
  MemoryDeleteRequest,
  MemoryRecord,
  MemorySearchResult,
  ModelCall,
  ModelConfigRequest,
  ModelConnectionTestRequest,
  ModelListRequest,
  ModelRuntimeConfig,
  ModelSettingsRequest,
  NodeRecord,
  OnboardingStatus,
  OpenLoop,
  PermissionProfile,
  PhotonIMessageSetupRequest,
  PhotonIMessageSetupResult,
  PhotonIMessageStatus,
  ProactiveMessage,
  ProductTask,
  ProductTaskCloseRequest,
  ProductTaskDetail,
  ProductTaskFilter,
  ProductTaskReopenRequest,
  ReflectionResult,
  RecoverableRunRecord,
  RedirectRunRequest,
  RedirectRunResponse,
  RunClosureReport,
  RunEvent,
  RunTrace,
  RuntimeMode,
  SecretStatus,
  SettingsRecord,
  SkillRecord,
  SystemHealth,
  TerminalSessionEvent,
  TerminalSessionInfo,
  TerminalSessionInputRequest,
  TerminalSessionKillRequest,
  TerminalSessionResizeRequest,
  TerminalSessionSnapshot,
  TerminalSessionStartRequest,
  ToolRunRecord,
  ToolWorkflowRecord,
  WorkerGatewayAuditRecord,
  WorkspaceSettings,
} from '../../../../../packages/shared-types/src/desktop-api';

declare global {
  interface Window {
    joi?: JoiPreloadApi;
  }
}

function electronBindings(api: JoiPreloadApi): DesktopBindings {
  const mapped = {} as Record<keyof DesktopBindings, (payload?: unknown) => Promise<unknown>>;
  for (const method of desktopBindingMethods) {
    mapped[method] = (payload?: unknown) => api.invoke(method, payload);
  }
  mapped.WrapMCPTool = (serverID?: unknown, toolName?: unknown, req?: unknown) => api.invoke('WrapMCPTool', {
    server_id: serverID,
    tool_name: toolName,
    request: req,
  });
  return mapped as unknown as DesktopBindings;
}

function bindings(): DesktopBindings {
  if (window.joi?.invoke) {
    return electronBindings(window.joi);
  }
  return {
      async SendChat(req) {
        const runID = `run_preview_${Date.now()}`;
        return {
          conversation_id: 'conv_preview',
          user_message_id: 'msg_preview_user',
          assistant_message_id: 'msg_preview_assistant',
          run_id: runID,
          selected_agent_id: 'general_agent',
          response: `Preview mode: ${req.message}`,
          model_calls: [],
        };
      },
      async GetRunTrace(runID) {
        return {
          id: runID,
          conversation_id: 'conv_preview',
          status: 'preview',
          selected_agent_id: 'general_agent',
          steps: [
            { id: 'step_preview_1', step_type: 'input_received', title: 'Input received', status: 'succeeded' },
            { id: 'step_preview_2', step_type: 'response_generated', title: 'Response generated', status: 'succeeded' },
          ],
        };
      },
      async ListConversations(filter: ConversationFilter = { view: 'active', limit: 100 }) {
        if (filter.view && filter.view !== 'active') {
          return { conversations: [] };
        }
        return {
          conversations: [
            {
              id: 'conv_preview',
              channel: 'preview',
              user_id: 'desktop_user',
              title: 'Preview conversation',
              active_agent_id: 'general_agent',
              last_message: 'Preview mode',
              last_role: 'assistant',
              latest_run_id: '',
              message_count: 2,
              lifecycle_status: 'active',
            },
          ],
        };
      },
      async ListConversationGroups() {
        return { groups: [{ id: 'cgrp_preview', name: '默认分组', sort_order: 1, collapsed: false }] };
      },
      async SaveConversationGroup(req) {
        return { id: req.id || `cgrp_preview_${Date.now()}`, name: req.name, sort_order: req.sort_order ?? 0, collapsed: Boolean(req.collapsed), metadata: req.metadata ?? {} };
      },
      async DeleteConversationGroup() {},
      async MoveConversationToGroup() {
        return { conversation: { id: 'conv_preview', channel: 'preview', user_id: 'desktop_user', title: 'Preview conversation', message_count: 2, lifecycle_status: 'active' } };
      },
      async ArchiveConversation() {
        return { conversation: { id: 'conv_preview', channel: 'preview', user_id: 'desktop_user', title: 'Preview conversation', message_count: 2, lifecycle_status: 'archived' } };
      },
      async TrashConversation() {
        return { conversation: { id: 'conv_preview', channel: 'preview', user_id: 'desktop_user', title: 'Preview conversation', message_count: 2, lifecycle_status: 'trashed', purge_after: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString() } };
      },
      async RestoreConversation() {
        return { conversation: { id: 'conv_preview', channel: 'preview', user_id: 'desktop_user', title: 'Preview conversation', message_count: 2, lifecycle_status: 'active' } };
      },
      async PurgeConversation() {
        return { conversation: { id: 'conv_preview', channel: 'preview', user_id: 'desktop_user', title: '[已永久清理]', message_count: 2, lifecycle_status: 'purged' } };
      },
      async GetConversation() {
        return {
          conversation: {
            id: 'conv_preview',
            channel: 'preview',
            user_id: 'desktop_user',
            title: 'Preview conversation',
            active_agent_id: 'general_agent',
            last_message: 'Preview mode',
            last_role: 'assistant',
            latest_run_id: '',
            message_count: 2,
          },
          messages: [
            { id: 'msg_preview_user', conversation_id: 'conv_preview', role: 'user', content: 'Preview request' },
            { id: 'msg_preview_assistant', conversation_id: 'conv_preview', role: 'assistant', content: 'Preview response', run_id: '' },
          ],
        };
      },
      async ListCapabilities() {
        return {
          capabilities: [
            { id: 'desktop_app_list', name: 'Desktop App List', description: 'List installed macOS applications as local metadata.', risk_level: 'read_only', enabled: true, metadata: { source: 'native', intent_domain: 'desktop_application_inventory' } },
            { id: 'workspace_search', name: 'Workspace Search', description: 'Search authorized workspace source and documents.', risk_level: 'read_only', enabled: true, metadata: { source: 'native', intent_domain: 'workspace_search' } },
            { id: 'file_analyze', name: 'File Analyze', description: 'Analyze an authorized workspace file.', risk_level: 'read_only', enabled: true, metadata: { source: 'native', intent_domain: 'authorized_file_read' } },
          ],
        };
      },
      async ListMCPServers() {
        return { servers: [{ id: 'local_mcp_registry', name: 'Local MCP Registry', transport: 'not_configured', status: 'inactive', trust: 'untrusted_until_wrapped', tools: [], resources: [], prompts: [], metadata: { policy: 'MCP tools require wrapping before execution.' } }] };
      },
      async SyncMCPServer(id) {
        return { server: { id, name: 'Local MCP Registry', transport: 'not_configured', status: 'inactive', trust: 'untrusted_until_wrapped', tools: [], resources: [], prompts: [], metadata: { last_sync_result: 'no configured MCP transport' } } };
      },
      async WrapMCPTool(serverID, toolName, req) {
        return { capability: { id: req.capability_id || `mcp_${serverID}_${toolName}`, name: toolName, description: req.description, risk_level: req.risk_level, enabled: true, metadata: { source: 'mcp_wrapped', intent_domain: req.intent_domain } } };
      },
      async ListSkills() {
        return { skills: [{ id: 'desktop_inventory_skill', version: 'v1', name: 'Desktop Inventory', description: 'List local installed applications without reading app content.', trigger_phrases: ['列出本地所有 app'], required_capabilities: ['desktop_app_list'], forbidden_capabilities: ['system_health_check'], output_contract: 'final_answer with bounded app metadata', enabled: true, metadata: { source: 'native_skill_registry' } }] };
      },
      async ListToolWorkflows() {
        return {
          workflows: [
            { id: 'workflow_desktop_app_list_v1', capability_id: 'desktop_app_list', name: 'desktop_app_list_v1', version: 'v1', risk_level: 'read_only', enabled: true, steps: [{ tool: 'desktop_list_app_bundles', risk_level: 'read_only' }] },
            { id: 'workflow_workspace_search_v1', capability_id: 'workspace_search', name: 'workspace_search_v1', version: 'v1', risk_level: 'read_only', enabled: true, steps: [{ tool: 'workspace_walk_search', risk_level: 'read_only' }] },
            { id: 'workflow_file_analyze_v1', capability_id: 'file_analyze', name: 'file_analyze_v1', version: 'v1', risk_level: 'read_only', enabled: true, steps: [{ tool: 'file_read_authorized', risk_level: 'read_only' }] },
          ],
        };
      },
      async ListToolRuns() {
        return { tool_runs: [] };
      },
      async SetToolWorkflowEnabled() {},
      async GetSystemHealth() {
        return {
          service_status: { sqlite: true, orchestrator: 'preview' },
          queue_status: { active_tasks: 0 },
          worker_status: [],
          warnings: [],
        };
      },
      async ListMemories() {
        return { memories: [] };
      },
      async UpdateMemory() {},
      async ListMemoriesUsedForRun() {
        return { memories: [] };
      },
      async ListMemoryCandidates() {
        return { memories: [] };
      },
      async DecideMemoryCandidate() {},
      async CorrectMemory() {},
      async DeleteMemory() {},
      async ListUserStates() {
        return { memories: [] };
      },
      async ListRelationshipStates() {
        return { memories: [] };
      },
      async ListProductTasks() {
        return {
          tasks: [
            {
              id: 'ptask_preview',
              title: '整理 Joi 伙伴前台与执行后台闭环',
              description: 'Preview product task',
              status: 'running',
              mode: 'serious_task',
              priority: 'normal',
              latest_run_id: 'run_preview',
              risk_level: 'read_only',
              progress_percent: 45,
              current_step_id: 'pstep_preview_2',
            },
          ],
        };
      },
      async ListProductTasksByConversation() {
        return this.ListProductTasks({});
      },
      async ListProductTasksByPrincipal() {
        return this.ListProductTasks({});
      },
      async GetProductTask() {
        return {
          task: {
            id: 'ptask_preview',
            title: '整理 Joi 伙伴前台与执行后台闭环',
            description: 'Preview product task',
            status: 'running',
            mode: 'serious_task',
            priority: 'normal',
            latest_run_id: 'run_preview',
            risk_level: 'read_only',
            progress_percent: 45,
            current_step_id: 'pstep_preview_2',
          },
          steps: [
            { id: 'pstep_preview_1', product_task_id: 'ptask_preview', title: '理解目标与约束', status: 'done', sort_order: 1 },
            { id: 'pstep_preview_2', product_task_id: 'ptask_preview', title: '整理上下文与证据', status: 'running', sort_order: 2 },
            { id: 'pstep_preview_3', product_task_id: 'ptask_preview', title: '产出交付物', status: 'pending', sort_order: 3 },
          ],
          deliverables: [],
        };
      },
      async CloseProductTask(req) {
        return this.GetProductTask(req.id);
      },
      async ReopenProductTask(req) {
        return this.GetProductTask(req.id);
      },
      async GetRecentRunClosureReport() {
        return {
          items: [],
          metrics: {
            total_runs: 0,
            terminal_event_runs: 0,
            execution_runs: 0,
            execution_runs_with_task_or_refusal: 0,
            completed_tasks: 0,
            completed_tasks_with_evidence: 0,
            runs_with_tool_evidence: 0,
            runs_with_memory_events: 0,
            runs_with_proactive_events: 0,
            runs_with_handoff_events: 0,
            recoverable_runs: 0,
          },
        };
      },
      async GetExternalHandoffAudit() {
        return {
          ok: true,
          schema_current: true,
          missing_schema: [],
          external_channels_seen: [],
          linked_live_handoffs: [],
          pending_external_handoffs: [],
          metrics: {
            external_runs: 0,
            desktop_runs: 0,
            linked_external_desktop_tasks: 0,
          },
          readiness: {
            checked: false,
            ok: false,
            credentials: {},
            checks: {},
            services: {},
          },
          status: 'unknown',
          next_action: '',
        };
      },
      async ListArtifacts() {
        return { artifacts: [] };
      },
      async GetArtifact(id) {
        return {
          id,
          type: 'report',
          title: 'Preview artifact',
          content_format: 'markdown',
          version: 1,
          status: 'active',
          content: '# Preview artifact\n\n这里会显示任务交付物。',
        };
      },
      async ListOpenLoops() {
        return { open_loops: [] };
      },
      async DecideOpenLoop() {},
      async ListProactiveMessages() {
        return { messages: [] };
      },
      async DecideProactiveMessage() {},
      async RecordNotificationOpened() {},
      async ListNodes() {
        return { nodes: [] };
      },
      async DisableNode() {},
      async EnableNode() {},
      async ListWorkerGatewayAuditLogs() {
        return { items: [] };
      },
      async GetModelUsage() {
        return { items: [] };
      },
      async ListConfirmations() {
        return { items: [] };
      },
      async DecideConfirmation() {},
      async ListPendingApprovals() {
        return { items: [] };
      },
      async DecideApproval() {
        return {};
      },
      async ResumeApprovalRun() {
        return { resumed: false };
      },
      async InterruptRun() {},
      async RedirectRun(req) {
        return {
          redirected_run: {
            id: req.run_id,
            status: 'redirected',
            selected_agent_id: 'general_agent',
            events: [{ id: 'evt_preview_redirected', run_id: req.run_id, seq: 1, event_type: 'run.redirected', terminal: true }],
            steps: [],
          },
        };
      },
      async ListRecoverableRuns() {
        return { runs: [] };
      },
      async ListBackups() {
        return { backups: [] };
      },
      async CreateBackup() {
        return { path: 'preview.joibak' };
      },
      async RestoreBackup() {},
      async ExportDiagnostics() {
        return { path: 'preview-diagnostics.zip' };
      },
      async GetSettings() {
        return {
          app_mode: 'desktop',
          version: '0.1.0-rc0',
          data_store: 'sqlite',
          task_queue: 'sqlite',
          sqlite_path: 'preview',
          log_dir: 'preview/logs',
          model_provider: 'openai_compatible',
          model_name: 'deepseek-v4-flash',
          model_reasoning_name: 'deepseek-v4-pro',
          model_base_url: '',
          telegram_enabled: false,
          telegram_allowed_user_ids: '',
          imessage_enabled: false,
          imessage_allowed_users: '',
          imessage_require_mention: false,
          imessage_operator_phone: '',
          imessage_assigned_number: '',
          imessage_project_id: '',
          imessage_home_channel: '',
          imessage_sidecar_port: 8790,
          worker_gateway: '',
          worker_gateway_enabled: true,
          backup_dir: 'preview/backups',
          auto_backup_enabled: false,
          docker_required: false,
        };
      },
      async GetWorkspaceSettings() {
        return {
          allowed_roots: ['/Users/hao/project/Joi'],
          default_root: '/Users/hao/project/Joi',
          browser_allowed_hosts: [],
          web_research_allow_private_hosts: false,
          file_analyze_max_bytes: 65536,
          workspace_search_max_results: 50,
        };
      },
      async SaveWorkspaceSettings() {},
      async ListSavedModels() {
        return {
          models: [
            {
              provider: 'openai_compatible',
              base_url: 'https://api.deepseek.com/v1',
              id: 'deepseek-v4-flash',
              display_name: 'DeepSeek V4 Flash',
              owner: 'deepseek',
              context_window: 64000,
              max_output_tokens: 8192,
              supports_json_mode: true,
              supports_tool_calling: true,
              supports_reasoning: false,
              supported_parameters: ['temperature', 'max_tokens', 'response_format', 'tools'],
              config: { role: 'default', enabled: true, temperature: 0.7, max_output_tokens: 8192, timeout_seconds: 60, max_retries: 1, supports_json_mode: true, supports_tool_calling: true, supports_reasoning: false },
            },
            {
              provider: 'openai_compatible',
              base_url: 'https://api.deepseek.com/v1',
              id: 'deepseek-v4-pro',
              display_name: 'DeepSeek V4 Pro',
              owner: 'deepseek',
              context_window: 128000,
              max_output_tokens: 16384,
              supports_json_mode: true,
              supports_tool_calling: true,
              supports_reasoning: true,
              supported_parameters: ['temperature', 'max_tokens', 'response_format', 'tools', 'reasoning'],
              config: { role: 'reasoning', enabled: true, temperature: 0.3, max_output_tokens: 16384, timeout_seconds: 90, max_retries: 1, supports_json_mode: true, supports_tool_calling: true, supports_reasoning: true },
            },
          ],
        };
      },
      async SaveModelConfig() {},
      async SaveModelSettings() {},
      async SaveOperationalSettings() {},
      async SaveTelegramConfig() {},
      async SendTestTelegramMessage() {
        return { ok: true, status: 'preview' };
      },
      async SetupPhotonIMessage() {
        return {
          status: 'succeeded',
          project_id: 'preview-photon-project',
          operator_phone: '+15551234567',
          assigned_number: '+15557654321',
          project_created: false,
          user_created: false,
        };
      },
      async SaveIMessageConfig() {},
      async GetIMessageStatus() {
        return {
          enabled: false,
          configured: false,
          connected: false,
          sidecar_running: false,
          sidecar_port: 8790,
          project_id: '',
          operator_phone: '',
          assigned_number: '',
          allowed_users: '',
          require_mention: false,
        };
      },
      async TestIMessageConnection() {
        return { ok: false, status: 'preview' };
      },
      async SendTestIMessageMessage() {
        return { ok: true, status: 'preview' };
      },
      async GetOnboardingStatus() {
        return { required: false, completed: true, model_configured: true, telegram_configured: false, worker_configured: false, first_backup_created: true, backup_count: 1 };
      },
      async CompleteOnboarding() {},
      async GetSecretStatus() {
        return { secrets: {} };
      },
      async SaveSecret() {},
      async TestModelConnection() {
        return { ok: true, status: 'preview' };
      },
      async FetchAvailableModels() {
        return {
          ok: true,
          status: 'preview',
          available_models: [
            {
              provider: 'openai_compatible',
              base_url: 'https://api.deepseek.com/v1',
              id: 'deepseek-v4-flash',
              display_name: 'DeepSeek V4 Flash',
              owner: 'deepseek',
              context_window: 64000,
              max_output_tokens: 8192,
              supports_json_mode: true,
              supports_tool_calling: true,
              supports_reasoning: false,
              supported_parameters: ['temperature', 'max_tokens', 'response_format', 'tools'],
              config: { role: 'general', enabled: true, temperature: 0.7, max_output_tokens: 8192, timeout_seconds: 60, max_retries: 1, supports_json_mode: true, supports_tool_calling: true, supports_reasoning: false },
            },
            {
              provider: 'openai_compatible',
              base_url: 'https://api.deepseek.com/v1',
              id: 'deepseek-v4-pro',
              display_name: 'DeepSeek V4 Pro',
              owner: 'deepseek',
              context_window: 128000,
              max_output_tokens: 16384,
              supports_json_mode: true,
              supports_tool_calling: true,
              supports_reasoning: true,
              supported_parameters: ['temperature', 'max_tokens', 'response_format', 'tools', 'reasoning'],
              config: { role: 'reasoning', enabled: true, temperature: 0.3, max_output_tokens: 16384, timeout_seconds: 90, max_retries: 1, supports_json_mode: true, supports_tool_calling: true, supports_reasoning: true },
            },
          ],
        };
      },
      async TestTelegramConnection() {
        return { ok: false, status: 'preview' };
      },
      async LoginXAIOAuth() {
        return {
          status: 'succeeded',
          provider: 'xai_oauth',
          base_url: 'https://api.x.ai/v1',
          model_name: 'grok-4.3',
          last_refresh: new Date().toISOString(),
          source: 'preview',
          scope: 'openid profile email offline_access grok-cli:access api:access',
        };
      },
      async GenerateWorkerToken() {
        return { token: 'preview-token' };
      },
    };
}

export const desktopApi = {
  sendChat: (req: ChatRequest) => bindings().SendChat(req),
  getRunTrace: (runID: string) => bindings().GetRunTrace(runID),
  listConversations: (filter: ConversationFilter = { view: 'active', limit: 100 }) => bindings().ListConversations(filter),
  getConversation: (conversationID: string) => bindings().GetConversation(conversationID),
  listConversationGroups: () => bindings().ListConversationGroups(),
  saveConversationGroup: (req: ConversationGroupRequest) => bindings().SaveConversationGroup(req),
  deleteConversationGroup: (id: string) => bindings().DeleteConversationGroup(id),
  moveConversationToGroup: (req: ConversationActionRequest) => bindings().MoveConversationToGroup(req),
  archiveConversation: (req: ConversationActionRequest) => bindings().ArchiveConversation(req),
  trashConversation: (req: ConversationActionRequest) => bindings().TrashConversation(req),
  restoreConversation: (req: ConversationActionRequest) => bindings().RestoreConversation(req),
  purgeConversation: (req: ConversationActionRequest) => bindings().PurgeConversation(req),
  listCapabilities: () => bindings().ListCapabilities(),
  listMCPServers: () => bindings().ListMCPServers(),
  syncMCPServer: (id: string) => bindings().SyncMCPServer(id),
  wrapMCPTool: (serverID: string, toolName: string, req: MCPWrapToolRequest) => bindings().WrapMCPTool(serverID, toolName, req),
  listSkills: () => bindings().ListSkills(),
  listToolWorkflows: () => bindings().ListToolWorkflows(),
  listToolRuns: () => bindings().ListToolRuns(),
  setToolWorkflowEnabled: (req: { name: string; enabled: boolean }) => bindings().SetToolWorkflowEnabled(req),
  getSystemHealth: () => bindings().GetSystemHealth(),
  listMemories: (filter: { query?: string; limit?: number }) => bindings().ListMemories(filter),
  updateMemory: (req: { id: string; action: string; feedback?: string; comment?: string; target_id?: string; reason?: string; content?: string; summary?: string; scope_type?: string; run_id?: string }) => bindings().UpdateMemory(req),
  listMemoriesUsedForRun: (runID: string) => bindings().ListMemoriesUsedForRun(runID),
  listMemoryCandidates: (filter: MemoryCandidateFilter = {}) => bindings().ListMemoryCandidates(filter),
  decideMemoryCandidate: (req: MemoryCandidateDecisionRequest) => bindings().DecideMemoryCandidate(req),
  correctMemory: (req: MemoryCorrectionRequest) => bindings().CorrectMemory(req),
  deleteMemory: (req: MemoryDeleteRequest) => bindings().DeleteMemory(req),
  listUserStates: (filter: { limit?: number } = {}) => bindings().ListUserStates(filter),
  listRelationshipStates: (filter: { limit?: number } = {}) => bindings().ListRelationshipStates(filter),
  listProductTasks: (filter: ProductTaskFilter) => bindings().ListProductTasks(filter),
  listProductTasksByConversation: (conversationID: string) => bindings().ListProductTasksByConversation(conversationID),
  listProductTasksByPrincipal: (principalID: string) => bindings().ListProductTasksByPrincipal(principalID),
  getProductTask: (id: string) => bindings().GetProductTask(id),
  closeProductTask: (req: ProductTaskCloseRequest) => bindings().CloseProductTask(req),
  reopenProductTask: (req: ProductTaskReopenRequest) => bindings().ReopenProductTask(req),
  getRecentRunClosureReport: (req: { limit?: number } = {}) => bindings().GetRecentRunClosureReport(req),
  getExternalHandoffAudit: () => bindings().GetExternalHandoffAudit(),
  listArtifacts: (filter: { product_task_id?: string; type?: string; limit?: number }) => bindings().ListArtifacts(filter),
  getArtifact: (id: string) => bindings().GetArtifact(id),
  listOpenLoops: (filter: { status?: string; limit?: number }) => bindings().ListOpenLoops(filter),
  decideOpenLoop: (req: { id: string; action: string; feedback?: string; due_at?: string }) => bindings().DecideOpenLoop(req),
  listProactiveMessages: (filter: { status?: string; limit?: number }) => bindings().ListProactiveMessages(filter),
  decideProactiveMessage: (req: { id: string; action: string; feedback?: string }) => bindings().DecideProactiveMessage(req),
  recordNotificationOpened: (req: RecordNotificationOpenedRequest) => bindings().RecordNotificationOpened(req),
  listNodes: () => bindings().ListNodes(),
  disableNode: (nodeID: string) => bindings().DisableNode(nodeID),
  enableNode: (nodeID: string) => bindings().EnableNode(nodeID),
  listWorkerGatewayAuditLogs: () => bindings().ListWorkerGatewayAuditLogs(),
  getModelUsage: () => bindings().GetModelUsage(),
  listConfirmations: () => bindings().ListConfirmations(),
  decideConfirmation: (req: { id: string; approve: boolean; actor?: string; reason?: string }) => bindings().DecideConfirmation(req),
  listPendingApprovals: () => bindings().ListPendingApprovals(),
  decideApproval: (req: ApprovalDecisionRequest) => bindings().DecideApproval(req),
  resumeApprovalRun: (req: ApprovalResumeRunRequest) => bindings().ResumeApprovalRun(req),
  interruptRun: (req: InterruptRunRequest) => bindings().InterruptRun(req),
  redirectRun: (req: RedirectRunRequest) => bindings().RedirectRun(req),
  listRecoverableRuns: (req: { limit?: number } = {}) => bindings().ListRecoverableRuns(req),
  listBackups: () => bindings().ListBackups(),
  createBackup: () => bindings().CreateBackup(),
  restoreBackup: (path: string) => bindings().RestoreBackup(path),
  exportDiagnostics: () => bindings().ExportDiagnostics(),
  getSettings: () => bindings().GetSettings(),
  getWorkspaceSettings: () => bindings().GetWorkspaceSettings(),
  saveWorkspaceSettings: (req: WorkspaceSettings) => bindings().SaveWorkspaceSettings(req),
  listSavedModels: (req: ModelListRequest = {}) => bindings().ListSavedModels(req),
  fetchAvailableModels: (req?: ModelConnectionTestRequest) => bindings().FetchAvailableModels(req),
  saveModelConfig: (req: ModelConfigRequest) => bindings().SaveModelConfig(req),
  saveModelSettings: (req: ModelSettingsRequest) => bindings().SaveModelSettings(req),
  saveOperationalSettings: (req: { telegram_enabled: boolean; telegram_allowed_user_ids?: string; imessage_enabled?: boolean; imessage_allowed_users?: string; imessage_require_mention?: boolean; imessage_home_channel?: string; worker_gateway_enabled: boolean; backup_dir?: string; auto_backup_enabled: boolean }) => bindings().SaveOperationalSettings(req),
  saveTelegramConfig: (req: { token?: string; allowed_user_ids?: string; enabled: boolean }) => bindings().SaveTelegramConfig(req),
  sendTestTelegramMessage: (req: { chat_id?: string; message?: string }) => bindings().SendTestTelegramMessage(req),
  setupPhotonIMessage: (req: PhotonIMessageSetupRequest) => bindings().SetupPhotonIMessage(req),
  saveIMessageConfig: (req: { project_id?: string; project_secret?: string; dashboard_token?: string; phone_number?: string; assigned_number?: string; home_channel?: string; allowed_users?: string; require_mention?: boolean; enabled: boolean; sidecar_port?: number }) => bindings().SaveIMessageConfig(req),
  getIMessageStatus: () => bindings().GetIMessageStatus(),
  testIMessageConnection: () => bindings().TestIMessageConnection(),
  sendTestIMessageMessage: (req: { space_id?: string; message?: string }) => bindings().SendTestIMessageMessage(req),
  getOnboardingStatus: () => bindings().GetOnboardingStatus(),
  completeOnboarding: () => bindings().CompleteOnboarding(),
  getSecretStatus: () => bindings().GetSecretStatus(),
  saveSecret: (req: { name: string; value: string }) => bindings().SaveSecret(req),
  loginXAIOAuth: () => bindings().LoginXAIOAuth(),
  testModelConnection: (req?: ModelConnectionTestRequest) => bindings().TestModelConnection(req),
  testTelegramConnection: () => bindings().TestTelegramConnection(),
  generateWorkerToken: () => bindings().GenerateWorkerToken(),
};
