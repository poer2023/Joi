import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  desktopApi,
  type AutomationDefinition,
  type AutomationExecutionKind,
  type AutomationRunRecord,
  type AutomationTriggerRecord,
  type AvailableModel,
  type ConversationSummary,
  type SecretStatus,
  type SettingsRecord,
  type WorkspaceSettings,
} from '../../api/desktop';
import {
  automationExecutionLabel,
  automationSearchText,
  automationSuggestions,
  normalizedWeekdays,
  rruleFromScheduleDraft,
  scheduleDraft,
  scheduleDraftFromAutomation,
  summarizeAutomationSchedule,
  summarizeScheduleDraft,
  triggerConfigFromScheduleDraft,
  weekdayLabel,
  type AutomationScheduleDraft,
} from './automationParity';
import {
  buildAutomationTelegramNotificationPolicy,
  getAutomationTelegramNotificationDraft,
  getAutomationTelegramReadiness,
  getAutomationTelegramTargetError,
} from './automationUiState';

type AutomationEditorDraft = {
  id?: string;
  slug?: string;
  name: string;
  prompt: string;
  kind: 'schedule' | 'webhook';
  executionKind: AutomationExecutionKind;
  status: 'ACTIVE' | 'PAUSED';
  schedule: AutomationScheduleDraft;
  model: string;
  modelProvider: string;
  modelBaseURL: string;
  reasoningEffort: string;
  permissionProfile: 'read_only' | 'workspace_write' | 'danger_full_access';
  cwd: string;
  targetThreadID: string;
  dedupField: string;
  telegramNotify: boolean;
  telegramTarget: string;
  isDraft: boolean;
  metadata: Record<string, unknown>;
};

type PendingConfirmation = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  action: () => void | Promise<void>;
};

type Props = {
  activeObjectID: string;
  automations: AutomationDefinition[];
  runs: AutomationRunRecord[];
  triggers: AutomationTriggerRecord[];
  conversations: ConversationSummary[];
  savedModels: AvailableModel[];
  settings: SettingsRecord | null;
  secretStatus: SecretStatus | null;
  workspaceSettings: WorkspaceSettings | null;
  selectAutomation: (id: string) => void;
  refreshAll: () => Promise<void>;
  setNotice: (value: string) => void;
  openConversation: (id: string) => Promise<void>;
  createWithJoi: (request: string) => Promise<void>;
};

