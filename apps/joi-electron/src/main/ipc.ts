import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { testGitHubConnection } from './github';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { desktopIpcMethods, type DesktopIpcMethod, type JoiInvokeRequest } from '../../../../packages/shared-types/src/preload-api';
import type {
  ApprovalDecisionRequest,
  ApprovalResumeRunRequest,
  AgentModelPolicyRequest,
  AssistantActionRequest,
  BrowserWorkbenchRequest,
  DeveloperWorkbenchRequest,
  AutomationDefinition,
  AutomationDefinitionRequest,
  AutomationTriggerNowRequest,
  AutomationWebhookTestRequest,
  CapabilityRecord,
  ChatRequest,
  ConnectExternalMirrorRoomRequest,
  CreateProjectPersonaRequest,
  CreateSharedRoomRequest,
  EvaluateRoomPermissionsRequest,
  ConversationFilter,
  ConnectionTest,
  ExternalHandoffAudit,
  ExternalHandoffReadiness,
  GenerateProjectPersonaCandidatesRequest,
  LogCleanupRequest,
  LogFilter,
  ModelConnectionTestRequest,
  ModelConfigRequest,
  ModelSettingsRequest,
  PermissionProfile,
  PluginInstallFromGitHubRequest,
  MCPServerRecord,
  MCPToolCallRequest,
  MediaWorkbenchRequest,
  PhotonIMessageStatus,
  PreviewExternalPersonaMessageRequest,
  RecordExternalConnectorFailureRequest,
  RecordExternalConnectorInboundRequest,
  RecordExternalConnectorOutboundRequest,
  RedirectRunRequest,
  RetryExternalConnectorEventRequest,
  RollbackProjectPersonaRequest,
  RoutingFeedbackRequest,
  RunEvent,
  RunTraceSpanFilter,
  SetRouteLockRequest,
  SettingsRecord,
  TelegramInboundStatus,
  TerminalSessionInputRequest,
  TerminalSessionKillRequest,
  TerminalSessionResizeRequest,
  TerminalSessionStartRequest,
  UpdateMessengerProjectRequest,
  WorkspaceSettings,
  UpdateMessengerRoomRequest,
  UpdateProjectPersonaRequest,
} from '../../../../packages/shared-types/src/desktop-api';
import type { JoiSQLiteStore, PersistedToolResult, StartedToolCallingChat, ToolCallingPromptAssembly, ToolCallingResumeRequest } from '../../../../packages/store/src/sqlite';
import type { KeychainSecretStore } from '../../../../packages/secrets/src/keychain';
import { fetchAvailableModels, isLoopbackModelEndpoint, LOCAL_MODEL_PROXY_API_KEY, testModelConnection } from '../../../../packages/runtime/src/model';
import { DEFAULT_XAI_OAUTH_BASE_URL, isGrokBuildProvider, isXAIOAuthBackedProvider, loginWithXAIOAuthLoopback, resolveXAIOAuthCredentials, validateXAIInferenceBaseURL } from '../../../../packages/runtime/src/xai-oauth';
import { sendTestTelegramMessage, testTelegramConnection } from '../../../../packages/runtime/src/telegram';
import { PHOTON_DASHBOARD_TOKEN_SECRET, PHOTON_PROJECT_SECRET_SECRET, setupPhotonIMessage, testPhotonIMessageConnection } from '../../../../packages/runtime/src/imessage';
import { executeFileAnalyze, executeFileRead, executePublicWebExtract, executeUnsupportedCapability, executeWebResearch, executeWorkspaceSearch, resolveWorkspacePath } from '../../../../packages/runtime/src/capabilities';
import { executeApplyPatch, executeShellCommand, executeTestCommand } from '../../../../packages/runtime/src/workspace-exec';
import { executeComputerObserve } from '../../../../packages/runtime/src/browser-computer';
import { executeDesktopAppInspect, executeDesktopAppList } from '../../../../packages/runtime/src/desktop-apps';
import { executeServerDiagnose, executeSystemHealthCheck } from '../../../../packages/runtime/src/diagnostics';
import { runChatCompletionsToolTurn } from '../../../../packages/runtime/src/tool-calling';
import { runACPChatTurn, type ACPProviderRuntimeConfig } from '../../../../packages/runtime/src/acp';
import { inferFinalResponseContract } from '../../../../packages/runtime/src/agent-kernel';
import {
  canonicalElectronCapabilityName,
  compileElectronCapabilityTools,
  electronCapabilityRequiresConfirmation,
  electronCapabilityRisk,
  listElectronCapabilityToolDefinitions,
} from '../../../../packages/runtime/src/capability-compiler';
import { executeGrokBuildImageGeneration } from '../../../../packages/runtime/src/grok-build-image';
import { executeLocalSpeechTranscription, executeLocalTextToSpeech } from '../../../../packages/runtime/src/local-speech.ts';
import { executeXAIVideoGeneration } from '../../../../packages/runtime/src/xai-video.ts';
import { discoverCodexSkills } from '../../../../packages/runtime/src/skills.ts';
import { executeJoiPiComputerUse } from './pi-computer-use';
import { TerminalSessionManager } from './terminal';
import { automationWebhookSecretRef, newAutomationWebhookSecret } from './automation';
import { executeAutomationUpdateCapability, executeRequestUserInputCapability } from './automation-capabilities';
import {
  executeMemoryRecallCapability,
  executeMemoryWriteCandidateCapability,
  executeProjectListCapability,
  executeSessionBranchCapability,
  executeSessionCompactCapability,
  executeSessionSearchCapability,
  executeSessionSummaryCapability,
  executeSkillsListCapability,
  executeSkillViewCapability,
  executeTaskListCapability,
  executeTaskUpdateCapability,
  executeTaskViewCapability,
  executeToolSearchCapability,
} from './local-agent-capabilities';
import {
  executeShellKillCapability,
  executeShellOutputCapability,
  executeShellStartCapability,
  executeShellWriteCapability,
} from './terminal-capabilities';
import { executeNativeLSPCapability } from './native-lsp-capabilities.ts';
import { NativeDebuggerManager } from './debugger-capabilities.ts';
import { resolveAutomationModelSettings } from './automation-runtime-route';
import { JoiPluginManager } from './plugin-manager';
import { isProactiveTelegramDeliveryRequested, type TelegramOutboundDeliveryResult } from './telegram-outbound';
import {
  defaultJoiCommandSocketPath,
  publishJoiRunEvent,
  publishJoiTerminalEvent,
  startJoiCommandHost,
} from './command-host';
import { resolveACPBridgeGrant } from './acp-web-bridge';
import { MCPRuntimeManager } from './mcp-runtime.ts';
import { BrowserWorkbenchManager } from './browser-workbench.ts';
import { executeCodeCapability } from './code-execution-capabilities.ts';
import { analyzeImageFile, analyzeVideoFile, saveMediaDataURL } from './media-analysis.ts';
import { AssistantRuntimeManager } from './assistant-runtime.ts';

const invokeRequestSchema = z.object({
  method: z.enum(desktopIpcMethods),
  payload: z.unknown().optional(),
}) satisfies z.ZodType<JoiInvokeRequest>;

const externalUrlSchema = z.string().url();

type Handler = (payload?: unknown) => Promise<unknown> | unknown;
type DesktopIpcHandlerMap = Record<DesktopIpcMethod, Handler>;

export type AppDirs = {
  userDataDir: string;
  logDir: string;
  backupDir: string;
  dbPath: string;
};

export type RegisterIpcOptions = {
  pluginManager?: JoiPluginManager;
  deliverProactiveMessage?: (id: string) => Promise<TelegramOutboundDeliveryResult>;
  onTelegramConfigChanged?: () => void;
  onIMessageConfigChanged?: () => void;
  getTelegramStatus?: () => TelegramInboundStatus | undefined;
  getIMessageStatus?: () => PhotonIMessageStatus | undefined;
  testIMessageConnection?: () => Promise<ConnectionTest> | ConnectionTest | undefined;
  sendTestIMessageMessage?: (spaceID?: string, message?: string) => Promise<ConnectionTest> | ConnectionTest | undefined;
  deterministicChat?: boolean;
  getAutomationWebhookURL?: (automation: AutomationDefinition) => string;
  requestAutomationDrain?: () => void;
};

let terminalSessionManager: TerminalSessionManager | null = null;
let nativeDebuggerManager: NativeDebuggerManager | null = null;
let terminalDisposeRegistered = false;
let terminalCliEventUnsubscribe: (() => void) | null = null;
let browserBridgeServer: Server | null = null;
let mcpRuntimeManager: MCPRuntimeManager | null = null;
let browserWorkbenchManager: BrowserWorkbenchManager | null = null;
let assistantRuntimeManager: AssistantRuntimeManager | null = null;

function getTerminalSessionManager() {
  if (!terminalSessionManager) {
    terminalSessionManager = new TerminalSessionManager();
  }
  if (!terminalDisposeRegistered) {
    terminalDisposeRegistered = true;
    app.once('before-quit', () => {
      terminalSessionManager?.dispose();
      terminalSessionManager = null;
      nativeDebuggerManager?.dispose();
      nativeDebuggerManager = null;
      void mcpRuntimeManager?.closeAll();
      mcpRuntimeManager = null;
      browserWorkbenchManager?.dispose();
      browserWorkbenchManager = null;
      assistantRuntimeManager?.dispose();
      assistantRuntimeManager = null;
      terminalDisposeRegistered = false;
    });
  }
  return terminalSessionManager;
}

function getNativeDebuggerManager() {
  if (!nativeDebuggerManager) nativeDebuggerManager = new NativeDebuggerManager();
  return nativeDebuggerManager;
}

function getMCPRuntimeManager() {
  if (!mcpRuntimeManager) mcpRuntimeManager = new MCPRuntimeManager();
  return mcpRuntimeManager;
}

function getBrowserWorkbenchManager() {
  if (!browserWorkbenchManager) browserWorkbenchManager = new BrowserWorkbenchManager();
  return browserWorkbenchManager;
}

async function executeBrowserWorkbenchAction(req: BrowserWorkbenchRequest) {
  if (req.action !== 'vision') return getBrowserWorkbenchManager().execute(req);
  const screenshot = await getBrowserWorkbenchManager().execute({ ...req, action: 'screenshot' });
  if (!screenshot.screenshot_path) throw new Error('browser vision did not produce a screenshot');
  const analysis = await analyzeImageFile(
    screenshot.screenshot_path,
    join(app.getPath('userData'), 'browser-workbench', 'vision'),
  );
  return { ...screenshot, action: 'vision', result: analysis, text: String(analysis.text || '') };
}

