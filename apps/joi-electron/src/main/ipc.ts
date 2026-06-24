import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { desktopIpcMethods, type DesktopIpcMethod, type JoiInvokeRequest } from '../../../../packages/shared-types/src/preload-api';
import type {
  ApprovalDecisionRequest,
  ApprovalResumeRunRequest,
  AutomationDefinition,
  AutomationDefinitionRequest,
  AutomationTriggerNowRequest,
  AutomationWebhookTestRequest,
  ChatRequest,
  ConversationFilter,
  ConnectionTest,
  ExternalHandoffAudit,
  ExternalHandoffReadiness,
  LogCleanupRequest,
  LogFilter,
  ModelConnectionTestRequest,
  ModelConfigRequest,
  ModelSettingsRequest,
  PhotonIMessageStatus,
  RedirectRunRequest,
  SettingsRecord,
  TelegramInboundStatus,
  TerminalSessionInputRequest,
  TerminalSessionKillRequest,
  TerminalSessionResizeRequest,
  TerminalSessionStartRequest,
  WorkspaceSettings,
} from '../../../../packages/shared-types/src/desktop-api';
import type { JoiSQLiteStore, PersistedToolResult, StartedToolCallingChat, ToolCallingPromptAssembly, ToolCallingResumeRequest } from '../../../../packages/store/src/sqlite';
import type { KeychainSecretStore } from '../../../../packages/secrets/src/keychain';
import { fetchAvailableModels, isLoopbackModelEndpoint, LOCAL_MODEL_PROXY_API_KEY, testModelConnection } from '../../../../packages/runtime/src/model';
import { DEFAULT_XAI_OAUTH_BASE_URL, isXAIOAuthProvider, loginWithXAIOAuthLoopback, resolveXAIOAuthCredentials, validateXAIInferenceBaseURL } from '../../../../packages/runtime/src/xai-oauth';
import { sendTestTelegramMessage, testTelegramConnection } from '../../../../packages/runtime/src/telegram';
import { PHOTON_DASHBOARD_TOKEN_SECRET, PHOTON_PROJECT_SECRET_SECRET, setupPhotonIMessage, testPhotonIMessageConnection } from '../../../../packages/runtime/src/imessage';
import { executeFileAnalyze, executeFileRead, executeWebResearch, executeWorkspaceSearch } from '../../../../packages/runtime/src/capabilities';
import { executeApplyPatch, executeShellCommand, executeTestCommand } from '../../../../packages/runtime/src/workspace-exec';
import { executeBrowserClick, executeBrowserNavigate, executeBrowserObserve, executeBrowserType, executeComputerObserve } from '../../../../packages/runtime/src/browser-computer';
import { executeDesktopAppInspect, executeDesktopAppList } from '../../../../packages/runtime/src/desktop-apps';
import { executeServerDiagnose, executeSystemHealthCheck } from '../../../../packages/runtime/src/diagnostics';
import { runChatCompletionsToolTurn } from '../../../../packages/runtime/src/tool-calling';
import { compileElectronCapabilityTools } from '../../../../packages/runtime/src/capability-compiler';
import { TerminalSessionManager } from './terminal';
import { automationWebhookSecretRef, newAutomationWebhookSecret } from './automation';

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

export function registerIpc(window: BrowserWindow, _appDirs: AppDirs, store: JoiSQLiteStore, secrets: KeychainSecretStore, options: RegisterIpcOptions = {}) {
  const activeToolCallingRuns = new Map<string, AbortController>();
  const emittedRunSeqByRunID = new Map<string, number>();
  const terminalManager = getTerminalSessionManager();
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
  const emitNewRunEvents = (runID: string) => {
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
      const apiKey = await resolveAPIKeyForModelEndpoint(settings, secrets);
      if (!canRunRealToolCalling(settings, apiKey, chatRequest)) {
        throw new Error(unconfiguredModelMessage(settings, apiKey, chatRequest));
      }
      const result = await runLiveElectronToolCallingChat(chatRequest, settings, apiKey, store, activeToolCallingRuns, emitNewRunEvents);
      emitNewRunEvents(result.run_id);
      return result;
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
      const apiKey = await resolveAPIKeyForModelEndpoint(settings, secrets);
      const result = await runLiveElectronToolCallingChat({
        conversation_id: redirected.conversation_id,
        channel: redirected.entry_channel || 'desktop',
        message,
        input_mode: req.requested_mode || (redirected.resolved_mode as ChatRequest['input_mode']) || 'auto',
        product_task_id: req.product_task_id || (typeof redirected.metadata?.product_task_id === 'string' ? redirected.metadata.product_task_id : undefined),
        parent_run_id: runID,
        redirected_from_run_id: runID,
        runtime_mode: 'tool_calling',
      }, settings, apiKey, store, activeToolCallingRuns, emitNewRunEvents);
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
    DecideProactiveMessage(payload) {
      store.decideProactiveMessage(payload as { id?: string; action?: string; feedback?: string });
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
      const modelName = 'grok-4.3';
      store.saveModelConfig({
        provider: 'xai_oauth',
        base_url: DEFAULT_XAI_OAUTH_BASE_URL,
        name: modelName,
        reasoning_name: modelName,
        timeout_seconds: 60,
        max_retries: 1,
      });
      return {
        ...result,
        model_name: modelName,
      };
    },
    async GenerateWorkerToken() {
      const token = `joi_worker_${randomUUID().replace(/-/g, '')}`;
      await secrets.save('WORKER_TOKEN', token);
      return { token };
    },
  };

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
      onRunEvent: () => emitInitialEvents(started.run_id),
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
    if (!window.isDestroyed()) {
      window.webContents.send('joi:run:event', event);
    }
    if (seq > nextSeq) nextSeq = seq;
  }
  if (runID && nextSeq > lastSeq) {
    emittedSeqByRunID.set(runID, nextSeq);
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
    onRunEvent?: () => void;
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
    callbacks: options.started ? store.createToolCallingEventCallbacks(options.started, options.onRunEvent) : undefined,
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
        const executed = await executeElectronCapability(call.name, call.arguments, req, store, { signal: toolOptions?.signal });
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
  await resumeElectronToolCallingRun(resume, settings, await resolveAPIKeyForModelEndpoint(settings, secrets), store);
  const trace = store.getRunTrace(resume.run_id);
  emitRunEvents(window, trace);
  return { resumed: true, trace };
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
  options: { signal?: AbortSignal } = {},
): Promise<{ output: Record<string, unknown> } | undefined> {
  const permissionProfile = String(req.permission_profile || inputs.permission_profile || 'read_only');
  const inputsWithPermission: Record<string, unknown> & { permission_profile: string } = {
    ...inputs,
    permission_profile: permissionProfile,
  };
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
      return { output: await executeShellCommand(inputsWithPermission, store.getWorkspaceSettings(), { signal: options.signal }) };
    case 'test_command':
      return { output: await executeTestCommand(inputsWithPermission, store.getWorkspaceSettings(), { signal: options.signal }) };
    case 'apply_patch':
      if (!['workspace_write', 'danger_full_access'].includes(String(req.permission_profile || ''))) return undefined;
      return { output: executeApplyPatch(inputsWithPermission, store.getWorkspaceSettings()) };
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
