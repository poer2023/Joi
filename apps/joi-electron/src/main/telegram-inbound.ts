import type { BrowserWindow } from 'electron';
import type { ChatRequest, ChatResponse, RunEvent, SettingsRecord, TelegramInboundStatus } from '../../../../packages/shared-types/src/desktop-api';
import type { KeychainSecretStore } from '../../../../packages/secrets/src/keychain';
import type { AppLogInput, JoiSQLiteStore, TelegramInboundUpdateRecord } from '../../../../packages/store/src/sqlite';
import { LOCAL_MODEL_PROXY_API_KEY } from '../../../../packages/runtime/src/model';
import {
  planTelegramMessage,
  postTelegramMessage,
} from '../../../../packages/runtime/src/telegram-message.ts';
import { canRunRealToolCalling, emitRunEvent, emitRunEvents, resolveAPIKeyForModelEndpoint, runLiveElectronToolCallingChat } from './ipc';
import type { JoiPluginManager } from './plugin-manager';
import { resolveTelegramModelRuntimeRoute, telegramOwnerPermissionProfile } from './telegram-runtime-route';
import { telegramConversationID } from './telegram-thread';

type TelegramInboundOptions = {
  store: JoiSQLiteStore;
  secrets: KeychainSecretStore;
  pluginManager: JoiPluginManager;
  getWindow: () => BrowserWindow | null;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
};

