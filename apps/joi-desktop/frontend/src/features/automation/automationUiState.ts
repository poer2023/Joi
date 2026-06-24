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

export function getAutomationSettingsObjects(automations: AutomationDefinition[]): AutomationSettingsObject[] {
  return [
    { id: 'new-schedule', label: '新建定时任务', description: '按 cron、interval、daily 或 weekly 触发' },
    { id: 'new-webhook', label: '新建 Hook 任务', description: '通过本地 HMAC Webhook 触发' },
    ...automations.map((automation) => ({
      id: automation.id,
      label: automation.name,
      description: `${automation.kind === 'webhook' ? 'Webhook' : '定时'} · ${automation.enabled ? '已启用' : '已停用'}`,
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