export function CodexAutomationConsole({
  activeObjectID,
  automations,
  runs,
  triggers,
  conversations,
  savedModels,
  settings,
  secretStatus,
  workspaceSettings,
  selectAutomation,
  refreshAll,
  setNotice,
  openConversation,
  createWithJoi,
}: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all');
  const [draft, setDraft] = useState<AutomationEditorDraft | null>(null);
  const [initialDraft, setInitialDraft] = useState('');
  const [busy, setBusy] = useState('');
  const [saveError, setSaveError] = useState('');
  const [showJoiCreate, setShowJoiCreate] = useState(false);
  const [joiRequest, setJoiRequest] = useState('');
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [endpoint, setEndpoint] = useState<{ automation_id: string; url: string; secret_configured: boolean; secret_value_once?: string } | null>(null);
  const selectedIDRef = useRef('');

  const selectedAutomation = automations.find((item) => item.id === activeObjectID);
  const selectedRuns = useMemo(
    () => draft?.id ? runs.filter((item) => item.automation_id === draft.id) : [],
    [draft?.id, runs],
  );
  const runningAutomationIDs = useMemo(
    () => new Set(runs.filter((item) => item.status === 'running').map((item) => item.automation_id)),
    [runs],
  );
  const unreadAutomationIDs = useMemo(
    () => new Set(runs.filter((item) => !item.read_at).map((item) => item.automation_id)),
    [runs],
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [...automations]
      .filter((item) => statusFilter === 'all' || (statusFilter === 'active' ? item.enabled : !item.enabled))
      .filter((item) => !query || automationSearchText(item).includes(query))
      .sort((left, right) => {
        const leftTime = left.next_fire_at ? Date.parse(left.next_fire_at) : Number.MAX_SAFE_INTEGER;
        const rightTime = right.next_fire_at ? Date.parse(right.next_fire_at) : Number.MAX_SAFE_INTEGER;
        return leftTime === rightTime ? left.name.localeCompare(right.name) : leftTime - rightTime;
      });
  }, [automations, search, statusFilter]);
  const modelOptions = useMemo(() => automationModelOptions(savedModels, settings), [savedModels, settings]);

  const telegramReadiness = getAutomationTelegramReadiness({
    telegramEnabled: Boolean(settings?.telegram_enabled),
    tokenStatusKnown: Boolean(secretStatus),
    tokenConfigured: Boolean(secretStatus?.secrets?.TELEGRAM_BOT_TOKEN),
    allowedUserIDs: settings?.telegram_allowed_user_ids || '',
  });
  const telegramTargetError = draft ? getAutomationTelegramTargetError({
    enabled: draft.telegramNotify,
    chatID: draft.telegramTarget,
    allowedChatIDs: telegramReadiness.allowedChatIDs,
  }) : '';
  const dirty = Boolean(draft && JSON.stringify(draft) !== initialDraft);
  const selectedModelKey = draft?.model
    ? automationModelRouteKey({ id: draft.model, provider: draft.modelProvider, base_url: draft.modelBaseURL })
    : '';

  useEffect(() => {
    if (selectedAutomation && selectedIDRef.current !== selectedAutomation.id) {
      selectedIDRef.current = selectedAutomation.id;
      installDraft(editorDraftFromAutomation(selectedAutomation));
      setEndpoint(null);
    }
  }, [activeObjectID, selectedAutomation]);

  function installDraft(next: AutomationEditorDraft | null) {
    setDraft(next);
    setInitialDraft(next ? JSON.stringify(next) : '');
    setSaveError('');
  }

  function requestSelection(id: string) {
    const action = () => {
      selectedIDRef.current = '';
      selectAutomation(id);
    };
    if (dirty) {
      requestDiscardConfirmation(action);
      return;
    }
    action();
  }

  function createManual(kind: AutomationExecutionKind = 'cron') {
    const action = () => {
      const next = newAutomationDraft(kind);
      selectedIDRef.current = kind === 'webhook' ? 'new-webhook' : 'new-schedule';
      installDraft(next);
      selectAutomation(kind === 'webhook' ? 'new-webhook' : 'new-schedule');
    };
    if (dirty) {
      requestDiscardConfirmation(action);
      return;
    }
    action();
  }

  function createSuggestion(index: number) {
    const action = () => {
      const suggestion = automationSuggestions[index];
      const next = newAutomationDraft('cron');
      next.name = suggestion.name;
      next.prompt = suggestion.prompt;
      next.schedule = { ...suggestion.schedule, weekdays: [...suggestion.schedule.weekdays] };
      selectedIDRef.current = 'new-schedule';
      installDraft(next);
      selectAutomation('new-schedule');
    };
    if (dirty) {
      requestDiscardConfirmation(action);
      return;
    }
    action();
  }

  function requestDiscardConfirmation(action: () => void | Promise<void>) {
    setPendingConfirmation({
      title: '放弃未保存的更改？',
      message: '对这个已安排任务所做的更改将丢失。',
      confirmLabel: '放弃更改',
      danger: true,
      action,
    });
  }

  async function resolveConfirmation() {
    const confirmation = pendingConfirmation;
    if (!confirmation) return;
    setPendingConfirmation(null);
    await confirmation.action();
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim() || !draft.prompt.trim()) {
      setSaveError('名称和任务说明不能为空。');
      return;
    }
    if (draft.executionKind === 'heartbeat' && !draft.targetThreadID) {
      setSaveError('继续现有任务必须选择目标任务。');
      return;
    }
    if (draft.kind === 'schedule' && draft.executionKind === 'cron' && !draft.model.trim()) {
      setSaveError('新任务自动化必须选择模型。');
      return;
    }
    if (telegramTargetError) {
      setSaveError(telegramTargetError);
      return;
    }
    setBusy('save');
    setSaveError('');
    try {
      const recurrence = draft.kind === 'schedule' ? rruleFromScheduleDraft(draft.schedule) : '';
      const isLegacyCron = recurrence.startsWith('CRON:');
      const saved = await desktopApi.saveAutomation({
        id: draft.id,
        kind: draft.kind,
        execution_kind: draft.executionKind,
        name: draft.name.trim(),
        slug: draft.slug,
        enabled: draft.status === 'ACTIVE',
        trigger_config: draft.kind === 'webhook'
          ? draft.dedupField.trim() ? { dedup_json_field: draft.dedupField.trim() } : {}
          : triggerConfigFromScheduleDraft(draft.schedule),
        prompt_template: draft.prompt,
        input_mode: 'background_task',
        permission_profile: draft.permissionProfile,
        preferred_node: 'main-node',
        allow_worker: false,
        conversation_id: draft.executionKind === 'heartbeat' ? draft.targetThreadID : undefined,
        target_thread_id: draft.executionKind === 'heartbeat' ? draft.targetThreadID : undefined,
        target: draft.executionKind === 'heartbeat'
          ? { type: 'thread', thread_id: draft.targetThreadID }
          : draft.cwd ? { type: 'workspace', cwd: draft.cwd } : { type: 'projectless' },
        cwds: draft.cwd ? [draft.cwd] : [],
        rrule: draft.kind === 'schedule' && !isLegacyCron ? recurrence : undefined,
        model: draft.model,
        model_provider: draft.modelProvider,
        model_base_url: draft.modelBaseURL,
        reasoning_effort: draft.reasoningEffort,
        execution_environment: 'local',
        dedup_policy: draft.kind === 'webhook' && draft.dedupField.trim() ? { dedup_json_field: draft.dedupField.trim() } : {},
        retry_policy: { max_attempts: 2, backoff_seconds: [60, 300], no_retry_error_codes: ['POLICY_DENIED', 'INVALID_PAYLOAD', 'PENDING_CONFIRMATION'] },
        max_concurrency: 1,
        notification_policy: buildAutomationTelegramNotificationPolicy({
          enabled: draft.telegramNotify,
          chatID: draft.telegramTarget,
          allowedUserIDs: settings?.telegram_allowed_user_ids || '',
        }),
        is_draft: false,
        metadata: { ...draft.metadata, reviewed_at: new Date().toISOString(), is_draft: false },
      });
      setNotice(`${saved.name} 已保存`);
      await refreshAll();
      selectedIDRef.current = '';
      selectAutomation(saved.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function toggleStatus(automation: AutomationDefinition, enabled = !automation.enabled) {
    setBusy(`status:${automation.id}`);
    try {
      await desktopApi.setAutomationEnabled({ id: automation.id, enabled });
      setNotice(enabled ? '已恢复已安排任务' : '已暂停已安排任务');
      await refreshAll();
    } finally {
      setBusy('');
    }
  }

  async function runNow(automation: AutomationDefinition) {
    setBusy(`run:${automation.id}`);
    try {
      await desktopApi.triggerAutomationNow({ id: automation.id, payload: { manual: true, requested_from: 'scheduled_tasks' } });
      setNotice('已安排任务已启动');
      await refreshAll();
    } finally {
      setBusy('');
    }
  }

  function remove(automation: AutomationDefinition) {
    setPendingConfirmation({
      title: `删除“${automation.name}”？`,
      message: '这会停止所有未来运行。已有运行历史仍会保留。',
      confirmLabel: '删除任务',
      danger: true,
      action: () => deleteAutomation(automation),
    });
  }

  async function deleteAutomation(automation: AutomationDefinition) {
    setBusy(`delete:${automation.id}`);
    try {
      await desktopApi.deleteAutomation(automation.id);
      setNotice('已安排任务已删除');
      installDraft(null);
      selectedIDRef.current = '';
      selectAutomation('new-schedule');
      await refreshAll();
    } finally {
      setBusy('');
    }
  }

  async function markRunRead(run: AutomationRunRecord, read: boolean) {
    await desktopApi.setAutomationRunRead({ id: run.id, read });
    await refreshAll();
  }

  async function openRun(run: AutomationRunRecord) {
    if (!run.read_at) await desktopApi.setAutomationRunRead({ id: run.id, read: true });
    if (run.conversation_id) await openConversation(run.conversation_id);
    else setNotice('这次运行没有可打开的任务会话');
    await refreshAll();
  }

  async function archiveRun(run: AutomationRunRecord, archived: boolean) {
    await desktopApi.setAutomationRunArchived({ id: run.id, archived });
    setNotice(archived ? '运行已归档' : '运行已恢复');
    await refreshAll();
  }

  async function markAllRead(automationID?: string) {
    const result = await desktopApi.markAllAutomationRunsRead(automationID ? { automation_id: automationID } : {});
    setNotice(`已将 ${result.updated} 次运行标为已读`);
    await refreshAll();
  }

  async function archiveAll(automationID: string) {
    setBusy('archive-all');
    try {
      const result = await desktopApi.archiveAllAutomationRuns({ automation_id: automationID });
      setNotice(result.failed_count
        ? `已归档 ${result.succeeded_count} 次运行；${result.failed_count} 次失败`
        : `已归档 ${result.succeeded_count} 次运行`);
      await refreshAll();
    } finally {
      setBusy('');
    }
  }

  async function loadWebhookEndpoint() {
    if (!draft?.id) return;
    const value = await desktopApi.getAutomationWebhookEndpoint(draft.id);
    setEndpoint(value);
  }

  async function rotateWebhookSecret() {
    if (!draft?.id) return;
    const value = await desktopApi.rotateAutomationWebhookSecret(draft.id);
    setEndpoint(value);
    if (value.secret_value_once) await navigator.clipboard?.writeText(value.secret_value_once);
    setNotice(value.secret_value_once ? '新 Webhook 密钥已复制，只显示一次' : 'Webhook 密钥已轮换');
  }

  async function submitJoiCreate(event: FormEvent) {
    event.preventDefault();
    const request = joiRequest.trim();
    if (!request) return;
    setBusy('joi-create');
    try {
      await createWithJoi(request);
      setShowJoiCreate(false);
      setJoiRequest('');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  return (
    <section className={`automation-console ${draft ? 'has-detail' : ''}`}>
      <div className="automation-list-pane">
        <header className="automation-page-header">
          <div>
            <h1>已安排</h1>
            <p>让 Joi 定时执行任务、设置提醒或持续监控</p>
          </div>
          <div className="automation-create-group">
            <button type="button" onClick={() => setShowJoiCreate(true)}>创建</button>
            <details className="automation-create-menu">
              <summary aria-label="创建已安排任务选项">⌄</summary>
              <div role="menu">
                <button type="button" role="menuitem" onClick={() => setShowJoiCreate(true)}>使用 Joi 创建</button>
                <button type="button" role="menuitem" onClick={() => createManual('cron')}>手动设置</button>
                <button type="button" role="menuitem" onClick={() => createManual('webhook')}>Webhook 任务</button>
              </div>
            </details>
          </div>
        </header>

        <div className="automation-toolbar">
          <input aria-label="搜索已安排任务" placeholder="搜索已安排任务" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select aria-label="已安排任务状态" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="all">全部</option>
            <option value="active">已启用</option>
            <option value="paused">已暂停</option>
          </select>
          {unreadAutomationIDs.size > 0 && <button className="automation-quiet-button" type="button" onClick={() => void markAllRead()}>全部标为已读</button>}
        </div>

        <div className="automation-list" role="list">
          {filtered.map((automation) => {
            const running = runningAutomationIDs.has(automation.id);
            const unread = unreadAutomationIDs.has(automation.id);
            return (
              <article key={automation.id} className={`automation-row ${activeObjectID === automation.id ? 'selected' : ''} ${automation.enabled ? '' : 'paused'}`} role="listitem">
                <button
                  className={`automation-status-button ${running ? 'running' : automation.enabled ? 'active' : 'paused'}`}
                  type="button"
                  aria-label={running ? '运行中' : automation.enabled ? '暂停' : '恢复'}
                  disabled={running || busy === `status:${automation.id}`}
                  onClick={() => void toggleStatus(automation)}
                >{running ? '◌' : automation.enabled ? '●' : 'Ⅱ'}</button>
                <button className="automation-row-main" type="button" onClick={() => requestSelection(automation.id)}>
                  <span className="automation-row-title">
                    <strong>{automation.name}</strong>
                    {automation.is_draft && <em>待审核</em>}
                    {unread && <i aria-label="有未读运行" />}
                  </span>
                  <span>{automationExecutionLabel(automation.execution_kind)} · {summarizeAutomationSchedule(automation)}</span>
                  <small>{running ? '正在运行' : automation.enabled && automation.next_fire_at ? `下次运行 ${relativeTime(automation.next_fire_at)}` : automation.enabled ? '等待计算下次运行' : '已暂停'}</small>
                </button>
                <div className="automation-row-actions">
                  <button type="button" disabled={busy === `run:${automation.id}`} onClick={() => void runNow(automation)}>立即运行</button>
                  <button className="danger" type="button" onClick={() => void remove(automation)}>删除</button>
                </div>
              </article>
            );
          })}
          {filtered.length === 0 && (
            <div className="automation-empty-state">
              <strong>{automations.length ? '没有匹配的已安排任务' : '还没有已安排任务'}</strong>
              <p>{automations.length ? '调整搜索或状态筛选。' : '从建议开始，或让 Joi 根据你的目标创建。'}</p>
            </div>
          )}
        </div>

        {(automations.length === 0 || filtered.length === 0) && !search && statusFilter === 'all' && (
          <section className="automation-suggestions">
            <h2>建议</h2>
            {automationSuggestions.map((suggestion, index) => (
              <button key={suggestion.id} type="button" onClick={() => createSuggestion(index)}>
                <span>＋</span>
                <strong>{suggestion.name}</strong>
                <small>{suggestion.description}</small>
                <em>{summarizeScheduleDraft(suggestion.schedule)}</em>
              </button>
            ))}
          </section>
        )}
      </div>

      {draft && (
        <aside className="automation-detail-pane" aria-label="已安排任务详情">
          <header className="automation-detail-header">
            <span className={`automation-state-label ${draft.status === 'ACTIVE' ? 'active' : 'paused'}`}>{draft.status === 'ACTIVE' ? '已启用' : '已暂停'}</span>
            <div>
              {draft.id && <button type="button" disabled={busy === `run:${draft.id}`} onClick={() => selectedAutomation && void runNow(selectedAutomation)}>立即运行</button>}
              {saveError && <button type="button" disabled={busy === 'save'} onClick={() => void save()}>重试保存</button>}
              <button type="button" aria-label="收起详情" onClick={() => {
                if (dirty) requestDiscardConfirmation(() => installDraft(null));
                else installDraft(null);
              }}>×</button>
            </div>
          </header>

          <div className="automation-detail-scroll">
            <section className="automation-editor">
              <input className="automation-name-input" aria-label="任务名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoFocus={!draft.id} />
              {draft.isDraft && <p className="automation-review-banner">这是 Joi 生成的暂停草稿。检查内容后选择状态并保存，才会开始运行。</p>}

              <label>
                <span>任务说明</span>
                <textarea rows={6} value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} />
              </label>

              {draft.kind === 'schedule' ? (
                <>
                  <fieldset>
                    <legend>执行方式</legend>
                    <label><input type="radio" checked={draft.executionKind === 'cron'} onChange={() => setDraft({ ...draft, executionKind: 'cron' })} />新任务</label>
                    <label><input type="radio" checked={draft.executionKind === 'heartbeat'} onChange={() => setDraft({ ...draft, executionKind: 'heartbeat' })} />继续现有任务</label>
                  </fieldset>

                  <label>
                    <span>时间安排</span>
                    <select value={draft.schedule.mode} onChange={(event) => setDraft({ ...draft, schedule: { ...draft.schedule, mode: event.target.value as AutomationScheduleDraft['mode'] } })}>
                      <option value="hourly">每隔几小时</option>
                      <option value="daily">每天</option>
                      <option value="weekdays">工作日</option>
                      <option value="weekly">每周</option>
                      <option value="custom">自定义 RRULE / Cron</option>
                    </select>
                  </label>
                  {draft.schedule.mode === 'hourly' && <label><span>小时间隔</span><input type="number" min="1" max="168" value={draft.schedule.interval} onChange={(event) => setDraft({ ...draft, schedule: { ...draft.schedule, interval: Math.max(1, Number(event.target.value) || 1) } })} /></label>}
                  {['daily', 'weekdays', 'weekly'].includes(draft.schedule.mode) && <label><span>运行时间</span><input type="time" value={draft.schedule.time} onChange={(event) => setDraft({ ...draft, schedule: { ...draft.schedule, time: event.target.value } })} /></label>}
                  {draft.schedule.mode === 'weekly' && (
                    <fieldset className="automation-weekdays">
                      <legend>星期</legend>
                      {['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map((day) => (
                        <label key={day}><input type="checkbox" checked={draft.schedule.weekdays.includes(day)} onChange={(event) => setDraft({ ...draft, schedule: { ...draft.schedule, weekdays: normalizedWeekdays(event.target.checked ? [...draft.schedule.weekdays, day] : draft.schedule.weekdays.filter((item) => item !== day)) } })} />{weekdayLabel(day)}</label>
                      ))}
                    </fieldset>
                  )}
                  {draft.schedule.mode === 'custom' && <label><span>规则</span><textarea rows={3} placeholder="FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0" value={draft.schedule.customRrule} onChange={(event) => setDraft({ ...draft, schedule: { ...draft.schedule, customRrule: event.target.value } })} /></label>}
                  <label><span>时区</span><input value={draft.schedule.timezone} onChange={(event) => setDraft({ ...draft, schedule: { ...draft.schedule, timezone: event.target.value } })} /></label>

                  {draft.executionKind === 'heartbeat' ? (
                    <label>
                      <span>目标任务</span>
                      <select value={draft.targetThreadID} onChange={(event) => setDraft({ ...draft, targetThreadID: event.target.value })}>
                        <option value="">选择现有任务</option>
                        {conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title || conversation.topic || '未命名任务'}</option>)}
                      </select>
                    </label>
                  ) : (
                    <label><span>工作目录</span><input placeholder="无项目" value={draft.cwd} onChange={(event) => setDraft({ ...draft, cwd: event.target.value })} /></label>
                  )}

                  {draft.executionKind === 'cron' && (
                    <label>
                      <span>模型</span>
                      <select value={selectedModelKey} onChange={(event) => {
                        const selected = modelOptions.find((model) => automationModelRouteKey(model) === event.target.value);
                        setDraft({
                          ...draft,
                          model: selected?.id || '',
                          modelProvider: selected?.provider || '',
                          modelBaseURL: selected?.base_url || '',
                        });
                      }}>
                        <option value="">选择模型</option>
                        {modelOptions.map((model) => <option key={automationModelRouteKey(model)} value={automationModelRouteKey(model)}>{automationModelOptionLabel(model, modelOptions)}</option>)}
                        {draft.model && !modelOptions.some((model) => automationModelRouteKey(model) === selectedModelKey) && <option value={selectedModelKey}>{draft.model}</option>}
                      </select>
                    </label>
                  )}
                  <label><span>推理强度</span><select value={draft.reasoningEffort} onChange={(event) => setDraft({ ...draft, reasoningEffort: event.target.value })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
                  <label><span>权限</span><select value={draft.permissionProfile} onChange={(event) => setDraft({ ...draft, permissionProfile: event.target.value as AutomationEditorDraft['permissionProfile'] })}><option value="read_only">只读</option><option value="workspace_write">可写工作区</option><option value="danger_full_access">完整本机权限</option></select></label>
                </>
              ) : (
                <>
                  <label><span>去重字段</span><input value={draft.dedupField} onChange={(event) => setDraft({ ...draft, dedupField: event.target.value })} /></label>
                  {draft.id && (
                    <section className="automation-webhook-tools">
                      <div><button type="button" onClick={() => void loadWebhookEndpoint()}>显示地址</button><button type="button" onClick={() => void rotateWebhookSecret()}>轮换密钥</button></div>
                      {endpoint?.automation_id === draft.id && <code>{endpoint.url}</code>}
                    </section>
                  )}
                </>
              )}

              <fieldset>
                <legend>状态</legend>
                <label><input type="radio" checked={draft.status === 'ACTIVE'} onChange={() => setDraft({ ...draft, status: 'ACTIVE' })} />启用</label>
                <label><input type="radio" checked={draft.status === 'PAUSED'} onChange={() => setDraft({ ...draft, status: 'PAUSED' })} />暂停</label>
              </fieldset>

              <fieldset className="automation-notification-fieldset">
                <legend>完成后通知</legend>
                <label><input type="checkbox" checked={draft.telegramNotify} disabled={!telegramReadiness.ready} onChange={(event) => setDraft({ ...draft, telegramNotify: event.target.checked, telegramTarget: draft.telegramTarget || telegramReadiness.defaultChatID })} />推送到 Telegram</label>
                {draft.telegramNotify && <input aria-label="Telegram Chat ID" value={draft.telegramTarget} onChange={(event) => setDraft({ ...draft, telegramTarget: event.target.value })} />}
                <small>{telegramReadiness.message}</small>
              </fieldset>

              {saveError && <p className="automation-error" role="alert">{saveError}</p>}
              <footer className="automation-editor-footer">
                {draft.id && selectedAutomation && <button className="danger" type="button" onClick={() => void remove(selectedAutomation)}>删除</button>}
                <button type="button" disabled={!dirty || busy === 'save'} onClick={() => void save()}>{busy === 'save' ? '保存中' : draft.id ? '保存' : '创建已安排任务'}</button>
              </footer>
            </section>

            {draft.id && (
              <section className="automation-history">
                <header>
                  <h2>之前的运行</h2>
                  <div>
                    {selectedRuns.some((run) => !run.read_at) && <button type="button" onClick={() => void markAllRead(draft.id)}>全部已读</button>}
                    {selectedRuns.some((run) => !run.archived_at && run.status !== 'running') && <button type="button" disabled={busy === 'archive-all'} onClick={() => void archiveAll(draft.id!)}>全部归档</button>}
                  </div>
                </header>
                {selectedRuns.length === 0 ? <p className="automation-history-empty">还没有运行记录</p> : selectedRuns.map((run) => (
                  <article key={run.id} className={`automation-history-row ${run.archived_at ? 'archived' : ''}`}>
                    <span className={`automation-run-dot ${run.status} ${!run.read_at ? 'unread' : ''}`} />
                    <button type="button" disabled={!run.conversation_id || Boolean(run.archived_at)} onClick={() => void openRun(run)}>
                      <strong>{run.automation_name || draft.name || '未命名运行'}</strong>
                      <small>{run.source_cwd || run.output_summary || run.error_message || statusLabel(run.status)}</small>
                    </button>
                    <time>{formatRunTime(run.created_at)}</time>
                    <div>
                      <button type="button" onClick={() => void markRunRead(run, Boolean(run.read_at) ? false : true)}>{run.read_at ? '未读' : '已读'}</button>
                      {run.status !== 'running' && <button type="button" onClick={() => void archiveRun(run, !run.archived_at)}>{run.archived_at ? '恢复' : '归档'}</button>}
                    </div>
                  </article>
                ))}
              </section>
            )}
          </div>
        </aside>
      )}

      {showJoiCreate && (
        <div className="automation-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowJoiCreate(false)}>
          <form className="automation-joi-create-modal" onSubmit={(event) => void submitJoiCreate(event)}>
            <header><h2>使用 Joi 创建已安排任务</h2><button type="button" aria-label="关闭" onClick={() => setShowJoiCreate(false)}>×</button></header>
            <p>Joi 会先补问必要信息，再通过真实 automation_update 工具生成暂停草稿供你审核。</p>
            <textarea autoFocus rows={5} placeholder="例如：每个工作日上午 9 点检查项目进展，有阻塞时提醒我。" value={joiRequest} onChange={(event) => setJoiRequest(event.target.value)} />
            <footer><button type="button" onClick={() => setShowJoiCreate(false)}>取消</button><button type="submit" disabled={!joiRequest.trim() || busy === 'joi-create'}>{busy === 'joi-create' ? '正在与 Joi 对话' : '开始对话'}</button></footer>
          </form>
        </div>
      )}

      {pendingConfirmation && (
        <div className="automation-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPendingConfirmation(null)}>
          <section className="automation-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="automation-confirm-title">
            <h2 id="automation-confirm-title">{pendingConfirmation.title}</h2>
            <p>{pendingConfirmation.message}</p>
            <footer>
              <button type="button" onClick={() => setPendingConfirmation(null)}>取消</button>
              <button className={pendingConfirmation.danger ? 'danger' : ''} type="button" onClick={() => void resolveConfirmation()}>{pendingConfirmation.confirmLabel}</button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );

  function newAutomationDraft(kind: AutomationExecutionKind): AutomationEditorDraft {
    const notification = getAutomationTelegramNotificationDraft(undefined, settings?.telegram_allowed_user_ids || '');
    const defaultModel = modelOptions.find((model) => isCurrentModelRoute(model, settings)) || modelOptions[0];
    return {
      name: kind === 'webhook' ? 'Webhook 自动化' : '未命名已安排任务',
      prompt: kind === 'webhook' ? '请处理这个 Webhook 事件：{{payload}}' : '请处理这个已安排任务。',
      kind: kind === 'webhook' ? 'webhook' : 'schedule',
      executionKind: kind,
      status: 'ACTIVE',
      schedule: scheduleDraft(),
      model: defaultModel?.id || settings?.model_name || '',
      modelProvider: defaultModel?.provider || settings?.model_provider || '',
      modelBaseURL: defaultModel?.base_url || settings?.model_base_url || '',
      reasoningEffort: settings?.model_reasoning_effort || 'low',
      permissionProfile: 'read_only',
      cwd: workspaceSettings?.default_root || '',
      targetThreadID: '',
      dedupField: 'event_id',
      telegramNotify: notification.enabled,
      telegramTarget: notification.chatID,
      isDraft: false,
      metadata: {},
    };
  }

  function editorDraftFromAutomation(automation: AutomationDefinition): AutomationEditorDraft {
    const notification = getAutomationTelegramNotificationDraft(automation, settings?.telegram_allowed_user_ids || '');
    const selectedModel = resolveAutomationModelOption(automation, modelOptions, settings);
    return {
      id: automation.id,
      slug: automation.slug,
      name: automation.name,
      prompt: automation.prompt_template,
      kind: automation.kind,
      executionKind: automation.execution_kind,
      status: automation.enabled ? 'ACTIVE' : 'PAUSED',
      schedule: scheduleDraftFromAutomation(automation),
      model: automation.model || selectedModel?.id || settings?.model_name || '',
      modelProvider: automation.model_provider || selectedModel?.provider || settings?.model_provider || '',
      modelBaseURL: automation.model_base_url || selectedModel?.base_url || settings?.model_base_url || '',
      reasoningEffort: automation.reasoning_effort || settings?.model_reasoning_effort || 'low',
      permissionProfile: automation.permission_profile,
      cwd: automation.cwds[0] || workspaceSettings?.default_root || '',
      targetThreadID: automation.target_thread_id || automation.conversation_id || '',
      dedupField: String(automation.dedup_policy.dedup_json_field || automation.trigger_config.dedup_json_field || 'event_id'),
      telegramNotify: notification.enabled,
      telegramTarget: notification.chatID,
      isDraft: Boolean(automation.is_draft),
      metadata: { ...automation.metadata },
    };
  }
}

function automationModelOptions(models: AvailableModel[], settings: SettingsRecord | null): AvailableModel[] {
  const byRoute = new Map<string, AvailableModel>();
  for (const model of models) {
    if (!model.id.trim() || model.config?.enabled === false) continue;
    const isCurrent = model.id === settings?.model_name
      && (!settings.model_provider || model.provider === settings.model_provider)
      && (!settings.model_base_url || normalizeModelBaseURL(model.base_url || '') === normalizeModelBaseURL(settings.model_base_url));
    if (model.metadata?.observed_from_request && !isCurrent) continue;
    byRoute.set(automationModelRouteKey(model), model);
  }
  if (settings?.model_name) {
    const current: AvailableModel = {
      id: settings.model_name,
      display_name: settings.model_name,
      provider: settings.model_provider,
      base_url: settings.model_base_url,
    };
    const key = automationModelRouteKey(current);
    if (!byRoute.has(key)) byRoute.set(key, current);
  }
  return [...byRoute.values()].sort((left, right) => {
    const leftCurrent = isCurrentModelRoute(left, settings);
    const rightCurrent = isCurrentModelRoute(right, settings);
    if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
    return automationModelOptionLabel(left, [...byRoute.values()]).localeCompare(automationModelOptionLabel(right, [...byRoute.values()]));
  });
}

function resolveAutomationModelOption(
  automation: AutomationDefinition,
  options: AvailableModel[],
  settings: SettingsRecord | null,
): AvailableModel | undefined {
  const modelID = automation.model || settings?.model_name || '';
  const provider = automation.model_provider || '';
  const baseURL = automation.model_base_url || '';
  if (!modelID) return undefined;
  const candidates = options.filter((model) => model.id === modelID);
  if (provider || baseURL) {
    return candidates.find((model) => (!provider || model.provider === provider)
      && (!baseURL || normalizeModelBaseURL(model.base_url || '') === normalizeModelBaseURL(baseURL)));
  }
  const current = candidates.find((model) => isCurrentModelRoute(model, settings));
  if (modelID === settings?.model_name && current) return current;
  return [...candidates].sort((left, right) => automationModelScore(right) - automationModelScore(left))[0];
}

function automationModelScore(model: AvailableModel): number {
  let score = 0;
  if (model.metadata?.source === 'desktop_runtime_config') score += 120;
  if (model.metadata?.source === 'provider_model_list') score += 100;
  if (model.base_url?.trim()) score += 50;
  if (model.supports_tool_calling) score += 10;
  return score;
}

function automationModelRouteKey(model: Pick<AvailableModel, 'id' | 'provider' | 'base_url'>): string {
  return [model.provider || '', normalizeModelBaseURL(model.base_url || ''), model.id]
    .map((part) => encodeURIComponent(part))
    .join('|');
}

function automationModelOptionLabel(model: AvailableModel, options: AvailableModel[]): string {
  const name = model.display_name || model.id;
  const duplicated = options.filter((item) => item.id === model.id).length > 1;
  return duplicated && model.provider ? `${name} · ${model.provider}` : name;
}

function isCurrentModelRoute(model: AvailableModel, settings: SettingsRecord | null): boolean {
  return Boolean(settings?.model_name && model.id === settings.model_name
    && (!settings.model_provider || model.provider === settings.model_provider)
    && (!settings.model_base_url || normalizeModelBaseURL(model.base_url || '') === normalizeModelBaseURL(settings.model_base_url)));
}

function normalizeModelBaseURL(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function relativeTime(value: string): string {
  const delta = Date.parse(value) - Date.now();
  if (!Number.isFinite(delta)) return value;
  const minutes = Math.round(delta / 60_000);
  if (Math.abs(minutes) < 60) return minutes <= 1 ? '即将运行' : `${minutes} 分钟后`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${hours} 小时后`;
  return `${Math.round(hours / 24)} 天后`;
}

function formatRunTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function statusLabel(value: string): string {
  return ({ running: '运行中', succeeded: '已完成', failed: '失败', cancelled: '已取消', waiting_confirmation: '等待确认' } as Record<string, string>)[value] || value;
}
