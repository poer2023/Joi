export type ChatRequest = {
  conversation_id?: string;
  channel?: string;
  user_id?: string;
  message: string;
  preferred_node?: string;
  allow_worker?: boolean;
};

export type ChatResponse = {
  conversation_id: string;
  user_message_id: string;
  assistant_message_id: string;
  run_id: string;
  selected_agent_id: string;
  response: string;
  model_calls?: ModelCall[];
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
  status: string;
  selected_agent_id: string;
  route_result?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  model_calls?: ModelCall[];
  prompt_assemblies?: Array<{ id: string; prefix_hash: string; dynamic_tail_hash: string; prompt_cache_key: string }>;
  memory_context_packs?: Array<{ id: string; memory_profile_version: string; dynamic_retrieval?: unknown[] }>;
  steps?: Array<{ id: string; step_type: string; title: string; status: string; input?: Record<string, unknown>; output?: Record<string, unknown> }>;
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
  status: string;
  confidence: number;
  pinned: boolean;
  disabled: boolean;
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
  metadata?: Record<string, unknown>;
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

type DesktopBindings = {
  SendChat(req: ChatRequest): Promise<ChatResponse>;
  GetRunTrace(runID: string): Promise<RunTrace>;
  GetSystemHealth(): Promise<SystemHealth>;
  ListMemories(filter: { query?: string; limit?: number }): Promise<{ memories: MemoryRecord[] }>;
  UpdateMemory(req: { id: string; action: string; feedback?: string; comment?: string; target_id?: string; reason?: string; content?: string; summary?: string; scope_type?: string }): Promise<void>;
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
  SaveModelConfig(req: ModelConfigRequest): Promise<void>;
  SaveOperationalSettings(req: { telegram_enabled: boolean; telegram_allowed_user_ids?: string; worker_gateway_enabled: boolean; backup_dir?: string; auto_backup_enabled: boolean }): Promise<void>;
  SaveTelegramConfig(req: { token?: string; allowed_user_ids?: string; enabled: boolean }): Promise<void>;
  SendTestTelegramMessage(req: { chat_id?: string; message?: string }): Promise<ConnectionTest>;
  GetOnboardingStatus(): Promise<OnboardingStatus>;
  CompleteOnboarding(): Promise<void>;
  GetSecretStatus(): Promise<SecretStatus>;
  SaveSecret(req: { name: string; value: string }): Promise<void>;
  TestModelConnection(): Promise<ConnectionTest>;
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
          status: 'preview',
          selected_agent_id: 'general_agent',
          steps: [
            { id: 'step_preview_1', step_type: 'input_received', title: 'Input received', status: 'succeeded' },
            { id: 'step_preview_2', step_type: 'response_generated', title: 'Response generated', status: 'succeeded' },
          ],
        };
      },
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
      async SaveModelConfig() {},
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
        return { ok: true, status: 'preview' };
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
  getSystemHealth: () => bindings().GetSystemHealth(),
  listMemories: (filter: { query?: string; limit?: number }) => bindings().ListMemories(filter),
  updateMemory: (req: { id: string; action: string; feedback?: string; comment?: string; target_id?: string; reason?: string; content?: string; summary?: string; scope_type?: string }) => bindings().UpdateMemory(req),
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
  saveModelConfig: (req: ModelConfigRequest) => bindings().SaveModelConfig(req),
  saveOperationalSettings: (req: { telegram_enabled: boolean; telegram_allowed_user_ids?: string; worker_gateway_enabled: boolean; backup_dir?: string; auto_backup_enabled: boolean }) => bindings().SaveOperationalSettings(req),
  saveTelegramConfig: (req: { token?: string; allowed_user_ids?: string; enabled: boolean }) => bindings().SaveTelegramConfig(req),
  sendTestTelegramMessage: (req: { chat_id?: string; message?: string }) => bindings().SendTestTelegramMessage(req),
  getOnboardingStatus: () => bindings().GetOnboardingStatus(),
  completeOnboarding: () => bindings().CompleteOnboarding(),
  getSecretStatus: () => bindings().GetSecretStatus(),
  saveSecret: (req: { name: string; value: string }) => bindings().SaveSecret(req),
  testModelConnection: () => bindings().TestModelConnection(),
  testTelegramConnection: () => bindings().TestTelegramConnection(),
  generateWorkerToken: () => bindings().GenerateWorkerToken(),
};
