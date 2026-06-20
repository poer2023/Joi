export type ChatRequest = {
  conversation_id?: string;
  channel?: string;
  user_id?: string;
  message: string;
  preferred_node?: string;
  allow_worker?: boolean;
  model_name?: string;
  input_mode?: InputMode;
  product_task_id?: string;
  runtime_mode?: RuntimeMode;
  permission_profile?: PermissionProfile;
};

export type ChatResponse = {
  conversation_id: string;
  user_message_id: string;
  assistant_message_id: string;
  run_id: string;
  selected_agent_id: string;
  response: string;
  ui?: ChatUIHints;
  model_calls?: ModelCall[];
  used_memories?: MemorySearchResult[];
  product_task?: ProductTask;
  artifacts?: ArtifactSummary[];
  proactive_candidates?: ProactiveMessage[];
  reflection?: ReflectionResult;
};

export type ChatUIHints = {
  interaction_class: string;
  requires_user_input: boolean;
  missing_input?: string;
  inline_execution: boolean;
};

export type InputMode = 'auto' | 'chat_assist' | 'serious_task' | 'background_task';

export type RuntimeMode = 'legacy_json' | 'tool_calling';

export type PermissionProfile = 'read_only' | 'workspace_write' | 'danger_full_access';

export type TaskContract = {
  objective: string;
  deliverables: string[];
  constraints: string[];
  success_checks: string[];
  capability_scope: string[];
  risk_level: string;
  mode: InputMode | string;
  verification_requirements: string[];
};

export type TaskVerification = {
  status: 'pending' | 'passed' | 'failed' | string;
  summary: string;
  checks: Array<{
    name: string;
    status: 'passed' | 'failed' | string;
    evidence?: Record<string, unknown>;
  }>;
  verified_at?: string;
};

export type InterruptRunRequest = {
  run_id: string;
  reason?: string;
  scope?: 'run' | 'task';
};

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
  events?: RunEvent[];
  steps?: Array<{
    id: string;
    run_id?: string;
    step_type: string;
    title: string;
    status: string;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
    error?: Record<string, unknown>;
    started_at?: string;
    finished_at?: string;
    duration_ms?: number;
    created_at?: string;
  }>;
};

export type RunEvent = {
  id: string;
  run_id: string;
  turn_id?: string;
  seq: number;
  event_type: string;
  type?: string;
  item_id?: string;
  item_type?: string;
  status?: string;
  title?: string;
  summary?: string;
  payload?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  delta?: Record<string, unknown> | string;
  metadata?: Record<string, unknown>;
  error?: string;
  created_at?: string;
};

export type ConversationSummary = {
  id: string;
  channel: string;
  user_id: string;
  title: string;
  active_agent_id?: string;
  topic?: string;
  group_id?: string;
  lifecycle_status?: 'active' | 'archived' | 'trashed' | 'purged' | string;
  pinned?: boolean;
  last_message?: string;
  last_role?: string;
  latest_run_id?: string;
  message_count: number;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  archived_at?: string;
  trashed_at?: string;
  purge_after?: string;
  restored_at?: string;
};

export type ConversationFilter = {
  view?: 'active' | 'archived' | 'trash' | 'all' | 'purged' | string;
  group_id?: string;
  limit?: number;
};

export type ConversationActionRequest = {
  id: string;
  reason?: string;
  group_id?: string;
};

export type ConversationActionResponse = {
  conversation: ConversationSummary;
};

