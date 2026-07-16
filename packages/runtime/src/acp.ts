import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type InitializeResponse,
  type McpServer,
  type NewSessionResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionConfigSelectOption,
  type SessionNotification,
  type ToolCallUpdate,
} from '@agentclientprotocol/sdk';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { PermissionProfile } from '../../shared-types/src/desktop-api';
import {
  committedAnswerCallbacks,
  type ToolCall,
  type ToolCallingCallbacks,
  type ToolCallingTurnResult,
  type ToolResult,
} from './tool-calling.ts';
import { validateFullAccessCommandInput } from './workspace-exec.ts';

export type ACPTrustedMCPTool = {
  server: string;
  tool: string;
};

export type ACPCompiledCapability = {
  capability_id: string;
  operation: 'workspace_read' | 'workspace_write' | 'workspace_execute' | 'workspace_permissions' | 'network' | 'mcp';
  allowed_roots?: string[];
  command_policy?: 'read_only' | 'workspace_test' | 'full_access_blacklist_v1';
  host_access?: boolean;
  access?: 'read' | 'write';
  server?: string;
  tool?: string;
};

export type ACPProviderRuntimeConfig = {
  provider_id: string;
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  auth_method?: string;
  model?: string;
  timeout_seconds?: number;
  permission_profile?: PermissionProfile;
  mcp_servers?: McpServer[];
  capability_allowlist?: readonly ACPCompiledCapability[];
  joi_capability_tools?: string[];
  ephemeral_session?: boolean;
};

export type ACPProviderInspection = {
  ok: boolean;
  status: string;
  provider_id: string;
  protocol: 'acp';
  command: string;
  agent_name?: string;
  agent_version?: string;
  protocol_version?: number;
  current_model?: string;
  models: Array<{ id: string; name?: string }>;
  error_summary?: string;
};

export type ACPChatTurnRequest = ACPProviderRuntimeConfig & {
  system_message: string;
  messages: Array<{ role: string; content: string }>;
  signal?: AbortSignal;
  callbacks?: ToolCallingCallbacks;
  getSteeringMessages?: () => Promise<Array<Record<string, unknown>>> | Array<Record<string, unknown>>;
  getFollowUpMessages?: () => Promise<Array<Record<string, unknown>>> | Array<Record<string, unknown>>;
};

type ACPConnectionHandle = {
  process: ChildProcessWithoutNullStreams;
  connection: ClientSideConnection;
  client: JoiACPClient;
  initialize: InitializeResponse;
  session: NewSessionResponse;
  close: () => void;
};

type ACPPermissionDecision = {
  allow: boolean;
  capability_id?: string;
  reason: string;
};

type ACPObservedToolCall = ToolCallUpdate;

class JoiACPClient implements Client {
  private readonly permissionProfile: PermissionProfile;
  private readonly capabilityAllowlist: readonly ACPCompiledCapability[];
  private readonly onUpdate?: (notification: SessionNotification) => void;
  private readonly onPermission?: (request: RequestPermissionRequest, outcome: RequestPermissionResponse, decision: ACPPermissionDecision) => void;
  private readonly observedToolCalls = new Map<string, ACPObservedToolCall>();

  constructor(
    permissionProfile: PermissionProfile,
    capabilityAllowlist: readonly ACPCompiledCapability[],
    onUpdate?: (notification: SessionNotification) => void,
    onPermission?: (request: RequestPermissionRequest, outcome: RequestPermissionResponse, decision: ACPPermissionDecision) => void,
  ) {
    this.permissionProfile = permissionProfile;
    this.capabilityAllowlist = capabilityAllowlist;
    this.onUpdate = onUpdate;
    this.onPermission = onPermission;
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
    const update = params.update;
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      this.observedToolCalls.set(
        update.toolCallId,
        mergeACPObservedToolCall(this.observedToolCalls.get(update.toolCallId), update),
      );
    }
    this.onUpdate?.(params);
  }

  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const observed = mergeACPObservedToolCall(this.observedToolCalls.get(params.toolCall.toolCallId), params.toolCall);
    const decision = evaluateACPPermission(observed, this.permissionProfile, this.capabilityAllowlist);
    const outcome = permissionOutcome(params, decision.allow);
    this.onPermission?.(params, outcome, decision);
    return outcome;
  }
}

export function compileACPProviderCapabilityAllowlist(input: {
  permission_profile?: PermissionProfile;
  allowed_roots: string[];
  trusted_mcp_tools?: ACPTrustedMCPTool[];
}): ACPCompiledCapability[] {
  const profile = normalizePermissionProfile(input.permission_profile);
  const hostAccess = profile === 'danger_full_access';
  const roots = hostAccess ? ['/'] : uniqueAbsoluteRoots(input.allowed_roots);
  const capabilities: ACPCompiledCapability[] = [
    { capability_id: 'acp.workspace.read', operation: 'workspace_read', allowed_roots: roots, host_access: hostAccess },
    {
      capability_id: hostAccess ? 'acp.host.execute.full_access_blacklist_v1' : 'acp.workspace.execute.read_only',
      operation: 'workspace_execute',
      allowed_roots: roots,
      command_policy: hostAccess ? 'full_access_blacklist_v1' : 'read_only',
      host_access: hostAccess,
    },
    { capability_id: 'acp.workspace.permissions.read', operation: 'workspace_permissions', allowed_roots: roots, access: 'read', host_access: hostAccess },
  ];
  if (profile === 'workspace_write' || profile === 'danger_full_access') {
    capabilities.push(
      { capability_id: 'acp.workspace.write', operation: 'workspace_write', allowed_roots: roots, host_access: hostAccess },
      ...(!hostAccess ? [{ capability_id: 'acp.workspace.execute.test', operation: 'workspace_execute' as const, allowed_roots: roots, command_policy: 'workspace_test' as const }] : []),
      { capability_id: 'acp.workspace.permissions.write', operation: 'workspace_permissions', allowed_roots: roots, access: 'write', host_access: hostAccess },
    );
  }
  if (hostAccess) capabilities.push({ capability_id: 'acp.host.network', operation: 'network', host_access: true });
  for (const item of input.trusted_mcp_tools || []) {
    const server = String(item.server || '').trim();
    const tool = String(item.tool || '').trim();
    if (!safeCapabilitySegment(server) || !safeCapabilitySegment(tool)) continue;
    capabilities.push({
      capability_id: `mcp.${server}.${tool}`,
      operation: 'mcp',
      server,
      tool,
    });
  }
  return capabilities;
}

export function buildACPChildEnvironment(
  providerEnv: Record<string, string> = {},
  parentEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ACP_PARENT_ENV_ALLOWLIST) {
    const value = parentEnv[key];
    if (safeACPEnvironmentValue(key, value)) result[key] = value;
  }
  for (const key of ACP_PROVIDER_ENV_ALLOWLIST) {
    const value = providerEnv[key];
    if (safeACPEnvironmentValue(key, value)) result[key] = value;
  }
  result.HOME ||= homedir();
  result.PATH ||= '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  result.TMPDIR ||= tmpdir();
  return result;
}

