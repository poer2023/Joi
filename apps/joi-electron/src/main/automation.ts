import type { BrowserWindow } from 'electron';
import type {
  AutomationDefinition,
  AutomationTriggerRecord,
  ChatRequest,
  ChatResponse,
  RunEvent,
  SettingsRecord,
} from '../../../../packages/shared-types/src/desktop-api';
import type { JoiSQLiteStore } from '../../../../packages/store/src/sqlite';
import type { KeychainSecretStore } from '../../../../packages/secrets/src/keychain';
import {
  automationTaskCompletionFailure,
  computeNextAutomationFire,
  renderAutomationPrompt,
  scheduleDedupKey,
  shouldCoalesceMissedFire,
} from '../../../../packages/runtime/src/automation';
import { LOCAL_MODEL_PROXY_API_KEY } from '../../../../packages/runtime/src/model';
import {
  canRunRealToolCalling,
  emitRunEvent,
  emitRunEvents,
  resolveAPIKeyForModelEndpoint,
  runLiveElectronToolCallingChat,
} from './ipc';
import type { JoiPluginManager } from './plugin-manager';
import type { TelegramOutboundService } from './telegram-outbound';
import { resolveAutomationModelRuntimeRoute, resolveAutomationModelSettings } from './automation-runtime-route';
export { AutomationWebhookServer, automationWebhookSecretRef, newAutomationWebhookSecret } from './automation-webhook';

type AutomationAppLogInput = Parameters<JoiSQLiteStore['recordAppLog']>[0];

export type AutomationRunnerOptions = {
  store: JoiSQLiteStore;
  secrets: KeychainSecretStore;
  pluginManager?: JoiPluginManager;
  telegramOutbound?: TelegramOutboundService;
  getWindow: () => BrowserWindow | null;
  deterministicChat?: boolean;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  executeChat?: (req: ChatRequest) => Promise<ChatResponse>;
};

export class AutomationRunner {
  private store: JoiSQLiteStore;
  private secrets: KeychainSecretStore;
  private pluginManager?: JoiPluginManager;
  private telegramOutbound?: TelegramOutboundService;
  private getWindow: () => BrowserWindow | null;
  private deterministicChat: boolean;
  private logger: Pick<Console, 'info' | 'warn' | 'error'>;
  private executeChatOverride?: (req: ChatRequest) => Promise<ChatResponse>;
  private timer?: NodeJS.Timeout;
  private activeRuns = new Map<string, AbortController>();
  private activeCount = 0;
  private stopped = true;

  constructor(options: AutomationRunnerOptions) {
    this.store = options.store;
    this.secrets = options.secrets;
    this.pluginManager = options.pluginManager;
    this.telegramOutbound = options.telegramOutbound;
    this.getWindow = options.getWindow;
    this.deterministicChat = Boolean(options.deterministicChat);
    this.logger = options.logger || console;
    this.executeChatOverride = options.executeChat;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 30_000);
    this.timer.unref?.();
    recordAutomationAppLog(this.store, this.logger, {
      level: 'info',
      risk_level: 'state_change',
      category: 'automation',
      feature_key: 'automation.runner.started',
      source: 'electron_automation',
      message: 'automation runner started',
      payload: { interval_ms: 30_000 },
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const controller of this.activeRuns.values()) {
      if (!controller.signal.aborted) controller.abort(new Error('automation runner stopped'));
    }
    this.activeRuns.clear();
    recordAutomationAppLog(this.store, this.logger, {
      level: 'info',
      risk_level: 'state_change',
      category: 'automation',
      feature_key: 'automation.runner.stopped',
      source: 'electron_automation',
      message: 'automation runner stopped',
    });
  }

  requestDrain(): void {
    void this.tick();
  }