export type ConversationGroup = {
  id: string;
  name: string;
  sort_order: number;
  collapsed: boolean;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type ConversationGroupRequest = {
  id?: string;
  name: string;
  sort_order?: number;
  collapsed?: boolean;
  metadata?: Record<string, unknown>;
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

export type MCPToolRecord = {
  name: string;
  description: string;
  wrapped_as?: string;
  enabled: boolean;
  schema?: Record<string, unknown>;
};

export type MCPResourceRecord = {
  uri: string;
  name: string;
  description: string;
  mime_type: string;
};

export type MCPPromptRecord = {
  name: string;
  description: string;
  arguments?: string[];
};

export type MCPServerRecord = {
  id: string;
  name: string;
  transport: string;
  command?: string;
  args?: string[];
  enabled?: boolean;
  status: string;
  trust: string;
  last_sync_at?: string;
  last_sync_error?: string;
  tools: MCPToolRecord[];
  resources: MCPResourceRecord[];
  prompts: MCPPromptRecord[];
  metadata?: Record<string, unknown>;
};

export type MCPWrapToolRequest = {
  capability_id?: string;
  description: string;
  intent_domain: string;
  positive_examples: string[];
  negative_examples: string[];
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  risk_level: string;
  privacy_level: string;
  ui_visibility: string;
  enabled?: boolean;
};

export type SkillRecord = {
  id: string;
  version: string;
  name: string;
  description: string;
  trigger_phrases: string[];
  required_capabilities: string[];
  forbidden_capabilities: string[];
  output_contract: string;
  enabled: boolean;
  metadata?: Record<string, unknown>;
  recent_run?: Record<string, unknown>;
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
  task_contract?: TaskContract;
  verification?: TaskVerification;
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
  call_id?: string;
  turn_id?: string;
  approval_scope?: string;
  approval_key?: string;
  operation_id?: string;
  affected_paths?: string[];
  external_target?: string;
  reversible?: boolean;
  approved_by?: string;
  rejected_by?: string;
  decision_reason?: string;
  created_at?: string;
  decided_at?: string;
  resumed_at?: string;
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
  model_reasoning_name?: string;
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
  provider?: string;
  base_url?: string;
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
  reasoning_name?: string;
  timeout_seconds?: number;
  max_retries?: number;
};

export type ModelConnectionTestRequest = ModelConfigRequest & {
  api_key?: string;
};

export type XAIOAuthLoginResult = {
  status: 'succeeded';
  provider: 'xai_oauth';
  base_url: string;
  model_name: string;
  last_refresh: string;
  source: string;
  scope: string;
  expires_at?: string;
};

export type ModelListRequest = {
  provider?: string;
  base_url?: string;
};

export type DesktopBindings = {
  SendChat(req: ChatRequest): Promise<ChatResponse>;
  GetRunTrace(runID: string): Promise<RunTrace>;
  ListConversations(filter: ConversationFilter): Promise<{ conversations: ConversationSummary[] }>;
  GetConversation(conversationID: string): Promise<ConversationDetail>;
  ListConversationGroups(): Promise<{ groups: ConversationGroup[] }>;
  SaveConversationGroup(req: ConversationGroupRequest): Promise<ConversationGroup>;
  DeleteConversationGroup(id: string): Promise<void>;
  MoveConversationToGroup(req: ConversationActionRequest): Promise<ConversationActionResponse>;
  ArchiveConversation(req: ConversationActionRequest): Promise<ConversationActionResponse>;
  TrashConversation(req: ConversationActionRequest): Promise<ConversationActionResponse>;
  RestoreConversation(req: ConversationActionRequest): Promise<ConversationActionResponse>;
  PurgeConversation(req: ConversationActionRequest): Promise<ConversationActionResponse>;
  ListCapabilities(): Promise<{ capabilities: CapabilityRecord[] }>;
  ListMCPServers(): Promise<{ servers: MCPServerRecord[] }>;
  SyncMCPServer(id: string): Promise<{ server: MCPServerRecord }>;
  WrapMCPTool(serverID: string, toolName: string, req: MCPWrapToolRequest): Promise<{ capability: CapabilityRecord }>;
  ListSkills(): Promise<{ skills: SkillRecord[] }>;
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
  InterruptRun(req: InterruptRunRequest): Promise<void>;
  ListBackups(): Promise<{ backups: BackupRecord[] }>;
  CreateBackup(): Promise<{ path: string }>;
  RestoreBackup(path: string): Promise<void>;
  ExportDiagnostics(): Promise<{ path: string }>;
  GetSettings(): Promise<SettingsRecord>;
  GetWorkspaceSettings(): Promise<WorkspaceSettings>;
  SaveWorkspaceSettings(req: WorkspaceSettings): Promise<void>;
  ListSavedModels(req: ModelListRequest): Promise<{ models: AvailableModel[] }>;
  FetchAvailableModels(req?: ModelConnectionTestRequest): Promise<ConnectionTest>;
  SaveModelConfig(req: ModelConfigRequest): Promise<void>;
  SaveModelSettings(req: ModelSettingsRequest): Promise<void>;
  SaveOperationalSettings(req: { telegram_enabled: boolean; telegram_allowed_user_ids?: string; worker_gateway_enabled: boolean; backup_dir?: string; auto_backup_enabled: boolean }): Promise<void>;
  SaveTelegramConfig(req: { token?: string; allowed_user_ids?: string; enabled: boolean }): Promise<void>;
  SendTestTelegramMessage(req: { chat_id?: string; message?: string }): Promise<ConnectionTest>;
  GetOnboardingStatus(): Promise<OnboardingStatus>;
  CompleteOnboarding(): Promise<void>;
  GetSecretStatus(): Promise<SecretStatus>;
  SaveSecret(req: { name: string; value: string }): Promise<void>;
  LoginXAIOAuth(): Promise<XAIOAuthLoginResult>;
  TestModelConnection(req?: ModelConnectionTestRequest): Promise<ConnectionTest>;
  TestTelegramConnection(): Promise<ConnectionTest>;
  GenerateWorkerToken(): Promise<{ token: string }>;
};

export type JoiPreloadApi = {
  invoke<T = unknown>(method: keyof DesktopBindings, payload?: unknown): Promise<T>;
  onRunEvent(callback: (event: unknown) => void): () => void;
  app: {
    getVersion(): Promise<string>;
    openExternal(url: string): Promise<void>;
  };
};

export const desktopBindingMethods: Array<keyof DesktopBindings> = [
  'ArchiveConversation',
  'CompleteOnboarding',
  'CreateBackup',
  'DecideConfirmation',
  'DecideProactiveMessage',
  'DeleteConversationGroup',
  'DisableNode',
  'EnableNode',
  'ExportDiagnostics',
  'FetchAvailableModels',
  'GenerateWorkerToken',
  'GetArtifact',
  'GetConversation',
  'GetModelUsage',
  'GetOnboardingStatus',
  'GetProductTask',
  'GetRunTrace',
  'GetSecretStatus',
  'GetSettings',
  'GetSystemHealth',
  'GetWorkspaceSettings',
  'InterruptRun',
  'ListArtifacts',
  'ListBackups',
  'ListCapabilities',
  'ListConfirmations',
  'ListConversationGroups',
  'ListConversations',
  'LoginXAIOAuth',
  'ListMCPServers',
  'ListMemories',
  'ListNodes',
  'ListOpenLoops',
  'ListProductTasks',
  'ListProactiveMessages',
  'ListSavedModels',
  'ListSkills',
  'ListToolRuns',
  'ListToolWorkflows',
  'ListWorkerGatewayAuditLogs',
  'MoveConversationToGroup',
  'PurgeConversation',
  'RestoreBackup',
  'RestoreConversation',
  'SaveConversationGroup',
  'SaveModelConfig',
  'SaveModelSettings',
  'SaveOperationalSettings',
  'SaveSecret',
  'SaveTelegramConfig',
  'SaveWorkspaceSettings',
  'SendChat',
  'SendTestTelegramMessage',
  'SetToolWorkflowEnabled',
  'SyncMCPServer',
  'TestModelConnection',
  'TestTelegramConnection',
  'TrashConversation',
  'UpdateMemory',
  'WrapMCPTool',
];
