import type { AutomationDefinition, AutomationExecutionKind, AvailableModel, SettingsRecord } from '../../api/desktop';

export type AutomationScheduleMode = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom';

export type AutomationScheduleDraft = {
  mode: AutomationScheduleMode;
  interval: number;
  time: string;
  weekdays: string[];
  customRrule: string;
  timezone: string;
};

export type AutomationSuggestion = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  schedule: AutomationScheduleDraft;
};

export type AutomationSetupModelRoute = {
  provider: string;
  model: string;
  baseURL: string;
  reasoningEffort?: string;
  hostToolRuntime: boolean;
};

const weekdayOrder = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export const automationSuggestions: AutomationSuggestion[] = [
  {
    id: 'daily-brief',
    name: '每日简报',
    description: '每个工作日汇总日程、未读消息和当天优先事项',
    prompt: '给我一份晨间简报，包含今天的日程、重要未读消息，以及任何需要我关注的事项。',
    schedule: scheduleDraft({ mode: 'weekdays', time: '08:00', weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'] }),
  },
  {
    id: 'weekly-review',
    name: '每周回顾',
    description: '每周五把近期工作整理成精简状态更新',
    prompt: '回顾我本周完成的工作，并起草一份简短的状态更新。',
    schedule: scheduleDraft({ mode: 'weekly', time: '16:00', weekdays: ['FR'] }),
  },
  {
    id: 'follow-up-monitor',
    name: '跟进监控',
    description: '检查近期活动并标出需要我关注的变化',
    prompt: '检查近期活动，突出重要变化，并标出任何需要我跟进的事项。',
    schedule: scheduleDraft({ mode: 'weekdays', time: '09:00', weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'] }),
  },
];

export function scheduleDraft(overrides: Partial<AutomationScheduleDraft> = {}): AutomationScheduleDraft {
  return {
    mode: overrides.mode || 'daily',
    interval: Math.max(1, overrides.interval || 1),
    time: overrides.time || '09:00',
    weekdays: overrides.weekdays?.length ? [...overrides.weekdays] : ['MO'],
    customRrule: overrides.customRrule || '',
    timezone: overrides.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
}

export function scheduleDraftFromAutomation(automation?: AutomationDefinition): AutomationScheduleDraft {
  if (!automation) return scheduleDraft();
  const timezone = String(automation.trigger_config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const rrule = automation.rrule || String(automation.trigger_config.rrule || '');
  if (rrule) return scheduleDraftFromRRule(rrule, timezone);
  const type = String(automation.trigger_config.type || 'interval');
  if (type === 'daily') return scheduleDraft({ mode: 'daily', time: String(automation.trigger_config.time || '09:00'), timezone });
  if (type === 'weekly') {
    const weekday = numberToWeekday(Number(automation.trigger_config.weekday ?? 1));
    return scheduleDraft({ mode: 'weekly', time: String(automation.trigger_config.time || '09:00'), weekdays: [weekday], timezone });
  }
  if (type === 'interval') {
    const minutes = Number(automation.trigger_config.every_minutes ?? Number(automation.trigger_config.every_seconds || 3600) / 60);
    if (minutes >= 60 && minutes % 60 === 0) return scheduleDraft({ mode: 'hourly', interval: Math.max(1, minutes / 60), timezone });
    return scheduleDraft({ mode: 'custom', customRrule: `FREQ=MINUTELY;INTERVAL=${Math.max(1, Math.round(minutes || 60))}`, timezone });
  }
  const expression = String(automation.trigger_config.expression || automation.trigger_config.cron || '').trim();
  return scheduleDraft({ mode: 'custom', customRrule: expression ? `CRON:${expression}` : '', timezone });
}

export function rruleFromScheduleDraft(draft: AutomationScheduleDraft): string {
  if (draft.mode === 'custom') return draft.customRrule.trim();
  const { hour, minute } = timeParts(draft.time);
  if (draft.mode === 'hourly') return `FREQ=HOURLY;INTERVAL=${Math.max(1, Math.floor(draft.interval))};BYMINUTE=${minute};BYSECOND=0`;
  if (draft.mode === 'daily') return `FREQ=DAILY;INTERVAL=1;BYHOUR=${hour};BYMINUTE=${minute};BYSECOND=0`;
  const weekdays = normalizedWeekdays(draft.mode === 'weekdays' ? ['MO', 'TU', 'WE', 'TH', 'FR'] : draft.weekdays);
  return `FREQ=WEEKLY;INTERVAL=1;BYDAY=${weekdays.join(',')};BYHOUR=${hour};BYMINUTE=${minute};BYSECOND=0`;
}

export function triggerConfigFromScheduleDraft(draft: AutomationScheduleDraft): Record<string, unknown> {
  const recurrence = rruleFromScheduleDraft(draft);
  if (recurrence.startsWith('CRON:')) {
    return { type: 'cron', expression: recurrence.slice(5), timezone: draft.timezone };
  }
  return { type: 'rrule', rrule: recurrence, timezone: draft.timezone };
}

export function summarizeAutomationSchedule(automation: AutomationDefinition): string {
  if (automation.kind === 'webhook' || automation.execution_kind === 'webhook') return '收到授权 Webhook 时';
  return summarizeScheduleDraft(scheduleDraftFromAutomation(automation));
}

export function summarizeScheduleDraft(draft: AutomationScheduleDraft): string {
  if (draft.mode === 'hourly') return draft.interval === 1 ? '每小时' : `每 ${draft.interval} 小时`;
  if (draft.mode === 'daily') return `每天 ${draft.time}`;
  if (draft.mode === 'weekdays') return `工作日 ${draft.time}`;
  if (draft.mode === 'weekly') return `每周${normalizedWeekdays(draft.weekdays).map(weekdayLabel).join('、')} ${draft.time}`;
  return summarizeCustomRule(draft.customRrule);
}

export function automationExecutionLabel(kind: AutomationExecutionKind): string {
  if (kind === 'heartbeat') return '继续现有任务';
  if (kind === 'webhook') return 'Webhook';
  return '新任务';
}

export function automationSetupModelRoute(
  settings: SettingsRecord | null,
  models: AvailableModel[],
): AutomationSetupModelRoute | null {
  if (!settings?.model_name) return null;
  if (!settings.model_provider.startsWith('acp_')) {
    return {
      provider: settings.model_provider,
      model: settings.model_name,
      baseURL: settings.model_base_url,
      reasoningEffort: settings.model_reasoning_effort,
      hostToolRuntime: true,
    };
  }
  const candidates = models
    .filter((model) => model.config?.enabled !== false)
    .filter((model) => model.provider === 'openai_compatible' || model.provider === 'xai_oauth')
    .filter((model) => Boolean(model.id.trim() && model.base_url?.trim()))
    .filter((model) => !model.metadata?.observed_from_request)
    .filter((model) => !/(?:image|video|embedding|moderation|audio|tts|whisper)/i.test(model.id))
    .sort((left, right) => automationSetupCandidateScore(right) - automationSetupCandidateScore(left)
      || left.id.localeCompare(right.id));
  const selected = candidates[0];
  if (!selected?.provider || !selected.base_url) {
    return {
      provider: settings.model_provider,
      model: settings.model_name,
      baseURL: settings.model_base_url,
      reasoningEffort: settings.model_reasoning_effort,
      hostToolRuntime: false,
    };
  }
  return {
    provider: selected.provider,
    model: selected.id,
    baseURL: selected.base_url,
    reasoningEffort: selected.provider === settings.model_provider ? settings.model_reasoning_effort : 'low',
    hostToolRuntime: true,
  };
}

export function automationSearchText(automation: AutomationDefinition): string {
  return [
    automation.name,
    automation.prompt_template,
    automation.cwds.join(' '),
    automation.target_thread_id,
    automation.model,
    summarizeAutomationSchedule(automation),
  ].filter(Boolean).join(' ').toLocaleLowerCase();
}

export function normalizedWeekdays(values: string[]): string[] {
  const unique = new Set(values.map((item) => item.trim().toUpperCase()).filter((item) => weekdayOrder.includes(item)));
  return weekdayOrder.filter((item) => unique.has(item));
}

export function weekdayLabel(value: string): string {
  return ({ MO: '一', TU: '二', WE: '三', TH: '四', FR: '五', SA: '六', SU: '日' } as Record<string, string>)[value] || value;
}

function scheduleDraftFromRRule(value: string, timezone: string): AutomationScheduleDraft {
  const parsed = parseRRule(value);
  const frequency = parsed.FREQ?.toUpperCase();
  const time = `${String(Number(parsed.BYHOUR || 9)).padStart(2, '0')}:${String(Number(parsed.BYMINUTE || 0)).padStart(2, '0')}`;
  const weekdays = normalizedWeekdays(String(parsed.BYDAY || '').split(','));
  if (frequency === 'HOURLY') return scheduleDraft({ mode: 'hourly', interval: Number(parsed.INTERVAL || 1), time, timezone });
  if (frequency === 'DAILY') return scheduleDraft({ mode: 'daily', time, timezone });
  if (frequency === 'WEEKLY' && weekdays.join(',') === 'MO,TU,WE,TH,FR') return scheduleDraft({ mode: 'weekdays', time, weekdays, timezone });
  if (frequency === 'WEEKLY' && weekdays.length > 0) return scheduleDraft({ mode: 'weekly', time, weekdays, timezone });
  return scheduleDraft({ mode: 'custom', customRrule: value, timezone });
}

function parseRRule(value: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const body = line.trim().replace(/^RRULE:/i, '');
    if (/^DTSTART/i.test(body)) continue;
    for (const part of body.split(';')) {
      const index = part.indexOf('=');
      if (index > 0) output[part.slice(0, index).toUpperCase()] = part.slice(index + 1);
    }
  }
  return output;
}

function summarizeCustomRule(value: string): string {
  const rule = value.trim();
  if (!rule) return '自定义时间';
  if (rule.startsWith('CRON:')) return `Cron · ${rule.slice(5)}`;
  const parsed = parseRRule(rule);
  if (parsed.FREQ === 'MINUTELY') return `每 ${Number(parsed.INTERVAL || 1)} 分钟`;
  if (parsed.FREQ === 'HOURLY') return `每 ${Number(parsed.INTERVAL || 1)} 小时`;
  return '自定义时间';
}

function timeParts(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const hour = Math.max(0, Math.min(23, Number(match?.[1] || 9)));
  const minute = Math.max(0, Math.min(59, Number(match?.[2] || 0)));
  return { hour, minute };
}

function numberToWeekday(value: number): string {
  return ({ 0: 'SU', 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA' } as Record<number, string>)[value] || 'MO';
}

function automationSetupCandidateScore(model: AvailableModel): number {
  let score = model.provider === 'openai_compatible' ? 200 : 100;
  if (model.supports_tool_calling || model.config?.supports_tool_calling) score += 40;
  if (model.metadata?.source === 'desktop_runtime_config') score += 20;
  if (/flash|mini|fast/i.test(model.id)) score += 5;
  return score;
}