type TelegramUpdateResponse = {
  ok: boolean;
  description?: string;
  result?: TelegramUpdate[];
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

type TelegramMessage = {
  message_id: number;
  message_thread_id?: number;
  text?: string;
  chat: { id: number; type: string };
  from?: { id: number };
};

type TelegramAPIResponse<T = unknown> = {
  ok: boolean;
  description?: string;
  result?: T;
};

const telegramAPIBaseURL = 'https://api.telegram.org';
const pollTimeoutSeconds = 45;
const retryDelayMs = 3000;
const typingPulseIntervalMs = 4000;
const replyTimeoutMs = 10_000;
const localOwnerPrincipalID = 'principal_local_owner';

export class TelegramInboundService {
  private readonly store: JoiSQLiteStore;
  private readonly secrets: KeychainSecretStore;
  private readonly pluginManager: JoiPluginManager;
  private readonly getWindow: () => BrowserWindow | null;
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>;
  private controller: AbortController | null = null;
  private reconfigureTimer: NodeJS.Timeout | null = null;
  private activeRuns = new Map<string, AbortController>();
  private tokenConfigured = false;
  private polling = false;
  private lastPollAt = '';
  private lastUpdateID: number | null = null;
  private lastError = '';

  constructor(options: TelegramInboundOptions) {
    this.store = options.store;
    this.secrets = options.secrets;
    this.pluginManager = options.pluginManager;
    this.getWindow = options.getWindow;
    this.logger = options.logger || console;
  }

  async start(): Promise<void> {
    await this.reconfigure();
  }

  scheduleReconfigure(): void {
    if (this.reconfigureTimer) clearTimeout(this.reconfigureTimer);
    this.reconfigureTimer = setTimeout(() => {
      this.reconfigureTimer = null;
      void this.reconfigure();
    }, 250);
  }

  async reconfigure(): Promise<void> {
    const settings = this.store.getSettings();
    const token = await this.secrets.resolve('TELEGRAM_BOT_TOKEN');
    this.tokenConfigured = Boolean(token.trim());
    if (!settings.telegram_enabled || !token.trim()) {
      this.stop();
      return;
    }
    if (this.controller && !this.controller.signal.aborted) return;
    this.controller = new AbortController();
    void this.pollLoop(token.trim(), this.controller.signal);
  }

  stop(): void {
    if (this.reconfigureTimer) {
      clearTimeout(this.reconfigureTimer);
      this.reconfigureTimer = null;
    }
    if (this.controller && !this.controller.signal.aborted) {
      this.controller.abort();
    }
    this.controller = null;
    this.polling = false;
    for (const controller of this.activeRuns.values()) {
      if (!controller.signal.aborted) controller.abort();
    }
    this.activeRuns.clear();
  }

  status(): TelegramInboundStatus {
    const settings = this.store.getSettings();
    const controllerRunning = Boolean(this.controller && !this.controller.signal.aborted);
    return {
      enabled: Boolean(settings.telegram_enabled),
      configured: this.tokenConfigured,
      polling: controllerRunning && this.polling,
      allowed_user_ids_configured: Boolean(settings.telegram_allowed_user_ids?.trim()),
      active_runs: this.activeRuns.size,
      last_poll_at: this.lastPollAt || undefined,
      last_update_id: this.lastUpdateID ?? undefined,
      last_error: this.lastError || undefined,
    };
  }

  private async pollLoop(token: string, signal: AbortSignal): Promise<void> {
    let offset = this.store.getTelegramInboundOffset();
    this.lastUpdateID = offset > 0 ? offset - 1 : null;
    this.polling = true;
    this.lastError = '';
    this.logger.info('telegram inbound started');
    this.log({
      level: 'info',
      risk_level: 'read_only',
      category: 'external',
      feature_key: 'telegram.poll.started',
      source: 'telegram_inbound',
      message: 'Telegram inbound poll started',
    });
    try {
      await this.drainDurableInbox(token, signal);
      while (!signal.aborted) {
        try {
          const updates = await this.getUpdates(token, offset, signal);
          this.lastPollAt = new Date().toISOString();
          this.lastError = '';
          if (updates.length > 0) {
            const persisted = this.store.persistTelegramInboundUpdates(updates.map((update) => ({
              update_id: update.update_id,
              message_id: update.message?.message_id,
              chat_id: update.message?.chat.id,
              from_id: update.message?.from?.id,
              chat_type: update.message?.chat.type,
              text: update.message?.text || '',
              metadata: {
                source: 'telegram_get_updates',
                external_thread_id: update.message?.message_thread_id ? String(update.message.message_thread_id) : '',
              },
            })));
            // Requesting the next persisted offset acknowledges the batch to
            // Telegram. The durable inbox, not process memory, is now the
            // source of truth for processing and deduplication.
            offset = persisted.offset;
            this.lastUpdateID = offset > 0 ? offset - 1 : this.lastUpdateID;
          }
          await this.drainDurableInbox(token, signal);
        } catch (error) {
          if (!signal.aborted) {
            this.lastError = sanitizeTelegramError(error, token);
            this.logger.warn('telegram inbound poll failed', this.lastError);
            this.log({
              level: 'warn',
              risk_level: 'read_only',
              category: 'external',
              feature_key: 'telegram.poll.failed',
              source: 'telegram_inbound',
              message: 'Telegram inbound poll failed',
              error: { message: sanitizeTelegramError(error, token) },
            });
            await sleep(retryDelayMs, signal);
          }
        }
      }
    } finally {
      this.polling = false;
      this.logger.info('telegram inbound stopped');
      this.log({
        level: 'info',
        risk_level: 'read_only',
        category: 'external',
        feature_key: 'telegram.poll.stopped',
        source: 'telegram_inbound',
        message: 'Telegram inbound poll stopped',
      });
    }
  }

  private async getUpdates(token: string, offset: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    const params = new URLSearchParams({
      timeout: String(pollTimeoutSeconds),
      offset: String(offset),
      allowed_updates: JSON.stringify(['message']),
    });
    const payload = await telegramRequest<TelegramUpdateResponse>(token, `getUpdates?${params.toString()}`, { signal });
    if (!payload.ok) {
      throw new Error(payload.description || 'telegram getUpdates returned an error');
    }
    return payload.result || [];
  }

  private async drainDurableInbox(token: string, signal: AbortSignal): Promise<void> {
    await this.drainPendingReplies(token, signal);
    while (!signal.aborted) {
      const update = this.store.claimTelegramInboundUpdate();
      if (!update) break;
      await this.handleUpdate(token, update);
      await this.drainPendingReplies(token, signal);
    }
  }

  private async drainPendingReplies(token: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const update = this.store.claimTelegramInboundReply();
      if (!update) break;
      try {
        const messageID = await sendTelegramMessage(token, Number(update.chat_id), update.response_text);
        this.store.completeTelegramInboundUpdate({
          update_id: update.update_id,
          external_delivery_id: `telegram:${update.chat_id}:${messageID}`,
        });
        this.log({
          level: 'info',
          risk_level: 'state_change',
          category: 'external',
          feature_key: 'telegram.reply.sent',
          source: 'telegram_inbound',
          message: 'Telegram reply sent',
          run_id: update.run_id,
          conversation_id: telegramConversationID(update.chat_id, telegramExternalThreadID(update)),
          item_type: 'telegram_chat',
          item_id: update.chat_id,
          payload: { update_id: update.update_id, response_length: update.response_text.length, external_message_id: messageID },
        });
      } catch (error) {
        const code = telegramRequestErrorCode(error);
        const acceptanceUnknown = isTelegramAcceptanceUnknown(code);
        this.store.failTelegramInboundUpdate({
          update_id: update.update_id,
          error_code: code,
          error_message: sanitizeTelegramError(error, token),
          acceptance_unknown: acceptanceUnknown,
        });
        this.log({
          level: 'error',
          risk_level: 'state_change',
          category: 'external',
          feature_key: acceptanceUnknown ? 'telegram.reply.acceptance_unknown' : 'telegram.reply.failed',
          source: 'telegram_inbound',
          message: acceptanceUnknown ? 'Telegram reply acceptance is unknown; automatic resend suppressed' : 'Telegram reply failed',
          run_id: update.run_id,
          item_type: 'telegram_message',
          item_id: update.message_id,
          payload: { update_id: update.update_id, retryable: false, acceptance_unknown: acceptanceUnknown },
          error: { code, message: sanitizeTelegramError(error, token) },
        });
      }
    }
  }

  private async handleUpdate(token: string, persisted: TelegramInboundUpdateRecord): Promise<void> {
    const update: TelegramUpdate = {
      update_id: persisted.update_id,
      message: persisted.message_id || persisted.chat_id ? {
        message_id: Number(persisted.message_id || 0),
        message_thread_id: telegramExternalThreadID(persisted) || undefined,
        text: persisted.text,
        chat: { id: Number(persisted.chat_id || 0), type: persisted.chat_type },
        from: persisted.from_id ? { id: Number(persisted.from_id) } : undefined,
      } : undefined,
    };
    const message = update.message;
    const text = message?.text?.trim() || '';
    if (!message || !text) {
      this.store.completeTelegramInboundUpdate({ update_id: persisted.update_id });
      return;
    }
    if (message.chat.type !== 'private') {
      this.log({
        level: 'info',
        risk_level: 'read_only',
        category: 'external',
        feature_key: 'telegram.message.rejected',
        source: 'telegram_inbound',
        message: 'Telegram message rejected',
        item_type: 'telegram_message',
        item_id: String(message.message_id),
        payload: { chat_id: message.chat.id, chat_type: message.chat.type, update_id: update.update_id, reason: 'non_private_chat' },
      });
      this.store.completeTelegramInboundUpdate({ update_id: update.update_id });
      return;
    }
    const fromID = message.from?.id;
    const settings = this.store.getSettings();
    const allowed = allowedUserIDs(settings.telegram_allowed_user_ids);
    if (!fromID || !allowed.has(fromID)) {
      this.log({
        level: 'warn',
        risk_level: 'read_only',
        category: 'external',
        feature_key: 'telegram.message.rejected',
        source: 'telegram_inbound',
        message: 'Telegram message rejected',
        item_type: 'telegram_message',
        item_id: String(message.message_id),
        payload: { chat_id: message.chat.id, from_id: fromID, update_id: update.update_id, reason: 'unauthorized_user' },
      });
      // Strict allow-list: reject and audit without sending any data back to
      // an untrusted chat/user.
      this.store.completeTelegramInboundUpdate({ update_id: update.update_id });
      return;
    }
    const principalID = localOwnerPrincipalID;
    if (isStatusCommand(text)) {
      this.log({
        level: 'info',
        risk_level: 'read_only',
        category: 'external',
        feature_key: 'telegram.status.requested',
        source: 'telegram_inbound',
        message: 'Telegram status requested',
        item_type: 'telegram_message',
        item_id: String(message.message_id),
        payload: { chat_id: message.chat.id, from_id: fromID, update_id: update.update_id },
      });
      this.store.markTelegramInboundReplyPending({
        update_id: update.update_id,
        response_text: await this.telegramStatusReply(settings),
      });
      return;
    }
    this.log({
      level: 'info',
      risk_level: 'read_only',
      category: 'external',
      feature_key: 'telegram.message.received',
      source: 'telegram_inbound',
      message: 'Telegram message received',
      item_type: 'telegram_message',
      item_id: String(message.message_id),
      payload: { chat_id: message.chat.id, from_id: fromID, update_id: update.update_id, text_length: text.length },
    });
    this.store.markTelegramInboundModelStarted(update.update_id);
    try {
      const result = await this.runJoiForReply(token, update.update_id, message, settings, principalID);
      this.store.markTelegramInboundReplyPending({
        update_id: update.update_id,
        response_text: result.reply,
        run_id: result.runID,
      });
    } catch (error) {
      this.logger.error('telegram inbound run failed', sanitizeTelegramError(error, token));
      this.log({
        level: 'error',
        risk_level: 'read_only',
        category: 'external',
        feature_key: 'telegram.run.failed',
        source: 'telegram_inbound',
        message: 'Telegram run failed',
        conversation_id: telegramConversationID(message.chat.id, message.message_thread_id),
        error: { message: sanitizeTelegramError(error, token) },
      });
      // The durable model_started boundary prevents a retry of this model
      // task. A failure response may still be delivered once.
      this.store.markTelegramInboundReplyPending({
        update_id: update.update_id,
        response_text: `处理失败：${compactText(safeErrorMessage(error), 260)}`,
      });
    }
  }

  private async telegramStatusReply(settings: SettingsRecord): Promise<string> {
    let modelCredential = 'missing';
    try {
      const acpProvider = this.pluginManager.resolveProvider(settings.model_provider || '', telegramOwnerPermissionProfile);
      const apiKey = acpProvider
        ? LOCAL_MODEL_PROXY_API_KEY
        : await resolveAPIKeyForModelEndpoint(settings, this.secrets);
      modelCredential = apiKey.trim() ? 'available' : 'missing';
    } catch (error) {
      modelCredential = `failed: ${compactText(safeErrorMessage(error), 180)}`;
    }
    const health = this.store.systemHealth();
    return [
      'Joi Telegram 在线。',
      `Telegram: ${settings.telegram_enabled ? 'enabled' : 'disabled'}`,
      `Model: ${settings.model_provider || 'unset'} / ${settings.model_name || 'unset'}`,
      `Model credential: ${modelCredential}`,
      `SQLite: ${health.service_status.sqlite ? 'ok' : 'failed'}`,
      'Remote mode: danger_full_access + full_access_blacklist_v1',
    ].join('\n');
  }

  private async runJoiForReply(
    token: string,
    updateID: number,
    message: TelegramMessage,
    _initialSettings: SettingsRecord,
    principalID?: string,
  ): Promise<{ reply: string; runID?: string }> {
    const req: ChatRequest = {
      conversation_id: telegramConversationID(message.chat.id, message.message_thread_id),
      channel: 'telegram',
      user_id: message.from?.id ? `telegram:${message.from.id}` : `telegram:${message.chat.id}`,
      principal_id: principalID,
      message: normalizeTelegramText(message.text || ''),
      preferred_node: 'main-node',
      allow_worker: false,
      runtime_mode: 'tool_calling',
      permission_profile: telegramOwnerPermissionProfile,
    };
    const stopTyping = startTelegramTypingLoop(token, message.chat.id, this.logger);
    try {
      this.log({
        level: 'info',
        risk_level: 'read_only',
        category: 'external',
        feature_key: 'telegram.run.requested',
        source: 'telegram_inbound',
        message: 'Telegram run requested',
        conversation_id: req.conversation_id,
        payload: { chat_id: message.chat.id, from_id: message.from?.id, text_length: req.message.length },
      });
      const settings = this.store.getSettings();
      const runtimeRoute = await resolveTelegramModelRuntimeRoute({
        settings,
        request: req,
        localProxyAPIKey: LOCAL_MODEL_PROXY_API_KEY,
        resolveACPProvider: (providerID, permissionProfile) => this.pluginManager.resolveProvider(providerID, permissionProfile),
        resolveAPIKey: () => resolveAPIKeyForModelEndpoint(settings, this.secrets),
        canRun: canRunRealToolCalling,
      });
      if (!runtimeRoute.ready) {
        this.log({
          level: 'warn',
          risk_level: 'read_only',
          category: 'external',
          feature_key: 'telegram.run.skipped',
          source: 'telegram_inbound',
          message: 'Telegram run skipped',
          conversation_id: req.conversation_id,
          payload: { reason: 'model_not_configured' },
        });
        return { reply: 'Joi Telegram 入口已收到消息，但模型未配置完整，无法生成回复。请先在 Joi Desktop 里完成模型设置。' };
      }
      const result = await runLiveElectronToolCallingChat(
        req,
        settings || _initialSettings,
        this.secrets,
        this.store,
        this.activeRuns,
        (runID, event?: RunEvent) => {
          this.store.attachTelegramInboundRun(updateID, runID);
          const window = this.getWindow();
          if (window && !window.isDestroyed()) {
            if (event) emitRunEvent(window, event);
            else emitRunEvents(window, this.store.getRunTrace(runID));
          }
        },
        this.pluginManager,
        { model_selection_policy: runtimeRoute.model_selection_policy },
      );
      const window = this.getWindow();
      if (window && !window.isDestroyed()) emitRunEvents(window, this.store.getRunTrace(result.run_id));
      return { reply: telegramReply(result), runID: result.run_id };
    } finally {
      stopTyping();
    }
  }

  private log(input: AppLogInput): void {
    try {
      this.store.recordAppLog(input);
    } catch (error) {
      this.logger.warn('telegram app log write failed', safeErrorMessage(error));
    }
  }
}

