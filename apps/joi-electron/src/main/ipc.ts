import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { desktopIpcMethods, type DesktopIpcMethod, type JoiInvokeRequest } from '../../../../packages/shared-types/src/preload-api';
import type {
  ChatRequest,
  ConversationFilter,
  ModelConnectionTestRequest,
  ModelConfigRequest,
  ModelSettingsRequest,
  SettingsRecord,
  WorkspaceSettings,
} from '../../../../packages/shared-types/src/desktop-api';
import type { JoiSQLiteStore, PersistedToolResult, StartedToolCallingChat, ToolCallingPromptAssembly, ToolCallingResumeRequest } from '../../../../packages/store/src/sqlite';
import type { KeychainSecretStore } from '../../../../packages/secrets/src/keychain';
import { fetchAvailableModels, isLoopbackModelEndpoint, LOCAL_MODEL_PROXY_API_KEY, testModelConnection } from '../../../../packages/runtime/src/model';
import { DEFAULT_XAI_OAUTH_BASE_URL, isXAIOAuthProvider, resolveXAIOAuthCredentials, validateXAIInferenceBaseURL } from '../../../../packages/runtime/src/xai-oauth';
import { sendTestTelegramMessage, testTelegramConnection } from '../../../../packages/runtime/src/telegram';
import { executeFileAnalyze, executeFileRead, executeWebResearch, executeWorkspaceSearch } from '../../../../packages/runtime/src/capabilities';
import { executeApplyPatch, executeShellCommand, executeTestCommand } from '../../../../packages/runtime/src/workspace-exec';
import { executeBrowserClick, executeBrowserNavigate, executeBrowserObserve, executeBrowserType, executeComputerObserve } from '../../../../packages/runtime/src/browser-computer';
import { executeDesktopAppInspect, executeDesktopAppList } from '../../../../packages/runtime/src/desktop-apps';
import { executeServerDiagnose, executeSystemHealthCheck } from '../../../../packages/runtime/src/diagnostics';
import { runChatCompletionsToolTurn } from '../../../../packages/runtime/src/tool-calling';
import { compileElectronCapabilityTools } from '../../../../packages/runtime/src/capability-compiler';

const invokeRequestSchema = z.object({
  method: z.enum(desktopIpcMethods),
  payload: z.unknown().optional(),
}) satisfies z.ZodType<JoiInvokeRequest>;

const externalUrlSchema = z.string().url();

type Handler = (payload?: unknown) => Promise<unknown> | unknown;

export type AppDirs = {
  userDataDir: string;
  logDir: string;
  backupDir: string;
  dbPath: string;
};

export type RegisterIpcOptions = {
  onTelegramConfigChanged?: () => void;
};