export async function inspectACPProvider(config: ACPProviderRuntimeConfig): Promise<ACPProviderInspection> {
  let handle: ACPConnectionHandle | undefined;
  try {
    handle = await openACPConnection({ ...config, permission_profile: 'read_only' });
    const modelInventory = acpSessionModelInventory(handle.session);
    return {
      ok: true,
      status: 'ready',
      provider_id: config.provider_id,
      protocol: 'acp',
      command: config.command,
      agent_name: handle.initialize.agentInfo?.title || handle.initialize.agentInfo?.name,
      agent_version: handle.initialize.agentInfo?.version,
      protocol_version: handle.initialize.protocolVersion,
      current_model: modelInventory.currentModelId || undefined,
      models: modelInventory.availableModels.map((model) => ({ id: model.modelId, name: model.name })),
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      provider_id: config.provider_id,
      protocol: 'acp',
      command: config.command,
      models: [],
      error_summary: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (handle) await releaseACPConnection(handle);
  }
}

export async function runACPChatTurn(req: ACPChatTurnRequest): Promise<ToolCallingTurnResult> {
  const callbacks = committedAnswerCallbacks(req.callbacks);
  const toolCalls = new Map<string, ToolCall>();
  const toolResults: ToolResult[] = [];
  const usage = emptyUsage();
  let responseText = '';
  let deltaIndex = 0;
  let leadingTextBuffer = '';
  let leadingTextResolved = false;
  let handle: ACPConnectionHandle | undefined;
  try {
    handle = await openACPConnection({
      ...req,
      permission_profile: req.permission_profile || 'read_only',
    }, (notification) => {
      const update = notification.update;
      callbacks?.onModelDelta?.({ step: 1, payload: { protocol: 'acp', session_update: update } });
      if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
        const emitAssistantText = (text: string) => {
          if (!text) return;
          responseText += text;
          callbacks?.onAssistantDelta?.({ step: 1, text, index: deltaIndex++ });
        };
        if (!leadingTextResolved) {
          leadingTextBuffer += update.content.text;
          const decision = filterACPLeadingSystemNotice(leadingTextBuffer);
          if (!decision.ready) return;
          leadingTextResolved = true;
          leadingTextBuffer = '';
          if (decision.notice) callbacks?.onModelDelta?.({ step: 1, payload: { protocol: 'acp', system_notice: decision.notice } });
          emitAssistantText(decision.text);
        } else {
          emitAssistantText(update.content.text);
        }
        return;
      }
      if (update.sessionUpdate === 'usage_update') {
        callbacks?.onModelDelta?.({ step: 1, payload: { protocol: 'acp', context_window: { size: update.size, used: update.used, cost: update.cost } } });
        return;
      }
      if (update.sessionUpdate === 'tool_call') {
        const call = acpToolCall(update);
        toolCalls.set(call.id, call);
        callbacks?.onToolCallRequested?.({ step: 1, call });
        if (update.status === 'in_progress' || update.status === 'pending' || !update.status) {
          callbacks?.onToolStarted?.({ step: 1, call });
        }
        if (update.status === 'completed' || update.status === 'failed') {
          finishACPTool(update, call, toolResults, callbacks);
        }
        return;
      }
      if (update.sessionUpdate === 'tool_call_update') {
        const existing = toolCalls.get(update.toolCallId) || acpToolCall(update);
        const call = mergeACPToolCall(existing, update);
        toolCalls.set(call.id, call);
        if (update.rawOutput !== undefined) {
          callbacks?.onToolOutputDelta?.({ step: 1, call, output: acpOutput(update.rawOutput) });
        }
        if (update.status === 'completed' || update.status === 'failed') {
          finishACPTool(update, call, toolResults, callbacks);
        }
      }
    }, (permission, outcome, decision) => {
      callbacks?.onModelDelta?.({
        step: 1,
        payload: {
          protocol: 'acp',
          permission: {
            tool_call_id: permission.toolCall.toolCallId,
            kind: permission.toolCall.kind,
            title: permission.toolCall.title,
            outcome: outcome.outcome,
            policy_capability: decision.capability_id || null,
            policy_reason: decision.reason,
          },
        },
      });
    });

    const requestedModel = (req.model || '').trim();
    const effectivePermissionMode = await setACPPermissionMode(
      handle,
      normalizePermissionProfile(req.permission_profile),
    );
    callbacks?.onModelDelta?.({
      step: 1,
      payload: {
        protocol: 'acp',
        permission_mode: {
          profile: normalizePermissionProfile(req.permission_profile),
          effective_mode: effectivePermissionMode,
          command_policy: normalizePermissionProfile(req.permission_profile) === 'danger_full_access'
            ? 'full_access_blacklist_v1'
            : 'sandbox_allowlist_v1',
        },
      },
    });
    const modelInventory = acpSessionModelInventory(handle.session);
    const availableModelIDs = modelInventory.availableModels.map((model) => model.modelId);
    let effectiveModel = modelInventory.currentModelId || 'default';
    if (requestedModel && requestedModel !== 'default') {
      if (!availableModelIDs.includes(requestedModel)) {
        throw new Error(acpUnavailableModelMessage(requestedModel, availableModelIDs));
      }
      effectiveModel = await setACPModel(handle, requestedModel);
    }
    const effectiveJoiTools = effectiveJoiMCPToolNames(req.mcp_servers, req.joi_capability_tools);
    await callbacks?.onEvent?.({
      type: 'work_summary.updated',
      step: 0,
      status: 'completed',
      detail: {
        phase: 'prepared',
        summary: effectiveJoiTools.length > 0
          ? `已准备 ${effectiveJoiTools.length} 项 Joi 能力`
          : '已准备 ACP 执行环境',
        user_visible: true,
        capability_count: effectiveJoiTools.length,
        capability_names: effectiveJoiTools,
        provider_id: req.provider_id,
      },
    });
    callbacks?.onModelDelta?.({
      step: 1,
      payload: {
        protocol: 'acp',
        model_selection: {
          requested_model: requestedModel || 'default',
          effective_model: effectiveModel,
        },
      },
    });
    const promptText = assembleACPPrompt(
      req.system_message,
      req.messages,
      req.mcp_servers,
      req.joi_capability_tools,
    );
    let nextPrompt = promptText;
    let finalStopReason = '';
    let promptTurn = 0;
    for (; promptTurn < 12; promptTurn += 1) {
      const step = promptTurn + 1;
      callbacks?.onModelStarted?.({ step, model: effectiveModel, streaming: true });
      const promptResponse = await withACPTimeout(
        handle.connection.prompt({
          sessionId: handle.session.sessionId,
          prompt: [{ type: 'text', text: nextPrompt }],
        }),
        req.timeout_seconds || 300,
        req.signal,
        async () => {
          await handle?.connection.cancel({ sessionId: handle?.session.sessionId || '' }).catch(() => undefined);
        },
      );
      if (promptResponse.usage) mergeUsage(usage, promptResponse.usage);
      finalStopReason = promptResponse.stopReason;
      const queued = await drainACPQueuedMessages(req);
      if (queued.length === 0) break;
      const queuedText = queued.map((message) => typeof message.content === 'string' ? message.content.trim() : '').filter(Boolean).join('\n\n');
      if (!queuedText) break;
      if (responseText.trim()) {
        responseText += '\n\n';
        callbacks?.onAssistantDelta?.({ step, text: '\n\n', index: deltaIndex++ });
      }
      await callbacks?.onEvent?.({
        type: 'run.message_queue_drained',
        step,
        status: 'completed',
        detail: { count: queued.length, next_prompt: true, protocol: 'acp' },
      });
      nextPrompt = queuedText;
    }
    if (!leadingTextResolved && leadingTextBuffer) {
      const decision = filterACPLeadingSystemNotice(leadingTextBuffer, true);
      if (decision.notice) callbacks?.onModelDelta?.({ step: 1, payload: { protocol: 'acp', system_notice: decision.notice } });
      if (decision.text) {
        responseText += decision.text;
        callbacks?.onAssistantDelta?.({ step: 1, text: decision.text, index: deltaIndex++ });
      }
      leadingTextResolved = true;
      leadingTextBuffer = '';
    }
    const usageStatus = usage.total_tokens > 0 ? 'recorded' : 'provider_missing';
    callbacks?.onUsage?.({ step: 1, usage, usage_status: usageStatus });
    callbacks?.onAssistantCompleted?.({ step: promptTurn + 1, text: responseText, finish_reason: finalStopReason, usage_status: usageStatus });
    callbacks?.onModelCompleted?.({ step: promptTurn + 1, finish_reason: finalStopReason, usage_status: usageStatus });
    const distinctToolResults = [...new Map(toolResults.map((result) => [result.call_id, result])).values()];
    const failedToolCount = distinctToolResults.filter((result) => String(result.output.status || '').toLowerCase() === 'failed').length;
    const succeededToolCount = distinctToolResults.length - failedToolCount;
    await callbacks?.onEvent?.({
      type: 'work_summary.updated',
      step: 1,
      status: 'completed',
      detail: {
        phase: 'verified',
        summary: distinctToolResults.length === 0
          ? '执行完成 · 未调用工具'
          : failedToolCount > 0
            ? `执行完成 · ${succeededToolCount} 项成功，${failedToolCount} 项失败`
            : `执行完成 · ${succeededToolCount} 项成功`,
        user_visible: true,
        succeeded_tool_count: succeededToolCount,
        failed_tool_count: failedToolCount,
        tool_count: distinctToolResults.length,
      },
    });
    return {
      status: 'completed',
      final_message: responseText.trim(),
      tool_results: toolResults,
      usage,
      usage_status: usageStatus,
      finish_reason: finalStopReason,
      model_responses: [{
        protocol: 'acp',
        provider_id: req.provider_id,
        session_id: handle.session.sessionId,
        requested_model: requestedModel || 'default',
        effective_model: effectiveModel,
        stop_reason: finalStopReason,
        agent: handle.initialize.agentInfo,
      }],
    };
  } catch (error) {
    const normalized = error instanceof ACPProcessError
      ? error
      : normalizedACPError(error, responseText);
    callbacks?.onError?.({ step: 1, error: normalized });
    throw normalized;
  } finally {
    if (handle) {
      const cleanupError = await releaseACPConnection(handle);
      if (cleanupError) {
        callbacks?.onModelDelta?.({
          step: 1,
          payload: {
            protocol: 'acp',
            session_cleanup: {
              status: 'failed',
              mode: 'close',
              error: cleanupError,
            },
          },
        });
      }
    }
  }
}