function telegramExternalThreadID(update: Pick<TelegramInboundUpdateRecord, 'metadata'>): number | undefined {
  const value = String(update.metadata?.external_thread_id ?? '').trim();
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function allowedUserIDs(value = ''): Set<number> {
  return new Set(value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item)));
}

function normalizeTelegramText(text: string): string {
  if (text.trim().toLowerCase() === '/joi_status') return 'Joi 自检';
  return text;
}

function isStatusCommand(text: string): boolean {
  return text.trim().toLowerCase() === '/joi_status';
}

function telegramReply(result: ChatResponse): string {
  const response = result.response || '';
  if (response.trim()) return response;
  return `Joi 已完成处理，但没有生成可见文本。Run Trace: ${result.run_id}`;
}

async function sendTelegramMessage(token: string, chatID: number, text: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), telegramReplyTimeoutMs(text));
  timer.unref?.();
  try {
    const result = await postTelegramMessage({
      apiBaseURL: telegramAPIBaseURL,
      token,
      chatID,
      text,
      disableLinkPreview: true,
      fetchImpl: fetch,
      signal: controller.signal,
    });
    if (!result.ok) {
      throw codedTelegramRequestError(
        result.messageIDs.length > 0 ? 'TELEGRAM_ACCEPTANCE_UNKNOWN_PARTIAL' : 'TELEGRAM_API_REJECTED',
        result.payload.description || `Telegram rejected ${result.method} with HTTP ${result.status}.`,
      );
    }
    const messageID = result.messageIDs[0] || '';
    if (!messageID) {
      throw codedTelegramRequestError(
        'TELEGRAM_ACCEPTANCE_UNKNOWN_RESPONSE',
        `Telegram ${result.method} returned no message ID; automatic resend is suppressed.`,
      );
    }
    return messageID;
  } catch (error) {
    const code = telegramRequestErrorCode(error);
    if (controller.signal.aborted) {
      throw codedTelegramRequestError(
        'TELEGRAM_ACCEPTANCE_UNKNOWN_TIMEOUT',
        'Telegram sendMessage timed out; automatic resend is suppressed.',
      );
    }
    if (code === 'TELEGRAM_REQUEST_FAILED') {
      throw codedTelegramRequestError(
        'TELEGRAM_ACCEPTANCE_UNKNOWN_CONNECTION',
        `Telegram connection ended before acceptance was confirmed: ${compactText(safeErrorMessage(error), 220)}`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function telegramReplyTimeoutMs(text: string): number {
  return planTelegramMessage(text).images.length > 0 ? Math.max(replyTimeoutMs, 90_000) : replyTimeoutMs;
}

function startTelegramTypingLoop(token: string, chatID: number, logger: Pick<Console, 'warn'>): () => void {
  let stopped = false;
  const pulse = () => {
    if (stopped) return;
    void sendTelegramChatAction(token, chatID, 'typing').catch((error) => {
      logger.warn('telegram typing action failed', sanitizeTelegramError(error, token));
    });
  };
  pulse();
  const timer = setInterval(pulse, typingPulseIntervalMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function sendTelegramChatAction(token: string, chatID: number, action: 'typing'): Promise<void> {
  await telegramRequest(token, 'sendChatAction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatID,
      action,
    }),
  });
}

async function telegramRequest<T = TelegramAPIResponse>(token: string, method: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${telegramAPIBaseURL}/bot${token}/${method}`, init);
  const payload = await response.json().catch(() => ({ ok: false, description: 'telegram returned non-json' })) as T & { ok?: boolean; description?: string };
  if (!response.ok) {
    throw codedTelegramRequestError('TELEGRAM_API_REJECTED', payload.description || `telegram request failed: ${response.status}`);
  }
  return payload;
}

function codedTelegramRequestError(code: string, message: string): Error & { code?: string } {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function telegramRequestErrorCode(error: unknown): string {
  return String((error as { code?: unknown })?.code || 'TELEGRAM_REQUEST_FAILED').trim() || 'TELEGRAM_REQUEST_FAILED';
}

function isTelegramAcceptanceUnknown(code: string): boolean {
  return code.startsWith('TELEGRAM_ACCEPTANCE_UNKNOWN');
}

function compactText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeTelegramError(error: unknown, token: string): string {
  return safeErrorMessage(error).replaceAll(token, '[redacted]');
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