export function registerIpc(window: BrowserWindow, _appDirs: AppDirs, store: JoiSQLiteStore, secrets: KeychainSecretStore, options: RegisterIpcOptions = {}) {
  const activeToolCallingRuns = new Map<string, AbortController>();
  const sqliteApi: Record<DesktopIpcMethod, Handler> = {
    async SendChat(payload) {
      const chatRequest = payload as ChatRequest;
      const settings = store.getSettings();
      const apiKey = await resolveAPIKeyForModelEndpoint(settings, secrets);
      if (!canRunRealToolCalling(settings, apiKey, chatRequest)) {
        throw new Error(unconfiguredModelMessage(settings, apiKey, chatRequest));
      }
      const result = await runLiveElectronToolCallingChat(chatRequest, settings, apiKey, store, activeToolCallingRuns, (runID) => {
        emitRunEvents(window, store.getRunTrace(runID));
      });
      emitRunEvents(window, store.getRunTrace(result.run_id));
      return result;
    },
    GetRunTrace(payload) {
      return store.getRunTrace(String(payload ?? ''));
    },
    ListConversations(payload) {
      return store.listConversations(payload as ConversationFilter);
    },
    GetConversation(payload) {
      return store.getConversation(String(payload ?? ''));
    },
    ListConversationGroups() {
      return store.listConversationGroups();
    },
    SaveConversationGroup(payload) {
      return store.saveConversationGroup(payload as Parameters<typeof store.saveConversationGroup>[0]);
    },
    DeleteConversationGroup(payload) {
      store.deleteConversationGroup(String(payload ?? ''));
    },
    MoveConversationToGroup(payload) {
      return store.moveConversationToGroup(payload as Parameters<typeof store.moveConversationToGroup>[0]);
    },
    ArchiveConversation(payload) {
      return store.archiveConversation(payload as Parameters<typeof store.archiveConversation>[0]);
    },
    TrashConversation(payload) {
      return store.trashConversation(payload as Parameters<typeof store.trashConversation>[0]);
    },
    RestoreConversation(payload) {
      return store.restoreConversation(payload as Parameters<typeof store.restoreConversation>[0]);
    },
    PurgeConversation(payload) {
      return store.purgeConversation(payload as Parameters<typeof store.purgeConversation>[0]);
    },
    GetSettings() {
      return store.getSettings();
    },
    GetSystemHealth() {
      return store.systemHealth();
    },
    ListSavedModels(_payload) {
      return store.listSavedModels();
    },
    async FetchAvailableModels(payload) {
      const result = await fetchAvailableModels(payload as ModelConnectionTestRequest | undefined, store.getSettings(), (name) => secrets.resolve(name), (name, value) => secrets.save(name, value));
      if (result.ok && result.available_models?.length) {
        const provider = result.available_models[0]?.provider || store.getSettings().model_provider;
        const baseURL = result.available_models[0]?.base_url || store.getSettings().model_base_url;
        store.replaceFetchedModels(provider, baseURL, result.available_models);
      }
      return result;
    },
    TestModelConnection(payload) {
      return testModelConnection(payload as ModelConnectionTestRequest | undefined, store.getSettings(), (name) => secrets.resolve(name), (name, value) => secrets.save(name, value));
    },
    async TestTelegramConnection() {
      return testTelegramConnection({ token: await secrets.resolve('TELEGRAM_BOT_TOKEN') });
    },
    ListCapabilities() {
      return store.listCapabilities();
    },
    ListMCPServers() {
      return store.listMCPServers();
    },
    SyncMCPServer(payload) {
      return store.syncMCPServer(String(payload ?? ''));
    },
    WrapMCPTool(payload) {
      return store.wrapMCPTool(payload as Parameters<typeof store.wrapMCPTool>[0]);
    },
    ListSkills() {
      return store.listSkills();
    },
    ListToolWorkflows() {
      return store.listToolWorkflows();
    },
    ListToolRuns() {
      return store.listToolRuns();
    },
    SetToolWorkflowEnabled(payload) {
      store.setToolWorkflowEnabled(payload as { name?: string; enabled?: boolean });
    },
    ListMemories(payload) {
      return store.listMemories(payload as { query?: string; limit?: number });
    },
    UpdateMemory(payload) {
      store.updateMemory(payload as Parameters<typeof store.updateMemory>[0]);
    },
    ListNodes() {
      return store.listNodes();
    },
    DisableNode(payload) {
      store.disableNode(String(payload ?? ''));
    },
    EnableNode(payload) {
      store.enableNode(String(payload ?? ''));
    },
    ListWorkerGatewayAuditLogs() {
      return store.listWorkerGatewayAuditLogs();
    },
    GetModelUsage() {
      return store.getModelUsage();
    },
    ListConfirmations() {
      return store.listConfirmations();
    },
    async DecideConfirmation(payload) {
      const req = payload as Parameters<typeof store.decideConfirmation>[0];
      store.decideConfirmation(req);
      if (req.approve && req.id) {
        const resume = store.loadApprovedToolCallingResume(req.id);
        if (resume) {
          const settings = store.getSettings();
          await resumeElectronToolCallingRun(resume, settings, await resolveAPIKeyForModelEndpoint(settings, secrets), store);
          const trace = store.getRunTrace(resume.run_id);
          for (const event of trace.events ?? []) {
            window.webContents.send('joi:run:event', event);
          }
        }
      }
    },
    InterruptRun(payload) {
      const req = payload as Parameters<typeof store.interruptRun>[0];
      const runID = req.run_id?.trim() || '';
      const active = activeToolCallingRuns.get(runID);
      if (active && !active.signal.aborted) {
        active.abort(new Error(req.reason || 'interrupted by user'));
      }
      store.interruptRun(req);
      if (runID) emitRunEvents(window, store.getRunTrace(runID));
    },
    ListBackups() {
      return store.listBackups();
    },
    CreateBackup() {
      return store.createBackup();
    },
    RestoreBackup(payload) {
      store.restoreBackup(String(payload ?? ''));
    },
    ExportDiagnostics() {
      return store.exportDiagnostics();
    },
    GetWorkspaceSettings() {
      return store.getWorkspaceSettings();
    },
    SaveWorkspaceSettings(payload) {
      store.saveWorkspaceSettings(payload as WorkspaceSettings);
    },
    SaveModelConfig(payload) {
      store.saveModelConfig(payload as ModelConfigRequest);
    },
    SaveModelSettings(payload) {
      store.saveModelSettings(payload as ModelSettingsRequest);
    },
    SaveOperationalSettings(payload) {
      store.saveOperationalSettings(payload as Parameters<typeof store.saveOperationalSettings>[0]);
      options.onTelegramConfigChanged?.();
    },
    async SaveTelegramConfig(payload) {
      const req = payload as { token?: string; allowed_user_ids?: string; enabled?: boolean };
      if (req.token?.trim()) {
        await secrets.save('TELEGRAM_BOT_TOKEN', req.token.trim());
      }
      store.saveOperationalSettings({
        telegram_enabled: Boolean(req.enabled),
        telegram_allowed_user_ids: req.allowed_user_ids || '',
        worker_gateway_enabled: store.getSettings().worker_gateway_enabled ?? false,
        auto_backup_enabled: store.getSettings().auto_backup_enabled ?? false,
      });
      options.onTelegramConfigChanged?.();
    },
    async SendTestTelegramMessage(payload) {
      const req = payload as { chat_id?: string; message?: string };
      const settings = store.getSettings();
      return sendTestTelegramMessage({
        token: await secrets.resolve('TELEGRAM_BOT_TOKEN'),
        chatID: req.chat_id,
        allowedUserIDs: settings.telegram_allowed_user_ids || '',
        message: req.message,
      });
    },
    GetOnboardingStatus() {
      return secrets.status().then((status) => store.getOnboardingStatus(status.secrets));
    },
    CompleteOnboarding() {
      store.completeOnboarding();
    },
    ListProductTasks(payload) {
      return store.listProductTasks(payload as { status?: string; limit?: number });
    },
    GetProductTask(payload) {
      return store.getProductTask(String(payload ?? ''));
    },
    ListArtifacts(payload) {
      return store.listArtifacts(payload as { product_task_id?: string; type?: string; limit?: number });
    },
    GetArtifact(payload) {
      return store.getArtifact(String(payload ?? ''));
    },
    ListOpenLoops(payload) {
      return store.listOpenLoops(payload as { status?: string; limit?: number });
    },
    ListProactiveMessages(payload) {
      return store.listProactiveMessages(payload as { status?: string; limit?: number });
    },
    DecideProactiveMessage(payload) {
      store.decideProactiveMessage(payload as { id?: string; action?: string; feedback?: string });
    },
    GetSecretStatus() {
      return secrets.status();
    },
    SaveSecret(payload) {
      const req = payload as { name?: string; value?: string };
      return secrets.save(String(req.name ?? ''), String(req.value ?? ''));
    },
    async GenerateWorkerToken() {
      const token = `joi_worker_${randomUUID().replace(/-/g, '')}`;
      await secrets.save('WORKER_TOKEN', token);
      return { token };
    },
  };

  ipcMain.handle('joi:invoke', async (_event, input: unknown) => {
    const { method, payload } = invokeRequestSchema.parse(input);
    const handler = sqliteApi[method as DesktopIpcMethod];
    if (!handler) {
      throw new Error(`Unsupported Joi IPC method: ${method}`);
    }
    return handler(payload);
  });

  ipcMain.handle('joi:app:getVersion', () => app.getVersion());

  ipcMain.handle('joi:app:openExternal', async (_event, rawUrl: unknown) => {
    const url = externalUrlSchema.parse(rawUrl);
    await shell.openExternal(url);
  });
}