type ACPModelInventory = {
  currentModelId: string;
  availableModels: Array<{ modelId: string; name?: string }>;
};

function acpSessionModelInventory(session: NewSessionResponse): ACPModelInventory {
  const legacy = (session as NewSessionResponse & { models?: ACPModelInventory }).models;
  if (legacy?.availableModels?.length) return legacy;
  const configOptions = session.configOptions || [];
  const modelOption = configOptions.find((option) => option.type === 'select' && (option.category === 'model' || option.id === 'model'));
  const effortOption = configOptions.find((option) => option.type === 'select' && (option.category === 'thought_level' || option.id === 'reasoning_effort'));
  if (!modelOption || modelOption.type !== 'select') return { currentModelId: '', availableModels: [] };
  const models = flattenACPSelectOptions(modelOption);
  const efforts = effortOption?.type === 'select' ? flattenACPSelectOptions(effortOption) : [];
  const currentEffort = effortOption?.type === 'select' ? String(effortOption.currentValue || '') : '';
  const formatID = (model: string, effort: string) => effort ? `${model}[${effort}]` : model;
  const availableModels = models.flatMap((model) => {
    if (efforts.length === 0) return [{ modelId: String(model.value), name: model.name }];
    return efforts.map((effort) => ({
      modelId: formatID(String(model.value), String(effort.value)),
      name: `${model.name || model.value} (${effort.name || effort.value})`,
    }));
  });
  return {
    currentModelId: formatID(String(modelOption.currentValue || ''), currentEffort),
    availableModels,
  };
}

function flattenACPSelectOptions(option: Extract<SessionConfigOption, { type: 'select' }>): SessionConfigSelectOption[] {
  const options = option.options;
  if (options.length === 0) return [];
  if ('group' in options[0]) return options.flatMap((group) => 'options' in group ? group.options : []);
  return options as SessionConfigSelectOption[];
}

async function setACPPermissionMode(handle: ACPConnectionHandle, profile: PermissionProfile): Promise<string> {
  const desiredMode = profile === 'danger_full_access'
    ? 'agent-full-access'
    : profile === 'workspace_write' ? 'agent' : 'read-only';
  const configOptions = handle.session.configOptions || [];
  const modeOption = configOptions.find((option) => option.type === 'select' && (option.category === 'mode' || option.id === 'mode'));
  if (!modeOption || modeOption.type !== 'select') return 'provider-managed';
  if (!flattenACPSelectOptions(modeOption).some((option) => option.value === desiredMode)) {
    throw new Error(`ACP permission mode is not available: ${desiredMode}`);
  }
  await handle.connection.setSessionConfigOption({
    sessionId: handle.session.sessionId,
    configId: modeOption.id,
    value: desiredMode,
  });
  return desiredMode;
}

async function setACPModel(handle: ACPConnectionHandle, requestedModel: string): Promise<string> {
  const configOptions = handle.session.configOptions || [];
  const modelOption = configOptions.find((option) => option.type === 'select' && (option.category === 'model' || option.id === 'model'));
  if (!modelOption || modelOption.type !== 'select') {
    await handle.connection.extMethod('session/set_model', { sessionId: handle.session.sessionId, modelId: requestedModel });
    return requestedModel;
  }
  const match = requestedModel.match(/^(.*)\[([^\]]+)\]$/u);
  const baseModel = match ? match[1] : requestedModel;
  const requestedEffort = match ? match[2] : '';
  let updatedOptions = (await handle.connection.setSessionConfigOption({
    sessionId: handle.session.sessionId,
    configId: modelOption.id,
    value: baseModel,
  })).configOptions || configOptions;
  if (requestedEffort) {
    const effortOption = updatedOptions.find((option) => option.type === 'select' && (option.category === 'thought_level' || option.id === 'reasoning_effort'));
    if (!effortOption || effortOption.type !== 'select' || !flattenACPSelectOptions(effortOption).some((option) => option.value === requestedEffort)) {
      throw new Error(`ACP reasoning effort is not available for ${baseModel}: ${requestedEffort}`);
    }
    updatedOptions = (await handle.connection.setSessionConfigOption({
      sessionId: handle.session.sessionId,
      configId: effortOption.id,
      value: requestedEffort,
    })).configOptions || updatedOptions;
  }
  return requestedModel;
}

function acpUnavailableModelMessage(requestedModel: string, availableModelIDs: string[]): string {
  const inventory = availableModelIDs.length > 0 ? availableModelIDs.join(', ') : 'none';
  return `ACP model is not available: ${requestedModel}. Available models: ${inventory}`;
}

