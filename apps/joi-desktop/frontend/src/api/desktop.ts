export type ChatRequest = {
  conversation_id?: string;
  channel?: string;
  user_id?: string;
  message: string;
  preferred_node?: string;
  allow_worker?: boolean;
  input_mode?: InputMode;
  product_task_id?: string;
};

export type ChatResponse = {
  conversation_id: string;
  user_message_id: string;
  assistant_message_id: string;
  run_id: string;
  selected_agent_id: string;
  response: string;
  model_calls?: ModelCall[];
  used_memories?: MemorySearchResult[];
  product_task?: ProductTask;
  artifacts?: ArtifactSummary[];
  proactive_candidates?: ProactiveMessage[];
  reflection?: ReflectionResult;
};

export type InputMode = 'auto' | 'chat_assist' | 'serious_task' | 'background_task';

export type ModelCall = {
  id: string;
  provider: string;
  model_name: string;
  status: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cacheable_prefix_tokens?: number;
  dynamic_tail_tokens?: number;
  latency_ms: number;
  prompt_cache_key?: string;
  prefix_hash?: string;
  dynamic_tail_hash?: string;
  metadata?: Record<string, unknown>;
};

export type RunTrace = {
  id: string;
  conversation_id?: string;
  user_message_id?: string;
  status: string;
  selected_agent_id: string;
  route_result?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  model_calls?: ModelCall[];
  prompt_assemblies?: Array<{ id: string; prefix_hash: string; dynamic_tail_hash: string; prompt_cache_key: string }>;
  memory_context_packs?: Array<{ id: string; memory_profile_version: string; dynamic_retrieval?: MemorySearchResult[] }>;
  steps?: Array<{ id: string; step_type: string; title: string; status: string; input?: Record<string, unknown>; output?: Record<string, unknown>; error?: Record<string, unknown> }>;
};

export type ConversationSummary = {
  id: string;
  channel: string;
  user_id: string;
  title: string;
  active_agent_id?: string;
  topic?: string;
  last_message?: string;
  last_role?: string;
  latest_run_id?: string;
  message_count: number;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | string;
  content: string;
  run_id?: string;
  attachments?: unknown[];
  metadata?: Record<string, unknown>;
  created_at?: string;
};

export type ConversationDetail = {
  conversation: ConversationSummary;
  messages: ConversationMessage[];
};

export type CapabilityRecord = {
  id: string;
  name: string;
  description: string;
  risk_level: string;
  enabled: boolean;
  metadata?: Record<string, unknown>;
};

export type ToolWorkflowStep = {
  tool: string;
  args?: Record<string, unknown>;
  risk_level: string;
};

