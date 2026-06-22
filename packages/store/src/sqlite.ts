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
  InputMode,
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
  ProactiveMessage,
  ProductTask,
  ProductTaskDetail,
  ProductTaskStep,
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
  };
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
  };
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
    this.db.exec(options.schemaSql);
    this.seedDefaults();
  }

  close(): void {
    this.db.close();
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

    this.transaction(() => {
      this.exec(
        `INSERT INTO conversations (id, channel, user_id, title, active_agent_id, lifecycle_status, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET title=COALESCE(conversations.title, excluded.title), updated_at=datetime('now')`,
        conversationID,
        req.channel || 'desktop',
        req.user_id || 'desktop_user',
        title,
        plan.agentID,
        json({ electron_native: true }),
      );

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
        `INSERT INTO runs (id, conversation_id, user_message_id, status, selected_agent_id, selected_model_id, selected_node_id, route_result, started_at, finished_at, duration_ms, metadata, created_at)
         VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, datetime('now'), datetime('now'), 0, ?, datetime('now'))`,
        runID,
        conversationID,
        userMessageID,
        plan.agentID,
        modelName,
        plan.selectedNodeID,
        json(plan.routeResult),
        json({ runtime_mode: req.runtime_mode || 'tool_calling', input_mode: req.input_mode || 'auto' }),
      );

      this.exec(
        `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
         VALUES (?, ?, 'assistant', ?, '[]', ?, datetime('now'))`,
        assistantMessageID,
        conversationID,
        response,
        json({ run_id: runID, source: 'electron_sqlite_store' }),
      );

      const events = this.deterministicRunEvents(runID, response, createdAt);
      for (const event of events) {
        this.exec(
          `INSERT INTO run_events (id, run_id, seq, event_type, payload, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          event.id,
          runID,
          event.seq,
          event.event_type,
          json(event.payload ?? {}),
        );
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
      this.applyDeterministicRuntimeArtifacts(plan, runID, conversationID, userMessageID, modelName, capabilityExecution?.output);
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
    let productTask: ProductTask | undefined;

    this.transaction(() => {
      this.exec(
        `INSERT INTO conversations (id, channel, user_id, title, active_agent_id, lifecycle_status, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET active_agent_id=excluded.active_agent_id, updated_at=datetime('now')`,
        conversationID,
        req.channel || 'desktop',
        req.user_id || 'desktop_user',
        title,
        agentID,
        json({ electron_native: true, runtime: 'ts_tool_calling' }),
      );
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
        `INSERT INTO runs (id, conversation_id, user_message_id, status, selected_agent_id, selected_model_id, selected_node_id, route_result, started_at, metadata, created_at)
         VALUES (?, ?, ?, 'running', ?, ?, 'main-node', ?, datetime('now'), ?, datetime('now'))`,
        runID,
        conversationID,
        userMessageID,
        agentID,
        modelName,
        json({ route: 'electron_ts_tool_calling', agent_id: agentID, model: modelName, provider }),
        json({ runtime_mode: 'tool_calling', input_mode: req.input_mode || 'auto', source: 'electron_ts_tool_calling', live_cancellable: true }),
      );
      productTask = this.ensureProductTaskForRun(req, {
        conversation_id: conversationID,
        user_message_id: userMessageID,
        run_id: runID,
        message,
      });
      this.exec(
        `INSERT INTO turns (id, run_id, turn_index, status, active_model_call_id, cancellation_key, started_at, metadata)
         VALUES (?, ?, 1, 'running', ?, ?, datetime('now'), ?)`,
        turnID,
        runID,
        modelCallID,
        `cancel_${runID}`,
        json({ runtime: 'electron_ts_tool_calling', live_cancellable: true }),
      );
      this.insertRunEvent(runID, turnID, 1, 'run.started', { run_id: runID, conversation_id: conversationID, status: 'running', type: 'run.started' });
      this.insertRunEvent(runID, turnID, 2, 'turn.started', { run_id: runID, turn_id: turnID, status: 'running', type: 'turn.started' });
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
        `INSERT INTO model_calls (id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name, prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, output_tokens, cached_input_tokens, latency_ms, status, raw_response, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'running', '{}', ?, datetime('now'))`,
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
      for (const result of toolResults) {
        const capability = canonicalCapabilityName(result.name);
        const workflowName = workflowNameForGateway(capability);
        const args = result.arguments || {};
        const risk = workflowRiskLevel(capability);
        const requestedAction = requestedActionForTool(capability, args, result.output);
        const resultWaiting = isWaitingConfirmationToolResult(result);
        const operationID = operationIDForTool(started.product_task_id, capability, args, result.call_id);
        this.insertRunStep(started.run_id, 'capability_requested', 'Model requested capability tool', { agent_id: started.selected_agent_id, call_id: result.call_id, tool_name: result.name }, { capability, goal: requestedAction, inputs: args, risk, source: 'tool_calling', operation_id: operationID });
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
        this.exec(
          `INSERT INTO tool_runs (id, run_id, capability_id, workflow_name, tool_name, node_id, assignment_reason, risk_level, status, input, output, finished_at, duration_ms)
           VALUES (?, ?, ?, ?, ?, 'main-node', 'model_tool_call', ?, 'succeeded', ?, ?, datetime('now'), 0)`,
          toolRunID,
          started.run_id,
          capability,
          workflowName,
          workflowName,
          risk,
          json(args),
          json(result.output),
        );
        this.insertRunStep(started.run_id, 'tool_finished', 'Tool runtime finished', { workflow_name: workflowName, tool_run_id: toolRunID, call_id: result.call_id }, result.output);
        this.insertTurnItem(started.run_id, started.turn_id, itemSeq++, 'tool_output', 'tool', result.call_id, result.name, {}, JSON.stringify(result.output), result.output, 'completed', { tool_run_id: toolRunID, capability });
        this.recordProductTaskToolCheckpoint(started.product_task_id, {
          run_id: started.run_id,
          capability,
          requested_action: requestedAction,
          input: args,
          output: { ...result.output, operation_id: operationID },
          status: String(result.output?.status || '') === 'failed' ? 'failed' : 'done',
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
      this.insertRunStep(started.run_id, 'model_call_finished', 'Model call finished', { agent_id: started.selected_agent_id, model_id: started.model_name, prompt_assembly_id: started.prompt_assembly_id }, { provider: started.provider, model: started.model_name, real_model: started.provider !== 'mock_provider', fallback_to_mock: false, input_tokens: positiveNumber(usage.input_tokens), output_tokens: positiveNumber(usage.output_tokens), cached_input_tokens: positiveNumber(usage.cached_input_tokens), tool_run_count: toolResults.length });
      this.insertRunStep(started.run_id, 'agent_output_parsed', 'Agent output parsed', { turn: 1 }, { repaired: false, output_type: 'final_answer' });
      this.insertRunStep(started.run_id, 'response_generated', waitingConfirmation ? 'Confirmation response generated' : 'Response generated', {}, { response }, waitingConfirmation ? 'waiting_confirmation' : 'succeeded');
      this.insertTurnItem(started.run_id, started.turn_id, itemSeq++, 'message', 'assistant', '', '', {}, response, {}, waitingConfirmation ? 'waiting_confirmation' : 'completed', { final_answer: !waitingConfirmation, waiting_confirmation: waitingConfirmation });
      this.exec(
        `UPDATE model_calls
         SET input_tokens=?, output_tokens=?, cached_input_tokens=?, latency_ms=0, status='succeeded', raw_response=?, metadata=json_set(COALESCE(metadata, '{}'), '$.tool_run_count', ?)
         WHERE id=?`,
        positiveNumber(usage.input_tokens),
        positiveNumber(usage.output_tokens),
        positiveNumber(usage.cached_input_tokens),
        json({ responses: turn.model_responses || [] }),
        toolResults.length,
        started.model_call_id,
      );
      this.exec(
        `UPDATE runs
         SET status=?, finished_at=CASE WHEN ? THEN NULL ELSE datetime('now') END,
             duration_ms=CASE WHEN ? THEN NULL ELSE CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER) END
         WHERE id=?`,
        waitingConfirmation ? 'waiting_confirmation' : 'completed',
        waitingConfirmation ? 1 : 0,
        waitingConfirmation ? 1 : 0,
        started.run_id,
      );
      this.exec(
        `UPDATE turns
         SET status=?, finished_at=CASE WHEN ? THEN NULL ELSE datetime('now') END
         WHERE id=?`,
        waitingConfirmation ? 'waiting_confirmation' : 'completed',
        waitingConfirmation ? 1 : 0,
        started.turn_id,
      );
      if (waitingConfirmation) {
        this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'message.delta', { run_id: started.run_id, turn_id: started.turn_id, delta: response, status: 'waiting_confirmation', type: 'message.delta' });
        this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'run.waiting_confirmation', { run_id: started.run_id, turn_id: started.turn_id, status: 'waiting_confirmation', message: response, type: 'run.waiting_confirmation' });
      } else {
        this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'message.delta', { run_id: started.run_id, turn_id: started.turn_id, delta: response, status: 'completed', type: 'message.delta' });
        this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'turn.completed', { run_id: started.run_id, turn_id: started.turn_id, status: 'completed', type: 'turn.completed' });
        this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), 'run.completed', { run_id: started.run_id, status: 'succeeded', type: 'run.completed' });
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
         SET status=?, error_code=?, error_message=?, finished_at=datetime('now'),
             duration_ms=CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER)
         WHERE id=?`,
        status,
        status === 'cancelled' ? 'interrupted' : 'tool_calling_runtime_failed',
        error.message,
        started.run_id,
      );
      this.exec(
        `UPDATE turns SET status=?, finished_at=datetime('now') WHERE id=?`,
        status,
        started.turn_id,
      );
      this.exec(
        `UPDATE model_calls
         SET status=?, error_code=?, error_message=?, raw_response=?, metadata=json_set(COALESCE(metadata, '{}'), '$.error', ?)
         WHERE id=?`,
        status,
        status === 'cancelled' ? 'interrupted' : 'tool_calling_runtime_failed',
        error.message,
        json({ error: error.message }),
        error.message,
        started.model_call_id,
      );
      this.markProductTaskFailed(started.product_task_id, started.run_id, error, status);
      this.insertRunEvent(started.run_id, started.turn_id, this.nextRunEventSeq(started.run_id), status === 'cancelled' ? 'run.interrupted' : 'run.failed', { run_id: started.run_id, turn_id: started.turn_id, status, error: error.message, message: response });
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
    const waitingResult = toolResults.find(isWaitingConfirmationToolResult);
    const waitingConfirmation = turn.status === 'waiting_confirmation' || Boolean(waitingResult);
    const runStatus = waitingConfirmation ? 'waiting_confirmation' : 'completed';
    const turnStatus = waitingConfirmation ? 'waiting_confirmation' : 'completed';
    let productTask: ProductTask | undefined;
    let artifacts: ArtifactSummary[] = [];

    this.transaction(() => {
      this.exec(
        `INSERT INTO conversations (id, channel, user_id, title, active_agent_id, lifecycle_status, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET active_agent_id=excluded.active_agent_id, updated_at=datetime('now')`,
        conversationID,
        req.channel || 'desktop',
        req.user_id || 'desktop_user',
        title,
        agentID,
        json({ electron_native: true, runtime: 'ts_tool_calling' }),
      );

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
        `INSERT INTO runs (id, conversation_id, user_message_id, status, selected_agent_id, selected_model_id, selected_node_id, route_result, started_at, finished_at, duration_ms, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'main-node', ?, datetime('now'), CASE WHEN ? THEN NULL ELSE datetime('now') END, CASE WHEN ? THEN NULL ELSE 0 END, ?, datetime('now'))`,
        runID,
        conversationID,
        userMessageID,
        runStatus,
        agentID,
        modelName,
        json({ route: 'electron_ts_tool_calling', agent_id: agentID, model: modelName, provider }),
        waitingConfirmation ? 1 : 0,
        waitingConfirmation ? 1 : 0,
        json({ runtime_mode: 'tool_calling', input_mode: req.input_mode || 'auto', source: 'electron_ts_tool_calling' }),
      );
      productTask = this.ensureProductTaskForRun(req, {
        conversation_id: conversationID,
        user_message_id: userMessageID,
        run_id: runID,
        message,
      });

      this.exec(
        `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
         VALUES (?, ?, 'assistant', ?, '[]', ?, datetime('now'))`,
        assistantMessageID,
        conversationID,
        response,
        json({ run_id: runID, source: 'electron_ts_tool_calling' }),
      );

      this.exec(
        `INSERT INTO turns (id, run_id, turn_index, status, active_model_call_id, cancellation_key, started_at, finished_at, metadata)
         VALUES (?, ?, 1, ?, ?, ?, datetime('now'), CASE WHEN ? THEN NULL ELSE datetime('now') END, ?)`,
        turnID,
        runID,
        turnStatus,
        modelCallID,
        `cancel_${runID}`,
        waitingConfirmation ? 1 : 0,
        json({ runtime: 'electron_ts_tool_calling' }),
      );

      this.insertRunEvent(runID, turnID, 1, 'run.started', { run_id: runID, conversation_id: conversationID, status: 'running', type: 'run.started' });
      this.insertRunEvent(runID, turnID, 2, 'turn.started', { run_id: runID, turn_id: turnID, status: 'running', type: 'turn.started' });

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
          this.insertRunEvent(runID, turnID, 3, 'approval.requested', approvalPayload);
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
        this.exec(
          `INSERT INTO tool_runs (id, run_id, capability_id, workflow_name, tool_name, node_id, assignment_reason, risk_level, status, input, output, finished_at, duration_ms)
           VALUES (?, ?, ?, ?, ?, 'main-node', 'model_tool_call', ?, 'succeeded', ?, ?, datetime('now'), 0)`,
          toolRunID,
          runID,
          capability,
          workflowName,
          workflowName,
          risk,
          json(args),
          json(result.output),
        );
        this.insertRunStep(runID, 'tool_finished', 'Tool runtime finished', { workflow_name: workflowName, tool_run_id: toolRunID, call_id: result.call_id }, result.output);
        this.insertTurnItem(runID, turnID, itemSeq++, 'tool_output', 'tool', result.call_id, result.name, {}, JSON.stringify(result.output), result.output, 'completed', { tool_run_id: toolRunID, capability });
        this.recordProductTaskToolCheckpoint(productTask?.id, {
          run_id: runID,
          capability,
          requested_action: requestedAction,
          input: args,
          output: { ...result.output, operation_id: operationID },
          status: String(result.output?.status || '') === 'failed' ? 'failed' : 'done',
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

      this.insertRunStep(runID, 'model_call_finished', 'Model call finished', { agent_id: agentID, model_id: modelName, prompt_assembly_id: promptAssemblyID }, { provider, model: modelName, real_model: provider !== 'mock_provider', fallback_to_mock: false, input_tokens: positiveNumber(usage.input_tokens), output_tokens: positiveNumber(usage.output_tokens), cached_input_tokens: positiveNumber(usage.cached_input_tokens), tool_run_count: toolResults.length });
      this.insertRunStep(runID, 'agent_output_parsed', 'Agent output parsed', { turn: 1 }, { repaired: false, output_type: 'final_answer' });
      this.insertRunStep(runID, 'response_generated', waitingConfirmation ? 'Confirmation response generated' : 'Response generated', {}, { response }, waitingConfirmation ? 'waiting_confirmation' : 'succeeded');
      this.insertTurnItem(runID, turnID, itemSeq++, 'message', 'assistant', '', '', {}, response, {}, waitingConfirmation ? 'waiting_confirmation' : 'completed', { final_answer: !waitingConfirmation, waiting_confirmation: waitingConfirmation });

      this.exec(
        `INSERT INTO model_calls (id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name, prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, output_tokens, cached_input_tokens, latency_ms, status, raw_response, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'succeeded', ?, ?, datetime('now'))`,
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
        positiveNumber(usage.input_tokens),
        positiveNumber(usage.output_tokens),
        positiveNumber(usage.cached_input_tokens),
        json({ responses: turn.model_responses || [] }),
        json({ source: 'electron_ts_tool_calling', real_model: provider !== 'mock_provider', fallback_to_mock: false, tool_run_count: toolResults.length }),
      );

      if (waitingConfirmation) {
        this.insertRunEvent(runID, turnID, 4, 'message.delta', { run_id: runID, turn_id: turnID, delta: response, status: 'waiting_confirmation', type: 'message.delta' });
        this.insertRunEvent(runID, turnID, 5, 'run.waiting_confirmation', { run_id: runID, turn_id: turnID, status: 'waiting_confirmation', message: response, type: 'run.waiting_confirmation' });
      } else {
        this.insertRunEvent(runID, turnID, 3, 'message.delta', { run_id: runID, turn_id: turnID, delta: response, status: 'completed', type: 'message.delta' });
        this.insertRunEvent(runID, turnID, 4, 'turn.completed', { run_id: runID, turn_id: turnID, status: 'completed', type: 'turn.completed' });
        this.insertRunEvent(runID, turnID, 5, 'run.completed', { run_id: runID, status: 'succeeded', type: 'run.completed' });
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
      `SELECT id, run_id, turn_id, seq, event_type, payload, created_at
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
      `SELECT id, provider, model_name, status, input_tokens, output_tokens, cached_input_tokens, cacheable_prefix_tokens, dynamic_tail_tokens, latency_ms, prompt_cache_key, prefix_hash, dynamic_tail_hash, metadata
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
      `SELECT id, provider, model_name, display_name, base_url, supports_json_mode, supports_tool_calling, context_window, input_price_per_1m, output_price_per_1m, enabled, metadata
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
          `INSERT INTO models (id, provider, model_name, display_name, base_url, supports_json_mode, supports_tool_calling, context_window, input_price_per_1m, output_price_per_1m, enabled, metadata, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, 0), NULLIF(?, 0), NULLIF(?, 0), 1, ?, datetime('now'))
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
    return {
      service_status: {
        sqlite: String(integrity?.integrity_check || '') === 'ok',
        electron: 'running',
        runtime: 'electron_ts_sqlite',
      },
      queue_status: { driver: 'sqlite', pending: 0 },
      worker_status: [],
      model_latency: {},
      tool_failure_rate: {},
      token_cost_today: {},
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
          this.exec(
            `UPDATE memories
             SET content=?, summary=?, status='confirmed', disabled_at=NULL,
                 metadata=json_set(COALESCE(metadata, '{}'), '$.edited_by', 'desktop_ui', '$.edited_at', datetime('now')),
                 updated_at=datetime('now')
             WHERE id=?`,
            content,
            summary,
            id,
          );
          this.insertMemoryFeedback(id, req.run_id, 'edit', req.comment || req.reason || '');
        });
        return;
      }
      case 'reject':
        this.exec(
          `UPDATE memories
           SET status='rejected', disabled_at=datetime('now'),
               metadata=json_set(COALESCE(metadata, '{}'), '$.rejected_by', 'desktop_ui', '$.reject_reason', ?, '$.rejected_at', datetime('now')),
               updated_at=datetime('now')
           WHERE id=?`,
          req.reason || 'desktop_ui',
          id,
        );
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

  getModelUsage(): { items: Record<string, unknown>[] } {
    const rows = this.all(
      `SELECT COALESCE(provider, '') AS provider,
              COALESCE(model_name, '') AS model,
              COALESCE(agent_id, '') AS agent,
              COUNT(*) AS calls,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
              COALESCE(AVG(latency_ms), 0) AS avg_latency_ms,
              SUM(CASE WHEN status='fallback_to_mock' THEN 1 ELSE 0 END) AS fallback_calls,
              SUM(CASE WHEN status NOT IN ('succeeded', 'fallback_to_mock') THEN 1 ELSE 0 END) AS error_calls
       FROM model_calls
       GROUP BY provider, model_name, agent_id
       ORDER BY calls DESC, provider ASC, model ASC`,
    );
    return {
      items: rows.map((row) => ({
        provider: optionalString(row.provider) || '',
        model: optionalString(row.model) || '',
        agent: optionalString(row.agent) || '',
        calls: Number(row.calls ?? 0),
        input_tokens: Number(row.input_tokens ?? 0),
        output_tokens: Number(row.output_tokens ?? 0),
        cached_input_tokens: Number(row.cached_input_tokens ?? 0),
        cache_hit_ratio: Number(row.input_tokens ?? 0) > 0 ? Number(row.cached_input_tokens ?? 0) / Number(row.input_tokens ?? 1) : 0,
        avg_latency_ms: Number(row.avg_latency_ms ?? 0),
        fallback_calls: Number(row.fallback_calls ?? 0),
        error_calls: Number(row.error_calls ?? 0),
        estimated_cost: 0,
      })),
    };
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

  decideConfirmation(req: { id?: string; approve?: boolean; actor?: string; reason?: string }): void {
    const id = req.id?.trim();
    if (!id) throw new Error('confirmation id is required');
    const status = req.approve ? 'approved' : 'rejected';
    const existing = this.get(
      `SELECT id, COALESCE(run_id, '') AS run_id, COALESCE(turn_id, '') AS turn_id,
              COALESCE(call_id, '') AS call_id, COALESCE(capability_id, '') AS capability_id,
              status
       FROM confirmation_requests
       WHERE id=?`,
      id,
    );
    if (!existing) return;
    const runID = optionalString(existing.run_id) || '';
    const turnID = optionalString(existing.turn_id) || '';
    const callID = optionalString(existing.call_id) || '';
    const capabilityID = optionalString(existing.capability_id) || '';
    this.transaction(() => {
      if (req.approve) {
        this.exec(
          `UPDATE confirmation_requests
           SET status='approved', approved_by=?, rejected_by='', decision_reason=?, decided_at=datetime('now')
           WHERE id=? AND status='pending'`,
          req.actor || 'desktop_ui',
          req.reason || '',
          id,
        );
      } else {
        this.exec(
          `UPDATE confirmation_requests
           SET status='rejected', rejected_by=?, approved_by='', decision_reason=?, decided_at=datetime('now')
           WHERE id=? AND status='pending'`,
          req.actor || 'desktop_ui',
          req.reason || '',
          id,
        );
      }
      if (runID) {
        const payload = { confirmation_id: id, run_id: runID, turn_id: turnID, call_id: callID, capability: capabilityID, status, approved: Boolean(req.approve), reason: req.reason || '' };
        this.insertRunEvent(runID, turnID, this.nextRunEventSeq(runID), 'approval.resolved', payload);
        if (!req.approve) {
          const runMetadata = parseObject(this.get(`SELECT metadata FROM runs WHERE id=?`, runID)?.metadata);
          const productTaskID = optionalString(runMetadata.product_task_id);
          this.exec(
            `UPDATE runs
             SET status='failed', error_code='confirmation_rejected', error_message=?, finished_at=datetime('now'),
                 duration_ms=CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER)
             WHERE id=? AND status='waiting_confirmation'`,
            req.reason || 'Confirmation rejected',
            runID,
          );
          this.exec(
            `UPDATE turns
             SET status='failed', finished_at=datetime('now')
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
        json({ confirmation_id: id, actor: req.actor || 'desktop_ui', electron_native: true }),
      );
    });
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
    const runMetadata = parseObject(this.get(`SELECT metadata FROM runs WHERE id=?`, request.run_id)?.metadata);
    const productTaskID = optionalString(runMetadata.product_task_id);
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
        `INSERT INTO tool_runs (id, run_id, capability_id, workflow_name, tool_name, node_id, assignment_reason, risk_level, status, input, output, finished_at, duration_ms)
         VALUES (?, ?, ?, ?, ?, 'main-node', 'confirmation_resume', ?, 'succeeded', ?, ?, datetime('now'), 0)`,
        toolRunID,
        request.run_id,
        capability,
        workflowName,
        workflowName,
        workflowRiskLevel(capability),
        json(request.input),
        json(toolResult.output),
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
      this.recordProductTaskToolCheckpoint(productTaskID, {
        run_id: request.run_id,
        capability,
        requested_action: request.requested_action || `Execute ${capability}`,
        input: request.input,
        output: { ...toolResult.output, resumed: true },
        status: String(toolResult.output?.status || '') === 'failed' ? 'failed' : 'done',
        tool_run_id: toolRunID,
        operation_id: optionalString(request.input.operation_id) || operationIDForTool(productTaskID, capability, request.input, request.call_id),
      });
      if (modelError) {
        this.insertRunStep(request.run_id, 'model_call_failed', 'Model call failed after approval resume', { agent_id: request.agent_id, model_id: resume.model_name || request.model_name, prompt_assembly_id: optionalString(promptAssembly?.id) || '' }, { model_call_id: modelCallID, provider: resume.provider || request.provider, model: resume.model_name || request.model_name, resumed: true, error: modelError, tool_run_ids: [toolRunID] }, 'failed');
        this.exec(
          `INSERT INTO model_calls (id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name, prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, output_tokens, cached_input_tokens, latency_ms, status, error_code, error_message, raw_response, metadata, created_at)
           VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?, 0, 'failed', 'approval_resume_model_failed', ?, ?, ?, datetime('now'))`,
          modelCallID,
          request.run_id,
          request.agent_id,
          request.model_id || resume.model_name || request.model_name,
          optionalString(promptAssembly?.id) || '',
          resume.provider || request.provider,
          resume.model_name || request.model_name,
          optionalString(promptAssembly?.prompt_cache_key) || '',
          optionalString(promptAssembly?.prefix_hash) || '',
          optionalString(promptAssembly?.dynamic_tail_hash) || '',
          positiveNumber(usage.input_tokens),
          positiveNumber(usage.output_tokens),
          positiveNumber(usage.cached_input_tokens),
          modelError,
          json({ responses: resume.model_responses || [], error: modelError }),
          json({ source: 'electron_ts_tool_calling_resume', resumed_from_confirmation_id: request.confirmation_id, tool_run_id: toolRunID, error: modelError }),
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
           SET status='failed', error_code='approval_resume_model_failed', error_message=?, finished_at=datetime('now'),
               duration_ms=CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER)
           WHERE id=?`,
          modelError,
          request.run_id,
        );
        this.exec(
          `UPDATE turns
           SET status='failed', finished_at=datetime('now')
           WHERE id=?`,
          request.turn_id,
        );
        this.markProductTaskFailed(productTaskID, request.run_id, new Error(modelError), 'failed');
        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'tool.output.delta', { call_id: request.call_id, tool_name: capability, status: 'completed', output: toolResult.output, resumed: true });
        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'tool.finished', { call_id: request.call_id, tool_name: capability, status: 'completed', output: toolResult.output, resumed: true });
        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'message.delta', { run_id: request.run_id, turn_id: request.turn_id, delta: response, status: 'failed', resumed: true, error: modelError });
        this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'run.failed', { run_id: request.run_id, turn_id: request.turn_id, status: 'failed', error: 'approval_resume_model_failed', message: modelError, resumed: true });
        if (productTaskID) {
          productTask = this.getProductTask(productTaskID).task;
        }
        return;
      }
      this.insertRunStep(request.run_id, 'model_call_finished', 'Model call finished', { agent_id: request.agent_id, model_id: resume.model_name || request.model_name, prompt_assembly_id: optionalString(promptAssembly?.id) || '' }, { model_call_id: modelCallID, provider: resume.provider || request.provider, model: resume.model_name || request.model_name, real_model: (resume.provider || request.provider) !== 'mock_provider', resumed: true, input_tokens: positiveNumber(usage.input_tokens), output_tokens: positiveNumber(usage.output_tokens), cached_input_tokens: positiveNumber(usage.cached_input_tokens), tool_run_ids: [toolRunID] });
      this.insertRunStep(request.run_id, 'agent_output_parsed', 'Agent output parsed', { turn: 1, resumed: true }, { repaired: false, output_type: 'final_answer' });
      this.insertRunStep(request.run_id, 'response_generated', 'Response generated', {}, { response, resumed: true });
      this.exec(
        `INSERT INTO model_calls (id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name, prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, output_tokens, cached_input_tokens, latency_ms, status, raw_response, metadata, created_at)
         VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?, 0, 'succeeded', ?, ?, datetime('now'))`,
        modelCallID,
        request.run_id,
        request.agent_id,
        request.model_id || resume.model_name || request.model_name,
        optionalString(promptAssembly?.id) || '',
        resume.provider || request.provider,
        resume.model_name || request.model_name,
        optionalString(promptAssembly?.prompt_cache_key) || '',
        optionalString(promptAssembly?.prefix_hash) || '',
        optionalString(promptAssembly?.dynamic_tail_hash) || '',
        positiveNumber(usage.input_tokens),
        positiveNumber(usage.output_tokens),
        positiveNumber(usage.cached_input_tokens),
        json({ responses: resume.model_responses || [] }),
        json({ source: 'electron_ts_tool_calling_resume', resumed_from_confirmation_id: request.confirmation_id, tool_run_id: toolRunID }),
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
         SET status='succeeded', error_code=NULL, error_message=NULL, finished_at=datetime('now'),
             duration_ms=CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER)
         WHERE id=?`,
        request.run_id,
      );
      this.exec(
        `UPDATE turns
         SET status='completed', finished_at=datetime('now')
         WHERE id=?`,
        request.turn_id,
      );
      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'tool.output.delta', { call_id: request.call_id, tool_name: capability, status: 'completed', output: toolResult.output, resumed: true });
      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'tool.finished', { call_id: request.call_id, tool_name: capability, status: 'completed', output: toolResult.output, resumed: true });
      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'message.delta', { run_id: request.run_id, turn_id: request.turn_id, delta: response, status: 'completed', resumed: true });
      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'turn.completed', { run_id: request.run_id, turn_id: request.turn_id, status: 'completed', resumed: true });
      this.insertRunEvent(request.run_id, request.turn_id, this.nextRunEventSeq(request.run_id), 'run.completed', { run_id: request.run_id, status: 'succeeded', resumed: true });
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
    this.transaction(() => {
      this.exec(
        `UPDATE runs
         SET status='cancelled', error_code='interrupted', error_message=?, finished_at=datetime('now'),
             duration_ms=CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER)
         WHERE id=?`,
        reason,
        runID,
      );
      this.exec(
        `UPDATE turns
         SET status='cancelled', finished_at=datetime('now')
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
      this.exec(
        `INSERT OR IGNORE INTO run_events (id, run_id, seq, event_type, payload, created_at)
         VALUES (?, ?, COALESCE((SELECT MAX(seq) + 1 FROM run_events WHERE run_id=?), 1), 'run.interrupted', ?, datetime('now'))`,
        `${runID}_evt_interrupt`,
        runID,
        runID,
        json({ status: 'cancelled', reason }),
      );
      this.markProductTaskFailed(productTaskID, runID, new Error(reason), 'cancelled');
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
      ['last_100_model_calls.json', this.diagnosticRows(`SELECT id, COALESCE(run_id,'') AS run_id, COALESCE(agent_id,'') AS agent_id, COALESCE(provider,'') AS provider, COALESCE(model_name,'') AS model_name, COALESCE(prompt_cache_key,'') AS prompt_cache_key, COALESCE(prefix_hash,'') AS prefix_hash, COALESCE(dynamic_tail_hash,'') AS dynamic_tail_hash, COALESCE(input_tokens,0) AS input_tokens, COALESCE(output_tokens,0) AS output_tokens, COALESCE(cached_input_tokens,0) AS cached_input_tokens, COALESCE(latency_ms,0) AS latency_ms, status, COALESCE(error_code,'') AS error_code, COALESCE(error_message,'') AS error_message, metadata, created_at FROM model_calls ORDER BY created_at DESC LIMIT 100`)],
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
      this.seedDefaults();
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
    message: string;
  }): ProductTask | undefined {
    const mode = effectiveInputMode(req, context.message);
    const existingTaskID = req.product_task_id?.trim();
    if (!existingTaskID && !shouldCreateProductTask(req, context.message, mode)) return undefined;
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
      checkpoints: [{ run_id: context.run_id, status: 'running', at: nowIso() }],
      verification: pendingTaskVerification('Task is running.'),
    };

    const taskID = existingTaskID || `ptask_${newID()}`;
    const existing = existingTaskID ? this.get(
      `SELECT metadata FROM product_tasks WHERE id=?`,
      existingTaskID,
    ) : undefined;

    if (existingTaskID && existing) {
      const metadata = { ...parseObject(existing.metadata), ...metadataBase };
      this.exec(
        `UPDATE product_tasks
         SET latest_run_id=?, status='running', mode=?, risk_level=?, progress_percent=MAX(progress_percent, 10),
             summary=?, metadata=?, updated_at=datetime('now')
         WHERE id=?`,
        context.run_id,
        mode,
        contract.risk_level,
        contract.objective,
        json(metadata),
        existingTaskID,
      );
      this.insertRunStep(context.run_id, 'product_task_attached', 'Product task attached', {}, { product_task_id: existingTaskID, contract });
    } else {
      this.exec(
        `INSERT INTO product_tasks (id, title, description, status, mode, priority, created_from_conversation_id,
                                    created_from_message_id, latest_run_id, owner_user_id, source_channel,
                                    risk_level, progress_percent, current_step_id, summary, metadata)
         VALUES (?, ?, ?, 'running', ?, 'normal', ?, ?, ?, ?, ?, ?, 10, ?, ?, ?)`,
        taskID,
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
      `SELECT id, title, description, status, mode, priority, created_from_conversation_id,
              created_from_message_id, latest_run_id, owner_user_id, source_channel, risk_level,
              progress_percent, current_step_id, summary, metadata, created_at, updated_at, completed_at
       FROM product_tasks
       WHERE id=?`,
      taskID,
    );
    return row ? rowToProductTask(row) : undefined;
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
       SET status=?, progress_percent=?, summary=?, metadata=json_set(COALESCE(metadata, '{}'), '$.verification', json(?)),
           completed_at=CASE WHEN ?='completed' THEN datetime('now') ELSE completed_at END,
           updated_at=datetime('now')
       WHERE id=?`,
      taskStatus,
      progress,
      context.response.slice(0, 500),
      json(verification),
      taskStatus,
      productTaskID,
    );
    this.insertRunStep(context.run_id, 'task_verification_finished', 'Task verification finished', {}, { product_task_id: productTaskID, verification }, verification.status === 'passed' ? 'succeeded' : 'blocked');
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
    this.exec(
      `INSERT INTO proactive_messages (id, type, title, body, reason, source_memory_ids, source_open_loop_id,
                                       source_product_task_id, score, status, channel, metadata)
       VALUES (?, 'followup', ?, ?, 'background_task_completed', '[]', ?, ?, 0.78, 'draft', 'desktop', ?)`,
      `pmsg_${newID()}`,
      `Review ${taskTitle}`,
      suggestedFollowup,
      openLoopID,
      productTaskID,
      json({ source: 'task_os_v1', run_id: context.run_id }),
    );
    this.insertRunStep(context.run_id, 'open_loop_created', 'Open loop created', {}, { open_loop_id: openLoopID, product_task_id: productTaskID });
    this.insertRunStep(context.run_id, 'proactive_candidate_created', 'Proactive candidate created', {}, { source_open_loop_id: openLoopID, product_task_id: productTaskID, status: 'draft' });
  }

  private markProductTaskFailed(productTaskID: string | undefined, runID: string, error: Error, status: 'failed' | 'cancelled'): void {
    if (!productTaskID) return;
    const taskStatus = status === 'cancelled' ? 'paused' : 'blocked';
    const verification = failedTaskVerification(error.message);
    this.exec(
      `UPDATE product_tasks
       SET status=?, summary=?, metadata=json_set(COALESCE(metadata, '{}'), '$.verification', json(?), '$.last_error', ?),
           updated_at=datetime('now')
       WHERE id=?`,
      taskStatus,
      error.message,
      json(verification),
      error.message,
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
  }

  listProductTasks(filter: { status?: string; limit?: number } = {}): { tasks: ProductTask[] } {
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
    const rows = this.all(
      `SELECT id, title, description, status, mode, priority, created_from_conversation_id,
              created_from_message_id, latest_run_id, owner_user_id, source_channel, risk_level,
              progress_percent, current_step_id, summary, metadata, created_at, updated_at, completed_at
       FROM product_tasks
       WHERE ${where.join(' AND ')}
       ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
       LIMIT ?`,
      ...params,
      limit,
    );
    return { tasks: rows.map(rowToProductTask) };
  }

  getProductTask(id: string): ProductTaskDetail {
    const taskID = id.trim();
    if (!taskID) throw new Error('product_task id is required');
    const task = this.get(
      `SELECT id, title, description, status, mode, priority, created_from_conversation_id,
              created_from_message_id, latest_run_id, owner_user_id, source_channel, risk_level,
              progress_percent, current_step_id, summary, metadata, created_at, updated_at, completed_at
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

  listProactiveMessages(filter: { status?: string; limit?: number } = {}): { messages: ProactiveMessage[] } {
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
      case 'queue':
        status = 'queued';
        break;
      case 'sent':
        status = 'sent';
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
        status = 'dismissed';
        feedback ||= action;
        break;
      default:
        throw new Error(`unsupported proactive action: ${action}`);
    }
    this.transaction(() => {
      this.exec(
        `UPDATE proactive_messages
         SET status=?, feedback=NULLIF(?, ''), updated_at=datetime('now'), sent_at=CASE WHEN ?='sent' THEN datetime('now') ELSE sent_at END
         WHERE id=?`,
        status,
        feedback,
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

  private deterministicRunEvents(runID: string, response: string, createdAt: string): RunEvent[] {
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
        event_type: 'assistant.delta',
        type: 'assistant.delta',
        status: 'running',
        delta: response,
        created_at: createdAt,
        payload: { delta: response },
      },
      {
        id: `${runID}_evt_3`,
        run_id: runID,
        seq: 3,
        event_type: 'assistant.completed',
        type: 'assistant.completed',
        status: 'completed',
        created_at: createdAt,
        payload: { message: response },
      },
      {
        id: `${runID}_evt_4`,
        run_id: runID,
        seq: 4,
        event_type: 'run.finalized',
        type: 'run.finalized',
        status: 'completed',
        created_at: createdAt,
        payload: { status: 'completed' },
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

  private insertMemoryFeedback(memoryID: string, runID: string | undefined, feedback: string, comment: string): void {
    this.exec(
      `INSERT INTO memory_feedback (id, memory_id, run_id, feedback, comment)
       VALUES (?, ?, NULLIF(?, ''), ?, ?)`,
      `mfb_${newID()}`,
      memoryID,
      runID || '',
      feedback,
      comment,
    );
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
    this.exec(
      `INSERT INTO run_events (id, run_id, turn_id, seq, event_type, payload, created_at)
       VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, datetime('now'))`,
      `evt_${newID()}`,
      runID,
      turnID,
      seq,
      eventType,
      json(payload),
    );
  }

  private nextRunEventSeq(runID: string): number {
    const row = this.get(`SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM run_events WHERE run_id=?`, runID);
    return Number(row?.seq ?? 1);
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
    capabilityOutput?: Record<string, unknown>,
  ): void {
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
    if (plan.productTask) {
      productTaskID = `ptask_${newID()}`;
      this.exec(
        `INSERT INTO product_tasks (id, title, description, status, mode, priority, created_from_conversation_id, created_from_message_id, latest_run_id, owner_user_id, source_channel, risk_level, progress_percent, summary, metadata)
         VALUES (?, ?, ?, 'planning', 'serious_task', 'normal', ?, ?, ?, 'desktop_user', 'desktop', 'read_only', 20, ?, ?)`,
        productTaskID,
        plan.productTask.title,
        plan.productTask.description,
        conversationID,
        userMessageID,
        runID,
        plan.productTask.summary,
        json({ source: 'electron_sqlite_deterministic' }),
      );
      for (let index = 0; index < plan.productTask.stepCount; index++) {
        this.exec(
          `INSERT INTO product_task_steps (id, product_task_id, title, description, status, sort_order, capability_id, run_id, input, output)
           VALUES (?, ?, ?, '', 'pending', ?, 'file_analyze', ?, '{}', '{}')`,
          `pstep_${newID()}`,
          productTaskID,
          `Step ${index + 1}`,
          index + 1,
          runID,
        );
      }
    }
    if (plan.artifact) {
      const artifactID = `art_${newID()}`;
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
      const output = capabilityOutput || { status: 'succeeded', model: modelName };
      this.exec(
        `INSERT INTO tool_runs (id, run_id, capability_id, workflow_name, tool_name, node_id, assignment_reason, risk_level, status, input, output, finished_at, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'read_only', 'succeeded', ?, ?, datetime('now'), 0)`,
        `toolrun_${newID()}`,
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
  const payload = parseObject(row.payload);
  return {
    id: String(row.id),
    run_id: String(row.run_id),
    turn_id: optionalString(row.turn_id),
    seq: Number(row.seq),
    event_type: String(row.event_type),
    type: optionalString(payload.type) || String(row.event_type),
    status: optionalString(payload.status),
    title: optionalString(payload.title),
    summary: optionalString(payload.summary),
    payload,
    delta: typeof payload.delta === 'string' ? payload.delta : undefined,
    metadata: parseObject(payload.metadata),
    error: optionalString(payload.error),
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
    cacheable_prefix_tokens: optionalNumber(row.cacheable_prefix_tokens),
    dynamic_tail_tokens: optionalNumber(row.dynamic_tail_tokens),
    latency_ms: Number(row.latency_ms ?? 0),
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
  if (/后台|持续|定时|之后提醒|稍后提醒|monitor|watch|background/.test(message) || /background|cron|schedule/.test(normalized)) {
    return 'background_task';
  }
  if (/帮我|整理|分析|实现|修改|检查|生成|写一份|做一份|认真执行|执行|修复/.test(message)
    || /\b(analyze|implement|fix|generate|write|check|run|build)\b/.test(normalized)) {
    return 'serious_task';
  }
  return 'chat_assist';
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

function clampLimit(value: number | undefined, fallback: number): number {
  if (!value || value < 1) return fallback;
  return Math.min(Math.floor(value), 200);
}

function boolString(value: boolean): string {
  return value ? 'true' : 'false';
}

function json(value: unknown): string {
  return JSON.stringify(value);
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
    for (const [key, item] of Object.entries(value)) {
      result[key] = diagnosticSensitiveKey(key) ? '[REDACTED]' : sanitizeDiagnosticValue(item);
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