  async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      this.reconcileSchedules();
      this.drainQueue();
      await this.telegramOutbound?.drainFailedDeliveries();
      await this.telegramOutbound?.drainAuthorizedProactiveMessages();
    } catch (error) {
      this.logger.warn('automation runner tick failed', error);
      recordAutomationAppLog(this.store, this.logger, {
        level: 'error',
        risk_level: 'state_change',
        category: 'automation',
        feature_key: 'automation.runner.tick_failed',
        source: 'electron_automation',
        message: 'automation runner tick failed',
        error,
      });
    }
  }

  private reconcileSchedules(): void {
    const now = new Date();
    for (const automation of this.store.listDueScheduleAutomations(now.toISOString())) {
      const currentNext = automation.next_fire_at;
      if (!currentNext) {
        const next = computeNextAutomationFire(automation.trigger_config, now, {
          timezone: String(automation.trigger_config.timezone || ''),
          last_fire_at: automation.last_fire_at,
        });
        this.store.updateAutomationScheduleState(automation.id, next);
        continue;
      }
      if (!shouldCoalesceMissedFire(currentNext, now)) continue;
      const dedupKey = scheduleDedupKey(automation.id, currentNext);
      this.store.enqueueAutomationTrigger({
        automation_id: automation.id,
        trigger_type: 'schedule',
        dedup_key: dedupKey,
        payload: {
          scheduled_fire_at: currentNext,
          coalesced: true,
          local_timezone: automation.trigger_config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        fire_at: currentNext,
      });
      recordAutomationAppLog(this.store, this.logger, {
        level: 'info',
        risk_level: 'state_change',
        category: 'automation',
        feature_key: 'automation.schedule.enqueued',
        source: 'electron_automation',
        message: 'automation schedule trigger enqueued',
        item_type: 'automation',
        item_id: automation.id,
        payload: { automation_id: automation.id, trigger_type: 'schedule', fire_at: currentNext },
      });
      const nextFire = computeNextAutomationFire(automation.trigger_config, now, {
        timezone: String(automation.trigger_config.timezone || ''),
        last_fire_at: currentNext,
      });
      this.store.updateAutomationScheduleState(automation.id, nextFire, currentNext);
    }
  }

  private drainQueue(): void {
    while (this.activeCount < 2) {
      const claim = this.store.claimDueAutomationTrigger(new Date().toISOString());
      if (!claim) break;
      this.activeCount += 1;
      void this.processClaim(claim.automation, claim.trigger)
        .catch((error) => this.logger.warn('automation claim failed', error))
        .finally(() => {
          this.activeCount = Math.max(0, this.activeCount - 1);
          if (!this.stopped) this.drainQueue();
        });
    }
  }

  private async processClaim(automation: AutomationDefinition, trigger: AutomationTriggerRecord): Promise<void> {
    recordAutomationAppLog(this.store, this.logger, {
      level: 'info',
      risk_level: 'state_change',
      category: 'automation',
      feature_key: 'automation.trigger.claimed',
      source: 'electron_automation',
      message: 'automation trigger claimed',
      item_type: 'automation_trigger',
      item_id: trigger.id,
      payload: {
        automation_id: automation.id,
        trigger_type: trigger.trigger_type,
        attempt_count: trigger.attempt_count,
      },
    });
    try {
      const chatRequest = this.chatRequestForAutomation(automation, trigger);
      const response = await this.executeChat(chatRequest);
      const productTaskID = this.productTaskIDForResponse(response);
      const automationRun = this.store.recordAutomationRunStarted({
        automation_id: automation.id,
        trigger_id: trigger.id,
        run_id: response.run_id,
        product_task_id: productTaskID,
        conversation_id: response.conversation_id,
        source_cwd: automation.cwds[0],
        automation_name: automation.name,
      });
      const trace = this.store.getRunTrace(response.run_id);
      emitRunEventsIfPossible(this.getWindow(), this.store, response.run_id);
      if (trace.status === 'waiting_confirmation' || trace.terminal_status === 'waiting_confirmation') {
        this.store.recordAutomationRunFailed({
          automation_run_id: automationRun.id,
          run_id: response.run_id,
          product_task_id: productTaskID,
          error_code: 'PENDING_CONFIRMATION',
          error_message: 'Automation run is waiting for user confirmation.',
        });
        recordAutomationAppLog(this.store, this.logger, {
          level: 'warn',
          risk_level: 'state_change',
          category: 'automation',
          feature_key: 'automation.run.waiting_confirmation',
          source: 'electron_automation',
          message: 'automation run is waiting for user confirmation',
          run_id: response.run_id,
          item_type: 'automation_run',
          item_id: automationRun.id,
          payload: { automation_id: automation.id, trigger_id: trigger.id, product_task_id: productTaskID },
        });
        emitRunEventsIfPossible(this.getWindow(), this.store, response.run_id);
        return;
      }
      if (trace.status === 'failed' || trace.terminal_status === 'failed' || trace.status === 'cancelled') {
        const errorMessage = trace.terminal_reason || 'Automation run failed.';
        const retryAt = retryAtForAutomation(automation, trigger, 'RUNTIME_FAILED', errorMessage);
        this.store.recordAutomationRunFailed({
          automation_run_id: automationRun.id,
          run_id: response.run_id,
          product_task_id: productTaskID,
          error_code: trace.status === 'cancelled' ? 'RUN_CANCELLED' : 'RUNTIME_FAILED',
          error_message: errorMessage,
          retry_at: retryAt,
        });
        recordAutomationAppLog(this.store, this.logger, {
          level: 'error',
          risk_level: 'state_change',
          category: 'automation',
          feature_key: 'automation.run.failed',
          source: 'electron_automation',
          message: 'automation run failed',
          run_id: response.run_id,
          item_type: 'automation_run',
          item_id: automationRun.id,
          payload: { automation_id: automation.id, trigger_id: trigger.id, product_task_id: productTaskID, retry_at: retryAt },
          error: { code: trace.status === 'cancelled' ? 'RUN_CANCELLED' : 'RUNTIME_FAILED', message: errorMessage },
        });
        emitRunEventsIfPossible(this.getWindow(), this.store, response.run_id);
        return;
      }
      const productTask = response.product_task
        || (productTaskID ? this.store.getProductTask(productTaskID).task : undefined);
      const taskFailure = automationTaskCompletionFailure(productTask);
      if (taskFailure) {
        const retryAt = retryAtForAutomation(automation, trigger, taskFailure.code, taskFailure.message);
        this.store.recordAutomationRunFailed({
          automation_run_id: automationRun.id,
          run_id: response.run_id,
          product_task_id: productTaskID,
          error_code: taskFailure.code,
          error_message: taskFailure.message,
          retry_at: retryAt,
        });
        recordAutomationAppLog(this.store, this.logger, {
          level: 'error',
          risk_level: 'state_change',
          category: 'automation',
          feature_key: 'automation.run.task_verification_failed',
          source: 'electron_automation',
          message: 'automation task verification failed',
          run_id: response.run_id,
          item_type: 'automation_run',
          item_id: automationRun.id,
          payload: { automation_id: automation.id, trigger_id: trigger.id, product_task_id: productTaskID, retry_at: retryAt },
          error: taskFailure,
        });
        emitRunEventsIfPossible(this.getWindow(), this.store, response.run_id);
        return;
      }
      if (this.telegramOutbound) {
        await this.telegramOutbound.deliverAutomationCompletion({
          automation,
          trigger,
          response,
          automation_run_id: automationRun.id,
          product_task_id: productTaskID,
        });
      } else {
        this.store.recordAutomationRunCompleted({
          automation_run_id: automationRun.id,
          run_id: response.run_id,
          product_task_id: productTaskID,
          output_summary: response.response.slice(0, 500),
        });
      }
      recordAutomationAppLog(this.store, this.logger, {
        level: 'info',
        risk_level: 'state_change',
        category: 'automation',
        feature_key: 'automation.run.succeeded',
        source: 'electron_automation',
        message: 'automation run succeeded',
        run_id: response.run_id,
        item_type: 'automation_run',
        item_id: automationRun.id,
        payload: { automation_id: automation.id, trigger_id: trigger.id, product_task_id: productTaskID },
      });
      emitRunEventsIfPossible(this.getWindow(), this.store, response.run_id);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const code = errorCode(err);
      const retryAt = retryAtForAutomation(automation, trigger, code, err.message);
      this.store.recordAutomationTriggerFailed({
        trigger_id: trigger.id,
        error_code: code,
        error_message: err.message,
        retry_at: retryAt,
      });
      recordAutomationAppLog(this.store, this.logger, {
        level: 'error',
        risk_level: 'state_change',
        category: 'automation',
        feature_key: 'automation.trigger.failed',
        source: 'electron_automation',
        message: 'automation trigger failed',
        item_type: 'automation_trigger',
        item_id: trigger.id,
        payload: { automation_id: automation.id, trigger_type: trigger.trigger_type, retry_at: retryAt },
        error: { code, message: err.message },
      });
    }
  }

  private async executeChat(req: ChatRequest): Promise<ChatResponse> {
    if (this.executeChatOverride) return this.executeChatOverride(req);
    if (this.deterministicChat) {
      const response = await this.store.sendDeterministicChat(req);
      emitRunEventsIfPossible(this.getWindow(), this.store, response.run_id);
      return response;
    }
    const settings = resolveAutomationModelSettings({
      settings: this.store.getSettings(),
      request: req,
      availableModels: this.store.listSavedModels().models,
    });
    const route = await resolveAutomationModelRuntimeRoute({
      settings,
      request: req,
      localProxyAPIKey: LOCAL_MODEL_PROXY_API_KEY,
      resolveACPProvider: (providerID, permissionProfile) => this.pluginManager?.resolveProvider(providerID, permissionProfile),
      resolveAPIKey: () => resolveAPIKeyForModelEndpoint(settings, this.secrets),
      canRun: canRunRealToolCalling,
    });
    if (!route.ready) {
      throw codedAutomationError('MODEL_NOT_CONFIGURED', modelConfigError(settings));
    }
    const response = await runLiveElectronToolCallingChat(
      req,
      settings,
      this.secrets,
      this.store,
      this.activeRuns,
      (runID, event?: RunEvent) => emitRunEventsIfPossible(this.getWindow(), this.store, runID, event),
      this.pluginManager,
      { model_selection_policy: route.model_selection_policy },
    );
    emitRunEventsIfPossible(this.getWindow(), this.store, response.run_id);
    return response;
  }

  private chatRequestForAutomation(automation: AutomationDefinition, trigger: AutomationTriggerRecord): ChatRequest {
    const message = renderAutomationPrompt(automation.prompt_template, {
      automation: {
        id: automation.id,
        kind: automation.kind,
        name: automation.name,
        slug: automation.slug,
      },
      trigger: {
        id: trigger.id,
        type: trigger.trigger_type,
        dedup_key: trigger.dedup_key,
        fire_at: trigger.fire_at,
        attempt_count: trigger.attempt_count,
      },
      payload: trigger.payload,
    });
    if (!message.trim()) throw codedAutomationError('INVALID_PAYLOAD', 'Automation prompt rendered empty.');
    return {
      conversation_id: automation.execution_kind === 'heartbeat'
        ? automation.target_thread_id || automation.conversation_id
        : undefined,
      channel: automation.kind === 'webhook' ? 'webhook' : 'automation',
      user_id: `automation:${automation.id}`,
      principal_id: automation.principal_id,
      message,
      preferred_node: automation.preferred_node || 'main-node',
      allow_worker: automation.allow_worker,
      model_provider: automation.model_provider,
      model_name: automation.model,
      model_base_url: automation.model_base_url,
      reasoning_effort: automation.reasoning_effort,
      workspace_root: automation.cwds[0],
      input_mode: automation.input_mode || 'background_task',
      runtime_mode: 'tool_calling',
      permission_profile: automation.permission_profile || 'read_only',
    };
  }

  private productTaskIDForResponse(response: ChatResponse): string | undefined {
    if (response.product_task?.id) return response.product_task.id;
    return this.store
      .listProductTasks({ conversation_id: response.conversation_id, limit: 20 })
      .tasks.find((task) => task.source_run_id === response.run_id || task.latest_run_id === response.run_id)
      ?.id;
  }
}

