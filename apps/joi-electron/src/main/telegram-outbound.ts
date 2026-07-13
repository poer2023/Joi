import { createHash } from 'node:crypto';
import type {
  AutomationDefinition,
  AutomationTriggerRecord,
  ChatResponse,
} from '../../../../packages/shared-types/src/desktop-api';
import type {
  JoiSQLiteStore,
  ProactiveOutboundContext,
} from '../../../../packages/store/src/sqlite';
import type { KeychainSecretStore } from '../../../../packages/secrets/src/keychain';
import {
  planTelegramMessage,
  postTelegramMessage,
} from '../../../../packages/runtime/src/telegram-message.ts';

type TelegramOutboundStore = Pick<JoiSQLiteStore,
  | 'getSettings'
  | 'recordAutomationRunCompleted'
  | 'claimOutboundNotificationDelivery'
  | 'completeOutboundNotificationDelivery'
  | 'failOutboundNotificationDelivery'
  | 'listDueOutboundNotificationRetries'
  | 'reclaimExpiredOutboundNotificationLeases'
  | 'getProactiveOutboundContext'
  | 'listProactiveOutboundContexts'
  | 'recordAppLog'
>;

type TelegramPolicy = {
  enabled: boolean;
  chatID: string;
  prefix: string;
  disableLinkPreview: boolean;
  maxAttempts: number;
  backoffSeconds: number[];
};

export type TelegramOutboundDeliveryResult = {
  status: 'skipped' | 'deduped' | 'delivered' | 'failed';
  notification_id?: string;
  external_delivery_id?: string;
  reason?: string;
  error_summary?: string;
};

export type TelegramOutboundServiceOptions = {
  store: TelegramOutboundStore;
  secrets: Pick<KeychainSecretStore, 'resolve'>;
  fetchImpl?: typeof fetch;
  apiBaseURL?: string;
  timeoutMs?: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
};

export class TelegramOutboundService {
  private readonly store: TelegramOutboundStore;
  private readonly secrets: Pick<KeychainSecretStore, 'resolve'>;
  private readonly fetchImpl: typeof fetch;
  private readonly apiBaseURL: string;
  private readonly timeoutMs: number;
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>;
  private proactiveDrainRunning = false;
  private failedDeliveryDrainRunning = false;