export async function runLiveElectronToolCallingChat(
  req: ChatRequest,
  settings: SettingsRecord,
  apiKey: string,
  store: JoiSQLiteStore,
  activeRuns: Map<string, AbortController>,
  emitInitialEvents: (runID: string) => void,
) {
  const modelName = (req.model_name || settings.model_name || '').trim();
  const agentID = 'general_agent';
  const promptAssembly = store.assembleToolCallingPrompt(req, agentID, modelName);
  const started = store.beginToolCallingChat(req, {
    provider: settings.model_provider || 'openai_compatible',
    model_name: modelName,
    selected_agent_id: agentID,
    prompt_assembly: promptAssembly,
  });
  emitInitialEvents(started.run_id);
  const controller = new AbortController();
  activeRuns.set(started.run_id, controller);
  try {
    const turn = await runElectronToolCallingTurn(req, settings, apiKey, store, {
      started,
      promptAssembly,
      signal: controller.signal,
    });
    return store.finishToolCallingChat(started, turn);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const interrupted = controller.signal.aborted || isAbortError(err);
    return store.failToolCallingChat(started, err, interrupted ? 'cancelled' : 'failed');
  } finally {
    activeRuns.delete(started.run_id);
  }
}

export function emitRunEvents(window: BrowserWindow, trace: ReturnType<JoiSQLiteStore['getRunTrace']>): void {
  for (const event of trace.events ?? []) {
    if (!window.isDestroyed()) {
      window.webContents.send('joi:run:event', event);
    }
  }
}

