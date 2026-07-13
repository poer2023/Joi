import type {
  AutomationDefinition,
  AutomationRunRecord,
  AutomationTriggerRecord,
  AutomationWebhookEndpoint,
} from '../../api/desktop';

export type AutomationSettingsObject = {
  id: string;
  label: string;
  description: string;
};

export type AutomationDetailBanner = {
  tone: 'error' | 'status';
  title: string;
  message: string;
};

export type AutomationDetailState = {
  recentTriggers: AutomationTriggerRecord[];
  recentRuns: AutomationRunRecord[];
  lastRunStatus: string;
  webhookUrl: string;
  secretConfigured: boolean;
  secretValueAvailable: boolean;
  banner?: AutomationDetailBanner;
};

export type AutomationTelegramNotificationDraft = {
  enabled: boolean;
  chatID: string;
};

export type AutomationTelegramReadiness = {
  ready: boolean;
  defaultChatID: string;
  allowedChatIDs: string[];
  message: string;
};

export function getAutomationSettingsObjects(automations: AutomationDefinition[]): AutomationSettingsObject[] {
  return [
    { id: 'new-schedule', label: '新建定时任务', description: '按间隔、每天、每周或指定时间运行' },
    { id: 'new-webhook', label: '新建外部触发任务', description: '收到已授权的外部事件后运行' },
    ...automations.map((automation) => ({
      id: automation.id,
      label: automation.name,
      description: `${automation.kind === 'webhook' ? '外部触发' : '定时运行'} · ${automation.enabled ? '已启用' : '已停用'}`,
    })),
  ];
}

export function getAutomationDetailState(input: {
  automation?: AutomationDefinition;
  triggers: AutomationTriggerRecord[];
  runs: AutomationRunRecord[];
  endpoint?: AutomationWebhookEndpoint | null;
}): AutomationDetailState {
  const automationID = input.automation?.id || '';
  const recentTriggers = input.triggers
    .filter((trigger) => trigger.automation_id === automationID)
    .slice(0, 6);
  const recentRuns = input.runs
    .filter((run) => run.automation_id === automationID)
    .slice(0, 6);
  const latestRun = recentRuns[0];
  const latestTrigger = recentTriggers[0];
  const errorMessage = latestRun?.error_message || latestTrigger?.error_message || '';
  const errorCode = latestRun?.error_code || latestTrigger?.error_code || 'ERROR';
  const lastRunStatus = latestRun?.status || latestTrigger?.status || 'idle';
  return {
    recentTriggers,
    recentRuns,
    lastRunStatus,
    webhookUrl: input.endpoint?.automation_id === automationID ? input.endpoint.url : '',
    secretConfigured: Boolean(input.endpoint?.automation_id === automationID && input.endpoint.secret_configured),
    secretValueAvailable: Boolean(input.endpoint?.automation_id === automationID && input.endpoint.secret_value_once),
    banner: errorMessage
      ? {
          tone: 'error',
          title: '最近一次自动化失败',
          message: `${errorCode} · ${errorMessage}`,
        }
      : latestRun
        ? {
            tone: 'status',
            title: '最近一次运行',
            message: lastRunStatus,
          }
        : undefined,
  };
}

export function getAutomationTelegramNotificationDraft(
  automation: AutomationDefinition | undefined,
  allowedUserIDs: string,
): AutomationTelegramNotificationDraft {
  const policy = asRecord(automation?.notification_policy);
  const telegram = asRecord(policy.telegram);
  const channel = String(telegram.channel || policy.channel || policy.provider || '').trim().toLowerCase();
  const channels = Array.isArray(policy.channels) ? policy.channels.map((item) => String(item).trim().toLowerCase()) : [];
  const requested = policy.telegram === true || Object.keys(telegram).length > 0 || channel === 'telegram' || channels.includes('telegram');
  const enabled = requested && policy.enabled !== false && telegram.enabled !== false && policy.on_success !== false && telegram.on_success !== false;
  const configuredTarget = String(telegram.chat_id || policy.telegram_chat_id || policy.chat_id || '').trim();
  return {
    enabled,
    chatID: configuredTarget || firstAllowedTelegramID(allowedUserIDs),
  };
}

export function buildAutomationTelegramNotificationPolicy(input: {
  enabled: boolean;
  chatID?: string;
  allowedUserIDs: string;
}): Record<string, unknown> {
  if (!input.enabled) return {};
  const chatID = input.chatID?.trim() || firstAllowedTelegramID(input.allowedUserIDs);
  return {
    channel: 'telegram',
    on_success: true,
    events: ['completed'],
    ...(chatID ? { chat_id: chatID } : {}),
  };
}

export function getAutomationTelegramReadiness(input: {
  telegramEnabled: boolean;
  tokenStatusKnown: boolean;
  tokenConfigured: boolean;
  allowedUserIDs: string;
}): AutomationTelegramReadiness {
  const allowedChatIDs = allowedTelegramIDs(input.allowedUserIDs);
  const defaultChatID = allowedChatIDs[0] || '';
  if (!input.telegramEnabled) {
    return { ready: false, defaultChatID, allowedChatIDs, message: '请先前往“聊天入口 → Telegram”启用入口。' };
  }
  if (!input.tokenStatusKnown) {
    return { ready: false, defaultChatID, allowedChatIDs, message: '正在读取 Telegram 凭证状态。' };
  }
  if (!input.tokenConfigured) {
    return { ready: false, defaultChatID, allowedChatIDs, message: '请先在“聊天入口 → Telegram”保存 Bot Token。' };
  }
  if (!defaultChatID) {
    return { ready: false, defaultChatID, allowedChatIDs, message: '请先在“聊天入口 → Telegram”填写允许用户 ID。' };
  }
  return {
    ready: true,
    defaultChatID,
    allowedChatIDs,
    message: `只会发送给 Telegram 白名单用户；默认 ${defaultChatID}。`,
  };
}

export function getAutomationTelegramTargetError(input: {
  enabled: boolean;
  chatID: string;
  allowedChatIDs: string[];
}): string {
  if (!input.enabled || !input.chatID.trim()) return '';
  return input.allowedChatIDs.includes(input.chatID.trim()) ? '' : '目标用户 / Chat ID 不在 Telegram 白名单中，无法保存或发送。';
}

function firstAllowedTelegramID(value: string): string {
  return allowedTelegramIDs(value)[0] || '';
}

function allowedTelegramIDs(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter((item) => /^[1-9]\d{3,19}$/.test(item)))];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