async function openACPConnection(
  config: ACPProviderRuntimeConfig,
  onUpdate?: (notification: SessionNotification) => void,
  onPermission?: (request: RequestPermissionRequest, outcome: RequestPermissionResponse, decision: ACPPermissionDecision) => void,
): Promise<ACPConnectionHandle> {
  if (!config.command.trim()) throw new Error('ACP command is required');
  if (!config.cwd.startsWith('/')) throw new Error('ACP cwd must be an absolute path');
  const stderrSummary = new ACPStderrSummary();
  const child = spawn(config.command, config.args || [], {
    cwd: config.cwd,
    env: buildACPChildEnvironment(config.env || {}),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderrSummary.observe(chunk);
  });
  const processFailure = new Promise<never>((_resolve, reject) => {
    child.once('error', () => {
      reject(new ACPProcessError('spawn_failed', null, null, stderrSummary.snapshot()));
    });
    child.once('exit', (code, signal) => {
      reject(new ACPProcessError('exited_before_session', code, signal, stderrSummary.snapshot()));
    });
  });
  const input = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
  const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
  const client = new JoiACPClient(
    normalizePermissionProfile(config.permission_profile),
    config.capability_allowlist || [],
    onUpdate,
    onPermission,
  );
  const connection = new ClientSideConnection(() => client, ndJsonStream(input, output));
  const close = () => closeACPProcess(child);
  try {
    const initialize = await Promise.race([
      connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'joi-desktop', title: 'Joi Desktop', version: '0.1.1' },
      }),
      processFailure,
    ]);
    if (initialize.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`ACP protocol mismatch: client=${PROTOCOL_VERSION} agent=${initialize.protocolVersion}`);
    }
    const authMethod = (config.auth_method || '').trim();
    if (authMethod && authMethod !== 'none' && initialize.authMethods?.some((method) => method.id === authMethod)) {
      await connection.authenticate({ methodId: authMethod });
    }
    const session = await Promise.race([
      connection.newSession({ cwd: config.cwd, mcpServers: config.mcp_servers || [] }),
      processFailure,
    ]);
    return { process: child, connection, client, initialize, session, close };
  } catch (error) {
    close();
    if (error instanceof ACPProcessError) throw error;
    const base = safeACPErrorMessage(error);
    const diagnostic = stderrSummary.snapshot();
    throw new Error(diagnostic.present ? `${base} · ACP stderr summary ${JSON.stringify(diagnostic)}` : base);
  }
}

