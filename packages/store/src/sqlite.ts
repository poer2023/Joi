import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { arch, homedir, platform, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inflateRawSync } from 'node:zlib';
import type {
  AvailableModel,
  ArtifactDetail,
  ArtifactSummary,
  AutomationDefinition,
  AutomationDefinitionRequest,
  AutomationKind,
  AutomationRunRecord,
  AutomationTriggerNowRequest,
  AutomationTriggerRecord,
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
  ExternalHandoffAudit,
  InputMode,
  LogCleanupPreview,
  LogCleanupRequest,
  LogCleanupResult,
  LogEntry,
  LogFilter,
  MCPServerRecord,
  MCPWrapToolRequest,
  MemoryRecord,
  MemorySearchResult,
  ModelCall,
  ModelConfigRequest,
  ModelSettingsRequest,
  NodeRecord,
  OnboardingStatus,
  OpenLoop,
  PermissionProfile,
  ProactiveMessage,
  ProductTask,
  ProductTaskDetail,
  ProductTaskStep,
  RecoverableRunRecord,
  RunClosureReport,
  RunEvent,
  RunTrace,
  SettingsRecord,
  SkillRecord,
  SystemHealth,
  TaskContract,
  TaskVerification,
  ToolRunRecord,
  ToolWorkflowRecord,
  WorkerGatewayAuditRecord,
  WorkspaceSettings,
} from '../../shared-types/src/desktop-api';

type SQLiteValue = string | number | bigint | null;
type SQLiteRow = Record<string, unknown>;

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
};

export type AutomationRunFinishRequest = {
  automation_run_id: string;
  run_id?: string;
  product_task_id?: string;
  output_summary?: string;
};