export function canRunRealToolCalling(settings: SettingsRecord, apiKey: string, req: ChatRequest): boolean {
  if (req.runtime_mode && req.runtime_mode !== 'tool_calling') return false;
  const effectiveAPIKey = apiKeyForModelEndpoint(settings, apiKey);
  return realModelProviderConfigured(settings)
    && Boolean(modelBaseURLForSettings(settings).trim())
    && Boolean((req.model_name || settings.model_name || '').trim())
    && Boolean(effectiveAPIKey.trim());
}

function unconfiguredModelMessage(settings: SettingsRecord, apiKey: string, req: ChatRequest): string {
  if (req.runtime_mode && req.runtime_mode !== 'tool_calling') {
    return 'Joi Electron no longer supports the legacy desktop chat runtime. Use runtime_mode=tool_calling.';
  }
  if (!realModelProviderConfigured(settings)) {
    return `Real model provider is not configured: ${settings.model_provider || 'empty'}. Configure an OpenAI-compatible or xAI OAuth provider.`;
  }
  if (!modelBaseURLForSettings(settings).trim()) {
    return 'Real model base URL is not configured.';
  }
  if (!(req.model_name || settings.model_name || '').trim()) {
    return 'Real model name is not configured.';
  }
  if (!apiKeyForModelEndpoint(settings, apiKey).trim()) {
    return 'MODEL_API_KEY is not configured in Keychain or environment.';
  }
  return 'Real model tool-calling runtime is not configured.';
}

export function apiKeyForModelEndpoint(settings: SettingsRecord, apiKey: string): string {
  if (isLoopbackModelEndpoint(settings.model_base_url || '')) return LOCAL_MODEL_PROXY_API_KEY;
  return apiKey.trim();
}

export async function resolveAPIKeyForModelEndpoint(settings: SettingsRecord, secrets: KeychainSecretStore): Promise<string> {
  if (isLoopbackModelEndpoint(settings.model_base_url || '')) return LOCAL_MODEL_PROXY_API_KEY;
  if (isXAIOAuthProvider(settings.model_provider)) {
    const credentials = await resolveXAIOAuthCredentials((name) => secrets.resolve(name), (name, value) => secrets.save(name, value));
    return credentials.apiKey;
  }
  return (await secrets.resolve('MODEL_API_KEY')).trim();
}

function realModelProviderConfigured(settings: SettingsRecord): boolean {
  return settings.model_provider === 'openai_compatible' || isXAIOAuthProvider(settings.model_provider);
}

function modelBaseURLForSettings(settings: SettingsRecord): string {
  if (isXAIOAuthProvider(settings.model_provider)) {
    return validateXAIInferenceBaseURL(settings.model_base_url || DEFAULT_XAI_OAUTH_BASE_URL);
  }
  return settings.model_base_url || '';
}

