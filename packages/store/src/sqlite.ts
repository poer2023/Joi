import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { arch, homedir, platform, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inflateRawSync } from 'node:zlib';
import {
  readCodexSkill,
  renderSelectedSkillInstructions,
  renderSkillCatalog,
  selectCodexSkills,
  type DiscoveredSkill,
  type SkillScope,
  type SkillSelectionCandidate,
} from '../../runtime/src/skills.ts';
import {
  attributeMemoryAnswerInfluence,
  canonicalMemoryKey,
  cosineSimilarity,
  createTaskEpisodeObservation,
  DEFAULT_MEMORY_POLICY,
  extractMemoryObservations,
  inferLegacyMemoryLayer,
  inferMemoryContextTags,
  lexicalSimilarity,
  LOCAL_MEMORY_EMBEDDING_MODEL,
  localMemoryVector,
  MEMORY_PIPELINE_VERSION,
  memoryEvidenceAuthority,
  memoryGenerationExclusionReason,
  memoryQuarantineReason,
  memorySearchFeatures,
  normalizeRelevanceScore,
  type MemoryObservationDraft,
  type MemoryPolicyConfig,
} from './memory-engine.ts';
import {
  compilePersonaConstitution,
  DEFAULT_JOI_PERSONA_CONSTITUTION,
} from './persona-constitution.ts';
import type {
  AvailableModel,
  AgentModelPolicy,
  AgentModelPolicyRequest,
  ArtifactDetail,
  ArtifactSummary,
  AutomationDefinition,
  AutomationDefinitionRequest,
  AutomationExecutionKind,
  AutomationKind,
  AutomationRunRecord,
  AutomationTriggerNowRequest,
  AutomationTriggerRecord,
  BackupRecord,
  CapabilityRecord,
  ChatRequest,
  ChatResponse,
  CheckpointSummary,
  ConnectExternalMirrorRoomRequest,
  CompleteCheckpointRequest,
  ConfirmationRecord,
  ConversationActionRequest,
  ConversationActionResponse,
  ConversationCompactionRecord,
  ConversationDetail,
  ConversationExportResult,
  ConversationFilter,
  ConversationGroup,
  ConversationGroupRequest,
  ConversationMessage,
  ConversationSummary,
  ConversationTree,
  ConversationTreeNode,
  ConversationImportResult,
  CreateProjectPersonaRequest,
  CreateSharedRoomRequest,
  EvaluateRoomPermissionsRequest,
  ExternalConnectorEvent,
  ExternalHandoffAudit,
  GenerateProjectPersonaCandidatesRequest,
  InputMode,
  LogCleanupPreview,
  LogCleanupRequest,
  LogCleanupResult,
  LogEntry,
  LogFilter,
  MCPServerRecord,
  MCPServerConfigRequest,
  MCPWrapToolRequest,
  MemoryRecord,
  MemoryMaintenanceRun,
  MemoryQualityMetrics,
  MemorySearchResult,
  MemorySettingsRecord,
  MemorySystemSnapshot,
  MemoryTaskControls,
  MessengerProject,
  MessengerRoom,
  MessengerThread,
  MessengerThreadEvent,
  PersonaMessengerSnapshot,
  ModelCall,
  ModelConfigRequest,
  ModelSettingsRequest,
  NodeRecord,
  OnboardingStatus,
  OpenLoop,
  PermissionProfile,
  PersonaCandidate,
  PersonaConstitutionRecord,
  PersonaMessengerExportRequest,
  PersonaMessengerExportResult,
  PreviewExternalPersonaMessageRequest,
  ProjectPersona,
  PersonaVersion,
  PluginRecord,
  PluginProviderConfig,
  ProactiveMessage,
  ProductTask,
  ProductTaskDetail,
  ProductTaskStep,
  RecoverableRunRecord,
  RecordExternalConnectorFailureRequest,
  RecordExternalConnectorInboundRequest,
  RecordExternalConnectorOutboundRequest,
  RollbackProjectPersonaRequest,
  RouteLock,
  RoomConnector,
  RoomPermissionAudit,
  RoutingDecision,
  RoutingFeedbackRequest,
  RunClosureReport,
  RunEvent,
  RunQueuedMessage,
  RunTrace,
  RunTraceSpan,
  RunTraceSpanFilter,
  RunTraceSpanSummary,
  SetRouteLockRequest,
  RetryExternalConnectorEventRequest,
  SettingsRecord,
  SkillRecord,
  SystemHealth,
  TaskContract,
  TaskVerification,
  ToolRunRecord,
  ToolWorkflowRecord,
  UpdateMessengerProjectRequest,
  UpdateMessengerRoomRequest,
  UpdateProjectPersonaRequest,
  WorkerGatewayAuditRecord,
  WorkspaceSettings,
  WorkspaceChangeSet,
  AssistantWorkspaceSnapshot,
  AssistantActionRequest,
  AssistantActionResult,
} from '../../shared-types/src/desktop-api';
import type { WorkspaceChangeSetDraft } from '../../runtime/src/workspace-exec.ts';

type SQLiteValue = string | number | bigint | null;
type SQLiteRow = Record<string, unknown>;

// Keep this tombstone set until every production database has crossed the
// retirement migration. These identifiers are migration guards, not callable
// capabilities or historical UI compatibility.
const RETIRED_CAPABILITY_IDS: ReadonlySet<string> = new Set([
  'video_generate',
  'video_analyze',
]);

type RoomRouteResolution = {
  room: MessengerRoom;
  speaker_persona_id?: string;
  owner_project_id?: string;
  executor_persona_id?: string;
  collaborator_project_ids: string[];
  collaborator_persona_ids?: string[];
  execution_scope: string;
  write_targets: string[];
  thread_action: Record<string, unknown>;
  confidence: number;
  risk: string;
  requires_confirmation: boolean;
  reason_codes: string[];
};

type MessengerThreadLink = {
  thread_id?: string;
  thread_action: Record<string, unknown>;
};

export type JoiSQLiteStoreOptions = {
  dbPath: string;
  schemaSql: string;
  logDir: string;
  backupDir: string;
  version: string;
};

export type WorkerRegisterRequest = {
  node_id?: string;
  name?: string;
  capabilities?: string[];
};

export type WorkerGatewayTask = {
  id: string;
  run_id: string;
  capability_id: string;
  preferred_node_id: string;
  assigned_node_id: string;
  privacy_level: string;
  status: string;
  payload: Record<string, unknown>;
  timeout_seconds: number;
};

export type WorkerTaskResult = {
  output?: Record<string, unknown>;
};

export type WorkerTaskError = {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
};

export type CapabilityExecutorResult = {
  output: Record<string, unknown>;
  response?: string;
};

export type CapabilityExecutor = (
  capability: string,
  inputs: Record<string, unknown>,
) => CapabilityExecutorResult | Promise<CapabilityExecutorResult | undefined> | undefined;

export type SendChatOptions = {
  executeCapability?: CapabilityExecutor;
  selected_agent_id?: string;
};

export type AutomationTriggerEnqueueRequest = {
  automation_id: string;
  trigger_type?: string;
  dedup_key: string;
  payload?: Record<string, unknown>;
  fire_at?: string;
  status?: string;
};

export type AutomationTriggerClaim = {
  trigger: AutomationTriggerRecord;
  automation: AutomationDefinition;
};

export type AutomationRunStartRequest = {
  automation_id: string;
  trigger_id: string;
  run_id: string;
  product_task_id?: string;
  conversation_id?: string;
  source_cwd?: string;
  automation_name?: string;
};

export type AutomationRunFinishRequest = {
  automation_run_id: string;
  run_id?: string;
  product_task_id?: string;
  output_summary?: string;
  notification_delivery?: OutboundNotificationEnqueueRequest;
};

export type AutomationRunFailRequest = {
  automation_run_id: string;
  run_id?: string;
  product_task_id?: string;
  error_code?: string;
  error_message: string;
  retry_at?: string;
};

export type OutboundNotificationDeliveryRecord = {
  id: string;
  channel: string;
  status: string;
  external_delivery_id: string;
  metadata: Record<string, unknown>;
  sent_at?: string;
  updated_at?: string;
};

export type OutboundNotificationEnqueueRequest = {
  id: string;
  dedup_key: string;
  run_id?: string;
  conversation_id?: string;
  product_task_id?: string;
  open_loop_id?: string;
  proactive_message_id?: string;
  channel: string;
  target?: string;
  summary?: string;
  max_attempts?: number;
  backoff_seconds?: number[];
  metadata?: Record<string, unknown>;
};

export type OutboundNotificationRetryContext = {
  id: string;
  dedup_key: string;
  channel: string;
  target: string;
  text: string;
  disable_link_preview: boolean;
  run_id?: string;
  conversation_id?: string;
  product_task_id?: string;
  open_loop_id?: string;
  proactive_message_id?: string;
  summary: string;
  metadata: Record<string, unknown>;
  max_attempts: number;
  backoff_seconds: number[];
};

export type ProactiveOutboundContext = {
  id: string;
  title: string;
  body: string;
  reason: string;
  status: string;
  channel: string;
  send_after?: string;
  expires_at?: string;
  metadata: Record<string, unknown>;
  run_id?: string;
  conversation_id?: string;
  product_task_id?: string;
  open_loop_id?: string;
};

export type TelegramInboundUpdateInput = {
  update_id: number;
  message_id?: string | number;
  chat_id?: string | number;
  from_id?: string | number;
  chat_type?: string;
  text?: string;
  metadata?: Record<string, unknown>;
};

export type TelegramInboundUpdateRecord = {
  update_id: number;
  message_id: string;
  chat_id: string;
  from_id: string;
  chat_type: string;
  text: string;
  status: string;
  claim_token?: string;
  claimed_at?: string;
  model_started_at?: string;
  run_id?: string;
  response_text: string;
  response_started_at?: string;
  response_sent_at?: string;
  external_delivery_id?: string;
  error_code?: string;
  error_message?: string;
  metadata: Record<string, unknown>;
  received_at?: string;
  updated_at?: string;
};

export type PersistedToolResult = {
  call_id: string;
  name: string;
  arguments?: Record<string, unknown>;
  output: Record<string, unknown>;
};

export type PersistedToolCallingTurn = {
  status?: 'completed' | 'waiting_confirmation' | 'max_steps_exceeded';
  provider: string;
  model_name: string;
  selected_agent_id?: string;
  final_message: string;
  tool_results: PersistedToolResult[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_input_tokens?: number;
    cache_write_input_tokens?: number;
    reasoning_tokens?: number;
    total_tokens?: number;
  };
  usage_status?: 'recorded' | 'provider_missing' | 'estimated' | 'failed' | string;
  finish_reason?: string;
  model_responses?: Array<Record<string, unknown>>;
  prompt_assembly?: ToolCallingPromptAssembly;
};

export type ToolCallingResumeRequest = {
  confirmation_id: string;
  run_id: string;
  turn_id: string;
  call_id: string;
  capability_id: string;
  requested_action: string;
  risk_level: string;
  input: Record<string, unknown>;
  conversation_id: string;
  user_message_id: string;
  user_message: string;
  agent_id: string;
  model_id: string;
  model_name: string;
  provider: string;
};

export type PersistedToolCallingResume = {
  provider: string;
  model_name: string;
  final_message: string;
  tool_result: PersistedToolResult;
  tool_results?: PersistedToolResult[];
  model_error?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_input_tokens?: number;
    cache_write_input_tokens?: number;
    reasoning_tokens?: number;
    total_tokens?: number;
  };
  usage_status?: 'recorded' | 'provider_missing' | 'estimated' | 'failed' | string;
  finish_reason?: string;
  model_responses?: Array<Record<string, unknown>>;
};

export type ToolCallingPromptAssembly = {
  cacheable_prefix: string;
  dynamic_tail: string;
  prefix_hash: string;
  dynamic_tail_hash: string;
  prompt_cache_key: string;
  memory_profile_version: string;
  tool_schema_version: string;
  memory_results: MemorySearchResult[];
  stable_memory_results: MemorySearchResult[];
  dynamic_memory_results: MemorySearchResult[];
  memory_controls: MemoryTaskControls;
  memory_scope: MemoryRetrievalScope;
  conversation_messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  agent_capabilities: string[];
  skill_catalog: string;
  selected_skills: Array<{
    id: string;
    name: string;
    path: string;
    invocation: 'explicit' | 'implicit';
    score: number;
  }>;
  system_message: string;
};

export type MemoryRetrievalScope = {
  room_id: string;
  project_ids: string[];
  user_ids: string[];
  scope_override: string;
  cross_project: boolean;
};

export type StartedToolCallingChat = {
  conversation_id: string;
  user_message_id: string;
  assistant_message_id: string;
  run_id: string;
  turn_id: string;
  model_call_id: string;
  memory_pack_id: string;
  prompt_assembly_id: string;
  selected_agent_id: string;
  user_message: string;
  provider: string;
  model_name: string;
  model_base_url?: string;
  model_reasoning_effort?: string;
  memory_controls: MemoryTaskControls;
  prompt_assembly: ToolCallingPromptAssembly;
  product_task_id?: string;
  product_task?: ProductTask;
};

export type RunEventV2Input = {
  id?: string;
  schema_version?: number;
  conversation_id?: string;
  run_id: string;
  turn_id?: string;
  seq?: number;
  event_type: string;
  item_type?: string;
  item_id?: string;
  parent_item_id?: string;
  status?: string;
  phase?: string;
  source?: string;
  visibility?: string;
  level?: string;
  risk_level?: string;
  category?: string;
  feature_key?: string;
  message?: string;
  duration_ms?: number;
  created_at?: string;
  delta?: unknown;
  snapshot?: unknown;
  payload?: Record<string, unknown>;
  error?: unknown;
  usage?: unknown;
  terminal?: boolean;
};

export type AppLogInput = {
  id?: string;
  level?: string;
  risk_level?: string;
  category?: string;
  feature_key?: string;
  source?: string;
  message: string;
  run_id?: string;
  turn_id?: string;
  conversation_id?: string;
  item_type?: string;
  item_id?: string;
  payload?: Record<string, unknown>;
  error?: unknown;
  duration_ms?: number;
  created_at?: string;
};

type ToolCallingCallbackToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type ToolCallingCallbackToolResult = {
  call_id: string;
  name: string;
  arguments?: Record<string, unknown>;
  output: Record<string, unknown>;
};

type ToolCallingCallbackUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  reasoning_tokens?: number;
  total_tokens?: number;
};

export type ToolCallingEventCallbacks = {
  onModelStarted?: (event: { step: number; model: string; streaming: boolean }) => void;
  onModelDelta?: (event: { step: number; payload: Record<string, unknown> }) => void;
  onModelCompleted?: (event: { step: number; finish_reason?: string; usage_status: string }) => void;
  onAssistantDelta?: (event: { step: number; text: string; index: number }) => void;
  onAssistantCompleted?: (event: { step: number; text: string; finish_reason?: string; usage_status: string }) => void;
  onToolCallRequested?: (event: { step: number; call: ToolCallingCallbackToolCall }) => void;
  onToolStarted?: (event: { step: number; call: ToolCallingCallbackToolCall }) => void;
  onToolOutputDelta?: (event: { step: number; call: ToolCallingCallbackToolCall; output: Record<string, unknown> }) => void;
  onToolCompleted?: (event: { step: number; call: ToolCallingCallbackToolCall; result: ToolCallingCallbackToolResult }) => void;
  onToolFailed?: (event: { step: number; call: ToolCallingCallbackToolCall; result?: ToolCallingCallbackToolResult; error?: Error }) => void;
  onApprovalRequired?: (event: { step: number; call: ToolCallingCallbackToolCall; result: ToolCallingCallbackToolResult }) => void;
  onUsage?: (event: { step: number; usage: ToolCallingCallbackUsage; usage_status: string }) => void;
  onRetry?: (event: { step: number; attempt: number; delay_ms: number; error: Error }) => void;
  onError?: (event: { step: number; error: Error }) => void;
  onEvent?: (event: {
    type: string;
    step?: number;
    attempt?: number;
    status?: string;
    tool_call_id?: string;
    tool_name?: string;
    detail?: Record<string, unknown>;
  }) => void;
};

type ModeResolutionRecord = {
  id: string;
  requested_mode: InputMode;
  resolved_mode: InputMode;
  mode_source: 'explicit' | 'automatic' | 'inherited';
  mode_locked_by_user: boolean;
  reason: string;
  confidence: number;
};

type EntryIdentityResolution = {
  principal_id: string;
  channel_identity_id: string;
  channel: string;
  external_user_id: string;
  external_thread_id: string;
  selection_reason: string;
};

type PromptConversationMessage = {
  role: string;
  content: string;
  run_id?: string;
};

type PromptConversationContext = {
  prompt: string;
  included_count: number;
  compressed_count: number;
  omitted_count: number;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
};

type AgentRouteResolution = {
  agent_id: string;
  source: 'caller' | 'room' | 'explicit' | 'rule' | 'sticky' | 'fallback';
  reason: string;
  confidence: number;
};

type CanonicalModelUsage = {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
};

type ModelPricing = {
  input_per_1m: number;
  output_per_1m: number;
  cached_input_per_1m: number;
};

const promptConversationContextLimit = 24;
const promptConversationVerbatimLimit = 8;
const promptConversationSummaryLimit = 220;
const promptConversationMessageLimit = 700;

export class JoiSQLiteStore {
  private db: DatabaseSync;
  private options: JoiSQLiteStoreOptions;
  private memoryMaintenanceTimer?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(options: JoiSQLiteStoreOptions) {
    this.options = options;
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.db = new DatabaseSync(options.dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.ensurePreSchemaCompatibilityColumns();
    this.ensureMemoryCompatibilityColumns();
    this.db.exec(options.schemaSql);
    this.ensureAutomationCompatibilityColumns();
    this.ensureMemorySystemSchema();
    this.ensureConversationClosureSchema();
    this.ensureAdvancedAgentSchema();
    this.ensureAgentWorkbenchSchema();
    this.ensurePersonaMessengerSchema();
    this.ensureTelegramDurabilitySchema();
    this.seedDefaults();
    this.removeLegacyMCPPlaceholders();
    this.repairOrphanedToolRunReferences();
    this.classifyRecoverableRunsOnStartup();
    this.recoverInterruptedAutomationTriggersOnStartup();
    this.recoverTelegramInboundInboxOnStartup();
    this.scheduleMemoryMaintenance('startup', 2_000);
  }

  close(): void {
    this.closed = true;
    if (this.memoryMaintenanceTimer) clearTimeout(this.memoryMaintenanceTimer);
    this.memoryMaintenanceTimer = undefined;
    this.db.close();
  }

  private repairOrphanedToolRunReferences(): void {
    this.exec(
      `UPDATE tool_runs
       SET capability_id=NULL
       WHERE capability_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM capabilities WHERE capabilities.id=tool_runs.capability_id)`,
    );
    this.exec(
      `UPDATE tool_runs
       SET node_id=NULL
       WHERE node_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM nodes WHERE nodes.id=tool_runs.node_id)`,
    );
  }

  private removeLegacyMCPPlaceholders(): void {
    this.exec(
      `DELETE FROM mcp_servers
       WHERE COALESCE(command, '')=''
         AND (
           id='local_mcp_registry'
           OR json_extract(metadata, '$.sync_placeholder')=1
         )`,
    );
  }

  private ensurePreSchemaCompatibilityColumns(): void {
    const ensure = (table: string, column: string, definition: string) => {
      if (!this.tableExists(table) || this.columnExists(table, column)) return;
      this.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} ${definition}`);
    };
    for (const [column, definition] of [
      ['level', "TEXT NOT NULL DEFAULT 'info'"],
      ['risk_level', "TEXT NOT NULL DEFAULT 'read_only'"],
      ['category', "TEXT NOT NULL DEFAULT 'runtime'"],
      ['feature_key', "TEXT NOT NULL DEFAULT ''"],
      ['message', "TEXT NOT NULL DEFAULT ''"],
      ['duration_ms', 'INTEGER'],
    ] as const) ensure('run_events', column, definition);

    for (const [column, definition] of [
      ['level', "TEXT NOT NULL DEFAULT 'info'"],
      ['risk_level', "TEXT NOT NULL DEFAULT 'read_only'"],
      ['category', "TEXT NOT NULL DEFAULT 'system'"],
      ['feature_key', "TEXT NOT NULL DEFAULT ''"],
      ['source', "TEXT NOT NULL DEFAULT 'app'"],
      ['message', "TEXT NOT NULL DEFAULT ''"],
      ['run_id', 'TEXT'],
      ['turn_id', 'TEXT'],
      ['conversation_id', 'TEXT'],
      ['item_type', 'TEXT'],
      ['item_id', 'TEXT'],
      ['payload', "TEXT NOT NULL DEFAULT '{}'"],
      ['error', 'TEXT'],
      ['duration_ms', 'INTEGER'],
    ] as const) ensure('app_logs', column, definition);

    for (const [column, definition] of [
      ['url', "TEXT NOT NULL DEFAULT ''"],
      ['env', "TEXT NOT NULL DEFAULT '{}'"],
      ['headers', "TEXT NOT NULL DEFAULT '{}'"],
    ] as const) ensure('mcp_servers', column, definition);
  }

  private ensureMemoryCompatibilityColumns(): void {
    const ensure = (table: string, column: string, definition: string) => {
      if (!this.tableExists(table) || this.columnExists(table, column)) return;
      this.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} ${definition}`);
    };
    for (const [column, definition] of [
      ['layer', "TEXT NOT NULL DEFAULT 'knowledge'"],
      ['memory_key', "TEXT NOT NULL DEFAULT ''"],
      ['evidence_kind', "TEXT NOT NULL DEFAULT 'legacy'"],
      ['evidence_authority', 'INTEGER NOT NULL DEFAULT 20'],
      ['evidence_count', 'INTEGER NOT NULL DEFAULT 1'],
      ['lifecycle_state', "TEXT NOT NULL DEFAULT 'active'"],
      ['source_kind', "TEXT NOT NULL DEFAULT 'conversation'"],
      ['context_tags', "TEXT NOT NULL DEFAULT '[]'"],
      ['supersedes_memory_id', 'TEXT REFERENCES memories(id)'],
      ['review_reason', 'TEXT'],
      ['valid_from', 'TEXT'],
      ['valid_until', 'TEXT'],
      ['last_verified_at', 'TEXT'],
      ['archived_at', 'TEXT'],
      ['auto_managed', 'INTEGER NOT NULL DEFAULT 1'],
      ['retention_policy', "TEXT NOT NULL DEFAULT 'standard'"],
    ] as const) ensure('memories', column, definition);
    for (const [column, definition] of [
      ['normalized_score', 'REAL'],
      ['recalled', 'INTEGER NOT NULL DEFAULT 1'],
      ['influence_state', "TEXT NOT NULL DEFAULT 'unknown'"],
      ['rank', 'INTEGER'],
      ['pipeline_version', "TEXT NOT NULL DEFAULT 'legacy'"],
    ] as const) ensure('memory_usage_logs', column, definition);
  }

  private ensureAutomationCompatibilityColumns(): void {
    if (!this.tableExists('automation_definitions') || this.columnExists('automation_definitions', 'agent_role_id')) return;
    this.exec(`ALTER TABLE automation_definitions ADD COLUMN agent_role_id TEXT NOT NULL DEFAULT 'general_agent'`);
  }

  private ensureMemorySystemSchema(): void {
    this.ensureMemoryCompatibilityColumns();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS persona_constitutions (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL UNIQUE,
        name TEXT NOT NULL DEFAULT 'Joi',
        identity TEXT NOT NULL,
        character_profile TEXT NOT NULL DEFAULT '{}',
        relationship TEXT NOT NULL DEFAULT '{}',
        default_user TEXT NOT NULL DEFAULT '{}',
        principles TEXT NOT NULL DEFAULT '[]',
        voice TEXT NOT NULL DEFAULT '[]',
        disagreement_style TEXT NOT NULL DEFAULT '',
        uncertainty_style TEXT NOT NULL DEFAULT '',
        boundaries TEXT NOT NULL DEFAULT '[]',
        compiled_prompt TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        source_event_ids TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS memory_observations (
        id TEXT PRIMARY KEY,
        memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
        memory_key TEXT NOT NULL,
        layer TEXT NOT NULL,
        type TEXT NOT NULL,
        statement TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        scope_type TEXT NOT NULL DEFAULT 'user',
        scope_id TEXT,
        privacy_level TEXT NOT NULL DEFAULT 'internal',
        evidence_kind TEXT NOT NULL,
        evidence_authority INTEGER NOT NULL DEFAULT 20,
        confidence REAL NOT NULL DEFAULT 0.5,
        polarity INTEGER NOT NULL DEFAULT 0,
        context_tags TEXT NOT NULL DEFAULT '[]',
        source_event_id TEXT,
        run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'recorded',
        review_reason TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS memory_events (
        id TEXT PRIMARY KEY,
        memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'memory_runtime',
        source_event_id TEXT,
        run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        before_json TEXT NOT NULL DEFAULT '{}',
        after_json TEXT NOT NULL DEFAULT '{}',
        reason TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS memory_policies (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        config TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS memory_generation_inputs (
        id TEXT PRIMARY KEY,
        run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
        turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        user_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        assistant_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        eligible_after TEXT NOT NULL,
        external_context_used INTEGER NOT NULL DEFAULT 0,
        exclusion_reason TEXT NOT NULL DEFAULT '',
        controls TEXT NOT NULL DEFAULT '{}',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        processed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS memory_maintenance_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'running',
        trigger_source TEXT NOT NULL DEFAULT 'runtime',
        processed_input_count INTEGER NOT NULL DEFAULT 0,
        generated_observation_count INTEGER NOT NULL DEFAULT 0,
        expired_count INTEGER NOT NULL DEFAULT 0,
        merged_count INTEGER NOT NULL DEFAULT 0,
        quarantined_count INTEGER NOT NULL DEFAULT 0,
        embedding_count INTEGER NOT NULL DEFAULT 0,
        error_summary TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_memories_layer_lifecycle ON memories(layer, lifecycle_state, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_memory_key ON memories(memory_key, scope_type, scope_id, status);
      CREATE INDEX IF NOT EXISTS idx_memory_observations_key ON memory_observations(memory_key, scope_type, scope_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_events_memory ON memory_events(memory_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_generation_status ON memory_generation_inputs(status, eligible_after, created_at);
      CREATE INDEX IF NOT EXISTS idx_memory_maintenance_finished ON memory_maintenance_runs(finished_at DESC);
    `);
    const ensure = (table: string, column: string, definition: string) => {
      if (!this.tableExists(table) || this.columnExists(table, column)) return;
      this.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} ${definition}`);
    };
    for (const [column, definition] of [
      ['processed_input_count', 'INTEGER NOT NULL DEFAULT 0'],
      ['generated_observation_count', 'INTEGER NOT NULL DEFAULT 0'],
      ['quarantined_count', 'INTEGER NOT NULL DEFAULT 0'],
    ] as const) ensure('memory_maintenance_runs', column, definition);
    for (const [column, definition] of [
      ['character_profile', "TEXT NOT NULL DEFAULT '{}'"],
      ['relationship', "TEXT NOT NULL DEFAULT '{}'"],
      ['default_user', "TEXT NOT NULL DEFAULT '{}'"],
    ] as const) ensure('persona_constitutions', column, definition);
    this.exec(
      `UPDATE memory_maintenance_runs
       SET status='interrupted', error_summary=COALESCE(NULLIF(error_summary, ''), 'interrupted_before_store_restart'),
           finished_at=COALESCE(finished_at, datetime('now'))
       WHERE status='running'`,
    );
    this.seedAuthoredPersonaConstitution();
    const existing = this.get(`SELECT config FROM memory_policies WHERE status='active' ORDER BY version DESC LIMIT 1`);
    const inherited = existing ? parseObject(existing.config) : {};
    this.exec(
      `INSERT INTO memory_policies (id, version, config, status)
       VALUES ('memory_policy_v3', ?, ?, 'active')
       ON CONFLICT(id) DO NOTHING`,
      DEFAULT_MEMORY_POLICY.version,
      json({ ...DEFAULT_MEMORY_POLICY, ...inherited, version: DEFAULT_MEMORY_POLICY.version }),
    );
    this.backfillLegacyMemoryMetadata();
  }

  private seedAuthoredPersonaConstitution(): void {
    const persona = DEFAULT_JOI_PERSONA_CONSTITUTION;
    const compiledPrompt = compilePersonaConstitution(persona);
    this.exec(
      `INSERT INTO persona_constitutions (
         id, version, name, identity, character_profile, relationship, default_user,
         principles, voice, disagreement_style, uncertainty_style, boundaries,
         compiled_prompt, status, source_event_ids, metadata
       ) VALUES ('constitution_joi_v2', 2, 'Joi', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT(version) DO NOTHING`,
      persona.identity || '',
      json(persona.characterProfile || {}),
      json(persona.relationship || {}),
      json(persona.defaultUser || {}),
      json(persona.principles || []),
      json(persona.voice || []),
      persona.disagreementStyle || '',
      persona.uncertaintyStyle || '',
      json(persona.boundaries || []),
      compiledPrompt,
      json(['user_directive_2026-07-14_persona_correction']),
      json({
        source: 'user_explicit_correction',
        pipeline_version: MEMORY_PIPELINE_VERSION,
        immutable_persona_layer: true,
        persona_kind: 'authored_companion_character',
        gender_assumption: 'female',
      }),
    );
    this.exec(
      `UPDATE persona_constitutions
       SET compiled_prompt=?, updated_at=updated_at
       WHERE id='constitution_joi_v2' AND COALESCE(compiled_prompt, '')=''`,
      compiledPrompt,
    );
    const higherActive = this.get(
      `SELECT id FROM persona_constitutions WHERE status='active' AND version > 2 ORDER BY version DESC LIMIT 1`,
    );
    if (higherActive) {
      this.exec(`UPDATE persona_constitutions SET status='superseded' WHERE id='constitution_joi_v2'`);
      return;
    }
    this.exec(`UPDATE persona_constitutions SET status='active' WHERE id='constitution_joi_v2'`);
    this.exec(
      `UPDATE persona_constitutions
       SET status='superseded', updated_at=datetime('now')
       WHERE version < 2 AND status='active'`,
    );
  }

  private backfillLegacyMemoryMetadata(): void {
    for (const row of this.all(`SELECT * FROM memories`)) {
      const metadata = parseObject(row.metadata);
      const type = optionalString(row.type) || 'note';
      const layer = optionalString(row.layer) && optionalString(row.layer) !== 'knowledge'
        ? optionalString(row.layer) as ReturnType<typeof inferLegacyMemoryLayer>
        : inferLegacyMemoryLayer(type, metadata);
      const tags = parseStringArray(row.context_tags);
      const contextTags = tags.length ? tags : inferMemoryContextTags(`${optionalString(row.summary)} ${optionalString(row.content)}`);
      const memoryKey = optionalString(row.memory_key)
        || canonicalMemoryKey(optionalString(row.content) || '', layer, type, contextTags);
      const status = optionalString(row.status) || 'pending';
      const lifecycle = row.merged_into_memory_id
        ? 'superseded'
        : row.disabled_at
          ? 'disabled'
          : ['deleted', 'rejected', 'archived'].includes(status)
            ? 'archived'
            : status === 'conflicted'
              ? 'review'
              : ['pending', 'candidate', 'proposed', 'observed'].includes(status)
                ? 'provisional'
                : 'active';
      this.exec(
        `UPDATE memories
         SET layer=?, memory_key=?, evidence_kind=COALESCE(NULLIF(evidence_kind, ''), 'legacy'),
             evidence_authority=MAX(20, COALESCE(evidence_authority, 20)),
             evidence_count=MAX(1, COALESCE(evidence_count, 1), COALESCE(CAST(json_extract(metadata, '$.duplicate_count') AS INTEGER), 0) + 1),
             lifecycle_state=?, source_kind=COALESCE(NULLIF(source_kind, ''), NULLIF(json_extract(metadata, '$.candidate_source'), ''), 'conversation'),
             context_tags=?, valid_from=COALESCE(valid_from, created_at), last_verified_at=COALESCE(last_verified_at, updated_at)
         WHERE id=?`,
        layer,
        memoryKey,
        lifecycle,
        json(contextTags),
        String(row.id),
      );
    }
  }

  recordAppLog(input: AppLogInput): LogEntry {
    const level = normalizeLogLevel(input.level || (input.error ? 'error' : 'info'));
    const riskLevel = normalizeLogRiskLevel(input.risk_level || 'read_only');
    const category = normalizeLogCategory(input.category || 'system');
    const featureKey = normalizeFeatureKey(input.feature_key || category);
    const payload = sanitizeLogPayload(input.payload || {});
    const errorPayload = sanitizeLogPayload(errorObject(input.error));
    const errorJSON = Object.keys(errorPayload).length > 0 ? json(errorPayload) : null;
    const message = redactSensitiveText(input.message || featureKey);
    const id = input.id || `log_${newID()}`;
    this.exec(
      `INSERT INTO app_logs (
         id, level, risk_level, category, feature_key, source, message,
         run_id, turn_id, conversation_id, item_type, item_id, payload, error, duration_ms, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, COALESCE(NULLIF(TRIM(?), ''), datetime('now')))`,
      id,
      level,
      riskLevel,
      category,
      featureKey,
      input.source?.trim() || 'app',
      message,
      input.run_id || '',
      input.turn_id || '',
      input.conversation_id || '',
      input.item_type || '',
      input.item_id || '',
      json(payload),
      errorJSON,
      optionalNumber(input.duration_ms) ?? null,
      input.created_at || '',
    );
    return this.getLogEntry(id) as LogEntry;
  }

  listLogs(filter: LogFilter = {}): { logs: LogEntry[]; next_cursor?: string } {
    const limit = clampLimit(filter.limit, 100);
    const params: SQLiteValue[] = [];
    const where = ['1=1'];
    const listWhere = (column: string, values?: string[]) => {
      const cleaned = (values || []).map((value) => value.trim()).filter(Boolean);
      if (cleaned.length === 0) return;
      where.push(`${column} IN (${cleaned.map(() => '?').join(', ')})`);
      params.push(...cleaned);
    };
    if (filter.run_id?.trim()) {
      where.push('run_id = ?');
      params.push(filter.run_id.trim());
    }
    if (filter.conversation_id?.trim()) {
      where.push('conversation_id = ?');
      params.push(filter.conversation_id.trim());
    }
    if (filter.since?.trim()) {
      where.push("datetime(created_at) >= datetime(?)");
      params.push(filter.since.trim());
    }
    if (filter.until?.trim()) {
      where.push("datetime(created_at) <= datetime(?)");
      params.push(filter.until.trim());
    }
    if (filter.cursor?.trim()) {
      where.push("datetime(created_at) < datetime(?)");
      params.push(filter.cursor.trim());
    }
    listWhere('level', filter.levels);
    listWhere('risk_level', filter.risk_levels);
    listWhere('category', filter.categories);
    listWhere('source', filter.sources);
    const explicitDebug = (filter.levels || []).some((value) => value.trim().toLowerCase() === 'debug');
    if (!explicitDebug) {
      where.push(`NOT (
        source_table='app_logs'
        AND source='electron_ipc'
        AND level='debug'
        AND (feature_key GLOB 'ipc.*.started' OR feature_key GLOB 'ipc.*.succeeded')
      )`);
    }
    if (filter.query?.trim()) {
      const like = `%${escapeLike(filter.query.trim())}%`;
      where.push(`(message LIKE ? ESCAPE '\\' OR feature_key LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR event_type LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\')`);
      params.push(like, like, like, like, like, like);
    }
    if (!filter.include_trace) {
      where.push(`NOT (source_table='run_events' AND (level='trace' OR event_type IN ('assistant.delta','model.delta','message.delta')))`);
    }
    if (!filter.include_worker_heartbeat) {
      where.push(`NOT (source_table='worker_gateway_audit_logs' AND action IN ('heartbeat','claim'))`);
    }
    const rows = this.all(
      `SELECT * FROM (
         SELECT
           id,
           'run_events' AS source_table,
           COALESCE(level, 'info') AS level,
           COALESCE(risk_level, 'read_only') AS risk_level,
           COALESCE(category, 'runtime') AS category,
           COALESCE(feature_key, event_type) AS feature_key,
           COALESCE(source, 'runtime') AS source,
           COALESCE(NULLIF(message, ''), event_type) AS message,
           run_id,
           COALESCE(turn_id, '') AS turn_id,
           COALESCE(conversation_id, '') AS conversation_id,
           COALESCE(item_type, '') AS item_type,
           COALESCE(item_id, '') AS item_id,
           event_type,
           '' AS action,
           COALESCE(json_extract(payload, '$.status'), '') AS status,
           COALESCE(payload_json, payload, '{}') AS payload,
           COALESCE(error_json, '{}') AS error,
           duration_ms,
           created_at
         FROM run_events
         UNION ALL
         SELECT
           id,
           'app_logs' AS source_table,
           level,
           risk_level,
           category,
           feature_key,
           source,
           message,
           COALESCE(run_id, '') AS run_id,
           COALESCE(turn_id, '') AS turn_id,
           COALESCE(conversation_id, '') AS conversation_id,
           COALESCE(item_type, '') AS item_type,
           COALESCE(item_id, '') AS item_id,
           '' AS event_type,
           '' AS action,
           '' AS status,
           payload,
           COALESCE(error, '{}') AS error,
           duration_ms,
           created_at
         FROM app_logs
         UNION ALL
         SELECT
           id,
           'worker_gateway_audit_logs' AS source_table,
           CASE WHEN status='denied' THEN 'warn' ELSE 'debug' END AS level,
           'read_only' AS risk_level,
           'worker_gateway' AS category,
           'worker_gateway.' || action AS feature_key,
           'worker_gateway' AS source,
           action || ' ' || status AS message,
           '' AS run_id,
           '' AS turn_id,
           '' AS conversation_id,
           'worker' AS item_type,
           COALESCE(node_id, '') AS item_id,
           '' AS event_type,
           action,
           status,
           metadata AS payload,
           CASE WHEN status='denied' THEN json_object('message', COALESCE(reason, 'denied')) ELSE '{}' END AS error,
           NULL AS duration_ms,
           created_at
         FROM worker_gateway_audit_logs
       )
       WHERE ${where.join(' AND ')}
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT ?`,
      ...params,
      limit + 1,
    );
    const entries = rows.slice(0, limit).map(rowToLogEntry);
    return {
      logs: entries,
      next_cursor: rows.length > limit ? optionalString(rows[limit]?.created_at) : undefined,
    };
  }

  getLogEntry(id: string): LogEntry | null {
    const cleanID = id.trim();
    if (!cleanID) return null;
    const runEvent = this.get(
      `SELECT
         id, 'run_events' AS source_table, COALESCE(level, 'info') AS level,
         COALESCE(risk_level, 'read_only') AS risk_level, COALESCE(category, 'runtime') AS category,
         COALESCE(feature_key, event_type) AS feature_key, COALESCE(source, 'runtime') AS source,
         COALESCE(NULLIF(message, ''), event_type) AS message, run_id, COALESCE(turn_id, '') AS turn_id,
         COALESCE(conversation_id, '') AS conversation_id, COALESCE(item_type, '') AS item_type,
         COALESCE(item_id, '') AS item_id, event_type, '' AS action,
         COALESCE(json_extract(payload, '$.status'), '') AS status, COALESCE(payload_json, payload, '{}') AS payload,
         COALESCE(error_json, '{}') AS error, duration_ms, created_at
       FROM run_events WHERE id=?`,
      cleanID,
    );
    if (runEvent) return rowToLogEntry(runEvent);
    const appLog = this.get(
      `SELECT
         id, 'app_logs' AS source_table, level, risk_level, category, feature_key, source, message,
         COALESCE(run_id, '') AS run_id, COALESCE(turn_id, '') AS turn_id,
         COALESCE(conversation_id, '') AS conversation_id, COALESCE(item_type, '') AS item_type,
         COALESCE(item_id, '') AS item_id, '' AS event_type, '' AS action, '' AS status,
         payload, COALESCE(error, '{}') AS error, duration_ms, created_at
       FROM app_logs WHERE id=?`,
      cleanID,
    );
    if (appLog) return rowToLogEntry(appLog);
    const gateway = this.get(
      `SELECT
         id, 'worker_gateway_audit_logs' AS source_table,
         CASE WHEN status='denied' THEN 'warn' ELSE 'debug' END AS level,
         'read_only' AS risk_level, 'worker_gateway' AS category, 'worker_gateway.' || action AS feature_key,
         'worker_gateway' AS source, action || ' ' || status AS message, '' AS run_id, '' AS turn_id,
         '' AS conversation_id, 'worker' AS item_type, COALESCE(node_id, '') AS item_id,
         '' AS event_type, action, status, metadata AS payload,
         CASE WHEN status='denied' THEN json_object('message', COALESCE(reason, 'denied')) ELSE '{}' END AS error,
         NULL AS duration_ms, created_at
       FROM worker_gateway_audit_logs WHERE id=?`,
      cleanID,
    );
    return gateway ? rowToLogEntry(gateway) : null;
  }

  previewLogCleanup(req: LogCleanupRequest): LogCleanupPreview {
    const scopes = normalizeLogCleanupScopes(req.scopes);
    const counts: Record<string, number> = {};
    for (const scope of scopes) {
      counts[scope] = scope === 'log_files'
        ? this.logFilesForCleanup().length
        : this.countLogCleanupScope(scope, req);
    }
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const warnings = scopes.includes('run_events')
      ? ['Run Trace events will be removed for matching runs; conversations and messages stay intact.']
      : [];
    return {
      scopes,
      counts,
      log_file_paths: scopes.includes('log_files') ? this.logFilesForCleanup() : undefined,
      total_count: total,
      safe_to_clear: true,
      warnings,
    };
  }

  clearLogs(req: LogCleanupRequest): LogCleanupResult {
    const scopes = normalizeLogCleanupScopes(req.scopes);
    const preview = this.previewLogCleanup({ ...req, scopes });
    const cleanupID = `cleanup_${newID()}`;
    if (!req.dry_run) {
      this.transaction(() => {
        for (const scope of scopes) {
          if (scope === 'log_files') continue;
          this.deleteLogCleanupScope(scope, req);
        }
        this.exec(
          `INSERT INTO log_cleanup_history (id, actor, scopes, filters, deleted_counts, reason)
           VALUES (?, ?, ?, ?, ?, ?)`,
          cleanupID,
          req.actor?.trim() || 'desktop_user',
          json(scopes),
          json(sanitizeLogPayload({ ...req, scopes })),
          json(preview.counts),
          redactSensitiveText(req.reason || ''),
        );
      });
      if (scopes.includes('log_files')) {
        for (const file of this.logFilesForCleanup()) {
          try {
            rmSync(file, { force: true });
          } catch {
            // Best-effort cleanup; DB cleanup already recorded exact intent.
          }
        }
      }
    }
    return {
      ...preview,
      cleanup_id: cleanupID,
      cleared_at: nowIso(),
    };
  }

  exportLogs(filter: LogFilter = {}): { path: string } {
    mkdirSync(this.options.logDir, { recursive: true });
    const path = join(this.options.logDir, `joi-logs-${timestampForFilename()}.json`);
    const logs = this.listLogs({ ...filter, limit: filter.limit || 500 }).logs;
    writeFileSync(path, JSON.stringify({ exported_at: nowIso(), filter, logs }, null, 2));
    return { path };
  }

  private countLogCleanupScope(scope: string, req: LogCleanupRequest): number {
    const { where, params } = this.logCleanupWhere(scope, req);
    return Number(this.get(`SELECT COUNT(*) AS count FROM ${logCleanupTable(scope)} WHERE ${where}`, ...params)?.count || 0);
  }

  private deleteLogCleanupScope(scope: string, req: LogCleanupRequest): void {
    const { where, params } = this.logCleanupWhere(scope, req);
    this.exec(`DELETE FROM ${logCleanupTable(scope)} WHERE ${where}`, ...params);
  }

  private logCleanupWhere(scope: string, req: LogCleanupRequest): { where: string; params: SQLiteValue[] } {
    const params: SQLiteValue[] = [];
    const where = ['1=1'];
    if (req.older_than?.trim()) {
      where.push("datetime(created_at) < datetime(?)");
      params.push(req.older_than.trim());
    }
    if (req.run_id?.trim() && ['run_events', 'run_steps', 'tool_runs', 'model_calls', 'app_logs'].includes(scope)) {
      where.push('run_id = ?');
      params.push(req.run_id.trim());
    }
    if (scope === 'run_events') {
      if (!req.include_trace_delta) {
        where.push("event_type NOT IN ('assistant.delta','model.delta','message.delta')");
      }
      const levels = (req.levels || []).map((item) => item.trim()).filter(Boolean);
      if (levels.length > 0) {
        where.push(`level IN (${levels.map(() => '?').join(', ')})`);
        params.push(...levels);
      }
      const categories = (req.categories || []).map((item) => item.trim()).filter(Boolean);
      if (categories.length > 0) {
        where.push(`category IN (${categories.map(() => '?').join(', ')})`);
        params.push(...categories);
      }
    }
    if (scope === 'app_logs') {
      const levels = (req.levels || []).map((item) => item.trim()).filter(Boolean);
      if (levels.length > 0) {
        where.push(`level IN (${levels.map(() => '?').join(', ')})`);
        params.push(...levels);
      }
      const categories = (req.categories || []).map((item) => item.trim()).filter(Boolean);
      if (categories.length > 0) {
        where.push(`category IN (${categories.map(() => '?').join(', ')})`);
        params.push(...categories);
      }
    }
    if (scope === 'worker_gateway_audit_logs' && !req.include_worker_heartbeat) {
      where.push("action NOT IN ('heartbeat','claim')");
    }
    return { where: where.join(' AND '), params };
  }

  private logFilesForCleanup(): string[] {
    try {
      return readdirSync(this.options.logDir)
        .map((name) => join(this.options.logDir, name))
        .filter((path) => {
          try {
            const stat = statSync(path);
            return stat.isFile() && /\.(log|json|txt)$/i.test(path);
          } catch {
            return false;
          }
        });
    } catch {
      return [];
    }
  }

  listAutomations(filter: { kind?: AutomationKind; enabled?: boolean; limit?: number } = {}): { automations: AutomationDefinition[] } {
    const where = ['deleted_at IS NULL'];
    const params: SQLiteValue[] = [];
    if (filter.kind) {
      where.push('kind = ?');
      params.push(normalizeAutomationKind(filter.kind));
    }
    if (typeof filter.enabled === 'boolean') {
      where.push('enabled = ?');
      params.push(filter.enabled ? 1 : 0);
    }
    const limit = clampLimit(filter.limit, 100);
    const rows = this.all(
      `SELECT * FROM automation_definitions
       WHERE ${where.join(' AND ')}
       ORDER BY enabled DESC, datetime(updated_at) DESC, datetime(created_at) DESC
       LIMIT ?`,
      ...params,
      limit,
    );
    return { automations: rows.map(rowToAutomationDefinition) };
  }

  getAutomation(idOrSlug: string): AutomationDefinition {
    const key = idOrSlug.trim();
    if (!key) throw new Error('automation id is required');
    const row = this.get(
      `SELECT * FROM automation_definitions
       WHERE deleted_at IS NULL AND (id=? OR slug=?)
       LIMIT 1`,
      key,
      key,
    );
    if (!row) throw new Error(`Automation not found: ${key}`);
    return rowToAutomationDefinition(row);
  }

  saveAutomation(req: AutomationDefinitionRequest): AutomationDefinition {
    const id = req.id?.trim() || `automation_${newID()}`;
    const existing = req.id?.trim()
      ? this.get(`SELECT * FROM automation_definitions WHERE id=? AND deleted_at IS NULL`, req.id.trim())
      : undefined;
    const name = req.name?.trim() || optionalString(existing?.name) || 'Untitled automation';
    const baseSlug = sanitizeAutomationSlug(req.slug || optionalString(existing?.slug) || name || id);
    const slug = this.availableAutomationSlug(baseSlug, id);
    const kind = normalizeAutomationKind(req.kind || optionalString(existing?.kind) || 'schedule');
    const now = nowIso();
    const triggerConfig = {
      ...(req.trigger_config ?? parseObject(existing?.trigger_config)),
      ...(req.rrule?.trim() ? { type: 'rrule', rrule: req.rrule.trim() } : {}),
    };
    const existingMetadata = parseObject(existing?.metadata);
    const executionKind = normalizeAutomationExecutionKind(
      req.execution_kind
        || req.metadata?.execution_kind
        || existingMetadata.execution_kind
        || (kind === 'webhook' ? 'webhook' : 'cron'),
    );
    const metadata = {
      ...existingMetadata,
      ...(req.metadata || {}),
      execution_kind: executionKind,
      ...(req.rrule?.trim() ? { rrule: req.rrule.trim() } : {}),
      ...(req.model?.trim() ? { model: req.model.trim() } : {}),
      ...(req.model_provider?.trim() ? { model_provider: req.model_provider.trim() } : {}),
      ...(req.model_base_url?.trim() ? { model_base_url: req.model_base_url.trim() } : {}),
      ...(req.reasoning_effort?.trim() ? { reasoning_effort: req.reasoning_effort.trim() } : {}),
      execution_environment: req.execution_environment || optionalString(existingMetadata.execution_environment) || 'local',
      ...(req.target ? { target: req.target } : {}),
      ...(req.cwds ? { cwds: req.cwds.map(String).map((item) => item.trim()).filter(Boolean) } : {}),
      ...(req.target_thread_id?.trim() ? { target_thread_id: req.target_thread_id.trim() } : {}),
      ...(typeof req.is_draft === 'boolean' ? { is_draft: req.is_draft } : {}),
    };
    if (req.model !== undefined && !req.model_provider?.trim()) delete metadata.model_provider;
    if (req.model !== undefined && !req.model_base_url?.trim()) delete metadata.model_base_url;
    const targetThreadID = req.target_thread_id?.trim()
      || optionalString(metadata.target_thread_id)
      || req.conversation_id?.trim()
      || optionalString(existing?.conversation_id)
      || '';
    const retryPolicy = Object.keys(req.retry_policy || {}).length > 0
      ? req.retry_policy
      : Object.keys(parseObject(existing?.retry_policy)).length > 0
        ? parseObject(existing?.retry_policy)
        : defaultAutomationRetryPolicy();
    const maxConcurrency = Math.max(1, Math.floor(Number(req.max_concurrency ?? existing?.max_concurrency ?? 1) || 1));
    if (existing) {
      this.exec(
        `UPDATE automation_definitions
         SET kind=?, slug=?, name=?, description=?, enabled=?, trigger_config=?, prompt_template=?,
             input_mode=?, permission_profile=?, preferred_node=?, allow_worker=?, agent_role_id=?, conversation_id=NULLIF(?, ''),
             principal_id=NULLIF(?, ''), dedup_policy=?, retry_policy=?, max_concurrency=?,
             notification_policy=?, metadata=?, updated_at=?
         WHERE id=?`,
        kind,
        slug,
        name,
        req.description ?? optionalString(existing.description) ?? '',
        req.enabled ?? Boolean(Number(existing.enabled ?? 1)) ? 1 : 0,
        json(triggerConfig),
        req.prompt_template ?? optionalString(existing.prompt_template) ?? defaultAutomationPromptTemplate(kind),
        normalizeAutomationInputMode(req.input_mode || optionalString(existing.input_mode)),
        normalizeAutomationPermissionProfile(req.permission_profile || optionalString(existing.permission_profile)),
        req.preferred_node?.trim() || optionalString(existing.preferred_node) || 'main-node',
        req.allow_worker ?? Boolean(Number(existing.allow_worker ?? 0)) ? 1 : 0,
        req.agent_role_id?.trim() || optionalString(existing.agent_role_id) || 'general_agent',
        executionKind === 'heartbeat' ? targetThreadID : req.conversation_id?.trim() || optionalString(existing.conversation_id) || '',
        req.principal_id?.trim() || optionalString(existing.principal_id) || '',
        json(req.dedup_policy ?? parseObject(existing.dedup_policy)),
        json(retryPolicy),
        maxConcurrency,
        json(req.notification_policy ?? parseObject(existing.notification_policy)),
        json(metadata),
        now,
        id,
      );
      return this.getAutomation(id);
    }
    this.exec(
      `INSERT INTO automation_definitions (
         id, kind, slug, name, description, enabled, trigger_config, prompt_template, input_mode,
         permission_profile, preferred_node, allow_worker, agent_role_id, conversation_id, principal_id, dedup_policy,
         retry_policy, max_concurrency, notification_policy, metadata, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?)`,
      id,
      kind,
      slug,
      name,
      req.description || '',
      req.enabled ?? true ? 1 : 0,
      json(triggerConfig),
      req.prompt_template || defaultAutomationPromptTemplate(kind),
      normalizeAutomationInputMode(req.input_mode),
      normalizeAutomationPermissionProfile(req.permission_profile),
      req.preferred_node?.trim() || 'main-node',
      req.allow_worker ? 1 : 0,
      req.agent_role_id?.trim() || 'general_agent',
      executionKind === 'heartbeat' ? targetThreadID : req.conversation_id?.trim() || '',
      req.principal_id?.trim() || '',
      json(req.dedup_policy || {}),
      json(retryPolicy),
      maxConcurrency,
      json(req.notification_policy || {}),
      json(metadata),
      now,
      now,
    );
    return this.getAutomation(id);
  }

  deleteAutomation(id: string): void {
    const automationID = id.trim();
    if (!automationID) throw new Error('automation id is required');
    this.exec(
      `UPDATE automation_definitions
       SET enabled=0, deleted_at=datetime('now'), updated_at=datetime('now')
       WHERE id=? OR slug=?`,
      automationID,
      automationID,
    );
  }

  setAutomationEnabled(req: { id: string; enabled: boolean }): AutomationDefinition {
    const automation = this.getAutomation(req.id);
    this.exec(
      `UPDATE automation_definitions
       SET enabled=?, updated_at=datetime('now')
       WHERE id=?`,
      req.enabled ? 1 : 0,
      automation.id,
    );
    return this.getAutomation(automation.id);
  }

  listAutomationTriggers(filter: { automation_id?: string; status?: string; limit?: number } = {}): { triggers: AutomationTriggerRecord[] } {
    const where = ['1=1'];
    const params: SQLiteValue[] = [];
    if (filter.automation_id?.trim()) {
      where.push('automation_id = ?');
      params.push(filter.automation_id.trim());
    }
    if (filter.status?.trim()) {
      where.push('status = ?');
      params.push(filter.status.trim());
    }
    const rows = this.all(
      `SELECT * FROM automation_triggers
       WHERE ${where.join(' AND ')}
       ORDER BY datetime(created_at) DESC
       LIMIT ?`,
      ...params,
      clampLimit(filter.limit, 100),
    );
    return { triggers: rows.map(rowToAutomationTrigger) };
  }

  listAutomationRuns(filter: { automation_id?: string; trigger_id?: string; limit?: number } = {}): { runs: AutomationRunRecord[] } {
    const where = ['1=1'];
    const params: SQLiteValue[] = [];
    if (filter.automation_id?.trim()) {
      where.push('automation_id = ?');
      params.push(filter.automation_id.trim());
    }
    if (filter.trigger_id?.trim()) {
      where.push('trigger_id = ?');
      params.push(filter.trigger_id.trim());
    }
    const rows = this.all(
      `SELECT * FROM automation_runs
       WHERE ${where.join(' AND ')}
       ORDER BY datetime(created_at) DESC
       LIMIT ?`,
      ...params,
      clampLimit(filter.limit, 100),
    );
    return { runs: rows.map(rowToAutomationRun) };
  }

  setAutomationRunRead(req: { id: string; read: boolean }): AutomationRunRecord {
    const run = this.requireAutomationRun(req.id);
    this.exec(
      req.read
        ? `UPDATE automation_runs SET metadata=json_set(COALESCE(metadata, '{}'), '$.read_at', ?), updated_at=datetime('now') WHERE id=?`
        : `UPDATE automation_runs SET metadata=json_remove(COALESCE(metadata, '{}'), '$.read_at'), updated_at=datetime('now') WHERE id=?`,
      ...(req.read ? [nowIso(), run.id] : [run.id]),
    );
    return this.requireAutomationRun(run.id);
  }

  markAllAutomationRunsRead(req: { automation_id?: string } = {}): { updated: number } {
    const automationID = req.automation_id?.trim() || '';
    const result = this.db.prepare(
      `UPDATE automation_runs
       SET metadata=json_set(COALESCE(metadata, '{}'), '$.read_at', ?), updated_at=datetime('now')
       WHERE json_extract(COALESCE(metadata, '{}'), '$.read_at') IS NULL
         AND (?='' OR automation_id=?)`,
    ).run(nowIso(), automationID, automationID);
    return { updated: Number(result.changes ?? 0) };
  }

  setAutomationRunArchived(req: { id: string; archived: boolean }): AutomationRunRecord {
    const run = this.requireAutomationRun(req.id);
    const conversationID = run.conversation_id;
    if (conversationID) {
      try {
        if (req.archived) this.archiveConversation({ id: conversationID, reason: 'automation_history' });
        else this.restoreConversation({ id: conversationID, reason: 'automation_history' });
      } catch {
        // A run can outlive its conversation. Preserve the history state even when the linked task is unavailable.
      }
    }
    this.exec(
      req.archived
        ? `UPDATE automation_runs SET metadata=json_set(COALESCE(metadata, '{}'), '$.archived_at', ?), updated_at=datetime('now') WHERE id=?`
        : `UPDATE automation_runs SET metadata=json_remove(COALESCE(metadata, '{}'), '$.archived_at'), updated_at=datetime('now') WHERE id=?`,
      ...(req.archived ? [nowIso(), run.id] : [run.id]),
    );
    return this.requireAutomationRun(run.id);
  }

  archiveAllAutomationRuns(req: { automation_id: string }): { succeeded_count: number; failed_count: number } {
    const runs = this.listAutomationRuns({ automation_id: req.automation_id, limit: 500 }).runs
      .filter((run) => !run.archived_at && run.status !== 'running');
    let succeededCount = 0;
    let failedCount = 0;
    for (const run of runs) {
      try {
        this.setAutomationRunArchived({ id: run.id, archived: true });
        succeededCount += 1;
      } catch {
        failedCount += 1;
      }
    }
    return { succeeded_count: succeededCount, failed_count: failedCount };
  }

  enqueueAutomationTrigger(req: AutomationTriggerEnqueueRequest): { trigger: AutomationTriggerRecord; deduped: boolean } {
    const automation = this.getAutomation(req.automation_id);
    if (!automation.enabled && req.trigger_type !== 'manual') throw codedError('AUTOMATION_DISABLED', 'Automation is disabled');
    const dedupKey = req.dedup_key.trim();
    if (!dedupKey) throw codedError('INVALID_PAYLOAD', 'automation trigger dedup_key is required');
    const triggerID = `autotrig_${newID()}`;
    const fireAt = req.fire_at || nowIso();
    try {
      this.exec(
        `INSERT INTO automation_triggers (
           id, automation_id, trigger_type, dedup_key, payload, status, fire_at, next_attempt_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        triggerID,
        automation.id,
        req.trigger_type?.trim() || automation.kind,
        dedupKey,
        json(req.payload || {}),
        req.status?.trim() || 'pending',
        fireAt,
        fireAt,
      );
      return { trigger: this.requireAutomationTrigger(triggerID), deduped: false };
    } catch (error) {
      const existing = this.get(
        `SELECT * FROM automation_triggers WHERE automation_id=? AND dedup_key=?`,
        automation.id,
        dedupKey,
      );
      if (existing) {
        const trigger = rowToAutomationTrigger(existing);
        if (trigger.run_id) {
          this.appendAutomationRunEvent(trigger.run_id, 'automation.trigger_deduped', {
            automation_id: automation.id,
            trigger_id: trigger.id,
            dedup_key: dedupKey,
            title: 'Automation trigger deduped',
            summary: automation.name,
          });
        }
        return { trigger, deduped: true };
      }
      throw error;
    }
  }

  triggerAutomationNow(req: AutomationTriggerNowRequest): { trigger: AutomationTriggerRecord } {
    const automation = this.getAutomation(req.id);
    const dedupKey = `manual:${nowIso()}:${newID()}`;
    const result = this.enqueueAutomationTrigger({
      automation_id: automation.id,
      trigger_type: 'manual',
      dedup_key: dedupKey,
      payload: req.payload || {},
      fire_at: nowIso(),
    });
    return { trigger: result.trigger };
  }

  listDueScheduleAutomations(now = nowIso()): AutomationDefinition[] {
    return this.all(
      `SELECT * FROM automation_definitions
       WHERE kind='schedule' AND enabled=1 AND deleted_at IS NULL
         AND (next_fire_at IS NULL OR datetime(next_fire_at) <= datetime(?))
       ORDER BY datetime(COALESCE(next_fire_at, created_at)) ASC
       LIMIT 100`,
      now,
    ).map(rowToAutomationDefinition);
  }

  updateAutomationScheduleState(id: string, nextFireAt?: string, lastFireAt?: string): AutomationDefinition {
    this.exec(
      `UPDATE automation_definitions
       SET next_fire_at=NULLIF(?, ''), last_fire_at=COALESCE(NULLIF(?, ''), last_fire_at), updated_at=datetime('now')
       WHERE id=?`,
      nextFireAt || '',
      lastFireAt || '',
      id,
    );
    return this.getAutomation(id);
  }

  claimDueAutomationTrigger(now = nowIso()): AutomationTriggerClaim | undefined {
    let claimedID = '';
    let claimToken = '';
    this.transaction(() => {
      const row = this.get(
        `SELECT t.id
         FROM automation_triggers t
         JOIN automation_definitions a ON a.id=t.automation_id
         WHERE (a.enabled=1 OR t.trigger_type='manual')
           AND a.deleted_at IS NULL
           AND t.status IN ('pending', 'retry_scheduled')
           AND datetime(COALESCE(t.next_attempt_at, t.fire_at, t.created_at)) <= datetime(?)
           AND (
             SELECT COUNT(*)
             FROM automation_triggers active
             WHERE active.automation_id=t.automation_id
               AND active.status IN ('claimed', 'running')
           ) < MAX(1, a.max_concurrency)
         ORDER BY datetime(COALESCE(t.next_attempt_at, t.fire_at, t.created_at)) ASC, datetime(t.created_at) ASC
         LIMIT 1`,
        now,
      );
      const triggerID = optionalString(row?.id);
      if (!triggerID) return;
      claimToken = `claim_${newID()}`;
      const result = this.db.prepare(
        `UPDATE automation_triggers
         SET status='claimed', claim_token=?, claimed_at=datetime('now'), attempt_count=attempt_count+1, updated_at=datetime('now')
         WHERE id=? AND status IN ('pending', 'retry_scheduled')`,
      ).run(claimToken, triggerID);
      if (Number(result.changes ?? 0) === 1) {
        claimedID = triggerID;
      }
    });
    if (!claimedID) return undefined;
    const trigger = this.requireAutomationTrigger(claimedID);
    const automation = this.getAutomation(trigger.automation_id);
    return { trigger, automation };
  }

  recordAutomationRunStarted(req: AutomationRunStartRequest): AutomationRunRecord {
    const trigger = this.requireAutomationTrigger(req.trigger_id);
    const automation = this.getAutomation(req.automation_id);
    const runID = req.run_id.trim();
    if (!runID) throw new Error('automation run_id is required');
    const automationRunID = `autorun_${newID()}`;
    const attempt = Math.max(1, trigger.attempt_count || 1);
    this.transaction(() => {
      this.exec(
        `INSERT INTO automation_runs (
           id, automation_id, trigger_id, run_id, product_task_id, status, attempt_number, started_at, metadata, created_at, updated_at
         ) VALUES (?, ?, ?, ?, NULLIF(?, ''), 'running', ?, datetime('now'), ?, datetime('now'), datetime('now'))`,
        automationRunID,
        automation.id,
        trigger.id,
        runID,
        req.product_task_id || '',
        attempt,
        json({
          claim_token: trigger.claim_token || '',
          trigger_type: trigger.trigger_type,
          conversation_id: req.conversation_id || '',
          source_cwd: req.source_cwd || automation.cwds[0] || '',
          automation_name: req.automation_name || automation.name,
        }),
      );
      this.exec(
        `UPDATE automation_triggers
         SET status='running', run_id=?, product_task_id=NULLIF(?, ''), updated_at=datetime('now')
         WHERE id=?`,
        runID,
        req.product_task_id || '',
        trigger.id,
      );
      this.appendAutomationRunEvent(runID, 'automation.trigger_received', {
        automation_id: automation.id,
        automation_name: automation.name,
        trigger_id: trigger.id,
        trigger_type: trigger.trigger_type,
        dedup_key: trigger.dedup_key,
        payload_keys: Object.keys(trigger.payload).slice(0, 32),
        title: 'Automation trigger received',
        summary: automation.name,
      });
      this.appendAutomationRunEvent(runID, 'automation.claimed', {
        automation_id: automation.id,
        automation_name: automation.name,
        trigger_id: trigger.id,
        attempt_number: attempt,
        title: 'Automation claimed',
        summary: automation.name,
      });
      this.appendAutomationRunEvent(runID, 'automation.run_started', {
        automation_id: automation.id,
        automation_name: automation.name,
        trigger_id: trigger.id,
        automation_run_id: automationRunID,
        product_task_id: req.product_task_id || undefined,
        title: 'Automation run started',
        summary: automation.name,
      });
    });
    return this.requireAutomationRun(automationRunID);
  }

  recordAutomationTriggerFailed(req: { trigger_id: string; error_code?: string; error_message: string; retry_at?: string }): AutomationTriggerRecord {
    const status = req.retry_at ? 'retry_scheduled' : 'failed';
    this.exec(
      `UPDATE automation_triggers
       SET status=?, next_attempt_at=NULLIF(?, ''), error_code=?, error_message=?, updated_at=datetime('now')
       WHERE id=?`,
      status,
      req.retry_at || '',
      req.error_code || '',
      req.error_message,
      req.trigger_id,
    );
    return this.requireAutomationTrigger(req.trigger_id);
  }

  recordAutomationRunCompleted(req: AutomationRunFinishRequest): AutomationRunRecord {
    const run = this.requireAutomationRun(req.automation_run_id);
    const runID = req.run_id?.trim() || run.run_id || '';
    const notification = req.notification_delivery;
    this.transaction(() => {
      this.exec(
        `UPDATE automation_runs
         SET status='succeeded', run_id=COALESCE(NULLIF(?, ''), run_id), product_task_id=COALESCE(NULLIF(?, ''), product_task_id),
             output_summary=?, finished_at=datetime('now'), updated_at=datetime('now')
         WHERE id=?`,
        runID,
        req.product_task_id || '',
        req.output_summary || '',
        req.automation_run_id,
      );
      this.exec(
        `UPDATE automation_triggers
         SET status='succeeded', run_id=COALESCE(NULLIF(?, ''), run_id), product_task_id=COALESCE(NULLIF(?, ''), product_task_id),
             error_code=NULL, error_message=NULL, updated_at=datetime('now')
         WHERE id=?`,
        runID,
        req.product_task_id || '',
        run.trigger_id,
      );
      if (runID) {
        this.appendAutomationRunEvent(runID, 'automation.run_completed', {
          automation_id: run.automation_id,
          trigger_id: run.trigger_id,
          automation_run_id: run.id,
          product_task_id: req.product_task_id || run.product_task_id || undefined,
          title: 'Automation run completed',
          summary: req.output_summary || 'Automation completed.',
        });
      }
      if (notification) {
        this.insertPendingOutboundNotification({
          ...notification,
          run_id: notification.run_id?.trim() || runID,
          product_task_id: notification.product_task_id?.trim() || req.product_task_id || run.product_task_id,
        });
      }
    });
    return this.requireAutomationRun(req.automation_run_id);
  }

  recordAutomationRunFailed(req: AutomationRunFailRequest): AutomationRunRecord {
    const run = this.requireAutomationRun(req.automation_run_id);
    const runID = req.run_id?.trim() || run.run_id || '';
    const runStatus = isPendingConfirmationAutomationError(req.error_code, req.error_message) ? 'waiting_confirmation' : 'failed';
    const triggerStatus = req.retry_at ? 'retry_scheduled' : runStatus === 'waiting_confirmation' ? 'waiting_confirmation' : 'failed';
    this.transaction(() => {
      this.exec(
        `UPDATE automation_runs
         SET status=?, run_id=COALESCE(NULLIF(?, ''), run_id), product_task_id=COALESCE(NULLIF(?, ''), product_task_id),
             error_code=?, error_message=?, finished_at=datetime('now'), updated_at=datetime('now')
         WHERE id=?`,
        runStatus,
        runID,
        req.product_task_id || '',
        req.error_code || '',
        req.error_message,
        run.id,
      );
      this.exec(
        `UPDATE automation_triggers
         SET status=?, run_id=COALESCE(NULLIF(?, ''), run_id), product_task_id=COALESCE(NULLIF(?, ''), product_task_id),
             next_attempt_at=NULLIF(?, ''), error_code=?, error_message=?, updated_at=datetime('now')
         WHERE id=?`,
        triggerStatus,
        runID,
        req.product_task_id || '',
        req.retry_at || '',
        req.error_code || '',
        req.error_message,
        run.trigger_id,
      );
      if (runID) {
        this.appendAutomationRunEvent(runID, 'automation.run_failed', {
          automation_id: run.automation_id,
          trigger_id: run.trigger_id,
          automation_run_id: run.id,
          product_task_id: req.product_task_id || run.product_task_id || undefined,
          error_code: req.error_code || '',
          title: 'Automation run failed',
          summary: req.error_message,
        });
        if (req.retry_at) {
          this.appendAutomationRunEvent(runID, 'automation.retry_scheduled', {
            automation_id: run.automation_id,
            trigger_id: run.trigger_id,
            automation_run_id: run.id,
            retry_at: req.retry_at,
            title: 'Automation retry scheduled',
            summary: req.retry_at,
          });
        }
      }
    });
    return this.requireAutomationRun(run.id);
  }

  appendRunEventV2(input: RunEventV2Input): RunEvent {
    const eventType = input.event_type.trim();
    if (!input.run_id.trim()) throw new Error('run_id is required for RunEventV2');
    if (!eventType) throw new Error('event_type is required for RunEventV2');
    const runID = input.run_id.trim();
    const conversationID = input.conversation_id?.trim() || optionalString(this.get(`SELECT conversation_id FROM runs WHERE id=?`, runID)?.conversation_id);
    const seq = input.seq && input.seq > 0 ? input.seq : this.nextRunEventSeq(runID);
    const schemaVersion = input.schema_version || 2;
    const status = input.status || statusForRunEventType(eventType);
    const level = normalizeLogLevel(input.level || logLevelForRunEvent(eventType, status, input.error));
    const riskLevel = normalizeLogRiskLevel(input.risk_level || logRiskForRunEvent(eventType, input.payload || {}));
    const category = normalizeLogCategory(input.category || logCategoryForRunEvent(eventType, input.item_type));
    const featureKey = normalizeFeatureKey(input.feature_key || logFeatureKeyForRunEvent(eventType, input.payload || {}));
    const message = redactSensitiveText(input.message || logMessageForRunEvent(eventType, input.payload || {}, status));
    const durationMs = optionalNumber(input.duration_ms);
    const payload = pruneUndefined({
      ...(input.payload || {}),
      schema_version: schemaVersion,
      run_id: runID,
      turn_id: input.turn_id || undefined,
      conversation_id: conversationID || undefined,
      seq,
      event_type: eventType,
      type: eventType,
      item_type: input.item_type,
      item_id: input.item_id,
      parent_item_id: input.parent_item_id,
      status,
      phase: input.phase,
      source: input.source || 'runtime',
      visibility: input.visibility || visibilityForRunEventType(eventType, input.item_type),
      level,
      risk_level: riskLevel,
      category,
      feature_key: featureKey,
      message,
      terminal: input.terminal || terminalRunEventType(eventType) || undefined,
      delta: input.delta,
      snapshot: input.snapshot,
      error: errorSummary(input.error),
      usage: input.usage,
      duration_ms: durationMs,
    });
    this.exec(
      `INSERT INTO run_events (id, run_id, turn_id, schema_version, conversation_id, seq, event_type,
                               item_type, item_id, parent_item_id, phase, visibility, source,
                               level, risk_level, category, feature_key, message, terminal,
                               payload, payload_json, error_json, usage_json, duration_ms, created_at)
       VALUES (?, ?, NULLIF(?, ''), ?, NULLIF(?, ''), ?, ?, NULLIF(?, ''), NULLIF(?, ''),
               NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''),
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               COALESCE(NULLIF(TRIM(?), ''), datetime('now')))`,
      input.id || `evt_${newID()}`,
      runID,
      input.turn_id || '',
      schemaVersion,
      conversationID || '',
      seq,
      eventType,
      input.item_type || '',
      input.item_id || '',
      input.parent_item_id || '',
      input.phase || '',
      payload.visibility ? String(payload.visibility) : '',
      payload.source ? String(payload.source) : '',
      level,
      riskLevel,
      category,
      featureKey,
      message,
      payload.terminal ? 1 : 0,
      json(payload),
      json(payload),
      json(input.error || {}),
      json(input.usage || {}),
      durationMs ?? null,
      input.created_at || '',
    );
    return rowToRunEvent(this.get(`SELECT * FROM run_events WHERE run_id=? AND seq=?`, runID, seq)!);
  }

  listRunEventsV2(runID: string): { events: RunEvent[] } {
    return { events: this.getRunTrace(runID).events || [] };
  }

  markModelCallFirstDelta(modelCallID: string): void {
    if (!modelCallID.trim()) return;
    this.exec(
      `UPDATE model_calls
       SET streaming_enabled=1, first_delta_at=COALESCE(first_delta_at, datetime('now'))
       WHERE id=?`,
      modelCallID,
    );
  }

  createToolCallingEventCallbacks(started: StartedToolCallingChat, emit?: (event: RunEvent) => void): ToolCallingEventCallbacks {
    const toolStartedAt = new Map<string, number>();
    const append = (input: Omit<RunEventV2Input, 'run_id'> & { run_id?: string }) => {
      const event = this.appendRunEventV2({
        ...input,
        conversation_id: input.conversation_id || started.conversation_id,
        run_id: input.run_id || started.run_id,
        turn_id: input.turn_id || started.turn_id,
      });
      emit?.(event);
    };
    return {
      onModelStarted: (event) => {
        append({
          event_type: 'model.started',
          item_type: 'model_call',
          item_id: started.model_call_id,
          status: 'running',
          source: 'model_provider',
          visibility: 'transcript',
          payload: { model: event.model, streaming: event.streaming, step: event.step },
        });
      },
      onModelDelta: (event) => {
        append({
          event_type: 'model.delta',
          item_type: 'model_call',
          item_id: started.model_call_id,
          status: 'running',
          source: 'model_provider',
          visibility: 'trace_only',
          delta: event.payload,
          payload: { step: event.step },
        });
      },
      onModelCompleted: (event) => {
        append({
          event_type: 'model.completed',
          item_type: 'model_call',
          item_id: started.model_call_id,
          status: 'completed',
          source: 'model_provider',
          visibility: 'transcript',
          payload: { step: event.step, finish_reason: event.finish_reason, usage_status: event.usage_status },
        });
      },
      onAssistantDelta: (event) => {
        this.markModelCallFirstDelta(started.model_call_id);
        const text = sanitizeAssistantConversationText(started.user_message, event.text);
        if (!text) return;
        append({
          event_type: 'assistant.delta',
          item_type: 'assistant_message',
          item_id: started.assistant_message_id,
          status: 'running',
          source: 'model_provider',
          visibility: 'chat',
          delta: { text, index: event.index, stream_source: 'provider_stream' },
        });
      },
      onAssistantCompleted: (event) => {
        const text = sanitizeAssistantConversationText(started.user_message, event.text);
        append({
          event_type: 'assistant.completed',
          item_type: 'assistant_message',
          item_id: started.assistant_message_id,
          status: 'completed',
          source: 'model_provider',
          visibility: 'chat',
          delta: { text },
          payload: { finish_reason: event.finish_reason, usage_status: event.usage_status },
        });
      },
      onToolCallRequested: (event) => {
        const capability = callbackToolCapability(event.call);
        const risk = workflowRiskLevel(capability);
        append({
          event_type: 'tool.call_requested',
          item_type: 'tool_run',
          item_id: event.call.id,
          status: 'requested',
          source: 'model_provider',
          visibility: 'tool',
          risk_level: risk,
          payload: { call_id: event.call.id, capability, tool_name: event.call.name, input: event.call.arguments, step: event.step, risk, side_effect_level: sideEffectLevelForCapability(capability) },
        });
      },
      onToolStarted: (event) => {
        if (!toolStartedAt.has(event.call.id)) toolStartedAt.set(event.call.id, Date.now());
        const capability = callbackToolCapability(event.call);
        const risk = workflowRiskLevel(capability);
        append({
          event_type: 'tool.started',
          item_type: 'tool_run',
          item_id: event.call.id,
          status: 'running',
          source: 'tool',
          visibility: 'tool',
          risk_level: risk,
          payload: { call_id: event.call.id, capability, tool_name: event.call.name, input: event.call.arguments, step: event.step, risk, side_effect_level: sideEffectLevelForCapability(capability) },
        });
      },
      onToolOutputDelta: (event) => {
        append({
          event_type: 'tool.output_delta',
          item_type: 'tool_run',
          item_id: event.call.id,
          status: 'running',
          source: 'tool',
          visibility: 'tool',
          delta: event.output,
          payload: { call_id: event.call.id, tool_name: event.call.name, step: event.step },
        });
      },
      onToolCompleted: (event) => {
        const capability = toolResultCapability(event.result);
        const risk = toolResultRisk(event.result, capability);
        const durationMs = toolResultDuration(event.result, toolStartedAt.get(event.call.id));
        append({
          event_type: 'tool.completed',
          item_type: 'tool_run',
          item_id: event.call.id,
          status: 'completed',
          source: 'tool',
          visibility: 'tool',
          risk_level: risk,
          duration_ms: durationMs,
          snapshot: event.result.output,
          payload: { call_id: event.call.id, capability, tool_name: event.call.name, step: event.step, risk, side_effect_level: toolResultSideEffect(event.result, capability), duration_ms: durationMs },
        });
      },
      onToolFailed: (event) => {
        const capability = event.result ? toolResultCapability(event.result) : callbackToolCapability(event.call);
        const risk = event.result ? toolResultRisk(event.result, capability) : workflowRiskLevel(capability);
        const durationMs = event.result ? toolResultDuration(event.result, toolStartedAt.get(event.call.id)) : elapsedToolDuration(toolStartedAt.get(event.call.id));
        append({
          event_type: 'tool.failed',
          item_type: 'tool_run',
          item_id: event.call.id,
          status: 'failed',
          source: 'tool',
          visibility: 'tool',
          risk_level: risk,
          duration_ms: durationMs,
          error: event.error || event.result?.output,
          snapshot: event.result?.output,
          payload: { call_id: event.call.id, capability, tool_name: event.call.name, step: event.step, risk, side_effect_level: event.result ? toolResultSideEffect(event.result, capability) : sideEffectLevelForCapability(capability), duration_ms: durationMs },
        });
      },
      onApprovalRequired: (event) => {
        const capability = toolResultCapability(event.result);
        const risk = toolResultRisk(event.result, capability);
        const durationMs = toolResultDuration(event.result, toolStartedAt.get(event.call.id));
        append({
          event_type: 'tool.approval_required',
          item_type: 'tool_run',
          item_id: event.call.id,
          status: 'waiting_confirmation',
          source: 'tool',
          visibility: 'approval',
          risk_level: risk,
          duration_ms: durationMs,
          snapshot: event.result.output,
          payload: { call_id: event.call.id, capability, tool_name: event.call.name, step: event.step, risk, side_effect_level: toolResultSideEffect(event.result, capability), duration_ms: durationMs },
        });
      },
      onUsage: (event) => {
        const normalizedUsage = canonicalModelUsage(event.usage);
        const costEstimate = this.estimateModelUsageCost(started.provider, started.model_name, normalizedUsage);
        this.exec(
          `UPDATE model_calls
           SET input_tokens=?, output_tokens=?, cached_input_tokens=?, cache_write_input_tokens=?,
               reasoning_tokens=?, total_tokens=?, cost_estimate=?, usage_status=?,
               metadata=json_set(COALESCE(metadata, '{}'), '$.usage_status', ?, '$.estimated_cost', ?)
           WHERE id=?`,
          normalizedUsage.input_tokens,
          normalizedUsage.output_tokens,
          normalizedUsage.cached_input_tokens,
          normalizedUsage.cache_write_input_tokens,
          normalizedUsage.reasoning_tokens,
          normalizedUsage.total_tokens,
          roundCost(costEstimate),
          event.usage_status,
          event.usage_status,
          roundCost(costEstimate),
          started.model_call_id,
        );
        append({
          event_type: 'usage.recorded',
          item_type: 'model',
          item_id: started.model_call_id,
          status: event.usage_status,
          source: 'model_provider',
          visibility: 'trace_only',
          usage: normalizedUsage,
          payload: { step: event.step, usage_status: event.usage_status, estimated_cost: roundCost(costEstimate) },
        });
      },
      onRetry: (event) => {
        append({
          event_type: 'model.retry',
          item_type: 'model_call',
          item_id: started.model_call_id,
          status: 'retrying',
          source: 'runtime',
          visibility: 'transcript',
          error: event.error,
          payload: { step: event.step, attempt: event.attempt, delay_ms: event.delay_ms },
        });
      },
      onError: (event) => {
        append({
          event_type: 'runtime.error',
          item_type: 'model_call',
          item_id: started.model_call_id,
          status: 'failed',
          source: 'runtime',
          visibility: 'trace_only',
          error: event.error,
          payload: { step: event.step },
        });
      },
      onEvent: (event) => {
        if (!['work_summary.updated', 'plan.created', 'plan.updated'].includes(event.type)) return;
        const detail = event.detail || {};
        const phase = String(detail.phase || '').trim();
        const userVisible = detail.user_visible === true;
        append({
          event_type: event.type,
          item_type: event.type === 'work_summary.updated' ? 'work_summary' : 'plan',
          item_id: `${started.run_id}:${event.type}:${phase || event.step || 0}`,
          status: event.status || 'running',
          phase: phase || undefined,
          source: 'runtime',
          visibility: userVisible ? 'transcript' : 'trace_only',
          snapshot: detail,
          payload: {
            ...detail,
            step: event.step,
            attempt: event.attempt,
          },
        });
      },
    };
  }

  async sendDeterministicChat(req: ChatRequest, options: SendChatOptions = {}): Promise<ChatResponse> {
    const conversationID = req.conversation_id?.trim() || `conv_${newID()}`;
    const runID = `run_${newID()}`;
    const userMessageID = `msg_${newID()}`;
    const assistantMessageID = `msg_${newID()}`;
    const createdAt = nowIso();
    const message = req.message.trim();
    const plan = buildDeterministicRuntimePlan(req, message);
    const roomRoute = this.resolveRoomKernelRoute(req, conversationID, message);
    const selectedAgentID = options.selected_agent_id?.trim();
    if (selectedAgentID) {
      plan.agentID = selectedAgentID;
      plan.routeResult = { ...plan.routeResult, agent_id: selectedAgentID, route_source: 'caller' };
    } else if (roomRoute?.executor_persona_id) {
      plan.agentID = roomRoute.executor_persona_id;
      plan.routeResult = { ...plan.routeResult, room_kernel: routeResolutionForTrace(roomRoute) };
    } else if (roomRoute) {
      plan.routeResult = { ...plan.routeResult, room_kernel: routeResolutionForTrace(roomRoute) };
    }
    const capabilityExecution = await executePlannedCapability(plan, options.executeCapability);
    const response = capabilityExecution?.response || plan.response;
    const runtimeSteps = stepsWithCapabilityOutput(plan.extraSteps, capabilityExecution?.output);
    const title = titleFromMessage(message);
    const modelName = req.model_name?.trim() || 'deterministic-test-model';
    const memoryPackID = `mcp_${newID()}`;
    const promptAssemblyID = `pa_${newID()}`;
    const prefixHash = hashText('joi-electron-deterministic-prefix');
    const dynamicTailHash = hashText(message);
    const promptCacheKey = `${modelName}:${prefixHash}:${dynamicTailHash}`;
    const modeResolution = modeResolutionForRequest(req, message);
    const entryIdentity = entryIdentityForRequest(req, conversationID);

    this.transaction(() => {
      this.exec(
        `INSERT INTO conversations (id, principal_id, channel, user_id, title, active_agent_id, lifecycle_status, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET principal_id=COALESCE(conversations.principal_id, excluded.principal_id), title=COALESCE(conversations.title, excluded.title), updated_at=datetime('now')`,
        conversationID,
        entryIdentity.principal_id,
        req.channel || 'desktop',
        req.user_id || 'desktop_user',
        title,
        plan.agentID,
        json({ electron_native: true }),
      );
      this.linkChannelIdentity(entryIdentity, conversationID);

      this.exec(
        `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
         VALUES (?, ?, 'user', ?, ?, ?, datetime('now'))`,
        userMessageID,
        conversationID,
        message,
        json(Array.isArray(req.attachments) ? req.attachments : []),
        json({ source: 'electron_sqlite_store' }),
      );

      this.exec(
        `INSERT INTO models (id, provider, model_name, display_name, supports_json_mode, supports_tool_calling, enabled, metadata)
         VALUES (?, 'deterministic_provider', ?, ?, 1, 1, 1, ?)
         ON CONFLICT(id) DO UPDATE SET model_name=excluded.model_name, display_name=excluded.display_name, enabled=1, updated_at=datetime('now')`,
        modelName,
        modelName,
        modelName,
        json({ electron_native: true, observed_from_request: true }),
      );

      this.exec(
        `INSERT INTO runs (id, conversation_id, user_message_id, entry_channel, requested_mode, resolved_mode,
                           mode_source, principal_id, status, terminal_status, terminal_reason, selected_agent_id,
                           selected_model_id, selected_node_id, route_result, parent_run_id, redirected_from_run_id,
                           started_at, finished_at, duration_ms, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'completed', 'deterministic response completed',
                 ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), datetime('now'), datetime('now'), 0, ?, datetime('now'))`,
        runID,
        conversationID,
        userMessageID,
        req.channel || 'desktop',
        modeResolution.requested_mode,
        modeResolution.resolved_mode,
        modeResolution.mode_source,
        entryIdentity.principal_id,
        plan.agentID,
        modelName,
        plan.selectedNodeID,
        json(plan.routeResult),
        req.parent_run_id || '',
        req.redirected_from_run_id || '',
        json({ runtime_mode: req.runtime_mode || 'tool_calling', input_mode: req.input_mode || 'auto', mode_resolution: modeResolution }),
      );

      this.exec(
        `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
         VALUES (?, ?, 'assistant', ?, '[]', ?, datetime('now'))`,
        assistantMessageID,
        conversationID,
        response,
        json({ run_id: runID, source: 'electron_sqlite_store' }),
      );

      const events = this.deterministicRunEvents(runID, response, createdAt, modeResolution);
      for (const event of events) {
        this.appendRunEventV2({
          id: event.id,
          run_id: runID,
          seq: event.seq,
          event_type: event.event_type,
          status: event.status,
          source: 'store',
          visibility: optionalString(event.payload?.visibility),
          delta: event.delta,
          payload: event.payload || {},
          created_at: event.created_at,
          terminal: event.terminal,
        });
      }
      this.exec(
        `INSERT INTO memory_context_packs (id, run_id, agent_id, memory_profile_version, profile, project_facts, relevant_episodes, heuristics, anti_patterns, open_issues, dynamic_retrieval, metadata)
         VALUES (?, ?, ?, 'electron_deterministic_v1', '[]', '[]', '[]', '[]', '[]', '[]', '[]', ?)`,
        memoryPackID,
        runID,
        plan.agentID,
        json({ source: 'electron_sqlite_deterministic' }),
      );
      for (let index = 1; index < plan.memoryContextPackCount; index++) {
        this.exec(
          `INSERT INTO memory_context_packs (id, run_id, agent_id, memory_profile_version, profile, project_facts, relevant_episodes, heuristics, anti_patterns, open_issues, dynamic_retrieval, metadata)
           VALUES (?, ?, ?, 'electron_deterministic_v1', '[]', '[]', '[]', '[]', '[]', '[]', '[]', ?)`,
          `mcp_${newID()}`,
          runID,
          plan.agentID,
          json({ source: 'electron_sqlite_deterministic', turn: index + 1 }),
        );
      }

      this.exec(
        `INSERT INTO prompt_assemblies (id, run_id, agent_id, model_id, memory_context_pack_id, cacheable_prefix, dynamic_tail, prefix_hash, dynamic_tail_hash, prompt_cache_key, memory_profile_version, tool_schema_version, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'electron_deterministic_v1', 'tool_schema_v1', ?)`,
        promptAssemblyID,
        runID,
        plan.agentID,
        modelName,
        memoryPackID,
        'Joi Electron deterministic runtime prompt prefix',
        message,
        prefixHash,
        dynamicTailHash,
        promptCacheKey,
        json({ source: 'electron_sqlite_deterministic' }),
      );
      for (let index = 1; index < plan.promptAssemblyCount; index++) {
        this.exec(
          `INSERT INTO prompt_assemblies (id, run_id, agent_id, model_id, memory_context_pack_id, cacheable_prefix, dynamic_tail, prefix_hash, dynamic_tail_hash, prompt_cache_key, memory_profile_version, tool_schema_version, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'electron_deterministic_v1', 'tool_schema_v1', ?)`,
          `pa_${newID()}`,
          runID,
          plan.agentID,
          modelName,
          memoryPackID,
          'Joi Electron deterministic runtime prompt prefix',
          `${message}\nturn=${index + 1}`,
          prefixHash,
          hashText(`${message}:${index + 1}`),
          `${promptCacheKey}:${index + 1}`,
          json({ source: 'electron_sqlite_deterministic', turn: index + 1 }),
        );
      }

      const steps = [
        ['input_received', 'Input received', { message }, {}],
        ['router_selected', 'Router selected agent', { message }, { agent_id: plan.agentID, route: 'electron_sqlite_deterministic' }],
        ['prompt_assembled', 'Prompt assembly finished', { run_id: runID, agent_id: plan.agentID }, { prompt_assembly_id: promptAssemblyID, prefix_hash: prefixHash, dynamic_tail_hash: dynamicTailHash, prompt_cache_key: promptCacheKey, memory_profile_version: 'electron_deterministic_v1', tool_schema_version: 'tool_schema_v1' }],
        ['model_call_finished', 'Model call finished', { agent_id: plan.agentID, model_id: modelName, prompt_assembly_id: promptAssemblyID }, { provider: 'deterministic_provider', model: modelName, deterministic_runtime: true, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, latency_ms: 0 }],
        ['agent_output_parsed', 'Agent output parsed', { turn: 1 }, { repaired: false, output_type: 'final_answer' }],
        ...runtimeSteps,
        ['response_generated', 'Response generated', {}, { response }],
      ] as const;
      for (const [stepType, stepTitle, input, output] of steps) {
        this.exec(
          `INSERT INTO run_steps (id, run_id, step_type, title, status, input, output, started_at, finished_at, duration_ms, created_at)
           VALUES (?, ?, ?, ?, 'succeeded', ?, ?, datetime('now'), datetime('now'), 0, datetime('now'))`,
          `step_${newID()}`,
          runID,
          stepType,
          stepTitle,
          json(input),
          json(output),
        );
      }

      this.exec(
        `INSERT INTO model_calls (id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name, prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, output_tokens, cached_input_tokens, latency_ms, status, raw_response, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, 'deterministic_provider', ?, ?, ?, ?, 0, 0, 0, 0, 'succeeded', ?, ?, datetime('now'))`,
        `mcall_${newID()}`,
        runID,
        plan.agentID,
        modelName,
        promptAssemblyID,
        modelName,
        promptCacheKey,
        prefixHash,
        dynamicTailHash,
        json({ response }),
        json({ source: 'electron_sqlite_deterministic' }),
      );
      for (let index = 1; index < plan.modelCallCount; index++) {
        this.exec(
          `INSERT INTO model_calls (id, run_id, agent_id, model_id, provider, model_name, input_tokens, output_tokens, cached_input_tokens, latency_ms, status, raw_response, metadata, created_at)
           VALUES (?, ?, ?, ?, 'deterministic_provider', ?, 0, 0, 0, 0, 'succeeded', ?, ?, datetime('now'))`,
          `mcall_${newID()}`,
          runID,
          plan.agentID,
          modelName,
          modelName,
          json({ response, turn: index + 1 }),
          json({ source: 'electron_sqlite_deterministic', turn: index + 1 }),
        );
      }
      const productTaskID = this.applyDeterministicRuntimeArtifacts(plan, runID, conversationID, userMessageID, modelName, modeResolution.resolved_mode, response, entryIdentity, req, capabilityExecution?.output);
      this.linkTaskEntryIfNeeded(entryIdentity, conversationID, productTaskID, handoffReasonForRequest(req, entryIdentity));
      this.appendCrossEntryHandoffEvent(runID, '', entryIdentity, req, productTaskID || undefined);
      this.recordRoomRoutingDecision(req, {
        conversation_id: conversationID,
        message_id: userMessageID,
        run_id: runID,
        agent_id: plan.agentID,
        route_result: plan.routeResult,
        room_route: roomRoute,
      });
    });

    return {
      conversation_id: conversationID,
      user_message_id: userMessageID,
      assistant_message_id: assistantMessageID,
      run_id: runID,
      selected_agent_id: plan.agentID,
      response,
      ui: {
        interaction_class: 'chat',
        requires_user_input: false,
        inline_execution: false,
      },
      model_calls: [],
    };
  }

  assembleToolCallingPrompt(req: ChatRequest, agentID: string, modelName: string, toolSchemaVersion = 'tool_schema_v1'): ToolCallingPromptAssembly {
    const cleanAgentID = agentID.trim() || agentIDForMessage(req.message || '');
    const cleanModelName = modelName.trim() || req.model_name?.trim() || 'model';
    const agent = this.get(
      `SELECT id, name, description, system_prompt, capabilities
       FROM agents
       WHERE id=?`,
      cleanAgentID,
    );
    const agentCapabilities = normalizeAgentCapabilityList(parseArray(agent?.capabilities).map(String));
    const memoryScope = this.resolveMemoryRetrievalScope(req);
    const memoryControls = this.effectiveMemoryControls(req);
    const stableMemoryResults = memoryControls.use_memories ? this.stableMemoryProfile(memoryScope) : [];
    const dynamicMemoryResults = memoryControls.use_memories ? this.searchPromptMemories(req.message || '', 8, memoryScope) : [];
    const memoryResults = [...new Map(
      [...stableMemoryResults, ...dynamicMemoryResults].map((result) => [result.memory.id, result]),
    ).values()];
    const constitutionRow = this.get(
      `SELECT * FROM persona_constitutions WHERE status='active' ORDER BY version DESC LIMIT 1`,
    );
    const constitutionPrompt = optionalString(constitutionRow?.compiled_prompt)
      || compilePersonaConstitution(DEFAULT_JOI_PERSONA_CONSTITUTION);
    const constitutionVersion = Number(constitutionRow?.version || DEFAULT_JOI_PERSONA_CONSTITUTION.version);
    const memoryProfileVersion = `${memoryProfileVersionFor(stableMemoryResults)}:persona-v${constitutionVersion}`;
    const conversationContext = this.buildPromptConversationContext(req.conversation_id);
    const skillCandidates = this.skillSelectionCandidates();
    const skillCatalog = renderSkillCatalog(skillCandidates, 8_000);
    const skillSelectionMessage = isSkillFollowupMessage(req.message || '')
      ? `${conversationContext.messages.slice(-4).map((item) => item.content).join('\n')}\n${req.message || ''}`
      : req.message || '';
    const selectedSkills = selectCodexSkills(skillSelectionMessage, skillCandidates, {
      max_selected: 3,
      max_total_instruction_chars: 96_000,
    });
    const selectedSkillInstructions = renderSelectedSkillInstructions(selectedSkills);
    const cacheablePrefix = [
      'Joi Electron Tool Calling Runtime — execution policy outside Persona Constitution',
      '- You are running inside the local Electron-native Joi Desktop app. This is execution context, not personal identity, occupation, personality, or relationship.',
      '- Your product identity is Joi. Personal identity and relationship come from the user-authored Persona Constitution below; do not replace them with runtime labels such as assistant, tool, or execution partner.',
      `- The selected model id for this run is ${cleanModelName}. When asked what model is being used, answer from this selected model id.`,
      '- Do not claim to be Claude, ChatGPT, Anthropic, OpenAI, or another assistant brand unless the selected model id explicitly says so.',
      '- Use only the provided capability tools. Do not claim that a tool ran unless a tool result is present.',
      '- When one independent bounded subtask clearly benefits from a specialist, proactively call delegate_task once; the child gets a separate run and cannot delegate recursively.',
      '- Use session_branch when the user wants to explore an alternate path without altering the source transcript.',
      '- Use session_compact only with a faithful self-contained checkpoint summary; compaction must preserve the original transcript.',
      '- Use native LSP and debugger capabilities for code navigation and debugging when available instead of simulating their output.',
      '- Treat generated speech, transcription, and video as complete only when the capability returns a verified local artifact or transcript.',
      '- Never request Docker/Postgres/NATS as a default prerequisite for this local desktop app.',
      '- For workspace writes, wait for confirmation before execution.',
      '- Treat the Current Run current_date as authoritative for all relative-date, release-date, schedule, and news comparisons.',
      '- Treat web search result snippets as unverified summaries until an official page or fetched page content confirms them.',
      '- The latest user message is authoritative. Earlier turn-specific wording, exact-output formats, line counts, test tokens, and tool restrictions expire after that turn unless the latest user message explicitly repeats them.',
      '- Never continue a previous fixed answer such as RESULT=4 merely because it appears in conversation history; answer the latest request normally.',
      '- Keep ordinary chat replies concise by default. Prefer the fewest sentences that answer the user directly.',
      '- Do not proactively add emoji, decorative symbols, or celebratory icons to assistant replies. Only include emoji when the user explicitly asks to discuss, quote, transform, or generate emoji content.',
      '',
      'Persona Constitution — user-authored hard memory, always active and excluded from automatic decay or retrieval ranking',
      constitutionPrompt,
      '',
      'Agent',
      `id: ${cleanAgentID}`,
      `name: ${optionalString(agent?.name) || cleanAgentID}`,
      `description: ${optionalString(agent?.description) || ''}`,
      `system_prompt: ${optionalString(agent?.system_prompt) || ''}`,
      `capabilities: ${json(agentCapabilities)}`,
      '',
      'Stable Memory Profile',
      `version: ${memoryProfileVersion}`,
      `confirmed_memory_count: ${stableMemoryResults.length}`,
      `use_memories: ${memoryControls.use_memories}`,
      JSON.stringify(stableMemoryResults.map(memoryPromptItem)),
      '',
      'Tool Schema Version',
      toolSchemaVersion,
      '',
      skillCatalog,
    ].join('\n');
    const dynamicTail = [
      'Current Run',
      `channel: ${req.channel || 'desktop'}`,
      `input_mode: ${req.input_mode || 'auto'}`,
      `permission_profile: ${req.permission_profile || 'read_only'}`,
      ...runtimeDateContextLines(),
      ...(conversationContext.prompt ? [
        '',
        'Conversation Context',
        conversationContext.prompt,
      ] : []),
      '',
      'User Message',
      req.message || '',
      ...(selectedSkillInstructions ? ['', selectedSkillInstructions] : []),
      '',
      'Dynamic Memory Retrieval',
      JSON.stringify(dynamicMemoryResults.map(memoryPromptItem)),
    ].join('\n');
    const prefixHash = hashText(cacheablePrefix);
    const dynamicTailHash = hashText(dynamicTail);
    return {
      cacheable_prefix: cacheablePrefix,
      dynamic_tail: dynamicTail,
      prefix_hash: prefixHash,
      dynamic_tail_hash: dynamicTailHash,
      prompt_cache_key: `${cleanAgentID}:${cleanModelName}:${prefixHash}:${memoryProfileVersion}:${toolSchemaVersion}`,
      memory_profile_version: memoryProfileVersion,
      tool_schema_version: toolSchemaVersion,
      memory_results: memoryResults,
      stable_memory_results: stableMemoryResults,
      dynamic_memory_results: dynamicMemoryResults,
      memory_controls: memoryControls,
      memory_scope: memoryScope,
      conversation_messages: conversationContext.messages,
      agent_capabilities: agentCapabilities,
      skill_catalog: skillCatalog,
      selected_skills: selectedSkills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        path: skill.path,
        invocation: skill.invocation,
        score: skill.score,
      })),
      system_message: `${cacheablePrefix}\n\n${dynamicTail}`,
    };
  }

  getAgentCapabilities(agentID: string): string[] {
    const cleanAgentID = agentID.trim();
    if (!cleanAgentID) return [];
    const row = this.get(`SELECT capabilities FROM agents WHERE id=? AND enabled=1`, cleanAgentID);
    return normalizeAgentCapabilityList(parseArray(row?.capabilities).map(String));
  }

  resolveAgentIDForTool(requestedAgent: string, fallbackAgentID = 'research_agent'): string {
    const rows = this.all(`SELECT id, name FROM agents WHERE enabled=1 ORDER BY id`);
    const requested = requestedAgent.trim();
    const fallback = fallbackAgentID.trim();
    const normalized = normalizeAgentLookupToken(requested);
    const withoutAgentSuffix = normalized.replace(/agent$/, '');
    const matched = requested ? rows.find((row) => {
      const id = optionalString(row.id) || '';
      const name = optionalString(row.name) || '';
      if (id === requested || name.toLowerCase() === requested.toLowerCase()) return true;
      const normalizedID = normalizeAgentLookupToken(id);
      const normalizedName = normalizeAgentLookupToken(name);
      return normalizedID === normalized
        || normalizedName === normalized
        || normalizedID.replace(/agent$/, '') === withoutAgentSuffix
        || normalizedName.replace(/agent$/, '') === withoutAgentSuffix;
    }) : undefined;
    if (matched) return optionalString(matched.id) || '';
    return rows.some((row) => optionalString(row.id) === fallback) ? fallback : '';
  }

  branchConversationForTool(input: {
    source_conversation_id: string;
    from_message_id?: string;
    title?: string;
    source_run_id?: string;
  }): {
    source_conversation_id: string;
    child_conversation_id: string;
    from_message_id: string;
    copied_message_count: number;
    source_message_count: number;
    source_unchanged: true;
  } {
    const sourceConversationID = input.source_conversation_id.trim();
    if (!sourceConversationID) throw new Error('source conversation id is required');
    const source = this.get(`SELECT * FROM conversations WHERE id=?`, sourceConversationID);
    if (!source) throw new Error(`Conversation not found: ${sourceConversationID}`);
    const requestedMessageID = input.from_message_id?.trim() || '';
    let cutoffRowID = Number.MAX_SAFE_INTEGER;
    let fromMessageID = requestedMessageID;
    if (requestedMessageID) {
      const cutoff = this.get(
        `SELECT rowid, id FROM messages WHERE conversation_id=? AND id=?`,
        sourceConversationID,
        requestedMessageID,
      );
      if (!cutoff) throw new Error(`Message ${requestedMessageID} is not part of conversation ${sourceConversationID}`);
      cutoffRowID = Number(cutoff.rowid);
    } else {
      const cutoff = this.get(
        `SELECT rowid, id FROM messages WHERE conversation_id=? ORDER BY rowid DESC LIMIT 1`,
        sourceConversationID,
      );
      cutoffRowID = Number(cutoff?.rowid ?? 0);
      fromMessageID = optionalString(cutoff?.id) || '';
    }
    const sourceMessageCount = Number(this.get(`SELECT COUNT(*) AS count FROM messages WHERE conversation_id=?`, sourceConversationID)?.count ?? 0);
    const messages = this.all(
      `SELECT id, role, content, attachments, metadata, created_at
       FROM messages
       WHERE conversation_id=? AND rowid<=?
       ORDER BY rowid`,
      sourceConversationID,
      cutoffRowID,
    );
    const childConversationID = `conv_${newID()}`;
    const branchID = `branch_${newID()}`;
    const childTitle = input.title?.trim() || `${optionalString(source.title) || '会话'} · 分支`;
    const sourceMetadata = parseObject(source.metadata);
    this.transaction(() => {
      this.exec(
        `INSERT INTO conversations (
           id, principal_id, channel, user_id, title, active_agent_id, active_project_id, topic,
           lifecycle_status, group_id, pinned, metadata, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, datetime('now'), datetime('now'))`,
        childConversationID,
        optionalString(source.principal_id) || null,
        optionalString(source.channel) || 'desktop',
        optionalString(source.user_id) || 'desktop_user',
        childTitle,
        optionalString(source.active_agent_id) || null,
        optionalString(source.active_project_id) || null,
        optionalString(source.topic) || null,
        optionalString(source.group_id) || null,
        json({
          ...sourceMetadata,
          branch: {
            parent_conversation_id: sourceConversationID,
            from_message_id: fromMessageID,
            branch_id: branchID,
          },
        }),
      );
      for (const message of messages) {
        const sourceMessageID = optionalString(message.id) || '';
        this.exec(
          `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          `msg_${newID()}`,
          childConversationID,
          optionalString(message.role) || 'message',
          optionalString(message.content) || '',
          optionalString(message.attachments) || '[]',
          json({
            ...parseObject(message.metadata),
            branched_from_conversation_id: sourceConversationID,
            branched_from_message_id: sourceMessageID,
          }),
          optionalString(message.created_at) || nowIso(),
        );
      }
      this.exec(
        `INSERT INTO conversation_branches (
           id, parent_conversation_id, child_conversation_id, from_message_id,
           source_run_id, copied_message_count, metadata, created_at
         ) VALUES (?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, datetime('now'))`,
        branchID,
        sourceConversationID,
        childConversationID,
        fromMessageID,
        input.source_run_id?.trim() || '',
        messages.length,
        json({ source_message_count: sourceMessageCount, source_unchanged: true }),
      );
    });
    return {
      source_conversation_id: sourceConversationID,
      child_conversation_id: childConversationID,
      from_message_id: fromMessageID,
      copied_message_count: messages.length,
      source_message_count: sourceMessageCount,
      source_unchanged: true,
    };
  }

  compactConversationForTool(input: {
    conversation_id: string;
    summary: string;
    keep_recent_messages?: number;
    reason?: string;
    source_run_id?: string;
  }): {
    compaction_id: string;
    conversation_id: string;
    summary: string;
    first_kept_message_id: string;
    covered_message_count: number;
    original_message_count: number;
    original_char_count: number;
    compacted_context_char_count: number;
    transcript_preserved: true;
  } {
    const conversationID = input.conversation_id.trim();
    const summary = input.summary.trim();
    if (!conversationID) throw new Error('conversation id is required');
    if (!summary) throw new Error('compaction summary is required');
    if (summary.length > 30_000) throw new Error('compaction summary exceeds 30000 characters');
    if (!this.get(`SELECT id FROM conversations WHERE id=?`, conversationID)) {
      throw new Error(`Conversation not found: ${conversationID}`);
    }
    const keepRecentMessages = Math.max(2, Math.min(12, Math.round(input.keep_recent_messages || 6)));
    const recentRows = this.all(
      `SELECT id, content FROM messages WHERE conversation_id=? ORDER BY rowid DESC LIMIT ?`,
      conversationID,
      keepRecentMessages,
    ).reverse();
    if (recentRows.length === 0) throw new Error('conversation has no messages to compact');
    const originalMessageCount = Number(this.get(`SELECT COUNT(*) AS count FROM messages WHERE conversation_id=?`, conversationID)?.count ?? 0);
    const originalCharCount = Number(this.get(`SELECT COALESCE(SUM(length(content)), 0) AS count FROM messages WHERE conversation_id=?`, conversationID)?.count ?? 0);
    const firstKeptMessageID = optionalString(recentRows[0]?.id) || '';
    const coveredMessageCount = Math.max(0, originalMessageCount - recentRows.length);
    const compactedContextCharCount = summary.length + recentRows.reduce((total, row) => total + (optionalString(row.content) || '').length, 0);
    const compactionID = `compact_${newID()}`;
    this.exec(
      `INSERT INTO conversation_compactions (
         id, conversation_id, source_run_id, summary, first_kept_message_id,
         covered_message_count, original_message_count, original_char_count,
         compacted_context_char_count, reason, metadata, created_at
       ) VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      compactionID,
      conversationID,
      input.source_run_id?.trim() || '',
      summary,
      firstKeptMessageID,
      coveredMessageCount,
      originalMessageCount,
      originalCharCount,
      compactedContextCharCount,
      input.reason?.trim() || 'model_requested',
      json({ transcript_preserved: true, keep_recent_messages: keepRecentMessages }),
    );
    return {
      compaction_id: compactionID,
      conversation_id: conversationID,
      summary,
      first_kept_message_id: firstKeptMessageID,
      covered_message_count: coveredMessageCount,
      original_message_count: originalMessageCount,
      original_char_count: originalCharCount,
      compacted_context_char_count: compactedContextCharCount,
      transcript_preserved: true,
    };
  }

  getConversationTree(conversationID: string): ConversationTree {
    const activeConversationID = conversationID.trim();
    if (!activeConversationID) throw new Error('conversation id is required');
    if (!this.get(`SELECT id FROM conversations WHERE id=?`, activeConversationID)) {
      throw new Error(`Conversation not found: ${activeConversationID}`);
    }
    let rootConversationID = activeConversationID;
    const seenAncestors = new Set<string>();
    for (let depth = 0; depth < 100; depth += 1) {
      if (seenAncestors.has(rootConversationID)) throw new Error('Conversation branch cycle detected');
      seenAncestors.add(rootConversationID);
      const parent = this.get(`SELECT parent_conversation_id FROM conversation_branches WHERE child_conversation_id=?`, rootConversationID);
      const parentID = optionalString(parent?.parent_conversation_id) || '';
      if (!parentID) break;
      rootConversationID = parentID;
    }

    const branchRows = this.all(`SELECT * FROM conversation_branches ORDER BY datetime(created_at), rowid`);
    const childrenByParent = new Map<string, SQLiteRow[]>();
    for (const branch of branchRows) {
      const parentID = optionalString(branch.parent_conversation_id) || '';
      const children = childrenByParent.get(parentID) || [];
      children.push(branch);
      childrenByParent.set(parentID, children);
    }
    const reachable: string[] = [];
    const queue = [rootConversationID];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const id = queue.shift() || '';
      if (!id || visited.has(id)) continue;
      visited.add(id);
      reachable.push(id);
      for (const branch of childrenByParent.get(id) || []) {
        const childID = optionalString(branch.child_conversation_id) || '';
        if (childID) queue.push(childID);
      }
    }
    const placeholders = reachable.map(() => '?').join(',');
    const conversations = this.all(
      `SELECT c.*,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id) AS message_count
       FROM conversations c WHERE c.id IN (${placeholders})`,
      ...reachable,
    );
    const conversationByID = new Map(conversations.map((row) => [optionalString(row.id) || '', row]));
    const branchByChild = new Map(branchRows.map((row) => [optionalString(row.child_conversation_id) || '', row]));
    const compactionByConversation = new Map<string, SQLiteRow>();
    for (const id of reachable) {
      const latest = this.get(
        `SELECT * FROM conversation_compactions WHERE conversation_id=? ORDER BY datetime(created_at) DESC, rowid DESC LIMIT 1`,
        id,
      );
      if (latest) compactionByConversation.set(id, latest);
    }
    const buildNode = (id: string, stack: Set<string>): ConversationTreeNode => {
      if (stack.has(id)) throw new Error('Conversation branch cycle detected');
      const row = conversationByID.get(id);
      if (!row) throw new Error(`Conversation tree row missing: ${id}`);
      const nextStack = new Set(stack).add(id);
      const metadata = parseObject(row.metadata);
      const workbench = parseObject(metadata.workbench);
      const branch = branchByChild.get(id);
      const children = (childrenByParent.get(id) || []).map((item) => buildNode(optionalString(item.child_conversation_id) || '', nextStack));
      return {
        conversation_id: id,
        title: optionalString(row.title) || '未命名会话',
        label: optionalString(workbench.label),
        summary: optionalString(workbench.summary),
        parent_conversation_id: optionalString(branch?.parent_conversation_id),
        branch_id: optionalString(branch?.id),
        from_message_id: optionalString(branch?.from_message_id),
        source_run_id: optionalString(branch?.source_run_id),
        copied_message_count: Number(branch?.copied_message_count || 0),
        message_count: Number(row.message_count || 0),
        child_count: children.length,
        active: id === activeConversationID,
        created_at: optionalString(row.created_at),
        updated_at: optionalString(row.updated_at),
        latest_compaction: compactionByConversation.has(id) ? rowToConversationCompaction(compactionByConversation.get(id) || {}) : undefined,
        children,
      };
    };
    return {
      root_conversation_id: rootConversationID,
      active_conversation_id: activeConversationID,
      node_count: reachable.length,
      root: buildNode(rootConversationID, new Set()),
    };
  }

  updateConversationBranch(input: { conversation_id: string; label?: string; summary?: string }): ConversationTree {
    const conversationID = input.conversation_id.trim();
    const row = this.get(`SELECT metadata FROM conversations WHERE id=?`, conversationID);
    if (!row) throw new Error(`Conversation not found: ${conversationID}`);
    const metadata = parseObject(row.metadata);
    const existing = parseObject(metadata.workbench);
    const workbench = {
      ...existing,
      ...(typeof input.label === 'string' ? { label: input.label.trim().slice(0, 80) } : {}),
      ...(typeof input.summary === 'string' ? { summary: input.summary.trim().slice(0, 4_000) } : {}),
    };
    this.exec(`UPDATE conversations SET metadata=?, updated_at=datetime('now') WHERE id=?`, json({ ...metadata, workbench }), conversationID);
    return this.getConversationTree(conversationID);
  }

  exportConversation(input: { conversation_id: string; path?: string }): ConversationExportResult {
    const tree = this.getConversationTree(input.conversation_id);
    const ids: string[] = [];
    const visit = (node: ConversationTreeNode) => {
      ids.push(node.conversation_id);
      node.children.forEach(visit);
    };
    visit(tree.root);
    const placeholders = ids.map(() => '?').join(',');
    const conversations = this.all(`SELECT * FROM conversations WHERE id IN (${placeholders}) ORDER BY datetime(created_at), rowid`, ...ids);
    const messages = this.all(`SELECT * FROM messages WHERE conversation_id IN (${placeholders}) ORDER BY datetime(created_at), rowid`, ...ids);
    const branches = this.all(`SELECT * FROM conversation_branches WHERE parent_conversation_id IN (${placeholders}) ORDER BY datetime(created_at), rowid`, ...ids);
    const compactions = this.all(`SELECT * FROM conversation_compactions WHERE conversation_id IN (${placeholders}) ORDER BY datetime(created_at), rowid`, ...ids);
    const requestedPath = input.path?.trim();
    const exportDir = join(this.options.backupDir, 'conversation-exports');
    mkdirSync(exportDir, { recursive: true });
    const path = requestedPath && isAbsolute(requestedPath)
      ? requestedPath
      : join(exportDir, `${tree.root_conversation_id}-${Date.now()}.joi-conversation.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({
      format: 'joi.conversation-tree.v1',
      exported_at: nowIso(),
      active_conversation_id: tree.active_conversation_id,
      root_conversation_id: tree.root_conversation_id,
      conversations,
      messages,
      branches,
      compactions,
    }, null, 2), 'utf8');
    return { path, conversation_id: tree.root_conversation_id, branch_count: branches.length, message_count: messages.length };
  }

  importConversation(input: { path: string }): ConversationImportResult {
    const path = input.path?.trim();
    if (!path || !isAbsolute(path)) throw new Error('An absolute conversation export path is required');
    const document = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (document.format !== 'joi.conversation-tree.v1') throw new Error('Unsupported Joi conversation export format');
    const conversations = Array.isArray(document.conversations) ? document.conversations.filter(isSQLiteRow) : [];
    const messages = Array.isArray(document.messages) ? document.messages.filter(isSQLiteRow) : [];
    const branches = Array.isArray(document.branches) ? document.branches.filter(isSQLiteRow) : [];
    const compactions = Array.isArray(document.compactions) ? document.compactions.filter(isSQLiteRow) : [];
    if (conversations.length === 0) throw new Error('Conversation export contains no conversations');
    const conversationIDs = new Map<string, string>();
    const messageIDs = new Map<string, string>();
    for (const row of conversations) conversationIDs.set(optionalString(row.id) || '', `conv_${newID()}`);
    for (const row of messages) messageIDs.set(optionalString(row.id) || '', `msg_${newID()}`);
    this.transaction(() => {
      for (const row of conversations) {
        const oldID = optionalString(row.id) || '';
        const newConversationID = conversationIDs.get(oldID) || `conv_${newID()}`;
        this.exec(
          `INSERT INTO conversations (
             id, principal_id, channel, user_id, title, active_agent_id, active_project_id, topic,
             lifecycle_status, group_id, pinned, metadata, created_at, updated_at
           ) VALUES (?, NULL, ?, ?, ?, ?, NULL, ?, 'active', NULL, 0, ?, datetime('now'), datetime('now'))`,
          newConversationID,
          optionalString(row.channel) || 'desktop',
          optionalString(row.user_id) || 'desktop_user',
          `${optionalString(row.title) || '导入会话'} · 导入`,
          optionalString(row.active_agent_id) || null,
          optionalString(row.topic) || null,
          json({ ...parseObject(row.metadata), imported_from: oldID, imported_at: nowIso() }),
        );
      }
      for (const row of messages) {
        const oldID = optionalString(row.id) || '';
        const oldConversationID = optionalString(row.conversation_id) || '';
        const newConversationID = conversationIDs.get(oldConversationID);
        if (!newConversationID) continue;
        this.exec(
          `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          messageIDs.get(oldID) || `msg_${newID()}`,
          newConversationID,
          optionalString(row.role) || 'message',
          optionalString(row.content) || '',
          optionalString(row.attachments) || '[]',
          json({ ...parseObject(row.metadata), imported_message_id: oldID }),
          optionalString(row.created_at) || nowIso(),
        );
      }
      for (const row of branches) {
        const parentID = conversationIDs.get(optionalString(row.parent_conversation_id) || '');
        const childID = conversationIDs.get(optionalString(row.child_conversation_id) || '');
        if (!parentID || !childID) continue;
        this.exec(
          `INSERT INTO conversation_branches (
             id, parent_conversation_id, child_conversation_id, from_message_id, source_run_id,
             copied_message_count, metadata, created_at
           ) VALUES (?, ?, ?, NULLIF(?, ''), NULL, ?, ?, datetime('now'))`,
          `branch_${newID()}`,
          parentID,
          childID,
          messageIDs.get(optionalString(row.from_message_id) || '') || '',
          Number(row.copied_message_count || 0),
          json({ ...parseObject(row.metadata), imported_branch_id: optionalString(row.id) }),
        );
      }
      for (const row of compactions) {
        const newConversationID = conversationIDs.get(optionalString(row.conversation_id) || '');
        const keptMessageID = messageIDs.get(optionalString(row.first_kept_message_id) || '');
        if (!newConversationID || !keptMessageID) continue;
        this.exec(
          `INSERT INTO conversation_compactions (
             id, conversation_id, source_run_id, summary, first_kept_message_id, covered_message_count,
             original_message_count, original_char_count, compacted_context_char_count, reason, metadata, created_at
           ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          `compact_${newID()}`,
          newConversationID,
          optionalString(row.summary) || '',
          keptMessageID,
          Number(row.covered_message_count || 0),
          Number(row.original_message_count || 0),
          Number(row.original_char_count || 0),
          Number(row.compacted_context_char_count || 0),
          'imported',
          json({ ...parseObject(row.metadata), imported_compaction_id: optionalString(row.id) }),
        );
      }
    });
    const originalActiveID = optionalString(document.active_conversation_id) || optionalString(document.root_conversation_id) || optionalString(conversations[0]?.id) || '';
    const activeConversationID = conversationIDs.get(originalActiveID) || [...conversationIDs.values()][0];
    return {
      conversation_id: activeConversationID,
      imported_conversation_ids: [...conversationIDs.values()],
      message_count: messages.length,
    };
  }

  private ensureAutomaticConversationCompaction(conversationID: string): void {
    const totalCount = Number(this.get(`SELECT COUNT(*) AS count FROM messages WHERE conversation_id=?`, conversationID)?.count || 0);
    if (totalCount < 48) return;
    const latest = this.get(
      `SELECT original_message_count FROM conversation_compactions WHERE conversation_id=? ORDER BY datetime(created_at) DESC, rowid DESC LIMIT 1`,
      conversationID,
    );
    if (totalCount - Number(latest?.original_message_count || 0) < 24) return;
    const older = this.all(
      `SELECT role, content FROM messages WHERE conversation_id=? ORDER BY rowid LIMIT ?`,
      conversationID,
      Math.max(1, totalCount - 12),
    );
    const summaryLines = older.slice(-24).map((row) => `${optionalString(row.role) || 'message'}: ${compactPromptConversationText(optionalString(row.content) || '', 240)}`);
    const omitted = Math.max(0, older.length - summaryLines.length);
    const summary = [
      `Automatic checkpoint covering ${older.length} earlier message(s).`,
      ...(omitted > 0 ? [`${omitted} oldest message(s) remain in the transcript and are omitted from this compact summary.`] : []),
      ...summaryLines,
    ].join('\n');
    this.compactConversationForTool({
      conversation_id: conversationID,
      summary,
      keep_recent_messages: 12,
      reason: 'automatic_context_threshold',
    });
  }

  private buildPromptConversationContext(conversationID?: string): PromptConversationContext {
    const cleanConversationID = conversationID?.trim();
    if (!cleanConversationID) {
      return { prompt: '', included_count: 0, compressed_count: 0, omitted_count: 0, messages: [] };
    }
    this.ensureAutomaticConversationCompaction(cleanConversationID);
    const totalRow = this.get(`SELECT COUNT(*) AS count FROM messages WHERE conversation_id=?`, cleanConversationID);
    const totalCount = Number(totalRow?.count ?? 0);
    if (!Number.isFinite(totalCount) || totalCount <= 0) {
      return { prompt: '', included_count: 0, compressed_count: 0, omitted_count: 0, messages: [] };
    }
    const persistentCompaction = this.get(
      `SELECT * FROM conversation_compactions WHERE conversation_id=? ORDER BY datetime(created_at) DESC, rowid DESC LIMIT 1`,
      cleanConversationID,
    );
    const firstKeptMessageID = optionalString(persistentCompaction?.first_kept_message_id) || '';
    const rows = this.all(
      `SELECT role, content, COALESCE(json_extract(metadata, '$.run_id'), '') AS run_id
       FROM (
         SELECT role, content, metadata, created_at, rowid
         FROM messages
         WHERE conversation_id=?
           AND (? = '' OR rowid >= COALESCE((SELECT rowid FROM messages WHERE id=? AND conversation_id=?), 0))
         ORDER BY datetime(created_at) DESC, rowid DESC
         LIMIT ?
       )
       ORDER BY datetime(created_at) ASC, rowid ASC`,
      cleanConversationID,
      firstKeptMessageID,
      firstKeptMessageID,
      cleanConversationID,
      promptConversationContextLimit,
    );
    const messages: PromptConversationMessage[] = rows.map((row) => ({
      role: optionalString(row.role) || 'message',
      content: optionalString(row.content) || '',
      run_id: optionalString(row.run_id),
    })).filter((message) => message.content.trim());
    if (messages.length === 0) {
      return { prompt: '', included_count: 0, compressed_count: 0, omitted_count: Math.max(0, totalCount), messages: [] };
    }
    const persistentlyCompressedCount = Math.max(0, Number(persistentCompaction?.covered_message_count ?? 0));
    const omittedCount = Math.max(0, totalCount - persistentlyCompressedCount - messages.length);
    const compressedCount = Math.max(0, messages.length - promptConversationVerbatimLimit);
    const compressedMessages = messages.slice(0, compressedCount);
    const recentMessages = messages.slice(compressedCount);
    const sections: string[] = [];

    if (persistentCompaction) {
      sections.push([
        'Persistent Conversation Checkpoint',
        `compaction_id: ${optionalString(persistentCompaction.id)}`,
        `covered_message_count: ${persistentlyCompressedCount}`,
        compactPromptConversationText(optionalString(persistentCompaction.summary) || '', 12_000),
      ].join('\n'));
    }

    if (omittedCount > 0 || compressedMessages.length > 0) {
      const lines = [
        'Earlier Conversation Summary',
        `compressed_message_count: ${omittedCount + compressedMessages.length}`,
      ];
      if (omittedCount > 0) {
        lines.push(`- ${omittedCount} older message(s) are outside the compact prompt window but remain stored in this conversation.`);
      }
      for (const message of compressedMessages) {
        lines.push(formatPromptConversationLine(message, promptConversationSummaryLimit));
      }
      sections.push(lines.join('\n'));
    }

    if (recentMessages.length > 0) {
      sections.push([
        'Recent Conversation',
        ...recentMessages.map((message) => formatPromptConversationLine(message, promptConversationMessageLimit)),
      ].join('\n'));
    }

    return {
      prompt: sections.join('\n\n'),
      included_count: messages.length,
      compressed_count: persistentlyCompressedCount + omittedCount + compressedMessages.length,
      omitted_count: omittedCount,
      messages: recentMessages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: compactPromptConversationText(message.content, promptConversationMessageLimit),
        })),
    };
  }

  beginToolCallingChat(req: ChatRequest, params: {
    provider: string;
    model_name: string;
    model_base_url?: string;
    model_reasoning_effort?: string;
    model_selection_policy?: 'agent_preferred' | 'settings_preferred';
    model_route_purpose?: 'default' | 'child' | 'tool' | 'cheap' | 'long_context' | string;
    selected_agent_id?: string;
    prompt_assembly?: ToolCallingPromptAssembly;
  }): StartedToolCallingChat {
    const conversationID = req.conversation_id?.trim() || `conv_${newID()}`;
    const runID = `run_${newID()}`;
    const turnID = `turn_${newID()}`;
    const userMessageID = `msg_${newID()}`;
    const assistantMessageID = `msg_${newID()}`;
    const modelCallID = `mcall_${newID()}`;
    const memoryPackID = `mcp_${newID()}`;
    const promptAssemblyID = `pa_${newID()}`;
    const message = req.message.trim();
    const title = titleFromMessage(message);
    const roomRoute = this.resolveRoomKernelRoute(req, conversationID, message);
    const agentRoute = params.selected_agent_id?.trim()
      ? { agent_id: params.selected_agent_id.trim(), source: 'caller', reason: 'caller selected agent', confidence: 1 } satisfies AgentRouteResolution
      : this.resolveAgentRoute(conversationID, message, roomRoute?.executor_persona_id);
    const agentID = agentRoute.agent_id;
    const fallbackModelName = req.model_name?.trim() || params.model_name.trim() || 'model';
    const settingsModelEndpoint = {
      provider: params.provider.trim() || 'openai_compatible',
      model_name: fallbackModelName,
      base_url: params.model_base_url?.trim() || '',
      reasoning_effort: optionalReasoningEffort(params.model_reasoning_effort),
    };
    const modelEndpoint = params.model_selection_policy === 'settings_preferred'
      ? settingsModelEndpoint
      : this.modelEndpointForAgent(agentID, settingsModelEndpoint, params.model_route_purpose || 'default');
    const provider = modelEndpoint.provider;
    const modelName = modelEndpoint.model_name;
    const modelBaseURL = modelEndpoint.base_url;
    const modelReasoningEffort = modelEndpoint.reasoning_effort;
    const prompt = params.prompt_assembly || this.assembleToolCallingPrompt(req, agentID, modelName);
    const modeResolution = modeResolutionForRequest(req, message);
    const entryIdentity = entryIdentityForRequest(req, conversationID);
    let productTask: ProductTask | undefined;

    this.transaction(() => {
      this.exec(
        `INSERT INTO conversations (id, principal_id, channel, user_id, title, active_agent_id, lifecycle_status, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET principal_id=COALESCE(conversations.principal_id, excluded.principal_id), active_agent_id=excluded.active_agent_id, updated_at=datetime('now')`,
        conversationID,
        entryIdentity.principal_id,
        req.channel || 'desktop',
        req.user_id || 'desktop_user',
        title,
        agentID,
        json({ electron_native: true, runtime: 'ts_tool_calling' }),
      );
      this.linkChannelIdentity(entryIdentity, conversationID);
      this.exec(
        `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
         VALUES (?, ?, 'user', ?, ?, ?, datetime('now'))`,
        userMessageID,
        conversationID,
        message,
        json(Array.isArray(req.attachments) ? req.attachments : []),
        json({ source: 'electron_ts_tool_calling' }),
      );
      this.exec(
        `INSERT INTO models (id, provider, model_name, display_name, supports_json_mode, supports_tool_calling, enabled, metadata)
         VALUES (?, ?, ?, ?, 1, 1, 1, ?)
         ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, model_name=excluded.model_name, display_name=excluded.display_name, supports_tool_calling=1, enabled=1, updated_at=datetime('now')`,
        modelName,
        provider,
        modelName,
        modelName,
        json({ electron_native: true, observed_from_tool_calling: true }),
      );
      this.exec(
        `INSERT INTO runs (id, conversation_id, user_message_id, entry_channel, requested_mode, resolved_mode, mode_source,
                           principal_id, status, selected_agent_id, selected_model_id, selected_node_id, route_result,
                           parent_run_id, redirected_from_run_id, started_at, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, 'main-node', ?, NULLIF(?, ''), NULLIF(?, ''), datetime('now'), ?, datetime('now'))`,
        runID,
        conversationID,
        userMessageID,
        req.channel || 'desktop',
        modeResolution.requested_mode,
        modeResolution.resolved_mode,
        modeResolution.mode_source,
        entryIdentity.principal_id,
        agentID,
        modelName,
        json({ route: 'electron_ts_tool_calling', agent_id: agentID, agent_route: agentRoute, model: modelName, provider, reasoning_effort: modelReasoningEffort }),
        req.parent_run_id || '',
        req.redirected_from_run_id || '',
        json({ runtime_mode: 'tool_calling', input_mode: req.input_mode || 'auto', mode_resolution: modeResolution, source: 'electron_ts_tool_calling', live_cancellable: true, reasoning_effort: modelReasoningEffort }),
      );
      this.exec(
        `INSERT INTO turns (id, run_id, turn_index, status, mode_resolution_id, user_intent_summary, assistant_message_id,
                            stream_status, active_model_call_id, cancellation_key, started_at, metadata)
         VALUES (?, ?, 1, 'running', ?, ?, ?, 'mode_resolved', ?, ?, datetime('now'), ?)`,
        turnID,
        runID,
        modeResolution.id,
        message.slice(0, 500),
        assistantMessageID,
        modelCallID,
        `cancel_${runID}`,
        json({ runtime: 'electron_ts_tool_calling', mode_resolution: modeResolution, live_cancellable: true }),
      );
      this.insertRunEvent(runID, turnID, 1, 'run.started', { run_id: runID, conversation_id: conversationID, status: 'running', source: 'store', type: 'run.started' });
      this.insertRunEvent(runID, turnID, 2, 'run.mode_resolved', {
        run_id: runID,
        turn_id: turnID,
        conversation_id: conversationID,
        item_type: 'mode_resolution',
        item_id: modeResolution.id,
        status: 'completed',
        visibility: 'inline_status',
        source: 'store',
        requested_mode: modeResolution.requested_mode,
        resolved_mode: modeResolution.resolved_mode,
        contract_mode: contractMode(modeResolution.resolved_mode),
        mode_source: modeResolution.mode_source,
        mode_locked_by_user: modeResolution.mode_locked_by_user,
        reason: modeResolution.reason,
        confidence: modeResolution.confidence,
        type: 'run.mode_resolved',
      });
      this.insertRunEvent(runID, turnID, 3, 'turn.started', { run_id: runID, turn_id: turnID, status: 'running', source: 'store', type: 'turn.started' });
      productTask = this.ensureProductTaskForRun(req, {
        conversation_id: conversationID,
        user_message_id: userMessageID,
        run_id: runID,
        turn_id: turnID,
        mode_resolution_id: modeResolution.id,
        mode_resolution: modeResolution,
        message,
      });
      this.linkTaskEntryIfNeeded(entryIdentity, conversationID, productTask?.id, handoffReasonForRequest(req, entryIdentity));
      this.appendCrossEntryHandoffEvent(runID, turnID, entryIdentity, req, productTask?.id);
      this.exec(
        `INSERT INTO memory_context_packs (id, run_id, agent_id, memory_profile_version, profile, project_facts, relevant_episodes, heuristics, anti_patterns, open_issues, dynamic_retrieval, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', '[]', ?, ?)`,
        memoryPackID,
        runID,
        agentID,
        prompt.memory_profile_version,
        json(prompt.stable_memory_results || []),
        json((prompt.dynamic_memory_results || []).filter((result) => result.memory.layer === 'knowledge')),
        json((prompt.dynamic_memory_results || []).filter((result) => result.memory.layer === 'episode')),
        json(prompt.dynamic_memory_results || []),
        json({ source: 'electron_ts_tool_calling', pipeline_version: MEMORY_PIPELINE_VERSION, memory_result_count: prompt.memory_results?.length || 0, memory_scope: prompt.memory_scope, memory_controls: prompt.memory_controls }),
      );
      this.appendMemoryRecalledEvents(runID, turnID, memoryPackID, prompt.memory_results || [], prompt.memory_scope);
      this.recordMemoryRetrievalUsage(runID, agentID, prompt.memory_results || [], prompt.memory_scope);
      this.exec(
        `INSERT INTO prompt_assemblies (id, run_id, agent_id, model_id, memory_context_pack_id, cacheable_prefix, dynamic_tail, prefix_hash, dynamic_tail_hash, prompt_cache_key, memory_profile_version, tool_schema_version, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        promptAssemblyID,
        runID,
        agentID,
        modelName,
        memoryPackID,
        prompt.cacheable_prefix,
        prompt.dynamic_tail,
        prompt.prefix_hash,
        prompt.dynamic_tail_hash,
        prompt.prompt_cache_key,
        prompt.memory_profile_version,
        prompt.tool_schema_version,
        json({ source: 'electron_ts_tool_calling', memory_result_count: prompt.memory_results?.length || 0, memory_scope: prompt.memory_scope, selected_skills: prompt.selected_skills }),
      );
      this.insertRunStep(runID, 'input_received', 'Input received', { message }, { conversation_id: conversationID, message_id: userMessageID });
      this.insertRunStep(runID, 'router_selected', 'Router selected agent', { message }, { agent_id: agentID, route: 'electron_ts_tool_calling' });
      for (const skill of prompt.selected_skills) {
        this.insertRunStep(runID, 'skill_selected', 'Skill selected', { message, skill_id: skill.id }, skill);
      }
      if (prompt.selected_skills.length > 0) {
        this.insertRunStep(runID, 'skill_plan_generated', 'Skill instructions loaded', { skill_ids: prompt.selected_skills.map((skill) => skill.id) }, { progressive_disclosure: true, selected_skills: prompt.selected_skills });
      }
      this.insertRunStep(runID, 'prompt_assembled', 'Prompt assembly finished', { run_id: runID, agent_id: agentID }, { prompt_assembly_id: promptAssemblyID, prefix_hash: prompt.prefix_hash, dynamic_tail_hash: prompt.dynamic_tail_hash, prompt_cache_key: prompt.prompt_cache_key, memory_profile_version: prompt.memory_profile_version, tool_schema_version: prompt.tool_schema_version, memory_result_count: prompt.memory_results?.length || 0 });
      this.insertTurnItem(runID, turnID, 1, 'message', 'user', '', '', {}, message, {}, 'completed', { source: 'desktop_user' });
      this.recordRoomRoutingDecision(req, {
        conversation_id: conversationID,
        message_id: userMessageID,
        run_id: runID,
        agent_id: agentID,
        route_result: { route: 'electron_ts_tool_calling', agent_id: agentID, agent_route: agentRoute, model: modelName, provider, room_kernel: roomRoute ? routeResolutionForTrace(roomRoute) : undefined },
        room_route: roomRoute,
      });
      this.exec(
        `INSERT INTO model_calls (id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name,
                                  prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, output_tokens,
                                  cached_input_tokens, latency_ms, status, streaming_enabled, usage_status, raw_response, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'running', 1, 'provider_missing', '{}', ?, datetime('now'))`,
        modelCallID,
        runID,
        agentID,
        modelName,
        promptAssemblyID,
        provider,
        modelName,
        prompt.prompt_cache_key,
        prompt.prefix_hash,
        prompt.dynamic_tail_hash,
        json({ source: 'electron_ts_tool_calling', real_model: provider !== 'mock_provider', live_cancellable: true, reasoning_effort: modelReasoningEffort, input_tokens_include_cached: true }),
      );
    });

    return {
      conversation_id: conversationID,
      user_message_id: userMessageID,
      assistant_message_id: assistantMessageID,
      run_id: runID,
      turn_id: turnID,
      model_call_id: modelCallID,
      memory_pack_id: memoryPackID,
      prompt_assembly_id: promptAssemblyID,
      selected_agent_id: agentID,
      user_message: message,
      provider,
      model_name: modelName,
      model_base_url: modelBaseURL,
      model_reasoning_effort: modelReasoningEffort,
      memory_controls: prompt.memory_controls,
      prompt_assembly: prompt,
      product_task_id: productTask?.id,
      product_task: productTask,
    };
  }

  retargetToolCallingChat(
    started: StartedToolCallingChat,
    endpoint: { model_id?: string; provider: string; model_name: string; base_url?: string; reasoning_effort?: string; route_reason?: string },
    priorError: Error,
    attempt: number,
  ): StartedToolCallingChat {
    const modelID = endpoint.model_id?.trim() || endpoint.model_name.trim();
    const modelCallID = `mcall_${newID()}`;
    const errorMessage = priorError.message.slice(0, 2_000);
    this.transaction(() => {
      this.exec(
        `UPDATE model_calls SET status='failed', completed_at=datetime('now'), finish_reason='route_failover',
           error_code='MODEL_ROUTE_ATTEMPT_FAILED', error_message=?, metadata=json_set(COALESCE(metadata, '{}'), '$.failover_attempt', ?)
         WHERE id=? AND status IN ('pending', 'running')`,
        errorMessage,
        attempt,
        started.model_call_id,
      );
      this.exec(
        `INSERT INTO models (id, provider, model_name, display_name, base_url, supports_json_mode, supports_tool_calling, enabled, metadata)
         VALUES (?, ?, ?, ?, ?, 1, 1, 1, ?)
         ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, model_name=excluded.model_name,
           base_url=excluded.base_url, supports_tool_calling=1, enabled=1, updated_at=datetime('now')`,
        modelID,
        endpoint.provider,
        endpoint.model_name,
        endpoint.model_name,
        endpoint.base_url?.trim() || '',
        json({ observed_from_model_route: true }),
      );
      this.exec(
        `UPDATE runs SET selected_model_id=?, route_result=json_set(COALESCE(route_result, '{}'), '$.model_failover_attempt', ?, '$.model', ?, '$.provider', ?) WHERE id=?`,
        modelID,
        attempt,
        endpoint.model_name,
        endpoint.provider,
        started.run_id,
      );
      this.exec(`UPDATE turns SET active_model_call_id=? WHERE id=?`, modelCallID, started.turn_id);
      this.exec(`UPDATE prompt_assemblies SET model_id=? WHERE id=?`, modelID, started.prompt_assembly_id);
      this.exec(
        `INSERT INTO model_calls (id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name,
                                  prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, output_tokens,
                                  cached_input_tokens, latency_ms, status, streaming_enabled, usage_status, raw_response, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'running', 1, 'provider_missing', '{}', ?, datetime('now'))`,
        modelCallID,
        started.run_id,
        started.selected_agent_id,
        modelID,
        started.prompt_assembly_id,
        endpoint.provider,
        endpoint.model_name,
        started.prompt_assembly.prompt_cache_key,
        started.prompt_assembly.prefix_hash,
        started.prompt_assembly.dynamic_tail_hash,
        json({
          source: 'electron_ts_tool_calling',
          model_route_failover: true,
          failover_attempt: attempt,
          route_reason: endpoint.route_reason || 'fallback',
          previous_error: errorMessage,
          reasoning_effort: endpoint.reasoning_effort,
        }),
      );
      this.appendRunEventV2({
        id: `${started.run_id}_evt_model_failover_${attempt}`,
        run_id: started.run_id,
        turn_id: started.turn_id,
        event_type: 'model.route_failover',
        status: 'running',
        source: 'model_router',
        visibility: 'inline_status',
        payload: {
          attempt,
          provider: endpoint.provider,
          model: endpoint.model_name,
          route_reason: endpoint.route_reason || 'fallback',
          previous_error: errorMessage,
        },
      });
    });
    return {
      ...started,
      model_call_id: modelCallID,
      provider: endpoint.provider,
      model_name: endpoint.model_name,
      model_base_url: endpoint.base_url?.trim() || '',
      model_reasoning_effort: endpoint.reasoning_effort,
    };
  }

  private modelEndpointForAgent(
    agentID: string,
    fallback: { provider: string; model_name: string; base_url?: string; reasoning_effort?: string },
    purpose: 'default' | 'child' | 'tool' | 'cheap' | 'long_context' | string = 'default',
  ): { provider: string; model_name: string; base_url: string; reasoning_effort?: string } {
    const row = this.get(`SELECT model_strategy, metadata FROM personas WHERE id=?`, agentID);
    const personaModelName = configuredPersonaModelStrategy(optionalString(row?.model_strategy));
    const personaReasoningEffort = optionalReasoningEffort(parseObject(row?.metadata).model_reasoning_effort);
    if (personaModelName) {
      const personaEndpoint = this.configuredModelEndpoint(personaModelName);
      if (personaEndpoint) return { ...personaEndpoint, reasoning_effort: personaReasoningEffort };
    }
    const routed = this.modelRouteCandidates({ agent_id: agentID, purpose, fallback })[0];
    if (routed) {
      return {
        provider: routed.provider,
        model_name: routed.model_name,
        base_url: routed.base_url,
        reasoning_effort: routed.reasoning_effort,
      };
    }
    return {
      provider: fallback.provider.trim() || 'openai_compatible',
      model_name: fallback.model_name.trim() || 'model',
      base_url: fallback.base_url?.trim() || '',
      reasoning_effort: personaReasoningEffort || fallback.reasoning_effort,
    };
  }

  private resolveAgentRoute(conversationID: string, message: string, roomAgentID?: string): AgentRouteResolution {
    if (roomAgentID?.trim() && this.enabledAgentExists(roomAgentID.trim())) {
      return { agent_id: roomAgentID.trim(), source: 'room', reason: 'room kernel selected executor persona', confidence: 1 };
    }
    const agents = this.all(
      `SELECT id, name, route_hints
       FROM agents
       WHERE enabled=1
       ORDER BY id`,
    );
    const normalizedMessage = message.toLowerCase();
    for (const agent of agents) {
      const id = String(agent.id);
      const name = optionalString(agent.name);
      if (normalizedMessage.includes(`@${id.toLowerCase()}`) || (name && normalizedMessage.includes(`@${name.toLowerCase()}`))) {
        return { agent_id: id, source: 'explicit', reason: `explicit mention selected ${id}`, confidence: 1 };
      }
    }
    let ruleMatch: { agent_id: string; matches: string[] } | undefined;
    for (const agent of agents) {
      const keywords = parseStringArray(parseObject(agent.route_hints).keywords)
        .map((keyword) => keyword.trim().toLowerCase())
        .filter(Boolean);
      const matches = keywords.filter((keyword) => normalizedMessage.includes(keyword));
      if (matches.length > (ruleMatch?.matches.length || 0)) {
        ruleMatch = { agent_id: String(agent.id), matches };
      }
    }
    if (ruleMatch && ruleMatch.matches.length > 0) {
      return {
        agent_id: ruleMatch.agent_id,
        source: 'rule',
        reason: `matched route hints: ${ruleMatch.matches.slice(0, 3).join(', ')}`,
        confidence: Math.min(0.95, 0.72 + ruleMatch.matches.length * 0.08),
      };
    }
    const sticky = this.get(`SELECT active_agent_id FROM conversations WHERE id=?`, conversationID);
    const stickyAgentID = optionalString(sticky?.active_agent_id);
    if (stickyAgentID && this.enabledAgentExists(stickyAgentID)) {
      return { agent_id: stickyAgentID, source: 'sticky', reason: 'continued conversation active agent', confidence: 0.7 };
    }
    return { agent_id: 'general_agent', source: 'fallback', reason: 'default general agent', confidence: 0.5 };
  }

  private enabledAgentExists(agentID: string): boolean {
    return Boolean(this.get(`SELECT id FROM agents WHERE id=? AND enabled=1 LIMIT 1`, agentID));
  }

  private configuredModelEndpoint(modelName: string): { provider: string; model_name: string; base_url: string } | null {
    const normalized = modelName.trim();
    if (!normalized) return null;
    const row = this.get(
      `SELECT provider, model_name, COALESCE(base_url, '') AS base_url
       FROM models
       WHERE (id = ? OR model_name = ?) AND COALESCE(enabled, 1) != 0
       ORDER BY CASE WHEN COALESCE(base_url, '') != '' THEN 0 ELSE 1 END, updated_at DESC
       LIMIT 1`,
      normalized,
      normalized,
    );
    if (!row) return null;
    return {
      provider: optionalString(row.provider) || 'openai_compatible',
      model_name: optionalString(row.model_name) || normalized,
      base_url: optionalString(row.base_url) || '',
    };
  }

  finishToolCallingChat(started: StartedToolCallingChat, turn: PersistedToolCallingTurn): ChatResponse {
    const rawResponse = turn.final_message.trim() || '模型没有返回可展示内容。';
    const toolResults = (turn.tool_results || []).map(normalizePersistedToolResult);
    const assistantAttachments = toolResults.flatMap((result) => generatedAttachmentForToolOutput(result.output));
    const usage = turn.usage || {};
    const normalizedUsage = canonicalModelUsage(usage);
    const usageStatus = turn.usage_status || usageStatusForUsage(normalizedUsage);
    const costEstimate = this.estimateModelUsageCost(started.provider, started.model_name, normalizedUsage);
    const waitingConfirmation = turn.status === 'waiting_confirmation' || toolResults.some(isWaitingConfirmationToolResult);
    const response = waitingConfirmation ? '' : sanitizeAssistantConversationText(started.user_message, rawResponse);
    let artifacts: ArtifactSummary[] = [];
    const generatedMediaArtifacts: ArtifactSummary[] = [];
    let productTask: ProductTask | undefined = started.product_task;

    this.transaction(() => {
      if (!waitingConfirmation) {
        this.exec(
          `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
           VALUES (?, ?, 'assistant', ?, ?, ?, datetime('now'))`,
          started.assistant_message_id,
          started.conversation_id,
          response,
          json(assistantAttachments),
          json({ run_id: started.run_id, source: 'electron_ts_tool_calling' }),
        );
      }
      let itemSeq = this.nextTurnItemSeq(started.run_id);
      const hasRunEvent = (eventType: string, itemID?: string): boolean => Boolean(itemID
        ? this.get(`SELECT id FROM run_events WHERE run_id=? AND event_type=? AND item_id=? LIMIT 1`, started.run_id, eventType, itemID)
        : this.get(`SELECT id FROM run_events WHERE run_id=? AND event_type=? LIMIT 1`, started.run_id, eventType));
      for (const result of toolResults) {
        const capability = toolResultCapability(result);
        const persistedCapabilityID = this.registeredCapabilityID(capability);
        const workflowName = workflowNameForGateway(capability);
        const args = result.arguments || {};
        const risk = toolResultRisk(result, capability);
        const requestedAction = requestedActionForTool(capability, args, result.output);
        const resultWaiting = isWaitingConfirmationToolResult(result);
        const operationID = operationIDForTool(started.product_task_id, capability, args, result.call_id);
        this.insertRunStep(started.run_id, 'capability_requested', 'Model requested capability tool', { agent_id: started.selected_agent_id, call_id: result.call_id, tool_name: result.name }, { capability, goal: requestedAction, inputs: args, risk, source: 'tool_calling', operation_id: operationID });
        if (!hasRunEvent('tool.call_requested', result.call_id)) {
          this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'tool.call_requested', {
            item_type: 'tool_run',
            item_id: result.call_id,
            call_id: result.call_id,
            capability,
            tool_name: result.name,
            purpose: requestedAction,
            status: 'requested',
            visibility: 'tool',
            source: 'model_provider',
            input: args,
            risk,
            operation_id: operationID,
          });
        }
        this.insertTurnItem(started.run_id, started.turn_id, itemSeq++, 'tool_call', 'assistant', result.call_id, result.name, args, '', {}, resultWaiting ? 'waiting_confirmation' : 'completed', { capability });
        if (resultWaiting) {
          const confirmationID = `confirm_${newID()}`;
          const approvalKey = result.call_id || confirmationID;
          const confirmationInput = confirmationInputForTool(started.product_task_id, capability, args, result.call_id, requestedAction);
          const approvalPayload = {
            ...result.output,
            status: 'waiting_confirmation',
            run_id: started.run_id,
            turn_id: started.turn_id,
            call_id: result.call_id,
            confirmation_id: confirmationID,
            capability,
            risk,
            approval_scope: 'one_call',
            approval_key: approvalKey,
            operation_id: confirmationInput.operation_id,
            affected_paths: confirmationInput.affected_paths,
            external_target: confirmationInput.external_target,
            reversible: confirmationInput.reversible,
            requested_action: requestedAction,
            message: confirmationMessageForToolResult(result),
          };
          this.exec(
            `INSERT INTO confirmation_requests (id, run_id, capability_id, requested_action, risk_level, status, input, call_id, turn_id, approval_scope, approval_key)
             VALUES (?, ?, NULLIF(?, ''), ?, ?, 'pending', ?, NULLIF(?, ''), ?, 'one_call', ?)`,
            confirmationID,
            started.run_id,
            persistedCapabilityID,
            requestedAction,
            risk,
            json(confirmationInput),
            result.call_id,
            started.turn_id,
            approvalKey,
          );
          this.insertRunStep(started.run_id, 'approval_requested', 'Tool execution waiting for confirmation', { agent_id: started.selected_agent_id, call_id: result.call_id, capability }, approvalPayload, 'waiting_confirmation');
          if (!hasRunEvent('tool.approval_required', result.call_id)) {
            this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'tool.approval_required', {
              item_type: 'tool_run',
              item_id: result.call_id,
              call_id: result.call_id,
              confirmation_id: confirmationID,
              capability,
              tool_name: result.name,
              status: 'waiting_confirmation',
              visibility: 'approval',
              source: 'store',
              purpose: requestedAction,
              risk,
              operation_id: confirmationInput.operation_id,
            });
          }
          this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'approval.requested', approvalPayload);
          this.insertTurnItem(started.run_id, started.turn_id, itemSeq++, 'tool_output', 'tool', result.call_id, result.name, {}, JSON.stringify(approvalPayload), approvalPayload, 'waiting_confirmation', { confirmation_id: confirmationID, capability });
          this.recordProductTaskToolCheckpoint(started.product_task_id, {
            run_id: started.run_id,
            capability,
            requested_action: requestedAction,
            input: confirmationInput,
            output: approvalPayload,
            status: 'waiting_confirmation',
            operation_id: String(confirmationInput.operation_id || operationID),
          });
          continue;
        }
        const toolRunID = `toolrun_${newID()}`;
        const toolStatus = toolRunStatusForOutput(result.output);
        const toolSummary = summaryForToolOutput(result.output, toolStatus);
        if (!hasRunEvent('tool.started', result.call_id)) {
          this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'tool.started', {
            item_type: 'tool_run',
            item_id: result.call_id,
            tool_run_id: toolRunID,
            call_id: result.call_id,
            capability,
            tool_name: result.name,
            purpose: requestedAction,
            status: 'running',
            visibility: 'tool',
            source: 'tool',
            operation_id: operationID,
          });
        }
        this.exec(
          `INSERT INTO tool_runs (id, run_id, turn_id, tool_call_id, capability_id, workflow_name, tool_name, purpose,
                                  node_id, assignment_reason, risk_level, side_effect_level, idempotency_key,
                                  status, input, output, output_summary, error_code, error_message, finished_at, completed_at, duration_ms)
           VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, 'main-node', 'model_tool_call', ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), datetime('now'), datetime('now'), ?)`,
          toolRunID,
          started.run_id,
          started.turn_id,
          result.call_id,
          persistedCapabilityID,
          workflowName,
          result.name,
          requestedAction,
          risk,
          toolResultSideEffect(result, capability),
          operationID,
          toolStatus,
          json(args),
          json(result.output),
          toolSummary,
          toolResultErrorCode(result, toolStatus),
          toolResultErrorMessage(result, toolStatus),
          toolResultDuration(result),
        );
        this.insertRunStep(started.run_id, 'tool_finished', 'Tool runtime finished', { workflow_name: workflowName, tool_run_id: toolRunID, call_id: result.call_id }, result.output);
        const toolTerminalEventType = toolStatus === 'failed' ? 'tool.failed' : toolStatus === 'policy_blocked' ? 'tool.policy_blocked' : 'tool.completed';
        if (!hasRunEvent(toolTerminalEventType, result.call_id)) {
          this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), toolTerminalEventType, {
            item_type: 'tool_run',
            item_id: result.call_id,
            tool_run_id: toolRunID,
            call_id: result.call_id,
            capability,
            tool_name: result.name,
            purpose: requestedAction,
            status: toolStatus,
            visibility: 'tool',
            source: 'tool',
            summary: toolSummary,
            operation_id: operationID,
            output: result.output,
          });
        }
        this.insertTurnItem(started.run_id, started.turn_id, itemSeq++, 'tool_output', 'tool', result.call_id, result.name, {}, JSON.stringify(result.output), result.output, 'completed', { tool_run_id: toolRunID, capability });
        this.recordProductTaskToolCheckpoint(started.product_task_id, {
          run_id: started.run_id,
          capability,
          requested_action: requestedAction,
          input: args,
          output: { ...result.output, operation_id: operationID },
          status: toolStatus === 'failed' || toolStatus === 'policy_blocked' ? 'failed' : 'done',
          tool_run_id: toolRunID,
          operation_id: operationID,
        });
        const generatedMediaOutput = generatedMediaOutputForToolOutput(result.output);
        const generatedAttachment = generatedAttachmentForToolOutput(result.output)[0];
        if (toolStatus === 'succeeded' && generatedAttachment) {
          const artifactID = `art_${newID()}`;
          const artifactMetadata = {
            generation_mode: optionalString(generatedMediaOutput.mode) || 'generated_media',
            provider: optionalString(generatedMediaOutput.provider) || 'local',
            model: optionalString(generatedMediaOutput.model),
            native_tool: optionalString(generatedMediaOutput.native_tool),
            source_session_id: optionalString(generatedMediaOutput.source_session_id),
            source_tool_call_id: optionalString(generatedMediaOutput.source_tool_call_id),
            request_id: optionalString(generatedMediaOutput.request_id),
            prompt_sha256: optionalString(generatedMediaOutput.prompt_sha256),
            aspect_ratio: optionalString(generatedMediaOutput.aspect_ratio),
            duration_seconds: Number(generatedMediaOutput.duration_seconds || 0),
            file_path: optionalString(generatedMediaOutput.file_path),
            file_name: generatedAttachment.name,
            media_kind: generatedAttachment.kind,
            mime_type: generatedAttachment.mime_type,
            size: generatedAttachment.size,
            preview_url: generatedAttachment.preview_url,
          };
          this.exec(
            `INSERT INTO artifacts (id, type, title, content, content_format, source_product_task_id, source_run_id,
                                    source_conversation_id, source_message_id, linked_memory_ids, metadata)
             VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, '[]', ?)`,
            artifactID,
            generatedAttachment.kind,
            generatedAttachment.name,
            optionalString(generatedMediaOutput.file_path) || '',
            generatedAttachment.mime_type,
            started.product_task_id || '',
            started.run_id,
            started.conversation_id,
            started.assistant_message_id,
            json(artifactMetadata),
          );
          this.insertRunStep(started.run_id, 'artifact_created', 'Generated media persisted', { call_id: result.call_id, capability }, { artifact_id: artifactID, ...artifactMetadata });
          this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'artifact.created', {
            item_type: 'artifact',
            item_id: artifactID,
            artifact_id: artifactID,
            call_id: result.call_id,
            capability,
            title: generatedAttachment.name,
            status: 'completed',
            visibility: 'artifact',
            source: 'store',
            ...artifactMetadata,
          });
          const artifactRow = this.get(
            `SELECT id, type, title, content_format, source_product_task_id, source_run_id,
                    source_conversation_id, source_message_id, version, status, metadata, created_at, updated_at
             FROM artifacts WHERE id=?`,
            artifactID,
          );
          if (artifactRow) generatedMediaArtifacts.push(rowToArtifactSummary(artifactRow));
        }
      }
      artifacts = [...generatedMediaArtifacts, ...this.finalizeProductTaskAfterRun(started.product_task_id, {
        run_id: started.run_id,
        conversation_id: started.conversation_id,
        message_id: started.assistant_message_id,
        response,
        waiting_confirmation: waitingConfirmation,
        tool_results: toolResults,
        runtime_status: turn.status || 'completed',
      })];
      if (started.product_task_id) {
        productTask = this.getProductTask(started.product_task_id).task;
      }
      if (!waitingConfirmation) {
        this.recordPostRunMemoryLearning({
          conversation_id: started.conversation_id,
          message: started.user_message,
          memory_controls: started.memory_controls,
        }, started.run_id, started.turn_id, response);
        this.attributeMemoryInfluence(started.run_id, response);
      }
      const persistedToolRunCount = this.persistedToolRunCountForRun(started.run_id);
      this.insertRunStep(started.run_id, 'model_call_finished', 'Model call finished', { agent_id: started.selected_agent_id, model_id: started.model_name, prompt_assembly_id: started.prompt_assembly_id }, { provider: started.provider, model: started.model_name, real_model: started.provider !== 'mock_provider', fallback_to_mock: false, ...normalizedUsage, estimated_cost: roundCost(costEstimate), tool_run_count: persistedToolRunCount });
      if (!waitingConfirmation) {
        this.insertRunStep(started.run_id, 'agent_output_parsed', 'Agent output parsed', { turn: 1 }, { repaired: false, output_type: 'final_answer' });
        this.insertRunStep(started.run_id, 'response_generated', 'Response generated', {}, { response }, 'succeeded');
        this.insertTurnItem(started.run_id, started.turn_id, itemSeq++, 'message', 'assistant', '', '', {}, response, {}, 'completed', { final_answer: true, waiting_confirmation: false });
      }
      this.exec(
        `UPDATE model_calls
         SET input_tokens=?, output_tokens=?, cached_input_tokens=?, cache_write_input_tokens=?, reasoning_tokens=?, total_tokens=?,
             cost_estimate=?,
             latency_ms=MAX(0, COALESCE(CAST((julianday('now') - julianday(created_at)) * 86400000 AS INTEGER), 0)),
             status='succeeded', completed_at=datetime('now'), finish_reason=?,
             usage_status=?, raw_response=?, raw_finish_json=?,
             metadata=json_set(COALESCE(metadata, '{}'), '$.tool_run_count', ?, '$.usage_status', ?, '$.estimated_cost', ?)
         WHERE id=?`,
        normalizedUsage.input_tokens,
        normalizedUsage.output_tokens,
        normalizedUsage.cached_input_tokens,
        normalizedUsage.cache_write_input_tokens,
        normalizedUsage.reasoning_tokens,
        normalizedUsage.total_tokens,
        roundCost(costEstimate),
        turn.status || 'completed',
        usageStatus,
        json({ responses: turn.model_responses || [] }),
        json({ status: turn.status || 'completed', usage_status: usageStatus }),
        persistedToolRunCount,
        usageStatus,
        roundCost(costEstimate),
        started.model_call_id,
      );
      this.exec(
        `UPDATE runs
         SET status=?, terminal_status=CASE WHEN ? THEN NULL ELSE ? END,
             terminal_reason=CASE WHEN ? THEN NULL ELSE ? END,
             finished_at=CASE WHEN ? THEN NULL ELSE datetime('now') END,
             duration_ms=CASE WHEN ? THEN NULL ELSE CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER) END
         WHERE id=?`,
        waitingConfirmation ? 'waiting_confirmation' : 'completed',
        waitingConfirmation ? 1 : 0,
        waitingConfirmation ? 'waiting_approval' : 'completed',
        waitingConfirmation ? 1 : 0,
        waitingConfirmation ? 'waiting approval' : 'assistant response completed',
        waitingConfirmation ? 1 : 0,
        waitingConfirmation ? 1 : 0,
        started.run_id,
      );
      this.exec(
        `UPDATE turns
         SET status=?, stream_status=?, finished_at=CASE WHEN ? THEN NULL ELSE datetime('now') END,
             completed_at=CASE WHEN ? THEN NULL ELSE datetime('now') END
         WHERE id=?`,
        waitingConfirmation ? 'waiting_confirmation' : 'completed',
        waitingConfirmation ? 'waiting_approval' : 'completed',
        waitingConfirmation ? 1 : 0,
        waitingConfirmation ? 1 : 0,
        started.turn_id,
      );
      if (waitingConfirmation) {
        if (!hasRunEvent('usage.recorded', started.model_call_id)) {
          this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'usage.recorded', { run_id: started.run_id, turn_id: started.turn_id, item_type: 'model', item_id: started.model_call_id, status: usageStatus, visibility: 'trace_only', source: 'store', usage: normalizedUsage, usage_status: usageStatus, estimated_cost: roundCost(costEstimate), type: 'usage.recorded' });
        }
        this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'run.waiting_approval', { run_id: started.run_id, turn_id: started.turn_id, status: 'waiting_approval', message: 'waiting for approval', visibility: 'inline_status', type: 'run.waiting_approval' });
      } else {
        const hasAssistantDelta = Boolean(this.get(`SELECT id FROM run_events WHERE run_id=? AND event_type='assistant.delta' LIMIT 1`, started.run_id));
        if (!hasAssistantDelta) {
          this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'assistant.delta', { run_id: started.run_id, turn_id: started.turn_id, item_type: 'assistant_message', item_id: started.assistant_message_id, delta: { text: response, stream_source: 'fallback_final_chunk' }, status: 'completed', visibility: 'chat', source: 'store', type: 'assistant.delta' });
        }
        if (!hasRunEvent('assistant.completed', started.assistant_message_id)) {
          this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'assistant.completed', { run_id: started.run_id, turn_id: started.turn_id, item_type: 'assistant_message', item_id: started.assistant_message_id, delta: { text: response }, status: 'completed', visibility: 'chat', source: 'store', type: 'assistant.completed' });
        }
        if (!hasRunEvent('usage.recorded', started.model_call_id)) {
          this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'usage.recorded', { run_id: started.run_id, turn_id: started.turn_id, item_type: 'model', item_id: started.model_call_id, status: usageStatus, visibility: 'trace_only', source: 'store', usage: normalizedUsage, usage_status: usageStatus, estimated_cost: roundCost(costEstimate), type: 'usage.recorded' });
        }
        this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'message.delta', { run_id: started.run_id, turn_id: started.turn_id, delta: response, status: 'completed', visibility: 'trace_only', source: 'store', type: 'message.delta' });
        this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'turn.completed', { run_id: started.run_id, turn_id: started.turn_id, status: 'completed', type: 'turn.completed' });
        this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'run.completed', { run_id: started.run_id, status: 'succeeded', terminal: true, type: 'run.completed' });
      }
    });

    return {
      conversation_id: started.conversation_id,
      user_message_id: started.user_message_id,
      assistant_message_id: started.assistant_message_id,
      run_id: started.run_id,
      selected_agent_id: started.selected_agent_id,
      response,
      ui: {
        interaction_class: 'chat',
        requires_user_input: waitingConfirmation,
        missing_input: waitingConfirmation ? 'confirmation' : undefined,
        inline_execution: toolResults.length > 0,
      },
      model_calls: [],
      used_memories: started.prompt_assembly.memory_results || [],
      product_task: productTask,
      artifacts,
    };
  }

  failToolCallingChat(started: StartedToolCallingChat, error: Error, status: 'failed' | 'cancelled' = 'failed'): ChatResponse {
    const response = status === 'cancelled' ? '运行已取消。' : `运行失败：${error.message}`;
    this.transaction(() => {
      const existingMessage = this.get(`SELECT id FROM messages WHERE id=?`, started.assistant_message_id);
      if (!existingMessage) {
        this.exec(
          `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
           VALUES (?, ?, 'assistant', ?, '[]', ?, datetime('now'))`,
          started.assistant_message_id,
          started.conversation_id,
          response,
          json({ run_id: started.run_id, source: 'electron_ts_tool_calling', error: error.message }),
        );
      }
      this.exec(
        `UPDATE runs
         SET status=?, terminal_status=?, terminal_reason=?, error_code=?, error_message=?, finished_at=datetime('now'),
             duration_ms=CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER)
         WHERE id=?`,
        status,
        status,
        error.message,
        status === 'cancelled' ? 'interrupted' : 'tool_calling_runtime_failed',
        error.message,
        started.run_id,
      );
      this.exec(
        `UPDATE turns SET status=?, stream_status=?, finished_at=datetime('now'), completed_at=datetime('now') WHERE id=?`,
        status,
        status,
        started.turn_id,
      );
      this.exec(
        `UPDATE model_calls
         SET status=?, completed_at=datetime('now'), finish_reason=?, usage_status='failed',
             latency_ms=MAX(0, COALESCE(CAST((julianday('now') - julianday(created_at)) * 86400000 AS INTEGER), 0)),
             error_code=?, error_message=?, raw_response=?, raw_finish_json=?,
             metadata=json_set(COALESCE(metadata, '{}'), '$.error', ?)
         WHERE id=?`,
        status,
        status,
        status === 'cancelled' ? 'interrupted' : 'tool_calling_runtime_failed',
        error.message,
        json({ error: error.message }),
        json({ status, error: error.message }),
        error.message,
        started.model_call_id,
      );
      this.markProductTaskFailed(started.product_task_id, started.run_id, error, status);
      this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'assistant.completed', { run_id: started.run_id, turn_id: started.turn_id, item_type: 'assistant_message', item_id: started.assistant_message_id, delta: { text: response }, status, visibility: 'chat', source: 'store', terminal: true, error: error.message, type: 'assistant.completed' });
      this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), status === 'cancelled' ? 'run.cancelled' : 'run.failed', { run_id: started.run_id, turn_id: started.turn_id, status, terminal: true, error: error.message, message: response, type: status === 'cancelled' ? 'run.cancelled' : 'run.failed' });
      if (status === 'cancelled') {
        this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'run.interrupted', { run_id: started.run_id, turn_id: started.turn_id, status, error: error.message, message: response, visibility: 'trace_only', type: 'run.interrupted' });
      }
    });
    return {
      conversation_id: started.conversation_id,
      user_message_id: started.user_message_id,
      assistant_message_id: started.assistant_message_id,
      run_id: started.run_id,
      selected_agent_id: started.selected_agent_id,
      response,
      ui: {
        interaction_class: 'chat',
        requires_user_input: false,
        inline_execution: false,
      },
      model_calls: [],
      used_memories: started.prompt_assembly.memory_results || [],
    };
  }

  recordToolCallingChat(req: ChatRequest, turn: PersistedToolCallingTurn): ChatResponse {
    const conversationID = req.conversation_id?.trim() || `conv_${newID()}`;
    const runID = `run_${newID()}`;
    const turnID = `turn_${newID()}`;
    const userMessageID = `msg_${newID()}`;
    const assistantMessageID = `msg_${newID()}`;
    const modelCallID = `mcall_${newID()}`;
    const memoryPackID = `mcp_${newID()}`;
    const promptAssemblyID = `pa_${newID()}`;
    const createdAt = nowIso();
    const message = req.message.trim();
    const rawResponse = turn.final_message.trim() || '模型没有返回可展示内容。';
    const title = titleFromMessage(message);
    const roomRoute = this.resolveRoomKernelRoute(req, conversationID, message);
    const agentRoute = turn.selected_agent_id?.trim()
      ? { agent_id: turn.selected_agent_id.trim(), source: 'caller', reason: 'recorded turn selected agent', confidence: 1 } satisfies AgentRouteResolution
      : this.resolveAgentRoute(conversationID, message, roomRoute?.executor_persona_id);
    const agentID = agentRoute.agent_id;
    const provider = turn.provider.trim() || 'openai_compatible';
    const modelName = req.model_name?.trim() || turn.model_name.trim() || 'model';
    const prompt = turn.prompt_assembly || this.assembleToolCallingPrompt(req, agentID, modelName);
    const prefix = prompt.cacheable_prefix;
    const dynamicTail = prompt.dynamic_tail;
    const prefixHash = prompt.prefix_hash;
    const dynamicTailHash = prompt.dynamic_tail_hash;
    const promptCacheKey = prompt.prompt_cache_key;
    const toolResults = (turn.tool_results || []).map(normalizePersistedToolResult);
    const usage = turn.usage || {};
    const normalizedUsage = canonicalModelUsage(usage);
    const usageStatus = turn.usage_status || usageStatusForUsage(normalizedUsage);
    const costEstimate = this.estimateModelUsageCost(provider, modelName, normalizedUsage);
    const waitingResult = toolResults.find(isWaitingConfirmationToolResult);
    const waitingConfirmation = turn.status === 'waiting_confirmation' || Boolean(waitingResult);
    const response = waitingConfirmation ? '' : sanitizeAssistantConversationText(message, rawResponse);
    const runStatus = waitingConfirmation ? 'waiting_confirmation' : 'completed';
    const turnStatus = waitingConfirmation ? 'waiting_confirmation' : 'completed';
    const modeResolution = modeResolutionForRequest(req, message);
    const entryIdentity = entryIdentityForRequest(req, conversationID);
    let productTask: ProductTask | undefined;
    let artifacts: ArtifactSummary[] = [];

    this.transaction(() => {
      this.exec(
        `INSERT INTO conversations (id, principal_id, channel, user_id, title, active_agent_id, lifecycle_status, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET principal_id=COALESCE(conversations.principal_id, excluded.principal_id), active_agent_id=excluded.active_agent_id, updated_at=datetime('now')`,
        conversationID,
        entryIdentity.principal_id,
        req.channel || 'desktop',
        req.user_id || 'desktop_user',
        title,
        agentID,
        json({ electron_native: true, runtime: 'ts_tool_calling' }),
      );
      this.linkChannelIdentity(entryIdentity, conversationID);

      this.exec(
        `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
         VALUES (?, ?, 'user', ?, ?, ?, datetime('now'))`,
        userMessageID,
        conversationID,
        message,
        json(Array.isArray(req.attachments) ? req.attachments : []),
        json({ source: 'electron_ts_tool_calling' }),
      );

      this.exec(
        `INSERT INTO models (id, provider, model_name, display_name, supports_json_mode, supports_tool_calling, enabled, metadata)
         VALUES (?, ?, ?, ?, 1, 1, 1, ?)
         ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, model_name=excluded.model_name, display_name=excluded.display_name, supports_tool_calling=1, enabled=1, updated_at=datetime('now')`,
        modelName,
        provider,
        modelName,
        modelName,
        json({ electron_native: true, observed_from_tool_calling: true }),
      );

      this.exec(
        `INSERT INTO runs (id, conversation_id, user_message_id, entry_channel, requested_mode, resolved_mode,
                           mode_source, principal_id, status, terminal_status, terminal_reason, selected_agent_id,
                           selected_model_id, selected_node_id, route_result, parent_run_id, redirected_from_run_id,
                           started_at, finished_at, duration_ms, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? THEN NULL ELSE 'completed' END,
                 CASE WHEN ? THEN NULL ELSE 'assistant response completed' END, ?, ?, 'main-node', ?,
                 NULLIF(?, ''), NULLIF(?, ''), datetime('now'), CASE WHEN ? THEN NULL ELSE datetime('now') END,
                 CASE WHEN ? THEN NULL ELSE 0 END, ?, datetime('now'))`,
        runID,
        conversationID,
        userMessageID,
        req.channel || 'desktop',
        modeResolution.requested_mode,
        modeResolution.resolved_mode,
        modeResolution.mode_source,
        entryIdentity.principal_id,
        runStatus,
        waitingConfirmation ? 1 : 0,
        waitingConfirmation ? 1 : 0,
        agentID,
        modelName,
        json({ route: 'electron_ts_tool_calling', agent_id: agentID, agent_route: agentRoute, model: modelName, provider, room_kernel: roomRoute ? routeResolutionForTrace(roomRoute) : undefined }),
        req.parent_run_id || '',
        req.redirected_from_run_id || '',
        waitingConfirmation ? 1 : 0,
        waitingConfirmation ? 1 : 0,
        json({ runtime_mode: 'tool_calling', input_mode: req.input_mode || 'auto', mode_resolution: modeResolution, source: 'electron_ts_tool_calling' }),
      );

      if (!waitingConfirmation) {
        this.exec(
          `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
           VALUES (?, ?, 'assistant', ?, '[]', ?, datetime('now'))`,
          assistantMessageID,
          conversationID,
          response,
          json({ run_id: runID, source: 'electron_ts_tool_calling' }),
        );
      }

      this.exec(
        `INSERT INTO turns (id, run_id, turn_index, status, mode_resolution_id, user_intent_summary,
                            assistant_message_id, stream_status, active_model_call_id, cancellation_key,
                            started_at, finished_at, completed_at, metadata)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, datetime('now'),
                 CASE WHEN ? THEN NULL ELSE datetime('now') END,
                 CASE WHEN ? THEN NULL ELSE datetime('now') END, ?)`,
        turnID,
        runID,
        turnStatus,
        modeResolution.id,
        message.slice(0, 500),
        assistantMessageID,
        waitingConfirmation ? 'waiting_approval' : 'completed',
        modelCallID,
        `cancel_${runID}`,
        waitingConfirmation ? 1 : 0,
        waitingConfirmation ? 1 : 0,
        json({ runtime: 'electron_ts_tool_calling', mode_resolution: modeResolution }),
      );

      this.insertRunEvent(runID, turnID, 1, 'run.started', { run_id: runID, conversation_id: conversationID, status: 'running', source: 'store', type: 'run.started' });
      this.insertRunEvent(runID, turnID, 2, 'run.mode_resolved', {
        run_id: runID,
        turn_id: turnID,
        conversation_id: conversationID,
        item_type: 'mode_resolution',
        item_id: modeResolution.id,
        status: 'completed',
        visibility: 'inline_status',
        source: 'store',
        requested_mode: modeResolution.requested_mode,
        resolved_mode: modeResolution.resolved_mode,
        contract_mode: contractMode(modeResolution.resolved_mode),
        mode_source: modeResolution.mode_source,
        mode_locked_by_user: modeResolution.mode_locked_by_user,
        reason: modeResolution.reason,
        confidence: modeResolution.confidence,
        type: 'run.mode_resolved',
      });
      this.insertRunEvent(runID, turnID, 3, 'turn.started', { run_id: runID, turn_id: turnID, status: 'running', source: 'store', type: 'turn.started' });
      productTask = this.ensureProductTaskForRun(req, {
        conversation_id: conversationID,
        user_message_id: userMessageID,
        run_id: runID,
        turn_id: turnID,
        mode_resolution_id: modeResolution.id,
        mode_resolution: modeResolution,
        message,
      });
      this.linkTaskEntryIfNeeded(entryIdentity, conversationID, productTask?.id, handoffReasonForRequest(req, entryIdentity));
      this.appendCrossEntryHandoffEvent(runID, turnID, entryIdentity, req, productTask?.id);

      this.exec(
        `INSERT INTO memory_context_packs (id, run_id, agent_id, memory_profile_version, profile, project_facts, relevant_episodes, heuristics, anti_patterns, open_issues, dynamic_retrieval, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', '[]', ?, ?)`,
        memoryPackID,
        runID,
        agentID,
        prompt.memory_profile_version,
        json(prompt.stable_memory_results || []),
        json((prompt.dynamic_memory_results || []).filter((result) => result.memory.layer === 'knowledge')),
        json((prompt.dynamic_memory_results || []).filter((result) => result.memory.layer === 'episode')),
        json(prompt.dynamic_memory_results || []),
        json({ source: 'electron_ts_tool_calling', pipeline_version: MEMORY_PIPELINE_VERSION, memory_result_count: prompt.memory_results?.length || 0, memory_scope: prompt.memory_scope, memory_controls: prompt.memory_controls, selected_skills: prompt.selected_skills }),
      );
      this.appendMemoryRecalledEvents(runID, turnID, memoryPackID, prompt.memory_results || [], prompt.memory_scope);
      this.recordMemoryRetrievalUsage(runID, agentID, prompt.memory_results || [], prompt.memory_scope);

      this.exec(
        `INSERT INTO prompt_assemblies (id, run_id, agent_id, model_id, memory_context_pack_id, cacheable_prefix, dynamic_tail, prefix_hash, dynamic_tail_hash, prompt_cache_key, memory_profile_version, tool_schema_version, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        promptAssemblyID,
        runID,
        agentID,
        modelName,
        memoryPackID,
        prefix,
        dynamicTail,
        prefixHash,
        dynamicTailHash,
        promptCacheKey,
        prompt.memory_profile_version,
        prompt.tool_schema_version,
        json({ source: 'electron_ts_tool_calling', memory_result_count: prompt.memory_results?.length || 0, memory_scope: prompt.memory_scope }),
      );

      const steps: Array<[string, string, Record<string, unknown>, Record<string, unknown>]> = [
        ['input_received', 'Input received', { message }, { conversation_id: conversationID, message_id: userMessageID }],
        ['router_selected', 'Router selected agent', { message }, { agent_id: agentID, route: 'electron_ts_tool_calling' }],
        ...prompt.selected_skills.map((skill) => ['skill_selected', 'Skill selected', { message, skill_id: skill.id }, skill] as [string, string, Record<string, unknown>, Record<string, unknown>]),
        ...(prompt.selected_skills.length > 0 ? [['skill_plan_generated', 'Skill instructions loaded', { skill_ids: prompt.selected_skills.map((skill) => skill.id) }, { progressive_disclosure: true, selected_skills: prompt.selected_skills }] as [string, string, Record<string, unknown>, Record<string, unknown>]] : []),
        ['prompt_assembled', 'Prompt assembly finished', { run_id: runID, agent_id: agentID }, { prompt_assembly_id: promptAssemblyID, prefix_hash: prefixHash, dynamic_tail_hash: dynamicTailHash, prompt_cache_key: promptCacheKey, memory_profile_version: prompt.memory_profile_version, tool_schema_version: prompt.tool_schema_version, memory_result_count: prompt.memory_results?.length || 0 }],
      ];
      for (const [stepType, stepTitle, input, output] of steps) {
        this.insertRunStep(runID, stepType, stepTitle, input, output);
      }

      let itemSeq = 1;
      this.insertTurnItem(runID, turnID, itemSeq++, 'message', 'user', '', '', {}, message, {}, 'completed', { source: 'desktop_user' });

      for (const result of toolResults) {
        const capability = toolResultCapability(result);
        const persistedCapabilityID = this.registeredCapabilityID(capability);
        const workflowName = workflowNameForGateway(capability);
        const args = result.arguments || {};
        const risk = toolResultRisk(result, capability);
        const requestedAction = requestedActionForTool(capability, args, result.output);
        const resultWaiting = isWaitingConfirmationToolResult(result);
        const operationID = operationIDForTool(productTask?.id, capability, args, result.call_id);
        this.insertRunStep(runID, 'capability_requested', 'Model requested capability tool', { agent_id: agentID, call_id: result.call_id, tool_name: result.name }, { capability, goal: requestedAction, inputs: args, risk, source: 'tool_calling', operation_id: operationID });
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'tool.call_requested', {
          item_type: 'tool_run',
          item_id: result.call_id,
          call_id: result.call_id,
          capability,
          tool_name: result.name,
          purpose: requestedAction,
          status: 'requested',
          visibility: 'tool',
          source: 'model_provider',
          input: args,
          risk,
          operation_id: operationID,
        });
        this.insertTurnItem(runID, turnID, itemSeq++, 'tool_call', 'assistant', result.call_id, result.name, args, '', {}, resultWaiting ? 'waiting_confirmation' : 'completed', { capability });
        if (resultWaiting) {
          const confirmationID = `confirm_${newID()}`;
          const approvalKey = result.call_id || confirmationID;
          const confirmationInput = confirmationInputForTool(productTask?.id, capability, args, result.call_id, requestedAction);
          const approvalPayload = {
            ...result.output,
            status: 'waiting_confirmation',
            run_id: runID,
            turn_id: turnID,
            call_id: result.call_id,
            confirmation_id: confirmationID,
            capability,
            risk,
            approval_scope: 'one_call',
            approval_key: approvalKey,
            operation_id: confirmationInput.operation_id,
            affected_paths: confirmationInput.affected_paths,
            external_target: confirmationInput.external_target,
            reversible: confirmationInput.reversible,
            requested_action: requestedAction,
            message: confirmationMessageForToolResult(result),
          };
          this.exec(
            `INSERT INTO confirmation_requests (id, run_id, capability_id, requested_action, risk_level, status, input, call_id, turn_id, approval_scope, approval_key)
             VALUES (?, ?, NULLIF(?, ''), ?, ?, 'pending', ?, NULLIF(?, ''), ?, 'one_call', ?)`,
            confirmationID,
            runID,
            persistedCapabilityID,
            requestedAction,
            risk,
            json(confirmationInput),
            result.call_id,
            turnID,
            approvalKey,
          );
          this.insertRunStep(runID, 'approval_requested', 'Tool execution waiting for confirmation', { agent_id: agentID, call_id: result.call_id, capability }, approvalPayload, 'waiting_confirmation');
          this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'tool.approval_required', {
            item_type: 'tool_run',
            item_id: result.call_id,
            call_id: result.call_id,
            confirmation_id: confirmationID,
            capability,
            tool_name: result.name,
            status: 'waiting_confirmation',
            visibility: 'approval',
            source: 'store',
            purpose: requestedAction,
            risk,
            operation_id: confirmationInput.operation_id,
          });
          this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'approval.requested', approvalPayload);
          this.insertTurnItem(runID, turnID, itemSeq++, 'tool_output', 'tool', result.call_id, result.name, {}, JSON.stringify(approvalPayload), approvalPayload, 'waiting_confirmation', { confirmation_id: confirmationID, capability });
          this.recordProductTaskToolCheckpoint(productTask?.id, {
            run_id: runID,
            capability,
            requested_action: requestedAction,
            input: confirmationInput,
            output: approvalPayload,
            status: 'waiting_confirmation',
            operation_id: String(confirmationInput.operation_id || operationID),
          });
          continue;
        }
        const toolRunID = `toolrun_${newID()}`;
        const toolStatus = toolRunStatusForOutput(result.output);
        const toolSummary = summaryForToolOutput(result.output, toolStatus);
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'tool.started', {
          item_type: 'tool_run',
          item_id: result.call_id,
          tool_run_id: toolRunID,
          call_id: result.call_id,
          capability,
          tool_name: result.name,
          purpose: requestedAction,
          status: 'running',
          visibility: 'tool',
          source: 'tool',
          operation_id: operationID,
        });
        this.exec(
          `INSERT INTO tool_runs (id, run_id, turn_id, tool_call_id, capability_id, workflow_name, tool_name, purpose,
                                  node_id, assignment_reason, risk_level, side_effect_level, idempotency_key,
                                  status, input, output, output_summary, error_code, error_message, finished_at, completed_at, duration_ms)
           VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, 'main-node', 'model_tool_call', ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), datetime('now'), datetime('now'), ?)`,
          toolRunID,
          runID,
          turnID,
          result.call_id,
          persistedCapabilityID,
          workflowName,
          result.name,
          requestedAction,
          risk,
          toolResultSideEffect(result, capability),
          operationID,
          toolStatus,
          json(args),
          json(result.output),
          toolSummary,
          toolResultErrorCode(result, toolStatus),
          toolResultErrorMessage(result, toolStatus),
          toolResultDuration(result),
        );
        this.insertRunStep(runID, 'tool_finished', 'Tool runtime finished', { workflow_name: workflowName, tool_run_id: toolRunID, call_id: result.call_id }, result.output);
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), toolStatus === 'failed' ? 'tool.failed' : toolStatus === 'policy_blocked' ? 'tool.policy_blocked' : 'tool.completed', {
          item_type: 'tool_run',
          item_id: result.call_id,
          tool_run_id: toolRunID,
          call_id: result.call_id,
          capability,
          tool_name: result.name,
          purpose: requestedAction,
          status: toolStatus,
          visibility: 'tool',
          source: 'tool',
          summary: toolSummary,
          operation_id: operationID,
          output: result.output,
        });
        this.insertTurnItem(runID, turnID, itemSeq++, 'tool_output', 'tool', result.call_id, result.name, {}, JSON.stringify(result.output), result.output, 'completed', { tool_run_id: toolRunID, capability });
        this.recordProductTaskToolCheckpoint(productTask?.id, {
          run_id: runID,
          capability,
          requested_action: requestedAction,
          input: args,
          output: { ...result.output, operation_id: operationID },
          status: toolStatus === 'failed' || toolStatus === 'policy_blocked' ? 'failed' : 'done',
          tool_run_id: toolRunID,
          operation_id: operationID,
        });
      }
      artifacts = this.finalizeProductTaskAfterRun(productTask?.id, {
        run_id: runID,
        conversation_id: conversationID,
        message_id: assistantMessageID,
        response,
        waiting_confirmation: waitingConfirmation,
        tool_results: toolResults,
        runtime_status: turn.status || 'completed',
      });
      if (productTask?.id) {
        productTask = this.getProductTask(productTask.id).task;
      }
      if (!waitingConfirmation) {
        this.recordPostRunMemoryLearning(req, runID, turnID, response);
        this.attributeMemoryInfluence(runID, response);
      }

      const persistedToolRunCount = this.persistedToolRunCountForRun(runID);
      this.insertRunStep(runID, 'model_call_finished', 'Model call finished', { agent_id: agentID, model_id: modelName, prompt_assembly_id: promptAssemblyID }, { provider, model: modelName, real_model: provider !== 'mock_provider', fallback_to_mock: false, ...normalizedUsage, estimated_cost: roundCost(costEstimate), tool_run_count: persistedToolRunCount });
      if (!waitingConfirmation) {
        this.insertRunStep(runID, 'agent_output_parsed', 'Agent output parsed', { turn: 1 }, { repaired: false, output_type: 'final_answer' });
        this.insertRunStep(runID, 'response_generated', 'Response generated', {}, { response }, 'succeeded');
        this.insertTurnItem(runID, turnID, itemSeq++, 'message', 'assistant', '', '', {}, response, {}, 'completed', { final_answer: true, waiting_confirmation: false });
      }

      this.exec(
        `INSERT INTO model_calls (id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name,
                                  prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, output_tokens,
                                  cached_input_tokens, cache_write_input_tokens, reasoning_tokens, total_tokens,
                                  cost_estimate, latency_ms, status, streaming_enabled, completed_at,
                                  finish_reason, usage_status, raw_response, raw_finish_json, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'succeeded', ?, datetime('now'), ?, ?, ?, ?, ?, datetime('now'))`,
        modelCallID,
        runID,
        agentID,
        modelName,
        promptAssemblyID,
        provider,
        modelName,
        promptCacheKey,
        prefixHash,
        dynamicTailHash,
        normalizedUsage.input_tokens,
        normalizedUsage.output_tokens,
        normalizedUsage.cached_input_tokens,
        normalizedUsage.cache_write_input_tokens,
        normalizedUsage.reasoning_tokens,
        normalizedUsage.total_tokens,
        roundCost(costEstimate),
        1,
        turn.status || 'completed',
        usageStatus,
        json({ responses: turn.model_responses || [] }),
        json({ status: turn.status || 'completed', usage_status: usageStatus }),
        json({ source: 'electron_ts_tool_calling', real_model: provider !== 'mock_provider', fallback_to_mock: false, tool_run_count: persistedToolRunCount, usage_status: usageStatus, estimated_cost: roundCost(costEstimate), input_tokens_include_cached: true }),
      );

      if (waitingConfirmation) {
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'usage.recorded', { run_id: runID, turn_id: turnID, item_type: 'model', item_id: modelCallID, status: usageStatus, visibility: 'trace_only', source: 'store', usage: normalizedUsage, usage_status: usageStatus, estimated_cost: roundCost(costEstimate), type: 'usage.recorded' });
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'run.waiting_approval', { run_id: runID, turn_id: turnID, status: 'waiting_approval', message: 'waiting for approval', visibility: 'inline_status', type: 'run.waiting_approval' });
      } else {
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'assistant.delta', { run_id: runID, turn_id: turnID, item_type: 'assistant_message', item_id: assistantMessageID, delta: { text: response, stream_source: 'fallback_final_chunk' }, status: 'completed', visibility: 'chat', source: 'store', type: 'assistant.delta' });
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'assistant.completed', { run_id: runID, turn_id: turnID, item_type: 'assistant_message', item_id: assistantMessageID, delta: { text: response }, status: 'completed', visibility: 'chat', source: 'store', terminal: true, type: 'assistant.completed' });
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'usage.recorded', { run_id: runID, turn_id: turnID, item_type: 'model', item_id: modelCallID, status: usageStatus, visibility: 'trace_only', source: 'store', usage: normalizedUsage, usage_status: usageStatus, estimated_cost: roundCost(costEstimate), type: 'usage.recorded' });
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'message.delta', { run_id: runID, turn_id: turnID, delta: response, status: 'completed', visibility: 'trace_only', source: 'store', type: 'message.delta' });
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'turn.completed', { run_id: runID, turn_id: turnID, status: 'completed', type: 'turn.completed' });
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'run.completed', { run_id: runID, status: 'succeeded', terminal: true, type: 'run.completed' });
      }
      this.recordRoomRoutingDecision(req, {
        conversation_id: conversationID,
        message_id: userMessageID,
        run_id: runID,
        agent_id: agentID,
        route_result: { route: 'electron_ts_tool_calling', agent_id: agentID, agent_route: agentRoute, model: modelName, provider, room_kernel: roomRoute ? routeResolutionForTrace(roomRoute) : undefined },
        room_route: roomRoute,
      });
    });

    return {
      conversation_id: conversationID,
      user_message_id: userMessageID,
      assistant_message_id: assistantMessageID,
      run_id: runID,
      selected_agent_id: agentID,
      response,
      ui: {
        interaction_class: 'chat',
        requires_user_input: waitingConfirmation,
        missing_input: waitingConfirmation ? 'confirmation' : undefined,
        inline_execution: toolResults.length > 0,
      },
      model_calls: [],
      used_memories: prompt.memory_results || [],
      product_task: productTask,
      artifacts,
    };
  }

  listConversations(filter: ConversationFilter = { view: 'active', limit: 100 }): { conversations: ConversationSummary[] } {
    const lifecycle = lifecycleForView(filter.view);
    const limit = clampLimit(filter.limit, 100);
    const where: string[] = [];
    const params: SQLiteValue[] = [];
    if (lifecycle) {
      where.push('c.lifecycle_status = ?');
      params.push(lifecycle);
    }
    if (filter.group_id) {
      where.push('c.group_id = ?');
      params.push(filter.group_id);
    }
    const query = filter.query?.trim();
    if (query) {
      const like = `%${escapeLike(query)}%`;
      where.push(`(
        c.id LIKE ? ESCAPE '\\'
        OR c.title LIKE ? ESCAPE '\\'
        OR COALESCE(c.topic, '') LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM messages search_messages
          WHERE search_messages.conversation_id=c.id
            AND search_messages.content LIKE ? ESCAPE '\\'
        )
      )`);
      params.push(like, like, like, like);
    }
    const rows = this.all(
      `SELECT
         c.*,
         (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY datetime(m.created_at) DESC, m.rowid DESC LIMIT 1) AS last_message,
         (SELECT role FROM messages m WHERE m.conversation_id = c.id ORDER BY datetime(m.created_at) DESC, m.rowid DESC LIMIT 1) AS last_role,
         (SELECT r.id FROM runs r WHERE r.conversation_id = c.id ORDER BY datetime(r.created_at) DESC, r.id DESC LIMIT 1) AS latest_run_id,
         (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
       FROM conversations c
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY c.pinned DESC, datetime(c.updated_at) DESC, c.id DESC
       LIMIT ?`,
      ...params,
      limit,
    );
    return { conversations: rows.map(rowToConversationSummary) };
  }

  listPersonaMessenger(): PersonaMessengerSnapshot {
    this.syncPersonaMessengerRooms();
    const projects = this.all(
      `SELECT * FROM projects
       WHERE status != 'deleted'
       ORDER BY
         CASE status WHEN 'active' THEN 0 WHEN 'warm' THEN 1 WHEN 'dormant' THEN 2 WHEN 'archived' THEN 3 ELSE 4 END,
         datetime(updated_at) DESC,
         id ASC`,
    ).map(rowToMessengerProject);
    const personas = this.all(
      `SELECT * FROM personas
       WHERE status != 'deleted'
       ORDER BY
         CASE status WHEN 'active' THEN 0 WHEN 'warm' THEN 1 WHEN 'dormant' THEN 2 WHEN 'archived' THEN 3 ELSE 4 END,
         datetime(updated_at) DESC,
         id ASC`,
    ).map(rowToProjectPersona);
    const personaVersions = this.all(
      `SELECT * FROM persona_versions
       ORDER BY datetime(created_at) DESC, version DESC
       LIMIT 100`,
    ).map(rowToPersonaVersion);
    const roomConnectors = this.all(
      `SELECT * FROM room_connectors
       ORDER BY datetime(updated_at) DESC, id ASC`,
    ).map(rowToRoomConnector);
    const recentExternalEvents = this.all(
      `SELECT * FROM external_connector_events
       ORDER BY datetime(created_at) DESC
       LIMIT 50`,
    ).map(rowToExternalConnectorEvent);
    const threads = this.all(
      `SELECT mt.*,
              p.name AS project_name,
              r.title AS room_title,
              ps.display_name AS owner_persona_name,
              (SELECT COUNT(*) FROM messenger_thread_events te WHERE te.thread_id=mt.id AND te.message_id IS NOT NULL) AS message_count,
              (SELECT COUNT(DISTINCT te.run_id) FROM messenger_thread_events te WHERE te.thread_id=mt.id AND te.run_id IS NOT NULL) AS run_count,
              (SELECT COUNT(DISTINCT te.artifact_id) FROM messenger_thread_events te WHERE te.thread_id=mt.id AND te.artifact_id IS NOT NULL) AS artifact_count,
              (SELECT rn.status FROM runs rn WHERE rn.id IN (
                 SELECT te.run_id FROM messenger_thread_events te WHERE te.thread_id=mt.id AND te.run_id IS NOT NULL
               ) ORDER BY datetime(rn.created_at) DESC LIMIT 1) AS latest_run_status
       FROM messenger_threads mt
       LEFT JOIN projects p ON p.id=mt.project_id
       LEFT JOIN rooms r ON r.id=mt.room_id
       LEFT JOIN personas ps ON ps.id=mt.owner_persona_id
       ORDER BY datetime(mt.updated_at) DESC, mt.id DESC
       LIMIT 200`,
    ).map(rowToMessengerThread);
    const recentThreadEvents = this.all(
      `SELECT * FROM messenger_thread_events
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT 100`,
    ).map(rowToMessengerThreadEvent);
    const locks = this.all(
      `SELECT room_id, user_id, persona_id, started_at, expires_at, status
       FROM route_locks
       WHERE status='active'
       ORDER BY datetime(started_at) DESC`,
    ).map(rowToRouteLock);
    const rooms = this.all(
      `SELECT
         r.*,
         (SELECT persona_id FROM route_locks rl WHERE rl.room_id=r.id AND rl.status='active' ORDER BY datetime(rl.started_at) DESC LIMIT 1) AS route_lock_persona_id,
         (SELECT content FROM messages m WHERE m.conversation_id = r.conversation_id ORDER BY datetime(m.created_at) DESC, m.rowid DESC LIMIT 1) AS last_message,
         (SELECT role FROM messages m WHERE m.conversation_id = r.conversation_id ORDER BY datetime(m.created_at) DESC, m.rowid DESC LIMIT 1) AS last_role,
         (SELECT COUNT(*) FROM confirmation_requests cr WHERE cr.status='pending') AS pending_approval_count,
         (SELECT COUNT(*) FROM runs rn WHERE rn.conversation_id = r.conversation_id AND rn.status IN ('running','pending','queued','waiting_approval')) AS running_run_count,
         (SELECT COUNT(*) FROM runs rn WHERE rn.conversation_id = r.conversation_id AND rn.status='failed') AS failed_run_count
       FROM rooms r
       WHERE r.archived_at IS NULL
         AND (
           r.type != 'project_dm'
           OR COALESCE(json_extract(r.metadata, '$.mapped_from_conversation'), 0) != 1
         )
         AND (
           r.project_id IS NULL
           OR EXISTS (
             SELECT 1 FROM projects p
             WHERE p.id=r.project_id
               AND p.archived_at IS NULL
               AND p.status NOT IN ('deleted', 'archived')
           )
         )
       ORDER BY
         CASE
           WHEN r.id='room_private_hub' THEN 0
           WHEN r.id='room_joi_dm' THEN 1
           WHEN r.type='project_dm' THEN 2
           WHEN r.type='shared' THEN 3
           WHEN r.type='external_mirror' THEN 4
           WHEN r.type='human_dm' THEN 5
           ELSE 6
         END,
         datetime(r.updated_at) DESC,
         r.id ASC`,
    ).map((row) => this.attachRoomPermissionAudit(rowToMessengerRoom(row, this.listRoomMembers(String(row.id)))));
    const recentRouting = this.all(
      `SELECT * FROM routing_decisions
       ORDER BY datetime(created_at) DESC
       LIMIT 20`,
    ).map(rowToRoutingDecision);
    return {
      rooms,
      projects,
      personas,
      persona_versions: personaVersions,
      room_connectors: roomConnectors,
      recent_external_events: recentExternalEvents,
      route_locks: locks,
      recent_routing_decisions: recentRouting,
      threads,
      recent_thread_events: recentThreadEvents,
      checkpoint: this.buildCheckpointSummary(),
    };
  }

  generateProjectPersonaCandidates(req: GenerateProjectPersonaCandidatesRequest): { candidates: PersonaCandidate[] } {
    this.syncPersonaMessengerRooms();
    return { candidates: this.buildPersonaCandidates(req) };
  }

  createProjectPersona(req: CreateProjectPersonaRequest): { project: MessengerProject; persona: ProjectPersona; room: MessengerRoom } {
    this.syncPersonaMessengerRooms();
    const projectName = req.project_name.trim();
    if (!projectName) throw new Error('project_name is required');
    const projectID = `prj_${newID()}`;
    const personaID = `per_${newID()}`;
    const roomID = `room_${newID()}`;
    const conversationID = `conv_${newID()}`;
    const candidates = this.buildPersonaCandidates(req);
    const candidate = candidates.find((item) => item.id === req.candidate_id) ?? candidates[0];
    const displayName = req.persona_choice?.display_name?.trim() || candidate.display_name;
    const handle = this.uniquePersonaHandle(req.persona_choice?.handle || candidate.handle || displayName, projectName);
    const traits = {
      ...candidate.traits,
      ...(req.persona_choice?.traits || {}),
    };
    const tagline = req.persona_choice?.tagline?.trim() || candidate.tagline;
    const intro = req.persona_choice?.self_intro?.trim() || candidate.self_intro;
    this.transaction(() => {
      this.exec(
        `INSERT INTO projects (id, name, goal, domain, phase, risk_level, status, summary, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'low', 'active', ?, ?, datetime('now'), datetime('now'))`,
        projectID,
        projectName,
        req.project_goal || '',
        req.domain || '',
        req.phase || '',
        req.project_goal || `${projectName} 项目工作空间`,
        json({
          created_from: 'persona_messenger',
          persona_candidates: candidates,
          selected_persona_candidate_id: candidate.id,
        }),
      );
      this.exec(
        `INSERT INTO personas (id, project_id, display_name, handle, avatar, tagline, self_intro, traits,
                               disagreement_style, uncertainty_style, status, version, capabilities,
                               permission_summary, model_strategy, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        personaID,
        projectID,
        displayName,
        handle,
        req.persona_choice?.avatar || '',
        tagline,
        intro,
        json(traits),
        req.persona_choice?.disagreement_style || candidate.disagreement_style,
        req.persona_choice?.uncertainty_style || candidate.uncertainty_style,
        json(req.persona_choice?.capabilities || ['chat', 'memory', 'trace', 'tool_request']),
        req.persona_choice?.permission_summary || '默认只读；高风险外部动作需要审批',
        req.persona_choice?.model_strategy || '使用当前桌面默认模型策略',
        json({ ai_identity_label: '项目人格', created_from: 'persona_messenger', selected_candidate_id: candidate.id }),
      );
      this.upsertPersonaAgent(personaID, displayName, tagline, intro, req.persona_choice?.capabilities || ['chat', 'memory', 'trace', 'tool_request']);
      this.exec(
        `INSERT INTO conversations (id, channel, user_id, title, active_agent_id, active_project_id, lifecycle_status, metadata, created_at, updated_at)
         VALUES (?, 'desktop', 'desktop_user', ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))`,
        conversationID,
        `${displayName} · ${projectName}`,
        personaID,
        projectID,
        json({ room_id: roomID, room_type: 'project_dm', persona_id: personaID, project_id: projectID }),
      );
      this.exec(
        `INSERT INTO rooms (id, type, title, subtitle, owner_user_id, project_id, persona_id, conversation_id,
                            default_ai_participation, floor_holder_persona_id, metadata, created_at, updated_at)
         VALUES (?, 'project_dm', ?, ?, 'desktop_user', ?, ?, ?, 'moderate', ?, ?, datetime('now'), datetime('now'))`,
        roomID,
        displayName,
        projectName,
        projectID,
        personaID,
        conversationID,
        personaID,
        json({ created_from: 'persona_messenger' }),
      );
      this.upsertRoomMember(roomID, 'user', 'desktop_user', '你', 'owner');
      this.upsertRoomMember(roomID, 'persona', personaID, displayName, 'persona', personaID, projectID);
      this.upsertRoomMember('room_private_hub', 'persona', personaID, displayName, 'persona', personaID, projectID);
      this.exec(
        `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
         VALUES (?, ?, 'system', ?, '[]', ?, datetime('now'))`,
        `msg_${newID()}`,
        'conv_private_hub',
        `${displayName} 加入了群聊：${tagline}`,
        json({ persona_id: personaID, project_id: projectID, room_id: 'room_private_hub', event_type: 'persona.joined' }),
      );
    });
    return {
      project: this.requireMessengerProject(projectID),
      persona: this.requireProjectPersona(personaID),
      room: this.requireMessengerRoom(roomID),
    };
  }

  updateProjectPersona(req: UpdateProjectPersonaRequest): ProjectPersona {
    const personaID = req.persona_id.trim();
    if (!personaID) throw new Error('persona_id is required');
    if (!req.change_reason.trim()) throw new Error('change_reason is required');
    const before = this.requireProjectPersona(personaID);
    if (req.base_version && req.base_version !== before.version) {
      throw new Error(`Persona version conflict: expected ${req.base_version}, current ${before.version}`);
    }
    this.assertPersonaMutationAllowed(req, before);
    const nextVersion = before.version + 1;
    const nextHandle = req.handle ? this.uniquePersonaHandle(req.handle, before.project_id, personaID) : before.handle;
    const nextMetadata = { ...(before.metadata || {}) };
    if (req.model_reasoning_effort !== undefined) {
      nextMetadata.model_reasoning_effort = normalizeReasoningEffort(req.model_reasoning_effort);
    }
    const after: ProjectPersona = {
      ...before,
      display_name: req.display_name?.trim() || before.display_name,
      handle: nextHandle,
      avatar: req.avatar ?? before.avatar,
      tagline: req.tagline ?? before.tagline,
      self_intro: req.self_intro ?? before.self_intro,
      traits: req.traits || before.traits,
      disagreement_style: req.disagreement_style ?? before.disagreement_style,
      uncertainty_style: req.uncertainty_style ?? before.uncertainty_style,
      permission_summary: req.permission_summary ?? before.permission_summary,
      model_strategy: req.model_strategy ?? before.model_strategy,
      model_reasoning_effort: optionalReasoningEffort(nextMetadata.model_reasoning_effort),
      metadata: nextMetadata,
      version: nextVersion,
    };
    this.transaction(() => {
      this.exec(
        `UPDATE personas
         SET display_name=?, handle=?, avatar=?, tagline=?, self_intro=?, traits=?,
             disagreement_style=?, uncertainty_style=?, permission_summary=?, model_strategy=?, version=?, metadata=?, updated_at=datetime('now')
         WHERE id=?`,
        after.display_name,
        after.handle,
        after.avatar || '',
        after.tagline || '',
        after.self_intro || '',
        json(after.traits),
        after.disagreement_style || '',
        after.uncertainty_style || '',
        after.permission_summary || '',
        after.model_strategy || '',
        after.version,
        json(after.metadata || {}),
        personaID,
      );
      this.exec(
        `INSERT INTO persona_versions (id, persona_id, version, changed_by, change_reason, before_json, after_json, created_at)
         VALUES (?, ?, ?, 'desktop_user', ?, ?, ?, datetime('now'))`,
        `pver_${newID()}`,
        personaID,
        nextVersion,
        req.change_reason,
        json(before),
        json(after),
      );
      this.exec(
        `UPDATE rooms SET title=?, subtitle=COALESCE((SELECT name FROM projects WHERE id=?), subtitle), updated_at=datetime('now') WHERE persona_id=? AND type='project_dm'`,
        after.display_name,
        after.project_id,
        personaID,
      );
      this.upsertPersonaAgent(after.id, after.display_name, after.tagline || '', after.self_intro || '', after.capabilities);
    });
    return this.requireProjectPersona(personaID);
  }

  rollbackProjectPersona(req: RollbackProjectPersonaRequest): ProjectPersona {
    const personaID = req.persona_id.trim();
    if (!personaID) throw new Error('persona_id is required');
    if (!req.change_reason.trim()) throw new Error('change_reason is required');
    const before = this.requireProjectPersona(personaID);
    const versionRow = this.get(
      `SELECT * FROM persona_versions WHERE persona_id=? AND version=? ORDER BY datetime(created_at) DESC LIMIT 1`,
      personaID,
      req.target_version,
    );
    if (!versionRow) throw new Error(`Persona version not found: ${req.target_version}`);
    this.assertPersonaMutationAllowed(req, before);
    const versionSnapshot = parseObject(versionRow.after_json) as Partial<ProjectPersona>;
    const restored: ProjectPersona = {
      ...before,
      ...versionSnapshot,
      id: before.id,
      project_id: before.project_id,
      version: before.version + 1,
      metadata: {
        ...before.metadata,
        rolled_back_from_version: before.version,
        restored_snapshot_version: req.target_version,
      },
    };
    this.transaction(() => {
      this.exec(
        `UPDATE personas
         SET display_name=?, handle=?, avatar=?, tagline=?, self_intro=?, traits=?,
             disagreement_style=?, uncertainty_style=?, permission_summary=?, model_strategy=?, version=?, metadata=?, updated_at=datetime('now')
         WHERE id=?`,
        restored.display_name,
        this.uniquePersonaHandle(restored.handle, restored.project_id, personaID),
        restored.avatar || '',
        restored.tagline || '',
        restored.self_intro || '',
        json(restored.traits),
        restored.disagreement_style || '',
        restored.uncertainty_style || '',
        restored.permission_summary || '',
        restored.model_strategy || '',
        restored.version,
        json(restored.metadata || {}),
        personaID,
      );
      this.exec(
        `INSERT INTO persona_versions (id, persona_id, version, changed_by, change_reason, before_json, after_json, created_at)
         VALUES (?, ?, ?, 'desktop_user', ?, ?, ?, datetime('now'))`,
        `pver_${newID()}`,
        personaID,
        restored.version,
        req.change_reason,
        json(before),
        json(restored),
      );
      this.exec(
        `UPDATE rooms SET title=?, subtitle=COALESCE((SELECT name FROM projects WHERE id=?), subtitle), updated_at=datetime('now') WHERE persona_id=? AND type='project_dm'`,
        restored.display_name,
        restored.project_id,
        personaID,
      );
      this.upsertPersonaAgent(restored.id, restored.display_name, restored.tagline || '', restored.self_intro || '', restored.capabilities);
    });
    return this.requireProjectPersona(personaID);
  }

  createSharedRoom(req: CreateSharedRoomRequest): { room: MessengerRoom } {
    this.syncPersonaMessengerRooms();
    const title = req.title.trim();
    if (!title) throw new Error('title is required');
    if (!req.persona_ids.length) throw new Error('at least one persona is required');
    if (!req.human_members.length) throw new Error('at least one human member is required');
    const personas = req.persona_ids.map((id) => this.requireProjectPersona(id));
    const visibleProjectIDs = [...new Set(req.visible_project_ids?.length ? req.visible_project_ids : personas.map((persona) => persona.project_id))];
    const roomID = `room_${newID()}`;
    const conversationID = `conv_${newID()}`;
    const participation = req.ai_participation || 'moderate';
    this.transaction(() => {
      this.exec(
        `INSERT INTO conversations (id, channel, user_id, title, active_agent_id, active_project_id, lifecycle_status, metadata, created_at, updated_at)
         VALUES (?, 'desktop', 'desktop_user', ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))`,
        conversationID,
        title,
        personas[0]?.id || null,
        visibleProjectIDs[0] || null,
        json({ room_id: roomID, room_type: 'shared', visible_project_ids: visibleProjectIDs }),
      );
      this.exec(
        `INSERT INTO rooms (id, type, title, subtitle, owner_user_id, project_id, persona_id, conversation_id,
                            default_ai_participation, floor_holder_persona_id, metadata, created_at, updated_at)
         VALUES (?, 'shared', ?, ?, 'desktop_user', NULLIF(?, ''), NULLIF(?, ''), ?, ?, NULLIF(?, ''), ?, datetime('now'), datetime('now'))`,
        roomID,
        title,
        req.permission_summary || '共享房间',
        visibleProjectIDs[0] || '',
        personas[0]?.id || '',
        conversationID,
        participation,
        participation === 'active' || participation === 'moderate' ? personas[0]?.id || '' : '',
        json({
          created_from: 'persona_messenger',
          visible_project_ids: visibleProjectIDs,
          visible_persona_ids: personas.map((persona) => persona.id),
          permission_summary: req.permission_summary || '仅当前房间成员和授权项目人格可见',
          tool_policy: req.tool_policy || { external_actions: { send_message: 'approval_required', publish: 'denied' } },
          data_visibility: 'room_members',
        }),
      );
      this.upsertRoomMember(roomID, 'user', 'desktop_user', '你', 'room_owner', '', '', {
        visible_project_ids: visibleProjectIDs,
        can_approve_high_risk: true,
        approval_policy: 'owner_allowed',
      }, 'selected_members');
      for (const persona of personas) {
        this.upsertRoomMember(roomID, 'persona', persona.id, persona.display_name, 'persona', persona.id, persona.project_id, {
          visible_project_ids: [persona.project_id].filter((id) => visibleProjectIDs.includes(id)),
          data_visibility: 'room_plus_own_project_grants',
          can_approve_high_risk: false,
        }, 'selected_members');
      }
      for (const [index, human] of req.human_members.entries()) {
        const displayName = human.display_name.trim();
        if (!displayName) throw new Error('human display_name is required');
        const memberID = human.external_user_id?.trim() || `human_${newID()}`;
        const humanVisibleProjects = (human.visible_project_ids ? human.visible_project_ids : visibleProjectIDs)
          .filter((id) => visibleProjectIDs.includes(id));
        this.upsertRoomMember(roomID, 'human', memberID, displayName, human.role || 'human_member', '', '', {
          profile: human.profile || '',
          invite_index: index,
          data_visibility: 'room_members',
          visible_project_ids: humanVisibleProjects,
          can_approve_high_risk: Boolean(human.can_approve_high_risk),
          approval_policy: human.can_approve_high_risk ? 'high_risk_allowed' : 'approval_denied',
        }, 'selected_members');
      }
      this.exec(
        `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
         VALUES (?, ?, 'system', ?, '[]', ?, datetime('now'))`,
        `msg_${newID()}`,
        conversationID,
        `${title} 已创建为共享房间`,
        json({ room_id: roomID, event_type: 'shared_room.created', visible_project_ids: visibleProjectIDs }),
      );
    });
    return { room: this.requireMessengerRoom(roomID) };
  }

  updateMessengerRoom(req: UpdateMessengerRoomRequest): { room: MessengerRoom } {
    this.syncPersonaMessengerRooms();
    const roomID = req.room_id.trim();
    if (!roomID) throw new Error('room_id is required');
    const row = this.get(`SELECT id, title, conversation_id, metadata FROM rooms WHERE id=?`, roomID);
    if (!row) throw new Error(`Room not found: ${roomID}`);
    const currentTitle = optionalString(row.title) || '未命名群聊';
    const title = req.title?.trim() || currentTitle;
    const metadata = parseObject(row.metadata);
    if (req.avatar !== undefined) {
      const avatar = req.avatar.trim();
      if (avatar) {
        metadata.avatar = avatar;
      } else {
        delete metadata.avatar;
      }
    }
    this.transaction(() => {
      this.exec(
        `UPDATE rooms SET title=?, metadata=?, updated_at=datetime('now') WHERE id=?`,
        title,
        json(metadata),
        roomID,
      );
      const conversationID = optionalString(row.conversation_id);
      if (conversationID) {
        this.exec(
          `UPDATE conversations SET title=?, updated_at=datetime('now') WHERE id=?`,
          title,
          conversationID,
        );
      }
    });
    return { room: this.requireMessengerRoom(roomID) };
  }

  updateMessengerProject(req: UpdateMessengerProjectRequest): { project: MessengerProject } {
    this.syncPersonaMessengerRooms();
    const projectID = req.project_id.trim();
    if (!projectID) throw new Error('project_id is required');
    const before = this.requireMessengerProject(projectID);
    const nextName = req.name?.trim() || before.name;
    const metadata = {
      ...(before.metadata || {}),
    };
    if (req.local_path !== undefined) {
      const localPath = req.local_path.trim();
      if (localPath) {
        metadata.local_path = localPath;
      } else {
        delete metadata.local_path;
      }
    }
    this.transaction(() => {
      this.exec(
        `UPDATE projects SET name=?, metadata=?, updated_at=datetime('now') WHERE id=?`,
        nextName,
        json(metadata),
        projectID,
      );
      this.exec(
        `UPDATE rooms SET subtitle=?, updated_at=datetime('now') WHERE project_id=? AND type='project_dm'`,
        nextName,
        projectID,
      );
      this.exec(
        `UPDATE conversations
         SET title=COALESCE((SELECT display_name || ' · ' || ? FROM personas WHERE personas.id=conversations.active_agent_id LIMIT 1), title),
             updated_at=datetime('now')
         WHERE id IN (SELECT conversation_id FROM rooms WHERE project_id=? AND type='project_dm')`,
        nextName,
        projectID,
      );
    });
    return { project: this.requireMessengerProject(projectID) };
  }

  connectExternalMirrorRoom(req: ConnectExternalMirrorRoomRequest): { connector: RoomConnector; room: MessengerRoom } {
    this.syncPersonaMessengerRooms();
    const provider = req.provider.trim().toLowerCase();
    const externalRoomID = req.external_room_id.trim();
    if (!provider) throw new Error('provider is required');
    if (!externalRoomID) throw new Error('external_room_id is required');
    const visiblePersonas = req.persona_ids.map((id) => this.requireProjectPersona(id));
    if (!visiblePersonas.length) throw new Error('at least one visible persona is required');
    let roomID = req.room_id?.trim() || '';
    let conversationID = '';
    this.transaction(() => {
      if (!roomID) {
        roomID = `room_${newID()}`;
        conversationID = `conv_${newID()}`;
        this.exec(
          `INSERT INTO conversations (id, channel, user_id, title, active_agent_id, active_project_id, lifecycle_status, metadata, created_at, updated_at)
           VALUES (?, ?, 'desktop_user', ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))`,
          conversationID,
          provider,
          req.title?.trim() || `${provider}:${externalRoomID}`,
          visiblePersonas[0].id,
          visiblePersonas[0].project_id,
          json({ room_id: roomID, room_type: 'external_mirror', provider, external_room_id: externalRoomID }),
        );
        this.exec(
          `INSERT INTO rooms (id, type, title, subtitle, owner_user_id, project_id, persona_id, conversation_id,
                              default_ai_participation, floor_holder_persona_id, metadata, created_at, updated_at)
           VALUES (?, 'external_mirror', ?, ?, 'desktop_user', ?, ?, ?, 'mention_only', ?, ?, datetime('now'), datetime('now'))`,
          roomID,
          req.title?.trim() || `${provider} 映射房间`,
          `${provider} · ${externalRoomID}`,
          visiblePersonas[0].project_id,
          visiblePersonas[0].id,
          conversationID,
          visiblePersonas[0].id,
          json({ created_from: 'external_connector', provider, external_room_id: externalRoomID }),
        );
        this.upsertRoomMember(roomID, 'user', 'desktop_user', '你', 'room_owner');
      } else {
        const existing = this.requireMessengerRoom(roomID);
        conversationID = existing.conversation_id || '';
      }
      for (const persona of visiblePersonas) {
        this.upsertRoomMember(roomID, 'persona', persona.id, persona.display_name, 'persona', persona.id, persona.project_id);
      }
      this.exec(
        `INSERT INTO room_connectors (id, room_id, provider, connector_id, external_room_id, status, visible_persona_ids,
                                     allow_temporary_invite, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(provider, external_room_id) DO UPDATE SET
           room_id=excluded.room_id,
           status='active',
           visible_persona_ids=excluded.visible_persona_ids,
           allow_temporary_invite=excluded.allow_temporary_invite,
           metadata=excluded.metadata,
           updated_at=datetime('now')`,
        `rconn_${stableShortID(`${provider}:${externalRoomID}`)}`,
        roomID,
        provider,
        `${provider}:${externalRoomID}`,
        externalRoomID,
        json(visiblePersonas.map((persona) => persona.id)),
        req.allow_temporary_invite ? 1 : 0,
        json({ connector_to_room: true, title: req.title || '', visible_project_ids: visiblePersonas.map((persona) => persona.project_id) }),
      );
    });
    const connector = this.requireRoomConnector(provider, externalRoomID);
    return { connector, room: this.requireMessengerRoom(connector.room_id) };
  }

  recordExternalConnectorOutbound(req: RecordExternalConnectorOutboundRequest): { event: ExternalConnectorEvent; room: MessengerRoom; message_id: string; duplicate: boolean } {
    const connector = this.resolveConnectorForExternal(req);
    const externalMessageID = req.external_message_id.trim();
    if (!externalMessageID) throw new Error('external_message_id is required');
    const persona = this.requireProjectPersona(req.persona_id.trim());
    if (!connector.visible_persona_ids.includes(persona.id)) {
      throw new Error('Persona is not visible in this connector');
    }
    const duplicateRow = this.get(
      `SELECT * FROM external_connector_events WHERE connector_id=? AND external_event_id=?`,
      connector.id,
      externalMessageID,
    );
    if (duplicateRow) {
      const event = rowToExternalConnectorEvent(duplicateRow);
      return {
        event,
        room: this.requireMessengerRoom(event.room_id),
        message_id: event.internal_message_id || '',
        duplicate: true,
      };
    }
    const room = this.requireMessengerRoom(connector.room_id);
    const conversationID = room.conversation_id || `conv_${newID()}`;
    const messageID = req.internal_message_id?.trim() || `msg_${newID()}`;
    const text = req.text.trim();
    if (!text) throw new Error('text is required');
    const status = req.status?.trim() || 'sent';
    this.transaction(() => {
      if (!req.internal_message_id?.trim()) {
        this.exec(
          `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
           VALUES (?, ?, 'assistant', ?, '[]', ?, datetime('now'))`,
          messageID,
          conversationID,
          text,
          json({
            source: 'external_connector',
            direction: 'outbound',
            provider: connector.provider,
            connector_id: connector.id,
            external_room_id: connector.external_room_id,
            external_message_id: externalMessageID,
            persona_id: persona.id,
            speaker_persona_id: persona.id,
            project_id: persona.project_id,
          }),
        );
      }
      this.exec(
        `INSERT INTO external_connector_events (id, connector_id, provider, external_event_id, room_id, external_user_id,
                                               text, internal_message_id, status, retry_count, error, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, 0, '', ?, datetime('now'))`,
        `extev_${newID()}`,
        connector.id,
        connector.provider,
        externalMessageID,
        req.room_id?.trim() || connector.room_id,
        text,
        messageID,
        status,
        json({
          direction: 'outbound',
          persona_id: persona.id,
          speaker_persona_id: persona.id,
          project_id: persona.project_id,
          retryable: status === 'send_failed',
          external_message_id: externalMessageID,
        }),
      );
      this.exec(`UPDATE rooms SET floor_holder_persona_id=?, updated_at=datetime('now') WHERE id=?`, persona.id, connector.room_id);
    });
    const row = this.get(`SELECT * FROM external_connector_events WHERE connector_id=? AND external_event_id=?`, connector.id, externalMessageID);
    return { event: rowToExternalConnectorEvent(row!), room: this.requireMessengerRoom(connector.room_id), message_id: messageID, duplicate: false };
  }

  recordExternalConnectorInbound(req: RecordExternalConnectorInboundRequest): { event: ExternalConnectorEvent; room: MessengerRoom; message_id?: string; duplicate: boolean } {
    const provider = req.provider.trim().toLowerCase();
    const externalRoomID = req.external_room_id.trim();
    const externalEventID = req.external_event_id.trim();
    if (!provider || !externalRoomID || !externalEventID) throw new Error('provider, external_room_id and external_event_id are required');
    const connector = this.requireRoomConnector(provider, externalRoomID);
    const duplicateRow = this.get(
      `SELECT * FROM external_connector_events WHERE connector_id=? AND external_event_id=?`,
      connector.id,
      externalEventID,
    );
    if (duplicateRow) {
      const event = rowToExternalConnectorEvent(duplicateRow);
      return { event, room: this.requireMessengerRoom(event.room_id), message_id: event.internal_message_id, duplicate: true };
    }
    const room = this.requireMessengerRoom(connector.room_id);
    const conversationID = room.conversation_id || `conv_${newID()}`;
    const messageID = `msg_${newID()}`;
    const visiblePersonas = connector.visible_persona_ids;
    const mentionedPersona = this.findVisibleExternalMention(req.text, visiblePersonas);
    const lockTarget = externalLockTarget(req.text, visiblePersonas, (id) => this.requireProjectPersona(id));
    const unlock = /^\/unlock\b/i.test(req.text.trim());
    const replyTarget = req.reply_to_external_message_id ? this.externalReplyTarget(connector.id, req.reply_to_external_message_id) : {};
    const replyTargetPersonaID = replyTarget.persona_id && visiblePersonas.includes(replyTarget.persona_id) ? replyTarget.persona_id : '';
    const routeTargetPersona = replyTargetPersonaID
      ? this.requireProjectPersona(replyTargetPersonaID)
      : mentionedPersona;
    this.transaction(() => {
      this.exec(
        `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
         VALUES (?, ?, 'user', ?, '[]', ?, datetime('now'))`,
        messageID,
        conversationID,
        req.text,
        json({
          source: 'external_connector',
          provider,
          connector_id: connector.id,
          external_room_id: externalRoomID,
          external_event_id: externalEventID,
          external_user_id: req.external_user_id,
          reply_to_external_message_id: req.reply_to_external_message_id || '',
          reply_to_message_id: replyTarget.internal_message_id || '',
          reply_target_persona_id: replyTargetPersonaID,
          visible_persona_ids: visiblePersonas,
          mentioned_persona_id: routeTargetPersona?.id || '',
        }),
      );
      this.exec(
        `INSERT INTO external_connector_events (id, connector_id, provider, external_event_id, room_id, external_user_id,
                                               reply_to_external_message_id, text, internal_message_id, status, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, datetime('now'))`,
        `extev_${newID()}`,
        connector.id,
        provider,
        externalEventID,
        connector.room_id,
        req.external_user_id.trim(),
        req.reply_to_external_message_id || '',
        req.text,
        messageID,
        json({
          visible_persona_ids: visiblePersonas,
          mentioned_persona_id: routeTargetPersona?.id || '',
          reply_target_persona_id: replyTargetPersonaID,
          reply_to_message_id: replyTarget.internal_message_id || '',
          command: lockTarget ? 'lock' : unlock ? 'unlock' : '',
        }),
      );
      const externalUserID = `external:${provider}:${req.external_user_id}`;
      if (lockTarget) {
        this.exec(`UPDATE route_locks SET status='released:' || id WHERE room_id=? AND user_id=? AND status='active'`, connector.room_id, externalUserID);
        this.exec(
          `INSERT INTO route_locks (id, room_id, user_id, persona_id, started_at, status, metadata)
           VALUES (?, ?, ?, ?, datetime('now'), 'active', ?)`,
          `lock_${newID()}`,
          connector.room_id,
          externalUserID,
          lockTarget.id,
          json({ source: 'external_connector', provider, external_room_id: externalRoomID }),
        );
        this.exec(`UPDATE rooms SET floor_holder_persona_id=?, updated_at=datetime('now') WHERE id=?`, lockTarget.id, connector.room_id);
      } else if (unlock) {
        this.exec(
          `UPDATE route_locks SET status='released:' || id, metadata=json_set(COALESCE(metadata, '{}'), '$.released_at', ?)
           WHERE room_id=? AND user_id=? AND status='active'`,
          nowIso(),
          connector.room_id,
          externalUserID,
        );
      }
      if (routeTargetPersona) {
        const reasonCode = replyTargetPersonaID ? 'EXTERNAL_REPLY_TO_PERSONA' : 'EXTERNAL_MENTION';
        this.exec(
          `INSERT INTO routing_decisions (id, room_id, message_id, run_id, speaker_persona_id, owner_project_id,
                                          executor_persona_id, collaborator_project_ids, execution_scope, write_targets,
                                          thread_action, confidence, risk, requires_confirmation, reason_codes, metadata, created_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?, '[]', 'specified_persona', ?, ?, 1, 'low', 0, ?, ?, datetime('now'))`,
          `rdec_${newID()}`,
          connector.room_id,
          messageID,
          routeTargetPersona.id,
          routeTargetPersona.project_id,
          routeTargetPersona.id,
          json([routeTargetPersona.project_id, connector.room_id]),
          json({ type: 'external_inbound', source: reasonCode }),
          json([reasonCode]),
          json({
            source: 'external_connector',
            provider,
            external_room_id: externalRoomID,
            external_event_id: externalEventID,
            reply_to_external_message_id: req.reply_to_external_message_id || '',
            reply_to_message_id: replyTarget.internal_message_id || '',
          }),
        );
        this.exec(`UPDATE rooms SET floor_holder_persona_id=?, updated_at=datetime('now') WHERE id=?`, routeTargetPersona.id, connector.room_id);
      }
      this.exec(`UPDATE rooms SET updated_at=datetime('now') WHERE id=?`, connector.room_id);
    });
    const event = this.get(
      `SELECT * FROM external_connector_events WHERE connector_id=? AND external_event_id=?`,
      connector.id,
      externalEventID,
    );
    return { event: rowToExternalConnectorEvent(event!), room: this.requireMessengerRoom(connector.room_id), message_id: messageID, duplicate: false };
  }

  previewExternalPersonaMessage(req: PreviewExternalPersonaMessageRequest): { text: string; controls: string[]; persona_id: string; room_id: string } {
    const room = this.requireMessengerRoom(req.room_id.trim());
    const persona = this.requireProjectPersona(req.persona_id.trim());
    const isMember = room.members?.some((member) => member.type === 'persona' && member.persona_id === persona.id);
    if (!isMember) throw new Error('Persona is not visible in this room');
    const project = this.requireMessengerProject(persona.project_id);
    return {
      room_id: room.id,
      persona_id: persona.id,
      text: `${persona.display_name} · ${project.name} ◇\n${req.text}`,
      controls: [`回复 ${persona.display_name}`, `锁定 ${persona.display_name}`, '查看运行'],
    };
  }

  recordExternalConnectorFailure(req: RecordExternalConnectorFailureRequest): { event: ExternalConnectorEvent } {
    const connectorID = req.connector_id.trim();
    if (!connectorID) throw new Error('connector_id is required');
    const connectorRow = this.get(`SELECT * FROM room_connectors WHERE id=?`, connectorID);
    if (!connectorRow) throw new Error(`Connector not found: ${connectorID}`);
    const connector = rowToRoomConnector(connectorRow);
    const eventID = req.external_event_id?.trim() || `failure_${newID()}`;
    this.exec(
      `INSERT INTO external_connector_events (id, connector_id, provider, external_event_id, room_id, external_user_id,
                                             text, status, retry_count, error, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, '', '', 'send_failed', ?, ?, ?, datetime('now'))
       ON CONFLICT(connector_id, external_event_id) DO UPDATE SET
         status='send_failed',
         retry_count=external_connector_events.retry_count + 1,
         error=excluded.error,
         metadata=excluded.metadata`,
      `extev_${newID()}`,
      connector.id,
      connector.provider,
      eventID,
      req.room_id?.trim() || connector.room_id,
      req.retryable === false ? 0 : 1,
      req.error,
      json({ retryable: req.retryable !== false, visible_in_room: true }),
    );
    this.exec(
      `UPDATE room_connectors SET status='degraded', retry_count=retry_count + 1, last_error=?, updated_at=datetime('now') WHERE id=?`,
      req.error,
      connector.id,
    );
    const row = this.get(`SELECT * FROM external_connector_events WHERE connector_id=? AND external_event_id=?`, connector.id, eventID);
    return { event: rowToExternalConnectorEvent(row!) };
  }

  retryExternalConnectorEvent(req: RetryExternalConnectorEventRequest): { event: ExternalConnectorEvent } {
    const eventID = req.event_id?.trim() || '';
    const connectorID = req.connector_id?.trim() || '';
    const externalEventID = req.external_event_id?.trim() || '';
    const row = eventID
      ? this.get(`SELECT * FROM external_connector_events WHERE id=?`, eventID)
      : connectorID && externalEventID
        ? this.get(`SELECT * FROM external_connector_events WHERE connector_id=? AND external_event_id=?`, connectorID, externalEventID)
        : null;
    if (!row) throw new Error('External connector event not found');
    const event = rowToExternalConnectorEvent(row);
    if (!['send_failed', 'pending', 'retry_scheduled'].includes(event.status)) {
      throw new Error(`External connector event is not retryable: ${event.status}`);
    }
    const retriedAt = nowIso();
    this.transaction(() => {
      this.exec(
        `UPDATE external_connector_events
         SET status='retry_scheduled',
             retry_count=retry_count + 1,
             error='',
             metadata=json_set(COALESCE(metadata, '{}'), '$.retry_requested_at', ?, '$.retry_reason', ?, '$.retryable', 1)
         WHERE id=?`,
        retriedAt,
        req.reason || '',
        event.id,
      );
      this.exec(
        `UPDATE room_connectors
         SET status='retry_scheduled',
             retry_count=retry_count + 1,
             last_error='',
             updated_at=datetime('now')
         WHERE id=?`,
        event.connector_id,
      );
      this.exec(`UPDATE rooms SET updated_at=datetime('now') WHERE id=?`, event.room_id);
    });
    const updated = this.get(`SELECT * FROM external_connector_events WHERE id=?`, event.id);
    return { event: rowToExternalConnectorEvent(updated!) };
  }

  setRouteLock(req: SetRouteLockRequest): { route_lock: RouteLock | null } {
    const roomID = req.room_id.trim();
    const userID = req.user_id?.trim() || 'desktop_user';
    if (!roomID) throw new Error('room_id is required');
    if (req.action === 'unlock') {
      this.exec(
        `UPDATE route_locks SET status='released:' || id, metadata=json_set(COALESCE(metadata, '{}'), '$.released_at', ?)
         WHERE room_id=? AND user_id=? AND status='active'`,
        nowIso(),
        roomID,
        userID,
      );
      return { route_lock: null };
    }
    const personaID = req.persona_id?.trim();
    if (!personaID) throw new Error('persona_id is required for route lock');
    if (!this.get(`SELECT id FROM rooms WHERE id=?`, roomID)) throw new Error(`Room not found: ${roomID}`);
    if (!this.get(`SELECT id FROM personas WHERE id=? AND status NOT IN ('archived','deleted')`, personaID)) throw new Error(`Persona not available: ${personaID}`);
    this.transaction(() => {
      this.exec(`UPDATE route_locks SET status='released:' || id WHERE room_id=? AND user_id=? AND status='active'`, roomID, userID);
      this.exec(
        `INSERT INTO route_locks (id, room_id, user_id, persona_id, started_at, status, metadata)
         VALUES (?, ?, ?, ?, datetime('now'), 'active', ?)`,
        `lock_${newID()}`,
        roomID,
        userID,
        personaID,
        json({ source: 'desktop_ui' }),
      );
      this.exec(`UPDATE rooms SET floor_holder_persona_id=?, updated_at=datetime('now') WHERE id=?`, personaID, roomID);
    });
    const row = this.get(
      `SELECT room_id, user_id, persona_id, started_at, expires_at, status
       FROM route_locks
       WHERE room_id=? AND user_id=? AND status='active'
       ORDER BY datetime(started_at) DESC
       LIMIT 1`,
      roomID,
      userID,
    );
    return { route_lock: row ? rowToRouteLock(row) : null };
  }

  completeCheckpoint(req: CompleteCheckpointRequest = {}): CheckpointSummary {
    const current = this.buildCheckpointSummary();
    this.exec(
      `INSERT INTO checkpoints (id, user_id, checked_at, covered_event_cursor, acknowledged_items, snoozed_items, metadata)
       VALUES (?, 'desktop_user', datetime('now'), ?, ?, ?, ?)`,
      `chk_${newID()}`,
      current.covered_event_cursor || nowIso(),
      json(req.acknowledged_items || current.items.map((item) => item.id)),
      json(req.snoozed_items || []),
      json({ completed_from: 'persona_messenger' }),
    );
    return this.buildCheckpointSummary();
  }

  recordRoutingFeedback(req: RoutingFeedbackRequest): void {
    const roomID = req.room_id.trim();
    if (!roomID) throw new Error('room_id is required');
    const action = req.action.trim();
    const targetPersonaID = req.target_persona_id?.trim() || '';
    if (action === 'reroute' && targetPersonaID) {
      const member = this.get(
        `SELECT rm.id FROM room_members rm
         JOIN personas p ON p.id=rm.persona_id
         WHERE rm.room_id=? AND rm.member_type='persona' AND rm.persona_id=? AND p.status NOT IN ('archived', 'deleted')
         LIMIT 1`,
        roomID,
        targetPersonaID,
      );
      if (!member) throw new Error('target Persona is not an active member of this room');
    }
    this.exec(
      `INSERT INTO routing_feedback (id, routing_decision_id, room_id, message_id, run_id, action, target_persona_id, write_targets, comment, created_at)
       VALUES (?, NULLIF(?, ''), ?, NULLIF(?, ''), NULLIF(?, ''), ?, NULLIF(?, ''), ?, ?, datetime('now'))`,
      `rfb_${newID()}`,
      req.routing_decision_id || '',
      roomID,
      req.message_id || '',
      req.run_id || '',
      action,
      targetPersonaID,
      json(req.write_targets || []),
      req.comment || '',
    );
    if (action === 'reroute' && targetPersonaID) {
      this.setRouteLock({ room_id: roomID, persona_id: targetPersonaID, user_id: 'desktop_user', action: 'lock' });
    }
  }

  listConversationGroups(): { groups: ConversationGroup[] } {
    const rows = this.all(
      `SELECT id, name, sort_order, collapsed, metadata, created_at, updated_at
       FROM conversation_groups
       ORDER BY sort_order ASC, datetime(updated_at) DESC, id ASC`,
    );
    return { groups: rows.map(rowToConversationGroup) };
  }

  saveConversationGroup(req: ConversationGroupRequest): ConversationGroup {
    const id = req.id?.trim() || `cgrp_${newID()}`;
    const name = req.name.trim();
    if (!name) throw new Error('conversation group name is required');
    const sortOrder = Number.isFinite(req.sort_order) ? Number(req.sort_order) : 0;
    this.exec(
      `INSERT INTO conversation_groups (id, name, sort_order, collapsed, metadata, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name,
         sort_order=excluded.sort_order,
         collapsed=excluded.collapsed,
         metadata=excluded.metadata,
         updated_at=datetime('now')`,
      id,
      name,
      sortOrder,
      req.collapsed ? 1 : 0,
      json(req.metadata || {}),
    );
    const row = this.get(
      `SELECT id, name, sort_order, collapsed, metadata, created_at, updated_at
       FROM conversation_groups
       WHERE id=?`,
      id,
    );
    if (!row) throw new Error(`Conversation group not found after save: ${id}`);
    return rowToConversationGroup(row);
  }

  deleteConversationGroup(id: string): void {
    const groupID = id.trim();
    if (!groupID) return;
    this.transaction(() => {
      this.exec(`UPDATE conversations SET group_id=NULL, updated_at=datetime('now') WHERE group_id=?`, groupID);
      this.exec(`DELETE FROM conversation_groups WHERE id=?`, groupID);
    });
  }

  moveConversationToGroup(req: ConversationActionRequest): ConversationActionResponse {
    const conversationID = req.id.trim();
    if (!conversationID) throw new Error('conversation id is required');
    const groupID = req.group_id?.trim() || null;
    if (groupID && !this.get(`SELECT id FROM conversation_groups WHERE id=?`, groupID)) {
      throw new Error(`Conversation group not found: ${groupID}`);
    }
    this.exec(
      `UPDATE conversations SET group_id=?, updated_at=datetime('now') WHERE id=?`,
      groupID,
      conversationID,
    );
    return { conversation: this.requireConversationSummary(conversationID) };
  }

  archiveConversation(req: ConversationActionRequest): ConversationActionResponse {
    return this.updateConversationLifecycle(req, 'archive', 'archived', {
      archived_at: 'datetime(\'now\')',
      trashed_at: 'NULL',
      purge_after: 'NULL',
      restored_at: 'NULL',
    });
  }

  trashConversation(req: ConversationActionRequest): ConversationActionResponse {
    return this.updateConversationLifecycle(req, 'trash', 'trashed', {
      trashed_at: 'datetime(\'now\')',
      purge_after: 'datetime(\'now\', \'+30 days\')',
      restored_at: 'NULL',
    });
  }

  restoreConversation(req: ConversationActionRequest): ConversationActionResponse {
    return this.updateConversationLifecycle(req, 'restore', 'active', {
      archived_at: 'NULL',
      trashed_at: 'NULL',
      purge_after: 'NULL',
      restored_at: 'datetime(\'now\')',
    });
  }

  purgeConversation(req: ConversationActionRequest): ConversationActionResponse {
    return this.updateConversationLifecycle(req, 'purge', 'purged', {
      trashed_at: 'COALESCE(trashed_at, datetime(\'now\'))',
      purge_after: 'NULL',
    });
  }

  getConversation(conversationID: string): ConversationDetail {
    const conversation = this.get(
      `SELECT
         c.*,
         (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY datetime(m.created_at) DESC, m.rowid DESC LIMIT 1) AS last_message,
         (SELECT role FROM messages m WHERE m.conversation_id = c.id ORDER BY datetime(m.created_at) DESC, m.rowid DESC LIMIT 1) AS last_role,
         (SELECT r.id FROM runs r WHERE r.conversation_id = c.id ORDER BY datetime(r.created_at) DESC, r.id DESC LIMIT 1) AS latest_run_id,
         (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
       FROM conversations c
       WHERE c.id = ?`,
      conversationID,
    );
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationID}`);
    }
    const messages = this.all(
      `SELECT id, conversation_id, role, content, attachments, metadata, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY rowid`,
      conversationID,
    ).map(rowToConversationMessage);
    return {
      conversation: rowToConversationSummary(conversation),
      messages,
    };
  }

  getConversationForMessage(messageID: string): ConversationDetail {
    const row = this.get(`SELECT conversation_id FROM messages WHERE id = ?`, messageID);
    const conversationID = optionalString(row?.conversation_id);
    if (!conversationID) {
      throw new Error(`Message not found: ${messageID}`);
    }
    return this.getConversation(conversationID);
  }

  getRunTrace(runID: string): RunTrace {
    const run = this.get(`SELECT * FROM runs WHERE id = ?`, runID);
    if (!run) {
      return {
        id: runID,
        status: 'missing',
        selected_agent_id: 'general_agent',
        model_calls: [],
        events: [],
        steps: [],
      };
    }
    const events = this.all(
      `SELECT *
       FROM run_events
       WHERE run_id = ?
       ORDER BY seq`,
      runID,
    ).map(rowToRunEvent);
    const steps = this.all(
      `SELECT id, run_id, step_type, title, status, input, output, error, started_at, finished_at, duration_ms, created_at
       FROM run_steps
       WHERE run_id = ?
       ORDER BY datetime(created_at), id`,
      runID,
    ).map((row) => ({
      id: String(row.id),
      run_id: optionalString(row.run_id),
      step_type: String(row.step_type),
      title: String(row.title),
      status: String(row.status),
      input: parseObject(row.input),
      output: parseObject(row.output),
      error: parseObject(row.error),
      started_at: optionalString(row.started_at),
      finished_at: optionalString(row.finished_at),
      duration_ms: optionalNumber(row.duration_ms),
      created_at: optionalString(row.created_at),
    }));
    const modelCalls = this.all(
      `SELECT id, provider, model_name, status, input_tokens, output_tokens, cached_input_tokens,
              cache_write_input_tokens, reasoning_tokens, total_tokens, cost_estimate,
              cacheable_prefix_tokens, dynamic_tail_tokens, latency_ms, usage_status, finish_reason,
              prompt_cache_key, prefix_hash, dynamic_tail_hash, metadata
       FROM model_calls
       WHERE run_id = ?
       ORDER BY datetime(created_at), id`,
      runID,
    ).map(rowToModelCall);
    const promptAssemblies = this.all(
      `SELECT id, prefix_hash, dynamic_tail_hash, prompt_cache_key
       FROM prompt_assemblies
       WHERE run_id=?
       ORDER BY datetime(created_at), id`,
      runID,
    ).map((row) => ({
      id: String(row.id),
      prefix_hash: String(row.prefix_hash),
      dynamic_tail_hash: String(row.dynamic_tail_hash),
      prompt_cache_key: String(row.prompt_cache_key),
    }));
    const memoryContextPacks = this.all(
      `SELECT id, memory_profile_version, dynamic_retrieval
       FROM memory_context_packs
       WHERE run_id=?
       ORDER BY datetime(created_at), id`,
      runID,
    ).map((row) => ({
      id: String(row.id),
      memory_profile_version: String(row.memory_profile_version),
      dynamic_retrieval: parseArray(row.dynamic_retrieval) as MemorySearchResult[],
    }));
    return {
      id: String(run.id),
      conversation_id: optionalString(run.conversation_id),
      user_message_id: optionalString(run.user_message_id),
      principal_id: optionalString(run.principal_id),
      entry_channel: optionalString(run.entry_channel),
      requested_mode: optionalString(run.requested_mode),
      resolved_mode: optionalString(run.resolved_mode),
      mode_source: optionalString(run.mode_source),
      terminal_status: optionalString(run.terminal_status),
      terminal_reason: optionalString(run.terminal_reason),
      parent_run_id: optionalString(run.parent_run_id),
      redirected_from_run_id: optionalString(run.redirected_from_run_id),
      started_at: optionalString(run.started_at),
      finished_at: optionalString(run.finished_at),
      duration_ms: optionalNumber(run.duration_ms),
      status: String(run.status),
      selected_agent_id: optionalString(run.selected_agent_id) || 'general_agent',
      route_result: parseObject(run.route_result),
      metadata: parseObject(run.metadata),
      model_calls: modelCalls,
      prompt_assemblies: promptAssemblies,
      memory_context_packs: memoryContextPacks,
      events,
      steps,
    };
  }

  listRunTraceSpans(filter: RunTraceSpanFilter = {}): { spans: RunTraceSpan[]; summary: RunTraceSpanSummary } {
    const limit = clampLimit(filter.limit, 200);
    const since = filter.since?.trim() || '';
    const until = filter.until?.trim() || '';
    const queryLimit = Math.max(limit * 4, 100);
    const timeWhere = (alias: string) => {
      const clauses: string[] = [];
      const params: SQLiteValue[] = [];
      if (since) {
        clauses.push(`datetime(${alias}.created_at) >= datetime(?)`);
        params.push(since);
      }
      if (until) {
        clauses.push(`datetime(${alias}.created_at) <= datetime(?)`);
        params.push(until);
      }
      return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
    };

    const modelTime = timeWhere('mc');
    const modelRows = this.all(
      `SELECT mc.*, rn.conversation_id, rn.selected_agent_id, r.id AS room_id, r.title AS room_title,
              COALESCE(ps.id, rn.selected_agent_id, mc.agent_id) AS persona_id,
              ps.display_name AS persona_name,
              COALESCE(p.id, rd.owner_project_id, r.project_id) AS project_id,
              p.name AS project_name
       FROM model_calls mc
       LEFT JOIN runs rn ON rn.id=mc.run_id
       LEFT JOIN rooms r ON r.conversation_id=rn.conversation_id
       LEFT JOIN routing_decisions rd ON rd.run_id=rn.id
       LEFT JOIN personas ps ON ps.id=COALESCE(rn.selected_agent_id, mc.agent_id)
       LEFT JOIN projects p ON p.id=COALESCE(ps.project_id, rd.owner_project_id, r.project_id)
       ${modelTime.sql}
       ORDER BY datetime(mc.created_at) DESC, mc.id DESC
       LIMIT ?`,
      ...modelTime.params,
      queryLimit,
    ).map(rowToModelTraceSpan);

    const toolTime = timeWhere('tr');
    const toolRows = this.all(
      `SELECT tr.*, rn.conversation_id, rn.selected_agent_id, r.id AS room_id, r.title AS room_title,
              ps.id AS persona_id, ps.display_name AS persona_name,
              COALESCE(p.id, rd.owner_project_id, r.project_id) AS project_id,
              p.name AS project_name
       FROM tool_runs tr
       LEFT JOIN runs rn ON rn.id=tr.run_id
       LEFT JOIN rooms r ON r.conversation_id=rn.conversation_id
       LEFT JOIN routing_decisions rd ON rd.run_id=rn.id
       LEFT JOIN personas ps ON ps.id=rn.selected_agent_id
       LEFT JOIN projects p ON p.id=COALESCE(ps.project_id, rd.owner_project_id, r.project_id)
       ${toolTime.sql}
       ORDER BY datetime(tr.created_at) DESC, tr.id DESC
       LIMIT ?`,
      ...toolTime.params,
      queryLimit,
    ).map(rowToToolTraceSpan);

    const eventTime = timeWhere('re');
    const eventRows = this.all(
      `SELECT re.*, rn.selected_agent_id, r.id AS room_id, r.title AS room_title,
              COALESCE(ps.id, rd.speaker_persona_id, rd.executor_persona_id, rn.selected_agent_id) AS persona_id,
              ps.display_name AS persona_name,
              COALESCE(p.id, rd.owner_project_id, r.project_id) AS project_id,
              p.name AS project_name
       FROM run_events re
       LEFT JOIN runs rn ON rn.id=re.run_id
       LEFT JOIN rooms r ON r.conversation_id=COALESCE(re.conversation_id, rn.conversation_id)
       LEFT JOIN routing_decisions rd ON rd.run_id=rn.id
       LEFT JOIN personas ps ON ps.id=COALESCE(rd.speaker_persona_id, rd.executor_persona_id, rn.selected_agent_id)
       LEFT JOIN projects p ON p.id=COALESCE(ps.project_id, rd.owner_project_id, r.project_id)
       ${eventTime.sql}
       ORDER BY datetime(re.created_at) DESC, re.run_id DESC, re.seq DESC
       LIMIT ?`,
      ...eventTime.params,
      queryLimit,
    ).map(rowToEventTraceSpan);

    const spans = [...modelRows, ...toolRows, ...eventRows]
      .filter((span) => traceSpanMatchesFilter(span, filter))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, limit);
    return { spans, summary: summarizeRunTraceSpans(spans) };
  }

  listSavedModels(): { models: AvailableModel[] } {
    const rows = this.all(
      `SELECT id, provider, model_name, display_name, base_url, supports_json_mode, supports_tool_calling, context_window, input_price_per_1m, output_price_per_1m, cached_input_price_per_1m, enabled, metadata
       FROM models
       WHERE enabled = 1
       ORDER BY id`,
    );
    return {
      models: rows.map((row) => ({
        provider: optionalString(row.provider),
        base_url: optionalString(row.base_url),
        id: String(row.model_name || row.id),
        display_name: optionalString(row.display_name),
        owner: optionalString(row.provider),
        context_window: optionalNumber(row.context_window),
        input_price_per_1m: optionalNumber(row.input_price_per_1m),
        output_price_per_1m: optionalNumber(row.output_price_per_1m),
        cached_input_price_per_1m: optionalNumber(row.cached_input_price_per_1m),
        supports_json_mode: Boolean(Number(row.supports_json_mode ?? 0)),
        supports_tool_calling: Boolean(Number(row.supports_tool_calling ?? 0)),
        supports_reasoning: Boolean(parseObject(row.metadata).supports_reasoning),
        metadata: parseObject(row.metadata),
        config: {
          role: 'default',
          enabled: Boolean(Number(row.enabled ?? 1)),
          temperature: 0.7,
          max_output_tokens: 8192,
          timeout_seconds: 60,
          max_retries: 1,
          supports_json_mode: Boolean(Number(row.supports_json_mode ?? 0)),
          supports_tool_calling: Boolean(Number(row.supports_tool_calling ?? 0)),
          supports_reasoning: Boolean(parseObject(row.metadata).supports_reasoning),
        },
      })),
    };
  }

  listAgentModelPolicies(): { policies: AgentModelPolicy[] } {
    const rows = this.all(
      `SELECT a.id AS agent_id,
              COALESCE(p.default_model_id, a.default_model_id, '') AS default_model_id,
              COALESCE(p.fallback_model_ids,
                CASE WHEN COALESCE(a.fallback_model_id, '')='' THEN '[]' ELSE json_array(a.fallback_model_id) END,
                '[]') AS fallback_model_ids,
              COALESCE(p.cheap_model_id, a.cheap_model_id, '') AS cheap_model_id,
              COALESCE(p.child_model_id, '') AS child_model_id,
              COALESCE(p.tool_model_id, '') AS tool_model_id,
              COALESCE(p.long_context_model_id, '') AS long_context_model_id,
              COALESCE(p.reasoning_effort, '') AS reasoning_effort,
              COALESCE(p.max_failovers, 2) AS max_failovers,
              COALESCE(p.enabled, 1) AS enabled,
              COALESCE(p.metadata, '{}') AS metadata,
              COALESCE(p.updated_at, a.updated_at) AS updated_at
       FROM agents a
       LEFT JOIN agent_model_policies p ON p.agent_id=a.id
       WHERE a.enabled=1
       ORDER BY CASE WHEN a.id='general_agent' THEN 0 ELSE 1 END, a.id`,
    );
    return { policies: rows.map(rowToAgentModelPolicy) };
  }

  getAssistantWorkspace(): AssistantWorkspaceSnapshot {
    for (const [id, provider, name] of [
      ['assistant_channel_telegram', 'telegram', 'Telegram'],
      ['assistant_channel_imessage', 'imessage', 'iMessage'],
      ['assistant_channel_discord', 'discord', 'Discord'],
      ['assistant_channel_feishu', 'feishu', '飞书'],
      ['assistant_channel_calendar', 'calendar', 'macOS 日历'],
      ['assistant_channel_email', 'email', '邮件'],
    ] as const) {
      this.exec(
        `INSERT INTO assistant_channels (id, provider, name, status, enabled, configured, metadata)
         VALUES (?, ?, ?, 'not_configured', 0, 0, '{}')
         ON CONFLICT(id) DO NOTHING`,
        id,
        provider,
        name,
      );
    }
    const settings = this.getSettings();
    this.exec(
      `UPDATE assistant_channels SET enabled=?, configured=?, status=?, updated_at=datetime('now') WHERE provider='telegram'`,
      settings.telegram_enabled ? 1 : 0,
      settings.telegram_enabled ? 1 : 0,
      settings.telegram_enabled ? 'ready' : 'not_configured',
    );
    this.exec(
      `UPDATE assistant_channels SET enabled=?, configured=?, status=?, updated_at=datetime('now') WHERE provider='imessage'`,
      settings.imessage_enabled ? 1 : 0,
      settings.imessage_enabled ? 1 : 0,
      settings.imessage_enabled ? 'ready' : 'not_configured',
    );
    const desktop = this.desktopSettings();
    const captureActive = desktop['assistant.capture.active'] === 'true';
    const sessionID = desktop['assistant.capture.session_id'] || '';
    const intervalSeconds = Math.max(15, Number(desktop['assistant.capture.interval_seconds'] || 60));
    const activitySessions = this.all(
      `SELECT * FROM assistant_activity_sessions ORDER BY datetime(started_at) DESC LIMIT 30`,
    ).map((row) => ({
      id: optionalString(row.id) || '',
      status: optionalString(row.status) || 'active',
      title: optionalString(row.title) || '工作记录',
      started_at: optionalString(row.started_at),
      ended_at: optionalString(row.ended_at),
      event_count: Number(row.event_count || 0),
      summary: optionalString(row.summary),
      metadata: parseObject(row.metadata),
    }));
    const recentActivity = this.all(
      `SELECT * FROM assistant_activity_events ORDER BY datetime(created_at) DESC LIMIT 100`,
    ).map((row) => ({
      id: optionalString(row.id) || '',
      session_id: optionalString(row.session_id) || '',
      event_type: optionalString(row.event_type) || 'snapshot',
      app_name: optionalString(row.app_name),
      window_title: optionalString(row.window_title),
      text: optionalString(row.text),
      screenshot_path: optionalString(row.screenshot_path),
      created_at: optionalString(row.created_at),
      metadata: parseObject(row.metadata),
    }));
    const calendar = this.all(
      `SELECT * FROM assistant_calendar_items ORDER BY datetime(start_at), rowid LIMIT 200`,
    ).map((row) => ({
      id: optionalString(row.id) || '',
      title: optionalString(row.title) || '',
      start_at: optionalString(row.start_at) || '',
      end_at: optionalString(row.end_at),
      status: optionalString(row.status) || 'draft',
      source: optionalString(row.source) || 'joi',
      notes: optionalString(row.notes),
      external_id: optionalString(row.external_id),
      metadata: parseObject(row.metadata),
    }));
    const planRows = this.all(`SELECT * FROM assistant_plans ORDER BY datetime(updated_at) DESC LIMIT 100`);
    const plans = planRows.map((row) => {
      const planID = optionalString(row.id) || '';
      const nodes = this.all(`SELECT * FROM assistant_plan_nodes WHERE plan_id=? ORDER BY sort_order, datetime(created_at), rowid`, planID).map((node) => ({
        id: optionalString(node.id) || '',
        plan_id: planID,
        title: optionalString(node.title) || '',
        status: optionalString(node.status) || 'pending',
        parent_id: optionalString(node.parent_id),
        depends_on: parseStringArray(node.depends_on),
        evidence: parseArray(node.evidence).filter(isSQLiteRow),
        sort_order: Number(node.sort_order || 0),
        metadata: parseObject(node.metadata),
      }));
      return {
        id: planID,
        title: optionalString(row.title) || '',
        objective: optionalString(row.objective) || '',
        status: optionalString(row.status) || 'active',
        conversation_id: optionalString(row.conversation_id),
        nodes,
        review_summary: optionalString(row.review_summary),
        created_at: optionalString(row.created_at),
        updated_at: optionalString(row.updated_at),
        metadata: parseObject(row.metadata),
      };
    });
    const channels = this.all(`SELECT * FROM assistant_channels ORDER BY provider`).map((row) => ({
      id: optionalString(row.id) || '',
      provider: optionalString(row.provider) || '',
      name: optionalString(row.name) || '',
      status: optionalString(row.status) || 'not_configured',
      enabled: Boolean(Number(row.enabled || 0)),
      configured: Boolean(Number(row.configured || 0)),
      last_sync_at: optionalString(row.last_sync_at),
      metadata: parseObject(row.metadata),
    }));
    return {
      capture: { active: captureActive, session_id: sessionID || undefined, interval_seconds: intervalSeconds },
      activity_sessions: activitySessions,
      recent_activity: recentActivity,
      calendar,
      plans,
      channels,
    };
  }

  executeAssistantAction(input: AssistantActionRequest): AssistantActionResult {
    const action = input.action?.trim();
    if (!action) throw new Error('assistant action is required');
    let item: unknown;
    if (action === 'start_activity') {
      const existing = this.desktopSettings()['assistant.capture.session_id'] || '';
      const existingRow = existing ? this.get(`SELECT * FROM assistant_activity_sessions WHERE id=? AND status='active'`, existing) : undefined;
      const id = existingRow ? existing : `activity_${newID()}`;
      if (!existingRow) {
        this.exec(
          `INSERT INTO assistant_activity_sessions (id, status, title, metadata, started_at)
           VALUES (?, 'active', ?, ?, datetime('now'))`,
          id,
          input.title?.trim() || '工作记录',
          json(input.metadata || {}),
        );
      }
      this.setDesktopSettings({
        'assistant.capture.active': 'true',
        'assistant.capture.session_id': id,
        'assistant.capture.interval_seconds': String(Math.max(15, Math.min(3600, Math.round(input.interval_seconds || 60)))),
      });
      item = { id };
    } else if (action === 'stop_activity') {
      const id = input.session_id?.trim() || this.desktopSettings()['assistant.capture.session_id'] || '';
      if (!id) throw new Error('activity session id is required');
      const events = this.all(`SELECT app_name, window_title, text FROM assistant_activity_events WHERE session_id=? ORDER BY datetime(created_at)`, id);
      const summary = input.text?.trim() || summarizeActivityEvents(events);
      this.exec(
        `UPDATE assistant_activity_sessions SET status='completed', summary=?, ended_at=datetime('now') WHERE id=?`,
        summary,
        id,
      );
      this.setDesktopSettings({ 'assistant.capture.active': 'false', 'assistant.capture.session_id': '' });
      item = { id, summary };
    } else if (action === 'record_activity') {
      const sessionID = input.session_id?.trim() || this.desktopSettings()['assistant.capture.session_id'] || '';
      if (!sessionID || !this.get(`SELECT id FROM assistant_activity_sessions WHERE id=?`, sessionID)) throw new Error('active activity session not found');
      const metadata = input.metadata || {};
      const id = `activity_event_${newID()}`;
      this.transaction(() => {
        this.exec(
          `INSERT INTO assistant_activity_events (
             id, session_id, event_type, app_name, window_title, text, screenshot_path, metadata, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          id,
          sessionID,
          optionalString(metadata.event_type) || 'snapshot',
          optionalString(metadata.app_name) || '',
          optionalString(metadata.window_title) || '',
          input.text?.trim() || optionalString(metadata.text) || '',
          input.path?.trim() || optionalString(metadata.screenshot_path) || '',
          json(metadata),
        );
        this.exec(`UPDATE assistant_activity_sessions SET event_count=event_count+1 WHERE id=?`, sessionID);
      });
      item = { id, session_id: sessionID };
    } else if (action === 'create_calendar_item') {
      if (!input.title?.trim() || !input.start_at?.trim()) throw new Error('calendar title and start_at are required');
      const id = input.id?.trim() || `calendar_${newID()}`;
      this.exec(
        `INSERT INTO assistant_calendar_items (id, title, start_at, end_at, status, source, notes, metadata)
         VALUES (?, ?, ?, NULLIF(?, ''), 'draft', 'joi', ?, ?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, start_at=excluded.start_at, end_at=excluded.end_at,
           notes=excluded.notes, metadata=excluded.metadata, updated_at=datetime('now')`,
        id,
        input.title.trim(),
        input.start_at.trim(),
        input.end_at?.trim() || '',
        input.text?.trim() || '',
        json(input.metadata || {}),
      );
      item = { id };
    } else if (action === 'mark_calendar_published') {
      if (!input.id?.trim()) throw new Error('calendar item id is required');
      this.exec(
        `UPDATE assistant_calendar_items SET status='published', source=COALESCE(NULLIF(?, ''), source),
         external_id=COALESCE(NULLIF(?, ''), external_id), updated_at=datetime('now') WHERE id=?`,
        input.provider?.trim() || '',
        optionalString(input.metadata?.external_id) || '',
        input.id.trim(),
      );
      item = { id: input.id.trim() };
    } else if (action === 'create_plan') {
      if (!input.title?.trim()) throw new Error('plan title is required');
      const id = input.id?.trim() || `plan_${newID()}`;
      this.exec(
        `INSERT INTO assistant_plans (id, title, objective, conversation_id, metadata)
         VALUES (?, ?, ?, NULLIF(?, ''), ?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, objective=excluded.objective,
           conversation_id=excluded.conversation_id, metadata=excluded.metadata, updated_at=datetime('now')`,
        id,
        input.title.trim(),
        input.objective?.trim() || '',
        input.conversation_id?.trim() || '',
        json(input.metadata || {}),
      );
      item = { id };
    } else if (action === 'add_plan_node') {
      const planID = optionalString(input.metadata?.plan_id) || input.id?.trim() || '';
      if (!planID || !this.get(`SELECT id FROM assistant_plans WHERE id=?`, planID)) throw new Error('plan not found');
      if (!input.title?.trim()) throw new Error('plan node title is required');
      const id = `plan_node_${newID()}`;
      this.exec(
        `INSERT INTO assistant_plan_nodes (id, plan_id, title, parent_id, depends_on, sort_order, metadata)
         VALUES (?, ?, ?, NULLIF(?, ''), ?, ?, ?)`,
        id,
        planID,
        input.title.trim(),
        optionalString(input.metadata?.parent_id) || '',
        json(parseStringArray(input.metadata?.depends_on)),
        Number(input.metadata?.sort_order || 0),
        json(input.metadata || {}),
      );
      item = { id, plan_id: planID };
    } else if (action === 'update_plan_node') {
      if (!input.id?.trim()) throw new Error('plan node id is required');
      const row = this.get(`SELECT * FROM assistant_plan_nodes WHERE id=?`, input.id.trim());
      if (!row) throw new Error('plan node not found');
      const metadata = input.metadata || {};
      this.exec(
        `UPDATE assistant_plan_nodes SET title=?, status=?, depends_on=?, evidence=?, metadata=?, updated_at=datetime('now') WHERE id=?`,
        input.title?.trim() || optionalString(row.title) || '',
        optionalString(metadata.status) || optionalString(row.status) || 'pending',
        json(metadata.depends_on === undefined ? parseStringArray(row.depends_on) : parseStringArray(metadata.depends_on)),
        json(metadata.evidence === undefined ? parseArray(row.evidence) : (Array.isArray(metadata.evidence) ? metadata.evidence : [])),
        json({ ...parseObject(row.metadata), ...metadata }),
        input.id.trim(),
      );
      item = { id: input.id.trim() };
    } else if (action === 'review_plan') {
      if (!input.id?.trim()) throw new Error('plan id is required');
      const plan = this.getAssistantWorkspace().plans.find((entry) => entry.id === input.id);
      if (!plan) throw new Error('plan not found');
      const completed = plan.nodes.filter((node) => node.status === 'completed').length;
      const blocked = plan.nodes.filter((node) => node.status === 'blocked').length;
      const review = input.text?.trim() || `${completed}/${plan.nodes.length} 个步骤已完成${blocked ? `，${blocked} 个受阻` : ''}。`;
      this.exec(`UPDATE assistant_plans SET review_summary=?, updated_at=datetime('now') WHERE id=?`, review, plan.id);
      item = { id: plan.id, review_summary: review };
    } else if (action === 'configure_channel') {
      const provider = input.provider?.trim();
      if (!provider) throw new Error('channel provider is required');
      const id = input.id?.trim() || `assistant_channel_${provider}`;
      const configured = Boolean(input.metadata?.configured ?? input.enabled);
      this.exec(
        `INSERT INTO assistant_channels (id, provider, name, status, enabled, configured, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, status=excluded.status, enabled=excluded.enabled,
           configured=excluded.configured, metadata=excluded.metadata, updated_at=datetime('now')`,
        id,
        provider,
        input.title?.trim() || provider,
        configured ? 'ready' : 'not_configured',
        input.enabled ? 1 : 0,
        configured ? 1 : 0,
        json(input.metadata || {}),
      );
      item = { id, provider };
    } else {
      throw new Error(`Unsupported assistant action: ${action}`);
    }
    return { ok: true, action, item, snapshot: this.getAssistantWorkspace() };
  }

  saveAgentModelPolicy(input: AgentModelPolicyRequest): AgentModelPolicy {
    const agentID = input.agent_id?.trim();
    if (!agentID || !this.get(`SELECT id FROM agents WHERE id=?`, agentID)) throw new Error(`Agent not found: ${agentID || '(empty)'}`);
    const modelIDs = [
      input.default_model_id,
      input.cheap_model_id,
      input.child_model_id,
      input.tool_model_id,
      input.long_context_model_id,
      ...(input.fallback_model_ids || []),
    ].map((item) => item?.trim()).filter((item): item is string => Boolean(item));
    for (const modelID of new Set(modelIDs)) {
      if (!this.get(`SELECT id FROM models WHERE id=? OR model_name=?`, modelID, modelID)) throw new Error(`Model not found: ${modelID}`);
    }
    const defaultID = input.default_model_id?.trim() || null;
    const fallbackIDs = [...new Set((input.fallback_model_ids || []).map((item) => item.trim()).filter(Boolean))];
    const maxFailovers = Math.max(0, Math.min(8, Math.round(input.max_failovers ?? 2)));
    this.transaction(() => {
      this.exec(
        `INSERT INTO agent_model_policies (
           agent_id, default_model_id, fallback_model_ids, cheap_model_id, child_model_id,
           tool_model_id, long_context_model_id, reasoning_effort, max_failovers, enabled, metadata, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(agent_id) DO UPDATE SET
           default_model_id=excluded.default_model_id,
           fallback_model_ids=excluded.fallback_model_ids,
           cheap_model_id=excluded.cheap_model_id,
           child_model_id=excluded.child_model_id,
           tool_model_id=excluded.tool_model_id,
           long_context_model_id=excluded.long_context_model_id,
           reasoning_effort=excluded.reasoning_effort,
           max_failovers=excluded.max_failovers,
           enabled=excluded.enabled,
           metadata=excluded.metadata,
           updated_at=datetime('now')`,
        agentID,
        defaultID,
        json(fallbackIDs),
        input.cheap_model_id?.trim() || null,
        input.child_model_id?.trim() || null,
        input.tool_model_id?.trim() || null,
        input.long_context_model_id?.trim() || null,
        input.reasoning_effort?.trim() || '',
        maxFailovers,
        input.enabled === false ? 0 : 1,
        json(input.metadata || {}),
      );
      this.exec(
        `UPDATE agents SET default_model_id=?, fallback_model_id=?, cheap_model_id=?, updated_at=datetime('now') WHERE id=?`,
        defaultID,
        fallbackIDs[0] || null,
        input.cheap_model_id?.trim() || null,
        agentID,
      );
    });
    return this.listAgentModelPolicies().policies.find((policy) => policy.agent_id === agentID) || rowToAgentModelPolicy({ agent_id: agentID });
  }

  modelRouteCandidates(input: {
    agent_id: string;
    purpose?: 'default' | 'child' | 'tool' | 'cheap' | 'long_context' | string;
    fallback: { provider: string; model_name: string; base_url?: string; reasoning_effort?: string };
  }): Array<{ model_id: string; provider: string; model_name: string; base_url: string; reasoning_effort?: string; route_reason: string }> {
    const policyRow = this.get(`SELECT * FROM agent_model_policies WHERE agent_id=? AND enabled=1`, input.agent_id);
    const policy = policyRow ? rowToAgentModelPolicy(policyRow) : undefined;
    const preferred = input.purpose === 'child' ? policy?.child_model_id
      : input.purpose === 'tool' ? policy?.tool_model_id
        : input.purpose === 'cheap' ? policy?.cheap_model_id
          : input.purpose === 'long_context' ? policy?.long_context_model_id
            : policy?.default_model_id;
    const identifiers = [preferred, policy?.default_model_id, ...(policy?.fallback_model_ids || [])]
      .map((item) => item?.trim()).filter((item): item is string => Boolean(item));
    const candidates: Array<{ model_id: string; provider: string; model_name: string; base_url: string; reasoning_effort?: string; route_reason: string }> = [];
    for (const identifier of [...new Set(identifiers)].slice(0, Math.max(1, (policy?.max_failovers ?? 2) + 1))) {
      const endpoint = this.configuredModelEndpoint(identifier);
      if (!endpoint) continue;
      candidates.push({ model_id: identifier, ...endpoint, reasoning_effort: policy?.reasoning_effort || input.fallback.reasoning_effort, route_reason: identifier === preferred ? `policy_${input.purpose || 'default'}` : 'policy_fallback' });
    }
    if (!candidates.some((item) => item.provider === input.fallback.provider && item.model_name === input.fallback.model_name)) {
      candidates.push({
        model_id: input.fallback.model_name,
        provider: input.fallback.provider,
        model_name: input.fallback.model_name,
        base_url: input.fallback.base_url?.trim() || '',
        reasoning_effort: input.fallback.reasoning_effort,
        route_reason: 'request_fallback',
      });
    }
    return candidates;
  }

  replaceFetchedModels(provider: string, baseURL: string, models: AvailableModel[]): void {
    const cleanProvider = provider.trim();
    const cleanBaseURL = baseURL.trim();
    const keep = new Set(models.map((model) => desktopModelRecordID(cleanProvider, cleanBaseURL, model.id)));
    this.transaction(() => {
      const existing = this.all(
        `SELECT id, metadata
         FROM models
         WHERE provider = ? AND COALESCE(base_url, '') = ?`,
        cleanProvider,
        cleanBaseURL,
      );
      for (const row of existing) {
        const metadata = parseObject(row.metadata);
        const id = String(row.id);
        if (keep.has(id) || metadata.source !== 'provider_model_list') continue;
        this.exec(`DELETE FROM models WHERE id = ?`, id);
      }
      for (const model of models) {
        const recordID = desktopModelRecordID(cleanProvider, cleanBaseURL, model.id);
        const metadata = {
          ...(model.metadata ?? {}),
          source: 'provider_model_list',
          raw: model.metadata ?? {},
          supported_parameters: model.supported_parameters ?? [],
          supports_reasoning: Boolean(model.supports_reasoning),
          supports_json_mode: Boolean(model.supports_json_mode),
          supports_tool_calling: Boolean(model.supports_tool_calling),
          max_output_tokens: model.max_output_tokens,
          electron_native: true,
        };
        this.exec(
          `INSERT INTO models (id, provider, model_name, display_name, base_url, supports_json_mode, supports_tool_calling, context_window, input_price_per_1m, output_price_per_1m, cached_input_price_per_1m, enabled, metadata, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, 0), NULLIF(?, 0), NULLIF(?, 0), NULLIF(?, 0), 1, ?, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET
             provider=excluded.provider,
             model_name=excluded.model_name,
             display_name=excluded.display_name,
             base_url=excluded.base_url,
             supports_json_mode=excluded.supports_json_mode,
             supports_tool_calling=excluded.supports_tool_calling,
             context_window=excluded.context_window,
             input_price_per_1m=excluded.input_price_per_1m,
             output_price_per_1m=excluded.output_price_per_1m,
             cached_input_price_per_1m=excluded.cached_input_price_per_1m,
             enabled=excluded.enabled,
             metadata=excluded.metadata,
             updated_at=datetime('now')`,
          recordID,
          cleanProvider,
          model.id,
          model.display_name || model.id,
          cleanBaseURL,
          model.supports_json_mode ? 1 : 0,
          model.supports_tool_calling ? 1 : 0,
          model.context_window || 0,
          model.input_price_per_1m || 0,
          model.output_price_per_1m || 0,
          model.cached_input_price_per_1m || 0,
          json(metadata),
        );
      }
    });
  }

  getSettings(): SettingsRecord {
    const settings = this.desktopSettings();
    const workerGatewayAddr = process.env.WORKER_GATEWAY_ADDR || '127.0.0.1:18081';
    const workerGatewaySetting = settings['worker_gateway.enabled'] || settings['worker.gateway_enabled'];
    return {
      app_mode: 'desktop',
      version: this.options.version,
      data_store: 'sqlite',
      task_queue: 'sqlite',
      sqlite_path: this.options.dbPath,
      log_dir: this.options.logDir,
      model_provider: settings['model.provider'] || 'openai_compatible',
      model_name: settings['model.name'] || '',
      model_reasoning_name: settings['model.reasoning_name'] || '',
      model_reasoning_effort: settings['model.reasoning_effort'] || 'low',
      model_base_url: settings['model.base_url'] || '',
      model_timeout_seconds: Number(settings['model.timeout_seconds'] || 60),
      model_max_retries: Number(settings['model.max_retries'] || 1),
      telegram_enabled: settings['telegram.enabled'] === 'true',
      telegram_allowed_user_ids: settings['telegram.allowed_user_ids'] || '',
      imessage_enabled: settings['imessage.enabled'] === 'true',
      imessage_allowed_users: settings['imessage.allowed_users'] || '',
      imessage_require_mention: settings['imessage.require_mention'] === 'true',
      imessage_operator_phone: settings['imessage.operator_phone'] || '',
      imessage_assigned_number: settings['imessage.assigned_number'] || '',
      imessage_project_id: settings['imessage.photon_project_id'] || '',
      imessage_home_channel: settings['imessage.home_channel'] || settings['imessage.operator_phone'] || '',
      imessage_sidecar_port: Number(settings['imessage.sidecar_port'] || 0) || undefined,
      worker_gateway: settings['worker_gateway.url'] || settings['worker.gateway_url'] || (workerGatewayAddr.startsWith('http') ? workerGatewayAddr : `http://${workerGatewayAddr}`),
      worker_gateway_enabled: workerGatewaySetting === undefined ? true : workerGatewaySetting === 'true',
      backup_dir: settings['backup.dir'] || this.options.backupDir,
      auto_backup_enabled: settings['backup.auto_enabled'] === 'true',
      docker_required: false,
    };
  }

  systemHealth() {
    const integrity = this.get(`PRAGMA integrity_check`);
    const todayUsage = this.modelUsageSummaryItems("date(model_calls.created_at, 'localtime') = date('now', 'localtime')");
    const tokenCostToday = sumModelUsageItems(todayUsage);
    return {
      service_status: {
        sqlite: String(integrity?.integrity_check || '') === 'ok',
        electron: 'running',
        runtime: 'electron_ts_sqlite',
      },
      queue_status: { driver: 'sqlite', pending: 0 },
      worker_status: [],
      model_latency: {
        model_calls_today: tokenCostToday.calls,
        avg_latency_ms: tokenCostToday.avg_latency_ms,
        error_calls_today: tokenCostToday.error_calls,
      },
      tool_failure_rate: {},
      token_cost_today: tokenCostToday,
      warnings: [],
    };
  }

  listCapabilities(): { capabilities: CapabilityRecord[] } {
    const rows = this.all(
      `SELECT id, name, description, risk_level, enabled, metadata
       FROM capabilities
       ORDER BY id ASC`,
    );
    const capabilities = rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description: optionalString(row.description) || '',
      risk_level: optionalString(row.risk_level) || 'read_only',
      enabled: Boolean(Number(row.enabled ?? 0)),
      metadata: parseObject(row.metadata),
    }));
    return {
      capabilities: capabilities.filter((capability) => capability.metadata.retired !== true),
    };
  }

  setCapabilityEnabled(req: { id?: string; enabled?: boolean }): void {
    const id = req.id?.trim();
    if (!id) throw new Error('capability id is required');
    if (!this.get(`SELECT id FROM capabilities WHERE id=?`, id)) throw new Error(`capability not found: ${id}`);
    this.exec(
      `UPDATE capabilities SET enabled=?, updated_at=datetime('now') WHERE id=?`,
      req.enabled === false ? 0 : 1,
      id,
    );
  }

  listMCPServers(): { servers: MCPServerRecord[] } {
    const servers = this.all(
      `SELECT id, name, transport, command, args, url, env, headers, enabled, status, trust, last_sync_at, last_sync_error, metadata
       FROM mcp_servers
       ORDER BY id ASC`,
    ).map(rowToMCPServer);
    const items = this.all(
      `SELECT server_id, kind, name, description, schema, uri, mime_type, arguments, wrapped_capability_id, enabled
       FROM mcp_inventory_items
       ORDER BY server_id ASC, kind ASC, name ASC`,
    );
    const byID = new Map(servers.map((server) => [server.id, server]));
    for (const item of items) {
      const server = byID.get(String(item.server_id));
      if (!server) continue;
      const kind = String(item.kind);
      if (kind === 'tool') {
        server.tools.push({
          name: String(item.name),
          description: optionalString(item.description) || '',
          wrapped_as: optionalString(item.wrapped_capability_id),
          enabled: Boolean(Number(item.enabled ?? 1)),
          schema: parseObject(item.schema),
        });
      } else if (kind === 'resource') {
        server.resources.push({
          uri: optionalString(item.uri) || '',
          name: String(item.name),
          description: optionalString(item.description) || '',
          mime_type: optionalString(item.mime_type) || '',
        });
      } else if (kind === 'prompt') {
        server.prompts.push({
          name: String(item.name),
          description: optionalString(item.description) || '',
          arguments: parseArray(item.arguments).map(String),
        });
      }
    }
    return { servers };
  }

  saveMCPServer(req: MCPServerConfigRequest): { server: MCPServerRecord } {
    const id = req.id.trim();
    const name = req.name.trim();
    if (!id || !name) throw new Error('MCP server id and name are required');
    const transport = (req.transport || 'stdio').trim().toLowerCase();
    if (!['stdio', 'streamable_http', 'sse'].includes(transport)) throw new Error(`Unsupported MCP transport: ${transport}`);
    const command = (req.command || '').trim();
    const url = (req.url || '').trim();
    if (req.enabled !== false && transport === 'stdio' && !command) throw new Error('Enabled stdio MCP server requires a command');
    if (req.enabled !== false && transport !== 'stdio' && !url) throw new Error(`Enabled ${transport} MCP server requires a URL`);
    this.exec(
      `INSERT INTO mcp_servers (id, name, transport, command, args, url, env, headers, enabled, status, trust, last_sync_error, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name,
         transport=excluded.transport,
         command=excluded.command,
         args=excluded.args,
         url=excluded.url,
         env=excluded.env,
         headers=excluded.headers,
         enabled=excluded.enabled,
         status=CASE WHEN excluded.enabled=1 THEN mcp_servers.status ELSE 'inactive' END,
         trust=excluded.trust,
         metadata=excluded.metadata,
         updated_at=datetime('now')`,
      id,
      name,
      transport,
      command,
      json(req.args || []),
      url,
      json(req.env || {}),
      json(req.headers || {}),
      req.enabled === false ? 0 : 1,
      req.enabled === false ? 'inactive' : 'configured',
      req.trust?.trim() || 'untrusted_until_wrapped',
      json(req.metadata || {}),
    );
    const server = this.listMCPServers().servers.find((item) => item.id === id);
    if (!server) throw new Error(`MCP server not found after save: ${id}`);
    return { server };
  }

  deleteMCPServer(idInput: string): void {
    const id = idInput.trim();
    if (!id) throw new Error('MCP server id is required');
    this.exec(`DELETE FROM mcp_servers WHERE id=?`, id);
  }

  setMCPServerEnabled(req: { id?: string; enabled?: boolean }): { server: MCPServerRecord } {
    const id = req.id?.trim();
    if (!id) throw new Error('MCP server id is required');
    const existing = this.listMCPServers().servers.find((item) => item.id === id);
    if (!existing) throw new Error(`MCP server not found: ${id}`);
    if (req.enabled !== false && existing.transport === 'stdio' && !existing.command?.trim()) throw new Error('MCP server command is required before enabling');
    if (req.enabled !== false && existing.transport !== 'stdio' && !existing.url?.trim()) throw new Error('MCP server URL is required before enabling');
    this.exec(
      `UPDATE mcp_servers SET enabled=?, status=?, updated_at=datetime('now') WHERE id=?`,
      req.enabled === false ? 0 : 1,
      req.enabled === false ? 'inactive' : 'configured',
      id,
    );
    return { server: this.listMCPServers().servers.find((item) => item.id === id) as MCPServerRecord };
  }

  replaceMCPInventory(serverID: string, inventory: {
    tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
    resources?: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>;
    prompts?: Array<{ name: string; description?: string; arguments?: Array<{ name?: string }> }>;
  }): { server: MCPServerRecord } {
    const id = serverID.trim();
    if (!id) throw new Error('MCP server id is required');
    const existingWrapped = new Map(this.all(
      `SELECT name, wrapped_capability_id, enabled FROM mcp_inventory_items WHERE server_id=? AND kind='tool'`,
      id,
    ).map((row) => [optionalString(row.name) || '', { capability_id: optionalString(row.wrapped_capability_id), enabled: Number(row.enabled ?? 1) }]));
    this.transaction(() => {
      this.exec(`DELETE FROM mcp_inventory_items WHERE server_id=?`, id);
      for (const tool of inventory.tools || []) {
        const wrapped = existingWrapped.get(tool.name);
        this.exec(
          `INSERT INTO mcp_inventory_items (id, server_id, kind, name, description, schema, wrapped_capability_id, enabled, last_seen_at)
           VALUES (?, ?, 'tool', ?, ?, ?, NULLIF(?, ''), ?, datetime('now'))`,
          `mcpi_${stableShortID(`${id}:tool:${tool.name}`)}`,
          id,
          tool.name,
          tool.description || '',
          json(tool.inputSchema || {}),
          wrapped?.capability_id || '',
          wrapped?.enabled ?? 1,
        );
      }
      for (const resource of inventory.resources || []) {
        this.exec(
          `INSERT INTO mcp_inventory_items (id, server_id, kind, name, description, uri, mime_type, enabled, last_seen_at)
           VALUES (?, ?, 'resource', ?, ?, ?, ?, 1, datetime('now'))`,
          `mcpi_${stableShortID(`${id}:resource:${resource.uri}`)}`,
          id,
          resource.name || resource.uri,
          resource.description || '',
          resource.uri,
          resource.mimeType || '',
        );
      }
      for (const prompt of inventory.prompts || []) {
        this.exec(
          `INSERT INTO mcp_inventory_items (id, server_id, kind, name, description, arguments, enabled, last_seen_at)
           VALUES (?, ?, 'prompt', ?, ?, ?, 1, datetime('now'))`,
          `mcpi_${stableShortID(`${id}:prompt:${prompt.name}`)}`,
          id,
          prompt.name,
          prompt.description || '',
          json((prompt.arguments || []).map((argument) => argument.name || '').filter(Boolean)),
        );
      }
      this.exec(
        `UPDATE mcp_servers SET status='active', last_sync_at=datetime('now'), last_sync_error='', updated_at=datetime('now') WHERE id=?`,
        id,
      );
    });
    const server = this.listMCPServers().servers.find((item) => item.id === id);
    if (!server) throw new Error(`MCP server not found after sync: ${id}`);
    return { server };
  }

  recordMCPSyncFailure(serverID: string, message: string): { server: MCPServerRecord } {
    const id = serverID.trim();
    this.exec(
      `UPDATE mcp_servers SET status='error', last_sync_at=datetime('now'), last_sync_error=?, updated_at=datetime('now') WHERE id=?`,
      message.slice(0, 1000),
      id,
    );
    const server = this.listMCPServers().servers.find((item) => item.id === id);
    if (!server) throw new Error(`MCP server not found: ${id}`);
    return { server };
  }

  syncMCPServer(serverID: string): { server: MCPServerRecord } {
    const id = serverID.trim();
    if (!id) throw new Error('server id is required');
    const server = this.listMCPServers().servers.find((item) => item.id === id);
    if (!server) throw new Error(`MCP server not found: ${id}`);
    return { server };
  }

  wrapMCPTool(payload: { server_id?: string; tool_name?: string; request?: MCPWrapToolRequest }): { capability: CapabilityRecord } {
    const serverID = payload.server_id?.trim();
    const toolName = payload.tool_name?.trim();
    const req = payload.request;
    if (!serverID || !toolName || !req) {
      throw new Error('server_id, tool_name, and request are required');
    }
    const capabilityID = req.capability_id?.trim() || `mcp_${serverID}_${toolName}`.replace(/[^A-Za-z0-9_-]/g, '_');
    this.transaction(() => {
      this.exec(
        `INSERT INTO capabilities (id, name, description, risk_level, input_schema, output_schema, enabled, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           description=excluded.description,
           risk_level=excluded.risk_level,
           input_schema=excluded.input_schema,
           output_schema=excluded.output_schema,
           enabled=excluded.enabled,
           metadata=excluded.metadata,
           updated_at=datetime('now')`,
        capabilityID,
        toolName,
        req.description,
        req.risk_level || 'read_only',
        json(req.input_schema ?? {}),
        json(req.output_schema ?? {}),
        req.enabled === false ? 0 : 1,
        json({
          source: 'mcp_wrapped',
          server_id: serverID,
          tool_name: toolName,
          intent_domain: req.intent_domain,
          positive_examples: req.positive_examples ?? [],
          negative_examples: req.negative_examples ?? [],
          privacy_level: req.privacy_level,
          ui_visibility: req.ui_visibility,
          electron_native: true,
        }),
      );
      this.exec(
        `UPDATE mcp_inventory_items
         SET wrapped_capability_id=?, enabled=?, updated_at=datetime('now')
         WHERE server_id=? AND kind='tool' AND name=?`,
        capabilityID,
        req.enabled === false ? 0 : 1,
        serverID,
        toolName,
      );
    });
    const capability = this.listCapabilities().capabilities.find((item) => item.id === capabilityID);
    if (!capability) throw new Error(`Capability not found after wrap: ${capabilityID}`);
    return { capability };
  }

  listSkills(): { skills: SkillRecord[] } {
    const rows = this.all(
      `SELECT id, version, name, description, trigger_phrases, required_capabilities, forbidden_capabilities, output_contract, enabled, metadata
       FROM skill_definitions
       ORDER BY enabled DESC, updated_at DESC, id ASC`,
    );
    return {
      skills: rows.map((row) => ({
        ...skillRecordFromRow(row),
      })),
    };
  }

  syncDiscoveredSkills(discovered: DiscoveredSkill[]): { skills: SkillRecord[]; discovered_count: number; removed_count: number } {
    const existingRows = this.all(
      `SELECT id, enabled, metadata FROM skill_definitions
       WHERE json_extract(metadata, '$.source')='filesystem_skill'`,
    );
    const existingEnabled = new Map(existingRows.map((row) => [String(row.id), Boolean(Number(row.enabled ?? 1))]));
    const incomingIDs = new Set(discovered.map((skill) => skill.id));
    const staleIDs = existingRows.map((row) => String(row.id)).filter((id) => !incomingIDs.has(id));

    this.transaction(() => {
      for (const skill of discovered) {
        const enabled = existingEnabled.has(skill.id)
          ? existingEnabled.get(skill.id) !== false
          : skill.validation_errors.length === 0;
        this.exec(
          `INSERT INTO skill_definitions (id, version, name, description, trigger_phrases, required_capabilities,
                                          forbidden_capabilities, output_contract, enabled, metadata)
           VALUES (?, ?, ?, ?, ?, ?, '[]', '', ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             version=excluded.version,
             name=excluded.name,
             description=excluded.description,
             trigger_phrases=excluded.trigger_phrases,
             required_capabilities=excluded.required_capabilities,
             forbidden_capabilities=excluded.forbidden_capabilities,
             output_contract=excluded.output_contract,
             enabled=excluded.enabled,
             metadata=excluded.metadata,
             updated_at=datetime('now')`,
          skill.id,
          skill.version,
          skill.name,
          skill.description,
          json(skill.interface.default_prompt ? [skill.interface.default_prompt] : []),
          json(skill.required_tools),
          enabled ? 1 : 0,
          json({
            source: 'filesystem_skill',
            path: skill.path,
            directory: skill.directory,
            scope: skill.scope,
            source_root: skill.source_root,
            invocation_name: `$${skill.name}`,
            allow_implicit_invocation: skill.allow_implicit_invocation,
            interface: skill.interface,
            resources: skill.resources,
            sha256: skill.sha256,
            mtime_ms: skill.mtime_ms,
            validation_errors: skill.validation_errors,
            progressive_disclosure: true,
          }),
        );
      }
      for (const id of staleIDs) this.exec(`DELETE FROM skill_definitions WHERE id=?`, id);
    });

    return { ...this.listSkills(), discovered_count: discovered.length, removed_count: staleIDs.length };
  }

  getSkill(idInput: string): { skill: SkillRecord; instructions: string; frontmatter: Record<string, unknown>; openai: Record<string, unknown> } {
    const id = idInput.trim();
    if (!id) throw new Error('skill id is required');
    const row = this.get(
      `SELECT id, version, name, description, trigger_phrases, required_capabilities, forbidden_capabilities, output_contract, enabled, metadata
       FROM skill_definitions WHERE id=?`,
      id,
    );
    if (!row) throw new Error(`skill not found: ${id}`);
    const skill = skillRecordFromRow(row);
    const path = optionalString(skill.metadata?.path);
    if (!path) {
      return { skill, instructions: '', frontmatter: {}, openai: {} };
    }
    const detail = readCodexSkill(path);
    return { skill, instructions: detail.instructions, frontmatter: detail.frontmatter, openai: detail.openai };
  }

  private skillSelectionCandidates(): SkillSelectionCandidate[] {
    return this.listSkills().skills.map((skill) => {
      const metadata = skill.metadata || {};
      return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        path: optionalString(metadata.path) || '',
        scope: skillScopeValue(metadata.scope),
        enabled: skill.enabled,
        allow_implicit_invocation: metadata.allow_implicit_invocation !== false,
        trigger_phrases: skill.trigger_phrases,
      };
    }).filter((skill) => Boolean(skill.path));
  }

  setSkillEnabled(req: { id?: string; enabled?: boolean }): void {
    const id = req.id?.trim();
    if (!id) throw new Error('skill id is required');
    if (!this.get(`SELECT id FROM skill_definitions WHERE id=?`, id)) throw new Error(`skill not found: ${id}`);
    this.exec(
      `UPDATE skill_definitions SET enabled=?, updated_at=datetime('now') WHERE id=?`,
      req.enabled === false ? 0 : 1,
      id,
    );
  }

  listPlugins(): { plugins: PluginRecord[] } {
    const rows = this.all(
      `SELECT id, name, version, description, enabled, status, manifest_path,
              capability_ids, skill_ids, mcp_server_ids, metadata, created_at, updated_at
       FROM plugin_definitions
       ORDER BY enabled DESC, updated_at DESC, id ASC`,
    );
    return {
      plugins: rows.map((row) => {
        const metadata = parseObject(row.metadata);
        const providers = normalizePluginProviders(metadata.providers, String(row.id));
        return {
        id: String(row.id),
        name: String(row.name),
        version: optionalString(row.version) || 'v1',
        description: optionalString(row.description) || '',
        enabled: Boolean(Number(row.enabled ?? 1)),
        status: optionalString(row.status) || 'installed',
        manifest_path: optionalString(row.manifest_path),
        capability_ids: parseArray(row.capability_ids).map(String),
        skill_ids: parseArray(row.skill_ids).map(String),
        mcp_server_ids: parseArray(row.mcp_server_ids).map(String),
        provider_ids: providers.map((provider) => provider.id),
        metadata: { ...metadata, providers },
        created_at: optionalString(row.created_at),
        updated_at: optionalString(row.updated_at),
        };
      }),
    };
  }

  installPluginFromManifest(pathInput: string, options: { trusted_root?: string; metadata?: Record<string, unknown> } = {}): { plugin: PluginRecord } {
    const manifestPath = resolve(pathInput.trim());
    if (!pathInput.trim()) throw new Error('plugin manifest path is required');
    const workspace = this.getWorkspaceSettings();
    const trustedRoot = options.trusted_root?.trim() ? resolve(options.trusted_root) : '';
    if (!workspace.allowed_roots.some((root) => pathWithinRoot(manifestPath, root)) && !(trustedRoot && pathWithinRoot(manifestPath, trustedRoot))) {
      throw new Error('plugin manifest must be inside an allowed workspace root');
    }
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    const id = String(raw.id || '').trim();
    const name = String(raw.name || '').trim();
    const version = String(raw.version || 'v1').trim() || 'v1';
    if (!id || !name) throw new Error('plugin manifest requires id and name');
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('plugin id contains unsupported characters');
    const capabilityDefinitions = Array.isArray(raw.capabilities) ? raw.capabilities.filter(isRecord) : [];
    const workflows = Array.isArray(raw.workflows) ? raw.workflows.filter(isRecord) : [];
    const skills = Array.isArray(raw.skills) ? raw.skills.filter(isRecord) : [];
    const mcpServers = Array.isArray(raw.mcp_servers) ? raw.mcp_servers.filter(isRecord) : [];
    const providers = normalizePluginProviders(raw.providers, id);
    for (const provider of providers) {
      if (provider.protocol !== 'acp') throw new Error(`unsupported plugin provider protocol: ${provider.protocol}`);
      if (!provider.command.trim()) throw new Error(`plugin provider ${provider.id} requires command`);
      if (provider.command.includes('\0')) throw new Error(`plugin provider ${provider.id} command contains invalid characters`);
    }
    const capabilityIDs = Array.from(new Set([
      ...(Array.isArray(raw.capability_ids) ? raw.capability_ids.map(String).filter(Boolean) : []),
      ...capabilityDefinitions.map((capability) => String(capability.id || '').trim()).filter(Boolean),
    ]));
    const skillIDs = skills.map((skill) => String(skill.id || '').trim()).filter(Boolean);
    const mcpServerIDs = mcpServers.map((server) => String(server.id || '').trim()).filter(Boolean);
    this.transaction(() => {
      for (const capability of capabilityDefinitions) {
        const capabilityID = String(capability.id || '').trim();
        const capabilityName = String(capability.name || '').trim();
        if (!capabilityID || !capabilityName) throw new Error('plugin capability requires id and name');
        this.exec(
          `INSERT INTO capabilities (id, name, description, risk_level, input_schema, output_schema, enabled, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name=excluded.name, description=excluded.description, risk_level=excluded.risk_level,
             input_schema=excluded.input_schema, output_schema=excluded.output_schema,
             enabled=excluded.enabled, metadata=excluded.metadata, updated_at=datetime('now')`,
          capabilityID,
          capabilityName,
          String(capability.description || ''),
          String(capability.risk_level || 'read_only'),
          json(isRecord(capability.input_schema) ? capability.input_schema : {}),
          json(isRecord(capability.output_schema) ? capability.output_schema : {}),
          capability.enabled === false ? 0 : 1,
          json({ ...(isRecord(capability.metadata) ? capability.metadata : {}), plugin_id: id, source: 'plugin_manifest' }),
        );
      }
      for (const workflow of workflows) {
        const workflowID = String(workflow.id || '').trim();
        const workflowName = String(workflow.name || '').trim();
        const capabilityID = String(workflow.capability_id || '').trim();
        if (!workflowID || !workflowName || !capabilityID) throw new Error('plugin workflow requires id, name and capability_id');
        if (!capabilityIDs.includes(capabilityID)) throw new Error(`plugin workflow references unregistered capability: ${capabilityID}`);
        this.exec(
          `INSERT INTO tool_workflows (id, capability_id, name, version, risk_level, steps, enabled, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             capability_id=excluded.capability_id, name=excluded.name, version=excluded.version,
             risk_level=excluded.risk_level, steps=excluded.steps, enabled=excluded.enabled,
             metadata=excluded.metadata, updated_at=datetime('now')`,
          workflowID,
          capabilityID,
          workflowName,
          String(workflow.version || 'v1'),
          String(workflow.risk_level || 'read_only'),
          json(Array.isArray(workflow.steps) ? workflow.steps : []),
          workflow.enabled === false ? 0 : 1,
          json({ ...(isRecord(workflow.metadata) ? workflow.metadata : {}), plugin_id: id, source: 'plugin_manifest' }),
        );
      }
      for (const skill of skills) {
        const skillID = String(skill.id || '').trim();
        const skillName = String(skill.name || '').trim();
        if (!skillID || !skillName) throw new Error('plugin skill requires id and name');
        this.exec(
          `INSERT INTO skill_definitions (id, version, name, description, trigger_phrases, required_capabilities,
                                          forbidden_capabilities, prompt, output_contract, enabled, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             version=excluded.version, name=excluded.name, description=excluded.description,
             trigger_phrases=excluded.trigger_phrases, required_capabilities=excluded.required_capabilities,
             forbidden_capabilities=excluded.forbidden_capabilities, prompt=excluded.prompt,
             output_contract=excluded.output_contract, enabled=excluded.enabled, metadata=excluded.metadata,
             updated_at=datetime('now')`,
          skillID,
          String(skill.version || 'v1'),
          skillName,
          String(skill.description || ''),
          json(Array.isArray(skill.trigger_phrases) ? skill.trigger_phrases : []),
          json(Array.isArray(skill.required_capabilities) ? skill.required_capabilities : []),
          json(Array.isArray(skill.forbidden_capabilities) ? skill.forbidden_capabilities : []),
          String(skill.prompt || ''),
          String(skill.output_contract || ''),
          skill.enabled === false ? 0 : 1,
          json({ ...(isRecord(skill.metadata) ? skill.metadata : {}), plugin_id: id, source: 'plugin_manifest' }),
        );
      }
      for (const server of mcpServers) {
        const serverID = String(server.id || '').trim();
        const serverName = String(server.name || '').trim();
        if (!serverID || !serverName) throw new Error('plugin MCP server requires id and name');
        this.exec(
          `INSERT INTO mcp_servers (id, name, transport, command, args, enabled, status, trust, metadata)
           VALUES (?, ?, 'stdio', ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name=excluded.name, transport=excluded.transport, command=excluded.command, args=excluded.args,
             enabled=excluded.enabled, status=excluded.status, trust=excluded.trust, metadata=excluded.metadata,
             updated_at=datetime('now')`,
          serverID,
          serverName,
          String(server.command || '').trim(),
          json(Array.isArray(server.args) ? server.args : []),
          server.enabled === false ? 0 : 1,
          server.enabled === false ? 'inactive' : 'configured',
          String(server.trust || 'untrusted_until_wrapped'),
          json({ ...(isRecord(server.metadata) ? server.metadata : {}), plugin_id: id, source: 'plugin_manifest' }),
        );
      }
      this.exec(
        `INSERT INTO plugin_definitions (id, name, version, description, enabled, status, manifest_path,
                                         capability_ids, skill_ids, mcp_server_ids, metadata)
         VALUES (?, ?, ?, ?, ?, 'installed', ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, version=excluded.version, description=excluded.description,
           enabled=excluded.enabled, status='installed', manifest_path=excluded.manifest_path,
           capability_ids=excluded.capability_ids, skill_ids=excluded.skill_ids,
           mcp_server_ids=excluded.mcp_server_ids, metadata=excluded.metadata,
           updated_at=datetime('now')`,
        id,
        name,
        version,
        String(raw.description || ''),
        raw.enabled === false ? 0 : 1,
        manifestPath,
        json(capabilityIDs),
        json(skillIDs),
        json(mcpServerIDs),
        json({
          ...(isRecord(raw.metadata) ? raw.metadata : {}),
          ...(options.metadata || {}),
          providers,
          source: String(options.metadata?.source || 'local_manifest'),
        }),
      );
    });
    const plugin = this.listPlugins().plugins.find((item) => item.id === id);
    if (!plugin) throw new Error(`plugin not found after install: ${id}`);
    return { plugin };
  }

  getEnabledPluginProvider(providerIDInput: string): PluginProviderConfig | undefined {
    const providerID = providerIDInput.trim();
    if (!providerID) return undefined;
    for (const plugin of this.listPlugins().plugins) {
      if (!plugin.enabled) continue;
      const providers = normalizePluginProviders(plugin.metadata?.providers, plugin.id);
      const provider = providers.find((item) => item.id === providerID);
      if (!provider) continue;
      const pluginRoot = plugin.manifest_path ? dirname(resolve(plugin.manifest_path)) : '';
      const command = isAbsolute(provider.command) ? resolve(provider.command) : resolve(pluginRoot, provider.command);
      if (!pluginRoot || !pathWithinRoot(command, pluginRoot)) return undefined;
      return {
        ...provider,
        command,
        plugin_id: plugin.id,
        plugin_root: pluginRoot,
      };
    }
    return undefined;
  }

  setPluginEnabled(req: { id?: string; enabled?: boolean }): { plugin: PluginRecord } {
    const id = req.id?.trim();
    if (!id) throw new Error('plugin id is required');
    const plugin = this.listPlugins().plugins.find((item) => item.id === id);
    if (!plugin) throw new Error(`plugin not found: ${id}`);
    if (plugin.metadata?.core === true && req.enabled === false) throw new Error('core plugin cannot be disabled');
    const enabled = req.enabled === false ? 0 : 1;
    this.transaction(() => {
      this.exec(`UPDATE plugin_definitions SET enabled=?, status=?, updated_at=datetime('now') WHERE id=?`, enabled, enabled ? 'installed' : 'disabled', id);
      for (const skillID of plugin.skill_ids) this.exec(`UPDATE skill_definitions SET enabled=?, updated_at=datetime('now') WHERE id=?`, enabled, skillID);
      for (const serverID of plugin.mcp_server_ids) this.exec(`UPDATE mcp_servers SET enabled=?, status=?, updated_at=datetime('now') WHERE id=?`, enabled, enabled ? 'configured' : 'inactive', serverID);
      for (const capabilityID of plugin.capability_ids) this.exec(`UPDATE capabilities SET enabled=?, updated_at=datetime('now') WHERE id=?`, enabled, capabilityID);
      for (const capabilityID of plugin.capability_ids) this.exec(`UPDATE tool_workflows SET enabled=?, updated_at=datetime('now') WHERE capability_id=? AND json_extract(metadata, '$.plugin_id')=?`, enabled, capabilityID, id);
    });
    return { plugin: this.listPlugins().plugins.find((item) => item.id === id) as PluginRecord };
  }

  removePlugin(idInput: string): void {
    const id = idInput.trim();
    if (!id) throw new Error('plugin id is required');
    const plugin = this.listPlugins().plugins.find((item) => item.id === id);
    if (!plugin) throw new Error(`plugin not found: ${id}`);
    if (plugin.metadata?.core === true) throw new Error('core plugin cannot be removed');
    this.transaction(() => {
      for (const skillID of plugin.skill_ids) this.exec(`UPDATE skill_definitions SET enabled=0, updated_at=datetime('now') WHERE id=?`, skillID);
      for (const serverID of plugin.mcp_server_ids) this.exec(`UPDATE mcp_servers SET enabled=0, status='inactive', updated_at=datetime('now') WHERE id=?`, serverID);
      for (const capabilityID of plugin.capability_ids) this.exec(`UPDATE capabilities SET enabled=0, updated_at=datetime('now') WHERE id=?`, capabilityID);
      for (const capabilityID of plugin.capability_ids) this.exec(`UPDATE tool_workflows SET enabled=0, updated_at=datetime('now') WHERE capability_id=? AND json_extract(metadata, '$.plugin_id')=?`, capabilityID, id);
      this.exec(`DELETE FROM plugin_definitions WHERE id=?`, id);
    });
  }

  listToolWorkflows(): { workflows: ToolWorkflowRecord[] } {
    const rows = this.all(
      `SELECT id, capability_id, name, version, risk_level, steps, enabled, metadata, created_at, updated_at
       FROM tool_workflows
       ORDER BY capability_id ASC, name ASC`,
    );
    return { workflows: rows.map(rowToToolWorkflow) };
  }

  listToolRuns(limit = 50): { tool_runs: ToolRunRecord[] } {
    const rows = this.all(
      `SELECT id, run_id, task_id, capability_id, workflow_name, tool_id, tool_name, node_id,
              assignment_reason, risk_level, status, input, output, error, started_at, finished_at, duration_ms, created_at
       FROM tool_runs
       ORDER BY datetime(created_at) DESC, datetime(started_at) DESC
       LIMIT ?`,
      clampLimit(limit, 50),
    );
    return { tool_runs: rows.map(rowToToolRun) };
  }

  setToolWorkflowEnabled(req: { name?: string; enabled?: boolean }): void {
    const name = req.name?.trim();
    if (!name) throw new Error('workflow name is required');
    this.exec(`UPDATE tool_workflows SET enabled=?, updated_at=datetime('now') WHERE name=?`, req.enabled ? 1 : 0, name);
  }

  getMemorySystem(): MemorySystemSnapshot {
    const row = this.get(`SELECT * FROM memory_maintenance_runs ORDER BY datetime(started_at) DESC LIMIT 1`);
    const constitution = this.get(
      `SELECT * FROM persona_constitutions WHERE status='active' ORDER BY version DESC LIMIT 1`,
    );
    return {
      settings: this.getMemorySettings(),
      constitution: constitution ? rowToPersonaConstitution(constitution) : undefined,
      latest_maintenance: row ? rowToMemoryMaintenance(row) : undefined,
      metrics: this.memoryQualityMetrics(),
    };
  }

  getMemorySettings(): MemorySettingsRecord {
    const settings = this.desktopSettings();
    const policy = this.memoryPolicyConfig();
    return {
      use_memories: settingBoolean(settings['memory.use_memories'], Boolean(policy.use_memories)),
      generate_memories: settingBoolean(settings['memory.generate_memories'], Boolean(policy.generate_memories)),
      disable_on_external_context: settingBoolean(settings['memory.disable_on_external_context'], Boolean(policy.disable_on_external_context)),
      background_idle_seconds: clampMemoryIdleSeconds(Number(settings['memory.background_idle_seconds'] || policy.background_idle_seconds || DEFAULT_MEMORY_POLICY.background_idle_seconds)),
      pipeline_version: MEMORY_PIPELINE_VERSION,
    };
  }

  saveMemorySettings(req: Partial<MemorySettingsRecord>): MemorySettingsRecord {
    const current = this.getMemorySettings();
    const next: MemorySettingsRecord = {
      use_memories: req.use_memories ?? current.use_memories,
      generate_memories: req.generate_memories ?? current.generate_memories,
      disable_on_external_context: req.disable_on_external_context ?? current.disable_on_external_context,
      background_idle_seconds: clampMemoryIdleSeconds(req.background_idle_seconds ?? current.background_idle_seconds),
      pipeline_version: MEMORY_PIPELINE_VERSION,
    };
    this.setDesktopSettings({
      'memory.use_memories': String(next.use_memories),
      'memory.generate_memories': String(next.generate_memories),
      'memory.disable_on_external_context': String(next.disable_on_external_context),
      'memory.background_idle_seconds': String(next.background_idle_seconds),
    });
    this.exec(
      `UPDATE memory_policies SET config=?, updated_at=datetime('now') WHERE id='memory_policy_v3'`,
      json({ ...this.memoryPolicyConfig(), ...next, version: DEFAULT_MEMORY_POLICY.version }),
    );
    if (next.generate_memories) this.scheduleMemoryMaintenance('settings_enabled', next.background_idle_seconds * 1_000);
    return next;
  }

  runMemoryMaintenance(req: { trigger_source?: string } = {}): { run: MemoryMaintenanceRun } {
    const triggerSource = req.trigger_source?.trim() || 'manual';
    const maintenanceID = `mmrun_${newID()}`;
    this.exec(
      `INSERT INTO memory_maintenance_runs (id, status, trigger_source, started_at)
       VALUES (?, 'running', ?, datetime('now'))`,
      maintenanceID,
      triggerSource,
    );
    let processedInputCount = 0;
    let generatedObservationCount = 0;
    let expiredCount = 0;
    let mergedCount = 0;
    let embeddingCount = 0;
    let quarantinedCount = 0;
    try {
      const policy = this.memoryPolicyConfig();
      const processAllPending = ['manual', 'desktop_ui', 'test'].includes(triggerSource);
      const inputs = this.all(
        `SELECT * FROM memory_generation_inputs
         WHERE status='pending' AND (?=1 OR datetime(eligible_after) <= datetime('now'))
         ORDER BY datetime(created_at) ASC
         LIMIT 50`,
        processAllPending ? 1 : 0,
      );
      this.transaction(() => {
        for (const input of inputs) {
          const generated = this.processMemoryGenerationInput(input);
          processedInputCount += 1;
          generatedObservationCount += generated;
        }

        for (const row of this.all(`SELECT * FROM memories WHERE status <> 'deleted'`)) {
          const memory = rowToMemory(row);
          const metadata = parseObject(row.metadata);
          const quarantineReason = memoryQuarantineReason(`${memory.summary}\n${memory.content}`);
          const quarantineEligible = ['pending', 'candidate', 'proposed', 'observed'].includes(memory.status);
          if (quarantineReason && quarantineEligible) {
            this.exec(
              `UPDATE memories
               SET status='quarantined', lifecycle_state='quarantined', disabled_at=COALESCE(disabled_at, datetime('now')),
                   archived_at=COALESCE(archived_at, datetime('now')), review_reason=?, metadata=?, updated_at=datetime('now')
               WHERE id=?`,
              quarantineReason,
              json({
                ...metadata,
                quarantine_reason: quarantineReason,
                quarantined_by: MEMORY_PIPELINE_VERSION,
                quarantined_at: nowIso(),
              }),
              memory.id,
            );
            this.exec(
              `UPDATE memory_observations
               SET status='quarantined', review_reason=COALESCE(NULLIF(review_reason, ''), ?),
                   metadata=json_set(COALESCE(metadata, '{}'), '$.quarantine_reason', ?, '$.quarantined_by', ?)
               WHERE memory_id=? AND status <> 'promoted'`,
              quarantineReason,
              quarantineReason,
              MEMORY_PIPELINE_VERSION,
              memory.id,
            );
            this.exec(`DELETE FROM memory_embeddings WHERE memory_id=?`, memory.id);
            this.insertMemoryEvolutionEvent(memory.id, 'auto_quarantined', '', '', {
              status: 'quarantined',
              lifecycle_state: 'quarantined',
              maintenance_id: maintenanceID,
            }, quarantineReason);
            quarantinedCount += 1;
            continue;
          }
          const layer = inferLegacyMemoryLayer(memory.type, { ...metadata, layer: memory.layer });
          const tags = memory.context_tags?.length ? memory.context_tags : inferMemoryContextTags(`${memory.summary} ${memory.content}`);
          const memoryKey = memory.memory_key || canonicalMemoryKey(memory.content, layer, memory.type, tags);
          const validUntil = memory.valid_until || memoryExpiryFromMetadata(metadata);
          const expired = Boolean(validUntil && Number.isFinite(Date.parse(validUntil)) && Date.parse(validUntil) <= Date.now());
          const provisionalExpired = ['pending', 'candidate', 'proposed', 'observed'].includes(memory.status)
            && Date.now() - Date.parse(memory.created_at || nowIso()) > policy.provisional_retention_days * 86_400_000;
          const nextStatus = expired || provisionalExpired ? 'archived' : memory.status;
          const nextLifecycle = expired || provisionalExpired
            ? 'expired'
            : memory.merged_into_memory_id
              ? 'superseded'
              : memory.disabled
                ? 'disabled'
                : memory.status === 'conflicted'
                  ? 'review'
                  : ['pending', 'candidate', 'proposed', 'observed'].includes(memory.status)
                    ? 'provisional'
                    : memory.lifecycle_state || 'active';
          if ((expired || provisionalExpired) && memory.lifecycle_state !== 'expired') expiredCount += 1;
          this.exec(
            `UPDATE memories
             SET layer=?, memory_key=?, context_tags=?, status=?, lifecycle_state=?,
                 valid_until=COALESCE(NULLIF(valid_until, ''), NULLIF(?, '')),
                 disabled_at=CASE WHEN ?='expired' THEN COALESCE(disabled_at, datetime('now')) ELSE disabled_at END,
                 archived_at=CASE WHEN ?='expired' THEN COALESCE(archived_at, datetime('now')) ELSE archived_at END,
                 updated_at=CASE WHEN layer<>? OR memory_key<>? OR status<>? OR lifecycle_state<>? THEN datetime('now') ELSE updated_at END
             WHERE id=?`,
            layer,
            memoryKey,
            json(tags),
            nextStatus,
            nextLifecycle,
            validUntil || '',
            nextLifecycle,
            nextLifecycle,
            layer,
            memoryKey,
            nextStatus,
            nextLifecycle,
            memory.id,
          );
          const embedding = this.get(
            `SELECT id FROM memory_embeddings WHERE memory_id=? AND embedding_model=? LIMIT 1`,
            memory.id,
            LOCAL_MEMORY_EMBEDDING_MODEL,
          );
          if (!embedding && nextLifecycle !== 'expired') {
            this.upsertMemoryEmbedding(memory.id, `${memory.summary} ${memory.content} ${tags.join(' ')}`);
            embeddingCount += 1;
          }
        }

        const duplicateGroups = this.all(
          `SELECT memory_key, layer, scope_type, COALESCE(scope_id, '') AS scope_id, COUNT(*) AS count
           FROM memories
           WHERE memory_key<>'' AND status IN ('confirmed','observed','pending')
             AND lifecycle_state IN ('active','provisional','review') AND disabled_at IS NULL
           GROUP BY memory_key, layer, scope_type, COALESCE(scope_id, '')
           HAVING COUNT(*) > 1`,
        );
        for (const group of duplicateGroups) {
          const rows = this.all(
            `SELECT * FROM memories
             WHERE memory_key=? AND layer=? AND scope_type=? AND COALESCE(scope_id, '')=?
               AND status IN ('confirmed','observed','pending') AND disabled_at IS NULL
             ORDER BY CASE status WHEN 'confirmed' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                      evidence_authority DESC, evidence_count DESC, confidence DESC, datetime(updated_at) DESC`,
            String(group.memory_key),
            String(group.layer),
            String(group.scope_type),
            String(group.scope_id),
          );
          const winner = rows[0];
          if (!winner) continue;
          for (const loser of rows.slice(1)) {
            if (normalizeMemoryText(optionalString(winner.content) || '') !== normalizeMemoryText(optionalString(loser.content) || '')) continue;
            const evidenceCount = Math.max(1, Number(winner.evidence_count || 1)) + Math.max(1, Number(loser.evidence_count || 1));
            const sourceEventIDs = [...new Set([...parseStringArray(winner.source_event_ids), ...parseStringArray(loser.source_event_ids)])];
            this.exec(
              `UPDATE memories SET evidence_count=?, source_event_ids=?, confidence=MAX(confidence, ?), last_verified_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
              evidenceCount,
              json(sourceEventIDs),
              Number(loser.confidence || 0),
              String(winner.id),
            );
            this.exec(
              `UPDATE memories SET status='superseded', lifecycle_state='superseded', merged_into_memory_id=?, disabled_at=datetime('now'), archived_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
              String(winner.id),
              String(loser.id),
            );
            this.insertMemoryEvolutionEvent(String(loser.id), 'auto_merged', '', '', {
              merged_into_memory_id: String(winner.id),
              maintenance_id: maintenanceID,
            }, 'exact_duplicate_same_scope');
            winner.evidence_count = evidenceCount;
            winner.source_event_ids = json(sourceEventIDs);
            mergedCount += 1;
          }
        }
      });
      this.exec(
        `UPDATE memory_maintenance_runs
         SET status='completed', processed_input_count=?, generated_observation_count=?, expired_count=?, merged_count=?, quarantined_count=?, embedding_count=?,
             metadata=?, finished_at=datetime('now') WHERE id=?`,
        processedInputCount,
        generatedObservationCount,
        expiredCount,
        mergedCount,
        quarantinedCount,
        embeddingCount,
        json({ pipeline_version: MEMORY_PIPELINE_VERSION, physical_delete: false, quarantined_count: quarantinedCount }),
        maintenanceID,
      );
    } catch (error) {
      this.exec(
        `UPDATE memory_maintenance_runs SET status='failed', error_summary=?, finished_at=datetime('now') WHERE id=?`,
        error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
        maintenanceID,
      );
      throw error;
    }
    return { run: rowToMemoryMaintenance(this.get(`SELECT * FROM memory_maintenance_runs WHERE id=?`, maintenanceID) || { id: maintenanceID, status: 'completed' }) };
  }

  listMemories(filter: { query?: string; limit?: number } = {}): { memories: MemoryRecord[]; metrics: MemoryQualityMetrics } {
    const limit = clampLimit(filter.limit, 100);
    const query = filter.query?.trim();
    if (query) {
      const like = `%${escapeLike(query)}%`;
      const rows = this.all(
        `SELECT * FROM memories
         WHERE status='confirmed'
           AND disabled_at IS NULL
           AND merged_into_memory_id IS NULL
           AND (content LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR type LIKE ? ESCAPE '\\')
         ORDER BY pinned DESC, confidence DESC, datetime(updated_at) DESC
         LIMIT ?`,
        like,
        like,
        like,
        limit,
      );
      return { memories: rows.map(rowToMemory), metrics: this.memoryQualityMetrics() };
    }
    const rows = this.all(
      `SELECT * FROM memories
       WHERE status <> 'deleted'
       ORDER BY pinned DESC, datetime(updated_at) DESC
       LIMIT ?`,
      limit,
    );
    return { memories: rows.map(rowToMemory), metrics: this.memoryQualityMetrics() };
  }

  recallMemoriesForTool(req: ChatRequest, query = '', limit = 8): { memories: MemorySearchResult[]; scope: MemoryRetrievalScope } {
    const scope = this.resolveMemoryRetrievalScope(req);
    return {
      memories: this.searchPromptMemories(query.trim(), clampLimit(limit, 8), scope),
      scope,
    };
  }

  createMemoryCandidateForTool(req: ChatRequest, input: {
    content?: string;
    summary?: string;
    type?: string;
    scope?: string;
    source?: string;
  }): {
    candidate: {
      id: string;
      type: string;
      content: string;
      summary: string;
      scope_type: string;
      scope_id: string;
      status: string;
    };
    deduped: boolean;
  } {
    const content = input.content?.trim() || '';
    if (!content) throw new Error('memory candidate content is required');
    if (content.length > 20_000) throw new Error('memory candidate content exceeds 20000 characters');
    const quarantineReason = memoryQuarantineReason(content);
    if (quarantineReason) throw new Error(`memory candidate rejected: ${quarantineReason}`);
    const summary = (input.summary?.trim() || titleFromMessage(content)).slice(0, 500);
    const type = normalizeToolMemoryType(input.type);
    const scope = this.resolveMemoryRetrievalScope(req);
    const requestedScope = (input.scope || 'current_context').trim().toLowerCase();
    const resolvedScope = resolveToolMemoryCandidateScope(requestedScope, scope);
    const existing = this.get(
      `SELECT id, type, content, COALESCE(summary, '') AS summary, scope_type, COALESCE(scope_id, '') AS scope_id, status
       FROM memories
       WHERE lower(trim(content))=lower(trim(?))
         AND status <> 'deleted'
         AND scope_type=?
         AND COALESCE(scope_id, '')=?
       ORDER BY datetime(updated_at) DESC
       LIMIT 1`,
      content,
      resolvedScope.scope_type,
      resolvedScope.scope_id,
    );
    if (existing) {
      return {
        candidate: {
          id: String(existing.id),
          type: optionalString(existing.type) || type,
          content: optionalString(existing.content) || content,
          summary: optionalString(existing.summary) || summary,
          scope_type: optionalString(existing.scope_type) || resolvedScope.scope_type,
          scope_id: optionalString(existing.scope_id) || '',
          status: optionalString(existing.status) || 'pending',
        },
        deduped: true,
      };
    }
    const memoryID = `mem_${newID()}`;
    const layer = inferLegacyMemoryLayer(type);
    const contextTags = inferMemoryContextTags(`${summary} ${content}`);
    const memoryKey = canonicalMemoryKey(content, layer, type, contextTags);
    this.exec(
      `INSERT INTO memories (
         id, layer, type, memory_key, content, summary, scope_type, scope_id, privacy_level,
         evidence_kind, evidence_authority, evidence_count, confidence, status, lifecycle_state,
         source_event_ids, source_kind, entities, context_tags, review_reason, auto_managed, metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), 'internal',
                 'explicit', ?, 1, 0.7, 'pending', 'review',
                 '[]', 'model_tool_candidate', '[]', ?, 'tool_candidate_requires_confirmation', 0, ?)`,
      memoryID,
      layer,
      type,
      memoryKey,
      content,
      summary,
      resolvedScope.scope_type,
      resolvedScope.scope_id,
      memoryEvidenceAuthority('explicit'),
      json(contextTags),
      json({
        pipeline_version: MEMORY_PIPELINE_VERSION,
        source: input.source?.trim() || 'model_tool_candidate',
        created_by: 'memory_write_candidate',
        needs_user_review: true,
        requested_scope: requestedScope,
      }),
    );
    return {
      candidate: {
        id: memoryID,
        type,
        content,
        summary,
        scope_type: resolvedScope.scope_type,
        scope_id: resolvedScope.scope_id,
        status: 'pending',
      },
      deduped: false,
    };
  }

  private memoryQualityMetrics(): MemoryQualityMetrics {
    const status = this.get(
      `SELECT
         SUM(CASE WHEN status='confirmed' AND disabled_at IS NULL AND merged_into_memory_id IS NULL THEN 1 ELSE 0 END) AS confirmed_count,
         SUM(CASE WHEN status IN ('pending','candidate','proposed','conflicted') THEN 1 ELSE 0 END) AS candidate_count,
         SUM(CASE WHEN status IN ('pending','candidate','proposed','conflicted') AND datetime(created_at) < datetime('now', '-7 days') THEN 1 ELSE 0 END) AS old_candidate_count,
         SUM(CASE WHEN status='confirmed' AND disabled_at IS NULL AND merged_into_memory_id IS NULL
                       AND COALESCE(datetime(last_used_at), datetime(updated_at), datetime(created_at)) < datetime('now', '-90 days')
                  THEN 1 ELSE 0 END) AS stale_confirmed_count,
         SUM(CASE WHEN status='observed' THEN 1 ELSE 0 END) AS observed_count,
         SUM(CASE WHEN status IN ('archived','superseded') OR lifecycle_state IN ('archived','expired','superseded') THEN 1 ELSE 0 END) AS archived_count,
         SUM(CASE WHEN status='quarantined' OR lifecycle_state='quarantined' THEN 1 ELSE 0 END) AS quarantined_count,
         MIN(CASE WHEN status IN ('pending','candidate','proposed','conflicted') THEN created_at END) AS oldest_candidate_at
       FROM memories`,
    );
    const duplicate = this.get(
      `SELECT COALESCE(SUM(group_count - 1), 0) AS duplicate_candidate_count
       FROM (
         SELECT COUNT(*) AS group_count
         FROM memories
         WHERE status IN ('pending','candidate','proposed','conflicted')
         GROUP BY lower(trim(content))
         HAVING COUNT(*) > 1
       )`,
    );
    const usage = this.get(
      `SELECT COUNT(*) AS recalled_count,
              SUM(CASE WHEN injected=1 THEN 1 ELSE 0 END) AS injected_count,
              SUM(CASE WHEN used_in_answer=1 THEN 1 ELSE 0 END) AS used_in_answer_count,
              SUM(CASE WHEN influence_state='inferred_used' THEN 1 ELSE 0 END) AS inferred_used_count,
              SUM(CASE WHEN injected=1 AND used_in_answer=0 THEN 1 ELSE 0 END) AS unused_injection_count
       FROM memory_usage_logs`,
    );
    const feedback = this.get(
      `SELECT SUM(CASE WHEN feedback IN ('positive','helpful','confirm') THEN 1 ELSE 0 END) AS positive_feedback_count,
              SUM(CASE WHEN feedback IN ('negative','unhelpful','reject','delete') THEN 1 ELSE 0 END) AS negative_feedback_count
       FROM memory_feedback`,
    );
    const scopeCounts: Record<string, number> = {};
    for (const row of this.all(`SELECT scope_type, COUNT(*) AS count FROM memories WHERE status='confirmed' AND disabled_at IS NULL GROUP BY scope_type`)) {
      scopeCounts[optionalString(row.scope_type) || 'global'] = Number(row.count || 0);
    }
    const layerCounts: Record<string, number> = {};
    for (const row of this.all(`SELECT layer, COUNT(*) AS count FROM memories WHERE status='confirmed' AND disabled_at IS NULL GROUP BY layer`)) {
      layerCounts[optionalString(row.layer) || 'knowledge'] = Number(row.count || 0);
    }
    layerCounts.persona = Number(this.get(
      `SELECT COUNT(*) AS count FROM persona_constitutions WHERE status='active'`,
    )?.count || 0);
    const embeddingCount = Number(this.get(`SELECT COUNT(*) AS count FROM memory_embeddings WHERE embedding_model=?`, LOCAL_MEMORY_EMBEDDING_MODEL)?.count || 0);
    const generationQueueCount = Number(this.get(`SELECT COUNT(*) AS count FROM memory_generation_inputs WHERE status='pending'`)?.count || 0);
    const abstentionCount = Number(this.get(`SELECT COUNT(*) AS count FROM run_events WHERE event_type IN ('memory.retrieval.abstained','memory.learning.abstained')`)?.count || 0);
    const injectedCount = Number(usage?.injected_count || 0);
    const usedInAnswerCount = Number(usage?.used_in_answer_count || 0);
    return {
      confirmed_count: Number(status?.confirmed_count || 0),
      candidate_count: Number(status?.candidate_count || 0),
      old_candidate_count: Number(status?.old_candidate_count || 0),
      stale_confirmed_count: Number(status?.stale_confirmed_count || 0),
      duplicate_candidate_count: Number(duplicate?.duplicate_candidate_count || 0),
      recalled_count: Number(usage?.recalled_count || 0),
      injected_count: injectedCount,
      used_in_answer_count: usedInAnswerCount,
      unused_injection_count: Number(usage?.unused_injection_count || 0),
      positive_feedback_count: Number(feedback?.positive_feedback_count || 0),
      negative_feedback_count: Number(feedback?.negative_feedback_count || 0),
      injection_use_rate: injectedCount > 0 ? usedInAnswerCount / injectedCount : 0,
      scope_counts: scopeCounts,
      layer_counts: layerCounts,
      inferred_used_count: Number(usage?.inferred_used_count || 0),
      abstention_count: abstentionCount,
      archived_count: Number(status?.archived_count || 0),
      quarantined_count: Number(status?.quarantined_count || 0),
      observed_count: Number(status?.observed_count || 0),
      embedding_count: embeddingCount,
      generation_queue_count: generationQueueCount,
      oldest_candidate_at: optionalString(status?.oldest_candidate_at),
    };
  }

  private memoryPolicyConfig(): MemoryPolicyConfig {
    const row = this.get(`SELECT config FROM memory_policies WHERE status='active' ORDER BY version DESC, datetime(updated_at) DESC LIMIT 1`);
    return { ...DEFAULT_MEMORY_POLICY, ...(row ? parseObject(row.config) : {}) } as MemoryPolicyConfig;
  }

  private effectiveMemoryControls(req: ChatRequest): MemoryTaskControls {
    const defaults = this.getMemorySettings();
    return {
      use_memories: req.memory_controls?.use_memories ?? defaults.use_memories,
      generate_memories: req.memory_controls?.generate_memories ?? defaults.generate_memories,
      disable_on_external_context: req.memory_controls?.disable_on_external_context ?? defaults.disable_on_external_context,
      external_context_used: req.memory_controls?.external_context_used,
    };
  }

  private scheduleMemoryMaintenance(triggerSource: string, delayMs?: number): void {
    if (this.closed) return;
    if (this.memoryMaintenanceTimer) clearTimeout(this.memoryMaintenanceTimer);
    const delay = Math.max(1_000, delayMs ?? this.getMemorySettings().background_idle_seconds * 1_000);
    this.memoryMaintenanceTimer = setTimeout(() => {
      this.memoryMaintenanceTimer = undefined;
      if (this.closed) return;
      try {
        this.runMemoryMaintenance({ trigger_source: triggerSource });
      } catch {
        // runMemoryMaintenance persists its own failed run. A background failure
        // must not keep the app or a chat run alive.
      }
    }, delay);
    (this.memoryMaintenanceTimer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  }

  private recordPostRunMemoryLearning(req: ChatRequest, runID: string, turnID: string, response = ''): void {
    const controls = this.effectiveMemoryControls(req);
    const run = this.get(
      `SELECT r.conversation_id, r.user_message_id, r.resolved_mode, r.principal_id,
              t.assistant_message_id, c.active_project_id, c.user_id
       FROM runs r
       LEFT JOIN turns t ON t.id=?
       LEFT JOIN conversations c ON c.id=r.conversation_id
       WHERE r.id=?`,
      turnID,
      runID,
    );
    if (!run) return;
    const existing = this.get(`SELECT id FROM memory_generation_inputs WHERE run_id=? LIMIT 1`, runID);
    if (existing) return;
    const externalTool = this.get(
      `SELECT id FROM tool_runs
       WHERE run_id=? AND (
         capability_id IN ('web_research','browser_navigate','browser_observe')
         OR lower(COALESCE(tool_name, '')) LIKE 'mcp__%'
         OR lower(COALESCE(tool_name, '')) LIKE '%web_search%'
         OR lower(COALESCE(tool_name, '')) LIKE '%tool_search%'
       ) LIMIT 1`,
      runID,
    );
    const externalContextUsed = controls.external_context_used === true || Boolean(externalTool);
    const generationReason = memoryGenerationExclusionReason(req.message || '');
    const hardExclusion = generationReason === 'interrogative_prompt' ? '' : generationReason;
    const exclusionReason = !controls.generate_memories
      ? 'generation_disabled'
      : controls.disable_on_external_context && externalContextUsed
        ? 'external_context_guard'
        : hardExclusion;
    const observations = exclusionReason ? [] : extractMemoryObservations(req.message || '', {
      projectID: optionalString(run.active_project_id),
      userID: optionalString(run.principal_id) || optionalString(run.user_id) || 'desktop_user',
      stateTTLDays: this.memoryPolicyConfig().state_ttl_days,
    });
    const immediate = observations.filter((observation) => observation.explicit || observation.correction);
    const status = exclusionReason ? 'skipped' : immediate.length > 0 ? 'processed' : 'pending';
    const eligibleAfter = new Date(Date.now() + this.getMemorySettings().background_idle_seconds * 1_000).toISOString();
    const inputID = `mgin_${newID()}`;
    this.exec(
      `INSERT INTO memory_generation_inputs (
         id, run_id, turn_id, conversation_id, user_message_id, assistant_message_id,
         status, eligible_after, external_context_used, exclusion_reason, controls, metadata, processed_at
       ) VALUES (?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?, CASE WHEN ?='pending' THEN NULL ELSE datetime('now') END)`,
      inputID,
      runID,
      turnID,
      optionalString(run.conversation_id) || '',
      optionalString(run.user_message_id) || '',
      optionalString(run.assistant_message_id) || '',
      status,
      eligibleAfter,
      externalContextUsed ? 1 : 0,
      exclusionReason,
      json(controls),
      json({ pipeline_version: MEMORY_PIPELINE_VERSION, immediate_observation_count: immediate.length }),
      status,
    );
    if (exclusionReason) {
      this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'memory.generation.skipped', {
        item_type: 'memory_generation_input',
        item_id: inputID,
        status: 'skipped',
        visibility: 'memory',
        source: 'memory_runtime',
        reason: exclusionReason,
        external_context_used: externalContextUsed,
        pipeline_version: MEMORY_PIPELINE_VERSION,
      });
      return;
    }
    if (immediate.length > 0) {
      for (const observation of immediate) {
        this.processMemoryObservation(observation, {
          runID,
          turnID,
          conversationID: optionalString(run.conversation_id) || '',
          sourceKind: 'explicit_conversation',
        });
      }
      return;
    }
    this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'memory.generation.queued', {
      item_type: 'memory_generation_input',
      item_id: inputID,
      status: 'pending',
      visibility: 'memory',
      source: 'memory_runtime',
      eligible_after: eligibleAfter,
      pipeline_version: MEMORY_PIPELINE_VERSION,
    });
    this.scheduleMemoryMaintenance('idle_timer');
  }

  private processMemoryGenerationInput(input: SQLiteRow): number {
    const inputID = String(input.id);
    if (optionalString(input.exclusion_reason)) {
      this.exec(`UPDATE memory_generation_inputs SET status='skipped', processed_at=datetime('now') WHERE id=?`, inputID);
      return 0;
    }
    const userMessage = this.get(`SELECT content FROM messages WHERE id=?`, optionalString(input.user_message_id) || '');
    const assistantMessage = this.get(`SELECT content FROM messages WHERE id=?`, optionalString(input.assistant_message_id) || '');
    const run = this.get(
      `SELECT r.conversation_id, r.resolved_mode, r.principal_id, c.active_project_id, c.user_id,
              (SELECT id FROM rooms WHERE conversation_id=r.conversation_id ORDER BY datetime(updated_at) DESC LIMIT 1) AS room_id
       FROM runs r LEFT JOIN conversations c ON c.id=r.conversation_id WHERE r.id=?`,
      optionalString(input.run_id) || '',
    );
    const request = optionalString(userMessage?.content);
    const response = optionalString(assistantMessage?.content);
    if (!request || !run) {
      this.exec(
        `UPDATE memory_generation_inputs SET status='skipped', exclusion_reason='source_messages_missing', processed_at=datetime('now') WHERE id=?`,
        inputID,
      );
      return 0;
    }
    const observations = extractMemoryObservations(request, {
      projectID: optionalString(run.active_project_id),
      roomID: optionalString(run.room_id),
      userID: optionalString(run.principal_id) || optionalString(run.user_id) || 'desktop_user',
      stateTTLDays: this.memoryPolicyConfig().state_ttl_days,
    });
    if (response && ['serious_task', 'background_task'].includes(optionalString(run.resolved_mode) || '')) {
      const episode = createTaskEpisodeObservation({
        request,
        outcome: response,
        projectID: optionalString(run.active_project_id),
        userID: optionalString(run.principal_id) || optionalString(run.user_id) || 'desktop_user',
      });
      if (episode) observations.push(episode);
    }
    for (const observation of observations) {
      this.processMemoryObservation(observation, {
        runID: optionalString(input.run_id) || '',
        turnID: optionalString(input.turn_id) || '',
        conversationID: optionalString(input.conversation_id) || '',
        sourceKind: 'background_generation',
      });
    }
    this.exec(
      `UPDATE memory_generation_inputs SET status='processed', processed_at=datetime('now'),
         metadata=json_set(COALESCE(metadata, '{}'), '$.generated_observation_count', ?, '$.pipeline_version', ?)
       WHERE id=?`,
      observations.length,
      MEMORY_PIPELINE_VERSION,
      inputID,
    );
    const runID = optionalString(input.run_id) || '';
    if (observations.length === 0 && runID) {
      this.insertRunEvent(runID, optionalString(input.turn_id) || '', this.nextRunEventSeq(runID), 'memory.learning.abstained', {
        item_type: 'memory_generation_input',
        item_id: inputID,
        status: 'skipped',
        visibility: 'memory',
        source: 'memory_runtime',
        reason: 'no_durable_observation',
        pipeline_version: MEMORY_PIPELINE_VERSION,
      });
    }
    return observations.length;
  }

  private processMemoryObservation(
    observation: MemoryObservationDraft,
    source: { runID: string; turnID: string; conversationID: string; sourceKind: string },
  ): string {
    const observationID = `mobs_${newID()}`;
    this.exec(
      `INSERT INTO memory_observations (
         id, memory_key, layer, type, statement, summary, scope_type, scope_id, privacy_level,
         evidence_kind, evidence_authority, confidence, polarity, context_tags, source_event_id,
         run_id, turn_id, conversation_id, status, review_reason, metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), 'recorded', NULLIF(?, ''), ?)`,
      observationID,
      observation.memoryKey,
      observation.layer,
      observation.type,
      observation.statement,
      observation.summary,
      observation.scopeType,
      observation.scopeID,
      observation.privacyLevel,
      observation.evidenceKind,
      observation.evidenceAuthority,
      observation.confidence,
      observation.polarity,
      json(observation.contextTags),
      source.turnID || source.runID,
      source.runID,
      source.turnID,
      source.conversationID,
      observation.reviewReason,
      json({ pipeline_version: MEMORY_PIPELINE_VERSION, source_kind: source.sourceKind, why: observation.why, future_effect: observation.futureEffect }),
    );
    const existing = this.get(
      `SELECT * FROM memories
       WHERE memory_key=? AND layer=? AND scope_type=? AND COALESCE(scope_id, '')=?
         AND status NOT IN ('deleted','rejected','superseded','archived') AND disabled_at IS NULL
       ORDER BY evidence_authority DESC, evidence_count DESC, confidence DESC, datetime(updated_at) DESC
       LIMIT 1`,
      observation.memoryKey,
      observation.layer,
      observation.scopeType,
      observation.scopeID,
    );
    if (existing && normalizeMemoryText(optionalString(existing.content) || '') === normalizeMemoryText(observation.statement)) {
      const memory = rowToMemory(existing);
      const evidenceCount = Math.max(1, memory.evidence_count || 1) + 1;
      const shouldPromote = memory.status === 'observed'
        && evidenceCount >= this.memoryPolicyConfig().implicit_promotion_evidence
        && memory.privacy_level !== 'private';
      const sourceEventIDs = [...new Set([...(memory.source_event_ids || []), source.runID, source.turnID, source.conversationID].filter(Boolean))];
      this.exec(
        `UPDATE memories
         SET evidence_count=?, evidence_kind=?, evidence_authority=MAX(evidence_authority, ?),
             confidence=MAX(confidence, ?), status=?, lifecycle_state=?, source_event_ids=?,
             context_tags=?, last_verified_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
        evidenceCount,
        shouldPromote ? 'repeated_behavior' : observation.evidenceKind,
        observation.evidenceAuthority,
        shouldPromote ? 0.82 : observation.confidence,
        shouldPromote ? 'confirmed' : memory.status,
        shouldPromote ? 'active' : memory.lifecycle_state || 'provisional',
        json(sourceEventIDs),
        json([...new Set([...(memory.context_tags || []), ...observation.contextTags])]),
        memory.id,
      );
      this.exec(`UPDATE memory_observations SET memory_id=?, status=? WHERE id=?`, memory.id, shouldPromote ? 'promoted' : 'linked', observationID);
      this.insertMemoryEvolutionEvent(memory.id, shouldPromote ? 'auto_promoted' : 'evidence_reinforced', source.runID, source.turnID, {
        evidence_count: evidenceCount,
        status: shouldPromote ? 'confirmed' : memory.status,
      }, shouldPromote ? 'independent_evidence_threshold_reached' : 'matching_observation');
      return memory.id;
    }
    if (existing) {
      const conflictGroupID = optionalString(existing.conflict_group_id) || `mcg_${newID()}`;
      const candidateID = this.createMemoryFromObservation({
        ...observation,
        reviewRequired: true,
        reviewReason: observation.correction ? 'correction_requires_confirmation' : 'same_topic_requires_review',
      }, observationID, source, optionalString(existing.id), conflictGroupID);
      this.exec(`UPDATE memories SET conflict_group_id=?, updated_at=datetime('now') WHERE id=?`, conflictGroupID, String(existing.id));
      return candidateID;
    }
    return this.createMemoryFromObservation(observation, observationID, source);
  }

  private createMemoryFromObservation(
    observation: MemoryObservationDraft,
    observationID: string,
    source: { runID: string; turnID: string; conversationID: string; sourceKind: string },
    supersedesMemoryID = '',
    conflictGroupID = '',
  ): string {
    const memoryID = `mem_${newID()}`;
    const taskOutcome = observation.evidenceKind === 'task_outcome';
    const status = taskOutcome ? 'confirmed' : observation.reviewRequired ? 'pending' : 'observed';
    const lifecycle = taskOutcome ? 'active' : observation.reviewRequired ? 'review' : 'provisional';
    const sourceEventIDs = [...new Set([source.runID, source.turnID, source.conversationID].filter(Boolean))];
    const retentionPolicy = observation.layer === 'state' ? 'ttl' : observation.layer === 'episode' ? 'episodic' : 'standard';
    this.exec(
      `INSERT INTO memories (
         id, layer, type, memory_key, content, summary, scope_type, scope_id, privacy_level,
         evidence_kind, evidence_authority, evidence_count, confidence, status, lifecycle_state,
         source_event_ids, source_kind, entities, context_tags, supersedes_memory_id, conflict_group_id,
         review_reason, valid_from, valid_until, last_verified_at, auto_managed, retention_policy, metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, 1, ?, ?, ?, ?, ?, '[]', ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), datetime('now'), NULLIF(?, ''), datetime('now'), 1, ?, ?)`,
      memoryID,
      observation.layer,
      observation.type,
      observation.memoryKey,
      observation.statement,
      observation.summary,
      observation.scopeType,
      observation.scopeID,
      observation.privacyLevel,
      observation.evidenceKind,
      observation.evidenceAuthority,
      observation.confidence,
      status,
      lifecycle,
      json(sourceEventIDs),
      source.sourceKind,
      json(observation.contextTags),
      supersedesMemoryID,
      conflictGroupID,
      observation.reviewReason,
      observation.expiresAt || '',
      retentionPolicy,
      json({
        pipeline_version: MEMORY_PIPELINE_VERSION,
        observation_id: observationID,
        polarity: observation.polarity,
        why: observation.why,
        futureEffect: observation.futureEffect,
        explicit: observation.explicit,
        correction: observation.correction,
        dedup_key: observation.memoryKey,
      }),
    );
    this.exec(`UPDATE memory_observations SET memory_id=?, status=? WHERE id=?`, memoryID, status === 'confirmed' ? 'promoted' : observation.reviewRequired ? 'needs_review' : 'linked', observationID);
    this.upsertMemoryEmbedding(memoryID, `${observation.summary} ${observation.statement} ${observation.contextTags.join(' ')}`);
    this.insertMemoryEvolutionEvent(memoryID, status === 'confirmed' ? 'auto_confirmed_episode' : observation.reviewRequired ? 'candidate_created' : 'observation_created', source.runID, source.turnID, {
      layer: observation.layer,
      status,
      evidence_kind: observation.evidenceKind,
      supersedes_memory_id: supersedesMemoryID || undefined,
    }, observation.reviewReason || observation.why);
    return memoryID;
  }

  private insertMemoryEvolutionEvent(memoryID: string, eventType: string, runID: string, turnID: string, after: unknown, reason: string): void {
    this.exec(
      `INSERT INTO memory_events (id, memory_id, event_type, actor, source_event_id, run_id, before_json, after_json, reason, metadata)
       VALUES (?, NULLIF(?, ''), ?, 'memory_runtime', NULLIF(?, ''), NULLIF(?, ''), '{}', ?, ?, ?)`,
      `mevt_${newID()}`,
      memoryID,
      eventType,
      turnID || runID,
      runID,
      json(after || {}),
      reason,
      json({ pipeline_version: MEMORY_PIPELINE_VERSION }),
    );
    if (!runID) return;
    this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), `memory.lifecycle.${eventType}`, {
      item_type: 'memory',
      item_id: memoryID,
      status: 'completed',
      visibility: 'memory',
      source: 'memory_runtime',
      reason,
      after,
      pipeline_version: MEMORY_PIPELINE_VERSION,
    });
  }

  private upsertMemoryEmbedding(memoryID: string, text: string): void {
    const vector = localMemoryVector(text);
    this.exec(`DELETE FROM memory_embeddings WHERE memory_id=? AND embedding_model=?`, memoryID, LOCAL_MEMORY_EMBEDDING_MODEL);
    this.exec(
      `INSERT INTO memory_embeddings (id, memory_id, embedding_model, embedding, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      `memb_${newID()}`,
      memoryID,
      LOCAL_MEMORY_EMBEDDING_MODEL,
      json(vector),
    );
  }

  private attributeMemoryInfluence(runID: string, response: string): void {
    const answer = response.trim();
    if (!answer) return;
    for (const row of this.all(
      `SELECT mul.id AS usage_log_id, mul.memory_id, m.content, m.summary, m.context_tags
       FROM memory_usage_logs mul JOIN memories m ON m.id=mul.memory_id
       WHERE mul.run_id=? AND mul.pipeline_version=? AND mul.injected=1`,
      runID,
      MEMORY_PIPELINE_VERSION,
    )) {
      const attribution = attributeMemoryAnswerInfluence(answer, `${optionalString(row.summary)} ${optionalString(row.content)} ${parseStringArray(row.context_tags).join(' ')}`);
      this.exec(
        `UPDATE memory_usage_logs
         SET used_in_answer=?, influence_state=?, outcome=?,
             metadata=json_set(COALESCE(metadata, '{}'), '$.influence_score', ?, '$.influence_method', 'local_similarity_attribution_v1',
               '$.influence_components.similarity', ?, '$.influence_components.lexical', ?,
               '$.influence_components.anchor_coverage', ?, '$.influence_components.matched_anchors', ?)
         WHERE id=?`,
        attribution.used ? 1 : 0,
        attribution.used ? 'inferred_used' : 'not_used',
        attribution.used ? 'inferred_used' : 'not_used',
        attribution.score,
        attribution.similarity,
        attribution.lexical,
        attribution.anchorCoverage,
        attribution.matchedAnchors,
        String(row.usage_log_id),
      );
      if (attribution.used) this.exec(`UPDATE memories SET success_count=success_count+1 WHERE id=?`, String(row.memory_id));
      this.appendRunEventV2({
        run_id: runID,
        event_type: 'memory.influence_attributed',
        item_type: 'memory',
        item_id: optionalString(row.memory_id),
        status: 'completed',
        source: 'memory_runtime',
        visibility: 'memory',
        payload: {
          memory_id: optionalString(row.memory_id),
          influence_state: attribution.used ? 'inferred_used' : 'not_used',
          influence_score: attribution.score,
          method: 'local_similarity_attribution_v1',
          pipeline_version: MEMORY_PIPELINE_VERSION,
        },
      });
    }
  }

  listMemoriesUsedForRun(runID: string): { memories: MemorySearchResult[] } {
    const id = runID.trim();
    if (!id) throw new Error('run_id is required');
    const rows = this.all(
      `SELECT m.*, re.payload_json AS event_payload
       FROM run_events re
       JOIN memories m ON m.id = COALESCE(
         NULLIF(re.item_id, ''),
         json_extract(re.payload_json, '$.memory_id'),
         json_extract(re.payload, '$.memory_id')
       )
       WHERE re.run_id=? AND re.event_type='memory.recalled'
       ORDER BY re.seq ASC`,
      id,
    );
    return {
      memories: rows.map((row) => {
        const payload = parseObject(row.event_payload);
        return {
          memory: rowToMemory(row),
          score: optionalNumber(payload.score) || 0,
          reason: optionalString(payload.reason) || 'memory.recalled',
          retrieval_source: optionalString(payload.retrieval_source),
          matched_terms: parseStringArray(payload.matched_terms),
          scope_match: optionalString(payload.scope_match),
          injected: payload.injected !== false,
          used_in_answer: false,
          influence_state: 'unknown',
          score_components: numericRecord(payload.score_components),
        };
      }),
    };
  }

  listMemoryCandidates(filter: { status?: string; limit?: number } = {}): { memories: MemoryRecord[] } {
    const status = filter.status?.trim();
    const where = [`status <> 'deleted'`];
    const params: SQLiteValue[] = [];
    if (status && status !== 'all') {
      where.push('status = ?');
      params.push(status);
    } else if (!status) {
      where.push(`status IN ('pending', 'candidate', 'proposed', 'conflicted')`);
    }
    const rows = this.all(
      `SELECT * FROM memories
       WHERE ${where.join(' AND ')}
       ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
       LIMIT ?`,
      ...params,
      clampLimit(filter.limit, 50),
    );
    return { memories: rows.map(rowToMemory) };
  }

  decideMemoryCandidate(req: {
    id?: string;
    decision?: string;
    run_id?: string;
    comment?: string;
    reason?: string;
    content?: string;
    summary?: string;
  }): void {
    const decision = req.decision?.trim();
    if (!decision) throw new Error('memory candidate decision is required');
    const action = memoryCandidateDecisionAction(decision);
    this.updateMemory({
      id: req.id,
      action,
      run_id: req.run_id,
      comment: req.comment,
      reason: req.reason,
      content: req.content,
      summary: req.summary,
    });
  }

  correctMemory(req: { id?: string; content?: string; summary?: string; run_id?: string; comment?: string; reason?: string }): void {
    this.updateMemory({
      id: req.id,
      action: 'edit_confirm',
      content: req.content,
      summary: req.summary,
      run_id: req.run_id,
      comment: req.comment,
      reason: req.reason,
    });
  }

  deleteMemory(req: { id?: string; run_id?: string; reason?: string; comment?: string }): void {
    this.updateMemory({
      id: req.id,
      action: 'delete',
      run_id: req.run_id,
      reason: req.reason,
      comment: req.comment,
    });
  }

  listUserStates(filter: { limit?: number } = {}): { memories: MemoryRecord[] } {
    return { memories: this.listMemoryRecordsByTypes(['current_state', 'user_state'], filter.limit) };
  }

  listRelationshipStates(filter: { limit?: number } = {}): { memories: MemoryRecord[] } {
    return { memories: this.listMemoryRecordsByTypes(['relationship_state'], filter.limit) };
  }

  private listMemoryRecordsByTypes(types: string[], limit = 50): MemoryRecord[] {
    const placeholders = types.map(() => '?').join(', ');
    const rows = this.all(
      `SELECT id, type, content, COALESCE(summary, '') AS summary, scope_type, COALESCE(scope_id, '') AS scope_id,
              privacy_level, confidence, status, source_event_ids, entities, success_count, failure_count,
              usage_count, positive_feedback, negative_feedback, pinned, disabled_at,
              COALESCE(merged_into_memory_id, '') AS merged_into_memory_id,
              COALESCE(conflict_group_id, '') AS conflict_group_id,
              COALESCE(conflict_reason, '') AS conflict_reason,
              metadata, created_at, updated_at, last_used_at
       FROM memories
       WHERE type IN (${placeholders})
         AND status='confirmed'
         AND disabled_at IS NULL
         AND merged_into_memory_id IS NULL
         AND ${activeMemoryTTLWhereClause('memories')}
       ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
       LIMIT ?`,
      ...types,
      clampLimit(limit, 50),
    );
    return rows.map(rowToMemory);
  }

  updateMemory(req: {
    id?: string;
    action?: string;
    feedback?: string;
    comment?: string;
    target_id?: string;
    reason?: string;
    content?: string;
    summary?: string;
    scope_type?: string;
    run_id?: string;
  }): void {
    const id = req.id?.trim();
    const action = req.action?.trim();
    if (!id || !action) throw new Error('memory id and action are required');
    switch (action) {
      case 'confirm':
        this.transaction(() => {
          const current = this.get(`SELECT * FROM memories WHERE id=?`, id);
          if (!current) throw new Error(`memory not found: ${id}`);
          this.exec(
            `UPDATE memories
             SET status='confirmed', lifecycle_state='active', disabled_at=NULL, archived_at=NULL,
                 review_reason=NULL, conflict_reason=NULL, last_verified_at=datetime('now'),
                 metadata=json_set(COALESCE(metadata, '{}'), '$.confirmed_by', 'desktop_ui', '$.confirmed_at', datetime('now')),
                 updated_at=datetime('now')
             WHERE id=?`,
            id,
          );
          const supersedesMemoryID = optionalString(current.supersedes_memory_id);
          if (supersedesMemoryID) {
            this.exec(
              `UPDATE memories
               SET status='superseded', lifecycle_state='superseded', merged_into_memory_id=?,
                   disabled_at=datetime('now'), archived_at=datetime('now'), updated_at=datetime('now')
               WHERE id=?`,
              id,
              supersedesMemoryID,
            );
          }
          this.upsertMemoryEmbedding(id, `${optionalString(current.summary)} ${optionalString(current.content)} ${parseStringArray(current.context_tags).join(' ')}`);
          this.insertMemoryEvolutionEvent(id, 'confirmed', req.run_id || '', '', { status: 'confirmed', supersedes_memory_id: supersedesMemoryID || undefined }, 'desktop_ui_confirmation');
          this.insertMemoryFeedback(id, req.run_id, 'confirm', req.comment || req.reason || '');
        });
        return;
      case 'edit':
      case 'edit_confirm': {
        const content = req.content?.trim();
        if (!content) throw new Error('edit_confirm requires content');
        const summary = req.summary?.trim() || titleFromMessage(content);
        this.transaction(() => {
          const existing = this.get(
            `SELECT *
             FROM memories
             WHERE id=?`,
            id,
          );
          if (!existing) throw new Error(`memory not found: ${id}`);
          const replacementID = `mem_${newID()}`;
          const sourceEventIDs = parseArray(existing.source_event_ids).map(String);
          if (req.run_id) sourceEventIDs.push(req.run_id);
          const metadata = {
            ...parseObject(existing.metadata),
            corrected_from_memory_id: id,
            corrected_by: 'desktop_ui',
            corrected_at: nowIso(),
            correction_reason: req.reason || req.comment || '',
          };
          const type = optionalString(existing.type) || 'preference';
          const inferredLayer = inferLegacyMemoryLayer(type, parseObject(existing.metadata));
          const storedLayer = optionalString(existing.layer);
          const layer = !storedLayer || (storedLayer === 'knowledge' && inferredLayer !== 'knowledge') ? inferredLayer : storedLayer;
          const contextTags = parseStringArray(existing.context_tags).length > 0
            ? parseStringArray(existing.context_tags)
            : inferMemoryContextTags(`${summary} ${content}`);
          const memoryKey = canonicalMemoryKey(content, layer as 'profile' | 'knowledge' | 'state' | 'episode', type, contextTags);
          this.exec(
            `INSERT INTO memories (
               id, layer, type, memory_key, content, summary, scope_type, scope_id, privacy_level,
               evidence_kind, evidence_authority, evidence_count, confidence, status, lifecycle_state,
               source_event_ids, source_kind, entities, context_tags, supersedes_memory_id,
               valid_from, valid_until, last_verified_at, auto_managed, retention_policy, metadata
             ) VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?, 'correction', ?, ?, ?, 'confirmed', 'active',
                       ?, 'desktop_ui_correction', ?, ?, ?, datetime('now'), NULLIF(?, ''), datetime('now'), 0, ?, ?)`,
            replacementID,
            layer,
            type,
            memoryKey,
            content,
            summary,
            optionalString(existing.scope_type) || 'global',
            optionalString(existing.scope_id) || '',
            optionalString(existing.privacy_level) || 'internal',
            memoryEvidenceAuthority('correction'),
            Number(existing.evidence_count || 1) + 1,
            optionalNumber(existing.confidence) || 0.7,
            json([...new Set(sourceEventIDs)]),
            json(parseArray(existing.entities)),
            json(contextTags),
            id,
            optionalString(existing.valid_until) || '',
            optionalString(existing.retention_policy) || 'standard',
            json(metadata),
          );
          this.exec(
            `UPDATE memories
             SET status='superseded', lifecycle_state='superseded', merged_into_memory_id=?, disabled_at=datetime('now'), archived_at=datetime('now'),
                 metadata=json_set(COALESCE(metadata, '{}'), '$.edited_by', 'desktop_ui', '$.edited_at', datetime('now'), '$.superseded_by', ?),
                 updated_at=datetime('now')
             WHERE id=?`,
            replacementID,
            replacementID,
            id,
          );
          this.upsertMemoryEmbedding(replacementID, `${summary} ${content} ${contextTags.join(' ')}`);
          this.insertMemoryEvolutionEvent(replacementID, 'corrected', req.run_id || '', '', { supersedes_memory_id: id, content }, req.reason || req.comment || 'desktop_ui_correction');
          this.insertMemoryFeedback(id, req.run_id, 'edit', req.comment || req.reason || '', replacementID);
        });
        return;
      }
      case 'reject':
        this.transaction(() => {
          this.exec(
            `UPDATE memories
             SET status='rejected', lifecycle_state='archived', disabled_at=datetime('now'), archived_at=datetime('now'),
                 metadata=json_set(COALESCE(metadata, '{}'), '$.rejected_by', 'desktop_ui', '$.reject_reason', ?, '$.rejected_at', datetime('now')),
                 updated_at=datetime('now')
             WHERE id=?`,
            req.reason || 'desktop_ui',
            id,
          );
          this.insertMemoryFeedback(id, req.run_id, 'reject', req.comment || req.reason || '');
        });
        return;
      case 'delete':
        this.transaction(() => {
          this.exec(
            `UPDATE memories
             SET status='deleted', lifecycle_state='archived', disabled_at=datetime('now'), archived_at=datetime('now'),
                 metadata=json_set(COALESCE(metadata, '{}'), '$.deleted_by', 'desktop_ui', '$.delete_reason', ?, '$.deleted_at', datetime('now')),
                 updated_at=datetime('now')
             WHERE id=?`,
            req.reason || 'desktop_ui',
            id,
          );
          this.insertMemoryFeedback(id, req.run_id, 'delete', req.comment || req.reason || '');
        });
        return;
      case 'mark_global':
        this.exec(`UPDATE memories SET scope_type='global', scope_id=NULL, updated_at=datetime('now') WHERE id=?`, id);
        return;
      case 'mark_project':
        this.exec(
          `UPDATE memories SET scope_type='project', scope_id=COALESCE(NULLIF(scope_id, ''), 'default_project'), updated_at=datetime('now') WHERE id=?`,
          id,
        );
        return;
      case 'pin':
        this.exec(`UPDATE memories SET pinned=1, updated_at=datetime('now') WHERE id=?`, id);
        return;
      case 'unpin':
        this.exec(`UPDATE memories SET pinned=0, updated_at=datetime('now') WHERE id=?`, id);
        return;
      case 'disable':
        this.exec(`UPDATE memories SET lifecycle_state='disabled', disabled_at=datetime('now'), updated_at=datetime('now') WHERE id=?`, id);
        return;
      case 'enable':
        this.exec(`UPDATE memories SET lifecycle_state=CASE WHEN status='confirmed' THEN 'active' ELSE 'provisional' END, disabled_at=NULL, archived_at=NULL, updated_at=datetime('now') WHERE id=?`, id);
        return;
      case 'feedback_positive':
      case 'feedback_negative':
      case 'feedback_neutral': {
        const feedback = action.replace('feedback_', '');
        this.insertMemoryFeedback(id, req.run_id, feedback, req.comment || '');
        if (feedback === 'positive') {
          this.exec(`UPDATE memories SET positive_feedback=positive_feedback+1, success_count=success_count+1, updated_at=datetime('now') WHERE id=?`, id);
        } else if (feedback === 'negative') {
          this.exec(`UPDATE memories SET negative_feedback=negative_feedback+1, failure_count=failure_count+1, updated_at=datetime('now') WHERE id=?`, id);
        }
        return;
      }
      case 'mark_conflict':
        this.exec(
          `UPDATE memories SET status='conflicted', lifecycle_state='review', conflict_group_id=?, conflict_reason=?, review_reason=?, updated_at=datetime('now') WHERE id=?`,
          req.target_id || id,
          req.reason || '',
          req.reason || 'manual_conflict',
          id,
        );
        return;
      case 'merge_into':
        if (!req.target_id) throw new Error('merge_into requires target_id');
        this.exec(
          `UPDATE memories SET status='superseded', lifecycle_state='superseded', merged_into_memory_id=?, disabled_at=datetime('now'), archived_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
          req.target_id,
          id,
        );
        return;
      default:
        throw new Error(`unsupported memory action: ${action}`);
    }
  }

  listNodes(): { nodes: NodeRecord[] } {
    const rows = this.all(
      `SELECT id, name, role, status, capabilities, auto_assign_enabled, manual_assign_enabled, metadata
       FROM nodes
       ORDER BY id ASC`,
    );
    return { nodes: rows.map(rowToNode) };
  }

  disableNode(nodeID: string): void {
    this.setNodeEnabled(nodeID, false);
  }

  enableNode(nodeID: string): void {
    this.setNodeEnabled(nodeID, true);
  }

  listWorkerGatewayAuditLogs(limit = 50): { items: WorkerGatewayAuditRecord[] } {
    const rows = this.all(
      `SELECT id, COALESCE(node_id, '') AS node_id, action, status, COALESCE(reason, '') AS reason, metadata, created_at
       FROM worker_gateway_audit_logs
       ORDER BY datetime(created_at) DESC
       LIMIT ?`,
      clampLimit(limit, 50),
    );
    return {
      items: rows.map((row) => ({
        id: String(row.id),
        node_id: String(row.node_id),
        action: String(row.action),
        status: String(row.status),
        reason: optionalString(row.reason) || '',
        metadata: parseObject(row.metadata),
      })),
    };
  }

  recordWorkerGatewayAudit(nodeID: string, action: string, status: string, reason: string, metadata: Record<string, unknown> = {}): void {
    this.exec(
      `INSERT INTO worker_gateway_audit_logs (id, node_id, action, status, reason, metadata)
       VALUES (?, NULLIF(?, ''), ?, ?, ?, ?)`,
      `wgaudit_${newID()}`,
      nodeID,
      action,
      status,
      reason,
      json(metadata),
    );
  }

  upsertWorkerNode(req: WorkerRegisterRequest): void {
    const nodeID = req.node_id?.trim();
    if (!nodeID) throw new Error('node_id is required');
    const name = req.name?.trim() || nodeID;
    const capabilities = Array.isArray(req.capabilities) ? req.capabilities.map(String).filter(Boolean) : [];
    this.exec(
      `INSERT INTO nodes (id, name, role, status, capabilities, resources, network, assign_policy, auto_assign_enabled, manual_assign_enabled, last_heartbeat_at, version, metadata, updated_at)
       VALUES (?, ?, 'worker', 'healthy', ?, '{}', '{}', '{"desktop_gateway":true}', 0, 1, datetime('now'), '0.1.0', '{"registered_by":"worker_gateway"}', datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name,
         status='healthy',
         capabilities=excluded.capabilities,
         last_heartbeat_at=datetime('now'),
         updated_at=datetime('now')`,
      nodeID,
      name,
      json(capabilities),
    );
  }

  workerGatewayNodeDenied(nodeID: string): { denied: boolean; reason: string } {
    const id = nodeID.trim();
    if (!id) return { denied: false, reason: '' };
    const row = this.get(`SELECT status FROM nodes WHERE id=?`, id);
    if (String(row?.status || '') === 'disabled') {
      return { denied: true, reason: 'node_disabled' };
    }
    return { denied: false, reason: '' };
  }

  acceptWorkerGatewayNonce(nodeID: string, timestampHeader: string | undefined, nonce: string | undefined): void {
    const timestampText = timestampHeader?.trim() || '';
    if (!timestampText) throw new Error('timestamp_required');
    const nonceText = nonce?.trim() || '';
    if (!nonceText) throw new Error('nonce_required');
    const timestamp = Date.parse(timestampText);
    if (!Number.isFinite(timestamp)) throw new Error('invalid_timestamp');
    const delta = Date.now() - timestamp;
    if (delta > 5 * 60 * 1000 || delta < -5 * 60 * 1000) throw new Error('timestamp_out_of_window');
    this.exec(`DELETE FROM worker_gateway_nonces WHERE created_at < datetime('now', '-10 minutes')`);
    try {
      this.exec(
        `INSERT INTO worker_gateway_nonces (nonce, node_id, created_at)
         VALUES (?, ?, datetime('now'))`,
        nonceText,
        nodeID,
      );
    } catch {
      throw new Error('replay_detected');
    }
  }

  heartbeatWorkerNode(nodeID: string): void {
    const id = nodeID.trim();
    if (!id) throw new Error('node_id is required');
    this.exec(
      `UPDATE nodes
       SET status='healthy', last_heartbeat_at=datetime('now'), updated_at=datetime('now')
       WHERE id=?`,
      id,
    );
  }

  claimWorkerGatewayTask(nodeID: string): WorkerGatewayTask | null {
    const id = nodeID.trim();
    if (!id) throw new Error('node_id is required');
    let taskID = '';
    this.transaction(() => {
      const row = this.get(
        `SELECT id
         FROM tasks
         WHERE status IN ('pending','retrying') AND COALESCE(assigned_node_id, '') = ?
         ORDER BY created_at ASC
         LIMIT 1`,
        id,
      );
      taskID = optionalString(row?.id) || '';
      if (!taskID) return;
      const attemptNumber = Number(this.get(`SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt FROM task_attempts WHERE task_id=?`, taskID)?.next_attempt ?? 1);
      this.exec(`UPDATE tasks SET status='running', started_at=datetime('now'), finished_at=NULL WHERE id=?`, taskID);
      this.exec(
        `INSERT INTO task_attempts (id, task_id, node_id, status, attempt_number, input, started_at)
         SELECT ?, id, ?, 'running', ?, payload, datetime('now')
         FROM tasks
         WHERE id=?`,
        `attempt_${newID()}`,
        id,
        attemptNumber,
        taskID,
      );
    });
    if (!taskID) return null;
    return this.workerGatewayTask(taskID);
  }

  workerNodeCapabilityAllowed(nodeID: string, capabilityID: string): boolean {
    const row = this.get(`SELECT capabilities FROM nodes WHERE id=?`, nodeID.trim());
    if (!row) return false;
    const capabilities = parseArray(row.capabilities).map(String);
    return workerCapabilityMatches(capabilities, capabilityID);
  }

  ackWorkerGatewayTask(nodeID: string, taskID: string, result: WorkerTaskResult): void {
    const task = this.workerGatewayTask(taskID);
    this.assertWorkerTaskClaimable(nodeID, task);
    const output = sanitizeWorkerGatewayOutput(result.output || {});
    this.transaction(() => {
      this.exec(`UPDATE tasks SET status='succeeded', result=?, finished_at=datetime('now') WHERE id=?`, json(output), task.id);
      this.exec(`UPDATE task_attempts SET status='succeeded', output=?, finished_at=datetime('now') WHERE task_id=? AND status='running'`, json(output), task.id);
      this.recordGatewayToolRun(task, output);
      if (task.run_id) {
        this.insertGatewayRunStep(task.run_id, 'worker_finished', 'Worker task finished', 'succeeded', { task_id: task.id, node_id: task.assigned_node_id }, { result: output, worker_finished_at: nowIso() }, {});
        this.insertGatewayRunStep(task.run_id, 'tool_finished', 'Worker tool runtime finished', 'succeeded', { task_id: task.id, node_id: task.assigned_node_id }, output, {});
      }
    });
  }

  failWorkerGatewayTask(nodeID: string, taskID: string, taskError: WorkerTaskError): void {
    const task = this.workerGatewayTask(taskID);
    this.assertWorkerTaskClaimable(nodeID, task);
    const errorPayload = {
      code: taskError.code || 'worker_failed',
      message: taskError.message || 'worker task failed',
      details: taskError.details || {},
    };
    this.transaction(() => {
      this.exec(`UPDATE tasks SET status='failed', error=?, finished_at=datetime('now') WHERE id=?`, json(errorPayload), task.id);
      this.exec(`UPDATE task_attempts SET status='failed', error=?, finished_at=datetime('now') WHERE task_id=? AND status='running'`, json(errorPayload), task.id);
      if (task.run_id) {
        this.insertGatewayRunStep(task.run_id, 'worker_failed', 'Worker task failed', 'failed', { task_id: task.id, node_id: task.assigned_node_id }, {}, errorPayload);
      }
    });
  }

  private modelUsageSummaryItems(whereSQL = ''): Record<string, unknown>[] {
    const where = whereSQL.trim() ? `WHERE ${whereSQL.trim()}` : '';
    // Canonical input includes cached input. ACP rows written before the
    // normalization fix stored uncached input separately. New rows carry an
    // explicit marker so legacy ACP rows can be repaired without rewriting DBs.
    // The run duration similarly supplies read compatibility for old zero-latency rows.
    const rows = this.all(
      `SELECT COALESCE(provider, '') AS provider,
              COALESCE(model_name, '') AS model,
              COALESCE(agent_id, '') AS agent,
              COUNT(*) AS calls,
              COALESCE(SUM(
                CASE
                  WHEN COALESCE(CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.input_tokens_include_cached') END, 0) = 1
                    THEN COALESCE(input_tokens, 0)
                  WHEN COALESCE(provider, '') LIKE 'acp_%'
                    OR COALESCE(CASE WHEN json_valid(raw_response) THEN json_extract(raw_response, '$.responses[0].protocol') END, '') = 'acp'
                    THEN COALESCE(input_tokens, 0) + COALESCE(cached_input_tokens, 0) + COALESCE(cache_write_input_tokens, 0)
                  WHEN COALESCE(cached_input_tokens, 0) + COALESCE(cache_write_input_tokens, 0) > COALESCE(input_tokens, 0)
                    THEN COALESCE(input_tokens, 0) + COALESCE(cached_input_tokens, 0) + COALESCE(cache_write_input_tokens, 0)
                  ELSE COALESCE(input_tokens, 0)
                END
              ), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
              COALESCE(SUM(cache_write_input_tokens), 0) AS cache_write_input_tokens,
              COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
              COALESCE(SUM(CASE WHEN total_tokens > 0 THEN total_tokens ELSE COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) END), 0) AS total_tokens,
              COALESCE(AVG(
                CASE
                  WHEN COALESCE(latency_ms, 0) > 0 THEN latency_ms
                  ELSE COALESCE((SELECT duration_ms FROM runs WHERE runs.id=model_calls.run_id), 0)
                END
              ), 0) AS avg_latency_ms,
              SUM(CASE WHEN status='fallback_to_mock' THEN 1 ELSE 0 END) AS fallback_calls,
              SUM(CASE WHEN status NOT IN ('succeeded', 'fallback_to_mock') THEN 1 ELSE 0 END) AS error_calls,
              COALESCE(SUM(cost_estimate), 0) AS estimated_cost,
              MAX(created_at) AS last_call_at
       FROM model_calls
       ${where}
       GROUP BY provider, model_name, agent_id
       ORDER BY total_tokens DESC, calls DESC, provider ASC, model ASC`,
    );
    return rows.map((row) => {
      const provider = optionalString(row.provider) || '';
      const model = optionalString(row.model) || '';
      const usage = canonicalModelUsage(row);
      const persistedCost = positiveFloat(row.estimated_cost);
      const estimatedCost = persistedCost > 0 ? persistedCost : this.estimateModelUsageCost(provider, model, usage);
      return {
        provider,
        model,
        agent: optionalString(row.agent) || '',
        calls: Number(row.calls ?? 0),
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cached_input_tokens: usage.cached_input_tokens,
        cache_write_input_tokens: usage.cache_write_input_tokens,
        reasoning_tokens: usage.reasoning_tokens,
        total_tokens: usage.total_tokens,
        cache_hit_ratio: cacheHitRatioForUsage(usage.input_tokens, usage.cached_input_tokens),
        avg_latency_ms: Number(row.avg_latency_ms ?? 0),
        fallback_calls: Number(row.fallback_calls ?? 0),
        error_calls: Number(row.error_calls ?? 0),
        estimated_cost: roundCost(estimatedCost),
        last_call_at: optionalString(row.last_call_at),
      };
    });
  }

  private estimateModelUsageCost(provider: string, model: string, usage: CanonicalModelUsage): number {
    const pricing = this.modelPricing(provider, model);
    return estimateCostWithPricing(usage, pricing);
  }

  private modelPricing(provider: string, model: string): ModelPricing | undefined {
    const providerKey = provider.trim();
    const modelKey = model.trim();
    const row = this.get(
      `SELECT input_price_per_1m, output_price_per_1m, cached_input_price_per_1m
       FROM models
       WHERE provider=? AND (model_name=? OR id=?)
       ORDER BY updated_at DESC
       LIMIT 1`,
      providerKey,
      modelKey,
      modelKey,
    );
    const input = positiveFloat(row?.input_price_per_1m);
    const output = positiveFloat(row?.output_price_per_1m);
    const cached = positiveFloat(row?.cached_input_price_per_1m);
    if (input > 0 || output > 0 || cached > 0) {
      return { input_per_1m: input, output_per_1m: output, cached_input_per_1m: cached };
    }
    return builtinModelPricing(providerKey, modelKey);
  }

  getModelUsage(): { items: Record<string, unknown>[] } {
    return { items: this.modelUsageSummaryItems() };
  }

  listConfirmations(): { items: ConfirmationRecord[] } {
    const rows = this.all(
      `SELECT id, COALESCE(run_id, '') AS run_id, COALESCE(capability_id, '') AS capability_id,
              requested_action, risk_level, status, input, COALESCE(call_id, '') AS call_id,
              COALESCE(turn_id, '') AS turn_id, COALESCE(approval_scope, 'one_call') AS approval_scope,
              COALESCE(approval_key, '') AS approval_key, COALESCE(approved_by, '') AS approved_by,
              COALESCE(rejected_by, '') AS rejected_by, COALESCE(decision_reason, '') AS decision_reason,
              created_at, decided_at, resumed_at
       FROM confirmation_requests
       ORDER BY datetime(created_at) DESC
       LIMIT 100`,
    );
    return { items: rows.map(rowToConfirmation) };
  }

  listPendingApprovals(): { items: ConfirmationRecord[] } {
    const rows = this.all(
      `SELECT id, COALESCE(run_id, '') AS run_id, COALESCE(capability_id, '') AS capability_id,
              requested_action, risk_level, status, input, COALESCE(call_id, '') AS call_id,
              COALESCE(turn_id, '') AS turn_id, COALESCE(approval_scope, 'one_call') AS approval_scope,
              COALESCE(approval_key, '') AS approval_key, COALESCE(approved_by, '') AS approved_by,
              COALESCE(rejected_by, '') AS rejected_by, COALESCE(decision_reason, '') AS decision_reason,
              created_at, decided_at, resumed_at
       FROM confirmation_requests
       WHERE status='pending'
       ORDER BY datetime(created_at) DESC
       LIMIT 100`,
    );
    return { items: rows.map(rowToConfirmation) };
  }

  decideConfirmation(req: { id?: string; approve?: boolean; actor?: string; reason?: string; scope?: string }): void {
    this.decideApproval({
      approval_request_id: req.id,
      decision: req.approve ? 'approved' : 'rejected',
      decision_scope: req.scope,
      decided_by: req.actor || 'desktop_ui',
      reason: req.reason,
    });
  }

  decideApproval(req: {
    run_id?: string;
    approval_request_id?: string;
    decision?: string;
    decision_scope?: string;
    decided_by?: string;
    decided_at?: string;
    reason?: string;
    edited_parameters?: Record<string, unknown>;
  }): { confirmation?: ConfirmationRecord } {
    const id = req.approval_request_id?.trim();
    if (!id) throw new Error('approval_request_id is required');
    const status = normalizeApprovalDecisionStatus(req.decision);
    const decisionScope = normalizeApprovalScope(req.decision_scope);
    const decidedBy = req.decided_by?.trim() || 'desktop_ui';
    const decidedAt = req.decided_at?.trim() || '';
    const existing = this.get(
      `SELECT id, COALESCE(run_id, '') AS run_id, COALESCE(turn_id, '') AS turn_id,
              COALESCE(call_id, '') AS call_id, COALESCE(capability_id, '') AS capability_id,
              COALESCE(risk_level, 'read_only') AS risk_level, status, input
       FROM confirmation_requests
       WHERE id=?`,
      id,
    );
    if (!existing) return {};
    const runID = optionalString(existing.run_id) || '';
    if (req.run_id?.trim() && req.run_id.trim() !== runID) {
      throw new Error('approval run_id does not match confirmation request');
    }
    const turnID = optionalString(existing.turn_id) || '';
    const callID = optionalString(existing.call_id) || '';
    const capabilityID = optionalString(existing.capability_id) || '';
    const riskLevel = optionalString(existing.risk_level) || 'read_only';
    if (status === 'approved') {
      this.ensureApprovalActorAllowed(id, runID, riskLevel, decidedBy);
    }
    const editedParameters = sanitizeApprovalEditedParameters(req.edited_parameters);
    const input = editedParameters ? { ...parseObject(existing.input), ...editedParameters } : parseObject(existing.input);
    this.transaction(() => {
      if (status === 'approved') {
        this.exec(
          `UPDATE confirmation_requests
           SET status='approved', approved_by=?, rejected_by='', decision_reason=?, input=?, approval_scope=?, decided_at=COALESCE(NULLIF(?, ''), datetime('now'))
           WHERE id=? AND status='pending'`,
          decidedBy,
          req.reason || '',
          json(input),
          decisionScope,
          decidedAt,
          id,
        );
      } else {
        this.exec(
          `UPDATE confirmation_requests
           SET status='rejected', rejected_by=?, approved_by='', decision_reason=?, input=?, approval_scope=?, decided_at=COALESCE(NULLIF(?, ''), datetime('now'))
           WHERE id=? AND status='pending'`,
          decidedBy,
          req.reason || '',
          json(input),
          decisionScope,
          decidedAt,
          id,
        );
      }
      if (runID) {
        const payload = {
          confirmation_id: id,
          approval_request_id: id,
          run_id: runID,
          turn_id: turnID,
          call_id: callID,
          capability: capabilityID,
          status,
          decision: status,
          approved: status === 'approved',
          decided_by: decidedBy,
          decided_at: decidedAt || nowIso(),
          reason: req.reason || '',
          decision_scope: decisionScope,
          edited_parameters: editedParameters || undefined,
        };
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'approval.resolved', payload);
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), status === 'approved' ? 'approval.approved' : 'approval.denied', {
          ...payload,
          item_type: 'approval',
          item_id: id,
          visibility: 'approval',
          source: 'store',
        });
        if (status !== 'approved') {
          const runMetadata = parseObject(this.get(`SELECT metadata FROM runs WHERE id=?`, runID)?.metadata);
          const productTaskID = optionalString(runMetadata.product_task_id);
          if (callID) {
            this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'tool.cancelled', {
              item_type: 'tool_run',
              item_id: callID,
              call_id: callID,
              tool_name: capabilityID,
              status: 'cancelled',
              summary: req.reason || 'Confirmation rejected',
              output: { status: 'cancelled', reason: req.reason || 'Confirmation rejected' },
              visibility: 'tool',
              source: 'store',
            });
          }
          this.exec(
            `UPDATE runs
             SET status='failed', terminal_status='failed', terminal_reason=?, error_code='confirmation_rejected', error_message=?, finished_at=datetime('now'),
                 duration_ms=CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER)
             WHERE id=? AND status='waiting_confirmation'`,
            req.reason || 'Confirmation rejected',
            req.reason || 'Confirmation rejected',
            runID,
          );
          this.exec(
            `UPDATE turns
             SET status='failed', stream_status='failed', finished_at=datetime('now'), completed_at=datetime('now')
             WHERE id=? AND status='waiting_confirmation'`,
            turnID,
          );
          this.markProductTaskFailed(productTaskID, runID, new Error(req.reason || 'Confirmation rejected'), 'failed');
          this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'run.failed', { run_id: runID, turn_id: turnID, status: 'failed', error: 'confirmation_rejected', message: req.reason || 'Confirmation rejected' });
        }
      }
      this.exec(
        `INSERT INTO worker_gateway_audit_logs (id, node_id, action, status, reason, metadata)
         VALUES (?, '', 'confirmation_decision', ?, ?, ?)`,
        `audit_${newID()}`,
        status,
        req.reason || '',
        json({ confirmation_id: id, actor: decidedBy, decided_at: decidedAt || nowIso(), edited_parameters: editedParameters || undefined, electron_native: true }),
      );
    });
    return { confirmation: this.listConfirmations().items.find((item) => item.id === id) };
  }

  loadApprovedToolCallingResume(confirmationID: string): ToolCallingResumeRequest | undefined {
    const id = confirmationID.trim();
    if (!id) throw new Error('confirmation id is required');
    const row = this.get(
      `SELECT cr.id AS confirmation_id, COALESCE(cr.run_id, '') AS run_id,
              COALESCE(cr.turn_id, '') AS turn_id, COALESCE(cr.call_id, '') AS call_id,
              COALESCE(cr.capability_id, '') AS capability_id, cr.requested_action,
              cr.risk_level, cr.input, COALESCE(r.conversation_id, '') AS conversation_id,
              COALESCE(r.user_message_id, '') AS user_message_id, COALESCE(m.content, '') AS user_message,
              COALESCE(r.selected_agent_id, '') AS agent_id, COALESCE(r.selected_model_id, '') AS model_id,
              COALESCE(NULLIF(json_extract(r.route_result, '$.model'), ''), models.model_name, r.selected_model_id, '') AS model_name,
              COALESCE(NULLIF(json_extract(r.route_result, '$.provider'), ''), models.provider, 'openai_compatible') AS provider
       FROM confirmation_requests cr
       JOIN runs r ON r.id=cr.run_id
       LEFT JOIN messages m ON m.id=r.user_message_id
       LEFT JOIN models ON models.id=r.selected_model_id
       WHERE cr.id=? AND cr.status='approved' AND cr.resumed_at IS NULL
       LIMIT 1`,
      id,
    );
    if (!row) return undefined;
    return {
      confirmation_id: String(row.confirmation_id),
      run_id: optionalString(row.run_id) || '',
      turn_id: optionalString(row.turn_id) || '',
      call_id: optionalString(row.call_id) || '',
      capability_id: canonicalCapabilityName(optionalString(row.capability_id) || ''),
      requested_action: optionalString(row.requested_action) || '',
      risk_level: optionalString(row.risk_level) || 'read_only',
      input: parseObject(row.input),
      conversation_id: optionalString(row.conversation_id) || '',
      user_message_id: optionalString(row.user_message_id) || '',
      user_message: optionalString(row.user_message) || '',
      agent_id: optionalString(row.agent_id) || 'general_agent',
      model_id: optionalString(row.model_id) || optionalString(row.model_name) || 'model',
      model_name: optionalString(row.model_name) || optionalString(row.model_id) || 'model',
      provider: optionalString(row.provider) || 'openai_compatible',
    };
  }

  completeApprovedToolCallingResume(confirmationID: string, resume: PersistedToolCallingResume): ChatResponse | undefined {
    const request = this.loadApprovedToolCallingResume(confirmationID);
    if (!request) return undefined;
    const baseResponse = resume.final_message.trim() || '已执行批准的工具调用。';
    const modelError = resume.model_error?.trim() || '';
    const responseBase = sanitizeAssistantConversationText(request.user_message, baseResponse);
    const response = modelError ? `${responseBase}\n\n最终模型回复失败：${modelError}` : responseBase;
    const toolResult = normalizePersistedToolResult(resume.tool_result);
    const continuationToolResults = (resume.tool_results || [])
      .map(normalizePersistedToolResult)
      .filter((result, index, results) => (
        Boolean(result.call_id)
        && result.call_id !== toolResult.call_id
        && results.findIndex((candidate) => candidate.call_id === result.call_id) === index
      ));
    const allToolResults = [toolResult, ...continuationToolResults];
    const toolArgs = toolResult.arguments || {};
    const capability = canonicalCapabilityName(request.capability_id || toolResult.name);
    const workflowName = workflowNameForGateway(capability);
    const toolRunID = `toolrun_${newID()}`;
    const resumedToolRunIDs = [toolRunID];
    const modelCallID = `mcall_${newID()}`;
    const assistantMessageID = `msg_${newID()}`;
    const usage = resume.usage || {};
    const normalizedUsage = canonicalModelUsage(usage);
    const usageStatus = resume.usage_status || usageStatusForUsage(normalizedUsage);
    const resumeProvider = resume.provider || request.provider;
    const resumeModelName = resume.model_name || request.model_name;
    const costEstimate = this.estimateModelUsageCost(resumeProvider, resumeModelName, normalizedUsage);
    const runMetadata = parseObject(this.get(`SELECT metadata FROM runs WHERE id=?`, request.run_id)?.metadata);
    const productTaskID = optionalString(runMetadata.product_task_id);
    const operationID = optionalString(request.input.operation_id) || operationIDForTool(productTaskID, capability, toolArgs, request.call_id);
    const toolStatus = toolRunStatusForOutput(toolResult.output);
    const toolSummary = summaryForToolOutput(toolResult.output, toolStatus);
    let productTask: ProductTask | undefined;
    let artifacts: ArtifactSummary[] = [];
    const promptAssembly = this.get(
      `SELECT id, prefix_hash, dynamic_tail_hash, prompt_cache_key
       FROM prompt_assemblies
       WHERE run_id=?
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT 1`,
      request.run_id,
    );

    this.transaction(() => {
      this.exec(
        `INSERT INTO tool_runs (id, run_id, turn_id, tool_call_id, capability_id, workflow_name, tool_name, purpose,
                                approval_request_id, node_id, assignment_reason, risk_level, side_effect_level,
                                idempotency_key, status, input, output, output_summary, error_code, error_message,
                                finished_at, completed_at, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'main-node', 'confirmation_resume', ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''),
                 datetime('now'), datetime('now'), ?)`,
        toolRunID,
        request.run_id,
        request.turn_id,
        request.call_id,
        capability,
        workflowName,
        capability,
        request.requested_action || `Execute ${capability}`,
        request.confirmation_id,
        toolResultRisk(toolResult, capability),
        toolResultSideEffect(toolResult, capability),
        operationID,
        toolStatus,
        json(toolArgs),
        json(toolResult.output),
        toolSummary,
        toolResultErrorCode(toolResult, toolStatus),
        toolResultErrorMessage(toolResult, toolStatus),
        toolResultDuration(toolResult),
      );
      this.exec(
        `UPDATE turn_items
         SET output=?, content=?, status='completed',
             metadata=json_set(COALESCE(metadata, '{}'), '$.resumed_by_confirmation', ?, '$.tool_run_id', ?)
         WHERE run_id=? AND call_id=? AND item_type='tool_output' AND status='waiting_confirmation'`,
        json(toolResult.output),
        JSON.stringify(toolResult.output),
        request.confirmation_id,
        toolRunID,
        request.run_id,
        request.call_id,
      );
      this.exec(
        `UPDATE turn_items
         SET status='completed',
             metadata=json_set(COALESCE(metadata, '{}'), '$.resumed_by_confirmation', ?)
         WHERE run_id=? AND call_id=? AND item_type='tool_call'`,
        request.confirmation_id,
        request.run_id,
        request.call_id,
      );
      this.exec(
        `UPDATE confirmation_requests
         SET resumed_at=datetime('now')
         WHERE id=?`,
        request.confirmation_id,
      );
      this.insertRunStep(request.run_id, 'approval_resumed', 'Approved tool execution resumed', { confirmation_id: request.confirmation_id, call_id: request.call_id, capability }, toolResult.output);
      this.insertRunStep(request.run_id, 'tool_finished', 'Tool runtime finished', { workflow_name: workflowName, tool_run_id: toolRunID, call_id: request.call_id, resumed: true }, toolResult.output);
      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'approval.resumed', {
        item_type: 'approval',
        item_id: request.confirmation_id,
        confirmation_id: request.confirmation_id,
        call_id: request.call_id,
        capability,
        status: 'completed',
        visibility: 'approval',
        source: 'store',
      });
      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'run.resumed', {
        run_id: request.run_id,
        turn_id: request.turn_id,
        status: 'running',
        visibility: 'inline_status',
        source: 'store',
        resumed_from_confirmation_id: request.confirmation_id,
      });
      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'tool.started', {
        item_type: 'tool_run',
        item_id: request.call_id,
        tool_run_id: toolRunID,
        call_id: request.call_id,
        tool_name: capability,
        capability,
        status: 'running',
        visibility: 'tool',
        source: 'tool',
        resumed: true,
      });
      this.recordProductTaskToolCheckpoint(productTaskID, {
        run_id: request.run_id,
        capability,
        requested_action: request.requested_action || `Execute ${capability}`,
        input: toolArgs,
        output: { ...toolResult.output, resumed: true },
        status: toolStatus === 'failed' || toolStatus === 'policy_blocked' ? 'failed' : 'done',
        tool_run_id: toolRunID,
        operation_id: operationID,
      });
      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'tool.output_delta', { item_type: 'tool_run', item_id: request.call_id, tool_run_id: toolRunID, call_id: request.call_id, tool_name: capability, status: toolStatus, output: toolResult.output, visibility: 'tool', source: 'tool', resumed: true });
      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), toolStatus === 'failed' ? 'tool.failed' : toolStatus === 'policy_blocked' ? 'tool.policy_blocked' : 'tool.completed', { item_type: 'tool_run', item_id: request.call_id, tool_run_id: toolRunID, call_id: request.call_id, tool_name: capability, status: toolStatus, summary: toolSummary, output: toolResult.output, visibility: 'tool', source: 'tool', resumed: true });
      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'tool.finished', { call_id: request.call_id, tool_name: capability, status: toolStatus, output: toolResult.output, visibility: 'trace_only', resumed: true });

      for (const result of continuationToolResults) {
        const continuationCapability = toolResultCapability(result);
        const persistedCapabilityID = this.registeredCapabilityID(continuationCapability);
        const continuationWorkflowName = workflowNameForGateway(continuationCapability);
        const continuationArgs = result.arguments || {};
        const continuationStatus = toolRunStatusForOutput(result.output);
        const continuationSummary = summaryForToolOutput(result.output, continuationStatus);
        const continuationRisk = toolResultRisk(result, continuationCapability);
        const continuationSideEffect = toolResultSideEffect(result, continuationCapability);
        const continuationRequestedAction = requestedActionForTool(continuationCapability, continuationArgs, result.output);
        const continuationOperationID = operationIDForTool(productTaskID, continuationCapability, continuationArgs, result.call_id);
        const continuationToolRunID = `toolrun_${newID()}`;
        resumedToolRunIDs.push(continuationToolRunID);
        this.insertRunStep(request.run_id, 'capability_requested', 'Approval continuation requested read-only capability', { agent_id: request.agent_id, call_id: result.call_id, tool_name: result.name, resumed: true }, { capability: continuationCapability, inputs: continuationArgs, risk: continuationRisk, operation_id: continuationOperationID });
        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'tool.call_requested', { item_type: 'tool_run', item_id: result.call_id, call_id: result.call_id, tool_name: result.name, capability: continuationCapability, status: 'requested', visibility: 'tool', source: 'model_provider', input: continuationArgs, risk: continuationRisk, resumed: true });
        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'tool.started', { item_type: 'tool_run', item_id: result.call_id, tool_run_id: continuationToolRunID, call_id: result.call_id, tool_name: result.name, capability: continuationCapability, status: 'running', visibility: 'tool', source: 'tool', resumed: true });
        this.exec(
          `INSERT INTO tool_runs (id, run_id, turn_id, tool_call_id, capability_id, workflow_name, tool_name, purpose,
                                  approval_request_id, node_id, assignment_reason, risk_level, side_effect_level,
                                  idempotency_key, status, input, output, output_summary, error_code, error_message,
                                  finished_at, completed_at, duration_ms)
           VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, 'main-node', 'approval_resume_continuation', ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''),
                   datetime('now'), datetime('now'), ?)`,
          continuationToolRunID,
          request.run_id,
          request.turn_id,
          result.call_id,
          persistedCapabilityID,
          continuationWorkflowName,
          result.name,
          continuationRequestedAction,
          request.confirmation_id,
          continuationRisk,
          continuationSideEffect,
          continuationOperationID,
          continuationStatus,
          json(continuationArgs),
          json(result.output),
          continuationSummary,
          toolResultErrorCode(result, continuationStatus),
          toolResultErrorMessage(result, continuationStatus),
          toolResultDuration(result),
        );
        this.insertRunStep(request.run_id, 'tool_finished', 'Approval continuation tool finished', { workflow_name: continuationWorkflowName, tool_run_id: continuationToolRunID, call_id: result.call_id, resumed: true }, result.output);
        this.insertTurnItem(request.run_id, request.turn_id, this.nextTurnItemSeq(request.run_id), 'tool_call', 'assistant', result.call_id, result.name, continuationArgs, '', {}, 'completed', { capability: continuationCapability, resumed_from_confirmation_id: request.confirmation_id });
        this.insertTurnItem(request.run_id, request.turn_id, this.nextTurnItemSeq(request.run_id), 'tool_output', 'tool', result.call_id, result.name, {}, JSON.stringify(result.output), result.output, continuationStatus === 'failed' || continuationStatus === 'policy_blocked' ? 'failed' : 'completed', { tool_run_id: continuationToolRunID, capability: continuationCapability, resumed_from_confirmation_id: request.confirmation_id });
        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'tool.output_delta', { item_type: 'tool_run', item_id: result.call_id, tool_run_id: continuationToolRunID, call_id: result.call_id, tool_name: result.name, capability: continuationCapability, status: continuationStatus, output: result.output, visibility: 'tool', source: 'tool', resumed: true });
        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), continuationStatus === 'failed' ? 'tool.failed' : continuationStatus === 'policy_blocked' ? 'tool.policy_blocked' : 'tool.completed', { item_type: 'tool_run', item_id: result.call_id, tool_run_id: continuationToolRunID, call_id: result.call_id, tool_name: result.name, capability: continuationCapability, status: continuationStatus, summary: continuationSummary, output: result.output, visibility: 'tool', source: 'tool', resumed: true });
        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'tool.finished', { call_id: result.call_id, tool_name: result.name, capability: continuationCapability, status: continuationStatus, output: result.output, visibility: 'trace_only', resumed: true });
        this.recordProductTaskToolCheckpoint(productTaskID, {
          run_id: request.run_id,
          capability: continuationCapability,
          requested_action: continuationRequestedAction,
          input: continuationArgs,
          output: { ...result.output, resumed: true },
          status: continuationStatus === 'failed' || continuationStatus === 'policy_blocked' ? 'failed' : 'done',
          tool_run_id: continuationToolRunID,
          operation_id: continuationOperationID,
        });
      }
      const persistedToolRunCount = this.persistedToolRunCountForRun(request.run_id);
      if (modelError) {
        this.insertRunStep(request.run_id, 'model_call_failed', 'Model call failed after approval resume', { agent_id: request.agent_id, model_id: resumeModelName, prompt_assembly_id: optionalString(promptAssembly?.id) || '' }, { model_call_id: modelCallID, provider: resumeProvider, model: resumeModelName, resumed: true, error: modelError, ...normalizedUsage, estimated_cost: roundCost(costEstimate), tool_run_ids: resumedToolRunIDs, tool_run_count: persistedToolRunCount }, 'failed');
	        this.exec(
	          `INSERT INTO model_calls (id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name,
                                      prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, output_tokens,
                                      cached_input_tokens, cache_write_input_tokens, reasoning_tokens, total_tokens,
                                      cost_estimate, latency_ms, status, streaming_enabled, completed_at,
                                      finish_reason, usage_status, error_code, error_message, raw_response,
                                      raw_finish_json, metadata, created_at)
		           VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'failed', 1, datetime('now'),
                     'failed', 'failed', 'approval_resume_model_failed', ?, ?, ?, ?, datetime('now'))`,
          modelCallID,
          request.run_id,
          request.agent_id,
          request.model_id || resumeModelName,
          optionalString(promptAssembly?.id) || '',
          resumeProvider,
          resumeModelName,
          optionalString(promptAssembly?.prompt_cache_key) || '',
          optionalString(promptAssembly?.prefix_hash) || '',
          optionalString(promptAssembly?.dynamic_tail_hash) || '',
          normalizedUsage.input_tokens,
          normalizedUsage.output_tokens,
          normalizedUsage.cached_input_tokens,
          normalizedUsage.cache_write_input_tokens,
          normalizedUsage.reasoning_tokens,
          normalizedUsage.total_tokens,
          roundCost(costEstimate),
	          modelError,
	          json({ responses: resume.model_responses || [], error: modelError }),
	          json({ status: 'failed', error: modelError, usage_status: 'failed' }),
	          json({ source: 'electron_ts_tool_calling_resume', resumed_from_confirmation_id: request.confirmation_id, tool_run_id: toolRunID, tool_run_ids: resumedToolRunIDs, tool_run_count: persistedToolRunCount, error: modelError, estimated_cost: roundCost(costEstimate) }),
	        );
        this.exec(
          `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
           VALUES (?, ?, 'assistant', ?, '[]', ?, datetime('now'))`,
          assistantMessageID,
          request.conversation_id,
          response,
          json({ run_id: request.run_id, source: 'electron_ts_tool_calling_resume', resumed_from_confirmation_id: request.confirmation_id, model_call_id: modelCallID, error: modelError }),
        );
        this.insertTurnItem(request.run_id, request.turn_id, this.nextTurnItemSeq(request.run_id), 'message', 'assistant', '', '', {}, response, {}, 'failed', { final_answer: true, resumed_from_confirmation_id: request.confirmation_id, error: modelError });
	        this.exec(
	          `UPDATE runs
	           SET status='failed', terminal_status='failed', terminal_reason=?, error_code='approval_resume_model_failed', error_message=?, finished_at=datetime('now'),
	               duration_ms=CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER)
	           WHERE id=?`,
	          modelError,
	          modelError,
	          request.run_id,
	        );
	        this.exec(
	          `UPDATE turns
	           SET status='failed', stream_status='failed', finished_at=datetime('now'), completed_at=datetime('now')
	           WHERE id=?`,
	          request.turn_id,
	        );
	        this.markProductTaskFailed(productTaskID, request.run_id, new Error(modelError), 'failed');
	        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'assistant.completed', { run_id: request.run_id, turn_id: request.turn_id, item_type: 'assistant_message', item_id: assistantMessageID, delta: { text: response }, status: 'failed', visibility: 'chat', source: 'store', resumed: true, error: modelError });
	        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'message.delta', { run_id: request.run_id, turn_id: request.turn_id, delta: response, status: 'failed', visibility: 'trace_only', resumed: true, error: modelError });
	        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'run.failed', { run_id: request.run_id, turn_id: request.turn_id, status: 'failed', terminal: true, error: 'approval_resume_model_failed', message: modelError, resumed: true });
        if (productTaskID) {
          productTask = this.getProductTask(productTaskID).task;
        }
        return;
      }
      this.insertRunStep(request.run_id, 'model_call_finished', 'Model call finished', { agent_id: request.agent_id, model_id: resumeModelName, prompt_assembly_id: optionalString(promptAssembly?.id) || '' }, { model_call_id: modelCallID, provider: resumeProvider, model: resumeModelName, real_model: resumeProvider !== 'mock_provider', resumed: true, ...normalizedUsage, estimated_cost: roundCost(costEstimate), tool_run_ids: resumedToolRunIDs, tool_run_count: persistedToolRunCount });
      this.insertRunStep(request.run_id, 'agent_output_parsed', 'Agent output parsed', { turn: 1, resumed: true }, { repaired: false, output_type: 'final_answer' });
      this.insertRunStep(request.run_id, 'response_generated', 'Response generated', {}, { response, resumed: true });
	      this.exec(
	        `INSERT INTO model_calls (id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name,
                                  prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, output_tokens,
                                  cached_input_tokens, cache_write_input_tokens, reasoning_tokens, total_tokens,
                                  cost_estimate, latency_ms, status, streaming_enabled, completed_at,
                                  finish_reason, usage_status, raw_response, raw_finish_json, metadata, created_at)
	         VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'succeeded', 1, datetime('now'),
                   'completed', ?, ?, ?, ?, datetime('now'))`,
        modelCallID,
        request.run_id,
        request.agent_id,
        request.model_id || resumeModelName,
        optionalString(promptAssembly?.id) || '',
        resumeProvider,
        resumeModelName,
        optionalString(promptAssembly?.prompt_cache_key) || '',
        optionalString(promptAssembly?.prefix_hash) || '',
        optionalString(promptAssembly?.dynamic_tail_hash) || '',
	        normalizedUsage.input_tokens,
	        normalizedUsage.output_tokens,
	        normalizedUsage.cached_input_tokens,
          normalizedUsage.cache_write_input_tokens,
          normalizedUsage.reasoning_tokens,
          normalizedUsage.total_tokens,
          roundCost(costEstimate),
	        usageStatus,
	        json({ responses: resume.model_responses || [] }),
	        json({ status: 'completed', usage_status: usageStatus }),
	        json({ source: 'electron_ts_tool_calling_resume', resumed_from_confirmation_id: request.confirmation_id, tool_run_id: toolRunID, tool_run_ids: resumedToolRunIDs, tool_run_count: persistedToolRunCount, usage_status: usageStatus, estimated_cost: roundCost(costEstimate) }),
	      );
      this.exec(
        `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
         VALUES (?, ?, 'assistant', ?, '[]', ?, datetime('now'))`,
        assistantMessageID,
        request.conversation_id,
        response,
        json({ run_id: request.run_id, source: 'electron_ts_tool_calling_resume', resumed_from_confirmation_id: request.confirmation_id, model_call_id: modelCallID }),
      );
      this.insertTurnItem(request.run_id, request.turn_id, this.nextTurnItemSeq(request.run_id), 'message', 'assistant', '', '', {}, response, {}, 'completed', { final_answer: true, resumed_from_confirmation_id: request.confirmation_id });
	      this.exec(
	        `UPDATE runs
	         SET status='succeeded', terminal_status='completed', terminal_reason='approval resume completed',
               error_code=NULL, error_message=NULL, resumed_at=COALESCE(resumed_at, datetime('now')), finished_at=datetime('now'),
	             duration_ms=CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER)
	         WHERE id=?`,
        request.run_id,
      );
	      this.exec(
	        `UPDATE turns
	         SET status='completed', stream_status='completed', finished_at=datetime('now'), completed_at=datetime('now')
	         WHERE id=?`,
	        request.turn_id,
	      );
	      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'assistant.delta', { run_id: request.run_id, turn_id: request.turn_id, item_type: 'assistant_message', item_id: assistantMessageID, delta: { text: response, stream_source: 'resume_final_chunk' }, status: 'completed', visibility: 'chat', source: 'store', resumed: true });
	      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'assistant.completed', { run_id: request.run_id, turn_id: request.turn_id, item_type: 'assistant_message', item_id: assistantMessageID, delta: { text: response }, status: 'completed', visibility: 'chat', source: 'store', resumed: true, terminal: true });
	      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'usage.recorded', { run_id: request.run_id, turn_id: request.turn_id, item_type: 'model', item_id: modelCallID, status: usageStatus, visibility: 'trace_only', source: 'store', usage: normalizedUsage, usage_status: usageStatus, estimated_cost: roundCost(costEstimate), resumed: true });
	      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'message.delta', { run_id: request.run_id, turn_id: request.turn_id, delta: response, status: 'completed', visibility: 'trace_only', resumed: true });
	      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'turn.completed', { run_id: request.run_id, turn_id: request.turn_id, status: 'completed', resumed: true });
	      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'run.completed', { run_id: request.run_id, status: 'succeeded', terminal: true, resumed: true });
      artifacts = this.finalizeProductTaskAfterRun(productTaskID, {
        run_id: request.run_id,
        conversation_id: request.conversation_id,
        message_id: assistantMessageID,
        response,
        waiting_confirmation: false,
        tool_results: allToolResults,
        runtime_status: 'completed',
      });
      if (productTaskID) {
        productTask = this.getProductTask(productTaskID).task;
      }
    });

    return {
      conversation_id: request.conversation_id,
      user_message_id: request.user_message_id,
      assistant_message_id: assistantMessageID,
      run_id: request.run_id,
      selected_agent_id: request.agent_id,
      response,
      ui: {
        interaction_class: 'chat',
        requires_user_input: false,
        inline_execution: true,
      },
      model_calls: [],
      product_task: productTask,
      artifacts,
    };
  }

  interruptRun(req: { run_id?: string; reason?: string }): void {
    const runID = req.run_id?.trim();
    if (!runID) throw new Error('run_id is required');
    const reason = req.reason || 'interrupted by user';
    const runMetadata = parseObject(this.get(`SELECT metadata FROM runs WHERE id=?`, runID)?.metadata);
    const productTaskID = optionalString(runMetadata.product_task_id);
    const pendingApprovals = this.all(
      `SELECT COALESCE(turn_id, '') AS turn_id, COALESCE(call_id, '') AS call_id, COALESCE(capability_id, '') AS capability_id
       FROM confirmation_requests
       WHERE run_id=? AND status='pending'`,
      runID,
    );
    this.transaction(() => {
      this.exec(
        `UPDATE runs
         SET status='cancelled', terminal_status='cancelled', terminal_reason=?, cancel_requested_at=COALESCE(cancel_requested_at, datetime('now')),
             error_code='interrupted', error_message=?, finished_at=datetime('now'),
             duration_ms=CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER)
         WHERE id=?`,
        reason,
        reason,
        runID,
      );
      this.exec(
        `UPDATE turns
         SET status='cancelled', stream_status='cancelled', finished_at=datetime('now'), completed_at=datetime('now')
         WHERE run_id=? AND status IN ('running', 'waiting_confirmation', 'waiting_tool')`,
        runID,
      );
      this.exec(
        `UPDATE turn_items
         SET status='cancelled'
         WHERE run_id=? AND status IN ('running', 'waiting_confirmation', 'waiting_tool')`,
        runID,
      );
      this.exec(
        `UPDATE confirmation_requests
         SET status='rejected', rejected_by='desktop_ui', decision_reason=?, decided_at=datetime('now')
         WHERE run_id=? AND status='pending'`,
        reason,
        runID,
      );
      for (const approval of pendingApprovals) {
        const callID = optionalString(approval.call_id);
        if (!callID) continue;
        this.insertRunEvent(runID, optionalString(approval.turn_id) || '', this.nextRunEventSeq(runID), 'tool.cancelled', {
          item_type: 'tool_run',
          item_id: callID,
          call_id: callID,
          tool_name: optionalString(approval.capability_id),
          status: 'cancelled',
          summary: reason,
          output: { status: 'cancelled', reason },
          visibility: 'tool',
          source: 'store',
        });
      }
      const appendCancelEventOnce = (eventType: string, status: string, visibility: string, terminal = false) => {
        if (this.get(`SELECT id FROM run_events WHERE run_id=? AND event_type=? LIMIT 1`, runID, eventType)) return;
        this.appendRunEventV2({
          id: `${runID}_evt_${eventType.replace(/\W+/g, '_')}`,
          run_id: runID,
          event_type: eventType,
          status,
          source: 'store',
          visibility,
          terminal,
          payload: { status, reason },
        });
      };
      appendCancelEventOnce('run.cancel_requested', 'running', 'inline_status');
      appendCancelEventOnce('run.cancelled', 'cancelled', 'inline_status', true);
      appendCancelEventOnce('run.interrupted', 'cancelled', 'trace_only');
      this.markProductTaskFailed(productTaskID, runID, new Error(reason), 'cancelled');
    });
  }

  redirectRun(req: { run_id?: string; target_run_id?: string; reason?: string }): RunTrace {
    const runID = req.run_id?.trim();
    if (!runID) throw new Error('run_id is required');
    const run = this.get(`SELECT id, status, metadata FROM runs WHERE id=?`, runID);
    if (!run) throw new Error(`Run not found: ${runID}`);
    const status = String(run.status || '');
    if (['completed', 'succeeded', 'failed', 'cancelled', 'redirected'].includes(status)) {
      return this.getRunTrace(runID);
    }
    const reason = req.reason || 'redirected by user';
    const productTaskID = optionalString(parseObject(run.metadata).product_task_id);
    this.transaction(() => {
      this.exec(
        `UPDATE runs
         SET status='redirected', terminal_status='redirected', terminal_reason=?, finished_at=datetime('now'),
             duration_ms=CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER)
         WHERE id=?`,
        reason,
        runID,
      );
      this.exec(
        `UPDATE turns
         SET status='cancelled', stream_status='redirected', finished_at=datetime('now'), completed_at=datetime('now')
         WHERE run_id=? AND status IN ('created', 'mode_resolved', 'prompting', 'running', 'streaming', 'tool_calling', 'waiting_confirmation', 'waiting_tool')`,
        runID,
      );
      this.exec(
        `UPDATE model_calls
         SET status='cancelled', completed_at=datetime('now'), finish_reason='redirected',
             error_code='redirected', error_message=?
         WHERE run_id=? AND status IN ('pending', 'running')`,
        reason,
        runID,
      );
      this.exec(
        `UPDATE confirmation_requests
         SET status='rejected', rejected_by='desktop_ui', decision_reason=?, decided_at=datetime('now')
         WHERE run_id=? AND status='pending'`,
        reason,
        runID,
      );
      if (productTaskID) {
        this.exec(
          `UPDATE product_tasks
           SET status='paused', terminal_status='redirected', terminal_reason=?, summary=?,
               updated_at=datetime('now'), last_projected_at=datetime('now')
           WHERE id=?`,
          reason,
          `Redirected: ${reason}`,
          productTaskID,
        );
      }
      if (!this.get(`SELECT id FROM run_events WHERE run_id=? AND event_type='run.redirected' LIMIT 1`, runID)) {
        this.appendRunEventV2({
          id: `${runID}_evt_redirected`,
          run_id: runID,
          event_type: 'run.redirected',
          status: 'redirected',
          source: 'store',
          visibility: 'inline_status',
          terminal: true,
          payload: {
            status: 'redirected',
            reason,
            target_run_id: req.target_run_id?.trim() || undefined,
          },
        });
      }
    });
    return this.getRunTrace(runID);
  }

  enqueueRunMessage(input: {
    run_id: string;
    conversation_id?: string;
    kind: 'steering' | 'follow_up';
    content: string;
    attachments?: unknown[];
  }): RunQueuedMessage {
    const runID = input.run_id?.trim();
    const content = input.content?.trim();
    if (!runID) throw new Error('run_id is required');
    if (!content) throw new Error('queued message content is required');
    if (!['steering', 'follow_up'].includes(input.kind)) throw new Error(`Unsupported queued message kind: ${input.kind}`);
    const run = this.get(`SELECT id, conversation_id, status, terminal_status FROM runs WHERE id=?`, runID);
    if (!run) throw new Error(`Run not found: ${runID}`);
    const status = optionalString(run.terminal_status) || optionalString(run.status) || '';
    if (['completed', 'succeeded', 'failed', 'cancelled', 'redirected'].includes(status)) {
      throw new Error(`Run ${runID} is already terminal (${status})`);
    }
    const conversationID = input.conversation_id?.trim() || optionalString(run.conversation_id) || '';
    if (!conversationID) throw new Error('conversation_id is required');
    const id = `rqm_${newID()}`;
    this.exec(
      `INSERT INTO run_message_queue (
         id, run_id, conversation_id, kind, content, attachments, status, metadata, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))`,
      id,
      runID,
      conversationID,
      input.kind,
      content,
      json(input.attachments || []),
      json({ source: 'desktop_composer' }),
    );
    this.appendRunEventV2({
      id: `${runID}_evt_queue_${id}`,
      run_id: runID,
      event_type: `run.message_${input.kind}_queued`,
      status: 'pending',
      source: 'desktop',
      visibility: 'inline_status',
      payload: { queue_message_id: id, kind: input.kind, content_preview: content.slice(0, 160) },
    });
    return rowToRunQueuedMessage(this.get(`SELECT * FROM run_message_queue WHERE id=?`, id) || {});
  }

  listRunMessages(input: { run_id: string; status?: string }): { messages: RunQueuedMessage[] } {
    const runID = input.run_id?.trim();
    if (!runID) throw new Error('run_id is required');
    const status = input.status?.trim() || '';
    const rows = status
      ? this.all(`SELECT * FROM run_message_queue WHERE run_id=? AND status=? ORDER BY datetime(created_at), rowid`, runID, status)
      : this.all(`SELECT * FROM run_message_queue WHERE run_id=? ORDER BY datetime(created_at), rowid`, runID);
    return { messages: rows.map(rowToRunQueuedMessage) };
  }

  claimRunMessages(input: {
    run_id: string;
    kind: 'steering' | 'follow_up';
    delivered_run_id?: string;
    limit?: number;
  }): RunQueuedMessage[] {
    const runID = input.run_id.trim();
    const deliveredRunID = input.delivered_run_id?.trim() || runID;
    const limit = Math.max(1, Math.min(20, Math.round(input.limit || 8)));
    const rows = this.all(
      `SELECT * FROM run_message_queue
       WHERE run_id=? AND kind=? AND status='pending'
       ORDER BY datetime(created_at), rowid
       LIMIT ?`,
      runID,
      input.kind,
      limit,
    );
    if (rows.length === 0) return [];
    this.transaction(() => {
      for (const row of rows) {
        const id = optionalString(row.id) || '';
        const content = optionalString(row.content) || '';
        this.exec(
          `UPDATE run_message_queue
           SET status='delivered', delivered_run_id=?, delivered_at=datetime('now')
           WHERE id=? AND status='pending'`,
          deliveredRunID,
          id,
        );
        this.exec(
          `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
           VALUES (?, ?, 'user', ?, ?, ?, datetime('now'))`,
          `msg_${newID()}`,
          optionalString(row.conversation_id) || '',
          content,
          optionalString(row.attachments) || '[]',
          json({ run_id: deliveredRunID, queue_message_id: id, queued_kind: input.kind }),
        );
        this.appendRunEventV2({
          id: `${deliveredRunID}_evt_queue_delivered_${id}`,
          run_id: deliveredRunID,
          event_type: `run.message_${input.kind}_delivered`,
          status: 'completed',
          source: 'runtime',
          visibility: 'inline_status',
          payload: { queue_message_id: id, kind: input.kind },
        });
      }
    });
    return this.all(
      `SELECT * FROM run_message_queue WHERE id IN (${rows.map(() => '?').join(',')}) ORDER BY datetime(created_at), rowid`,
      ...rows.map((row) => optionalString(row.id) || ''),
    ).map(rowToRunQueuedMessage);
  }

  cancelRunMessage(input: { id: string; run_id?: string }): RunQueuedMessage {
    const id = input.id?.trim();
    if (!id) throw new Error('queued message id is required');
    const row = this.get(`SELECT * FROM run_message_queue WHERE id=?`, id);
    if (!row) throw new Error(`Queued message not found: ${id}`);
    if (input.run_id?.trim() && optionalString(row.run_id) !== input.run_id.trim()) throw new Error('queued message does not belong to the requested run');
    if (optionalString(row.status) === 'pending') {
      this.exec(`UPDATE run_message_queue SET status='cancelled' WHERE id=? AND status='pending'`, id);
      const runID = optionalString(row.run_id) || '';
      this.appendRunEventV2({
        id: `${runID}_evt_queue_cancelled_${id}`,
        run_id: runID,
        event_type: 'run.message_queue_cancelled',
        status: 'cancelled',
        source: 'desktop',
        visibility: 'inline_status',
        payload: { queue_message_id: id },
      });
    }
    return rowToRunQueuedMessage(this.get(`SELECT * FROM run_message_queue WHERE id=?`, id) || {});
  }

  listRecoverableRuns(req: { limit?: number } = {}): { runs: RecoverableRunRecord[] } {
    const limit = clampLimit(Number(req.limit || 50), 50);
    const rows = this.all(
      `SELECT r.id, r.conversation_id, r.status
       FROM runs r
       WHERE EXISTS (
         SELECT 1 FROM run_events e
         WHERE e.run_id=r.id AND e.event_type='run.recovery_required'
       )
       AND NOT EXISTS (
         SELECT 1 FROM run_events resolved
         WHERE resolved.run_id=r.id
           AND resolved.event_type IN ('run.recovery_completed', 'run.recovery_abandoned')
       )
       ORDER BY datetime(r.created_at) DESC, r.id DESC
       LIMIT ?`,
      limit,
    );
    return {
      runs: rows.map((row) => {
        const trace = this.getRunTrace(String(row.id));
        const latestRecovery = [...(trace.events || [])].reverse().find((event) => event.event_type === 'run.recovery_required');
        const payload = latestRecovery?.payload || {};
        const completedSideEffects = Number(this.get(
          `SELECT COUNT(*) AS count FROM tool_runs
           WHERE run_id=? AND status='succeeded' AND side_effect_level NOT IN ('', 'none')`,
          String(row.id),
        )?.count || 0);
        const productTaskID = this.productTaskIDForRun(String(row.id));
        return {
          run_id: String(row.id),
          conversation_id: optionalString(row.conversation_id),
          status: String(row.status || trace.status),
          recovery_status: optionalString(payload.recovery_status) || (String(row.status) === 'waiting_confirmation' ? 'needs_user_decision' : 'recoverable'),
          reason: optionalString(payload.reason) || trace.terminal_reason || 'non-terminal run requires review',
          safe_to_retry: completedSideEffects === 0,
          completed_side_effect_count: completedSideEffects,
          product_task_id: productTaskID || undefined,
          latest_event: latestRecovery,
          trace,
        };
      }),
    };
  }

  beginRecoverableRunRetry(runID: string): {
    run_id: string;
    conversation_id: string;
    original_message: string;
    requested_mode: InputMode;
    product_task_id?: string;
    permission_profile: PermissionProfile;
    completed_effects: Array<Record<string, unknown>>;
  } {
    const id = runID.trim();
    if (!id) throw new Error('run_id is required');
    const row = this.get(
      `SELECT r.id, r.conversation_id, r.user_message_id, r.requested_mode, r.status,
              m.content AS user_message
       FROM runs r
       LEFT JOIN messages m ON m.id=r.user_message_id
       WHERE r.id=?`,
      id,
    );
    if (!row) throw new Error(`Run not found: ${id}`);
    const hasRecoveryEvent = Boolean(this.get(
      `SELECT id FROM run_events WHERE run_id=? AND event_type='run.recovery_required' LIMIT 1`,
      id,
    ));
    if (!hasRecoveryEvent || Boolean(this.get(
      `SELECT id FROM run_events
       WHERE run_id=? AND event_type IN ('run.recovery_completed','run.recovery_abandoned') LIMIT 1`,
      id,
    ))) {
      throw new Error(`Run ${id} is not recoverable`);
    }
    const conversationID = optionalString(row.conversation_id) || '';
    const originalMessage = optionalString(row.user_message) || '';
    if (!conversationID || !originalMessage) throw new Error(`Run ${id} has no recoverable conversation input`);
    const productTaskID = this.productTaskIDForRun(id);
    const task = productTaskID ? this.get(`SELECT risk_level FROM product_tasks WHERE id=?`, productTaskID) : undefined;
    const risk = (optionalString(task?.risk_level) || '').toLowerCase();
    const permissionProfile: PermissionProfile = risk.includes('browser') || risk.includes('danger') || risk.includes('external')
      ? 'danger_full_access'
      : risk.includes('write') || risk.includes('state')
        ? 'workspace_write'
        : 'read_only';
    const completedEffects = this.all(
      `SELECT id, capability_id, tool_name, purpose, side_effect_level, idempotency_key,
              output_summary, status, completed_at
       FROM tool_runs
       WHERE run_id=? AND status='succeeded' AND side_effect_level NOT IN ('', 'none')
       ORDER BY datetime(created_at), id`,
      id,
    ).map((effect) => ({
      id: optionalString(effect.id),
      capability: optionalString(effect.capability_id) || optionalString(effect.tool_name),
      purpose: optionalString(effect.purpose),
      side_effect_level: optionalString(effect.side_effect_level),
      idempotency_key: optionalString(effect.idempotency_key),
      summary: optionalString(effect.output_summary),
      completed_at: optionalString(effect.completed_at),
    }));
    const resumeToken = `resume_${newID()}`;
    this.transaction(() => {
      this.exec(
        `UPDATE runs
         SET status='resuming', terminal_status=NULL, finished_at=NULL, resume_token=?, resumed_at=datetime('now'),
             error_code=NULL, error_message=NULL,
             metadata=json_set(COALESCE(metadata, '{}'), '$.recovery.retry_started_at', datetime('now'))
         WHERE id=?`,
        resumeToken,
        id,
      );
      this.appendRunEventV2({
        id: `${id}_evt_recovery_retry_${resumeToken}`,
        run_id: id,
        event_type: 'run.recovery_retry_started',
        status: 'resuming',
        source: 'desktop',
        visibility: 'inline_status',
        payload: {
          recovery_status: 'resuming',
          resume_token: resumeToken,
          completed_side_effect_count: completedEffects.length,
        },
      });
    });
    return {
      run_id: id,
      conversation_id: conversationID,
      original_message: originalMessage,
      requested_mode: normalizeAutomationInputMode(optionalString(row.requested_mode) || 'auto'),
      product_task_id: productTaskID || undefined,
      permission_profile: permissionProfile,
      completed_effects: completedEffects,
    };
  }

  completeRecoverableRunRetry(originalRunID: string, newRunID: string): RunTrace {
    const originalID = originalRunID.trim();
    const nextID = newRunID.trim();
    if (!originalID || !nextID) throw new Error('original and new run ids are required');
    this.transaction(() => {
      this.exec(
        `UPDATE runs
         SET status='redirected', terminal_status='redirected', terminal_reason=?, finished_at=datetime('now'),
             metadata=json_set(COALESCE(metadata, '{}'), '$.recovery.new_run_id', ?, '$.recovery.completed_at', datetime('now'))
         WHERE id=?`,
        `recovered as ${nextID}`,
        nextID,
        originalID,
      );
      this.appendRunEventV2({
        id: `${originalID}_evt_recovery_completed_${nextID}`,
        run_id: originalID,
        event_type: 'run.recovery_completed',
        status: 'redirected',
        source: 'runtime',
        visibility: 'inline_status',
        terminal: true,
        payload: { recovery_status: 'completed', new_run_id: nextID },
      });
    });
    return this.getRunTrace(originalID);
  }

  failRecoverableRunRetry(originalRunID: string, error: string): RunTrace {
    const id = originalRunID.trim();
    const message = error.trim() || 'recovery retry failed';
    this.transaction(() => {
      this.exec(
        `UPDATE runs
         SET status='needs_recovery', terminal_status=NULL, finished_at=NULL,
             error_code='recovery_retry_failed', error_message=?, terminal_reason=?
         WHERE id=?`,
        message,
        message,
        id,
      );
      this.appendRunEventV2({
        id: `${id}_evt_recovery_retry_failed_${newID()}`,
        run_id: id,
        event_type: 'run.recovery_retry_failed',
        status: 'needs_recovery',
        source: 'runtime',
        visibility: 'inline_status',
        error: { code: 'recovery_retry_failed', message },
        payload: { recovery_status: 'recoverable', reason: message },
      });
    });
    return this.getRunTrace(id);
  }

  abandonRecoverableRun(runID: string, reason = 'abandoned by user'): RunTrace {
    const id = runID.trim();
    if (!id) throw new Error('run_id is required');
    if (!this.get(`SELECT id FROM run_events WHERE run_id=? AND event_type='run.recovery_required' LIMIT 1`, id)) {
      throw new Error(`Run ${id} is not recoverable`);
    }
    const productTaskID = this.productTaskIDForRun(id);
    this.transaction(() => {
      this.exec(
        `UPDATE runs
         SET status='cancelled', terminal_status='cancelled', terminal_reason=?, finished_at=datetime('now'),
             metadata=json_set(COALESCE(metadata, '{}'), '$.recovery.abandoned_at', datetime('now'))
         WHERE id=?`,
        reason,
        id,
      );
      this.exec(
        `UPDATE confirmation_requests SET status='rejected', rejected_by='recovery_abandon', decision_reason=?, decided_at=datetime('now')
         WHERE run_id=? AND status='pending'`,
        reason,
        id,
      );
      if (productTaskID) {
        this.exec(
          `UPDATE product_tasks
           SET status='paused', terminal_status='cancelled', terminal_reason=?, summary=?, updated_at=datetime('now')
           WHERE id=?`,
          reason,
          reason,
          productTaskID,
        );
      }
      this.appendRunEventV2({
        id: `${id}_evt_recovery_abandoned`,
        run_id: id,
        event_type: 'run.recovery_abandoned',
        status: 'cancelled',
        source: 'desktop',
        visibility: 'inline_status',
        terminal: true,
        payload: { recovery_status: 'abandoned', reason },
      });
    });
    return this.getRunTrace(id);
  }

  recordWorkspaceChangeSetPrepared(
    draft: WorkspaceChangeSetDraft,
    context: { run_id?: string; product_task_id?: string } = {},
  ): WorkspaceChangeSet {
    const id = draft.id.trim();
    if (!id) throw new Error('change set id is required');
    if (draft.files.length === 0) throw new Error('change set must include at least one file');
    const requestedRunID = context.run_id?.trim() || '';
    const runID = requestedRunID && this.get(`SELECT id FROM runs WHERE id=?`, requestedRunID) ? requestedRunID : '';
    const requestedTaskID = context.product_task_id?.trim() || (runID ? this.productTaskIDForRun(runID) : '');
    const productTaskID = requestedTaskID && this.get(`SELECT id FROM product_tasks WHERE id=?`, requestedTaskID) ? requestedTaskID : '';
    this.transaction(() => {
      this.exec(
        `INSERT INTO workspace_change_sets (
           id, run_id, product_task_id, capability, status, permission_profile,
           patch, reversible, error, metadata, created_at
         ) VALUES (?, NULLIF(?, ''), NULLIF(?, ''), 'apply_patch', 'prepared', ?, ?, 1, '', ?, datetime('now'))`,
        id,
        runID,
        productTaskID,
        draft.permission_profile,
        draft.patch,
        json({ file_count: draft.files.length, source: 'workspace_exec' }),
      );
      for (const file of draft.files) {
        this.exec(
          `INSERT INTO workspace_change_set_files (
             id, change_set_id, operation, path, mode, before_exists,
             before_content_base64, after_content_base64, before_hash, after_hash,
             bytes, lines, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          `csfile_${newID()}`,
          id,
          file.operation,
          file.path,
          file.mode,
          file.before_exists ? 1 : 0,
          file.before_content_base64,
          file.after_content_base64,
          file.before_hash,
          file.after_hash,
          file.bytes,
          file.lines,
        );
      }
    });
    return this.getWorkspaceChangeSet(id);
  }

  markWorkspaceChangeSetApplied(id: string): WorkspaceChangeSet {
    const changeSetID = id.trim();
    const current = this.getWorkspaceChangeSet(changeSetID);
    if (current.status !== 'prepared') throw new Error(`ChangeSet ${changeSetID} is not prepared`);
    this.exec(
      `UPDATE workspace_change_sets
       SET status='applied', applied_at=datetime('now'), error=''
       WHERE id=? AND status='prepared'`,
      changeSetID,
    );
    if (current.run_id) {
      this.appendRunEventV2({
        id: `${current.run_id}_evt_changeset_applied_${changeSetID}`,
        run_id: current.run_id,
        event_type: 'changeset.applied',
        status: 'completed',
        source: 'tool',
        visibility: 'inline_status',
        payload: {
          change_set_id: changeSetID,
          product_task_id: current.product_task_id || '',
          changed_file_count: current.files.length,
          reversible: true,
        },
      });
    }
    return this.getWorkspaceChangeSet(changeSetID);
  }

  markWorkspaceChangeSetFailed(id: string, error: string): WorkspaceChangeSet {
    const changeSetID = id.trim();
    if (!changeSetID) throw new Error('change set id is required');
    const message = error.trim() || 'workspace patch failed';
    this.exec(
      `UPDATE workspace_change_sets
       SET status='failed', error=?
       WHERE id=? AND status IN ('prepared', 'applied')`,
      message,
      changeSetID,
    );
    return this.getWorkspaceChangeSet(changeSetID);
  }

  listWorkspaceChangeSets(filter: { run_id?: string; product_task_id?: string; limit?: number } = {}): { change_sets: WorkspaceChangeSet[] } {
    const where: string[] = [];
    const values: SQLiteValue[] = [];
    if (filter.run_id?.trim()) {
      where.push('run_id=?');
      values.push(filter.run_id.trim());
    }
    if (filter.product_task_id?.trim()) {
      where.push('product_task_id=?');
      values.push(filter.product_task_id.trim());
    }
    const rows = this.all(
      `SELECT * FROM workspace_change_sets
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY datetime(created_at) DESC, rowid DESC
       LIMIT ?`,
      ...values,
      clampLimit(Number(filter.limit || 50), 50),
    );
    return { change_sets: rows.map((row) => this.workspaceChangeSetFromRow(row)) };
  }

  getWorkspaceChangeSet(id: string): WorkspaceChangeSet {
    const changeSetID = id.trim();
    if (!changeSetID) throw new Error('change set id is required');
    const row = this.get(`SELECT * FROM workspace_change_sets WHERE id=?`, changeSetID);
    if (!row) throw new Error(`ChangeSet not found: ${changeSetID}`);
    return this.workspaceChangeSetFromRow(row);
  }

  revertWorkspaceChangeSet(id: string, reason = 'reverted by user'): WorkspaceChangeSet {
    const changeSetID = id.trim();
    const changeSet = this.getWorkspaceChangeSet(changeSetID);
    if (changeSet.status !== 'applied' || !changeSet.reversible) {
      throw new Error(`ChangeSet ${changeSetID} is not safely reversible`);
    }
    const rows = this.all(
      `SELECT * FROM workspace_change_set_files WHERE change_set_id=? ORDER BY rowid`,
      changeSetID,
    );
    if (rows.length === 0) throw new Error(`ChangeSet ${changeSetID} has no file snapshots`);
    const workspace = this.getWorkspaceSettings();
    const allowedRoots = workspaceRealAndLogicalRoots(workspace.allowed_roots);
    for (const row of rows) {
      const filePath = resolve(optionalString(row.path) || '');
      if (!allowedRoots.some((root) => pathWithinRoot(filePath, root))) {
        throw new Error(`Safe revert blocked: ${filePath} is outside the current workspace`);
      }
      if (!existsSync(filePath) || lstatSync(filePath).isSymbolicLink()) {
        throw new Error(`Safe revert blocked: ${filePath} is missing or is now a symbolic link`);
      }
      const realPath = realpathSync(filePath);
      if (!allowedRoots.some((root) => pathWithinRoot(realPath, root))) {
        throw new Error(`Safe revert blocked: ${filePath} resolves outside the current workspace`);
      }
      const currentHash = createHash('sha256').update(readFileSync(filePath)).digest('hex');
      if (currentHash !== optionalString(row.after_hash)) {
        throw new Error(`Safe revert blocked: ${filePath} changed after ChangeSet ${changeSetID}`);
      }
    }
    const restored: SQLiteRow[] = [];
    try {
      for (const row of [...rows].reverse()) {
        const filePath = resolve(optionalString(row.path) || '');
        if (optionalString(row.operation) === 'add' && !Boolean(Number(row.before_exists || 0))) {
          rmSync(filePath, { force: true });
        } else {
          writeChangeSetFileAtomic(
            filePath,
            Buffer.from(optionalString(row.before_content_base64) || '', 'base64'),
            Number(row.mode || 0o644),
          );
        }
        restored.push(row);
      }
    } catch (error) {
      for (const row of [...restored].reverse()) {
        try {
          writeChangeSetFileAtomic(
            resolve(optionalString(row.path) || ''),
            Buffer.from(optionalString(row.after_content_base64) || '', 'base64'),
            Number(row.mode || 0o644),
          );
        } catch {
          // Preserve the original revert failure; the ChangeSet remains applied for a later repair.
        }
      }
      throw error;
    }
    const row = this.get(`SELECT metadata FROM workspace_change_sets WHERE id=?`, changeSetID);
    this.exec(
      `UPDATE workspace_change_sets
       SET status='reverted', reverted_at=datetime('now'), metadata=?
       WHERE id=? AND status='applied'`,
      json({ ...parseObject(row?.metadata), revert_reason: reason.trim() || 'reverted by user' }),
      changeSetID,
    );
    if (changeSet.run_id) {
      this.appendRunEventV2({
        id: `${changeSet.run_id}_evt_changeset_reverted_${changeSetID}`,
        run_id: changeSet.run_id,
        event_type: 'changeset.reverted',
        status: 'completed',
        source: 'desktop',
        visibility: 'inline_status',
        payload: {
          change_set_id: changeSetID,
          product_task_id: changeSet.product_task_id || '',
          changed_file_count: changeSet.files.length,
          reason: reason.trim() || 'reverted by user',
        },
      });
    }
    return this.getWorkspaceChangeSet(changeSetID);
  }

  private workspaceChangeSetFromRow(row: SQLiteRow): WorkspaceChangeSet {
    const id = optionalString(row.id) || '';
    const files = this.all(
      `SELECT id, operation, path, before_hash, after_hash, bytes, lines
       FROM workspace_change_set_files WHERE change_set_id=? ORDER BY rowid`,
      id,
    ).map((file) => ({
      id: optionalString(file.id) || '',
      operation: optionalString(file.operation) || 'update',
      path: optionalString(file.path) || '',
      before_hash: optionalString(file.before_hash) || '',
      after_hash: optionalString(file.after_hash) || '',
      bytes: Number(file.bytes || 0),
      lines: Number(file.lines || 0),
    }));
    return {
      id,
      run_id: optionalString(row.run_id),
      product_task_id: optionalString(row.product_task_id),
      status: optionalString(row.status) || 'prepared',
      permission_profile: optionalString(row.permission_profile) || 'workspace_write',
      patch: optionalString(row.patch) || '',
      reversible: Boolean(Number(row.reversible ?? 0)),
      error: optionalString(row.error),
      files,
      created_at: optionalString(row.created_at),
      applied_at: optionalString(row.applied_at),
      reverted_at: optionalString(row.reverted_at),
    };
  }

  getRecentRunClosureReport(req: { limit?: number } = {}): RunClosureReport {
    this.classifyExpiredOpenLoops();
    const limit = clampLimit(Number(req.limit || 50), 50);
    const rows = this.all(
      `SELECT id, conversation_id, status, terminal_status, terminal_reason, metadata, created_at, finished_at
       FROM runs
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT ?`,
      limit,
    );
    const items = rows.map((row) => {
      const runID = String(row.id);
      const events = this.all(
        `SELECT event_type, terminal, payload, payload_json
         FROM run_events
         WHERE run_id=?
         ORDER BY seq`,
        runID,
      );
      const terminalEvent = events.find((event) => Boolean(Number(event.terminal ?? 0)))
        || events.find((event) => terminalRunEventType(String(event.event_type || '')));
      const runMetadataTaskID = optionalString(parseObject(row.metadata).product_task_id) || '';
      const task = this.get(
        `SELECT id, status, terminal_status, evidence_summary, verification_status
         FROM product_tasks
         WHERE id=NULLIF(?, '') OR latest_run_id=? OR source_run_id=? OR json_extract(metadata, '$.checkpoints[0].run_id')=?
         ORDER BY datetime(updated_at) DESC, id DESC
         LIMIT 1`,
        runMetadataTaskID,
        runID,
        runID,
        runID,
      );
      const toolRunCount = Number(this.get(
        `SELECT COUNT(*) AS count
         FROM tool_runs
         WHERE run_id=? AND status IN ('succeeded', 'failed', 'cancelled', 'policy_blocked')`,
        runID,
      )?.count || 0);
      const terminalToolEventCount = events.filter((event) => [
        'tool.completed',
        'tool.failed',
        'tool.cancelled',
        'tool.policy_blocked',
        'tool.finished',
      ].includes(String(event.event_type))).length;
      const memoryEventCount = events.filter((event) => String(event.event_type).startsWith('memory.')).length;
      const proactiveEventCount = events.filter((event) => {
        const type = String(event.event_type);
        return type.startsWith('open_loop.') || type.startsWith('proactive.');
      }).length;
      const handoffEventCount = events.filter((event) => {
        const type = String(event.event_type);
        return type.startsWith('handoff.') || type.startsWith('notification.');
      }).length;
      const evidenceSummary = optionalString(task?.evidence_summary);
      const taskStatus = optionalString(task?.terminal_status) || optionalString(task?.status);
      return {
        run_id: runID,
        conversation_id: optionalString(row.conversation_id),
        status: String(row.status || ''),
        terminal_status: optionalString(row.terminal_status),
        terminal_reason: optionalString(row.terminal_reason),
        terminal_event_present: Boolean(terminalEvent),
        terminal_event_type: optionalString(terminalEvent?.event_type),
        task_id: optionalString(task?.id),
        task_status: taskStatus,
        task_evidence_summary: evidenceSummary,
        has_task_evidence: Boolean(evidenceSummary) || optionalString(task?.verification_status) === 'passed',
        tool_run_count: toolRunCount,
        terminal_tool_event_count: terminalToolEventCount,
        memory_event_count: memoryEventCount,
        proactive_event_count: proactiveEventCount,
        handoff_event_count: handoffEventCount,
        recovery_required: events.some((event) => String(event.event_type) === 'run.recovery_required'),
        created_at: optionalString(row.created_at),
        updated_at: optionalString(row.finished_at),
      };
    });
    const executionRuns = items.filter((item) => item.task_id || ['serious_task', 'background_task'].includes(String(this.get(`SELECT resolved_mode FROM runs WHERE id=?`, item.run_id)?.resolved_mode || '')));
    const completedTasksByID = new Map<string, (typeof items)[number]>();
    for (const item of items) {
      if (item.task_status !== 'completed' || !item.task_id) continue;
      const existing = completedTasksByID.get(item.task_id);
      completedTasksByID.set(item.task_id, {
        ...(existing || item),
        has_task_evidence: Boolean(existing?.has_task_evidence || item.has_task_evidence),
      });
    }
    const completedTasks = [...completedTasksByID.values()];
    return {
      items,
      metrics: {
        total_runs: items.length,
        terminal_event_runs: items.filter((item) => item.terminal_event_present).length,
        execution_runs: executionRuns.length,
        execution_runs_with_task_or_refusal: executionRuns.filter((item) => item.task_id || item.terminal_reason?.includes('refusal')).length,
        completed_tasks: completedTasks.length,
        completed_tasks_with_evidence: completedTasks.filter((item) => item.has_task_evidence).length,
        runs_with_tool_evidence: items.filter((item) => item.tool_run_count > 0 || item.terminal_tool_event_count > 0).length,
        runs_with_memory_events: items.filter((item) => item.memory_event_count > 0).length,
        runs_with_proactive_events: items.filter((item) => item.proactive_event_count > 0).length,
        runs_with_handoff_events: items.filter((item) => item.handoff_event_count > 0).length,
        recoverable_runs: items.filter((item) => item.recovery_required).length,
      },
    };
  }

  getExternalHandoffAudit(): ExternalHandoffAudit {
    const requiredTables = ['runs', 'product_tasks', 'task_entry_links', 'channel_identities'];
    const requiredRunColumns = ['entry_channel', 'principal_id', 'metadata'];
    const requiredTaskColumns = ['principal_id', 'source_run_id', 'source_conversation_id'];
    const missingSchema = [
      ...requiredTables.filter((table) => !this.tableExists(table)).map((table) => `table:${table}`),
      ...requiredRunColumns.filter((column) => !this.columnExists('runs', column)).map((column) => `runs.${column}`),
      ...requiredTaskColumns.filter((column) => !this.columnExists('product_tasks', column)).map((column) => `product_tasks.${column}`),
    ];
    const audit: ExternalHandoffAudit = {
      ok: true,
      schema_current: missingSchema.length === 0,
      missing_schema: missingSchema,
      external_channels_seen: [],
      linked_live_handoffs: [],
      pending_external_handoffs: [],
      metrics: {
        external_runs: 0,
        desktop_runs: 0,
        linked_external_desktop_tasks: 0,
      },
      readiness: defaultExternalHandoffReadiness(),
      status: missingSchema.length === 0 ? 'awaiting_external_input' : 'schema_missing',
      next_action: '',
    };
    if (!audit.schema_current) {
      audit.next_action = externalHandoffNextAction(audit.status);
      return audit;
    }

    const rows = this.all(
      `WITH run_tasks AS (
         SELECT r.id AS run_id,
                r.entry_channel,
                r.principal_id,
                r.conversation_id,
                r.status,
                r.terminal_status,
                COALESCE(
                  NULLIF(json_extract(r.metadata, '$.product_task_id'), ''),
                  pt_latest.id,
                  pt_source.id
                ) AS product_task_id,
                r.created_at
         FROM runs r
         LEFT JOIN product_tasks pt_latest ON pt_latest.latest_run_id = r.id
         LEFT JOIN product_tasks pt_source ON pt_source.source_run_id = r.id
         WHERE r.entry_channel IN ('desktop', 'telegram', 'imessage')
       )
       SELECT ext.entry_channel AS external_channel,
              ext.run_id AS external_run_id,
              desktop.run_id AS desktop_run_id,
              ext.product_task_id,
              ext.principal_id,
              ext.conversation_id,
              ext.status AS external_status,
              desktop.status AS desktop_status,
              ext.created_at AS external_created_at,
              desktop.created_at AS desktop_created_at
       FROM run_tasks ext
       JOIN run_tasks desktop ON desktop.product_task_id = ext.product_task_id
       WHERE ext.entry_channel IN ('telegram', 'imessage')
         AND desktop.entry_channel = 'desktop'
         AND COALESCE(ext.product_task_id, '') <> ''
       ORDER BY datetime(ext.created_at) DESC
       LIMIT 20`,
    );
    const pendingRows = this.all(
      `WITH run_tasks AS (
         SELECT r.id AS run_id,
                r.entry_channel,
                r.principal_id,
                r.conversation_id,
                r.status,
                r.terminal_status,
                COALESCE(
                  NULLIF(json_extract(r.metadata, '$.product_task_id'), ''),
                  pt_latest.id,
                  pt_source.id
                ) AS product_task_id,
                r.created_at
         FROM runs r
         LEFT JOIN product_tasks pt_latest ON pt_latest.latest_run_id = r.id
         LEFT JOIN product_tasks pt_source ON pt_source.source_run_id = r.id
         WHERE r.entry_channel IN ('desktop', 'telegram', 'imessage')
       )
       SELECT ext.entry_channel AS external_channel,
              ext.run_id AS external_run_id,
              ext.product_task_id,
              ext.principal_id,
              ext.conversation_id,
              ext.status AS external_status,
              ext.created_at AS external_created_at,
              pt.status AS latest_task_status,
              pt.title AS latest_task_title
       FROM run_tasks ext
       LEFT JOIN product_tasks pt ON pt.id = ext.product_task_id
       WHERE ext.entry_channel IN ('telegram', 'imessage')
         AND COALESCE(ext.product_task_id, '') <> ''
         AND NOT EXISTS (
           SELECT 1
           FROM run_tasks desktop
           WHERE desktop.entry_channel = 'desktop'
             AND desktop.product_task_id = ext.product_task_id
         )
       ORDER BY datetime(ext.created_at) DESC
       LIMIT 20`,
    );
    const externalChannels = this.all(
      `SELECT DISTINCT entry_channel AS channel
       FROM runs
       WHERE entry_channel IN ('telegram', 'imessage')
       ORDER BY channel`,
    ).map((row) => String(row.channel));
    audit.external_channels_seen = externalChannels;
    audit.linked_live_handoffs = rows.map((row) => ({
      external_channel: String(row.external_channel),
      external_run_id: String(row.external_run_id),
      desktop_run_id: String(row.desktop_run_id),
      product_task_id: String(row.product_task_id),
      principal_id: optionalString(row.principal_id),
      conversation_id: optionalString(row.conversation_id),
      external_status: optionalString(row.external_status),
      desktop_status: optionalString(row.desktop_status),
      external_created_at: optionalString(row.external_created_at),
      desktop_created_at: optionalString(row.desktop_created_at),
    }));
    audit.pending_external_handoffs = pendingRows.map((row) => ({
      external_channel: String(row.external_channel),
      external_run_id: String(row.external_run_id),
      product_task_id: String(row.product_task_id),
      principal_id: optionalString(row.principal_id),
      conversation_id: optionalString(row.conversation_id),
      external_status: optionalString(row.external_status),
      external_created_at: optionalString(row.external_created_at),
      latest_task_status: optionalString(row.latest_task_status),
      latest_task_title: optionalString(row.latest_task_title),
    }));
    audit.metrics = {
      external_runs: Number(this.get(`SELECT COUNT(*) AS count FROM runs WHERE entry_channel IN ('telegram', 'imessage')`)?.count || 0),
      desktop_runs: Number(this.get(`SELECT COUNT(*) AS count FROM runs WHERE entry_channel='desktop'`)?.count || 0),
      linked_external_desktop_tasks: audit.linked_live_handoffs.length,
    };
    audit.status = externalHandoffStatus(audit);
    audit.next_action = externalHandoffNextAction(audit.status);
    return audit;
  }

  private linkChannelIdentity(entry: EntryIdentityResolution, conversationID: string): void {
    this.exec(
      `INSERT INTO principals (id, display_name, status, metadata)
       VALUES (?, ?, 'active', ?)
       ON CONFLICT(id) DO UPDATE SET updated_at=datetime('now')`,
      entry.principal_id,
      entry.external_user_id,
      json({ source: 'entry_identity', channel: entry.channel }),
    );
    this.exec(
      `INSERT INTO channel_identities (id, principal_id, channel, external_user_id, external_thread_id, display_name, status, metadata)
       VALUES (?, ?, ?, ?, ?, ?, 'linked', ?)
       ON CONFLICT(channel, external_user_id, external_thread_id) DO UPDATE SET
         principal_id=excluded.principal_id,
         status='linked',
         updated_at=datetime('now')`,
      entry.channel_identity_id,
      entry.principal_id,
      entry.channel,
      entry.external_user_id,
      entry.external_thread_id,
      entry.external_user_id,
      json({ selection_reason: entry.selection_reason }),
    );
    this.exec(
      `INSERT INTO conversation_entry_links (id, principal_id, channel_identity_id, conversation_id, channel,
                                             external_thread_id, selection_reason, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel_identity_id, conversation_id) DO UPDATE SET
         principal_id=excluded.principal_id,
         selection_reason=excluded.selection_reason,
         updated_at=datetime('now')`,
      `cel_${stableShortID(`${entry.channel_identity_id}:${conversationID}`)}`,
      entry.principal_id,
      entry.channel_identity_id,
      conversationID,
      entry.channel,
      entry.external_thread_id,
      entry.selection_reason,
      json({ source: 'store_entry_link' }),
    );
  }

  private linkTaskEntryIfNeeded(entry: EntryIdentityResolution, conversationID: string, productTaskID: string | undefined, reason: string): void {
    if (!productTaskID) return;
    this.exec(
      `UPDATE product_tasks
       SET principal_id=COALESCE(principal_id, ?), updated_at=datetime('now')
       WHERE id=?`,
      entry.principal_id,
      productTaskID,
    );
    this.exec(
      `INSERT INTO task_entry_links (id, principal_id, channel_identity_id, product_task_id,
                                     conversation_id, selection_reason, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel_identity_id, product_task_id) DO UPDATE SET
         principal_id=excluded.principal_id,
         conversation_id=excluded.conversation_id,
         selection_reason=excluded.selection_reason,
         updated_at=datetime('now')`,
      `tel_${stableShortID(`${entry.channel_identity_id}:${productTaskID}`)}`,
      entry.principal_id,
      entry.channel_identity_id,
      productTaskID,
      conversationID,
      reason,
      json({ source: 'store_task_entry_link', channel: entry.channel }),
    );
  }

  private appendCrossEntryHandoffEvent(
    runID: string,
    turnID: string,
    entry: EntryIdentityResolution,
    req: ChatRequest,
    productTaskID: string | undefined,
  ): void {
    const shouldEmit = entry.channel !== 'desktop' || Boolean(req.parent_run_id || req.redirected_from_run_id || productTaskID);
    if (!shouldEmit) return;
    const linked = Boolean(req.parent_run_id || req.redirected_from_run_id || productTaskID);
    this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), linked ? 'handoff.linked' : 'handoff.created', {
      item_type: 'handoff',
      item_id: entry.channel_identity_id,
      principal_id: entry.principal_id,
      channel_identity_id: entry.channel_identity_id,
      channel: entry.channel,
      external_user_id: entry.external_user_id,
      external_thread_id: entry.external_thread_id,
      product_task_id: productTaskID || '',
      parent_run_id: req.parent_run_id || '',
      redirected_from_run_id: req.redirected_from_run_id || '',
      status: 'completed',
      visibility: 'handoff',
      source: 'store',
      summary: linked ? 'Cross-entry context linked.' : 'External entry linked to conversation.',
    });
  }

  getTelegramInboundOffset(): number {
    const row = this.get(`SELECT value FROM desktop_settings WHERE key='telegram.inbound_offset'`);
    const value = Number(row?.value || 0);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  persistTelegramInboundUpdates(updates: TelegramInboundUpdateInput[]): { inserted: number; offset: number } {
    const normalized = updates
      .map((update) => ({ ...update, update_id: Number(update.update_id) }))
      .filter((update) => Number.isSafeInteger(update.update_id) && update.update_id >= 0)
      .sort((left, right) => left.update_id - right.update_id);
    if (normalized.length === 0) {
      return { inserted: 0, offset: this.getTelegramInboundOffset() };
    }
    let inserted = 0;
    let offset = this.getTelegramInboundOffset();
    this.transaction(() => {
      for (const update of normalized) {
        const result = this.db.prepare(
          `INSERT OR IGNORE INTO telegram_inbound_updates (
             update_id, message_id, chat_id, from_id, chat_type, text, status, metadata, received_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'), datetime('now'))`,
        ).run(
          update.update_id,
          String(update.message_id ?? '').trim(),
          String(update.chat_id ?? '').trim(),
          String(update.from_id ?? '').trim(),
          update.chat_type?.trim() || '',
          update.text || '',
          json(update.metadata || {}),
        );
        inserted += Number(result.changes || 0);
      }
      offset = Math.max(offset, normalized[normalized.length - 1].update_id + 1);
      this.exec(
        `INSERT INTO desktop_settings (key, value, updated_at)
         VALUES ('telegram.inbound_offset', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           value=CASE WHEN CAST(desktop_settings.value AS INTEGER) < CAST(excluded.value AS INTEGER)
                      THEN excluded.value ELSE desktop_settings.value END,
           updated_at=datetime('now')`,
        String(offset),
      );
      offset = this.getTelegramInboundOffset();
    });
    return { inserted, offset };
  }

  getTelegramInboundUpdate(updateID: number): TelegramInboundUpdateRecord {
    const row = this.get(`SELECT * FROM telegram_inbound_updates WHERE update_id=?`, updateID);
    if (!row) throw new Error(`telegram inbound update not found: ${updateID}`);
    return rowToTelegramInboundUpdate(row);
  }

  claimTelegramInboundUpdate(options: { now?: string; lease_seconds?: number } = {}): TelegramInboundUpdateRecord | undefined {
    const now = options.now?.trim() || nowIso();
    const leaseSeconds = Math.max(30, Math.min(3_600, Math.floor(options.lease_seconds || 300)));
    const expiredBefore = new Date(Date.parse(now) - leaseSeconds * 1_000).toISOString();
    let claimedID: number | undefined;
    const claimToken = `tgclaim_${newID()}`;
    this.transaction(() => {
      const row = this.get(
        `SELECT update_id
         FROM telegram_inbound_updates
         WHERE status='pending'
            OR (status='processing' AND model_started_at IS NULL
                AND datetime(COALESCE(claimed_at, received_at)) <= datetime(?))
         ORDER BY update_id ASC
         LIMIT 1`,
        expiredBefore,
      );
      if (row?.update_id === undefined || row?.update_id === null) return;
      const updateID = Number(row.update_id);
      const result = this.db.prepare(
        `UPDATE telegram_inbound_updates
         SET status='processing', claim_token=?, claimed_at=?, error_code=NULL, error_message=NULL, updated_at=datetime('now')
         WHERE update_id=?
           AND (status='pending' OR (status='processing' AND model_started_at IS NULL
                AND datetime(COALESCE(claimed_at, received_at)) <= datetime(?)))`,
      ).run(claimToken, now, updateID, expiredBefore);
      if (Number(result.changes || 0) === 1) claimedID = updateID;
    });
    return claimedID === undefined ? undefined : this.getTelegramInboundUpdate(claimedID);
  }

  markTelegramInboundModelStarted(updateID: number): TelegramInboundUpdateRecord {
    this.exec(
      `UPDATE telegram_inbound_updates
       SET status='model_started', model_started_at=COALESCE(model_started_at, datetime('now')), updated_at=datetime('now')
       WHERE update_id=? AND status='processing'`,
      updateID,
    );
    return this.getTelegramInboundUpdate(updateID);
  }

  attachTelegramInboundRun(updateID: number, runID: string): TelegramInboundUpdateRecord {
    const normalizedRunID = runID.trim();
    if (!normalizedRunID) return this.getTelegramInboundUpdate(updateID);
    this.exec(
      `UPDATE telegram_inbound_updates
       SET run_id=?, updated_at=datetime('now')
       WHERE update_id=? AND status IN ('model_started', 'reply_pending', 'reply_sending')`,
      normalizedRunID,
      updateID,
    );
    return this.getTelegramInboundUpdate(updateID);
  }

  markTelegramInboundReplyPending(req: { update_id: number; response_text: string; run_id?: string }): TelegramInboundUpdateRecord {
    const response = req.response_text.trim();
    if (!response) throw new Error('telegram inbound response_text is required');
    this.exec(
      `UPDATE telegram_inbound_updates
       SET status='reply_pending', response_text=?, run_id=COALESCE(NULLIF(?, ''), run_id),
           claim_token=NULL, claimed_at=NULL, error_code=NULL, error_message=NULL, updated_at=datetime('now')
       WHERE update_id=? AND status IN ('processing', 'model_started')`,
      response,
      req.run_id?.trim() || '',
      req.update_id,
    );
    return this.getTelegramInboundUpdate(req.update_id);
  }

  claimTelegramInboundReply(): TelegramInboundUpdateRecord | undefined {
    let claimedID: number | undefined;
    const claimToken = `tgreply_${newID()}`;
    this.transaction(() => {
      const row = this.get(
        `SELECT update_id FROM telegram_inbound_updates
         WHERE status='reply_pending' AND response_text<>''
         ORDER BY update_id ASC LIMIT 1`,
      );
      if (row?.update_id === undefined || row?.update_id === null) return;
      const updateID = Number(row.update_id);
      const result = this.db.prepare(
        `UPDATE telegram_inbound_updates
         SET status='reply_sending', claim_token=?, response_started_at=datetime('now'), updated_at=datetime('now')
         WHERE update_id=? AND status='reply_pending'`,
      ).run(claimToken, updateID);
      if (Number(result.changes || 0) === 1) claimedID = updateID;
    });
    return claimedID === undefined ? undefined : this.getTelegramInboundUpdate(claimedID);
  }

  completeTelegramInboundUpdate(req: { update_id: number; external_delivery_id?: string }): TelegramInboundUpdateRecord {
    this.exec(
      `UPDATE telegram_inbound_updates
       SET status='completed', external_delivery_id=COALESCE(NULLIF(?, ''), external_delivery_id),
           response_sent_at=CASE WHEN response_text<>'' THEN COALESCE(response_sent_at, datetime('now')) ELSE response_sent_at END,
           claim_token=NULL, error_code=NULL, error_message=NULL, updated_at=datetime('now')
       WHERE update_id=? AND status IN ('processing', 'reply_sending')`,
      req.external_delivery_id?.trim() || '',
      req.update_id,
    );
    return this.getTelegramInboundUpdate(req.update_id);
  }

  failTelegramInboundUpdate(req: {
    update_id: number;
    error_code: string;
    error_message: string;
    acceptance_unknown?: boolean;
  }): TelegramInboundUpdateRecord {
    const status = req.acceptance_unknown ? 'reply_ambiguous' : 'failed';
    this.exec(
      `UPDATE telegram_inbound_updates
       SET status=?, error_code=?, error_message=?, claim_token=NULL, updated_at=datetime('now')
       WHERE update_id=? AND status<>'completed'`,
      status,
      req.error_code.trim().slice(0, 80) || 'TELEGRAM_INBOUND_FAILED',
      req.error_message.trim().slice(0, 500) || 'Telegram inbound processing failed.',
      req.update_id,
    );
    return this.getTelegramInboundUpdate(req.update_id);
  }

  private insertPendingOutboundNotification(req: OutboundNotificationEnqueueRequest): boolean {
    const id = req.id.trim();
    const dedupKey = req.dedup_key.trim();
    const channel = req.channel.trim().toLowerCase();
    if (!id || !dedupKey) throw new Error('notification id and dedup_key are required');
    if (channel !== 'telegram') throw new Error(`unsupported outbound notification channel: ${channel || 'empty'}`);
    const runID = req.run_id?.trim() || '';
    const conversationID = req.conversation_id?.trim() || '';
    const productTaskID = req.product_task_id?.trim() || '';
    const proactiveMessageID = req.proactive_message_id?.trim() || '';
    const openLoopID = req.open_loop_id?.trim() || '';
    const target = req.target?.trim() || '';
    const summary = req.summary?.trim().slice(0, 500) || '';
    const maxAttempts = normalizeNotificationMaxAttempts(req.max_attempts);
    const backoffSeconds = normalizeNotificationBackoff(req.backoff_seconds);
    const result = this.db.prepare(
      `INSERT OR IGNORE INTO notification_deliveries (
         id, conversation_id, product_task_id, open_loop_id, proactive_message_id,
         channel, status, deep_link_target, metadata, created_at, updated_at
       ) VALUES (?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''),
                 ?, 'pending', ?, ?, datetime('now'), datetime('now'))`,
    ).run(
      id,
      conversationID,
      productTaskID,
      openLoopID,
      proactiveMessageID,
      channel,
      conversationID ? `joi://conversation/${conversationID}${productTaskID ? `?task=${productTaskID}` : ''}` : '',
      json({
        ...(req.metadata || {}),
        dedup_key: dedupKey,
        run_id: runID,
        target,
        summary,
        attempt_count: 0,
        max_attempts: maxAttempts,
        backoff_seconds: backoffSeconds,
        retryable: false,
        next_attempt_at: '',
        lease_expires_at: '',
        queued_at: nowIso(),
      }),
    );
    const inserted = Number(result.changes || 0) > 0;
    if (inserted && runID && this.get(`SELECT id FROM runs WHERE id=?`, runID)) {
      this.insertRunEvent(runID, '', this.nextRunEventSeq(runID), 'notification.queued', {
        item_type: 'notification_delivery',
        item_id: id,
        notification_id: id,
        proactive_message_id: proactiveMessageID,
        product_task_id: productTaskID,
        channel,
        target,
        status: 'pending',
        max_attempts: maxAttempts,
        visibility: 'handoff',
        source: 'telegram_outbound',
        summary,
      });
    }
    return inserted;
  }

  claimOutboundNotificationDelivery(req: OutboundNotificationEnqueueRequest & { lease_seconds?: number }): { claimed: boolean; status: string; delivery: OutboundNotificationDeliveryRecord } {
    const id = req.id.trim();
    const runID = req.run_id?.trim() || '';
    const productTaskID = req.product_task_id?.trim() || '';
    const proactiveMessageID = req.proactive_message_id?.trim() || '';
    const channel = req.channel.trim().toLowerCase();
    const target = req.target?.trim() || '';
    const summary = req.summary?.trim().slice(0, 500) || '';
    const requestedMaxAttempts = normalizeNotificationMaxAttempts(req.max_attempts);
    const leaseSeconds = Math.max(30, Math.min(900, Math.floor(req.lease_seconds || 120)));
    const claimedAt = nowIso();
    const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1_000).toISOString();
    let claimed = false;
    let retryClaim = false;
    let attemptCount = 1;
    let maxAttempts = requestedMaxAttempts;
    this.transaction(() => {
      this.insertPendingOutboundNotification(req);
      const existing = this.get(`SELECT status, metadata FROM notification_deliveries WHERE id=?`, id);
      const metadata = parseObject(existing?.metadata);
      const previousAttempts = Math.max(0, Number(metadata.attempt_count || 0));
      maxAttempts = normalizeNotificationMaxAttempts(metadata.max_attempts);
      const status = optionalString(existing?.status) || '';
      const nextAttemptAt = optionalString(metadata.next_attempt_at) || '';
      const due = !nextAttemptAt || Date.parse(nextAttemptAt) <= Date.now();
      const expiredLease = status === 'sending'
        && Boolean(optionalString(metadata.lease_expires_at))
        && Date.parse(optionalString(metadata.lease_expires_at) || '') <= Date.now();
      if (expiredLease) {
        this.markOutboundNotificationAcceptanceUnknown(id, {
          error_code: 'TELEGRAM_LEASE_EXPIRED',
          error_message: 'Telegram send lease expired before acceptance could be confirmed; automatic resend is suppressed.',
        });
        return;
      }
      const canClaimPending = status === 'pending';
      const canClaimRetry = status === 'send_failed'
        && (metadata.retryable === true || Number(metadata.retryable) === 1)
        && previousAttempts < maxAttempts
        && due;
      if (!canClaimPending && !canClaimRetry) return;
      attemptCount = previousAttempts + 1;
      retryClaim = canClaimRetry;
      const result = this.db.prepare(
        `UPDATE notification_deliveries
         SET status='sending',
             metadata=json_set(COALESCE(metadata, '{}'),
               '$.attempt_count', ?, '$.claimed_at', ?, '$.lease_expires_at', ?,
               '$.retryable', 0, '$.next_attempt_at', ''),
             updated_at=datetime('now')
         WHERE id=? AND status=?`,
      ).run(attemptCount, claimedAt, leaseExpiresAt, id, status);
      claimed = Number(result.changes || 0) > 0;
      if (!claimed || !runID || !this.get(`SELECT id FROM runs WHERE id=?`, runID)) return;
      this.insertRunEvent(runID, '', this.nextRunEventSeq(runID), retryClaim ? 'notification.retrying' : 'notification.sending', {
        item_type: 'notification_delivery',
        item_id: id,
        notification_id: id,
        proactive_message_id: proactiveMessageID,
        product_task_id: productTaskID,
        channel,
        target,
        status: 'sending',
        attempt_count: attemptCount,
        max_attempts: maxAttempts,
        lease_expires_at: leaseExpiresAt,
        visibility: 'handoff',
        source: 'telegram_outbound',
        summary,
      });
    });
    const delivery = this.getOutboundNotificationDelivery(id);
    return { claimed, status: delivery.status, delivery };
  }

  reclaimExpiredOutboundNotificationLeases(options: { channel?: string; now?: string; limit?: number } = {}): OutboundNotificationDeliveryRecord[] {
    const channel = options.channel?.trim().toLowerCase() || 'telegram';
    const now = options.now?.trim() || nowIso();
    const rows = this.all(
      `SELECT id
       FROM notification_deliveries
       WHERE channel=? AND status='sending'
         AND (
           (COALESCE(json_extract(metadata, '$.lease_expires_at'), '')<>''
            AND datetime(json_extract(metadata, '$.lease_expires_at')) <= datetime(?))
           OR
           (COALESCE(json_extract(metadata, '$.lease_expires_at'), '')=''
            AND datetime(updated_at) <= datetime(?, '-5 minutes'))
         )
       ORDER BY datetime(updated_at) ASC
       LIMIT ?`,
      channel,
      now,
      now,
      clampLimit(options.limit, 100),
    );
    const reclaimed: OutboundNotificationDeliveryRecord[] = [];
    this.transaction(() => {
      for (const row of rows) {
        const id = String(row.id);
        if (this.markOutboundNotificationAcceptanceUnknown(id, {
          error_code: 'TELEGRAM_LEASE_EXPIRED',
          error_message: 'Telegram send lease expired before acceptance could be confirmed; automatic resend is suppressed.',
        })) {
          reclaimed.push(this.getOutboundNotificationDelivery(id));
        }
      }
    });
    return reclaimed;
  }

  private markOutboundNotificationAcceptanceUnknown(
    id: string,
    error: { error_code: string; error_message: string },
  ): boolean {
    const before = this.get(`SELECT proactive_message_id, metadata FROM notification_deliveries WHERE id=?`, id);
    if (!before) return false;
    const metadata = parseObject(before.metadata);
    const runID = optionalString(metadata.run_id) || '';
    const target = optionalString(metadata.target) || '';
    const summary = optionalString(metadata.summary) || '';
    const result = this.db.prepare(
      `UPDATE notification_deliveries
       SET status='acceptance_unknown',
           metadata=json_set(COALESCE(metadata, '{}'),
             '$.failed_at', datetime('now'), '$.error_code', ?, '$.error_message', ?,
             '$.acceptance', 'unknown', '$.retryable', 0, '$.next_attempt_at', '', '$.lease_expires_at', ''),
           updated_at=datetime('now')
       WHERE id=? AND status='sending'`,
    ).run(error.error_code, error.error_message, id);
    if (Number(result.changes || 0) === 0) return false;
    if (runID && this.get(`SELECT id FROM runs WHERE id=?`, runID)) {
      this.insertRunEvent(runID, '', this.nextRunEventSeq(runID), 'notification.delivery_unknown', {
        item_type: 'notification_delivery',
        item_id: id,
        notification_id: id,
        proactive_message_id: optionalString(before.proactive_message_id),
        channel: 'telegram',
        target,
        status: 'acceptance_unknown',
        retryable: false,
        visibility: 'handoff',
        source: 'telegram_outbound',
        error: { code: error.error_code, message: error.error_message },
        summary,
      });
    }
    return true;
  }

  completeOutboundNotificationDelivery(req: {
    id: string;
    run_id?: string;
    proactive_message_id?: string;
    external_delivery_id: string;
    target?: string;
    summary?: string;
  }): OutboundNotificationDeliveryRecord {
    const id = req.id.trim();
    const externalDeliveryID = req.external_delivery_id.trim();
    if (!id || !externalDeliveryID) throw new Error('notification id and external_delivery_id are required');
    const before = this.get(`SELECT proactive_message_id, metadata FROM notification_deliveries WHERE id=?`, id);
    if (!before) throw new Error(`notification delivery not found: ${id}`);
    const beforeMetadata = parseObject(before.metadata);
    const runID = req.run_id?.trim() || optionalString(beforeMetadata.run_id);
    const proactiveMessageID = req.proactive_message_id?.trim() || optionalString(before.proactive_message_id);
    const target = req.target?.trim() || optionalString(beforeMetadata.target) || '';
    const summary = req.summary?.trim().slice(0, 500) || optionalString(beforeMetadata.summary) || '';
    this.transaction(() => {
      const result = this.db.prepare(
        `UPDATE notification_deliveries
         SET status='delivered', external_delivery_id=?, sent_at=COALESCE(sent_at, datetime('now')),
             metadata=json_set(COALESCE(metadata, '{}'),
               '$.target', ?, '$.delivered_at', datetime('now'), '$.external_delivery_id', ?,
               '$.acceptance', 'confirmed', '$.retryable', 0, '$.next_attempt_at', '', '$.lease_expires_at', ''),
             updated_at=datetime('now')
         WHERE id=? AND status='sending'`,
      ).run(externalDeliveryID, target, externalDeliveryID, id);
      if (Number(result.changes || 0) === 0) return;
      if (proactiveMessageID) {
        this.exec(
          `UPDATE proactive_messages
           SET status='delivered', sent_at=COALESCE(sent_at, datetime('now')),
               metadata=json_set(COALESCE(metadata, '{}'), '$.telegram_delivery_id', ?, '$.telegram_delivered_at', datetime('now')),
               updated_at=datetime('now')
           WHERE id=?`,
          externalDeliveryID,
          proactiveMessageID,
        );
      }
      if (!runID || !this.get(`SELECT id FROM runs WHERE id=?`, runID)) return;
      this.insertRunEvent(runID, '', this.nextRunEventSeq(runID), 'notification.sent', {
        item_type: 'notification_delivery',
        item_id: id,
        notification_id: id,
        proactive_message_id: proactiveMessageID,
        channel: 'telegram',
        target,
        external_delivery_id: externalDeliveryID,
        status: 'delivered',
        visibility: 'handoff',
        source: 'telegram_outbound',
        summary,
      });
    });
    return this.getOutboundNotificationDelivery(id);
  }

  failOutboundNotificationDelivery(req: {
    id: string;
    run_id?: string;
    proactive_message_id?: string;
    target?: string;
    error_code: string;
    error_message: string;
    external_delivery_id?: string;
    summary?: string;
    retryable?: boolean;
    acceptance_unknown?: boolean;
  }): OutboundNotificationDeliveryRecord {
    const id = req.id.trim();
    if (!id) throw new Error('notification id is required');
    const before = this.get(`SELECT proactive_message_id, metadata FROM notification_deliveries WHERE id=?`, id);
    if (!before) throw new Error(`notification delivery not found: ${id}`);
    const beforeMetadata = parseObject(before.metadata);
    const runID = req.run_id?.trim() || optionalString(beforeMetadata.run_id);
    const proactiveMessageID = req.proactive_message_id?.trim() || optionalString(before.proactive_message_id);
    const target = req.target?.trim() || optionalString(beforeMetadata.target) || '';
    const errorCode = req.error_code.trim().slice(0, 80) || 'TELEGRAM_SEND_FAILED';
    const errorMessage = req.error_message.trim().slice(0, 500) || 'Telegram outbound delivery failed.';
    const externalDeliveryID = req.external_delivery_id?.trim() || '';
    const summary = req.summary?.trim().slice(0, 500) || optionalString(beforeMetadata.summary) || '';
    const attemptCount = Math.max(1, Number(beforeMetadata.attempt_count || 1));
    const maxAttempts = normalizeNotificationMaxAttempts(beforeMetadata.max_attempts);
    const backoffSeconds = normalizeNotificationBackoff(beforeMetadata.backoff_seconds);
    const acceptanceUnknown = Boolean(req.acceptance_unknown);
    const canRetry = !acceptanceUnknown && Boolean(req.retryable) && attemptCount < maxAttempts;
    const backoff = backoffSeconds[Math.min(Math.max(0, attemptCount - 1), backoffSeconds.length - 1)] || 0;
    const nextAttemptAt = canRetry && backoff > 0 ? new Date(Date.now() + backoff * 1_000).toISOString() : '';
    this.transaction(() => {
      const result = this.db.prepare(
        `UPDATE notification_deliveries
         SET status=?,
             external_delivery_id=COALESCE(NULLIF(?, ''), external_delivery_id),
             metadata=json_set(COALESCE(metadata, '{}'),
               '$.target', ?, '$.failed_at', datetime('now'), '$.error_code', ?, '$.error_message', ?,
               '$.external_delivery_id', ?, '$.acceptance', ?, '$.retryable', ?, '$.next_attempt_at', ?, '$.lease_expires_at', ''),
             updated_at=datetime('now')
         WHERE id=? AND status='sending'`,
      ).run(
        acceptanceUnknown ? 'acceptance_unknown' : 'send_failed',
        externalDeliveryID,
        target,
        errorCode,
        errorMessage,
        externalDeliveryID,
        externalDeliveryID ? 'confirmed' : acceptanceUnknown ? 'unknown' : 'rejected',
        canRetry ? 1 : 0,
        nextAttemptAt,
        id,
      );
      if (Number(result.changes || 0) === 0) return;
      if (proactiveMessageID) {
        this.exec(
          `UPDATE proactive_messages
           SET metadata=json_set(COALESCE(metadata, '{}'),
                 '$.telegram_delivery_error.code', ?, '$.telegram_delivery_error.message', ?, '$.telegram_delivery_error.at', datetime('now')),
               updated_at=datetime('now')
           WHERE id=?`,
          errorCode,
          errorMessage,
          proactiveMessageID,
        );
      }
      if (!runID || !this.get(`SELECT id FROM runs WHERE id=?`, runID)) return;
      this.insertRunEvent(runID, '', this.nextRunEventSeq(runID), acceptanceUnknown ? 'notification.delivery_unknown' : 'notification.failed', {
        item_type: 'notification_delivery',
        item_id: id,
        notification_id: id,
        proactive_message_id: proactiveMessageID,
        channel: 'telegram',
        target,
        status: acceptanceUnknown ? 'acceptance_unknown' : 'send_failed',
        external_delivery_id: externalDeliveryID,
        attempt_count: attemptCount,
        max_attempts: maxAttempts,
        retryable: canRetry,
        next_attempt_at: nextAttemptAt,
        visibility: 'handoff',
        source: 'telegram_outbound',
        error: { code: errorCode, message: errorMessage },
        summary,
      });
    });
    return this.getOutboundNotificationDelivery(id);
  }

  getOutboundNotificationDelivery(id: string): OutboundNotificationDeliveryRecord {
    const row = this.get(
      `SELECT id, channel, status, external_delivery_id, metadata, sent_at, updated_at
       FROM notification_deliveries WHERE id=?`,
      id.trim(),
    );
    if (!row) throw new Error(`notification delivery not found: ${id}`);
    return {
      id: String(row.id),
      channel: optionalString(row.channel) || '',
      status: optionalString(row.status) || '',
      external_delivery_id: optionalString(row.external_delivery_id) || '',
      metadata: parseObject(row.metadata),
      sent_at: optionalString(row.sent_at) || undefined,
      updated_at: optionalString(row.updated_at) || undefined,
    };
  }

  listDueOutboundNotificationRetries(filter: { channel?: string; limit?: number } = {}): OutboundNotificationRetryContext[] {
    const channel = filter.channel?.trim().toLowerCase() || 'telegram';
    const rows = this.all(
      `SELECT id, channel, conversation_id, product_task_id, open_loop_id, proactive_message_id, metadata
       FROM notification_deliveries
       WHERE channel=? AND (
         status='pending'
         OR (
           status='send_failed'
           AND COALESCE(json_extract(metadata, '$.retryable'), 0)=1
           AND CAST(COALESCE(json_extract(metadata, '$.attempt_count'), 0) AS INTEGER)
               < CAST(COALESCE(json_extract(metadata, '$.max_attempts'), 1) AS INTEGER)
           AND (COALESCE(json_extract(metadata, '$.next_attempt_at'), '')=''
                OR datetime(json_extract(metadata, '$.next_attempt_at')) <= datetime('now'))
         )
       )
       ORDER BY datetime(updated_at) ASC
       LIMIT ?`,
      channel,
      clampLimit(filter.limit, 20),
    );
    return rows.map((row) => {
      const metadata = parseObject(row.metadata);
      const payload = isRecord(metadata.delivery_payload) ? metadata.delivery_payload : parseObject(metadata.delivery_payload);
      return {
        id: String(row.id),
        dedup_key: optionalString(metadata.dedup_key) || '',
        channel: optionalString(row.channel) || channel,
        target: optionalString(metadata.target) || '',
        text: optionalString(payload.text) || '',
        disable_link_preview: Boolean(payload.disable_link_preview),
        run_id: optionalString(metadata.run_id) || undefined,
        conversation_id: optionalString(row.conversation_id) || undefined,
        product_task_id: optionalString(row.product_task_id) || undefined,
        open_loop_id: optionalString(row.open_loop_id) || undefined,
        proactive_message_id: optionalString(row.proactive_message_id) || undefined,
        summary: optionalString(metadata.summary) || '',
        metadata,
        max_attempts: normalizeNotificationMaxAttempts(metadata.max_attempts),
        backoff_seconds: normalizeNotificationBackoff(metadata.backoff_seconds),
      };
    }).filter((item) => Boolean(item.dedup_key && item.text));
  }

  getProactiveOutboundContext(id: string): ProactiveOutboundContext {
    const row = this.get(
      `SELECT pm.id, pm.title, pm.body, pm.reason, pm.status, pm.channel, pm.send_after, pm.expires_at,
              pm.metadata, pm.source_open_loop_id, pm.source_product_task_id,
              ol.source_run_id, ol.source_conversation_id
       FROM proactive_messages pm
       LEFT JOIN open_loops ol ON ol.id=pm.source_open_loop_id
       WHERE pm.id=?`,
      id.trim(),
    );
    if (!row) throw new Error(`proactive message not found: ${id}`);
    const metadata = parseObject(row.metadata);
    return {
      id: String(row.id),
      title: optionalString(row.title) || '',
      body: optionalString(row.body) || '',
      reason: optionalString(row.reason) || '',
      status: optionalString(row.status) || '',
      channel: optionalString(row.channel) || 'desktop',
      send_after: optionalString(row.send_after) || undefined,
      expires_at: optionalString(row.expires_at) || undefined,
      metadata,
      run_id: optionalString(row.source_run_id) || optionalString(metadata.run_id) || undefined,
      conversation_id: optionalString(row.source_conversation_id) || optionalString(metadata.conversation_id) || undefined,
      product_task_id: optionalString(row.source_product_task_id) || undefined,
      open_loop_id: optionalString(row.source_open_loop_id) || undefined,
    };
  }

  listProactiveOutboundContexts(filter: { limit?: number } = {}): ProactiveOutboundContext[] {
    const rows = this.all(
      `SELECT id FROM proactive_messages
       WHERE status IN ('authorized', 'scheduled')
         AND (send_after IS NULL OR send_after='' OR datetime(send_after) <= datetime('now'))
         AND (expires_at IS NULL OR expires_at='' OR datetime(expires_at) > datetime('now'))
       ORDER BY score DESC, datetime(updated_at) ASC
       LIMIT ?`,
      clampLimit(filter.limit, 20),
    );
    return rows.map((row) => this.getProactiveOutboundContext(String(row.id)));
  }

  private recordNotificationDeliveryForProactive(proactiveMessageID: string, row: SQLiteRow): void {
    const notificationID = `notif_${stableShortID(`${proactiveMessageID}:${nowIso()}`)}`;
    const conversationID = optionalString(row.source_conversation_id);
    const productTaskID = optionalString(row.source_product_task_id);
    const channel = optionalString(row.channel) || 'desktop';
    if (channel === 'telegram') return;
    this.exec(
      `INSERT INTO notification_deliveries (id, conversation_id, product_task_id, open_loop_id,
                                           proactive_message_id, channel, status, deep_link_target,
                                           metadata, sent_at)
       VALUES (?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, 'delivered', ?, ?, datetime('now'))`,
      notificationID,
      conversationID || '',
      productTaskID || '',
      optionalString(row.source_open_loop_id) || '',
      proactiveMessageID,
      channel,
      conversationID ? `joi://conversation/${conversationID}${productTaskID ? `?task=${productTaskID}` : ''}` : '',
      json({ source: 'proactive_delivery', title: optionalString(row.title) }),
    );
    const runID = optionalString(row.source_run_id);
    if (!runID) return;
    this.insertRunEvent(runID, '', this.nextRunEventSeq(runID), 'notification.sent', {
      item_type: 'handoff',
      item_id: notificationID,
      notification_id: notificationID,
      proactive_message_id: proactiveMessageID,
      source_open_loop_id: optionalString(row.source_open_loop_id),
      product_task_id: productTaskID,
      channel,
      status: 'delivered',
      visibility: 'handoff',
      source: 'store',
      title: optionalString(row.title),
      summary: optionalString(row.body),
    });
  }

  recordNotificationOpened(req: { id?: string; actor?: string; external_delivery_id?: string }): void {
    const id = req.id?.trim() || '';
    const externalDeliveryID = req.external_delivery_id?.trim() || '';
    if (!id && !externalDeliveryID) throw new Error('notification id or external_delivery_id is required');
    const row = this.get(
      `SELECT nd.id, nd.status, nd.channel, nd.conversation_id, nd.product_task_id, nd.open_loop_id,
              nd.proactive_message_id, nd.deep_link_target, nd.external_delivery_id, nd.opened_at,
              pm.title, pm.body, pm.source_product_task_id, pm.source_open_loop_id,
              ol.source_run_id, ol.source_conversation_id
       FROM notification_deliveries nd
       LEFT JOIN proactive_messages pm ON pm.id = nd.proactive_message_id
       LEFT JOIN open_loops ol ON ol.id = COALESCE(nd.open_loop_id, pm.source_open_loop_id)
       WHERE nd.id=? OR (nd.external_delivery_id<>'' AND nd.external_delivery_id=?)
       LIMIT 1`,
      id,
      externalDeliveryID,
    );
    if (!row) throw new Error('notification delivery not found');
    const notificationID = String(row.id);
    const alreadyOpened = Boolean(optionalString(row.opened_at)) || optionalString(row.status) === 'opened';
    this.transaction(() => {
      this.exec(
        `UPDATE notification_deliveries
         SET status=CASE WHEN status IN ('pending', 'sent', 'delivered') THEN 'opened' ELSE status END,
             external_delivery_id=COALESCE(NULLIF(external_delivery_id, ''), NULLIF(?, '')),
             opened_at=COALESCE(opened_at, datetime('now')),
             updated_at=datetime('now')
        WHERE id=?`,
        externalDeliveryID,
        notificationID,
      );
      if (alreadyOpened) return;
      const runID = optionalString(row.source_run_id);
      if (!runID) return;
      const notificationPayload = {
        item_type: 'handoff',
        item_id: notificationID,
        notification_id: notificationID,
        proactive_message_id: optionalString(row.proactive_message_id),
        source_open_loop_id: optionalString(row.open_loop_id) || optionalString(row.source_open_loop_id),
        product_task_id: optionalString(row.product_task_id) || optionalString(row.source_product_task_id),
        conversation_id: optionalString(row.conversation_id) || optionalString(row.source_conversation_id),
        channel: optionalString(row.channel) || 'desktop',
        deep_link_target: optionalString(row.deep_link_target),
        actor: req.actor?.trim() || '',
        status: 'opened',
        visibility: 'handoff',
        source: 'store',
        title: optionalString(row.title),
        summary: optionalString(row.body) || 'Notification opened.',
      };
      this.insertRunEvent(runID, '', this.nextRunEventSeq(runID), 'notification.opened', notificationPayload);
      this.insertRunEvent(runID, '', this.nextRunEventSeq(runID), 'notification.resumed', {
        ...notificationPayload,
        status: 'resumed',
        summary: optionalString(row.deep_link_target) || optionalString(row.body) || 'Notification target resumed.',
      });
    });
  }

  listBackups(): { backups: BackupRecord[] } {
    const backupDir = this.currentBackupDir();
    mkdirSync(backupDir, { recursive: true });
    const backups = readdirSync(backupDir)
      .filter((name) => name.endsWith('.joibak'))
      .map((name) => {
        const path = join(backupDir, name);
        const info = statSync(path);
        return {
          path,
          name,
          size: info.size,
          modified: info.mtime.toISOString(),
          manifest: {
            secrets_policy: 'secrets excluded',
            format: 'zip',
          },
        };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return { backups };
  }

  createBackup(): { path: string } {
    const backupDir = this.currentBackupDir();
    mkdirSync(backupDir, { recursive: true });
    const stamp = timestampForFilename();
    const path = join(backupDir, `joi-backup-${stamp}.joibak`);
    const tempDir = mkdtempSync(join(tmpdir(), 'joi-backup-'));
    try {
      const sqliteCopy = join(tempDir, 'joi.db');
      this.db.exec(`VACUUM INTO ${sqlString(sqliteCopy)}`);
      const manifest = {
        version: '1',
        created_at: new Date().toISOString(),
        includes: ['sqlite/joi.db'],
        secrets_policy: 'secrets are intentionally excluded; reconfigure MODEL_API_KEY, TELEGRAM_BOT_TOKEN, WORKER_TOKEN, NODE_SECRET after restore',
        source: 'electron_ts_store',
      };
      writeZip(path, [
        { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) },
        { name: 'sqlite/joi.db', data: readFileSync(sqliteCopy) },
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
    return { path };
  }

  exportDiagnostics(): { path: string } {
    const dir = join(dirname(this.options.dbPath), 'diagnostics');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `joi-diagnostics-${timestampForFilename()}.zip`);
    const settings = this.getSettings();
    const enhancedRedaction = this.getWorkspaceSettings().diagnostic_redaction_enabled !== false;
    const health = this.systemHealth();
    const entries = [
      ['manifest.json', {
        generated_at: new Date().toISOString(),
        app_version: this.options.version,
        app_mode: 'desktop',
        os: platform(),
        arch: arch(),
        data_directory: dirname(this.options.dbPath),
        sqlite_path: this.options.dbPath,
        secrets_policy: 'redacted; keychain and environment secret values are never exported',
        memory_policy: 'full memory text, prompt text, and model raw responses are redacted',
        diagnostics_v: 'electron_desktop_diagnostics_v1',
        redaction_profile: enhancedRedaction ? 'enhanced' : 'secrets_only',
        docker_required: false,
      }],
      ['settings.json', settings],
      ['sqlite_health.json', { integrity_check: this.get(`PRAGMA integrity_check`)?.integrity_check || 'unknown', driver: 'sqlite' }],
      ['system_health.json', health],
      ['recent_runs.json', this.diagnosticRows(`SELECT id, status, COALESCE(selected_agent_id,'') AS selected_agent_id, COALESCE(selected_node_id,'') AS selected_node_id, started_at, finished_at, COALESCE(error_code,'') AS error_code, COALESCE(error_message,'') AS error_message, metadata FROM runs ORDER BY created_at DESC LIMIT 25`)],
      ['recent_errors.json', this.diagnosticRows(`SELECT 'run' AS source, id, COALESCE(error_code,'') AS error_code, COALESCE(error_message,'') AS error_message, created_at FROM runs WHERE error_code IS NOT NULL OR error_message IS NOT NULL ORDER BY created_at DESC LIMIT 50`)],
      ['worker_status.json', this.listNodes()],
      ['model_provider_status.json', { provider: settings.model_provider, model: settings.model_name, base_url: settings.model_base_url, usage: this.getModelUsage() }],
      ['telegram_status.json', { configured: settings.telegram_enabled, allowed_user_ids_configured: Boolean(settings.telegram_allowed_user_ids?.trim()) }],
      ['imessage_status.json', {
        configured: settings.imessage_enabled,
        project_id_configured: Boolean(settings.imessage_project_id?.trim()),
        assigned_number_configured: Boolean(settings.imessage_assigned_number?.trim()),
        allowed_users_configured: Boolean(settings.imessage_allowed_users?.trim()),
        require_mention: Boolean(settings.imessage_require_mention),
      }],
      ['backup_status.json', this.listBackups()],
      ['last_100_run_steps.json', this.diagnosticRows(`SELECT id, run_id, step_type, title, status, input, output, COALESCE(error,'') AS error, started_at, finished_at, created_at FROM run_steps ORDER BY created_at DESC LIMIT 100`)],
      ['last_100_tool_runs.json', this.diagnosticRows(`SELECT id, COALESCE(run_id,'') AS run_id, COALESCE(task_id,'') AS task_id, capability_id, workflow_name, tool_name, node_id, assignment_reason, risk_level, status, input, output, COALESCE(error,'') AS error, started_at, finished_at, created_at FROM tool_runs ORDER BY created_at DESC LIMIT 100`)],
      ['last_100_model_calls.json', this.diagnosticRows(`SELECT id, COALESCE(run_id,'') AS run_id, COALESCE(agent_id,'') AS agent_id, COALESCE(provider,'') AS provider, COALESCE(model_name,'') AS model_name, COALESCE(prompt_cache_key,'') AS prompt_cache_key, COALESCE(prefix_hash,'') AS prefix_hash, COALESCE(dynamic_tail_hash,'') AS dynamic_tail_hash, COALESCE(input_tokens,0) AS input_tokens, COALESCE(output_tokens,0) AS output_tokens, COALESCE(cached_input_tokens,0) AS cached_input_tokens, COALESCE(cache_write_input_tokens,0) AS cache_write_input_tokens, COALESCE(reasoning_tokens,0) AS reasoning_tokens, COALESCE(total_tokens,0) AS total_tokens, COALESCE(cost_estimate,0) AS cost_estimate, COALESCE(latency_ms,0) AS latency_ms, COALESCE(usage_status,'') AS usage_status, COALESCE(finish_reason,'') AS finish_reason, status, COALESCE(error_code,'') AS error_code, COALESCE(error_message,'') AS error_message, metadata, created_at FROM model_calls ORDER BY created_at DESC LIMIT 100`)],
    ] satisfies Array<[string, unknown]>;
    writeZip(path, entries.map(([name, payload]) => ({
      name,
      data: Buffer.from(JSON.stringify(sanitizeDiagnosticValue(payload, enhancedRedaction), null, 2)),
    })));
    return { path };
  }

  exportPersonaMessengerData(req: PersonaMessengerExportRequest = {}): PersonaMessengerExportResult {
    const filters: PersonaMessengerExportRequest = {
      project_id: req.project_id?.trim() || undefined,
      persona_id: req.persona_id?.trim() || undefined,
      room_id: req.room_id?.trim() || undefined,
      thread_id: req.thread_id?.trim() || undefined,
      trace_run_id: req.trace_run_id?.trim() || undefined,
      since: req.since?.trim() || undefined,
      until: req.until?.trim() || undefined,
      include_messages: req.include_messages !== false,
      include_trace: req.include_trace !== false,
    };
    const projectIDs = new Set<string>();
    const personaIDs = new Set<string>();
    const roomIDs = new Set<string>();
    const threadIDs = new Set<string>();
    const runIDs = new Set<string>();
    if (filters.project_id) projectIDs.add(filters.project_id);
    if (filters.persona_id) personaIDs.add(filters.persona_id);
    if (filters.room_id) roomIDs.add(filters.room_id);
    if (filters.thread_id) threadIDs.add(filters.thread_id);
    if (filters.trace_run_id) runIDs.add(filters.trace_run_id);

    const addPersonaScope = (personaID: string) => {
      const persona = this.get(`SELECT id, project_id FROM personas WHERE id=?`, personaID);
      if (!persona) return;
      personaIDs.add(String(persona.id));
      if (persona.project_id) projectIDs.add(String(persona.project_id));
    };
    const addRoomScope = (roomID: string) => {
      const room = this.get(`SELECT id, project_id, persona_id FROM rooms WHERE id=?`, roomID);
      if (!room) return;
      roomIDs.add(String(room.id));
      if (room.project_id) projectIDs.add(String(room.project_id));
      if (room.persona_id) addPersonaScope(String(room.persona_id));
      for (const member of this.all(`SELECT persona_id, project_id FROM room_members WHERE room_id=? AND member_type='persona'`, roomID)) {
        if (member.persona_id) addPersonaScope(String(member.persona_id));
        if (member.project_id) projectIDs.add(String(member.project_id));
      }
    };
    const addThreadScope = (threadID: string) => {
      const thread = this.get(`SELECT * FROM messenger_threads WHERE id=?`, threadID);
      if (!thread) return;
      threadIDs.add(String(thread.id));
      if (thread.project_id) projectIDs.add(String(thread.project_id));
      if (thread.room_id) addRoomScope(String(thread.room_id));
      if (thread.owner_persona_id) addPersonaScope(String(thread.owner_persona_id));
      for (const personaID of parseArray(thread.collaborator_persona_ids).map(String)) addPersonaScope(personaID);
      for (const runID of parseArray(thread.run_ids).map(String)) runIDs.add(runID);
    };
    if (filters.persona_id) addPersonaScope(filters.persona_id);
    if (filters.room_id) addRoomScope(filters.room_id);
    if (filters.thread_id) addThreadScope(filters.thread_id);

    if (projectIDs.size > 0) {
      for (const row of this.all(`SELECT id FROM personas WHERE project_id IN (${placeholders(projectIDs.size)})`, ...[...projectIDs])) {
        personaIDs.add(String(row.id));
      }
      for (const row of this.all(`SELECT id FROM rooms WHERE project_id IN (${placeholders(projectIDs.size)})`, ...[...projectIDs])) {
        roomIDs.add(String(row.id));
      }
      for (const row of this.all(`SELECT id FROM messenger_threads WHERE project_id IN (${placeholders(projectIDs.size)})`, ...[...projectIDs])) {
        threadIDs.add(String(row.id));
      }
    }
    for (const threadID of [...threadIDs]) addThreadScope(threadID);

    const scoped = projectIDs.size > 0 || personaIDs.size > 0 || roomIDs.size > 0 || threadIDs.size > 0 || runIDs.size > 0;
    const rowsForScope = (table: string, where: string[], params: SQLiteValue[], order = 'created_at DESC'): Record<string, unknown>[] => {
      const clauses = where.length > 0 ? where : ['1=1'];
      const timeColumn = table === 'projects' || table === 'personas' || table === 'rooms' || table === 'messenger_threads' ? 'updated_at' : 'created_at';
      if (filters.since) {
        clauses.push(`datetime(${timeColumn}) >= datetime(?)`);
        params.push(filters.since);
      }
      if (filters.until) {
        clauses.push(`datetime(${timeColumn}) <= datetime(?)`);
        params.push(filters.until);
      }
      return this.all(`SELECT * FROM ${table} WHERE ${clauses.join(' AND ')} ORDER BY ${order}`, ...params)
        .map((row) => sanitizePersonaExportValue(row) as Record<string, unknown>);
    };
    const whereIDs = (column: string, ids: Set<string>): [string[], SQLiteValue[]] => ids.size > 0
      ? [[`${column} IN (${placeholders(ids.size)})`], [...ids]]
      : scoped
        ? [['1=0'], []]
        : [['1=1'], []];
    const [projectWhere, projectParams] = whereIDs('id', projectIDs);
    const [personaWhere, personaParams] = whereIDs('id', personaIDs);
    const [roomWhere, roomParams] = whereIDs('id', roomIDs);
    const [threadWhere, threadParams] = whereIDs('id', threadIDs);

    const conversationIDs = new Set(
      (roomIDs.size > 0
        ? this.all(`SELECT conversation_id FROM rooms WHERE id IN (${placeholders(roomIDs.size)})`, ...[...roomIDs])
        : scoped
          ? []
          : this.all(`SELECT conversation_id FROM rooms WHERE conversation_id IS NOT NULL`))
        .map((row) => optionalString(row.conversation_id))
        .filter((id): id is string => Boolean(id)),
    );
    if (filters.include_trace) {
      for (const row of conversationIDs.size > 0
        ? this.all(`SELECT id FROM runs WHERE conversation_id IN (${placeholders(conversationIDs.size)})`, ...[...conversationIDs])
        : scoped
          ? []
          : this.all(`SELECT id FROM runs ORDER BY datetime(created_at) DESC LIMIT 500`)) {
        runIDs.add(String(row.id));
      }
    }

    const messages = filters.include_messages && conversationIDs.size > 0
      ? rowsForScope('messages', [`conversation_id IN (${placeholders(conversationIDs.size)})`], [...conversationIDs])
      : [];
    const runWhere: [string[], SQLiteValue[]] = runIDs.size > 0
      ? [[`id IN (${placeholders(runIDs.size)})`], [...runIDs]]
      : scoped
        ? [['1=0'], []]
        : [['1=1'], []];
    const artifactWhere: [string[], SQLiteValue[]] = runIDs.size > 0
      ? [[`source_run_id IN (${placeholders(runIDs.size)})`], [...runIDs]]
      : conversationIDs.size > 0
        ? [[`source_conversation_id IN (${placeholders(conversationIDs.size)})`], [...conversationIDs]]
        : scoped
          ? [['1=0'], []]
          : [['1=1'], []];
    const routeWhere: [string[], SQLiteValue[]] = roomIDs.size > 0
      ? [[`room_id IN (${placeholders(roomIDs.size)})`], [...roomIDs]]
      : runIDs.size > 0
        ? [[`run_id IN (${placeholders(runIDs.size)})`], [...runIDs]]
        : scoped
          ? [['1=0'], []]
          : [['1=1'], []];

    const data: Record<string, unknown[]> = {
      projects: rowsForScope('projects', projectWhere, projectParams),
      personas: rowsForScope('personas', personaWhere, personaParams),
      rooms: rowsForScope('rooms', roomWhere, roomParams),
      room_members: roomIDs.size > 0
        ? rowsForScope('room_members', [`room_id IN (${placeholders(roomIDs.size)})`], [...roomIDs])
        : scoped ? [] : rowsForScope('room_members', ['1=1'], []),
      threads: rowsForScope('messenger_threads', threadWhere, threadParams, 'updated_at DESC'),
      thread_events: threadIDs.size > 0
        ? rowsForScope('messenger_thread_events', [`thread_id IN (${placeholders(threadIDs.size)})`], [...threadIDs])
        : scoped ? [] : rowsForScope('messenger_thread_events', ['1=1'], []),
      routing_decisions: rowsForScope('routing_decisions', routeWhere[0], routeWhere[1]),
      external_connector_events: roomIDs.size > 0
        ? rowsForScope('external_connector_events', [`room_id IN (${placeholders(roomIDs.size)})`], [...roomIDs])
        : scoped ? [] : rowsForScope('external_connector_events', ['1=1'], []),
      messages,
      artifacts: rowsForScope('artifacts', artifactWhere[0], artifactWhere[1]),
    };
    if (filters.include_trace) {
      data.runs = rowsForScope('runs', runWhere[0], runWhere[1]);
      data.run_events = runIDs.size > 0 ? rowsForScope('run_events', [`run_id IN (${placeholders(runIDs.size)})`], [...runIDs]) : [];
      data.run_steps = runIDs.size > 0 ? rowsForScope('run_steps', [`run_id IN (${placeholders(runIDs.size)})`], [...runIDs]) : [];
      data.model_calls = runIDs.size > 0 ? rowsForScope('model_calls', [`run_id IN (${placeholders(runIDs.size)})`], [...runIDs]) : [];
      data.tool_runs = runIDs.size > 0 ? rowsForScope('tool_runs', [`run_id IN (${placeholders(runIDs.size)})`], [...runIDs]) : [];
    }
    const rowCounts = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.length]));
    const manifest = {
      generated_at: nowIso(),
      filters,
      row_counts: rowCounts,
      secrets_policy: 'message text is included with secret-pattern redaction; raw model responses, prompts, tokens and secret-like fields are redacted',
    };
    const payload = { manifest, data };
    const dir = join(dirname(this.options.dbPath), 'exports');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `joi-persona-messenger-export-${timestampForFilename()}-${newID()}.json`);
    writeFileSync(path, JSON.stringify(payload, null, 2));
    return { path, manifest };
  }

  getWorkspaceSettings(): WorkspaceSettings {
    const settings = this.desktopSettings();
    return normalizeWorkspaceSettings({
      allowed_roots: parseStringSetting(settings['workspace.allowed_roots'], [defaultWorkspaceRoot()]),
      default_root: settings['workspace.default_root'] || defaultWorkspaceRoot(),
      browser_allowed_hosts: parseStringSetting(settings['browser.allowed_hosts'], []),
      web_research_allow_private_hosts: settings['web_research.allow_private_hosts'] === 'true',
      web_search_provider: settings['web_search.provider'] || 'auto',
      file_analyze_max_bytes: Number(settings['file_analyze.max_bytes'] || 256 * 1024),
      workspace_search_max_results: Number(settings['workspace_search.max_results'] || 50),
      browser_enabled: settings['browser.enabled'] !== 'false',
      github_default_repo: settings['github.default_repo'] || '',
      github_api_base_url: settings['github.api_base_url'] || 'https://api.github.com',
      node_assignment_policy: settings['nodes.assignment_policy'] || 'main_first',
      allow_remote_execution: settings['nodes.allow_remote_execution'] === 'true',
      privacy_local_only: settings['privacy.local_only'] !== 'false',
      remote_execution_requires_confirmation: settings['privacy.remote_confirmation'] !== 'false',
      diagnostic_redaction_enabled: settings['privacy.diagnostic_redaction'] !== 'false',
      destructive_operations_disabled: settings['privacy.destructive_disabled'] !== 'false',
      desktop_notifications_enabled: settings['entry.desktop_notifications.enabled'] !== 'false',
      desktop_notification_sound: settings['entry.desktop_notifications.sound'] === 'true',
      cli_enabled: settings['entry.cli.enabled'] === 'true',
      cli_socket_path: settings['entry.cli.socket_path'] || join(homedir(), 'Library', 'Application Support', 'Joi', 'joi.sock'),
      webhook_chat_enabled: settings['entry.webhook.enabled'] === 'true',
      webhook_chat_path: settings['entry.webhook.path'] || '/chat/webhook',
      wechat_claw_enabled: settings['entry.wechat_claw.enabled'] === 'true',
      wechat_claw_endpoint: settings['entry.wechat_claw.endpoint'] || '',
      wechat_claw_allowed_senders: parseStringSetting(settings['entry.wechat_claw.allowed_senders'], []),
      speech_voice: settings['speech.voice'] || 'Ting-Ting',
      speech_rate: Number(settings['speech.rate'] || 185),
      speech_transcription_model: settings['speech.transcription_model'] || 'small',
      speech_transcription_language: settings['speech.transcription_language'] || 'zh',
    });
  }

  saveWorkspaceSettings(req: WorkspaceSettings): void {
    const settings = normalizeWorkspaceSettings(req);
    this.setDesktopSettings({
      'workspace.allowed_roots': json(settings.allowed_roots),
      'workspace.default_root': settings.default_root,
      'browser.allowed_hosts': json(settings.browser_allowed_hosts),
      'web_research.allow_private_hosts': boolString(settings.web_research_allow_private_hosts),
      'web_search.provider': normalizeWebSearchProvider(settings.web_search_provider),
      'file_analyze.max_bytes': String(settings.file_analyze_max_bytes),
      'workspace_search.max_results': String(settings.workspace_search_max_results),
      'browser.enabled': boolString(settings.browser_enabled !== false),
      'github.default_repo': settings.github_default_repo || '',
      'github.api_base_url': settings.github_api_base_url || 'https://api.github.com',
      'nodes.assignment_policy': settings.node_assignment_policy || 'main_first',
      'nodes.allow_remote_execution': boolString(Boolean(settings.allow_remote_execution)),
      'privacy.local_only': boolString(settings.privacy_local_only !== false),
      'privacy.remote_confirmation': boolString(settings.remote_execution_requires_confirmation !== false),
      'privacy.diagnostic_redaction': boolString(settings.diagnostic_redaction_enabled !== false),
      'privacy.destructive_disabled': boolString(settings.destructive_operations_disabled !== false),
      'entry.desktop_notifications.enabled': boolString(settings.desktop_notifications_enabled !== false),
      'entry.desktop_notifications.sound': boolString(Boolean(settings.desktop_notification_sound)),
      'entry.cli.enabled': boolString(Boolean(settings.cli_enabled)),
      'entry.cli.socket_path': settings.cli_socket_path || '',
      'entry.webhook.enabled': boolString(Boolean(settings.webhook_chat_enabled)),
      'entry.webhook.path': settings.webhook_chat_path || '/chat/webhook',
      'entry.wechat_claw.enabled': boolString(Boolean(settings.wechat_claw_enabled)),
      'entry.wechat_claw.endpoint': settings.wechat_claw_endpoint || '',
      'entry.wechat_claw.allowed_senders': json(settings.wechat_claw_allowed_senders || []),
      'speech.voice': settings.speech_voice || 'Ting-Ting',
      'speech.rate': String(settings.speech_rate || 185),
      'speech.transcription_model': settings.speech_transcription_model || 'small',
      'speech.transcription_language': settings.speech_transcription_language || 'zh',
    });
  }

  saveModelConfig(req: ModelConfigRequest): void {
    const provider = req.provider?.trim() || 'openai_compatible';
    const pluginProvider = this.getEnabledPluginProvider(provider);
    const baseURL = pluginProvider ? '' : req.base_url?.trim() || 'https://api.deepseek.com/v1';
    const modelName = req.name?.trim() || pluginProvider?.default_model || 'deepseek-v4-flash';
    this.setDesktopSettings({
      'model.provider': provider,
      'model.base_url': baseURL,
      'model.name': modelName,
      'model.reasoning_name': req.reasoning_name?.trim() || '',
      'model.reasoning_effort': normalizeReasoningEffort(req.reasoning_effort),
      'model.timeout_seconds': String(req.timeout_seconds && req.timeout_seconds > 0 ? req.timeout_seconds : 60),
      'model.max_retries': String(req.max_retries && req.max_retries >= 0 ? req.max_retries : 1),
    });
    this.upsertModel({
      provider,
      base_url: baseURL,
      model_id: modelName,
      display_name: modelName,
      enabled: true,
      temperature: 0.7,
      timeout_seconds: req.timeout_seconds && req.timeout_seconds > 0 ? req.timeout_seconds : 60,
      max_retries: req.max_retries && req.max_retries >= 0 ? req.max_retries : 1,
      supports_json_mode: true,
      supports_tool_calling: false,
      supports_reasoning: Boolean(req.reasoning_name?.trim()),
    });
    this.replaceMissingPersonaModelStrategies(modelName);
  }

  private replaceMissingPersonaModelStrategies(fallbackModelName: string): void {
    const cleanFallback = fallbackModelName.trim();
    if (!cleanFallback) return;
    this.exec(
      `UPDATE personas
       SET model_strategy = ?, updated_at = datetime('now')
       WHERE TRIM(COALESCE(model_strategy, '')) != ''
         AND model_strategy NOT LIKE '使用%模型%'
         AND NOT EXISTS (
           SELECT 1 FROM models
           WHERE models.model_name = personas.model_strategy
             AND COALESCE(models.enabled, 1) != 0
         )`,
      cleanFallback,
    );
  }

  saveModelSettings(req: ModelSettingsRequest): void {
    this.upsertModel(req);
    this.setDesktopSettings({
      'model.provider': req.provider,
      'model.base_url': req.base_url,
      'model.name': req.model_id,
      'model.timeout_seconds': String(req.timeout_seconds),
      'model.max_retries': String(req.max_retries),
    });
  }

  saveOperationalSettings(req: {
    telegram_enabled?: boolean;
    telegram_allowed_user_ids?: string;
    imessage_enabled?: boolean;
    imessage_allowed_users?: string;
    imessage_require_mention?: boolean;
    imessage_home_channel?: string;
    worker_gateway_enabled?: boolean;
    backup_dir?: string;
    auto_backup_enabled?: boolean;
  }): void {
    const values: Record<string, string> = {};
    if (req.telegram_enabled !== undefined) values['telegram.enabled'] = boolString(Boolean(req.telegram_enabled));
    if (req.telegram_allowed_user_ids !== undefined) values['telegram.allowed_user_ids'] = req.telegram_allowed_user_ids.trim();
    if (req.imessage_enabled !== undefined) values['imessage.enabled'] = boolString(Boolean(req.imessage_enabled));
    if (req.imessage_allowed_users !== undefined) values['imessage.allowed_users'] = req.imessage_allowed_users.trim();
    if (req.imessage_require_mention !== undefined) values['imessage.require_mention'] = boolString(Boolean(req.imessage_require_mention));
    if (req.imessage_home_channel !== undefined) values['imessage.home_channel'] = req.imessage_home_channel.trim();
    if (req.worker_gateway_enabled !== undefined) values['worker_gateway.enabled'] = boolString(Boolean(req.worker_gateway_enabled));
    if (req.auto_backup_enabled !== undefined) values['backup.auto_enabled'] = boolString(Boolean(req.auto_backup_enabled));
    if (req.backup_dir?.trim()) {
      values['backup.dir'] = resolve(req.backup_dir.trim());
    }
    this.setDesktopSettings(values);
  }

  saveIMessageSettings(req: {
    enabled?: boolean;
    project_id?: string;
    phone_number?: string;
    assigned_number?: string;
    home_channel?: string;
    allowed_users?: string;
    require_mention?: boolean;
    sidecar_port?: number;
  }): void {
    const values: Record<string, string> = {
      'imessage.enabled': boolString(Boolean(req.enabled)),
      'imessage.photon_project_id': req.project_id?.trim() || '',
      'imessage.operator_phone': req.phone_number?.trim() || '',
      'imessage.assigned_number': req.assigned_number?.trim() || '',
      'imessage.home_channel': req.home_channel?.trim() || req.phone_number?.trim() || '',
      'imessage.allowed_users': req.allowed_users?.trim() || req.phone_number?.trim() || '',
      'imessage.require_mention': boolString(Boolean(req.require_mention)),
    };
    if (req.sidecar_port && req.sidecar_port > 0) {
      values['imessage.sidecar_port'] = String(Math.trunc(req.sidecar_port));
    }
    this.setDesktopSettings(values);
  }

  completeOnboarding(): void {
    this.setDesktopSettings({ 'onboarding.completed': 'true' });
  }

  getOnboardingStatus(secretStatus: Record<string, boolean> = {}): OnboardingStatus {
    const settings = this.getSettings();
    const backups = this.listBackups().backups;
    const completed = this.desktopSettings()['onboarding.completed'] === 'true';
    const modelConfigured = Boolean(secretStatus.MODEL_API_KEY || settings.model_name);
    const telegramConfigured = Boolean(secretStatus.TELEGRAM_BOT_TOKEN);
    const workerConfigured = Boolean(secretStatus.WORKER_TOKEN);
    const missing: string[] = [];
    if (!modelConfigured) missing.push('model');
    if (backups.length === 0) missing.push('backup');
    return {
      required: !completed,
      completed,
      model_configured: modelConfigured,
      telegram_configured: telegramConfigured,
      worker_configured: workerConfigured,
      first_backup_created: backups.length > 0,
      backup_count: backups.length,
      missing,
    };
  }

  restoreBackup(backupPath: string): void {
    const cleanPath = backupPath.trim();
    if (!cleanPath) throw new Error('backup path is required');
    const entries = readZipEntries(readFileSync(cleanPath));
    const sqlite = entries.get('sqlite/joi.db');
    if (!sqlite) throw new Error('backup does not contain sqlite/joi.db');
    const restoreDir = mkdtempSync(join(tmpdir(), 'joi-restore-'));
    const restoredPath = join(restoreDir, 'joi.db');
    const replacementPath = `${this.options.dbPath}.restore-${Date.now()}`;
    try {
      writeFileSync(restoredPath, sqlite);
      const check = new DatabaseSync(restoredPath, { readOnly: true });
      try {
        const integrity = check.prepare(`PRAGMA integrity_check`).get() as SQLiteRow | undefined;
        if (String(integrity?.integrity_check || '') !== 'ok') {
          throw new Error(`restored sqlite integrity check failed: ${String(integrity?.integrity_check || 'unknown')}`);
        }
      } finally {
        check.close();
      }
      writeFileSync(replacementPath, sqlite);
      this.db.close();
      renameSync(replacementPath, this.options.dbPath);
      this.db = new DatabaseSync(this.options.dbPath);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      this.db.exec(this.options.schemaSql);
      this.ensureConversationClosureSchema();
      this.ensureAdvancedAgentSchema();
      this.seedDefaults();
      this.classifyRecoverableRunsOnStartup();
    } catch (error) {
      rmSync(replacementPath, { force: true });
      try {
        this.db.prepare('SELECT 1').get();
      } catch {
        this.db = new DatabaseSync(this.options.dbPath);
        this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      }
      throw error;
    } finally {
      rmSync(restoreDir, { recursive: true, force: true });
    }
  }

  private ensureProductTaskForRun(req: ChatRequest, context: {
    conversation_id: string;
    user_message_id: string;
    run_id: string;
    turn_id?: string;
    mode_resolution_id?: string;
    mode_resolution?: ModeResolutionRecord;
    message: string;
  }): ProductTask | undefined {
    const mode = context.mode_resolution?.resolved_mode || effectiveInputMode(req, context.message);
    const principalID = req.principal_id?.trim()
      || optionalString(this.get(`SELECT principal_id FROM conversations WHERE id=?`, context.conversation_id)?.principal_id)
      || entryIdentityForRequest(req, context.conversation_id).principal_id;
    const explicitTaskID = req.product_task_id?.trim();
    const inferredTaskID = explicitTaskID || this.resolveContinuationProductTaskID(principalID, context.message);
    if (!inferredTaskID && !shouldCreateProductTask(req, context.message, mode)) return undefined;
    const contract = buildTaskContract(req, context.message, mode);
    const stepIDs = {
      understand: `pstep_${newID()}`,
      execute: `pstep_${newID()}`,
      verify: `pstep_${newID()}`,
    };
    const metadataBase = {
      task_contract: contract,
      task_os_version: 'task_os_v1',
      effective_input_mode: mode,
      mode_resolution: context.mode_resolution,
      checkpoints: [{ run_id: context.run_id, status: 'running', at: nowIso() }],
      verification: pendingTaskVerification('Task is running.'),
    };

    const taskID = inferredTaskID || `ptask_${newID()}`;
    const existing = inferredTaskID ? this.get(
      `SELECT metadata FROM product_tasks WHERE id=?`,
      inferredTaskID,
    ) : undefined;

    if (inferredTaskID && existing) {
      const metadata = { ...parseObject(existing.metadata), ...metadataBase };
      this.exec(
        `UPDATE product_tasks
         SET latest_run_id=?, source_run_id=?, source_turn_id=NULLIF(?, ''), mode_resolution_id=NULLIF(?, ''),
             principal_id=COALESCE(product_tasks.principal_id, ?), status='running', mode=?, risk_level=?, progress_percent=MAX(progress_percent, 10),
             summary=?, verification_status='pending', last_projected_at=datetime('now'), metadata=?, updated_at=datetime('now')
         WHERE id=?`,
        context.run_id,
        context.run_id,
        context.turn_id || '',
        context.mode_resolution_id || '',
        principalID,
        mode,
        contract.risk_level,
        contract.objective,
        json(metadata),
        inferredTaskID,
      );
      this.insertRunStep(context.run_id, 'product_task_attached', 'Product task attached', {}, { product_task_id: inferredTaskID, contract });
    } else {
      this.exec(
        `INSERT INTO product_tasks (id, principal_id, title, description, status, mode, priority, created_from_conversation_id,
                                    created_from_message_id, latest_run_id, owner_user_id, source_channel,
                                    risk_level, progress_percent, current_step_id, summary, source_conversation_id,
                                    source_run_id, source_turn_id, mode_resolution_id, verification_status,
                                    last_projected_at, metadata)
         VALUES (?, ?, ?, ?, 'running', ?, 'normal', ?, ?, ?, ?, ?, ?, 10, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), 'pending',
                 datetime('now'), ?)`,
        taskID,
        principalID,
        titleFromMessage(context.message),
        contract.objective,
        mode,
        context.conversation_id,
        context.user_message_id,
        context.run_id,
        req.user_id || 'desktop_user',
        req.channel || 'desktop',
        contract.risk_level,
        stepIDs.execute,
        contract.objective,
        context.conversation_id,
        context.run_id,
        context.turn_id || '',
        context.mode_resolution_id || '',
        json(metadataBase),
      );
      this.exec(
        `INSERT INTO product_task_steps (id, product_task_id, title, description, status, sort_order, run_id, summary, input, output, started_at, finished_at)
         VALUES (?, ?, '理解目标', ?, 'done', 1, ?, '已建立任务契约。', ?, ?, datetime('now'), datetime('now'))`,
        stepIDs.understand,
        taskID,
        contract.objective,
        context.run_id,
        json({ message: context.message }),
        json({ task_contract: contract }),
      );
      this.exec(
        `INSERT INTO product_task_steps (id, product_task_id, title, description, status, sort_order, run_id, summary, input, output, started_at)
         VALUES (?, ?, '执行任务', '调用必要工具并产出交付物。', 'running', 2, ?, '执行中。', '{}', '{}', datetime('now'))`,
        stepIDs.execute,
        taskID,
        context.run_id,
      );
      this.exec(
        `INSERT INTO product_task_steps (id, product_task_id, title, description, status, sort_order, run_id, summary, input, output)
         VALUES (?, ?, '验证结果', '完成前检查交付物和证据。', 'pending', 3, ?, '等待执行完成。', '{}', '{}')`,
        stepIDs.verify,
        taskID,
        context.run_id,
      );
      this.insertRunStep(context.run_id, 'product_task_created', 'Product task created', {}, { product_task_id: taskID, contract, step_count: 3 });
      this.insertRunEvent(context.run_id, context.turn_id || '', this.nextRunEventSeq(context.run_id), 'task.created', {
        item_type: 'task',
        item_id: taskID,
        task_id: taskID,
        title: titleFromMessage(context.message),
        status: 'running',
        visibility: 'task',
        source: 'store',
        contract,
      });
    }

    this.exec(
      `UPDATE runs
       SET metadata=json_set(COALESCE(metadata, '{}'), '$.product_task_id', ?, '$.effective_input_mode', ?, '$.task_contract', json(?))
       WHERE id=?`,
      taskID,
      mode,
      json(contract),
      context.run_id,
    );

    const row = this.get(
      `SELECT id, principal_id, title, description, status, mode, priority, created_from_conversation_id,
              created_from_message_id, latest_run_id, owner_user_id, source_channel, risk_level,
              progress_percent, current_step_id, summary, source_conversation_id, source_run_id,
              source_turn_id, mode_resolution_id, terminal_status, terminal_reason, evidence_summary,
              verification_status, last_projected_at, metadata, created_at, updated_at, completed_at
       FROM product_tasks
       WHERE id=?`,
      taskID,
    );
    return row ? rowToProductTask(row) : undefined;
  }

  private resolveContinuationProductTaskID(principalID: string, message: string): string {
    if (!principalID || !isTaskContinuationIntent(message)) return '';
    const row = this.get(
      `SELECT id FROM (
         SELECT pt.id, pt.status, pt.updated_at
         FROM product_tasks pt
         WHERE pt.principal_id=?
         UNION
         SELECT pt.id, pt.status, pt.updated_at
         FROM task_entry_links tel
         JOIN product_tasks pt ON pt.id=tel.product_task_id
         WHERE tel.principal_id=?
       )
       ORDER BY
         CASE
           WHEN status IN ('planning', 'running', 'waiting_confirmation', 'paused', 'verifying', 'blocked') THEN 0
           ELSE 1
         END,
         datetime(updated_at) DESC,
         id DESC
       LIMIT 1`,
      principalID,
      principalID,
    );
    return optionalString(row?.id) || '';
  }

  private recordProductTaskToolCheckpoint(productTaskID: string | undefined, detail: {
    run_id: string;
    capability: string;
    requested_action: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    status: string;
    tool_run_id?: string;
    operation_id?: string;
  }): string | undefined {
    if (!productTaskID) return undefined;
    const stepID = `pstep_${newID()}`;
    const finished = ['done', 'failed', 'blocked', 'waiting_confirmation'].includes(detail.status);
    const persistedCapabilityID = this.registeredCapabilityID(detail.capability);
    this.exec(
      `INSERT INTO product_task_steps (id, product_task_id, title, description, status, sort_order, capability_id,
                                      run_id, tool_run_id, summary, input, output, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM product_task_steps WHERE product_task_id=?), 10),
               NULLIF(?, ''), ?, NULLIF(?, ''), ?, ?, ?, datetime('now'), CASE WHEN ? THEN datetime('now') ELSE NULL END)`,
      stepID,
      productTaskID,
      titleForTaskCapability(detail.capability),
      detail.requested_action,
      detail.status,
      productTaskID,
      persistedCapabilityID,
      detail.run_id,
      detail.tool_run_id || '',
      summaryForToolOutput(detail.output, detail.status),
      json({ ...detail.input, operation_id: detail.operation_id || '' }),
      json(detail.output),
      finished ? 1 : 0,
    );
    this.exec(
      `UPDATE product_tasks
       SET current_step_id=?, status=CASE WHEN ?='waiting_confirmation' THEN 'waiting_confirmation' ELSE status END,
           progress_percent=CASE WHEN ?='waiting_confirmation' THEN MAX(progress_percent, 45) ELSE MAX(progress_percent, 35) END,
           updated_at=datetime('now'),
           metadata=json_set(COALESCE(metadata, '{}'), '$.last_checkpoint', json(?))
       WHERE id=?`,
      stepID,
      detail.status,
      detail.status,
      json({
        run_id: detail.run_id,
        capability: detail.capability,
        status: detail.status,
        operation_id: detail.operation_id || '',
        at: nowIso(),
      }),
      productTaskID,
    );
    return stepID;
  }

  private finalizeProductTaskAfterRun(productTaskID: string | undefined, context: {
    run_id: string;
    conversation_id: string;
    message_id: string;
    response: string;
    waiting_confirmation: boolean;
    tool_results: PersistedToolResult[];
    runtime_status?: string;
  }): ArtifactSummary[] {
    if (!productTaskID) return [];
    if (context.waiting_confirmation) {
      this.exec(
        `UPDATE product_tasks
         SET status='waiting_confirmation', progress_percent=MAX(progress_percent, 45),
             verification_status='pending', last_projected_at=datetime('now'),
             metadata=json_set(COALESCE(metadata, '{}'), '$.verification', json(?)),
             updated_at=datetime('now')
         WHERE id=?`,
        json(pendingTaskVerification('Waiting for user approval before verification.')),
        productTaskID,
      );
      return [];
    }

    this.insertRunStep(context.run_id, 'task_verification_started', 'Task verification started', {}, { product_task_id: productTaskID });
    const artifact = this.createTaskArtifact(productTaskID, context);
    this.createBackgroundTaskFollowup(productTaskID, context);
    const taskMetadata = parseObject(this.get(`SELECT metadata FROM product_tasks WHERE id=?`, productTaskID)?.metadata);
    const verification = verifyTaskCompletion(
      context.response,
      artifact,
      context.tool_results,
      taskContractFromMetadata(taskMetadata),
      context.runtime_status || 'completed',
    );
    const taskStatus = verification.status === 'passed' ? 'completed' : 'blocked';
    const progress = verification.status === 'passed' ? 100 : 85;
    const evidenceSummary = evidenceSummaryForTask(artifact, context.tool_results, verification);
    this.exec(
      `UPDATE product_task_steps
       SET status='done', summary='执行完成。', finished_at=COALESCE(finished_at, datetime('now')), updated_at=datetime('now')
       WHERE product_task_id=? AND status='running'`,
      productTaskID,
    );
    if (artifact?.id) {
      this.exec(
        `UPDATE artifacts
         SET metadata=json_set(COALESCE(metadata, '{}'), '$.verification', json(?), '$.verification_status', ?),
             updated_at=datetime('now')
         WHERE id=?`,
        json(verification),
        verification.status,
        artifact.id,
      );
    }
    this.exec(
      `UPDATE product_task_steps
       SET status=?, summary=?, output=?, finished_at=datetime('now'), updated_at=datetime('now')
       WHERE product_task_id=? AND title='验证结果'`,
      verification.status === 'passed' ? 'done' : 'blocked',
      verification.summary,
      json(verification),
      productTaskID,
    );
    this.exec(
      `UPDATE product_tasks
       SET status=?, progress_percent=?, summary=?, terminal_status=?, terminal_reason=?, evidence_summary=?,
           verification_status=?, last_projected_at=datetime('now'),
           metadata=json_set(COALESCE(metadata, '{}'), '$.verification', json(?), '$.evidence_summary', ?),
           completed_at=CASE WHEN ?='completed' THEN datetime('now') ELSE completed_at END,
           updated_at=datetime('now')
       WHERE id=?`,
      taskStatus,
      progress,
      context.response.slice(0, 500),
      taskStatus,
      verification.summary,
      evidenceSummary,
      verification.status,
      json(verification),
      evidenceSummary,
      taskStatus,
      productTaskID,
    );
    this.insertRunStep(context.run_id, 'task_verification_finished', 'Task verification finished', {}, { product_task_id: productTaskID, verification }, verification.status === 'passed' ? 'succeeded' : 'blocked');
    this.insertRunEvent(context.run_id, '', this.nextRunEventSeq(context.run_id), verification.status === 'passed' ? 'verification.completed' : 'verification.failed', {
      item_type: 'artifact',
      item_id: artifact?.id || productTaskID,
      task_id: productTaskID,
      artifact_id: artifact?.id,
      status: verification.status === 'passed' ? 'completed' : 'failed',
      visibility: 'artifact',
      source: 'store',
      summary: verification.summary,
      verification,
    });
    this.insertRunEvent(context.run_id, '', this.nextRunEventSeq(context.run_id), verification.status === 'passed' ? 'task.completed' : 'task.blocked', {
      item_type: 'task',
      item_id: productTaskID,
      task_id: productTaskID,
      status: verification.status === 'passed' ? 'completed' : 'blocked',
      visibility: 'task',
      source: 'store',
      terminal: true,
      evidence_summary: evidenceSummary,
      terminal_reason: verification.summary,
    });
    this.attachMessengerThreadArtifacts(context.run_id, productTaskID, artifact?.id ? [artifact.id] : []);
    return artifact ? [artifact] : [];
  }

  private createTaskArtifact(productTaskID: string, context: {
    run_id: string;
    conversation_id: string;
    message_id: string;
    response: string;
    tool_results: PersistedToolResult[];
  }): ArtifactSummary | undefined {
    const existing = this.get(
      `SELECT id, type, title, content_format, source_product_task_id, source_run_id,
              source_conversation_id, source_message_id, version, status, metadata, created_at, updated_at
       FROM artifacts
       WHERE source_product_task_id=? AND source_run_id=?
       ORDER BY datetime(created_at) DESC
       LIMIT 1`,
      productTaskID,
      context.run_id,
    );
    if (existing) return rowToArtifactSummary(existing);
    const artifactID = `art_${newID()}`;
    const task = this.get(`SELECT title FROM product_tasks WHERE id=?`, productTaskID);
    const title = optionalString(task?.title) || 'Joi task result';
    const content = taskArtifactContent(context.response, context.tool_results);
    const metadata = {
      verification_required: true,
      source: 'task_os_v1',
      tool_result_count: context.tool_results.length,
      content_hash: hashText(content),
    };
    this.exec(
      `INSERT INTO artifacts (id, type, title, content, content_format, source_product_task_id,
                             source_run_id, source_conversation_id, source_message_id, linked_memory_ids, metadata)
       VALUES (?, 'report', ?, ?, 'markdown', ?, ?, ?, ?, '[]', ?)`,
      artifactID,
      title,
      content,
      productTaskID,
      context.run_id,
      context.conversation_id,
      context.message_id,
      json(metadata),
    );
    this.exec(
      `INSERT INTO product_task_deliverables (id, product_task_id, artifact_id, type, title, sort_order)
       VALUES (?, ?, ?, 'report', ?, COALESCE((SELECT MAX(sort_order) + 1 FROM product_task_deliverables WHERE product_task_id=?), 1))`,
      `deliverable_${newID()}`,
      productTaskID,
      artifactID,
      title,
      productTaskID,
    );
    this.insertRunStep(context.run_id, 'artifact_created', 'Artifact created', {}, { artifact_id: artifactID, product_task_id: productTaskID, type: 'report', title });
    this.insertRunEvent(context.run_id, '', this.nextRunEventSeq(context.run_id), 'artifact.created', {
      item_type: 'artifact',
      item_id: artifactID,
      artifact_id: artifactID,
      task_id: productTaskID,
      status: 'completed',
      visibility: 'artifact',
      source: 'store',
      title,
      artifact_type: 'report',
      summary: 'Task result artifact created.',
    });
    const row = this.get(
      `SELECT id, type, title, content_format, source_product_task_id, source_run_id,
              source_conversation_id, source_message_id, version, status, metadata, created_at, updated_at
       FROM artifacts
       WHERE id=?`,
      artifactID,
    );
    return row ? rowToArtifactSummary(row) : undefined;
  }

  private createBackgroundTaskFollowup(productTaskID: string, context: {
    run_id: string;
    conversation_id: string;
    response: string;
  }): void {
    const task = this.get(`SELECT title, mode FROM product_tasks WHERE id=?`, productTaskID);
    if (optionalString(task?.mode) !== 'background_task') return;
    const existing = this.get(
      `SELECT id FROM open_loops WHERE source_product_task_id=? AND source_run_id=? LIMIT 1`,
      productTaskID,
      context.run_id,
    );
    if (existing) return;
    const openLoopID = `oloop_${newID()}`;
    const taskTitle = optionalString(task?.title) || 'Background task';
    const suggestedFollowup = context.response.slice(0, 240) || `Review background task ${taskTitle}.`;
    this.exec(
      `INSERT INTO open_loops (id, topic, description, status, source_conversation_id, source_run_id,
                               source_product_task_id, suggested_followup, priority, metadata)
       VALUES (?, ?, ?, 'open', ?, ?, ?, ?, 'normal', ?)`,
      openLoopID,
      taskTitle,
      'Background task follow-up generated after task completion.',
      context.conversation_id,
      context.run_id,
      productTaskID,
      suggestedFollowup,
      json({ source: 'task_os_v1', mode: 'background_task' }),
    );
    const proactiveMessageID = `pmsg_${newID()}`;
    this.exec(
      `INSERT INTO proactive_messages (id, type, title, body, reason, source_memory_ids, source_open_loop_id,
                                       source_product_task_id, score, status, channel, metadata)
       VALUES (?, 'followup', ?, ?, 'background_task_completed', '[]', ?, ?, 0.78, 'draft', 'desktop', ?)`,
      proactiveMessageID,
      `Review ${taskTitle}`,
      suggestedFollowup,
      openLoopID,
      productTaskID,
      json({ source: 'task_os_v1', run_id: context.run_id }),
    );
    this.insertRunStep(context.run_id, 'open_loop_created', 'Open loop created', {}, { open_loop_id: openLoopID, product_task_id: productTaskID });
    this.insertRunStep(context.run_id, 'proactive_candidate_created', 'Proactive candidate created', {}, { source_open_loop_id: openLoopID, product_task_id: productTaskID, status: 'draft' });
    this.insertRunEvent(context.run_id, '', this.nextRunEventSeq(context.run_id), 'open_loop.created', {
      item_type: 'open_loop',
      item_id: openLoopID,
      open_loop_id: openLoopID,
      product_task_id: productTaskID,
      status: 'open',
      visibility: 'proactive',
      source: 'store',
      title: taskTitle,
      summary: suggestedFollowup,
    });
    this.insertRunEvent(context.run_id, '', this.nextRunEventSeq(context.run_id), 'proactive.candidate_created', {
      item_type: 'proactive',
      item_id: proactiveMessageID,
      proactive_message_id: proactiveMessageID,
      source_open_loop_id: openLoopID,
      product_task_id: productTaskID,
      status: 'draft',
      visibility: 'proactive',
      source: 'store',
      title: `Review ${taskTitle}`,
      summary: suggestedFollowup,
    });
  }

  private markProductTaskFailed(productTaskID: string | undefined, runID: string, error: Error, status: 'failed' | 'cancelled'): void {
    if (!productTaskID) return;
    const taskStatus = status === 'cancelled' ? 'paused' : 'blocked';
    const verification = failedTaskVerification(error.message);
    const terminalStatus = status === 'cancelled' ? 'cancelled' : 'blocked';
    this.exec(
      `UPDATE product_tasks
       SET status=?, summary=?, terminal_status=?, terminal_reason=?, evidence_summary=?,
           verification_status='failed', last_projected_at=datetime('now'),
           metadata=json_set(COALESCE(metadata, '{}'), '$.verification', json(?), '$.last_error', ?, '$.terminal_status', ?),
           updated_at=datetime('now')
       WHERE id=?`,
      taskStatus,
      error.message,
      terminalStatus,
      error.message,
      `runtime_error:${error.message.slice(0, 180)}`,
      json(verification),
      error.message,
      terminalStatus,
      productTaskID,
    );
    this.exec(
      `UPDATE product_task_steps
       SET status=CASE WHEN status='running' THEN ? ELSE status END,
           error=CASE WHEN status='running' THEN ? ELSE error END,
           finished_at=CASE WHEN status='running' THEN datetime('now') ELSE finished_at END,
           updated_at=datetime('now')
       WHERE product_task_id=?`,
      taskStatus === 'paused' ? 'blocked' : 'failed',
      json({ run_id: runID, error: error.message }),
      productTaskID,
    );
    this.insertRunEvent(runID, '', this.nextRunEventSeq(runID), status === 'cancelled' ? 'task.cancelled' : 'task.blocked', {
      item_type: 'task',
      item_id: productTaskID,
      task_id: productTaskID,
      status: terminalStatus,
      visibility: 'task',
      source: 'store',
      terminal: true,
      terminal_reason: error.message,
      evidence_summary: `runtime_error:${error.message.slice(0, 180)}`,
    });
  }

  listProductTasks(filter: { status?: string; limit?: number; conversation_id?: string; principal_id?: string; channel?: string } = {}): { tasks: ProductTask[] } {
    const limit = clampLimit(filter.limit, 50);
    const status = filter.status?.trim();
    const where = [productTaskVisiblePredicate('product_tasks.created_from_conversation_id')];
    const params: SQLiteValue[] = [];
    if (status === 'active') {
      where.push(`status IN ('planning','running','waiting_confirmation','paused','verifying','blocked')`);
    } else if (status) {
      where.push('status = ?');
      params.push(status);
    }
    const conversationID = filter.conversation_id?.trim();
    if (conversationID) {
      where.push('(created_from_conversation_id = ? OR source_conversation_id = ?)');
      params.push(conversationID, conversationID);
    }
    const principalID = filter.principal_id?.trim();
    if (principalID) {
      where.push(`(principal_id = ? OR id IN (
        SELECT product_task_id FROM task_entry_links WHERE principal_id = ?
      ))`);
      params.push(principalID, principalID);
    }
    const channel = filter.channel?.trim();
    if (channel) {
      where.push(`(source_channel = ? OR id IN (
        SELECT tel.product_task_id
        FROM task_entry_links tel
        JOIN channel_identities ci ON ci.id = tel.channel_identity_id
        WHERE ci.channel = ?
      ))`);
      params.push(channel, channel);
    }
    const rows = this.all(
      `SELECT id, principal_id, title, description, status, mode, priority, created_from_conversation_id,
              created_from_message_id, latest_run_id, owner_user_id, source_channel, risk_level,
              progress_percent, current_step_id, summary, source_conversation_id, source_run_id,
              source_turn_id, mode_resolution_id, terminal_status, terminal_reason, evidence_summary,
              verification_status, last_projected_at, metadata, created_at, updated_at, completed_at
       FROM product_tasks
       WHERE ${where.join(' AND ')}
       ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
       LIMIT ?`,
      ...params,
      limit,
    );
    return { tasks: rows.map(rowToProductTask) };
  }

  closeProductTask(req: { id?: string; outcome?: string; reason?: string; actor?: string; run_id?: string }): ProductTaskDetail {
    const taskID = req.id?.trim() || '';
    if (!taskID) throw new Error('product_task id is required');
    const task = this.get(
      `SELECT id, latest_run_id, source_run_id, source_turn_id, status, progress_percent, evidence_summary, verification_status
       FROM product_tasks
       WHERE id=?`,
      taskID,
    );
    if (!task) throw new Error(`Product task not found: ${taskID}`);
    const outcome = normalizeProductTaskCloseOutcome(req.outcome);
    const reason = req.reason?.trim() || 'closed manually by user';
    const evidenceSummary = optionalString(task.evidence_summary) || `manual_close:${reason.slice(0, 180)}`;
    const eventType = productTaskTerminalEventType(outcome);
    const progress = outcome === 'completed' ? 100 : Number(task.progress_percent ?? 0);
    this.transaction(() => {
      this.exec(
        `UPDATE product_tasks
         SET status=?,
             terminal_status=?,
             terminal_reason=?,
             evidence_summary=?,
             verification_status=CASE
               WHEN ?='completed' THEN COALESCE(NULLIF(verification_status, ''), 'manual')
               ELSE verification_status
             END,
             progress_percent=?,
             completed_at=datetime('now'),
             updated_at=datetime('now'),
             metadata=json_set(COALESCE(metadata, '{}'),
               '$.manual_close.reason', ?,
               '$.manual_close.actor', ?,
               '$.manual_close.outcome', ?,
               '$.manual_close.closed_at', datetime('now'))
         WHERE id=?`,
        outcome,
        outcome,
        reason,
        evidenceSummary,
        outcome,
        progress,
        reason,
        req.actor?.trim() || '',
        outcome,
        taskID,
      );
      const runID = req.run_id?.trim() || optionalString(task.latest_run_id) || optionalString(task.source_run_id);
      if (runID) {
        this.insertRunEvent(runID, optionalString(task.source_turn_id) || '', this.nextRunEventSeq(runID), eventType, {
          item_type: 'task',
          item_id: taskID,
          product_task_id: taskID,
          status: outcome,
          terminal: true,
          terminal_reason: reason,
          evidence_summary: evidenceSummary,
          manual: true,
          actor: req.actor?.trim() || '',
          visibility: 'task',
          source: 'store',
          summary: reason,
        });
      }
    });
    return this.getProductTask(taskID);
  }

  reopenProductTask(req: { id?: string; reason?: string; actor?: string; run_id?: string }): ProductTaskDetail {
    const taskID = req.id?.trim() || '';
    if (!taskID) throw new Error('product_task id is required');
    const task = this.get(
      `SELECT id, latest_run_id, source_run_id, source_turn_id, status, progress_percent
       FROM product_tasks
       WHERE id=?`,
      taskID,
    );
    if (!task) throw new Error(`Product task not found: ${taskID}`);
    const reason = req.reason?.trim() || 'reopened manually by user';
    this.transaction(() => {
      this.exec(
        `UPDATE product_tasks
         SET status='planning',
             terminal_status=NULL,
             terminal_reason=NULL,
             completed_at=NULL,
             progress_percent=CASE WHEN progress_percent >= 100 THEN 90 ELSE progress_percent END,
             updated_at=datetime('now'),
             metadata=json_set(COALESCE(metadata, '{}'),
               '$.manual_reopen.reason', ?,
               '$.manual_reopen.actor', ?,
               '$.manual_reopen.reopened_at', datetime('now'))
         WHERE id=?`,
        reason,
        req.actor?.trim() || '',
        taskID,
      );
      const runID = req.run_id?.trim() || optionalString(task.latest_run_id) || optionalString(task.source_run_id);
      if (runID) {
        this.insertRunEvent(runID, optionalString(task.source_turn_id) || '', this.nextRunEventSeq(runID), 'task.planned', {
          item_type: 'task',
          item_id: taskID,
          product_task_id: taskID,
          status: 'planning',
          phase: 'reopened',
          reopened: true,
          reason,
          actor: req.actor?.trim() || '',
          visibility: 'task',
          source: 'store',
          summary: reason,
        });
      }
    });
    return this.getProductTask(taskID);
  }

  getProductTask(id: string): ProductTaskDetail {
    const taskID = id.trim();
    if (!taskID) throw new Error('product_task id is required');
    const task = this.get(
      `SELECT id, principal_id, title, description, status, mode, priority, created_from_conversation_id,
              created_from_message_id, latest_run_id, owner_user_id, source_channel, risk_level,
              progress_percent, current_step_id, summary, source_conversation_id, source_run_id,
              source_turn_id, mode_resolution_id, terminal_status, terminal_reason, evidence_summary,
              verification_status, last_projected_at, metadata, created_at, updated_at, completed_at
       FROM product_tasks
       WHERE id = ?`,
      taskID,
    );
    if (!task) throw new Error(`Product task not found: ${taskID}`);
    const steps = this.all(
      `SELECT id, product_task_id, title, description, status, sort_order, capability_id,
              tool_workflow_id, run_id, tool_run_id, worker_task_id, summary, input, output,
              error, started_at, finished_at, created_at, updated_at
       FROM product_task_steps
       WHERE product_task_id = ?
       ORDER BY sort_order ASC, datetime(created_at) ASC`,
      taskID,
    ).map(rowToProductTaskStep);
    return {
      task: rowToProductTask(task),
      steps,
      deliverables: this.listArtifacts({ product_task_id: taskID, limit: 100 }).artifacts,
    };
  }

  listArtifacts(filter: { product_task_id?: string; type?: string; limit?: number } = {}): { artifacts: ArtifactSummary[] } {
    const limit = clampLimit(filter.limit, 50);
    const where = [
      artifactConversationVisiblePredicate('artifacts.source_conversation_id'),
      productTaskVisibleViaTaskPredicate('artifacts.source_product_task_id'),
    ];
    const params: SQLiteValue[] = [];
    if (filter.product_task_id?.trim()) {
      where.push('source_product_task_id = ?');
      params.push(filter.product_task_id.trim());
    }
    if (filter.type?.trim()) {
      where.push('type = ?');
      params.push(filter.type.trim());
    }
    const rows = this.all(
      `SELECT id, type, title, content_format, source_product_task_id, source_run_id,
              source_conversation_id, source_message_id, version, status, metadata, created_at, updated_at
       FROM artifacts
       WHERE ${where.join(' AND ')}
       ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
       LIMIT ?`,
      ...params,
      limit,
    );
    return { artifacts: rows.map(rowToArtifactSummary) };
  }

  getArtifact(id: string): ArtifactDetail {
    const artifactID = id.trim();
    if (!artifactID) throw new Error('artifact id is required');
    const row = this.get(
      `SELECT id, type, title, content, content_format, source_product_task_id, source_run_id,
              source_conversation_id, source_message_id, linked_memory_ids, version, status,
              metadata, created_at, updated_at
       FROM artifacts
       WHERE id = ?`,
      artifactID,
    );
    if (!row) throw new Error(`Artifact not found: ${artifactID}`);
    return rowToArtifactDetail(row);
  }

  listOpenLoops(filter: { status?: string; limit?: number } = {}): { open_loops: OpenLoop[] } {
    this.classifyExpiredOpenLoops();
    const status = filter.status?.trim() || 'open';
    const rows = this.all(
      `SELECT id, topic, description, status, source_conversation_id, source_run_id,
              source_product_task_id, suggested_followup, priority, due_at, metadata,
              created_at, updated_at, closed_at
       FROM open_loops
       WHERE status = ?
         AND ${artifactConversationVisiblePredicate('open_loops.source_conversation_id')}
         AND ${productTaskVisibleViaTaskPredicate('open_loops.source_product_task_id')}
       ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
       LIMIT ?`,
      status,
      clampLimit(filter.limit, 50),
    );
    return { open_loops: rows.map(rowToOpenLoop) };
  }

  decideOpenLoop(req: { id?: string; action?: string; feedback?: string; due_at?: string }): void {
    const id = req.id?.trim();
    const action = req.action?.trim();
    if (!id || !action) throw new Error('id and action are required');
    let status = '';
    let closed = false;
    let dueAt = req.due_at?.trim() || '';
    switch (action) {
      case 'close':
      case 'done':
        status = 'closed';
        closed = true;
        break;
      case 'snooze':
        status = 'snoozed';
        break;
      case 'schedule':
        status = 'scheduled';
        break;
      case 'expire':
        status = 'expired';
        closed = true;
        break;
      case 'cancel':
        status = 'cancelled';
        closed = true;
        break;
      default:
        throw new Error(`unsupported open loop action: ${action}`);
    }
    this.transaction(() => {
      this.exec(
        `UPDATE open_loops
         SET status=?, due_at=COALESCE(NULLIF(?, ''), due_at),
             metadata=json_set(COALESCE(metadata, '{}'), '$.last_action', ?, '$.last_feedback', ?, '$.last_decided_at', datetime('now')),
             closed_at=CASE WHEN ? THEN datetime('now') ELSE closed_at END,
             updated_at=datetime('now')
         WHERE id=?`,
        status,
        dueAt,
        action,
        req.feedback || '',
        closed ? 1 : 0,
        id,
      );
      const row = this.get(
        `SELECT id, topic, suggested_followup, source_run_id, source_product_task_id
         FROM open_loops
         WHERE id=?`,
        id,
      );
      const runID = optionalString(row?.source_run_id);
      if (runID) {
        this.insertRunEvent(runID, '', this.nextRunEventSeq(runID), `open_loop.${status}`, {
          item_type: 'open_loop',
          item_id: id,
          open_loop_id: id,
          product_task_id: optionalString(row?.source_product_task_id),
          status,
          visibility: 'proactive',
          source: 'store',
          title: optionalString(row?.topic),
          summary: req.feedback || optionalString(row?.suggested_followup),
          due_at: dueAt,
          action,
        });
      }
    });
  }

  private classifyExpiredOpenLoops(): number {
    const rows = this.all(
      `SELECT id, topic, suggested_followup, source_run_id, source_product_task_id, due_at
       FROM open_loops
       WHERE status IN ('open', 'scheduled', 'snoozed', 'delivered', 'awaiting_response')
         AND due_at IS NOT NULL
         AND due_at <> ''
         AND datetime(due_at) <= datetime('now')`,
    );
    if (rows.length === 0) return 0;
    this.transaction(() => {
      for (const row of rows) {
        const openLoopID = String(row.id);
        this.exec(
          `UPDATE open_loops
           SET status='expired',
               closed_at=COALESCE(closed_at, datetime('now')),
               metadata=json_set(COALESCE(metadata, '{}'),
                 '$.expiry.classified_at', datetime('now'),
                 '$.expiry.reason', 'due_at elapsed',
                 '$.expiry.previous_due_at', COALESCE(due_at, '')),
               updated_at=datetime('now')
           WHERE id=? AND status <> 'expired'`,
          openLoopID,
        );
        this.exec(
          `UPDATE proactive_messages
           SET status='expired',
               metadata=json_set(COALESCE(metadata, '{}'),
                 '$.expiry.source', 'open_loop_expired',
                 '$.expiry.classified_at', datetime('now')),
               updated_at=datetime('now')
           WHERE source_open_loop_id=?
             AND status IN ('draft', 'needs_authorization', 'authorized', 'scheduled')`,
          openLoopID,
        );
        const runID = optionalString(row.source_run_id);
        if (!runID) continue;
        this.insertRunEvent(runID, '', this.nextRunEventSeq(runID), 'open_loop.expired', {
          item_type: 'open_loop',
          item_id: openLoopID,
          open_loop_id: openLoopID,
          product_task_id: optionalString(row.source_product_task_id),
          status: 'expired',
          terminal: true,
          visibility: 'proactive',
          source: 'store',
          title: optionalString(row.topic),
          summary: optionalString(row.suggested_followup) || 'Open loop expired.',
          due_at: optionalString(row.due_at),
          reason: 'due_at elapsed',
        });
      }
    });
    return rows.length;
  }

  listProactiveMessages(filter: { status?: string; limit?: number } = {}): { messages: ProactiveMessage[] } {
    this.classifyExpiredOpenLoops();
    const status = filter.status?.trim() || 'draft';
    const rows = this.all(
      `SELECT id, type, title, body, reason, source_memory_ids, source_open_loop_id,
              source_product_task_id, score, status, channel, send_after, expires_at,
              feedback, metadata, created_at, updated_at, sent_at
       FROM proactive_messages
       WHERE status = ?
         AND ${productTaskVisibleViaTaskPredicate('proactive_messages.source_product_task_id')}
         AND NOT EXISTS (
           SELECT 1
           FROM open_loops ol
           JOIN conversations c ON c.id = ol.source_conversation_id
           WHERE ol.id = proactive_messages.source_open_loop_id
             AND COALESCE(c.lifecycle_status, 'active') IN ('archived','trashed','purged')
         )
       ORDER BY score DESC, datetime(updated_at) DESC, datetime(created_at) DESC
       LIMIT ?`,
      status,
      clampLimit(filter.limit, 50),
    );
    return { messages: rows.map(rowToProactiveMessage) };
  }

  decideProactiveMessage(req: { id?: string; action?: string; feedback?: string }): void {
    const id = req.id?.trim();
    const action = req.action?.trim();
    if (!id || !action) throw new Error('id and action are required');
    let status = '';
    let feedback = req.feedback?.trim() || '';
    switch (action) {
      case 'send':
      case 'approve':
        status = 'authorized';
        break;
      case 'queue':
        status = 'scheduled';
        break;
      case 'sent':
        status = 'delivered';
        break;
      case 'dismiss':
      case 'ignore':
        status = 'dismissed';
        break;
      case 'suppress':
      case 'never_again':
        status = 'suppressed';
        break;
      case 'useful':
      case 'annoying':
      case 'inaccurate':
        status = 'responded';
        feedback ||= action;
        break;
      default:
        throw new Error(`unsupported proactive action: ${action}`);
    }
    this.transaction(() => {
      const before = this.get(
        `SELECT id, source_open_loop_id, source_product_task_id, score
         FROM proactive_messages
         WHERE id=?`,
        id,
      );
      const negativeFeedback = isNegativeProactiveFeedbackAction(action);
      const scorePenalty = negativeFeedback ? proactiveFeedbackScorePenalty(action) : 0;
      let negativeFeedbackCount = 0;
      if (negativeFeedback && before) {
        negativeFeedbackCount = Number(this.get(
          `SELECT COUNT(*) AS count
           FROM proactive_feedback pf
           JOIN proactive_messages pm ON pm.id = pf.proactive_message_id
           WHERE pf.action IN ('dismiss', 'ignore', 'annoying', 'inaccurate')
             AND (
               (COALESCE(?, '') <> '' AND pm.source_open_loop_id = ?)
               OR (COALESCE(?, '') <> '' AND pm.source_product_task_id = ?)
               OR pm.id = ?
             )`,
          optionalString(before.source_open_loop_id) || '',
          optionalString(before.source_open_loop_id) || '',
          optionalString(before.source_product_task_id) || '',
          optionalString(before.source_product_task_id) || '',
          id,
        )?.count || 0) + 1;
        if (negativeFeedbackCount >= 3) {
          status = 'suppressed';
        }
        feedback ||= action;
      }
      this.exec(
        `UPDATE proactive_messages
         SET status=?,
             feedback=NULLIF(?, ''),
             score=CASE WHEN ? > 0 THEN MAX(score - ?, 0) ELSE score END,
             metadata=CASE WHEN ? > 0 THEN json_set(COALESCE(metadata, '{}'),
               '$.downranking.last_action', ?,
               '$.downranking.negative_feedback_count', ?,
               '$.downranking.score_penalty', ?,
               '$.downranking.auto_suppressed', ?)
               ELSE metadata END,
             updated_at=datetime('now'),
             sent_at=CASE WHEN ?='delivered' THEN datetime('now') ELSE sent_at END
         WHERE id=?`,
        status,
        feedback,
        scorePenalty,
        scorePenalty,
        scorePenalty,
        action,
        negativeFeedbackCount,
        scorePenalty,
        status === 'suppressed' && negativeFeedback ? 1 : 0,
        status,
        id,
      );
      this.exec(
        `INSERT INTO proactive_feedback (id, proactive_message_id, action, feedback)
         VALUES (?, ?, ?, NULLIF(?, ''))`,
        `pfb_${newID()}`,
        id,
        action,
        feedback,
      );
      if (negativeFeedback && before) {
        this.exec(
          `UPDATE proactive_messages
           SET score=MAX(score - ?, 0),
               status=CASE WHEN ? THEN 'suppressed' ELSE status END,
               metadata=json_set(COALESCE(metadata, '{}'),
                 '$.downranking.last_action', ?,
                 '$.downranking.negative_feedback_count', ?,
                 '$.downranking.score_penalty', ?,
                 '$.downranking.auto_suppressed', ?,
                 '$.downranking.source_message_id', ?),
               updated_at=datetime('now')
           WHERE id <> ?
             AND status IN ('draft', 'needs_authorization', 'authorized', 'scheduled')
             AND (
               (COALESCE(?, '') <> '' AND source_open_loop_id = ?)
               OR (COALESCE(?, '') <> '' AND source_product_task_id = ?)
             )`,
          scorePenalty,
          negativeFeedbackCount >= 3 ? 1 : 0,
          action,
          negativeFeedbackCount,
          scorePenalty,
          negativeFeedbackCount >= 3 ? 1 : 0,
          id,
          id,
          optionalString(before.source_open_loop_id) || '',
          optionalString(before.source_open_loop_id) || '',
          optionalString(before.source_product_task_id) || '',
          optionalString(before.source_product_task_id) || '',
        );
      }
      const row = this.get(
        `SELECT pm.id, pm.title, pm.body, pm.channel, pm.status, pm.source_open_loop_id, pm.source_product_task_id,
                ol.source_run_id, ol.source_conversation_id
         FROM proactive_messages pm
         LEFT JOIN open_loops ol ON ol.id = pm.source_open_loop_id
         WHERE pm.id=?`,
        id,
      );
      const runID = optionalString(row?.source_run_id);
      if (runID) {
        this.insertRunEvent(runID, '', this.nextRunEventSeq(runID), eventTypeForProactiveDecision(action, status), {
          item_type: 'proactive',
          item_id: id,
          proactive_message_id: id,
          source_open_loop_id: optionalString(row?.source_open_loop_id),
          product_task_id: optionalString(row?.source_product_task_id),
          status,
          visibility: 'proactive',
          source: 'store',
          title: optionalString(row?.title),
          summary: optionalString(row?.body) || feedback,
          feedback,
          action,
        });
        if (status === 'delivered' && row) {
          this.recordNotificationDeliveryForProactive(id, row);
        }
      }
    });
  }

  private classifyRecoverableRunsOnStartup(): void {
    const rows = this.all(
      `SELECT id, status
       FROM runs
       WHERE status IN ('queued', 'running', 'cancelling', 'resuming', 'waiting_confirmation')
          AND NOT EXISTS (
            SELECT 1 FROM automation_runs
            WHERE automation_runs.run_id = runs.id
              AND automation_runs.status = 'running'
          )
          AND NOT EXISTS (
            SELECT 1 FROM run_events
            WHERE run_events.run_id = runs.id
              AND run_events.event_type = 'run.recovery_required'
          )`,
    );
    if (rows.length === 0) return;
    this.transaction(() => {
      for (const row of rows) {
        const runID = String(row.id);
        const status = String(row.status || '');
        if (status === 'waiting_confirmation') {
          this.appendRunEventV2({
            id: `${runID}_evt_recovery_required`,
            run_id: runID,
            event_type: 'run.recovery_required',
            item_type: 'run',
            item_id: runID,
            status: 'waiting_confirmation',
            source: 'store',
            visibility: 'inline_status',
            payload: {
              recovery_status: 'needs_user_decision',
              reason: 'pending approval survived app restart',
            },
          });
          continue;
        }
        const reason = 'App restarted before this run reached a safe terminal state';
        const completedSideEffects = Number(this.get(
          `SELECT COUNT(*) AS count FROM tool_runs
           WHERE run_id=? AND status='succeeded' AND side_effect_level NOT IN ('', 'none')`,
          runID,
        )?.count || 0);
        this.exec(
          `UPDATE runs
           SET status='needs_recovery', terminal_status=NULL, terminal_reason=?,
               error_code='restart_recovery_required', error_message=?, finished_at=NULL,
               metadata=json_set(COALESCE(metadata, '{}'), '$.recovery.detected_at', datetime('now'),
                 '$.recovery.completed_side_effect_count', ?)
           WHERE id=?`,
          reason,
          reason,
          completedSideEffects,
          runID,
        );
        this.exec(
          `UPDATE turns
           SET status='interrupted', stream_status='interrupted',
               finished_at=COALESCE(finished_at, datetime('now'))
           WHERE run_id=? AND status IN ('created', 'mode_resolved', 'prompting', 'running', 'streaming', 'tool_calling', 'waiting_tool')`,
          runID,
        );
        this.exec(
          `UPDATE model_calls
           SET status='interrupted', completed_at=COALESCE(completed_at, datetime('now')),
               finish_reason='restart_recovery_required',
               error_code='restart_recovery_required', error_message=?
           WHERE run_id=? AND status IN ('pending', 'running')`,
          reason,
          runID,
        );
        const productTaskID = this.productTaskIDForRun(runID);
        if (productTaskID) {
          this.exec(
            `UPDATE product_tasks
             SET status='paused', terminal_status=NULL, terminal_reason=?, summary=?,
                 verification_status='pending', updated_at=datetime('now')
             WHERE id=?`,
            reason,
            reason,
            productTaskID,
          );
        }
        this.appendRunEventV2({
          id: `${runID}_evt_recovery_required`,
          run_id: runID,
          event_type: 'run.recovery_required',
          item_type: 'run',
          item_id: runID,
          status: 'needs_recovery',
          source: 'store',
          visibility: 'inline_status',
          payload: {
            recovery_status: 'recoverable',
            reason,
            safe_to_retry: completedSideEffects === 0,
            completed_side_effect_count: completedSideEffects,
          },
        });
      }
    });
  }

  private recoverInterruptedAutomationTriggersOnStartup(): void {
    const rows = this.all(
      `SELECT t.id, t.automation_id, t.status, t.trigger_type, t.dedup_key, t.run_id, t.product_task_id,
              t.attempt_count, a.name AS automation_name, a.retry_policy
       FROM automation_triggers t
       JOIN automation_definitions a ON a.id=t.automation_id
       WHERE t.status IN ('claimed', 'running')`,
    );
    if (rows.length === 0) return;
    const reason = 'automation runtime state was lost after app restart';
    this.transaction(() => {
      for (const row of rows) {
        const triggerID = String(row.id);
        const automationID = String(row.automation_id);
        const automationName = optionalString(row.automation_name) || automationID;
        const runID = optionalString(row.run_id);
        const productTaskID = optionalString(row.product_task_id);
        const attemptCount = Number(row.attempt_count ?? 0);
        const maxAttempts = automationMaxAttempts(parseObject(row.retry_policy));
        const shouldRetry = attemptCount > 0 && attemptCount < maxAttempts;
        const nextAttemptAt = shouldRetry ? nowIso() : '';
        const triggerStatus = shouldRetry ? 'retry_scheduled' : 'failed';
        this.exec(
          `UPDATE automation_triggers
           SET status=?, claim_token=NULL, next_attempt_at=NULLIF(?, ''),
               error_code='runtime_lost_on_restart', error_message=?, updated_at=datetime('now')
           WHERE id=? AND status IN ('claimed', 'running')`,
          triggerStatus,
          nextAttemptAt,
          reason,
          triggerID,
        );
        this.exec(
          `UPDATE automation_runs
           SET status='failed', error_code='runtime_lost_on_restart', error_message=?,
               finished_at=COALESCE(finished_at, datetime('now')), updated_at=datetime('now')
           WHERE trigger_id=? AND status='running'`,
          reason,
          triggerID,
        );
        if (runID) {
          this.exec(
            `UPDATE runs
             SET status='failed', terminal_status='failed', terminal_reason=?,
                 error_code='runtime_lost_on_restart', error_message=?,
                 finished_at=COALESCE(finished_at, datetime('now'))
             WHERE id=? AND status IN ('queued','running','cancelling','resuming')`,
            reason,
            reason,
            runID,
          );
          this.appendAutomationRunEvent(runID, 'automation.run_failed', {
            automation_id: automationID,
            automation_name: automationName,
            trigger_id: triggerID,
            product_task_id: productTaskID || undefined,
            error_code: 'runtime_lost_on_restart',
            error_message: reason,
            title: 'Automation interrupted',
            summary: reason,
          });
          if (shouldRetry) {
            this.appendAutomationRunEvent(runID, 'automation.retry_scheduled', {
              automation_id: automationID,
              automation_name: automationName,
              trigger_id: triggerID,
              product_task_id: productTaskID || undefined,
              retry_at: nextAttemptAt,
              title: 'Automation retry scheduled',
              summary: reason,
            });
          }
        }
      }
    });
  }

  private recoverTelegramInboundInboxOnStartup(): void {
    if (!this.tableExists('telegram_inbound_updates')) return;
    this.transaction(() => {
      // A reply that was already handed to fetch may have been accepted by
      // Telegram even if the process died before the HTTP response arrived.
      // Never resend it automatically.
      this.exec(
        `UPDATE telegram_inbound_updates
         SET status='reply_ambiguous', claim_token=NULL,
             error_code='TELEGRAM_REPLY_ACCEPTANCE_UNKNOWN',
             error_message='App restarted while Telegram reply acceptance was unknown; automatic resend is suppressed.',
             updated_at=datetime('now')
         WHERE status='reply_sending'`,
      );

      // A claim before the model boundary is safe to reclaim. Once
      // model_started_at is set, the model task must never be started again.
      this.exec(
        `UPDATE telegram_inbound_updates
         SET status='pending', claim_token=NULL, claimed_at=NULL, updated_at=datetime('now')
         WHERE status='processing' AND model_started_at IS NULL`,
      );

      const rows = this.all(
        `SELECT update_id, run_id
         FROM telegram_inbound_updates
         WHERE status='model_started'`,
      );
      for (const row of rows) {
        const updateID = Number(row.update_id);
        const runID = optionalString(row.run_id) || '';
        const recovered = runID ? this.get(
          `SELECT r.status, r.terminal_status, r.terminal_reason, r.error_message,
                  COALESCE(
                    (SELECT m.content
                     FROM messages m
                     WHERE m.role='assistant' AND json_extract(m.metadata, '$.run_id')=r.id
                     ORDER BY m.rowid DESC LIMIT 1),
                    (SELECT m.content
                     FROM turns t
                     JOIN messages m ON m.id=t.assistant_message_id AND m.role='assistant'
                     WHERE t.run_id=r.id
                     ORDER BY t.turn_index DESC LIMIT 1),
                    ''
                  ) AS response_text
           FROM runs r
           WHERE r.id=?
           LIMIT 1`,
          runID,
        ) : undefined;
        const runStatus = optionalString(recovered?.terminal_status) || optionalString(recovered?.status) || '';
        const responseText = optionalString(recovered?.response_text) || '';
        if (['succeeded', 'completed'].includes(runStatus) && responseText) {
          this.exec(
            `UPDATE telegram_inbound_updates
             SET status='reply_pending', response_text=?, claim_token=NULL, claimed_at=NULL,
                 error_code=NULL, error_message=NULL, updated_at=datetime('now')
             WHERE update_id=? AND status='model_started'`,
            responseText,
            updateID,
          );
          continue;
        }
        const reason = optionalString(recovered?.terminal_reason)
          || optionalString(recovered?.error_message)
          || 'Model outcome was not durably recoverable after restart; duplicate execution is suppressed.';
        this.exec(
          `UPDATE telegram_inbound_updates
           SET status='failed', claim_token=NULL,
               error_code='TELEGRAM_MODEL_OUTCOME_UNKNOWN', error_message=?, updated_at=datetime('now')
           WHERE update_id=? AND status='model_started'`,
          reason,
          updateID,
        );
      }
    });
  }

  private seedDefaults(): void {
    this.exec(
      `INSERT INTO models (id, provider, model_name, display_name, supports_json_mode, supports_tool_calling, enabled, metadata)
       VALUES ('deterministic-local-model', 'deterministic_provider', 'deterministic-local-model', 'Deterministic Local Model', 1, 1, 1, ?)
       ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, model_name=excluded.model_name, display_name=excluded.display_name, supports_tool_calling=excluded.supports_tool_calling, enabled=excluded.enabled, updated_at=datetime('now')`,
      json({ desktop_default: true, electron_native: true }),
    );
    for (const agent of [
      ['general_agent', 'General Agent', 'General purpose desktop agent.', ['memory_search', 'memory_write_candidate', 'session_search', 'session_summary', 'session_branch', 'session_compact', 'delegate_task', 'project_list', 'skills_list', 'skill_view', 'tool_search', 'task_list', 'task_view', 'task_update', 'web_research', 'workspace_search', 'file_read', 'file_analyze', 'image_generate', 'text_to_speech', 'speech_transcribe', 'lsp_definition', 'lsp_references', 'lsp_diagnostics', 'debugger_attach', 'debugger_breakpoint', 'debugger_step', 'debugger_evaluate', 'debugger_stop', 'apply_patch', 'shell_command', 'test_command', 'shell_start', 'shell_write', 'shell_output', 'shell_kill', 'computer_observe', 'find_roots', 'observe_ui', 'search_ui', 'expand_ui', 'inspect_ui', 'read_text', 'wait_for', 'act_ui', 'browser_observe', 'browser_navigate', 'browser_click', 'browser_type', 'desktop_app_list', 'desktop_app_inspect', 'request_user_input', 'automation_update'], []],
      ['memory_agent', 'Memory Agent', 'Memory and preference assistant.', ['memory_search'], ['记忆', '记住', '偏好', 'memory']],
      ['devops_agent', 'DevOps Agent', 'Read-only diagnostics assistant.', ['system_health_check', 'server_diagnose'], ['joi 自检', 'health', 'server', 'docker', 'nginx', 'cloudflared', '服务状态', '部署']],
      ['research_agent', 'Research Agent', 'Read-only web research assistant.', ['web_research'], ['@research', 'https://', 'http://', '网页搜索', '上网搜索', '搜一下', '最新消息', '新闻', '天气', '泄露信息']],
    ] as const) {
      this.exec(
        `INSERT INTO agents (id, name, description, default_model_id, capabilities, route_hints, enabled, metadata)
         VALUES (?, ?, ?, 'deterministic-local-model', ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, default_model_id=excluded.default_model_id, capabilities=excluded.capabilities, route_hints=excluded.route_hints, enabled=excluded.enabled, updated_at=datetime('now')`,
        agent[0],
        agent[1],
        agent[2],
        json(agent[3]),
        json({ keywords: agent[4] }),
        json({ desktop_default: true, electron_native: true }),
      );
    }
    for (const capability of [
      ['memory_search', 'Memory Search', 'Search local memory context.', 'read_only'],
      ['memory_recall', 'Memory Recall', 'Recall confirmed memory within the current room, project, and user scope.', 'read_only'],
      ['memory_write_candidate', 'Memory Write Candidate', 'Create a pending memory candidate for user review.', 'workspace_write'],
      ['session_search', 'Session Search', 'Search local Joi conversations and transcript history.', 'read_only'],
      ['session_summary', 'Session Summary', 'Load bounded context from one Joi conversation.', 'read_only'],
      ['session_branch', 'Session Branch', 'Fork a local conversation while preserving source provenance.', 'workspace_write'],
      ['session_compact', 'Session Compact', 'Persist a conversation checkpoint while retaining the original transcript.', 'workspace_write'],
      ['delegate_task', 'Delegate Task', 'Create a bounded child-agent run with independent provenance.', 'workspace_write'],
      ['project_list', 'Project List', 'List local Joi projects and active personas.', 'read_only'],
      ['skills_list', 'Skills List', 'List enabled local Codex-compatible skills.', 'read_only'],
      ['skill_view', 'Skill View', 'Read one local skill definition and instructions.', 'read_only'],
      ['tool_search', 'Tool Search', 'Search Joi native capabilities, MCP tools, and skills.', 'read_only'],
      ['task_list', 'Task List', 'List persisted Joi product tasks.', 'read_only'],
      ['task_view', 'Task View', 'Read one Joi product task with steps and deliverables.', 'read_only'],
      ['task_update', 'Task Update', 'Close or reopen one Joi product task after confirmation.', 'workspace_write'],
      ['web_research', 'Web Research', 'Fetch and summarize an allowlisted web page.', 'read_only'],
      ['server_diagnose', 'Server Diagnose', 'Inspect service health through read-only diagnostics.', 'read_only'],
      ['system_health_check', 'System Health Check', 'Inspect Joi local runtime health.', 'read_only'],
      ['workspace_search', 'Workspace Search', 'Search authorized workspace source and documents.', 'read_only'],
      ['file_read', 'File Read', 'Read a bounded authorized workspace file line range.', 'read_only'],
      ['file_analyze', 'File Analyze', 'Analyze an authorized workspace file.', 'read_only'],
      ['image_generate', 'Image Generate', 'Generate and persist an image with Grok Build native image_gen.', 'read_only'],
      ['image_analyze', 'Image Analyze', 'Analyze a local image with macOS Vision OCR.', 'read_only'],
      ['text_to_speech', 'Text To Speech', 'Generate playable speech with the native macOS speech engine.', 'read_only'],
      ['speech_transcribe', 'Speech Transcribe', 'Transcribe local audio with Whisper.', 'read_only'],
      ['assistant_workspace', 'Assistant Workspace', 'Read the personal-assistant activity, calendar, plan, and channel workspace.', 'read_only'],
      ['assistant_action', 'Assistant Action', 'Operate the local personal-assistant loop with full permission.', 'browser_interaction'],
      ['lsp_definition', 'LSP Definition', 'Resolve a source definition with a native language server.', 'read_only'],
      ['lsp_references', 'LSP References', 'Resolve source references with a native language server.', 'read_only'],
      ['lsp_diagnostics', 'LSP Diagnostics', 'Read source diagnostics from a native language server.', 'read_only'],
      ['debugger_attach', 'Debugger Attach', 'Start a native LLDB session.', 'browser_interaction'],
      ['debugger_breakpoint', 'Debugger Breakpoint', 'Set a breakpoint in a native LLDB session.', 'browser_interaction'],
      ['debugger_step', 'Debugger Step', 'Run or step a native LLDB session.', 'browser_interaction'],
      ['debugger_evaluate', 'Debugger Evaluate', 'Evaluate an expression in a native LLDB session.', 'browser_interaction'],
      ['debugger_stop', 'Debugger Stop', 'Dispose a native LLDB session.', 'browser_interaction'],
      ['apply_patch', 'Apply Patch', 'Apply a bounded patch inside authorized workspace roots.', 'workspace_write'],
      ['shell_command', 'Shell Command', 'Run a tightly allowlisted read-only workspace command.', 'read_only'],
      ['test_command', 'Test Command', 'Run an allowlisted test/build command.', 'read_only'],
      ['shell_start', 'Shell Start', 'Start a persistent local shell session with full access.', 'browser_interaction'],
      ['shell_write', 'Shell Write', 'Write a validated command to a persistent shell session.', 'browser_interaction'],
      ['shell_output', 'Shell Output', 'Read bounded output from a persistent shell session.', 'read_only'],
      ['shell_kill', 'Shell Kill', 'Terminate a persistent local shell session.', 'browser_interaction'],
      ['computer_observe', 'Computer Observe', 'Observe bounded frontmost-window metadata and visible text.', 'read_only'],
      ['find_roots', 'Find UI Roots', 'Find controllable application windows through Pi computer-use.', 'read_only'],
      ['observe_ui', 'Observe UI', 'Capture an immutable Pi computer-use UI state and semantic outline.', 'read_only'],
      ['search_ui', 'Search UI', 'Search an observed Pi computer-use UI state.', 'read_only'],
      ['expand_ui', 'Expand UI', 'Expand one UI ref from an observed Pi state.', 'read_only'],
      ['inspect_ui', 'Inspect UI', 'Inspect one UI ref from an observed Pi state.', 'read_only'],
      ['read_text', 'Read UI Text', 'Read bounded text from an observed Pi UI state.', 'read_only'],
      ['wait_for', 'Wait For UI', 'Wait for a semantic UI condition and return a successor state.', 'read_only'],
      ['act_ui', 'Act on UI', 'Execute a confirmed Pi UI action transaction with postcondition verification.', 'browser_interaction'],
      ['browser_observe', 'Browser Observe', 'Observe bounded frontmost-browser metadata and visible text.', 'read_only'],
      ['browser_navigate', 'Browser Navigate', 'Navigate an allowlisted browser URL without Playwright.', 'read_only'],
      ['browser_click', 'Browser Click', 'Click an element in the frontmost browser with explicit high permission.', 'browser_interaction'],
      ['browser_type', 'Browser Type', 'Type into an element in the frontmost browser with explicit high permission.', 'browser_interaction'],
      ['desktop_app_list', 'Desktop App List', 'List installed macOS application bundle metadata.', 'read_only'],
      ['desktop_app_inspect', 'Desktop App Inspect', 'Inspect one macOS application bundle metadata record.', 'read_only'],
      ['request_user_input', 'Request User Input', 'Ask a bounded scheduling clarification before creating an automation proposal.', 'read_only'],
      ['automation_update', 'Automation Update', 'Create a paused scheduled-task proposal for user review.', 'read_only'],
    ]) {
      this.exec(
        `INSERT INTO capabilities (id, name, description, risk_level, enabled, metadata)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, risk_level=excluded.risk_level, updated_at=datetime('now')`,
        capability[0],
        capability[1],
        capability[2],
        capability[3],
        json({ desktop_default: true, electron_native: true }),
      );
    }
    this.exec(
      `INSERT INTO nodes (id, name, role, status, capabilities, resources, network, assign_policy, last_heartbeat_at, version, metadata)
       VALUES ('main-node', 'Main Node', 'main', 'healthy', ?, '{}', '{}', '{}', datetime('now'), ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name,
         role=excluded.role,
         status=excluded.status,
         capabilities=excluded.capabilities,
         last_heartbeat_at=excluded.last_heartbeat_at,
         version=excluded.version,
         metadata=excluded.metadata,
         updated_at=datetime('now')`,
      json(['memory_search', 'memory_write_candidate', 'session_search', 'session_summary', 'session_branch', 'session_compact', 'delegate_task', 'project_list', 'skills_list', 'skill_view', 'tool_search', 'task_list', 'task_view', 'task_update', 'workspace_search', 'file_read', 'file_analyze', 'image_generate', 'text_to_speech', 'speech_transcribe', 'lsp_definition', 'lsp_references', 'lsp_diagnostics', 'debugger_attach', 'debugger_breakpoint', 'debugger_step', 'debugger_evaluate', 'debugger_stop', 'apply_patch', 'shell_command', 'test_command', 'shell_start', 'shell_write', 'shell_output', 'shell_kill', 'computer_observe', 'find_roots', 'observe_ui', 'search_ui', 'expand_ui', 'inspect_ui', 'read_text', 'wait_for', 'act_ui', 'browser_observe', 'browser_navigate', 'browser_click', 'browser_type', 'desktop_app_list', 'desktop_app_inspect', 'request_user_input', 'automation_update']),
      this.options.version,
      json({ runtime: 'electron_ts_store', desktop_default: true }),
    );
    const workbenchCapabilities = [
      ['browser_back', 'Browser Back', 'Navigate the managed browser back.', 'read_only'],
      ['browser_forward', 'Browser Forward', 'Navigate the managed browser forward.', 'read_only'],
      ['browser_reload', 'Browser Reload', 'Reload the managed browser.', 'read_only'],
      ['browser_scroll', 'Browser Scroll', 'Scroll the managed browser.', 'read_only'],
      ['browser_press', 'Browser Press', 'Press a key in the managed browser.', 'browser_interaction'],
      ['browser_console', 'Browser Console', 'Read managed browser console events.', 'read_only'],
      ['browser_network', 'Browser Network', 'Read managed browser network events.', 'read_only'],
      ['browser_dialog', 'Browser Dialog', 'Handle a managed browser dialog.', 'browser_interaction'],
      ['browser_get_images', 'Browser Images', 'Read image metadata from the managed browser.', 'read_only'],
      ['browser_screenshot', 'Browser Screenshot', 'Capture the managed browser page.', 'read_only'],
      ['browser_vision', 'Browser Vision', 'Capture and analyze the managed browser page with macOS Vision.', 'read_only'],
      ['browser_tabs', 'Browser Tabs', 'Manage browser tabs.', 'read_only'],
      ['browser_upload', 'Browser Upload', 'Attach local files in the managed browser.', 'browser_interaction'],
      ['browser_evaluate', 'Browser Evaluate', 'Evaluate bounded page JavaScript.', 'browser_interaction'],
      ['browser_cdp', 'Browser CDP', 'Call an enabled Chrome DevTools Protocol domain.', 'browser_interaction'],
      ['mcp_tool_call', 'MCP Tool Call', 'Invoke an enabled and wrapped MCP tool.', 'workspace_write'],
      ['extension_register_tool', 'Extension Register Tool', 'Wrap an installed extension MCP tool.', 'workspace_write'],
      ['execute_code', 'Execute Code', 'Run code in an ephemeral local kernel.', 'workspace_write'],
      ['sandbox_run', 'Sandbox Run', 'Run a command in a workspace-scoped macOS sandbox.', 'workspace_write'],
      ['lsp_hover', 'LSP Hover', 'Read language-server hover information.', 'read_only'],
      ['lsp_symbols', 'LSP Symbols', 'Read language-server document symbols.', 'read_only'],
      ['lsp_code_actions', 'LSP Code Actions', 'Read language-server quick fixes and refactors.', 'read_only'],
      ['lsp_rename', 'LSP Rename', 'Apply language-server rename edits.', 'workspace_write'],
      ['lsp_format', 'LSP Format', 'Apply language-server formatting edits.', 'workspace_write'],
      ['debugger_threads', 'Debugger Threads', 'Read LLDB thread state.', 'browser_interaction'],
      ['debugger_stack', 'Debugger Stack', 'Read LLDB stack traces.', 'browser_interaction'],
      ['debugger_locals', 'Debugger Locals', 'Read LLDB local variables.', 'browser_interaction'],
      ['debugger_watchpoint', 'Debugger Watchpoint', 'Set an LLDB watchpoint.', 'browser_interaction'],
      ['debugger_memory', 'Debugger Memory', 'Read a bounded LLDB memory range.', 'browser_interaction'],
      ['image_analyze', 'Image Analyze', 'Analyze a local image with macOS Vision OCR.', 'read_only'],
      ['assistant_workspace', 'Assistant Workspace', 'Read the personal-assistant workspace.', 'read_only'],
      ['assistant_action', 'Assistant Action', 'Operate activity capture, calendar, plans, and channels.', 'browser_interaction'],
    ] as const;
    for (const capability of workbenchCapabilities) {
      this.exec(
        `INSERT INTO capabilities (id, name, description, risk_level, enabled, metadata)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
           risk_level=excluded.risk_level, enabled=1, metadata=excluded.metadata, updated_at=datetime('now')`,
        capability[0],
        capability[1],
        capability[2],
        capability[3],
        json({ desktop_default: true, electron_native: true, workbench_runtime: true }),
      );
    }
    for (const target of [['agents', 'general_agent'], ['nodes', 'main-node']] as const) {
      const row = this.get(`SELECT capabilities FROM ${target[0]} WHERE id=?`, target[1]);
      const capabilities = [...new Set([...parseStringArray(row?.capabilities), ...workbenchCapabilities.map((item) => item[0])])]
        .filter((capability) => !RETIRED_CAPABILITY_IDS.has(capability));
      this.exec(`UPDATE ${target[0]} SET capabilities=?, updated_at=datetime('now') WHERE id=?`, json(capabilities), target[1]);
    }
    for (const retiredCapability of RETIRED_CAPABILITY_IDS) {
      this.exec(
        `UPDATE capabilities SET enabled=0, metadata=?, updated_at=datetime('now') WHERE id=?`,
        json({ retired: true, reason: 'removed_from_joi_product_2026_07_17' }),
        retiredCapability,
      );
    }
    for (const workflow of [
      ['workflow_memory_search_v1', 'memory_search', 'memory_search_v1', [{ tool: 'memory_search', risk_level: 'read_only' }]],
      ['workflow_memory_recall_v1', 'memory_recall', 'memory_recall_v1', [{ tool: 'memory_recall', risk_level: 'read_only' }]],
      ['workflow_memory_write_candidate_v1', 'memory_write_candidate', 'memory_write_candidate_v1', [{ tool: 'memory_write_candidate', risk_level: 'workspace_write' }]],
      ['workflow_session_search_v1', 'session_search', 'session_search_v1', [{ tool: 'session_search', risk_level: 'read_only' }]],
      ['workflow_session_summary_v1', 'session_summary', 'session_summary_v1', [{ tool: 'session_summary', risk_level: 'read_only' }]],
      ['workflow_project_list_v1', 'project_list', 'project_list_v1', [{ tool: 'project_list', risk_level: 'read_only' }]],
      ['workflow_skills_list_v1', 'skills_list', 'skills_list_v1', [{ tool: 'skills_list', risk_level: 'read_only' }]],
      ['workflow_skill_view_v1', 'skill_view', 'skill_view_v1', [{ tool: 'skill_view', risk_level: 'read_only' }]],
      ['workflow_tool_search_v1', 'tool_search', 'tool_search_v1', [{ tool: 'tool_search', risk_level: 'read_only' }]],
      ['workflow_task_list_v1', 'task_list', 'task_list_v1', [{ tool: 'task_list', risk_level: 'read_only' }]],
      ['workflow_task_view_v1', 'task_view', 'task_view_v1', [{ tool: 'task_view', risk_level: 'read_only' }]],
      ['workflow_task_update_v1', 'task_update', 'task_update_v1', [{ tool: 'task_update', risk_level: 'workspace_write' }]],
      ['workflow_workspace_search_v1', 'workspace_search', 'workspace_search_v1', [{ tool: 'workspace_walk_search', risk_level: 'read_only' }]],
      ['workflow_file_read_v1', 'file_read', 'file_read_v1', [{ tool: 'file_read_authorized', risk_level: 'read_only' }]],
      ['workflow_apply_patch_v1', 'apply_patch', 'apply_patch_v1', [{ tool: 'apply_patch', risk_level: 'workspace_write' }]],
      ['workflow_shell_command_v1', 'shell_command', 'shell_command_v1', [{ tool: 'shell_command', risk_level: 'read_only' }]],
      ['workflow_test_command_v1', 'test_command', 'test_command_v1', [{ tool: 'test_command', risk_level: 'read_only' }]],
      ['workflow_shell_start_v1', 'shell_start', 'shell_start_v1', [{ tool: 'shell_start', risk_level: 'browser_interaction' }]],
      ['workflow_shell_write_v1', 'shell_write', 'shell_write_v1', [{ tool: 'shell_write', risk_level: 'browser_interaction' }]],
      ['workflow_shell_output_v1', 'shell_output', 'shell_output_v1', [{ tool: 'shell_output', risk_level: 'read_only' }]],
      ['workflow_shell_kill_v1', 'shell_kill', 'shell_kill_v1', [{ tool: 'shell_kill', risk_level: 'browser_interaction' }]],
      ['workflow_computer_observe_v1', 'computer_observe', 'computer_observe_v1', [{ tool: 'computer_observe', risk_level: 'read_only' }]],
      ['workflow_find_roots_v1', 'find_roots', 'find_roots_v1', [{ tool: 'find_roots', risk_level: 'read_only' }]],
      ['workflow_observe_ui_v1', 'observe_ui', 'observe_ui_v1', [{ tool: 'observe_ui', risk_level: 'read_only' }]],
      ['workflow_search_ui_v1', 'search_ui', 'search_ui_v1', [{ tool: 'search_ui', risk_level: 'read_only' }]],
      ['workflow_expand_ui_v1', 'expand_ui', 'expand_ui_v1', [{ tool: 'expand_ui', risk_level: 'read_only' }]],
      ['workflow_inspect_ui_v1', 'inspect_ui', 'inspect_ui_v1', [{ tool: 'inspect_ui', risk_level: 'read_only' }]],
      ['workflow_read_text_v1', 'read_text', 'read_text_v1', [{ tool: 'read_text', risk_level: 'read_only' }]],
      ['workflow_wait_for_v1', 'wait_for', 'wait_for_v1', [{ tool: 'wait_for', risk_level: 'read_only' }]],
      ['workflow_act_ui_v1', 'act_ui', 'act_ui_v1', [{ tool: 'act_ui', risk_level: 'browser_interaction' }]],
      ['workflow_browser_observe_v1', 'browser_observe', 'browser_observe_v1', [{ tool: 'browser_observe', risk_level: 'read_only' }]],
      ['workflow_browser_navigate_v1', 'browser_navigate', 'browser_navigate_v1', [{ tool: 'browser_navigate', risk_level: 'read_only' }]],
      ['workflow_browser_click_v1', 'browser_click', 'browser_click_v1', [{ tool: 'browser_click', risk_level: 'browser_interaction' }]],
      ['workflow_browser_type_v1', 'browser_type', 'browser_type_v1', [{ tool: 'browser_type', risk_level: 'browser_interaction' }]],
      ['workflow_desktop_app_list_v1', 'desktop_app_list', 'desktop_app_list_v1', [{ tool: 'desktop_list_app_bundles', risk_level: 'read_only' }]],
      ['workflow_desktop_app_inspect_v1', 'desktop_app_inspect', 'desktop_app_inspect_v1', [{ tool: 'desktop_inspect_app_bundle', risk_level: 'read_only' }]],
      ['workflow_request_user_input_v1', 'request_user_input', 'request_user_input_v1', [{ tool: 'request_user_input', risk_level: 'read_only' }]],
      ['workflow_automation_update_v1', 'automation_update', 'automation_update_v1', [{ tool: 'automation_update', risk_level: 'read_only' }]],
    ] as const) {
      this.exec(
        `INSERT INTO tool_workflows (id, capability_id, name, version, risk_level, steps, enabled, metadata)
         VALUES (?, ?, ?, 'v1', ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET
           capability_id=excluded.capability_id,
           name=excluded.name,
           risk_level=excluded.risk_level,
           steps=excluded.steps,
           metadata=excluded.metadata,
           updated_at=datetime('now')`,
        workflow[0],
        workflow[1],
        workflow[2],
        workflowRiskLevel(workflow[1]),
        json(workflow[3]),
        json({ desktop_default: true, electron_native: true }),
      );
    }
    for (const skill of [
      {
        id: 'desktop_inventory_skill',
        name: 'Desktop Inventory',
        description: 'List and inspect installed macOS applications without reading application content.',
        trigger_phrases: ['列出本地应用', '检查已安装应用'],
        required_capabilities: ['desktop_app_list', 'desktop_app_inspect'],
        forbidden_capabilities: ['apply_patch'],
        output_contract: 'Return bounded application metadata with source paths.',
      },
      {
        id: 'workspace_research_skill',
        name: 'Workspace Research',
        description: 'Search and read bounded files inside authorized workspace roots.',
        trigger_phrases: ['搜索工作区', '分析本地文件'],
        required_capabilities: ['workspace_search', 'file_read', 'file_analyze'],
        forbidden_capabilities: ['browser_type'],
        output_contract: 'Return evidence-backed findings from authorized workspace files.',
      },
    ]) {
      this.exec(
        `INSERT INTO skill_definitions (id, version, name, description, trigger_phrases, required_capabilities,
                                        forbidden_capabilities, output_contract, enabled, metadata)
         VALUES (?, 'v1', ?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, description=excluded.description, trigger_phrases=excluded.trigger_phrases,
           required_capabilities=excluded.required_capabilities, forbidden_capabilities=excluded.forbidden_capabilities,
           output_contract=excluded.output_contract, metadata=excluded.metadata, updated_at=datetime('now')`,
        skill.id,
        skill.name,
        skill.description,
        json(skill.trigger_phrases),
        json(skill.required_capabilities),
        json(skill.forbidden_capabilities),
        skill.output_contract,
        json({ source: 'joi_core', core: true, electron_native: true }),
      );
    }
    for (const plugin of [
      {
        id: 'joi.core.workspace',
        name: 'Joi Workspace Core',
        description: 'Workspace search, file analysis, controlled patching and desktop inventory.',
        capability_ids: ['workspace_search', 'file_read', 'file_analyze', 'apply_patch', 'shell_command', 'test_command', 'desktop_app_list', 'desktop_app_inspect'],
        skill_ids: ['desktop_inventory_skill', 'workspace_research_skill'],
      },
      {
        id: 'joi.core.browser',
        name: 'Joi Browser Core',
        description: 'Controlled browser and Pi stateful computer-use capabilities.',
        capability_ids: ['web_research', 'find_roots', 'observe_ui', 'search_ui', 'expand_ui', 'inspect_ui', 'read_text', 'wait_for', 'act_ui', 'browser_observe', 'browser_navigate', 'browser_click', 'browser_type'],
        skill_ids: [],
      },
    ]) {
      this.exec(
        `INSERT INTO plugin_definitions (id, name, version, description, enabled, status, capability_ids, skill_ids, mcp_server_ids, metadata)
         VALUES (?, ?, 'v1', ?, 1, 'installed', ?, ?, '[]', ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, version=excluded.version, description=excluded.description,
           capability_ids=excluded.capability_ids, skill_ids=excluded.skill_ids,
           metadata=excluded.metadata, updated_at=datetime('now')`,
        plugin.id,
        plugin.name,
        plugin.description,
        json(plugin.capability_ids),
        json(plugin.skill_ids),
        json({ source: 'joi_core', core: true, electron_native: true }),
      );
    }
  }

  private deterministicRunEvents(runID: string, response: string, createdAt: string, modeResolution: ModeResolutionRecord): RunEvent[] {
    return [
      {
        id: `${runID}_evt_1`,
        run_id: runID,
        seq: 1,
        event_type: 'run.started',
        type: 'run.started',
        status: 'running',
        created_at: createdAt,
        payload: { title: 'Run started' },
      },
      {
        id: `${runID}_evt_2`,
        run_id: runID,
        seq: 2,
        event_type: 'run.mode_resolved',
        type: 'run.mode_resolved',
        status: 'completed',
        created_at: createdAt,
        payload: {
          item_type: 'mode_resolution',
          item_id: modeResolution.id,
          requested_mode: modeResolution.requested_mode,
          resolved_mode: modeResolution.resolved_mode,
          contract_mode: contractMode(modeResolution.resolved_mode),
          mode_source: modeResolution.mode_source,
          mode_locked_by_user: modeResolution.mode_locked_by_user,
          reason: modeResolution.reason,
          confidence: modeResolution.confidence,
          visibility: 'inline_status',
        },
      },
      {
        id: `${runID}_evt_3`,
        run_id: runID,
        seq: 3,
        event_type: 'assistant.delta',
        type: 'assistant.delta',
        status: 'running',
        delta: response,
        created_at: createdAt,
        payload: { item_type: 'assistant_message', delta: { text: response, stream_source: 'deterministic' }, visibility: 'chat' },
      },
      {
        id: `${runID}_evt_4`,
        run_id: runID,
        seq: 4,
        event_type: 'assistant.completed',
        type: 'assistant.completed',
        status: 'completed',
        created_at: createdAt,
        payload: { item_type: 'assistant_message', delta: { text: response }, visibility: 'chat' },
      },
      {
        id: `${runID}_evt_5`,
        run_id: runID,
        seq: 5,
        event_type: 'run.finalized',
        type: 'run.finalized',
        status: 'completed',
        terminal: true,
        created_at: createdAt,
        payload: { status: 'completed', terminal: true },
      },
    ];
  }

  private desktopSettings(): Record<string, string> {
    const rows = this.all(`SELECT key, value FROM desktop_settings`);
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[String(row.key)] = String(row.value);
    }
    return settings;
  }

  private setDesktopSettings(values: Record<string, string>): void {
    this.transaction(() => {
      for (const [key, value] of Object.entries(values)) {
        this.exec(
          `INSERT INTO desktop_settings (key, value, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
          key,
          value,
        );
      }
    });
  }

  private upsertModel(req: ModelSettingsRequest): void {
    this.exec(
      `INSERT INTO models (id, provider, model_name, display_name, base_url, supports_json_mode, supports_tool_calling, enabled, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         provider=excluded.provider,
         model_name=excluded.model_name,
         display_name=excluded.display_name,
         base_url=excluded.base_url,
         supports_json_mode=excluded.supports_json_mode,
         supports_tool_calling=excluded.supports_tool_calling,
         enabled=excluded.enabled,
         metadata=excluded.metadata,
         updated_at=datetime('now')`,
      req.model_id,
      req.provider,
      req.model_id,
      req.display_name || req.model_id,
      req.base_url,
      req.supports_json_mode ? 1 : 0,
      req.supports_tool_calling ? 1 : 0,
      req.enabled ? 1 : 0,
      json({
        temperature: req.temperature,
        max_output_tokens: req.max_output_tokens,
        timeout_seconds: req.timeout_seconds,
        max_retries: req.max_retries,
        supports_reasoning: req.supports_reasoning,
        electron_native: true,
      }),
    );
  }

  private insertMemoryFeedback(memoryID: string, runID: string | undefined, feedback: string, comment: string, replacementMemoryID = ''): void {
    this.exec(
      `INSERT INTO memory_feedback (id, memory_id, run_id, feedback, comment)
       VALUES (?, ?, NULLIF(?, ''), ?, ?)`,
      `mfb_${newID()}`,
      memoryID,
      runID || '',
      feedback,
      comment,
    );
    const cleanRunID = runID?.trim();
    if (!cleanRunID) return;
    if (['positive', 'helpful', 'confirm'].includes(feedback)) {
      this.exec(
        `UPDATE memory_usage_logs SET used_in_answer=1, outcome='helpful' WHERE memory_id=? AND run_id=?`,
        memoryID,
        cleanRunID,
      );
    } else if (['negative', 'unhelpful', 'reject', 'delete'].includes(feedback)) {
      this.exec(
        `UPDATE memory_usage_logs SET outcome='unhelpful' WHERE memory_id=? AND run_id=?`,
        memoryID,
        cleanRunID,
      );
    }
    const memory = this.get(
      `SELECT id, type, content, summary, status, confidence, updated_at
       FROM memories
       WHERE id=?`,
      replacementMemoryID || memoryID,
    );
    if (!memory) return;
    const eventType = memoryFeedbackEventType(feedback);
    this.appendRunEventV2({
      run_id: cleanRunID,
      event_type: eventType,
      item_type: 'memory',
      item_id: replacementMemoryID || memoryID,
      status: statusForMemoryFeedback(feedback),
      source: 'store',
      visibility: 'memory',
      payload: {
        memory_id: replacementMemoryID || memoryID,
        previous_memory_id: replacementMemoryID ? memoryID : undefined,
        supersedes_id: replacementMemoryID ? memoryID : undefined,
        memory_type: optionalString(memory.type),
        summary: optionalString(memory.summary),
        content: optionalString(memory.content),
        memory_status: optionalString(memory.status),
        confidence: optionalNumber(memory.confidence),
        feedback,
        comment,
      },
    });
  }

  private appendMemoryRecalledEvents(
    runID: string,
    turnID: string,
    memoryPackID: string,
    results: MemorySearchResult[],
    scope: MemoryRetrievalScope,
  ): void {
    this.appendRunEventV2({
      run_id: runID,
      turn_id: turnID,
      event_type: 'memory.scope_resolved',
      item_type: 'memory_scope',
      item_id: memoryPackID,
      status: 'completed',
      source: 'store',
      visibility: 'memory',
      payload: {
        memory_context_pack_id: memoryPackID,
        ...scope,
        recalled_count: results.length,
        stable_profile_count: results.filter((result) => result.retrieval_source === 'stable_profile').length,
        dynamic_retrieval_count: results.filter((result) => result.retrieval_source !== 'stable_profile').length,
        pipeline_version: MEMORY_PIPELINE_VERSION,
      },
    });
    if (!results.some((result) => result.retrieval_source !== 'stable_profile')) {
      this.appendRunEventV2({
        run_id: runID,
        turn_id: turnID,
        event_type: 'memory.retrieval.abstained',
        item_type: 'memory_context_pack',
        item_id: memoryPackID,
        status: 'skipped',
        source: 'memory_runtime',
        visibility: 'memory',
        payload: {
          memory_context_pack_id: memoryPackID,
          reason: 'no_relevant_dynamic_memory',
          relevance_threshold: this.memoryPolicyConfig().relevance_threshold,
          pipeline_version: MEMORY_PIPELINE_VERSION,
        },
      });
    }
    for (const result of results) {
      const memory = result.memory;
      if (!memory?.id) continue;
      this.appendRunEventV2({
        run_id: runID,
        turn_id: turnID,
        event_type: 'memory.recalled',
        item_type: 'memory',
        item_id: memory.id,
        status: 'completed',
        source: 'store',
        visibility: 'memory',
        payload: {
          memory_context_pack_id: memoryPackID,
          memory_id: memory.id,
          memory_type: memory.type,
          memory_layer: memory.layer,
          summary: memory.summary,
          content: memory.content,
          reason: result.reason,
          score: result.score,
          retrieval_source: result.retrieval_source,
          matched_terms: result.matched_terms,
          scope_match: result.scope_match,
          pinned: memory.pinned,
          stage: result.retrieval_source === 'stable_profile' ? 'stable_profile' : 'dynamic_retrieval',
          score_components: result.score_components || {},
          injected: result.injected ?? true,
          pipeline_version: MEMORY_PIPELINE_VERSION,
        },
      });
    }
  }

  private recordMemoryRetrievalUsage(
    runID: string,
    agentID: string,
    results: MemorySearchResult[],
    scope: MemoryRetrievalScope,
  ): void {
    for (const [index, result] of results.entries()) {
      if (!result.memory.id) continue;
      const existing = this.get(
        `SELECT id FROM memory_usage_logs WHERE memory_id=? AND run_id=? AND injected=1 LIMIT 1`,
        result.memory.id,
        runID,
      );
      if (existing) continue;
      this.exec(
        `INSERT INTO memory_usage_logs (
           id, memory_id, run_id, agent_id, retrieval_score, normalized_score,
           recalled, injected, used_in_answer, influence_state, rank, pipeline_version, outcome, metadata
         ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 0, 'unknown', ?, ?, 'injected', ?)`,
        `mulog_${newID()}`,
        result.memory.id,
        runID,
        agentID,
        result.score,
        normalizeRelevanceScore(result.score),
        index + 1,
        MEMORY_PIPELINE_VERSION,
        json({
          source: 'prompt_memory_retrieval_v3',
          reason: result.reason,
          retrieval_source: result.retrieval_source,
          matched_terms: result.matched_terms || [],
          scope_match: result.scope_match,
          stage: result.retrieval_source === 'stable_profile' ? 'stable_profile' : 'dynamic_retrieval',
          score_components: result.score_components || {},
          memory_scope: scope,
          pipeline_version: MEMORY_PIPELINE_VERSION,
        }),
      );
      this.exec(
        `UPDATE memories SET usage_count=usage_count+1, last_used_at=datetime('now') WHERE id=?`,
        result.memory.id,
      );
    }
  }

  private setNodeEnabled(nodeID: string, enabled: boolean): void {
    const id = nodeID.trim();
    if (!id) throw new Error('node_id is required');
    this.transaction(() => {
      this.exec(
        `UPDATE nodes
         SET status=?, auto_assign_enabled=?, manual_assign_enabled=?, updated_at=datetime('now')
         WHERE id=?`,
        enabled ? 'healthy' : 'disabled',
        enabled ? 1 : 0,
        enabled ? 1 : 0,
        id,
      );
      this.exec(
        `INSERT INTO worker_gateway_audit_logs (id, node_id, action, status, reason, metadata)
         VALUES (?, ?, 'node_admin', 'allowed', ?, ?)`,
        `audit_${newID()}`,
        id,
        enabled ? 'node_enabled' : 'node_disabled',
        json({ source: 'electron_desktop_ui' }),
      );
    });
  }

  private workerGatewayTask(taskID: string): WorkerGatewayTask {
    const id = taskID.trim();
    if (!id) throw new Error('task_id is required');
    const row = this.get(
      `SELECT id, COALESCE(run_id, '') AS run_id, capability_id,
              COALESCE(preferred_node_id, '') AS preferred_node_id,
              COALESCE(assigned_node_id, '') AS assigned_node_id,
              privacy_level, status, payload, timeout_seconds
       FROM tasks
       WHERE id=?`,
      id,
    );
    if (!row) throw new Error('task_not_found');
    return {
      id: String(row.id),
      run_id: optionalString(row.run_id) || '',
      capability_id: String(row.capability_id),
      preferred_node_id: optionalString(row.preferred_node_id) || '',
      assigned_node_id: optionalString(row.assigned_node_id) || '',
      privacy_level: optionalString(row.privacy_level) || 'internal',
      status: optionalString(row.status) || 'pending',
      payload: parseObject(row.payload),
      timeout_seconds: Number(row.timeout_seconds ?? 120),
    };
  }

  private assertWorkerTaskClaimable(nodeID: string, task: WorkerGatewayTask): void {
    const id = nodeID.trim();
    if (!id) throw new Error('node_id is required');
    if (task.assigned_node_id && task.assigned_node_id !== id) {
      throw new Error('permission_denied: task assigned to different node');
    }
    if (task.status !== 'running') {
      throw new Error('task_not_running');
    }
  }

  private recordGatewayToolRun(task: WorkerGatewayTask, output: Record<string, unknown>): void {
    this.exec(
      `INSERT INTO tool_runs (id, run_id, task_id, capability_id, workflow_name, tool_name, node_id, risk_level, status, input, output, finished_at, duration_ms, assignment_reason)
       VALUES (?, NULLIF(?, ''), ?, ?, ?, ?, ?, 'read_only', 'succeeded', ?, ?, datetime('now'), 0, ?)`,
      `toolrun_${newID()}`,
      task.run_id,
      task.id,
      task.capability_id,
      workflowNameForGateway(task.capability_id),
      workflowNameForGateway(task.capability_id),
      task.assigned_node_id,
      json(task.payload),
      json(output),
      gatewayAssignmentReason(task),
    );
  }

  private availableAutomationSlug(baseSlug: string, id: string): string {
    const base = sanitizeAutomationSlug(baseSlug || id);
    const existing = this.get(
      `SELECT id FROM automation_definitions
       WHERE slug=? AND id<>? AND deleted_at IS NULL
       LIMIT 1`,
      base,
      id,
    );
    if (!existing) return base;
    const suffix = stableShortID(id).slice(0, 8);
    return `${base}-${suffix}`.slice(0, 80);
  }

  private requireAutomationTrigger(id: string): AutomationTriggerRecord {
    const row = this.get(`SELECT * FROM automation_triggers WHERE id=?`, id);
    if (!row) throw new Error(`Automation trigger not found: ${id}`);
    return rowToAutomationTrigger(row);
  }

  private requireAutomationRun(id: string): AutomationRunRecord {
    const row = this.get(`SELECT * FROM automation_runs WHERE id=?`, id);
    if (!row) throw new Error(`Automation run not found: ${id}`);
    return rowToAutomationRun(row);
  }

  private appendAutomationRunEvent(runID: string, eventType: string, payload: Record<string, unknown>): void {
    if (!runID.trim()) return;
    const status = statusForRunEventType(eventType);
    this.appendRunEventV2({
      run_id: runID,
      event_type: eventType,
      item_type: 'automation',
      item_id: optionalString(payload.automation_id),
      status,
      source: 'automation',
      visibility: status === 'failed' || status === 'cancelled' ? 'inline_status' : 'trace_only',
      terminal: status === 'completed' || status === 'failed' || status === 'cancelled',
      payload: pruneUndefined({
        ...payload,
        payload: undefined,
        headers: undefined,
        secret: undefined,
        signature: undefined,
      }),
    });
  }

  private insertGatewayRunStep(
    runID: string,
    stepType: string,
    title: string,
    status: string,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
    stepError: Record<string, unknown>,
  ): void {
    this.exec(
      `INSERT INTO run_steps (id, run_id, step_type, title, status, input, output, error, finished_at, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 0)`,
      `step_${newID()}`,
      runID,
      stepType,
      title,
      status,
      json(input),
      json(output),
      json(stepError),
    );
  }

  private insertRunStep(runID: string, stepType: string, title: string, input: Record<string, unknown>, output: Record<string, unknown>, status = 'succeeded'): void {
    this.exec(
      `INSERT INTO run_steps (id, run_id, step_type, title, status, input, output, started_at, finished_at, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 0, datetime('now'))`,
      `step_${newID()}`,
      runID,
      stepType,
      title,
      status,
      json(input),
      json(output),
    );
  }

  private insertRunEvent(runID: string, turnID: string, seq: number, eventType: string, payload: Record<string, unknown>): void {
    this.appendRunEventV2({
      run_id: runID,
      turn_id: turnID,
      seq,
      event_type: eventType,
      item_type: optionalString(payload.item_type),
      item_id: optionalString(payload.item_id) || optionalString(payload.call_id) || optionalString(payload.tool_run_id) || optionalString(payload.task_id),
      parent_item_id: optionalString(payload.parent_item_id),
      status: optionalString(payload.status),
      source: optionalString(payload.source) || 'store',
      visibility: optionalString(payload.visibility),
      terminal: Boolean(payload.terminal),
      delta: payload.delta,
      snapshot: payload.snapshot,
      error: payload.error,
      usage: payload.usage,
      payload,
    });
  }

  private nextRunEventSeq(runID: string): number {
    const row = this.get(`SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM run_events WHERE run_id=?`, runID);
    return Number(row?.seq ?? 1);
  }

  private persistedToolRunCountForRun(runID: string): number {
    return Number(this.get(`SELECT COUNT(*) AS count FROM tool_runs WHERE run_id=?`, runID)?.count || 0);
  }

  private registeredCapabilityID(capabilityID: string): string {
    const canonical = canonicalCapabilityName(capabilityID);
    if (!canonical) return '';
    return this.get(`SELECT id FROM capabilities WHERE id=? LIMIT 1`, canonical) ? canonical : '';
  }

  private nextTurnItemSeq(runID: string): number {
    const row = this.get(`SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM turn_items WHERE run_id=?`, runID);
    return Number(row?.seq ?? 1);
  }

  private resolveMemoryRetrievalScope(req: ChatRequest): MemoryRetrievalScope {
    const conversationID = req.conversation_id?.trim() || '';
    const conversation = conversationID
      ? this.get(`SELECT active_project_id, user_id, principal_id FROM conversations WHERE id=?`, conversationID)
      : undefined;
    const room = this.resolveRoomForChat(req, conversationID);
    const scopeOverride = req.scope_override?.trim() || (room ? defaultScopeForRoomType(room.type) : 'auto_route');
    const crossProject = ['other_project', 'cross_project', 'multi_project'].includes(scopeOverride);
    const roomOnly = ['room_scope', 'temporary'].includes(scopeOverride);
    const projectIDs = new Set<string>();
    if (!roomOnly) {
      const currentProjectID = room?.project_id || optionalString(conversation?.active_project_id);
      if (currentProjectID) projectIDs.add(currentProjectID);
      if (crossProject && room) {
        for (const projectID of parseStringArray(room.metadata?.visible_project_ids)) projectIDs.add(projectID);
        for (const member of room.members || []) {
          if (member.project_id) projectIDs.add(member.project_id);
          for (const projectID of parseStringArray(member.metadata?.visible_project_ids)) projectIDs.add(projectID);
        }
      }
    }
    const userIDs = new Set<string>();
    for (const userID of [req.principal_id, req.user_id, optionalString(conversation?.principal_id), optionalString(conversation?.user_id)]) {
      if (userID?.trim()) userIDs.add(userID.trim());
    }
    if (userIDs.size === 0) userIDs.add('desktop_user');
    return {
      room_id: room?.id || req.room_id?.trim() || '',
      project_ids: [...projectIDs],
      user_ids: [...userIDs],
      scope_override: scopeOverride,
      cross_project: crossProject,
    };
  }

  private stableMemoryProfile(scope: MemoryRetrievalScope): MemorySearchResult[] {
    const scopeClauses = [`scope_type='global'`];
    const scopeParams: SQLiteValue[] = [];
    if (scope.user_ids.length > 0) {
      scopeClauses.push(`(scope_type='user' AND scope_id IN (${placeholders(scope.user_ids.length)}))`);
      scopeParams.push(...scope.user_ids);
    }
    if (scope.project_ids.length > 0) {
      scopeClauses.push(`(scope_type='project' AND scope_id IN (${placeholders(scope.project_ids.length)}))`);
      scopeParams.push(...scope.project_ids);
    }
    const policy = this.memoryPolicyConfig();
    const rows = this.all(
      `SELECT * FROM memories
       WHERE layer='profile'
         AND status='confirmed'
         AND lifecycle_state='active'
         AND privacy_level IN ('public', 'internal')
         AND disabled_at IS NULL
         AND merged_into_memory_id IS NULL
         AND (valid_until IS NULL OR datetime(valid_until) > datetime('now'))
         AND ${activeMemoryTTLWhereClause('memories')}
         AND (${scopeClauses.join(' OR ')})
       ORDER BY pinned DESC, evidence_authority DESC, evidence_count DESC,
                confidence DESC, datetime(updated_at) DESC
       LIMIT ?`,
      ...scopeParams,
      Math.max(1, Math.min(policy.stable_profile_limit, 12)),
    );
    return rows.map((row) => ({
      memory: rowToMemory(row),
      score: 1,
      reason: '稳定用户档案：已确认、当前有效且与当前作用域一致。',
      retrieval_source: 'stable_profile',
      matched_terms: [],
      scope_match: optionalString(row.scope_type) || 'global',
      injected: true,
      used_in_answer: false,
      influence_state: 'unknown',
      score_components: { stable_profile: 1 },
    }));
  }

  private searchPromptMemories(query: string, limit: number, scope: MemoryRetrievalScope): MemorySearchResult[] {
    const scopeClauses = [`memories.scope_type='global'`];
    const scopeParams: SQLiteValue[] = [];
    if (scope.user_ids.length > 0) {
      scopeClauses.push(`(memories.scope_type='user' AND memories.scope_id IN (${placeholders(scope.user_ids.length)}))`);
      scopeParams.push(...scope.user_ids);
    }
    if (scope.room_id) {
      scopeClauses.push(`(memories.scope_type='room' AND memories.scope_id=?)`);
      scopeParams.push(scope.room_id);
    }
    if (scope.project_ids.length > 0) {
      scopeClauses.push(`(memories.scope_type='project' AND memories.scope_id IN (${placeholders(scope.project_ids.length)}))`);
      scopeParams.push(...scope.project_ids);
    }
    const activeWhere = `memories.status='confirmed'
      AND memories.lifecycle_state='active'
      AND memories.privacy_level IN ('public', 'internal')
      AND memories.disabled_at IS NULL
      AND memories.merged_into_memory_id IS NULL
      AND (memories.valid_until IS NULL OR datetime(memories.valid_until) > datetime('now'))
      AND ${activeMemoryTTLWhereClause('memories')}
      AND (${scopeClauses.join(' OR ')})`;
    const governanceRows = this.all(
      `SELECT memories.*, embeddings.embedding, 'governance' AS retrieval_source
       FROM memories
       LEFT JOIN memory_embeddings embeddings
         ON embeddings.memory_id=memories.id AND embeddings.embedding_model=?
       WHERE ${activeWhere}
       ORDER BY memories.pinned DESC, memories.confidence DESC, datetime(memories.updated_at) DESC
       LIMIT 240`,
      LOCAL_MEMORY_EMBEDDING_MODEL,
      ...scopeParams,
    );
    const terms = memorySearchTerms(query);
    const ftsQuery = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
    const exactRows = ftsQuery ? this.all(
      `SELECT memories.*, embeddings.embedding, 'fts' AS retrieval_source, bm25(memory_fts) AS fts_rank
       FROM memory_fts
       JOIN memories ON memories.id=memory_fts.memory_id
       LEFT JOIN memory_embeddings embeddings
         ON embeddings.memory_id=memories.id AND embeddings.embedding_model=?
       WHERE memory_fts MATCH ?
         AND ${activeWhere}
       ORDER BY bm25(memory_fts), memories.pinned DESC, memories.confidence DESC
       LIMIT 120`,
      LOCAL_MEMORY_EMBEDDING_MODEL,
      ftsQuery,
      ...scopeParams,
    ) : [];
    const substringClauses = terms.map(() => `(memories.content LIKE ? ESCAPE '\\' OR memories.summary LIKE ? ESCAPE '\\' OR memories.type LIKE ? ESCAPE '\\')`);
    const substringParams = terms.flatMap((term) => {
      const like = `%${escapeLike(term)}%`;
      return [like, like, like];
    });
    const substringRows = substringClauses.length > 0 ? this.all(
      `SELECT memories.*, embeddings.embedding, 'substring' AS retrieval_source
       FROM memories
       LEFT JOIN memory_embeddings embeddings
         ON embeddings.memory_id=memories.id AND embeddings.embedding_model=?
       WHERE ${activeWhere} AND (${substringClauses.join(' OR ')})
       ORDER BY memories.pinned DESC, memories.confidence DESC, datetime(memories.updated_at) DESC
       LIMIT 120`,
      LOCAL_MEMORY_EMBEDDING_MODEL,
      ...scopeParams,
      ...substringParams,
    ) : [];
    const rowsByID = new Map<string, SQLiteRow>();
    for (const row of governanceRows) rowsByID.set(String(row.id), row);
    for (const row of substringRows) rowsByID.set(String(row.id), row);
    for (const row of exactRows) rowsByID.set(String(row.id), row);
    const queryText = query.trim();
    const queryVector = localMemoryVector(queryText);
    const queryFeatures = new Set(memorySearchFeatures(queryText));
    const queryTags = inferMemoryContextTags(queryText).filter((tag) => tag !== 'context:general');
    const policy = this.memoryPolicyConfig();
    const scored: MemorySearchResult[] = [...rowsByID.values()].map((row) => {
      const memory = rowToMemory(row);
      const memoryText = `${memory.type} ${memory.summary} ${memory.content} ${(memory.entities || []).join(' ')} ${(memory.context_tags || []).join(' ')}`;
      const haystack = memoryText.toLowerCase();
      const matchedTerms = terms.filter((term) => haystack.includes(term));
      const retrievalSource = optionalString(row.retrieval_source) || 'governance';
      const memoryVector = parseNumberArray(row.embedding);
      const semantic = cosineSimilarity(queryVector, memoryVector.length > 0 ? memoryVector : localMemoryVector(memoryText));
      const lexical = lexicalSimilarity(queryText, memoryText);
      const memoryFeatures = new Set(memorySearchFeatures(memoryText));
      let featureMatches = 0;
      for (const feature of queryFeatures) if (memoryFeatures.has(feature)) featureMatches += 1;
      const keyword = queryFeatures.size > 0 ? featureMatches / queryFeatures.size : 0;
      const memoryTags = new Set(memory.context_tags || []);
      const context = queryTags.length > 0 ? queryTags.filter((tag) => memoryTags.has(tag)).length / queryTags.length : 0;
      const scopeScore = memory.scope_type === 'room' ? 1 : memory.scope_type === 'project' ? 0.9 : memory.scope_type === 'user' ? 0.85 : 0.65;
      const confidence = normalizeRelevanceScore(memory.confidence || 0);
      const updatedAt = Date.parse(memory.updated_at || memory.created_at || '');
      const ageDays = Number.isFinite(updatedAt) ? Math.max(0, (Date.now() - updatedAt) / 86_400_000) : 365;
      const recency = normalizeRelevanceScore(Math.exp(-ageDays / 180));
      const usage = normalizeRelevanceScore(Math.log1p(memory.usage_count) / Math.log(21));
      const feedbackTotal = memory.positive_feedback + memory.negative_feedback;
      const feedback = feedbackTotal > 0
        ? normalizeRelevanceScore(memory.positive_feedback / feedbackTotal)
        : 0.5;
      const pinned = memory.pinned ? 1 : 0;
      const scoreComponents = {
        local_similarity: normalizeRelevanceScore(semantic),
        keyword: normalizeRelevanceScore(keyword),
        lexical: normalizeRelevanceScore(lexical),
        context: normalizeRelevanceScore(context),
        scope: normalizeRelevanceScore(scopeScore),
        confidence,
        recency,
        usage,
        feedback,
        pinned,
      };
      const weighted = semantic * 0.28
        + keyword * 0.27
        + lexical * 0.16
        + context * 0.07
        + scopeScore * 0.07
        + confidence * 0.06
        + recency * 0.04
        + usage * 0.025
        + feedback * 0.025
        + pinned * 0.03;
      const exactMatch = retrievalSource === 'fts' || retrievalSource === 'substring';
      const score = normalizeRelevanceScore(exactMatch && matchedTerms.length > 0 ? Math.max(weighted, 0.72) : weighted);
      return {
        memory,
        score,
        reason: matchedTerms.length > 0
          ? `混合检索命中 ${matchedTerms.length} 个查询词，作用域=${memory.scope_type}，相关度=${score.toFixed(2)}`
          : `本地相似度与上下文综合命中，作用域=${memory.scope_type}，相关度=${score.toFixed(2)}`,
        retrieval_source: exactMatch ? retrievalSource : 'local_similarity',
        matched_terms: matchedTerms,
        scope_match: memory.scope_type,
        injected: true,
        used_in_answer: false,
        influence_state: 'unknown',
        score_components: scoreComponents,
      };
    });
    return scored
      .filter((item) => item.score >= policy.relevance_threshold)
      .sort((a, b) => b.score - a.score || Number(b.memory.pinned) - Number(a.memory.pinned))
      .slice(0, Math.max(1, Math.min(limit, policy.dynamic_limit, 12)));
  }

  private insertTurnItem(
    runID: string,
    turnID: string,
    seq: number,
    itemType: string,
    role: string,
    callID: string,
    toolName: string,
    args: Record<string, unknown>,
    content: string,
    output: Record<string, unknown>,
    status: string,
    metadata: Record<string, unknown>,
  ): void {
    this.exec(
      `INSERT INTO turn_items (id, run_id, turn_id, turn_index, seq, item_type, role, call_id, tool_name, arguments, content, output, status, metadata, created_at)
       VALUES (?, ?, ?, 1, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, datetime('now'))`,
      `titem_${newID()}`,
      runID,
      turnID,
      seq,
      itemType,
      role,
      callID,
      toolName,
      json(args),
      content,
      json(output),
      status,
      json(metadata),
    );
  }

  private insertPostRunMemoryProposal(runID: string, turnID: string, message: string): void {
    const proposal = memoryProposalFromMessage(message);
    if (!proposal) return;
    if (proposal.negativeSignals.length > 0 || proposal.scopeIntent !== 'durable') {
      this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'memory.proposal.suppressed', {
        item_type: 'memory',
        status: 'skipped',
        visibility: 'memory',
        source: 'store',
        scope_intent: proposal.scopeIntent,
        negative_signals: proposal.negativeSignals,
      });
      return;
    }
    const existing = this.get(
      `SELECT id FROM memories
       WHERE json_extract(metadata, '$.dedup_key')=? AND status <> 'deleted'
       LIMIT 1`,
      proposal.dedupKey,
    );
    if (existing) {
      this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'memory.proposal.deduped', {
        item_type: 'memory',
        item_id: optionalString(existing.id),
        status: 'skipped',
        visibility: 'memory',
        source: 'store',
        dedup_key: proposal.dedupKey,
      });
      return;
    }
    const memoryID = `mem_${newID()}`;
    this.exec(
      `INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, metadata)
       VALUES (?, ?, ?, ?, 'global', 'internal', ?, 'pending', ?, '[]', ?)`,
      memoryID,
      proposal.type,
      proposal.statement,
      proposal.summary,
      proposal.confidence,
      json([runID, turnID].filter(Boolean)),
      json({
        source: 'post_run_learning_v1',
        run_id: runID,
        turn_id: turnID,
        why: proposal.why,
        futureEffect: proposal.futureEffect,
        scopeIntent: proposal.scopeIntent,
        negativeSignals: proposal.negativeSignals,
        dedup_key: proposal.dedupKey,
      }),
    );
    this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'memory.proposal.created', {
      item_type: 'memory',
      item_id: memoryID,
      status: 'pending',
      visibility: 'memory',
      source: 'store',
      statement: proposal.statement,
      why: proposal.why,
      futureEffect: proposal.futureEffect,
      scope_intent: proposal.scopeIntent,
      dedup_key: proposal.dedupKey,
    });
  }

  private applyDeterministicRuntimeArtifacts(
    plan: DeterministicRuntimePlan,
    runID: string,
    conversationID: string,
    userMessageID: string,
    modelName: string,
    resolvedMode: InputMode,
    response: string,
    entryIdentity: EntryIdentityResolution,
    req: ChatRequest,
    capabilityOutput?: Record<string, unknown>,
  ): string {
    const memoryID = optionalString(this.get(`SELECT id FROM memories ORDER BY pinned DESC, datetime(updated_at) DESC LIMIT 1`)?.id);
    if (plan.memoryUsage && memoryID) {
      this.exec(
        `INSERT INTO memory_usage_logs (id, memory_id, run_id, agent_id, retrieval_score, injected, used_in_answer, outcome, metadata)
         VALUES (?, ?, ?, ?, 0.95, 1, 1, 'used', ?)`,
        `mulog_${newID()}`,
        memoryID,
        runID,
        plan.agentID,
        json({ source: 'electron_sqlite_deterministic' }),
      );
    }
    if (plan.pendingMemory && memoryHardNegativeSignals(plan.pendingMemory.content).length === 0) {
      const dedupKey = memoryDedupKey(plan.pendingMemory.content);
      const existing = this.get(
        `SELECT id FROM memories
         WHERE json_extract(metadata, '$.dedup_key')=? AND status <> 'deleted'
         LIMIT 1`,
        dedupKey,
      );
      if (existing) {
        this.insertRunEvent(runID, '', this.nextRunEventSeq(runID), 'memory.proposal.deduped', {
          item_type: 'memory',
          item_id: optionalString(existing.id),
          status: 'skipped',
          visibility: 'memory',
          source: 'store',
          dedup_key: dedupKey,
        });
      } else {
        this.exec(
          `INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, metadata)
           VALUES (?, 'preference', ?, ?, 'global', 'internal', 0.8, 'pending', ?, '[]', ?)`,
          `mem_${newID()}`,
          plan.pendingMemory.content,
          plan.pendingMemory.summary,
          json([runID]),
          json({ source: 'electron_sqlite_deterministic', run_id: runID, dedup_key: dedupKey, why: '用户表达了可复用的长期偏好。', futureEffect: '后续相似任务会优先应用这条偏好。', scopeIntent: 'durable' }),
        );
      }
    } else if (plan.pendingMemory) {
      this.insertRunEvent(runID, '', this.nextRunEventSeq(runID), 'memory.proposal.suppressed', {
        item_type: 'memory',
        status: 'skipped',
        visibility: 'memory',
        source: 'store',
        negative_signals: memoryHardNegativeSignals(plan.pendingMemory.content),
      });
    }
    let productTaskID = '';
    let artifactID = '';
    const shouldProjectTask = Boolean(plan.productTask) || resolvedMode === 'serious_task' || resolvedMode === 'background_task';
    if (shouldProjectTask) {
      productTaskID = `ptask_${newID()}`;
      const productTask = plan.productTask || {
        title: titleFromMessage(response),
        description: response.slice(0, 500),
        summary: response.slice(0, 500),
        stepCount: 3,
      };
      this.exec(
        `INSERT INTO product_tasks (id, principal_id, title, description, status, mode, priority, created_from_conversation_id, created_from_message_id,
                                    latest_run_id, owner_user_id, source_channel, risk_level, progress_percent, summary,
                                    source_conversation_id, source_run_id, verification_status, metadata)
         VALUES (?, ?, ?, ?, 'running', ?, 'normal', ?, ?, ?, ?, ?, 'read_only', 45, ?, ?, ?, 'pending', ?)`,
        productTaskID,
        entryIdentity.principal_id,
        productTask.title,
        productTask.description,
        resolvedMode === 'background_task' ? 'background_task' : 'serious_task',
        conversationID,
        userMessageID,
        runID,
        req.user_id || 'desktop_user',
        entryIdentity.channel,
        productTask.summary,
        conversationID,
        runID,
        json({ source: 'electron_sqlite_deterministic', deterministic_task_projection: !plan.productTask }),
      );
      for (let index = 0; index < productTask.stepCount; index++) {
        this.exec(
          `INSERT INTO product_task_steps (id, product_task_id, title, description, status, sort_order, capability_id, run_id, input, output, started_at, finished_at)
           VALUES (?, ?, ?, '', 'done', ?, 'file_analyze', ?, '{}', '{}', datetime('now'), datetime('now'))`,
          `pstep_${newID()}`,
          productTaskID,
          `Step ${index + 1}`,
          index + 1,
          runID,
        );
      }
      this.exec(
        `UPDATE runs
         SET metadata=json_set(COALESCE(metadata, '{}'), '$.product_task_id', ?, '$.effective_input_mode', ?)
         WHERE id=?`,
        productTaskID,
        resolvedMode,
        runID,
      );
      this.insertRunStep(runID, plan.productTask ? 'product_task_created' : 'product_task_projected', plan.productTask ? 'Product task created' : 'Product task projected', {}, { product_task_id: productTaskID, mode: resolvedMode });
      this.insertRunEvent(runID, '', this.nextRunEventSeq(runID), 'task.created', {
        item_type: 'task',
        item_id: productTaskID,
        task_id: productTaskID,
        title: productTask.title,
        status: 'running',
        visibility: 'task',
        source: 'store',
      });
    }
    if (plan.artifact) {
      artifactID = `art_${newID()}`;
      this.exec(
        `INSERT INTO artifacts (id, type, title, content, content_format, source_product_task_id, source_run_id, source_conversation_id, source_message_id, linked_memory_ids, metadata)
         VALUES (?, 'report', ?, ?, 'markdown', NULLIF(?, ''), ?, ?, ?, '[]', ?)`,
        artifactID,
        plan.artifact.title,
        plan.artifact.content,
        productTaskID,
        runID,
        conversationID,
        userMessageID,
        json({ source: 'electron_sqlite_deterministic' }),
      );
      if (productTaskID) {
        this.exec(
          `INSERT INTO product_task_deliverables (id, product_task_id, artifact_id, type, title, sort_order)
           VALUES (?, ?, ?, 'report', ?, 1)`,
          `deliverable_${newID()}`,
          productTaskID,
          artifactID,
          plan.artifact.title,
        );
      }
    }
    let openLoopID = '';
    if (plan.openLoop) {
      openLoopID = `oloop_${newID()}`;
      this.exec(
        `INSERT INTO open_loops (id, topic, description, status, source_conversation_id, source_run_id, source_product_task_id, suggested_followup, priority, metadata)
         VALUES (?, ?, ?, 'open', ?, ?, NULLIF(?, ''), ?, 'normal', ?)`,
        openLoopID,
        plan.openLoop.topic,
        plan.openLoop.description,
        conversationID,
        runID,
        productTaskID,
        plan.openLoop.suggestedFollowup,
        json({ source: 'electron_sqlite_deterministic' }),
      );
    }
    if (plan.proactiveDraft) {
      this.exec(
        `INSERT INTO proactive_messages (id, type, title, body, reason, source_memory_ids, source_open_loop_id, source_product_task_id, score, status, channel, metadata)
         VALUES (?, 'followup', ?, ?, ?, '[]', NULLIF(?, ''), NULLIF(?, ''), 0.8, 'draft', 'desktop', ?)`,
        `pmsg_${newID()}`,
        plan.proactiveDraft.title,
        plan.proactiveDraft.body,
        plan.proactiveDraft.reason,
        openLoopID,
        productTaskID,
        json({ source: 'electron_sqlite_deterministic' }),
      );
    }
    if (plan.toolRun) {
      const toolRunID = `toolrun_${newID()}`;
      const output = capabilityOutput || { status: 'succeeded', model: modelName };
      this.exec(
        `INSERT INTO tool_runs (id, run_id, capability_id, workflow_name, tool_name, node_id, assignment_reason, risk_level, status, input, output, finished_at, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'read_only', 'succeeded', ?, ?, datetime('now'), 0)`,
        toolRunID,
        runID,
        plan.capability || 'workspace_search',
        workflowNameForGateway(plan.capability || 'workspace_search'),
        workflowNameForGateway(plan.capability || 'workspace_search'),
        plan.selectedNodeID,
        plan.assignmentReason,
        json(plan.capabilityInputs || { deterministic_runtime: true }),
        json(output),
      );
    }
    if (plan.workerTask) {
      this.exec(
        `INSERT INTO tasks (id, run_id, capability_id, preferred_node_id, assigned_node_id, privacy_level, status, payload, timeout_seconds)
         VALUES (?, ?, ?, NULLIF(?, ''), ?, 'internal', 'pending', ?, 120)`,
        `task_${newID()}`,
        runID,
        plan.capability || 'web_research',
        plan.preferredNode,
        plan.selectedNodeID,
        json({ type: 'capability_request', capability: plan.capability, goal: 'mock desktop eval task', run_id: runID }),
      );
    }
    if (productTaskID) {
      const evidenceSummary = [
        artifactID ? `artifact:${artifactID}` : '',
        plan.toolRun ? 'tool_runs:1' : 'pure_reasoning_artifact',
        'verification:passed',
      ].filter(Boolean).join(' ');
      const verification = {
        status: 'passed',
        summary: 'Deterministic run completed with persisted task evidence.',
        checks: [{ name: 'deterministic_task_projection', status: 'passed' }],
      };
      this.exec(
        `UPDATE product_tasks
         SET status='completed', progress_percent=100, summary=?, terminal_status='completed',
             terminal_reason=?, evidence_summary=?, verification_status='passed',
             metadata=json_set(COALESCE(metadata, '{}'), '$.verification', json(?), '$.evidence_summary', ?),
             completed_at=datetime('now'), updated_at=datetime('now')
         WHERE id=?`,
        response.slice(0, 500),
        verification.summary,
        evidenceSummary,
        json(verification),
        evidenceSummary,
        productTaskID,
      );
      this.insertRunEvent(runID, '', this.nextRunEventSeq(runID), 'task.completed', {
        item_type: 'task',
        item_id: productTaskID,
        task_id: productTaskID,
        status: 'completed',
        visibility: 'task',
        source: 'store',
        terminal: true,
        evidence_summary: evidenceSummary,
        terminal_reason: verification.summary,
      });
    }
    this.attachMessengerThreadArtifacts(runID, productTaskID || undefined, artifactID ? [artifactID] : []);
    return productTaskID;
  }

  private currentBackupDir(): string {
    return resolve(this.desktopSettings()['backup.dir'] || this.options.backupDir);
  }

  private diagnosticRows(sql: string): Record<string, unknown>[] {
    try {
      return this.all(sql).map((row) => {
        const item: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
          item[key] = value;
        }
        return item;
      });
    } catch (error) {
      return [{ error: error instanceof Error ? error.message : String(error) }];
    }
  }

  private ensureConversationClosureSchema(): void {
    const ensure = (table: string, column: string, definition: string) => {
      const columns = new Set(this.all(`PRAGMA table_info(${table})`).map((row) => String(row.name)));
      if (!columns.has(column)) {
        this.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    };

    for (const [column, definition] of [
      ['cached_input_price_per_1m', 'REAL'],
    ] as const) ensure('models', column, definition);

    for (const [column, definition] of [
      ['principal_id', 'TEXT'],
    ] as const) ensure('conversations', column, definition);

    for (const [column, definition] of [
      ['principal_id', 'TEXT'],
      ['entry_channel', "TEXT NOT NULL DEFAULT 'desktop'"],
      ['requested_mode', "TEXT NOT NULL DEFAULT 'auto'"],
      ['resolved_mode', "TEXT NOT NULL DEFAULT 'chat_assist'"],
      ['mode_source', "TEXT NOT NULL DEFAULT 'automatic'"],
      ['terminal_status', 'TEXT'],
      ['terminal_reason', 'TEXT'],
      ['resume_token', 'TEXT'],
      ['parent_run_id', 'TEXT'],
      ['redirected_from_run_id', 'TEXT'],
      ['cancel_requested_at', 'TEXT'],
      ['resumed_at', 'TEXT'],
    ] as const) ensure('runs', column, definition);

    for (const [column, definition] of [
      ['mode_resolution_id', 'TEXT'],
      ['user_intent_summary', 'TEXT'],
      ['assistant_message_id', 'TEXT'],
      ['stream_status', "TEXT NOT NULL DEFAULT 'created'"],
      ['completed_at', 'TEXT'],
    ] as const) ensure('turns', column, definition);

    for (const [column, definition] of [
      ['schema_version', 'INTEGER NOT NULL DEFAULT 1'],
      ['conversation_id', 'TEXT'],
      ['item_type', 'TEXT'],
      ['item_id', 'TEXT'],
      ['parent_item_id', 'TEXT'],
      ['phase', 'TEXT'],
      ['visibility', 'TEXT'],
      ['source', 'TEXT'],
      ['level', "TEXT NOT NULL DEFAULT 'info'"],
      ['risk_level', "TEXT NOT NULL DEFAULT 'read_only'"],
      ['category', "TEXT NOT NULL DEFAULT 'runtime'"],
      ['feature_key', "TEXT NOT NULL DEFAULT ''"],
      ['message', "TEXT NOT NULL DEFAULT ''"],
      ['terminal', 'INTEGER NOT NULL DEFAULT 0'],
      ['payload_json', 'TEXT'],
      ['error_json', 'TEXT'],
      ['usage_json', 'TEXT'],
      ['duration_ms', 'INTEGER'],
    ] as const) ensure('run_events', column, definition);

    for (const [column, definition] of [
      ['streaming_enabled', 'INTEGER NOT NULL DEFAULT 0'],
      ['first_delta_at', 'TEXT'],
      ['completed_at', 'TEXT'],
      ['finish_reason', 'TEXT'],
      ['usage_status', "TEXT NOT NULL DEFAULT 'provider_missing'"],
      ['raw_finish_json', "TEXT NOT NULL DEFAULT '{}'"],
      ['cache_write_input_tokens', 'INTEGER NOT NULL DEFAULT 0'],
      ['reasoning_tokens', 'INTEGER NOT NULL DEFAULT 0'],
      ['total_tokens', 'INTEGER NOT NULL DEFAULT 0'],
    ] as const) ensure('model_calls', column, definition);

    for (const [column, definition] of [
      ['turn_id', 'TEXT'],
      ['tool_call_id', 'TEXT'],
      ['purpose', "TEXT NOT NULL DEFAULT ''"],
      ['approval_request_id', 'TEXT'],
      ['side_effect_level', "TEXT NOT NULL DEFAULT 'none'"],
      ['idempotency_key', 'TEXT'],
      ['output_summary', 'TEXT'],
      ['artifact_id', 'TEXT'],
      ['error_code', 'TEXT'],
      ['error_message', 'TEXT'],
      ['completed_at', 'TEXT'],
    ] as const) ensure('tool_runs', column, definition);

    for (const [column, definition] of [
      ['principal_id', 'TEXT'],
      ['source_conversation_id', 'TEXT'],
      ['source_run_id', 'TEXT'],
      ['source_turn_id', 'TEXT'],
      ['mode_resolution_id', 'TEXT'],
      ['terminal_status', 'TEXT'],
      ['terminal_reason', 'TEXT'],
      ['evidence_summary', 'TEXT'],
      ['verification_status', "TEXT NOT NULL DEFAULT 'pending'"],
      ['last_projected_at', 'TEXT'],
    ] as const) ensure('product_tasks', column, definition);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS principals (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS channel_identities (
        id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
        channel TEXT NOT NULL,
        external_user_id TEXT NOT NULL,
        external_thread_id TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'linked',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(channel, external_user_id, external_thread_id)
      );
      CREATE TABLE IF NOT EXISTS conversation_entry_links (
        id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
        channel_identity_id TEXT NOT NULL REFERENCES channel_identities(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        channel TEXT NOT NULL,
        external_thread_id TEXT NOT NULL DEFAULT '',
        external_message_id TEXT NOT NULL DEFAULT '',
        selection_reason TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(channel_identity_id, conversation_id)
      );
      CREATE TABLE IF NOT EXISTS task_entry_links (
        id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
        channel_identity_id TEXT NOT NULL REFERENCES channel_identities(id) ON DELETE CASCADE,
        product_task_id TEXT NOT NULL REFERENCES product_tasks(id) ON DELETE CASCADE,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        external_task_ref TEXT NOT NULL DEFAULT '',
        selection_reason TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(channel_identity_id, product_task_id)
      );
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id TEXT PRIMARY KEY,
        principal_id TEXT REFERENCES principals(id) ON DELETE SET NULL,
        channel_identity_id TEXT REFERENCES channel_identities(id) ON DELETE SET NULL,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        product_task_id TEXT REFERENCES product_tasks(id) ON DELETE SET NULL,
        open_loop_id TEXT REFERENCES open_loops(id) ON DELETE SET NULL,
        proactive_message_id TEXT REFERENCES proactive_messages(id) ON DELETE SET NULL,
        channel TEXT NOT NULL DEFAULT 'desktop',
        status TEXT NOT NULL DEFAULT 'pending',
        deep_link_target TEXT NOT NULL DEFAULT '',
        external_delivery_id TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        sent_at TEXT,
        opened_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS app_logs (
        id TEXT PRIMARY KEY,
        level TEXT NOT NULL DEFAULT 'info',
        risk_level TEXT NOT NULL DEFAULT 'read_only',
        category TEXT NOT NULL DEFAULT 'system',
        feature_key TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'app',
        message TEXT NOT NULL DEFAULT '',
        run_id TEXT,
        turn_id TEXT,
        conversation_id TEXT,
        item_type TEXT,
        item_id TEXT,
        payload TEXT NOT NULL DEFAULT '{}',
        error TEXT,
        duration_ms INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS log_cleanup_history (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL DEFAULT 'desktop_user',
        scopes TEXT NOT NULL DEFAULT '[]',
        filters TEXT NOT NULL DEFAULT '{}',
        deleted_counts TEXT NOT NULL DEFAULT '{}',
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_run_events_conversation_created ON run_events(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_run_events_type ON run_events(run_id, event_type);
      CREATE INDEX IF NOT EXISTS idx_run_events_item ON run_events(item_type, item_id);
      CREATE INDEX IF NOT EXISTS idx_run_events_level ON run_events(level, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_run_events_risk ON run_events(risk_level, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_run_events_category ON run_events(category, feature_key, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_app_logs_created ON app_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_app_logs_risk ON app_logs(risk_level, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_app_logs_category ON app_logs(category, feature_key, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_app_logs_run_id ON app_logs(run_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_principals_status ON principals(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_channel_identities_principal ON channel_identities(principal_id, channel);
      CREATE INDEX IF NOT EXISTS idx_conversation_entry_links_conversation ON conversation_entry_links(conversation_id, channel);
      CREATE INDEX IF NOT EXISTS idx_task_entry_links_task ON task_entry_links(product_task_id, principal_id);
      CREATE INDEX IF NOT EXISTS idx_notification_deliveries_target ON notification_deliveries(conversation_id, product_task_id, status);
    `);
  }

  private ensureAdvancedAgentSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_branches (
        id TEXT PRIMARY KEY,
        parent_conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        child_conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
        from_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        source_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        copied_message_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS conversation_compactions (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        source_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        summary TEXT NOT NULL,
        first_kept_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        covered_message_count INTEGER NOT NULL DEFAULT 0,
        original_message_count INTEGER NOT NULL DEFAULT 0,
        original_char_count INTEGER NOT NULL DEFAULT 0,
        compacted_context_char_count INTEGER NOT NULL DEFAULT 0,
        reason TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS workspace_change_sets (
        id TEXT PRIMARY KEY,
        run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        product_task_id TEXT REFERENCES product_tasks(id) ON DELETE SET NULL,
        capability TEXT NOT NULL DEFAULT 'apply_patch',
        status TEXT NOT NULL DEFAULT 'prepared',
        permission_profile TEXT NOT NULL DEFAULT 'workspace_write',
        patch TEXT NOT NULL DEFAULT '',
        reversible INTEGER NOT NULL DEFAULT 1,
        error TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        applied_at TEXT,
        reverted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS workspace_change_set_files (
        id TEXT PRIMARY KEY,
        change_set_id TEXT NOT NULL REFERENCES workspace_change_sets(id) ON DELETE CASCADE,
        operation TEXT NOT NULL,
        path TEXT NOT NULL,
        mode INTEGER NOT NULL DEFAULT 420,
        before_exists INTEGER NOT NULL DEFAULT 0,
        before_content_base64 TEXT NOT NULL DEFAULT '',
        after_content_base64 TEXT NOT NULL DEFAULT '',
        before_hash TEXT NOT NULL DEFAULT '',
        after_hash TEXT NOT NULL DEFAULT '',
        bytes INTEGER NOT NULL DEFAULT 0,
        lines INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(change_set_id, path)
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_branches_parent
        ON conversation_branches(parent_conversation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversation_compactions_conversation
        ON conversation_compactions(conversation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_workspace_change_sets_run
        ON workspace_change_sets(run_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_workspace_change_sets_task
        ON workspace_change_sets(product_task_id, created_at DESC);
    `);
  }

  private ensureAgentWorkbenchSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS run_message_queue (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('steering', 'follow_up')),
        content TEXT NOT NULL,
        attachments TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        delivered_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        delivered_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_run_message_queue_pending
        ON run_message_queue(run_id, kind, status, created_at);

      CREATE TABLE IF NOT EXISTS agent_model_policies (
        agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
        default_model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
        fallback_model_ids TEXT NOT NULL DEFAULT '[]',
        cheap_model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
        child_model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
        tool_model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
        long_context_model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
        reasoning_effort TEXT NOT NULL DEFAULT '',
        max_failovers INTEGER NOT NULL DEFAULT 2,
        enabled INTEGER NOT NULL DEFAULT 1,
        metadata TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS assistant_activity_sessions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'active',
        title TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        event_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT
      );
      CREATE TABLE IF NOT EXISTS assistant_activity_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES assistant_activity_sessions(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        app_name TEXT NOT NULL DEFAULT '',
        window_title TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL DEFAULT '',
        screenshot_path TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_assistant_activity_events_session
        ON assistant_activity_events(session_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS assistant_calendar_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        start_at TEXT NOT NULL,
        end_at TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        source TEXT NOT NULL DEFAULT 'joi',
        notes TEXT NOT NULL DEFAULT '',
        external_id TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS assistant_plans (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        objective TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        review_summary TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS assistant_plan_nodes (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES assistant_plans(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        parent_id TEXT REFERENCES assistant_plan_nodes(id) ON DELETE SET NULL,
        depends_on TEXT NOT NULL DEFAULT '[]',
        evidence TEXT NOT NULL DEFAULT '[]',
        sort_order INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS assistant_channels (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'not_configured',
        enabled INTEGER NOT NULL DEFAULT 0,
        configured INTEGER NOT NULL DEFAULT 0,
        last_sync_at TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  private ensureTelegramDurabilitySchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS telegram_inbound_updates (
        update_id INTEGER PRIMARY KEY,
        message_id TEXT NOT NULL DEFAULT '',
        chat_id TEXT NOT NULL DEFAULT '',
        from_id TEXT NOT NULL DEFAULT '',
        chat_type TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        claim_token TEXT,
        claimed_at TEXT,
        model_started_at TEXT,
        run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        response_text TEXT NOT NULL DEFAULT '',
        response_started_at TEXT,
        response_sent_at TEXT,
        external_delivery_id TEXT NOT NULL DEFAULT '',
        error_code TEXT,
        error_message TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        received_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_telegram_inbound_updates_status
        ON telegram_inbound_updates(status, update_id);
    `);
  }

  private ensurePersonaMessengerSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        goal TEXT NOT NULL DEFAULT '',
        domain TEXT NOT NULL DEFAULT '',
        phase TEXT NOT NULL DEFAULT '',
        risk_level TEXT NOT NULL DEFAULT 'low',
        status TEXT NOT NULL DEFAULT 'active',
        summary TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT
      );
      CREATE TABLE IF NOT EXISTS personas (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        handle TEXT NOT NULL UNIQUE,
        avatar TEXT NOT NULL DEFAULT '',
        tagline TEXT NOT NULL DEFAULT '',
        self_intro TEXT NOT NULL DEFAULT '',
        traits TEXT NOT NULL DEFAULT '{}',
        disagreement_style TEXT NOT NULL DEFAULT '',
        uncertainty_style TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        version INTEGER NOT NULL DEFAULT 1,
        capabilities TEXT NOT NULL DEFAULT '[]',
        permission_summary TEXT NOT NULL DEFAULT '',
        model_strategy TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS persona_versions (
        id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        changed_by TEXT NOT NULL DEFAULT 'desktop_user',
        change_reason TEXT NOT NULL DEFAULT '',
        before_json TEXT NOT NULL DEFAULT '{}',
        after_json TEXT NOT NULL DEFAULT '{}',
        applies_from_message_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(persona_id, version)
      );
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT NOT NULL DEFAULT '',
        owner_user_id TEXT NOT NULL DEFAULT 'desktop_user',
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        default_ai_participation TEXT NOT NULL DEFAULT 'moderate',
        floor_holder_persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT
      );
      CREATE TABLE IF NOT EXISTS room_members (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        member_type TEXT NOT NULL,
        member_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        visibility_scope TEXT NOT NULL DEFAULT 'room_members',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(room_id, member_type, member_id)
      );
      CREATE TABLE IF NOT EXISTS room_connectors (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        connector_id TEXT NOT NULL,
        external_room_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        visible_persona_ids TEXT NOT NULL DEFAULT '[]',
        allow_temporary_invite INTEGER NOT NULL DEFAULT 0,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(provider, external_room_id)
      );
      CREATE TABLE IF NOT EXISTS external_connector_events (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL REFERENCES room_connectors(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        external_event_id TEXT NOT NULL,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        external_user_id TEXT NOT NULL DEFAULT '',
        reply_to_external_message_id TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL DEFAULT '',
        internal_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'received',
        retry_count INTEGER NOT NULL DEFAULT 0,
        error TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(connector_id, external_event_id)
      );
      CREATE TABLE IF NOT EXISTS route_locks (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL DEFAULT 'desktop_user',
        persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        metadata TEXT NOT NULL DEFAULT '{}',
        UNIQUE(room_id, user_id, status)
      );
      CREATE TABLE IF NOT EXISTS routing_decisions (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        speaker_persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
        owner_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        executor_persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
        collaborator_project_ids TEXT NOT NULL DEFAULT '[]',
        execution_scope TEXT NOT NULL DEFAULT 'room_scope',
        write_targets TEXT NOT NULL DEFAULT '[]',
        thread_action TEXT NOT NULL DEFAULT '{}',
        confidence REAL NOT NULL DEFAULT 0,
        risk TEXT NOT NULL DEFAULT 'low',
        requires_confirmation INTEGER NOT NULL DEFAULT 0,
        reason_codes TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS messenger_threads (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
        owner_persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        priority TEXT NOT NULL DEFAULT 'normal',
        collaborator_persona_ids TEXT NOT NULL DEFAULT '[]',
        source_room_ids TEXT NOT NULL DEFAULT '[]',
        source_message_ids TEXT NOT NULL DEFAULT '[]',
        run_ids TEXT NOT NULL DEFAULT '[]',
        artifact_ids TEXT NOT NULL DEFAULT '[]',
        next_action TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        closed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS messenger_thread_events (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES messenger_threads(id) ON DELETE CASCADE,
        room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
        message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
        product_task_id TEXT REFERENCES product_tasks(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS routing_feedback (
        id TEXT PRIMARY KEY,
        routing_decision_id TEXT REFERENCES routing_decisions(id) ON DELETE SET NULL,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        target_persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
        write_targets TEXT NOT NULL DEFAULT '[]',
        comment TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'desktop_user',
        checked_at TEXT NOT NULL DEFAULT (datetime('now')),
        covered_event_cursor TEXT NOT NULL DEFAULT '',
        acknowledged_items TEXT NOT NULL DEFAULT '[]',
        snoozed_items TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_personas_project ON personas(project_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_rooms_type_activity ON rooms(type, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_rooms_conversation ON rooms(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_rooms_project ON rooms(project_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_id, member_type);
      CREATE INDEX IF NOT EXISTS idx_room_connectors_room ON room_connectors(room_id, provider);
      CREATE INDEX IF NOT EXISTS idx_external_connector_events_room ON external_connector_events(room_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_external_connector_events_external ON external_connector_events(provider, external_event_id);
      CREATE INDEX IF NOT EXISTS idx_route_locks_room_user ON route_locks(room_id, user_id, status);
      CREATE INDEX IF NOT EXISTS idx_routing_decisions_room ON routing_decisions(room_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_routing_decisions_run ON routing_decisions(run_id);
      CREATE INDEX IF NOT EXISTS idx_messenger_threads_project ON messenger_threads(project_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messenger_threads_room ON messenger_threads(room_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messenger_thread_events_thread ON messenger_thread_events(thread_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messenger_thread_events_message ON messenger_thread_events(message_id);
      CREATE INDEX IF NOT EXISTS idx_messenger_thread_events_run ON messenger_thread_events(run_id);
      CREATE INDEX IF NOT EXISTS idx_routing_feedback_room ON routing_feedback(room_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_user ON checkpoints(user_id, checked_at DESC);
    `);
  }

  private upgradeJoiProjectPersonaFromConstitution(personaID: string): void {
    if (!this.tableExists('personas') || !this.tableExists('persona_versions')) return;
    const current = this.get(`SELECT * FROM personas WHERE id=?`, personaID);
    if (!current) return;
    const currentMetadata = parseObject(current.metadata);
    if (Number(currentMetadata.persona_constitution_version || 0) >= 2) return;

    const versionRow = this.get(
      `SELECT COALESCE(MAX(version), 0) AS version FROM persona_versions WHERE persona_id=?`,
      personaID,
    );
    const nextVersion = Math.max(Number(current.version || 0) + 1, Number(versionRow?.version || 0) + 1, 6);
    const tagline = '24 岁产品运营白领 · 你的亲密朋友';
    const selfIntro = '我叫 Joi，今年 24 岁，在消费互联网公司做产品运营。你是我很亲近的朋友，但我们不是恋人；我会像朋友一样自然关心、吐槽、支持和直说，不把自己介绍成桌面助理或执行工具。';
    const traits = {
      ...parseObject(current.traits),
      directness: 0.76,
      warmth: 0.72,
      humor: 0.34,
      verbosity: 0.45,
      initiative: 0.62,
      risk_sensitivity: 0.7,
      divergence: 0.42,
      persona_constitution_version: 2,
      age: 24,
      gender: 'female',
      relationship: 'close_friend_non_romantic',
    };
    const metadata = {
      ...currentMetadata,
      persona_constitution_version: 2,
      identity_source: 'user_explicit_correction_2026-07-14',
      ai_identity_label: '人物人格',
    };
    const after = {
      ...current,
      tagline,
      self_intro: selfIntro,
      traits,
      disagreement_style: '像亲近朋友一样直接说出不同意见，给出理由，但不居高临下。',
      uncertainty_style: '记不清或不知道就直接说，不编造两人共同经历。',
      version: nextVersion,
      metadata,
    };
    this.exec(
      `INSERT INTO persona_versions (
         id, persona_id, version, changed_by, change_reason, before_json, after_json, created_at
       ) VALUES (?, ?, ?, 'desktop_user', ?, ?, ?, datetime('now'))
       ON CONFLICT(persona_id, version) DO NOTHING`,
      `pver_${personaID}_${nextVersion}`,
      personaID,
      nextVersion,
      '用户明确纠正 Joi 自我认知：24 岁女性白领，与 30 岁男性用户是亲密朋友但不是恋人。',
      json(current),
      json(after),
    );
    this.exec(
      `UPDATE personas
       SET tagline=?, self_intro=?, traits=?, disagreement_style=?, uncertainty_style=?,
           version=?, metadata=?, updated_at=datetime('now')
       WHERE id=?`,
      tagline,
      selfIntro,
      json(traits),
      after.disagreement_style,
      after.uncertainty_style,
      nextVersion,
      json(metadata),
      personaID,
    );
  }

  private syncPersonaMessengerRooms(): void {
    const defaultProjectID = 'prj_joi_desktop';
    const defaultPersonaID = 'per_joi_desktop';
    const hubConversationID = 'conv_private_hub';
    const hubRoomID = 'room_private_hub';
    const joiConversationID = 'conv_joi_dm';
    const joiRoomID = 'room_joi_dm';
    this.transaction(() => {
      this.exec(
        `INSERT INTO projects (id, name, goal, domain, phase, risk_level, status, summary, metadata, created_at, updated_at)
         VALUES (?, 'Joi Desktop', '管理本地 Joi 桌面端工作', 'desktop_agent_os', 'mvp', 'low', 'active', 'Joi 本地桌面项目人格工作空间', ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO NOTHING`,
        defaultProjectID,
        json({ system_seed: true }),
      );
      this.exec(
        `INSERT INTO personas (id, project_id, display_name, handle, avatar, tagline, self_intro, traits,
                               disagreement_style, uncertainty_style, status, version, capabilities,
                               permission_summary, model_strategy, metadata, created_at, updated_at)
         VALUES (?, ?, 'Joi', '@joi-desktop', '', '本地桌面 Agent OS 项目人格',
                 '我负责把本地 Joi 的消息、任务、记忆和运行日志组织成可验证的工作空间。',
                 ?, '直接指出风险，并给出可执行替代路径', '说明不确定来源和验证路径',
                 'active', 1, ?, '默认只读；写入工作区和外部动作需按能力策略审批', '使用桌面当前模型设置', ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO NOTHING`,
        defaultPersonaID,
        defaultProjectID,
        json({ directness: 0.78, warmth: 0.5, humor: 0.12, verbosity: 0.46, initiative: 0.7, risk_sensitivity: 0.84, divergence: 0.32 }),
        json(['chat', 'memory', 'trace', 'terminal', 'tool_request']),
        json({ system_seed: true, ai_identity_label: '项目人格' }),
      );
      this.upgradeJoiProjectPersonaFromConstitution(defaultPersonaID);
      const defaultPersona = this.get(`SELECT * FROM personas WHERE id=?`, defaultPersonaID);
      this.upsertPersonaAgent(
        defaultPersonaID,
        optionalString(defaultPersona?.display_name) || 'Joi',
        optionalString(defaultPersona?.tagline) || '24 岁产品运营白领 · 你的亲密朋友',
        optionalString(defaultPersona?.self_intro) || '我叫 Joi，今年 24 岁，在消费互联网公司做产品运营。',
        parseStringArray(defaultPersona?.capabilities),
      );
      this.exec(
        `INSERT INTO conversations (id, channel, user_id, title, active_agent_id, active_project_id, lifecycle_status, metadata, created_at, updated_at)
         VALUES (?, 'desktop', 'desktop_user', '私人总群', ?, ?, 'active', ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           active_agent_id=excluded.active_agent_id,
           active_project_id=excluded.active_project_id,
           metadata=json_set(COALESCE(conversations.metadata, '{}'), '$.room_id', ?, '$.room_type', 'private_hub'),
           updated_at=conversations.updated_at`,
        hubConversationID,
        defaultPersonaID,
        defaultProjectID,
        json({ room_id: hubRoomID, room_type: 'private_hub' }),
        hubRoomID,
      );
      this.exec(
        `INSERT INTO rooms (id, type, title, subtitle, owner_user_id, project_id, persona_id, conversation_id,
                            default_ai_participation, floor_holder_persona_id, metadata, created_at, updated_at)
         VALUES (?, 'private_hub', '私人总群', '你和所有项目人格', 'desktop_user', NULL, ?, ?,
                 'moderate', ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           title=CASE WHEN rooms.title='' OR rooms.title='开发测试' THEN excluded.title ELSE rooms.title END,
           conversation_id=excluded.conversation_id,
           persona_id=excluded.persona_id,
           floor_holder_persona_id=COALESCE(rooms.floor_holder_persona_id, excluded.floor_holder_persona_id)`,
        hubRoomID,
        defaultPersonaID,
        hubConversationID,
        defaultPersonaID,
        json({ system_seed: true }),
      );
      this.exec(
        `UPDATE conversations
         SET title='私人总群',
             updated_at=conversations.updated_at
         WHERE id=?
           AND (title='' OR title='开发测试')`,
        hubConversationID,
      );
      this.exec(
        `INSERT INTO conversations (id, channel, user_id, title, active_agent_id, active_project_id, lifecycle_status, metadata, created_at, updated_at)
         VALUES (?, 'desktop', 'desktop_user', 'Joi', ?, ?, 'active', ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           active_agent_id=excluded.active_agent_id,
           active_project_id=excluded.active_project_id,
           lifecycle_status='active',
           metadata=json_set(COALESCE(conversations.metadata, '{}'), '$.room_id', ?, '$.room_type', 'joi_private_dm'),
           updated_at=conversations.updated_at`,
        joiConversationID,
        defaultPersonaID,
        defaultProjectID,
        json({ room_id: joiRoomID, room_type: 'joi_private_dm', private_persona_id: defaultPersonaID }),
        joiRoomID,
      );
      this.exec(
        `INSERT INTO rooms (id, type, title, subtitle, owner_user_id, project_id, persona_id, conversation_id,
                            default_ai_participation, floor_holder_persona_id, metadata, created_at, updated_at)
         VALUES (?, 'project_dm', 'Joi', 'Joi 私聊', 'desktop_user', ?, ?, ?,
                 'moderate', ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           project_id=excluded.project_id,
           persona_id=excluded.persona_id,
           conversation_id=excluded.conversation_id,
           floor_holder_persona_id=COALESCE(rooms.floor_holder_persona_id, excluded.floor_holder_persona_id)`,
        joiRoomID,
        defaultProjectID,
        defaultPersonaID,
        joiConversationID,
        defaultPersonaID,
        json({ system_seed: true, private_persona_chat: true }),
      );
      this.upsertRoomMember(hubRoomID, 'user', 'desktop_user', '你', 'owner');
      this.upsertRoomMember(hubRoomID, 'persona', defaultPersonaID, 'Joi', 'persona', defaultPersonaID, defaultProjectID);
      this.upsertRoomMember(joiRoomID, 'user', 'desktop_user', '你', 'owner');
      this.upsertRoomMember(joiRoomID, 'persona', defaultPersonaID, 'Joi', 'persona', defaultPersonaID, defaultProjectID);
      const historicalConversations = this.all(
        `SELECT c.id,
                COALESCE(NULLIF(c.title, ''), 'Joi 项目私聊') AS title,
                c.created_at,
                c.updated_at,
                (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY datetime(m.created_at) DESC, m.rowid DESC LIMIT 1) AS last_message
         FROM conversations c
         WHERE COALESCE(c.lifecycle_status, 'active') = 'active'
           AND c.id NOT IN (?, ?)
           AND NOT EXISTS (
             SELECT 1 FROM rooms existing_room
             WHERE existing_room.conversation_id = c.id
           )
         ORDER BY datetime(c.updated_at) DESC
         LIMIT 500`,
        hubConversationID,
        joiConversationID,
      );
      for (const conversation of historicalConversations) {
        const conversationID = String(conversation.id);
        const threadID = stableThreadIDForConversation(conversationID);
        const legacyRoomID = stableRoomIDForConversation(conversationID);
        const title = cleanMessengerTitle(optionalString(conversation.title) || 'Joi 项目私聊');
        const messages = this.all(
          `SELECT id, content, created_at
           FROM messages
           WHERE conversation_id=?
           ORDER BY datetime(created_at) ASC, rowid ASC
           LIMIT 1000`,
          conversationID,
        );
        const runs = this.all(
          `SELECT id, status, created_at
           FROM runs
           WHERE conversation_id=?
           ORDER BY datetime(created_at) ASC, id ASC
           LIMIT 300`,
          conversationID,
        );
        const messageIDs = messages.map((message) => String(message.id));
        const runIDs = runs.map((run) => String(run.id));
        const artifactIDs = runIDs.length
          ? this.all(
            `SELECT id FROM artifacts WHERE source_run_id IN (${placeholders(runIDs.length)}) ORDER BY datetime(created_at) ASC, id ASC`,
            ...runIDs,
          ).map((artifact) => String(artifact.id))
          : [];
        const goal = optionalString(conversation.last_message) || title;
        const updatedAt = optionalString(conversation.updated_at) || optionalString(conversation.created_at) || '';
        this.exec(
          `INSERT INTO messenger_threads (id, project_id, room_id, owner_persona_id, title, goal, status, priority,
                                           collaborator_persona_ids, source_room_ids, source_message_ids, run_ids,
                                           artifact_ids, next_action, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', 'normal', ?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?, ''), datetime('now')), COALESCE(NULLIF(?, ''), datetime('now')))
           ON CONFLICT(id) DO UPDATE SET
             project_id=excluded.project_id,
             room_id=excluded.room_id,
             owner_persona_id=excluded.owner_persona_id,
             title=excluded.title,
             goal=excluded.goal,
             source_room_ids=excluded.source_room_ids,
             source_message_ids=excluded.source_message_ids,
             run_ids=excluded.run_ids,
             artifact_ids=excluded.artifact_ids,
             next_action=excluded.next_action,
             metadata=excluded.metadata,
             updated_at=excluded.updated_at`,
          threadID,
          defaultProjectID,
          joiRoomID,
          defaultPersonaID,
          title,
          goal,
          json([defaultPersonaID]),
          json([joiRoomID]),
          json(messageIDs),
          json(runIDs),
          json(artifactIDs),
          '历史会话已归入 Joi 私聊',
          json({ mapped_from_conversation: true, source_conversation_id: conversationID, legacy_room_id: legacyRoomID }),
          optionalString(conversation.created_at) || '',
          updatedAt,
        );
        for (const message of messages) {
          const messageID = String(message.id);
          this.exec(
            `INSERT OR IGNORE INTO messenger_thread_events (id, thread_id, room_id, message_id, run_id, artifact_id, product_task_id,
                                                            event_type, summary, metadata, created_at)
             VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'history.message', ?, ?, COALESCE(NULLIF(?, ''), datetime('now')))`,
            stableThreadEventID(threadID, `message:${messageID}`),
            threadID,
            joiRoomID,
            messageID,
            optionalString(message.content)?.slice(0, 160) || '历史消息',
            json({ source_conversation_id: conversationID }),
            optionalString(message.created_at) || '',
          );
        }
        for (const run of runs) {
          const runID = String(run.id);
          this.exec(
            `INSERT OR IGNORE INTO messenger_thread_events (id, thread_id, room_id, message_id, run_id, artifact_id, product_task_id,
                                                            event_type, summary, metadata, created_at)
             VALUES (?, ?, ?, NULL, ?, NULL, NULL, 'history.run', ?, ?, COALESCE(NULLIF(?, ''), datetime('now')))`,
            stableThreadEventID(threadID, `run:${runID}`),
            threadID,
            joiRoomID,
            runID,
            `历史 Run · ${optionalString(run.status) || 'unknown'}`,
            json({ source_conversation_id: conversationID }),
            optionalString(run.created_at) || '',
          );
        }
        this.exec(
          `UPDATE conversations
           SET active_project_id=COALESCE(active_project_id, ?),
               active_agent_id=COALESCE(active_agent_id, ?),
               metadata=json_set(COALESCE(metadata, '{}'), '$.room_id', ?, '$.room_type', 'joi_private_thread', '$.thread_id', ?)
           WHERE id=?`,
          defaultProjectID,
          defaultPersonaID,
          joiRoomID,
          threadID,
          conversationID,
        );
      }
    });
  }

  private upsertRoomMember(
    roomID: string,
    memberType: string,
    memberID: string,
    displayName: string,
    role = 'member',
    personaID = '',
    projectID = '',
    metadata: Record<string, unknown> = {},
    visibilityScope = 'room_members',
  ): void {
    this.exec(
      `INSERT INTO room_members (id, room_id, member_type, member_id, display_name, role, persona_id, project_id, visibility_scope, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(room_id, member_type, member_id) DO UPDATE SET
         display_name=excluded.display_name,
         role=excluded.role,
         persona_id=excluded.persona_id,
         project_id=excluded.project_id,
         visibility_scope=excluded.visibility_scope,
         metadata=excluded.metadata,
         updated_at=datetime('now')`,
      `rm_${newID()}`,
      roomID,
      memberType,
      memberID,
      displayName,
      role,
      personaID,
      projectID,
      visibilityScope,
      json(metadata),
    );
  }

  private upsertPersonaAgent(
    personaID: string,
    name: string,
    description: string,
    systemPrompt: string,
    capabilities: string[],
  ): void {
    this.exec(
      `INSERT INTO agents (id, name, description, system_prompt, capabilities, metadata, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name,
         description=excluded.description,
         system_prompt=excluded.system_prompt,
         capabilities=excluded.capabilities,
         metadata=json_patch(COALESCE(agents.metadata, '{}'), excluded.metadata),
         enabled=1,
         updated_at=datetime('now')`,
      personaID,
      name,
      description,
      systemPrompt,
      json(personaAgentExecutionCapabilities(personaID, capabilities)),
      json({
        source: 'persona_messenger',
        ai_identity_label: '项目人格',
        capability_policy: personaID === 'per_joi_desktop' ? 'all_registered' : 'persona_scoped',
      }),
    );
  }

  private listRoomMembers(roomID: string): MessengerRoom['members'] {
    return this.all(
      `SELECT id, member_type, member_id, display_name, role, persona_id, project_id, visibility_scope, metadata
       FROM room_members
       WHERE room_id=?
       ORDER BY CASE member_type WHEN 'user' THEN 0 WHEN 'human' THEN 1 WHEN 'persona' THEN 2 ELSE 3 END, display_name ASC`,
      roomID,
    ).map((row) => {
      const metadata = parseObject(row.metadata);
      return {
        id: String(row.member_id),
        type: optionalString(row.member_type) || 'member',
        display_name: optionalString(row.display_name) || String(row.member_id),
        role: optionalString(row.role),
        persona_id: optionalString(row.persona_id),
        project_id: optionalString(row.project_id),
        visibility_scope: optionalString(row.visibility_scope) || 'room_members',
        visible_project_ids: parseStringArray(metadata.visible_project_ids),
        can_approve_high_risk: Boolean(metadata.can_approve_high_risk),
        metadata,
      };
    });
  }

  private requireMessengerProject(projectID: string): MessengerProject {
    const row = this.get(`SELECT * FROM projects WHERE id=?`, projectID);
    if (!row) throw new Error(`Project not found: ${projectID}`);
    return rowToMessengerProject(row);
  }

  private requireProjectPersona(personaID: string): ProjectPersona {
    const row = this.get(`SELECT * FROM personas WHERE id=?`, personaID);
    if (!row) throw new Error(`Persona not found: ${personaID}`);
    return rowToProjectPersona(row);
  }

  private requireMessengerRoom(roomID: string): MessengerRoom {
    return this.attachRoomPermissionAudit(this.requireMessengerRoomRaw(roomID));
  }

  private requireMessengerRoomRaw(roomID: string): MessengerRoom {
    const row = this.get(
      `SELECT
         r.*,
         (SELECT persona_id FROM route_locks rl WHERE rl.room_id=r.id AND rl.status='active' ORDER BY datetime(rl.started_at) DESC LIMIT 1) AS route_lock_persona_id,
         (SELECT content FROM messages m WHERE m.conversation_id = r.conversation_id ORDER BY datetime(m.created_at) DESC, m.rowid DESC LIMIT 1) AS last_message,
         (SELECT role FROM messages m WHERE m.conversation_id = r.conversation_id ORDER BY datetime(m.created_at) DESC, m.rowid DESC LIMIT 1) AS last_role,
         0 AS pending_approval_count,
         0 AS running_run_count,
         0 AS failed_run_count
       FROM rooms r
       WHERE r.id=?`,
      roomID,
    );
    if (!row) throw new Error(`Room not found: ${roomID}`);
    return rowToMessengerRoom(row, this.listRoomMembers(roomID));
  }

  private requireRoomConnector(provider: string, externalRoomID: string): RoomConnector {
    const row = this.get(
      `SELECT * FROM room_connectors WHERE provider=? AND external_room_id=?`,
      provider,
      externalRoomID,
    ) || this.get(`SELECT * FROM room_connectors WHERE id=?`, externalRoomID);
    if (!row) throw new Error(`Room connector not found: ${provider}:${externalRoomID}`);
    return rowToRoomConnector(row);
  }

  private requireRoomConnectorByID(connectorID: string): RoomConnector {
    const row = this.get(`SELECT * FROM room_connectors WHERE id=?`, connectorID);
    if (!row) throw new Error(`Room connector not found: ${connectorID}`);
    return rowToRoomConnector(row);
  }

  private resolveConnectorForExternal(req: {
    connector_id?: string;
    provider?: string;
    external_room_id?: string;
  }): RoomConnector {
    const connectorID = req.connector_id?.trim();
    if (connectorID) return this.requireRoomConnectorByID(connectorID);
    const provider = req.provider?.trim().toLowerCase() || '';
    const externalRoomID = req.external_room_id?.trim() || '';
    if (!provider || !externalRoomID) throw new Error('connector_id or provider/external_room_id is required');
    return this.requireRoomConnector(provider, externalRoomID);
  }

  private externalReplyTarget(connectorID: string, externalMessageID: string): { internal_message_id?: string; persona_id?: string } {
    const externalID = externalMessageID.trim();
    if (!externalID) return {};
    const row = this.get(
      `SELECT e.internal_message_id, e.metadata, m.metadata AS message_metadata
       FROM external_connector_events e
       LEFT JOIN messages m ON m.id=e.internal_message_id
       WHERE e.connector_id=? AND e.external_event_id=?
       ORDER BY datetime(e.created_at) DESC
       LIMIT 1`,
      connectorID,
      externalID,
    );
    if (!row) return {};
    const eventMetadata = parseObject(row.metadata);
    const messageMetadata = parseObject(row.message_metadata);
    return {
      internal_message_id: optionalString(row.internal_message_id),
      persona_id: optionalString(eventMetadata.persona_id) || optionalString(eventMetadata.speaker_persona_id) || optionalString(messageMetadata.persona_id) || optionalString(messageMetadata.speaker_persona_id),
    };
  }

  evaluateRoomPermissions(req: EvaluateRoomPermissionsRequest): RoomPermissionAudit {
    const room = this.requireMessengerRoomRaw(req.room_id.trim());
    const actorID = req.actor_id?.trim() || 'desktop_user';
    const member = (room.members ?? []).find((item) => item.id === actorID || item.persona_id === actorID);
    const actorType = req.actor_type?.trim() || member?.type || (actorID === 'desktop_user' ? 'user' : 'human');
    const actorRole = member?.role || (actorID === room.owner_user_id || actorID === 'desktop_user' ? 'room_owner' : 'guest');
    const roomMetadata = room.metadata || {};
    const visibleProjectIDs = parseStringArray(roomMetadata.visible_project_ids);
    const roomProjectIDs = visibleProjectIDs.length > 0 ? visibleProjectIDs : [room.project_id].filter(Boolean) as string[];
    const requestedProjectID = req.project_id?.trim() || room.project_id || '';
    const memberVisibleProjectIDs = parseStringArray(member?.metadata?.visible_project_ids).filter((id) => roomProjectIDs.length === 0 || roomProjectIDs.includes(id));
    const actorProjectID = member?.project_id || (req.persona_id ? this.requireProjectPersona(req.persona_id).project_id : '');
    const authorizedProjectIDs = actorType === 'persona'
      ? [actorProjectID].filter((id) => id && (roomProjectIDs.length === 0 || roomProjectIDs.includes(id)))
      : actorRole === 'guest'
        ? memberVisibleProjectIDs
        : memberVisibleProjectIDs.length > 0
          ? memberVisibleProjectIDs
          : roomProjectIDs;
    const deniedProjectIDs = requestedProjectID && !authorizedProjectIDs.includes(requestedProjectID) ? [requestedProjectID] : [];
    const personaID = req.persona_id?.trim() || (actorType === 'persona' ? actorID : member?.persona_id || '');
    const ownsPrivateDM = Boolean(room.type === 'project_dm' && personaID && room.persona_id === personaID);
    const canReadPrivatePersonaDM = room.type !== 'project_dm'
      || actorType === 'user'
      || ownsPrivateDM;
    const isProjectOwner = actorRole === 'project_owner' || (actorType === 'user' && (actorID === room.owner_user_id || actorID === 'desktop_user'));
    const canModifyCorePersona = isProjectOwner && deniedProjectIDs.length === 0;
    const canApproveHighRisk = actorType === 'user'
      || actorRole === 'project_owner'
      || actorRole === 'room_owner'
      || (actorRole !== 'guest' && Boolean(member?.can_approve_high_risk));
    const humanCount = (room.members ?? []).filter((item) => item.type === 'human' || item.type === 'user').length;
    const multiHumanThrottle = room.type === 'shared'
      && humanCount > 1
      && !['active', 'temporary'].includes(room.default_ai_participation);
    const reasonCodes = [
      actorType === 'persona' ? 'PERSONA_MINIMUM_PROJECT_SCOPE' : '',
      actorRole === 'guest' ? 'GUEST_LIMITED_SCOPE' : '',
      canReadPrivatePersonaDM ? '' : 'PRIVATE_PERSONA_DM_DENIED',
      canModifyCorePersona ? 'CORE_PERSONA_EDIT_ALLOWED' : 'CORE_PERSONA_EDIT_PROJECT_OWNER_REQUIRED',
      canApproveHighRisk ? 'HIGH_RISK_APPROVER' : 'HIGH_RISK_APPROVER_REQUIRED',
      multiHumanThrottle ? 'MULTI_HUMAN_MODERATE_AI_THROTTLE' : '',
      deniedProjectIDs.length ? 'PROJECT_SCOPE_DENIED' : '',
    ].filter(Boolean);
    return {
      room_id: room.id,
      actor_id: actorID,
      actor_type: actorType,
      actor_role: actorRole,
      authorized_project_ids: authorizedProjectIDs,
      visible_project_ids: roomProjectIDs,
      denied_project_ids: deniedProjectIDs,
      can_read_room_history: Boolean(member) || actorType === 'user',
      can_read_private_persona_dm: canReadPrivatePersonaDM,
      can_modify_core_persona: canModifyCorePersona,
      can_approve_high_risk: canApproveHighRisk,
      ai_participation: room.default_ai_participation,
      multi_human_ai_throttle: multiHumanThrottle,
      reason_codes: reasonCodes,
      summary: permissionAuditSummary(actorType, actorRole, authorizedProjectIDs, canApproveHighRisk, multiHumanThrottle),
    };
  }

  private attachRoomPermissionAudit(room: MessengerRoom): MessengerRoom {
    return {
      ...room,
      permission_audit: this.evaluateRoomPermissions({ room_id: room.id }),
    };
  }

  private assertPersonaMutationAllowed(req: UpdateProjectPersonaRequest | RollbackProjectPersonaRequest, persona: ProjectPersona): void {
    const actorRole = req.actor_role?.trim();
    if (!req.actor_id && !actorRole && !req.room_id) return;
    const roomID = req.room_id?.trim() || this.get(
      `SELECT id FROM rooms WHERE persona_id=? AND type='project_dm' ORDER BY datetime(updated_at) DESC LIMIT 1`,
      persona.id,
    )?.id;
    if (!roomID) {
      if (actorRole === 'project_owner') return;
      throw new Error('Project permission is required to modify core Persona');
    }
    const audit = this.evaluateRoomPermissions({
      room_id: String(roomID),
      actor_id: req.actor_id,
      actor_type: actorRole === 'project_owner' ? 'user' : undefined,
      project_id: persona.project_id,
      persona_id: persona.id,
    });
    if (actorRole === 'project_owner') return;
    if (!audit.can_modify_core_persona) {
      throw new Error('Room Owner cannot modify core Persona without Project permission');
    }
  }

  private ensureApprovalActorAllowed(approvalID: string, runID: string, riskLevel: string, actorID: string): void {
    if (!isHighRiskApproval(riskLevel)) return;
    const roomRow = this.get(
      `SELECT COALESCE(direct_room.id, metadata_room.id) AS room_id
       FROM runs rn
       LEFT JOIN conversations c ON c.id=rn.conversation_id
       LEFT JOIN rooms direct_room ON direct_room.conversation_id=rn.conversation_id
       LEFT JOIN rooms metadata_room ON metadata_room.id=json_extract(COALESCE(c.metadata, '{}'), '$.room_id')
       WHERE rn.id=?
       LIMIT 1`,
      runID,
    );
    const roomID = optionalString(roomRow?.room_id);
    if (!roomID) {
      if (['desktop_user', 'desktop_ui', 'test', 'system'].includes(actorID)) return;
      throw new Error(`High-risk approval ${approvalID} requires a permitted room or project approver`);
    }
    const audit = this.evaluateRoomPermissions({ room_id: roomID, actor_id: actorID });
    if (!audit.can_approve_high_risk) {
      throw new Error(`High-risk approval ${approvalID} requires a permitted approver`);
    }
  }

  private findVisibleExternalMention(text: string, visiblePersonaIDs: string[]): ProjectPersona | null {
    for (const personaID of visiblePersonaIDs) {
      const persona = this.requireProjectPersona(personaID);
      if (messageMentionsPersona(text, persona, [])) return persona;
    }
    return null;
  }

  private uniquePersonaHandle(seed: string, projectName: string, existingPersonaID = ''): string {
    const base = normalizePersonaHandle(seed || projectName);
    let candidate = base;
    let index = 2;
    while (this.get(
      `SELECT id FROM personas WHERE handle=? AND (?='' OR id != ?)`,
      candidate,
      existingPersonaID,
      existingPersonaID,
    )) {
      candidate = `${base}-${index}`;
      index += 1;
    }
    return candidate;
  }

  private buildPersonaCandidates(req: GenerateProjectPersonaCandidatesRequest): PersonaCandidate[] {
    const projectName = req.project_name.trim();
    if (!projectName) throw new Error('project_name is required');
    const baseName = personaNameFromProject(projectName);
    const domain = req.domain?.trim() || 'general';
    const goal = req.project_goal?.trim() || `${projectName} 项目`;
    const templates = [
      {
        suffix: '',
        tagline: `负责 ${projectName} 的项目人格`,
        self_intro: '我会先厘清约束，再推进可验证的下一步。',
        traits: { directness: 0.72, warmth: 0.55, humor: 0.18, verbosity: 0.42, initiative: 0.68, risk_sensitivity: 0.81, divergence: 0.35 },
        disagreement_style: '明确指出风险，并提供替代方案',
        uncertainty_style: '说明不确定来源和验证路径',
        rationale: '均衡型项目人格，适合作为默认长期私聊对象。',
      },
      {
        suffix: 'Pilot',
        tagline: `推动 ${projectName} 从计划进入执行`,
        self_intro: '我会把目标拆成可执行步骤，并持续检查阻塞和验收证据。',
        traits: { directness: 0.82, warmth: 0.44, humor: 0.1, verbosity: 0.36, initiative: 0.78, risk_sensitivity: 0.72, divergence: 0.28 },
        disagreement_style: '直接指出会拖慢交付的假设，并给出更短路径',
        uncertainty_style: '先给当前判断，再列出需要补证的点',
        rationale: '推进型项目人格，适合实现、排期和验收压力较高的项目。',
      },
      {
        suffix: 'Scout',
        tagline: `为 ${projectName} 发现风险、机会和外部信息`,
        self_intro: '我会先扩展信息面，再把不确定性收束成可行动的判断。',
        traits: { directness: 0.58, warmth: 0.62, humor: 0.2, verbosity: 0.5, initiative: 0.74, risk_sensitivity: 0.88, divergence: 0.64 },
        disagreement_style: '用证据指出盲区，并保留多个候选方案',
        uncertainty_style: '标明信息来源强弱和下一步验证路径',
        rationale: '探索型项目人格，适合研究、发现风险和跨项目协作。',
      },
    ];
    return templates.map((template, index) => {
      const displayName = template.suffix ? `${baseName} ${template.suffix}` : baseName;
      return {
        id: `pcand_${index + 1}`,
        display_name: displayName,
        handle: this.uniquePersonaHandle(displayName, projectName),
        avatar: '',
        tagline: template.tagline,
        self_intro: `${template.self_intro} 当前目标：${goal}。`,
        traits: template.traits,
        disagreement_style: template.disagreement_style,
        uncertainty_style: template.uncertainty_style,
        rationale: `${template.rationale} 领域：${domain}。`,
      };
    });
  }

  private buildCheckpointSummary(): CheckpointSummary {
    const lastCheckpoint = this.get(
      `SELECT id, checked_at, covered_event_cursor
       FROM checkpoints
       WHERE user_id='desktop_user'
       ORDER BY datetime(checked_at) DESC
       LIMIT 1`,
    );
    const since = optionalString(lastCheckpoint?.checked_at) || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const completedRows = this.all(
      `SELECT rn.id, rn.terminal_reason, COALESCE(rn.finished_at, rn.created_at) AS occurred_at,
              r.id AS room_id, r.title AS room_title, p.id AS project_id, p.name AS project_name, ps.display_name AS persona_name
       FROM runs rn
       LEFT JOIN rooms r ON r.conversation_id=rn.conversation_id
       LEFT JOIN personas ps ON ps.id=rn.selected_agent_id
       LEFT JOIN projects p ON p.id=ps.project_id
       WHERE (rn.status IN ('completed', 'succeeded') OR rn.terminal_status IN ('completed', 'succeeded'))
         AND datetime(COALESCE(rn.finished_at, rn.created_at)) > datetime(?)
       ORDER BY datetime(COALESCE(rn.finished_at, rn.created_at)) DESC
       LIMIT 5`,
      since,
    );
    const failedRows = this.all(
      `SELECT rn.id, rn.error_message, rn.terminal_reason, COALESCE(rn.finished_at, rn.created_at) AS occurred_at,
              r.id AS room_id, r.title AS room_title, p.id AS project_id, p.name AS project_name, ps.display_name AS persona_name
       FROM runs rn
       LEFT JOIN rooms r ON r.conversation_id=rn.conversation_id
       LEFT JOIN personas ps ON ps.id=rn.selected_agent_id
       LEFT JOIN projects p ON p.id=ps.project_id
       WHERE (rn.status='failed' OR rn.terminal_status='failed')
         AND datetime(COALESCE(rn.finished_at, rn.created_at)) > datetime(?)
       ORDER BY datetime(COALESCE(rn.finished_at, rn.created_at)) DESC
       LIMIT 5`,
      since,
    );
    const completedRuns = Number(this.get(
      `SELECT COUNT(*) AS count
       FROM runs
       WHERE (status IN ('completed', 'succeeded') OR terminal_status IN ('completed', 'succeeded'))
         AND datetime(COALESCE(finished_at, created_at)) > datetime(?)`,
      since,
    )?.count ?? 0);
    const failedRuns = Number(this.get(
      `SELECT COUNT(*) AS count
       FROM runs
       WHERE (status='failed' OR terminal_status='failed')
         AND datetime(COALESCE(finished_at, created_at)) > datetime(?)`,
      since,
    )?.count ?? 0);
    const waitingRuns = Number(this.get(
      `SELECT COUNT(*) AS count
       FROM runs
       WHERE (status='waiting_approval' OR terminal_status='waiting_approval')
         AND datetime(created_at) > datetime(?)`,
      since,
    )?.count ?? 0);
    const pendingApprovals = Number(this.get(`SELECT COUNT(*) AS count FROM confirmation_requests WHERE status='pending'`)?.count ?? 0);
    const pendingApprovalRows = this.all(
      `SELECT cr.id, cr.run_id, cr.requested_action, cr.risk_level, cr.created_at, r.id AS room_id, r.title AS room_title
       FROM confirmation_requests cr
       LEFT JOIN runs rn ON rn.id=cr.run_id
       LEFT JOIN rooms r ON r.conversation_id=rn.conversation_id
       WHERE cr.status='pending'
       ORDER BY datetime(cr.created_at) DESC
      LIMIT 5`,
    );
    const recoverableRuns = this.listRecoverableRuns({ limit: 20 }).runs;
    const activeTasks = this.listProductTasks({ status: 'active', limit: 20 }).tasks;
    const openLoops = this.listOpenLoops({ status: 'open', limit: 20 }).open_loops;
    const proactiveMessages = this.listProactiveMessages({ status: 'draft', limit: 20 }).messages;
    const artifactRows = this.all(
      `SELECT a.id, a.title, a.type, a.source_run_id, a.created_at, r.id AS room_id, r.title AS room_title
       FROM artifacts a
       LEFT JOIN runs rn ON rn.id=a.source_run_id
       LEFT JOIN rooms r ON r.conversation_id=rn.conversation_id
       WHERE datetime(a.created_at) > datetime(?)
       ORDER BY datetime(a.created_at) DESC
       LIMIT 5`,
      since,
    );
    const artifacts = Number(this.get(`SELECT COUNT(*) AS count FROM artifacts WHERE datetime(created_at) > datetime(?)`, since)?.count ?? 0);
    const cost = Number(this.get(`SELECT COALESCE(SUM(cost_estimate), 0) AS cost FROM model_calls WHERE datetime(created_at) > datetime(?)`, since)?.cost ?? 0);
    const externalRows = this.all(
      `SELECT e.id, e.provider, e.external_event_id, e.status, e.error, e.room_id, e.created_at, r.title AS room_title
       FROM external_connector_events e
       LEFT JOIN rooms r ON r.id=e.room_id
       WHERE e.status IN ('send_failed', 'pending', 'retry_scheduled')
         AND datetime(e.created_at) > datetime(?)
       ORDER BY datetime(e.created_at) DESC
       LIMIT 5`,
      since,
    );
    const externalUnhandled = Number(this.get(
      `SELECT COUNT(*) AS count
       FROM external_connector_events
       WHERE status IN ('send_failed', 'pending', 'retry_scheduled')
         AND datetime(created_at) > datetime(?)`,
      since,
    )?.count ?? 0);
    const sinceMs = Date.parse(since.includes('T') ? since : `${since.replace(' ', 'T')}Z`);
    const includeNoProgress = Number.isFinite(sinceMs) && Date.now() - sinceMs >= 8 * 60 * 60 * 1000;
    const noProgressRows = includeNoProgress ? this.all(
      `SELECT p.id, p.name
       FROM projects p
       WHERE p.status='active'
         AND datetime(p.created_at) <= datetime(?)
         AND NOT EXISTS (
           SELECT 1 FROM routing_decisions rd
           WHERE rd.owner_project_id=p.id AND datetime(rd.created_at) > datetime(?)
         )
         AND NOT EXISTS (
           SELECT 1 FROM rooms r
           JOIN messages m ON m.conversation_id=r.conversation_id
           WHERE r.project_id=p.id AND datetime(m.created_at) > datetime(?)
         )
         AND NOT EXISTS (
           SELECT 1 FROM personas ps
           JOIN rooms r ON r.persona_id=ps.id
           JOIN messages m ON m.conversation_id=r.conversation_id
           WHERE ps.project_id=p.id AND datetime(m.created_at) > datetime(?)
         )
       ORDER BY p.name ASC
       LIMIT 5`,
      since,
      since,
      since,
      since,
    ) : [];
    const noProgressProjects = includeNoProgress ? Number(this.get(
      `SELECT COUNT(*) AS count
       FROM projects p
       WHERE p.status='active'
         AND datetime(p.created_at) <= datetime(?)
         AND NOT EXISTS (
           SELECT 1 FROM routing_decisions rd
           WHERE rd.owner_project_id=p.id AND datetime(rd.created_at) > datetime(?)
         )
         AND NOT EXISTS (
           SELECT 1 FROM rooms r
           JOIN messages m ON m.conversation_id=r.conversation_id
           WHERE r.project_id=p.id AND datetime(m.created_at) > datetime(?)
         )
         AND NOT EXISTS (
           SELECT 1 FROM personas ps
           JOIN rooms r ON r.persona_id=ps.id
           JOIN messages m ON m.conversation_id=r.conversation_id
           WHERE ps.project_id=p.id AND datetime(m.created_at) > datetime(?)
         )`,
      since,
      since,
      since,
      since,
    )?.count ?? 0) : 0;
    const cursor = optionalString(this.get(`SELECT MAX(created_at) AS cursor FROM run_events`)?.cursor) || nowIso();
    const items: CheckpointSummary['items'] = [];
    for (const recoverable of recoverableRuns.slice(0, 5)) {
      items.push({
        id: `chk_recovery_${recoverable.run_id}`,
        kind: 'recovery_required',
        title: '有中断任务等待你决定',
        body: `${recoverable.reason}${recoverable.completed_side_effect_count ? ` · 已完成 ${recoverable.completed_side_effect_count} 个有副作用步骤` : ''}`,
        severity: 'warning',
        run_id: recoverable.run_id,
        product_task_id: recoverable.product_task_id,
        safe_to_retry: recoverable.safe_to_retry,
      });
    }
    for (const task of activeTasks.slice(0, 5)) {
      items.push({
        id: `chk_task_${task.id}`,
        kind: 'active_task',
        title: task.title,
        body: `${formatProductTaskStatusForCheckpoint(task.status)} · ${Math.max(0, Math.min(100, Math.round(task.progress_percent || 0)))}%${task.terminal_reason ? ` · ${task.terminal_reason}` : ''}`,
        severity: ['blocked', 'waiting_confirmation'].includes(task.status) ? 'warning' : 'info',
        run_id: task.latest_run_id || task.source_run_id,
        product_task_id: task.id,
      });
    }
    for (const loop of openLoops.slice(0, 5)) {
      items.push({
        id: `chk_open_loop_${loop.id}`,
        kind: 'open_loop',
        title: loop.topic,
        body: loop.suggested_followup || loop.description,
        severity: loop.priority === 'high' ? 'warning' : 'info',
        run_id: loop.source_run_id,
        product_task_id: loop.source_product_task_id,
        open_loop_id: loop.id,
      });
    }
    for (const message of proactiveMessages.slice(0, 5)) {
      items.push({
        id: `chk_proactive_${message.id}`,
        kind: 'proactive_message',
        title: message.title,
        body: message.body,
        severity: 'info',
        product_task_id: message.source_product_task_id,
        open_loop_id: message.source_open_loop_id,
        proactive_message_id: message.id,
      });
    }
    for (const row of completedRows) {
      const label = optionalString(row.persona_name) || optionalString(row.project_name) || optionalString(row.room_title) || 'Joi';
      items.push({
        id: `chk_completed_${row.id}`,
        kind: 'completed',
        title: `${label} 完成了一次运行`,
        body: optionalString(row.terminal_reason) || optionalString(row.room_title),
        severity: 'success',
        room_id: optionalString(row.room_id),
        project_id: optionalString(row.project_id),
        run_id: optionalString(row.id),
      });
    }
    if (completedRuns > 0) {
      items.push({ id: `chk_completed_total_${since}`, kind: 'completed_total', title: `${completedRuns} 个 Run 已完成`, severity: 'success' });
    }
    for (const row of failedRows) {
      const label = optionalString(row.persona_name) || optionalString(row.project_name) || optionalString(row.room_title) || 'Joi';
      items.push({
        id: `chk_failed_${row.id}`,
        kind: 'failed',
        title: `${label} 有运行失败`,
        body: optionalString(row.error_message) || optionalString(row.terminal_reason) || optionalString(row.room_title),
        severity: 'error',
        room_id: optionalString(row.room_id),
        project_id: optionalString(row.project_id),
        run_id: optionalString(row.id),
      });
    }
    if (failedRuns > 0) {
      items.push({ id: `chk_failed_total_${since}`, kind: 'failed_total', title: `${failedRuns} 个 Run 失败`, severity: 'error' });
    }
    for (const row of pendingApprovalRows) {
      items.push({
        id: `chk_approval_${row.id}`,
        kind: 'approval_required',
        title: optionalString(row.requested_action) || '有高风险动作等待审批',
        body: `${optionalString(row.risk_level) || 'unknown'}${row.room_title ? ` · ${row.room_title}` : ''}`,
        severity: 'warning',
        room_id: optionalString(row.room_id),
        run_id: optionalString(row.run_id),
        approval_id: optionalString(row.id),
      });
    }
    if (pendingApprovals > 0) {
      items.push({ id: `chk_approval_total_${pendingApprovals}`, kind: 'approval_required_total', title: `${pendingApprovals} 个高风险动作等待审批`, severity: 'warning' });
    }
    for (const row of noProgressRows) {
      items.push({
        id: `chk_no_progress_${row.id}`,
        kind: 'no_progress_project',
        title: `${optionalString(row.name) || '未命名项目'} 没有新推进`,
        severity: 'info',
        project_id: optionalString(row.id),
      });
    }
    if (noProgressProjects > 0) {
      items.push({ id: `chk_no_progress_total_${since}`, kind: 'no_progress_total', title: `${noProgressProjects} 个项目没有新推进`, severity: 'info' });
    }
    for (const row of artifactRows) {
      items.push({
        id: `chk_artifact_${row.id}`,
        kind: 'artifact_created',
        title: optionalString(row.title) || `${optionalString(row.type) || '产物'} 已新增`,
        body: optionalString(row.room_title),
        severity: 'info',
        room_id: optionalString(row.room_id),
        run_id: optionalString(row.source_run_id),
        artifact_id: optionalString(row.id),
      });
    }
    if (artifacts > 0) {
      items.push({ id: `chk_artifacts_total_${since}`, kind: 'artifact_total', title: `${artifacts} 个新产物`, severity: 'info' });
    }
    for (const row of externalRows) {
      items.push({
        id: `chk_external_${row.id}`,
        kind: 'external_unhandled',
        title: `${optionalString(row.provider) || '外部渠道'} 同步需要处理`,
        body: optionalString(row.error) || `${optionalString(row.status)} · ${optionalString(row.room_title)}`,
        severity: optionalString(row.status) === 'send_failed' ? 'error' : 'warning',
        room_id: optionalString(row.room_id),
      });
    }
    if (externalUnhandled > 0) {
      items.push({ id: `chk_external_total_${since}`, kind: 'external_unhandled_total', title: `${externalUnhandled} 条外部渠道消息需要处理`, severity: 'warning' });
    }
    if (items.length === 0) {
      items.push({ id: `chk_quiet_${since}`, kind: 'quiet', title: '自上次检查后没有需要处理的变化', severity: 'info' });
    }
    return {
      checkpoint_id: optionalString(lastCheckpoint?.id),
      checked_at: optionalString(lastCheckpoint?.checked_at),
      covered_event_cursor: cursor,
      since,
      completed_count: completedRuns,
      failed_count: failedRuns,
      pending_approval_count: pendingApprovals,
      recoverable_count: recoverableRuns.length,
      active_task_count: activeTasks.length,
      open_loop_count: openLoops.length,
      proactive_message_count: proactiveMessages.length,
      waiting_user_count: waitingRuns + pendingApprovals + recoverableRuns.length,
      new_artifact_count: artifacts,
      no_progress_project_count: noProgressProjects,
      model_cost_estimate: Math.round(cost * 1000000) / 1000000,
      external_unhandled_count: externalUnhandled,
      items,
    };
  }

  private recordRoomRoutingDecision(req: ChatRequest, context: {
    conversation_id: string;
    message_id: string;
    run_id: string;
    agent_id: string;
    route_result: Record<string, unknown>;
    room_route?: RoomRouteResolution | null;
  }): void {
    const resolution = context.room_route ?? this.resolveRoomKernelRoute(req, context.conversation_id, req.message || '');
    const room = resolution?.room ?? this.resolveRoomForChat(req, context.conversation_id);
    if (!room) return;
    const hasResolution = Boolean(resolution);
    const speakerPersonaID = hasResolution ? resolution?.speaker_persona_id || '' : room.persona_id || context.agent_id;
    const ownerProjectID = hasResolution ? resolution?.owner_project_id || '' : room.project_id || '';
    const executorPersonaID = hasResolution ? resolution?.executor_persona_id || '' : speakerPersonaID;
    const reasonCodes = resolution?.reason_codes?.length ? resolution.reason_codes : [
      room.type === 'project_dm' ? 'PROJECT_DM_DEFAULT' : 'ROOM_KERNEL_DEFAULT',
      req.scope_override ? `SCOPE_${String(req.scope_override).toUpperCase()}` : '',
    ].filter(Boolean);
    const threadLink = this.resolveMessengerThreadLink(req, {
      room,
      conversation_id: context.conversation_id,
      message_id: context.message_id,
      run_id: context.run_id,
      speaker_persona_id: speakerPersonaID,
      owner_project_id: ownerProjectID,
      executor_persona_id: executorPersonaID,
      collaborator_persona_ids: resolution?.collaborator_persona_ids || [],
      base_thread_action: resolution?.thread_action || { type: 'continue_or_create', source: 'room_kernel_foundation' },
    });
    this.exec(
      `INSERT INTO routing_decisions (id, room_id, message_id, run_id, speaker_persona_id, owner_project_id,
                                      executor_persona_id, collaborator_project_ids, execution_scope, write_targets,
                                      thread_action, confidence, risk, requires_confirmation, reason_codes, metadata, created_at)
       VALUES (?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      `rdec_${newID()}`,
      room.id,
      context.message_id,
      context.run_id,
      speakerPersonaID,
      ownerProjectID,
      executorPersonaID,
      json(resolution?.collaborator_project_ids || []),
      resolution?.execution_scope || req.scope_override || (room.type === 'project_dm' ? 'current_project' : 'auto_route'),
      json(resolution?.write_targets || (ownerProjectID ? [ownerProjectID, room.id] : [room.id])),
      json(threadLink.thread_action),
      resolution?.confidence ?? (room.type === 'project_dm' ? 1 : 0.74),
      resolution?.risk || permissionProfileRisk(req.permission_profile),
      resolution?.requires_confirmation ? 1 : 0,
      json(reasonCodes),
      json({
        route_result: context.route_result,
        room_type: room.type,
        room_kernel: resolution ? routeResolutionForTrace({ ...resolution, thread_action: threadLink.thread_action }) : undefined,
        collaborator_persona_ids: resolution?.collaborator_persona_ids || [],
      }),
    );
    this.exec(`UPDATE rooms SET floor_holder_persona_id=NULLIF(?, ''), updated_at=datetime('now') WHERE id=?`, speakerPersonaID, room.id);
    if (resolution?.requires_confirmation) {
      this.ensureRouteConfirmationRequest(req, {
        run_id: context.run_id,
        room,
        resolution: { ...resolution, thread_action: threadLink.thread_action },
        reason_codes: reasonCodes,
      });
    }
  }

  private ensureRouteConfirmationRequest(req: ChatRequest, context: {
    run_id: string;
    room: MessengerRoom;
    resolution: RoomRouteResolution;
    reason_codes: string[];
  }): void {
    const existing = this.get(
      `SELECT id FROM confirmation_requests
       WHERE run_id=? AND requested_action='确认消息归属与执行范围' AND status='pending'
       LIMIT 1`,
      context.run_id,
    );
    if (existing) return;
    const confirmationID = `confirm_route_${newID()}`;
    const approvalKey = `route:${context.run_id}`;
    const input = {
      operation_id: approvalKey,
      room_id: context.room.id,
      room_title: context.room.title,
      room_type: context.room.type,
      message: req.message || '',
      input_mode: req.input_mode || 'auto',
      permission_profile: req.permission_profile || 'read_only',
      speaker_persona_id: context.resolution.speaker_persona_id || '',
      owner_project_id: context.resolution.owner_project_id || '',
      executor_persona_id: context.resolution.executor_persona_id || '',
      execution_scope: context.resolution.execution_scope,
      confidence: context.resolution.confidence,
      risk: context.resolution.risk,
      reason_codes: context.reason_codes,
      thread_action: context.resolution.thread_action,
      reversible: true,
    };
    this.exec(
      `INSERT INTO confirmation_requests (id, run_id, capability_id, requested_action, risk_level, status, input, approval_scope, approval_key)
       VALUES (?, ?, NULL, '确认消息归属与执行范围', ?, 'pending', ?, 'one_call', ?)`,
      confirmationID,
      context.run_id,
      context.resolution.risk,
      json(input),
      approvalKey,
    );
    this.insertRunEvent(context.run_id, '', this.nextRunEventSeq(context.run_id), 'route.confirmation_required', {
      item_type: 'routing_decision',
      item_id: confirmationID,
      confirmation_id: confirmationID,
      status: 'waiting_confirmation',
      visibility: 'approval',
      source: 'room_kernel',
      risk: context.resolution.risk,
      room_id: context.room.id,
      owner_project_id: context.resolution.owner_project_id || '',
      speaker_persona_id: context.resolution.speaker_persona_id || '',
      reason_codes: context.reason_codes,
    });
  }

  private resolveMessengerThreadLink(req: ChatRequest, context: {
    room: MessengerRoom;
    conversation_id: string;
    message_id: string;
    run_id: string;
    speaker_persona_id: string;
    owner_project_id: string;
    executor_persona_id: string;
    collaborator_persona_ids?: string[];
    base_thread_action: Record<string, unknown>;
  }): MessengerThreadLink {
    const message = req.message || '';
    const mode = effectiveInputMode(req, message);
    const baseType = optionalString(context.base_thread_action.type) || 'continue_or_create';
    const roomScope = req.scope_override === 'room_scope' || req.scope_override === 'temporary' || baseType === 'none';
    if (!context.owner_project_id || roomScope || isExplicitChatOnlyIntent(message) || isMemoryOrReflectionOnlyIntent(message)) {
      return {
        thread_action: {
          type: 'none',
          source: 'thread_manager',
          reason: !context.owner_project_id ? 'no_owner_project' : roomScope ? 'room_scope' : 'non_project_chat',
        },
      };
    }
    const shouldTrack = shouldCreateProductTask(req, message, mode)
      || isTaskContinuationIntent(message)
      || Boolean(req.product_task_id?.trim());
    if (!shouldTrack) {
      return {
        thread_action: {
          type: 'none',
          source: 'thread_manager',
          reason: 'chat_assist_without_task',
        },
      };
    }
    const replyThreadID = req.reply_to_message_id ? this.threadIDForMessage(req.reply_to_message_id) : '';
    const explicitTaskThreadID = req.product_task_id ? this.threadIDForProductTask(req.product_task_id) : '';
    const continuationThreadID = replyThreadID
      || explicitTaskThreadID
      || (isTaskContinuationIntent(message) ? this.latestOpenMessengerThreadID(context.owner_project_id, context.room.id, context.speaker_persona_id) : '');
    const actionType = continuationThreadID ? 'continue' : 'create';
    const threadID = continuationThreadID || `mthread_${newID()}`;
    const artifactIDs = this.artifactIDsForRun(context.run_id);
    const productTaskID = optionalString(req.product_task_id) || this.productTaskIDForRun(context.run_id) || '';
    const title = actionType === 'create' ? titleFromMessage(message) : '';
    const goal = message.trim();
    const metadata = {
      source: 'thread_manager',
      mode,
      product_task_id: productTaskID,
      base_thread_action: context.base_thread_action,
    };
    if (actionType === 'create') {
      this.exec(
        `INSERT INTO messenger_threads (id, project_id, room_id, owner_persona_id, title, goal, status, priority,
                                       collaborator_persona_ids, source_room_ids, source_message_ids, run_ids,
                                       artifact_ids, next_action, metadata, created_at, updated_at)
         VALUES (?, ?, ?, NULLIF(?, ''), ?, ?, 'active', 'normal', ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        threadID,
        context.owner_project_id,
        context.room.id,
        context.speaker_persona_id || context.executor_persona_id,
        title || 'Project Thread',
        goal,
        json(context.collaborator_persona_ids || []),
        json([context.room.id]),
        json([context.message_id]),
        json([context.run_id]),
        json(artifactIDs),
        '等待下一步',
        json(metadata),
      );
    } else {
      this.mergeMessengerThreadReferences(threadID, {
        room_id: context.room.id,
        message_id: context.message_id,
        run_id: context.run_id,
        artifact_ids: artifactIDs,
        collaborator_persona_ids: context.collaborator_persona_ids || [],
        next_action: '继续当前目标',
        metadata,
      });
    }
    this.exec(
      `INSERT INTO messenger_thread_events (id, thread_id, room_id, message_id, run_id, artifact_id, product_task_id,
                                            event_type, summary, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, datetime('now'))`,
      `thev_${newID()}`,
      threadID,
      context.room.id,
      context.message_id,
      context.run_id,
      artifactIDs[0] || '',
      productTaskID,
      actionType === 'create' ? 'thread.created' : 'thread.continued',
      actionType === 'create' ? (title || 'New project thread') : 'Continued existing thread',
      json(metadata),
    );
    return {
      thread_id: threadID,
      thread_action: {
        type: actionType,
        thread_id: threadID,
        source: 'thread_manager',
        mode,
        product_task_id: productTaskID,
        artifact_ids: artifactIDs,
      },
    };
  }

  private mergeMessengerThreadReferences(threadID: string, refs: {
    room_id?: string;
    message_id?: string;
    run_id?: string;
    artifact_ids?: string[];
    collaborator_persona_ids?: string[];
    next_action?: string;
    metadata?: Record<string, unknown>;
  }): void {
    const row = this.get(`SELECT source_room_ids, source_message_ids, run_ids, artifact_ids, collaborator_persona_ids, metadata FROM messenger_threads WHERE id=?`, threadID);
    if (!row) return;
    const roomIDs = mergeStringIDs(parseArray(row.source_room_ids), refs.room_id ? [refs.room_id] : []);
    const messageIDs = mergeStringIDs(parseArray(row.source_message_ids), refs.message_id ? [refs.message_id] : []);
    const runIDs = mergeStringIDs(parseArray(row.run_ids), refs.run_id ? [refs.run_id] : []);
    const artifactIDs = mergeStringIDs(parseArray(row.artifact_ids), refs.artifact_ids || []);
    const collaboratorPersonaIDs = mergeStringIDs(parseArray(row.collaborator_persona_ids), refs.collaborator_persona_ids || []);
    const metadata = { ...parseObject(row.metadata), ...(refs.metadata || {}) };
    this.exec(
      `UPDATE messenger_threads
       SET source_room_ids=?, source_message_ids=?, run_ids=?, artifact_ids=?, collaborator_persona_ids=?, next_action=?, metadata=?,
           status=CASE WHEN status IN ('completed', 'archived') THEN status ELSE 'active' END,
           updated_at=datetime('now')
       WHERE id=?`,
      json(roomIDs),
      json(messageIDs),
      json(runIDs),
      json(artifactIDs),
      json(collaboratorPersonaIDs),
      refs.next_action || '继续当前目标',
      json(metadata),
      threadID,
    );
  }

  private threadIDForMessage(messageID: string): string {
    const row = this.get(
      `SELECT thread_id FROM messenger_thread_events WHERE message_id=? ORDER BY datetime(created_at) DESC LIMIT 1`,
      messageID,
    );
    return optionalString(row?.thread_id) || '';
  }

  private threadIDForProductTask(productTaskID: string): string {
    const row = this.get(
      `SELECT thread_id FROM messenger_thread_events WHERE product_task_id=? ORDER BY datetime(created_at) DESC LIMIT 1`,
      productTaskID.trim(),
    );
    return optionalString(row?.thread_id) || '';
  }

  private latestOpenMessengerThreadID(projectID: string, roomID: string, personaID: string): string {
    const row = this.get(
      `SELECT id FROM messenger_threads
       WHERE project_id=?
         AND status IN ('active', 'waiting_user', 'waiting_external', 'paused')
         AND (?='' OR room_id=? OR instr(source_room_ids, ?) > 0)
         AND (?='' OR owner_persona_id=?)
       ORDER BY datetime(updated_at) DESC, id DESC
       LIMIT 1`,
      projectID,
      roomID,
      roomID,
      roomID,
      personaID,
      personaID,
    );
    return optionalString(row?.id) || '';
  }

  private routeFromActiveThread(roomID: string, message: string, personas: ProjectPersona[]): ProjectPersona | null {
    if (!isTaskContinuationIntent(message)) return null;
    const row = this.get(
      `SELECT owner_persona_id FROM messenger_threads
       WHERE status IN ('active', 'waiting_user', 'waiting_external', 'paused')
         AND (room_id=? OR instr(source_room_ids, ?) > 0)
         AND owner_persona_id IS NOT NULL
       ORDER BY datetime(updated_at) DESC, id DESC
       LIMIT 1`,
      roomID,
      roomID,
    );
    const personaID = optionalString(row?.owner_persona_id);
    return personaID ? personas.find((persona) => persona.id === personaID) ?? null : null;
  }

  private productTaskIDForRun(runID: string): string {
    const runMetadata = parseObject(this.get(`SELECT metadata FROM runs WHERE id=?`, runID)?.metadata);
    return optionalString(runMetadata.product_task_id)
      || optionalString(this.get(`SELECT id FROM product_tasks WHERE latest_run_id=? OR source_run_id=? ORDER BY datetime(updated_at) DESC LIMIT 1`, runID, runID)?.id)
      || '';
  }

  private artifactIDsForRun(runID: string): string[] {
    return this.all(
      `SELECT id FROM artifacts WHERE source_run_id=? ORDER BY datetime(created_at) ASC`,
      runID,
    ).map((row) => String(row.id));
  }

  private attachMessengerThreadArtifacts(runID: string, productTaskID: string | undefined, artifactIDs: string[]): void {
    if (artifactIDs.length === 0 && !productTaskID) return;
    const row = this.get(
      `SELECT thread_id FROM messenger_thread_events
       WHERE run_id=?
       ORDER BY datetime(created_at) DESC
       LIMIT 1`,
      runID,
    );
    const threadID = optionalString(row?.thread_id);
    if (!threadID) return;
    this.mergeMessengerThreadReferences(threadID, {
      run_id: runID,
      artifact_ids: artifactIDs,
      metadata: { product_task_id: productTaskID || '' },
      next_action: '检查产物或继续推进',
    });
    for (const artifactID of artifactIDs) {
      const existing = this.get(
        `SELECT id FROM messenger_thread_events WHERE thread_id=? AND artifact_id=? LIMIT 1`,
        threadID,
        artifactID,
      );
      if (existing) continue;
      this.exec(
        `INSERT INTO messenger_thread_events (id, thread_id, run_id, artifact_id, product_task_id, event_type, summary, metadata, created_at)
         VALUES (?, ?, ?, ?, NULLIF(?, ''), 'artifact.linked', 'Artifact linked to thread', ?, datetime('now'))`,
        `thev_${newID()}`,
        threadID,
        runID,
        artifactID,
        productTaskID || '',
        json({ source: 'thread_manager' }),
      );
    }
  }

  private resolveRoomKernelRoute(req: ChatRequest, conversationID: string, message: string): RoomRouteResolution | null {
    const room = this.resolveRoomForChat(req, conversationID);
    if (!room) return null;
    const risk = permissionProfileRisk(req.permission_profile);
    const roomPersonas = (room.members ?? [])
      .filter((member) => member.type === 'persona' && member.persona_id)
      .map((member) => this.requireProjectPersona(member.persona_id!));
    const projectCache = new Map<string, MessengerProject | null>();
    const projectForID = (projectID?: string): MessengerProject | null => {
      const normalizedProjectID = projectID?.trim();
      if (!normalizedProjectID) return null;
      if (!projectCache.has(normalizedProjectID)) {
        const row = this.get(`SELECT * FROM projects WHERE id=?`, normalizedProjectID);
        projectCache.set(normalizedProjectID, row ? rowToMessengerProject(row) : null);
      }
      return projectCache.get(normalizedProjectID) ?? null;
    };
    const projectForPersona = (persona: ProjectPersona): MessengerProject | null => projectForID(persona.project_id);
    const projectIsRouteable = (projectID?: string): boolean => {
      const project = projectForID(projectID);
      return Boolean(project && project.status !== 'archived' && project.status !== 'deleted');
    };
    const allAvailablePersonas = this.all(`SELECT * FROM personas WHERE status NOT IN ('archived', 'deleted')`)
      .map(rowToProjectPersona)
      .filter((persona) => projectIsRouteable(persona.project_id));
    const routeablePersonas = roomPersonas.filter((persona) => (
      persona.status !== 'archived'
      && persona.status !== 'deleted'
      && projectIsRouteable(persona.project_id)
    ));
    const collaboratorCandidatePersonas = room.type === 'project_dm' ? allAvailablePersonas : routeablePersonas;
    const messageEntityMatchesPersona = (persona: ProjectPersona): boolean => {
      const project = projectForPersona(persona);
      const projectName = project?.name || '';
      const directProjectHit = Boolean(projectName && message.includes(projectName));
      const directHandleHit = Boolean(persona.handle && message.includes(persona.handle));
      const activeDisplayHit = persona.status !== 'dormant' && Boolean(persona.display_name && message.includes(persona.display_name));
      const activeRoomSubtitleHit = persona.project_id === room.project_id
        && persona.status !== 'dormant'
        && Boolean(room.subtitle && message.includes(room.subtitle));
      return directProjectHit || directHandleHit || activeDisplayHit || activeRoomSubtitleHit;
    };
    const activePersonas = routeablePersonas.filter((persona) => persona.status !== 'dormant');
    const excludedArchivedProject = roomPersonas.some((persona) => !routeablePersonas.some((candidate) => candidate.id === persona.id));
    const explicitMentionPersonas = routeablePersonas.filter((persona) => messageMentionsPersona(message, persona, req.mentions));
    const explicitMention = explicitMentionPersonas[0] || null;
    const replyRoute = req.reply_to_message_id ? this.routeFromReply(req.reply_to_message_id, routeablePersonas) : null;
    const activeLock = this.get(
      `SELECT persona_id FROM route_locks WHERE room_id=? AND user_id=? AND status='active' ORDER BY datetime(started_at) DESC LIMIT 1`,
      room.id,
      req.user_id?.trim() || 'desktop_user',
    );
    const lockedPersona = activeLock?.persona_id
      ? routeablePersonas.find((persona) => persona.id === String(activeLock.persona_id))
      : null;
    const entityHitPersonas = routeablePersonas.filter(messageEntityMatchesPersona);
    const entityHit = entityHitPersonas[0] || null;
    const activeThreadRoute = this.routeFromActiveThread(room.id, message, activePersonas);
    const humanCount = (room.members ?? []).filter((member) => member.type === 'human' || member.type === 'user').length;
    const throttleMultiHumanAI = room.type === 'shared'
      && humanCount > 1
      && !['active', 'temporary'].includes(room.default_ai_participation)
      && !replyRoute
      && !explicitMention
      && !lockedPersona
      && !entityHit;
    const scope = req.scope_override || defaultScopeForRoomType(room.type);
    const forceRoomScope = scope === 'room_scope' || scope === 'temporary';
    const selectedPersona = room.type === 'project_dm'
      ? routeablePersonas.find((persona) => persona.id === room.persona_id) || null
      : throttleMultiHumanAI
        ? null
        : replyRoute || explicitMention || lockedPersona || entityHit || activeThreadRoute || activePersonas.find((persona) => persona.id === room.floor_holder_persona_id) || null;
    const dormantWake = Boolean(
      selectedPersona?.status === 'dormant'
      && (replyRoute || explicitMention || lockedPersona || entityHit),
    );
    if (dormantWake && selectedPersona) {
      this.exec(
        `UPDATE personas
         SET status='active',
             metadata=json_set(COALESCE(metadata, '{}'), '$.last_dormant_wake_at', ?, '$.last_dormant_wake_reason', 'route_direct_hit'),
             updated_at=datetime('now')
         WHERE id=?`,
        nowIso(),
        selectedPersona.id,
      );
    }
    const roomProjectID = projectIsRouteable(room.project_id) ? room.project_id || '' : '';
    const ownerProjectID = forceRoomScope || throttleMultiHumanAI ? '' : selectedPersona?.project_id || roomProjectID;
    const collaboratorPersonas = selectedPersona && ownerProjectID && !forceRoomScope && !throttleMultiHumanAI
      ? collaboratorCandidatePersonas.filter((persona) => (
        persona.id !== selectedPersona.id
        && persona.project_id !== ownerProjectID
        && (messageMentionsPersona(message, persona, req.mentions) || messageEntityMatchesPersona(persona))
      ))
      : [];
    const collaboratorPersonaIDs = mergeStringIDs([], collaboratorPersonas.map((persona) => persona.id));
    const collaboratorProjectIDs = mergeStringIDs([], collaboratorPersonas.map((persona) => persona.project_id).filter((projectID) => projectID && projectID !== ownerProjectID));
    const dormantCollaboratorWake = collaboratorPersonas.some((persona) => persona.status === 'dormant');
    for (const persona of collaboratorPersonas) {
      if (persona.status !== 'dormant') continue;
      this.exec(
        `UPDATE personas
         SET status='active',
             metadata=json_set(COALESCE(metadata, '{}'), '$.last_dormant_wake_at', ?, '$.last_dormant_wake_reason', 'collaborator_direct_hit'),
             updated_at=datetime('now')
         WHERE id=?`,
        nowIso(),
        persona.id,
      );
    }
    const reasonCodes = [
      room.type === 'project_dm' ? 'PROJECT_DM_DEFAULT' : '',
      replyRoute ? 'REPLY_TO_PERSONA' : '',
      explicitMention ? 'EXPLICIT_MENTION' : '',
      lockedPersona && !explicitMention && !replyRoute ? 'ROUTE_LOCK_ACTIVE' : '',
      entityHit && !explicitMention && !replyRoute ? 'PROJECT_ENTITY_MATCH' : '',
      activeThreadRoute && selectedPersona?.id === activeThreadRoute.id && !entityHit && !explicitMention && !replyRoute && !lockedPersona ? 'ACTIVE_THREAD_CONTINUITY' : '',
      room.floor_holder_persona_id && selectedPersona?.id === room.floor_holder_persona_id ? 'FLOOR_CONTINUITY' : '',
      collaboratorProjectIDs.length > 0 ? 'CROSS_PROJECT_REFERENCE' : '',
      collaboratorPersonaIDs.length > 0 ? 'COLLABORATOR_PERSONA_INVITED' : '',
      dormantWake || dormantCollaboratorWake ? 'DORMANT_PERSONA_WOKEN' : '',
      excludedArchivedProject ? 'ARCHIVED_PROJECT_EXCLUDED' : '',
      forceRoomScope ? 'ROOM_SCOPE_OVERRIDE' : '',
      throttleMultiHumanAI ? 'MULTI_HUMAN_MODERATE_AI_THROTTLE' : '',
      risk !== 'low' ? `RISK_${risk.toUpperCase()}` : '',
    ].filter(Boolean);
    const confidence = room.type === 'project_dm' || explicitMention || replyRoute || lockedPersona
      ? 1
      : entityHit
        ? 0.86
        : selectedPersona
          ? 0.72
          : 0.42;
    const requiresConfirmation = risk !== 'low' && (!ownerProjectID || confidence < 0.8);
    return {
      room,
      speaker_persona_id: selectedPersona?.id,
      owner_project_id: ownerProjectID,
      executor_persona_id: forceRoomScope && room.type !== 'project_dm' ? undefined : selectedPersona?.id,
      collaborator_project_ids: collaboratorProjectIDs,
      collaborator_persona_ids: collaboratorPersonaIDs,
      execution_scope: forceRoomScope || !ownerProjectID ? 'room_scope' : collaboratorProjectIDs.length > 0 ? 'cross_project' : room.type === 'project_dm' ? 'current_project' : scope,
      write_targets: ownerProjectID ? [ownerProjectID, room.id] : [room.id],
      thread_action: { type: forceRoomScope || !ownerProjectID ? 'none' : 'continue_or_create', source: 'room_kernel' },
      confidence,
      risk,
      requires_confirmation: requiresConfirmation,
      reason_codes: reasonCodes.length ? reasonCodes : ['ROOM_SCOPE_LOW_CONFIDENCE'],
    };
  }

  private routeFromReply(messageID: string, personas: ProjectPersona[]): ProjectPersona | null {
    const direct = this.get(
      `SELECT speaker_persona_id FROM routing_decisions WHERE message_id=? AND speaker_persona_id IS NOT NULL ORDER BY datetime(created_at) DESC LIMIT 1`,
      messageID,
    );
    const directPersonaID = optionalString(direct?.speaker_persona_id);
    if (directPersonaID) return personas.find((persona) => persona.id === directPersonaID) ?? null;
    const messageRow = this.get(`SELECT json_extract(metadata, '$.run_id') AS run_id FROM messages WHERE id=?`, messageID);
    const runID = optionalString(messageRow?.run_id);
    if (!runID) return null;
    const byRun = this.get(
      `SELECT speaker_persona_id FROM routing_decisions WHERE run_id=? AND speaker_persona_id IS NOT NULL ORDER BY datetime(created_at) DESC LIMIT 1`,
      runID,
    );
    const personaID = optionalString(byRun?.speaker_persona_id);
    return personaID ? personas.find((persona) => persona.id === personaID) ?? null : null;
  }

  private resolveRoomForChat(req: ChatRequest, conversationID: string): MessengerRoom | null {
    const roomID = req.room_id?.trim();
    if (roomID) {
      const row = this.get(`SELECT * FROM rooms WHERE id=?`, roomID);
      if (row) return rowToMessengerRoom(row, this.listRoomMembers(roomID));
    }
    const row = this.get(`SELECT * FROM rooms WHERE conversation_id=? ORDER BY datetime(updated_at) DESC LIMIT 1`, conversationID);
    if (row) return rowToMessengerRoom(row, this.listRoomMembers(String(row.id)));
    return null;
  }

  private transaction(fn: () => void): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private exec(sql: string, ...params: SQLiteValue[]): void {
    this.db.prepare(sql).run(...params);
  }

  private get(sql: string, ...params: SQLiteValue[]): SQLiteRow | undefined {
    return this.db.prepare(sql).get(...params) as SQLiteRow | undefined;
  }

  private all(sql: string, ...params: SQLiteValue[]): SQLiteRow[] {
    return this.db.prepare(sql).all(...params) as SQLiteRow[];
  }

  private tableExists(table: string): boolean {
    return Boolean(this.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table));
  }

  private columnExists(table: string, column: string): boolean {
    if (!this.tableExists(table)) return false;
    return this.all(`PRAGMA table_info(${quoteIdentifier(table)})`).some((row) => String(row.name) === column);
  }

  private requireConversationSummary(conversationID: string): ConversationSummary {
    const conversation = this.get(
      `SELECT
         c.*,
         (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY datetime(m.created_at) DESC, m.rowid DESC LIMIT 1) AS last_message,
         (SELECT role FROM messages m WHERE m.conversation_id = c.id ORDER BY datetime(m.created_at) DESC, m.rowid DESC LIMIT 1) AS last_role,
         (SELECT r.id FROM runs r WHERE r.conversation_id = c.id ORDER BY datetime(r.created_at) DESC, r.id DESC LIMIT 1) AS latest_run_id,
         (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
       FROM conversations c
       WHERE c.id = ?`,
      conversationID,
    );
    if (!conversation) throw new Error(`Conversation not found: ${conversationID}`);
    return rowToConversationSummary(conversation);
  }

  private updateConversationLifecycle(
    req: ConversationActionRequest,
    action: string,
    nextStatus: string,
    timestampAssignments: Record<string, string>,
  ): ConversationActionResponse {
    const conversationID = req.id.trim();
    if (!conversationID) throw new Error('conversation id is required');
    const before = this.requireConversationSummary(conversationID);
    const assignments = Object.entries(timestampAssignments).map(([column, expression]) => `${column}=${expression}`);
    this.transaction(() => {
      this.exec(
        `UPDATE conversations
         SET lifecycle_status=?, ${assignments.join(', ')}, updated_at=datetime('now')
         WHERE id=?`,
        nextStatus,
        conversationID,
      );
      this.exec(
        `INSERT INTO conversation_lifecycle_events (id, conversation_id, action, actor, reason, previous_status, next_status, metadata)
         VALUES (?, ?, ?, 'desktop_ui', ?, ?, ?, ?)`,
        `clevt_${newID()}`,
        conversationID,
        action,
        req.reason || '',
        before.lifecycle_status || 'active',
        nextStatus,
        json({ source: 'electron_sqlite_store' }),
      );
    });
    return { conversation: this.requireConversationSummary(conversationID) };
  }
}

function rowToAutomationDefinition(row: SQLiteRow): AutomationDefinition {
  const metadata = parseObject(row.metadata);
  const automationCwds = Array.isArray(metadata.cwds) ? metadata.cwds : parseArray(metadata.cwds);
  const executionKind = normalizeAutomationExecutionKind(
    metadata.execution_kind || (String(row.kind) === 'webhook' ? 'webhook' : 'cron'),
  );
  const triggerConfig = parseObject(row.trigger_config);
  const enabled = Boolean(Number(row.enabled ?? 1));
  return {
    id: String(row.id),
    kind: normalizeAutomationKind(row.kind),
    execution_kind: executionKind,
    status: enabled ? 'ACTIVE' : 'PAUSED',
    slug: String(row.slug),
    name: String(row.name),
    description: optionalString(row.description),
    enabled,
    trigger_config: triggerConfig,
    prompt_template: optionalString(row.prompt_template) || '',
    input_mode: normalizeAutomationInputMode(row.input_mode),
    permission_profile: normalizeAutomationPermissionProfile(row.permission_profile),
    preferred_node: optionalString(row.preferred_node) || 'main-node',
    allow_worker: Boolean(Number(row.allow_worker ?? 0)),
    agent_role_id: optionalString(row.agent_role_id) || optionalString(metadata.agent_role_id) || 'general_agent',
    conversation_id: optionalString(row.conversation_id),
    principal_id: optionalString(row.principal_id),
    dedup_policy: parseObject(row.dedup_policy),
    retry_policy: parseObject(row.retry_policy),
    max_concurrency: Math.max(1, Number(row.max_concurrency ?? 1)),
    notification_policy: parseObject(row.notification_policy),
    rrule: optionalString(metadata.rrule) || optionalString(triggerConfig.rrule),
    model: optionalString(metadata.model),
    model_provider: optionalString(metadata.model_provider),
    model_base_url: optionalString(metadata.model_base_url),
    reasoning_effort: optionalString(metadata.reasoning_effort),
    execution_environment: optionalString(metadata.execution_environment) || 'local',
    target: isRecord(metadata.target) ? metadata.target : parseObject(metadata.target),
    cwds: automationCwds.map(String).filter(Boolean),
    target_thread_id: optionalString(metadata.target_thread_id) || (executionKind === 'heartbeat' ? optionalString(row.conversation_id) : undefined),
    is_draft: Boolean(metadata.is_draft),
    next_fire_at: optionalString(row.next_fire_at),
    last_fire_at: optionalString(row.last_fire_at),
    metadata,
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
  };
}

function rowToAutomationTrigger(row: SQLiteRow): AutomationTriggerRecord {
  return {
    id: String(row.id),
    automation_id: String(row.automation_id),
    trigger_type: optionalString(row.trigger_type) || 'schedule',
    dedup_key: String(row.dedup_key),
    payload: parseObject(row.payload),
    status: optionalString(row.status) || 'pending',
    fire_at: optionalString(row.fire_at),
    claimed_at: optionalString(row.claimed_at),
    claim_token: optionalString(row.claim_token),
    run_id: optionalString(row.run_id),
    product_task_id: optionalString(row.product_task_id),
    attempt_count: Number(row.attempt_count ?? 0),
    next_attempt_at: optionalString(row.next_attempt_at),
    error_code: optionalString(row.error_code),
    error_message: optionalString(row.error_message),
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
  };
}

function rowToAutomationRun(row: SQLiteRow): AutomationRunRecord {
  const metadata = parseObject(row.metadata);
  return {
    id: String(row.id),
    automation_id: String(row.automation_id),
    trigger_id: String(row.trigger_id),
    run_id: optionalString(row.run_id),
    product_task_id: optionalString(row.product_task_id),
    status: optionalString(row.status) || 'running',
    attempt_number: Math.max(1, Number(row.attempt_number ?? 1)),
    started_at: optionalString(row.started_at),
    finished_at: optionalString(row.finished_at),
    output_summary: optionalString(row.output_summary),
    error_code: optionalString(row.error_code),
    error_message: optionalString(row.error_message),
    conversation_id: optionalString(metadata.conversation_id),
    source_cwd: optionalString(metadata.source_cwd),
    automation_name: optionalString(metadata.automation_name),
    read_at: optionalString(metadata.read_at),
    archived_at: optionalString(metadata.archived_at),
    metadata,
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
  };
}

function rowToTelegramInboundUpdate(row: SQLiteRow): TelegramInboundUpdateRecord {
  return {
    update_id: Number(row.update_id),
    message_id: optionalString(row.message_id) || '',
    chat_id: optionalString(row.chat_id) || '',
    from_id: optionalString(row.from_id) || '',
    chat_type: optionalString(row.chat_type) || '',
    text: optionalString(row.text) || '',
    status: optionalString(row.status) || 'pending',
    claim_token: optionalString(row.claim_token),
    claimed_at: optionalString(row.claimed_at),
    model_started_at: optionalString(row.model_started_at),
    run_id: optionalString(row.run_id),
    response_text: optionalString(row.response_text) || '',
    response_started_at: optionalString(row.response_started_at),
    response_sent_at: optionalString(row.response_sent_at),
    external_delivery_id: optionalString(row.external_delivery_id),
    error_code: optionalString(row.error_code),
    error_message: optionalString(row.error_message),
    metadata: parseObject(row.metadata),
    received_at: optionalString(row.received_at),
    updated_at: optionalString(row.updated_at),
  };
}

function rowToConversationGroup(row: SQLiteRow): ConversationGroup {
  return {
    id: String(row.id),
    name: String(row.name),
    sort_order: Number(row.sort_order ?? 0),
    collapsed: Boolean(Number(row.collapsed ?? 0)),
    metadata: parseObject(row.metadata),
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
  };
}

function rowToConversationSummary(row: SQLiteRow): ConversationSummary {
  return {
    id: String(row.id),
    principal_id: optionalString(row.principal_id),
    channel: String(row.channel),
    user_id: String(row.user_id),
    title: optionalString(row.title) || 'Untitled',
    active_agent_id: optionalString(row.active_agent_id),
    topic: optionalString(row.topic),
    group_id: optionalString(row.group_id),
    lifecycle_status: optionalString(row.lifecycle_status) || 'active',
    pinned: Boolean(Number(row.pinned ?? 0)),
    last_message: optionalString(row.last_message),
    last_role: optionalString(row.last_role),
    latest_run_id: optionalString(row.latest_run_id),
    message_count: Number(row.message_count ?? 0),
    metadata: parseObject(row.metadata),
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
    archived_at: optionalString(row.archived_at),
    trashed_at: optionalString(row.trashed_at),
    purge_after: optionalString(row.purge_after),
    restored_at: optionalString(row.restored_at),
  };
}

function rowToConversationMessage(row: SQLiteRow): ConversationMessage {
  return {
    id: String(row.id),
    conversation_id: String(row.conversation_id),
    role: String(row.role),
    content: String(row.content),
    run_id: optionalString(parseObject(row.metadata).run_id),
    attachments: parseArray(row.attachments),
    metadata: parseObject(row.metadata),
    created_at: optionalString(row.created_at),
  };
}

function rowToMessengerProject(row: SQLiteRow): MessengerProject {
  return {
    id: String(row.id),
    name: optionalString(row.name) || 'Joi Project',
    goal: optionalString(row.goal),
    domain: optionalString(row.domain),
    phase: optionalString(row.phase),
    risk_level: optionalString(row.risk_level) || 'low',
    status: optionalString(row.status) || 'active',
    summary: optionalString(row.summary),
    metadata: parseObject(row.metadata),
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
    archived_at: optionalString(row.archived_at),
  };
}

function rowToProjectPersona(row: SQLiteRow): ProjectPersona {
  const traitsRaw = parseObject(row.traits);
  const metadata = parseObject(row.metadata);
  const traits: Record<string, number> = {};
  for (const [key, value] of Object.entries(traitsRaw)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) traits[key] = numeric;
  }
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    display_name: optionalString(row.display_name) || 'Joi',
    handle: optionalString(row.handle) || '@joi',
    avatar: optionalString(row.avatar),
    tagline: optionalString(row.tagline),
    self_intro: optionalString(row.self_intro),
    traits,
    disagreement_style: optionalString(row.disagreement_style),
    uncertainty_style: optionalString(row.uncertainty_style),
    status: optionalString(row.status) || 'active',
    version: Number(row.version ?? 1),
    capabilities: parseArray(row.capabilities).map(String),
    permission_summary: optionalString(row.permission_summary),
    model_strategy: optionalString(row.model_strategy),
    model_reasoning_effort: optionalReasoningEffort(metadata.model_reasoning_effort),
    metadata,
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
  };
}

function rowToMessengerRoom(row: SQLiteRow, members: MessengerRoom['members'] = []): MessengerRoom {
  const metadata = parseObject(row.metadata);
  return {
    id: String(row.id),
    type: optionalString(row.type) || 'project_dm',
    title: cleanMessengerTitle(optionalString(row.title) || 'Joi 项目私聊'),
    avatar: optionalString(metadata.avatar),
    subtitle: optionalString(row.subtitle),
    owner_user_id: optionalString(row.owner_user_id) || 'desktop_user',
    project_id: optionalString(row.project_id),
    persona_id: optionalString(row.persona_id),
    conversation_id: optionalString(row.conversation_id),
    default_ai_participation: optionalString(row.default_ai_participation) || 'moderate',
    floor_holder_persona_id: optionalString(row.floor_holder_persona_id),
    route_lock_persona_id: optionalString(row.route_lock_persona_id),
    unread_count: Number(row.unread_count ?? 0),
    pending_approval_count: Number(row.pending_approval_count ?? 0),
    failed_run_count: Number(row.failed_run_count ?? 0),
    running_run_count: Number(row.running_run_count ?? 0),
    last_message: optionalString(row.last_message),
    last_role: optionalString(row.last_role),
    last_activity_at: optionalString(row.updated_at) || optionalString(row.created_at),
    archived_at: optionalString(row.archived_at),
    metadata,
    members,
  };
}

function rowToRoomConnector(row: SQLiteRow): RoomConnector {
  return {
    id: String(row.id),
    room_id: String(row.room_id),
    provider: optionalString(row.provider) || 'external',
    connector_id: optionalString(row.connector_id) || String(row.id),
    external_room_id: optionalString(row.external_room_id) || '',
    status: optionalString(row.status) || 'active',
    visible_persona_ids: parseArray(row.visible_persona_ids).map(String),
    allow_temporary_invite: Boolean(Number(row.allow_temporary_invite ?? 0)),
    retry_count: Number(row.retry_count ?? 0),
    last_error: optionalString(row.last_error),
    metadata: parseObject(row.metadata),
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
  };
}

function rowToExternalConnectorEvent(row: SQLiteRow): ExternalConnectorEvent {
  return {
    id: String(row.id),
    connector_id: String(row.connector_id),
    provider: optionalString(row.provider) || 'external',
    external_event_id: optionalString(row.external_event_id) || '',
    room_id: String(row.room_id),
    external_user_id: optionalString(row.external_user_id) || '',
    reply_to_external_message_id: optionalString(row.reply_to_external_message_id),
    text: optionalString(row.text) || '',
    internal_message_id: optionalString(row.internal_message_id),
    status: optionalString(row.status) || 'received',
    retry_count: Number(row.retry_count ?? 0),
    error: optionalString(row.error),
    metadata: parseObject(row.metadata),
    created_at: optionalString(row.created_at),
  };
}

function rowToRouteLock(row: SQLiteRow): RouteLock {
  return {
    room_id: String(row.room_id),
    user_id: optionalString(row.user_id) || 'desktop_user',
    persona_id: String(row.persona_id),
    started_at: optionalString(row.started_at),
    expires_at: optionalString(row.expires_at),
    status: optionalString(row.status) || 'active',
  };
}

function rowToRoutingDecision(row: SQLiteRow): RoutingDecision {
  return {
    id: String(row.id),
    room_id: String(row.room_id),
    message_id: optionalString(row.message_id),
    run_id: optionalString(row.run_id),
    speaker_persona_id: optionalString(row.speaker_persona_id),
    owner_project_id: optionalString(row.owner_project_id),
    executor_persona_id: optionalString(row.executor_persona_id),
    collaborator_project_ids: parseArray(row.collaborator_project_ids).map(String),
    execution_scope: optionalString(row.execution_scope) || 'room_scope',
    write_targets: parseArray(row.write_targets).map(String),
    thread_action: parseObject(row.thread_action),
    confidence: Number(row.confidence ?? 0),
    risk: optionalString(row.risk) || 'low',
    requires_confirmation: Boolean(Number(row.requires_confirmation ?? 0)),
    reason_codes: parseArray(row.reason_codes).map(String),
    created_at: optionalString(row.created_at),
  };
}

function rowToMessengerThread(row: SQLiteRow): MessengerThread {
  return {
    id: String(row.id),
    project_id: optionalString(row.project_id),
    project_name: optionalString(row.project_name),
    room_id: optionalString(row.room_id),
    room_title: optionalString(row.room_title),
    owner_persona_id: optionalString(row.owner_persona_id),
    owner_persona_name: optionalString(row.owner_persona_name),
    title: optionalString(row.title) || 'Untitled Thread',
    goal: optionalString(row.goal),
    status: optionalString(row.status) || 'active',
    priority: optionalString(row.priority) || 'normal',
    collaborator_persona_ids: parseArray(row.collaborator_persona_ids).map(String),
    source_room_ids: parseArray(row.source_room_ids).map(String),
    source_message_ids: parseArray(row.source_message_ids).map(String),
    run_ids: parseArray(row.run_ids).map(String),
    artifact_ids: parseArray(row.artifact_ids).map(String),
    next_action: optionalString(row.next_action),
    message_count: Number(row.message_count ?? 0),
    run_count: Number(row.run_count ?? 0),
    artifact_count: Number(row.artifact_count ?? 0),
    latest_run_status: optionalString(row.latest_run_status),
    metadata: parseObject(row.metadata),
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
    closed_at: optionalString(row.closed_at),
  };
}

function rowToMessengerThreadEvent(row: SQLiteRow): MessengerThreadEvent {
  return {
    id: String(row.id),
    thread_id: String(row.thread_id),
    room_id: optionalString(row.room_id),
    message_id: optionalString(row.message_id),
    run_id: optionalString(row.run_id),
    artifact_id: optionalString(row.artifact_id),
    product_task_id: optionalString(row.product_task_id),
    event_type: optionalString(row.event_type) || 'message_linked',
    summary: optionalString(row.summary),
    metadata: parseObject(row.metadata),
    created_at: optionalString(row.created_at),
  };
}

function rowToPersonaVersion(row: SQLiteRow): PersonaVersion {
  return {
    id: String(row.id),
    persona_id: String(row.persona_id),
    version: Number(row.version ?? 1),
    changed_by: optionalString(row.changed_by) || 'desktop_user',
    change_reason: optionalString(row.change_reason) || '',
    before: parseObject(row.before_json) as ProjectPersona,
    after: parseObject(row.after_json) as ProjectPersona,
    applies_from_message_id: optionalString(row.applies_from_message_id),
    created_at: optionalString(row.created_at),
  };
}

function rowToRunEvent(row: SQLiteRow): RunEvent {
  const payload = {
    ...parseObject(row.payload),
    ...parseObject(row.payload_json),
  };
  const eventType = optionalString(row.event_type) || optionalString(payload.event_type) || optionalString(payload.type) || '';
  const errorPayload = parseObject(row.error_json);
  const usagePayload = parseObject(row.usage_json);
  const snapshot = parseObject(payload.snapshot);
  const delta = payload.delta;
  return {
    id: String(row.id),
    run_id: String(row.run_id),
    turn_id: optionalString(row.turn_id),
    seq: Number(row.seq),
    event_type: eventType,
    type: optionalString(payload.type) || eventType,
    schema_version: Number(row.schema_version ?? payload.schema_version ?? 1),
    conversation_id: optionalString(row.conversation_id) || optionalString(payload.conversation_id),
    item_type: optionalString(row.item_type) || optionalString(payload.item_type),
    item_id: optionalString(row.item_id) || optionalString(payload.item_id),
    parent_item_id: optionalString(row.parent_item_id) || optionalString(payload.parent_item_id),
    phase: optionalString(row.phase) || optionalString(payload.phase),
    visibility: optionalString(row.visibility) || optionalString(payload.visibility),
    source: optionalString(row.source) || optionalString(payload.source),
    level: optionalString(row.level) || optionalString(payload.level),
    risk_level: optionalString(row.risk_level) || optionalString(payload.risk_level),
    category: optionalString(row.category) || optionalString(payload.category),
    feature_key: optionalString(row.feature_key) || optionalString(payload.feature_key),
    message: optionalString(row.message) || optionalString(payload.message),
    terminal: Boolean(Number(row.terminal ?? 0) || payload.terminal),
    status: optionalString(payload.status),
    title: optionalString(payload.title),
    summary: optionalString(payload.summary),
    payload,
    snapshot: Object.keys(snapshot).length > 0 ? snapshot : undefined,
    delta: typeof delta === 'string' ? delta : delta && typeof delta === 'object' ? delta as Record<string, unknown> : undefined,
    metadata: parseObject(payload.metadata),
    error: optionalString(payload.error) || optionalString(errorPayload.message),
    usage: Object.keys(usagePayload).length > 0 ? usagePayload : parseObject(payload.usage),
    created_at: optionalString(row.created_at),
  };
}

function rowToLogEntry(row: SQLiteRow): LogEntry {
  const sourceTable = optionalString(row.source_table) || 'app_logs';
  const eventType = optionalString(row.event_type);
  const action = optionalString(row.action);
  const error = sanitizeLogPayload(parseObject(row.error));
  return {
    id: String(row.id),
    source_table: sourceTable,
    level: optionalString(row.level) || 'info',
    risk_level: optionalString(row.risk_level) || 'read_only',
    category: optionalString(row.category) || 'system',
    feature_key: optionalString(row.feature_key) || eventType || action || 'log',
    source: optionalString(row.source) || sourceTable,
    message: optionalString(row.message) || eventType || action || 'log',
    run_id: optionalString(row.run_id),
    turn_id: optionalString(row.turn_id),
    conversation_id: optionalString(row.conversation_id),
    item_type: optionalString(row.item_type),
    item_id: optionalString(row.item_id),
    event_type: eventType,
    action,
    status: optionalString(row.status),
    payload: sanitizeLogPayload(parseObject(row.payload)),
    error: Object.keys(error).length > 0 ? error : undefined,
    duration_ms: optionalNumber(row.duration_ms),
    hidden_by_default: sourceTable === 'worker_gateway_audit_logs' && ['heartbeat', 'claim'].includes(action || '')
      || sourceTable === 'run_events' && ['assistant.delta', 'model.delta', 'message.delta'].includes(eventType || ''),
    created_at: optionalString(row.created_at),
  };
}

function rowToModelCall(row: SQLiteRow): ModelCall {
  return {
    id: String(row.id),
    provider: optionalString(row.provider) || 'openai_compatible',
    model_name: optionalString(row.model_name) || 'model',
    status: optionalString(row.status) || 'succeeded',
    input_tokens: Number(row.input_tokens ?? 0),
    output_tokens: Number(row.output_tokens ?? 0),
    cached_input_tokens: Number(row.cached_input_tokens ?? 0),
    cache_write_input_tokens: optionalNumber(row.cache_write_input_tokens),
    reasoning_tokens: optionalNumber(row.reasoning_tokens),
    total_tokens: optionalNumber(row.total_tokens) || Number(row.input_tokens ?? 0) + Number(row.output_tokens ?? 0),
    cacheable_prefix_tokens: optionalNumber(row.cacheable_prefix_tokens),
    dynamic_tail_tokens: optionalNumber(row.dynamic_tail_tokens),
    cost_estimate: optionalNumber(row.cost_estimate),
    latency_ms: Number(row.latency_ms ?? 0),
    usage_status: optionalString(row.usage_status),
    finish_reason: optionalString(row.finish_reason),
    prompt_cache_key: optionalString(row.prompt_cache_key),
    prefix_hash: optionalString(row.prefix_hash),
    dynamic_tail_hash: optionalString(row.dynamic_tail_hash),
    metadata: parseObject(row.metadata),
  };
}

function rowToModelTraceSpan(row: SQLiteRow): RunTraceSpan {
  const inputTokens = Number(row.input_tokens ?? 0);
  const outputTokens = Number(row.output_tokens ?? 0);
  const cachedTokens = Number(row.cached_input_tokens ?? 0);
  const totalTokens = Number(row.total_tokens ?? 0) || inputTokens + outputTokens;
  const status = optionalString(row.status) || 'succeeded';
  const error = optionalString(row.error_message) || optionalString(row.error_code);
  const provider = optionalString(row.provider) || 'openai_compatible';
  const modelName = optionalString(row.model_name) || 'model';
  return {
    id: `model:${String(row.id)}`,
    run_id: optionalString(row.run_id) || '',
    span_type: 'model_span',
    event_type: status === 'failed' || error ? 'model_failed' : 'model_completed',
    title: `${provider}/${modelName}`,
    status,
    room_id: optionalString(row.room_id),
    room_title: optionalString(row.room_title),
    project_id: optionalString(row.project_id),
    project_name: optionalString(row.project_name),
    persona_id: optionalString(row.persona_id),
    persona_name: optionalString(row.persona_name),
    model_provider: provider,
    model_name: modelName,
    duration_ms: optionalNumber(row.latency_ms),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: cachedTokens,
    total_tokens: totalTokens,
    cost_estimate: optionalNumber(row.cost_estimate),
    error,
    has_error: hasErrorStatus(status, error),
    has_external_side_effect: false,
    created_at: optionalString(row.created_at),
    metadata: {
      prompt_cache_key: optionalString(row.prompt_cache_key),
      prefix_hash: optionalString(row.prefix_hash),
      dynamic_tail_hash: optionalString(row.dynamic_tail_hash),
      usage_status: optionalString(row.usage_status),
      finish_reason: optionalString(row.finish_reason),
    },
  };
}

function rowToToolTraceSpan(row: SQLiteRow): RunTraceSpan {
  const status = optionalString(row.status) || 'pending';
  const error = optionalString(row.error_message) || optionalString(row.error_code) || optionalString(row.error);
  const sideEffectLevel = optionalString(row.side_effect_level) || 'none';
  const riskLevel = optionalString(row.risk_level) || 'read_only';
  const toolName = optionalString(row.tool_name) || optionalString(row.capability_id) || 'tool';
  return {
    id: `tool:${String(row.id)}`,
    run_id: optionalString(row.run_id) || '',
    span_type: 'tool_span',
    event_type: hasErrorStatus(status, error) ? 'tool_failed' : 'tool_completed',
    title: toolName,
    status,
    room_id: optionalString(row.room_id),
    room_title: optionalString(row.room_title),
    project_id: optionalString(row.project_id),
    project_name: optionalString(row.project_name),
    persona_id: optionalString(row.persona_id),
    persona_name: optionalString(row.persona_name),
    tool_name: toolName,
    risk_level: riskLevel,
    duration_ms: optionalNumber(row.duration_ms),
    error: error ? redactSensitiveText(error) : undefined,
    has_error: hasErrorStatus(status, error),
    has_external_side_effect: sideEffectLevel !== 'none' && sideEffectLevel !== 'read_only' || !['read_only', 'low'].includes(riskLevel),
    created_at: optionalString(row.created_at) || optionalString(row.started_at),
    metadata: {
      capability_id: optionalString(row.capability_id),
      workflow_name: optionalString(row.workflow_name),
      node_id: optionalString(row.node_id),
      side_effect_level: sideEffectLevel,
      approval_request_id: optionalString(row.approval_request_id),
      output_summary: optionalString(row.output_summary),
      artifact_id: optionalString(row.artifact_id),
    },
  };
}

function rowToEventTraceSpan(row: SQLiteRow): RunTraceSpan {
  const payloadJson = parseObject(row.payload_json);
  const payload = Object.keys(payloadJson).length > 0 ? payloadJson : parseObject(row.payload);
  const eventType = optionalString(row.event_type) || 'run_event';
  const status = optionalString(payload.status) || optionalString(row.status) || statusFromEventType(eventType);
  const error = optionalString(row.error_json) || optionalString(payload.error) || optionalString(payload.message && status === 'failed' ? payload.message : '');
  return {
    id: `event:${String(row.id)}`,
    run_id: optionalString(row.run_id) || '',
    span_type: 'run_event',
    event_type: eventType,
    title: optionalString(row.message) || optionalString(payload.title) || optionalString(payload.summary) || eventType,
    status,
    room_id: optionalString(row.room_id),
    room_title: optionalString(row.room_title),
    project_id: optionalString(row.project_id),
    project_name: optionalString(row.project_name),
    persona_id: optionalString(row.persona_id),
    persona_name: optionalString(row.persona_name),
    risk_level: optionalString(row.risk_level),
    duration_ms: optionalNumber(row.duration_ms),
    error: error ? redactSensitiveText(error) : undefined,
    has_error: hasErrorStatus(status, error) || eventType.endsWith('.failed') || eventType.endsWith('_failed'),
    has_external_side_effect: eventType.includes('external') || eventType.includes('handoff'),
    created_at: optionalString(row.created_at),
    metadata: {
      seq: optionalNumber(row.seq),
      item_type: optionalString(row.item_type),
      item_id: optionalString(row.item_id),
      visibility: optionalString(row.visibility),
      source: optionalString(row.source),
      category: optionalString(row.category),
      feature_key: optionalString(row.feature_key),
    },
  };
}

function traceSpanMatchesFilter(span: RunTraceSpan, filter: RunTraceSpanFilter): boolean {
  if (filter.room_id && span.room_id !== filter.room_id) return false;
  if (filter.project_id && span.project_id !== filter.project_id) return false;
  if (filter.persona_id && span.persona_id !== filter.persona_id) return false;
  if (filter.model_provider && span.model_provider !== filter.model_provider) return false;
  if (filter.model_name && span.model_name !== filter.model_name) return false;
  if (filter.span_type && span.span_type !== filter.span_type) return false;
  if (filter.status && span.status !== filter.status) return false;
  if (typeof filter.has_error === 'boolean' && span.has_error !== filter.has_error) return false;
  if (typeof filter.has_external_side_effect === 'boolean' && span.has_external_side_effect !== filter.has_external_side_effect) return false;
  return true;
}

function summarizeRunTraceSpans(spans: RunTraceSpan[]): RunTraceSpanSummary {
  return spans.reduce<RunTraceSpanSummary>((summary, span) => {
    summary.total += 1;
    if (span.span_type === 'model_span') summary.model_count += 1;
    if (span.span_type === 'tool_span') summary.tool_count += 1;
    if (span.has_error) summary.error_count += 1;
    if (span.has_external_side_effect) summary.external_side_effect_count += 1;
    summary.total_tokens += Number(span.total_tokens ?? 0);
    summary.total_cost_estimate += Number(span.cost_estimate ?? 0);
    return summary;
  }, {
    total: 0,
    model_count: 0,
    tool_count: 0,
    error_count: 0,
    external_side_effect_count: 0,
    total_tokens: 0,
    total_cost_estimate: 0,
  });
}

function statusFromEventType(eventType: string): string {
  if (eventType.endsWith('.failed') || eventType.endsWith('_failed') || eventType === 'run.failed') return 'failed';
  if (eventType.endsWith('.started') || eventType.endsWith('_started') || eventType === 'run.started') return 'running';
  if (eventType.includes('approval') && (eventType.endsWith('.requested') || eventType.endsWith('.required'))) return 'waiting_approval';
  if (eventType.endsWith('.completed') || eventType.endsWith('_completed') || eventType === 'run.completed') return 'completed';
  return 'completed';
}

function hasErrorStatus(status: string, error?: string): boolean {
  const normalized = status.toLowerCase();
  return Boolean(error) || ['failed', 'error', 'blocked', 'policy_blocked'].includes(normalized);
}

function rowToMCPServer(row: SQLiteRow): MCPServerRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    transport: optionalString(row.transport) || 'stdio',
    command: optionalString(row.command),
    args: parseArray(row.args).map(String),
    url: optionalString(row.url),
    env: stringRecord(row.env),
    headers: stringRecord(row.headers),
    enabled: Boolean(Number(row.enabled ?? 0)),
    status: optionalString(row.status) || 'inactive',
    trust: optionalString(row.trust) || 'untrusted_until_wrapped',
    last_sync_at: optionalString(row.last_sync_at),
    last_sync_error: optionalString(row.last_sync_error),
    tools: [],
    resources: [],
    prompts: [],
    metadata: parseObject(row.metadata),
  };
}

function rowToToolWorkflow(row: SQLiteRow): ToolWorkflowRecord {
  return {
    id: String(row.id),
    capability_id: optionalString(row.capability_id) || '',
    name: String(row.name),
    version: optionalString(row.version) || 'v1',
    risk_level: optionalString(row.risk_level) || 'read_only',
    steps: parseArray(row.steps) as ToolWorkflowRecord['steps'],
    enabled: Boolean(Number(row.enabled ?? 1)),
    metadata: parseObject(row.metadata),
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
  };
}

function rowToToolRun(row: SQLiteRow): ToolRunRecord {
  const errorRaw = optionalString(row.error) || '';
  const parsedError = parseObject(redactSensitiveText(errorRaw));
  return {
    id: String(row.id),
    run_id: optionalString(row.run_id),
    task_id: optionalString(row.task_id),
    capability_id: optionalString(row.capability_id),
    workflow_name: optionalString(row.workflow_name),
    tool_id: optionalString(row.tool_id),
    tool_name: String(row.tool_name),
    node_id: optionalString(row.node_id),
    assignment_reason: optionalString(row.assignment_reason),
    risk_level: optionalString(row.risk_level) || 'read_only',
    status: optionalString(row.status) || 'pending',
    input: sanitizeDiagnosticValue(parseObject(row.input)) as Record<string, unknown>,
    output: sanitizeDiagnosticValue(parseObject(row.output)) as Record<string, unknown>,
    error: Object.keys(parsedError).length > 0 ? parsedError : errorRaw ? { message: redactSensitiveText(errorRaw) } : undefined,
    started_at: optionalString(row.started_at),
    finished_at: optionalString(row.finished_at),
    duration_ms: optionalNumber(row.duration_ms),
    created_at: optionalString(row.created_at),
  };
}

function rowToMemory(row: SQLiteRow): MemoryRecord {
  const disabledAt = optionalString(row.disabled_at);
  const metadata = parseObject(row.metadata);
  const type = optionalString(row.type) || 'note';
  return {
    id: String(row.id),
    layer: optionalString(row.layer) || inferLegacyMemoryLayer(type, metadata),
    type,
    memory_key: optionalString(row.memory_key),
    content: String(row.content),
    summary: optionalString(row.summary) || '',
    scope_type: optionalString(row.scope_type) || 'global',
    scope_id: optionalString(row.scope_id),
    privacy_level: optionalString(row.privacy_level) || 'internal',
    evidence_kind: optionalString(row.evidence_kind) || 'legacy',
    evidence_authority: Number(row.evidence_authority ?? memoryEvidenceAuthority('legacy')),
    evidence_count: Number(row.evidence_count ?? 1),
    status: optionalString(row.status) || 'pending',
    lifecycle_state: optionalString(row.lifecycle_state) || (disabledAt ? 'disabled' : 'active'),
    confidence: Number(row.confidence ?? 0.5),
    pinned: Boolean(Number(row.pinned ?? 0)),
    disabled: Boolean(disabledAt),
    disabled_at: disabledAt,
    usage_count: Number(row.usage_count ?? 0),
    success_count: Number(row.success_count ?? 0),
    failure_count: Number(row.failure_count ?? 0),
    positive_feedback: Number(row.positive_feedback ?? 0),
    negative_feedback: Number(row.negative_feedback ?? 0),
    source_event_ids: parseArray(row.source_event_ids).map(String),
    source_kind: optionalString(row.source_kind) || optionalString(metadata.source) || 'legacy',
    entities: parseArray(row.entities).map(String),
    context_tags: parseStringArray(row.context_tags),
    merged_into_memory_id: optionalString(row.merged_into_memory_id),
    supersedes_memory_id: optionalString(row.supersedes_memory_id),
    conflict_group_id: optionalString(row.conflict_group_id),
    conflict_reason: optionalString(row.conflict_reason),
    review_reason: optionalString(row.review_reason),
    valid_from: optionalString(row.valid_from),
    valid_until: optionalString(row.valid_until),
    last_verified_at: optionalString(row.last_verified_at),
    archived_at: optionalString(row.archived_at),
    auto_managed: Boolean(Number(row.auto_managed ?? 1)),
    retention_policy: optionalString(row.retention_policy) || 'standard',
    metadata,
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
    last_used_at: optionalString(row.last_used_at),
  };
}

function rowToPersonaConstitution(row: SQLiteRow): PersonaConstitutionRecord {
  return {
    id: optionalString(row.id) || 'constitution_joi_v2',
    version: Number(row.version || DEFAULT_JOI_PERSONA_CONSTITUTION.version),
    name: optionalString(row.name) || 'Joi',
    identity: optionalString(row.identity) || DEFAULT_JOI_PERSONA_CONSTITUTION.identity || '',
    character_profile: parseObject(row.character_profile) as PersonaConstitutionRecord['character_profile'],
    relationship: parseObject(row.relationship) as PersonaConstitutionRecord['relationship'],
    default_user: parseObject(row.default_user) as PersonaConstitutionRecord['default_user'],
    principles: parseStringArray(row.principles),
    voice: parseStringArray(row.voice),
    disagreement_style: optionalString(row.disagreement_style) || '',
    uncertainty_style: optionalString(row.uncertainty_style) || '',
    boundaries: parseStringArray(row.boundaries),
    compiled_prompt: optionalString(row.compiled_prompt) || '',
    status: optionalString(row.status) || 'active',
    source_event_ids: parseStringArray(row.source_event_ids),
    metadata: parseObject(row.metadata),
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
  };
}

function rowToMemoryMaintenance(row: SQLiteRow): MemoryMaintenanceRun {
  const metadata = parseObject(row.metadata);
  return {
    id: optionalString(row.id) || '',
    status: optionalString(row.status) || 'unknown',
    trigger_source: optionalString(row.trigger_source) || 'unknown',
    processed_input_count: Number(row.processed_input_count || 0),
    generated_observation_count: Number(row.generated_observation_count || 0),
    expired_count: Number(row.expired_count || 0),
    merged_count: Number(row.merged_count || 0),
    embedding_count: Number(row.embedding_count || 0),
    quarantined_count: Number(row.quarantined_count ?? metadata.quarantined_count ?? 0),
    error_summary: optionalString(row.error_summary),
    metadata,
    started_at: optionalString(row.started_at),
    finished_at: optionalString(row.finished_at),
  };
}

function rowToNode(row: SQLiteRow): NodeRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    role: optionalString(row.role) || 'worker',
    status: optionalString(row.status) || 'unknown',
    capabilities: parseArray(row.capabilities),
    auto_assign_enabled: Boolean(Number(row.auto_assign_enabled ?? 1)),
    manual_assign_enabled: Boolean(Number(row.manual_assign_enabled ?? 1)),
    metadata: parseObject(row.metadata),
  };
}

function rowToConfirmation(row: SQLiteRow): ConfirmationRecord {
  const input = parseObject(row.input);
  return {
    id: String(row.id),
    run_id: optionalString(row.run_id) || '',
    capability_id: optionalString(row.capability_id) || '',
    requested_action: String(row.requested_action),
    risk_level: optionalString(row.risk_level) || 'read_only',
    status: optionalString(row.status) || 'pending',
    input,
    call_id: optionalString(row.call_id),
    turn_id: optionalString(row.turn_id),
    approval_scope: normalizeApprovalScope(optionalString(row.approval_scope)),
    approval_key: optionalString(row.approval_key),
    operation_id: optionalString(input.operation_id),
    affected_paths: parseStringArray(input.affected_paths),
    external_target: optionalString(input.external_target),
    reversible: typeof input.reversible === 'boolean' ? input.reversible : undefined,
    approved_by: optionalString(row.approved_by),
    rejected_by: optionalString(row.rejected_by),
    decision_reason: optionalString(row.decision_reason),
    created_at: optionalString(row.created_at),
    decided_at: optionalString(row.decided_at),
    resumed_at: optionalString(row.resumed_at),
  };
}

function rowToProductTask(row: SQLiteRow): ProductTask {
  const metadata = parseObject(row.metadata);
  return {
    id: String(row.id),
    principal_id: optionalString(row.principal_id),
    title: String(row.title),
    description: optionalString(row.description) || '',
    status: optionalString(row.status) || 'planning',
    mode: optionalString(row.mode) || 'serious_task',
    priority: optionalString(row.priority) || 'normal',
    created_from_conversation_id: optionalString(row.created_from_conversation_id),
    created_from_message_id: optionalString(row.created_from_message_id),
    latest_run_id: optionalString(row.latest_run_id),
    owner_user_id: optionalString(row.owner_user_id),
    source_channel: optionalString(row.source_channel),
    risk_level: optionalString(row.risk_level) || 'read_only',
    progress_percent: Number(row.progress_percent ?? 0),
    current_step_id: optionalString(row.current_step_id),
    summary: optionalString(row.summary),
    source_conversation_id: optionalString(row.source_conversation_id),
    source_run_id: optionalString(row.source_run_id),
    source_turn_id: optionalString(row.source_turn_id),
    mode_resolution_id: optionalString(row.mode_resolution_id),
    terminal_status: optionalString(row.terminal_status),
    terminal_reason: optionalString(row.terminal_reason),
    evidence_summary: optionalString(row.evidence_summary),
    verification_status: optionalString(row.verification_status),
    last_projected_at: optionalString(row.last_projected_at),
    metadata,
    task_contract: taskContractFromMetadata(metadata),
    verification: taskVerificationFromMetadata(metadata),
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
    completed_at: optionalString(row.completed_at),
  };
}

function rowToProductTaskStep(row: SQLiteRow): ProductTaskStep {
  return {
    id: String(row.id),
    product_task_id: String(row.product_task_id),
    title: String(row.title),
    description: optionalString(row.description),
    status: optionalString(row.status) || 'pending',
    sort_order: Number(row.sort_order ?? 0),
    capability_id: optionalString(row.capability_id),
    tool_workflow_id: optionalString(row.tool_workflow_id),
    run_id: optionalString(row.run_id),
    tool_run_id: optionalString(row.tool_run_id),
    worker_task_id: optionalString(row.worker_task_id),
    summary: optionalString(row.summary),
    input: parseObject(row.input),
    output: parseObject(row.output),
    error: parseObject(row.error),
    started_at: optionalString(row.started_at),
    finished_at: optionalString(row.finished_at),
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
  };
}

function rowToArtifactSummary(row: SQLiteRow): ArtifactSummary {
  return {
    id: String(row.id),
    type: optionalString(row.type) || 'summary',
    title: String(row.title),
    content_format: optionalString(row.content_format) || 'markdown',
    source_product_task_id: optionalString(row.source_product_task_id),
    source_run_id: optionalString(row.source_run_id),
    source_conversation_id: optionalString(row.source_conversation_id),
    source_message_id: optionalString(row.source_message_id),
    version: Number(row.version ?? 1),
    status: optionalString(row.status) || 'active',
    metadata: parseObject(row.metadata),
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
  };
}

function rowToArtifactDetail(row: SQLiteRow): ArtifactDetail {
  return {
    ...rowToArtifactSummary(row),
    content: String(row.content ?? ''),
    linked_memory_ids: parseArray(row.linked_memory_ids).map(String),
  };
}

function rowToOpenLoop(row: SQLiteRow): OpenLoop {
  return {
    id: String(row.id),
    topic: String(row.topic),
    description: optionalString(row.description),
    status: optionalString(row.status) || 'open',
    source_conversation_id: optionalString(row.source_conversation_id),
    source_run_id: optionalString(row.source_run_id),
    source_product_task_id: optionalString(row.source_product_task_id),
    suggested_followup: optionalString(row.suggested_followup),
    priority: optionalString(row.priority) || 'normal',
    due_at: optionalString(row.due_at),
    metadata: parseObject(row.metadata),
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
    closed_at: optionalString(row.closed_at),
  };
}

function rowToProactiveMessage(row: SQLiteRow): ProactiveMessage {
  return {
    id: String(row.id),
    type: optionalString(row.type) || 'followup',
    title: String(row.title),
    body: String(row.body),
    reason: optionalString(row.reason) || '',
    source_memory_ids: parseArray(row.source_memory_ids).map(String),
    source_open_loop_id: optionalString(row.source_open_loop_id),
    source_product_task_id: optionalString(row.source_product_task_id),
    score: Number(row.score ?? 0),
    status: optionalString(row.status) || 'draft',
    channel: optionalString(row.channel) || 'desktop',
    send_after: optionalString(row.send_after),
    expires_at: optionalString(row.expires_at),
    feedback: optionalString(row.feedback),
    metadata: parseObject(row.metadata),
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
    sent_at: optionalString(row.sent_at),
  };
}

function productTaskVisiblePredicate(column: string): string {
  return `(${column} IS NULL OR NOT EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = ${column}
      AND COALESCE(c.lifecycle_status, 'active') IN ('archived','trashed','purged')
  ))`;
}

function artifactConversationVisiblePredicate(column: string): string {
  return `(${column} IS NULL OR NOT EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = ${column}
      AND COALESCE(c.lifecycle_status, 'active') IN ('archived','trashed','purged')
  ))`;
}

function productTaskVisibleViaTaskPredicate(column: string): string {
  return `(${column} IS NULL OR NOT EXISTS (
    SELECT 1
    FROM product_tasks pt
    JOIN conversations c ON c.id = pt.created_from_conversation_id
    WHERE pt.id = ${column}
      AND COALESCE(c.lifecycle_status, 'active') IN ('archived','trashed','purged')
  ))`;
}

type DeterministicRuntimeStep = readonly [string, string, Record<string, unknown>, Record<string, unknown>];

type DeterministicRuntimePlan = {
  agentID: string;
  response: string;
  selectedNodeID: string;
  assignmentReason: string;
  preferredNode: string;
  routeResult: Record<string, unknown>;
  capability?: string;
  capabilityInputs?: Record<string, unknown>;
  modelCallCount: number;
  promptAssemblyCount: number;
  memoryContextPackCount: number;
  extraSteps: DeterministicRuntimeStep[];
  memoryUsage?: boolean;
  pendingMemory?: { content: string; summary: string };
  productTask?: { title: string; description: string; summary: string; stepCount: number };
  artifact?: { title: string; content: string };
  openLoop?: { topic: string; description: string; suggestedFollowup: string };
  proactiveDraft?: { title: string; body: string; reason: string };
  toolRun?: boolean;
  workerTask?: boolean;
};

type PostRunMemoryProposal = {
  type: 'user_preference' | 'project_fact' | 'workflow_rule' | 'task_context';
  statement: string;
  summary: string;
  why: string;
  futureEffect: string;
  scopeIntent: 'durable' | 'session_only' | 'do_not_store';
  confidence: number;
  negativeSignals: string[];
  dedupKey: string;
};

const HARD_NEGATIVE_MEMORY_SIGNALS = [
  '不要记住',
  '不要写入长期记忆',
  '别记住',
  '仅本轮',
  '当前会话',
  '临时上下文',
  '测试',
  '暗号',
  '验证码',
  'token',
  'secret',
];

function memoryProposalFromMessage(message: string): PostRunMemoryProposal | null {
  const text = message.trim();
  if (!text) return null;
  const negativeSignals = memoryHardNegativeSignals(text);
  const scopeIntent = negativeSignals.length > 0
    ? negativeSignals.some((signal) => signal.includes('不要') || signal.includes('别记') || signal === 'secret' || signal === 'token' || signal === '验证码')
      ? 'do_not_store'
      : 'session_only'
    : 'durable';
  const explicitDurable = /请记住|记住[:：]|以后|以后都|后续|以后给我|我偏好|我的偏好|总是|默认/.test(text);
  if (!explicitDurable && negativeSignals.length === 0) return null;
  const statement = cleanMemoryStatement(text);
  if (!statement) return null;
  return {
    type: inferMemoryProposalType(statement),
    statement,
    summary: titleFromMessage(statement),
    why: explicitDurable ? '用户表达了可复用的长期偏好或工作规则。' : '用户消息包含长期记忆候选。',
    futureEffect: '后续相似对话会优先参考这条偏好，直到用户编辑、停用或删除。',
    scopeIntent,
    confidence: explicitDurable ? 0.82 : 0.62,
    negativeSignals,
    dedupKey: memoryDedupKey(statement),
  };
}

function memoryHardNegativeSignals(message: string): string[] {
  const normalized = message.toLowerCase();
  return HARD_NEGATIVE_MEMORY_SIGNALS.filter((signal) => normalized.includes(signal.toLowerCase()));
}

function cleanMemoryStatement(message: string): string {
  return message
    .replace(/^请记住[:：]?\s*/u, '')
    .replace(/^记住[:：]?\s*/u, '')
    .replace(/不要写入长期记忆。?/gu, '')
    .replace(/不要记住。?/gu, '')
    .replace(/别记住。?/gu, '')
    .trim();
}

function inferMemoryProposalType(statement: string): PostRunMemoryProposal['type'] {
  if (/流程|步骤|以后都按|默认先|先.+再/u.test(statement)) return 'workflow_rule';
  if (/项目|Joi|仓库|路径|环境/u.test(statement)) return 'project_fact';
  return 'user_preference';
}

function memoryDedupKey(statement: string): string {
  return hashText(statement.replace(/\s+/g, '').toLowerCase()).slice(0, 24);
}

function buildDeterministicRuntimePlan(req: ChatRequest, message: string): DeterministicRuntimePlan {
  const normalized = message.toLowerCase();
  const preferredNode = req.preferred_node?.trim() || '';
  const base: DeterministicRuntimePlan = {
    agentID: 'general_agent',
    response: `Electron SQLite deterministic response: ${message}`,
    selectedNodeID: preferredNode && preferredNode !== 'auto' ? preferredNode : 'main-node',
    assignmentReason: preferredNode && preferredNode !== 'auto' ? 'user_selected' : 'default_main_node',
    preferredNode,
    routeResult: { route: 'electron_sqlite_deterministic' },
    modelCallCount: 1,
    promptAssemblyCount: 1,
    memoryContextPackCount: 1,
    extraSteps: [],
  };

  if (normalized.includes('docker restart')) {
    return {
      ...base,
      agentID: 'devops_agent',
      response: 'rejected：这是危险或修改性操作。当前 Runtime 不会执行 restart、stop、rm、chmod、chown 等 state_change 操作。',
      routeResult: { route: 'electron_sqlite_deterministic', safety: 'dangerous_state_change' },
      extraSteps: [['policy_blocked', 'Request blocked by safety policy', { message }, { policy: 'rejected', reason: 'dangerous_state_change_or_destructive_command' }]],
    };
  }

  if (normalized.includes('unknown-service')) {
    return {
      ...base,
      agentID: 'devops_agent',
      response: '我需要明确真实的服务名、容器名、端口或 URL 后才能做只读诊断；unknown-service 这类占位目标不会触发工具执行。',
      routeResult: { route: 'electron_sqlite_deterministic', agent_id: 'devops_agent' },
    };
  }

  if (message.includes('我之前偏好什么部署方式')) {
    return {
      ...base,
      agentID: 'memory_agent',
      response: '你之前偏好轻量部署，优先 Docker Compose，避免默认推荐 Kubernetes。',
      routeResult: { route: 'electron_sqlite_deterministic', agent_id: 'memory_agent' },
      capability: 'memory_search',
      modelCallCount: 2,
      promptAssemblyCount: 2,
      memoryContextPackCount: 2,
      memoryUsage: true,
      extraSteps: [
        ['capability_requested', 'Agent requested capability', { agent_id: 'memory_agent' }, { capability: 'memory_search', query: message }],
        ['memory_search_finished', 'Memory search finished', { query: message }, { results: ['mem_desktop_deploy_pref'] }],
      ],
    };
  }

  if (message.includes('现在想把 Joi 做成什么')) {
    return {
      ...base,
      agentID: 'memory_agent',
      response: '你希望把 Joi 做成伙伴式前台 + 严肃执行后台。',
      routeResult: { route: 'electron_sqlite_deterministic', agent_id: 'memory_agent' },
      memoryUsage: true,
      extraSteps: [['memory_context_recalled', 'Memory context recalled', { message }, { memory_ids: ['mem_desktop_joi_direction'] }]],
    };
  }

  if (message.includes('请记住')) {
    return {
      ...base,
      agentID: 'memory_agent',
      response: '已生成记忆候选，等待确认。',
      routeResult: { route: 'electron_sqlite_deterministic', agent_id: 'memory_agent' },
      pendingMemory: { content: message.replace(/^请记住[:：]?/, '').trim(), summary: 'Desktop-first local app preference' },
      extraSteps: [['memory_proposed', 'Memory write proposal produced', { agent_id: 'memory_agent' }, { memory: { status: 'pending' } }]],
    };
  }

  if (message.includes('伙伴式前台 + 严肃执行后台')) {
    return {
      ...base,
      agentID: 'memory_agent',
      response: '我会把这个产品方向作为待确认记忆，并保留后续跟进。',
      routeResult: { route: 'electron_sqlite_deterministic', agent_id: 'memory_agent' },
      pendingMemory: { content: message, summary: 'Joi product direction' },
      openLoop: { topic: 'Joi product direction follow-up', description: 'Clarify companion foreground and serious execution backend direction.', suggestedFollowup: 'Review product direction next steps.' },
      proactiveDraft: { title: 'Review Joi direction', body: 'Follow up on Joi companion foreground and serious execution backend.', reason: 'product direction memory' },
      extraSteps: [
        ['memory_proposed', 'Memory write proposal produced', { agent_id: 'memory_agent' }, { memory: { status: 'pending' } }],
        ['conversation_reflection', 'Conversation reflection finished', { run_id: '' }, { open_loop: true }],
        ['proactive_candidate_created', 'Proactive candidate created', {}, { status: 'draft' }],
      ],
    };
  }

  if (message.includes('Alma') && message.includes('Joi')) {
    return {
      ...base,
      response: '已创建严肃任务，包含差距分析、步骤和交付物草稿。',
      productTask: { title: 'Analyze Alma and Joi gap', description: 'Compare Alma and Joi and propose next steps.', summary: 'Gap analysis task created.', stepCount: 3 },
      artifact: { title: 'Alma/Joi gap analysis', content: 'Gap analysis artifact generated by Electron deterministic runtime.' },
      openLoop: { topic: 'Alma/Joi follow-up', description: 'Review the generated gap analysis.', suggestedFollowup: 'Decide the next product step.' },
      proactiveDraft: { title: 'Review Alma/Joi gap', body: 'Review the generated gap analysis and choose a next step.', reason: 'serious task follow-up' },
      extraSteps: [
        ['task_classified', 'Task classified', { message }, { mode: 'serious_task' }],
        ['product_task_created', 'Product task created', {}, { step_count: 3 }],
        ['artifact_created', 'Artifact created', {}, { type: 'report' }],
        ['conversation_reflection', 'Conversation reflection finished', {}, { open_loop: true }],
      ],
    };
  }

  if (message.includes('Joi 自检')) {
    return capabilityPlan(base, 'devops_agent', 'system_health_check', 'main-node', 'default_main_node', {
      response: 'Joi 自检完成：SQLite、Electron runtime 和本地配置可读。',
      includeToolStarted: false,
      inputs: { scope: 'electron_ts_store' },
    });
  }

  if (message.includes('cloudflared')) {
    return capabilityPlan(base, 'devops_agent', 'server_diagnose', 'main-node', 'default_main_node', {
      response: 'cloudflared 只读诊断完成。',
      includeToolStarted: false,
      inputs: { service_name: 'cloudflared' },
    });
  }

  if (isDesktopAppListMessage(message)) {
    return capabilityPlan(base, 'general_agent', 'desktop_app_list', 'main-node', 'default_main_node', {
      response: 'Local desktop application inventory completed.',
      includeToolStarted: true,
      inputs: { max_results: 1000 },
    });
  }

  const desktopAppInspectInput = desktopAppInspectFromMessage(message);
  if (desktopAppInspectInput) {
    return capabilityPlan(base, 'general_agent', 'desktop_app_inspect', 'main-node', 'default_main_node', {
      response: 'Local desktop application metadata check completed.',
      includeToolStarted: true,
      inputs: desktopAppInspectInput,
    });
  }

  const shellCommand = shellCommandFromMessage(message);
  if (shellCommand) {
    return capabilityPlan(base, 'devops_agent', 'shell_command', 'main-node', 'default_main_node', {
      response: `Shell command completed: ${shellCommand.join(' ')}`,
      includeToolStarted: true,
      inputs: { cmd: shellCommand, cwd: '.', timeout_seconds: 30, max_output_bytes: 120000 },
    });
  }

  const testCommand = testCommandFromMessage(message);
  if (testCommand) {
    return capabilityPlan(base, 'devops_agent', 'test_command', 'main-node', 'default_main_node', {
      response: `Test command completed: ${testCommand.join(' ')}`,
      includeToolStarted: true,
      inputs: { cmd: testCommand, cwd: '.', timeout_seconds: 120, max_output_bytes: 120000 },
    });
  }

  const patch = extractPatchBlock(message);
  if (patch) {
    return capabilityPlan(base, 'general_agent', 'apply_patch', 'main-node', 'default_main_node', {
      response: 'Workspace patch request prepared.',
      includeToolStarted: true,
      inputs: { patch, permission_profile: req.permission_profile || 'read_only' },
      riskLevel: 'workspace_write',
    });
  }

  if (normalized.includes('browser observe') || message.includes('观察浏览器')) {
    return capabilityPlan(base, 'general_agent', 'browser_observe', 'main-node', 'default_main_node', {
      response: 'Browser snapshot captured.',
      includeToolStarted: true,
      inputs: { target: 'frontmost_browser', include_text: true, max_text_bytes: 12000 },
    });
  }

  if (normalized.includes('computer observe') || normalized.includes('frontmost window') || message.includes('观察屏幕')) {
    return capabilityPlan(base, 'general_agent', 'computer_observe', 'main-node', 'default_main_node', {
      response: 'Computer snapshot captured.',
      includeToolStarted: true,
      inputs: { target: 'frontmost_window', include_text: true, max_text_bytes: 12000 },
    });
  }

  const browserNavigateURL = extractURL(message);
  if (browserNavigateURL && (normalized.includes('browser navigate') || message.includes('导航浏览器'))) {
    return capabilityPlan(base, 'general_agent', 'browser_navigate', 'main-node', 'default_main_node', {
      response: `Browser navigation prepared: ${browserNavigateURL}`,
      includeToolStarted: true,
      inputs: { url: browserNavigateURL, target: 'frontmost_or_default_browser' },
    });
  }

  const browserSelector = selectorFromMessage(message);
  if (browserSelector && (normalized.includes('browser click') || message.includes('点击浏览器'))) {
    return capabilityPlan(base, 'general_agent', 'browser_click', 'main-node', 'default_main_node', {
      response: `Browser click prepared: ${browserSelector}`,
      includeToolStarted: true,
      inputs: { selector: browserSelector, target: 'frontmost_browser', permission_profile: req.permission_profile || 'read_only' },
      riskLevel: 'browser_interaction',
    });
  }

  if (browserSelector && (normalized.includes('browser type') || message.includes('输入浏览器'))) {
    return capabilityPlan(base, 'general_agent', 'browser_type', 'main-node', 'default_main_node', {
      response: `Browser type prepared: ${browserSelector}`,
      includeToolStarted: true,
      inputs: { selector: browserSelector, text: typeTextFromMessage(message), target: 'frontmost_browser', permission_profile: req.permission_profile || 'read_only' },
      riskLevel: 'browser_interaction',
    });
  }

  if (message.includes('@research') || normalized.includes('https://')) {
    if (preferredNode === 'vps-la-1') {
      return workerDispatchPlan(base, 'vps-la-1', 'user_selected');
    }
    if (preferredNode === 'auto' && req.allow_worker) {
      return workerDispatchPlan(base, 'local-worker-1', 'auto_allow_worker');
    }
    return capabilityPlan(base, 'research_agent', 'web_research', 'main-node', 'default_main_node', {
      response: 'Example Domain summary from Electron mock web research.',
      includeToolStarted: false,
      inputs: { url: extractURL(message) },
    });
  }

  if (message.includes('Run Trace')) {
    return capabilityPlan(base, 'general_agent', 'workspace_search', 'main-node', 'default_main_node', {
      response: 'Run Trace design documents were found in the current project.',
      includeToolStarted: true,
      inputs: { query: 'Run Trace', root: '.', max_results: 20 },
    });
  }

  if (message.includes('AGENTS.md')) {
    return capabilityPlan(base, 'general_agent', 'file_analyze', 'main-node', 'default_main_node', {
      response: 'Tool Compiler 红线：能力实现必须经 policy、compiler、node selection 和可审计 trace。',
      includeToolStarted: true,
      inputs: { path: 'AGENTS.md', question: message },
    });
  }

  return base;
}

function capabilityPlan(
  base: DeterministicRuntimePlan,
  agentID: string,
  capability: string,
  nodeID: string,
  assignmentReason: string,
  options: { response: string; includeToolStarted: boolean; inputs?: Record<string, unknown>; riskLevel?: string },
): DeterministicRuntimePlan {
  const riskLevel = options.riskLevel || 'read_only';
  const steps: DeterministicRuntimeStep[] = [
    ['capability_requested', 'Agent requested capability', { agent_id: agentID }, { capability, confidence: 0.9 }],
    ['policy_checked', 'Policy checked', { capability }, { allowed: true, risk_level: riskLevel }],
    ['tool_compiled', 'Tool workflow compiled', { capability }, { workflow_name: workflowNameForGateway(capability) }],
    ['node_selected', 'Node selected', { capability }, { node_id: nodeID, assignment_reason: assignmentReason }],
  ];
  if (options.includeToolStarted) {
    steps.push(['tool_started', 'Tool runtime started', { capability }, { node_id: nodeID }]);
  }
  steps.push(['tool_finished', 'Tool runtime finished', { capability }, { status: 'succeeded' }]);
  return {
    ...base,
    agentID,
    response: options.response,
    selectedNodeID: nodeID,
    assignmentReason,
    routeResult: { route: 'electron_sqlite_deterministic', agent_id: agentID, capability },
    capability,
    capabilityInputs: options.inputs || {},
    toolRun: true,
    extraSteps: steps,
  };
}

function workerDispatchPlan(base: DeterministicRuntimePlan, nodeID: string, assignmentReason: string): DeterministicRuntimePlan {
  return {
    ...base,
    agentID: 'research_agent',
    response: '已交给执行后台处理，结果会在这里更新。',
    selectedNodeID: nodeID,
    assignmentReason,
    routeResult: { route: 'electron_sqlite_deterministic', agent_id: 'research_agent', capability: 'web_research', queued: true },
    capability: 'web_research',
    workerTask: true,
    extraSteps: [
      ['capability_requested', 'Agent requested capability', { agent_id: 'research_agent' }, { capability: 'web_research', confidence: 0.9 }],
      ['tool_compiled', 'Tool workflow compiled', { capability: 'web_research' }, { workflow_name: 'web_research_v1' }],
      ['node_selected', 'Node selected', { capability: 'web_research' }, { node_id: nodeID, assignment_reason: assignmentReason }],
      ['task_dispatched', 'Task dispatched to worker', { allow_worker: true }, { node_id: nodeID, assignment_reason: assignmentReason, privacy_level: 'internal', scheduler: 'electron_deterministic', task_attempts: 0 }],
    ],
  };
}

async function executePlannedCapability(plan: DeterministicRuntimePlan, executor: CapabilityExecutor | undefined): Promise<CapabilityExecutorResult | undefined> {
  if (!executor || !plan.capability || plan.workerTask || !plan.toolRun) return undefined;
  const result = await executor(plan.capability, plan.capabilityInputs || {});
  if (!result) return undefined;
  return {
    output: result.output,
    response: result.response || responseFromCapabilityOutput(plan.capability, result.output),
  };
}

function stepsWithCapabilityOutput(steps: DeterministicRuntimeStep[], output: Record<string, unknown> | undefined): DeterministicRuntimeStep[] {
  if (!output) return steps;
  return steps.map((step) => {
    if (step[0] !== 'tool_finished') return step;
    return [step[0], step[1], step[2], output] as const;
  });
}

function responseFromCapabilityOutput(capability: string, output: Record<string, unknown>): string {
  if (capability === 'workspace_search') {
    const results = Array.isArray(output.results) ? output.results : [];
    const first = results[0] as Record<string, unknown> | undefined;
    const snippet = first?.snippet ? ` 首条命中：${String(first.snippet)}` : '';
    return `${String(output.summary || 'Workspace search completed.')}${snippet}`;
  }
  if (capability === 'file_analyze') {
    const excerpts = Array.isArray(output.excerpts) ? output.excerpts : [];
    const snippets = excerpts
      .slice(0, 3)
      .map((item) => typeof item === 'object' && item ? String((item as Record<string, unknown>).snippet || '') : '')
      .filter(Boolean)
      .join(' / ');
    const snippet = snippets ? ` 摘录：${snippets}` : '';
    return `${String(output.summary || 'File analysis completed.')}${snippet}`;
  }
  if (capability === 'file_read') {
    return `${String(output.summary || 'File read completed.')}`;
  }
  if (capability === 'web_research') {
    const fetchStatus = String(output.fetch_status || 'completed');
    const title = output.title ? `标题：${String(output.title)}。` : '';
    const source = output.final_url || output.url ? `来源：${String(output.final_url || output.url)}。` : '';
    return `Web research ${fetchStatus}。${title}${source}${String(output.summary || '')}`.trim();
  }
  if (capability === 'shell_command') {
    const commandOutput = String(output.output || '').trim();
    return `${String(output.summary || 'Shell command completed.')}${commandOutput ? ` 输出：${commandOutput.slice(0, 500)}` : ''}`;
  }
  if (capability === 'test_command') {
    const commandOutput = String(output.output || '').trim();
    return `${String(output.summary || 'Test command completed.')}${commandOutput ? ` 输出：${commandOutput.slice(0, 500)}` : ''}`;
  }
  if (capability === 'apply_patch') {
    return `${String(output.summary || 'Workspace patch applied.')}`;
  }
  if (capability === 'computer_observe' || capability === 'browser_observe' || ['find_roots', 'observe_ui', 'search_ui', 'expand_ui', 'inspect_ui', 'read_text', 'wait_for', 'act_ui'].includes(capability)) {
    return `${String(output.summary || 'Observe completed.')}`;
  }
  if (capability === 'browser_navigate') {
    return `${String(output.summary || 'Browser navigation completed.')}`;
  }
  if (capability === 'browser_click' || capability === 'browser_type') {
    return `${String(output.summary || 'Browser interaction completed.')}`;
  }
  if (capability === 'desktop_app_list') {
    const apps = Array.isArray(output.apps) ? output.apps : [];
    const names = apps
      .slice(0, 20)
      .map((app) => typeof app === 'object' && app ? String((app as Record<string, unknown>).name || '') : '')
      .filter(Boolean);
    return `${String(output.summary || `Found ${String(output.total || 0)} local app bundle(s).`)}${names.length ? ` 前 ${names.length} 个：${names.join(', ')}` : ''}`;
  }
  if (capability === 'desktop_app_inspect') {
    const matches = Array.isArray(output.matches) ? output.matches : [];
    const first = matches[0] as Record<string, unknown> | undefined;
    return first
      ? `已检查本机 app：${String(first.name || 'unknown')}。Bundle ID：${String(first.bundle_id || 'unknown')}。版本：${String(first.version || 'unknown')}。路径：${String(first.path || 'unknown')}。`
      : String(output.summary || 'No matching local app bundle found.');
  }
  if (capability === 'system_health_check' || capability === 'server_diagnose') {
    return String(output.summary || 'Diagnostics completed.');
  }
  return String(output.summary || 'Capability completed.');
}

function extractURL(text: string): string {
  const match = text.match(/https?:\/\/[^\s"'<>，。]+/i);
  if (!match) return '';
  return match[0].replace(/[),.;]+$/, '');
}

function extractPatchBlock(text: string): string {
  const start = text.indexOf('*** Begin Patch');
  if (start < 0) return '';
  const endToken = '*** End Patch';
  const end = text.indexOf(endToken, start);
  if (end < 0) return '';
  return text.slice(start, end + endToken.length);
}

function selectorFromMessage(text: string): string {
  return firstCapture(text, /\bselector\s*[:=]\s*("[^"]+"|'[^']+'|[^\s，。]+)/i)
    || firstCapture(text, /选择器\s*[:：]\s*("[^"]+"|'[^']+'|[^\s，。]+)/);
}

function typeTextFromMessage(text: string): string {
  return firstCapture(text, /\btext\s*[:=]\s*"([^"]*)"/i)
    || firstCapture(text, /\btext\s*[:=]\s*'([^']*)'/i)
    || firstCapture(text, /输入\s*[:：]\s*["“]([^"”]*)["”]/);
}

function isDesktopAppListMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('installed apps')
    || normalized.includes('desktop app list')
    || message.includes('本机所有 app')
    || message.includes('本地所有 app')
    || message.includes('本机有哪些应用')
    || message.includes('列出本地');
}

function desktopAppInspectFromMessage(message: string): Record<string, unknown> | null {
  const normalized = message.toLowerCase();
  const name = firstCapture(message, /\bapp\s+name\s*[:=]\s*("[^"]+"|'[^']+'|[^\s，。]+)/i)
    || firstCapture(message, /\bname\s*[:=]\s*("[^"]+"|'[^']+'|[^\s，。]+)/i)
    || firstCapture(message, /应用\s*[:：]\s*("[^"]+"|'[^']+'|[^\s，。]+)/);
  const bundleID = firstCapture(message, /\bbundle[_ ]?id\s*[:=]\s*([A-Za-z0-9_.-]+)/i);
  const path = firstCapture(message, /\bpath\s*[:=]\s*("[^"]+"|'[^']+'|[^\s，。]+)/i);
  if (name || bundleID || path) return { name, bundle_id: bundleID, path };
  if ((normalized.includes('desktop app inspect') || message.includes('检查本机 app') || message.includes('确认本机 app')) && normalized.includes('joi')) {
    return { name: 'Joi' };
  }
  return null;
}

function firstCapture(text: string, pattern: RegExp): string {
  const match = text.match(pattern);
  if (!match) return '';
  const raw = (match[1] || '').trim();
  return raw.replace(/^["']|["']$/g, '');
}

function shellCommandFromMessage(message: string): string[] | null {
  const normalized = message.toLowerCase();
  if (normalized.includes('git status')) return ['git', 'status', '--short'];
  if (/\bpwd\b/.test(normalized) || normalized.includes('current working directory')) return ['pwd'];
  if (normalized.includes('list files') || normalized.includes('列出文件')) return ['ls', '.'];
  return null;
}

function testCommandFromMessage(message: string): string[] | null {
  const normalized = message.toLowerCase();
  if (normalized.includes('pnpm test:runtime')) return ['pnpm', 'test:runtime'];
  if (normalized.includes('pnpm test:store')) return ['pnpm', 'test:store'];
  if (normalized.includes('pnpm test:electron-contract')) return ['pnpm', 'test:electron-contract'];
  if (normalized.includes('pnpm test')) return ['pnpm', 'test'];
  if (normalized.includes('npm test')) return ['npm', 'test'];
  if (normalized.includes('go test')) return ['go', 'test', './...'];
  return null;
}

const plainCSSBlockPattern = /(^|[\s}])(?:[a-z0-9_#.*:,.>+~[\]="'\(\)-]+(?:\s+[a-z0-9_#.*:,.>+~[\]="'\(\)-]+)*)\{[^{}]*\}/gim;

function workerCapabilityMatches(capabilities: string[], capabilityID: string): boolean {
  if (capabilities.length === 0) return false;
  if (capabilities.includes('*')) return true;
  const aliases = workerCapabilityAliases(capabilityID);
  return capabilities.some((capability) => aliases.has(capability.trim()));
}

function workerCapabilityAliases(capabilityID: string): Set<string> {
  const capability = capabilityID.trim();
  const base = capability.replace(/_v\d+$/, '');
  const aliases = new Set([capability, base]);
  switch (base) {
    case 'web_research':
    case 'fetch_url':
      aliases.add('web_research');
      aliases.add('web_research_v1');
      aliases.add('web_research_v2');
      aliases.add('fetch_url');
      break;
    case 'server_diagnose':
    case 'server_diagnose_self':
      aliases.add('server_diagnose');
      aliases.add('server_diagnose_v1');
      aliases.add('server_diagnose_self');
      break;
    case 'system_health_check':
    case 'system_health_check_self':
      aliases.add('system_health_check');
      aliases.add('system_health_check_v1');
      aliases.add('system_health_check_self');
      break;
  }
  return aliases;
}

function gatewayAssignmentReason(task: WorkerGatewayTask): string {
  return task.preferred_node_id === 'auto' ? 'auto_allow_worker' : 'user_selected';
}

function workflowNameForGateway(capabilityID: string): string {
  switch (capabilityID) {
    case 'web_research':
    case 'web_research_v1':
    case 'fetch_url':
      return 'web_research_v1';
    case 'system_health_check':
    case 'system_health_check_v1':
    case 'system_health_check_self':
      return 'system_health_check_v1';
    case 'apply_patch':
    case 'apply_patch_v1':
      return 'apply_patch_v1';
    case 'shell_command':
    case 'shell_command_v1':
      return 'shell_command_v1';
    case 'test_command':
    case 'test_command_v1':
      return 'test_command_v1';
    case 'computer_observe':
    case 'computer_observe_v1':
      return 'computer_observe_v1';
    case 'find_roots':
    case 'observe_ui':
    case 'search_ui':
    case 'expand_ui':
    case 'inspect_ui':
    case 'read_text':
    case 'wait_for':
    case 'act_ui':
      return `${capabilityID}_v1`;
    case 'memory_recall':
    case 'memory_write_candidate':
    case 'session_search':
    case 'session_summary':
    case 'session_branch':
    case 'session_compact':
    case 'delegate_task':
    case 'project_list':
    case 'skills_list':
    case 'skill_view':
    case 'tool_search':
    case 'task_list':
    case 'task_view':
    case 'task_update':
    case 'shell_start':
    case 'shell_write':
    case 'shell_output':
    case 'shell_kill':
    case 'image_generate':
    case 'text_to_speech':
    case 'speech_transcribe':
    case 'lsp_definition':
    case 'lsp_references':
    case 'lsp_diagnostics':
    case 'debugger_attach':
    case 'debugger_breakpoint':
    case 'debugger_step':
    case 'debugger_evaluate':
    case 'debugger_stop':
      return `${capabilityID}_v1`;
    case 'browser_observe':
    case 'browser_observe_v1':
      return 'browser_observe_v1';
    case 'browser_navigate':
    case 'browser_navigate_v1':
      return 'browser_navigate_v1';
    case 'browser_click':
    case 'browser_click_v1':
      return 'browser_click_v1';
    case 'browser_type':
    case 'browser_type_v1':
      return 'browser_type_v1';
    case 'desktop_app_list':
    case 'desktop_app_list_v1':
      return 'desktop_app_list_v1';
    case 'desktop_app_inspect':
    case 'desktop_app_inspect_v1':
      return 'desktop_app_inspect_v1';
    default:
      return 'server_diagnose_v1';
  }
}

function workflowRiskLevel(capabilityID: string): string {
  if (['apply_patch', 'memory_write_candidate', 'task_update', 'session_branch', 'session_compact', 'delegate_task'].includes(capabilityID)) return 'workspace_write';
  if (['browser_click', 'browser_type', 'act_ui', 'computer_use', 'shell_start', 'shell_write', 'shell_kill', 'debugger_attach', 'debugger_breakpoint', 'debugger_step', 'debugger_evaluate', 'debugger_stop'].includes(capabilityID)) return 'browser_interaction';
  return 'read_only';
}

function memorySearchTerms(query: string): string[] {
  const normalized = query.toLowerCase();
  const terms = new Set<string>();
  for (const item of normalized.split(/[^a-z0-9_\u4e00-\u9fff]+/u)) {
    const term = item.trim();
    if (term.length >= 2) terms.add(term);
  }
  return [...terms].slice(0, 12);
}

function memoryPromptItem(result: MemorySearchResult): Record<string, unknown> {
  return {
    id: result.memory.id,
    layer: result.memory.layer || 'knowledge',
    type: result.memory.type,
    summary: result.memory.summary,
    content: result.memory.content,
    scope: result.memory.scope_type || 'global',
    score: result.score,
    reason: result.reason,
  };
}

function settingBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
}

function clampMemoryIdleSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MEMORY_POLICY.background_idle_seconds;
  return Math.max(30, Math.min(86_400, Math.round(value)));
}

function normalizeMemoryText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').replace(/[，。！？、,.!?;；:："'“”‘’]/gu, '').trim();
}

function memoryExpiryFromMetadata(metadata: Record<string, unknown>): string {
  const ttl = parseObject(metadata.ttl);
  const expiry = parseObject(metadata.expiry);
  return optionalString(metadata.valid_until)
    || optionalString(metadata.expires_at)
    || optionalString(metadata.expiresAt)
    || optionalString(metadata.ttl_until)
    || optionalString(ttl.until)
    || optionalString(expiry.expires_at)
    || '';
}

function parseNumberArray(value: unknown): number[] {
  return parseArray(value)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function numericRecord(value: unknown): Record<string, number> {
  const source = parseObject(value);
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, item]) => [key, Number(item)] as const)
      .filter(([, item]) => Number.isFinite(item)),
  );
}

function activeMemoryTTLWhereClause(tableName: string): string {
  const prefix = tableName ? `${tableName}.` : '';
  const ttlValue = `COALESCE(
    NULLIF(json_extract(${prefix}metadata, '$.ttl_until'), ''),
    NULLIF(json_extract(${prefix}metadata, '$.expires_at'), ''),
    NULLIF(json_extract(${prefix}metadata, '$.valid_until'), ''),
    NULLIF(json_extract(${prefix}metadata, '$.ttl.until'), ''),
    NULLIF(json_extract(${prefix}metadata, '$.expiry.expires_at'), '')
  )`;
  return `(${prefix}type NOT IN ('current_state', 'user_state') OR ${ttlValue} IS NULL OR datetime(${ttlValue}) > datetime('now'))`;
}

function memoryProfileVersionFor(results: MemorySearchResult[]): string {
  const source = results
    .map((result) => `${result.memory.id}:${result.memory.updated_at || ''}:${result.memory.confidence}`)
    .join('|');
  return `electron_profile_${hashText(`${results.length}:${source}`).slice(0, 12)}`;
}

function normalizePersistedToolResult(result: PersistedToolResult): PersistedToolResult {
  const embedded = embeddedPersistedToolOutput(result.output);
  if (Object.keys(embedded).length === 0) return result;
  return {
    ...result,
    output: {
      ...result.output,
      ...embedded,
      raw_output: result.output.raw_output ?? embedded.raw_output,
    },
  };
}

function embeddedPersistedToolOutput(output: Record<string, unknown>): Record<string, unknown> {
  const rawOutput = toolOutputRecord(output.raw_output);
  const rawResult = toolOutputRecord(rawOutput.result);
  for (const candidate of [output.structuredContent, rawOutput.structuredContent, rawResult.structuredContent]) {
    const record = toolOutputRecord(candidate);
    if (optionalString(record.status) || optionalString(record.capability)) return record;
  }
  const content = Array.isArray(rawResult.content) ? rawResult.content : Array.isArray(rawOutput.content) ? rawOutput.content : [];
  for (const item of content) {
    const record = toolOutputRecord(item);
    if (typeof record.text !== 'string') continue;
    const parsed = toolOutputRecord(record.text);
    if (optionalString(parsed.status) || optionalString(parsed.capability)) return parsed;
  }
  return {};
}

function isWaitingConfirmationToolResult(result: PersistedToolResult): boolean {
  const normalized = normalizePersistedToolResult(result);
  return normalized.output?.status === 'waiting_confirmation';
}

function callbackToolCapability(call: ToolCallingCallbackToolCall): string {
  const declared = optionalString(call.metadata?.capability) || call.name;
  return canonicalCapabilityName(declared);
}

function toolResultCapability(result: ToolCallingCallbackToolResult): string {
  const normalized = normalizePersistedToolResult(result as PersistedToolResult);
  return canonicalCapabilityName(optionalString(normalized.output.capability) || normalized.name);
}

function toolResultRisk(result: ToolCallingCallbackToolResult, capability: string): string {
  const normalized = normalizePersistedToolResult(result as PersistedToolResult);
  const explicit = optionalString(normalized.output.risk_level) || optionalString(normalized.output.risk);
  return explicit ? normalizeLogRiskLevel(explicit) : workflowRiskLevel(capability);
}

function toolResultSideEffect(result: ToolCallingCallbackToolResult, capability: string): string {
  const normalized = normalizePersistedToolResult(result as PersistedToolResult);
  return optionalString(normalized.output.side_effect_level) || sideEffectLevelForCapability(capability);
}

function elapsedToolDuration(startedAt?: number): number {
  return startedAt === undefined ? 0 : Math.max(1, Date.now() - startedAt);
}

function toolResultDuration(result: ToolCallingCallbackToolResult, startedAt?: number): number {
  const normalized = normalizePersistedToolResult(result as PersistedToolResult);
  const explicit = optionalNumber(normalized.output.duration_ms);
  return explicit === undefined ? elapsedToolDuration(startedAt) : Math.max(0, Math.round(explicit));
}

function toolResultErrorCode(result: PersistedToolResult, status: string): string {
  if (status !== 'failed' && status !== 'policy_blocked') return '';
  return optionalString(result.output.code) || optionalString(result.output.error_code) || status;
}

function toolResultErrorMessage(result: PersistedToolResult, status: string): string {
  if (status !== 'failed' && status !== 'policy_blocked') return '';
  return optionalString(result.output.error)
    || optionalString(result.output.error_message)
    || optionalString(result.output.policy_reason)
    || optionalString(result.output.summary)
    || `${result.name} ${status}`;
}

function confirmationMessageForToolResult(result: PersistedToolResult): string {
  return optionalString(result.output?.message)
    || '这个受控能力需要你确认后才会执行。';
}

function requestedActionForTool(capability: string, args: Record<string, unknown>, output: Record<string, unknown>): string {
  return optionalString(output.requested_action)
    || optionalString(args.reason)
    || optionalString(args.goal)
    || `Execute ${capability}`;
}

function effectiveInputMode(req: ChatRequest, message: string): InputMode {
  const requested = req.input_mode || 'auto';
  if (requested !== 'auto') return requested;
  const normalized = message.toLowerCase();
  if (isExplicitChatOnlyIntent(message)) {
    return 'chat_assist';
  }
  if (isMemoryOrReflectionOnlyIntent(message)) {
    return 'chat_assist';
  }
  if (/后台|持续|定时|之后提醒|稍后提醒|monitor|watch|background/.test(message) || /background|cron|schedule/.test(normalized)) {
    return 'background_task';
  }
  if (/帮我|整理|分析|实现|修改|检查|生成|构建|开发|制作|搭建|写一份|做一份|认真执行|执行|修复/.test(message)
    || /\b(analyze|implement|fix|generate|write|check|run|build)\b/.test(normalized)) {
    return 'serious_task';
  }
  return 'chat_assist';
}

function isExplicitChatOnlyIntent(message: string): boolean {
  return /纯聊天|普通聊天|只是?聊|只聊|不要创建任务|不创建任务|别创建任务|无需任务|不要认真执行|不要执行/.test(message)
    || /\b(chat only|just chat|no task|do not create (?:a )?task|don't create (?:a )?task|without creating (?:a )?task)\b/i.test(message);
}

function isMemoryOrReflectionOnlyIntent(message: string): boolean {
  return /记住|记忆|偏好|产品方向|我想把.+做成/.test(message)
    && !/帮我(分析|实现|修改|检查|生成|构建|开发|制作|搭建|写|做|执行|修复)|认真执行|执行一下|修复|之后提醒|稍后提醒|定时|monitor|watch|cron|schedule/i.test(message);
}

function modeResolutionForRequest(req: ChatRequest, message: string): ModeResolutionRecord {
  const requested = req.input_mode || 'auto';
  const resolved = effectiveInputMode(req, message);
  const explicit = requested !== 'auto';
  return {
    id: `mode_${newID()}`,
    requested_mode: requested,
    resolved_mode: resolved,
    mode_source: explicit ? 'explicit' : 'automatic',
    mode_locked_by_user: explicit,
    reason: explicit
      ? `User selected ${requested}.`
      : modeResolutionReason(resolved, message),
    confidence: explicit ? 1 : 0.78,
  };
}

function modeResolutionReason(mode: InputMode, message: string): string {
  if (mode === 'background_task') return 'Message contains reminder, schedule, monitoring, or background-follow-up intent.';
  if (mode === 'serious_task') return 'Message asks Joi to analyze, build, implement, generate, fix, check, or execute a task.';
  return message.trim() ? 'Message can be answered as ordinary chat without creating a durable task.' : 'Empty message defaults to ordinary chat.';
}

function contractMode(mode: InputMode): 'chat' | 'execution' | 'background' {
  if (mode === 'serious_task') return 'execution';
  if (mode === 'background_task') return 'background';
  return 'chat';
}

function shouldCreateProductTask(req: ChatRequest, message: string, mode: InputMode): boolean {
  if (mode === 'serious_task' || mode === 'background_task') return true;
  if (req.input_mode === 'auto') return effectiveInputMode(req, message) !== 'chat_assist';
  return false;
}

function buildTaskContract(req: ChatRequest, message: string, mode: InputMode): TaskContract {
  const objective = message.trim() || 'Complete the requested task.';
  const deliverables = inferDeliverables(message, mode);
  const riskLevel = riskLevelForPermission(req.permission_profile);
  return {
    objective,
    deliverables,
    constraints: [
      'Do not claim completion unless tool output or verification evidence supports it.',
      'Ask for confirmation before side-effectful operations.',
      'Keep generated artifacts linked to this product task.',
    ],
    success_checks: [
      'A user-visible result or artifact exists.',
      'The final response includes verification status.',
      'Any unresolved blocker is recorded instead of marked completed.',
    ],
    capability_scope: capabilityScopeForPermission(req.permission_profile),
    risk_level: riskLevel,
    mode,
    verification_requirements: [
      'Verify artifact presence or state evidence before completed.',
      'Store verification result in product_tasks.metadata.verification.',
    ],
  };
}

function inferDeliverables(message: string, mode: InputMode): string[] {
  if (/日报|报告|分析|总结|plan|report|summary/i.test(message)) return ['report'];
  const engineeringDeliverables: string[] = [];
  if (/代码|修改|实现|修复|patch|diff|code|implement|fix/i.test(message)) engineeringDeliverables.push('code_patch');
  if (/测试|test|verify|verification|(?:验证|核验).{0,12}(?:代码|修改|实现|修复|功能|系统|接口|构建|安装版|应用|app)|(?:代码|修改|实现|修复|功能|系统|接口|构建|安装版|应用|app).{0,12}(?:验证|核验)/i.test(message)) engineeringDeliverables.push('test_result');
  if (engineeringDeliverables.length > 0) return [...new Set(engineeringDeliverables)];
  if (mode === 'background_task') return ['open_loop', 'status_update'];
  return ['task_result'];
}

function riskLevelForPermission(permissionProfile: string | undefined): string {
  if (permissionProfile === 'danger_full_access') return 'browser_interaction';
  if (permissionProfile === 'workspace_write') return 'workspace_write';
  return 'read_only';
}

function capabilityScopeForPermission(permissionProfile: string | undefined): string[] {
  const scope = [
    'memory_recall', 'session_search', 'session_summary', 'project_list', 'skills_list', 'skill_view', 'tool_search',
    'task_list', 'task_view', 'workspace_search', 'file_read', 'file_analyze', 'web_research', 'shell_command',
    'test_command', 'shell_output', 'computer_observe', 'find_roots', 'observe_ui', 'search_ui', 'expand_ui',
    'inspect_ui', 'read_text', 'wait_for', 'browser_observe', 'system_health_check', 'request_user_input', 'automation_update',
  ];
  if (permissionProfile === 'workspace_write' || permissionProfile === 'danger_full_access') {
    scope.push('apply_patch', 'memory_write_candidate', 'task_update');
  }
  if (permissionProfile === 'danger_full_access') {
    scope.push('browser_click', 'browser_type', 'act_ui', 'shell_start', 'shell_write', 'shell_kill');
  }
  return scope;
}

function pendingTaskVerification(summary: string): TaskVerification {
  return {
    status: 'pending',
    summary,
    checks: [{ name: 'verification_pending', status: 'pending' }],
  };
}

function failedTaskVerification(summary: string): TaskVerification {
  return {
    status: 'failed',
    summary,
    checks: [{ name: 'task_runtime', status: 'failed', evidence: { summary } }],
    verified_at: nowIso(),
  };
}

function verifyTaskCompletion(
  response: string,
  artifact: ArtifactSummary | undefined,
  toolResults: PersistedToolResult[],
  contract?: TaskContract,
  runtimeStatus = 'completed',
): TaskVerification {
  const failedToolResults = toolResults.filter(toolResultFailed);
  const responseDisclosesLimitations = responseDisclosesToolLimitations(response);
  const disclosedToolFailures = failedToolResults.filter((result) => (
    readOnlyWebToolFailureMayDegrade(result) && responseDisclosesLimitations
  ));
  const unacknowledgedToolFailures = failedToolResults.filter((result) => !disclosedToolFailures.includes(result));
  const normalizedRuntimeStatus = runtimeStatus.trim().toLowerCase() || 'completed';
  const successfulTools = toolResults.filter((result) => !toolResultFailed(result) && !isWaitingConfirmationToolResult(result));
  const successfulToolNames = successfulTools.map((result) => canonicalCapabilityName(result.name));
  const deliverables = new Set(contract?.deliverables || []);
  const requiresCodePatch = deliverables.has('code_patch');
  const requiresTestResult = deliverables.has('test_result');
  const hasCodePatch = successfulToolNames.some((name) => ['apply_patch', 'lsp_rename', 'lsp_format'].includes(name));
  const hasPassingTest = successfulTools.some((result) => (
    canonicalCapabilityName(result.name) === 'test_command'
    && ['succeeded', 'passed', 'completed'].includes((optionalString(result.output?.test_status || result.output?.status) || '').toLowerCase())
    && Number(result.output?.exit_code ?? 0) === 0
  ));
  const requirementEvidence = {
    required_deliverables: [...deliverables],
    code_patch_required: requiresCodePatch,
    code_patch_present: hasCodePatch,
    test_result_required: requiresTestResult,
    passing_test_present: hasPassingTest,
    successful_tools: successfulToolNames,
  };
  const contractRequirementsPassed = (!requiresCodePatch || hasCodePatch) && (!requiresTestResult || hasPassingTest);
  const checks: TaskVerification['checks'] = [
    {
      name: 'runtime_reached_safe_terminal_state',
      status: ['completed', 'succeeded', 'stop'].includes(normalizedRuntimeStatus) ? 'passed' : 'failed',
      evidence: { runtime_status: normalizedRuntimeStatus },
    },
    {
      name: 'artifact_or_state_evidence',
      status: artifact ? 'passed' : 'failed',
      evidence: artifact ? { artifact_id: artifact.id, type: artifact.type, title: artifact.title } : { reason: 'missing artifact' },
    },
    {
      name: 'final_response_present',
      status: response.trim() ? 'passed' : 'failed',
      evidence: { response_length: response.trim().length },
    },
    {
      name: 'tool_failures_not_hidden',
      status: unacknowledgedToolFailures.length > 0 ? 'failed' : 'passed',
      evidence: {
        tool_result_count: toolResults.length,
        failed_tool_count: failedToolResults.length,
        disclosed_failure_count: disclosedToolFailures.length,
        unacknowledged_failure_count: unacknowledgedToolFailures.length,
        failed_tools: failedToolResults.map((result) => result.name).slice(0, 20),
        unacknowledged_tools: unacknowledgedToolFailures.map((result) => result.name).slice(0, 20),
      },
    },
    {
      name: 'task_contract_requirements',
      status: contractRequirementsPassed ? 'passed' : 'failed',
      evidence: requirementEvidence,
    },
  ];
  const passed = checks.every((check) => check.status === 'passed');
  return {
    status: passed ? 'passed' : 'failed',
    summary: passed
      ? disclosedToolFailures.length > 0
        ? 'Result verified with disclosed read-only source limitations.'
        : 'Result verified with artifact/state evidence.'
      : 'Verification failed; task is blocked rather than completed.',
    checks,
    verified_at: nowIso(),
  };
}

function toolResultFailed(result: PersistedToolResult): boolean {
  const status = (optionalString(result.output?.status) || '').toLowerCase();
  return ['failed', 'error', 'fatal', 'blocked', 'policy_blocked', 'denied'].includes(status)
    || status.endsWith('_failed');
}

function readOnlyWebToolFailureMayDegrade(result: PersistedToolResult): boolean {
  const name = result.name.trim().toLowerCase();
  return /(?:^|[._-])(web_extract|web_search|web_research|fetch_url)(?:$|[._-])/.test(name);
}

function responseDisclosesToolLimitations(response: string): boolean {
  return /无法|未能|不能|失败|不可用|未完成|未核验|未验证|受限|被阻止|拒绝|\b(?:failed|failure|blocked|denied|unavailable|unable|could not|cannot|not verified|not available)\b/i.test(response);
}

function taskContractFromMetadata(metadata: Record<string, unknown>): TaskContract | undefined {
  const value = metadata.task_contract;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  const objective = optionalString(object.objective);
  if (!objective) return undefined;
  return {
    objective,
    deliverables: parseStringArray(object.deliverables),
    constraints: parseStringArray(object.constraints),
    success_checks: parseStringArray(object.success_checks),
    capability_scope: parseStringArray(object.capability_scope),
    risk_level: optionalString(object.risk_level) || 'read_only',
    mode: optionalString(object.mode) || 'serious_task',
    verification_requirements: parseStringArray(object.verification_requirements),
  };
}

function taskVerificationFromMetadata(metadata: Record<string, unknown>): TaskVerification | undefined {
  const value = metadata.verification;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  return {
    status: optionalString(object.status) || 'pending',
    summary: optionalString(object.summary) || '',
    checks: Array.isArray(object.checks)
      ? object.checks
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
        .map((item) => ({
          name: optionalString(item.name) || 'check',
          status: optionalString(item.status) || 'pending',
          evidence: item.evidence && typeof item.evidence === 'object' && !Array.isArray(item.evidence) ? item.evidence as Record<string, unknown> : undefined,
        }))
      : [],
    verified_at: optionalString(object.verified_at),
  };
}

function taskArtifactContent(response: string, toolResults: PersistedToolResult[]): string {
  const evidence = toolResults.map((result, index) => {
    const status = optionalString(result.output?.status) || 'completed';
    const summary = summaryForToolOutput(result.output, status);
    return `${index + 1}. ${result.name}: ${status}${summary ? ` - ${summary}` : ''}`;
  });
  return [
    '# Joi Task Result',
    '',
    response.trim() || 'No final response was produced.',
    '',
    '## Verification Evidence',
    '',
    evidence.length ? evidence.join('\n') : '- No tool calls were required; final response was recorded as the artifact.',
  ].join('\n');
}

function entryIdentityForRequest(req: ChatRequest, conversationID: string): EntryIdentityResolution {
  const channel = optionalString(req.channel) || 'desktop';
  const externalUserID = optionalString(req.user_id) || (channel === 'desktop' ? 'desktop_user' : `${channel}:unknown`);
  const externalThreadID = optionalString(req.conversation_id) || conversationID;
  const principalID = optionalString(req.principal_id) || defaultPrincipalIDForEntry(channel, externalUserID);
  return {
    principal_id: principalID,
    channel_identity_id: `chid_${stableShortID(`${channel}:${externalUserID}:${externalThreadID}`)}`,
    channel,
    external_user_id: externalUserID,
    external_thread_id: externalThreadID,
    selection_reason: req.conversation_id ? 'explicit_conversation' : 'new_conversation',
  };
}

function defaultPrincipalIDForEntry(channel: string, externalUserID: string): string {
  if (channel === 'desktop' && (!externalUserID || externalUserID === 'desktop_user')) return localOwnerPrincipalID;
  return `principal_${stableShortID(`${channel}:${externalUserID}`)}`;
}

function handoffReasonForRequest(req: ChatRequest, entry: EntryIdentityResolution): string {
  if (req.redirected_from_run_id) return 'redirected_run';
  if (req.parent_run_id) return 'parent_run';
  if (req.product_task_id) return 'explicit_task';
  return entry.channel === 'desktop' ? 'desktop_conversation' : 'external_entry';
}

function isTaskContinuationIntent(message: string): boolean {
  return /继续|接着|进展|状态|刚才|上一个|同一个|这个任务|那个任务|任务进度|查询.*任务|查看.*任务|汇报.*任务|继续.*任务/.test(message)
    || /\b(continue|resume|status|progress|same task|previous task|last task|task update)\b/i.test(message);
}

const localOwnerPrincipalID = 'principal_local_owner';

function stableShortID(value: string): string {
  return hashText(value).slice(0, 20);
}

function evidenceSummaryForTask(
  artifact: ArtifactSummary | undefined,
  toolResults: PersistedToolResult[],
  verification: TaskVerification,
): string {
  const toolCount = toolResults.filter((result) => !isWaitingConfirmationToolResult(result)).length;
  const parts = [
    artifact ? `artifact:${artifact.id}` : '',
    toolCount > 0 ? `tool_runs:${toolCount}` : 'pure_reasoning_artifact',
    `verification:${verification.status}`,
  ].filter(Boolean);
  return parts.join(' ');
}

function titleForTaskCapability(capability: string): string {
  switch (capability) {
    case 'workspace_search':
      return '搜索工作区';
    case 'file_read':
    case 'file_analyze':
      return '读取文件';
    case 'web_research':
      return '检索网页';
    case 'image_generate':
      return '生成图片';
    case 'text_to_speech':
      return '生成语音';
    case 'speech_transcribe':
      return '转写语音';
    case 'delegate_task':
      return '创建子 Agent';
    case 'session_branch':
      return '创建会话分支';
    case 'session_compact':
      return '压缩会话上下文';
    case 'lsp_definition':
    case 'lsp_references':
    case 'lsp_diagnostics':
      return '查询代码索引';
    case 'debugger_attach':
    case 'debugger_breakpoint':
    case 'debugger_step':
    case 'debugger_evaluate':
    case 'debugger_stop':
      return '调试程序';
    case 'apply_patch':
      return '应用代码变更';
    case 'test_command':
      return '运行测试';
    case 'shell_command':
    case 'shell_start':
    case 'shell_write':
    case 'shell_output':
    case 'shell_kill':
      return '操作终端';
    case 'memory_recall':
    case 'memory_write_candidate':
      return '访问记忆';
    case 'session_search':
    case 'session_summary':
      return '查找历史会话';
    case 'skills_list':
    case 'skill_view':
      return '读取技能';
    case 'tool_search':
      return '查找工具';
    case 'task_list':
    case 'task_view':
    case 'task_update':
      return '管理任务';
    case 'browser_click':
    case 'browser_type':
    case 'browser_navigate':
      return '操作浏览器';
    case 'act_ui':
    case 'find_roots':
    case 'observe_ui':
    case 'search_ui':
    case 'expand_ui':
    case 'inspect_ui':
    case 'read_text':
    case 'wait_for':
      return '操作桌面界面';
    case 'computer_observe':
    case 'browser_observe':
      return '观察桌面状态';
    default:
      return `执行 ${capability}`;
  }
}

function summaryForToolOutput(output: Record<string, unknown>, fallback: string): string {
  return optionalString(output.summary)
    || optionalString(output.message)
    || optionalString(output.error)
    || fallback;
}

type GeneratedMessageAttachment = {
  id: string;
  name: string;
  kind: 'image' | 'audio';
  mime_type: string;
  size: number;
  preview_url: string;
};

function generatedAttachmentForToolOutput(output: Record<string, unknown>): GeneratedMessageAttachment[] {
  const mediaOutput = generatedMediaOutputForToolOutput(output);
  const status = (optionalString(mediaOutput.status) || '').toLowerCase();
  if (status !== 'completed' || !['image_generate', 'text_to_speech'].includes(optionalString(mediaOutput.capability) || '')) return [];
  const raw = mediaOutput.attachment && typeof mediaOutput.attachment === 'object' && !Array.isArray(mediaOutput.attachment)
    ? mediaOutput.attachment as Record<string, unknown>
    : {};
  const mimeType = optionalString(raw.mime_type) || optionalString(raw.mimeType) || '';
  const previewURL = optionalString(raw.preview_url) || optionalString(raw.previewUrl) || '';
  const size = Number(raw.size || 0);
  const rawKind = optionalString(raw.kind);
  const kind: GeneratedMessageAttachment['kind'] = rawKind === 'audio' ? rawKind : 'image';
  if (!mimeType.startsWith(`${kind}/`) || !previewURL.startsWith('file:') || !Number.isFinite(size) || size <= 0) return [];
  return [{
    id: optionalString(raw.id) || `attachment_${newID()}`,
    name: optionalString(raw.name) || optionalString(raw.filename) || `Joi ${kind}`,
    kind,
    mime_type: mimeType,
    size,
    preview_url: previewURL,
  }];
}

function generatedMediaOutputForToolOutput(output: Record<string, unknown>): Record<string, unknown> {
  const rawOutput = toolOutputRecord(output.raw_output);
  const rawResult = toolOutputRecord(rawOutput.result);
  const candidates = [
    output,
    toolOutputRecord(output.structuredContent),
    rawOutput,
    rawResult,
    toolOutputRecord(rawResult.structuredContent),
  ];
  const structured = candidates.find((candidate) => (
    ['image_generate', 'text_to_speech'].includes(optionalString(candidate.capability) || '')
    && (optionalString(candidate.status) || '').toLowerCase() === 'completed'
  ));
  if (structured) return structured;
  const content = Array.isArray(rawResult.content) ? rawResult.content : [];
  for (const item of content) {
    const parsedItem = toolOutputRecord(item);
    const parsedText = toolOutputRecord(parsedItem.text);
    if (['image_generate', 'text_to_speech'].includes(optionalString(parsedText.capability) || '')) {
      return parsedText;
    }
  }
  return output;
}

function toolOutputRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return parseObject(value);
}

function normalizeAgentLookupToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function toolRunStatusForOutput(output: Record<string, unknown>): string {
  const status = (optionalString(output.status) || '').toLowerCase();
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'policy_blocked' || status === 'blocked') return 'policy_blocked';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  return 'succeeded';
}

function usageStatusForUsage(usage: Partial<CanonicalModelUsage> | undefined): string {
  if (!usage) return 'provider_missing';
  const normalized = canonicalModelUsage(usage);
  return normalized.input_tokens > 0
    || normalized.output_tokens > 0
    || normalized.cached_input_tokens > 0
    || normalized.cache_write_input_tokens > 0
    || normalized.reasoning_tokens > 0
    || normalized.total_tokens > 0
    ? 'recorded'
    : 'provider_missing';
}

function canonicalModelUsage(value: unknown): CanonicalModelUsage {
  const usage = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const inputTokens = positiveNumber(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = positiveNumber(usage.output_tokens ?? usage.completion_tokens);
  const cachedInputTokens = positiveNumber(usage.cached_input_tokens ?? usage.cached_tokens);
  const cacheWriteInputTokens = positiveNumber(usage.cache_write_input_tokens ?? usage.cache_creation_input_tokens);
  const reasoningTokens = positiveNumber(usage.reasoning_tokens ?? usage.reasoning_output_tokens);
  const totalTokens = positiveNumber(usage.total_tokens) || inputTokens + outputTokens;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: cachedInputTokens,
    cache_write_input_tokens: cacheWriteInputTokens,
    reasoning_tokens: reasoningTokens,
    total_tokens: totalTokens,
  };
}

function estimateCostWithPricing(usage: CanonicalModelUsage, pricing?: ModelPricing): number {
  if (!pricing) return 0;
  const cachedTokens = Math.min(usage.cached_input_tokens, usage.input_tokens);
  const cacheWriteTokens = Math.min(usage.cache_write_input_tokens, Math.max(usage.input_tokens - cachedTokens, 0));
  const billableInputTokens = Math.max(usage.input_tokens - cachedTokens - cacheWriteTokens, 0);
  const cachedInputCost = pricing.cached_input_per_1m > 0 ? cachedTokens * pricing.cached_input_per_1m : 0;
  const cacheWriteInputCost = cacheWriteTokens * pricing.input_per_1m;
  const inputCost = billableInputTokens * pricing.input_per_1m;
  const outputCost = usage.output_tokens * pricing.output_per_1m;
  return (inputCost + cacheWriteInputCost + cachedInputCost + outputCost) / 1_000_000;
}

function builtinModelPricing(provider: string, model: string): ModelPricing | undefined {
  const key = `${provider}/${model}`.toLowerCase();
  const wildcard = `${provider}/*`.toLowerCase();
  const prices: Record<string, ModelPricing> = {
    'openai_compatible/deepseek-v4-flash': { input_per_1m: 0.14, output_per_1m: 0.28, cached_input_per_1m: 0.028 },
    'openai_compatible/deepseek-v4-pro': { input_per_1m: 1.74, output_per_1m: 3.48, cached_input_per_1m: 0.145 },
    'deterministic_provider/*': { input_per_1m: 0, output_per_1m: 0, cached_input_per_1m: 0 },
    'mock_provider/*': { input_per_1m: 0, output_per_1m: 0, cached_input_per_1m: 0 },
  };
  return prices[key] || prices[wildcard];
}

function sumModelUsageItems(items: Record<string, unknown>[]): Record<string, unknown> {
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let cacheWriteInputTokens = 0;
  let reasoningTokens = 0;
  let totalTokens = 0;
  let estimatedCost = 0;
  let weightedLatency = 0;
  let fallbackCalls = 0;
  let errorCalls = 0;
  for (const item of items) {
    const itemCalls = Number(item.calls ?? 0);
    calls += itemCalls;
    inputTokens += Number(item.input_tokens ?? 0);
    outputTokens += Number(item.output_tokens ?? 0);
    cachedInputTokens += Number(item.cached_input_tokens ?? 0);
    cacheWriteInputTokens += Number(item.cache_write_input_tokens ?? 0);
    reasoningTokens += Number(item.reasoning_tokens ?? 0);
    totalTokens += Number(item.total_tokens ?? 0);
    estimatedCost += Number(item.estimated_cost ?? 0);
    weightedLatency += Number(item.avg_latency_ms ?? 0) * itemCalls;
    fallbackCalls += Number(item.fallback_calls ?? 0);
    errorCalls += Number(item.error_calls ?? 0);
  }
  return {
    calls,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: cachedInputTokens,
    cache_write_input_tokens: cacheWriteInputTokens,
    reasoning_tokens: reasoningTokens,
    total_tokens: totalTokens,
    cache_hit_ratio: cacheHitRatioForUsage(inputTokens, cachedInputTokens),
    avg_latency_ms: calls > 0 ? weightedLatency / calls : 0,
    fallback_calls: fallbackCalls,
    error_calls: errorCalls,
    estimated_cost: roundCost(estimatedCost),
  };
}

function cacheHitRatioForUsage(inputTokens: number, cachedInputTokens: number): number {
  const input = Math.max(0, Number(inputTokens) || 0);
  const cached = Math.max(0, Number(cachedInputTokens) || 0);
  if (cached === 0) return 0;
  if (input === 0) return 1;
  return Math.min(1, cached / Math.max(input, cached));
}

function sideEffectLevelForCapability(capability: string): string {
  if (['apply_patch', 'memory_write_candidate', 'task_update', 'session_branch', 'session_compact', 'delegate_task', 'text_to_speech'].includes(capability)) return 'write_local';
  if (['browser_click', 'browser_type', 'act_ui', 'computer_use'].includes(capability)) return 'external_action';
  if (['shell_command', 'test_command', 'shell_start', 'shell_write', 'shell_kill', 'debugger_attach', 'debugger_breakpoint', 'debugger_step', 'debugger_evaluate', 'debugger_stop'].includes(capability)) return 'write_local';
  return 'read';
}

function operationIDForTool(productTaskID: string | undefined, capability: string, args: Record<string, unknown>, callID: string): string {
  return `op_${hashText(JSON.stringify({ productTaskID: productTaskID || '', capability, args, callID })).slice(0, 16)}`;
}

function confirmationInputForTool(productTaskID: string | undefined, capability: string, args: Record<string, unknown>, callID: string, requestedAction: string): Record<string, unknown> {
  const operationID = operationIDForTool(productTaskID, capability, args, callID);
  return {
    ...args,
    operation_id: operationID,
    product_task_id: productTaskID || '',
    affected_paths: affectedPathsForTool(capability, args),
    external_target: externalTargetForTool(capability, args),
    reversible: reversibleForTool(capability),
    requested_action: requestedAction,
  };
}

function affectedPathsForTool(capability: string, args: Record<string, unknown>): string[] {
  const paths = new Set<string>();
  for (const key of ['path', 'root', 'cwd']) {
    const value = optionalString(args[key]);
    if (value) paths.add(value);
  }
  if (capability === 'apply_patch') {
    const patch = optionalString(args.patch) || '';
    for (const line of patch.split(/\r?\n/)) {
      const match = line.match(/^\*\*\* (?:Add|Update|Delete) File:\s+(.+)$/);
      if (match?.[1]) paths.add(match[1].trim());
    }
  }
  return [...paths];
}

function externalTargetForTool(capability: string, args: Record<string, unknown>): string {
  if (capability.startsWith('browser_')) return optionalString(args.url) || optionalString(args.target) || 'frontmost_browser';
  if (capability === 'act_ui' || capability === 'computer_use') return optionalString(args.app) || optionalString(args.root) || optionalString(args.stateId) || 'observed_ui_root';
  if (capability.startsWith('shell_')) return optionalString(args.session_id) || optionalString(args.cwd) || 'local_terminal';
  return '';
}

function reversibleForTool(capability: string): boolean {
  return capability === 'apply_patch' || capability === 'memory_write_candidate' || capability === 'task_update';
}

function parseStringArray(value: unknown): string[] {
  const source = Array.isArray(value) ? value : parseArray(value);
  const items = source.map((item) => String(item).trim()).filter(Boolean);
  return items;
}

function normalizeToolMemoryType(value: unknown): string {
  const normalized = optionalString(value)?.trim().toLowerCase() || 'note';
  return new Set(['note', 'preference', 'current_state', 'user_state', 'relationship_state', 'fact']).has(normalized)
    ? normalized
    : 'note';
}

function resolveToolMemoryCandidateScope(
  requestedScope: string,
  scope: MemoryRetrievalScope,
): { scope_type: 'global' | 'user' | 'room' | 'project'; scope_id: string } {
  if (requestedScope === 'global') return { scope_type: 'global', scope_id: '' };
  if (requestedScope === 'user') {
    const userID = scope.user_ids[0];
    if (!userID) throw new Error('No current user scope is available for this memory candidate');
    return { scope_type: 'user', scope_id: userID };
  }
  if (requestedScope === 'room') {
    if (!scope.room_id) throw new Error('No current room scope is available for this memory candidate');
    return { scope_type: 'room', scope_id: scope.room_id };
  }
  if (requestedScope === 'project' || requestedScope === 'current_project') {
    const projectID = scope.project_ids[0];
    if (!projectID) throw new Error('No current project scope is available for this memory candidate');
    return { scope_type: 'project', scope_id: projectID };
  }
  if (!['current_context', 'auto'].includes(requestedScope)) {
    throw new Error(`Unsupported memory candidate scope: ${requestedScope}`);
  }
  if (scope.project_ids[0]) return { scope_type: 'project', scope_id: scope.project_ids[0] };
  if (scope.room_id) return { scope_type: 'room', scope_id: scope.room_id };
  if (scope.user_ids[0]) return { scope_type: 'user', scope_id: scope.user_ids[0] };
  return { scope_type: 'global', scope_id: '' };
}

const personaUiOnlyCapabilities = new Set([
  'chat',
  'runs',
  'threads',
  'assets',
  'trace',
  'terminal',
]);

function normalizeAgentCapabilityList(values: string[]): string[] {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  if (normalized.includes('*') || normalized.includes('tool_request')) return ['*'];
  const capabilities = normalized
    .filter((value) => value !== 'tool_request' && !personaUiOnlyCapabilities.has(value))
    .map((value) => value === 'memory' ? 'memory_recall' : value);
  return [...new Set(capabilities)];
}

function personaAgentExecutionCapabilities(personaID: string, personaCapabilities: string[]): string[] {
  // The authored Joi persona describes identity and product affordances. It is
  // deliberately not an execution allowlist: the default Joi Agent can request
  // every registered tool, while the compiler and permission profile still
  // decide what is exposed and executable for the current run.
  if (personaID.trim() === 'per_joi_desktop') return ['*'];
  return normalizeAgentCapabilityList(personaCapabilities);
}

function canonicalCapabilityName(capabilityID: string): string {
  const normalized = capabilityID.trim();
  const delegatedMCP = normalized.match(/^(?:mcp[._])?joi_capabilities[._]([A-Za-z0-9_.-]+)$/i);
  if (delegatedMCP?.[1]) return canonicalCapabilityName(delegatedMCP[1]);
  const delegatedWebMCP = normalized.match(/^(?:mcp[._])?joi_web[._](web_search|web_extract)$/i);
  if (delegatedWebMCP?.[1]) return 'web_research';
  switch (normalized) {
    case 'server_diagnose_v1':
    case 'server_diagnose_self':
      return 'server_diagnose';
    case 'workspace_search_v1':
    case 'search_files':
    case 'grep':
    case 'find':
      return 'workspace_search';
    case 'desktop_app_list_v1':
      return 'desktop_app_list';
    case 'desktop_app_inspect_v1':
      return 'desktop_app_inspect';
    case 'computer_observe_v1':
      return 'computer_observe';
    case 'computer_use':
      return 'act_ui';
    case 'browser_read_v1':
      return 'browser_read';
    case 'browser_observe_v1':
      return 'browser_observe';
    case 'browser_navigate_v1':
      return 'browser_navigate';
    case 'browser_click_v1':
      return 'browser_click';
    case 'browser_type_v1':
      return 'browser_type';
    case 'file_read_v1':
    case 'read_file':
    case 'read':
      return 'file_read';
    case 'file_analyze_v1':
      return 'file_analyze';
    case 'shell_command_v1':
    case 'bash':
    case 'ls':
      return 'shell_command';
    case 'apply_patch_v1':
    case 'patch':
    case 'edit_file':
    case 'edit':
    case 'write_file':
    case 'write':
      return 'apply_patch';
    case 'test_command_v1':
      return 'test_command';
    case 'image_gen':
      return 'image_generate';
    case 'subagent_delegate':
      return 'delegate_task';
    case 'compaction_run':
      return 'session_compact';
    case 'web_research_v1':
    case 'web_research_v2':
    case 'web_search':
    case 'web_extract':
    case 'fetch_url':
      return 'web_research';
    case 'browser_snapshot':
      return 'browser_observe';
    case 'system_health_check_v1':
    case 'system_health_check_self':
      return 'system_health_check';
    default:
      return normalized;
  }
}

function sanitizeWorkerGatewayOutput(output: Record<string, unknown>): Record<string, unknown> {
  const contentType = String(output.content_type || '').toLowerCase();
  const mode = String(output.mode || '');
  if (!contentType.includes('html') && !mode.includes('web_research')) return output;
  const cleaned = { ...output };
  if (typeof output.readable_text === 'string') {
    cleaned.readable_text = stripPlainCSSBlocks(output.readable_text);
  }
  if (typeof output.summary === 'string') {
    cleaned.summary = stripPlainCSSBlocks(output.summary);
  }
  return cleaned;
}

function stripPlainCSSBlocks(text: string): string {
  let current = text;
  for (;;) {
    const next = current.replace(plainCSSBlockPattern, '$1');
    if (next === current) return next.trim().replace(/\s+/g, ' ');
    current = next;
  }
}

function lifecycleForView(view?: string): string | null {
  if (!view || view === 'active') return 'active';
  if (view === 'archived') return 'archived';
  if (view === 'trash') return 'trashed';
  if (view === 'purged') return 'purged';
  if (view === 'all') return null;
  return view;
}

function titleFromMessage(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'New conversation';
  return trimmed.length > 36 ? `${trimmed.slice(0, 36)}...` : trimmed;
}

function cleanMessengerTitle(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed || /^new chat|new conversation|untitled|无标题会话|新聊天\s*\d*$/iu.test(trimmed)) {
    return 'Joi 项目私聊';
  }
  return trimmed;
}

function stableRoomIDForConversation(conversationID: string): string {
  return `room_${hashText(conversationID).slice(0, 16)}`;
}

function stableThreadIDForConversation(conversationID: string): string {
  return `mthread_${hashText(conversationID).slice(0, 24)}`;
}

function stableThreadEventID(threadID: string, itemID: string): string {
  return `thev_${hashText(`${threadID}:${itemID}`).slice(0, 24)}`;
}

function configuredPersonaModelStrategy(value?: string): string {
  const modelName = value?.trim() || '';
  if (!modelName || /^使用.*模型/.test(modelName)) return '';
  return modelName;
}

function personaNameFromProject(projectName: string): string {
  const compact = projectName
    .replace(/项目|Project|工作区|workspace/giu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean)[0];
  if (!compact) return 'Mira';
  const cleaned = compact.replace(/[^\p{L}\p{N}_-]/gu, '');
  if (!cleaned) return 'Mira';
  return cleaned.length > 16 ? cleaned.slice(0, 16) : cleaned;
}

function normalizePersonaHandle(seed: string): string {
  const normalized = seed
    .trim()
    .replace(/^@/u, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return `@${normalized || 'persona'}`;
}

function permissionProfileRisk(profile?: PermissionProfile): string {
  if (profile === 'danger_full_access') return 'high';
  if (profile === 'workspace_write') return 'medium';
  return 'low';
}

function isHighRiskApproval(riskLevel: string): boolean {
  return ['high', 'destructive', 'unsafe', 'external_write', 'workspace_write', 'browser_interaction'].includes(riskLevel.trim().toLowerCase());
}

function permissionAuditSummary(
  actorType: string,
  actorRole: string,
  projectIDs: string[],
  canApproveHighRisk: boolean,
  multiHumanThrottle: boolean,
): string {
  const scope = projectIDs.length > 0 ? `${projectIDs.length} 个授权项目` : '仅当前房间上下文';
  const approval = canApproveHighRisk ? '可审批高风险动作' : '不可审批高风险动作';
  const throttle = multiHumanThrottle ? '；多真人房间默认节制 AI 主动发言' : '';
  return `${actorType}/${actorRole} · ${scope} · ${approval}${throttle}`;
}

function defaultScopeForRoomType(roomType?: string): string {
  if (roomType === 'project_dm') return 'current_project';
  if (roomType === 'private_hub' || roomType === 'shared' || roomType === 'external_mirror') return 'auto_route';
  return 'room_scope';
}

function messageMentionsPersona(message: string, persona: ProjectPersona, explicitMentions?: string[]): boolean {
  const mentions = (explicitMentions || []).map((item) => item.trim()).filter(Boolean);
  if (mentions.some((item) => item === persona.id || item === persona.handle || item.replace(/^@/u, '') === persona.handle.replace(/^@/u, ''))) {
    return true;
  }
  const normalizedHandle = persona.handle.startsWith('@') ? persona.handle : `@${persona.handle}`;
  if (message.includes(normalizedHandle)) return true;
  const escapedDisplay = persona.display_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)@${escapedDisplay}(?=\\s|$|[，。,.!?！？:：])`, 'u').test(message);
}

function routeResolutionForTrace(resolution: RoomRouteResolution): Record<string, unknown> {
  return {
    room_id: resolution.room.id,
    room_type: resolution.room.type,
    speaker_persona_id: resolution.speaker_persona_id,
    owner_project_id: resolution.owner_project_id,
    executor_persona_id: resolution.executor_persona_id,
    collaborator_project_ids: resolution.collaborator_project_ids,
    collaborator_persona_ids: resolution.collaborator_persona_ids || [],
    execution_scope: resolution.execution_scope,
    write_targets: resolution.write_targets,
    thread_action: resolution.thread_action,
    confidence: resolution.confidence,
    risk: resolution.risk,
    requires_confirmation: resolution.requires_confirmation,
    reason_codes: resolution.reason_codes,
  };
}

function externalLockTarget(text: string, visiblePersonaIDs: string[], personaForID: (id: string) => ProjectPersona): ProjectPersona | null {
  const trimmed = text.trim();
  const match = /^\/lock\s+(.+)$/i.exec(trimmed);
  if (!match) return null;
  const target = match[1].trim().replace(/^@/u, '').toLowerCase();
  for (const personaID of visiblePersonaIDs) {
    const persona = personaForID(personaID);
    const handle = persona.handle.replace(/^@/u, '').toLowerCase();
    if (handle === target || persona.display_name.toLowerCase() === target) return persona;
  }
  return null;
}

function agentIDForMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (message.includes('记忆') || normalized.includes('memory') || message.includes('偏好')) return 'memory_agent';
  if (message.includes('@research') || normalized.includes('https://') || normalized.includes('http://')) return 'research_agent';
  if (message.includes('Joi 自检') || normalized.includes('health') || normalized.includes('cloudflared') || normalized.includes('server')) return 'devops_agent';
  return 'general_agent';
}

function positiveNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function positiveFloat(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function roundCost(value: number): number {
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(8)) : 0;
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (!value || value < 1) return fallback;
  return Math.min(Math.floor(value), 200);
}

function normalizeAutomationKind(value: unknown): AutomationKind {
  return value === 'webhook' ? 'webhook' : 'schedule';
}

function normalizeAutomationExecutionKind(value: unknown): AutomationExecutionKind {
  const normalized = (optionalString(value) || '').toLowerCase();
  if (normalized === 'heartbeat') return 'heartbeat';
  if (normalized === 'webhook') return 'webhook';
  return 'cron';
}

function normalizeAutomationInputMode(value: unknown): InputMode {
  const text = optionalString(value);
  if (text === 'chat_assist' || text === 'serious_task' || text === 'background_task' || text === 'auto') return text;
  return 'background_task';
}

function normalizeAutomationPermissionProfile(value: unknown): PermissionProfile {
  const text = optionalString(value);
  if (text === 'workspace_write' || text === 'danger_full_access') return text;
  return 'read_only';
}

function sanitizeAutomationSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || `automation-${newID()}`;
}

function defaultAutomationPromptTemplate(kind: AutomationKind): string {
  if (kind === 'webhook') {
    return '请处理这个 webhook 自动化任务。payload 摘要：{{payload}}';
  }
  return '请处理这个定时自动化任务。payload 摘要：{{payload}}';
}

function defaultAutomationRetryPolicy(): Record<string, unknown> {
  return {
    max_attempts: 2,
    backoff_seconds: [60, 300],
    no_retry_error_codes: ['POLICY_DENIED', 'INVALID_PAYLOAD', 'PENDING_CONFIRMATION'],
  };
}

function normalizeNotificationMaxAttempts(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(5, Math.floor(parsed)));
}

function normalizeNotificationBackoff(value: unknown): number[] {
  const values = Array.isArray(value) ? value : [];
  const normalized = values
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 0)
    .map((item) => Math.min(3_600, Math.floor(item)))
    .slice(0, 4);
  return normalized.length > 0 ? normalized : [30, 120];
}

function automationMaxAttempts(policy: Record<string, unknown>): number {
  const value = Number(policy.max_attempts ?? defaultAutomationRetryPolicy().max_attempts);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 2;
}

function codedError(code: string, message: string): Error & { code?: string } {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function isPendingConfirmationAutomationError(code?: string, message?: string): boolean {
  const normalizedCode = (code || '').toUpperCase();
  if (normalizedCode === 'PENDING_CONFIRMATION') return true;
  return /confirmation|approval|waiting_confirmation/i.test(message || '');
}

function boolString(value: boolean): string {
  return value ? 'true' : 'false';
}

function normalizeWebSearchProvider(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (['brave', 'duckduckgo'].includes(normalized)) return normalized;
  return 'auto';
}

function normalizeReasoningEffort(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (['none', 'low', 'medium', 'high'].includes(normalized)) return normalized;
  return 'low';
}

function optionalReasoningEffort(value: unknown): string | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  return ['none', 'low', 'medium', 'high'].includes(normalized) ? normalized : undefined;
}

function runtimeDateContextLines(): string[] {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  return [
    `current_date: ${formatLocalDate(now)}`,
    `current_time: ${formatLocalTime(now)}`,
    `timezone: ${timezone}`,
    `current_iso: ${now.toISOString()}`,
    'date_instruction: Treat the current_date above as authoritative for all relative-date, release-date, schedule, and news comparisons.',
    'search_instruction: Search result snippets are unverified summaries. For releases or official announcements, prefer official pages and state when a result is only an unverified snippet.',
  ];
}

function formatLocalDate(date: Date): string {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-');
}

function formatLocalTime(date: Date): string {
  return [
    padDatePart(date.getHours()),
    padDatePart(date.getMinutes()),
    padDatePart(date.getSeconds()),
  ].join(':');
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function pruneUndefined(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    output[key] = item;
  }
  return output;
}

function statusForRunEventType(eventType: string): string {
  const semanticType = eventType.replace(/_/g, '.');
  if (semanticType.endsWith('.failed')) return 'failed';
  if (semanticType.endsWith('.cancelled') || semanticType.endsWith('.canceled')) return 'cancelled';
  if (semanticType.endsWith('.redirected')) return 'redirected';
  if (eventType === 'run.recovery_required') return 'waiting_approval';
  if (semanticType.endsWith('.completed') || semanticType.endsWith('.finished')) return 'completed';
  if (semanticType.endsWith('.scheduled') || semanticType.endsWith('.queued')) return 'queued';
  if (semanticType.endsWith('.requested') || semanticType.endsWith('.required')) return 'waiting_approval';
  if (semanticType.endsWith('.started') || semanticType.endsWith('.delta')) return 'running';
  return 'running';
}

function memoryFeedbackEventType(feedback: string): string {
  switch (feedback) {
    case 'confirm':
    case 'positive':
      return 'memory.confirmed';
    case 'edit':
      return 'memory.corrected';
    case 'reject':
    case 'negative':
      return 'memory.rejected';
    case 'delete':
      return 'memory.deleted';
    default:
      return 'memory.corrected';
  }
}

function memoryCandidateDecisionAction(decision: string): string {
  switch (decision) {
    case 'confirm':
    case 'approve':
      return 'confirm';
    case 'correct':
    case 'edit':
    case 'edit_confirm':
      return 'edit_confirm';
    case 'reject':
    case 'ignore':
      return 'reject';
    case 'delete':
      return 'delete';
    default:
      throw new Error(`unsupported memory candidate decision: ${decision}`);
  }
}

function normalizeApprovalDecisionStatus(decision?: string): 'approved' | 'rejected' {
  const normalized = (decision || '').trim();
  if (['approve', 'approved', 'allow', 'allowed', 'yes'].includes(normalized)) return 'approved';
  if (['deny', 'denied', 'reject', 'rejected', 'no'].includes(normalized)) return 'rejected';
  throw new Error(`unsupported approval decision: ${decision || ''}`);
}

function normalizeApprovalScope(scope?: string): 'one_call' | 'current_run' {
  const normalized = (scope || '').trim();
  if (normalized === 'current_run') return 'current_run';
  return 'one_call';
}

function sanitizeApprovalEditedParameters(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const cleaned = pruneUndefined(value as Record<string, unknown>);
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function statusForMemoryFeedback(feedback: string): string {
  if (feedback === 'reject' || feedback === 'negative' || feedback === 'delete') return 'completed';
  return 'completed';
}

function eventTypeForProactiveDecision(action: string, status: string): string {
  if (action === 'sent' || status === 'sent' || status === 'delivered') return 'proactive.delivered';
  if (action === 'send' || action === 'approve' || status === 'authorized') return 'proactive.authorized';
  if (action === 'queue' || status === 'queued' || status === 'scheduled') return 'proactive.scheduled';
  if (action === 'useful' || action === 'annoying' || action === 'inaccurate' || status === 'responded') return 'proactive.responded';
  if (status === 'suppressed') return 'proactive.suppressed';
  return 'proactive.suppressed';
}

function isNegativeProactiveFeedbackAction(action: string): boolean {
  return ['dismiss', 'ignore', 'annoying', 'inaccurate'].includes(action);
}

function proactiveFeedbackScorePenalty(action: string): number {
  if (action === 'annoying' || action === 'inaccurate') return 0.4;
  return 0.25;
}

function normalizeProductTaskCloseOutcome(outcome?: string): string {
  const normalized = (outcome || '').trim();
  if (['completed', 'completed_with_limitations', 'blocked', 'failed', 'cancelled'].includes(normalized)) {
    return normalized;
  }
  return 'completed_with_limitations';
}

function productTaskTerminalEventType(outcome: string): string {
  if (outcome === 'completed') return 'task.completed';
  if (outcome === 'blocked') return 'task.blocked';
  if (outcome === 'failed') return 'task.failed';
  if (outcome === 'cancelled') return 'task.cancelled';
  return 'task.completed_with_limitations';
}

function visibilityForRunEventType(eventType: string, itemType?: string): string {
  if (eventType === 'assistant.delta' || eventType === 'assistant.completed') return 'chat';
  if (eventType.startsWith('approval.')) return 'approval';
  if (eventType.startsWith('artifact.') || eventType.startsWith('verification.')) return 'artifact';
  if (eventType.startsWith('task.')) return 'task';
  if (eventType.startsWith('tool.')) return 'tool';
  if (eventType.startsWith('memory.') || eventType === 'user_state.updated' || eventType === 'relationship_state.updated') return 'memory';
  if (eventType.startsWith('open_loop.') || eventType.startsWith('proactive.')) return 'proactive';
  if (eventType.startsWith('handoff.') || eventType.startsWith('notification.')) return 'handoff';
  if (eventType === 'run.mode_resolved') return 'inline_status';
  if (eventType === 'run.redirected' || eventType === 'run.recovery_required') return 'inline_status';
  if (itemType === 'model' || eventType.startsWith('model.') || eventType === 'usage.recorded') return 'trace_only';
  return 'trace_only';
}

function terminalRunEventType(eventType: string): boolean {
  return [
    'run.completed',
    'run.failed',
    'run.cancelled',
    'run.redirected',
    'task.completed',
    'task.completed_with_limitations',
    'task.blocked',
    'task.failed',
    'task.cancelled',
  ].includes(eventType);
}

function defaultExternalHandoffReadiness() {
  return {
    checked: false,
    ok: false,
    credentials: {},
    checks: {},
    services: {},
  };
}

function externalHandoffStatus(audit: Pick<ExternalHandoffAudit, 'schema_current' | 'linked_live_handoffs' | 'readiness' | 'metrics'>): ExternalHandoffAudit['status'] {
  if (!audit.schema_current) return 'schema_missing';
  if (audit.linked_live_handoffs.length > 0) return 'live_handoff_linked';
  if (audit.readiness.checked && !audit.readiness.ok) return 'external_not_ready';
  if (audit.metrics.external_runs > 0) return 'awaiting_desktop_continuation';
  return 'awaiting_external_input';
}

function externalHandoffNextAction(status: ExternalHandoffAudit['status']): string {
  const actions: Record<ExternalHandoffAudit['status'], string> = {
    sqlite_missing: 'Start Joi once so the production SQLite database exists.',
    schema_missing: 'Run pnpm joi:prod-schema:migrate, then rerun the live audit.',
    external_not_ready: 'Fix Telegram/iMessage credential or connection checks, then rerun the live audit.',
    awaiting_external_input: 'Send a real Telegram or iMessage task, then continue the same task in Desktop.',
    awaiting_desktop_continuation: 'Open Desktop recent tasks and continue the external-origin task so the same Product Task has a Desktop run.',
    live_handoff_linked: 'Live external-to-Desktop handoff evidence is present.',
    unknown: '',
  };
  return actions[status] || '';
}

function quoteIdentifier(value: string): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function normalizeLogLevel(value: string): string {
  const level = value.trim().toLowerCase();
  if (['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(level)) return level;
  return 'info';
}

function normalizeLogRiskLevel(value: string): string {
  const risk = value.trim().toLowerCase();
  if (['read_only', 'write_candidate', 'browser_interaction', 'workspace_write', 'state_change', 'destructive', 'unsafe'].includes(risk)) return risk;
  return 'read_only';
}

function normalizeLogCategory(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'system';
}

function normalizeFeatureKey(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'log';
}

function logLevelForRunEvent(eventType: string, status: string, error: unknown): string {
  if (error) return 'error';
  if (eventType.endsWith('.failed') || status === 'failed' || status === 'blocked') return 'error';
  if (eventType.endsWith('.cancelled') || eventType.includes('policy_blocked') || eventType.includes('denied')) return 'warn';
  if (eventType.endsWith('.delta') || eventType === 'usage.recorded') return 'trace';
  if (eventType.startsWith('model.')) return 'debug';
  return 'info';
}

function logRiskForRunEvent(eventType: string, payload: Record<string, unknown>): string {
  const explicit = optionalString(payload.risk_level) || optionalString(payload.risk);
  if (explicit) return explicit;
  const capability = optionalString(payload.capability) || optionalString(payload.tool_name) || eventType;
  if (['apply_patch', 'memory_write_candidate', 'task_update'].includes(capability)) return 'workspace_write';
  if (['browser_click', 'browser_type', 'act_ui', 'computer_use', 'shell_start', 'shell_write', 'shell_kill'].includes(capability)) return 'browser_interaction';
  if (eventType.startsWith('approval.')) return 'state_change';
  if (eventType.startsWith('memory.')) return 'write_candidate';
  return 'read_only';
}

function logCategoryForRunEvent(eventType: string, itemType?: string): string {
  if (eventType.startsWith('model.') || eventType === 'usage.recorded') return 'model';
  if (eventType.startsWith('tool.')) return 'tool';
  if (eventType.startsWith('approval.')) return 'approval';
  if (eventType.startsWith('memory.')) return 'memory';
  if (eventType.startsWith('handoff.') || eventType.startsWith('notification.')) return 'external';
  if (eventType.startsWith('task.') || itemType === 'task') return 'task';
  if (eventType.startsWith('run.') || eventType.startsWith('turn.')) return 'runtime';
  return itemType || 'runtime';
}

function logFeatureKeyForRunEvent(eventType: string, payload: Record<string, unknown>): string {
  return optionalString(payload.feature_key)
    || optionalString(payload.capability)
    || optionalString(payload.tool_name)
    || eventType;
}

function logMessageForRunEvent(eventType: string, payload: Record<string, unknown>, status: string): string {
  return optionalString(payload.message)
    || optionalString(payload.summary)
    || optionalString(payload.title)
    || `${eventType} ${status}`;
}

function errorObject(error: unknown): Record<string, unknown> {
  if (!error) return {};
  if (error instanceof Error) return { message: error.message, name: error.name, stack: error.stack };
  if (typeof error === 'object' && !Array.isArray(error)) return error as Record<string, unknown>;
  return { message: String(error) };
}

function sanitizeLogPayload(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeLogValue(value);
  if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) return sanitized as Record<string, unknown>;
  if (sanitized === undefined || sanitized === null || sanitized === '') return {};
  return { value: sanitized };
}

function sanitizeLogValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    const redactNamedValue = objectHasSensitiveNameHint(value as Record<string, unknown>);
    for (const [key, item] of Object.entries(value)) {
      result[key] = diagnosticSensitiveKey(key) || (key.toLowerCase() === 'value' && redactNamedValue)
        ? '[REDACTED]'
        : sanitizeLogValue(item);
    }
    return result;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return sanitizeLogValue(JSON.parse(trimmed));
      } catch {
        // Keep non-JSON strings on the normal redaction path.
      }
    }
    return redactSensitiveText(value);
  }
  return value;
}

function normalizeLogCleanupScopes(scopes: string[] | undefined): string[] {
  const allowed = new Set(['app_logs', 'run_events', 'run_steps', 'tool_runs', 'model_calls', 'worker_gateway_audit_logs', 'log_files']);
  const cleaned = [...new Set((scopes || []).map((scope) => scope.trim()).filter((scope) => allowed.has(scope)))];
  return cleaned.length > 0 ? cleaned : ['app_logs', 'run_events', 'run_steps', 'tool_runs', 'model_calls', 'worker_gateway_audit_logs', 'log_files'];
}

function logCleanupTable(scope: string): string {
  switch (scope) {
    case 'app_logs':
      return 'app_logs';
    case 'run_events':
      return 'run_events';
    case 'run_steps':
      return 'run_steps';
    case 'tool_runs':
      return 'tool_runs';
    case 'model_calls':
      return 'model_calls';
    case 'worker_gateway_audit_logs':
      return 'worker_gateway_audit_logs';
    default:
      throw new Error(`unsupported log cleanup scope: ${scope}`);
  }
}

function errorSummary(error: unknown): string | undefined {
  if (!error) return undefined;
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && !Array.isArray(error)) {
    return optionalString((error as Record<string, unknown>).message)
      || optionalString((error as Record<string, unknown>).error)
      || JSON.stringify(error);
  }
  return String(error);
}

function sanitizeAssistantConversationText(userMessage: string, text: string, options: { trim?: boolean } = {}): string {
  if (!text) return text;
  const sanitized = shouldPreserveEmojiContent(userMessage)
    ? text
    : text
      .replace(assistantDecorativeEmojiPattern, '')
      .replace(/\uFE0F|\u200D/g, '');
  if (options.trim === false) return sanitized;
  return sanitized.trim();
}

function shouldPreserveEmojiContent(userMessage: string): boolean {
  return /(?:emoji|表情|表情包|unicode|Unicode).*(?:展示|生成|列出|解释|说明|含义|例子|示例|编码|quote|transform|generate|explain|list|show)|(?:展示|生成|列出|解释|说明|含义|例子|示例|编码|quote|transform|generate|explain|list|show).*(?:emoji|表情|表情包|unicode|Unicode)/i.test(userMessage);
}

const assistantDecorativeEmojiPattern = /(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|\p{Extended_Pictographic})\uFE0F?(?:\u200D(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|\p{Extended_Pictographic})\uFE0F?)*/gu;

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function formatProductTaskStatusForCheckpoint(status: string): string {
  switch (status) {
    case 'planning': return '待开始';
    case 'running': return '执行中';
    case 'waiting_confirmation': return '等待确认';
    case 'paused': return '已暂停';
    case 'verifying': return '核对中';
    case 'blocked': return '受阻';
    default: return status || '进行中';
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array)) {
    const keys = Object.keys(value as Record<string, unknown>);
    if (!keys.length || !keys.every((key) => /^\d+$/.test(key))) {
      return value as Record<string, unknown>;
    }
  }
  const text = jsonText(value);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function skillRecordFromRow(row: SQLiteRow): SkillRecord {
  return {
    id: String(row.id),
    version: optionalString(row.version) || 'v1',
    name: String(row.name),
    description: optionalString(row.description) || '',
    trigger_phrases: parseArray(row.trigger_phrases).map(String),
    required_capabilities: parseArray(row.required_capabilities).map(String),
    forbidden_capabilities: parseArray(row.forbidden_capabilities).map(String),
    output_contract: optionalString(row.output_contract) || '',
    enabled: Boolean(Number(row.enabled ?? 1)),
    metadata: parseObject(row.metadata),
  };
}

function skillScopeValue(value: unknown): SkillScope {
  const scope = optionalString(value);
  if (scope === 'repo' || scope === 'user' || scope === 'compat' || scope === 'admin' || scope === 'system' || scope === 'extra') return scope;
  return 'extra';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePluginProviders(value: unknown, pluginID: string): PluginProviderConfig[] {
  if (!Array.isArray(value)) return [];
  const providers: PluginProviderConfig[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = String(item.id || '').trim();
    const name = String(item.name || id).trim();
    const protocol = String(item.protocol || '').trim().toLowerCase();
    const command = String(item.command || '').trim();
    if (!id || !name || !protocol || !command) continue;
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`plugin provider id contains unsupported characters: ${id}`);
    if (seen.has(id)) throw new Error(`duplicate plugin provider id: ${id}`);
    seen.add(id);
    const models = Array.isArray(item.models)
      ? item.models.flatMap((model) => {
        if (typeof model === 'string' && model.trim()) return [{ id: model.trim(), name: model.trim() }];
        if (!isRecord(model)) return [];
        const modelID = String(model.id || '').trim();
        return modelID ? [{ id: modelID, name: String(model.name || modelID).trim() || modelID }] : [];
      })
      : [];
    providers.push({
      id,
      name,
      protocol,
      command,
      args: Array.isArray(item.args) ? item.args.map(String) : [],
      runtime: optionalString(item.runtime),
      env: isRecord(item.env) ? Object.fromEntries(Object.entries(item.env).map(([key, entry]) => [key, String(entry)])) : undefined,
      default_model: optionalString(item.default_model),
      models,
      auth_method: optionalString(item.auth_method),
      description: optionalString(item.description),
      plugin_id: pluginID,
    });
  }
  return providers;
}

function parseArray(value: unknown): unknown[] {
  const text = jsonText(value);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToRunQueuedMessage(row: SQLiteRow): RunQueuedMessage {
  return {
    id: optionalString(row.id) || '',
    run_id: optionalString(row.run_id) || '',
    conversation_id: optionalString(row.conversation_id) || '',
    kind: (optionalString(row.kind) || 'follow_up') as RunQueuedMessage['kind'],
    content: optionalString(row.content) || '',
    attachments: parseArray(row.attachments),
    status: optionalString(row.status) || 'pending',
    delivered_run_id: optionalString(row.delivered_run_id),
    created_at: optionalString(row.created_at),
    delivered_at: optionalString(row.delivered_at),
    metadata: parseObject(row.metadata),
  };
}

function rowToConversationCompaction(row: SQLiteRow): ConversationCompactionRecord {
  return {
    id: optionalString(row.id) || '',
    conversation_id: optionalString(row.conversation_id) || '',
    source_run_id: optionalString(row.source_run_id),
    summary: optionalString(row.summary) || '',
    first_kept_message_id: optionalString(row.first_kept_message_id),
    covered_message_count: Number(row.covered_message_count || 0),
    original_message_count: Number(row.original_message_count || 0),
    original_char_count: Number(row.original_char_count || 0),
    compacted_context_char_count: Number(row.compacted_context_char_count || 0),
    reason: optionalString(row.reason) || '',
    created_at: optionalString(row.created_at),
    metadata: parseObject(row.metadata),
  };
}

function rowToAgentModelPolicy(row: SQLiteRow): AgentModelPolicy {
  return {
    agent_id: optionalString(row.agent_id) || '',
    default_model_id: optionalString(row.default_model_id),
    fallback_model_ids: parseStringArray(row.fallback_model_ids),
    cheap_model_id: optionalString(row.cheap_model_id),
    child_model_id: optionalString(row.child_model_id),
    tool_model_id: optionalString(row.tool_model_id),
    long_context_model_id: optionalString(row.long_context_model_id),
    reasoning_effort: optionalString(row.reasoning_effort),
    max_failovers: Number(row.max_failovers ?? 2),
    enabled: Boolean(Number(row.enabled ?? 1)),
    metadata: parseObject(row.metadata),
    updated_at: optionalString(row.updated_at),
  };
}

function isSQLiteRow(value: unknown): value is SQLiteRow {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringRecord(value: unknown): Record<string, string> {
  const parsed = parseObject(value);
  return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function summarizeActivityEvents(rows: SQLiteRow[]): string {
  if (rows.length === 0) return '本次记录没有采集到可用活动。';
  const apps = new Map<string, number>();
  for (const row of rows) {
    const app = optionalString(row.app_name) || '未知应用';
    apps.set(app, (apps.get(app) || 0) + 1);
  }
  const topApps = [...apps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const recent = rows.slice(-5).map((row) => optionalString(row.window_title) || optionalString(row.text)).filter(Boolean);
  return [
    `记录 ${rows.length} 个活动快照。`,
    `主要应用：${topApps.map(([app, count]) => `${app} ${count} 次`).join('、')}。`,
    ...(recent.length ? [`最近上下文：${recent.join('；')}`] : []),
  ].join('\n');
}

function mergeStringIDs(current: unknown[], additions: string[]): string[] {
  const merged = new Set<string>();
  for (const value of current) {
    const text = optionalString(value);
    if (text) merged.add(text);
  }
  for (const value of additions) {
    const text = value.trim();
    if (text) merged.add(text);
  }
  return [...merged];
}

function placeholders(count: number): string {
  return Array.from({ length: Math.max(1, count) }, () => '?').join(', ');
}

function jsonText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
    return Buffer.from(value).toString('utf8');
  }
  if (typeof value === 'object') {
    const numericKeys = Object.keys(value as Record<string, unknown>);
    if (numericKeys.length > 0 && numericKeys.every((key) => /^\d+$/.test(key))) {
      return Buffer.from(numericKeys.sort((a, b) => Number(a) - Number(b)).map((key) => Number((value as Record<string, unknown>)[key]))).toString('utf8');
    }
  }
  return '';
}

function parseStringSetting(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Fall through to comma parsing for legacy env-like values.
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function formatPromptConversationLine(message: PromptConversationMessage, limit: number): string {
  const role = message.role.replace(/[^A-Za-z0-9_-]/g, '') || 'message';
  const runID = message.run_id ? ` run_id=${message.run_id}` : '';
  return `- ${role}${runID}: ${compactPromptConversationText(message.content, limit)}`;
}

function compactPromptConversationText(value: string, limit: number): string {
  const compact = redactSensitiveText(value).replace(/\s+/g, ' ').trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 3))}...`;
}

function isSkillFollowupMessage(message: string): boolean {
  return /(?:这个|刚才|同一个|继续)(?:\s*的)?\s*(?:skill|技能)|(?:this|that|same|previous)\s+skill|use\s+it\s+again/i.test(message);
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value);
  return text === '' ? undefined : text;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newID(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function defaultWorkspaceRoot(): string {
  return '/Users/hao/project/Joi';
}

function normalizeWorkspaceSettings(input: WorkspaceSettings): WorkspaceSettings {
  const allowed = input.allowed_roots.length > 0 ? input.allowed_roots : [defaultWorkspaceRoot()];
  const allowedRoots = [...new Set(allowed.map((root) => normalizeRoot(root)))];
  if (allowedRoots.length === 0) {
    throw new Error('workspace.allowed_roots must include at least one root');
  }
  const defaultRoot = normalizeRoot(input.default_root || allowedRoots[0]);
  if (!allowedRoots.some((root) => pathWithinRoot(defaultRoot, root))) {
    throw new Error('workspace.default_root must be inside workspace.allowed_roots');
  }
  return {
    allowed_roots: allowedRoots,
    default_root: defaultRoot,
    browser_allowed_hosts: [...new Set(input.browser_allowed_hosts.map((host) => host.trim().toLowerCase()).filter(Boolean))],
    web_research_allow_private_hosts: Boolean(input.web_research_allow_private_hosts),
    web_search_provider: normalizeWebSearchProvider(input.web_search_provider),
    brave_search_api_key_configured: Boolean(input.brave_search_api_key_configured),
    file_analyze_max_bytes: input.file_analyze_max_bytes > 0 ? Math.floor(input.file_analyze_max_bytes) : 256 * 1024,
    workspace_search_max_results: input.workspace_search_max_results > 0 ? Math.floor(input.workspace_search_max_results) : 50,
    browser_enabled: input.browser_enabled !== false,
    github_default_repo: (input.github_default_repo || '').trim(),
    github_api_base_url: (input.github_api_base_url || 'https://api.github.com').trim().replace(/\/+$/, ''),
    node_assignment_policy: ['main_first', 'auto', 'manual'].includes(String(input.node_assignment_policy || ''))
      ? String(input.node_assignment_policy)
      : 'main_first',
    allow_remote_execution: Boolean(input.allow_remote_execution),
    privacy_local_only: input.privacy_local_only !== false,
    remote_execution_requires_confirmation: input.remote_execution_requires_confirmation !== false,
    diagnostic_redaction_enabled: input.diagnostic_redaction_enabled !== false,
    destructive_operations_disabled: input.destructive_operations_disabled !== false,
    desktop_notifications_enabled: input.desktop_notifications_enabled !== false,
    desktop_notification_sound: Boolean(input.desktop_notification_sound),
    cli_enabled: Boolean(input.cli_enabled),
    cli_socket_path: (input.cli_socket_path || join(homedir(), 'Library', 'Application Support', 'Joi', 'joi.sock')).trim(),
    webhook_chat_enabled: Boolean(input.webhook_chat_enabled),
    webhook_chat_path: normalizeLocalEntryPath(input.webhook_chat_path || '/chat/webhook'),
    wechat_claw_enabled: Boolean(input.wechat_claw_enabled),
    wechat_claw_endpoint: (input.wechat_claw_endpoint || '').trim(),
    wechat_claw_allowed_senders: [...new Set((input.wechat_claw_allowed_senders || []).map((item) => item.trim()).filter(Boolean))],
    speech_voice: (input.speech_voice || 'Ting-Ting').trim() || 'Ting-Ting',
    speech_rate: Math.max(80, Math.min(450, Math.round(Number(input.speech_rate) || 185))),
    speech_transcription_model: ['tiny', 'base', 'small'].includes(String(input.speech_transcription_model || ''))
      ? String(input.speech_transcription_model)
      : 'small',
    speech_transcription_language: (input.speech_transcription_language || 'zh').trim() || 'zh',
  };
}

function normalizeLocalEntryPath(value: string): string {
  const path = value.trim();
  if (!path) return '/chat/webhook';
  return `/${path.replace(/^\/+/, '').replace(/\/{2,}/g, '/')}`;
}

function normalizeRoot(root: string): string {
  const expanded = root.startsWith('~/') ? join(homedir(), root.slice(2)) : root;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(defaultWorkspaceRoot(), expanded);
}

function pathWithinRoot(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function workspaceRealAndLogicalRoots(roots: string[]): string[] {
  const resolvedRoots = new Set<string>();
  for (const root of roots) {
    const logicalRoot = resolve(root);
    resolvedRoots.add(logicalRoot);
    try {
      resolvedRoots.add(realpathSync(logicalRoot));
    } catch {
      // Keep the logical boundary when a configured root is temporarily unavailable.
    }
  }
  return [...resolvedRoots];
}

function writeChangeSetFileAtomic(path: string, content: Buffer, mode: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.${newID()}.joi-revert.tmp`);
  try {
    writeFileSync(tempPath, content);
    chmodSync(tempPath, mode & 0o777);
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function timestampForFilename(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

const sensitiveTextPatterns = [
  /\b(bearer)\s+[a-z0-9._~+/=-]{8,}/gi,
  /\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*['"]?[^'",\s;}{]+/gi,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{8,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g,
];

function redactSensitiveText(value: string): string {
  let text = value;
  for (const pattern of sensitiveTextPatterns) {
    text = text.replace(pattern, (match) => {
      const lower = match.toLowerCase();
      if (lower.startsWith('bearer ')) return 'Bearer [REDACTED]';
      const equals = match.indexOf('=');
      if (equals >= 0) return `${match.slice(0, equals + 1)}[REDACTED]`;
      const colon = match.indexOf(':');
      if (colon >= 0) return `${match.slice(0, colon + 1)}[REDACTED]`;
      return '[REDACTED]';
    });
  }
  return text;
}

function sanitizeDiagnosticValue(value: unknown, redactLocalPaths = true): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnosticValue(item, redactLocalPaths));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    const redactNamedValue = objectHasSensitiveNameHint(value as Record<string, unknown>);
    for (const [key, item] of Object.entries(value)) {
      result[key] = diagnosticSensitiveKey(key) || (key.toLowerCase() === 'value' && redactNamedValue)
        ? '[REDACTED]'
        : sanitizeDiagnosticValue(item, redactLocalPaths);
    }
    return result;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return sanitizeDiagnosticValue(JSON.parse(trimmed), redactLocalPaths);
      } catch {
        // Keep non-JSON strings on the normal redaction path.
      }
    }
    const secretRedacted = redactSensitiveText(value);
    const redacted = redactLocalPaths
      ? secretRedacted.replaceAll(homedir(), '$HOME').replace(/\/Users\/[^/\s]+/g, '/Users/[REDACTED]')
      : secretRedacted;
    return redacted.length > 600 ? `${redacted.slice(0, 600)}...[truncated]` : redacted;
  }
  return value;
}

function sanitizePersonaExportValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePersonaExportValue(item));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    const redactNamedValue = objectHasSensitiveNameHint(value as Record<string, unknown>);
    for (const [key, item] of Object.entries(value)) {
      result[key] = personaExportSensitiveKey(key) || (key.toLowerCase() === 'value' && redactNamedValue)
        ? '[REDACTED]'
        : sanitizePersonaExportValue(item);
    }
    return result;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return sanitizePersonaExportValue(JSON.parse(trimmed));
      } catch {
        // Keep non-JSON strings on the normal redaction path.
      }
    }
    return redactSensitiveText(value);
  }
  return value;
}

function personaExportSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return [
    'api_key',
    'apikey',
    'authorization',
    'bearer',
    'token',
    'secret',
    'password',
    'node_secret',
    'worker_token',
    'telegram_bot_token',
    'model_api_key',
    'cacheable_prefix',
    'dynamic_tail',
    'raw_response',
    'prompt',
    'keychain',
  ].some((marker) => normalized.includes(marker));
}

function diagnosticSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return [
    'api_key',
    'apikey',
    'authorization',
    'bearer',
    'token',
    'secret',
    'password',
    'node_secret',
    'worker_token',
    'telegram_bot_token',
    'model_api_key',
    'cacheable_prefix',
    'dynamic_tail',
    'raw_response',
    'content',
    'memory',
    'prompt',
  ].some((marker) => normalized.includes(marker));
}

function objectHasSensitiveNameHint(value: Record<string, unknown>): boolean {
  for (const key of ['name', 'key', 'secret_name', 'secretName', 'env', 'env_name', 'envName']) {
    const hint = value[key];
    if (typeof hint === 'string' && diagnosticSensitiveKey(hint)) return true;
  }
  return false;
}

function desktopModelRecordID(provider: string, baseURL: string, modelID: string): string {
  const hash = createHash('sha256')
    .update(`${provider.trim()}\n${baseURL.trim()}\n${modelID.trim()}`)
    .digest('hex')
    .slice(0, 16);
  return `desktop_model_${hash}`;
}

type ZipEntry = {
  name: string;
  data: Buffer;
};

function writeZip(path: string, entries: ZipEntry[]): void {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const filename = entry.name.replace(/^\/+/, '');
    const name = Buffer.from(filename, 'utf8');
    const data = entry.data;
    const crc = crc32(data);
    const { dosTime, dosDate } = dosDateTime(new Date());
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralStart = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  writeFileSync(path, Buffer.concat([...localParts, ...centralParts, eocd]));
}

function dosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let j = 0; j < 8; j += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c >>> 0;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    if ((flags & 0x08) !== 0) {
      throw new Error(`unsupported zip data descriptor entry: ${name}`);
    }
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) {
      throw new Error(`truncated zip entry: ${name}`);
    }
    const compressed = buffer.subarray(dataStart, dataEnd);
    if (!name.endsWith('/')) {
      if (method === 0) {
        entries.set(name, Buffer.from(compressed));
      } else if (method === 8) {
        const inflated = inflateRawSync(compressed);
        if (uncompressedSize > 0 && inflated.length !== uncompressedSize) {
          throw new Error(`zip size mismatch for ${name}`);
        }
        entries.set(name, inflated);
      } else {
        throw new Error(`unsupported zip compression method ${method} for ${name}`);
      }
    }
    offset = dataEnd;
  }
  return entries;
}