export function registerIpc(window: BrowserWindow, appDirs: AppDirs, store: JoiSQLiteStore, secrets: KeychainSecretStore, options: RegisterIpcOptions = {}) {
  const activeToolCallingRuns = new Map<string, AbortController>();
  const emittedRunSeqByRunID = new Map<string, number>();
  const terminalManager = getTerminalSessionManager();
  if (!terminalCliEventUnsubscribe) {
    terminalCliEventUnsubscribe = terminalManager.onEvent(publishJoiTerminalEvent);
  }
  const pluginManager = options.pluginManager || new JoiPluginManager(store, appDirs.userDataDir);
  assistantRuntimeManager?.dispose();
  assistantRuntimeManager = new AssistantRuntimeManager(
    store,
    secrets,
    join(appDirs.userDataDir, 'assistant-runtime'),
    options.sendTestIMessageMessage,
  );
  assistantRuntimeManager.resume();
  terminalManager.attachWindow(window);
  terminalManager.setLogSink?.((event) => {
    safeRecordAppLog(store, {
      level: event.type === 'error' ? 'error' : event.type === 'output' ? 'trace' : 'info',
      risk_level: 'state_change',
      category: 'terminal',
      feature_key: `terminal.${event.type}`,
      source: 'electron_terminal',
      message: `terminal ${event.type}`,
      item_type: 'terminal_session',
      item_id: event.id,
      payload: {
        data: event.data,
        session: event.session,
      },
      error: event.error ? { message: event.error } : undefined,
    });
  });
  window.once('closed', () => {
    terminalManager.detachWindow(window);
    terminalManager.dispose();
  });
  const emitNewRunEvents = (runID: string, event?: RunEvent) => {
    if (event) {
      emitRunEvent(window, event);
      const lastSeq = emittedRunSeqByRunID.get(runID) || 0;
      if (event.seq > lastSeq) emittedRunSeqByRunID.set(runID, event.seq);
      return;
    }
    emitRunEventsSince(window, store.getRunTrace(runID), emittedRunSeqByRunID);
  };
  const sqliteApi: Record<DesktopIpcMethod, Handler> = {
    async SendChat(payload) {
      const chatRequest = payload as ChatRequest;
      if (options.deterministicChat) {
        const result = await store.sendDeterministicChat({
          ...chatRequest,
          runtime_mode: chatRequest.runtime_mode || 'tool_calling',
        });
        emitRunEvents(window, store.getRunTrace(result.run_id));
        return result;
      }
      const storedSettings = store.getSettings();
      const settings = chatRequest.model_provider || chatRequest.model_base_url
        ? resolveAutomationModelSettings({
            settings: storedSettings,
            request: chatRequest,
            availableModels: store.listSavedModels().models,
          })
        : storedSettings;
      const acpProvider = pluginManager.resolveProvider(settings.model_provider, chatRequest.permission_profile || 'read_only');
      const apiKey = acpProvider ? LOCAL_MODEL_PROXY_API_KEY : await resolveAPIKeyForModelEndpoint(settings, secrets);
      if (!canRunRealToolCalling(settings, apiKey, chatRequest, Boolean(acpProvider))) {
        throw new Error(unconfiguredModelMessage(settings, apiKey, chatRequest, Boolean(acpProvider)));
      }
      const result = await runLiveElectronToolCallingChat(chatRequest, settings, secrets, store, activeToolCallingRuns, emitNewRunEvents, pluginManager);
      emitNewRunEvents(result.run_id);
      return result;
    },
    ListPersonaMessenger() {
      return store.listPersonaMessenger();
    },
    GenerateProjectPersonaCandidates(payload) {
      return store.generateProjectPersonaCandidates(payload as GenerateProjectPersonaCandidatesRequest);
    },
    CreateProjectPersona(payload) {
      return store.createProjectPersona(payload as CreateProjectPersonaRequest);
    },
    UpdateProjectPersona(payload) {
      return store.updateProjectPersona(payload as UpdateProjectPersonaRequest);
    },
    RollbackProjectPersona(payload) {
      return store.rollbackProjectPersona(payload as RollbackProjectPersonaRequest);
    },
    CreateSharedRoom(payload) {
      return store.createSharedRoom(payload as CreateSharedRoomRequest);
    },
    UpdateMessengerRoom(payload) {
      return store.updateMessengerRoom(payload as UpdateMessengerRoomRequest);
    },
    UpdateMessengerProject(payload) {
      return store.updateMessengerProject(payload as UpdateMessengerProjectRequest);
    },
    ConnectExternalMirrorRoom(payload) {
      return store.connectExternalMirrorRoom(payload as ConnectExternalMirrorRoomRequest);
    },
    RecordExternalConnectorInbound(payload) {
      return store.recordExternalConnectorInbound(payload as RecordExternalConnectorInboundRequest);
    },
    RecordExternalConnectorOutbound(payload) {
      return store.recordExternalConnectorOutbound(payload as RecordExternalConnectorOutboundRequest);
    },
    PreviewExternalPersonaMessage(payload) {
      return store.previewExternalPersonaMessage(payload as PreviewExternalPersonaMessageRequest);
    },
    RecordExternalConnectorFailure(payload) {
      return store.recordExternalConnectorFailure(payload as RecordExternalConnectorFailureRequest);
    },
    RetryExternalConnectorEvent(payload) {
      return store.retryExternalConnectorEvent(payload as RetryExternalConnectorEventRequest);
    },
    SetRouteLock(payload) {
      return store.setRouteLock(payload as SetRouteLockRequest);
    },
    CompleteCheckpoint(payload) {
      return store.completeCheckpoint(payload as Parameters<typeof store.completeCheckpoint>[0]);
    },
    RecordRoutingFeedback(payload) {
      store.recordRoutingFeedback(payload as RoutingFeedbackRequest);
    },
    EvaluateRoomPermissions(payload) {
      return store.evaluateRoomPermissions(payload as EvaluateRoomPermissionsRequest);
    },
    ListAutomations(payload) {
      return store.listAutomations(payload as { kind?: 'schedule' | 'webhook'; enabled?: boolean; limit?: number });
    },
    GetAutomation(payload) {
      return store.getAutomation(String(payload ?? ''));
    },
    async SaveAutomation(payload) {
      const automation = store.saveAutomation(payload as AutomationDefinitionRequest);
      if (automation.kind === 'webhook') {
        const secretRef = automationWebhookSecretRef(automation.id);
        if (!(await secrets.resolve(secretRef))) {
          await secrets.save(secretRef, newAutomationWebhookSecret());
        }
      }
      return store.getAutomation(automation.id);
    },
    DeleteAutomation(payload) {
      store.deleteAutomation(String(payload ?? ''));
    },
    SetAutomationEnabled(payload) {
      return store.setAutomationEnabled(payload as { id: string; enabled: boolean });
    },
    TriggerAutomationNow(payload) {
      const result = store.triggerAutomationNow(payload as AutomationTriggerNowRequest);
      options.requestAutomationDrain?.();
      return result;
    },
    ListAutomationTriggers(payload) {
      return store.listAutomationTriggers(payload as { automation_id?: string; status?: string; limit?: number });
    },
    ListAutomationRuns(payload) {
      return store.listAutomationRuns(payload as { automation_id?: string; trigger_id?: string; limit?: number });
    },
    SetAutomationRunRead(payload) {
      return store.setAutomationRunRead(payload as { id: string; read: boolean });
    },
    MarkAllAutomationRunsRead(payload) {
      return store.markAllAutomationRunsRead((payload || {}) as { automation_id?: string });
    },
    SetAutomationRunArchived(payload) {
      return store.setAutomationRunArchived(payload as { id: string; archived: boolean });
    },
    ArchiveAllAutomationRuns(payload) {
      return store.archiveAllAutomationRuns(payload as { automation_id: string });
    },
    async GetAutomationWebhookEndpoint(payload) {
      const automation = store.getAutomation(String(payload ?? ''));
      const secretRef = automationWebhookSecretRef(automation.id);
      return {
        automation_id: automation.id,
        slug: automation.slug,
        url: options.getAutomationWebhookURL?.(automation) || `http://127.0.0.1:18082/automation/webhooks/${encodeURIComponent(automation.slug)}`,
        secret_ref: secretRef,
        secret_configured: Boolean(await secrets.resolve(secretRef)),
      };
    },
    async RotateAutomationWebhookSecret(payload) {
      const automation = store.getAutomation(String(payload ?? ''));
      if (automation.kind !== 'webhook') throw new Error('Automation is not a webhook automation');
      const secretRef = automationWebhookSecretRef(automation.id);
      const secret = newAutomationWebhookSecret();
      await secrets.save(secretRef, secret);
      return {
        automation_id: automation.id,
        slug: automation.slug,
        url: options.getAutomationWebhookURL?.(automation) || `http://127.0.0.1:18082/automation/webhooks/${encodeURIComponent(automation.slug)}`,
        secret_ref: secretRef,
        secret_configured: true,
        secret_value_once: secret,
      };
    },
    TestAutomationWebhook(payload) {
      const req = payload as AutomationWebhookTestRequest;
      const automation = store.getAutomation(req.id);
      if (automation.kind !== 'webhook') throw new Error('Automation is not a webhook automation');
      const result = store.enqueueAutomationTrigger({
        automation_id: automation.id,
        trigger_type: 'webhook',
        dedup_key: `test:${Date.now()}:${randomUUID()}`,
        payload: {
          ...(req.payload || {}),
          _webhook: {
            test: true,
            received_at: new Date().toISOString(),
          },
        },
        fire_at: new Date().toISOString(),
      });
      options.requestAutomationDrain?.();
      return { trigger: result.trigger };
    },
    GetRunTrace(payload) {
      return store.getRunTrace(String(payload ?? ''));
    },
    ListRunTraceSpans(payload) {
      return store.listRunTraceSpans(payload as RunTraceSpanFilter);
    },
    GetRecentRunClosureReport(payload) {
      return store.getRecentRunClosureReport(payload as { limit?: number });
    },
    async GetExternalHandoffAudit() {
      const base = store.getExternalHandoffAudit();
      const readiness = await getExternalHandoffReadiness(store.getSettings(), secrets, {
        getTelegramStatus: options.getTelegramStatus,
        getIMessageStatus: options.getIMessageStatus,
      });
      const audit: ExternalHandoffAudit = {
        ...base,
        readiness,
      };
      audit.status = statusForExternalHandoffAudit(audit);
      audit.next_action = nextActionForExternalHandoffStatus(audit.status);
      return audit;
    },
    ListConversations(payload) {
      return store.listConversations(payload as ConversationFilter);
    },
    GetConversation(payload) {
      return store.getConversation(String(payload ?? ''));
    },
    GetConversationForMessage(payload) {
      return store.getConversationForMessage(String(payload ?? ''));
    },
    GetConversationTree(payload) {
      return store.getConversationTree(String(payload ?? ''));
    },
    CreateConversationBranch(payload) {
      return store.branchConversationForTool(payload as Parameters<typeof store.branchConversationForTool>[0]);
    },
    CompactConversation(payload) {
      return store.compactConversationForTool(payload as Parameters<typeof store.compactConversationForTool>[0]);
    },
    UpdateConversationBranch(payload) {
      return store.updateConversationBranch(payload as Parameters<typeof store.updateConversationBranch>[0]);
    },
    ExportConversation(payload) {
      return store.exportConversation(payload as Parameters<typeof store.exportConversation>[0]);
    },
    ImportConversation(payload) {
      return store.importConversation(payload as Parameters<typeof store.importConversation>[0]);
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
      return mergeRuntimeCapabilityRecords(store.listCapabilities().capabilities);
    },
    SetCapabilityEnabled(payload) {
      store.setCapabilityEnabled(payload as { id?: string; enabled?: boolean });
    },
    ListMCPServers() {
      return store.listMCPServers();
    },
    SaveMCPServer(payload) {
      const req = payload as Parameters<typeof store.saveMCPServer>[0];
      void getMCPRuntimeManager().close(req.id);
      return store.saveMCPServer(req);
    },
    DeleteMCPServer(payload) {
      const id = String(payload ?? '');
      void getMCPRuntimeManager().close(id);
      store.deleteMCPServer(id);
    },
    SetMCPServerEnabled(payload) {
      const req = payload as { id?: string; enabled?: boolean };
      if (req.enabled === false && req.id) void getMCPRuntimeManager().close(req.id);
      return store.setMCPServerEnabled(req);
    },
    async SyncMCPServer(payload) {
      const serverID = String(payload ?? '').trim();
      const server = store.listMCPServers().servers.find((item) => item.id === serverID);
      if (!server) return store.syncMCPServer(serverID);
      try {
        const inventory = await getMCPRuntimeManager().inspect(server);
        return store.replaceMCPInventory(serverID, inventory);
      } catch (error) {
        store.recordMCPSyncFailure(serverID, error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    WrapMCPTool(payload) {
      return store.wrapMCPTool(payload as Parameters<typeof store.wrapMCPTool>[0]);
    },
    async InvokeMCPTool(payload) {
      const req = payload as MCPToolCallRequest;
      const server = store.listMCPServers().servers.find((item) => item.id === req.server_id);
      if (!server) throw new Error(`MCP server not found: ${req.server_id}`);
      const result = await getMCPRuntimeManager().callTool(server, req.tool_name, req.input || {}, req.timeout_ms);
      safeRecordAppLog(store, {
        level: result.is_error ? 'error' : 'info',
        risk_level: 'state_change',
        category: 'tool',
        feature_key: 'mcp.tool_call',
        source: 'mcp_runtime',
        message: `MCP ${server.id}/${req.tool_name}`,
        item_type: 'mcp_tool',
        item_id: `${server.id}:${req.tool_name}`,
        duration_ms: result.duration_ms,
        payload: { server_id: server.id, tool_name: req.tool_name, is_error: result.is_error },
      });
      return result;
    },
    ListSkills() {
      return reloadFilesystemSkills(store);
    },
    ReloadSkills() {
      return reloadFilesystemSkills(store);
    },
    GetSkill(payload) {
      reloadFilesystemSkills(store);
      return store.getSkill(String(payload ?? ''));
    },
    SetSkillEnabled(payload) {
      store.setSkillEnabled(payload as { id?: string; enabled?: boolean });
    },
    TestGitHubConnection() {
      return testGitHubConnection(store.getWorkspaceSettings(), (name) => secrets.resolve(name));
    },
    ListPlugins() {
      return store.listPlugins();
    },
    InstallPluginFromManifest(payload) {
      return store.installPluginFromManifest(String(payload ?? ''));
    },
    async InstallPluginFromGitHub(payload) {
      return pluginManager.installFromGitHub(payload as PluginInstallFromGitHubRequest);
    },
    async TestPluginProvider(payload) {
      const req = payload as { plugin_id?: string; provider_id?: string };
      return pluginManager.testProvider(String(req.plugin_id || ''), req.provider_id);
    },
    SetPluginEnabled(payload) {
      return store.setPluginEnabled(payload as { id?: string; enabled?: boolean });
    },
    async RemovePlugin(payload) {
      await pluginManager.remove(String(payload ?? ''));
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
    ListMemoriesUsedForRun(payload) {
      return store.listMemoriesUsedForRun(String(payload ?? ''));
    },
    ListMemoryCandidates(payload) {
      return store.listMemoryCandidates(payload as { status?: string; limit?: number });
    },
    DecideMemoryCandidate(payload) {
      store.decideMemoryCandidate(payload as { id?: string; decision?: string; run_id?: string; comment?: string; reason?: string; content?: string; summary?: string });
    },
    CorrectMemory(payload) {
      store.correctMemory(payload as { id?: string; content?: string; summary?: string; run_id?: string; comment?: string; reason?: string });
    },
    DeleteMemory(payload) {
      store.deleteMemory(payload as { id?: string; run_id?: string; reason?: string; comment?: string });
    },
    ListUserStates(payload) {
      return store.listUserStates(payload as { limit?: number });
    },
    ListRelationshipStates(payload) {
      return store.listRelationshipStates(payload as { limit?: number });
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
    ListPendingApprovals() {
      return store.listPendingApprovals();
    },
    DecideApproval(payload) {
      return store.decideApproval(payload as ApprovalDecisionRequest);
    },
    async ResumeApprovalRun(payload) {
      return resumeApprovalRunFromPayload(payload as ApprovalResumeRunRequest, window, store, secrets);
    },
    async DecideConfirmation(payload) {
      const req = payload as Parameters<typeof store.decideConfirmation>[0];
      store.decideConfirmation(req);
      if (req.approve && req.id) {
        await resumeApprovalRunFromPayload({ approval_request_id: req.id, run_id: '' }, window, store, secrets);
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
    async RedirectRun(payload) {
      const req = payload as RedirectRunRequest;
      const runID = req.run_id?.trim() || '';
      const active = activeToolCallingRuns.get(runID);
      if (active && !active.signal.aborted) {
        active.abort(new Error(req.reason || 'redirected by user'));
      }
      const redirected = store.redirectRun(req);
      if (runID) emitRunEvents(window, redirected);
      const message = req.message?.trim();
      if (!message) {
        return { redirected_run: redirected };
      }
      const settings = store.getSettings();
      const result = await runLiveElectronToolCallingChat({
        conversation_id: redirected.conversation_id,
        channel: redirected.entry_channel || 'desktop',
        message,
        input_mode: req.requested_mode || (redirected.resolved_mode as ChatRequest['input_mode']) || 'auto',
        product_task_id: req.product_task_id || (typeof redirected.metadata?.product_task_id === 'string' ? redirected.metadata.product_task_id : undefined),
        parent_run_id: runID,
        redirected_from_run_id: runID,
        runtime_mode: 'tool_calling',
      }, settings, secrets, store, activeToolCallingRuns, emitNewRunEvents);
      emitNewRunEvents(result.run_id);
      return { redirected_run: redirected, new_run: result };
    },
    EnqueueRunMessage(payload) {
      return store.enqueueRunMessage(payload as Parameters<typeof store.enqueueRunMessage>[0]);
    },
    ListRunMessages(payload) {
      return store.listRunMessages(payload as Parameters<typeof store.listRunMessages>[0]);
    },
    CancelRunMessage(payload) {
      return store.cancelRunMessage(payload as Parameters<typeof store.cancelRunMessage>[0]);
    },
    ListRecoverableRuns(payload) {
      return store.listRecoverableRuns(payload as { limit?: number });
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
    ExportPersonaMessengerData(payload) {
      return store.exportPersonaMessengerData(payload || {});
    },
    ListLogs(payload) {
      return store.listLogs((payload || {}) as LogFilter);
    },
    GetLogEntry(payload) {
      return store.getLogEntry(String(payload ?? ''));
    },
    PreviewLogCleanup(payload) {
      return store.previewLogCleanup((payload || { scopes: [] }) as LogCleanupRequest);
    },
    ClearLogs(payload) {
      return store.clearLogs((payload || { scopes: [] }) as LogCleanupRequest);
    },
    ExportLogs(payload) {
      return store.exportLogs((payload || {}) as LogFilter);
    },
    GetWorkspaceSettings() {
      return store.getWorkspaceSettings();
    },
    SaveWorkspaceSettings(payload) {
      store.saveWorkspaceSettings(payload as WorkspaceSettings);
    },
    async TestWebSearch(payload) {
      const req = payload as { query?: string; max_results?: number } | undefined;
      return executeWebResearch(
        { query: req?.query?.trim() || 'Brave Search API', max_results: req?.max_results || 3 },
        await workspaceSettingsWithSecrets(store, secrets),
      );
    },
    SaveModelConfig(payload) {
      store.saveModelConfig(payload as ModelConfigRequest);
    },
    SaveModelSettings(payload) {
      store.saveModelSettings(payload as ModelSettingsRequest);
    },
    ListAgentModelPolicies() {
      return store.listAgentModelPolicies();
    },
    SaveAgentModelPolicy(payload) {
      return store.saveAgentModelPolicy(payload as AgentModelPolicyRequest);
    },
    ExecuteBrowserAction(payload) {
      return executeBrowserWorkbenchAction(payload as BrowserWorkbenchRequest);
    },
    async ExecuteDeveloperAction(payload) {
      const req = payload as DeveloperWorkbenchRequest;
      const action = String(req.action || '').trim();
      const inputs = req.input || {};
      const workspaceSettings = store.getWorkspaceSettings();
      const permissionProfile = String(req.permission_profile || 'danger_full_access');
      if (action.startsWith('lsp_')) {
        return { action, output: await executeNativeLSPCapability(action as Parameters<typeof executeNativeLSPCapability>[0], inputs, workspaceSettings) };
      }
      if (action.startsWith('debugger_')) {
        return { action, output: await getNativeDebuggerManager().execute(action as Parameters<NativeDebuggerManager['execute']>[0], inputs, workspaceSettings, permissionProfile) };
      }
      if (['execute_code', 'code_execution', 'sandbox_run'].includes(action)) {
        return { action, output: await executeCodeCapability(action as Parameters<typeof executeCodeCapability>[0], inputs, workspaceSettings, permissionProfile) };
      }
      throw new Error(`Unsupported developer workbench action: ${action}`);
    },
    async ExecuteMediaAction(payload) {
      const req = payload as MediaWorkbenchRequest;
      const action = String(req.action || '').trim();
      const mediaRoot = join(app.getPath('userData'), 'media-workbench');
      if (action === 'save_recording') {
        if (!req.data_url) throw new Error('save_recording data_url is required');
        return { action, output: await saveMediaDataURL(req.data_url, join(mediaRoot, 'recordings'), req.mime_type) };
      }
      if (action === 'text_to_speech') {
        return {
          action,
          output: await executeLocalTextToSpeech(req as Record<string, unknown>, {
            output_dir: join(mediaRoot, 'speech'),
            timeout_seconds: 180,
          }),
        };
      }
      if (action === 'speech_transcribe') {
        if (!req.path) throw new Error('speech_transcribe path is required');
        return {
          action,
          output: await executeLocalSpeechTranscription(req as Record<string, unknown>, {
            output_dir: join(mediaRoot, 'transcriptions'),
            timeout_seconds: 900,
          }),
        };
      }
      if (action === 'analyze_image') {
        if (!req.path) throw new Error('analyze_image path is required');
        return { action, output: await analyzeImageFile(req.path, join(mediaRoot, 'analysis')) };
      }
      if (action === 'analyze_video') {
        if (!req.path) throw new Error('analyze_video path is required');
        const output = await analyzeVideoFile(req.path, join(mediaRoot, 'analysis'));
        if (req.transcribe) {
          try {
            output.transcription = await executeLocalSpeechTranscription({
              path: req.path,
              model: req.model || 'tiny',
              language: req.language || 'auto',
            }, { output_dir: join(mediaRoot, 'transcriptions'), timeout_seconds: 900 });
          } catch (error) {
            output.transcription_error = error instanceof Error ? error.message : String(error);
          }
        }
        return { action, output };
      }
      if (action === 'generate_video') {
        const credentials = await resolveXAIOAuthCredentials(
          (name) => secrets.resolve(name),
          (name, value) => secrets.save(name, value),
        );
        return {
          action,
          output: await executeXAIVideoGeneration({
            prompt: req.prompt,
            duration_seconds: req.duration_seconds,
            aspect_ratio: req.aspect_ratio,
            resolution: req.resolution,
          }, {
            api_key: credentials.apiKey,
            base_url: credentials.baseURL,
            output_dir: join(mediaRoot, 'generated-video'),
            timeout_seconds: 900,
          }),
        };
      }
      throw new Error(`Unsupported media workbench action: ${action}`);
    },
    GetAssistantWorkspace() {
      return store.getAssistantWorkspace();
    },
    ExecuteAssistantAction(payload) {
      return assistantRuntimeManager!.execute(payload as AssistantActionRequest);
    },
    SaveOperationalSettings(payload) {
      store.saveOperationalSettings(payload as Parameters<typeof store.saveOperationalSettings>[0]);
      options.onTelegramConfigChanged?.();
      options.onIMessageConfigChanged?.();
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
    async SetupPhotonIMessage(payload) {
      const req = payload as {
        phone_number?: string;
        project_name?: string;
        first_name?: string;
        last_name?: string;
        email?: string;
        timeout_seconds?: number;
      };
      const result = await setupPhotonIMessage({
        ...req,
        openURL: (url) => shell.openExternal(url),
        getSecret: (name) => secrets.resolve(name),
        saveSecret: (name, value) => secrets.save(name, value),
        onDeviceCode: (code) => {
          console.info(`Photon device login requested: ${code.verification_uri_complete || code.verification_uri} code=${code.user_code}`);
        },
      });
      store.saveIMessageSettings({
        enabled: true,
        project_id: result.project_id,
        phone_number: result.operator_phone,
        assigned_number: result.assigned_number,
        home_channel: result.operator_phone,
        allowed_users: result.operator_phone,
        require_mention: store.getSettings().imessage_require_mention ?? false,
        sidecar_port: store.getSettings().imessage_sidecar_port,
      });
      options.onIMessageConfigChanged?.();
      return result;
    },
    async SaveIMessageConfig(payload) {
      const req = payload as {
        project_id?: string;
        project_secret?: string;
        dashboard_token?: string;
        phone_number?: string;
        assigned_number?: string;
        home_channel?: string;
        allowed_users?: string;
        require_mention?: boolean;
        enabled?: boolean;
        sidecar_port?: number;
      };
      if (req.project_secret?.trim()) {
        await secrets.save(PHOTON_PROJECT_SECRET_SECRET, req.project_secret.trim());
      }
      if (req.dashboard_token?.trim()) {
        await secrets.save(PHOTON_DASHBOARD_TOKEN_SECRET, req.dashboard_token.trim());
      }
      store.saveIMessageSettings({
        enabled: Boolean(req.enabled),
        project_id: req.project_id || store.getSettings().imessage_project_id,
        phone_number: req.phone_number || store.getSettings().imessage_operator_phone,
        assigned_number: req.assigned_number || store.getSettings().imessage_assigned_number,
        home_channel: req.home_channel || store.getSettings().imessage_home_channel,
        allowed_users: req.allowed_users || store.getSettings().imessage_allowed_users,
        require_mention: req.require_mention ?? store.getSettings().imessage_require_mention ?? false,
        sidecar_port: req.sidecar_port || store.getSettings().imessage_sidecar_port,
      });
      options.onIMessageConfigChanged?.();
    },
    GetIMessageStatus() {
      return options.getIMessageStatus?.() || {
        enabled: store.getSettings().imessage_enabled,
        configured: Boolean(store.getSettings().imessage_project_id),
        connected: false,
        sidecar_running: false,
        project_id: store.getSettings().imessage_project_id,
        operator_phone: store.getSettings().imessage_operator_phone,
        assigned_number: store.getSettings().imessage_assigned_number,
        allowed_users: store.getSettings().imessage_allowed_users,
        require_mention: store.getSettings().imessage_require_mention,
      } satisfies PhotonIMessageStatus;
    },
    async TestIMessageConnection() {
      const delegated = await options.testIMessageConnection?.();
      if (delegated) return delegated;
      const settings = store.getSettings();
      return testPhotonIMessageConnection({
        project_id: settings.imessage_project_id,
        project_secret: await secrets.resolve(PHOTON_PROJECT_SECRET_SECRET),
      });
    },
    async SendTestIMessageMessage(payload) {
      const req = payload as { space_id?: string; message?: string };
      const delegated = await options.sendTestIMessageMessage?.(req.space_id, req.message);
      if (delegated) return delegated;
      return { ok: false, status: 'not_running', error_summary: 'iMessage service is not running' } satisfies ConnectionTest;
    },
    GetOnboardingStatus() {
      return secrets.status().then((status) => store.getOnboardingStatus(status.secrets));
    },
    CompleteOnboarding() {
      store.completeOnboarding();
    },
    ListProductTasks(payload) {
      return store.listProductTasks(payload as { status?: string; limit?: number; conversation_id?: string; principal_id?: string; channel?: string });
    },
    ListProductTasksByConversation(payload) {
      return store.listProductTasks({ conversation_id: String(payload ?? ''), limit: 100 });
    },
    ListProductTasksByPrincipal(payload) {
      return store.listProductTasks({ principal_id: String(payload ?? ''), limit: 100 });
    },
    GetProductTask(payload) {
      return store.getProductTask(String(payload ?? ''));
    },
    CloseProductTask(payload) {
      return store.closeProductTask(payload as { id?: string; outcome?: string; reason?: string; actor?: string; run_id?: string });
    },
    ReopenProductTask(payload) {
      return store.reopenProductTask(payload as { id?: string; reason?: string; actor?: string; run_id?: string });
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
    DecideOpenLoop(payload) {
      store.decideOpenLoop(payload as { id?: string; action?: string; feedback?: string; due_at?: string });
    },
    ListProactiveMessages(payload) {
      return store.listProactiveMessages(payload as { status?: string; limit?: number });
    },
    async DecideProactiveMessage(payload) {
      const req = payload as { id?: string; action?: string; feedback?: string };
      const id = req.id?.trim() || '';
      const action = req.action?.trim() || '';
      if (!id || !action) throw new Error('id and action are required');
      const context = store.getProactiveOutboundContext(id);
      const shouldDeliverTelegram = Boolean(options.deliverProactiveMessage)
        && ['send', 'approve', 'sent'].includes(action)
        && isProactiveTelegramDeliveryRequested(context);
      if (!shouldDeliverTelegram) {
        store.decideProactiveMessage(req);
        return;
      }
      if (context.status !== 'delivered') {
        store.decideProactiveMessage({ ...req, action: action === 'sent' ? 'send' : action });
      }
      const delivery = await options.deliverProactiveMessage!(id);
      if (delivery.status === 'failed') {
        throw new Error(`Telegram 主动推送失败：${delivery.error_summary || '请查看 Run Trace 和日志。'}`);
      }
    },
    RecordNotificationOpened(payload) {
      store.recordNotificationOpened(payload as { id?: string; actor?: string; external_delivery_id?: string });
    },
    GetSecretStatus() {
      return secrets.status();
    },
    SaveSecret(payload) {
      const req = payload as { name?: string; value?: string };
      return secrets.save(String(req.name ?? ''), String(req.value ?? ''));
    },
    async LoginXAIOAuth() {
      const result = await loginWithXAIOAuthLoopback({
        saveSecret: (name, value) => secrets.save(name, value),
        openURL: (url) => shell.openExternal(url),
        readClipboard: () => clipboard.readText(),
        timeoutSeconds: 240,
      });
      const modelName = 'grok-4.5';
      store.saveModelConfig({
        provider: 'grok_build',
        base_url: DEFAULT_XAI_OAUTH_BASE_URL,
        name: modelName,
        reasoning_name: modelName,
        reasoning_effort: 'low',
        timeout_seconds: 60,
        max_retries: 1,
      });
      return {
        ...result,
        provider: 'grok_build',
        model_name: modelName,
      };
    },
    async GenerateWorkerToken() {
      const token = `joi_worker_${randomUUID().replace(/-/g, '')}`;
      await secrets.save('WORKER_TOKEN', token);
      return { token };
    },
  };

  if (!envFlagValue(process.env.JOI_DISABLE_CLI_HOST)) {
    void startJoiCommandHost({
      socketPath: defaultJoiCommandSocketPath(appDirs.userDataDir),
      handlers: sqliteApi,
      riskForMethod: ipcRiskLevel,
      hostInfo: {
        app: 'Joi',
        version: app.getVersion(),
        runtime: 'electron_sqlite',
      },
      terminal: {
        start: (req) => terminalManager.start(req),
        input: (req) => terminalManager.input(req),
        resize: (req) => terminalManager.resize(req),
        kill: (req) => terminalManager.kill(req),
        getStatus: (id) => terminalManager.getStatus(id),
      },
      replayRunEvents: (runID, afterSeq) => (store.getRunTrace(runID).events || []).filter((event) => Number(event.seq || 0) > afterSeq),
      acpWeb: {
        authorize: (token) => resolveACPBridgeGrant(token),
        execute: async ({ capability, payload, request_id, permission_profile }) => {
          const startedAt = Date.now();
          const parentRunID = typeof payload.__joi_parent_run_id === 'string' ? payload.__joi_parent_run_id.trim() : '';
          const parentConversationID = typeof payload.__joi_parent_conversation_id === 'string' ? payload.__joi_parent_conversation_id.trim() : '';
          const delegationDepth = Math.max(0, Number(payload.__joi_delegation_depth || 0));
          const capabilityPayload = { ...payload };
          delete capabilityPayload.__joi_parent_run_id;
          delete capabilityPayload.__joi_parent_conversation_id;
          delete capabilityPayload.__joi_delegation_depth;
          const canonicalCapability = canonicalElectronCapabilityName(capability);
          const grantedPermissionProfile: PermissionProfile = permission_profile === 'danger_full_access'
            ? 'danger_full_access'
            : permission_profile === 'workspace_write'
              ? 'workspace_write'
              : 'read_only';
          const capabilityRisk = electronCapabilityRisk(canonicalCapability);
          const capabilityRecords = mergeRuntimeCapabilityRecords(store.listCapabilities().capabilities).capabilities;
          const disabled = capabilityRecords.some((record) => (
            canonicalElectronCapabilityName(record.id) === canonicalCapability
            && record.enabled === false
          ));
          if (disabled) {
            const output = {
              status: 'policy_blocked',
              capability,
              code: 'CAPABILITY_DISABLED',
              summary: `${capability} is disabled in Joi Settings.`,
              permission_profile: grantedPermissionProfile,
              bridge_trace_id: request_id,
            };
            safeRecordAppLog(store, {
              level: 'warn',
              risk_level: capabilityRisk,
              category: 'tool',
              feature_key: `acp_bridge.${capability}.blocked`,
              source: 'acp_mcp_bridge',
              message: `ACP capability ${capability} was blocked`,
              duration_ms: Date.now() - startedAt,
              payload: { capability, request_id, reason: 'capability_disabled', permission_profile: grantedPermissionProfile },
            });
            return output;
          }
          try {
            const executed = await executeElectronCapability(
              capability,
              capabilityPayload,
              {
                message: `ACP requested Joi capability ${capability}`,
                conversation_id: parentConversationID || undefined,
                parent_run_id: parentRunID || undefined,
                runtime_mode: 'tool_calling',
                permission_profile: grantedPermissionProfile,
              },
              store,
              secrets,
              {
                parentRunID,
                modelProvider: store.getSettings().model_provider,
                delegateTask: parentRunID && parentConversationID && delegationDepth === 0
                  ? (delegateInputs) => executeDelegatedChildAgent({
                      inputs: delegateInputs,
                      parent_request: {
                        message: `ACP requested Joi capability ${capability}`,
                        conversation_id: parentConversationID,
                        parent_run_id: parentRunID,
                        runtime_mode: 'tool_calling',
                        permission_profile: grantedPermissionProfile,
                      },
                      parent_run_id: parentRunID,
                      parent_conversation_id: parentConversationID,
                      settings: store.getSettings(),
                      store,
                      secrets,
                      plugin_manager: pluginManager,
                    })
                  : undefined,
              },
            );
            if (!executed) throw new Error(`${capability} did not produce a Joi capability result`);
            const output: Record<string, unknown> = {
              ...executed.output,
              capability,
              permission_profile: grantedPermissionProfile,
              bridge_trace_id: request_id,
            };
            const outputStatus = String(output.status || 'completed');
            safeRecordAppLog(store, {
              level: outputStatus === 'failed' ? 'error' : outputStatus === 'policy_blocked' ? 'warn' : 'info',
              risk_level: capabilityRisk,
              category: 'tool',
              feature_key: `acp_bridge.${capability}.${outputStatus}`,
              source: 'acp_mcp_bridge',
              message: `ACP capability ${capability} ${outputStatus}`,
              duration_ms: Date.now() - startedAt,
              payload: { capability, request_id, status: outputStatus, permission_profile: grantedPermissionProfile },
            });
            return output;
          } catch (error) {
            safeRecordAppLog(store, {
              level: 'error',
              risk_level: capabilityRisk,
              category: 'tool',
              feature_key: `acp_bridge.${capability}.failed`,
              source: 'acp_mcp_bridge',
              message: `ACP capability ${capability} failed`,
              duration_ms: Date.now() - startedAt,
              payload: { capability, request_id, permission_profile: grantedPermissionProfile },
              error,
            });
            throw error;
          }
        },
      },
      logger: console,
      onInvocation: ({ method, risk, duration_ms, ok, error }) => {
        safeRecordAppLog(store, {
          level: ok ? 'debug' : 'error',
          risk_level: risk,
          category: 'cli',
          feature_key: `cli.${method}.${ok ? 'succeeded' : 'failed'}`,
          source: 'unix_command_host',
          message: `CLI ${method} ${ok ? 'succeeded' : 'failed'}`,
          duration_ms,
          payload: { method },
          error,
        });
      },
    }).catch((error) => {
      safeRecordAppLog(store, {
        level: 'error',
        risk_level: 'read_only',
        category: 'cli',
        feature_key: 'cli.command_host.failed',
        source: 'unix_command_host',
        message: 'CLI command host failed to start',
        error,
      });
    });
  }

  startBrowserBridgeIfEnabled(sqliteApi, store);

  ipcMain.removeHandler('joi:invoke');
  ipcMain.handle('joi:invoke', async (_event, input: unknown) => {
    const { method, payload } = invokeRequestSchema.parse(input);
    const handler = sqliteApi[method as DesktopIpcMethod];
    if (!handler) {
      throw new Error(`Unsupported Joi IPC method: ${method}`);
    }
    const startedAt = Date.now();
    safeRecordAppLog(store, {
      level: 'debug',
      risk_level: ipcRiskLevel(method),
      category: 'ipc',
      feature_key: `ipc.${method}.started`,
      source: 'electron_ipc',
      message: `IPC ${method} started`,
      payload: { method, payload: sanitizeIpcLogPayload(method, payload) },
    });
    try {
      const result = await handler(payload);
      safeRecordAppLog(store, {
        level: 'debug',
        risk_level: ipcRiskLevel(method),
        category: 'ipc',
        feature_key: `ipc.${method}.succeeded`,
        source: 'electron_ipc',
        message: `IPC ${method} succeeded`,
        duration_ms: Date.now() - startedAt,
        payload: { method },
      });
      return result;
    } catch (error) {
      safeRecordAppLog(store, {
        level: 'error',
        risk_level: ipcRiskLevel(method),
        category: 'ipc',
        feature_key: `ipc.${method}.failed`,
        source: 'electron_ipc',
        message: `IPC ${method} failed`,
        duration_ms: Date.now() - startedAt,
        payload: { method },
        error,
      });
      throw error;
    }
  });

  ipcMain.removeHandler('joi:app:getVersion');
  ipcMain.handle('joi:app:getVersion', () => app.getVersion());

  ipcMain.removeHandler('joi:app:openExternal');
  ipcMain.handle('joi:app:openExternal', async (_event, rawUrl: unknown) => {
    const url = externalUrlSchema.parse(rawUrl);
    await shell.openExternal(url);
  });

  ipcMain.removeHandler('joi:terminal:start');
  ipcMain.handle('joi:terminal:start', (_event, payload: unknown) => terminalManager.start(payload as TerminalSessionStartRequest | undefined));

  ipcMain.removeHandler('joi:terminal:input');
  ipcMain.handle('joi:terminal:input', (_event, payload: unknown) => {
    terminalManager.input(payload as TerminalSessionInputRequest);
  });

  ipcMain.removeHandler('joi:terminal:resize');
  ipcMain.handle('joi:terminal:resize', (_event, payload: unknown) => {
    terminalManager.resize(payload as TerminalSessionResizeRequest);
  });

  ipcMain.removeHandler('joi:terminal:kill');
  ipcMain.handle('joi:terminal:kill', (_event, payload: unknown) => {
    terminalManager.kill(payload as TerminalSessionKillRequest);
  });

  ipcMain.removeHandler('joi:terminal:getStatus');
  ipcMain.handle('joi:terminal:getStatus', (_event, rawID: unknown) => terminalManager.getStatus(String(rawID ?? '')));
}

async function inspectStdioMCPServer(server: MCPServerRecord): Promise<{
  tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
  resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>;
  prompts: Array<{ name: string; description?: string; arguments?: Array<{ name?: string }> }>;
}> {
  if (server.transport !== 'stdio') throw new Error(`Unsupported MCP transport: ${server.transport}`);
  const command = server.command?.trim();
  if (!command) throw new Error('MCP stdio command is required');
  const child = spawn(command, server.args || [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, JOI_MCP_INVENTORY_ONLY: '1' },
  });
  let stderr = '';
  let stdoutBuffer = '';
  let nextID = 1;
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  const rejectAll = (error: Error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-4000);
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += String(chunk);
    for (;;) {
      const newline = stdoutBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line) as { id?: number; result?: Record<string, unknown>; error?: { message?: string } };
        if (typeof message.id !== 'number') continue;
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message || 'MCP request failed'));
        else request.resolve(message.result || {});
      } catch {
        // Some servers write human-readable startup messages to stdout. Inventory
        // parsing ignores those lines but keeps valid JSON-RPC messages bounded.
      }
    }
  });
  child.once('error', (error) => rejectAll(error));
  child.once('exit', (code) => {
    if (pending.size > 0) rejectAll(new Error(`MCP server exited (${code ?? 'unknown'}): ${stderr.trim() || 'no stderr'}`));
  });
  const send = (message: Record<string, unknown>) => {
    if (!child.stdin.writable) throw new Error('MCP server stdin is not writable');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const call = (method: string, params: Record<string, unknown> = {}) => new Promise<Record<string, unknown>>((resolveCall, rejectCall) => {
    const id = nextID++;
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectCall(new Error(`MCP ${method} timed out${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
    }, 8000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolveCall(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        rejectCall(error);
      },
    });
    send({ jsonrpc: '2.0', id, method, params });
  });
  const optionalList = async (method: string, key: string) => {
    try {
      const result = await call(method);
      return Array.isArray(result[key]) ? result[key] as Record<string, unknown>[] : [];
    } catch (error) {
      if (/method not found|not supported/i.test(error instanceof Error ? error.message : String(error))) return [];
      throw error;
    }
  };
  try {
    await call('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'Joi Desktop', version: app.getVersion() },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    const [tools, resources, prompts] = await Promise.all([
      optionalList('tools/list', 'tools'),
      optionalList('resources/list', 'resources'),
      optionalList('prompts/list', 'prompts'),
    ]);
    return {
      tools: tools.map((item) => ({
        name: String(item.name || ''),
        description: String(item.description || ''),
        inputSchema: item.inputSchema && typeof item.inputSchema === 'object' ? item.inputSchema as Record<string, unknown> : {},
      })).filter((item) => item.name),
      resources: resources.map((item) => ({
        uri: String(item.uri || ''),
        name: String(item.name || item.uri || ''),
        description: String(item.description || ''),
        mimeType: String(item.mimeType || ''),
      })).filter((item) => item.uri),
      prompts: prompts.map((item) => ({
        name: String(item.name || ''),
        description: String(item.description || ''),
        arguments: Array.isArray(item.arguments) ? item.arguments as Array<{ name?: string }> : [],
      })).filter((item) => item.name),
    };
  } finally {
    rejectAll(new Error('MCP inventory session closed'));
    child.kill();
  }
}

function startBrowserBridgeIfEnabled(handlers: DesktopIpcHandlerMap, store: JoiSQLiteStore): void {
  if (browserBridgeServer) return;
  if (!browserBridgeEnabled()) return;

  const { host, port } = browserBridgeAddr();
  browserBridgeServer = createServer(async (req, res) => {
    const origin = String(req.headers.origin || '');
    if (!browserBridgeOriginAllowed(origin)) {
      writeBrowserBridgeJson(res, 403, { ok: false, data: null, error: { message: 'origin not allowed' } }, origin);
      return;
    }
    if (req.method === 'OPTIONS') {
      writeBrowserBridgeJson(res, 204, null, origin);
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      writeBrowserBridgeJson(res, 200, { ok: true, data: { status: 'ok' }, error: null }, origin);
      return;
    }
    if (req.method !== 'POST' || req.url !== '/invoke') {
      writeBrowserBridgeJson(res, 404, { ok: false, data: null, error: { message: 'not found' } }, origin);
      return;
    }

    try {
      const rawBody = await readBrowserBridgeBody(req);
      const input = JSON.parse(rawBody) as unknown;
      const { method, payload } = invokeRequestSchema.parse(input);
      const handler = handlers[method as DesktopIpcMethod];
      if (!handler) {
        throw new Error(`Unsupported Joi bridge method: ${method}`);
      }
      const result = await handler(payload);
      writeBrowserBridgeJson(res, 200, { ok: true, data: result, error: null }, origin);
    } catch (error) {
      safeRecordAppLog(store, {
        level: 'error',
        risk_level: 'read_only',
        category: 'browser_bridge',
        feature_key: 'browser_bridge.invoke.failed',
        source: 'electron_browser_bridge',
        message: 'Browser bridge invocation failed',
        error,
      });
      writeBrowserBridgeJson(res, 500, {
        ok: false,
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      }, origin);
    }
  });

  browserBridgeServer.on('error', (error) => {
    browserBridgeServer = null;
    console.warn('browser bridge skipped', error);
  });
  browserBridgeServer.listen(port, host, () => {
    console.info(`Joi browser bridge listening on http://${host}:${port}`);
  });
  app.once('before-quit', () => {
    void browserBridgeServer?.close();
    browserBridgeServer = null;
  });
}

function browserBridgeEnabled(): boolean {
  const value = String(process.env.JOI_BROWSER_BRIDGE_ENABLED || '').trim().toLowerCase();
  if (value === '0' || value === 'false' || value === 'off' || value === 'no') return false;
  if (value === '1' || value === 'true' || value === 'on' || value === 'yes') return true;
  return Boolean(process.env.ELECTRON_RENDERER_URL);
}

function envFlagValue(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function browserBridgeAddr(): { host: string; port: number } {
  const raw = String(process.env.JOI_BROWSER_BRIDGE_ADDR || '127.0.0.1:18083').trim();
  const [host = '127.0.0.1', rawPort = '18083'] = raw.split(':');
  const port = Number.parseInt(rawPort, 10);
  return {
    host: host || '127.0.0.1',
    port: Number.isFinite(port) && port > 0 ? port : 18083,
  };
}

function browserBridgeOriginAllowed(origin: string): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  } catch {
    return false;
  }
}

function writeBrowserBridgeJson(res: ServerResponse, status: number, payload: unknown, origin: string): void {
  res.statusCode = status;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (status === 204) {
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readBrowserBridgeBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024 * 10) {
        reject(new Error('browser bridge request is too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body || '{}'));
    req.on('error', reject);
  });
}

function safeRecordAppLog(store: JoiSQLiteStore, input: Parameters<JoiSQLiteStore['recordAppLog']>[0]): void {
  try {
    store.recordAppLog(input);
  } catch (error) {
    console.warn('app log write failed', error);
  }
}

function sanitizeIpcLogPayload(method: DesktopIpcMethod, payload: unknown): unknown {
  return sanitizeIpcLogValue(payload, ipcMethodMayCarrySecret(method));
}

function sanitizeIpcLogValue(value: unknown, redactGenericValue: boolean): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeIpcLogValue(item, redactGenericValue));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    const nameHint = String((value as Record<string, unknown>).name ?? (value as Record<string, unknown>).key ?? '');
    const redactValueForNamedSecret = ipcSensitiveLogKey(nameHint);
    for (const [key, item] of Object.entries(value)) {
      const normalized = key.toLowerCase();
      if (ipcSensitiveLogKey(key) || (normalized === 'value' && (redactGenericValue || redactValueForNamedSecret))) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = sanitizeIpcLogValue(item, redactGenericValue);
      }
    }
    return result;
  }
  return value;
}

function ipcMethodMayCarrySecret(method: DesktopIpcMethod): boolean {
  return /Secret|Token|OAuth|TelegramConfig|IMessageConfig|Photon|Worker/i.test(String(method));
}

function ipcSensitiveLogKey(key: string): boolean {
  return /api[_-]?key|apikey|authorization|bearer|credential|password|secret|token|private[_-]?key/i.test(key);
}

function ipcRiskLevel(method: DesktopIpcMethod): string {
  const name = String(method);
  if (/Clear|Delete|Purge|Restore|Save|Set|Disable|Enable|Decide|Approve|Reject|Rotate|Generate|Login|Setup|Send|Trigger|Update|Close|Reopen|Archive|Trash|Move|Interrupt|Redirect|Create/i.test(name)) {
    if (/Clear|Delete|Purge|Restore|Rotate/i.test(name)) return 'state_change';
    if (/Save|Set|Update|Create|Generate|Login|Setup|Send|Trigger|Move|Archive|Trash|Close|Reopen|Interrupt|Redirect|Decide|Disable|Enable/i.test(name)) return 'write_candidate';
  }
  return 'read_only';
}

async function getExternalHandoffReadiness(
  settings: SettingsRecord,
  secrets: KeychainSecretStore,
  serviceStatus: { getTelegramStatus?: () => TelegramInboundStatus | undefined; getIMessageStatus?: () => PhotonIMessageStatus | undefined } = {},
): Promise<ExternalHandoffReadiness> {
  const telegramToken = await resolvedSecretStatus(secrets, 'TELEGRAM_BOT_TOKEN');
  const photonProjectSecret = await resolvedSecretStatus(secrets, PHOTON_PROJECT_SECRET_SECRET);
  const photonDashboardToken = await resolvedSecretStatus(secrets, PHOTON_DASHBOARD_TOKEN_SECRET);
  const telegramAllowedUsers = resolvedSettingStatus('TELEGRAM_ALLOWED_USER_IDS', settings.telegram_allowed_user_ids);
  const photonProjectID = resolvedSettingStatus('PHOTON_PROJECT_ID', settings.imessage_project_id);
  const credentials: ExternalHandoffReadiness['credentials'] = {
    TELEGRAM_BOT_TOKEN: statusRecord(telegramToken),
    TELEGRAM_ALLOWED_USER_IDS: statusRecord(telegramAllowedUsers),
    PHOTON_PROJECT_ID: statusRecord(photonProjectID),
    PHOTON_PROJECT_SECRET: statusRecord(photonProjectSecret),
    PHOTON_DASHBOARD_TOKEN: statusRecord(photonDashboardToken),
  };
  const readiness: ExternalHandoffReadiness = {
    checked: true,
    ok: false,
    credentials,
    checks: {},
    services: {},
  };
  const missing = Object.entries(credentials)
    .filter(([, credential]) => !credential.present)
    .map(([name]) => name);
  if (missing.length > 0) {
    readiness.missing = missing;
  }

  if (telegramToken.value && telegramAllowedUsers.value) {
    readiness.checks.telegram_get_me = await testTelegramConnection({ token: telegramToken.value });
  }
  if (photonProjectID.value && photonProjectSecret.value) {
    readiness.checks.imessage_photon = await testPhotonIMessageConnection({
      project_id: photonProjectID.value,
      project_secret: photonProjectSecret.value,
    });
  }

  readiness.failed_checks = Object.entries(readiness.checks)
    .filter(([, check]) => !check.ok)
    .map(([name]) => name);
  const telegramStatus = serviceStatus.getTelegramStatus?.() || fallbackTelegramStatus(settings, Boolean(telegramToken.value));
  const imessageStatus = serviceStatus.getIMessageStatus?.() || fallbackIMessageStatus(settings, Boolean(photonProjectSecret.value));
  const telegramCheckOK = Boolean(readiness.checks.telegram_get_me?.ok);
  const imessageCheckOK = Boolean(readiness.checks.imessage_photon?.ok);
  readiness.services.telegram = {
    label: 'Telegram',
    enabled: telegramStatus.enabled,
    configured: telegramStatus.configured,
    running: telegramStatus.polling,
    ready: Boolean(telegramStatus.enabled && telegramStatus.configured && telegramStatus.polling && telegramCheckOK),
    last_poll_at: telegramStatus.last_poll_at,
    last_update_id: telegramStatus.last_update_id,
    last_error: telegramStatus.last_error,
    details: {
      allowed_user_ids_configured: telegramStatus.allowed_user_ids_configured,
      active_runs: telegramStatus.active_runs,
      connection_check: telegramCheckOK,
    },
  };
  readiness.services.imessage = {
    label: 'iMessage',
    enabled: imessageStatus.enabled,
    configured: imessageStatus.configured,
    running: Boolean(imessageStatus.sidecar_running),
    ready: Boolean(imessageStatus.enabled && imessageStatus.configured && imessageStatus.sidecar_running && imessageCheckOK),
    last_error: imessageStatus.last_error,
    details: {
      connected: imessageStatus.connected,
      sidecar_running: imessageStatus.sidecar_running,
      sidecar_port: imessageStatus.sidecar_port || null,
      allowed_users_configured: Boolean(imessageStatus.allowed_users?.trim()),
      require_mention: Boolean(imessageStatus.require_mention),
      connection_check: imessageCheckOK,
    },
  };
  readiness.failed_services = Object.entries(readiness.services)
    .filter(([, service]) => service.enabled && service.configured && !service.ready)
    .map(([name]) => name);
  readiness.ok = Object.values(readiness.services).some((service) => service.ready);
  return readiness;
}

function fallbackTelegramStatus(settings: SettingsRecord, tokenConfigured: boolean): TelegramInboundStatus {
  return {
    enabled: Boolean(settings.telegram_enabled),
    configured: tokenConfigured,
    polling: false,
    allowed_user_ids_configured: Boolean(settings.telegram_allowed_user_ids?.trim()),
    active_runs: 0,
  };
}

function fallbackIMessageStatus(settings: SettingsRecord, projectSecretConfigured: boolean): PhotonIMessageStatus {
  return {
    enabled: Boolean(settings.imessage_enabled),
    configured: Boolean(settings.imessage_project_id?.trim()) && projectSecretConfigured,
    connected: false,
    sidecar_running: false,
    sidecar_port: settings.imessage_sidecar_port,
    project_id: settings.imessage_project_id,
    operator_phone: settings.imessage_operator_phone,
    assigned_number: settings.imessage_assigned_number,
    allowed_users: settings.imessage_allowed_users,
    require_mention: settings.imessage_require_mention,
  };
}

async function resolvedSecretStatus(secrets: KeychainSecretStore, name: string): Promise<{ value: string; source: string }> {
  const envValue = process.env[name]?.trim() || '';
  if (envValue) return { value: envValue, source: 'env' };
  const keychainValue = await secrets.get(name);
  if (keychainValue) return { value: keychainValue, source: 'keychain' };
  return { value: '', source: 'missing' };
}

function resolvedSettingStatus(envName: string, settingValue?: string): { value: string; source: string } {
  const envValue = process.env[envName]?.trim() || '';
  if (envValue) return { value: envValue, source: 'env' };
  const value = settingValue?.trim() || '';
  if (value) return { value, source: 'sqlite_settings' };
  return { value: '', source: 'missing' };
}

function statusRecord(resolved: { value: string; source: string }): { present: boolean; source: string } {
  return {
    present: Boolean(resolved.value),
    source: resolved.source,
  };
}

function statusForExternalHandoffAudit(audit: ExternalHandoffAudit): ExternalHandoffAudit['status'] {
  if (!audit.schema_current) return 'schema_missing';
  if (audit.linked_live_handoffs.length > 0) return 'live_handoff_linked';
  if (audit.readiness.checked && !audit.readiness.ok) return 'external_not_ready';
  if (audit.metrics.external_runs > 0) return 'awaiting_desktop_continuation';
  return 'awaiting_external_input';
}

function nextActionForExternalHandoffStatus(status: ExternalHandoffAudit['status']): string {
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

export async function runLiveElectronToolCallingChat(
  req: ChatRequest,
  settings: SettingsRecord,
  secrets: KeychainSecretStore,
  store: JoiSQLiteStore,
  activeRuns: Map<string, AbortController>,
  emitInitialEvents: (runID: string, event?: RunEvent) => void,
  pluginManager?: JoiPluginManager,
  routeOptions: {
    model_selection_policy?: 'agent_preferred' | 'settings_preferred';
  } = {},
) {
  reloadFilesystemSkills(store);
  const modelName = (req.model_name || settings.model_name || '').trim();
  const routePurpose = modelRoutePurposeForChat(req);
  let started = store.beginToolCallingChat(req, {
    provider: settings.model_provider || 'openai_compatible',
    model_name: modelName,
    model_base_url: settings.model_base_url || '',
    model_reasoning_effort: settings.model_reasoning_effort,
    model_selection_policy: routeOptions.model_selection_policy,
    model_route_purpose: routePurpose,
  });
  emitInitialEvents(started.run_id);
  const controller = new AbortController();
  activeRuns.set(started.run_id, controller);
  const routedCandidates = store.modelRouteCandidates({
    agent_id: started.selected_agent_id,
    purpose: routePurpose,
    fallback: {
      provider: settings.model_provider || 'openai_compatible',
      model_name: modelName,
      base_url: settings.model_base_url || '',
      reasoning_effort: settings.model_reasoning_effort,
    },
  });
  const candidates = deduplicateModelRouteCandidates([
    {
      model_id: started.model_name,
      provider: started.provider,
      model_name: started.model_name,
      base_url: started.model_base_url || '',
      reasoning_effort: started.model_reasoning_effort,
      route_reason: 'initial_selection',
    },
    ...routedCandidates,
  ]);
  let lastError: Error | undefined;
  try {
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (index > 0) {
        started = store.retargetToolCallingChat(started, candidate, lastError || new Error('Model route changed'), index);
        emitInitialEvents(started.run_id);
      }
      const effectiveSettings = settingsForStartedModel(settings, started);
      try {
        const resolvedACPProvider = pluginManager?.resolveProvider(
          effectiveSettings.model_provider,
          req.permission_profile || 'read_only',
          started.prompt_assembly.agent_capabilities,
        );
        const acpProvider = resolvedACPProvider
          ? withACPParentContext(resolvedACPProvider, started.run_id, started.conversation_id, 0)
          : undefined;
        const apiKey = acpProvider ? LOCAL_MODEL_PROXY_API_KEY : await resolveAPIKeyForModelEndpoint(effectiveSettings, secrets);
        if (!canRunRealToolCalling(effectiveSettings, apiKey, { ...req, model_name: started.model_name }, Boolean(acpProvider))) {
          throw new Error(unconfiguredModelMessage(effectiveSettings, apiKey, { ...req, model_name: started.model_name }, Boolean(acpProvider)));
        }
        const turn = await runElectronToolCallingTurn(req, effectiveSettings, apiKey, store, secrets, {
          started,
          promptAssembly: started.prompt_assembly,
          signal: controller.signal,
          onRunEvent: (event) => emitInitialEvents(started.run_id, event),
          acpProvider,
          pluginManager,
        });
        return store.finishToolCallingChat(started, turn);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (controller.signal.aborted || isAbortError(err)) {
          return store.failToolCallingChat(started, err, 'cancelled');
        }
        lastError = err;
        if (index >= candidates.length - 1) return store.failToolCallingChat(started, err, 'failed');
      }
    }
    return store.failToolCallingChat(started, lastError || new Error('No model route was available'), 'failed');
  } finally {
    activeRuns.delete(started.run_id);
  }
}

function modelRoutePurposeForChat(req: ChatRequest): 'default' | 'child' | 'tool' | 'cheap' | 'long_context' {
  if (req.parent_run_id) return 'child';
  const message = req.message.trim();
  const attachmentCount = Array.isArray(req.attachments) ? req.attachments.length : 0;
  if (message.length >= 12_000 || attachmentCount >= 5) return 'long_context';
  if (
    /(?:代码|编译|测试|调试|浏览器|网页|搜索|读取|文件|终端|shell|命令|MCP|插件|扩展|图片|视频|语音|日历|计划|自动化|执行|修复|实现|部署)/i.test(message)
    || /\b(?:code|build|test|debug|browser|search|read|file|terminal|shell|command|mcp|plugin|extension|image|video|audio|calendar|plan|automate|execute|fix|implement|deploy)\b/i.test(message)
    || attachmentCount > 0
  ) return 'tool';
  if (
    message.length <= 120
    && /^(?:你好|嗨|hi|hello|谢谢|thank(?:s| you)|翻译|改写|总结|是什么|谁是|什么时候|多少|怎么读)/i.test(message)
  ) return 'cheap';
  return 'default';
}

function deduplicateModelRouteCandidates<T extends { provider: string; model_name: string; base_url?: string }>(candidates: T[]): T[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.provider}\u0000${candidate.model_name}\u0000${candidate.base_url || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function reloadFilesystemSkills(store: JoiSQLiteStore) {
  const workspace = store.getWorkspaceSettings();
  const packagedSkillRoot = app.isPackaged
    ? join(process.resourcesPath, 'skills')
    : join(app.getAppPath(), 'resources', 'skills');
  const discovered = discoverCodexSkills({
    cwd: workspace.default_root,
    extra_roots: [
      ...workspace.allowed_roots.map((root) => join(root, '.agents', 'skills')),
      join(homedir(), '.codex', 'plugins', 'cache'),
    ],
    system_roots: [packagedSkillRoot],
  });
  return store.syncDiscoveredSkills(discovered);
}

function settingsForStartedModel(settings: SettingsRecord, started: StartedToolCallingChat): SettingsRecord {
  return {
    ...settings,
    model_provider: started.provider || settings.model_provider,
    model_name: started.model_name || settings.model_name,
    model_base_url: started.model_base_url || settings.model_base_url,
    model_reasoning_effort: started.model_reasoning_effort || settings.model_reasoning_effort,
  };
}

function withACPParentContext(
  provider: ACPProviderRuntimeConfig,
  parentRunID: string,
  parentConversationID: string,
  delegationDepth: number,
): ACPProviderRuntimeConfig {
  const contextEnvironment = [
    { name: 'JOI_PARENT_RUN_ID', value: parentRunID },
    { name: 'JOI_PARENT_CONVERSATION_ID', value: parentConversationID },
    { name: 'JOI_DELEGATION_DEPTH', value: String(delegationDepth) },
  ];
  return {
    ...provider,
    env: {
      ...(provider.env || {}),
      JOI_PARENT_RUN_ID: parentRunID,
      JOI_PARENT_CONVERSATION_ID: parentConversationID,
      JOI_DELEGATION_DEPTH: String(delegationDepth),
    },
    mcp_servers: provider.mcp_servers?.map((server) => ('env' in server
      ? {
          ...server,
          env: [
            ...server.env.filter((entry) => !contextEnvironment.some((context) => context.name === entry.name)),
            ...contextEnvironment,
          ],
        }
      : server)),
  };
}

async function executeDelegatedChildAgent(params: {
  inputs: Record<string, unknown>;
  parent_request: ChatRequest;
  parent_run_id: string;
  parent_conversation_id: string;
  settings: SettingsRecord;
  store: JoiSQLiteStore;
  secrets: KeychainSecretStore;
  plugin_manager?: JoiPluginManager;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const prompt = typeof params.inputs.prompt === 'string' ? params.inputs.prompt.trim() : '';
  if (!prompt) throw new Error('delegate_task prompt is required');
  if (prompt.length > 30_000) throw new Error('delegate_task prompt exceeds 30000 characters');
  const requestedAgent = typeof params.inputs.agent === 'string' ? params.inputs.agent.trim() : '';
  const childAgentID = params.store.resolveAgentIDForTool(requestedAgent, 'research_agent');
  const childCapabilities = params.store.getAgentCapabilities(childAgentID)
    .filter((capability) => canonicalElectronCapabilityName(capability) !== 'delegate_task');
  if (childCapabilities.length === 0) throw new Error(`enabled child agent not found or has no capabilities: ${childAgentID}`);
  const childRequest: ChatRequest = {
    message: prompt,
    channel: 'desktop_child_agent',
    user_id: params.parent_request.user_id || 'desktop_user',
    principal_id: params.parent_request.principal_id,
    parent_run_id: params.parent_run_id,
    runtime_mode: 'tool_calling',
    permission_profile: params.parent_request.permission_profile || 'read_only',
    workspace_root: params.parent_request.workspace_root,
    model_name: params.parent_request.model_name,
    reasoning_effort: params.parent_request.reasoning_effort,
  };
  const childRoute = params.store.modelRouteCandidates({
    agent_id: childAgentID,
    purpose: 'child',
    fallback: {
      provider: params.settings.model_provider || 'openai_compatible',
      model_name: params.settings.model_name || params.parent_request.model_name || 'model',
      base_url: params.settings.model_base_url || '',
      reasoning_effort: params.settings.model_reasoning_effort,
    },
  })[0];
  const childStarted = params.store.beginToolCallingChat(childRequest, {
    provider: childRoute?.provider || params.settings.model_provider || 'openai_compatible',
    model_name: childRoute?.model_name || params.settings.model_name || params.parent_request.model_name || 'model',
    model_base_url: childRoute?.base_url || params.settings.model_base_url || '',
    model_reasoning_effort: childRoute?.reasoning_effort || params.settings.model_reasoning_effort,
    model_selection_policy: 'settings_preferred',
    selected_agent_id: childAgentID,
  });
  const childSettings = settingsForStartedModel(params.settings, childStarted);
  const resolvedProvider = params.plugin_manager?.resolveProvider(
    childSettings.model_provider,
    childRequest.permission_profile || 'read_only',
    childCapabilities,
  );
  const acpProvider = resolvedProvider
    ? withACPParentContext(resolvedProvider, childStarted.run_id, childStarted.conversation_id, 1)
    : undefined;
  try {
    const apiKey = acpProvider
      ? LOCAL_MODEL_PROXY_API_KEY
      : await resolveAPIKeyForModelEndpoint(childSettings, params.secrets);
    const turn = await runElectronToolCallingTurn(childRequest, childSettings, apiKey, params.store, params.secrets, {
      started: childStarted,
      promptAssembly: childStarted.prompt_assembly,
      signal: params.signal,
      acpProvider,
      pluginManager: params.plugin_manager,
      delegationDepth: 1,
    });
    const response = params.store.finishToolCallingChat(childStarted, turn);
    return {
      status: 'completed',
      capability: 'delegate_task',
      mode: 'bounded_child_agent_v1',
      parent_run_id: params.parent_run_id,
      parent_conversation_id: params.parent_conversation_id,
      child_run_id: childStarted.run_id,
      child_conversation_id: childStarted.conversation_id,
      child_agent_id: childAgentID,
      child_status: turn.status,
      child_response: response.response,
      recursive_delegation_allowed: false,
      summary: `Child agent ${childAgentID} completed in independent run ${childStarted.run_id}.`,
    };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    params.store.failToolCallingChat(childStarted, failure, params.signal?.aborted ? 'cancelled' : 'failed');
    throw failure;
  }
}

export function emitRunEvents(window: BrowserWindow, trace: ReturnType<JoiSQLiteStore['getRunTrace']>): void {
  for (const event of trace.events ?? []) {
    emitRunEvent(window, event);
  }
}

export function shouldForwardRunEventToRenderer(event: RunEvent): boolean {
  return event.visibility !== 'trace_only' && event.event_type !== 'model.delta';
}

export function emitRunEvent(window: BrowserWindow, event: RunEvent): void {
  publishJoiRunEvent(event);
  if (!window.isDestroyed() && shouldForwardRunEventToRenderer(event)) {
    window.webContents.send('joi:run:event', event);
  }
}

function emitRunEventsSince(
  window: BrowserWindow,
  trace: ReturnType<JoiSQLiteStore['getRunTrace']>,
  emittedSeqByRunID: Map<string, number>,
): void {
  const runID = trace.id || '';
  const lastSeq = emittedSeqByRunID.get(runID) || 0;
  let nextSeq = lastSeq;
  for (const event of trace.events ?? []) {
    const seq = typeof event.seq === 'number' ? event.seq : Number((event as Record<string, unknown>).seq || 0);
    if (seq <= lastSeq) continue;
    emitRunEvent(window, event);
    if (seq > nextSeq) nextSeq = seq;
  }
  if (runID && nextSeq > lastSeq) {
    emittedSeqByRunID.set(runID, nextSeq);
  }
}

export function canRunRealToolCalling(settings: SettingsRecord, apiKey: string, req: ChatRequest, acpProviderConfigured = false): boolean {
  if (req.runtime_mode && req.runtime_mode !== 'tool_calling') return false;
  if (acpProviderConfigured) return Boolean((req.model_name || settings.model_name || 'default').trim());
  const effectiveAPIKey = apiKeyForModelEndpoint(settings, apiKey);
  return realModelProviderConfigured(settings)
    && Boolean(modelBaseURLForSettings(settings).trim())
    && Boolean((req.model_name || settings.model_name || '').trim())
    && Boolean(effectiveAPIKey.trim());
}

function unconfiguredModelMessage(settings: SettingsRecord, apiKey: string, req: ChatRequest, acpProviderConfigured = false): string {
  if (req.runtime_mode && req.runtime_mode !== 'tool_calling') {
    return 'Joi Electron no longer supports the legacy desktop chat runtime. Use runtime_mode=tool_calling.';
  }
  if (acpProviderConfigured && !(req.model_name || settings.model_name || 'default').trim()) return 'ACP model name is not configured.';
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
  if (isXAIOAuthBackedProvider(settings.model_provider)) {
    const credentials = await resolveXAIOAuthCredentials((name) => secrets.resolve(name), (name, value) => secrets.save(name, value));
    return credentials.apiKey;
  }
  return (await secrets.resolve('MODEL_API_KEY')).trim();
}

function realModelProviderConfigured(settings: SettingsRecord): boolean {
  return settings.model_provider === 'openai_compatible' || isXAIOAuthBackedProvider(settings.model_provider);
}

function modelBaseURLForSettings(settings: SettingsRecord): string {
  if (isXAIOAuthBackedProvider(settings.model_provider)) {
    return validateXAIInferenceBaseURL(settings.model_base_url || DEFAULT_XAI_OAUTH_BASE_URL);
  }
  return settings.model_base_url || '';
}

function reasoningEffortForSettings(settings: SettingsRecord, modelName: string, requested?: string): string | undefined {
  const effort = (requested || settings.model_reasoning_effort || '').trim().toLowerCase();
  if (!['none', 'low', 'medium', 'high'].includes(effort)) return undefined;
  const normalizedModel = modelName.trim().toLowerCase();
  if (isXAIOAuthBackedProvider(settings.model_provider) && normalizedModel.startsWith('grok-')) return effort;
  return undefined;
}

async function runElectronToolCallingTurn(
  req: ChatRequest,
  settings: SettingsRecord,
  apiKey: string,
  store: JoiSQLiteStore,
  secrets: KeychainSecretStore,
  options: {
    started?: StartedToolCallingChat;
    promptAssembly?: ToolCallingPromptAssembly;
    signal?: AbortSignal;
    onRunEvent?: (event: RunEvent) => void;
    acpProvider?: ACPProviderRuntimeConfig;
    pluginManager?: JoiPluginManager;
    delegationDepth?: number;
  } = {},
) {
  const modelName = options.started?.model_name || (req.model_name || settings.model_name || '').trim();
  const agentID = options.started?.selected_agent_id || 'general_agent';
  const promptAssembly = options.promptAssembly || store.assembleToolCallingPrompt(req, agentID, modelName);
  const delegationDepth = Math.max(0, Math.floor(options.delegationDepth || 0));
  const agentCapabilities = (promptAssembly.agent_capabilities || store.getAgentCapabilities(agentID))
    .filter((capability) => delegationDepth === 0 || canonicalElectronCapabilityName(capability) !== 'delegate_task');
  const compiledTools = compileElectronCapabilityTools(req.permission_profile, {
    allowed_capabilities: agentCapabilities,
  });
  const compiledToolNames = new Set(compiledTools.map((tool) => tool.name));
  const executionContext = req.workspace_root?.trim()
    ? `Automation execution context:\n- Working directory: ${req.workspace_root.trim()}\nKeep file and command operations inside this authorized working directory unless the user explicitly requests another allowed root.`
    : '';
  const wrappedMCPCatalog = store.listMCPServers().servers
    .filter((server) => server.enabled !== false && server.status !== 'inactive')
    .flatMap((server) => server.tools
      .filter((tool) => tool.enabled && tool.wrapped_as)
      .map((tool) => `- ${server.id}/${tool.name} (wrapped as ${tool.wrapped_as}): ${tool.description || 'No description'}`));
  const mcpContext = wrappedMCPCatalog.length > 0
    ? `Enabled wrapped MCP tools\n${wrappedMCPCatalog.join('\n')}\nCall these only through mcp_tool_call with server_id, tool_name, and input.`
    : '';
  const systemMessage = [promptAssembly.system_message, executionContext, mcpContext].filter(Boolean).join('\n\n');
  const conversationMessages = [
    ...promptAssembly.conversation_messages.map((message) => ({ role: message.role, content: message.content })),
    { role: 'user', content: req.message },
  ];
  const capabilityRequest = options.started?.conversation_id && !req.conversation_id
    ? { ...req, conversation_id: options.started.conversation_id }
    : req;
  const callbacks = options.started ? store.createToolCallingEventCallbacks(options.started, options.onRunEvent) : undefined;
  const drainQueuedMessages = (kind: 'steering' | 'follow_up') => {
    if (!options.started) return [];
    return store.claimRunMessages({
      run_id: options.started.run_id,
      delivered_run_id: options.started.run_id,
      kind,
    }).map((message) => ({
      role: 'user',
      content: message.content,
      metadata: { queue_message_id: message.id, queued_kind: message.kind },
    }));
  };
  let delegatedChildCount = 0;
  const result = options.acpProvider ? await runACPChatTurn({
    ...options.acpProvider,
    model: modelName,
    system_message: systemMessage,
    messages: conversationMessages,
    signal: options.signal,
    callbacks,
    getSteeringMessages: () => drainQueuedMessages('steering'),
    getFollowUpMessages: () => drainQueuedMessages('follow_up'),
  }) : await runChatCompletionsToolTurn({
    base_url: modelBaseURLForSettings(settings),
    api_key: apiKey,
    model: modelName,
    messages: [
      { role: 'system', content: systemMessage },
      ...conversationMessages,
    ],
    tools: compiledTools,
    stream: true,
    reasoning_effort: reasoningEffortForSettings(settings, modelName, req.reasoning_effort),
    max_retries: settings.model_max_retries ?? 1,
    retry_backoff_ms: 300,
    tool_execution: 'parallel',
    max_context_messages: 80,
    max_tool_result_bytes: 64 * 1024,
    final_response_contract: inferFinalResponseContract(conversationMessages),
    max_steps: 6,
    timeout_seconds: settings.model_timeout_seconds ?? 60,
    signal: options.signal,
    callbacks,
    getSteeringMessages: () => drainQueuedMessages('steering'),
    getFollowUpMessages: () => drainQueuedMessages('follow_up'),
    beforeToolCall: ({ call }) => compiledToolNames.has(call.name)
      ? undefined
      : { block: true, reason: `Capability ${call.name} is not allowed for agent ${agentID}.` },
    executeTool: async (call, toolOptions) => {
      try {
        if (electronCapabilityRequiresConfirmation(call.name)) {
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
                ? '浏览器操作需要你确认后才会执行。'
                : '工作区写入需要你确认后才会执行。',
            },
          };
        }
        const executed = await executeElectronCapability(call.name, call.arguments, capabilityRequest, store, secrets, {
          signal: toolOptions?.signal,
          modelProvider: settings.model_provider,
          modelName,
          parentRunID: options.started?.run_id,
          delegateTask: async (delegateInputs) => {
            if (!options.started) throw new Error('delegate_task requires a persisted parent run');
            if (delegationDepth > 0) throw new Error('child agents cannot recursively delegate');
            if (delegatedChildCount >= 1) throw new Error('this parent turn has already created its bounded child agent');
            delegatedChildCount += 1;
            return executeDelegatedChildAgent({
              inputs: delegateInputs,
              parent_request: capabilityRequest,
              parent_run_id: options.started.run_id,
              parent_conversation_id: options.started.conversation_id,
              settings,
              store,
              secrets,
              plugin_manager: options.pluginManager,
              signal: toolOptions?.signal,
            });
          },
        });
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
        if (error instanceof Error && isAbortError(error)) throw error;
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
    usage_status: result.usage_status,
    finish_reason: result.finish_reason,
    model_responses: result.model_responses,
  };
}

function isAbortError(error: Error): boolean {
  return error.name === 'AbortError' || /abort|interrupted|cancel/i.test(error.message);
}

async function resumeApprovalRunFromPayload(
  payload: ApprovalResumeRunRequest,
  window: BrowserWindow,
  store: JoiSQLiteStore,
  secrets: KeychainSecretStore,
) {
  const approvalRequestID = payload.approval_request_id?.trim() || '';
  if (!approvalRequestID) throw new Error('approval_request_id is required');
  const resume = store.loadApprovedToolCallingResume(approvalRequestID);
  if (!resume) return { resumed: false };
  if (payload.run_id?.trim() && payload.run_id.trim() !== resume.run_id) {
    throw new Error('approval run_id does not match confirmation request');
  }
  const settings = store.getSettings();
  await resumeElectronToolCallingRun(resume, settings, await resolveAPIKeyForModelEndpoint(settings, secrets), store, secrets);
  const trace = store.getRunTrace(resume.run_id);
  emitRunEvents(window, trace);
  return { resumed: true, trace };
}

async function resumeElectronToolCallingRun(
  resume: ToolCallingResumeRequest,
  settings: SettingsRecord,
  apiKey: string,
  store: JoiSQLiteStore,
  secrets: KeychainSecretStore,
) {
  const modelName = (resume.model_name || settings.model_name || '').trim();
  const resumeReq: ChatRequest = {
    conversation_id: resume.conversation_id,
    message: resume.user_message,
    runtime_mode: 'tool_calling',
    permission_profile: resume.risk_level === 'browser_interaction' ? 'danger_full_access' : resume.risk_level === 'workspace_write' ? 'workspace_write' : 'read_only',
  };
  const resumeAgentCapabilities = store.getAgentCapabilities(resume.agent_id);
  const resumeCapability = canonicalElectronCapabilityName(resume.capability_id);
  const approvedCapabilities = new Set(compileElectronCapabilityTools(resumeReq.permission_profile, {
    allowed_capabilities: resumeAgentCapabilities,
  }).map((tool) => canonicalElectronCapabilityName(tool.name)));
  if (!approvedCapabilities.has(resumeCapability)) {
    throw new Error(`Capability ${resume.capability_id} is no longer allowed for agent ${resume.agent_id}.`);
  }
  let toolResult: PersistedToolResult;
  try {
    const executed = await executeElectronCapability(resume.capability_id, resume.input, resumeReq, store, secrets);
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
  let modelError = '';
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
        tools: compileElectronCapabilityTools('read_only', { allowed_capabilities: resumeAgentCapabilities }),
        stream: true,
        reasoning_effort: reasoningEffortForSettings(settings, modelName),
        max_retries: settings.model_max_retries ?? 1,
        retry_backoff_ms: 300,
        tool_execution: 'parallel',
        max_context_messages: 80,
        max_tool_result_bytes: 64 * 1024,
        max_steps: 4,
        timeout_seconds: settings.model_timeout_seconds ?? 60,
        executeTool: async (call) => {
          const executed = await executeElectronCapability(call.name, call.arguments, { ...resumeReq, permission_profile: 'read_only' }, store, secrets);
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
      modelError = error instanceof Error ? error.message : String(error);
    }
  } else {
    modelError = 'Real model configuration is missing during approval resume.';
  }

  store.completeApprovedToolCallingResume(resume.confirmation_id, {
    provider: settings.model_provider || resume.provider || 'openai_compatible',
    model_name: modelName || resume.model_name || 'model',
    final_message: finalMessage,
    tool_result: toolResult,
    model_error: modelError || undefined,
    usage,
    model_responses: modelResponses,
  });
}

function electronRiskForCapability(capability: string): string {
  return electronCapabilityRisk(capability);
}

function electronSystemMessage(): Record<string, unknown> {
  return {
    role: 'system',
    content: [
      'You are Joi Desktop running inside an Electron-native local app.',
      'Use only the provided capability tools. Do not claim that a tool ran unless a tool result is present.',
      'Prefer concise final answers grounded in tool outputs. Never request Docker/Postgres/NATS as a default prerequisite for this local desktop app.',
      'Do not proactively add emoji, decorative symbols, or celebratory icons to assistant replies. Only include emoji when the user explicitly asks to discuss, quote, transform, or generate emoji content.',
      runtimeDateContextText(),
    ].join('\n'),
  };
}

function runtimeDateContextText(): string {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  return [
    `Current date: ${formatRuntimeDate(now)}`,
    `Current time: ${formatRuntimeTime(now)}`,
    `Timezone: ${timezone}`,
    `Current ISO timestamp: ${now.toISOString()}`,
    'Treat the current date above as authoritative for all relative-date, release-date, schedule, and news comparisons.',
    'Search result snippets are unverified summaries. For releases or official announcements, prefer official pages and state when a result is only an unverified snippet.',
  ].join('\n');
}

function formatRuntimeDate(date: Date): string {
  return [
    date.getFullYear(),
    padRuntimeDatePart(date.getMonth() + 1),
    padRuntimeDatePart(date.getDate()),
  ].join('-');
}

function formatRuntimeTime(date: Date): string {
  return [
    padRuntimeDatePart(date.getHours()),
    padRuntimeDatePart(date.getMinutes()),
    padRuntimeDatePart(date.getSeconds()),
  ].join(':');
}

function padRuntimeDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function mergeRuntimeCapabilityRecords(existing: CapabilityRecord[]): { capabilities: CapabilityRecord[] } {
  const byID = new Map(existing.map((capability) => [capability.id, {
    ...capability,
    metadata: { ...(capability.metadata || {}) },
  }]));
  for (const definition of listElectronCapabilityToolDefinitions()) {
    const current = byID.get(definition.name);
    const metadata = {
      ...(current?.metadata || {}),
      electron_native: true,
      model_visible: definition.backend !== 'planned' && definition.backend !== 'alias',
      backend: definition.backend || 'implemented',
      fields: definition.fields,
    };
    byID.set(definition.name, {
      id: definition.name,
      name: current?.name || capabilityDisplayName(definition.name),
      description: current?.description || definition.description,
      risk_level: current?.risk_level || definition.risk,
      enabled: definition.backend === 'planned' ? false : current?.enabled ?? true,
      metadata,
    });
  }
  return {
    capabilities: [...byID.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function capabilityDisplayName(value: string): string {
  const explicit: Record<string, string> = {
    web_research: 'Web Research',
    web_search: 'Web Search',
    web_extract: 'Web Extract',
    x_search: 'X Search',
    workspace_search: 'Workspace Search',
    search_files: 'Search Files',
    file_read: 'File Read',
    read_file: 'Read File',
    file_analyze: 'File Analyze',
    apply_patch: 'Apply Patch',
    execute_code: 'Execute Code',
    code_execution: 'Code Execution',
    mcp_tool_call: 'MCP Tool Call',
    text_to_speech: 'Text To Speech',
    ha_call_service: 'Home Assistant Call Service',
  };
  if (explicit[value]) return explicit[value];
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function workspaceSettingsWithSecrets(store: JoiSQLiteStore, secrets: KeychainSecretStore): Promise<WorkspaceSettings> {
  const settings = store.getWorkspaceSettings();
  const braveSearchAPIKey = (await secrets.resolve('BRAVE_SEARCH_API_KEY')).trim();
  return {
    ...settings,
    brave_search_api_key: braveSearchAPIKey,
    brave_search_api_key_configured: Boolean(braveSearchAPIKey),
  };
}


function firstStringInput(inputs: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = inputs[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function workspaceSearchAliasInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  return {
    ...inputs,
    query: firstStringInput(inputs, ['query', 'pattern', 'name', 'goal', 'text']),
  };
}

function fileReadAliasInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  return {
    ...inputs,
    path: firstStringInput(inputs, ['path', 'file_path', 'target_path']),
  };
}

function webSearchAliasInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  return {
    ...inputs,
    query: firstStringInput(inputs, ['query', 'q', 'goal', 'text']),
  };
}

function webExtractAliasInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  return {
    ...inputs,
    url: firstStringInput(inputs, ['url', 'source_url', 'href']),
  };
}

function commandAliasInputs(inputs: Record<string, unknown> & { permission_profile: string }): Record<string, unknown> & { permission_profile: string } {
  return {
    ...inputs,
    cmd: commandArgvFromAlias(inputs.cmd),
  };
}

function listAliasInputs(inputs: Record<string, unknown> & { permission_profile: string }): Record<string, unknown> & { permission_profile: string } {
  const path = firstStringInput(inputs, ['path', 'root']);
  return {
    ...inputs,
    cmd: path ? ['ls', path] : ['ls'],
  };
}

function browserRequestFromCapability(capability: string, inputs: Record<string, unknown>): BrowserWorkbenchRequest {
  const base = {
    session_id: firstStringInput(inputs, ['session_id', 'target']) || undefined,
    tab_id: Number(inputs.tab_id || 0) || undefined,
    visible: inputs.visible === true,
    timeout_ms: Number(inputs.timeout_ms || 0) || undefined,
  };
  if (capability === 'browser_observe' || capability === 'browser_snapshot') return { action: 'observe', ...base };
  if (capability === 'browser_navigate') return { action: 'navigate', ...base, url: firstStringInput(inputs, ['url']) };
  if (capability === 'browser_back') return { action: 'back', ...base };
  if (capability === 'browser_forward') return { action: 'forward', ...base };
  if (capability === 'browser_reload') return { action: 'reload', ...base };
  if (capability === 'browser_click') return { action: 'click', ...base, selector: firstStringInput(inputs, ['selector']) };
  if (capability === 'browser_type') return { action: 'type', ...base, selector: firstStringInput(inputs, ['selector']), text: String(inputs.text || '') };
  if (capability === 'browser_press') return { action: 'press', ...base, key: firstStringInput(inputs, ['key']) };
  if (capability === 'browser_scroll') {
    const amount = Number(inputs.amount || 700);
    const direction = firstStringInput(inputs, ['direction']).toLowerCase();
    return {
      action: 'scroll',
      ...base,
      delta_x: Number(inputs.delta_x || 0),
      delta_y: Number(inputs.delta_y || (direction === 'up' ? -Math.abs(amount) : Math.abs(amount))),
    };
  }
  if (capability === 'browser_console') return { action: 'console', ...base };
  if (capability === 'browser_network') return { action: 'network', ...base };
  if (capability === 'browser_get_images') return { action: 'get_images', ...base };
  if (capability === 'browser_screenshot') return { action: 'screenshot', ...base };
  if (capability === 'browser_vision') return { action: 'vision', ...base, text: firstStringInput(inputs, ['question']) };
  if (capability === 'browser_dialog') return { action: 'dialog', ...base, text: firstStringInput(inputs, ['action']) || 'accept', params: { prompt_text: firstStringInput(inputs, ['text']) } };
  if (capability === 'browser_upload') return { action: 'upload', ...base, selector: firstStringInput(inputs, ['selector']), paths: Array.isArray(inputs.paths) ? inputs.paths.map(String) : [firstStringInput(inputs, ['path'])].filter(Boolean) };
  if (capability === 'browser_evaluate') return { action: 'evaluate', ...base, expression: firstStringInput(inputs, ['expression', 'script']) };
  if (capability === 'browser_cdp') return { action: 'cdp', ...base, method: firstStringInput(inputs, ['method']), params: isRecordValue(inputs.params) ? inputs.params : {} };
  if (capability === 'browser_tabs') {
    const action = firstStringInput(inputs, ['action']);
    if (action === 'new') return { action: 'new_tab', ...base, url: firstStringInput(inputs, ['url']) || 'about:blank' };
    if (action === 'activate') return { action: 'activate_tab', ...base };
    if (action === 'close') return { action: 'close_tab', ...base };
    return { action: 'list_tabs', ...base };
  }
  return { action: capability.replace(/^browser_/, ''), ...base };
}

function patchAliasInputs(
  capability: string,
  inputs: Record<string, unknown> & { permission_profile: string },
): Record<string, unknown> | undefined {
  const patch = firstStringInput(inputs, ['patch']);
  if (!patch) return undefined;
  return {
    ...inputs,
    patch,
    source_capability: capability,
  };
}

function commandArgvFromAlias(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  const text = value.trim();
  if (!text || /[;&|`$<>]/.test(text)) return [];
  return (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? [])
    .map((item) => item.replace(/^(['"])(.*)\1$/, '$2').trim())
    .filter(Boolean);
}

async function executeElectronCapability(
  capability: string,
  inputs: Record<string, unknown>,
  req: ChatRequest,
  store: JoiSQLiteStore,
  secrets: KeychainSecretStore,
  options: {
    signal?: AbortSignal;
    modelProvider?: string;
    modelName?: string;
    parentRunID?: string;
    delegateTask?: (inputs: Record<string, unknown>) => Promise<Record<string, unknown>>;
  } = {},
): Promise<{ output: Record<string, unknown> } | undefined> {
  const permissionProfile = String(req.permission_profile || inputs.permission_profile || 'read_only');
  const inputsWithPermission: Record<string, unknown> & { permission_profile: string } = {
    ...inputs,
    permission_profile: permissionProfile,
  };
  const workspaceSettings = store.getWorkspaceSettings();
  const browserDisabled = () => ({
    output: {
      status: 'blocked',
      code: 'CAPABILITY_DISABLED',
      capability,
      summary: 'Browser capabilities are disabled in Settings.',
    },
  });
  switch (capability) {
    case 'workspace_search':
      return { output: executeWorkspaceSearch(inputs, store.getWorkspaceSettings()) };
    case 'search_files':
    case 'grep':
    case 'find':
      return { output: executeWorkspaceSearch(workspaceSearchAliasInputs(inputs), store.getWorkspaceSettings()) };
    case 'file_analyze':
      return { output: executeFileAnalyze(inputs, store.getWorkspaceSettings()) };
    case 'file_read':
      return { output: executeFileRead(inputs, store.getWorkspaceSettings()) };
    case 'read_file':
    case 'read':
      return { output: executeFileRead(fileReadAliasInputs(inputs), store.getWorkspaceSettings()) };
    case 'web_research':
      if (
        (typeof inputs.url !== 'string' || !inputs.url.trim())
        && (typeof inputs.query !== 'string' || !inputs.query.trim())
      ) return undefined;
      return { output: await executeWebResearch(inputs, await workspaceSettingsWithSecrets(store, secrets)) };
    case 'web_search':
      return { output: await executeWebResearch(webSearchAliasInputs(inputs), await workspaceSettingsWithSecrets(store, secrets)) };
    case 'web_extract':
      return { output: await executePublicWebExtract(webExtractAliasInputs(inputs), await workspaceSettingsWithSecrets(store, secrets)) };
    case 'shell_command':
      return { output: await executeShellCommand(inputsWithPermission, store.getWorkspaceSettings(), { signal: options.signal }) };
    case 'bash':
      return { output: await executeShellCommand(commandAliasInputs(inputsWithPermission), store.getWorkspaceSettings(), { signal: options.signal }) };
    case 'ls':
      return { output: await executeShellCommand(listAliasInputs(inputsWithPermission), store.getWorkspaceSettings(), { signal: options.signal }) };
    case 'test_command':
      return { output: await executeTestCommand(inputsWithPermission, store.getWorkspaceSettings(), { signal: options.signal }) };
    case 'execute_code':
    case 'code_execution':
    case 'sandbox_run':
      return { output: await executeCodeCapability(capability, inputs, workspaceSettings, permissionProfile, options.signal) };
    case 'shell_start':
      return {
        output: executeShellStartCapability(
          inputs,
          getTerminalSessionManager(),
          workspaceSettings.default_root,
          permissionProfile,
        ),
      };
    case 'shell_write':
      return { output: executeShellWriteCapability(inputs, getTerminalSessionManager(), permissionProfile) };
    case 'shell_output':
      return { output: executeShellOutputCapability(inputs, getTerminalSessionManager()) };
    case 'shell_kill':
      return { output: executeShellKillCapability(inputs, getTerminalSessionManager(), permissionProfile) };
    case 'image_generate':
      if (!isGrokBuildProvider(options.modelProvider)) {
        return { output: executeUnsupportedCapability(capability, inputsWithPermission, 'grok_build_required') };
      }
      return {
        output: await executeGrokBuildImageGeneration(inputs, {
          session_cwd: join(app.getPath('userData'), 'grok-build-image-runtime'),
          output_dir: join(app.getPath('userData'), 'generated-images'),
          timeout_seconds: 180,
          signal: options.signal,
        }),
      };
    case 'video_generate': {
      const credentials = await resolveXAIOAuthCredentials(
        (name) => secrets.resolve(name),
        (name, value) => secrets.save(name, value),
      );
      return {
        output: await executeXAIVideoGeneration(inputs, {
          api_key: credentials.apiKey,
          base_url: credentials.baseURL,
          output_dir: join(app.getPath('userData'), 'generated-videos'),
          timeout_seconds: 600,
          signal: options.signal,
        }),
      };
    }
    case 'image_analyze':
    case 'vision_analyze': {
      const sourcePath = authorizedMediaPath(
        inputs.path ?? inputs.image_path,
        workspaceSettings,
        permissionProfile,
      );
      return {
        output: await analyzeImageFile(
          sourcePath,
          join(app.getPath('userData'), 'media-workbench', 'agent-analysis'),
          options.signal,
        ),
      };
    }
    case 'video_analyze': {
      const sourcePath = authorizedMediaPath(
        inputs.path ?? inputs.video_path,
        workspaceSettings,
        permissionProfile,
      );
      const output = await analyzeVideoFile(
        sourcePath,
        join(app.getPath('userData'), 'media-workbench', 'agent-analysis'),
        { signal: options.signal, max_frames: Number(inputs.max_frames || 6) },
      );
      if (inputs.transcribe === true) {
        try {
          output.transcription = await executeLocalSpeechTranscription({
            path: sourcePath,
            model: inputs.model || 'tiny',
            language: inputs.language || 'auto',
          }, {
            output_dir: join(app.getPath('userData'), 'media-workbench', 'agent-transcriptions'),
            signal: options.signal,
            timeout_seconds: 900,
          });
        } catch (error) {
          output.transcription_error = error instanceof Error ? error.message : String(error);
        }
      }
      return { output };
    }
    case 'text_to_speech':
      return {
        output: await executeLocalTextToSpeech(inputs, {
          output_dir: join(app.getPath('userData'), 'generated-audio'),
          signal: options.signal,
          timeout_seconds: 180,
        }),
      };
    case 'speech_transcribe':
      return {
        output: await executeLocalSpeechTranscription({
          ...inputs,
          path: authorizedSpeechPath(inputs.path ?? inputs.file_path, workspaceSettings),
        }, {
          output_dir: join(app.getPath('userData'), 'speech-transcriptions'),
          signal: options.signal,
          timeout_seconds: 600,
        }),
      };
    case 'assistant_workspace':
      return {
        output: {
          status: 'completed',
          capability: 'assistant_workspace',
          snapshot: store.getAssistantWorkspace(),
          summary: 'Loaded the local personal-assistant workspace.',
        },
      };
    case 'assistant_action':
      if (permissionProfile !== 'danger_full_access') return undefined;
      if (!assistantRuntimeManager) throw new Error('personal assistant runtime is not initialized');
      return {
        output: await assistantRuntimeManager.execute(inputs as AssistantActionRequest) as unknown as Record<string, unknown>,
      };
    case 'apply_patch':
      if (!['workspace_write', 'danger_full_access'].includes(String(req.permission_profile || ''))) return undefined;
      return { output: executeApplyPatch(inputsWithPermission, store.getWorkspaceSettings()) };
    case 'patch':
    case 'edit_file':
    case 'edit':
    case 'write_file':
    case 'write': {
      if (!['workspace_write', 'danger_full_access'].includes(String(req.permission_profile || ''))) return undefined;
      const patchInputs = patchAliasInputs(capability, inputsWithPermission);
      if (!patchInputs) return { output: executeUnsupportedCapability(capability, inputsWithPermission, 'patch_required') };
      return { output: executeApplyPatch(patchInputs, store.getWorkspaceSettings()) };
    }
    case 'computer_observe':
      return { output: await executeComputerObserve(inputs) };
    case 'find_roots':
    case 'observe_ui':
    case 'search_ui':
    case 'expand_ui':
    case 'inspect_ui':
    case 'read_text':
    case 'wait_for':
      return {
        output: await executeJoiPiComputerUse(capability, inputs, {
          cwd: workspaceSettings.default_root,
          signal: options.signal,
        }),
      };
    case 'act_ui':
    case 'computer_use':
      if (String(req.permission_profile || '') !== 'danger_full_access') return undefined;
      return {
        output: await executeJoiPiComputerUse(capability, inputs, {
          cwd: workspaceSettings.default_root,
          signal: options.signal,
        }),
      };
    case 'browser_observe':
    case 'browser_snapshot':
    case 'browser_navigate':
    case 'browser_back':
    case 'browser_forward':
    case 'browser_reload':
    case 'browser_scroll':
    case 'browser_press':
    case 'browser_console':
    case 'browser_network':
    case 'browser_get_images':
    case 'browser_tabs':
    case 'browser_screenshot':
    case 'browser_vision':
      if (workspaceSettings.browser_enabled === false) return browserDisabled();
      return { output: await executeBrowserWorkbenchAction(browserRequestFromCapability(capability, inputs)) as unknown as Record<string, unknown> };
    case 'browser_click':
    case 'browser_type':
    case 'browser_dialog':
    case 'browser_upload':
    case 'browser_evaluate':
    case 'browser_cdp':
      if (workspaceSettings.browser_enabled === false) return browserDisabled();
      if (String(req.permission_profile || '') !== 'danger_full_access') return undefined;
      return { output: await executeBrowserWorkbenchAction(browserRequestFromCapability(capability, inputs)) as unknown as Record<string, unknown> };
    case 'desktop_app_list':
      return { output: executeDesktopAppList(inputs) };
    case 'desktop_app_inspect':
      return { output: executeDesktopAppInspect(inputs) };
    case 'system_health_check':
      return { output: executeSystemHealthCheck(store.systemHealth()) };
    case 'server_diagnose':
      return { output: await executeServerDiagnose(inputs) };
    case 'memory_recall':
    case 'memory_search':
      return { output: executeMemoryRecallCapability(inputs, req, store) };
    case 'memory_write_candidate':
      if (!['workspace_write', 'danger_full_access'].includes(permissionProfile)) return undefined;
      return { output: executeMemoryWriteCandidateCapability(inputs, req, store) };
    case 'session_search':
      return { output: executeSessionSearchCapability(inputs, store) };
    case 'session_summary':
      return { output: executeSessionSummaryCapability(inputs, req, store) };
    case 'session_branch':
      if (!['workspace_write', 'danger_full_access'].includes(permissionProfile)) return undefined;
      return { output: executeSessionBranchCapability(inputs, req, store, options.parentRunID) };
    case 'session_compact':
    case 'compaction_run':
      if (!['workspace_write', 'danger_full_access'].includes(permissionProfile)) return undefined;
      return { output: executeSessionCompactCapability(inputs, req, store, options.parentRunID) };
    case 'delegate_task':
    case 'subagent_delegate':
      if (!['workspace_write', 'danger_full_access'].includes(permissionProfile)) return undefined;
      if (!options.delegateTask) return { output: executeUnsupportedCapability(capability, inputsWithPermission, 'parent_run_context_required') };
      return { output: await options.delegateTask(inputs) };
    case 'mcp_tool_call': {
      const serverID = firstStringInput(inputs, ['server_id', 'server']);
      const toolName = firstStringInput(inputs, ['tool_name', 'tool']);
      const server = store.listMCPServers().servers.find((item) => item.id === serverID && item.enabled !== false);
      if (!server) throw new Error(`Enabled MCP server not found: ${serverID || '(empty)'}`);
      const tool = server.tools.find((item) => item.name === toolName && item.enabled);
      if (!tool) throw new Error(`MCP tool not found: ${serverID}/${toolName}`);
      if (!tool.wrapped_as) throw new Error(`MCP tool is not wrapped as a Joi capability: ${serverID}/${toolName}`);
      const result = await getMCPRuntimeManager().callTool(
        server,
        toolName,
        isRecordValue(inputs.input) ? inputs.input : isRecordValue(inputs.arguments) ? inputs.arguments : {},
        Number(inputs.timeout_ms || 120_000),
      );
      return {
        output: {
          status: result.is_error ? 'failed' : 'completed',
          capability: 'mcp_tool_call',
          wrapped_capability_id: tool.wrapped_as,
          ...result,
          summary: result.is_error
            ? `MCP ${serverID}/${toolName} returned an error.`
            : `MCP ${serverID}/${toolName} completed.`,
        },
      };
    }
    case 'extension_register_tool': {
      if (!['workspace_write', 'danger_full_access'].includes(permissionProfile)) return undefined;
      const extensionID = firstStringInput(inputs, ['extension_id', 'plugin_id']);
      const serverID = firstStringInput(inputs, ['server_id']);
      const toolName = firstStringInput(inputs, ['tool_name']);
      const plugin = store.listPlugins().plugins.find((item) => item.id === extensionID && item.enabled);
      if (!plugin) throw new Error(`Enabled extension not found: ${extensionID || '(empty)'}`);
      if (!plugin.mcp_server_ids.includes(serverID)) throw new Error(`MCP server ${serverID} does not belong to extension ${extensionID}`);
      const server = store.listMCPServers().servers.find((item) => item.id === serverID && item.enabled !== false);
      const tool = server?.tools.find((item) => item.name === toolName);
      if (!server || !tool) throw new Error(`Extension MCP tool not found: ${serverID}/${toolName}`);
      const wrapped = store.wrapMCPTool({
        server_id: serverID,
        tool_name: toolName,
        request: {
          capability_id: firstStringInput(inputs, ['capability_id']) || `mcp_${serverID}_${toolName}`.replace(/[^A-Za-z0-9_-]/g, '_'),
          description: firstStringInput(inputs, ['description']) || tool.description || `Extension tool ${toolName}`,
          intent_domain: firstStringInput(inputs, ['intent_domain']) || extensionID,
          positive_examples: Array.isArray(inputs.positive_examples) ? inputs.positive_examples.map(String) : [],
          negative_examples: Array.isArray(inputs.negative_examples) ? inputs.negative_examples.map(String) : [],
          input_schema: tool.schema || {},
          output_schema: {},
          risk_level: firstStringInput(inputs, ['risk_level']) || 'workspace_write',
          privacy_level: firstStringInput(inputs, ['privacy_level']) || 'local',
          ui_visibility: 'capabilities',
          enabled: true,
        },
      });
      return {
        output: {
          status: 'completed',
          capability: 'extension_register_tool',
          extension_id: extensionID,
          server_id: serverID,
          tool_name: toolName,
          wrapped_capability: wrapped.capability,
          summary: `Registered ${extensionID}/${toolName} as ${wrapped.capability.id}.`,
        },
      };
    }
    case 'lsp_definition':
    case 'lsp_references':
    case 'lsp_diagnostics':
    case 'lsp_hover':
    case 'lsp_symbols':
    case 'lsp_code_actions':
      return { output: await executeNativeLSPCapability(capability, inputs, workspaceSettings, options.signal) };
    case 'lsp_rename':
    case 'lsp_format':
      if (!['workspace_write', 'danger_full_access'].includes(permissionProfile)) return undefined;
      return { output: await executeNativeLSPCapability(capability, inputs, workspaceSettings, options.signal) };
    case 'debugger_attach':
    case 'debugger_breakpoint':
    case 'debugger_step':
    case 'debugger_evaluate':
    case 'debugger_threads':
    case 'debugger_stack':
    case 'debugger_locals':
    case 'debugger_watchpoint':
    case 'debugger_memory':
    case 'debugger_stop':
      return {
        output: await getNativeDebuggerManager().execute(
          capability,
          inputs,
          workspaceSettings,
          permissionProfile,
          options.signal,
        ),
      };
    case 'project_list':
      return { output: executeProjectListCapability(inputs, store) };
    case 'skills_list':
      reloadFilesystemSkills(store);
      return { output: executeSkillsListCapability(inputs, store) };
    case 'skill_view':
      reloadFilesystemSkills(store);
      return { output: executeSkillViewCapability(inputs, store) };
    case 'tool_search':
      reloadFilesystemSkills(store);
      return { output: executeToolSearchCapability(inputs, req, store) };
    case 'task_list':
      return { output: executeTaskListCapability(inputs, req, store) };
    case 'task_view':
      return { output: executeTaskViewCapability(inputs, store) };
    case 'task_update':
      if (!['workspace_write', 'danger_full_access'].includes(permissionProfile)) return undefined;
      return { output: executeTaskUpdateCapability(inputs, store) };
    case 'request_user_input':
      return { output: executeRequestUserInputCapability(inputs) };
    case 'automation_update':
      return { output: executeAutomationUpdateCapability(inputs, req, store) };
    default:
      return { output: executeUnsupportedCapability(capability, inputsWithPermission) };
  }
}

function authorizedSpeechPath(value: unknown, workspaceSettings: WorkspaceSettings): string {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) throw new Error('speech_transcribe path is required');
  try {
    return resolveWorkspacePath(input, workspaceSettings);
  } catch (workspaceError) {
    const source = realpathSync(resolve(input));
    const generatedAudioRoot = realpathSync(join(app.getPath('userData'), 'generated-audio'));
    const rel = relative(generatedAudioRoot, source);
    if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))) return source;
    throw workspaceError;
  }
}

function authorizedMediaPath(
  value: unknown,
  workspaceSettings: WorkspaceSettings,
  permissionProfile: string,
): string {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) throw new Error('media analysis path is required');
  if (permissionProfile === 'danger_full_access') return realpathSync(resolve(input));
  try {
    return resolveWorkspacePath(input, workspaceSettings);
  } catch (workspaceError) {
    const source = realpathSync(resolve(input));
    for (const root of [
      join(app.getPath('userData'), 'media-workbench'),
      join(app.getPath('userData'), 'generated-images'),
      join(app.getPath('userData'), 'generated-videos'),
      join(app.getPath('userData'), 'generated-audio'),
      join(app.getPath('userData'), 'browser-workbench'),
    ]) {
      try {
        const rel = relative(realpathSync(root), source);
        if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))) return source;
      } catch {
        // An optional generated-media root may not exist yet.
      }
    }
    throw workspaceError;
  }
}