function permissionOutcome(
  request: RequestPermissionRequest,
  allow: boolean,
): RequestPermissionResponse {
  const preferred = request.options.find((option) => option.kind === (allow ? 'allow_once' : 'reject_once'))
    || request.options.find((option) => allow ? option.kind.startsWith('allow_') : option.kind.startsWith('reject_'));
  return preferred
    ? { outcome: { outcome: 'selected', optionId: preferred.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

function mergeACPObservedToolCall(previous: ACPObservedToolCall | undefined, incoming: ToolCallUpdate): ACPObservedToolCall {
  const merged: ACPObservedToolCall = {
    toolCallId: incoming.toolCallId,
  };
  for (const key of ['title', 'kind', 'status', 'rawInput', 'rawOutput', 'locations', 'content', '_meta'] as const) {
    const next = incoming[key];
    const prior = previous?.[key];
    if (next !== undefined) Object.assign(merged, { [key]: next });
    else if (prior !== undefined) Object.assign(merged, { [key]: prior });
  }
  return merged;
}

function evaluateACPPermission(
  call: ACPObservedToolCall,
  profile: PermissionProfile,
  allowlist: readonly ACPCompiledCapability[],
): ACPPermissionDecision {
  const mcpIdentity = trustedMCPIdentity(call);
  if (mcpIdentity) {
    const capability = allowlist.find((item) => item.operation === 'mcp'
      && item.server === mcpIdentity.server
      && item.tool === mcpIdentity.tool);
    if (!capability) return denyACPPermission('mcp_tool_not_in_compiled_allowlist');
    if (!validateTrustedMCPArguments(mcpIdentity.server, mcpIdentity.tool, mcpIdentity.arguments)) {
      return denyACPPermission('mcp_arguments_failed_validation');
    }
    return allowACPPermission(capability, 'compiled_mcp_capability');
  }

  const rawInput = isRecord(call.rawInput) ? call.rawInput : {};
  if (Object.prototype.hasOwnProperty.call(rawInput, 'command')) {
    return evaluateACPCommandPermission(rawInput, profile, allowlist);
  }
  if (Object.prototype.hasOwnProperty.call(rawInput, 'permissions')) {
    return evaluateACPRequestedPermissions(rawInput.permissions, profile, allowlist);
  }

  const paths = extractACPToolPaths(call);
  const hasDiff = (call.content || []).some((item) => item.type === 'diff');
  const hasDeleteDiff = (call.content || []).some((item) => item.type === 'diff'
    && isRecord(item._meta) && item._meta.kind === 'delete');
  if ((call.kind === 'delete' || hasDeleteDiff) && profile !== 'danger_full_access') {
    return denyACPPermission('destructive_operation_denied');
  }
  if (call.kind === 'edit' || call.kind === 'move' || hasDiff) {
    if (profile !== 'workspace_write' && profile !== 'danger_full_access') {
      return denyACPPermission('workspace_write_profile_required');
    }
    const capability = findWorkspaceCapability(allowlist, 'workspace_write', paths);
    return capability
      ? allowACPPermission(capability, 'validated_workspace_write_paths')
      : denyACPPermission('workspace_write_paths_outside_compiled_scope');
  }
  if (['read', 'search', 'fetch'].includes(call.kind || '') && paths.length > 0) {
    const capability = findWorkspaceCapability(allowlist, 'workspace_read', paths);
    return capability
      ? allowACPPermission(capability, 'validated_workspace_read_paths')
      : denyACPPermission('workspace_read_paths_outside_compiled_scope');
  }
  return denyACPPermission('unknown_or_unverifiable_tool');
}

function trustedMCPIdentity(call: ACPObservedToolCall): { server: string; tool: string; arguments: unknown } | undefined {
  if (!isRecord(call._meta) || call._meta.is_mcp_tool_call !== true || !isRecord(call.rawInput)) return undefined;
  const server = typeof call.rawInput.server === 'string' ? call.rawInput.server.trim() : '';
  const tool = typeof call.rawInput.tool === 'string' ? call.rawInput.tool.trim() : '';
  if (!safeCapabilitySegment(server) || !safeCapabilitySegment(tool)) return undefined;
  return { server, tool, arguments: call.rawInput.arguments };
}

function validateTrustedMCPArguments(server: string, tool: string, value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (server !== 'joi_web') return true;
  if (tool === 'web_search') {
    if (Object.keys(value).some((key) => key !== 'query' && key !== 'max_results')) return false;
    const query = typeof value.query === 'string' ? value.query.trim() : '';
    const maxResults = value.max_results === undefined ? 5 : Number(value.max_results);
    return query.length > 0 && query.length <= 4_096 && Number.isInteger(maxResults) && maxResults >= 1 && maxResults <= 10;
  }
  if (tool === 'web_extract') {
    if (Object.keys(value).some((key) => key !== 'url')) return false;
    const url = safeHTTPURL(value.url);
    return Boolean(url);
  }
  return false;
}

async function drainACPQueuedMessages(req: ACPChatTurnRequest): Promise<Array<Record<string, unknown>>> {
  const steering = req.getSteeringMessages ? await req.getSteeringMessages() : [];
  if (Array.isArray(steering) && steering.length > 0) return steering;
  const followUp = req.getFollowUpMessages ? await req.getFollowUpMessages() : [];
  return Array.isArray(followUp) ? followUp : [];
}

function evaluateACPCommandPermission(
  rawInput: Record<string, unknown>,
  profile: PermissionProfile,
  allowlist: readonly ACPCompiledCapability[],
): ACPPermissionDecision {
  const argv = parseACPCommand(rawInput.command);
  const cwd = typeof rawInput.cwd === 'string' ? rawInput.cwd.trim() : '';
  if (!cwd) return denyACPPermission('command_or_cwd_missing');
  if (profile === 'danger_full_access') {
    const capability = allowlist.find((item) => item.operation === 'workspace_execute'
      && item.command_policy === 'full_access_blacklist_v1'
      && pathAllowedByCapability(cwd, item));
    if (!capability) return denyACPPermission('full_access_command_capability_missing');
    try {
      validateFullAccessCommandInput(rawInput.command, 'acp_terminal');
    } catch {
      return denyACPPermission('command_blacklisted_by_full_access_blacklist_v1');
    }
    return allowACPPermission(capability, 'validated_full_access_blacklist_v1_command');
  }
  if (!argv || argv.length === 0) return denyACPPermission('command_or_cwd_missing');
  const capabilities = allowlist.filter((item) => item.operation === 'workspace_execute');
  for (const capability of capabilities) {
    if (capability.command_policy === 'workspace_test' && profile !== 'workspace_write') continue;
    if (validateACPCommandAgainstCapability(argv, cwd, capability)) {
      return allowACPPermission(capability, `validated_${capability.command_policy || 'unknown'}_command`);
    }
  }
  return denyACPPermission('command_not_in_compiled_allowlist_or_outside_workspace');
}

function evaluateACPRequestedPermissions(
  value: unknown,
  profile: PermissionProfile,
  allowlist: readonly ACPCompiledCapability[],
): ACPPermissionDecision {
  if (!isRecord(value)) return denyACPPermission('permission_payload_invalid');
  if (Object.keys(value).some((key) => key !== 'network' && key !== 'fileSystem')) {
    return denyACPPermission('unknown_permission_category');
  }
  const networkRequested = isRecord(value.network) && value.network.enabled === true;
  const networkCapability = networkRequested && profile === 'danger_full_access'
    ? allowlist.find((item) => item.operation === 'network' && item.host_access === true)
    : undefined;
  if (networkRequested && !networkCapability) return denyACPPermission('network_permission_not_delegated');
  if (!isRecord(value.fileSystem)) {
    return networkCapability
      ? allowACPPermission(networkCapability, 'validated_host_network_permission')
      : denyACPPermission('filesystem_permission_missing');
  }
  if (Object.keys(value.fileSystem).some((key) => key !== 'read' && key !== 'write' && key !== 'entries')) {
    return denyACPPermission('unknown_filesystem_permission');
  }
  if (Array.isArray(value.fileSystem.entries) && value.fileSystem.entries.length > 0) {
    return denyACPPermission('filesystem_entries_permission_not_supported');
  }
  const readPaths = stringArray(value.fileSystem.read);
  const writePaths = stringArray(value.fileSystem.write);
  if (readPaths.length === 0 && writePaths.length === 0) return denyACPPermission('empty_filesystem_permission');
  const readCapability = readPaths.length > 0
    ? findWorkspacePermissionCapability(allowlist, 'read', readPaths)
    : undefined;
  if (readPaths.length > 0 && !readCapability) return denyACPPermission('filesystem_read_outside_compiled_scope');
  if (writePaths.length > 0 && profile !== 'workspace_write' && profile !== 'danger_full_access') {
    return denyACPPermission('filesystem_write_profile_required');
  }
  const writeCapability = writePaths.length > 0
    ? findWorkspacePermissionCapability(allowlist, 'write', writePaths)
    : undefined;
  if (writePaths.length > 0 && !writeCapability) return denyACPPermission('filesystem_write_outside_compiled_scope');
  const capability = writeCapability || readCapability || networkCapability;
  return capability
    ? allowACPPermission(capability, 'validated_workspace_permission_request')
    : denyACPPermission('permission_not_in_compiled_allowlist');
}

function findWorkspaceCapability(
  allowlist: readonly ACPCompiledCapability[],
  operation: ACPCompiledCapability['operation'],
  paths: string[],
): ACPCompiledCapability | undefined {
  if (paths.length === 0) return undefined;
  return allowlist.find((item) => item.operation === operation && paths.every((path) => pathAllowedByCapability(path, item)));
}

function findWorkspacePermissionCapability(
  allowlist: readonly ACPCompiledCapability[],
  access: 'read' | 'write',
  paths: string[],
): ACPCompiledCapability | undefined {
  return allowlist.find((item) => item.operation === 'workspace_permissions'
    && item.access === access
    && paths.every((path) => pathAllowedByCapability(path, item)));
}

function extractACPToolPaths(call: ACPObservedToolCall): string[] {
  const paths = new Set<string>();
  for (const location of call.locations || []) {
    if (typeof location.path === 'string' && location.path.trim()) paths.add(location.path.trim());
  }
  for (const item of call.content || []) {
    if (item.type === 'diff' && typeof item.path === 'string' && item.path.trim()) paths.add(item.path.trim());
  }
  if (isRecord(call.rawInput)) {
    for (const key of ['path', 'root', 'file', 'target', 'destination', 'old_path', 'new_path']) {
      const item = call.rawInput[key];
      if (typeof item === 'string' && item.trim()) paths.add(item.trim());
    }
    for (const key of ['paths', 'files']) {
      for (const item of stringArray(call.rawInput[key])) paths.add(item);
    }
  }
  return [...paths];
}

function validateACPCommandAgainstCapability(argv: string[], cwd: string, capability: ACPCompiledCapability): boolean {
  if (!pathAllowedByCapability(cwd, capability)) return false;
  if (!argv.every(safeACPCommandArgument)) return false;
  const executable = argv[0];
  if (basename(executable) !== executable) return false;
  if (capability.command_policy === 'workspace_test') return validateACPWorkspaceTestCommand(argv, cwd, capability);
  if (capability.command_policy !== 'read_only') return false;
  switch (executable) {
    case 'pwd':
      return argv.length === 1;
    case 'ls':
      return validateACPReadCommandPaths(argv.slice(1), cwd, capability, new Set(['-a', '-l', '-la', '-al', '-1', '--']));
    case 'cat':
      return validateACPReadCommandPaths(argv.slice(1), cwd, capability, new Set(['-n', '-b', '-s', '--']), true);
    case 'rg':
    case 'grep':
      return !argv.slice(1).some((item) => /^(--hidden|--no-ignore|--follow|--pre(?:=|$)|--hostname-bin(?:=|$))/.test(item))
        && argv.slice(1).every((item) => item.startsWith('-') || pathAllowedByCapability(resolve(cwd, item), capability));
    case 'find':
      return !argv.slice(1).some((item) => ['-H', '-L', '-follow', '-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprintf'].includes(item))
        && argv.slice(1).every((item) => item.startsWith('-') || ['!', '(', ')'].includes(item) || pathAllowedByCapability(resolve(cwd, item), capability));
    case 'git':
      return validateACPReadOnlyGitCommand(argv.slice(1), cwd, capability);
    default:
      return false;
  }
}

function validateACPReadCommandPaths(
  args: string[],
  cwd: string,
  capability: ACPCompiledCapability,
  allowedFlags: Set<string>,
  requirePath = false,
): boolean {
  const paths = args.filter((item) => !item.startsWith('-'));
  if (requirePath && paths.length === 0) return false;
  return args.every((item) => item.startsWith('-') ? allowedFlags.has(item) : pathAllowedByCapability(resolve(cwd, item), capability));
}

function validateACPReadOnlyGitCommand(args: string[], cwd: string, capability: ACPCompiledCapability): boolean {
  const subcommand = args[0];
  if (!['status', 'diff', 'log', 'show'].includes(subcommand || '')) return false;
  if (args.slice(1).some((item) => item === '--ext-diff' || item.startsWith('--output') || item.startsWith('--exec') || item === '-c')) return false;
  return args.slice(1).every((item) => item.startsWith('-') || pathAllowedByCapability(resolve(cwd, item), capability));
}

function validateACPWorkspaceTestCommand(argv: string[], cwd: string, capability: ACPCompiledCapability): boolean {
  const [executable, ...args] = argv;
  const cwdChangingFlags = new Set(['-C', '--cwd', '--dir', '--prefix', '--global-dir', '--script-shell']);
  if (args.some((item) => cwdChangingFlags.has(item) || [...cwdChangingFlags].some((flag) => item.startsWith(`${flag}=`)))) return false;
  if (!args.every((item) => !pathLikeCommandArgument(item) || pathAllowedByCapability(resolve(cwd, item), capability))) return false;
  if (executable === 'go') return args[0] === 'test' && !args.some((item) => item.startsWith('-exec') || item.startsWith('-toolexec'));
  if (executable === 'npm') {
    return (args.length === 1 && args[0] === 'test')
      || (args[0] === 'run' && allowedACPTestScript(args[1]) && args.slice(2).every((item) => item.startsWith('-')));
  }
  if (executable === 'pnpm') {
    let index = 0;
    while (args[index] === '--filter' || args[index] === '-F') index += 2;
    if (args[index] === '--workspace-root' || args[index] === '-w') index += 1;
    if (args[index] === 'run') index += 1;
    return allowedACPTestScript(args[index]) && args.slice(index + 1).every((item) => item.startsWith('-'));
  }
  if (executable === 'yarn') {
    let index = 0;
    if (args[index] === 'run') index += 1;
    return allowedACPTestScript(args[index]) && args.slice(index + 1).every((item) => item.startsWith('-'));
  }
  return false;
}

function allowedACPTestScript(value: string | undefined): boolean {
  const text = String(value || '').trim();
  return text === 'test' || text === 'build' || text.startsWith('test:') || text.startsWith('build:');
}

function parseACPCommand(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const argv = value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
    return argv.length === value.length ? argv : undefined;
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > 16_384) return undefined;
  const argv: string[] = [];
  let token = '';
  let quote = '';
  let escaped = false;
  for (const char of value) {
    if (char === '\0' || char === '\n' || char === '\r' || char === '$' || char === '`') return undefined;
    if (!quote && [';', '&', '|', '>', '<', '(', ')'].includes(char)) return undefined;
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (char === "'" || char === '"') {
      if (!quote) quote = char;
      else if (quote === char) quote = '';
      else token += char;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (token) argv.push(token);
      token = '';
      continue;
    }
    token += char;
  }
  if (escaped || quote) return undefined;
  if (token) argv.push(token);
  return argv.length > 0 ? argv : undefined;
}

function safeACPCommandArgument(value: string): boolean {
  const text = value.trim();
  if (!text || value.includes('\0') || text.startsWith('~') || hasParentTraversal(text) || blockedACPPath(text)) return false;
  if (text.includes('=/') || text.includes(':/')) return false;
  return true;
}

function pathLikeCommandArgument(value: string): boolean {
  if (!value || value.startsWith('-')) return false;
  return isAbsolute(value) || value.startsWith('.') || value.includes('/');
}

function pathAllowedByCapability(input: string, capability: ACPCompiledCapability): boolean {
  if (!input || input.includes('\0') || input.trim().startsWith('~')) return false;
  if (!capability.host_access && blockedACPPath(input)) return false;
  const roots = capability.allowed_roots || [];
  const candidates = isAbsolute(input) ? [input] : roots.map((root) => resolve(root, input));
  return candidates.some((inputPath) => {
    const candidate = canonicalBoundaryPath(inputPath);
    return roots.some((root) => pathWithinRoot(candidate, canonicalBoundaryPath(root)));
  });
}

function canonicalBoundaryPath(input: string): string {
  let candidate = resolve(input);
  if (existsSync(candidate)) {
    try {
      return realpathSync(candidate);
    } catch {
      return candidate;
    }
  }
  const missing: string[] = [];
  let ancestor = candidate;
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) {
    missing.unshift(basename(ancestor));
    ancestor = dirname(ancestor);
  }
  try {
    ancestor = realpathSync(ancestor);
  } catch {
    // Keep the normalized ancestor when it cannot be resolved.
  }
  candidate = resolve(ancestor, ...missing);
  return candidate;
}

function uniqueAbsoluteRoots(values: string[]): string[] {
  const roots: string[] = [];
  for (const value of values) {
    if (!isAbsolute(value)) continue;
    const candidate = canonicalBoundaryPath(value);
    if (!roots.some((root) => pathWithinRoot(candidate, root))) roots.push(candidate);
  }
  return roots;
}

function pathWithinRoot(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function blockedACPPath(value: string): boolean {
  const lower = value.toLowerCase().replaceAll('\\', '/');
  if (/(^|[/:])\.env(?:\.|$|\/)/.test(lower)) return true;
  if (/(^|[/:])\.(ssh|codex)(?:\/|$)/.test(lower)) return true;
  if (/(^|[/:])\.git\/config(?:$|[:/])/.test(lower) || lower.includes('/library/keychains/') || lower.includes('/private/etc/') || lower.includes('/var/db/')) return true;
  return lower.endsWith('.keychain-db') || lower.endsWith('/id_rsa') || lower.endsWith('/id_ed25519');
}

function hasParentTraversal(value: string): boolean {
  return value.replaceAll('\\', '/').split('/').includes('..');
}

function safeHTTPURL(value: unknown): URL | undefined {
  if (typeof value !== 'string' || value.length > 8_192) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  if (!value.every((item) => typeof item === 'string' && item.trim())) return [];
  return value.map((item) => String(item).trim());
}

function allowACPPermission(capability: ACPCompiledCapability, reason: string): ACPPermissionDecision {
  return { allow: true, capability_id: capability.capability_id, reason };
}

function denyACPPermission(reason: string): ACPPermissionDecision {
  return { allow: false, reason };
}

function safeCapabilitySegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

function acpToolCall(update: ToolCallUpdate): ToolCall {
  return {
    id: update.toolCallId,
    name: update.title || update.toolCallId,
    arguments: isRecord(update.rawInput) ? update.rawInput : update.rawInput === undefined ? {} : { value: update.rawInput },
    raw_arguments: update.rawInput,
  };
}

function mergeACPToolCall(call: ToolCall, update: ToolCallUpdate): ToolCall {
  return {
    ...call,
    name: update.title || call.name,
    arguments: update.rawInput === undefined ? call.arguments : isRecord(update.rawInput) ? update.rawInput : { value: update.rawInput },
    raw_arguments: update.rawInput === undefined ? call.raw_arguments : update.rawInput,
  };
}

function finishACPTool(update: ToolCallUpdate, call: ToolCall, results: ToolResult[], callbacks?: ToolCallingCallbacks) {
  if (results.some((result) => result.call_id === call.id)) return;
  const result: ToolResult = {
    call_id: call.id,
    name: call.name,
    arguments: call.arguments,
    output: {
      status: update.status === 'failed' ? 'failed' : 'succeeded',
      protocol: 'acp',
      kind: update.kind || 'other',
      raw_output: update.rawOutput ?? update.content ?? null,
    },
  };
  results.push(result);
  if (update.status === 'failed') callbacks?.onToolFailed?.({ step: 1, call, result, error: new Error(`${call.name} failed`) });
  else callbacks?.onToolCompleted?.({ step: 1, call, result });
}

function acpOutput(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : { value };
}

function assembleACPPrompt(
  systemMessage: string,
  messages: Array<{ role: string; content: string }>,
  mcpServers: McpServer[] | undefined,
  joiCapabilityTools: string[] | undefined,
): string {
  const transcript = messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n');
  const joiWebAvailable = (mcpServers || []).some((server) => server.name === 'joi_web');
  const delegatedToolNames = [...new Set((joiCapabilityTools || []).map((name) => name.trim()).filter(Boolean))].sort();
  return [
    'You are running as a delegated ACP coding agent inside Joi Desktop.',
    'Follow the host policy and the current user request. Do not claim a tool action succeeded unless the tool actually completed.',
    joiWebAvailable
      ? [
          'For public web research, use the policy-controlled Joi MCP tools whose full Codex names are mcp__joi_web__web_search and mcp__joi_web__web_extract.',
          'This Codex build may defer MCP schemas behind its built-in tool_search catalog. If either full tool name is not already visible, call tool_search for "joi_web web_search web_extract" before concluding that the tools are unavailable.',
          'Do not claim the Joi web tools are unavailable unless that discovery attempt returned no match. Do not substitute the Codex in-app Browser when these tools satisfy the request.',
        ].join(' ')
      : '',
    delegatedToolNames.length > 0
      ? [
          `The selected Joi Agent also grants these policy-controlled delegated tools: ${delegatedToolNames.map((name) => `mcp__joi_capabilities__${name}`).join(', ')}.`,
          `Use only the granted tools that fit the task. If a full tool name is not visible, call tool_search for "joi_capabilities ${delegatedToolNames.join(' ')}" before concluding it is unavailable.`,
          'These tools still execute through Joi policy, workspace-root, capability-enable, and audit checks.',
        ].join(' ')
      : '',
    '<JOI_SYSTEM_CONTEXT>',
    systemMessage,
    '</JOI_SYSTEM_CONTEXT>',
    '<CONVERSATION>',
    transcript,
    '</CONVERSATION>',
  ].filter(Boolean).join('\n\n');
}

function effectiveJoiMCPToolNames(mcpServers: McpServer[] | undefined, delegatedTools: string[] | undefined): string[] {
  const names = new Set<string>();
  if ((mcpServers || []).some((server) => server.name === 'joi_web')) {
    names.add('web_search');
    names.add('web_extract');
  }
  for (const name of delegatedTools || []) {
    const normalized = name.trim();
    if (normalized) names.add(normalized);
  }
  return [...names].sort();
}

function filterACPLeadingSystemNotice(value: string, force = false): { ready: boolean; text: string; notice?: string } {
  const prefixes = [
    'Warning: Skill descriptions were shortened to fit the 2% skills context budget.',
  ];
  if (!force && prefixes.some((prefix) => prefix.startsWith(value))) return { ready: false, text: '' };
  const matched = prefixes.find((prefix) => value.startsWith(prefix));
  if (!matched) return { ready: true, text: value };
  const separator = value.indexOf('\n\n');
  if (separator < 0 && !force && value.length < 2_048) return { ready: false, text: '' };
  if (separator < 0) return { ready: true, text: '', notice: value.trim() };
  return {
    ready: true,
    text: value.slice(separator + 2),
    notice: value.slice(0, separator).trim(),
  };
}

function emptyUsage(): ToolCallingTurnResult['usage'] {
  return { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, reasoning_tokens: 0, total_tokens: 0 };
}

function mergeUsage(target: ToolCallingTurnResult['usage'], value: { inputTokens?: number | null; outputTokens?: number | null; cachedReadTokens?: number | null; cachedWriteTokens?: number | null; thoughtTokens?: number | null; totalTokens?: number | null }) {
  const uncachedInputTokens = nonNegativeTokenCount(value.inputTokens, target.input_tokens);
  const cachedReadTokens = nonNegativeTokenCount(value.cachedReadTokens, target.cached_input_tokens);
  const cachedWriteTokens = nonNegativeTokenCount(value.cachedWriteTokens, target.cache_write_input_tokens);
  target.input_tokens = uncachedInputTokens + cachedReadTokens + cachedWriteTokens;
  target.output_tokens = nonNegativeTokenCount(value.outputTokens, target.output_tokens);
  target.cached_input_tokens = cachedReadTokens;
  target.cache_write_input_tokens = cachedWriteTokens;
  target.reasoning_tokens = nonNegativeTokenCount(value.thoughtTokens, target.reasoning_tokens);
  target.total_tokens = nonNegativeTokenCount(value.totalTokens, target.input_tokens + target.output_tokens);
}

function nonNegativeTokenCount(value: number | null | undefined, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

const ACP_PARENT_ENV_ALLOWLIST = [
  'HOME',
  'USER',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'NO_COLOR',
  'COLORTERM',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'CODEX_HOME',
  'CODEX_PATH',
] as const;

const ACP_PROVIDER_ENV_ALLOWLIST = [
  ...ACP_PARENT_ENV_ALLOWLIST,
  'CODEX_CONFIG',
  'DEFAULT_AUTH_REQUEST',
  'MODEL_PROVIDER',
  'DISABLE_MCP_CONFIG_FILTERING',
  'ELECTRON_RUN_AS_NODE',
  'JOI_ACP_EPHEMERAL',
  'JOI_PARENT_RUN_ID',
  'JOI_PARENT_CONVERSATION_ID',
  'JOI_DELEGATION_DEPTH',
] as const;

function safeACPEnvironmentValue(key: string, value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return false;
  if (/^(?:https?|all|no)_proxy$/i.test(key)) {
    try {
      const url = new URL(value);
      return !url.username && !url.password;
    } catch {
      return key.toLowerCase() === 'no_proxy' && value.length <= 8_192;
    }
  }
  return value.length <= 64 * 1024;
}

type ACPStderrDiagnostic = {
  present: boolean;
  observed_bytes: number;
  observed_lines: number;
  chunks: number;
  truncated: boolean;
  categories: string[];
};

class ACPStderrSummary {
  private observedBytes = 0;
  private newlines = 0;
  private chunks = 0;
  private endsWithNewline = true;
  private readonly categories = new Set<string>();

  observe(chunk: string): void {
    if (!chunk) return;
    this.observedBytes += Buffer.byteLength(chunk);
    this.newlines += (chunk.match(/\n/g) || []).length;
    this.chunks += 1;
    this.endsWithNewline = chunk.endsWith('\n');
    const lower = chunk.toLowerCase();
    if (/auth|login|credential/.test(lower)) this.categories.add('authentication');
    if (/permission|denied|sandbox/.test(lower)) this.categories.add('permission');
    if (/network|socket|connect|dns|tls/.test(lower)) this.categories.add('network');
    if (/not found|enoent|missing/.test(lower)) this.categories.add('not_found');
    if (/protocol|json|parse/.test(lower)) this.categories.add('protocol');
    if (/token|secret|api[_ -]?key|password|bearer/.test(lower)) this.categories.add('sensitive_content_redacted');
    if (this.categories.size === 0) this.categories.add('unspecified');
  }

  snapshot(): ACPStderrDiagnostic {
    return {
      present: this.observedBytes > 0,
      observed_bytes: this.observedBytes,
      observed_lines: this.newlines + (this.observedBytes > 0 && !this.endsWithNewline ? 1 : 0),
      chunks: this.chunks,
      truncated: this.observedBytes > 16_384,
      categories: [...this.categories].sort(),
    };
  }
}

class ACPProcessError extends Error {
  constructor(
    reason: 'spawn_failed' | 'exited_before_session',
    code: number | null,
    signal: string | null,
    stderr: ACPStderrDiagnostic,
  ) {
    super(`ACP process failure ${JSON.stringify({ reason, code, signal: signal || null, stderr })}`);
    this.name = 'ACPProcessError';
  }
}

export function safeACPErrorMessage(error: unknown): string {
  return redactACPErrorText(extractACPErrorText(error)).slice(0, 4_096) || 'ACP operation failed';
}

function normalizedACPError(error: unknown, responseText: string): Error & { code?: string } {
  const notice = extractACPSystemErrorNotice(responseText);
  const normalized = new Error(notice || safeACPErrorMessage(error)) as Error & { code?: string };
  if (error instanceof Error && error.name === 'AbortError') normalized.name = 'AbortError';
  const code = extractACPErrorCode(error);
  if (code) normalized.code = code;
  return normalized;
}

export function extractACPSystemErrorNotice(value: string): string {
  const text = String(value || '').trim();
  if (!text) return '';
  const paragraphs = text.split(/\n\s*\n/u).map((item) => item.trim()).filter(Boolean);
  const notice = paragraphs.find((item) => /^(?:you(?:'ve| have) hit your (?:usage|rate) limit\b|usage limit\b|rate limit\b|quota (?:exceeded|reached)\b|insufficient credits\b)/iu.test(item)
    || /\b(?:purchase more credits|try again at \d{1,2}:\d{2}\s*(?:am|pm))\b/iu.test(item));
  return notice ? redactACPErrorText(notice).slice(0, 4_096) : '';
}

function extractACPErrorText(error: unknown): string {
  const direct = meaningfulACPErrorString(error instanceof Error ? error.message : ownDataProperty(error, 'message'))
    || meaningfulACPErrorString(error);
  if (direct) return direct;

  const nestedError = ownDataProperty(error, 'error');
  const nested = meaningfulACPErrorString(
    nestedError instanceof Error ? nestedError.message : ownDataProperty(nestedError, 'message'),
  ) || meaningfulACPErrorString(nestedError);
  if (nested) return nested;

  const code = extractACPErrorCode(error);
  if (code) return code;

  const serialized = boundedACPErrorJSON(error);
  return serialized && !['{}', '[]', '"[object Object]"', '"[object Array]"'].includes(serialized)
    ? serialized
    : 'ACP operation failed';
}

function extractACPErrorCode(error: unknown): string {
  const code = ownDataProperty(error, 'code');
  if (typeof code === 'string' && code.trim()) return redactACPErrorText(code.trim()).slice(0, 256);
  if (typeof code === 'number' && Number.isFinite(code)) return String(code);
  const nestedError = ownDataProperty(error, 'error');
  const nestedCode = ownDataProperty(nestedError, 'code');
  if (typeof nestedCode === 'string' && nestedCode.trim()) return redactACPErrorText(nestedCode.trim()).slice(0, 256);
  if (typeof nestedCode === 'number' && Number.isFinite(nestedCode)) return String(nestedCode);
  return '';
}

function meaningfulACPErrorString(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text === '[object Object]' || text === '[object Array]' || text === 'undefined' || text === 'null') return '';
  return text.slice(0, 4_096);
}

function ownDataProperty(value: unknown, key: string): unknown {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function boundedACPErrorJSON(value: unknown): string {
  try {
    const bounded = boundedACPErrorValue(value, 0, new WeakSet<object>());
    const serialized = JSON.stringify(bounded);
    return typeof serialized === 'string' ? serialized.slice(0, 4_096) : '';
  } catch {
    return '';
  }
}

function boundedACPErrorValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 2_048);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return '[undefined]';
  if (typeof value === 'symbol' || typeof value === 'function') return `[${typeof value}]`;
  if (depth >= 4) return '[max-depth]';
  if (!value || typeof value !== 'object') return String(value).slice(0, 256);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.slice(0, 16).map((item) => boundedACPErrorValue(item, depth + 1, seen));
    const output: Record<string, unknown> = {};
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Object.keys(descriptors).slice(0, 24)) {
      const descriptor = descriptors[key];
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
      if (/stderr|raw[_-]?stderr/i.test(key)) {
        output[key] = '[REDACTED STDERR]';
      } else if (/token|secret|password|authorization|api[_-]?key/i.test(key)) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = boundedACPErrorValue(descriptor.value, depth + 1, seen);
      }
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function redactACPErrorText(source: string): string {
  return String(source || '')
    .replace(/\b(bearer)\s+[a-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*['"]?[^'",\s;}{]+/gi, (_match, key) => `${key}=[REDACTED]`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/([?&](?:access_token|token|key|secret|password)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\b(stderr|raw[_-]?stderr)\s*[:=][\s\S]*/gi, '$1=[REDACTED STDERR]')
    .replace(/\b[A-Za-z0-9_+/=-]{80,}\b/g, '[REDACTED]');
}

function normalizePermissionProfile(value: unknown): PermissionProfile {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'workspace_write') return 'workspace_write';
  if (text === 'danger_full_access') return 'danger_full_access';
  return 'read_only';
}

function closeACPProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.killed) return;
  child.stdin.end();
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
  }, 1_500);
  timer.unref?.();
}

async function releaseACPConnection(handle: ACPConnectionHandle): Promise<string | undefined> {
  let cleanupError: string | undefined;
  try {
    await withACPCleanupTimeout(
      handle.connection.closeSession({ sessionId: handle.session.sessionId }),
      2_000,
    );
  } catch (error) {
    cleanupError = safeACPErrorMessage(error);
  } finally {
    handle.close();
  }
  return cleanupError;
}

async function withACPCleanupTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`ACP session cleanup timed out after ${timeoutMs}ms`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withACPTimeout<T>(promise: Promise<T>, timeoutSeconds: number, signal: AbortSignal | undefined, onCancel: () => Promise<void>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const gate = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      void rejectAfterACPCancel(onCancel, reject, new Error(`ACP prompt timed out after ${timeoutSeconds}s`));
    }, Math.max(1, timeoutSeconds) * 1_000);
    timer.unref?.();
    if (signal) {
      abortHandler = () => {
        const error = new Error('ACP prompt aborted');
        error.name = 'AbortError';
        void rejectAfterACPCancel(onCancel, reject, error);
      };
      if (signal.aborted) abortHandler();
      else signal.addEventListener('abort', abortHandler, { once: true });
    }
  });
  try {
    return await Promise.race([promise, gate]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
  }
}

async function rejectAfterACPCancel(
  onCancel: () => Promise<void>,
  reject: (reason?: unknown) => void,
  error: Error,
): Promise<void> {
  try {
    await onCancel();
  } finally {
    reject(error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