async function runElectronToolCallingTurn(
  req: ChatRequest,
  settings: SettingsRecord,
  apiKey: string,
  store: JoiSQLiteStore,
  options: {
    started?: StartedToolCallingChat;
    promptAssembly?: ToolCallingPromptAssembly;
    signal?: AbortSignal;
  } = {},
) {
  const modelName = options.started?.model_name || (req.model_name || settings.model_name || '').trim();
  const agentID = options.started?.selected_agent_id || 'general_agent';
  const promptAssembly = options.promptAssembly || store.assembleToolCallingPrompt(req, agentID, modelName);
  const result = await runChatCompletionsToolTurn({
    base_url: modelBaseURLForSettings(settings),
    api_key: apiKey,
    model: modelName,
    messages: [
      { role: 'system', content: promptAssembly.system_message },
      { role: 'user', content: req.message },
    ],
    tools: compileElectronCapabilityTools(req.permission_profile),
    stream: true,
    max_steps: 6,
    timeout_seconds: 60,
    signal: options.signal,
    executeTool: async (call) => {
      try {
        if (shouldPauseElectronToolForConfirmation(call.name)) {
          const risk = electronRiskForCapability(call.name);
          return {
            call_id: call.id,
            name: call.name,
            arguments: call.arguments,
            output: {
              status: 'waiting_confirmation',
              capability: call.name,
              risk,
              requested_action: String(call.arguments.reason || call.arguments.goal || `Execute ${call.name}`),
              message: risk === 'browser_interaction'
                ? 'confirmation_required: browser interaction requires approval before execution'
                : 'confirmation_required: workspace write requires approval before execution',
            },
          };
        }
        const executed = await executeElectronCapability(call.name, call.arguments, req, store);
        return {
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
          output: executed?.output || {
            status: 'policy_blocked',
            capability: call.name,
            summary: `Capability ${call.name} is not enabled for the current permission profile.`,
          },
        } satisfies PersistedToolResult;
      } catch (error) {
        return {
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
          output: {
            status: 'failed',
            capability: call.name,
            error: error instanceof Error ? error.message : String(error),
            summary: `Capability ${call.name} failed.`,
          },
        };
      }
    },
  });
  return {
    status: result.status,
    provider: settings.model_provider || 'openai_compatible',
    model_name: modelName,
    selected_agent_id: agentID,
    final_message: result.final_message,
    prompt_assembly: promptAssembly,
    tool_results: result.tool_results.map((item) => ({
      call_id: item.call_id,
      name: item.name,
      arguments: item.arguments || {},
      output: item.output,
    })),
    usage: {
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      cached_input_tokens: result.usage.cached_input_tokens,
    },
    model_responses: result.model_responses,
  };
}

function isAbortError(error: Error): boolean {
  return error.name === 'AbortError' || /abort|interrupted|cancel/i.test(error.message);
}

