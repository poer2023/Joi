import type { BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import type { ChatRequest, ChatResponse, SettingsRecord } from '../../../../packages/shared-types/src/desktop-api';
import type { KeychainSecretStore } from '../../../../packages/secrets/src/keychain';
import type { JoiSQLiteStore } from '../../../../packages/store/src/sqlite';
import { canRunRealToolCalling, emitRunEvents, resolveAPIKeyForModelEndpoint, runLiveElectronToolCallingChat } from './ipc';

type TelegramInboundOptions = {
  store: JoiSQLiteStore;
  secrets: KeychainSecretStore;
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

export class TelegramInboundService {
  private readonly store: JoiSQLiteStore;
  private readonly secrets: KeychainSecretStore;
  private readonly getWindow: () => BrowserWindow | null;
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>;
  private controller: AbortController | null = null;
  private reconfigureTimer: NodeJS.Timeout | null = null;
  private activeRuns = new Map<string, AbortController>();

  constructor(options: TelegramInboundOptions) {
    this.store = options.store;
    this.secrets = options.secrets;
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
    for (const controller of this.activeRuns.values()) {
      if (!controller.signal.aborted) controller.abort();
    }
    this.activeRuns.clear();
  }

  private async pollLoop(token: string, signal: AbortSignal): Promise<void> {
    let offset = 0;
    this.logger.info('telegram inbound started');
    while (!signal.aborted) {
      try {
        const updates = await this.getUpdates(token, offset, signal);
        for (const update of updates) {
          if (signal.aborted) break;
          await this.handleUpdate(token, update);
          offset = Math.max(offset, update.update_id + 1);
        }
      } catch (error) {
        if (!signal.aborted) {
          this.logger.warn('telegram inbound poll failed', sanitizeTelegramError(error, token));
          await sleep(retryDelayMs, signal);
        }
      }
    }
    this.logger.info('telegram inbound stopped');
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

  private async handleUpdate(token: string, update: TelegramUpdate): Promise<void> {
    const message = update.message;
    const text = message?.text?.trim() || '';
    if (!message || !text) return;
    if (message.chat.type !== 'private') {
      await sendTelegramMessage(token, message.chat.id, '当前 Joi Telegram 入口只支持私聊文本消息。');
      return;
    }
    const fromID = message.from?.id;
    const settings = this.store.getSettings();
    const allowed = allowedUserIDs(settings.telegram_allowed_user_ids);
    if (allowed.size > 0 && (!fromID || !allowed.has(fromID))) {
      await sendTelegramMessage(token, message.chat.id, '未授权：当前 Joi Telegram 入口只允许白名单用户使用。');
      return;
    }
    if (isStatusCommand(text)) {
      await sendTelegramMessage(token, message.chat.id, await this.telegramStatusReply(settings));
      return;
    }
    await this.runJoiAndReply(token, message, settings);
  }

  private async telegramStatusReply(settings: SettingsRecord): Promise<string> {
    let modelCredential = 'missing';
    try {
      const apiKey = await resolveAPIKeyForModelEndpoint(settings, this.secrets);
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
      'Remote mode: read_only',
    ].join('\n');
  }

  private async runJoiAndReply(token: string, message: TelegramMessage, initialSettings: SettingsRecord): Promise<void> {
    const req: ChatRequest = {
      conversation_id: stableInboundConversationID('telegram', `chat:${message.chat.id}`),
      channel: 'telegram',
      user_id: message.from?.id ? `telegram:${message.from.id}` : `telegram:${message.chat.id}`,
      message: normalizeTelegramText(message.text || ''),
      preferred_node: 'main-node',
      allow_worker: false,
      runtime_mode: 'tool_calling',
      permission_profile: 'read_only',
    };
    const stopTyping = startTelegramTypingLoop(token, message.chat.id, this.logger);
    try {
      const settings = this.store.getSettings();
      const apiKey = await resolveAPIKeyForModelEndpoint(settings, this.secrets);
      if (!canRunRealToolCalling(settings, apiKey, req)) {
        await sendTelegramMessage(token, message.chat.id, 'Joi Telegram 入口已收到消息，但模型未配置完整，无法生成回复。请先在 Joi Desktop 里完成模型设置。');
        return;
      }
      const result = await runLiveElectronToolCallingChat(req, settings || initialSettings, apiKey, this.store, this.activeRuns, (runID) => {
        const window = this.getWindow();
        if (window && !window.isDestroyed()) emitRunEvents(window, this.store.getRunTrace(runID));
      });
      const window = this.getWindow();
      if (window && !window.isDestroyed()) emitRunEvents(window, this.store.getRunTrace(result.run_id));
      await sendTelegramMessage(token, message.chat.id, telegramReply(result));
    } catch (error) {
      this.logger.error('telegram inbound run failed', sanitizeTelegramError(error, token));
      await sendTelegramMessage(token, message.chat.id, `处理失败：${compactText(safeErrorMessage(error), 260)}`);
    } finally {
      stopTyping();
    }
  }
}

function stableInboundConversationID(channel: 'telegram', externalKey: string): string {
  const normalized = externalKey.trim() || 'unknown';
  const slug = normalized.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'unknown';
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return `conv_${channel}_${slug}_${digest}`;
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
  const response = compactText(result.response || '', 3400);
  if (response) return response;
  return compactText(`Joi 已完成处理，但没有生成可见文本。Run Trace: ${result.run_id}`, 3400);
}

async function sendTelegramMessage(token: string, chatID: number, text: string): Promise<void> {
  await telegramRequest(token, 'sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatID,
      text: compactText(text, 3500),
      disable_web_page_preview: true,
    }),
  });
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
    throw new Error(payload.description || `telegram request failed: ${response.status}`);
  }
  return payload;
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