  constructor(options: TelegramOutboundServiceOptions) {
    this.store = options.store;
    this.secrets = options.secrets;
    this.fetchImpl = options.fetchImpl || fetch;
    this.apiBaseURL = (options.apiBaseURL || 'https://api.telegram.org').replace(/\/+$/, '');
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? 10_000);
    this.logger = options.logger || console;
  }

  async deliverAutomationCompletion(input: {
    automation: AutomationDefinition;
    trigger: AutomationTriggerRecord;
    response: ChatResponse;
    automation_run_id: string;
    product_task_id?: string;
  }): Promise<TelegramOutboundDeliveryResult> {
    const policy = resolveTelegramNotificationPolicy(input.automation.notification_policy);
    const responseText = input.response.response || '任务已完成，但没有可见文本。';
    const responseSummary = compactText(responseText, 500);
    if (!policy.enabled) {
      this.store.recordAutomationRunCompleted({
        automation_run_id: input.automation_run_id,
        run_id: input.response.run_id,
        product_task_id: input.product_task_id,
        output_summary: responseSummary,
      });
      return { status: 'skipped', reason: 'notification_policy_disabled' };
    }
    const deliveryInput = {
      origin: 'automation',
      dedupKey: `automation:${input.automation.id}:trigger:${input.trigger.id}:success`,
      runID: input.response.run_id,
      conversationID: input.response.conversation_id,
      productTaskID: input.product_task_id,
      targetChatID: policy.chatID,
      disableLinkPreview: policy.disableLinkPreview,
      maxAttempts: policy.maxAttempts,
      backoffSeconds: policy.backoffSeconds,
      text: `${policy.prefix || `Joi 自动化 · ${input.automation.name}`}\n${responseText}`,
      summary: responseSummary,
      metadata: {
        automation_id: input.automation.id,
        automation_run_trigger_id: input.trigger.id,
        notification_policy: 'telegram_success',
      },
    } as const;
    const settings = this.store.getSettings();
    const allowedChatIDs = allowedPrivateChatIDs(settings.telegram_allowed_user_ids || '');
    const requestedChatID = normalizePrivateChatID(deliveryInput.targetChatID || '') || allowedChatIDs[0] || '';
    this.store.recordAutomationRunCompleted({
      automation_run_id: input.automation_run_id,
      run_id: input.response.run_id,
      product_task_id: input.product_task_id,
      output_summary: responseSummary,
      notification_delivery: {
        id: notificationIDFor(deliveryInput.dedupKey),
        dedup_key: deliveryInput.dedupKey,
        run_id: deliveryInput.runID,
        conversation_id: deliveryInput.conversationID,
        product_task_id: deliveryInput.productTaskID,
        channel: 'telegram',
        target: requestedChatID,
        summary: deliveryInput.summary,
        max_attempts: deliveryInput.maxAttempts,
        backoff_seconds: deliveryInput.backoffSeconds,
        metadata: {
          origin: deliveryInput.origin,
          ...deliveryInput.metadata,
          delivery_payload: {
            text: deliveryInput.text,
            disable_link_preview: Boolean(deliveryInput.disableLinkPreview),
          },
        },
      },
    });
    return this.deliver(deliveryInput);
  }

  async deliverProactiveMessage(id: string): Promise<TelegramOutboundDeliveryResult> {
    const context = this.store.getProactiveOutboundContext(id);
    if (!isProactiveTelegramDeliveryRequested(context)) {
      return { status: 'skipped', reason: 'proactive_channel_not_telegram' };
    }
    if (!['authorized', 'scheduled', 'delivered'].includes(context.status)) {
      return { status: 'skipped', reason: `proactive_status_${context.status || 'unknown'}` };
    }
    if (context.expires_at && Date.parse(context.expires_at) <= Date.now()) {
      return { status: 'skipped', reason: 'proactive_message_expired' };
    }
    if (context.send_after && Date.parse(context.send_after) > Date.now()) {
      return { status: 'skipped', reason: 'proactive_message_not_due' };
    }
    const policy = proactiveTelegramPolicy(context);
    return this.deliver({
      origin: 'proactive',
      dedupKey: `proactive:${context.id}`,
      runID: context.run_id,
      conversationID: context.conversation_id,
      productTaskID: context.product_task_id,
      proactiveMessageID: context.id,
      openLoopID: context.open_loop_id,
      targetChatID: policy.chatID,
      disableLinkPreview: policy.disableLinkPreview,
      maxAttempts: policy.maxAttempts,
      backoffSeconds: policy.backoffSeconds,
      text: `${policy.prefix || 'Joi 主动提醒'}\n${context.title}\n${context.body}`,
      summary: compactText(context.body, 500),
      metadata: { proactive_reason: context.reason },
    });
  }

  async drainAuthorizedProactiveMessages(limit = 20): Promise<TelegramOutboundDeliveryResult[]> {
    if (this.proactiveDrainRunning) return [];
    this.proactiveDrainRunning = true;
    try {
      const contexts = this.store.listProactiveOutboundContexts({ limit });
      const results: TelegramOutboundDeliveryResult[] = [];
      for (const context of contexts) {
        if (!isProactiveTelegramDeliveryRequested(context)) continue;
        results.push(await this.deliverProactiveMessage(context.id));
      }
      return results;
    } finally {
      this.proactiveDrainRunning = false;
    }
  }

  async drainFailedDeliveries(limit = 20): Promise<TelegramOutboundDeliveryResult[]> {
    if (this.failedDeliveryDrainRunning) return [];
    this.failedDeliveryDrainRunning = true;
    try {
      const reclaimed = this.store.reclaimExpiredOutboundNotificationLeases({ channel: 'telegram', limit });
      for (const delivery of reclaimed) {
        this.logger.warn('telegram outbound send lease reclaimed without resend', {
          notification_id: delivery.id,
          status: delivery.status,
          error_code: delivery.metadata.error_code,
        });
      }
      const contexts = this.store.listDueOutboundNotificationRetries({ channel: 'telegram', limit });
      const results: TelegramOutboundDeliveryResult[] = [];
      for (const context of contexts) {
        results.push(await this.deliver({
          origin: context.metadata.origin === 'proactive' ? 'proactive' : 'automation',
          dedupKey: context.dedup_key,
          runID: context.run_id,
          conversationID: context.conversation_id,
          productTaskID: context.product_task_id,
          proactiveMessageID: context.proactive_message_id,
          openLoopID: context.open_loop_id,
          targetChatID: context.target,
          disableLinkPreview: context.disable_link_preview,
          maxAttempts: context.max_attempts,
          backoffSeconds: context.backoff_seconds,
          text: context.text,
          summary: context.summary,
          metadata: context.metadata,
        }));
      }
      return results;
    } finally {
      this.failedDeliveryDrainRunning = false;
    }
  }

  private async deliver(input: {
    origin: 'automation' | 'proactive';
    dedupKey: string;
    runID?: string;
    conversationID?: string;
    productTaskID?: string;
    proactiveMessageID?: string;
    openLoopID?: string;
    targetChatID?: string;
    disableLinkPreview?: boolean;
    maxAttempts?: number;
    backoffSeconds?: number[];
    text: string;
    summary: string;
    metadata: Record<string, unknown>;
  }): Promise<TelegramOutboundDeliveryResult> {
    const settings = this.store.getSettings();
    const allowedChatIDs = allowedPrivateChatIDs(settings.telegram_allowed_user_ids || '');
    const requestedChatID = normalizePrivateChatID(input.targetChatID || '') || allowedChatIDs[0] || '';
    const notificationID = notificationIDFor(input.dedupKey);
    let claim: ReturnType<TelegramOutboundStore['claimOutboundNotificationDelivery']>;
    try {
      claim = this.store.claimOutboundNotificationDelivery({
        id: notificationID,
        dedup_key: input.dedupKey,
        run_id: input.runID,
        conversation_id: input.conversationID,
        product_task_id: input.productTaskID,
        open_loop_id: input.openLoopID,
        proactive_message_id: input.proactiveMessageID,
        channel: 'telegram',
        target: requestedChatID,
        summary: input.summary,
        max_attempts: input.maxAttempts,
        backoff_seconds: input.backoffSeconds,
        metadata: {
          origin: input.origin,
          ...input.metadata,
          delivery_payload: {
            text: input.text,
            disable_link_preview: Boolean(input.disableLinkPreview),
          },
        },
      });
    } catch (error) {
      const summary = compactText(safeErrorMessage(error), 300);
      this.recordLog('error', 'telegram.outbound.audit_failed', 'Telegram outbound delivery could not create its audit record', input, notificationID, {
        error: { code: 'AUDIT_WRITE_FAILED', message: summary },
      });
      return { status: 'failed', notification_id: notificationID, error_summary: summary };
    }
    if (!claim.claimed) {
      this.recordLog('debug', 'telegram.outbound.deduped', 'Duplicate Telegram outbound delivery suppressed', input, notificationID, {
        payload: { existing_status: claim.status, dedup_key: input.dedupKey },
      });
      if (claim.status === 'send_failed') {
        return {
          status: 'failed',
          notification_id: notificationID,
          reason: 'previous_attempt_failed',
          error_summary: String(claim.delivery.metadata.error_message || 'Previous Telegram delivery attempt failed.'),
        };
      }
      return { status: 'deduped', notification_id: notificationID, reason: claim.status || 'already_claimed' };
    }

    let token = '';
    let acceptedExternalDeliveryID = '';
    try {
      if (!settings.telegram_enabled) throw codedDeliveryError('TELEGRAM_DISABLED', 'Telegram is disabled in Joi settings.');
      if (allowedChatIDs.length === 0) throw codedDeliveryError('ALLOWLIST_MISSING', 'Telegram allowed user IDs are not configured.');
      if (!requestedChatID || !allowedChatIDs.includes(requestedChatID)) {
        throw codedDeliveryError('DESTINATION_NOT_ALLOWLISTED', 'Telegram destination is not an allow-listed private user.');
      }
      token = (await this.secrets.resolve('TELEGRAM_BOT_TOKEN')).trim();
      if (!token) throw codedDeliveryError('TOKEN_MISSING', 'Telegram bot token is not configured.');
      const messageID = await this.sendMessage(token, requestedChatID, input.text, Boolean(input.disableLinkPreview));
      const externalDeliveryID = `telegram:${requestedChatID}:${messageID}`;
      acceptedExternalDeliveryID = externalDeliveryID;
      this.store.completeOutboundNotificationDelivery({
        id: notificationID,
        run_id: input.runID,
        proactive_message_id: input.proactiveMessageID,
        external_delivery_id: externalDeliveryID,
        target: requestedChatID,
        summary: input.summary,
      });
      this.recordLog('info', 'telegram.outbound.sent', 'Telegram outbound notification delivered', input, notificationID, {
        payload: { target_chat_id: requestedChatID, external_delivery_id: externalDeliveryID },
      });
      return { status: 'delivered', notification_id: notificationID, external_delivery_id: externalDeliveryID };
    } catch (error) {
      const code = acceptedExternalDeliveryID
        ? 'TELEGRAM_ACCEPTANCE_UNKNOWN_PERSISTENCE'
        : deliveryErrorCode(error);
      const rawSummary = sanitizeTelegramError(error, token);
      const summary = acceptedExternalDeliveryID
        ? compactText(`Telegram accepted ${acceptedExternalDeliveryID}, but Joi could not persist delivery completion: ${rawSummary}`, 300)
        : rawSummary;
      const acceptanceUnknown = isAcceptanceUnknownDeliveryError(code);
      const retryable = !acceptanceUnknown && isRetryableDeliveryError(code);
      this.store.failOutboundNotificationDelivery({
        id: notificationID,
        run_id: input.runID,
        proactive_message_id: input.proactiveMessageID,
        target: requestedChatID,
        error_code: code,
        error_message: summary,
        external_delivery_id: acceptedExternalDeliveryID,
        summary: input.summary,
        retryable,
        acceptance_unknown: acceptanceUnknown,
      });
      this.recordLog('error', 'telegram.outbound.failed', 'Telegram outbound notification failed', input, notificationID, {
        payload: { target_chat_id: requestedChatID, retryable, acceptance_unknown: acceptanceUnknown },
        error: { code, message: summary },
      });
      this.logger.warn('telegram outbound delivery failed', { code, message: summary });
      return {
        status: 'failed',
        notification_id: notificationID,
        reason: acceptanceUnknown ? 'telegram_acceptance_unknown' : undefined,
        error_summary: summary,
      };
    }
  }

  private async sendMessage(token: string, chatID: string, text: string, disableLinkPreview: boolean): Promise<string> {
    const controller = new AbortController();
    const timeoutMs = planTelegramMessage(text).images.length > 0 ? Math.max(this.timeoutMs, 90_000) : this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const result = await postTelegramMessage({
        apiBaseURL: this.apiBaseURL,
        token,
        chatID,
        text,
        disableLinkPreview,
        fetchImpl: this.fetchImpl,
        signal: controller.signal,
      });
      const payload = result.payload;
      if (!result.ok) {
        const code = result.messageIDs.length > 0
          ? 'TELEGRAM_ACCEPTANCE_UNKNOWN_PARTIAL'
          : result.status >= 200 && result.status < 300
          ? 'TELEGRAM_ACCEPTANCE_UNKNOWN_RESPONSE'
          : result.status === 429
          ? 'TELEGRAM_API_RETRYABLE'
          : result.status >= 500
            ? 'TELEGRAM_ACCEPTANCE_UNKNOWN_HTTP'
            : 'TELEGRAM_API_ERROR';
        throw codedDeliveryError(
          code,
          compactText(payload.description || `Telegram ${result.method} failed with HTTP ${result.status}.`, 300),
        );
      }
      const messageID = result.messageIDs[0] || '';
      if (!messageID) {
        throw codedDeliveryError(
          'TELEGRAM_ACCEPTANCE_UNKNOWN_RESPONSE',
          `Telegram ${result.method} returned no message ID, so acceptance cannot be confirmed.`,
        );
      }
      return messageID;
    } catch (error) {
      if (controller.signal.aborted) {
        throw codedDeliveryError('TELEGRAM_ACCEPTANCE_UNKNOWN_TIMEOUT', 'Telegram sendMessage timed out; acceptance is unknown and automatic resend is suppressed.');
      }
      if (deliveryErrorCode(error) === 'TELEGRAM_SEND_FAILED') {
        throw codedDeliveryError('TELEGRAM_ACCEPTANCE_UNKNOWN_CONNECTION', `Telegram connection ended before acceptance was confirmed: ${compactText(safeErrorMessage(error), 220)}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private recordLog(
    level: string,
    featureKey: string,
    message: string,
    input: {
      origin: 'automation' | 'proactive';
      runID?: string;
      conversationID?: string;
      productTaskID?: string;
      proactiveMessageID?: string;
      metadata: Record<string, unknown>;
    },
    notificationID: string,
    extra: { payload?: Record<string, unknown>; error?: unknown } = {},
  ): void {
    try {
      this.store.recordAppLog({
        level,
        risk_level: 'state_change',
        category: 'external',
        feature_key: featureKey,
        source: 'telegram_outbound',
        message,
        run_id: input.runID,
        conversation_id: input.conversationID,
        item_type: 'notification_delivery',
        item_id: notificationID,
        payload: {
          origin: input.origin,
          product_task_id: input.productTaskID || '',
          proactive_message_id: input.proactiveMessageID || '',
          ...input.metadata,
          ...(extra.payload || {}),
        },
        error: extra.error,
      });
    } catch (error) {
      this.logger.warn('telegram outbound app log write failed', safeErrorMessage(error));
    }
  }
}

export function isProactiveTelegramDeliveryRequested(context: Pick<ProactiveOutboundContext, 'channel' | 'metadata'>): boolean {
  if (context.channel.trim().toLowerCase() === 'telegram') return true;
  return resolveTelegramNotificationPolicy(asRecord(context.metadata.notification_policy)).enabled;
}

export function resolveTelegramNotificationPolicy(input: Record<string, unknown> | undefined): TelegramPolicy {
  const policy = asRecord(input);
  const telegram = asRecord(policy.telegram);
  const retryPolicy = asRecord(telegram.retry_policy || policy.retry_policy);
  const channels = arrayStrings(policy.channels || policy.destinations).map((item) => item.toLowerCase());
  const channel = String(telegram.channel || policy.channel || policy.provider || policy.target_channel || '').trim().toLowerCase();
  const explicitlyRequested = policy.telegram === true
    || Object.keys(telegram).length > 0
    || channel === 'telegram'
    || channels.includes('telegram');
  const enabled = explicitlyRequested
    && policy.enabled !== false
    && telegram.enabled !== false
    && policy.on_success !== false
    && telegram.on_success !== false
    && eventAllowsSuccess(policy.events || telegram.events);
  return {
    enabled,
    chatID: String(telegram.chat_id || policy.telegram_chat_id || policy.chat_id || policy.target || '').trim(),
    prefix: compactText(String(telegram.prefix || policy.prefix || ''), 120),
    disableLinkPreview: telegram.disable_link_preview === true
      || telegram.disable_web_page_preview === true
      || policy.disable_link_preview === true
      || policy.disable_web_page_preview === true,
    maxAttempts: normalizeMaxAttempts(retryPolicy.max_attempts || telegram.max_attempts || policy.max_attempts),
    backoffSeconds: normalizeBackoff(retryPolicy.backoff_seconds || telegram.backoff_seconds || policy.backoff_seconds),
  };
}

function proactiveTelegramPolicy(context: Pick<ProactiveOutboundContext, 'channel' | 'metadata'>): TelegramPolicy {
  const metadataPolicy = asRecord(context.metadata.notification_policy);
  if (context.channel.trim().toLowerCase() !== 'telegram') return resolveTelegramNotificationPolicy(metadataPolicy);
  return resolveTelegramNotificationPolicy({ channel: 'telegram', ...metadataPolicy });
}

function eventAllowsSuccess(value: unknown): boolean {
  const events = arrayStrings(value).map((item) => item.toLowerCase());
  if (events.length === 0) return true;
  return events.some((event) => ['success', 'succeeded', 'completed', 'completion', 'all'].includes(event));
}

function allowedPrivateChatIDs(value: string): string[] {
  return [...new Set(value.split(',').map((item) => normalizePrivateChatID(item)).filter(Boolean))];
}

function normalizePrivateChatID(value: string): string {
  const normalized = value.trim();
  return /^[1-9]\d{3,19}$/.test(normalized) ? normalized : '';
}

function notificationIDFor(dedupKey: string): string {
  return `notif_tg_${createHash('sha256').update(dedupKey).digest('hex').slice(0, 24)}`;
}

function codedDeliveryError(code: string, message: string): Error & { code?: string } {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function deliveryErrorCode(error: unknown): string {
  return String((error as { code?: unknown })?.code || 'TELEGRAM_SEND_FAILED').trim() || 'TELEGRAM_SEND_FAILED';
}

function isRetryableDeliveryError(code: string): boolean {
  return new Set([
    'TELEGRAM_API_RETRYABLE',
    'TELEGRAM_DISABLED',
    'ALLOWLIST_MISSING',
    'DESTINATION_NOT_ALLOWLISTED',
    'TOKEN_MISSING',
  ]).has(code);
}

function isAcceptanceUnknownDeliveryError(code: string): boolean {
  return code.startsWith('TELEGRAM_ACCEPTANCE_UNKNOWN');
}

function sanitizeTelegramError(error: unknown, token: string): string {
  const raw = compactText(safeErrorMessage(error), 300);
  return token ? raw.replaceAll(token, '[redacted]') : raw;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compactText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function normalizeMaxAttempts(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(5, Math.floor(parsed))) : 3;
}

function normalizeBackoff(value: unknown): number[] {
  const normalized = (Array.isArray(value) ? value : [])
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 0)
    .map((item) => Math.min(3_600, Math.floor(item)))
    .slice(0, 4);
  return normalized.length > 0 ? normalized : [30, 120];
}