async function resumeElectronToolCallingRun(
  resume: ToolCallingResumeRequest,
  settings: SettingsRecord,
  apiKey: string,
  store: JoiSQLiteStore,
) {
  const modelName = (resume.model_name || settings.model_name || '').trim();
  const resumeReq: ChatRequest = {
    conversation_id: resume.conversation_id,
    message: resume.user_message,
    runtime_mode: 'tool_calling',
    permission_profile: resume.risk_level === 'browser_interaction' ? 'danger_full_access' : resume.risk_level === 'workspace_write' ? 'workspace_write' : 'read_only',
  };
  let toolResult: PersistedToolResult;
  try {
    const executed = await executeElectronCapability(resume.capability_id, resume.input, resumeReq, store);
    toolResult = {
      call_id: resume.call_id,
      name: resume.capability_id,
      arguments: resume.input,
      output: executed?.output || {
        status: 'policy_blocked',
        capability: resume.capability_id,
        summary: `Capability ${resume.capability_id} is not enabled for approval resume.`,
      },
    };
  } catch (error) {
    toolResult = {
      call_id: resume.call_id,
      name: resume.capability_id,
      arguments: resume.input,
      output: {
        status: 'failed',
        capability: resume.capability_id,
        error: error instanceof Error ? error.message : String(error),
        summary: `Approved capability ${resume.capability_id} failed during resume.`,
      },
    };
  }

  let finalMessage = String(toolResult.output.summary || '已执行批准的工具调用。');
  let usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };
  let modelResponses: Array<Record<string, unknown>> = [];
  const baseURL = modelBaseURLForSettings(settings);
  if (baseURL.trim() && modelName && apiKey.trim()) {
    try {
      const finalTurn = await runChatCompletionsToolTurn({
        base_url: baseURL,
        api_key: apiKey,
        model: modelName,
        messages: [
          electronSystemMessage(),
          { role: 'user', content: resume.user_message },
          {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: resume.call_id,
              type: 'function',
              function: { name: resume.capability_id, arguments: JSON.stringify(resume.input) },
            }],
          },
          {
            role: 'tool',
            tool_call_id: resume.call_id,
            name: resume.capability_id,
            content: JSON.stringify(toolResult.output),
          },
        ],
        tools: compileElectronCapabilityTools('read_only'),
        stream: true,
        max_steps: 4,
        timeout_seconds: 60,
        executeTool: async (call) => {
          const executed = await executeElectronCapability(call.name, call.arguments, { ...resumeReq, permission_profile: 'read_only' }, store);
          return {
            call_id: call.id,
            name: call.name,
            arguments: call.arguments,
            output: executed?.output || {
              status: 'policy_blocked',
              capability: call.name,
              summary: `Capability ${call.name} is not enabled during approval resume.`,
            },
          };
        },
      });
      finalMessage = finalTurn.final_message.trim() || finalMessage;
      usage = finalTurn.usage;
      modelResponses = finalTurn.model_responses;
    } catch (error) {
      finalMessage = `${finalMessage}\n\n最终模型回复失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  store.completeApprovedToolCallingResume(resume.confirmation_id, {
    provider: settings.model_provider || resume.provider || 'openai_compatible',
    model_name: modelName || resume.model_name || 'model',
    final_message: finalMessage,
    tool_result: toolResult,
    usage,
    model_responses: modelResponses,
  });
}

function shouldPauseElectronToolForConfirmation(capability: string): boolean {
  return capability === 'apply_patch' || capability === 'browser_click' || capability === 'browser_type';
}

function electronRiskForCapability(capability: string): string {
  if (capability === 'browser_click' || capability === 'browser_type') return 'browser_interaction';
  if (capability === 'apply_patch') return 'workspace_write';
  return 'read_only';
}

function electronSystemMessage(): Record<string, unknown> {
  return {
    role: 'system',
    content: [
      'You are Joi Desktop running inside an Electron-native local app.',
      'Use only the provided capability tools. Do not claim that a tool ran unless a tool result is present.',
      'Prefer concise final answers grounded in tool outputs. Never request Docker/Postgres/NATS as a default prerequisite for this local desktop app.',
    ].join('\n'),
  };
}

async function executeElectronCapability(
  capability: string,
  inputs: Record<string, unknown>,
  req: ChatRequest,
  store: JoiSQLiteStore,
): Promise<{ output: Record<string, unknown> } | undefined> {
  switch (capability) {
    case 'workspace_search':
      return { output: executeWorkspaceSearch(inputs, store.getWorkspaceSettings()) };
    case 'file_analyze':
      return { output: executeFileAnalyze(inputs, store.getWorkspaceSettings()) };
    case 'file_read':
      return { output: executeFileRead(inputs, store.getWorkspaceSettings()) };
    case 'web_research':
      if (typeof inputs.url !== 'string' || !inputs.url.trim()) return undefined;
      return { output: await executeWebResearch(inputs, store.getWorkspaceSettings()) };
    case 'shell_command':
      return { output: await executeShellCommand(inputs, store.getWorkspaceSettings()) };
    case 'test_command':
      return { output: await executeTestCommand(inputs, store.getWorkspaceSettings()) };
    case 'apply_patch':
      if (!['workspace_write', 'danger_full_access'].includes(String(req.permission_profile || ''))) return undefined;
      return { output: executeApplyPatch(inputs, store.getWorkspaceSettings()) };
    case 'computer_observe':
      return { output: await executeComputerObserve(inputs) };
    case 'browser_observe':
      return { output: await executeBrowserObserve(inputs) };
    case 'browser_navigate':
      return { output: await executeBrowserNavigate(inputs, store.getWorkspaceSettings()) };
    case 'browser_click':
      if (String(req.permission_profile || '') !== 'danger_full_access') return undefined;
      return { output: await executeBrowserClick(inputs) };
    case 'browser_type':
      if (String(req.permission_profile || '') !== 'danger_full_access') return undefined;
      return { output: await executeBrowserType(inputs) };
    case 'desktop_app_list':
      return { output: executeDesktopAppList(inputs) };
    case 'desktop_app_inspect':
      return { output: executeDesktopAppInspect(inputs) };
    case 'system_health_check':
      return { output: executeSystemHealthCheck(store.systemHealth()) };
    case 'server_diagnose':
      return { output: await executeServerDiagnose(inputs) };
    default:
      return undefined;
  }
}