export type AutomationRunFailRequest = {
  automation_run_id: string;
  run_id?: string;
  product_task_id?: string;
  error_code?: string;
  error_message: string;
  retry_at?: string;
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
  system_message: string;
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
  provider: string;
  model_name: string;
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
  onError?: (event: { step: number; error: Error }) => void;
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

  constructor(options: JoiSQLiteStoreOptions) {
    this.options = options;
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.db = new DatabaseSync(options.dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.ensurePreSchemaCompatibilityColumns();
    this.db.exec(options.schemaSql);
    this.ensureConversationClosureSchema();
    this.seedDefaults();
    this.classifyRecoverableRunsOnStartup();
    this.recoverInterruptedAutomationTriggersOnStartup();
  }

  close(): void {
    this.db.close();
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
  }

  recordAppLog(input: AppLogInput): LogEntry {
    const level = normalizeLogLevel(input.level || (input.error ? 'error' : 'info'));
    const riskLevel = normalizeLogRiskLevel(input.risk_level || 'read_only');
    const category = normalizeLogCategory(input.category || 'system');
    const featureKey = normalizeFeatureKey(input.feature_key || category);
    const payload = sanitizeLogPayload(input.payload || {});
    const errorPayload = sanitizeLogPayload(errorObject(input.error));
    const message = redactSensitiveText(input.message || featureKey);
    const id = input.id || `log_${newID()}`;
    this.exec(
      `INSERT INTO app_logs (
         id, level, risk_level, category, feature_key, source, message,
         run_id, turn_id, conversation_id, item_type, item_id, payload, error, duration_ms, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, COALESCE(?, datetime('now')))`,
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
      json(errorPayload),
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
    const triggerConfig = req.trigger_config ?? parseObject(existing?.trigger_config);
    const metadata = {
      ...parseObject(existing?.metadata),
      ...(req.metadata || {}),
    };
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
             input_mode=?, permission_profile=?, preferred_node=?, allow_worker=?, conversation_id=NULLIF(?, ''),
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
        req.conversation_id?.trim() || optionalString(existing.conversation_id) || '',
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
         permission_profile, preferred_node, allow_worker, conversation_id, principal_id, dedup_policy,
         retry_policy, max_concurrency, notification_policy, metadata, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?)`,
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
      req.conversation_id?.trim() || '',
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

  enqueueAutomationTrigger(req: AutomationTriggerEnqueueRequest): { trigger: AutomationTriggerRecord; deduped: boolean } {
    const automation = this.getAutomation(req.automation_id);
    if (!automation.enabled) throw codedError('AUTOMATION_DISABLED', 'Automation is disabled');
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
         WHERE a.enabled=1
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
        json({ claim_token: trigger.claim_token || '', trigger_type: trigger.trigger_type }),
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
               COALESCE(?, datetime('now')))`,
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

  createToolCallingEventCallbacks(started: StartedToolCallingChat, emit?: () => void): ToolCallingEventCallbacks {
    const append = (input: Omit<RunEventV2Input, 'run_id'> & { run_id?: string }) => {
      this.appendRunEventV2({
        ...input,
        conversation_id: input.conversation_id || started.conversation_id,
        run_id: input.run_id || started.run_id,
        turn_id: input.turn_id || started.turn_id,
      });
      emit?.();
    };
    return {
      onModelStarted: (event) => {
        append({
          event_type: 'model.started',
          item_type: 'model_call',
          item_id: started.model_call_id,
          status: 'running',
          source: 'model_provider',
          visibility: 'trace_only',
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
          visibility: 'trace_only',
          payload: { step: event.step, finish_reason: event.finish_reason, usage_status: event.usage_status },
        });
      },
      onAssistantDelta: (event) => {
        this.markModelCallFirstDelta(started.model_call_id);
        append({
          event_type: 'assistant.delta',
          item_type: 'assistant_message',
          item_id: started.assistant_message_id,
          status: 'running',
          source: 'model_provider',
          visibility: 'chat',
          delta: { text: event.text, index: event.index, stream_source: 'provider_stream' },
        });
      },
      onAssistantCompleted: (event) => {
        append({
          event_type: 'assistant.completed',
          item_type: 'assistant_message',
          item_id: started.assistant_message_id,
          status: 'completed',
          source: 'model_provider',
          visibility: 'chat',
          delta: { text: event.text },
          payload: { finish_reason: event.finish_reason, usage_status: event.usage_status },
        });
      },
      onToolCallRequested: (event) => {
        append({
          event_type: 'tool.call_requested',
          item_type: 'tool_run',
          item_id: event.call.id,
          status: 'requested',
          source: 'model_provider',
          visibility: 'tool',
          payload: { call_id: event.call.id, tool_name: event.call.name, input: event.call.arguments, step: event.step },
        });
      },
      onToolStarted: (event) => {
        append({
          event_type: 'tool.started',
          item_type: 'tool_run',
          item_id: event.call.id,
          status: 'running',
          source: 'tool',
          visibility: 'tool',
          payload: { call_id: event.call.id, tool_name: event.call.name, input: event.call.arguments, step: event.step },
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
        append({
          event_type: 'tool.completed',
          item_type: 'tool_run',
          item_id: event.call.id,
          status: 'completed',
          source: 'tool',
          visibility: 'tool',
          snapshot: event.result.output,
          payload: { call_id: event.call.id, tool_name: event.call.name, step: event.step },
        });
      },
      onToolFailed: (event) => {
        append({
          event_type: 'tool.failed',
          item_type: 'tool_run',
          item_id: event.call.id,
          status: 'failed',
          source: 'tool',
          visibility: 'tool',
          error: event.error || event.result?.output,
          snapshot: event.result?.output,
          payload: { call_id: event.call.id, tool_name: event.call.name, step: event.step },
        });
      },
      onApprovalRequired: (event) => {
        append({
          event_type: 'tool.approval_required',
          item_type: 'tool_run',
          item_id: event.call.id,
          status: 'waiting_confirmation',
          source: 'tool',
          visibility: 'approval',
          snapshot: event.result.output,
          payload: { call_id: event.call.id, tool_name: event.call.name, step: event.step },
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
      onError: (event) => {
        append({
          event_type: 'run.failed',
          item_type: 'run',
          item_id: started.run_id,
          status: 'failed',
          source: 'runtime',
          visibility: 'inline_status',
          terminal: true,
          error: event.error,
          payload: { step: event.step },
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
         VALUES (?, ?, 'user', ?, '[]', ?, datetime('now'))`,
        userMessageID,
        conversationID,
        message,
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
    const memoryResults = this.searchPromptMemories(req.message || '', 8);
    const memoryProfileVersion = memoryProfileVersionFor(memoryResults);
    const conversationContext = this.buildPromptConversationContext(req.conversation_id);
    const cacheablePrefix = [
      'Joi Electron Tool Calling Runtime',
      '- You are running inside the local Electron-native Joi Desktop app.',
      '- Your product identity is Joi. When asked who you are, say you are Joi, the local Joi Desktop assistant.',
      `- The selected model id for this run is ${cleanModelName}. When asked what model is being used, answer from this selected model id.`,
      '- Do not claim to be Claude, ChatGPT, Anthropic, OpenAI, or another assistant brand unless the selected model id explicitly says so.',
      '- Use only the provided capability tools. Do not claim that a tool ran unless a tool result is present.',
      '- Never request Docker/Postgres/NATS as a default prerequisite for this local desktop app.',
      '- For workspace writes, wait for confirmation before execution.',
      '',
      'Agent',
      `id: ${cleanAgentID}`,
      `name: ${optionalString(agent?.name) || cleanAgentID}`,
      `description: ${optionalString(agent?.description) || ''}`,
      `system_prompt: ${optionalString(agent?.system_prompt) || ''}`,
      `capabilities: ${optionalString(agent?.capabilities) || '[]'}`,
      '',
      'Stable Memory Profile',
      `version: ${memoryProfileVersion}`,
      `confirmed_memory_count: ${memoryResults.length}`,
      '',
      'Tool Schema Version',
      toolSchemaVersion,
    ].join('\n');
    const dynamicTail = [
      'Current Run',
      `channel: ${req.channel || 'desktop'}`,
      `input_mode: ${req.input_mode || 'auto'}`,
      `permission_profile: ${req.permission_profile || 'read_only'}`,
      ...(conversationContext.prompt ? [
        '',
        'Conversation Context',
        conversationContext.prompt,
      ] : []),
      '',
      'User Message',
      req.message || '',
      '',
      'Dynamic Memory Retrieval',
      JSON.stringify(memoryResults.map((result) => ({
        id: result.memory.id,
        type: result.memory.type,
        summary: result.memory.summary,
        content: result.memory.content,
        score: result.score,
        reason: result.reason,
      }))),
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
      system_message: `${cacheablePrefix}\n\n${dynamicTail}`,
    };
  }

  private buildPromptConversationContext(conversationID?: string): PromptConversationContext {
    const cleanConversationID = conversationID?.trim();
    if (!cleanConversationID) {
      return { prompt: '', included_count: 0, compressed_count: 0, omitted_count: 0 };
    }
    const totalRow = this.get(`SELECT COUNT(*) AS count FROM messages WHERE conversation_id=?`, cleanConversationID);
    const totalCount = Number(totalRow?.count ?? 0);
    if (!Number.isFinite(totalCount) || totalCount <= 0) {
      return { prompt: '', included_count: 0, compressed_count: 0, omitted_count: 0 };
    }
    const rows = this.all(
      `SELECT role, content, COALESCE(json_extract(metadata, '$.run_id'), '') AS run_id
       FROM (
         SELECT role, content, metadata, created_at, rowid
         FROM messages
         WHERE conversation_id=?
         ORDER BY datetime(created_at) DESC, rowid DESC
         LIMIT ?
       )
       ORDER BY datetime(created_at) ASC, rowid ASC`,
      cleanConversationID,
      promptConversationContextLimit,
    );
    const messages: PromptConversationMessage[] = rows.map((row) => ({
      role: optionalString(row.role) || 'message',
      content: optionalString(row.content) || '',
      run_id: optionalString(row.run_id),
    })).filter((message) => message.content.trim());
    if (messages.length === 0) {
      return { prompt: '', included_count: 0, compressed_count: 0, omitted_count: Math.max(0, totalCount) };
    }
    const omittedCount = Math.max(0, totalCount - messages.length);
    const compressedCount = Math.max(0, messages.length - promptConversationVerbatimLimit);
    const compressedMessages = messages.slice(0, compressedCount);
    const recentMessages = messages.slice(compressedCount);
    const sections: string[] = [];

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
      compressed_count: omittedCount + compressedMessages.length,
      omitted_count: omittedCount,
    };
  }

  beginToolCallingChat(req: ChatRequest, params: {
    provider: string;
    model_name: string;
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
    const agentID = params.selected_agent_id?.trim() || agentIDForMessage(message);
    const provider = params.provider.trim() || 'openai_compatible';
    const modelName = req.model_name?.trim() || params.model_name.trim() || 'model';
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
         VALUES (?, ?, 'user', ?, '[]', ?, datetime('now'))`,
        userMessageID,
        conversationID,
        message,
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
        json({ route: 'electron_ts_tool_calling', agent_id: agentID, model: modelName, provider }),
        req.parent_run_id || '',
        req.redirected_from_run_id || '',
        json({ runtime_mode: 'tool_calling', input_mode: req.input_mode || 'auto', mode_resolution: modeResolution, source: 'electron_ts_tool_calling', live_cancellable: true }),
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
         VALUES (?, ?, ?, ?, '[]', '[]', '[]', '[]', '[]', '[]', ?, ?)`,
        memoryPackID,
        runID,
        agentID,
        prompt.memory_profile_version,
        json(prompt.memory_results || []),
        json({ source: 'electron_ts_tool_calling', memory_result_count: prompt.memory_results?.length || 0 }),
      );
      this.appendMemoryRecalledEvents(runID, turnID, memoryPackID, prompt.memory_results || []);
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
        json({ source: 'electron_ts_tool_calling', memory_result_count: prompt.memory_results?.length || 0 }),
      );
      this.insertRunStep(runID, 'input_received', 'Input received', { message }, { conversation_id: conversationID, message_id: userMessageID });
      this.insertRunStep(runID, 'router_selected', 'Router selected agent', { message }, { agent_id: agentID, route: 'electron_ts_tool_calling' });
      this.insertRunStep(runID, 'prompt_assembled', 'Prompt assembly finished', { run_id: runID, agent_id: agentID }, { prompt_assembly_id: promptAssemblyID, prefix_hash: prompt.prefix_hash, dynamic_tail_hash: prompt.dynamic_tail_hash, prompt_cache_key: prompt.prompt_cache_key, memory_profile_version: prompt.memory_profile_version, tool_schema_version: prompt.tool_schema_version, memory_result_count: prompt.memory_results?.length || 0 });
      this.insertTurnItem(runID, turnID, 1, 'message', 'user', '', '', {}, message, {}, 'completed', { source: 'desktop_user' });
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
        json({ source: 'electron_ts_tool_calling', real_model: provider !== 'mock_provider', live_cancellable: true }),
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
      provider,
      model_name: modelName,
      prompt_assembly: prompt,
      product_task_id: productTask?.id,
      product_task: productTask,
    };
  }

  finishToolCallingChat(started: StartedToolCallingChat, turn: PersistedToolCallingTurn): ChatResponse {
    const response = turn.final_message.trim() || '模型没有返回可展示内容。';
    const toolResults = turn.tool_results || [];
    const usage = turn.usage || {};
    const normalizedUsage = canonicalModelUsage(usage);
    const usageStatus = turn.usage_status || usageStatusForUsage(normalizedUsage);
    const costEstimate = this.estimateModelUsageCost(started.provider, started.model_name, normalizedUsage);
    const waitingConfirmation = turn.status === 'waiting_confirmation' || toolResults.some(isWaitingConfirmationToolResult);
    let artifacts: ArtifactSummary[] = [];
    let productTask: ProductTask | undefined = started.product_task;

    this.transaction(() => {
      this.exec(
        `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
         VALUES (?, ?, 'assistant', ?, '[]', ?, datetime('now'))`,
        started.assistant_message_id,
        started.conversation_id,
        response,
        json({ run_id: started.run_id, source: 'electron_ts_tool_calling' }),
      );
      let itemSeq = this.nextTurnItemSeq(started.run_id);
      const hasRunEvent = (eventType: string, itemID?: string): boolean => Boolean(itemID
        ? this.get(`SELECT id FROM run_events WHERE run_id=? AND event_type=? AND item_id=? LIMIT 1`, started.run_id, eventType, itemID)
        : this.get(`SELECT id FROM run_events WHERE run_id=? AND event_type=? LIMIT 1`, started.run_id, eventType));
      for (const result of toolResults) {
        const capability = canonicalCapabilityName(result.name);
        const workflowName = workflowNameForGateway(capability);
        const args = result.arguments || {};
        const risk = workflowRiskLevel(capability);
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
            approval_scope: 'once',
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
             VALUES (?, ?, ?, ?, ?, 'pending', ?, NULLIF(?, ''), ?, 'once', ?)`,
            confirmationID,
            started.run_id,
            capability,
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
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'main-node', 'model_tool_call', ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), datetime('now'), datetime('now'), 0)`,
          toolRunID,
          started.run_id,
          started.turn_id,
          result.call_id,
          capability,
          workflowName,
          result.name,
          requestedAction,
          risk,
          sideEffectLevelForCapability(capability),
          operationID,
          toolStatus,
          json(args),
          json(result.output),
          toolSummary,
          toolStatus === 'failed' || toolStatus === 'policy_blocked' ? toolStatus : '',
          optionalString(result.output?.error) || '',
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
      }
      artifacts = this.finalizeProductTaskAfterRun(started.product_task_id, {
        run_id: started.run_id,
        conversation_id: started.conversation_id,
        message_id: started.assistant_message_id,
        response,
        waiting_confirmation: waitingConfirmation,
        tool_results: toolResults,
      });
      if (started.product_task_id) {
        productTask = this.getProductTask(started.product_task_id).task;
      }
      const persistedToolRunCount = this.persistedToolRunCountForRun(started.run_id);
      this.insertRunStep(started.run_id, 'model_call_finished', 'Model call finished', { agent_id: started.selected_agent_id, model_id: started.model_name, prompt_assembly_id: started.prompt_assembly_id }, { provider: started.provider, model: started.model_name, real_model: started.provider !== 'mock_provider', fallback_to_mock: false, ...normalizedUsage, estimated_cost: roundCost(costEstimate), tool_run_count: persistedToolRunCount });
      this.insertRunStep(started.run_id, 'agent_output_parsed', 'Agent output parsed', { turn: 1 }, { repaired: false, output_type: 'final_answer' });
      this.insertRunStep(started.run_id, 'response_generated', waitingConfirmation ? 'Confirmation response generated' : 'Response generated', {}, { response }, waitingConfirmation ? 'waiting_confirmation' : 'succeeded');
      this.insertTurnItem(started.run_id, started.turn_id, itemSeq++, 'message', 'assistant', '', '', {}, response, {}, waitingConfirmation ? 'waiting_confirmation' : 'completed', { final_answer: !waitingConfirmation, waiting_confirmation: waitingConfirmation });
      this.exec(
        `UPDATE model_calls
         SET input_tokens=?, output_tokens=?, cached_input_tokens=?, cache_write_input_tokens=?, reasoning_tokens=?, total_tokens=?,
             cost_estimate=?, latency_ms=0, status='succeeded', completed_at=datetime('now'), finish_reason=?,
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
        if (!hasRunEvent('assistant.completed', started.assistant_message_id)) {
          this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'assistant.completed', { run_id: started.run_id, turn_id: started.turn_id, item_type: 'assistant_message', item_id: started.assistant_message_id, delta: { text: response }, status: 'waiting_confirmation', visibility: 'chat', source: 'store', type: 'assistant.completed' });
        }
        this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'message.delta', { run_id: started.run_id, turn_id: started.turn_id, delta: response, status: 'waiting_confirmation', visibility: 'trace_only', source: 'store', type: 'message.delta' });
        this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'run.waiting_confirmation', { run_id: started.run_id, turn_id: started.turn_id, status: 'waiting_confirmation', message: response, type: 'run.waiting_confirmation' });
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
    const response = turn.final_message.trim() || '模型没有返回可展示内容。';
    const title = titleFromMessage(message);
    const agentID = turn.selected_agent_id?.trim() || agentIDForMessage(message);
    const provider = turn.provider.trim() || 'openai_compatible';
    const modelName = req.model_name?.trim() || turn.model_name.trim() || 'model';
    const prompt = turn.prompt_assembly || this.assembleToolCallingPrompt(req, agentID, modelName);
    const prefix = prompt.cacheable_prefix;
    const dynamicTail = prompt.dynamic_tail;
    const prefixHash = prompt.prefix_hash;
    const dynamicTailHash = prompt.dynamic_tail_hash;
    const promptCacheKey = prompt.prompt_cache_key;
    const toolResults = turn.tool_results || [];
    const usage = turn.usage || {};
    const normalizedUsage = canonicalModelUsage(usage);
    const usageStatus = turn.usage_status || usageStatusForUsage(normalizedUsage);
    const costEstimate = this.estimateModelUsageCost(provider, modelName, normalizedUsage);
    const waitingResult = toolResults.find(isWaitingConfirmationToolResult);
    const waitingConfirmation = turn.status === 'waiting_confirmation' || Boolean(waitingResult);
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
         VALUES (?, ?, 'user', ?, '[]', ?, datetime('now'))`,
        userMessageID,
        conversationID,
        message,
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
        json({ route: 'electron_ts_tool_calling', agent_id: agentID, model: modelName, provider }),
        req.parent_run_id || '',
        req.redirected_from_run_id || '',
        waitingConfirmation ? 1 : 0,
        waitingConfirmation ? 1 : 0,
        json({ runtime_mode: 'tool_calling', input_mode: req.input_mode || 'auto', mode_resolution: modeResolution, source: 'electron_ts_tool_calling' }),
      );

      this.exec(
        `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
         VALUES (?, ?, 'assistant', ?, '[]', ?, datetime('now'))`,
        assistantMessageID,
        conversationID,
        response,
        json({ run_id: runID, source: 'electron_ts_tool_calling' }),
      );

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
         VALUES (?, ?, ?, ?, '[]', '[]', '[]', '[]', '[]', '[]', ?, ?)`,
        memoryPackID,
        runID,
        agentID,
        prompt.memory_profile_version,
        json(prompt.memory_results || []),
        json({ source: 'electron_ts_tool_calling', memory_result_count: prompt.memory_results?.length || 0 }),
      );
      this.appendMemoryRecalledEvents(runID, turnID, memoryPackID, prompt.memory_results || []);

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
        json({ source: 'electron_ts_tool_calling', memory_result_count: prompt.memory_results?.length || 0 }),
      );

      const steps: Array<[string, string, Record<string, unknown>, Record<string, unknown>]> = [
        ['input_received', 'Input received', { message }, { conversation_id: conversationID, message_id: userMessageID }],
        ['router_selected', 'Router selected agent', { message }, { agent_id: agentID, route: 'electron_ts_tool_calling' }],
        ['prompt_assembled', 'Prompt assembly finished', { run_id: runID, agent_id: agentID }, { prompt_assembly_id: promptAssemblyID, prefix_hash: prefixHash, dynamic_tail_hash: dynamicTailHash, prompt_cache_key: promptCacheKey, memory_profile_version: prompt.memory_profile_version, tool_schema_version: prompt.tool_schema_version, memory_result_count: prompt.memory_results?.length || 0 }],
      ];
      for (const [stepType, stepTitle, input, output] of steps) {
        this.insertRunStep(runID, stepType, stepTitle, input, output);
      }

      let itemSeq = 1;
      this.insertTurnItem(runID, turnID, itemSeq++, 'message', 'user', '', '', {}, message, {}, 'completed', { source: 'desktop_user' });

      for (const result of toolResults) {
        const capability = canonicalCapabilityName(result.name);
        const workflowName = workflowNameForGateway(capability);
        const args = result.arguments || {};
        const risk = workflowRiskLevel(capability);
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
            approval_scope: 'once',
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
             VALUES (?, ?, ?, ?, ?, 'pending', ?, NULLIF(?, ''), ?, 'once', ?)`,
            confirmationID,
            runID,
            capability,
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
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'main-node', 'model_tool_call', ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), datetime('now'), datetime('now'), 0)`,
          toolRunID,
          runID,
          turnID,
          result.call_id,
          capability,
          workflowName,
          result.name,
          requestedAction,
          risk,
          sideEffectLevelForCapability(capability),
          operationID,
          toolStatus,
          json(args),
          json(result.output),
          toolSummary,
          toolStatus === 'failed' || toolStatus === 'policy_blocked' ? toolStatus : '',
          optionalString(result.output?.error) || '',
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
      });
      if (productTask?.id) {
        productTask = this.getProductTask(productTask.id).task;
      }

      const persistedToolRunCount = this.persistedToolRunCountForRun(runID);
      this.insertRunStep(runID, 'model_call_finished', 'Model call finished', { agent_id: agentID, model_id: modelName, prompt_assembly_id: promptAssemblyID }, { provider, model: modelName, real_model: provider !== 'mock_provider', fallback_to_mock: false, ...normalizedUsage, estimated_cost: roundCost(costEstimate), tool_run_count: persistedToolRunCount });
      this.insertRunStep(runID, 'agent_output_parsed', 'Agent output parsed', { turn: 1 }, { repaired: false, output_type: 'final_answer' });
      this.insertRunStep(runID, 'response_generated', waitingConfirmation ? 'Confirmation response generated' : 'Response generated', {}, { response }, waitingConfirmation ? 'waiting_confirmation' : 'succeeded');
      this.insertTurnItem(runID, turnID, itemSeq++, 'message', 'assistant', '', '', {}, response, {}, waitingConfirmation ? 'waiting_confirmation' : 'completed', { final_answer: !waitingConfirmation, waiting_confirmation: waitingConfirmation });

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
        json({ source: 'electron_ts_tool_calling', real_model: provider !== 'mock_provider', fallback_to_mock: false, tool_run_count: persistedToolRunCount, usage_status: usageStatus, estimated_cost: roundCost(costEstimate) }),
      );

      if (waitingConfirmation) {
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'assistant.completed', { run_id: runID, turn_id: turnID, item_type: 'assistant_message', item_id: assistantMessageID, delta: { text: response }, status: 'waiting_confirmation', visibility: 'chat', source: 'store', type: 'assistant.completed' });
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'message.delta', { run_id: runID, turn_id: turnID, delta: response, status: 'waiting_confirmation', visibility: 'trace_only', source: 'store', type: 'message.delta' });
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'run.waiting_confirmation', { run_id: runID, turn_id: turnID, status: 'waiting_confirmation', message: response, type: 'run.waiting_confirmation' });
      } else {
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'assistant.delta', { run_id: runID, turn_id: turnID, item_type: 'assistant_message', item_id: assistantMessageID, delta: { text: response, stream_source: 'fallback_final_chunk' }, status: 'completed', visibility: 'chat', source: 'store', type: 'assistant.delta' });
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'assistant.completed', { run_id: runID, turn_id: turnID, item_type: 'assistant_message', item_id: assistantMessageID, delta: { text: response }, status: 'completed', visibility: 'chat', source: 'store', terminal: true, type: 'assistant.completed' });
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'usage.recorded', { run_id: runID, turn_id: turnID, item_type: 'model', item_id: modelCallID, status: usageStatus, visibility: 'trace_only', source: 'store', usage: normalizedUsage, usage_status: usageStatus, estimated_cost: roundCost(costEstimate), type: 'usage.recorded' });
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'message.delta', { run_id: runID, turn_id: turnID, delta: response, status: 'completed', visibility: 'trace_only', source: 'store', type: 'message.delta' });
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'turn.completed', { run_id: runID, turn_id: turnID, status: 'completed', type: 'turn.completed' });
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'run.completed', { run_id: runID, status: 'succeeded', terminal: true, type: 'run.completed' });
      }
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
      model_base_url: settings['model.base_url'] || '',
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
    return {
      capabilities: rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        description: optionalString(row.description) || '',
        risk_level: optionalString(row.risk_level) || 'read_only',
        enabled: Boolean(Number(row.enabled ?? 0)),
        metadata: parseObject(row.metadata),
      })),
    };
  }

  listMCPServers(): { servers: MCPServerRecord[] } {
    const servers = this.all(
      `SELECT id, name, transport, command, args, enabled, status, trust, last_sync_at, last_sync_error, metadata
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

  syncMCPServer(serverID: string): { server: MCPServerRecord } {
    const id = serverID.trim();
    if (!id) throw new Error('server id is required');
    let server = this.listMCPServers().servers.find((item) => item.id === id);
    if (!server) {
      this.exec(
        `INSERT INTO mcp_servers (id, name, transport, enabled, status, trust, last_sync_error, metadata)
         VALUES (?, ?, 'stdio', 0, 'inactive', 'untrusted_until_wrapped', '', ?)`,
        id,
        id,
        json({ source: 'electron_sqlite_store', sync_placeholder: true }),
      );
      server = this.listMCPServers().servers.find((item) => item.id === id);
    }
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
      })),
    };
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

  listMemories(filter: { query?: string; limit?: number } = {}): { memories: MemoryRecord[] } {
    const limit = clampLimit(filter.limit, 100);
    const query = filter.query?.trim();
    if (query) {
      const like = `%${escapeLike(query)}%`;
      const rows = this.all(
        `SELECT id, type, content, COALESCE(summary, '') AS summary, scope_type, COALESCE(scope_id, '') AS scope_id,
                privacy_level, confidence, status, source_event_ids, entities, success_count, failure_count,
                usage_count, positive_feedback, negative_feedback, pinned, disabled_at,
                COALESCE(merged_into_memory_id, '') AS merged_into_memory_id,
                COALESCE(conflict_group_id, '') AS conflict_group_id,
                COALESCE(conflict_reason, '') AS conflict_reason,
                metadata, created_at, updated_at, last_used_at
         FROM memories
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
      return { memories: rows.map(rowToMemory) };
    }
    const rows = this.all(
      `SELECT id, type, content, COALESCE(summary, '') AS summary, scope_type, COALESCE(scope_id, '') AS scope_id,
              privacy_level, confidence, status, source_event_ids, entities, success_count, failure_count,
              usage_count, positive_feedback, negative_feedback, pinned, disabled_at,
              COALESCE(merged_into_memory_id, '') AS merged_into_memory_id,
              COALESCE(conflict_group_id, '') AS conflict_group_id,
              COALESCE(conflict_reason, '') AS conflict_reason,
              metadata, created_at, updated_at, last_used_at
       FROM memories
       WHERE status <> 'deleted'
       ORDER BY pinned DESC, datetime(updated_at) DESC
       LIMIT ?`,
      limit,
    );
    return { memories: rows.map(rowToMemory) };
  }

  listMemoriesUsedForRun(runID: string): { memories: MemorySearchResult[] } {
    const id = runID.trim();
    if (!id) throw new Error('run_id is required');
    const rows = this.all(
      `SELECT m.id, m.type, m.content, COALESCE(m.summary, '') AS summary, m.scope_type, COALESCE(m.scope_id, '') AS scope_id,
              m.privacy_level, m.confidence, m.status, m.source_event_ids, m.entities, m.success_count, m.failure_count,
              m.usage_count, m.positive_feedback, m.negative_feedback, m.pinned, m.disabled_at,
              COALESCE(m.merged_into_memory_id, '') AS merged_into_memory_id,
              COALESCE(m.conflict_group_id, '') AS conflict_group_id,
              COALESCE(m.conflict_reason, '') AS conflict_reason,
              m.metadata, m.created_at, m.updated_at, m.last_used_at,
              re.payload_json AS event_payload
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
      where.push(`status IN ('pending', 'candidate', 'conflicted')`);
    }
    const rows = this.all(
      `SELECT id, type, content, COALESCE(summary, '') AS summary, scope_type, COALESCE(scope_id, '') AS scope_id,
              privacy_level, confidence, status, source_event_ids, entities, success_count, failure_count,
              usage_count, positive_feedback, negative_feedback, pinned, disabled_at,
              COALESCE(merged_into_memory_id, '') AS merged_into_memory_id,
              COALESCE(conflict_group_id, '') AS conflict_group_id,
              COALESCE(conflict_reason, '') AS conflict_reason,
              metadata, created_at, updated_at, last_used_at
       FROM memories
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
          this.exec(
            `UPDATE memories
             SET status='confirmed', disabled_at=NULL,
                 metadata=json_set(COALESCE(metadata, '{}'), '$.confirmed_by', 'desktop_ui', '$.confirmed_at', datetime('now')),
                 updated_at=datetime('now')
             WHERE id=?`,
            id,
          );
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
            `SELECT type, scope_type, scope_id, privacy_level, confidence, source_event_ids, entities, metadata
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
          this.exec(
            `INSERT INTO memories (id, type, content, summary, scope_type, scope_id, privacy_level, confidence,
                                  status, source_event_ids, entities, metadata)
             VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, 'confirmed', ?, ?, ?)`,
            replacementID,
            optionalString(existing.type) || 'preference',
            content,
            summary,
            optionalString(existing.scope_type) || 'global',
            optionalString(existing.scope_id) || '',
            optionalString(existing.privacy_level) || 'internal',
            optionalNumber(existing.confidence) || 0.7,
            json([...new Set(sourceEventIDs)]),
            json(parseArray(existing.entities)),
            json(metadata),
          );
          this.exec(
            `UPDATE memories
             SET status='superseded', merged_into_memory_id=?, disabled_at=datetime('now'),
                 metadata=json_set(COALESCE(metadata, '{}'), '$.edited_by', 'desktop_ui', '$.edited_at', datetime('now'), '$.superseded_by', ?),
                 updated_at=datetime('now')
             WHERE id=?`,
            replacementID,
            replacementID,
            id,
          );
          this.insertMemoryFeedback(id, req.run_id, 'edit', req.comment || req.reason || '', replacementID);
        });
        return;
      }
      case 'reject':
        this.transaction(() => {
          this.exec(
            `UPDATE memories
             SET status='rejected', disabled_at=datetime('now'),
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
             SET status='deleted', disabled_at=datetime('now'),
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
        this.exec(`UPDATE memories SET disabled_at=datetime('now'), updated_at=datetime('now') WHERE id=?`, id);
        return;
      case 'enable':
        this.exec(`UPDATE memories SET disabled_at=NULL, updated_at=datetime('now') WHERE id=?`, id);
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
          `UPDATE memories SET status='conflicted', conflict_group_id=?, conflict_reason=?, updated_at=datetime('now') WHERE id=?`,
          req.target_id || id,
          req.reason || '',
          id,
        );
        return;
      case 'merge_into':
        if (!req.target_id) throw new Error('merge_into requires target_id');
        this.exec(`UPDATE memories SET merged_into_memory_id=?, updated_at=datetime('now') WHERE id=?`, req.target_id, id);
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
    const rows = this.all(
      `SELECT COALESCE(provider, '') AS provider,
              COALESCE(model_name, '') AS model,
              COALESCE(agent_id, '') AS agent,
              COUNT(*) AS calls,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
              COALESCE(SUM(cache_write_input_tokens), 0) AS cache_write_input_tokens,
              COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
              COALESCE(SUM(CASE WHEN total_tokens > 0 THEN total_tokens ELSE COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) END), 0) AS total_tokens,
              COALESCE(AVG(latency_ms), 0) AS avg_latency_ms,
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
        cache_hit_ratio: usage.input_tokens > 0 ? usage.cached_input_tokens / usage.input_tokens : 0,
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
              COALESCE(turn_id, '') AS turn_id, COALESCE(approval_scope, 'once') AS approval_scope,
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
              COALESCE(turn_id, '') AS turn_id, COALESCE(approval_scope, 'once') AS approval_scope,
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

  decideConfirmation(req: { id?: string; approve?: boolean; actor?: string; reason?: string }): void {
    this.decideApproval({
      approval_request_id: req.id,
      decision: req.approve ? 'approved' : 'rejected',
      decided_by: req.actor || 'desktop_ui',
      reason: req.reason,
    });
  }

  decideApproval(req: {
    run_id?: string;
    approval_request_id?: string;
    decision?: string;
    decided_by?: string;
    decided_at?: string;
    reason?: string;
    edited_parameters?: Record<string, unknown>;
  }): { confirmation?: ConfirmationRecord } {
    const id = req.approval_request_id?.trim();
    if (!id) throw new Error('approval_request_id is required');
    const status = normalizeApprovalDecisionStatus(req.decision);
    const decidedBy = req.decided_by?.trim() || 'desktop_ui';
    const decidedAt = req.decided_at?.trim() || '';
    const existing = this.get(
      `SELECT id, COALESCE(run_id, '') AS run_id, COALESCE(turn_id, '') AS turn_id,
              COALESCE(call_id, '') AS call_id, COALESCE(capability_id, '') AS capability_id,
              status, input
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
    const editedParameters = sanitizeApprovalEditedParameters(req.edited_parameters);
    const input = editedParameters ? { ...parseObject(existing.input), ...editedParameters } : parseObject(existing.input);
    this.transaction(() => {
      if (status === 'approved') {
        this.exec(
          `UPDATE confirmation_requests
           SET status='approved', approved_by=?, rejected_by='', decision_reason=?, input=?, decided_at=COALESCE(NULLIF(?, ''), datetime('now'))
           WHERE id=? AND status='pending'`,
          decidedBy,
          req.reason || '',
          json(input),
          decidedAt,
          id,
        );
      } else {
        this.exec(
          `UPDATE confirmation_requests
           SET status='rejected', rejected_by=?, approved_by='', decision_reason=?, input=?, decided_at=COALESCE(NULLIF(?, ''), datetime('now'))
           WHERE id=? AND status='pending'`,
          decidedBy,
          req.reason || '',
          json(input),
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
            this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'tool.failed', {
              item_type: 'tool_run',
              item_id: callID,
              call_id: callID,
              tool_name: capabilityID,
              status: 'failed',
              summary: req.reason || 'Confirmation rejected',
              output: { status: 'failed', reason: req.reason || 'Confirmation rejected' },
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
              COALESCE(models.model_name, r.selected_model_id, '') AS model_name,
              COALESCE(models.provider, 'openai_compatible') AS provider
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
    const response = modelError ? `${baseResponse}\n\n最终模型回复失败：${modelError}` : baseResponse;
    const toolResult = resume.tool_result;
    const capability = canonicalCapabilityName(request.capability_id || toolResult.name);
    const workflowName = workflowNameForGateway(capability);
    const toolRunID = `toolrun_${newID()}`;
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
    const operationID = optionalString(request.input.operation_id) || operationIDForTool(productTaskID, capability, request.input, request.call_id);
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
                 datetime('now'), datetime('now'), 0)`,
        toolRunID,
        request.run_id,
        request.turn_id,
        request.call_id,
        capability,
        workflowName,
        capability,
        request.requested_action || `Execute ${capability}`,
        request.confirmation_id,
        workflowRiskLevel(capability),
        sideEffectLevelForCapability(capability),
        operationID,
        toolStatus,
        json(request.input),
        json(toolResult.output),
        toolSummary,
        toolStatus === 'failed' || toolStatus === 'policy_blocked' ? toolStatus : '',
        optionalString(toolResult.output?.error) || '',
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
      this.recordProductTaskToolCheckpoint(productTaskID, {
        run_id: request.run_id,
        capability,
        requested_action: request.requested_action || `Execute ${capability}`,
        input: request.input,
        output: { ...toolResult.output, resumed: true },
        status: toolStatus === 'failed' || toolStatus === 'policy_blocked' ? 'failed' : 'done',
        tool_run_id: toolRunID,
        operation_id: operationID,
      });
      const persistedToolRunCount = this.persistedToolRunCountForRun(request.run_id);
      if (modelError) {
        this.insertRunStep(request.run_id, 'model_call_failed', 'Model call failed after approval resume', { agent_id: request.agent_id, model_id: resumeModelName, prompt_assembly_id: optionalString(promptAssembly?.id) || '' }, { model_call_id: modelCallID, provider: resumeProvider, model: resumeModelName, resumed: true, error: modelError, ...normalizedUsage, estimated_cost: roundCost(costEstimate), tool_run_ids: [toolRunID], tool_run_count: persistedToolRunCount }, 'failed');
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
	          json({ source: 'electron_ts_tool_calling_resume', resumed_from_confirmation_id: request.confirmation_id, tool_run_id: toolRunID, tool_run_count: persistedToolRunCount, error: modelError, estimated_cost: roundCost(costEstimate) }),
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
	        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'tool.output_delta', { item_type: 'tool_run', item_id: request.call_id, tool_run_id: toolRunID, call_id: request.call_id, tool_name: capability, status: toolStatus, output: toolResult.output, visibility: 'tool', source: 'tool', resumed: true });
	        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), toolStatus === 'failed' ? 'tool.failed' : toolStatus === 'policy_blocked' ? 'tool.policy_blocked' : 'tool.completed', { item_type: 'tool_run', item_id: request.call_id, tool_run_id: toolRunID, call_id: request.call_id, tool_name: capability, status: toolStatus, summary: toolSummary, output: toolResult.output, visibility: 'tool', source: 'tool', resumed: true });
	        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'tool.finished', { call_id: request.call_id, tool_name: capability, status: 'completed', output: toolResult.output, visibility: 'trace_only', resumed: true });
	        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'assistant.completed', { run_id: request.run_id, turn_id: request.turn_id, item_type: 'assistant_message', item_id: assistantMessageID, delta: { text: response }, status: 'failed', visibility: 'chat', source: 'store', resumed: true, error: modelError });
	        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'message.delta', { run_id: request.run_id, turn_id: request.turn_id, delta: response, status: 'failed', visibility: 'trace_only', resumed: true, error: modelError });
	        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'run.failed', { run_id: request.run_id, turn_id: request.turn_id, status: 'failed', terminal: true, error: 'approval_resume_model_failed', message: modelError, resumed: true });
        if (productTaskID) {
          productTask = this.getProductTask(productTaskID).task;
        }
        return;
      }
      this.insertRunStep(request.run_id, 'model_call_finished', 'Model call finished', { agent_id: request.agent_id, model_id: resumeModelName, prompt_assembly_id: optionalString(promptAssembly?.id) || '' }, { model_call_id: modelCallID, provider: resumeProvider, model: resumeModelName, real_model: resumeProvider !== 'mock_provider', resumed: true, ...normalizedUsage, estimated_cost: roundCost(costEstimate), tool_run_ids: [toolRunID], tool_run_count: persistedToolRunCount });
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
	        json({ source: 'electron_ts_tool_calling_resume', resumed_from_confirmation_id: request.confirmation_id, tool_run_id: toolRunID, tool_run_count: persistedToolRunCount, usage_status: usageStatus, estimated_cost: roundCost(costEstimate) }),
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
	      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'tool.output_delta', { item_type: 'tool_run', item_id: request.call_id, tool_run_id: toolRunID, call_id: request.call_id, tool_name: capability, status: toolStatus, output: toolResult.output, visibility: 'tool', source: 'tool', resumed: true });
	      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), toolStatus === 'failed' ? 'tool.failed' : toolStatus === 'policy_blocked' ? 'tool.policy_blocked' : 'tool.completed', { item_type: 'tool_run', item_id: request.call_id, tool_run_id: toolRunID, call_id: request.call_id, tool_name: capability, status: toolStatus, summary: toolSummary, output: toolResult.output, visibility: 'tool', source: 'tool', resumed: true });
	      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'tool.finished', { call_id: request.call_id, tool_name: capability, status: 'completed', output: toolResult.output, visibility: 'trace_only', resumed: true });
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
        tool_results: [toolResult],
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

  listRecoverableRuns(req: { limit?: number } = {}): { runs: RecoverableRunRecord[] } {
    const limit = clampLimit(Number(req.limit || 50), 50);
    const rows = this.all(
      `SELECT r.id, r.conversation_id, r.status
       FROM runs r
       WHERE r.status IN ('queued', 'running', 'cancelling', 'resuming', 'waiting_confirmation', 'needs_recovery')
          OR EXISTS (
            SELECT 1 FROM run_events e
            WHERE e.run_id=r.id AND e.event_type='run.recovery_required'
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
        return {
          run_id: String(row.id),
          conversation_id: optionalString(row.conversation_id),
          status: String(row.status || trace.status),
          recovery_status: optionalString(payload.recovery_status) || (String(row.status) === 'waiting_confirmation' ? 'needs_user_decision' : 'runtime_lost'),
          reason: optionalString(payload.reason) || trace.terminal_reason || 'non-terminal run requires review',
          latest_event: latestRecovery,
          trace,
        };
      }),
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

  private recordNotificationDeliveryForProactive(proactiveMessageID: string, row: SQLiteRow): void {
    const notificationID = `notif_${stableShortID(`${proactiveMessageID}:${nowIso()}`)}`;
    const conversationID = optionalString(row.source_conversation_id);
    const productTaskID = optionalString(row.source_product_task_id);
    const channel = optionalString(row.channel) || 'desktop';
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
      data: Buffer.from(JSON.stringify(sanitizeDiagnosticValue(payload), null, 2)),
    })));
    return { path };
  }

  getWorkspaceSettings(): WorkspaceSettings {
    const settings = this.desktopSettings();
    return normalizeWorkspaceSettings({
      allowed_roots: parseStringSetting(settings['workspace.allowed_roots'], [defaultWorkspaceRoot()]),
      default_root: settings['workspace.default_root'] || defaultWorkspaceRoot(),
      browser_allowed_hosts: parseStringSetting(settings['browser.allowed_hosts'], []),
      web_research_allow_private_hosts: settings['web_research.allow_private_hosts'] === 'true',
      file_analyze_max_bytes: Number(settings['file_analyze.max_bytes'] || 256 * 1024),
      workspace_search_max_results: Number(settings['workspace_search.max_results'] || 50),
    });
  }

  saveWorkspaceSettings(req: WorkspaceSettings): void {
    const settings = normalizeWorkspaceSettings(req);
    this.setDesktopSettings({
      'workspace.allowed_roots': json(settings.allowed_roots),
      'workspace.default_root': settings.default_root,
      'browser.allowed_hosts': json(settings.browser_allowed_hosts),
      'web_research.allow_private_hosts': boolString(settings.web_research_allow_private_hosts),
      'file_analyze.max_bytes': String(settings.file_analyze_max_bytes),
      'workspace_search.max_results': String(settings.workspace_search_max_results),
    });
  }

  saveModelConfig(req: ModelConfigRequest): void {
    const provider = req.provider?.trim() || 'openai_compatible';
    const baseURL = req.base_url?.trim() || 'https://api.deepseek.com/v1';
    const modelName = req.name?.trim() || 'deepseek-v4-flash';
    this.setDesktopSettings({
      'model.provider': provider,
      'model.base_url': baseURL,
      'model.name': modelName,
      'model.reasoning_name': req.reasoning_name?.trim() || '',
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
    this.exec(
      `INSERT INTO product_task_steps (id, product_task_id, title, description, status, sort_order, capability_id,
                                      run_id, tool_run_id, summary, input, output, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM product_task_steps WHERE product_task_id=?), 10),
               ?, ?, NULLIF(?, ''), ?, ?, ?, datetime('now'), CASE WHEN ? THEN datetime('now') ELSE NULL END)`,
      stepID,
      productTaskID,
      titleForTaskCapability(detail.capability),
      detail.requested_action,
      detail.status,
      productTaskID,
      detail.capability,
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
    const verification = verifyTaskCompletion(context.response, artifact, context.tool_results);
    const taskStatus = verification.status === 'passed' ? 'completed' : 'blocked';
    const progress = verification.status === 'passed' ? 100 : 85;
    const evidenceSummary = evidenceSummaryForTask(artifact, context.tool_results, verification);
    this.exec(
      `UPDATE product_task_steps
       SET status='done', summary='执行完成。', finished_at=COALESCE(finished_at, datetime('now')), updated_at=datetime('now')
       WHERE product_task_id=? AND status='running'`,
      productTaskID,
    );
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
        const reason = 'runtime state was lost after app restart';
        this.exec(
          `UPDATE runs
           SET status='failed', terminal_status='failed', terminal_reason=?,
               error_code='runtime_lost_on_restart', error_message=?,
               finished_at=COALESCE(finished_at, datetime('now')),
               duration_ms=COALESCE(duration_ms, CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER))
           WHERE id=?`,
          reason,
          reason,
          runID,
        );
        this.exec(
          `UPDATE turns
           SET status='failed', stream_status='failed',
               finished_at=COALESCE(finished_at, datetime('now')),
               completed_at=COALESCE(completed_at, datetime('now'))
           WHERE run_id=? AND status IN ('created', 'mode_resolved', 'prompting', 'running', 'streaming', 'tool_calling', 'waiting_tool')`,
          runID,
        );
        this.exec(
          `UPDATE model_calls
           SET status='failed', completed_at=COALESCE(completed_at, datetime('now')),
               finish_reason='runtime_lost_on_restart', usage_status=CASE WHEN usage_status='' THEN 'failed' ELSE usage_status END,
               error_code='runtime_lost_on_restart', error_message=?
           WHERE run_id=? AND status IN ('pending', 'running')`,
          reason,
          runID,
        );
        this.appendRunEventV2({
          id: `${runID}_evt_recovery_required`,
          run_id: runID,
          event_type: 'run.recovery_required',
          item_type: 'run',
          item_id: runID,
          status: 'failed',
          source: 'store',
          visibility: 'inline_status',
          payload: {
            recovery_status: 'runtime_lost',
            reason,
          },
        });
        this.appendRunEventV2({
          id: `${runID}_evt_recovery_failed`,
          run_id: runID,
          event_type: 'run.failed',
          item_type: 'run',
          item_id: runID,
          status: 'failed',
          source: 'store',
          visibility: 'inline_status',
          terminal: true,
          error: { code: 'runtime_lost_on_restart', message: reason },
          payload: {
            recovery_status: 'runtime_lost',
            reason,
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

  private seedDefaults(): void {
    this.exec(
      `INSERT INTO models (id, provider, model_name, display_name, supports_json_mode, supports_tool_calling, enabled, metadata)
       VALUES ('deterministic-local-model', 'deterministic_provider', 'deterministic-local-model', 'Deterministic Local Model', 1, 1, 1, ?)
       ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, model_name=excluded.model_name, display_name=excluded.display_name, supports_tool_calling=excluded.supports_tool_calling, enabled=excluded.enabled, updated_at=datetime('now')`,
      json({ desktop_default: true, electron_native: true }),
    );
    for (const agent of [
      ['general_agent', 'General Agent', 'General purpose desktop agent.', ['memory_search', 'workspace_search', 'file_read', 'file_analyze', 'apply_patch', 'shell_command', 'test_command', 'computer_observe', 'browser_observe', 'browser_navigate', 'browser_click', 'browser_type', 'desktop_app_list', 'desktop_app_inspect']],
      ['memory_agent', 'Memory Agent', 'Memory and preference assistant.', ['memory_search']],
      ['devops_agent', 'DevOps Agent', 'Read-only diagnostics assistant.', ['system_health_check', 'server_diagnose']],
      ['research_agent', 'Research Agent', 'Read-only web research assistant.', ['web_research']],
    ] as const) {
      this.exec(
        `INSERT INTO agents (id, name, description, default_model_id, capabilities, route_hints, enabled, metadata)
         VALUES (?, ?, ?, 'deterministic-local-model', ?, '{"keywords":[]}', 1, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, default_model_id=excluded.default_model_id, capabilities=excluded.capabilities, route_hints=excluded.route_hints, enabled=excluded.enabled, updated_at=datetime('now')`,
        agent[0],
        agent[1],
        agent[2],
        json(agent[3]),
        json({ desktop_default: true, electron_native: true }),
      );
    }
    for (const capability of [
      ['memory_search', 'Memory Search', 'Search local memory context.', 'read_only'],
      ['web_research', 'Web Research', 'Fetch and summarize an allowlisted web page.', 'read_only'],
      ['server_diagnose', 'Server Diagnose', 'Inspect service health through read-only diagnostics.', 'read_only'],
      ['system_health_check', 'System Health Check', 'Inspect Joi local runtime health.', 'read_only'],
      ['workspace_search', 'Workspace Search', 'Search authorized workspace source and documents.', 'read_only'],
      ['file_read', 'File Read', 'Read a bounded authorized workspace file line range.', 'read_only'],
      ['file_analyze', 'File Analyze', 'Analyze an authorized workspace file.', 'read_only'],
      ['apply_patch', 'Apply Patch', 'Apply a bounded patch inside authorized workspace roots.', 'workspace_write'],
      ['shell_command', 'Shell Command', 'Run a tightly allowlisted read-only workspace command.', 'read_only'],
      ['test_command', 'Test Command', 'Run an allowlisted test/build command.', 'read_only'],
      ['computer_observe', 'Computer Observe', 'Observe bounded frontmost-window metadata and visible text.', 'read_only'],
      ['browser_observe', 'Browser Observe', 'Observe bounded frontmost-browser metadata and visible text.', 'read_only'],
      ['browser_navigate', 'Browser Navigate', 'Navigate an allowlisted browser URL without Playwright.', 'read_only'],
      ['browser_click', 'Browser Click', 'Click an element in the frontmost browser with explicit high permission.', 'browser_interaction'],
      ['browser_type', 'Browser Type', 'Type into an element in the frontmost browser with explicit high permission.', 'browser_interaction'],
      ['desktop_app_list', 'Desktop App List', 'List installed macOS application bundle metadata.', 'read_only'],
      ['desktop_app_inspect', 'Desktop App Inspect', 'Inspect one macOS application bundle metadata record.', 'read_only'],
    ]) {
      this.exec(
        `INSERT INTO capabilities (id, name, description, risk_level, enabled, metadata)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, risk_level=excluded.risk_level, enabled=excluded.enabled, updated_at=datetime('now')`,
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
      json(['memory_search', 'workspace_search', 'file_read', 'file_analyze', 'apply_patch', 'shell_command', 'test_command', 'computer_observe', 'browser_observe', 'browser_navigate', 'browser_click', 'browser_type', 'desktop_app_list', 'desktop_app_inspect']),
      this.options.version,
      json({ runtime: 'electron_ts_store', desktop_default: true }),
    );
    for (const workflow of [
      ['workflow_memory_search_v1', 'memory_search', 'memory_search_v1', [{ tool: 'memory_search', risk_level: 'read_only' }]],
      ['workflow_workspace_search_v1', 'workspace_search', 'workspace_search_v1', [{ tool: 'workspace_walk_search', risk_level: 'read_only' }]],
      ['workflow_file_read_v1', 'file_read', 'file_read_v1', [{ tool: 'file_read_authorized', risk_level: 'read_only' }]],
      ['workflow_apply_patch_v1', 'apply_patch', 'apply_patch_v1', [{ tool: 'apply_patch', risk_level: 'workspace_write' }]],
      ['workflow_shell_command_v1', 'shell_command', 'shell_command_v1', [{ tool: 'shell_command', risk_level: 'read_only' }]],
      ['workflow_test_command_v1', 'test_command', 'test_command_v1', [{ tool: 'test_command', risk_level: 'read_only' }]],
      ['workflow_computer_observe_v1', 'computer_observe', 'computer_observe_v1', [{ tool: 'computer_observe', risk_level: 'read_only' }]],
      ['workflow_browser_observe_v1', 'browser_observe', 'browser_observe_v1', [{ tool: 'browser_observe', risk_level: 'read_only' }]],
      ['workflow_browser_navigate_v1', 'browser_navigate', 'browser_navigate_v1', [{ tool: 'browser_navigate', risk_level: 'read_only' }]],
      ['workflow_browser_click_v1', 'browser_click', 'browser_click_v1', [{ tool: 'browser_click', risk_level: 'browser_interaction' }]],
      ['workflow_browser_type_v1', 'browser_type', 'browser_type_v1', [{ tool: 'browser_type', risk_level: 'browser_interaction' }]],
      ['workflow_desktop_app_list_v1', 'desktop_app_list', 'desktop_app_list_v1', [{ tool: 'desktop_list_app_bundles', risk_level: 'read_only' }]],
      ['workflow_desktop_app_inspect_v1', 'desktop_app_inspect', 'desktop_app_inspect_v1', [{ tool: 'desktop_inspect_app_bundle', risk_level: 'read_only' }]],
    ] as const) {
      this.exec(
        `INSERT INTO tool_workflows (id, capability_id, name, version, risk_level, steps, enabled, metadata)
         VALUES (?, ?, ?, 'v1', ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET
           capability_id=excluded.capability_id,
           name=excluded.name,
           risk_level=excluded.risk_level,
           steps=excluded.steps,
           enabled=excluded.enabled,
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

  private appendMemoryRecalledEvents(runID: string, turnID: string, memoryPackID: string, results: MemorySearchResult[]): void {
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
          summary: memory.summary,
          content: memory.content,
          reason: result.reason,
          score: result.score,
          pinned: memory.pinned,
        },
      });
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
    this.appendRunEventV2({
      run_id: runID,
      event_type: eventType,
      item_type: 'automation',
      item_id: optionalString(payload.automation_id),
      source: 'automation',
      visibility: 'inline_status',
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

  private nextTurnItemSeq(runID: string): number {
    const row = this.get(`SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM turn_items WHERE run_id=?`, runID);
    return Number(row?.seq ?? 1);
  }

  private searchPromptMemories(query: string, limit: number): MemorySearchResult[] {
    const rows = this.all(
      `SELECT id, type, content, COALESCE(summary, '') AS summary, scope_type, COALESCE(scope_id, '') AS scope_id,
              privacy_level, confidence, status, source_event_ids, entities, success_count, failure_count,
              usage_count, positive_feedback, negative_feedback, pinned, disabled_at,
              COALESCE(merged_into_memory_id, '') AS merged_into_memory_id,
              COALESCE(conflict_group_id, '') AS conflict_group_id,
              COALESCE(conflict_reason, '') AS conflict_reason,
              metadata, created_at, updated_at, last_used_at
       FROM memories
       WHERE status='confirmed'
         AND disabled_at IS NULL
         AND merged_into_memory_id IS NULL
         AND ${activeMemoryTTLWhereClause('memories')}
       ORDER BY pinned DESC, confidence DESC, datetime(updated_at) DESC
       LIMIT 60`,
    );
    const terms = memorySearchTerms(query);
    const scored = rows.map((row) => {
      const memory = rowToMemory(row);
      const haystack = `${memory.type} ${memory.summary} ${memory.content} ${(memory.entities || []).join(' ')}`.toLowerCase();
      const termHits = terms.filter((term) => haystack.includes(term)).length;
      const score = Number(memory.confidence || 0) + (memory.pinned ? 0.25 : 0) + termHits * 0.35;
      return {
        memory,
        score,
        reason: termHits > 0 ? `matched ${termHits} prompt term${termHits === 1 ? '' : 's'}` : 'stable confirmed memory',
      };
    });
    return scored
      .filter((item) => item.score > 0 || item.memory.pinned)
      .sort((a, b) => b.score - a.score || Number(b.memory.pinned) - Number(a.memory.pinned))
      .slice(0, Math.max(1, Math.min(limit, 12)));
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
    if (plan.pendingMemory) {
      this.exec(
        `INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, metadata)
         VALUES (?, 'preference', ?, ?, 'global', 'internal', 0.8, 'pending', '[]', '[]', ?)`,
        `mem_${newID()}`,
        plan.pendingMemory.content,
        plan.pendingMemory.summary,
        json({ source: 'electron_sqlite_deterministic', run_id: runID }),
      );
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
  return {
    id: String(row.id),
    kind: normalizeAutomationKind(row.kind),
    slug: String(row.slug),
    name: String(row.name),
    description: optionalString(row.description),
    enabled: Boolean(Number(row.enabled ?? 1)),
    trigger_config: parseObject(row.trigger_config),
    prompt_template: optionalString(row.prompt_template) || '',
    input_mode: normalizeAutomationInputMode(row.input_mode),
    permission_profile: normalizeAutomationPermissionProfile(row.permission_profile),
    preferred_node: optionalString(row.preferred_node) || 'main-node',
    allow_worker: Boolean(Number(row.allow_worker ?? 0)),
    conversation_id: optionalString(row.conversation_id),
    principal_id: optionalString(row.principal_id),
    dedup_policy: parseObject(row.dedup_policy),
    retry_policy: parseObject(row.retry_policy),
    max_concurrency: Math.max(1, Number(row.max_concurrency ?? 1)),
    notification_policy: parseObject(row.notification_policy),
    next_fire_at: optionalString(row.next_fire_at),
    last_fire_at: optionalString(row.last_fire_at),
    metadata: parseObject(row.metadata),
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
    metadata: parseObject(row.metadata),
    created_at: optionalString(row.created_at),
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
    error: sanitizeLogPayload(parseObject(row.error)),
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

function rowToMCPServer(row: SQLiteRow): MCPServerRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    transport: optionalString(row.transport) || 'stdio',
    command: optionalString(row.command),
    args: parseArray(row.args).map(String),
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
  return {
    id: String(row.id),
    type: optionalString(row.type) || 'note',
    content: String(row.content),
    summary: optionalString(row.summary) || '',
    scope_type: optionalString(row.scope_type) || 'global',
    scope_id: optionalString(row.scope_id),
    privacy_level: optionalString(row.privacy_level) || 'internal',
    status: optionalString(row.status) || 'pending',
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
    entities: parseArray(row.entities).map(String),
    merged_into_memory_id: optionalString(row.merged_into_memory_id),
    conflict_group_id: optionalString(row.conflict_group_id),
    conflict_reason: optionalString(row.conflict_reason),
    metadata: parseObject(row.metadata),
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
    last_used_at: optionalString(row.last_used_at),
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
    approval_scope: optionalString(row.approval_scope),
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
  if (capability === 'computer_observe' || capability === 'browser_observe') {
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
  if (capabilityID === 'apply_patch') return 'workspace_write';
  if (capabilityID === 'browser_click' || capabilityID === 'browser_type') return 'browser_interaction';
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

function isWaitingConfirmationToolResult(result: PersistedToolResult): boolean {
  return result.output?.status === 'waiting_confirmation';
}

function confirmationMessageForToolResult(result: PersistedToolResult): string {
  return optionalString(result.output?.message)
    || 'confirmation_required: tool execution requires approval before it can continue.';
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
  if (/报告|分析|总结|plan|report|summary/i.test(message)) return ['report'];
  if (/代码|修改|实现|patch|diff|test/i.test(message)) return ['code_patch', 'test_result'];
  if (mode === 'background_task') return ['open_loop', 'status_update'];
  return ['task_result'];
}

function riskLevelForPermission(permissionProfile: string | undefined): string {
  if (permissionProfile === 'danger_full_access') return 'browser_interaction';
  if (permissionProfile === 'workspace_write') return 'workspace_write';
  return 'read_only';
}

function capabilityScopeForPermission(permissionProfile: string | undefined): string[] {
  const scope = ['workspace_search', 'file_read', 'file_analyze', 'web_research', 'computer_observe', 'browser_observe', 'system_health_check'];
  if (permissionProfile === 'workspace_write' || permissionProfile === 'danger_full_access') {
    scope.push('apply_patch', 'test_command');
  }
  if (permissionProfile === 'danger_full_access') {
    scope.push('browser_click', 'browser_type');
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

function verifyTaskCompletion(response: string, artifact: ArtifactSummary | undefined, toolResults: PersistedToolResult[]): TaskVerification {
  const checks: TaskVerification['checks'] = [
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
      status: toolResults.some((result) => String(result.output?.status || '').includes('failed')) ? 'failed' : 'passed',
      evidence: { tool_result_count: toolResults.length },
    },
  ];
  const passed = checks.every((check) => check.status === 'passed');
  return {
    status: passed ? 'passed' : 'failed',
    summary: passed ? 'Result verified with artifact/state evidence.' : 'Verification failed; task is blocked rather than completed.',
    checks,
    verified_at: nowIso(),
  };
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
    case 'apply_patch':
      return '应用代码变更';
    case 'test_command':
      return '运行测试';
    case 'browser_click':
    case 'browser_type':
    case 'browser_navigate':
      return '操作浏览器';
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
    cache_hit_ratio: inputTokens > 0 ? cachedInputTokens / inputTokens : 0,
    avg_latency_ms: calls > 0 ? weightedLatency / calls : 0,
    fallback_calls: fallbackCalls,
    error_calls: errorCalls,
    estimated_cost: roundCost(estimatedCost),
  };
}

function sideEffectLevelForCapability(capability: string): string {
  if (capability === 'apply_patch') return 'write_local';
  if (capability === 'browser_click' || capability === 'browser_type') return 'external_action';
  if (capability === 'shell_command' || capability === 'test_command') return 'write_local';
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
  return '';
}

function reversibleForTool(capability: string): boolean {
  return capability === 'apply_patch';
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items = value.map((item) => String(item).trim()).filter(Boolean);
  return items;
}

function canonicalCapabilityName(capabilityID: string): string {
  switch (capabilityID) {
    case 'server_diagnose_v1':
      return 'server_diagnose';
    case 'desktop_app_list_v1':
      return 'desktop_app_list';
    case 'desktop_app_inspect_v1':
      return 'desktop_app_inspect';
    case 'computer_observe_v1':
      return 'computer_observe';
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
      return 'file_read';
    case 'shell_command_v1':
      return 'shell_command';
    case 'web_research_v1':
    case 'web_research_v2':
    case 'fetch_url':
      return 'web_research';
    case 'system_health_check_v1':
      return 'system_health_check';
    default:
      return capabilityID;
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
  if (eventType.endsWith('.failed')) return 'failed';
  if (eventType.endsWith('.cancelled')) return 'cancelled';
  if (eventType.endsWith('.redirected')) return 'redirected';
  if (eventType === 'run.recovery_required') return 'waiting_approval';
  if (eventType.endsWith('.completed') || eventType.endsWith('.finished')) return 'completed';
  if (eventType.endsWith('.requested') || eventType.endsWith('.required')) return 'waiting_approval';
  if (eventType.endsWith('.started') || eventType.endsWith('.delta')) return 'running';
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
  if (capability === 'apply_patch') return 'workspace_write';
  if (capability === 'browser_click' || capability === 'browser_type') return 'browser_interaction';
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

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseObject(value: unknown): Record<string, unknown> {
  const text = jsonText(value);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
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
    file_analyze_max_bytes: input.file_analyze_max_bytes > 0 ? Math.floor(input.file_analyze_max_bytes) : 256 * 1024,
    workspace_search_max_results: input.workspace_search_max_results > 0 ? Math.floor(input.workspace_search_max_results) : 50,
  };
}

function normalizeRoot(root: string): string {
  const expanded = root.startsWith('~/') ? join(homedir(), root.slice(2)) : root;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(defaultWorkspaceRoot(), expanded);
}

function pathWithinRoot(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
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

function sanitizeDiagnosticValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnosticValue(item));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    const redactNamedValue = objectHasSensitiveNameHint(value as Record<string, unknown>);
    for (const [key, item] of Object.entries(value)) {
      result[key] = diagnosticSensitiveKey(key) || (key.toLowerCase() === 'value' && redactNamedValue)
        ? '[REDACTED]'
        : sanitizeDiagnosticValue(item);
    }
    return result;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return sanitizeDiagnosticValue(JSON.parse(trimmed));
      } catch {
        // Keep non-JSON strings on the normal redaction path.
      }
    }
    const redacted = redactSensitiveText(value);
    return redacted.length > 600 ? `${redacted.slice(0, 600)}...[truncated]` : redacted;
  }
  return value;
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