function retryAtForAutomation(
  automation: AutomationDefinition,
  trigger: AutomationTriggerRecord,
  code: string,
  message: string,
): string | undefined {
  const policy = automation.retry_policy || {};
  const noRetryCodes = new Set((Array.isArray(policy.no_retry_error_codes)
    ? policy.no_retry_error_codes
    : ['POLICY_DENIED', 'INVALID_PAYLOAD', 'PENDING_CONFIRMATION']).map((item) => String(item).toUpperCase()));
  const normalizedCode = code.toUpperCase();
  if (noRetryCodes.has(normalizedCode)) return undefined;
  if (/policy denied|pending confirmation|waiting for user confirmation/i.test(message)) return undefined;
  const maxAttempts = Math.max(1, Number(policy.max_attempts ?? 2));
  if (trigger.attempt_count >= maxAttempts) return undefined;
  const backoff = Array.isArray(policy.backoff_seconds) ? policy.backoff_seconds : [60, 300];
  const seconds = Number(backoff[Math.max(0, trigger.attempt_count - 1)] ?? backoff.at(-1) ?? 300);
  return new Date(Date.now() + Math.max(1, seconds) * 1000).toISOString();
}

function errorCode(error: Error): string {
  return (error as Error & { code?: string }).code || 'RUNTIME_FAILED';
}

function codedAutomationError(code: string, message: string): Error & { code?: string } {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function modelConfigError(settings: SettingsRecord): string {
  if ((settings.model_provider || '').startsWith('acp_')) {
    return `ACP provider is not installed or enabled for automation: provider=${settings.model_provider || 'empty'} model=${settings.model_name || 'empty'}`;
  }
  return `Real model runtime is not configured for automation: provider=${settings.model_provider || 'empty'} model=${settings.model_name || 'empty'}`;
}

function emitRunEventsIfPossible(window: BrowserWindow | null, store: JoiSQLiteStore, runID: string, event?: RunEvent): void {
  if (!window || window.isDestroyed()) return;
  if (event) emitRunEvent(window, event);
  else emitRunEvents(window, store.getRunTrace(runID));
}

function recordAutomationAppLog(store: JoiSQLiteStore, logger: Pick<Console, 'warn'>, input: AutomationAppLogInput): void {
  try {
    store.recordAppLog(input);
  } catch (error) {
    logger.warn('automation app log write failed', error);
  }
}