export type ToolWorkflowRecord = {
  id: string;
  capability_id: string;
  name: string;
  version: string;
  risk_level: string;
  steps: ToolWorkflowStep[];
  enabled: boolean;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type ToolRunRecord = {
  id: string;
  run_id?: string;
  task_id?: string;
  capability_id?: string;
  workflow_name?: string;
  tool_id?: string;
  tool_name: string;
  node_id?: string;
  assignment_reason?: string;
  risk_level: string;
  status: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: Record<string, unknown>;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  created_at?: string;
};

export type WorkspaceSettings = {
  allowed_roots: string[];
  default_root: string;
  browser_allowed_hosts: string[];
  web_research_allow_private_hosts: boolean;
  file_analyze_max_bytes: number;
  workspace_search_max_results: number;
};

export type SystemHealth = {
  service_status?: Record<string, unknown>;
  queue_status?: Record<string, unknown>;
  worker_status?: NodeRecord[];
  model_latency?: Record<string, unknown>;
  tool_failure_rate?: Record<string, unknown>;
  token_cost_today?: Record<string, unknown>;
  warnings?: unknown[];
};

export type MemoryRecord = {
  id: string;
  type: string;
  content: string;
  summary: string;
  scope_type?: string;
  scope_id?: string;
  privacy_level?: string;
  status: string;
  confidence: number;
  pinned: boolean;
  disabled?: boolean;
  disabled_at?: string;
  usage_count: number;
  success_count: number;
  failure_count: number;
  positive_feedback: number;
  negative_feedback: number;
  source_event_ids?: string[];
  entities?: string[];
  merged_into_memory_id?: string;
  conflict_group_id?: string;
  conflict_reason?: string;
  recent_usage?: MemoryUsageLog[];
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  last_used_at?: string;
};

export type MemoryUsageLog = {
  id: string;
  run_id: string;
  agent_id: string;
  retrieval_score: number;
  injected: boolean;
  used_in_answer: boolean;
  outcome: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
};

export type MemorySearchResult = {
  memory: MemoryRecord;
  score: number;
  reason: string;
};

export type ProductTask = {
  id: string;
  title: string;
  description: string;
  status: string;
  mode: InputMode | string;
  priority: string;
  created_from_conversation_id?: string;
  created_from_message_id?: string;
  latest_run_id?: string;
  owner_user_id?: string;
  source_channel?: string;
  risk_level: string;
  progress_percent: number;
  current_step_id?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
};

export type ProductTaskStep = {
  id: string;
  product_task_id: string;
  title: string;
  description?: string;
  status: string;
  sort_order: number;
  capability_id?: string;
  tool_workflow_id?: string;
  run_id?: string;
  tool_run_id?: string;
  worker_task_id?: string;
  summary?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: Record<string, unknown>;
  started_at?: string;
  finished_at?: string;
  created_at?: string;
  updated_at?: string;
};

export type ProductTaskDetail = {
  task: ProductTask;
  steps: ProductTaskStep[];
  deliverables: ArtifactSummary[];
};

export type ArtifactSummary = {
  id: string;
  type: string;
  title: string;
  content_format: string;
  source_product_task_id?: string;
  source_run_id?: string;
  source_conversation_id?: string;
  source_message_id?: string;
  version: number;
  status: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type ArtifactDetail = ArtifactSummary & {
  content: string;
  linked_memory_ids?: string[];
};

export type OpenLoop = {
  id: string;
  topic: string;
  description?: string;
  status: string;
  source_conversation_id?: string;
  source_run_id?: string;
  source_product_task_id?: string;
  suggested_followup?: string;
  priority: string;
  due_at?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
};

export type ProactiveMessage = {
  id: string;
  type: string;
  title: string;
  body: string;
  reason: string;
  source_memory_ids?: string[];
  source_open_loop_id?: string;
  source_product_task_id?: string;
  score: number;
  status: string;
  channel: string;
  send_after?: string;
  expires_at?: string;
  feedback?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  sent_at?: string;
};

export type ReflectionResult = {
  conversation_type: string;
  importance: string;
  should_create_task: boolean;
  memory_candidates?: MemoryRecord[];
  task_candidates?: Array<{ title: string; description: string; priority: string; mode: string; suggested_steps?: ProductTaskStep[] }>;
  open_loops?: OpenLoop[];
  proactive_opportunities?: ProactiveMessage[];
  product_task?: ProductTask;
};

export type NodeRecord = {
  id: string;
  name: string;
  role: string;
  status: string;
  capabilities?: unknown[];
  auto_assign_enabled: boolean;
  manual_assign_enabled: boolean;
  metadata?: Record<string, unknown>;
};

export type WorkerGatewayAuditRecord = {
  id: string;
  node_id: string;
  action: string;
  status: string;
  reason: string;
  metadata?: Record<string, unknown>;
};

export type ConfirmationRecord = {
  id: string;
  run_id: string;
  capability_id: string;
  requested_action: string;
  risk_level: string;
  status: string;
  input?: Record<string, unknown>;
  approved_by?: string;
  rejected_by?: string;
  decision_reason?: string;
};

export type BackupRecord = {
  path: string;
  name: string;
  size: number;
  modified: string;
  manifest?: Record<string, unknown>;
};

export type SettingsRecord = {
  version: string;
  app_mode: string;
  data_store: string;
  task_queue: string;
  sqlite_path: string;
  log_dir?: string;
  model_provider: string;
  model_name: string;
  model_base_url: string;
  telegram_enabled: boolean;
  telegram_allowed_user_ids?: string;
  worker_gateway: string;
  worker_gateway_enabled?: boolean;
  backup_dir: string;
  auto_backup_enabled?: boolean;
  docker_required: boolean;
};

export type SecretStatus = {
  secrets: Record<string, boolean>;
};

export type ConnectionTest = {
  ok: boolean;
  status: string;
  error_summary?: string;
  available_models?: AvailableModel[];
};

export type AvailableModel = {
  id: string;
  display_name?: string;
  owner?: string;
  object?: string;
  created?: string;
  context_window?: number;
  max_output_tokens?: number;
  input_price_per_1m?: number;
  output_price_per_1m?: number;
  supports_json_mode?: boolean;
  supports_tool_calling?: boolean;
  supports_reasoning?: boolean;
  supported_parameters?: string[];
  config?: ModelRuntimeConfig;
  metadata?: Record<string, unknown>;
};

export type ModelRuntimeConfig = {
  role?: string;
  enabled: boolean;
  temperature: number;
  max_output_tokens?: number;
  timeout_seconds: number;
  max_retries: number;
  supports_json_mode: boolean;
  supports_tool_calling: boolean;
  supports_reasoning: boolean;
};

export type ModelSettingsRequest = ModelRuntimeConfig & {
  provider: string;
  base_url: string;
  model_id: string;
  display_name?: string;
};

export type OnboardingStatus = {
  required: boolean;
  completed: boolean;
  model_configured: boolean;
  telegram_configured: boolean;
  worker_configured: boolean;
  first_backup_created: boolean;
  backup_count: number;
  missing?: string[];
};

export type ModelConfigRequest = {
  provider: string;
  base_url: string;
  name: string;
  timeout_seconds?: number;
  max_retries?: number;
};

export type ModelConnectionTestRequest = ModelConfigRequest & {
  api_key?: string;
};

type DesktopBindings = {
  SendChat(req: ChatRequest): Promise<ChatResponse>;
  GetRunTrace(runID: string): Promise<RunTrace>;
  ListConversations(): Promise<{ conversations: ConversationSummary[] }>;
  GetConversation(conversationID: string): Promise<ConversationDetail>;
  ListCapabilities(): Promise<{ capabilities: CapabilityRecord[] }>;
  ListToolWorkflows(): Promise<{ workflows: ToolWorkflowRecord[] }>;
  ListToolRuns(): Promise<{ tool_runs: ToolRunRecord[] }>;
  SetToolWorkflowEnabled(req: { name: string; enabled: boolean }): Promise<void>;
  GetSystemHealth(): Promise<SystemHealth>;
  ListMemories(filter: { query?: string; limit?: number }): Promise<{ memories: MemoryRecord[] }>;
  UpdateMemory(req: { id: string; action: string; feedback?: string; comment?: string; target_id?: string; reason?: string; content?: string; summary?: string; scope_type?: string; run_id?: string }): Promise<void>;
  ListProductTasks(filter: { status?: string; limit?: number }): Promise<{ tasks: ProductTask[] }>;
  GetProductTask(id: string): Promise<ProductTaskDetail>;
  ListArtifacts(filter: { product_task_id?: string; type?: string; limit?: number }): Promise<{ artifacts: ArtifactSummary[] }>;
  GetArtifact(id: string): Promise<ArtifactDetail>;
  ListOpenLoops(filter: { status?: string; limit?: number }): Promise<{ open_loops: OpenLoop[] }>;
  ListProactiveMessages(filter: { status?: string; limit?: number }): Promise<{ messages: ProactiveMessage[] }>;
  DecideProactiveMessage(req: { id: string; action: string; feedback?: string }): Promise<void>;
  ListNodes(): Promise<{ nodes: NodeRecord[] }>;
  DisableNode(nodeID: string): Promise<void>;
  EnableNode(nodeID: string): Promise<void>;
  ListWorkerGatewayAuditLogs(): Promise<{ items: WorkerGatewayAuditRecord[] }>;
  GetModelUsage(): Promise<{ items: Record<string, unknown>[] }>;
  ListConfirmations(): Promise<{ items: ConfirmationRecord[] }>;
  DecideConfirmation(req: { id: string; approve: boolean; actor?: string; reason?: string }): Promise<void>;
  ListBackups(): Promise<{ backups: BackupRecord[] }>;
  CreateBackup(): Promise<{ path: string }>;
  RestoreBackup(path: string): Promise<void>;
  ExportDiagnostics(): Promise<{ path: string }>;
  GetSettings(): Promise<SettingsRecord>;
  GetWorkspaceSettings(): Promise<WorkspaceSettings>;
  SaveWorkspaceSettings(req: WorkspaceSettings): Promise<void>;
  SaveModelConfig(req: ModelConfigRequest): Promise<void>;
  SaveModelSettings(req: ModelSettingsRequest): Promise<void>;
  SaveOperationalSettings(req: { telegram_enabled: boolean; telegram_allowed_user_ids?: string; worker_gateway_enabled: boolean; backup_dir?: string; auto_backup_enabled: boolean }): Promise<void>;
  SaveTelegramConfig(req: { token?: string; allowed_user_ids?: string; enabled: boolean }): Promise<void>;
  SendTestTelegramMessage(req: { chat_id?: string; message?: string }): Promise<ConnectionTest>;
  GetOnboardingStatus(): Promise<OnboardingStatus>;
  CompleteOnboarding(): Promise<void>;
  GetSecretStatus(): Promise<SecretStatus>;
  SaveSecret(req: { name: string; value: string }): Promise<void>;
  TestModelConnection(req?: ModelConnectionTestRequest): Promise<ConnectionTest>;
  TestTelegramConnection(): Promise<ConnectionTest>;
  GenerateWorkerToken(): Promise<{ token: string }>;
};

declare global {
  interface Window {
    go?: {
      main?: {
        DesktopApp?: DesktopBindings;
      };
    };
  }
}

function bindings(): DesktopBindings {
  const desktop = window.go?.main?.DesktopApp;
  if (!desktop) {
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
      async ListConversations() {
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
            },
          ],
        };
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
            { id: 'workspace_search', name: 'Workspace Search', description: 'Search authorized workspace source and documents.', risk_level: 'read_only', enabled: true },
            { id: 'file_analyze', name: 'File Analyze', description: 'Analyze an authorized workspace file.', risk_level: 'read_only', enabled: true },
          ],
        };
      },
      async ListToolWorkflows() {
        return {
          workflows: [
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
      async ListProactiveMessages() {
        return { messages: [] };
      },
      async DecideProactiveMessage() {},
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
          model_provider: 'mock_provider',
          model_name: 'mock-model',
          model_base_url: '',
          telegram_enabled: false,
          telegram_allowed_user_ids: '',
          worker_gateway: '',
          worker_gateway_enabled: true,
          backup_dir: 'preview/backups',
          auto_backup_enabled: false,
          docker_required: false,
        };
      },
      async GetWorkspaceSettings() {
        return {
          allowed_roots: ['/Users/hao/Documents/Joi'],
          default_root: '/Users/hao/Documents/Joi',
          browser_allowed_hosts: [],
          web_research_allow_private_hosts: false,
          file_analyze_max_bytes: 65536,
          workspace_search_max_results: 50,
        };
      },
      async SaveWorkspaceSettings() {},
      async SaveModelConfig() {},
      async SaveModelSettings() {},
      async SaveOperationalSettings() {},
      async SaveTelegramConfig() {},
      async SendTestTelegramMessage() {
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
        return {
          ok: true,
          status: 'preview',
          available_models: [
            {
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
      async GenerateWorkerToken() {
        return { token: 'preview-token' };
      },
    };
  }
  return desktop;
}

export const desktopApi = {
  sendChat: (req: ChatRequest) => bindings().SendChat(req),
  getRunTrace: (runID: string) => bindings().GetRunTrace(runID),
  listConversations: () => bindings().ListConversations(),
  getConversation: (conversationID: string) => bindings().GetConversation(conversationID),
  listCapabilities: () => bindings().ListCapabilities(),
  listToolWorkflows: () => bindings().ListToolWorkflows(),
  listToolRuns: () => bindings().ListToolRuns(),
  setToolWorkflowEnabled: (req: { name: string; enabled: boolean }) => bindings().SetToolWorkflowEnabled(req),
  getSystemHealth: () => bindings().GetSystemHealth(),
  listMemories: (filter: { query?: string; limit?: number }) => bindings().ListMemories(filter),
  updateMemory: (req: { id: string; action: string; feedback?: string; comment?: string; target_id?: string; reason?: string; content?: string; summary?: string; scope_type?: string; run_id?: string }) => bindings().UpdateMemory(req),
  listProductTasks: (filter: { status?: string; limit?: number }) => bindings().ListProductTasks(filter),
  getProductTask: (id: string) => bindings().GetProductTask(id),
  listArtifacts: (filter: { product_task_id?: string; type?: string; limit?: number }) => bindings().ListArtifacts(filter),
  getArtifact: (id: string) => bindings().GetArtifact(id),
  listOpenLoops: (filter: { status?: string; limit?: number }) => bindings().ListOpenLoops(filter),
  listProactiveMessages: (filter: { status?: string; limit?: number }) => bindings().ListProactiveMessages(filter),
  decideProactiveMessage: (req: { id: string; action: string; feedback?: string }) => bindings().DecideProactiveMessage(req),
  listNodes: () => bindings().ListNodes(),
  disableNode: (nodeID: string) => bindings().DisableNode(nodeID),
  enableNode: (nodeID: string) => bindings().EnableNode(nodeID),
  listWorkerGatewayAuditLogs: () => bindings().ListWorkerGatewayAuditLogs(),
  getModelUsage: () => bindings().GetModelUsage(),
  listConfirmations: () => bindings().ListConfirmations(),
  decideConfirmation: (req: { id: string; approve: boolean; actor?: string; reason?: string }) => bindings().DecideConfirmation(req),
  listBackups: () => bindings().ListBackups(),
  createBackup: () => bindings().CreateBackup(),
  restoreBackup: (path: string) => bindings().RestoreBackup(path),
  exportDiagnostics: () => bindings().ExportDiagnostics(),
  getSettings: () => bindings().GetSettings(),
  getWorkspaceSettings: () => bindings().GetWorkspaceSettings(),
  saveWorkspaceSettings: (req: WorkspaceSettings) => bindings().SaveWorkspaceSettings(req),
  saveModelConfig: (req: ModelConfigRequest) => bindings().SaveModelConfig(req),
  saveModelSettings: (req: ModelSettingsRequest) => bindings().SaveModelSettings(req),
  saveOperationalSettings: (req: { telegram_enabled: boolean; telegram_allowed_user_ids?: string; worker_gateway_enabled: boolean; backup_dir?: string; auto_backup_enabled: boolean }) => bindings().SaveOperationalSettings(req),
  saveTelegramConfig: (req: { token?: string; allowed_user_ids?: string; enabled: boolean }) => bindings().SaveTelegramConfig(req),
  sendTestTelegramMessage: (req: { chat_id?: string; message?: string }) => bindings().SendTestTelegramMessage(req),
  getOnboardingStatus: () => bindings().GetOnboardingStatus(),
  completeOnboarding: () => bindings().CompleteOnboarding(),
  getSecretStatus: () => bindings().GetSecretStatus(),
  saveSecret: (req: { name: string; value: string }) => bindings().SaveSecret(req),
  testModelConnection: (req?: ModelConnectionTestRequest) => bindings().TestModelConnection(req),
  testTelegramConnection: () => bindings().TestTelegramConnection(),
  generateWorkerToken: () => bindings().GenerateWorkerToken(),
};
