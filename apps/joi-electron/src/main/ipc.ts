import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { testGitHubConnection } from './github';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { z } from 'zod';
import { desktopIpcMethods, type DesktopIpcMethod, type JoiInvokeRequest } from '../../../../packages/shared-types/src/preload-api';
import type {
  ApprovalDecisionRequest,
  ApprovalResumeRunRequest,
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
  PluginInstallFromGitHubRequest,
  MCPServerRecord,
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
import { executeFileAnalyze, executeFileRead, executePublicWebExtract, executeUnsupportedCapability, executeWebResearch, executeWorkspaceSearch } from '../../../../packages/runtime/src/capabilities';
import { executeApplyPatch, executeShellCommand, executeTestCommand } from '../../../../packages/runtime/src/workspace-exec';
import { executeBrowserClick, executeBrowserNavigate, executeBrowserObserve, executeBrowserType, executeComputerObserve } from '../../../../packages/runtime/src/browser-computer';
import { executeDesktopAppInspect, executeDesktopAppList } from '../../../../packages/runtime/src/desktop-apps';
import { executeServerDiagnose, executeSystemHealthCheck } from '../../../../packages/runtime/src/diagnostics';
import { runChatCompletionsToolTurn } from '../../../../packages/runtime/src/tool-calling';
import { runACPChatTurn, type ACPProviderRuntimeConfig } from '../../../../packages/runtime/src/acp';
import { inferFinalResponseContract } from '../../../../packages/runtime/src/agent-kernel';
import { canonicalElectronCapabilityName, compileElectronCapabilityTools, listElectronCapabilityToolDefinitions } from '../../../../packages/runtime/src/capability-compiler';
import { executeGrokBuildImageGeneration } from '../../../../packages/runtime/src/grok-build-image';
import { TerminalSessionManager } from './terminal';
import { automationWebhookSecretRef, newAutomationWebhookSecret } from './automation';
import { JoiPluginManager } from './plugin-manager';
import { isProactiveTelegramDeliveryRequested, type TelegramOutboundDeliveryResult } from './telegram-outbound';
import {
  defaultJoiCommandSocketPath,
  publishJoiRunEvent,
  publishJoiTerminalEvent,
  startJoiCommandHost,
} from './command-host';
import { acpWebBridgeToken } from './acp-web-bridge';

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
let terminalDisposeRegistered = false;
let terminalCliEventUnsubscribe: (() => void) | null = null;
let browserBridgeServer: Server | null = null;

function getTerminalSessionManager() {
  if (!terminalSessionManager) {
    terminalSessionManager = new TerminalSessionManager();
  }
  if (!terminalDisposeRegistered) {
    terminalDisposeRegistered = true;
    app.once('before-quit', () => {
      terminalSessionManager?.dispose();
      terminalSessionManager = null;
      terminalDisposeRegistered = false;
    });
  }
  return terminalSessionManager;
}

export function registerIpc(window: BrowserWindow, appDirs: AppDirs, store: JoiSQLiteStore, secrets: KeychainSecretStore, options: RegisterIpcOptions = {}) {
  const activeToolCallingRuns = new Map<string, AbortController>();
  const emittedRunSeqByRunID = new Map<string, number>();
  const terminalManager = getTerminalSessionManager();
  if (!terminalCliEventUnsubscribe) {
    terminalCliEventUnsubscribe = terminalManager.onEvent(publishJoiTerminalEvent);
  }
  const pluginManager = options.pluginManager || new JoiPluginManager(store, appDirs.userDataDir);
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
      const settings = store.getSettings();
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
      return store.saveMCPServer(payload as Parameters<typeof store.saveMCPServer>[0]);
    },
    DeleteMCPServer(payload) {
      store.deleteMCPServer(String(payload ?? ''));
    },
    SetMCPServerEnabled(payload) {
      return store.setMCPServerEnabled(payload as { id?: string; enabled?: boolean });
    },
    async SyncMCPServer(payload) {
      const serverID = String(payload ?? '').trim();
      const server = store.listMCPServers().servers.find((item) => item.id === serverID);
      if (!server) return store.syncMCPServer(serverID);
      try {
        const inventory = await inspectStdioMCPServer(server);
        return store.replaceMCPInventory(serverID, inventory);
      } catch (error) {
        store.recordMCPSyncFailure(serverID, error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    WrapMCPTool(payload) {
      return store.wrapMCPTool(payload as Parameters<typeof store.wrapMCPTool>[0]);
    },
    ListSkills() {
      return store.listSkills();
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
        token: acpWebBridgeToken(),
        execute: async ({ capability, payload, request_id }) => {
          const startedAt = Date.now();
          const capabilityRecords = mergeRuntimeCapabilityRecords(store.listCapabilities().capabilities).capabilities;
          const disabled = [capability, 'web_research']
            .map((id) => capabilityRecords.find((record) => record.id === id))
            .some((record) => record?.enabled === false);
          if (disabled) {
            const output = {
              status: 'policy_blocked',
              capability,
              code: 'CAPABILITY_DISABLED',
              summary: `${capability} is disabled in Joi Settings.`,
              permission_profile: 'read_only',
              bridge_trace_id: request_id,
            };
            safeRecordAppLog(store, {
              level: 'warn',
              risk_level: 'read_only',
              category: 'tool',
              feature_key: `acp_web.${capability}.blocked`,
              source: 'acp_mcp_bridge',
              message: `ACP web capability ${capability} was blocked`,
              duration_ms: Date.now() - startedAt,
              payload: { capability, request_id, reason: 'capability_disabled' },
            });
            return output;
          }
          try {
            const executed = await executeElectronCapability(
              capability,
              payload,
              {
                message: `ACP requested Joi capability ${capability}`,
                runtime_mode: 'tool_calling',
                permission_profile: 'read_only',
              },
              store,
              secrets,
            );
            if (!executed) throw new Error(`${capability} did not produce a Joi capability result`);
            const output: Record<string, unknown> = {
              ...executed.output,
              capability,
              permission_profile: 'read_only',
              bridge_trace_id: request_id,
            };
            const outputStatus = String(output.status || 'completed');
            safeRecordAppLog(store, {
              level: outputStatus === 'failed' ? 'error' : outputStatus === 'policy_blocked' ? 'warn' : 'info',
              risk_level: 'read_only',
              category: 'tool',
              feature_key: `acp_web.${capability}.${outputStatus}`,
              source: 'acp_mcp_bridge',
              message: `ACP web capability ${capability} ${outputStatus}`,
              duration_ms: Date.now() - startedAt,
              payload: { capability, request_id, status: outputStatus },
            });
            return output;
          } catch (error) {
            safeRecordAppLog(store, {
              level: 'error',
              risk_level: 'read_only',
              category: 'tool',
              feature_key: `acp_web.${capability}.failed`,
              source: 'acp_mcp_bridge',
              message: `ACP web capability ${capability} failed`,
              duration_ms: Date.now() - startedAt,
              payload: { capability, request_id },
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
  const modelName = (req.model_name || settings.model_name || '').trim();
  const started = store.beginToolCallingChat(req, {
    provider: settings.model_provider || 'openai_compatible',
    model_name: modelName,
    model_base_url: settings.model_base_url || '',
    model_reasoning_effort: settings.model_reasoning_effort,
    model_selection_policy: routeOptions.model_selection_policy,
  });
  emitInitialEvents(started.run_id);
  const controller = new AbortController();
  activeRuns.set(started.run_id, controller);
  try {
    const effectiveSettings = settingsForStartedModel(settings, started);
    const acpProvider = pluginManager?.resolveProvider(effectiveSettings.model_provider, req.permission_profile || 'read_only');
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

function settingsForStartedModel(settings: SettingsRecord, started: StartedToolCallingChat): SettingsRecord {
  return {
    ...settings,
    model_provider: started.provider || settings.model_provider,
    model_name: started.model_name || settings.model_name,
    model_base_url: started.model_base_url || settings.model_base_url,
    model_reasoning_effort: started.model_reasoning_effort || settings.model_reasoning_effort,
  };
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

function reasoningEffortForSettings(settings: SettingsRecord, modelName: string): string | undefined {
  const effort = (settings.model_reasoning_effort || '').trim().toLowerCase();
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
  } = {},
) {
  const modelName = options.started?.model_name || (req.model_name || settings.model_name || '').trim();
  const agentID = options.started?.selected_agent_id || 'general_agent';
  const promptAssembly = options.promptAssembly || store.assembleToolCallingPrompt(req, agentID, modelName);
  const agentCapabilities = promptAssembly.agent_capabilities || store.getAgentCapabilities(agentID);
  const compiledTools = compileElectronCapabilityTools(req.permission_profile, {
    allowed_capabilities: agentCapabilities,
  });
  const compiledToolNames = new Set(compiledTools.map((tool) => tool.name));
  const conversationMessages = [
    ...promptAssembly.conversation_messages.map((message) => ({ role: message.role, content: message.content })),
    { role: 'user', content: req.message },
  ];
  const callbacks = options.started ? store.createToolCallingEventCallbacks(options.started, options.onRunEvent) : undefined;
  const result = options.acpProvider ? await runACPChatTurn({
    ...options.acpProvider,
    model: modelName,
    system_message: promptAssembly.system_message,
    messages: conversationMessages,
    signal: options.signal,
    callbacks,
  }) : await runChatCompletionsToolTurn({
    base_url: modelBaseURLForSettings(settings),
    api_key: apiKey,
    model: modelName,
    messages: [
      { role: 'system', content: promptAssembly.system_message },
      ...conversationMessages,
    ],
    tools: compiledTools,
    stream: true,
    reasoning_effort: reasoningEffortForSettings(settings, modelName),
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
    beforeToolCall: ({ call }) => compiledToolNames.has(call.name)
      ? undefined
      : { block: true, reason: `Capability ${call.name} is not allowed for agent ${agentID}.` },
    executeTool: async (call, toolOptions) => {
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
                ? '浏览器操作需要你确认后才会执行。'
                : '工作区写入需要你确认后才会执行。',
            },
          };
        }
        const executed = await executeElectronCapability(call.name, call.arguments, req, store, secrets, {
          signal: toolOptions?.signal,
          modelProvider: settings.model_provider,
          modelName,
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

const electronWorkspaceWriteCapabilities = new Set([
  'apply_patch',
  'patch',
  'edit_file',
  'edit',
  'write_file',
  'write',
  'execute_code',
  'code_execution',
  'sandbox_run',
  'delegate_task',
  'subagent_delegate',
  'mcp_tool_call',
  'extension_register_tool',
  'lsp_rename',
  'lsp_format',
  'memory_write_candidate',
  'memory',
  'session_branch',
  'queue_followup',
  'cronjob',
  'project_create',
  'project_switch',
  'skill_manage',
]);

const electronBrowserInteractionCapabilities = new Set([
  'browser_click',
  'browser_type',
  'browser_back',
  'browser_scroll',
  'browser_press',
  'browser_dialog',
  'browser_cdp',
  'computer_use',
  'debugger_attach',
  'debugger_breakpoint',
  'debugger_step',
  'debugger_evaluate',
  'ha_call_service',
]);

const electronConfirmationRequiredCapabilities = new Set([
  'apply_patch',
  'patch',
  'edit_file',
  'edit',
  'write_file',
  'write',
  'browser_click',
  'browser_type',
]);

function shouldPauseElectronToolForConfirmation(capability: string): boolean {
  return electronConfirmationRequiredCapabilities.has(capability);
}

function electronRiskForCapability(capability: string): string {
  if (electronBrowserInteractionCapabilities.has(capability)) return 'browser_interaction';
  if (electronWorkspaceWriteCapabilities.has(capability)) return 'workspace_write';
  return 'read_only';
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
  options: { signal?: AbortSignal; modelProvider?: string; modelName?: string } = {},
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
    case 'browser_observe':
      if (workspaceSettings.browser_enabled === false) return browserDisabled();
      return { output: await executeBrowserObserve(inputs) };
    case 'browser_snapshot':
      if (workspaceSettings.browser_enabled === false) return browserDisabled();
      return { output: await executeBrowserObserve(inputs) };
    case 'browser_navigate':
      if (workspaceSettings.browser_enabled === false) return browserDisabled();
      return { output: await executeBrowserNavigate(inputs, store.getWorkspaceSettings()) };
    case 'browser_click':
      if (workspaceSettings.browser_enabled === false) return browserDisabled();
      if (String(req.permission_profile || '') !== 'danger_full_access') return undefined;
      return { output: await executeBrowserClick(inputs) };
    case 'browser_type':
      if (workspaceSettings.browser_enabled === false) return browserDisabled();
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
      return { output: executeUnsupportedCapability(capability, inputsWithPermission) };
  }
}
