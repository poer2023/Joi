import { Terminal } from '@xterm/xterm';
import { Component, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  ErrorInfo,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import {
  desktopApi,
  type ArtifactDetail,
  type ArtifactSummary,
  type AutomationDefinition,
  type AutomationRunRecord,
  type AutomationTriggerRecord,
  type AutomationWebhookEndpoint,
  type AvailableModel,
  type BackupRecord,
  type ChatResponse,
  type CapabilityRecord,
  type ConversationMessage,
  type ConversationSummary,
  type ConfirmationRecord,
  type ExternalHandoffAudit,
  type InputMode,
  type LogCleanupPreview,
  type LogCleanupRequest,
  type LogEntry,
  type MemoryRecord,
  type MemorySearchResult,
  type MCPServerRecord,
  type ModelCall,
  type NodeRecord,
  type OnboardingStatus,
  type OpenLoop,
  type PhotonIMessageStatus,
  type ProactiveMessage,
  type ProductTask,
  type ProductTaskDetail,
  type RunClosureReport,
  type RunTrace,
  type SecretStatus,
  type SettingsRecord,
  type SkillRecord,
  type SystemHealth,
  type TerminalSessionEvent,
  type TerminalSessionInfo,
  type ToolRunRecord,
  type ToolWorkflowRecord,
  type WorkerGatewayAuditRecord,
  type WorkspaceSettings,
} from './api/desktop';
import { eventsOn, windowSetMinSize } from './api/runtime';
import { permissionProfileForPrompt } from './permissionProfile';
import joiAvatar from './assets/joi-avatar-circle.png';
import { ScrollArea } from './components/ScrollArea';
import { buildConversationRenderItems, getMessageRunId, sortBySeq } from './features/chat/conversationProjector';
import { getAutomationDetailState, getAutomationSettingsObjects } from './features/automation/automationUiState';
import { MessageList } from './features/chat/components/MessageList';
import { TraceDrawer } from './features/chat/components/TraceDrawer';
import { normalizeRunEvent, normalizeRunEvents } from './features/chat/runEventNormalizer';
import { mergeAssistantTextChunk } from './features/chat/streamingText';
import type { NormalizedRunEvent } from './features/chat/types';
import { visibleRecentTasksForHandoff } from './productTasks';
import {
  createOptimisticExecutionActions,
  getExecutionDisplayMode,
  projectRunTraceToActions,
  summarizeExecutionActions,
  visibleExecutionActions,
  sourceLabelFromURL,
  type ExecutionAction,
  type ExecutionActionDetail,
  type ExecutionActionKind,
  type ExecutionActionStatus,
} from './executionActions';
import '@xterm/xterm/css/xterm.css';

type Tab = 'chat' | 'trace' | 'system' | 'memory' | 'nodes' | 'costs' | 'confirmations' | 'settings' | 'backups';
type SettingsTab = Exclude<Tab, 'chat'>;
type SettingsCategory = 'models' | 'chatEntrances' | 'automations' | 'observability' | 'dataMemory' | 'capabilities' | 'nodesExecution' | 'privacySecurity' | 'advanced';
type ExecutionTarget = 'main-node' | 'auto' | 'local-worker-1' | 'vps-la-1';
type RightInspectorTab = 'terminal' | 'memory' | 'logs';
type StreamingAssistantMessage = ConversationMessage & {
  role: 'assistant';
  complete?: boolean;
};
type ExecutionRunStatus = 'pending' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
type ExecutionEvent = {
  id?: string;
  type?: string;
  event_type?: string;
  event?: string;
  seq?: number;
  run_id?: string;
  runID?: string;
  item_id?: string;
  item_type?: string;
  action_id?: string;
  actionID?: string;
  confirmation_id?: string;
  approved?: boolean;
  kind?: string;
  title?: string;
  status?: string;
  summary?: string;
  source_label?: string;
  sourceLabel?: string;
  duration_ms?: number;
  durationMs?: number;
  text?: string;
  delta?: string | Record<string, unknown>;
  message?: string;
  message_id?: string;
  payload?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  details?: ExecutionActionDetail[];
};
type ModelSettingsDraft = {
  provider: string;
  base_url: string;
  model_id: string;
  display_name: string;
  role: string;
  enabled: boolean;
  temperature: string;
  max_output_tokens: string;
  timeout_seconds: string;
  max_retries: string;
  supports_json_mode: boolean;
  supports_tool_calling: boolean;
  supports_reasoning: boolean;
};

const settingsSections: Array<{ id: SettingsTab; label: string; description: string }> = [
  { id: 'settings', label: '常规设置', description: '模型、密钥、运行参数' },
  { id: 'system', label: '系统状态', description: 'SQLite、队列与桌面运行状态' },
  { id: 'nodes', label: '节点与执行', description: '本地节点、工作节点与远端资源' },
  { id: 'memory', label: '记忆管理', description: '长期记忆、检索与反馈' },
  { id: 'trace', label: '运行记录', description: '最近任务的路由、模型与执行链路' },
  { id: 'costs', label: '成本用量', description: '令牌、缓存与模型调用统计' },
  { id: 'confirmations', label: '确认队列', description: '高风险能力请求审批' },
  { id: 'backups', label: '备份恢复', description: '本地数据备份与恢复' },
];
const settingsCategories: Array<{ id: SettingsCategory; label: string; description: string }> = [
  { id: 'models', label: '模型', description: '模型与服务配置' },
  { id: 'chatEntrances', label: '聊天入口', description: '聊天平台与入口管理' },
  { id: 'automations', label: '自动化', description: '定时任务与 Webhook Hook' },
  { id: 'observability', label: '日志与用量', description: '日志、Token 与成本统计' },
  { id: 'dataMemory', label: '数据与记忆', description: '数据存储与记忆管理' },
  { id: 'capabilities', label: '能力与工具', description: '插件、工具与能力配置' },
  { id: 'nodesExecution', label: '节点与执行', description: '工作节点与执行资源' },
  { id: 'privacySecurity', label: '隐私与安全', description: '隐私设置与安全控制' },
  { id: 'advanced', label: '高级', description: '实验性与开发者选项' },
];
const defaultSettingsObjectByCategory: Record<SettingsCategory, string> = {
  models: 'deepseek',
  chatEntrances: 'telegram',
  automations: 'new-schedule',
  observability: 'logs',
  dataMemory: 'memory-inbox',
  capabilities: 'builtin',
  nodesExecution: 'main-node',
  privacySecurity: 'secrets',
  advanced: 'diagnostics',
};
const DEFAULT_SIDEBAR_WIDTH = 224;
const MIN_SIDEBAR_WIDTH = 192;
const MAX_SIDEBAR_WIDTH = 560;
const CHAT_MAIN_MIN_WIDTH = 560;
const COMPANION_MAIN_MIN_WIDTH = 420;
const DEFAULT_RIGHT_PANEL_WIDTH = 520;
const RIGHT_PANEL_MIN_WIDTH = 260;
const RIGHT_PANEL_MAX_WIDTH = 960;
const MIN_APP_WIDTH = CHAT_MAIN_MIN_WIDTH;
const MIN_APP_HEIGHT = 720;
const RIGHT_INSPECTOR_TERMINAL_ID = 'joi-right-inspector-terminal';
const TERMINAL_APPROX_CHAR_WIDTH = 7.2;
const TERMINAL_APPROX_ROW_HEIGHT = 17;
const logLevelOptions = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const logRiskOptions = ['read_only', 'write_candidate', 'browser_interaction', 'workspace_write', 'state_change', 'destructive', 'unsafe'];
const logCategoryOptions = ['ipc', 'runtime', 'terminal', 'external', 'worker_gateway', 'settings', 'system', 'run', 'tool', 'model'];
const defaultLogCleanupScopes: LogCleanupRequest['scopes'] = ['app_logs', 'run_events', 'run_steps', 'tool_runs', 'model_calls', 'worker_gateway_audit_logs', 'log_files'];
const executionTargetOptions: Array<{ value: ExecutionTarget; label: string; preferredNode: string; allowWorker: boolean }> = [
  { value: 'main-node', label: '本机', preferredNode: 'main-node', allowWorker: false },
  { value: 'auto', label: '自动', preferredNode: 'auto', allowWorker: true },
  { value: 'local-worker-1', label: '本机 Worker', preferredNode: 'local-worker-1', allowWorker: true },
  { value: 'vps-la-1', label: '远端 Worker', preferredNode: 'vps-la-1', allowWorker: true },
];
const inputModeOptions: Array<{ value: InputMode; label: string; title: string }> = [
  { value: 'auto', label: 'Auto', title: '自动判断聊天、工具、任务或后台执行' },
  { value: 'chat_assist', label: 'Chat', title: '普通问答，默认隐藏工具过程' },
  { value: 'serious_task', label: 'Task', title: '认真执行，多步骤过程可见' },
  { value: 'background_task', label: 'Bg', title: '后台执行，主聊天只保留任务入口' },
];

function mergeRunEvents(
  current: Record<string, NormalizedRunEvent[]>,
  runId: string,
  incoming: NormalizedRunEvent[],
): Record<string, NormalizedRunEvent[]> {
  if (!runId || incoming.length === 0) return current;
  const existing = current[runId] ?? [];
  const merged = [...existing];
  for (const event of incoming) {
    const duplicate = merged.some((item) => (
      item.id === event.id
      || (event.seq > 0 && item.seq === event.seq && item.type === event.type)
    ));
    if (!duplicate) merged.push(event);
  }
  return {
    ...current,
    [runId]: sortBySeq(merged),
  };
}

function pickRunEvents(
  eventsByRunId: Record<string, NormalizedRunEvent[]>,
  runIds: Iterable<string | undefined>,
): Record<string, NormalizedRunEvent[]> {
  const picked: Record<string, NormalizedRunEvent[]> = {};
  for (const runId of runIds) {
    if (!runId) continue;
    if (eventsByRunId[runId]) picked[runId] = eventsByRunId[runId];
  }
  return picked;
}

function latestActiveRunId(eventsByRunId: Record<string, NormalizedRunEvent[]>): string {
  let latest = '';
  let latestSeq = -1;
  for (const [runId, events] of Object.entries(eventsByRunId)) {
    if (!runId || events.length === 0) continue;
    const sorted = sortBySeq(events);
    const terminal = [...sorted].reverse().find((event) => (
      event.type === 'run.completed'
      || event.type === 'run.finalized'
      || event.type === 'run.failed'
      || event.type === 'run.interrupted'
      || event.type === 'turn.aborted'
    ));
    const lastRunning = [...sorted].reverse().find((event) => (
      event.type === 'run.started'
      || event.type === 'turn.started'
      || event.status === 'running'
      || event.status === 'waiting_approval'
    ));
    if (!lastRunning) continue;
    if (terminal && terminal.seq >= lastRunning.seq) continue;
    if (lastRunning.seq >= latestSeq) {
      latest = runId;
      latestSeq = lastRunning.seq;
    }
  }
  return latest;
}

function normalizeTraceEvents(trace: RunTrace | null): NormalizedRunEvent[] {
  return normalizeRunEvents(trace?.events ?? [])
    .filter((event) => Boolean(event.runId));
}

type RenderCrashBoundaryProps = {
  children: ReactNode;
  onRecover?: () => void;
  resetKey: string;
  surface: string;
};

type RenderCrashBoundaryState = {
  errorMessage: string;
};

class RenderCrashBoundary extends Component<RenderCrashBoundaryProps, RenderCrashBoundaryState> {
  state: RenderCrashBoundaryState = { errorMessage: '' };

  static getDerivedStateFromError(error: unknown): RenderCrashBoundaryState {
    return { errorMessage: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error('joi render surface failed', {
      surface: this.props.surface,
      error,
      componentStack: errorInfo.componentStack,
    });
  }

  componentDidUpdate(previousProps: RenderCrashBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.errorMessage) {
      this.setState({ errorMessage: '' });
    }
  }

  render() {
    if (!this.state.errorMessage) return this.props.children;
    return (
      <section className="render-crash-panel">
        <strong>聊天页渲染失败</strong>
        <p>{this.state.errorMessage}</p>
        {this.props.onRecover ? <button type="button" onClick={this.props.onRecover}>返回空对话</button> : null}
      </section>
    );
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [message, setMessage] = useState('');
  const [lastPrompt, setLastPrompt] = useState('');
  const [pendingUserMessage, setPendingUserMessage] = useState<ConversationMessage | null>(null);
  const [streamingAssistantMessage, setStreamingAssistantMessage] = useState<StreamingAssistantMessage | null>(null);
  const [activeExecutionActions, setActiveExecutionActions] = useState<ExecutionAction[]>([]);
  const [activeExecutionStatus, setActiveExecutionStatus] = useState<ExecutionRunStatus>('pending');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [executionTarget, setExecutionTarget] = useState<ExecutionTarget>('main-node');
  const [inputMode, setInputMode] = useState<InputMode>('auto');
  const [selectedModelName, setSelectedModelName] = useState('');
  const [chat, setChat] = useState<ChatResponse | null>(null);
  const [trace, setTrace] = useState<RunTrace | null>(null);
  const [runEventsByRunId, setRunEventsByRunId] = useState<Record<string, NormalizedRunEvent[]>>({});
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<ConversationSummary[]>([]);
  const [trashedConversations, setTrashedConversations] = useState<ConversationSummary[]>([]);
  const [currentConversationID, setCurrentConversationID] = useState('');
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityRecord[]>([]);
  const [workflows, setWorkflows] = useState<ToolWorkflowRecord[]>([]);
  const [mcpServers, setMCPServers] = useState<MCPServerRecord[]>([]);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [toolRuns, setToolRuns] = useState<ToolRunRecord[]>([]);
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [closureReport, setClosureReport] = useState<RunClosureReport | null>(null);
  const [externalHandoffAudit, setExternalHandoffAudit] = useState<ExternalHandoffAudit | null>(null);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [productTasks, setProductTasks] = useState<ProductTask[]>([]);
  const [activeProductTaskID, setActiveProductTaskID] = useState('');
  const [activeProductTaskDetail, setActiveProductTaskDetail] = useState<ProductTaskDetail | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [artifactViewer, setArtifactViewer] = useState<ArtifactDetail | null>(null);
  const [openLoops, setOpenLoops] = useState<OpenLoop[]>([]);
  const [proactiveMessages, setProactiveMessages] = useState<ProactiveMessage[]>([]);
  const [automations, setAutomations] = useState<AutomationDefinition[]>([]);
  const [automationTriggers, setAutomationTriggers] = useState<AutomationTriggerRecord[]>([]);
  const [automationRuns, setAutomationRuns] = useState<AutomationRunRecord[]>([]);
  const [memoryQuery, setMemoryQuery] = useState('');
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [gatewayAudit, setGatewayAudit] = useState<WorkerGatewayAuditRecord[]>([]);
  const [usage, setUsage] = useState<Record<string, unknown>[]>([]);
  const [savedModels, setSavedModels] = useState<AvailableModel[]>([]);
  const [confirmations, setConfirmations] = useState<ConfirmationRecord[]>([]);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [settings, setSettings] = useState<SettingsRecord | null>(null);
  const [secretStatus, setSecretStatus] = useState<SecretStatus | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('models');
  const [settingsObjectByCategory, setSettingsObjectByCategory] = useState<Record<SettingsCategory, string>>(defaultSettingsObjectByCategory);
  const [manualSidebarCollapsed, setManualSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [rightPanelWidth, setRightPanelWidth] = useState(DEFAULT_RIGHT_PANEL_WIDTH);
  const [windowWidth, setWindowWidth] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [noticeKey, setNoticeKey] = useState(0);
  const shellRef = useRef<HTMLElement | null>(null);
  const pendingAssistantIDRef = useRef('');
  const pendingConversationIDRef = useRef('');
  const receivedAssistantDeltaRef = useRef(false);
  const receivedAssistantDeltaRunIDRef = useRef('');
  const assistantCompletedRunIDsRef = useRef<Set<string>>(new Set());
  const runCompletedFallbackTimersRef = useRef<Record<string, number>>({});
  const loadConversationRequestRef = useRef(0);

  const stepCount = useMemo(() => trace?.steps?.length ?? 0, [trace]);
  const firstModelCall = trace?.model_calls?.[0] ?? chat?.model_calls?.[0];
  const inSettingsArea = activeTab !== 'chat' && activeTab !== 'trace';
  const autoSidebarCollapsed = !manualSidebarCollapsed && windowWidth < sidebarWidth + CHAT_MAIN_MIN_WIDTH;
  const sidebarCollapsed = manualSidebarCollapsed || autoSidebarCollapsed;
  const activeSidebarWidth = sidebarCollapsed ? 0 : sidebarWidth;
  const maxRightPanelWidth = Math.max(
    RIGHT_PANEL_MIN_WIDTH,
    Math.min(RIGHT_PANEL_MAX_WIDTH, windowWidth - activeSidebarWidth - COMPANION_MAIN_MIN_WIDTH),
  );
  const activeRightPanelWidth = Math.min(rightPanelWidth, maxRightPanelWidth);
  const autoRightPanelCollapsed = windowWidth < activeSidebarWidth + CHAT_MAIN_MIN_WIDTH + RIGHT_PANEL_MIN_WIDTH;
  const shellStyle = {
    '--sidebar-width': `${activeSidebarWidth}px`,
    '--chat-main-min-width': `${CHAT_MAIN_MIN_WIDTH}px`,
    '--companion-main-min-width': `${COMPANION_MAIN_MIN_WIDTH}px`,
    '--right-panel-min-width': `${RIGHT_PANEL_MIN_WIDTH}px`,
    '--right-panel-width': `${activeRightPanelWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    if (!settings?.model_name) return;
    const models = savedModelsForProvider(savedModels, settings.model_provider, settings.model_base_url);
    const nextModel = models.length > 0 && !models.some((model) => model.id === settings.model_name)
      ? preferredDefaultModel(models)
      : settings.model_name;
    setSelectedModelName(nextModel);
  }, [savedModels, settings?.model_base_url, settings?.model_name, settings?.model_provider]);

  useEffect(() => {
    try {
      windowSetMinSize(MIN_APP_WIDTH, MIN_APP_HEIGHT);
    } catch {
      // Browser preview mode does not expose native window controls.
    }

    void refreshAll();
  }, []);

  useEffect(() => () => {
    Object.values(runCompletedFallbackTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    runCompletedFallbackTimersRef.current = {};
  }, []);

  useEffect(() => {
    try {
      return eventsOn('joi:run:event', (event: ExecutionEvent) => {
        dispatchExecutionEvent(event);
      });
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    let animationFrame = 0;

    function measureWidth() {
      return Math.round(shellRef.current?.getBoundingClientRect().width || window.innerWidth);
    }

    function updateWindowWidth() {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        setWindowWidth(measureWidth());
      });
    }

    updateWindowWidth();
    window.addEventListener('resize', updateWindowWidth);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateWindowWidth);
    if (shellRef.current) {
      observer?.observe(shellRef.current);
    }

    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      window.removeEventListener('resize', updateWindowWidth);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!notice) return;

    const timer = window.setTimeout(() => {
      setNotice('');
    }, 4500);

    return () => window.clearTimeout(timer);
  }, [notice, noticeKey]);

  useEffect(() => {
    if (activeTab === 'memory') {
      selectSettingsObject('dataMemory', 'memory-search');
    } else if (activeTab === 'nodes') {
      selectSettingsObject('nodesExecution', 'main-node');
    } else if (activeTab === 'system') {
      selectSettingsObject('advanced', 'diagnostics');
    } else if (activeTab === 'costs') {
      selectSettingsObject('observability', 'token-usage');
    } else if (activeTab === 'confirmations') {
      selectSettingsObject('privacySecurity', 'dangerous-actions');
    } else if (activeTab === 'backups') {
      selectSettingsObject('dataMemory', 'data-maintenance');
    }
  }, [activeTab]);

  function selectSettingsObject(category: SettingsCategory, objectID?: string) {
    setSettingsCategory(category);
    setSettingsObjectByCategory((current) => ({
      ...current,
      [category]: objectID ?? current[category] ?? defaultSettingsObjectByCategory[category],
    }));
  }

  function showNotice(value: string) {
    setError('');
    setNotice(value);
    setNoticeKey((current) => current + 1);
  }

  function showError(value: string) {
    setNotice('');
    setError(value);
    setErrorKey((current) => current + 1);
  }

  function dispatchExecutionEvent(event: ExecutionEvent) {
    const normalized = normalizeRunEvent(event);
    if (normalized.runId) {
      setRunEventsByRunId((current) => mergeRunEvents(current, normalized.runId, [normalized]));
    }

    const eventType = normalized.type || event.type || event.event || '';
    if (!eventType) return;

    if (eventType === 'run.started') {
      setActiveExecutionStatus('running');
      receivedAssistantDeltaRef.current = false;
      receivedAssistantDeltaRunIDRef.current = '';
      if (normalized.runId) {
        assistantCompletedRunIDsRef.current.delete(normalized.runId);
        clearRunCompletedFallback(normalized.runId);
      }
      return;
    }

    if (eventType === 'action.started') {
      setActiveExecutionStatus('running');
      setActiveExecutionActions((current) => upsertExecutionAction(current, event, 'running'));
      return;
    }

    if (eventType === 'action.completed') {
      setActiveExecutionActions((current) => upsertExecutionAction(current, event, 'completed'));
      return;
    }

    if (eventType === 'action.failed') {
      setActiveExecutionActions((current) => upsertExecutionAction(current, event, 'failed'));
      return;
    }

    if (eventType === 'tool.started' || eventType === 'tool.call.started' || eventType === 'tool.call_requested') {
      setActiveExecutionStatus('running');
      setActiveExecutionActions((current) => upsertExecutionAction(current, toolEventToExecutionAction(event), 'running'));
      return;
    }

    if (eventType === 'tool.finished' || eventType === 'tool.completed') {
      const status = String(event.status || '').toLowerCase() === 'failed' ? 'failed' : 'completed';
      setActiveExecutionActions((current) => upsertExecutionAction(current, toolEventToExecutionAction(event), status));
      return;
    }

    if (eventType === 'tool.failed' || eventType === 'tool.policy_blocked') {
      setActiveExecutionActions((current) => upsertExecutionAction(current, toolEventToExecutionAction(event), 'failed'));
      return;
    }

    if (eventType === 'approval.requested') {
      setActiveExecutionStatus('waiting_approval');
      setActiveExecutionActions((current) => upsertExecutionAction(current, approvalEventToExecutionAction(event), 'waiting_approval'));
      void refreshAll();
      return;
    }

    if (eventType === 'approval.resolved' || eventType === 'approval.approved' || eventType === 'approval.denied') {
      const confirmationID = String(event.confirmation_id || event.action_id || '');
      const approved = eventType === 'approval.approved' || (event.approved !== false && String(event.status || '').toLowerCase() !== 'rejected');
      setActiveExecutionActions((current) => current.map((action) => (
        action.id === confirmationID || (action.kind === 'confirmation' && confirmationID === '')
          ? { ...action, status: approved ? 'completed' : 'failed', summary: approved ? '已批准' : '已拒绝' }
          : action
      )));
      if (!approved) {
        setActiveExecutionStatus('failed');
      }
      return;
    }

    if (eventType === 'run.waiting_approval' || eventType === 'run.waiting_confirmation') {
      setActiveExecutionStatus('waiting_approval');
      return;
    }

    if (eventType === 'turn.aborted' || eventType === 'run.cancelled' || eventType === 'run.redirected' || eventType === 'run.recovery_required') {
      setActiveExecutionStatus('failed');
      setActiveExecutionActions((current) => current.map((action) => (
        action.status === 'running' || action.status === 'queued'
          ? { ...action, status: 'failed', summary: '已中断', description: '执行已中断' }
          : action
      )));
      return;
    }

    if (eventType === 'assistant.delta') {
      const text = String(normalized.delta.text ?? event.text ?? event.delta ?? '');
      if (!text) return;
      const runID = normalized.runId || event.run_id || event.runID || '';
      const messageID = String(normalized.itemId || normalized.metadata.message_id || normalized.snapshot.assistant_message_id || event.message_id || pendingAssistantIDRef.current || `streaming-${runID || Date.now()}`);
      const conversationID = pendingConversationIDRef.current || currentConversationID || 'pending-conversation';
      receivedAssistantDeltaRef.current = true;
      receivedAssistantDeltaRunIDRef.current = runID;
      setStreamingAssistantMessage((current) => ({
        id: current?.id || messageID,
        conversation_id: current?.conversation_id || conversationID,
        role: 'assistant',
        content: mergeAssistantTextChunk(String(current?.content || ''), text),
        run_id: runID || current?.run_id,
        complete: false,
      }));
      return;
    }

    if (eventType === 'assistant.completed') {
      if (normalized.status === 'waiting_approval') return;
      if (normalized.runId) {
        assistantCompletedRunIDsRef.current.add(normalized.runId);
        clearRunCompletedFallback(normalized.runId);
      }
      markStreamingAssistantComplete(normalized.runId);
      return;
    }

    if (eventType === 'foreground_run.completed' || eventType === 'run.finalized') {
      setActiveExecutionStatus('completed');
      return;
    }

    if (eventType === 'run.completed') {
      scheduleRunCompletedFallback(normalized.runId);
      return;
    }

    if (eventType === 'run.failed') {
      setActiveExecutionStatus('failed');
    }
  }

  function markStreamingAssistantComplete(runId?: string) {
    setStreamingAssistantMessage((current) => {
      if (!current) return current;
      if (runId && current.run_id && current.run_id !== runId) return current;
      return { ...current, complete: true };
    });
  }

  function clearRunCompletedFallback(runId: string) {
    const timer = runCompletedFallbackTimersRef.current[runId];
    if (!timer) return;
    window.clearTimeout(timer);
    delete runCompletedFallbackTimersRef.current[runId];
  }

  function scheduleRunCompletedFallback(runId: string) {
    if (!runId || assistantCompletedRunIDsRef.current.has(runId)) return;
    clearRunCompletedFallback(runId);
    runCompletedFallbackTimersRef.current[runId] = window.setTimeout(() => {
      delete runCompletedFallbackTimersRef.current[runId];
      if (assistantCompletedRunIDsRef.current.has(runId)) return;
      markStreamingAssistantComplete(runId);
    }, 800);
  }

  async function refreshAll() {
    setError('');
    try {
      const [
        conversationList,
        archivedConversationList,
        trashedConversationList,
        capabilityList,
        workflowList,
        mcpServerList,
        skillList,
        toolRunList,
        workspaceConfig,
        systemHealth,
        runClosureReport,
        handoffAudit,
        memoryList,
        taskList,
        artifactList,
        openLoopList,
        proactiveList,
        automationList,
        automationTriggerList,
        automationRunList,
        nodeList,
        gatewayAuditList,
        modelUsage,
        savedModelList,
        confirmationList,
        backupList,
        desktopSettings,
        secrets,
        onboardingStatus,
      ] = await Promise.all([
        desktopApi.listConversations({ view: 'active', limit: 100 }),
        desktopApi.listConversations({ view: 'archived', limit: 100 }),
        desktopApi.listConversations({ view: 'trash', limit: 100 }),
        desktopApi.listCapabilities(),
        desktopApi.listToolWorkflows(),
        desktopApi.listMCPServers(),
        desktopApi.listSkills(),
        desktopApi.listToolRuns(),
        desktopApi.getWorkspaceSettings(),
        desktopApi.getSystemHealth(),
        desktopApi.getRecentRunClosureReport({ limit: 50 }),
        desktopApi.getExternalHandoffAudit(),
        desktopApi.listMemories({ query: memoryQuery, limit: 50 }),
        desktopApi.listProductTasks({ status: '', limit: 50 }),
        desktopApi.listArtifacts({ limit: 50 }),
        desktopApi.listOpenLoops({ status: 'open', limit: 50 }),
        desktopApi.listProactiveMessages({ status: 'draft', limit: 50 }),
        desktopApi.listAutomations({ limit: 100 }),
        desktopApi.listAutomationTriggers({ limit: 100 }),
        desktopApi.listAutomationRuns({ limit: 100 }),
        desktopApi.listNodes(),
        desktopApi.listWorkerGatewayAuditLogs(),
        desktopApi.getModelUsage(),
        desktopApi.listSavedModels({}),
        desktopApi.listConfirmations(),
        desktopApi.listBackups(),
        desktopApi.getSettings(),
        desktopApi.getSecretStatus(),
        desktopApi.getOnboardingStatus(),
      ]);
      setConversations(conversationList.conversations ?? []);
      setArchivedConversations(archivedConversationList.conversations ?? []);
      setTrashedConversations(trashedConversationList.conversations ?? []);
      setCapabilities(capabilityList.capabilities ?? []);
      setWorkflows(workflowList.workflows ?? []);
      setMCPServers(mcpServerList.servers ?? []);
      setSkills(skillList.skills ?? []);
      setToolRuns(toolRunList.tool_runs ?? []);
      setWorkspaceSettings(workspaceConfig);
      setHealth(systemHealth);
      setClosureReport(runClosureReport);
      setExternalHandoffAudit(handoffAudit);
      setMemories(memoryList.memories ?? []);
      setProductTasks(taskList.tasks ?? []);
      setArtifacts(artifactList.artifacts ?? []);
      setOpenLoops(openLoopList.open_loops ?? []);
      setProactiveMessages(proactiveList.messages ?? []);
      setAutomations(automationList.automations ?? []);
      setAutomationTriggers(automationTriggerList.triggers ?? []);
      setAutomationRuns(automationRunList.runs ?? []);
      setNodes(nodeList.nodes ?? []);
      setGatewayAudit(gatewayAuditList.items ?? []);
      setUsage(modelUsage.items ?? []);
      setSavedModels(savedModelList.models ?? []);
      setConfirmations(confirmationList.items ?? []);
      setBackups(backupList.backups ?? []);
      setSettings(desktopSettings);
      setSecretStatus(secrets);
      setOnboarding(onboardingStatus);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  async function syncMCPServer(serverID: string) {
    setError('');
    try {
      const result = await desktopApi.syncMCPServer(serverID);
      setMCPServers((current) => current.map((server) => (server.id === serverID ? result.server : server)));
      showNotice('MCP inventory 已刷新；执行仍需 wrapped capability 授权。');
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  async function wrapMCPTool(server: MCPServerRecord, toolName: string) {
    setError('');
    const tool = server.tools.find((item) => item.name === toolName);
    if (!tool) return;
    try {
      const safeID = `mcp_${server.id}_${tool.name}`.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
      const result = await desktopApi.wrapMCPTool(server.id, tool.name, {
        capability_id: safeID,
        description: tool.description || `Wrapped MCP tool ${tool.name}`,
        intent_domain: `mcp_${server.id}_${tool.name}`.toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
        positive_examples: [`使用 ${tool.name}`, `调用 ${server.name} 的 ${tool.name}`],
        negative_examples: ['列出本地所有 app', '检查 Joi 服务健康状态'],
        input_schema: tool.schema || { type: 'object', additionalProperties: true },
        output_schema: { type: 'object', additionalProperties: true },
        risk_level: 'read_only',
        privacy_level: 'private_content',
        ui_visibility: 'chat',
      });
      setCapabilities((current) => [...current.filter((item) => item.id !== result.capability.id), result.capability]);
      const refreshed = await desktopApi.listMCPServers();
      setMCPServers(refreshed.servers ?? []);
      showNotice('MCP tool 已 wrapped 为 Joi capability；执行仍会经过 semantic/policy gate。');
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setError('');
    setNotice('');
    const prompt = message.trim();
    if (!prompt) return;
    const currentActiveRunID = latestActiveRunId(runEventsByRunId) || chat?.run_id || trace?.id || '';
    if (isSubmitting && currentActiveRunID) {
      setMessage('');
      showNotice('已追加到当前任务。');
      try {
        const redirected = await desktopApi.redirectRun({
          run_id: currentActiveRunID,
          message: prompt,
          reason: 'steer_in_desktop',
          requested_mode: inputMode,
          product_task_id: activeProductTaskID || undefined,
        });
        setTrace(redirected.new_run ? await desktopApi.getRunTrace(redirected.new_run.run_id) : redirected.redirected_run);
        if (redirected.new_run) {
          setChat(redirected.new_run);
          setCurrentConversationID(redirected.new_run.conversation_id);
        }
        await refreshAll();
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    setTrace(null);
    setStreamingAssistantMessage(null);
    setActiveExecutionActions([]);
    setActiveExecutionStatus('pending');
    if (isSubmitting) return;
    const optimisticActions = createOptimisticExecutionActions(prompt);
    const pendingConversationID = currentConversationID || 'pending-conversation';
    pendingConversationIDRef.current = pendingConversationID;
    pendingAssistantIDRef.current = '';
    receivedAssistantDeltaRef.current = false;
    receivedAssistantDeltaRunIDRef.current = '';
    Object.keys(runCompletedFallbackTimersRef.current).forEach(clearRunCompletedFallback);
    setLastPrompt(prompt);
    setPendingUserMessage({
      id: `pending-${Date.now()}`,
      conversation_id: pendingConversationID,
      role: 'user',
      content: prompt,
    });
    setMessage('');
    setActiveExecutionActions(optimisticActions);
    setActiveExecutionStatus(optimisticActions.length > 0 ? 'running' : 'pending');
    setIsSubmitting(true);
    const routing = executionTargetOptions.find((item) => item.value === executionTarget) ?? executionTargetOptions[0];
    const modelName = selectedModelName || settings?.model_name || 'deepseek-v4-flash';
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const result = await desktopApi.sendChat({
        conversation_id: currentConversationID || undefined,
        channel: 'desktop',
        user_id: 'desktop_user',
        message: prompt,
        preferred_node: routing.preferredNode,
        allow_worker: routing.allowWorker,
        model_name: modelName,
        input_mode: inputMode,
        product_task_id: activeProductTaskID || undefined,
        runtime_mode: 'tool_calling',
        permission_profile: permissionProfileForPrompt(inputMode, prompt),
      });
      setChat(result);
      pendingAssistantIDRef.current = result.assistant_message_id;
      pendingConversationIDRef.current = result.conversation_id;
      setCurrentConversationID(result.conversation_id);
      if (result.product_task?.id) {
        setActiveProductTaskID(result.product_task.id);
        setActiveProductTaskDetail(await desktopApi.getProductTask(result.product_task.id));
      }
      if (result.artifacts?.[0]?.id) {
        setArtifacts((current) => [result.artifacts![0], ...current.filter((item) => item.id !== result.artifacts![0].id)]);
      }
      setMessage('');
      const runTrace = await desktopApi.getRunTrace(result.run_id);
      setTrace(runTrace);
      setRunEventsByRunId((current) => mergeRunEvents(current, result.run_id, normalizeTraceEvents(runTrace)));
      const visibleActions = visibleExecutionActions(projectRunTraceToActions(runTrace));
      setActiveExecutionActions(visibleActions);
      setActiveExecutionStatus(normalizeRunExecutionStatus(runTrace.status));
      if (receivedAssistantDeltaRef.current && (!receivedAssistantDeltaRunIDRef.current || receivedAssistantDeltaRunIDRef.current === result.run_id)) {
        setStreamingAssistantMessage((current) => ({
          id: current?.id || result.assistant_message_id,
          conversation_id: current?.conversation_id || result.conversation_id,
          role: 'assistant',
          content: userFacingAssistantText(result.response || String(current?.content || '')),
          run_id: result.run_id,
          complete: true,
        }));
        await sleep(120);
      } else if (userFacingAssistantText(result.response)) {
        await streamAssistantText({
          id: result.assistant_message_id,
          conversation_id: result.conversation_id,
          role: 'assistant',
          content: '',
          run_id: result.run_id,
        }, userFacingAssistantText(result.response));
      } else {
        setStreamingAssistantMessage(null);
      }
      const detail = await desktopApi.getConversation(result.conversation_id);
      setConversationMessages(detail.messages ?? []);
      setPendingUserMessage(null);
      setStreamingAssistantMessage(null);
      setActiveExecutionActions([]);
      setActiveExecutionStatus('pending');
      pendingAssistantIDRef.current = '';
      pendingConversationIDRef.current = '';
      await refreshAll();
      setActiveTab('chat');
    } catch (err) {
      setPendingUserMessage(null);
      setStreamingAssistantMessage(null);
      setActiveExecutionActions([]);
      setActiveExecutionStatus('failed');
      pendingAssistantIDRef.current = '';
      pendingConversationIDRef.current = '';
      setMessage(prompt);
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function streamAssistantText(base: StreamingAssistantMessage, fullText: string) {
    const chunks = splitStreamingChunks(fullText);
    if (chunks.length === 0) {
      setStreamingAssistantMessage({ ...base, content: fullText, complete: true });
      return;
    }
    setStreamingAssistantMessage({ ...base, content: '', complete: false });
    let next = '';
    for (const chunk of chunks) {
      next += chunk;
      setStreamingAssistantMessage({ ...base, content: next.trimStart(), complete: false });
      await sleep(Math.min(90, Math.max(28, chunk.length * 8)));
    }
    setStreamingAssistantMessage({ ...base, content: fullText, complete: true });
    await sleep(120);
  }

  async function loadConversation(conversationID: string) {
    const requestID = loadConversationRequestRef.current + 1;
    loadConversationRequestRef.current = requestID;
    setError('');
    setNotice('');
    setCurrentConversationID(conversationID);
    setConversationMessages([]);
    setChat(null);
    setTrace(null);
    setPendingUserMessage(null);
    setStreamingAssistantMessage(null);
    setActiveExecutionActions([]);
    setActiveExecutionStatus('pending');
    pendingAssistantIDRef.current = '';
    pendingConversationIDRef.current = '';
    try {
      const detail = await desktopApi.getConversation(conversationID);
      if (loadConversationRequestRef.current !== requestID) return;
      setCurrentConversationID(detail.conversation.id);
      setConversationMessages(detail.messages ?? []);
      setChat(null);
      if (detail.conversation.latest_run_id) {
        const runTrace = await desktopApi.getRunTrace(detail.conversation.latest_run_id);
        if (loadConversationRequestRef.current !== requestID) return;
        setTrace(runTrace);
        setRunEventsByRunId((current) => mergeRunEvents(current, detail.conversation.latest_run_id || '', normalizeTraceEvents(runTrace)));
      } else {
        setTrace(null);
      }
      setActiveTab('chat');
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  async function archiveConversation(conversationID: string) {
    await desktopApi.archiveConversation({ id: conversationID, reason: 'desktop_ui' });
    if (currentConversationID === conversationID) {
      startNewChat();
    }
    showNotice('会话已归档');
    await refreshAll();
  }

  async function trashConversation(conversationID: string) {
    await desktopApi.trashConversation({ id: conversationID, reason: 'desktop_ui' });
    if (currentConversationID === conversationID) {
      startNewChat();
    }
    showNotice('会话已移到回收站');
    await refreshAll();
  }

  async function restoreConversation(conversationID: string) {
    await desktopApi.restoreConversation({ id: conversationID, reason: 'desktop_ui' });
    showNotice('会话已恢复');
    await refreshAll();
  }

  async function purgeConversation(conversationID: string) {
    const confirmed = window.confirm('永久清理会红线化消息、提示词、模型/工具原始内容和交付物内容，且不可恢复。确定继续？');
    if (!confirmed) return;
    await desktopApi.purgeConversation({ id: conversationID, reason: 'desktop_ui' });
    if (currentConversationID === conversationID) {
      startNewChat();
    }
    showNotice('会话已永久清理');
    await refreshAll();
  }

  async function setWorkflowEnabled(name: string, enabled: boolean) {
    await desktopApi.setToolWorkflowEnabled({ name, enabled });
    showNotice(`${name} 已${enabled ? '启用' : '停用'}`);
    await refreshAll();
  }

  async function updateMemory(id: string, action: string, extra: Partial<MemoryRecord> = {}) {
    await desktopApi.updateMemory({ id, action, reason: 'desktop_ui', content: extra.content, summary: extra.summary, run_id: trace?.id });
    await refreshAll();
  }

  async function selectProductTask(id: string) {
    setError('');
    setNotice('');
    try {
      const detail = await desktopApi.getProductTask(id);
      setActiveProductTaskID(id);
      setActiveProductTaskDetail(detail);
      if (detail.task.created_from_conversation_id) {
        const conversation = await desktopApi.getConversation(detail.task.created_from_conversation_id);
        setCurrentConversationID(conversation.conversation.id);
        setConversationMessages(conversation.messages ?? []);
      }
      if (detail.task.latest_run_id) {
        const runTrace = await desktopApi.getRunTrace(detail.task.latest_run_id);
        setTrace(runTrace);
        setRunEventsByRunId((current) => mergeRunEvents(current, detail.task.latest_run_id || '', normalizeTraceEvents(runTrace)));
      }
      setActiveTab('chat');
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openArtifact(id: string) {
    try {
      setArtifactViewer(await desktopApi.getArtifact(id));
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  async function decideProactiveMessage(id: string, action: string, feedback?: string) {
    await desktopApi.decideProactiveMessage({ id, action, feedback });
    await refreshAll();
  }

  async function decideConfirmation(id: string, approve: boolean, scope: 'one_call' | 'current_run' = 'one_call') {
    const runID = confirmations.find((item) => item.id === id)?.run_id || trace?.id || chat?.run_id || '';
    await desktopApi.decideConfirmation({
      id,
      approve,
      actor: 'desktop_admin',
      reason: approve ? `approved_in_desktop:${scope}` : 'rejected_in_desktop',
      scope,
    });
    if (runID) {
      const runTrace = await desktopApi.getRunTrace(runID);
      setTrace(runTrace);
      setRunEventsByRunId((current) => mergeRunEvents(current, runID, normalizeTraceEvents(runTrace)));
    }
    await refreshAll();
  }

  async function cancelRun(runID: string) {
    if (!runID) return;
    await desktopApi.interruptRun({ run_id: runID, reason: 'cancelled_in_desktop' });
    showNotice(`已请求中断运行：${compactIdentifier(runID)}`);
  }

  async function continueProductTask(task: ProductTask) {
    setActiveProductTaskID(task.id);
    setInputMode(task.mode === 'background_task' ? 'background_task' : 'serious_task');
    setMessage(`继续任务：${task.title}\n\n请根据已有任务契约继续执行未完成步骤，更新交付物，并在完成前写入验证结果。`);
    setActiveTab('chat');
    showNotice(`已准备继续任务：${task.title}`);
  }

  async function continueProductTaskByID(id: string) {
    if (!id) return;
    try {
      const detail = await desktopApi.getProductTask(id);
      await continueProductTask(detail.task);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  async function setNodeDisabled(nodeID: string, disabled: boolean) {
    if (disabled) {
      await desktopApi.disableNode(nodeID);
      showNotice(`节点已停用：${nodeID}`);
    } else {
      await desktopApi.enableNode(nodeID);
      showNotice(`节点已启用：${nodeID}`);
    }
    await refreshAll();
  }

  async function rotateWorkerToken() {
    const result = await desktopApi.generateWorkerToken();
    showNotice(`工作节点令牌已重置：${result.token}`);
    await refreshAll();
  }

  async function createBackup() {
    const result = await desktopApi.createBackup();
    showNotice(`备份已创建：${result.path}`);
    await refreshAll();
  }

  async function restoreBackup(path: string) {
    await desktopApi.restoreBackup(path);
    showNotice('备份已恢复。密钥仍保存在钥匙串中，必要时可重新配置。');
    await refreshAll();
  }

  function startNewChat() {
    loadConversationRequestRef.current += 1;
    Object.keys(runCompletedFallbackTimersRef.current).forEach(clearRunCompletedFallback);
    setActiveTab('chat');
    setChat(null);
    setTrace(null);
    setCurrentConversationID('');
    setConversationMessages([]);
    setPendingUserMessage(null);
    setStreamingAssistantMessage(null);
    setActiveExecutionActions([]);
    setActiveExecutionStatus('pending');
    setActiveProductTaskID('');
    setActiveProductTaskDetail(null);
    setArtifactViewer(null);
    setLastPrompt('');
    setMessage('');
    pendingAssistantIDRef.current = '';
    pendingConversationIDRef.current = '';
    receivedAssistantDeltaRef.current = false;
    receivedAssistantDeltaRunIDRef.current = '';
  }

  function toggleSidebarCollapsed() {
    setManualSidebarCollapsed(sidebarCollapsed ? false : true);
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (sidebarCollapsed) return;

    event.preventDefault();
    const shell = shellRef.current;
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    let nextWidth = startWidth;
    let animationFrame = 0;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    shell?.classList.add('sidebar-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function applyWidth() {
      animationFrame = 0;
      shell?.style.setProperty('--sidebar-width', `${nextWidth}px`);
    }

    function scheduleWidth(width: number) {
      nextWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(applyWidth);
    }

    function resize(moveEvent: PointerEvent) {
      scheduleWidth(startWidth + moveEvent.clientX - startX);
    }

    function stopResize() {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
      shell?.style.setProperty('--sidebar-width', `${nextWidth}px`);
      shell?.classList.remove('sidebar-resizing');
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setSidebarWidth(nextWidth);
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    }

    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  }

  function startRightPanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (autoRightPanelCollapsed) return;

    event.preventDefault();
    const shell = shellRef.current;
    const startX = event.clientX;
    const startWidth = activeRightPanelWidth;
    const maxWidth = Math.max(
      RIGHT_PANEL_MIN_WIDTH,
      Math.min(RIGHT_PANEL_MAX_WIDTH, windowWidth - activeSidebarWidth - COMPANION_MAIN_MIN_WIDTH),
    );
    let nextWidth = startWidth;
    let animationFrame = 0;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    shell?.classList.add('right-panel-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function applyWidth() {
      animationFrame = 0;
      shell?.style.setProperty('--right-panel-width', `${nextWidth}px`);
    }

    function scheduleWidth(width: number) {
      nextWidth = Math.min(maxWidth, Math.max(RIGHT_PANEL_MIN_WIDTH, width));
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(applyWidth);
    }

    function resize(moveEvent: PointerEvent) {
      scheduleWidth(startWidth + startX - moveEvent.clientX);
    }

    function stopResize() {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
      shell?.style.setProperty('--right-panel-width', `${nextWidth}px`);
      shell?.classList.remove('right-panel-resizing');
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setRightPanelWidth(nextWidth);
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    }

    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  }

  return (
    <main ref={shellRef} className={`im-app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${inSettingsArea ? 'settings-mode' : ''}`} style={shellStyle}>
      {inSettingsArea ? (
        <SettingsTopControls collapsed={sidebarCollapsed} goBack={() => setActiveTab('chat')} toggleCollapsed={toggleSidebarCollapsed} />
      ) : (
        <SidebarTopControls
          collapsed={sidebarCollapsed}
          setActiveTab={setActiveTab}
          startNewChat={startNewChat}
          toggleCollapsed={toggleSidebarCollapsed}
        />
      )}
      {inSettingsArea ? (
        <SettingsSidebar
          activeCategory={settingsCategory}
          collapsed={sidebarCollapsed}
          health={health}
          selectSettingsObject={selectSettingsObject}
        />
      ) : (
        <ConversationSidebar
          activeTab={activeTab}
          archiveConversation={archiveConversation}
          chat={chat}
          collapsed={sidebarCollapsed}
          conversations={conversations}
          currentConversationID={currentConversationID}
          health={health}
          loadConversation={loadConversation}
          setActiveTab={setActiveTab}
          trace={trace}
        />
      )}
      {!sidebarCollapsed && <div aria-label="调整侧边栏宽度" className="sidebar-resizer" role="separator" onPointerDown={startSidebarResize} />}

      <section className="im-workspace">
        <NotificationStack
          chatOffset={activeTab === 'chat' && !onboarding?.required}
          error={error}
          errorKey={errorKey}
          notice={notice}
          noticeKey={noticeKey}
          onDismissError={() => setError('')}
          onDismissNotice={() => setNotice('')}
        />

        {onboarding?.required && <OnboardingPanel createBackup={createBackup} refreshAll={refreshAll} setError={showError} setNotice={showNotice} status={onboarding} />}

        {!onboarding?.required && activeTab === 'chat' && (
          <RenderCrashBoundary
            onRecover={startNewChat}
            resetKey={`chat:${currentConversationID || chat?.conversation_id || 'new'}:${conversationMessages.length}:${chat?.run_id || trace?.id || ''}`}
            surface="chat"
          >
            <ChatHome
              activeProductTask={activeProductTaskDetail}
              artifacts={artifacts}
              activeExecutionActions={activeExecutionActions}
              autoRightPanelCollapsed={autoRightPanelCollapsed}
              chat={chat}
              conversationMessages={conversationMessages}
              cancelRun={cancelRun}
              continueProductTask={continueProductTask}
              decideConfirmation={decideConfirmation}
              decideProactiveMessage={decideProactiveMessage}
              executionTarget={executionTarget}
              health={health}
              inputMode={inputMode}
              isSubmitting={isSubmitting}
              memories={memories}
              openArtifact={openArtifact}
              openLoops={openLoops}
              lastPrompt={lastPrompt}
              message={message}
              pendingUserMessage={pendingUserMessage}
              streamingAssistantMessage={streamingAssistantMessage}
              proactiveMessages={proactiveMessages}
              productTasks={productTasks}
              runEventsByRunId={runEventsByRunId}
              savedModels={savedModels}
              selectProductTask={selectProductTask}
              selectedModelName={selectedModelName || settings?.model_name || 'deepseek-v4-flash'}
              setActiveTab={setActiveTab}
              setExecutionTarget={setExecutionTarget}
              setInputMode={setInputMode}
              setMessage={setMessage}
              setSelectedModelName={setSelectedModelName}
              settings={settings}
              startRightPanelResize={startRightPanelResize}
              updateMemory={updateMemory}
              submit={submit}
              trace={trace}
            />
          </RenderCrashBoundary>
        )}
        {artifactViewer && activeTab === 'chat' && (
          <ArtifactViewer artifact={artifactViewer} close={() => setArtifactViewer(null)} />
        )}

        {!onboarding?.required && activeTab === 'trace' && (
          <TraceStage
            firstModelCall={firstModelCall}
            goBack={() => setActiveTab('chat')}
            stepCount={stepCount}
            trace={trace}
          />
        )}

        {!onboarding?.required && activeTab !== 'chat' && activeTab !== 'trace' && (
          <section className="settings-stage">
            <SettingsConsole
              activeCategory={settingsCategory}
              activeObjectID={settingsObjectByCategory[settingsCategory]}
              archivedConversations={archivedConversations}
              audit={gatewayAudit}
              automations={automations}
              automationTriggers={automationTriggers}
              automationRuns={automationRuns}
              backups={backups}
              capabilities={capabilities}
              calls={trace?.model_calls ?? []}
              confirmations={confirmations}
              closureReport={closureReport}
              continueProductTaskByID={continueProductTaskByID}
              externalHandoffAudit={externalHandoffAudit}
              createBackup={createBackup}
              decideConfirmation={decideConfirmation}
              firstModelCall={firstModelCall}
              health={health}
              memories={memories}
              memoryQuery={memoryQuery}
              mcpServers={mcpServers}
              nodes={nodes}
              refreshAll={refreshAll}
              restoreBackup={restoreBackup}
              restoreConversation={restoreConversation}
              rotateWorkerToken={rotateWorkerToken}
              savedModels={savedModels}
              secretStatus={secretStatus}
              selectSettingsObject={selectSettingsObject}
              setMemoryQuery={setMemoryQuery}
              setNodeDisabled={setNodeDisabled}
              setNotice={showNotice}
              skills={skills}
              syncMCPServer={syncMCPServer}
              wrapMCPTool={wrapMCPTool}
              setWorkflowEnabled={setWorkflowEnabled}
              settings={settings}
              stepCount={stepCount}
              trace={trace}
              toolRuns={toolRuns}
              trashedConversations={trashedConversations}
              trashConversation={trashConversation}
              purgeConversation={purgeConversation}
              updateMemory={updateMemory}
              usage={usage}
              workflows={workflows}
              workspaceSettings={workspaceSettings}
            />
          </section>
        )}
      </section>
    </main>
  );
}

function NotificationStack({
  chatOffset,
  error,
  errorKey,
  notice,
  noticeKey,
  onDismissError,
  onDismissNotice,
}: {
  chatOffset: boolean;
  error: string;
  errorKey: number;
  notice: string;
  noticeKey: number;
  onDismissError: () => void;
  onDismissNotice: () => void;
}) {
  if (!error && !notice) {
    return null;
  }

  return (
    <div className={`notification-stack ${chatOffset ? 'chat-offset' : ''}`} aria-live="polite" aria-relevant="additions text">
      {error && (
        <section key={`error-${errorKey}`} className="app-toast error-toast" role="alert">
          <span className="toast-mark" aria-hidden="true">!</span>
          <div className="toast-copy">
            <strong>操作失败</strong>
            <p>{error}</p>
          </div>
          <button className="toast-close-button" type="button" aria-label="关闭通知" onClick={onDismissError}>
            ×
          </button>
        </section>
      )}
      {notice && (
        <section key={`notice-${noticeKey}`} className="app-toast notice-toast" role="status">
          <span className="toast-mark" aria-hidden="true">✓</span>
          <div className="toast-copy">
            <strong>已完成</strong>
            <p>{notice}</p>
          </div>
          <button className="toast-close-button" type="button" aria-label="关闭通知" onClick={onDismissNotice}>
            ×
          </button>
        </section>
      )}
    </div>
  );
}

function SecretInput({
  placeholder,
  value,
  visible,
  onChange,
  onToggleVisible,
}: {
  placeholder?: string;
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  onToggleVisible: () => void;
}) {
  return (
    <span className="secret-input-wrap">
      <input
        className="secret-input"
        placeholder={placeholder}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button className="secret-eye-button" type="button" aria-label={visible ? '隐藏密钥' : '显示密钥'} onClick={onToggleVisible}>
        <EyeIcon open={visible} />
      </button>
    </span>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg className="secret-eye-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.8 12s3.2-5.4 9.2-5.4 9.2 5.4 9.2 5.4-3.2 5.4-9.2 5.4S2.8 12 2.8 12Z" />
      <circle cx="12" cy="12" r="2.7" />
      {!open && <path d="M4.5 19.5 19.5 4.5" />}
    </svg>
  );
}

function ModelList({ models, onConfigure }: { models: AvailableModel[]; onConfigure?: (model: AvailableModel) => void }) {
  return (
    <div className="available-model-list">
      {models.map((model, index) => (
        <article key={modelListKey(model, index)} className="available-model-chip" title={model.owner || model.display_name || model.id}>
          <div className="available-model-main">
            <strong>{model.display_name || model.id}</strong>
            {model.display_name && model.display_name !== model.id && <small>{model.id}</small>}
            <span>{modelSummary(model)}</span>
          </div>
          {onConfigure && <button type="button" onClick={() => onConfigure(model)}>配置</button>}
        </article>
      ))}
    </div>
  );
}

function modelListKey(model: AvailableModel, index: number) {
  return [model.provider || '', model.base_url || '', model.id, index].join(':');
}

function modelSummary(model: AvailableModel) {
  const parts = [
    model.owner,
    model.context_window ? `${formatNumber(model.context_window)} context` : '',
    model.max_output_tokens ? `${formatNumber(model.max_output_tokens)} output` : '',
    model.input_price_per_1m ? `$${model.input_price_per_1m.toFixed(2)}/1M in` : '',
    model.output_price_per_1m ? `$${model.output_price_per_1m.toFixed(2)}/1M out` : '',
  ].filter(Boolean);
  return parts.join(' · ') || '提供方未返回更多元数据';
}

function ModelSettingsDialog({
  draft,
  model,
  onChange,
  onClose,
  onSave,
}: {
  draft: ModelSettingsDraft;
  model?: AvailableModel;
  onChange: (draft: ModelSettingsDraft) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const supportedParams = model?.supported_parameters ?? [];
  const setDraft = (patch: Partial<ModelSettingsDraft>) => onChange({ ...draft, ...patch });

  return (
    <div className="settings-modal-backdrop" role="presentation">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="model-settings-title">
        <header className="settings-modal-header">
          <div>
            <small>模型配置</small>
            <h2 id="model-settings-title">{draft.display_name || draft.model_id}</h2>
            <p>{draft.model_id}</p>
          </div>
          <button className="modal-close-button" type="button" aria-label="关闭弹窗" onClick={onClose}>×</button>
        </header>

        <dl className="model-info-grid">
          <KV label="Owner" value={model?.owner || '未返回'} />
          <KV label="Object" value={model?.object || '未返回'} />
          <KV label="Context" value={model?.context_window ? formatNumber(model.context_window) : '未返回'} />
          <KV label="Output" value={model?.max_output_tokens ? formatNumber(model.max_output_tokens) : '未返回'} />
          <KV label="Input Price" value={model?.input_price_per_1m ? `$${model.input_price_per_1m.toFixed(2)} / 1M` : '未返回'} />
          <KV label="Output Price" value={model?.output_price_per_1m ? `$${model.output_price_per_1m.toFixed(2)} / 1M` : '未返回'} />
        </dl>

        <div className="settings-form compact">
          <label className="field-row">
            <span>显示名称</span>
            <input value={draft.display_name} onChange={(event) => setDraft({ display_name: event.target.value })} />
          </label>
          <label className="field-row">
            <span>使用角色</span>
            <select value={draft.role} onChange={(event) => setDraft({ role: event.target.value })}>
              <option value="general">普通模型</option>
              <option value="default">默认模型</option>
              <option value="reasoning">推理模型</option>
              <option value="cheap">低成本模型</option>
            </select>
          </label>
          <label className="field-row">
            <span>启用</span>
            <input checked={draft.enabled} type="checkbox" onChange={(event) => setDraft({ enabled: event.target.checked })} />
          </label>
          <label className="field-row">
            <span>温度</span>
            <input inputMode="decimal" value={draft.temperature} onChange={(event) => setDraft({ temperature: event.target.value })} />
          </label>
          <label className="field-row">
            <span>最大输出 Tokens</span>
            <input inputMode="numeric" value={draft.max_output_tokens} onChange={(event) => setDraft({ max_output_tokens: event.target.value })} />
          </label>
          <label className="field-row">
            <span>超时秒数</span>
            <input inputMode="numeric" value={draft.timeout_seconds} onChange={(event) => setDraft({ timeout_seconds: event.target.value })} />
          </label>
          <label className="field-row">
            <span>重试次数</span>
            <input inputMode="numeric" value={draft.max_retries} onChange={(event) => setDraft({ max_retries: event.target.value })} />
          </label>
          <div className="field-row model-toggle-row">
            <span>能力开关</span>
            <div className="model-toggle-list">
              <label><input checked={draft.supports_json_mode} type="checkbox" onChange={(event) => setDraft({ supports_json_mode: event.target.checked })} /> JSON 模式</label>
              <label><input checked={draft.supports_tool_calling} type="checkbox" onChange={(event) => setDraft({ supports_tool_calling: event.target.checked })} /> Tool Calling</label>
              <label><input checked={draft.supports_reasoning} type="checkbox" onChange={(event) => setDraft({ supports_reasoning: event.target.checked })} /> 推理能力</label>
            </div>
          </div>
        </div>

        <div className="supported-param-list">
          {supportedParams.length > 0
            ? supportedParams.map((item) => <span key={item}>{item}</span>)
            : <span>提供方未返回 supported_parameters</span>}
        </div>

        <footer className="settings-modal-footer">
          <button className="secondary-button" type="button" onClick={onClose}>取消</button>
          <button type="button" onClick={onSave}>确认保存</button>
        </footer>
      </section>
    </div>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function numericValue(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(number) ? number : 0;
}

function formatTokenCount(value: unknown): string {
  return formatNumber(Math.max(0, Math.floor(numericValue(value))));
}

function formatRatio(value: unknown): string {
  const ratio = numericValue(value);
  if (ratio <= 0) return '0%';
  return `${Math.min(100, ratio * 100).toFixed(0)}%`;
}

function formatCost(value: unknown): string {
  const cost = numericValue(value);
  return cost > 0 ? `$${cost.toFixed(4)}` : '$0.0000';
}

function formatMilliseconds(value: unknown): string {
  return `${Math.round(numericValue(value))} ms`;
}

function modelCallTotalTokens(call: ModelCall): number {
  return numericValue(call.total_tokens) || numericValue(call.input_tokens) + numericValue(call.output_tokens);
}

function summarizeModelCalls(calls: ModelCall[]) {
  return calls.reduce((summary, call) => ({
    total_tokens: summary.total_tokens + modelCallTotalTokens(call),
    input_tokens: summary.input_tokens + numericValue(call.input_tokens),
    output_tokens: summary.output_tokens + numericValue(call.output_tokens),
    cached_input_tokens: summary.cached_input_tokens + numericValue(call.cached_input_tokens),
    reasoning_tokens: summary.reasoning_tokens + numericValue(call.reasoning_tokens),
    cost_estimate: summary.cost_estimate + numericValue(call.cost_estimate),
  }), {
    total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    reasoning_tokens: 0,
    cost_estimate: 0,
  });
}

function SettingsSidebar({
  activeCategory,
  collapsed,
  health,
  selectSettingsObject,
}: {
  activeCategory: SettingsCategory;
  collapsed: boolean;
  health: SystemHealth | null;
  selectSettingsObject: (category: SettingsCategory, objectID?: string) => void;
}) {
  if (collapsed) {
    return <aside aria-hidden="true" className="im-sidebar sidebar-placeholder" />;
  }

  return (
    <aside className="im-sidebar settings-sidebar">
      <ScrollArea className="settings-menu" aria-label="设置菜单">
        {settingsCategories.map((section) => (
          <button
            key={section.id}
            className={`settings-menu-item ${activeCategory === section.id ? 'active' : ''}`}
            type="button"
            onClick={() => selectSettingsObject(section.id)}
          >
            <span>
              <strong>{section.label}</strong>
            </span>
          </button>
        ))}
      </ScrollArea>

      <div className="settings-sidebar-footer">
        <span className={`sidebar-status-dot live-dot ${health?.service_status?.sqlite ? 'on' : ''}`} />
        <span>{health?.service_status?.sqlite ? '本地服务在线' : '需要刷新状态'}</span>
      </div>
    </aside>
  );
}

function SettingsConsole({
  activeCategory,
  activeObjectID,
  archivedConversations,
  audit,
  automations,
  automationTriggers,
  automationRuns,
  backups,
  capabilities,
  calls,
  confirmations,
  closureReport,
  continueProductTaskByID,
  externalHandoffAudit,
  createBackup,
  decideConfirmation,
  firstModelCall,
  health,
  memories,
  memoryQuery,
  mcpServers,
  nodes,
  refreshAll,
  restoreBackup,
  restoreConversation,
  rotateWorkerToken,
  savedModels,
  secretStatus,
  selectSettingsObject,
  setMemoryQuery,
  setNodeDisabled,
  setNotice,
  skills,
  syncMCPServer,
  wrapMCPTool,
  setWorkflowEnabled,
  settings,
  stepCount,
  trace,
  toolRuns,
  trashedConversations,
  trashConversation,
  purgeConversation,
  updateMemory,
  usage,
  workflows,
  workspaceSettings,
}: {
  activeCategory: SettingsCategory;
  activeObjectID: string;
  archivedConversations: ConversationSummary[];
  audit: WorkerGatewayAuditRecord[];
  automations: AutomationDefinition[];
  automationTriggers: AutomationTriggerRecord[];
  automationRuns: AutomationRunRecord[];
  backups: BackupRecord[];
  capabilities: CapabilityRecord[];
  calls: ModelCall[];
  confirmations: ConfirmationRecord[];
  closureReport: RunClosureReport | null;
  continueProductTaskByID: (id: string) => Promise<void>;
  externalHandoffAudit: ExternalHandoffAudit | null;
  createBackup: () => Promise<void>;
  decideConfirmation: (id: string, approve: boolean) => Promise<void>;
  firstModelCall?: ModelCall;
  health: SystemHealth | null;
  memories: MemoryRecord[];
  memoryQuery: string;
  mcpServers: MCPServerRecord[];
  nodes: NodeRecord[];
  refreshAll: () => Promise<void>;
  restoreBackup: (path: string) => Promise<void>;
  restoreConversation: (conversationID: string) => Promise<void>;
  rotateWorkerToken: () => Promise<void>;
  savedModels: AvailableModel[];
  secretStatus: SecretStatus | null;
  selectSettingsObject: (category: SettingsCategory, objectID?: string) => void;
  setMemoryQuery: (value: string) => void;
  setNodeDisabled: (nodeID: string, disabled: boolean) => Promise<void>;
  setNotice: (value: string) => void;
  skills: SkillRecord[];
  syncMCPServer: (serverID: string) => Promise<void>;
  wrapMCPTool: (server: MCPServerRecord, toolName: string) => Promise<void>;
  setWorkflowEnabled: (name: string, enabled: boolean) => Promise<void>;
  settings: SettingsRecord | null;
  stepCount: number;
  trace: RunTrace | null;
  toolRuns: ToolRunRecord[];
  trashedConversations: ConversationSummary[];
  trashConversation: (conversationID: string) => Promise<void>;
  purgeConversation: (conversationID: string) => Promise<void>;
  updateMemory: (id: string, action: string, extra?: Partial<MemoryRecord>) => Promise<void>;
  usage: Record<string, unknown>[];
  workflows: ToolWorkflowRecord[];
  workspaceSettings: WorkspaceSettings | null;
}) {
  const activeCategoryMeta = settingsCategories.find((category) => category.id === activeCategory) ?? settingsCategories[0];
  const objectItems = getSettingsObjects(activeCategory, nodes, automations);
  const activeObject = objectItems.find((item) => item.id === activeObjectID) ?? objectItems[0];
  const modelPreset = modelProviderPresets[activeObject.id] ?? modelProviderPresets.compatible;
  const [provider, setProvider] = useState(modelPreset.provider);
  const [modelBaseURL, setModelBaseURL] = useState(modelPreset.baseURL);
  const [modelName, setModelName] = useState(modelPreset.defaultModel);
  const [reasoningModel, setReasoningModel] = useState(modelPreset.reasoningModel);
  const [modelApiKey, setModelApiKey] = useState('');
  const [modelApiKeyVisible, setModelApiKeyVisible] = useState(false);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [modelSettingsDraft, setModelSettingsDraft] = useState<ModelSettingsDraft | null>(null);
  const [modelTimeout, setModelTimeout] = useState('60');
  const [modelRetryCount, setModelRetryCount] = useState('3');
  const [modelTemperature, setModelTemperature] = useState('0.7');
  const [testStatus, setTestStatus] = useState('');
  const [xaiLoginBusy, setXAILoginBusy] = useState(false);
  const [telegramEnabled, setTelegramEnabled] = useState(settings?.telegram_enabled ?? false);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramTokenVisible, setTelegramTokenVisible] = useState(false);
  const [telegramAllowed, setTelegramAllowed] = useState(settings?.telegram_allowed_user_ids ?? '');
  const [telegramChatID, setTelegramChatID] = useState('');
  const [imessageEnabled, setIMessageEnabled] = useState(settings?.imessage_enabled ?? false);
  const [imessageProjectID, setIMessageProjectID] = useState(settings?.imessage_project_id ?? '');
  const [imessageProjectSecret, setIMessageProjectSecret] = useState('');
  const [imessageProjectSecretVisible, setIMessageProjectSecretVisible] = useState(false);
  const [imessageDashboardToken, setIMessageDashboardToken] = useState('');
  const [imessageDashboardTokenVisible, setIMessageDashboardTokenVisible] = useState(false);
  const [imessagePhone, setIMessagePhone] = useState(settings?.imessage_operator_phone ?? '');
  const [imessageAssignedNumber, setIMessageAssignedNumber] = useState(settings?.imessage_assigned_number ?? '');
  const [imessageHomeChannel, setIMessageHomeChannel] = useState(settings?.imessage_home_channel ?? '');
  const [imessageAllowed, setIMessageAllowed] = useState(settings?.imessage_allowed_users ?? '');
  const [imessageRequireMention, setIMessageRequireMention] = useState(settings?.imessage_require_mention ?? false);
  const [imessageSidecarPort, setIMessageSidecarPort] = useState(String(settings?.imessage_sidecar_port ?? 8790));
  const [imessageTestSpaceID, setIMessageTestSpaceID] = useState('');
  const [imessageStatus, setIMessageStatus] = useState<PhotonIMessageStatus | null>(null);
  const [imessageSetupBusy, setIMessageSetupBusy] = useState(false);
  const [secretName, setSecretName] = useState('MODEL_API_KEY');
  const [secretValue, setSecretValue] = useState('');
  const [secretValueVisible, setSecretValueVisible] = useState(false);
  const [workerGatewayEnabled, setWorkerGatewayEnabled] = useState(settings?.worker_gateway_enabled ?? true);
  const [restorePath, setRestorePath] = useState('');
  const [automationName, setAutomationName] = useState('');
  const [automationSlug, setAutomationSlug] = useState('');
  const [automationScheduleType, setAutomationScheduleType] = useState('interval');
  const [automationCron, setAutomationCron] = useState('0 9 * * *');
  const [automationIntervalMinutes, setAutomationIntervalMinutes] = useState('60');
  const [automationTime, setAutomationTime] = useState('09:00');
  const [automationWeekday, setAutomationWeekday] = useState('1');
  const [automationOnceAt, setAutomationOnceAt] = useState('');
  const [automationTimezone, setAutomationTimezone] = useState('');
  const [automationDedupField, setAutomationDedupField] = useState('event_id');
  const [automationPrompt, setAutomationPrompt] = useState('请处理这个自动化任务。payload 摘要：{{payload}}');
  const [automationEndpoint, setAutomationEndpoint] = useState<AutomationWebhookEndpoint | null>(null);
  const [automationBusy, setAutomationBusy] = useState('');
  const inbox = memories.filter((memory) => memory.status !== 'rejected' && !isMemoryDisabled(memory) && (memory.status !== 'confirmed' || memory.confidence < 0.6 || Boolean(memory.conflict_group_id) || Boolean(memory.merged_into_memory_id)));
  const confirmedMemories = memories.filter((memory) => memory.status === 'confirmed' && !memory.disabled);
  const conflictedMemories = memories.filter((memory) => Boolean(memory.conflict_group_id));
  const searchedMemories = memories.filter((memory) => {
    if (!memoryQuery.trim()) return true;
    return `${memory.summary} ${memory.content} ${memory.type}`.toLowerCase().includes(memoryQuery.trim().toLowerCase());
  });

  useEffect(() => {
    const preset = modelProviderPresets[activeObject.id] ?? modelProviderPresets.compatible;
    const useSavedModelConfig = modelPresetMatchesSavedSettings(activeObject.id, preset, settings);
    const nextBaseURL = useSavedModelConfig ? settings?.model_base_url || preset.baseURL : preset.baseURL;
    const models = savedModelsForProvider(savedModels, preset.provider, nextBaseURL);
    const configuredDefaultModel = useSavedModelConfig ? settings?.model_name || preset.defaultModel : preset.defaultModel;
    const configuredReasoningModel = useSavedModelConfig ? settings?.model_reasoning_name || preset.reasoningModel : preset.reasoningModel;
    setProvider(preset.provider);
    setModelBaseURL(nextBaseURL);
    setModelName(models.length > 0 && !models.some((model) => model.id === configuredDefaultModel) ? preferredDefaultModel(models) : configuredDefaultModel);
    setReasoningModel(models.length > 0 && !models.some((model) => model.id === configuredReasoningModel) ? preferredReasoningModel(models) : configuredReasoningModel);
    setAvailableModels(models);
    setTestStatus('');
  }, [activeObject.id, savedModels, settings?.model_base_url, settings?.model_name, settings?.model_reasoning_name]);

  useEffect(() => {
    setTelegramEnabled(settings?.telegram_enabled ?? false);
    setTelegramAllowed(settings?.telegram_allowed_user_ids ?? '');
    setIMessageEnabled(settings?.imessage_enabled ?? false);
    setIMessageProjectID(settings?.imessage_project_id ?? '');
    setIMessagePhone(settings?.imessage_operator_phone ?? '');
    setIMessageAssignedNumber(settings?.imessage_assigned_number ?? '');
    setIMessageHomeChannel(settings?.imessage_home_channel ?? '');
    setIMessageAllowed(settings?.imessage_allowed_users ?? '');
    setIMessageRequireMention(settings?.imessage_require_mention ?? false);
    setIMessageSidecarPort(String(settings?.imessage_sidecar_port ?? 8790));
    setWorkerGatewayEnabled(settings?.worker_gateway_enabled ?? true);
  }, [settings?.imessage_allowed_users, settings?.imessage_assigned_number, settings?.imessage_enabled, settings?.imessage_home_channel, settings?.imessage_operator_phone, settings?.imessage_project_id, settings?.imessage_require_mention, settings?.imessage_sidecar_port, settings?.telegram_allowed_user_ids, settings?.telegram_enabled, settings?.worker_gateway_enabled]);

  useEffect(() => {
    setAutomationEndpoint(null);
    const selected = automations.find((automation) => automation.id === activeObject.id);
    if (!selected) {
      const isWebhook = activeObject.id === 'new-webhook';
      setAutomationName(isWebhook ? 'Webhook 自动化' : '定时自动化');
      setAutomationSlug('');
      setAutomationScheduleType('interval');
      setAutomationCron('0 9 * * *');
      setAutomationIntervalMinutes('60');
      setAutomationTime('09:00');
      setAutomationWeekday('1');
      setAutomationOnceAt('');
      setAutomationTimezone('');
      setAutomationDedupField(isWebhook ? 'event_id' : '');
      setAutomationPrompt(isWebhook ? '请处理这个 webhook 自动化任务。事件：{{payload.event_id}}' : '请处理这个定时自动化任务。payload 摘要：{{payload}}');
      return;
    }
    const config = selected.trigger_config ?? {};
    setAutomationName(selected.name);
    setAutomationSlug(selected.slug);
    setAutomationScheduleType(String(config.type || (selected.kind === 'webhook' ? 'webhook' : 'interval')));
    setAutomationCron(String(config.expression || config.cron || '0 9 * * *'));
    setAutomationIntervalMinutes(String(Number(config.every_minutes ?? (Number(config.every_seconds ?? config.interval_seconds ?? 3600) / 60)) || 60));
    setAutomationTime(String(config.time || '09:00'));
    setAutomationWeekday(String(config.weekday ?? '1'));
    setAutomationOnceAt(String(config.run_at || config.at || ''));
    setAutomationTimezone(String(config.timezone || ''));
    setAutomationDedupField(String(selected.dedup_policy?.dedup_json_field || config.dedup_json_field || 'event_id'));
    setAutomationPrompt(selected.prompt_template || '请处理这个自动化任务。payload 摘要：{{payload}}');
  }, [activeObject.id, automations]);

  async function saveModelDetail() {
    await desktopApi.saveModelConfig({
      provider,
      base_url: modelBaseURL,
      name: modelName,
      reasoning_name: reasoningModel,
      timeout_seconds: Number(modelTimeout) || 60,
      max_retries: Number(modelRetryCount) || 1,
    });
    if (modelApiKey.trim()) {
      await desktopApi.saveSecret({ name: 'MODEL_API_KEY', value: modelApiKey.trim() });
      setModelApiKey('');
    }
    setNotice(`${activeObject.label} 模型配置已保存`);
    await refreshAll();
  }

  async function testModelDetail() {
    const result = await desktopApi.testModelConnection({
      provider,
      base_url: modelBaseURL,
      name: modelName,
      api_key: modelApiKey.trim() || undefined,
      timeout_seconds: Number(modelTimeout) || 60,
      max_retries: Number(modelRetryCount) || 1,
    });
    const message = `连接测试：${formatStatus(result.status)}${result.error_summary ? ` · ${result.error_summary}` : ''}`;
    setTestStatus(message);
    setNotice(message);
  }

  async function fetchModelList() {
    const result = await desktopApi.fetchAvailableModels({
      provider,
      base_url: modelBaseURL,
      name: modelName,
      api_key: modelApiKey.trim() || undefined,
      timeout_seconds: Number(modelTimeout) || 60,
      max_retries: Number(modelRetryCount) || 1,
    });
    const models = result.available_models ?? [];
    setAvailableModels(models);
    if (models.length > 0 && !models.some((model) => model.id === modelName)) {
      setModelName(preferredDefaultModel(models));
    }
    if (models.length > 0 && !models.some((model) => model.id === reasoningModel)) {
      setReasoningModel(preferredReasoningModel(models));
    }
    const message = `模型列表：${formatStatus(result.status)}${result.error_summary ? ` · ${result.error_summary}` : ` · ${models.length} 个模型`}`;
    setTestStatus(message);
    setNotice(message);
    await refreshAll();
  }

  async function loginXAIOAuthDetail() {
    setXAILoginBusy(true);
    setTestStatus('xAI：正在等待浏览器授权');
    try {
      const result = await desktopApi.loginXAIOAuth();
      setProvider(result.provider);
      setModelBaseURL(result.base_url);
      setModelName(result.model_name);
      setReasoningModel(result.model_name);
      setTestStatus(`xAI：已登录 · ${result.scope}`);
      setNotice(`xAI OAuth 已登录并切换到 ${result.model_name}`);
      await refreshAll();
    } catch (error) {
      const message = `xAI：登录失败 · ${error instanceof Error ? error.message : String(error)}`;
      setTestStatus(message);
      setNotice(message);
    } finally {
      setXAILoginBusy(false);
    }
  }

  function openModelSettings(model: AvailableModel) {
    const config = model.config;
    setModelSettingsDraft({
      provider,
      base_url: modelBaseURL,
      model_id: model.id,
      display_name: model.display_name || model.id,
      role: config?.role || (model.id === modelName ? 'default' : model.id === reasoningModel ? 'reasoning' : 'general'),
      enabled: config?.enabled ?? true,
      temperature: String(config?.temperature ?? modelTemperature),
      max_output_tokens: String(config?.max_output_tokens || model.max_output_tokens || ''),
      timeout_seconds: String(config?.timeout_seconds ?? modelTimeout),
      max_retries: String(config?.max_retries ?? modelRetryCount),
      supports_json_mode: config?.supports_json_mode ?? Boolean(model.supports_json_mode),
      supports_tool_calling: config?.supports_tool_calling ?? Boolean(model.supports_tool_calling),
      supports_reasoning: config?.supports_reasoning ?? Boolean(model.supports_reasoning),
    });
  }

  async function saveModelSettings() {
    if (!modelSettingsDraft) return;
    const nextConfig = {
      role: modelSettingsDraft.role,
      enabled: modelSettingsDraft.enabled,
      temperature: Number(modelSettingsDraft.temperature) || 0,
      max_output_tokens: Number(modelSettingsDraft.max_output_tokens) || 0,
      timeout_seconds: Number(modelSettingsDraft.timeout_seconds) || 60,
      max_retries: Number(modelSettingsDraft.max_retries) || 0,
      supports_json_mode: modelSettingsDraft.supports_json_mode,
      supports_tool_calling: modelSettingsDraft.supports_tool_calling,
      supports_reasoning: modelSettingsDraft.supports_reasoning,
    };
    await desktopApi.saveModelSettings({
      provider: modelSettingsDraft.provider,
      base_url: modelSettingsDraft.base_url,
      model_id: modelSettingsDraft.model_id,
      display_name: modelSettingsDraft.display_name,
      ...nextConfig,
    });
    setAvailableModels((current) => current.map((model) => (
      model.id === modelSettingsDraft.model_id
        ? {
            ...model,
            display_name: modelSettingsDraft.display_name || model.display_name,
            supports_json_mode: nextConfig.supports_json_mode,
            supports_tool_calling: nextConfig.supports_tool_calling,
            supports_reasoning: nextConfig.supports_reasoning,
            config: nextConfig,
          }
        : model
    )));
    if (modelSettingsDraft.role === 'default') {
      setModelName(modelSettingsDraft.model_id);
    } else if (modelSettingsDraft.role === 'reasoning') {
      setReasoningModel(modelSettingsDraft.model_id);
    }
    setNotice(`${modelSettingsDraft.display_name || modelSettingsDraft.model_id} 配置已保存`);
    setModelSettingsDraft(null);
    await refreshAll();
  }

  async function saveTelegramDetail() {
    await desktopApi.saveTelegramConfig({ token: telegramToken, allowed_user_ids: telegramAllowed, enabled: telegramEnabled });
    setTelegramToken('');
    setNotice('Telegram 设置已保存');
    await refreshAll();
  }

  async function testTelegramDetail() {
    const result = await desktopApi.testTelegramConnection();
    setTestStatus(`Telegram：${formatStatus(result.status)}${result.error_summary ? ` · ${result.error_summary}` : ''}`);
  }

  async function sendTelegramTest() {
    const result = await desktopApi.sendTestTelegramMessage({ chat_id: telegramChatID, message: 'Joi 桌面端 Telegram 测试' });
    setTestStatus(`Telegram 消息：${formatStatus(result.status)}${result.error_summary ? ` · ${result.error_summary}` : ''}`);
  }

  async function setupIMessageDetail() {
    if (!imessagePhone.trim()) {
      setTestStatus('iMessage：请先填写你的 E.164 手机号，例如 +15551234567');
      return;
    }
    setIMessageSetupBusy(true);
    setTestStatus('iMessage：等待 Photon 浏览器授权');
    try {
      const result = await desktopApi.setupPhotonIMessage({
        phone_number: imessagePhone.trim(),
        project_name: 'Joi',
        timeout_seconds: 600,
      });
      setIMessageEnabled(true);
      setIMessageProjectID(result.project_id);
      setIMessagePhone(result.operator_phone || imessagePhone);
      setIMessageAssignedNumber(result.assigned_number || '');
      setIMessageHomeChannel(result.operator_phone || imessagePhone);
      setIMessageAllowed(result.operator_phone || imessagePhone);
      setTestStatus(`iMessage：Photon 已配置 · ${result.assigned_number || '等待分配号码'}`);
      setNotice('iMessage 已通过 Photon 配置完成');
      await refreshAll();
      await refreshIMessageStatus();
    } catch (error) {
      const message = `iMessage：配置失败 · ${error instanceof Error ? error.message : String(error)}`;
      setTestStatus(message);
      setNotice(message);
    } finally {
      setIMessageSetupBusy(false);
    }
  }

  async function saveIMessageDetail() {
    await desktopApi.saveIMessageConfig({
      project_id: imessageProjectID,
      project_secret: imessageProjectSecret,
      dashboard_token: imessageDashboardToken,
      phone_number: imessagePhone,
      assigned_number: imessageAssignedNumber,
      home_channel: imessageHomeChannel,
      allowed_users: imessageAllowed,
      require_mention: imessageRequireMention,
      enabled: imessageEnabled,
      sidecar_port: Number(imessageSidecarPort) || 8790,
    });
    setIMessageProjectSecret('');
    setIMessageDashboardToken('');
    setNotice('iMessage 设置已保存');
    await refreshAll();
    await refreshIMessageStatus();
  }

  async function refreshIMessageStatus() {
    const status = await desktopApi.getIMessageStatus();
    setIMessageStatus(status);
    return status;
  }

  async function testIMessageDetail() {
    const result = await desktopApi.testIMessageConnection();
    const status = await refreshIMessageStatus();
    setTestStatus(`iMessage：${formatStatus(result.status)}${result.error_summary ? ` · ${result.error_summary}` : status.connected ? ' · sidecar connected' : ''}`);
  }

  async function sendIMessageTest() {
    const result = await desktopApi.sendTestIMessageMessage({ space_id: imessageTestSpaceID, message: 'Joi 桌面端 iMessage 测试' });
    setTestStatus(`iMessage 消息：${formatStatus(result.status)}${result.error_summary ? ` · ${result.error_summary}` : ''}`);
  }

  async function saveWorkerGateway() {
    await desktopApi.saveOperationalSettings({
      telegram_enabled: settings?.telegram_enabled ?? false,
      telegram_allowed_user_ids: settings?.telegram_allowed_user_ids ?? '',
      imessage_enabled: settings?.imessage_enabled ?? false,
      imessage_allowed_users: settings?.imessage_allowed_users ?? '',
      imessage_require_mention: settings?.imessage_require_mention ?? false,
      imessage_home_channel: settings?.imessage_home_channel ?? '',
      worker_gateway_enabled: workerGatewayEnabled,
      backup_dir: settings?.backup_dir ?? '',
      auto_backup_enabled: settings?.auto_backup_enabled ?? false,
    });
    setNotice('工作节点网关设置已保存');
    await refreshAll();
  }

  async function saveSecret() {
    await desktopApi.saveSecret({ name: secretName, value: secretValue });
    setSecretValue('');
    setNotice(`${secretName} 已保存到钥匙串`);
    await refreshAll();
  }

  async function editAndConfirm(memory: MemoryRecord) {
    const edited = window.prompt('确认前编辑记忆', memory.content);
    if (edited === null) return;
    await updateMemory(memory.id, 'edit_confirm', { content: edited, summary: memory.summary });
  }

  function selectedAutomation(): AutomationDefinition | undefined {
    return automations.find((automation) => automation.id === activeObject.id);
  }

  function buildAutomationTriggerConfig(kind: 'schedule' | 'webhook'): Record<string, unknown> {
    if (kind === 'webhook') {
      return automationDedupField.trim() ? { dedup_json_field: automationDedupField.trim() } : {};
    }
    const base = automationTimezone.trim() ? { timezone: automationTimezone.trim() } : {};
    if (automationScheduleType === 'cron') return { ...base, type: 'cron', expression: automationCron.trim() || '0 9 * * *' };
    if (automationScheduleType === 'daily') return { ...base, type: 'daily', time: automationTime || '09:00' };
    if (automationScheduleType === 'weekly') return { ...base, type: 'weekly', weekday: Number(automationWeekday) || 1, time: automationTime || '09:00' };
    if (automationScheduleType === 'once') return { ...base, type: 'once', run_at: automationOnceAt };
    return { ...base, type: 'interval', every_minutes: Math.max(1, Number(automationIntervalMinutes) || 60) };
  }

  async function saveAutomation(kind: 'schedule' | 'webhook') {
    setAutomationBusy('save');
    try {
      const existing = selectedAutomation();
      const automation = await desktopApi.saveAutomation({
        id: existing?.id,
        kind,
        name: automationName.trim() || (kind === 'webhook' ? 'Webhook 自动化' : '定时自动化'),
        slug: automationSlug.trim() || undefined,
        enabled: existing?.enabled ?? true,
        trigger_config: buildAutomationTriggerConfig(kind),
        prompt_template: automationPrompt,
        input_mode: 'background_task',
        permission_profile: 'read_only',
        preferred_node: 'main-node',
        allow_worker: false,
        dedup_policy: kind === 'webhook' && automationDedupField.trim() ? { dedup_json_field: automationDedupField.trim() } : {},
        retry_policy: { max_attempts: 2, backoff_seconds: [60, 300], no_retry_error_codes: ['POLICY_DENIED', 'INVALID_PAYLOAD', 'PENDING_CONFIRMATION'] },
        max_concurrency: 1,
      });
      setNotice(`${automation.name} 已保存`);
      selectSettingsObject('automations', automation.id);
      await refreshAll();
    } finally {
      setAutomationBusy('');
    }
  }

  async function setAutomationEnabled(id: string, enabled: boolean) {
    setAutomationBusy(`enable:${id}`);
    try {
      await desktopApi.setAutomationEnabled({ id, enabled });
      setNotice(enabled ? '自动化已启用' : '自动化已停用');
      await refreshAll();
    } finally {
      setAutomationBusy('');
    }
  }

  async function triggerAutomationNow(id: string) {
    setAutomationBusy(`run:${id}`);
    try {
      await desktopApi.triggerAutomationNow({ id, payload: { manual: true, requested_from: 'desktop_settings' } });
      setNotice('已加入自动化队列');
      await refreshAll();
    } finally {
      setAutomationBusy('');
    }
  }

  async function deleteAutomation(id: string) {
    const ok = window.confirm('删除后会保留历史 trigger/run，但不再接受新触发。确定继续？');
    if (!ok) return;
    await desktopApi.deleteAutomation(id);
    selectSettingsObject('automations', 'new-schedule');
    setNotice('自动化已删除');
    await refreshAll();
  }

  async function loadAutomationEndpoint(id: string) {
    const endpoint = await desktopApi.getAutomationWebhookEndpoint(id);
    setAutomationEndpoint(endpoint);
    return endpoint;
  }

  async function copyAutomationEndpoint(id: string) {
    const endpoint = automationEndpoint?.automation_id === id ? automationEndpoint : await loadAutomationEndpoint(id);
    await navigator.clipboard?.writeText(endpoint.url);
    setNotice('Webhook URL 已复制');
  }

  async function rotateAutomationWebhookSecret(id: string) {
    const endpoint = await desktopApi.rotateAutomationWebhookSecret(id);
    setAutomationEndpoint(endpoint);
    if (endpoint.secret_value_once) {
      await navigator.clipboard?.writeText(endpoint.secret_value_once);
      setNotice('Webhook secret 已轮换并复制；离开此页后不会再次显示');
      return;
    }
    setNotice('Webhook secret 已轮换');
  }

  async function copyAutomationSecret() {
    if (!automationEndpoint?.secret_value_once) {
      setNotice('Secret 只在轮换后一次性可复制；如需新值请再次轮换');
      return;
    }
    await navigator.clipboard?.writeText(automationEndpoint.secret_value_once);
    setNotice('Webhook secret 已复制');
  }

  async function testAutomationWebhook(id: string) {
    await desktopApi.testAutomationWebhook({ id, payload: { event_id: `test_${Date.now()}`, source: 'desktop_settings' } });
    setNotice('Webhook 测试触发已入队');
    await refreshAll();
  }

  function renderModelDetail() {
    const visibleAvailableModels = savedModelsForProvider(availableModels, provider, modelBaseURL);
    return (
      <section className="settings-detail-panel">
        <DetailHeader title={activeObject.label} description={`配置 ${activeObject.label} API 连接与模型参数`} />
        <div className="settings-form">
          <label className="field-row">
            <span>接口地址</span>
            <input value={modelBaseURL} onChange={(event) => setModelBaseURL(event.target.value)} />
          </label>
          <label className="field-row">
            <span>API Key</span>
            <SecretInput
              placeholder="留空表示使用已保存密钥"
              value={modelApiKey}
              visible={modelApiKeyVisible}
              onChange={setModelApiKey}
              onToggleVisible={() => setModelApiKeyVisible((value) => !value)}
            />
          </label>
          <div className="field-row">
            <span>连接状态</span>
            <div className="connection-status">
              <span className={`live-dot ${settings?.model_name ? 'on' : ''}`} />
              <strong>{settings?.model_name ? '已配置' : '未配置'}</strong>
              <button type="button" onClick={testModelDetail}>测试连接</button>
              <button type="button" onClick={fetchModelList}>获取模型</button>
              {activeObject.id === 'grok' && (
                <button type="button" onClick={loginXAIOAuthDetail} disabled={xaiLoginBusy}>
                  {xaiLoginBusy ? '等待 xAI 授权' : '登录 xAI'}
                </button>
              )}
            </div>
          </div>
          {visibleAvailableModels.length > 0 && (
            <div className="field-row model-list-row">
              <span>可用模型</span>
              <ModelList models={visibleAvailableModels} onConfigure={openModelSettings} />
            </div>
          )}
          {modelSettingsDraft && (
            <ModelSettingsDialog
              draft={modelSettingsDraft}
              model={visibleAvailableModels.find((model) => model.id === modelSettingsDraft.model_id)}
              onChange={setModelSettingsDraft}
              onClose={() => setModelSettingsDraft(null)}
              onSave={saveModelSettings}
            />
          )}
          <div className="detail-actions">
            <button className="secondary-button" type="button" onClick={() => {
              setModelBaseURL(modelPreset.baseURL);
              setModelName(modelPreset.defaultModel);
              setReasoningModel(modelPreset.reasoningModel);
            }}>重置</button>
            <button type="button" onClick={saveModelDetail}>保存</button>
          </div>
          <details className="settings-advanced">
            <summary>高级参数</summary>
            <div className="settings-form compact">
              <label className="field-row">
                <span>超时</span>
                <input value={modelTimeout} onChange={(event) => setModelTimeout(event.target.value)} />
              </label>
              <label className="field-row">
                <span>重试次数</span>
                <input value={modelRetryCount} onChange={(event) => setModelRetryCount(event.target.value)} />
              </label>
              <label className="field-row">
                <span>温度</span>
                <input value={modelTemperature} onChange={(event) => setModelTemperature(event.target.value)} />
              </label>
              <label className="field-row">
                <span>协议类型</span>
                <input value={provider} onChange={(event) => setProvider(event.target.value)} />
              </label>
            </div>
          </details>
        </div>
      </section>
    );
  }

  function renderChatEntranceDetail() {
    if (activeObject.id === 'imessage') {
      const connected = imessageStatus?.connected ?? false;
      const sidecarRunning = imessageStatus?.sidecar_running ?? false;
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="iMessage" description="通过 Photon 托管线路接入 iMessage" />
          <div className="settings-form">
            <label className="field-row">
              <span>启用入口</span>
              <input checked={imessageEnabled} type="checkbox" onChange={(event) => setIMessageEnabled(event.target.checked)} />
            </label>
            <label className="field-row">
              <span>我的手机号</span>
              <input placeholder="+15551234567" value={imessagePhone} onChange={(event) => setIMessagePhone(event.target.value)} />
            </label>
            <div className="field-row">
              <span>Photon Setup</span>
              <div className="connection-status">
                <button type="button" onClick={setupIMessageDetail} disabled={imessageSetupBusy}>
                  {imessageSetupBusy ? '等待授权' : '登录并配置 Photon'}
                </button>
                <small>会打开 Photon 授权页，完成 project、secret、手机号注册。</small>
              </div>
            </div>
            <label className="field-row">
              <span>Project ID</span>
              <input value={imessageProjectID} onChange={(event) => setIMessageProjectID(event.target.value)} />
            </label>
            <label className="field-row">
              <span>Project Secret</span>
              <SecretInput
                placeholder="留空表示使用已保存密钥"
                value={imessageProjectSecret}
                visible={imessageProjectSecretVisible}
                onChange={setIMessageProjectSecret}
                onToggleVisible={() => setIMessageProjectSecretVisible((value) => !value)}
              />
            </label>
            <label className="field-row">
              <span>Dashboard Token</span>
              <SecretInput
                placeholder="可选；一键 setup 后会自动保存"
                value={imessageDashboardToken}
                visible={imessageDashboardTokenVisible}
                onChange={setIMessageDashboardToken}
                onToggleVisible={() => setIMessageDashboardTokenVisible((value) => !value)}
              />
            </label>
            <label className="field-row">
              <span>分配号码</span>
              <input value={imessageAssignedNumber} onChange={(event) => setIMessageAssignedNumber(event.target.value)} />
            </label>
            <label className="field-row">
              <span>默认会话</span>
              <input placeholder="E.164 手机号或 Photon space id" value={imessageHomeChannel} onChange={(event) => setIMessageHomeChannel(event.target.value)} />
            </label>
            <label className="field-row">
              <span>允许用户</span>
              <input placeholder="+15551234567,+15557654321" value={imessageAllowed} onChange={(event) => setIMessageAllowed(event.target.value)} />
            </label>
            <label className="field-row">
              <span>群聊唤醒</span>
              <input checked={imessageRequireMention} type="checkbox" onChange={(event) => setIMessageRequireMention(event.target.checked)} />
            </label>
            <label className="field-row">
              <span>Sidecar 端口</span>
              <input inputMode="numeric" value={imessageSidecarPort} onChange={(event) => setIMessageSidecarPort(event.target.value)} />
            </label>
            <label className="field-row">
              <span>测试会话</span>
              <input placeholder="留空使用默认会话" value={imessageTestSpaceID} onChange={(event) => setIMessageTestSpaceID(event.target.value)} />
            </label>
            <div className="field-row">
              <span>连接状态</span>
              <div className="connection-status">
                <span className={`live-dot ${connected ? 'on' : ''}`} />
                <strong>{connected ? '已连接' : imessageEnabled ? '未连接' : '未启用'}</strong>
                <small>{testStatus || (sidecarRunning ? 'Photon sidecar running' : 'Photon sidecar idle')}</small>
                <button type="button" onClick={testIMessageDetail}>测试连接</button>
                <button type="button" onClick={sendIMessageTest}>发送测试消息</button>
              </div>
            </div>
            <div className="detail-actions">
              <button className="secondary-button" type="button" onClick={() => {
                setIMessageProjectSecret('');
                setIMessageDashboardToken('');
              }}>清空密钥输入</button>
              <button type="button" onClick={saveIMessageDetail}>保存</button>
            </div>
            <CollapsedData label="高级详情" value={{
              enabled: imessageEnabled,
              project_id: imessageProjectID,
              assigned_number: imessageAssignedNumber,
              allowed_users: imessageAllowed,
              require_mention: imessageRequireMention,
              sidecar_port: imessageSidecarPort,
              status: imessageStatus,
            }} />
          </div>
        </section>
      );
    }

    if (activeObject.id !== 'telegram') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title={activeObject.label} description={`${activeObject.label} 入口配置`} />
          <div className="settings-form">
            <label className="field-row">
              <span>启用入口</span>
              <input type="checkbox" />
            </label>
            <label className="field-row">
              <span>入口标识</span>
              <input placeholder={`${activeObject.label} 暂未配置`} />
            </label>
            <div className="field-row">
              <span>连接状态</span>
              <div className="connection-status">
                <span className="live-dot" />
                <strong>未配置</strong>
                <small>该入口后续接入真实配置项</small>
              </div>
            </div>
            <div className="detail-actions">
              <button className="secondary-button" type="button">重置</button>
              <button type="button">保存</button>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="settings-detail-panel">
        <DetailHeader title="Telegram" description="配置 Telegram Bot、白名单与测试消息" />
        <div className="settings-form">
          <label className="field-row">
            <span>启用入口</span>
            <input checked={telegramEnabled} type="checkbox" onChange={(event) => setTelegramEnabled(event.target.checked)} />
          </label>
          <label className="field-row">
            <span>机器人令牌</span>
            <SecretInput
              placeholder="留空表示不更新令牌"
              value={telegramToken}
              visible={telegramTokenVisible}
              onChange={setTelegramToken}
              onToggleVisible={() => setTelegramTokenVisible((value) => !value)}
            />
          </label>
          <label className="field-row">
            <span>允许用户 ID</span>
            <input value={telegramAllowed} onChange={(event) => setTelegramAllowed(event.target.value)} />
          </label>
          <label className="field-row">
            <span>测试会话 ID</span>
            <input value={telegramChatID} onChange={(event) => setTelegramChatID(event.target.value)} />
          </label>
          <div className="field-row">
            <span>连接状态</span>
            <div className="connection-status">
              <span className={`live-dot ${settings?.telegram_enabled ? 'on' : ''}`} />
              <strong>{settings?.telegram_enabled ? '已启用' : '未启用'}</strong>
              <small>{testStatus || 'Telegram Bot 连接状态'}</small>
              <button type="button" onClick={testTelegramDetail}>测试机器人</button>
              <button type="button" onClick={sendTelegramTest}>发送测试消息</button>
            </div>
          </div>
          <div className="detail-actions">
            <button className="secondary-button" type="button" onClick={() => setTelegramToken('')}>清空令牌输入</button>
            <button type="button" onClick={saveTelegramDetail}>保存</button>
          </div>
          <CollapsedData label="高级详情" value={{ enabled: telegramEnabled, allowed_user_ids: telegramAllowed }} />
        </div>
      </section>
    );
  }

  function renderAutomationDetail() {
    const existing = selectedAutomation();
    const kind = existing?.kind ?? (activeObject.id === 'new-webhook' ? 'webhook' : 'schedule');
    const automationState = getAutomationDetailState({
      automation: existing,
      triggers: automationTriggers,
      runs: automationRuns,
      endpoint: automationEndpoint,
    });
    const { recentTriggers, recentRuns } = automationState;
    return (
      <section className="settings-detail-panel">
        <DetailHeader title={existing ? existing.name : kind === 'webhook' ? '新建 Hook 任务' : '新建定时任务'} description={kind === 'webhook' ? '本地 HMAC Webhook 触发后台任务' : 'Joi.app 打开时运行的定时后台任务'} />
        <div className="settings-form">
          <label className="field-row">
            <span>名称</span>
            <input value={automationName} onChange={(event) => setAutomationName(event.target.value)} />
          </label>
          <label className="field-row">
            <span>Slug</span>
            <input placeholder="留空自动生成" value={automationSlug} onChange={(event) => setAutomationSlug(event.target.value)} />
          </label>
          {kind === 'schedule' ? (
            <>
              <label className="field-row">
                <span>触发类型</span>
                <select value={automationScheduleType} onChange={(event) => setAutomationScheduleType(event.target.value)}>
                  <option value="interval">Interval</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="cron">Cron</option>
                  <option value="once">Once</option>
                </select>
              </label>
              {automationScheduleType === 'interval' && (
                <label className="field-row">
                  <span>间隔分钟</span>
                  <input value={automationIntervalMinutes} onChange={(event) => setAutomationIntervalMinutes(event.target.value)} />
                </label>
              )}
              {automationScheduleType === 'cron' && (
                <label className="field-row">
                  <span>Cron</span>
                  <input value={automationCron} onChange={(event) => setAutomationCron(event.target.value)} />
                </label>
              )}
              {(automationScheduleType === 'daily' || automationScheduleType === 'weekly') && (
                <label className="field-row">
                  <span>时间</span>
                  <input value={automationTime} onChange={(event) => setAutomationTime(event.target.value)} />
                </label>
              )}
              {automationScheduleType === 'weekly' && (
                <label className="field-row">
                  <span>星期</span>
                  <select value={automationWeekday} onChange={(event) => setAutomationWeekday(event.target.value)}>
                    <option value="1">周一</option>
                    <option value="2">周二</option>
                    <option value="3">周三</option>
                    <option value="4">周四</option>
                    <option value="5">周五</option>
                    <option value="6">周六</option>
                    <option value="0">周日</option>
                  </select>
                </label>
              )}
              {automationScheduleType === 'once' && (
                <label className="field-row">
                  <span>运行时间</span>
                  <input placeholder="2026-06-24T09:00:00+08:00" value={automationOnceAt} onChange={(event) => setAutomationOnceAt(event.target.value)} />
                </label>
              )}
              <label className="field-row">
                <span>时区</span>
                <input placeholder="默认本机时区" value={automationTimezone} onChange={(event) => setAutomationTimezone(event.target.value)} />
              </label>
            </>
          ) : (
            <label className="field-row">
              <span>Dedup JSON 字段</span>
              <input placeholder="event_id" value={automationDedupField} onChange={(event) => setAutomationDedupField(event.target.value)} />
            </label>
          )}
          <label className="field-row">
            <span>Prompt</span>
            <textarea value={automationPrompt} onChange={(event) => setAutomationPrompt(event.target.value)} rows={5} />
          </label>
          <div className="detail-actions">
            <button type="button" onClick={() => void saveAutomation(kind)} disabled={automationBusy === 'save'}>{automationBusy === 'save' ? '保存中' : '保存'}</button>
            {existing && (
              <>
                <button className="secondary-button" type="button" onClick={() => void setAutomationEnabled(existing.id, !existing.enabled)} disabled={automationBusy === `enable:${existing.id}`}>
                  {existing.enabled ? '停用' : '启用'}
                </button>
                <button className="secondary-button" type="button" onClick={() => void triggerAutomationNow(existing.id)} disabled={automationBusy === `run:${existing.id}`}>立即运行</button>
                <button className="danger" type="button" onClick={() => void deleteAutomation(existing.id)}>删除</button>
              </>
            )}
          </div>
        </div>
        {existing && (
          <>
            <dl className="compact-kv">
              <KV label="状态" value={existing.enabled ? '已启用' : '已停用'} />
              <KV label="权限" value={existing.permission_profile} />
              <KV label="输入模式" value={existing.input_mode} />
              <KV label="下次触发" value={existing.next_fire_at || '未计算'} />
              <KV label="上次触发" value={existing.last_fire_at || '无'} />
              <KV label="最近运行" value={formatStatus(automationState.lastRunStatus)} />
            </dl>
            {automationState.banner && (
              <p className={automationState.banner.tone === 'error' ? 'terminal-error' : 'logs-notice'}>
                {automationState.banner.title} · {automationState.banner.message}
              </p>
            )}
            {existing.kind === 'webhook' && (
              <section>
                <h3>Webhook</h3>
                <div className="detail-actions">
                  <button type="button" onClick={() => void loadAutomationEndpoint(existing.id)}>显示 URL</button>
                  <button type="button" onClick={() => void copyAutomationEndpoint(existing.id)}>复制 URL</button>
                  <button type="button" onClick={() => void rotateAutomationWebhookSecret(existing.id)}>轮换 Secret</button>
                  {automationState.secretValueAvailable && <button type="button" onClick={() => void copyAutomationSecret()}>复制 Secret</button>}
                  <button type="button" onClick={() => void testAutomationWebhook(existing.id)}>测试 Hook</button>
                </div>
                {automationEndpoint?.automation_id === existing.id && (
                  <dl className="compact-kv">
                    <KV label="URL" value={automationState.webhookUrl || automationEndpoint.url} />
                    <KV label="Secret Ref" value={automationEndpoint.secret_ref || '未设置'} />
                    <KV label="Secret" value={automationState.secretConfigured ? '已配置' : '未配置'} />
                    {automationState.secretValueAvailable && <KV label="New Secret" value="已生成并可复制一次" />}
                  </dl>
                )}
              </section>
            )}
            <section>
              <h3>Recent Triggers</h3>
              <RecordList
                emptyText="暂无 trigger。"
                items={recentTriggers}
                renderItem={(trigger) => (
                  <article key={trigger.id} className="row-card compact">
                    <strong>{formatStatus(trigger.status)}</strong>
                    <small>{trigger.trigger_type} · {trigger.dedup_key}</small>
                    <small>{trigger.created_at || ''}</small>
                    {trigger.error_message && <small>{trigger.error_code || 'ERROR'} · {trigger.error_message}</small>}
                    <CollapsedData label="Payload" value={trigger.payload} />
                  </article>
                )}
              />
            </section>
            <section>
              <h3>Recent Runs</h3>
              <RecordList
                emptyText="暂无 run。"
                items={recentRuns}
                renderItem={(run) => (
                  <article key={run.id} className="row-card compact">
                    <strong>{formatStatus(run.status)}</strong>
                    <small>attempt {run.attempt_number} · run {run.run_id || 'pending'}</small>
                    <small>{run.output_summary || run.error_message || run.created_at || ''}</small>
                  </article>
                )}
              />
            </section>
          </>
        )}
      </section>
    );
  }

  function renderObservabilityDetail() {
    if (activeObject.id === 'token-usage') {
      return <CostsPanel calls={calls} health={health} usage={usage} />;
    }
    if (activeObject.id === 'log-cleanup') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="日志清理" description="预览并清理日志、Run Trace、tool/model 与 worker audit 记录" />
          <DiagnosticsLogCleanup onNotice={setNotice} />
        </section>
      );
    }
    return (
      <section className="settings-detail-panel">
        <DetailHeader title="日志" description="筛选本地 app logs、Run Trace 与 worker audit 记录" />
        <CompanionLogsPanel runID={trace?.id} />
      </section>
    );
  }

  function renderMemoryDetail() {
    if (activeObject.id === 'memory-inbox') {
      return (
        <MemoryObjectDetail
          emptyText="暂无待处理记忆。"
          memories={inbox}
          title="待确认记忆"
          description="审核 Joi 准备写入长期记忆的候选内容"
          updateMemory={updateMemory}
          editAndConfirm={editAndConfirm}
          mode="inbox"
        />
      );
    }
    if (activeObject.id === 'confirmed-memory') {
      return (
        <MemoryObjectDetail
          emptyText="暂无已确认记忆。"
          memories={confirmedMemories}
          title="已确认记忆"
          description="已经进入长期记忆库、可被后续对话召回的内容"
          updateMemory={updateMemory}
          mode="confirmed"
        />
      );
    }
    if (activeObject.id === 'conflict-memory') {
      return (
        <MemoryObjectDetail
          emptyText="暂无冲突记忆。"
          memories={conflictedMemories}
          title="冲突记忆"
          description="需要合并、纠正或停用的记忆条目"
          updateMemory={updateMemory}
          mode="conflict"
        />
      );
    }
    if (activeObject.id === 'memory-search') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="记忆搜索" description="检索长期记忆内容、摘要与类型" />
          <div className="detail-toolbar">
            <input placeholder="搜索记忆" value={memoryQuery} onChange={(event) => setMemoryQuery(event.target.value)} />
            <button type="button" onClick={refreshAll}>搜索</button>
          </div>
          <MemoryObjectDetail emptyText="没有匹配的记忆。" memories={searchedMemories} updateMemory={updateMemory} mode="confirmed" />
        </section>
      );
    }
    if (activeObject.id === 'archived-conversations') {
      return (
        <ConversationLifecycleSettingsList
          conversations={archivedConversations}
          emptyText="暂无归档会话。"
          mode="archived"
          restoreConversation={restoreConversation}
          title="归档会话"
          trashConversation={trashConversation}
        />
      );
    }
    if (activeObject.id === 'trashed-conversations') {
      return (
        <ConversationLifecycleSettingsList
          conversations={trashedConversations}
          emptyText="回收站为空。"
          mode="trash"
          purgeConversation={purgeConversation}
          restoreConversation={restoreConversation}
          title="回收站"
        />
      );
    }
    if (activeObject.id === 'local-data') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="本地数据" description="查看本地 SQLite、日志与备份位置" />
          <dl className="metrics local-data-metrics">
            <KV label="SQLite 路径" value={settings?.sqlite_path ?? '未设置'} />
            <KV label="日志目录" value={settings?.log_dir ?? '未设置'} />
            <KV label="备份目录" value={settings?.backup_dir ?? '未设置'} />
            <KV label="数据存储" value={settings?.data_store ?? 'sqlite'} />
          </dl>
          <CollapsedData label="高级详情" value={{ sqlite_path: settings?.sqlite_path, log_dir: settings?.log_dir, backup_dir: settings?.backup_dir }} />
        </section>
      );
    }
    return (
      <section className="settings-detail-panel">
        <DetailHeader title="数据维护" description="创建、恢复和检查本地数据备份" />
        <div className="detail-toolbar">
          <button type="button" onClick={createBackup}>创建备份</button>
          <input placeholder="输入备份路径" value={restorePath} onChange={(event) => setRestorePath(event.target.value)} />
          <button disabled={!restorePath.trim()} type="button" onClick={() => restoreBackup(restorePath.trim())}>恢复</button>
        </div>
        <RecordList
          emptyText="暂无备份。"
          items={backups}
          renderItem={(backup) => (
            <article key={backup.path} className="row-card compact">
              <strong>{backup.name}</strong>
              <small>{backup.modified} · {Math.round(backup.size / 1024)} KB</small>
              <small>{backup.path}</small>
              {backup.manifest ? <CollapsedData label="查看备份清单" value={backup.manifest} /> : null}
              <button type="button" onClick={() => restoreBackup(backup.path)}>恢复</button>
            </article>
          )}
        />
      </section>
    );
  }

  function renderCapabilitiesDetail() {
    const latestRuns = toolRuns.slice(0, 8);
    const metadataValue = (capability: CapabilityRecord, key: string) => {
      const metadata = capability.metadata ?? {};
      const contract = (metadata.contract && typeof metadata.contract === 'object' ? metadata.contract : {}) as Record<string, unknown>;
      return metadata[key] ?? contract[key];
    };
    const metadataArray = (capability: CapabilityRecord, key: string) => {
      const value = metadataValue(capability, key);
      return Array.isArray(value) ? value.map((item) => String(item)) : [];
    };
    const sourceFor = (capability: CapabilityRecord) => String(metadataValue(capability, 'source') ?? 'native');
    const nativeCapabilities = capabilities.filter((capability) => sourceFor(capability) === 'native');
    const mcpWrappedCapabilities = capabilities.filter((capability) => sourceFor(capability) === 'mcp_wrapped');
    return (
      <section className="settings-detail-panel">
        <DetailHeader title="Capability Console" description="查看能力、workflow、运行记录和 workspace 边界" />
        <dl className="metrics">
          <KV label="能力" value={`${capabilities.length} 个`} />
          <KV label="Workflow" value={`${workflows.length} 个`} />
          <KV label="MCP Server" value={`${mcpServers.length} 个`} />
          <KV label="Skills" value={`${skills.length} 个`} />
          <KV label="最近工具运行" value={`${toolRuns.length} 条`} />
          <KV label="默认根目录" value={workspaceSettings?.default_root ?? '未设置'} />
        </dl>

        <h3>Native Capabilities</h3>
        <div className="capability-grid">
          {nativeCapabilities.map((capability) => (
            <article key={capability.id} className="row-card compact capability-contract-card">
              <div className="capability-contract-title">
                <strong>{capability.id}</strong>
                <small>{capability.enabled ? '已启用' : '已停用'}</small>
              </div>
              <p>{capability.description || '未记录描述'}</p>
              <dl className="compact-kv">
                <KV label="intent" value={String(metadataValue(capability, 'intent_domain') ?? '未设置')} />
                <KV label="risk" value={formatRiskLevel(String(metadataValue(capability, 'risk_level') ?? capability.risk_level))} />
                <KV label="privacy" value={String(metadataValue(capability, 'privacy_level') ?? 'public')} />
                <KV label="workflow" value={String(metadataValue(capability, 'workflow_id') ?? '未绑定')} />
              </dl>
              <CollapsedData
                label="查看 contract"
                value={{
                  positive_examples: metadataArray(capability, 'positive_examples'),
                  negative_examples: metadataArray(capability, 'negative_examples'),
                  input_schema: metadataValue(capability, 'input_schema') ?? {},
                  output_schema: metadataValue(capability, 'output_schema') ?? {},
                }}
              />
            </article>
          ))}
          {nativeCapabilities.length === 0 && <p className="empty">暂无 Native capability。</p>}
        </div>

        <h3>MCP</h3>
        <RecordList
          emptyText="暂无 MCP server。"
          items={mcpServers}
          renderItem={(server) => (
            <article key={server.id} className="row-card">
              <div>
                <strong>{server.name}</strong>
                <p>{server.transport} · {formatStatus(server.status)} · trust：{server.trust}</p>
                <small>Tools：{server.tools.length} · Resources：{server.resources.length} · Prompts：{server.prompts.length}</small>
                <small>MCP tool 只做 inventory，同步后仍需 wrapped capability 授权。</small>
                {server.tools.length > 0 && (
                  <div className="inline-chip-list">
                    {server.tools.map((tool) => (
                      <button key={tool.name} type="button" className="mini-button" onClick={() => wrapMCPTool(server, tool.name)} disabled={Boolean(tool.wrapped_as)}>
                        {tool.wrapped_as ? `已授权 ${tool.wrapped_as}` : `Wrap ${tool.name}`}
                      </button>
                    ))}
                  </div>
                )}
                <CollapsedData label="查看 MCP inventory" value={{ tools: server.tools, resources: server.resources, prompts: server.prompts, metadata: server.metadata }} />
              </div>
              <div className="row-actions">
                <button type="button" onClick={() => syncMCPServer(server.id)}>刷新 inventory</button>
              </div>
            </article>
          )}
        />

        {mcpWrappedCapabilities.length > 0 ? (
          <>
            <h3>MCP-wrapped Capabilities</h3>
            <div className="capability-grid">
              {mcpWrappedCapabilities.map((capability) => (
                <article key={capability.id} className="row-card compact capability-contract-card">
                  <strong>{capability.id}</strong>
                  <p>{capability.description || '未记录描述'}</p>
                  <small>{formatRiskLevel(capability.risk_level)} · {String(metadataValue(capability, 'privacy_level') ?? 'public')}</small>
                  <CollapsedData label="查看 wrapped contract" value={capability.metadata ?? {}} />
                </article>
              ))}
            </div>
          </>
        ) : null}

        <h3>Skills</h3>
        <RecordList
          emptyText="暂无 Skill。"
          items={skills}
          renderItem={(skill) => (
            <article key={skill.id} className="row-card compact">
              <strong>{skill.name}</strong>
              <p>{skill.description}</p>
              <small>{skill.id} · v{skill.version} · {skill.enabled ? '已启用' : '已停用'}</small>
              <small>Required：{skill.required_capabilities.join('、') || '无'} · Forbidden：{skill.forbidden_capabilities.join('、') || '无'}</small>
              <CollapsedData label="查看 Skill contract" value={{ trigger_phrases: skill.trigger_phrases, output_contract: skill.output_contract, metadata: skill.metadata }} />
            </article>
          )}
        />

        <h3>Tool Workflows</h3>
        <RecordList
          emptyText="暂无 workflow。"
          items={workflows}
          renderItem={(workflow) => (
            <article key={workflow.id} className="row-card">
              <div>
                <strong>{workflow.name}</strong>
                <p>{workflow.capability_id} · {workflow.version} · {formatRiskLevel(workflow.risk_level)} · {formatStatus(workflow.enabled ? 'enabled' : 'disabled')}</p>
                <small>步骤：{workflow.steps.map((step) => step.tool).join(' -> ') || '无'}</small>
                <CollapsedData label="查看 workflow steps" value={workflow.steps} />
              </div>
              <div className="row-actions">
                <button type="button" onClick={() => setWorkflowEnabled(workflow.name, !workflow.enabled)}>
                  {workflow.enabled ? '停用' : '启用'}
                </button>
              </div>
            </article>
          )}
        />

        <h3>Workspace Settings</h3>
        <div className="settings-form compact">
          <div className="field-row">
            <span>Allowed Roots</span>
            <div className="connection-status">
              <strong>{workspaceSettings?.allowed_roots?.length ?? 0} 个</strong>
              <small>{workspaceSettings?.allowed_roots?.join('、') || '未设置'}</small>
            </div>
          </div>
          <div className="field-row">
            <span>Allowed Hosts</span>
            <div className="connection-status">
              <strong>{workspaceSettings?.browser_allowed_hosts?.length ?? 0} 个</strong>
              <small>{workspaceSettings?.browser_allowed_hosts?.join('、') || '默认禁止私有 host'}</small>
            </div>
          </div>
          <dl className="metrics">
            <KV label="私有 host" value={workspaceSettings?.web_research_allow_private_hosts ? '允许 allowlist' : '默认拒绝'} />
            <KV label="文件读取上限" value={`${workspaceSettings?.file_analyze_max_bytes ?? 0} bytes`} />
            <KV label="搜索结果上限" value={`${workspaceSettings?.workspace_search_max_results ?? 0} 条`} />
          </dl>
        </div>

        <h3>Recent Tool Runs</h3>
        <RecordList
          emptyText="暂无 tool run。"
          items={latestRuns}
          renderItem={(run) => (
            <article key={run.id} className="row-card compact">
              <strong>{run.workflow_name || run.tool_name} · {formatStatus(run.status)}</strong>
              <small>{run.capability_id || 'unknown'} · {run.node_id || 'main-node'} · {run.assignment_reason || '未记录'}</small>
              <small>{run.run_id || run.task_id || run.id}</small>
              <CollapsedData label="查看输出" value={run.output ?? {}} />
            </article>
          )}
        />
      </section>
    );
  }

  function renderNodeDetail() {
    const selectedNode = nodes.find((node) => node.id === activeObject.id);
    if (activeObject.id === 'worker-gateway') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="Worker Gateway" description="配置工作节点网关和令牌" />
          <div className="settings-form">
            <label className="field-row">
              <span>启用网关</span>
              <input checked={workerGatewayEnabled} type="checkbox" onChange={(event) => setWorkerGatewayEnabled(event.target.checked)} />
            </label>
            <div className="field-row">
              <span>网关状态</span>
              <div className="connection-status">
                <span className={`live-dot ${workerGatewayEnabled ? 'on' : ''}`} />
                <strong>{workerGatewayEnabled ? '已启用' : '已停用'}</strong>
                <small>工作节点通过网关注册并获取任务</small>
                <button type="button" onClick={rotateWorkerToken}>重置工作节点令牌</button>
              </div>
            </div>
            <div className="detail-actions">
              <button type="button" onClick={saveWorkerGateway}>保存</button>
            </div>
          </div>
        </section>
      );
    }
    if (activeObject.id === 'assignment-policy') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="分配策略" description="控制主节点和工作节点如何接收任务" />
          <div className="settings-form">
            <label className="field-row">
              <span>默认策略</span>
              <select defaultValue="main-first">
                <option value="main-first">主节点优先</option>
                <option value="auto">高峰期自动派发</option>
                <option value="manual">仅手动指定</option>
              </select>
            </label>
            <label className="field-row">
              <span>允许远端执行</span>
              <input type="checkbox" />
            </label>
            <details className="settings-advanced">
              <summary>高级参数</summary>
              <p className="empty">后续可加入队列阈值、重试策略和最小上下文策略。</p>
            </details>
          </div>
        </section>
      );
    }
    if (activeObject.id === 'node-audit') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="节点审计" description="查看工作节点注册、心跳和派发记录" />
          <RecordList
            emptyText="暂无节点审计记录。"
            items={audit}
            renderItem={(item) => (
              <article key={item.id} className="row-card compact">
                <strong>{item.node_id || '未知节点'} · {formatAction(item.action)} · {formatStatus(item.status)}</strong>
                <small>{item.reason}</small>
                {item.metadata ? <CollapsedData label="高级详情" value={item.metadata} /> : null}
              </article>
            )}
          />
        </section>
      );
    }
    return (
      <section className="settings-detail-panel">
        <DetailHeader title={activeObject.label} description={`${activeObject.label} 连接与权限配置`} />
        <dl className="metrics">
          <KV label="节点 ID" value={selectedNode?.id ?? activeObject.id} />
          <KV label="角色" value={selectedNode ? formatNodeRole(selectedNode.role) : '待注册'} />
          <KV label="状态" value={selectedNode ? formatStatus(selectedNode.status) : '未连接'} />
          <KV label="能力数量" value={String(selectedNode?.capabilities?.length ?? 0)} />
        </dl>
        <div className="settings-form">
          <label className="field-row">
            <span>自动分配</span>
            <input checked={selectedNode?.auto_assign_enabled ?? false} readOnly type="checkbox" />
          </label>
          <label className="field-row">
            <span>手动指定</span>
            <input checked={selectedNode?.manual_assign_enabled ?? false} readOnly type="checkbox" />
          </label>
          <div className="field-row">
            <span>节点操作</span>
            <div className="connection-status">
              <span className={`live-dot ${selectedNode?.status !== 'disabled' && selectedNode ? 'on' : ''}`} />
              <strong>{selectedNode ? formatStatus(selectedNode.status) : '未注册'}</strong>
              <small>能力：{(selectedNode?.capabilities ?? []).join('、') || '未注册'}</small>
              {selectedNode ? (
                selectedNode.status === 'disabled'
                  ? <button type="button" onClick={() => setNodeDisabled(selectedNode.id, false)}>启用</button>
                  : <button type="button" onClick={() => setNodeDisabled(selectedNode.id, true)}>停用</button>
              ) : null}
            </div>
          </div>
          {selectedNode?.metadata ? <CollapsedData label="高级详情" value={selectedNode.metadata} /> : null}
        </div>
      </section>
    );
  }

  function renderPrivacyDetail() {
    if (activeObject.id === 'secrets') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="密钥管理" description="保存和查看本地钥匙串中的密钥状态" />
          <div className="settings-form">
            <label className="field-row">
              <span>密钥类型</span>
              <select value={secretName} onChange={(event) => setSecretName(event.target.value)}>
                <option value="MODEL_API_KEY">MODEL_API_KEY</option>
                <option value="TELEGRAM_BOT_TOKEN">TELEGRAM_BOT_TOKEN</option>
                <option value="WORKER_TOKEN">WORKER_TOKEN</option>
                <option value="NODE_SECRET">NODE_SECRET</option>
                <option value="ADMIN_TOKEN">ADMIN_TOKEN</option>
              </select>
            </label>
            <label className="field-row">
              <span>密钥值</span>
              <SecretInput
                value={secretValue}
                visible={secretValueVisible}
                onChange={setSecretValue}
                onToggleVisible={() => setSecretValueVisible((value) => !value)}
              />
            </label>
            <div className="detail-actions">
              <button type="button" onClick={saveSecret}>保存</button>
            </div>
          </div>
          <div className="secret-status">
            {Object.entries(secretStatus?.secrets ?? {}).map(([name, present]) => (
              <span key={name}>{name}：{present ? '已配置' : '缺失'}</span>
            ))}
          </div>
        </section>
      );
    }
    if (activeObject.id === 'dangerous-actions') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="危险操作" description="审批高风险能力请求" />
          <RecordList
            emptyText="暂无待确认请求。"
            items={confirmations}
            renderItem={(item) => (
              <article key={item.id} className="row-card">
                <div>
                  <strong>{item.requested_action}</strong>
                  <p>{item.capability_id} · 风险 {formatRiskLevel(item.risk_level)} · {formatStatus(item.status)}</p>
                  <small>任务：{item.run_id}</small>
                  {item.input ? <CollapsedData label="查看请求参数" value={item.input} /> : null}
                </div>
                {item.status === 'pending' && (
                  <div className="row-actions">
                    <button type="button" onClick={() => decideConfirmation(item.id, true)}>批准</button>
                    <button type="button" onClick={() => decideConfirmation(item.id, false)}>拒绝</button>
                  </div>
                )}
              </article>
            )}
          />
        </section>
      );
    }
    return (
      <section className="settings-detail-panel">
        <DetailHeader title={activeObject.label} description={`${activeObject.label} 配置`} />
        <div className="capability-grid">
          <CapabilityToggle label="默认本地优先" enabled />
          <CapabilityToggle label="远端执行需确认" enabled />
          <CapabilityToggle label="诊断信息脱敏" enabled={activeObject.id === 'diagnostic-redaction'} />
          <CapabilityToggle label="破坏性操作禁止" enabled />
        </div>
      </section>
    );
  }

  function renderAdvancedDetail() {
    if (activeObject.id === 'diagnostics') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="诊断包" description="导出本地运行诊断信息" />
          <dl className="metrics">
            <KV label="SQLite" value={formatBoolean(Boolean(health?.service_status?.sqlite))} />
            <KV label="模型调用" value={String(health?.model_latency?.model_calls_today ?? 0)} />
            <KV label="工作节点" value={String(health?.worker_status?.length ?? 0)} />
            <KV label="警告" value={String(health?.warnings?.length ?? 0)} />
          </dl>
          <div className="detail-actions">
            <button type="button" onClick={async () => {
              const result = await desktopApi.exportDiagnostics();
              setNotice(`诊断信息已导出：${result.path}`);
            }}>导出诊断</button>
          </div>
          <DiagnosticsLogCleanup onNotice={setNotice} />
          <ClosureReportPanel
            continueProductTaskByID={continueProductTaskByID}
            externalHandoffAudit={externalHandoffAudit}
            report={closureReport}
          />
        </section>
      );
    }
    if (activeObject.id === 'raw-data') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="原始数据" description="调试数据默认折叠，避免干扰普通设置流程" />
          <CollapsedData label="系统状态" value={health ?? {}} />
          <CollapsedData label="运行设置" value={settings ?? {}} />
          <CollapsedData label="节点数据" value={nodes} />
          <CollapsedData label="用量数据" value={{ usage, calls }} />
          <CollapsedData label="闭环报告" value={closureReport ?? {}} />
        </section>
      );
    }
    if (activeObject.id === 'prompt-assembly') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="Prompt Assembly" description="查看最近运行的提示词组装信息" />
          <dl className="metrics">
            <KV label="任务 ID" value={trace?.id ?? '暂无'} />
            <KV label="步骤数" value={`${stepCount} 步`} />
            <KV label="模型" value={firstModelCall?.model_name ?? '无'} />
            <KV label="延迟" value={`${firstModelCall?.latency_ms ?? 0} ms`} />
          </dl>
          <RecordList
            emptyText="暂无提示词组装记录。"
            items={trace?.prompt_assemblies ?? []}
            renderItem={(item) => (
              <article key={item.id} className="row-card compact">
                <strong>提示词组装</strong>
                <small>缓存键：{item.prompt_cache_key || '无'}</small>
                <small>前缀：{item.prefix_hash || '无'} · 动态尾部：{item.dynamic_tail_hash || '无'}</small>
              </article>
            )}
          />
        </section>
      );
    }
    if (activeObject.id === 'memory-context-pack') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="Memory Context Pack" description="查看最近运行召回的记忆上下文" />
          <RecordList
            emptyText="暂无记忆上下文记录。"
            items={trace?.memory_context_packs ?? []}
            renderItem={(item) => (
              <article key={item.id} className="row-card compact">
                <strong>{item.memory_profile_version}</strong>
                <small>动态召回：{item.dynamic_retrieval?.length ?? 0} 条</small>
                <CollapsedData label="高级详情" value={item} />
              </article>
            )}
          />
        </section>
      );
    }
    return (
      <section className="settings-detail-panel">
        <DetailHeader title="Tool I/O" description="查看最近步骤的工具输入输出" />
        <RecordList
          emptyText="暂无工具输入输出。"
          items={trace?.steps ?? []}
          renderItem={(step) => (
            <article key={step.id} className="row-card compact">
              <strong>{formatStepType(step.step_type)}</strong>
              <small>{step.title} · {formatStatus(step.status)}</small>
              {step.input ? <CollapsedData label="查看输入" value={step.input} /> : null}
              {step.output ? <CollapsedData label="查看输出" value={step.output} /> : null}
            </article>
          )}
        />
      </section>
    );
  }

  function renderDetail() {
    if (activeCategory === 'models') return renderModelDetail();
    if (activeCategory === 'chatEntrances') return renderChatEntranceDetail();
    if (activeCategory === 'automations') return renderAutomationDetail();
    if (activeCategory === 'observability') return renderObservabilityDetail();
    if (activeCategory === 'dataMemory') return renderMemoryDetail();
    if (activeCategory === 'capabilities') return renderCapabilitiesDetail();
    if (activeCategory === 'nodesExecution') return renderNodeDetail();
    if (activeCategory === 'privacySecurity') return renderPrivacyDetail();
    return renderAdvancedDetail();
  }

  return (
    <div className="settings-console">
      <ScrollArea as="aside" className="settings-object-column">
        <div className="settings-object-list" aria-label={`${activeCategoryMeta.label}对象`}>
          {objectItems.map((item) => (
            <button
              key={item.id}
              className={`settings-object-item ${activeObject.id === item.id ? 'active' : ''}`}
              type="button"
              onClick={() => selectSettingsObject(activeCategory, item.id)}
            >
              <strong>{item.label}</strong>
            </button>
          ))}
        </div>
      </ScrollArea>
      <ScrollArea as="main" className="settings-detail">
        <header className="settings-detail-topbar">
          <span>{activeCategoryMeta.label}</span>
        </header>
        {renderDetail()}
      </ScrollArea>
    </div>
  );
}

type ModelProviderPreset = { provider: string; baseURL: string; defaultModel: string; reasoningModel: string; models: string[] };

const modelProviderPresets: Record<string, ModelProviderPreset> = {
  openai: {
    provider: 'openai',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1',
    reasoningModel: 'o4-mini',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
  },
  deepseek: {
    provider: 'openai_compatible',
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-v4-flash',
    reasoningModel: 'deepseek-v4-pro',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  },
  gemini: {
    provider: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-pro',
    reasoningModel: 'gemini-2.5-pro',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  },
  claude: {
    provider: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    defaultModel: 'claude-4-sonnet',
    reasoningModel: 'claude-4-opus',
    models: ['claude-4-sonnet', 'claude-4-opus'],
  },
  grok: {
    provider: 'xai_oauth',
    baseURL: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.3',
    reasoningModel: 'grok-4.3',
    models: ['grok-4.3'],
  },
  local: {
    provider: 'local',
    baseURL: 'http://127.0.0.1:11434/v1',
    defaultModel: 'llama3.1',
    reasoningModel: 'qwen3',
    models: ['llama3.1', 'qwen3', 'deepseek-r1'],
  },
  openrouter: {
    provider: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4.1-mini',
    reasoningModel: 'deepseek/deepseek-r1',
    models: ['openai/gpt-4.1-mini', 'deepseek/deepseek-r1', 'anthropic/claude-4-sonnet'],
  },
  compatible: {
    provider: 'openai_compatible',
    baseURL: '',
    defaultModel: '',
    reasoningModel: '',
    models: ['deepseek-v4-flash', 'gpt-4.1-mini', 'custom-model'],
  },
};

function modelPresetMatchesSavedSettings(activeObjectID: string, preset: ModelProviderPreset, settings: SettingsRecord | null): boolean {
  const savedProvider = settings?.model_provider?.trim();
  const savedBaseURL = settings?.model_base_url?.trim();
  if (!savedProvider || !savedBaseURL) return false;
  const providerMatches = savedProvider === preset.provider || (activeObjectID === 'grok' && ['xai', 'xai_oauth', 'xai-oauth'].includes(savedProvider));
  return providerMatches && normalizeModelBaseURL(savedBaseURL) === normalizeModelBaseURL(preset.baseURL);
}

function normalizeModelBaseURL(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function getSettingsObjects(category: SettingsCategory, nodes: NodeRecord[], automations: AutomationDefinition[] = []) {
  if (category === 'models') {
    return [
      { id: 'openai', label: 'OpenAI', description: 'OpenAI API 与模型参数' },
      { id: 'deepseek', label: 'DeepSeek', description: 'DeepSeek API 连接与模型参数' },
      { id: 'gemini', label: 'Gemini', description: 'Google Gemini 模型配置' },
      { id: 'claude', label: 'Claude', description: 'Anthropic Claude 模型配置' },
      { id: 'grok', label: 'Grok', description: 'xAI Grok 模型配置' },
      { id: 'local', label: '本地模型', description: '本地推理服务与模型' },
      { id: 'openrouter', label: 'OpenRouter', description: '多模型路由服务' },
      { id: 'compatible', label: '自定义兼容', description: 'OpenAI Compatible 接口' },
    ];
  }
  if (category === 'chatEntrances') {
    return [
      { id: 'telegram', label: 'Telegram', description: 'Telegram Bot 入口' },
      { id: 'imessage', label: 'iMessage', description: 'Photon 托管 iMessage 入口' },
      { id: 'wechat-claw', label: '微信 Claw', description: '微信入口与桥接配置' },
      { id: 'desktop-notify', label: '桌面通知', description: '本机通知入口' },
      { id: 'cli', label: 'CLI', description: '命令行入口' },
      { id: 'webhook', label: 'Webhook', description: '外部 HTTP 入口' },
    ];
  }
  if (category === 'automations') {
    return getAutomationSettingsObjects(automations);
  }
  if (category === 'observability') {
    return [
      { id: 'logs', label: '日志', description: '按等级、风险、来源与 Run 筛选日志' },
      { id: 'token-usage', label: 'Token 用量', description: '模型调用、Token、缓存命中与成本' },
      { id: 'log-cleanup', label: '日志清理', description: '预览并清理日志与执行记录' },
    ];
  }
  if (category === 'dataMemory') {
    return [
      { id: 'memory-inbox', label: '待确认记忆', description: '审核记忆候选' },
      { id: 'confirmed-memory', label: '已确认记忆', description: '长期记忆库' },
      { id: 'conflict-memory', label: '冲突记忆', description: '需要处理的记忆冲突' },
      { id: 'memory-search', label: '记忆搜索', description: '检索与筛选记忆' },
      { id: 'archived-conversations', label: '归档会话', description: '查看和恢复已归档会话' },
      { id: 'trashed-conversations', label: '回收站', description: '恢复或永久清理会话' },
      { id: 'local-data', label: '本地数据', description: 'SQLite、日志与备份目录' },
      { id: 'data-maintenance', label: '数据维护', description: '备份、恢复与维护' },
    ];
  }
  if (category === 'capabilities') {
    return [
      { id: 'builtin', label: '内置能力', description: 'Joi 内置能力开关' },
      { id: 'skills', label: 'Skills', description: '技能包管理' },
      { id: 'plugins', label: 'Plugins', description: '插件管理' },
      { id: 'mcp', label: 'MCP', description: 'MCP Server 配置' },
      { id: 'filesystem', label: '文件系统', description: '本地文件访问能力' },
      { id: 'browser', label: '浏览器', description: '浏览器自动化能力' },
      { id: 'github', label: 'GitHub', description: '代码仓库连接能力' },
      { id: 'custom-tools', label: '自定义工具', description: '自定义能力注册' },
    ];
  }
  if (category === 'nodesExecution') {
    const nodeItems = ['main-node', 'local-worker', 'vps-la-1'].map((id) => {
      const node = nodes.find((item) => item.id === id);
      return { id, label: node?.name || id, description: node ? `${formatNodeRole(node.role)} · ${formatStatus(node.status)}` : '待注册节点' };
    });
    return [
      ...nodeItems,
      { id: 'worker-gateway', label: 'Worker Gateway', description: '工作节点网关与令牌' },
      { id: 'assignment-policy', label: '分配策略', description: '任务派发规则' },
      { id: 'node-audit', label: '节点审计', description: '节点注册与派发记录' },
    ];
  }
  if (category === 'privacySecurity') {
    return [
      { id: 'secrets', label: '密钥管理', description: '本地钥匙串与密钥状态' },
      { id: 'privacy-policy', label: '隐私策略', description: '本地优先与数据边界' },
      { id: 'remote-permission', label: '远端执行权限', description: '远端执行确认策略' },
      { id: 'dangerous-actions', label: '危险操作', description: '高风险操作审批' },
      { id: 'diagnostic-redaction', label: '诊断脱敏', description: '导出诊断前脱敏' },
    ];
  }
  return [
    { id: 'diagnostics', label: '诊断包', description: '导出运行诊断' },
    { id: 'raw-data', label: '原始数据', description: '系统调试数据' },
    { id: 'prompt-assembly', label: 'Prompt Assembly', description: '提示词组装详情' },
    { id: 'memory-context-pack', label: 'Memory Context Pack', description: '记忆上下文包' },
    { id: 'tool-io', label: 'Tool I/O', description: '工具输入输出' },
  ];
}

function DetailHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="detail-header">
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

function CapabilityToggle({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="capability-toggle">
      <span className={`live-dot ${enabled ? 'on' : ''}`} />
      <strong>{label}</strong>
      <small>{enabled ? '已启用' : '未启用'}</small>
    </div>
  );
}

function RecordList<T>({ emptyText, items, renderItem }: { emptyText: string; items: T[]; renderItem: (item: T) => ReactNode }) {
  return (
    <div className="table">
      {items.length ? items.map(renderItem) : <p className="empty">{emptyText}</p>}
    </div>
  );
}

function MemoryObjectDetail({
  description,
  emptyText,
  editAndConfirm,
  memories,
  mode,
  title,
  updateMemory,
}: {
  description?: string;
  emptyText: string;
  editAndConfirm?: (memory: MemoryRecord) => Promise<void>;
  memories: MemoryRecord[];
  mode: 'inbox' | 'confirmed' | 'conflict';
  title?: string;
  updateMemory: (id: string, action: string, extra?: Partial<MemoryRecord>) => Promise<void>;
}) {
  return (
    <section className="settings-detail-panel">
      {title && <DetailHeader title={title} description={description ?? "管理当前列表中的记忆条目"} />}
      <RecordList
        emptyText={emptyText}
        items={memories}
        renderItem={(memory) => (
          <article key={memory.id} className="row-card memory-record-card">
            <div className="memory-record-main">
              <strong>{memory.summary || memory.type}</strong>
              <p>{memory.content}</p>
              <small>{formatStatus(memory.status)} · 置信度 {memory.confidence.toFixed(2)} · 命中 {memory.usage_count}</small>
              {memory.conflict_group_id && <small>冲突：{memory.conflict_group_id} {memory.conflict_reason}</small>}
              {memory.source_event_ids?.length ? <small>来源：{memory.source_event_ids.join(', ')}</small> : null}
              {memory.metadata ? <CollapsedData label="高级详情" value={memory.metadata} /> : null}
            </div>
            <div className="row-actions memory-record-actions">
              {mode === 'inbox' && <button type="button" onClick={() => updateMemory(memory.id, 'confirm')}>确认</button>}
              {mode === 'inbox' && editAndConfirm && <button type="button" onClick={() => editAndConfirm(memory)}>编辑并确认</button>}
              {mode === 'inbox' && <button type="button" className="secondary" onClick={() => updateMemory(memory.id, 'reject')}>别记</button>}
              {mode !== 'inbox' && <button type="button" onClick={() => updateMemory(memory.id, memory.pinned ? 'unpin' : 'pin')}>{memory.pinned ? '取消置顶' : '置顶'}</button>}
              {mode !== 'inbox' && <button type="button" onClick={() => updateMemory(memory.id, memory.disabled ? 'enable' : 'disable')}>{memory.disabled ? '启用' : '停用'}</button>}
              {mode !== 'inbox' && <button type="button" onClick={() => updateMemory(memory.id, 'feedback_positive')}>有效</button>}
              {mode !== 'inbox' && <button type="button" onClick={() => updateMemory(memory.id, 'feedback_negative')}>无效</button>}
              {mode !== 'inbox' && <button type="button" onClick={() => updateMemory(memory.id, 'mark_conflict')}>标记冲突</button>}
            </div>
          </article>
        )}
      />
    </section>
  );
}

function ConversationLifecycleSettingsList({
  conversations,
  emptyText,
  mode,
  purgeConversation,
  restoreConversation,
  title,
  trashConversation,
}: {
  conversations: ConversationSummary[];
  emptyText: string;
  mode: 'archived' | 'trash';
  purgeConversation?: (conversationID: string) => Promise<void>;
  restoreConversation: (conversationID: string) => Promise<void>;
  title: string;
  trashConversation?: (conversationID: string) => Promise<void>;
}) {
  return (
    <section className="settings-detail-panel">
      <DetailHeader
        title={title}
        description={mode === 'trash' ? '回收站会话默认保留 30 天，永久清理前会再次确认。' : '归档会话从左侧主列表隐藏，可随时恢复。'}
      />
      <RecordList
        emptyText={emptyText}
        items={conversations}
        renderItem={(conversation) => (
          <article key={conversation.id} className="row-card conversation-lifecycle-card">
            <div>
              <strong>{conversationTitle(conversation)}</strong>
              <p>{conversation.last_message || '暂无最近消息'}</p>
              <small>
                {conversation.message_count ?? 0} 条消息 · 更新于 {formatShortTime(conversation.updated_at)}
                {mode === 'trash' && conversation.purge_after ? ` · 可清理：${formatShortTime(conversation.purge_after)}` : ''}
              </small>
            </div>
            <div className="row-actions">
              <button type="button" onClick={() => void restoreConversation(conversation.id)}>恢复</button>
              {mode === 'archived' && trashConversation && (
                <button className="danger" type="button" onClick={() => void trashConversation(conversation.id)}>移到回收站</button>
              )}
              {mode === 'trash' && purgeConversation && (
                <button className="danger" type="button" onClick={() => void purgeConversation(conversation.id)}>永久清理</button>
              )}
            </div>
          </article>
        )}
      />
    </section>
  );
}

function ConversationSidebar({
  activeTab,
  archiveConversation,
  chat,
  collapsed,
  conversations,
  currentConversationID,
  health,
  loadConversation,
  setActiveTab,
  trace,
}: {
  activeTab: Tab;
  archiveConversation: (conversationID: string) => Promise<void>;
  chat: ChatResponse | null;
  collapsed: boolean;
  conversations: ConversationSummary[];
  currentConversationID: string;
  health: SystemHealth | null;
  loadConversation: (conversationID: string) => Promise<void>;
  setActiveTab: (tab: Tab) => void;
  trace: RunTrace | null;
}) {
  if (collapsed) {
    return <aside aria-hidden="true" className="im-sidebar sidebar-placeholder" />;
  }

  return (
    <aside className="im-sidebar">
      <ScrollArea className="conversation-list">
        <RailSectionTitle label="会话" />
        {conversations.length ? conversations.map((item) => {
          const active = currentConversationID === item.id || (!currentConversationID && chat?.conversation_id === item.id);
          const isConversationContext = activeTab === 'chat' || activeTab === 'trace';
          return (
            <div key={item.id} className={`conversation-row-wrap ${active && isConversationContext ? 'active' : ''}`}>
              <button
                className={`conversation-item conversation-chat-item ${active && isConversationContext ? 'active' : ''}`}
                type="button"
                onClick={() => loadConversation(item.id)}
              >
                <span>
                  <strong>{conversationTitle(item)}</strong>
                </span>
                <time>{formatShortTime(item.updated_at)}</time>
              </button>
              <div className="conversation-row-actions">
                <button type="button" onClick={() => void archiveConversation(item.id)}>归档</button>
              </div>
            </div>
          );
        }) : (
          <button className={`conversation-item conversation-chat-item ${activeTab === 'chat' || activeTab === 'trace' ? 'active' : ''}`} type="button" onClick={() => setActiveTab('chat')}>
            <span>
              <strong>{chat ? '当前对话' : '新对话'}</strong>
            </span>
            <time>{trace ? '刚刚' : ''}</time>
          </button>
        )}
      </ScrollArea>

      <div className="sidebar-footer">
        <div className="user-avatar user-avatar-self">你</div>
        <strong className="sidebar-user-name">你</strong>
        <span className={`sidebar-status-dot live-dot ${health?.service_status?.sqlite ? 'on' : ''}`} title={health?.service_status?.sqlite ? 'SQLite OK' : 'SQLite 未连接'} />
        <button className="footer-settings-button" title="设置" type="button" onClick={() => setActiveTab('settings')}>
          <SidebarIcon name="settings" />
        </button>
      </div>
    </aside>
  );
}

function RailSectionTitle({ label }: { label: string }) {
  return <div className="rail-section-title">{label}</div>;
}

function handleTopControlPointerAction(
  event: ReactPointerEvent<HTMLButtonElement>,
  action: () => void,
  suppressClickRef: { current: boolean },
) {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  suppressClickRef.current = true;
  window.setTimeout(() => {
    suppressClickRef.current = false;
  }, 350);
  action();
}

function handleTopControlClickAction(
  event: ReactMouseEvent<HTMLButtonElement>,
  action: () => void,
  suppressClickRef: { current: boolean },
) {
  event.preventDefault();
  event.stopPropagation();
  if (suppressClickRef.current) {
    suppressClickRef.current = false;
    return;
  }
  action();
}

function SidebarTopControls({
  collapsed,
  setActiveTab,
  startNewChat,
  toggleCollapsed,
}: {
  collapsed: boolean;
  setActiveTab: (tab: Tab) => void;
  startNewChat: () => void;
  toggleCollapsed: () => void;
}) {
  const suppressNewClickRef = useRef(false);
  const suppressSearchClickRef = useRef(false);
  const suppressToggleClickRef = useRef(false);
  const openSearch = () => setActiveTab('memory');

  return (
    <div className="sidebar-top-controls">
      <button
        aria-label="新建对话"
        className="round-icon-button"
        title="新建对话"
        type="button"
        onClick={(event) => handleTopControlClickAction(event, startNewChat, suppressNewClickRef)}
        onPointerDown={(event) => handleTopControlPointerAction(event, startNewChat, suppressNewClickRef)}
      >
        <SidebarIcon name="plus" />
      </button>
      <button
        aria-label="搜索"
        className="round-icon-button"
        title="搜索"
        type="button"
        onClick={(event) => handleTopControlClickAction(event, openSearch, suppressSearchClickRef)}
        onPointerDown={(event) => handleTopControlPointerAction(event, openSearch, suppressSearchClickRef)}
      >
        <SidebarIcon name="search" />
      </button>
      <button
        aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        className="round-icon-button collapse-sidebar-button"
        title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        type="button"
        onClick={(event) => handleTopControlClickAction(event, toggleCollapsed, suppressToggleClickRef)}
        onPointerDown={(event) => handleTopControlPointerAction(event, toggleCollapsed, suppressToggleClickRef)}
      >
        <SidebarIcon name={collapsed ? 'expand' : 'collapse'} />
      </button>
    </div>
  );
}

function SettingsTopControls({
  collapsed,
  goBack,
  toggleCollapsed,
}: {
  collapsed: boolean;
  goBack: () => void;
  toggleCollapsed: () => void;
}) {
  const suppressBackClickRef = useRef(false);
  const suppressToggleClickRef = useRef(false);

  const toggleLabel = collapsed ? '展开设置菜单' : '折叠设置菜单';

  return (
    <div className="sidebar-top-controls settings-top-controls">
      <button
        aria-label="返回对话"
        className="round-icon-button"
        title="返回对话"
        type="button"
        onClick={(event) => handleTopControlClickAction(event, goBack, suppressBackClickRef)}
        onPointerDown={(event) => handleTopControlPointerAction(event, goBack, suppressBackClickRef)}
      >
        <SidebarIcon name="back" />
      </button>
      <button
        aria-label={toggleLabel}
        className="round-icon-button collapse-sidebar-button"
        title={toggleLabel}
        type="button"
        onClick={(event) => handleTopControlClickAction(event, toggleCollapsed, suppressToggleClickRef)}
        onPointerDown={(event) => handleTopControlPointerAction(event, toggleCollapsed, suppressToggleClickRef)}
      >
        <SidebarIcon name={collapsed ? 'expand' : 'collapse'} />
      </button>
    </div>
  );
}

function SidebarIcon({ name }: { name: 'plus' | 'search' | 'collapse' | 'expand' | 'down' | 'settings' | 'back' }) {
  return (
    <svg aria-hidden="true" className="sidebar-action-icon" focusable="false" viewBox="0 0 24 24">
      {name === 'plus' && (
        <>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </>
      )}
      {name === 'search' && (
        <>
          <circle cx="11" cy="11" r="6" />
          <path d="m16 16 4 4" />
        </>
      )}
      {name === 'back' && (
        <>
          <path d="M19 12H5" />
          <path d="m12 19-7-7 7-7" />
        </>
      )}
      {name === 'collapse' && <path d="m15 18-6-6 6-6" />}
      {name === 'expand' && <path d="m9 18 6-6-6-6" />}
      {name === 'down' && <path d="m6 9 6 6 6-6" />}
      {name === 'settings' && (
        <>
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

function ChatHome({
  activeProductTask,
  activeExecutionActions,
  artifacts,
  autoRightPanelCollapsed,
  chat,
  conversationMessages,
  cancelRun,
  continueProductTask,
  decideConfirmation,
  decideProactiveMessage,
  executionTarget,
  health,
  inputMode,
  isSubmitting,
  lastPrompt,
  message,
  memories,
  openArtifact,
  openLoops,
  pendingUserMessage,
  streamingAssistantMessage,
  proactiveMessages,
  productTasks,
  runEventsByRunId,
  savedModels,
  selectProductTask,
  selectedModelName,
  setActiveTab,
  setExecutionTarget,
  setInputMode,
  setMessage,
  setSelectedModelName,
  settings,
  startRightPanelResize,
  updateMemory,
  submit,
  trace,
}: {
  activeProductTask: ProductTaskDetail | null;
  activeExecutionActions: ExecutionAction[];
  artifacts: ArtifactSummary[];
  autoRightPanelCollapsed: boolean;
  chat: ChatResponse | null;
  conversationMessages: ConversationMessage[];
  cancelRun: (runID: string) => Promise<void>;
  continueProductTask: (task: ProductTask) => Promise<void>;
  decideConfirmation: (id: string, approve: boolean, scope?: 'one_call' | 'current_run') => Promise<void>;
  decideProactiveMessage: (id: string, action: string, feedback?: string) => Promise<void>;
  executionTarget: ExecutionTarget;
  health: SystemHealth | null;
  inputMode: InputMode;
  isSubmitting: boolean;
  lastPrompt: string;
  message: string;
  memories: MemoryRecord[];
  openArtifact: (id: string) => Promise<void>;
  openLoops: OpenLoop[];
  pendingUserMessage: ConversationMessage | null;
  streamingAssistantMessage: StreamingAssistantMessage | null;
  proactiveMessages: ProactiveMessage[];
  productTasks: ProductTask[];
  runEventsByRunId: Record<string, NormalizedRunEvent[]>;
  savedModels: AvailableModel[];
  selectProductTask: (id: string) => Promise<void>;
  selectedModelName: string;
  setActiveTab: (tab: Tab) => void;
  setExecutionTarget: (value: ExecutionTarget) => void;
  setInputMode: (value: InputMode) => void;
  setMessage: (value: string) => void;
  setSelectedModelName: (value: string) => void;
  settings: SettingsRecord | null;
  startRightPanelResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  updateMemory: (id: string, action: string, extra?: Partial<MemoryRecord>) => Promise<void>;
  submit: (event?: FormEvent) => Promise<void>;
  trace: RunTrace | null;
}) {
  const settledMessages: ConversationMessage[] = conversationMessages.length
    ? conversationMessages
    : chat
      ? [
        { id: chat.user_message_id, conversation_id: chat.conversation_id, role: 'user', content: lastPrompt },
        ...(streamingAssistantMessage ? [] : [{ id: chat.assistant_message_id, conversation_id: chat.conversation_id, role: 'assistant' as const, content: chat.response, run_id: chat.run_id }]),
      ]
      : [];
  const candidateRunIds = new Set<string>();
  for (const message of settledMessages) {
    const runId = getMessageRunId(message);
    if (runId) candidateRunIds.add(runId);
  }
  const streamingRunId = streamingAssistantMessage ? getMessageRunId(streamingAssistantMessage) : '';
  if (streamingRunId) candidateRunIds.add(streamingRunId);
  if (chat?.run_id) candidateRunIds.add(chat.run_id);
  if (trace?.id) candidateRunIds.add(trace.id);
  const pendingLiveRunId = (isSubmitting || pendingUserMessage) ? latestActiveRunId(runEventsByRunId) : '';
  const activeRunId = streamingRunId || chat?.run_id || trace?.id || pendingLiveRunId;
  if (activeRunId) candidateRunIds.add(activeRunId);
  const threadRunEventsByRunId = pickRunEvents(runEventsByRunId, candidateRunIds);
  const conversationProjection = useMemo(() => buildConversationRenderItems({
    messages: settledMessages,
    pendingUserMessage,
    streamingAssistant: streamingAssistantMessage,
    runEventsByRunId: threadRunEventsByRunId,
    activeRunId,
    mode: inputMode,
  }), [activeRunId, inputMode, pendingUserMessage, threadRunEventsByRunId, settledMessages, streamingAssistantMessage]);
  const renderItems = conversationProjection.items;
  const hasThread = renderItems.length > 0;
  const activeTaskBelongsToCurrentRun = Boolean(activeProductTask?.task.latest_run_id && activeProductTask.task.latest_run_id === (chat?.run_id || trace?.id));
  const latestTask = chat?.product_task ? { task: chat.product_task, steps: [], deliverables: chat.artifacts ?? [] } : activeTaskBelongsToCurrentRun ? activeProductTask : null;
  const executionActions = useMemo(() => projectRunTraceToActions(trace), [trace]);
  const visibleTraceActions = useMemo(() => visibleExecutionActions(executionActions), [executionActions]);
  const liveExecutionActions = activeExecutionActions.length > 0 ? activeExecutionActions : visibleTraceActions;
  const showInlineTaskCard = false;
  const [manualRightPanelCollapsed, setManualRightPanelCollapsed] = useState(true);
  const [rightInspectorTab, setRightInspectorTab] = useState<RightInspectorTab>('terminal');
  const [executionTargetOpen, setExecutionTargetOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelControlRef = useRef<HTMLDivElement | null>(null);
  const modelOptions = composerModelOptions(settings, selectedModelName, savedModels);
  const rightPanelCollapsed = manualRightPanelCollapsed || autoRightPanelCollapsed;
  const rightPanelToggleLabel = autoRightPanelCollapsed
    ? '窗口宽度不足，右侧内容已自动收起'
    : rightPanelCollapsed
      ? '展开右侧内容'
      : '收起右侧内容';
  const selectedExecutionTarget = executionTargetOptions.find((item) => item.value === executionTarget) ?? executionTargetOptions[0];
  const executionStatusLabel = executionTargetLabelFromTrace(trace, selectedExecutionTarget.label);

  useEffect(() => {
    if (!modelMenuOpen) return;

    function closeOnPointerDown(event: globalThis.PointerEvent) {
      const target = event.target;
      if (target instanceof Node && modelControlRef.current?.contains(target)) return;
      setModelMenuOpen(false);
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setModelMenuOpen(false);
      }
    }

    window.addEventListener('pointerdown', closeOnPointerDown, true);
    window.addEventListener('keydown', closeOnEscape, true);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown, true);
      window.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [modelMenuOpen]);

  function fillSuggestion(next: string) {
    setMessage(next);
  }

  function fillSeriousTaskSuggestion() {
    setInputMode('serious_task');
    setMessage('认真执行：根据这个方向，给我整理一份开发 spec。');
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;

    event.preventDefault();
    void submit();
  }

  return (
    <section className={`chat-home companion-layout${rightPanelCollapsed ? ' companion-layout-right-collapsed' : ''}`}>
      <section className="chat-main-column">
        <header className="chat-statusbar">
          {!hasThread && <small>本地运行 · 可检查</small>}
          {!hasThread ? (
            <div
              className="execution-target-control"
              title="选择本轮任务的执行位置；Worker 选项会自动启用工作节点派发。"
              onBlur={(event) => {
                const nextFocus = event.relatedTarget;
                if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) {
                  setExecutionTargetOpen(false);
                }
              }}
            >
              <button
                aria-expanded={executionTargetOpen}
                aria-haspopup="menu"
                className="execution-target-trigger"
                type="button"
                onClick={() => setExecutionTargetOpen((current) => !current)}
              >
                <span>执行位置</span>
                <strong>{selectedExecutionTarget.label}</strong>
                <SidebarIcon name="down" />
              </button>
              {executionTargetOpen && (
                <div className="execution-target-menu" role="menu">
                  {executionTargetOptions.map((item) => (
                    <button
                      key={item.value}
                      className={item.value === executionTarget ? 'active' : ''}
                      role="menuitemradio"
                      aria-checked={item.value === executionTarget}
                      type="button"
                      onClick={() => {
                        setExecutionTarget(item.value);
                        setExecutionTargetOpen(false);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className="execution-target-status" title="本轮会话的执行位置已固定">
              执行位置 <strong>{executionStatusLabel}</strong>
            </span>
          )}
          <button
            aria-expanded={!rightPanelCollapsed}
            className="round-icon-button collapse-sidebar-button right-panel-collapse-button"
            title={rightPanelToggleLabel}
            type="button"
            disabled={autoRightPanelCollapsed}
            onClick={() => setManualRightPanelCollapsed((current) => !current)}
          >
            <SidebarIcon name={rightPanelCollapsed ? 'expand' : 'collapse'} />
          </button>
        </header>

        <ScrollArea
          className={hasThread ? 'chat-thread' : 'chat-empty-state'}
          stickToBottom={hasThread}
          stickToBottomKey={hasThread ? conversationMessages[0]?.conversation_id || chat?.conversation_id || activeRunId || 'thread' : undefined}
        >
          {hasThread ? (
            <>
              <MessageList
                assistantAvatarSrc={joiAvatar}
                formatAssistantContent={userFacingAssistantText}
                items={renderItems}
                onOpenArtifact={(artifactId) => void openArtifact(artifactId)}
                onOpenTask={(taskId) => void selectProductTask(taskId)}
                onOpenTrace={() => setActiveTab('trace')}
                onResolveApproval={(approvalId, approve, scope) => void decideConfirmation(approvalId, approve, scope)}
              />
              {isSubmitting && !streamingAssistantMessage && !renderItems.some((item) => item.type === 'message' && item.role === 'assistant') && (
                <article className="message-row assistant-message pending-message">
                  <img className="message-avatar assistant" src={joiAvatar} alt="Joi" />
                  <div className="message-bubble">
                    <p>正在处理...</p>
                  </div>
                </article>
              )}
              {showInlineTaskCard && <TaskCard detail={latestTask!} openArtifact={openArtifact} openTrace={() => setActiveTab('trace')} />}
            </>
          ) : (
            <>
              <div className="hero-brand-lockup">
                <img className="hero-avatar" src={joiAvatar} alt="Joi" />
              </div>
              <h1>想聊点什么?</h1>
              <p>Joi 随时准备好帮你思考、写作、执行任务。</p>
              <div className="quick-actions">
                <button type="button" onClick={() => fillSuggestion('帮我总结这个网页，并提炼核心观点。')}>◎ 总结网页</button>
                <button type="button" onClick={() => fillSuggestion('记住：')}>□ 写入记忆</button>
                <button type="button" onClick={() => setActiveTab('trace')}>◴ 查看最近任务</button>
                <button type="button" onClick={fillSeriousTaskSuggestion}>▤ 认真执行</button>
              </div>
            </>
          )}
        </ScrollArea>

        <form className="composer" aria-busy={isSubmitting} onSubmit={submit}>
          <textarea
            placeholder={isSubmitting ? '补充或修改当前任务...' : '输入任务，或直接和 Joi 说你想做什么...'}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleComposerKeyDown}
          />
          <div
            className="composer-tools"
            onBlur={(event) => {
              const nextFocus = event.relatedTarget;
              if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) {
                setModelMenuOpen(false);
              }
            }}
          >
            <div className="composer-mode-control" role="group" aria-label="输入模式">
              {inputModeOptions.map((item) => (
                <button
                  key={item.value}
                  className={item.value === inputMode ? 'active' : ''}
                  type="button"
                  title={item.title}
                  aria-pressed={item.value === inputMode}
                  onClick={() => setInputMode(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div ref={modelControlRef} className="composer-model-control">
              <button
                aria-expanded={modelMenuOpen}
                className="composer-model-trigger"
                title="选择本次发送使用的模型"
                type="button"
                onClick={() => setModelMenuOpen((current) => !current)}
              >
                <span>{selectedModelName}</span>
                <SidebarIcon name="down" />
              </button>
              {modelMenuOpen && (
                <div className="composer-model-menu">
                  {modelOptions.map((item) => (
                    <button
                      key={item}
                      className={item === selectedModelName ? 'active' : ''}
                      aria-pressed={item === selectedModelName}
                      type="button"
                      onClick={() => {
                        setSelectedModelName(item);
                        setModelMenuOpen(false);
                      }}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {isSubmitting && !message.trim() ? (
            <button
              className="send-button stop-button"
              disabled={!activeRunId}
              type="button"
              title={activeRunId ? '中断运行' : '等待运行 ID'}
              onClick={() => void cancelRun(activeRunId)}
            >
              ■
            </button>
          ) : (
            <button
              className="send-button"
              disabled={!message.trim()}
              type="button"
              title={isSubmitting ? '追加到当前任务' : '发送'}
              onClick={() => void submit()}
            >
              ↑
            </button>
          )}
        </form>
      </section>
      {!rightPanelCollapsed && (
        <>
          <div
            aria-label="调整右侧栏宽度"
            className="right-panel-resizer"
            role="separator"
            onPointerDown={startRightPanelResize}
          />
          <ScrollArea
            as="aside"
            className="companion-right-panel"
            contentClassName="companion-right-panel-content"
            aria-label="Joi 右侧检查器"
          >
            <CompanionInspectorPanel
              activeTab={rightInspectorTab}
              decideProactiveMessage={decideProactiveMessage}
              memories={memories}
              openLoops={openLoops}
              proactiveMessages={proactiveMessages}
              setActiveTab={setRightInspectorTab}
              trace={trace}
              updateMemory={updateMemory}
            />
          </ScrollArea>
        </>
      )}
    </section>
  );
}

function TaskCard({ detail, openArtifact, openTrace }: { detail: ProductTaskDetail; openArtifact: (id: string) => Promise<void>; openTrace: () => void }) {
  const task = detail.task;
  const currentStep = detail.steps.find((step) => step.id === task.current_step_id) ?? detail.steps.find((step) => step.status === 'running') ?? detail.steps[0];
  return (
    <article className="task-card-inline">
      <header>
        <span className={`task-status-pill status-${task.status}`}>{formatStatus(task.status)}</span>
        <strong>任务：{task.title}</strong>
      </header>
      <p>{task.description || task.summary || '严肃任务已进入可追踪执行链路。'}</p>
      <div className="task-card-grid">
        <KV label="计划" value={`${detail.steps.length} 步`} />
        <KV label="当前步骤" value={currentStep?.title || '待开始'} />
        <KV label="风险" value={formatRiskLevel(task.risk_level)} />
        <KV label="运行 ID" value={task.latest_run_id || '待生成'} />
      </div>
      <div className="task-progress-bar" aria-label={`任务进度 ${task.progress_percent}%`}>
        <span style={{ width: `${Math.max(0, Math.min(100, task.progress_percent))}%` }} />
      </div>
      <footer>
        <button type="button" onClick={openTrace}>查看执行过程</button>
        {detail.deliverables.map((artifact) => (
          <button key={artifact.id} type="button" onClick={() => openArtifact(artifact.id)}>打开交付物</button>
        ))}
      </footer>
    </article>
  );
}

function dedupeConversationMessages(messages: ConversationMessage[]) {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const key = message.id || `${message.role}:${message.run_id || ''}:${message.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function CompanionInspectorPanel({
  activeTab,
  decideProactiveMessage,
  memories,
  openLoops,
  proactiveMessages,
  setActiveTab,
  trace,
  updateMemory,
}: {
  activeTab: RightInspectorTab;
  decideProactiveMessage: (id: string, action: string, feedback?: string) => Promise<void>;
  memories: MemoryRecord[];
  openLoops: OpenLoop[];
  proactiveMessages: ProactiveMessage[];
  setActiveTab: (tab: RightInspectorTab) => void;
  trace: RunTrace | null;
  updateMemory: (id: string, action: string, extra?: Partial<MemoryRecord>) => Promise<void>;
}) {
  return (
    <section className="right-inspector-shell">
      <header className="right-inspector-header">
        <div className="right-inspector-tabs" role="tablist" aria-label="右侧栏视图">
          <button
            id="right-inspector-tab-terminal"
            aria-controls="right-inspector-terminal"
            aria-selected={activeTab === 'terminal'}
            className={activeTab === 'terminal' ? 'active' : ''}
            role="tab"
            type="button"
            onClick={() => setActiveTab('terminal')}
          >
            <span>Terminal</span>
          </button>
          <button
            id="right-inspector-tab-memory"
            aria-controls="right-inspector-memory"
            aria-selected={activeTab === 'memory'}
            className={activeTab === 'memory' ? 'active' : ''}
            role="tab"
            type="button"
            onClick={() => setActiveTab('memory')}
          >
            <span>Memory</span>
          </button>
          <button
            id="right-inspector-tab-logs"
            aria-controls="right-inspector-logs"
            aria-selected={activeTab === 'logs'}
            className={activeTab === 'logs' ? 'active' : ''}
            role="tab"
            type="button"
            onClick={() => setActiveTab('logs')}
          >
            <span>Logs</span>
          </button>
        </div>
        <div className="right-inspector-header-drag-spacer" aria-hidden="true" />
      </header>
      {activeTab === 'terminal' ? (
        <CompanionTerminalPanel />
      ) : activeTab === 'logs' ? (
        <CompanionLogsPanel runID={trace?.id} />
      ) : (
        <CompanionInsightPanel
          decideProactiveMessage={decideProactiveMessage}
          memories={memories}
          openLoops={openLoops}
          proactiveMessages={proactiveMessages}
          trace={trace}
          updateMemory={updateMemory}
        />
      )}
    </section>
  );
}

function CompanionTerminalPanel() {
  return (
    <div
      id="right-inspector-terminal"
      className="right-inspector-tab-panel"
      role="tabpanel"
      aria-labelledby="right-inspector-tab-terminal"
    >
      <InteractiveTerminalPanel />
    </div>
  );
}

// joi-log-coverage: covered-by Electron IPC start/success/failure app_logs for desktopApi calls; local filters are read-only UI state.
function CompanionLogsPanel({ runID }: { runID?: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('');
  const [risk, setRisk] = useState('');
  const [category, setCategory] = useState('');
  const [source, setSource] = useState('');
  const [runFilter, setRunFilter] = useState('');
  const [includeTrace, setIncludeTrace] = useState(false);
  const [includeWorkerHeartbeat, setIncludeWorkerHeartbeat] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let disposed = false;
    const filter = buildLogFilter({
      category,
      includeTrace,
      includeWorkerHeartbeat,
      level,
      query,
      risk,
      runFilter,
      source,
    });
    async function loadLogs() {
      setLoading(true);
      setError('');
      try {
        const result = await desktopApi.listLogs(filter);
        if (!disposed) setLogs(result.logs ?? []);
      } catch (logError) {
        if (!disposed) setError(safeErrorText(logError));
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    void loadLogs();
    return () => {
      disposed = true;
    };
  }, [category, includeTrace, includeWorkerHeartbeat, level, query, refreshNonce, risk, runFilter, source]);

  async function exportVisibleLogs() {
    setError('');
    setNotice('');
    try {
      const result = await desktopApi.exportLogs(buildLogFilter({
        category,
        includeTrace,
        includeWorkerHeartbeat,
        level,
        query,
        risk,
        runFilter,
        source,
      }));
      setNotice(`已导出：${result.path}`);
    } catch (logError) {
      setError(safeErrorText(logError));
    }
  }

  return (
    <section
      id="right-inspector-logs"
      className="right-panel-section logs-inspector-panel"
      role="tabpanel"
      aria-labelledby="right-inspector-tab-logs"
    >
      <header>
        <small>Logs</small>
        <h2>日志</h2>
      </header>
      <div className="logs-filter-grid">
        <label className="field-row compact">
          <span>搜索</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="message / feature / run" />
        </label>
        <label className="field-row compact">
          <span>Level</span>
          <select value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="">全部</option>
            {logLevelOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="field-row compact">
          <span>Risk</span>
          <select value={risk} onChange={(event) => setRisk(event.target.value)}>
            <option value="">全部</option>
            {logRiskOptions.map((item) => <option key={item} value={item}>{formatRiskLevel(item)}</option>)}
          </select>
        </label>
        <label className="field-row compact">
          <span>Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">全部</option>
            {logCategoryOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="field-row compact">
          <span>Source</span>
          <input value={source} onChange={(event) => setSource(event.target.value)} placeholder="electron_ipc" />
        </label>
        <label className="field-row compact">
          <span>Run</span>
          <input value={runFilter} onChange={(event) => setRunFilter(event.target.value)} placeholder={runID || 'run id'} />
        </label>
      </div>
      <div className="logs-toggle-row">
        <label>
          <input type="checkbox" checked={includeTrace} onChange={(event) => setIncludeTrace(event.target.checked)} />
          <span>Trace delta</span>
        </label>
        <label>
          <input type="checkbox" checked={includeWorkerHeartbeat} onChange={(event) => setIncludeWorkerHeartbeat(event.target.checked)} />
          <span>Worker heartbeat</span>
        </label>
      </div>
      <div className="logs-toolbar">
        <button type="button" onClick={() => setRefreshNonce((value) => value + 1)} disabled={loading}>
          {loading ? '刷新中' : '刷新'}
        </button>
        {runID ? <button type="button" onClick={() => setRunFilter(runID)}>当前 Run</button> : null}
        <button type="button" onClick={() => void exportVisibleLogs()}>导出</button>
      </div>
      {error ? <p className="terminal-error">{error}</p> : null}
      {notice ? <p className="logs-notice">{notice}</p> : null}
      <div className="log-entry-list">
        {logs.length === 0 ? (
          <p className="empty">暂无日志。</p>
        ) : logs.map((log) => (
          <LogEntryRow key={`${log.source_table}:${log.id}`} log={log} />
        ))}
      </div>
    </section>
  );
}

function LogEntryRow({ log }: { log: LogEntry }) {
  return (
    <article className={`log-entry-row log-level-${classToken(log.level)}`}>
      <header>
        <span className="log-level-pill">{log.level}</span>
        <span>{formatRiskLevel(log.risk_level)}</span>
        <time>{formatShortTime(log.created_at)}</time>
      </header>
      <strong>{log.message || log.feature_key || log.event_type || log.id}</strong>
      <small>
        {[log.category, log.source, log.feature_key].filter(Boolean).join(' · ')}
        {log.run_id ? ` · ${log.run_id}` : ''}
      </small>
      <details>
        <summary>详情</summary>
        <pre>{formatRawData({
          id: log.id,
          source_table: log.source_table,
          event_type: log.event_type,
          item_type: log.item_type,
          item_id: log.item_id,
          duration_ms: log.duration_ms,
          status: log.status,
          payload: log.payload,
          error: log.error,
        })}</pre>
      </details>
    </article>
  );
}

function DiagnosticsLogCleanup({ onNotice }: { onNotice?: (message: string) => void }) {
  const [preview, setPreview] = useState<LogCleanupPreview | null>(null);
  const [previewRequestKey, setPreviewRequestKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [includeTraceDelta, setIncludeTraceDelta] = useState(false);
  const [includeWorkerHeartbeat, setIncludeWorkerHeartbeat] = useState(false);

  function cleanupRequest(): LogCleanupRequest {
    return {
      actor: 'desktop_admin',
      include_trace_delta: includeTraceDelta,
      include_worker_heartbeat: includeWorkerHeartbeat,
      reason: 'desktop_diagnostics_cleanup',
      scopes: defaultLogCleanupScopes,
    };
  }

  function cleanupRequestKey(request = cleanupRequest()): string {
    return JSON.stringify(request);
  }

  function invalidatePreview() {
    setPreview(null);
    setPreviewRequestKey('');
  }

  async function previewCleanup() {
    setBusy(true);
    setError('');
    try {
      const request = cleanupRequest();
      const result = await desktopApi.previewLogCleanup(request);
      setPreview(result);
      setPreviewRequestKey(cleanupRequestKey(request));
    } catch (cleanupError) {
      setError(safeErrorText(cleanupError));
    } finally {
      setBusy(false);
    }
  }

  async function clearLogs() {
    const request = cleanupRequest();
    const requestKey = cleanupRequestKey(request);
    if (!preview || previewRequestKey !== requestKey) {
      setError('请先 Preview 当前清理范围。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await desktopApi.clearLogs(request);
      setPreview(result);
      setPreviewRequestKey(requestKey);
      onNotice?.(`日志已清理：${result.total_count} 项`);
    } catch (cleanupError) {
      setError(safeErrorText(cleanupError));
    } finally {
      setBusy(false);
    }
  }

  const previewIsCurrent = Boolean(preview && previewRequestKey === cleanupRequestKey());

  return (
    <section className="diagnostics-log-cleanup">
      <h3>日志清理</h3>
      <dl className="metrics">
        <KV label="范围" value="系统日志、Run Trace、tool/model、worker audit、文件日志" />
        <KV label="保留" value="对话、记忆、设置、密钥" />
      </dl>
      <div className="logs-toggle-row">
        <label>
          <input
            type="checkbox"
            checked={includeTraceDelta}
            onChange={(event) => {
              setIncludeTraceDelta(event.target.checked);
              invalidatePreview();
            }}
          />
          <span>Trace delta</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={includeWorkerHeartbeat}
            onChange={(event) => {
              setIncludeWorkerHeartbeat(event.target.checked);
              invalidatePreview();
            }}
          />
          <span>Worker heartbeat</span>
        </label>
      </div>
      {preview ? (
        <div className="log-cleanup-preview">
          <strong>{preview.total_count} 项</strong>
          <div>
            {Object.entries(preview.counts).map(([scope, count]) => (
              <span key={scope}>{scope}: {count}</span>
            ))}
          </div>
          {preview.warnings.length > 0 ? <p>{preview.warnings.join(' · ')}</p> : null}
        </div>
      ) : null}
      {error ? <p className="terminal-error">{error}</p> : null}
      <div className="detail-actions">
        <button type="button" onClick={() => void previewCleanup()} disabled={busy}>Preview</button>
        <button type="button" onClick={() => void clearLogs()} disabled={busy || !previewIsCurrent || !preview?.safe_to_clear}>
          Clear Logs
        </button>
      </div>
    </section>
  );
}

function buildLogFilter(input: {
  category: string;
  includeTrace: boolean;
  includeWorkerHeartbeat: boolean;
  level: string;
  query: string;
  risk: string;
  runFilter: string;
  source: string;
}) {
  return {
    categories: input.category ? [input.category] : undefined,
    include_trace: input.includeTrace,
    include_worker_heartbeat: input.includeWorkerHeartbeat,
    levels: input.level ? [input.level] : undefined,
    limit: 80,
    query: input.query.trim() || undefined,
    risk_levels: input.risk ? [input.risk] : undefined,
    run_id: input.runFilter.trim() || undefined,
    sources: input.source.trim() ? [input.source.trim()] : undefined,
  };
}

function readCssVariable(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function InteractiveTerminalPanel() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [session, setSession] = useState<TerminalSessionInfo | null>(null);
  const [error, setError] = useState('');
  const shellLabel = session?.shell ? terminalShellLabel(session.shell) : 'ZSH';

  useEffect(() => {
    const api = window.joi?.terminal;
    const container = containerRef.current;
    if (!api || !container) {
      setSession(null);
      setError('Terminal requires the Joi desktop app.');
      return;
    }
    const terminalApi = api;

    let disposed = false;
    setError('');
    const terminalBackground = readCssVariable('--joi-terminal-background', '#fcf9f8');
    const terminalForeground = readCssVariable('--joi-terminal-foreground', '#1b1c1c');
    const terminalCursor = readCssVariable('--joi-terminal-cursor', '#445370');
    const terminalSelection = readCssVariable('--joi-terminal-selection', 'rgba(68, 71, 77, 0.18)');
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.24,
      scrollback: 5000,
      theme: {
        background: terminalBackground,
        foreground: terminalForeground,
        cursor: terminalCursor,
        selectionBackground: terminalSelection,
        black: '#31343a',
        blue: '#315c9f',
        cyan: '#286a70',
        green: '#3d6c40',
        magenta: '#6f4f8f',
        red: '#9b3530',
        white: '#f8fbff',
        yellow: '#775f24',
      },
    });
    terminalRef.current = terminal;
    terminal.open(container);

    const syncSize = () => {
      const size = estimateTerminalSize(container);
      terminal.resize(size.cols, size.rows);
      void terminalApi.resize({ id: RIGHT_INSPECTOR_TERMINAL_ID, cols: size.cols, rows: size.rows });
      return size;
    };
    const dataDisposable = terminal.onData((data) => {
      void terminalApi.input({ id: RIGHT_INSPECTOR_TERMINAL_ID, data });
    });
    const unsubscribe = terminalApi.onEvent((event: TerminalSessionEvent) => {
      if (event.id !== RIGHT_INSPECTOR_TERMINAL_ID) return;
      if (event.type === 'output' && event.data) {
        terminal.write(event.data);
      }
      if (event.session) {
        setSession(event.session);
      }
      if (event.type === 'error') {
        setError(event.error || event.session?.error || 'Terminal failed.');
      }
    });
    const resizeObserver = new ResizeObserver(syncSize);
    resizeObserver.observe(container);

    async function boot() {
      try {
        const snapshot = await terminalApi.getStatus(RIGHT_INSPECTOR_TERMINAL_ID);
        if (disposed) return;
        if (snapshot.output) {
          terminal.write(snapshot.output);
        }
        if (snapshot.session) {
          setSession(snapshot.session);
        }
        const size = syncSize();
        if (!snapshot.session || snapshot.session.status === 'exited' || snapshot.session.status === 'failed') {
          const started = await terminalApi.start({ id: RIGHT_INSPECTOR_TERMINAL_ID, cols: size.cols, rows: size.rows });
          if (disposed) return;
          setSession(started);
          if (started.status === 'failed') {
            setError(started.error || 'Terminal failed.');
          }
        }
        requestAnimationFrame(() => {
          if (!disposed) terminal.focus();
        });
      } catch (terminalError) {
        if (!disposed) {
          const message = safeErrorText(terminalError);
          setError(message);
          terminal.writeln(`\r\n${message}`);
        }
      }
    }

    void boot();
    return () => {
      disposed = true;
      unsubscribe();
      dataDisposable.dispose();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, []);

  return (
    <section className="right-panel-section interactive-terminal-panel">
      <header>
        <span className="terminal-shell-label">{shellLabel}</span>
      </header>
      <div className="interactive-terminal-frame" onMouseDown={() => terminalRef.current?.focus()}>
        <div ref={containerRef} className="interactive-terminal-surface" />
      </div>
      {error && <p className="terminal-error">{error}</p>}
    </section>
  );
}

function TerminalRunPanel({
  actions,
  openTrace,
  trace,
}: {
  actions: ExecutionAction[];
  openTrace: () => void;
  trace: RunTrace | null;
}) {
  const visibleActions = visibleExecutionActions(actions);
  const events = sortBySeq(normalizeTraceEvents(trace)).slice(-8);
  const latestModelCall = trace?.model_calls?.[0];
  return (
    <section className="right-panel-section terminal-run-panel">
      <header>
        <small>Terminal</small>
        <h2>{trace ? '最近运行' : '等待运行'}</h2>
      </header>
      <dl className="terminal-summary-grid">
        <KV label="状态" value={trace ? formatStatus(trace.status) : '空闲'} />
        <KV label="动作" value={`${visibleActions.length} 个`} />
        <KV label="事件" value={`${events.length} 条`} />
        <KV label="模型" value={latestModelCall?.model_name || '无'} />
      </dl>
      {visibleActions.length > 0 ? (
        <ExecutionActionFlow actions={visibleActions} mode="detail" runStatus={trace?.status ?? 'completed'} />
      ) : (
        <p className="empty">当前没有可见执行动作。</p>
      )}
      <TerminalEventStream events={events} />
      <button className="trace-link-button terminal-trace-button" type="button" onClick={openTrace}>打开完整执行过程</button>
    </section>
  );
}

function TerminalEventStream({ events }: { events: NormalizedRunEvent[] }) {
  if (events.length === 0) return null;
  return (
    <section className="terminal-event-stream" aria-label="Terminal event stream">
      <h3>Event Stream</h3>
      <ol>
        {events.map((event) => (
          <li key={event.id}>
            <span className={`status-dot ${event.status === 'running' ? 'running' : event.status === 'waiting_approval' ? 'waiting' : event.status === 'failed' ? 'failed' : 'done'}`} />
            <div>
              <strong>{event.type}</strong>
              <small>
                #{event.seq || '-'} · {formatStatus(event.status || 'completed')}
                {event.title || event.summary || event.error ? ` · ${[event.title, event.summary, event.error].filter(Boolean).join(' · ')}` : ''}
              </small>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CompanionInsightPanel({
  decideProactiveMessage,
  memories,
  openLoops,
  proactiveMessages,
  trace,
  updateMemory,
}: {
  decideProactiveMessage: (id: string, action: string, feedback?: string) => Promise<void>;
  memories: MemoryRecord[];
  openLoops: OpenLoop[];
  proactiveMessages: ProactiveMessage[];
  trace: RunTrace | null;
  updateMemory: (id: string, action: string, extra?: Partial<MemoryRecord>) => Promise<void>;
}) {
  const usedMemories = extractUsedMemories(trace).slice(0, 4);
  const currentRunID = trace?.id || '';
  const pending = memories.filter((memory) => isMemoryProposalForRun(memory, currentRunID)).slice(0, 4);

  async function editAndConfirm(memory: MemoryRecord) {
    const edited = window.prompt('修改后确认这条记忆', memory.content);
    if (edited === null) return;
    await updateMemory(memory.id, 'edit_confirm', { content: edited, summary: memory.summary });
  }

  return (
    <section
      id="right-inspector-memory"
      className="right-panel-section memory-inspector-panel"
      role="tabpanel"
      aria-labelledby="right-inspector-tab-memory"
    >
      <header>
        <small>Memory</small>
        <h2>记忆</h2>
      </header>
      <h3>本次使用了这些记忆</h3>
      <InsightList empty="本轮没有召回 confirmed memory。">
        {usedMemories.map((result) => (
          <InsightItem key={`used-${result.memory.id}`} title={result.memory.summary || result.memory.type} body={result.memory.content}>
            <small>score {result.score.toFixed(2)} · {formatMemoryReason(result.reason)}</small>
            <button type="button" onClick={() => updateMemory(result.memory.id, 'feedback_positive')}>准确</button>
            <button type="button" onClick={() => updateMemory(result.memory.id, 'feedback_negative')}>不准确</button>
            <button type="button" onClick={() => updateMemory(result.memory.id, 'disable')}>停用</button>
          </InsightItem>
        ))}
      </InsightList>
      <h3>本次建议</h3>
      <InsightList empty="本轮没有新的学习建议。">
        {pending.map((memory) => (
          <InsightItem key={memory.id} title={memory.summary || memory.type} body={memory.content}>
            {memoryProposalWhy(memory) ? <small>{memoryProposalWhy(memory)}</small> : null}
            <button type="button" onClick={() => updateMemory(memory.id, 'confirm')}>准确</button>
            <button type="button" onClick={() => editAndConfirm(memory)}>修改</button>
            <button type="button" onClick={() => updateMemory(memory.id, 'reject')}>别记</button>
          </InsightItem>
        ))}
      </InsightList>
    </section>
  );
}

function TaskExecutionPanel({
  cancelRun,
  continueProductTask,
  detail,
  openArtifact,
  openTrace,
}: {
  cancelRun: (runID: string) => Promise<void>;
  continueProductTask: (task: ProductTask) => Promise<void>;
  detail: ProductTaskDetail;
  openArtifact: (id: string) => Promise<void>;
  openTrace: () => void;
}) {
  const task = detail.task;
  const contract = task.task_contract;
  const verification = task.verification;
  const canInterrupt = Boolean(task.latest_run_id && ['running', 'waiting_confirmation', 'verifying'].includes(task.status));
  return (
    <section className="right-panel-section task-execution-panel">
      <header>
        <small>任务执行</small>
        <h2>{task.title}</h2>
      </header>
      <div className="task-panel-meta">
        <span className={`task-status-pill status-${task.status}`}>{formatStatus(task.status)}</span>
        <span>{formatRiskLevel(task.risk_level)}</span>
        <span>{task.progress_percent}%</span>
      </div>
      {contract && (
        <div className="task-contract-block">
          <h3>任务契约</h3>
          <p>{contract.objective}</p>
          <div className="task-contract-grid">
            <KV label="交付物" value={contract.deliverables.join('、') || '任务结果'} />
            <KV label="验证" value={contract.verification_requirements.join('、') || '完成前验证'} />
          </div>
        </div>
      )}
      <ol className="task-step-list">
        {detail.steps.map((step) => (
          <li key={step.id} className={`step-${step.status}`}>
            <span>{step.sort_order}</span>
            <div>
              <strong>{step.title}</strong>
              <small>{formatStatus(step.status)}{step.capability_id ? ` · ${step.capability_id}` : ''}</small>
              {step.summary && <p>{step.summary}</p>}
            </div>
          </li>
        ))}
      </ol>
      <h3>交付物</h3>
      <InsightList empty="还没有交付物。">
        {detail.deliverables.map((artifact) => (
          <InsightItem key={artifact.id} title={artifact.title} body={`${formatArtifactType(artifact.type)} · ${artifact.source_run_id || '无来源'}`}>
            <button type="button" onClick={() => openArtifact(artifact.id)}>打开</button>
          </InsightItem>
        ))}
      </InsightList>
      {verification && (
        <div className={`task-verification-block verification-${verification.status}`}>
          <h3>验证结果</h3>
          <p>{verification.summary || formatStatus(verification.status)}</p>
          {verification.checks.length > 0 && (
            <ul>
              {verification.checks.map((check) => (
                <li key={check.name}>{check.name} · {formatStatus(check.status)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="task-panel-actions">
        <button className="trace-link-button" type="button" onClick={openTrace}>查看执行过程</button>
        <button type="button" onClick={() => void continueProductTask(task)}>继续</button>
        <button
          type="button"
          disabled={!canInterrupt || !task.latest_run_id}
          onClick={() => task.latest_run_id ? void cancelRun(task.latest_run_id) : undefined}
        >
          暂停
        </button>
      </div>
    </section>
  );
}

function ProactiveQueuePanel({ messages, decide }: { messages: ProactiveMessage[]; decide: (id: string, action: string, feedback?: string) => Promise<void> }) {
  if (messages.length === 0) return null;
  return (
    <section className="right-panel-section compact-section">
      <h3>Joi 想提醒你的事</h3>
      {messages.slice(0, 4).map((item) => (
        <article key={item.id} className="proactive-card">
          <strong>{item.title}</strong>
          <p>{item.body}</p>
          <small>{item.reason} · {Math.round(item.score * 100)}%</small>
          <div>
            <button type="button" onClick={() => decide(item.id, 'send')}>发送</button>
            <button type="button" onClick={() => decide(item.id, 'dismiss')}>忽略</button>
            <button type="button" onClick={() => decide(item.id, 'annoying', 'too_annoying')}>太烦</button>
            <button type="button" onClick={() => decide(item.id, 'inaccurate', 'inaccurate')}>不准</button>
          </div>
        </article>
      ))}
    </section>
  );
}

function RecentArtifactsPanel({ artifacts, openArtifact }: { artifacts: ArtifactSummary[]; openArtifact: (id: string) => Promise<void> }) {
  if (artifacts.length === 0) return null;
  return (
    <section className="right-panel-section compact-section">
      <h3>交付结果</h3>
      {artifacts.slice(0, 4).map((artifact) => (
        <button key={artifact.id} className="artifact-mini-row" type="button" onClick={() => openArtifact(artifact.id)}>
          <strong>{artifact.title}</strong>
          <small>{formatArtifactType(artifact.type)} · v{artifact.version}</small>
        </button>
      ))}
    </section>
  );
}

function TaskMiniList({
  continueProductTask,
  selectProductTask,
  tasks,
}: {
  continueProductTask: (task: ProductTask) => Promise<void>;
  selectProductTask: (id: string) => Promise<void>;
  tasks: ProductTask[];
}) {
  const visible = visibleRecentTasksForHandoff(tasks);
  if (visible.length === 0) return null;
  return (
    <section className="right-panel-section compact-section">
      <h3>最近任务</h3>
      {visible.map((task) => (
        <div key={task.id} className="task-mini-row">
          <button className="task-mini-title" type="button" onClick={() => void selectProductTask(task.id)}>
            <strong>{task.title}</strong>
            <small>{formatStatus(task.status)} · {task.progress_percent}% · {formatChannelLabel(task.source_channel)}</small>
          </button>
          <div className="task-mini-actions">
            <button className="trace-link-button" type="button" onClick={() => void selectProductTask(task.id)}>打开</button>
            <button type="button" onClick={() => void continueProductTask(task)}>继续</button>
          </div>
        </div>
      ))}
    </section>
  );
}

function ArtifactViewer({ artifact, close }: { artifact: ArtifactDetail; close: () => void }) {
  return (
    <div className="artifact-viewer-backdrop" role="presentation">
      <section className="artifact-viewer" role="dialog" aria-modal="true" aria-labelledby="artifact-title">
        <header>
          <div>
            <small>{formatArtifactType(artifact.type)} · v{artifact.version} · {artifact.source_run_id || '无来源'}</small>
            <h2 id="artifact-title">{artifact.title}</h2>
          </div>
          <button type="button" aria-label="关闭交付物" onClick={close}>×</button>
        </header>
        <ScrollArea className="artifact-content">
          <pre>{artifact.content}</pre>
        </ScrollArea>
      </section>
    </div>
  );
}

function InsightList({ children, empty }: { children: ReactNode; empty: string }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  if (Array.isArray(items) && items.length === 0) {
    return <p className="empty">{empty}</p>;
  }
  return <div className="insight-list">{items || <p className="empty">{empty}</p>}</div>;
}

function InsightItem({ body, children, title }: { body?: string; children?: ReactNode; title: string }) {
  return (
    <article className="insight-item">
      <strong>{title}</strong>
      {body && <p>{body}</p>}
      {children && <div className="insight-actions">{children}</div>}
    </article>
  );
}

function isMemoryDisabled(memory: MemoryRecord) {
  return Boolean(memory.disabled || memory.disabled_at);
}

function isMemoryProposalForRun(memory: MemoryRecord, runID: string) {
  if (!runID || isMemoryDisabled(memory)) return false;
  if (memory.status === 'confirmed' || memory.status === 'rejected' || memory.status === 'deleted') return false;
  const metadataRunID = String(memory.metadata?.run_id || '');
  return metadataRunID === runID || Boolean(memory.source_event_ids?.includes(runID));
}

function memoryProposalWhy(memory: MemoryRecord) {
  const why = typeof memory.metadata?.why === 'string' ? memory.metadata.why : '';
  const futureEffect = typeof memory.metadata?.futureEffect === 'string' ? memory.metadata.futureEffect : '';
  return [why, futureEffect].filter(Boolean).join(' · ');
}

function extractUsedMemories(trace: RunTrace | null): MemorySearchResult[] {
  const results: MemorySearchResult[] = [];
  const seen = new Set<string>();
  for (const pack of trace?.memory_context_packs ?? []) {
    for (const raw of pack.dynamic_retrieval ?? []) {
      const result = normalizeMemorySearchResult(raw);
      if (!result?.memory?.id || seen.has(result.memory.id)) continue;
      seen.add(result.memory.id);
      results.push(result);
    }
  }
  return results;
}

function normalizeMemorySearchResult(value: unknown): MemorySearchResult | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Partial<MemorySearchResult>;
  if (!result.memory || typeof result.memory !== 'object') return null;
  const memory = result.memory as MemoryRecord;
  return {
    memory,
    score: typeof result.score === 'number' ? result.score : 0,
    reason: typeof result.reason === 'string' ? result.reason : 'retrieved',
  };
}

function formatMemoryReason(reason?: string) {
  if (!reason) return '召回';
  if (reason === 'sqlite_fts5') return '全文召回';
  if (reason === 'sqlite_keyword_fallback') return '关键词召回';
  return reason;
}

function ExecutionActionFlow({
  actions,
  collapsed = false,
  displayMode,
  mode = 'inline',
  openTrace,
  runStatus = 'completed',
}: {
  actions: ExecutionAction[];
  collapsed?: boolean;
  displayMode?: 'inline' | 'rail' | 'task';
  mode?: 'inline' | 'detail';
  openTrace?: () => void;
  runStatus?: string;
}) {
  const [manuallyExpanded, setManuallyExpanded] = useState(false);
  const visibleActions = visibleExecutionActions(actions);
  if (visibleActions.length === 0) return null;
  const resolvedDisplayMode = mode === 'detail' ? 'rail' : displayMode ?? getExecutionDisplayMode({ actions: visibleActions, status: runStatus });
  if (resolvedDisplayMode === 'task' && mode !== 'detail') return null;
  if (resolvedDisplayMode === 'inline' && mode === 'inline') {
    const action = visibleActions[0];
    const content = (
      <div className="execution-inline-wrap">
        <ExecutionInlineStatus action={action} onExpand={() => setManuallyExpanded((value) => !value)} expanded={manuallyExpanded} />
        {manuallyExpanded ? <ExecutionInlineDetails action={action} openTrace={openTrace} /> : null}
      </div>
    );
    return <article className="message-row execution-flow-row">{content}</article>;
  }
  const railCollapsed = mode === 'inline' && collapsed && !manuallyExpanded;
  const summary = summarizeExecutionActions(actions);
  const content = (
    <div className={`execution-action-flow execution-action-flow-${mode}${railCollapsed ? ' is-collapsed' : ''}`}>
      <ExecutionActionRail
        actions={visibleActions}
        collapsed={railCollapsed}
        onExpand={() => setManuallyExpanded(true)}
        runStatus={runStatus}
      />
      {!railCollapsed && mode === 'detail' ? (
        <div className="execution-action-list">
          {visibleActions.map((action, index) => (
            <ExecutionActionCard
              key={action.id}
              action={action}
              defaultOpen={action.status === 'running' || action.status === 'queued' || action.status === 'waiting_approval' || (index === visibleActions.length - 1 && mode === 'detail')}
            />
          ))}
        </div>
      ) : null}
      {!railCollapsed && mode === 'inline' && visibleActions.some((action) => hasActionDetails(action)) ? (
        <details className="execution-rail-details">
          <summary>展开</summary>
          <div className="execution-action-list">
            {visibleActions.map((action) => (
              <ExecutionInlineDetails key={action.id} action={action} openTrace={openTrace} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
  if (mode === 'detail') return content;
  return (
    <article className="message-row execution-flow-row">
      {content}
    </article>
  );
}

function ExecutionInlineStatus({ action, expanded, onExpand }: { action: ExecutionAction; expanded?: boolean; onExpand: () => void }) {
  return (
    <div className="execution-inline-status">
      <span className={`status-dot ${action.status === 'waiting_approval' ? 'waiting' : action.status === 'running' || action.status === 'queued' ? 'running' : action.status === 'failed' || action.status === 'blocked' ? 'failed' : 'done'}`} />
      <span>{action.completedLabel || action.summary || action.title}</span>
      <button className="inline-link" type="button" aria-expanded={expanded} onClick={onExpand}>展开</button>
    </div>
  );
}

function ExecutionActionRail({
  actions,
  collapsed,
  onExpand,
  runStatus,
}: {
  actions: ExecutionAction[];
  collapsed?: boolean;
  onExpand: () => void;
  runStatus: string;
}) {
  const waiting = runStatus === 'waiting_approval' || actions.some((action) => action.status === 'waiting_approval');
  const running = runStatus === 'running' || actions.some((action) => action.status === 'running' || action.status === 'queued');
  const failed = actions.some((action) => action.status === 'failed' || action.status === 'blocked' || action.status === 'limited');
  if (collapsed && !running && !failed) {
    return (
      <header className="execution-action-flow-header compact">
        <strong>{summarizeExecutionActions(actions)}</strong>
        <button type="button" onClick={onExpand}>展开</button>
      </header>
    );
  }
  return (
    <div className="execution-action-rail">
      <header className="execution-action-rail-header">
        <strong>{waiting ? 'Joi 等待你的确认' : running ? 'Joi 正在处理' : summarizeExecutionActions(actions)}</strong>
      </header>
      <div className="execution-action-rail-list">
        {actions.map((action) => (
          <div key={action.id} className={`execution-action-row status-${action.status}`}>
            <span className={`status-dot ${action.status === 'running' || action.status === 'queued' ? 'running' : action.status === 'waiting_approval' ? 'waiting' : action.status === 'failed' || action.status === 'blocked' ? 'failed' : 'done'}`} />
            <span>
              <strong>{actionLineTitle(action, running)}</strong>
              {running || action.summary || action.limitations?.length ? <small>{actionRowSummary(action, running)}</small> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExecutionInlineDetails({ action, openTrace }: { action: ExecutionAction; openTrace?: () => void }) {
  const sections = action.details.filter((detail) => detail.label !== 'COMMAND' || action.kind === 'command');
  return (
    <div className="execution-inline-details">
      {sections.map((detail) => (
        <ExecutionActionDetailBlock key={`${action.id}-${detail.label}`} detail={detail} />
      ))}
      {openTrace ? <button className="developer-diagnostics-link" type="button" onClick={openTrace}>开发者诊断</button> : null}
    </div>
  );
}

function ExecutionActionCard({ action, defaultOpen = false }: { action: ExecutionAction; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [userTouched, setUserTouched] = useState(false);

  useEffect(() => {
    if (!userTouched) {
      setOpen(action.status === 'running' || action.status === 'queued' || action.status === 'waiting_approval');
    }
  }, [action.status, userTouched]);

  return (
    <details
      className={`execution-action-card action-${action.kind} status-${action.status}`}
      open={open}
      onToggle={(event) => {
        setUserTouched(true);
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <span className="execution-action-dot" />
        <span className="execution-action-copy">
          <strong>{action.title}</strong>
          <small>{action.description}</small>
        </span>
        <span className="execution-action-meta">
          <strong>{formatStatus(action.status)}</strong>
          {action.duration_ms ? <small>{formatDuration(action.duration_ms)}</small> : null}
        </span>
      </summary>
      <div className="execution-action-body">
        {action.details.length > 0 ? action.details.map((detail) => (
          <ExecutionActionDetailBlock key={`${action.id}-${detail.label}`} detail={detail} />
        )) : (
          <p className="empty">没有额外输出。</p>
        )}
      </div>
    </details>
  );
}

function ExecutionActionDetailBlock({ detail }: { detail: ExecutionActionDetail }) {
  return (
    <section className="execution-action-detail">
      <h4>{detail.label}</h4>
      {typeof detail.value === 'string' || typeof detail.value === 'number' || typeof detail.value === 'boolean' ? (
        <pre>{String(detail.value)}</pre>
      ) : (
        <pre>{formatRawData(detail.value)}</pre>
      )}
    </section>
  );
}

function hasActionDetails(action: ExecutionAction) {
  return action.details.length > 0 || Boolean(action.limitations?.length);
}

function actionLineTitle(action: ExecutionAction, running: boolean) {
  const suffix = action.sourceLabel ? ` ${action.sourceLabel}` : '';
  if (running && (action.status === 'running' || action.status === 'queued')) {
    if (action.kind === 'web') return `读取网页${suffix}`;
    if (action.kind === 'workspace') return `搜索工作区${suffix}`;
    if (action.kind === 'file') return `读取文件${suffix}`;
  }
  return `${action.title}${suffix}`;
}

function actionRowSummary(action: ExecutionAction, running: boolean) {
  if (action.status === 'waiting_approval') return action.summary || action.description || '等待你的确认';
  if (running && (action.status === 'running' || action.status === 'queued')) {
    if (action.kind === 'web') return '正在提取正文...';
    return action.summary || action.description || '正在执行...';
  }
  if (action.limitations?.length) return action.limitations.join('；');
  return action.summary || action.description;
}

function upsertExecutionAction(actions: ExecutionAction[], event: ExecutionEvent, status: ExecutionActionStatus): ExecutionAction[] {
  const sourceLabel = String(event.source_label || event.sourceLabel || sourceLabelFromExecutionEvent(event));
  const title = String(event.title || defaultActionTitle(event.kind));
  const kind = normalizeExecutionActionKind(event.kind);
  const actionID = String(event.action_id || event.actionID || `${kind}-${title}-${sourceLabel || 'default'}`);
  const next: ExecutionAction = {
    id: actionID,
    kind,
    title,
    description: String(event.summary || event.status || title),
    summary: String(event.summary || ''),
    sourceLabel,
    status,
    completedLabel: status === 'completed' ? completedLabelFromEvent(kind, sourceLabel, title) : undefined,
    duration_ms: typeof event.duration_ms === 'number' ? event.duration_ms : event.durationMs,
    durationMs: typeof event.duration_ms === 'number' ? event.duration_ms : event.durationMs,
    details: event.details ?? [],
    raw_steps: [],
  };
  const index = actions.findIndex((action) => (
    action.id === actionID
    || (action.kind === kind && action.title === title && (!sourceLabel || action.sourceLabel === sourceLabel))
    || (action.kind === kind && action.status === 'running' && status === 'completed')
  ));
  if (index < 0) return [...actions, next];
  const copy = [...actions];
  copy[index] = {
    ...copy[index],
    ...next,
    details: next.details.length > 0 ? next.details : copy[index].details,
    completedLabel: next.completedLabel || copy[index].completedLabel,
    sourceLabel: next.sourceLabel || copy[index].sourceLabel,
    summary: next.summary || copy[index].summary,
  };
  return copy;
}

function toolEventToExecutionAction(event: ExecutionEvent): ExecutionEvent {
  const raw = event as ExecutionEvent & { tool_name?: string; toolName?: string; call_id?: string; callID?: string; arguments?: unknown; output?: unknown };
  const toolName = String(raw.tool_name || raw.toolName || raw.title || 'tool');
  const kind = actionKindForToolName(toolName);
  const title = actionTitleForToolName(toolName);
  const actionID = String(raw.call_id || raw.callID || raw.action_id || raw.actionID || `${toolName}-tool`);
  return {
    ...event,
    action_id: actionID,
    kind,
    title,
    summary: String(event.summary || (String(event.status || '').toLowerCase() === 'failed' ? '执行失败' : title)),
    source_label: String(event.source_label || event.sourceLabel || toolName),
    details: mergeExecutionEventDetails([
      { label: 'COMMAND', value: toolName },
      { label: 'INPUT', value: raw.arguments },
      { label: 'RESULT', value: raw.output },
    ], event.details),
  };
}

function approvalEventToExecutionAction(event: ExecutionEvent): ExecutionEvent {
  const raw = event as ExecutionEvent & { confirmation_id?: string; capability?: string; risk?: string };
  const capability = String(raw.capability || 'confirmation');
  return {
    ...event,
    action_id: String(raw.confirmation_id || event.action_id || `${capability}-confirmation`),
    kind: 'confirmation',
    title: '等待确认',
    summary: String(event.summary || `${capability} 等待你的确认`),
    source_label: capability,
    details: mergeExecutionEventDetails([
      { label: 'INPUT', value: { capability, risk: raw.risk, confirmation_id: raw.confirmation_id } },
    ], event.details),
  };
}

function mergeExecutionEventDetails(base: ExecutionActionDetail[], extra?: ExecutionActionDetail[]): ExecutionActionDetail[] {
  return [...base, ...(extra ?? [])].filter((detail) => (
    detail.value !== undefined
    && detail.value !== null
    && detail.value !== ''
  ));
}

function actionKindForToolName(toolName: string): ExecutionActionKind {
  const key = toolName.toLowerCase();
  if (key.includes('web') || key.includes('browser')) return 'web';
  if (key.includes('workspace_search')) return 'workspace';
  if (key.includes('file') || key.includes('patch')) return 'file';
  if (key.includes('memory')) return 'memory';
  if (key.includes('test') || key.includes('shell') || key.includes('command')) return 'command';
  if (key.includes('health') || key.includes('diagnose')) return 'diagnostic';
  return 'command';
}

function actionTitleForToolName(toolName: string): string {
  const key = toolName.toLowerCase();
  if (key.includes('web') || key.includes('browser')) return '读取网页';
  if (key.includes('workspace_search')) return '搜索工作区';
  if (key.includes('file_read')) return '读取文件';
  if (key.includes('file_analyze')) return '分析文件';
  if (key.includes('apply_patch')) return '修改文件';
  if (key.includes('memory')) return '处理记忆';
  if (key.includes('test') || key.includes('shell') || key.includes('command')) return '运行命令';
  if (key.includes('health')) return '系统自检';
  if (key.includes('diagnose')) return '诊断服务';
  return '执行工具';
}

function normalizeExecutionActionKind(kind: unknown): ExecutionActionKind {
  const value = String(kind || '').toLowerCase();
  if (value === 'web' || value === 'workspace' || value === 'file' || value === 'command' || value === 'artifact' || value === 'memory' || value === 'evidence' || value === 'model' || value === 'proactive' || value === 'confirmation' || value === 'diagnostic') {
    return value;
  }
  if (value === 'tool') return 'command';
  return 'command';
}

function defaultActionTitle(kind: unknown) {
  if (kind === 'web') return '读取网页';
  if (kind === 'workspace') return '搜索工作区';
  if (kind === 'file') return '读取文件';
  if (kind === 'evidence') return '引用工具证据';
  if (kind === 'model') return '模型回答';
  return '执行动作';
}

function completedLabelFromEvent(kind: ExecutionActionKind, sourceLabel: string, title: string) {
  if (kind === 'web') return `已读取网页${sourceLabel ? ` · ${sourceLabel}` : ''}`;
  if (kind === 'file') return `已读取文件${sourceLabel ? ` · ${sourceLabel}` : ''}`;
  if (kind === 'workspace') return `已搜索工作区${sourceLabel ? ` · ${sourceLabel}` : ''}`;
  return title;
}

function sourceLabelFromExecutionEvent(event: ExecutionEvent) {
  const sourceDetail = event.details?.find((detail) => detail.label === 'SOURCE')?.value;
  if (typeof sourceDetail === 'string') return sourceLabelFromURL(sourceDetail) || sourceDetail;
  return '';
}

function normalizeRunExecutionStatus(status?: string): ExecutionRunStatus {
  if (status === 'succeeded' || status === 'success' || status === 'completed') return 'completed';
  if (status === 'running') return 'running';
  if (status === 'waiting_confirmation' || status === 'waiting_approval') return 'waiting_approval';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function formatDuration(value: number) {
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

function splitStreamingChunks(value: string) {
  const text = value.trim();
  if (!text) return [];
  const chunks = text.match(/[^。！？.!?\n]+[。！？.!?\n]?\s*/g);
  return chunks?.filter(Boolean) ?? [text];
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function userFacingAssistantText(content: string) {
  if (/^confirmation_required\s*:/i.test(content.trim())) {
    return '';
  }
  if (content.includes('task_attempts') || content.includes('tool_runs') || content.includes('Run Trace')) {
    if (content.includes('已将任务派发') || content.includes('已交给') || content.includes('worker')) {
      return '已交给执行后台处理，结果会在这里更新。';
    }
  }
  return content
    .replace(/。?完整 Run Trace 已记录[^。]*。?/g, '')
    .replace(/Run Trace/g, '执行详情')
    .trim();
}

function shouldShowExecutionActionFlow(actions: ExecutionAction[]) {
  return visibleExecutionActions(actions).length > 0;
}

function shouldShowInlineRunDetails(chat: ChatResponse | null, trace: RunTrace | null, latestTask: ProductTaskDetail | null, executionActions: ExecutionAction[]): boolean {
  if (latestTask || executionActions.length > 0) return true;
  const uiInline = chat?.ui?.inline_execution ?? booleanFromUnknown(trace?.metadata?.ui_inline_execution);
  if (uiInline) return true;
  const interactionClass = String(chat?.ui?.interaction_class || trace?.metadata?.interaction_class || '');
  return !['', 'chat_assist', 'clarify'].includes(interactionClass);
}

function composerModelOptions(settings: SettingsRecord | null, selectedModelName: string, savedModels: AvailableModel[]) {
  const configured = settings?.model_name || 'deepseek-v4-flash';
  const options = new Set<string>();
  const providerModels = savedModelsForProvider(savedModels, settings?.model_provider, settings?.model_base_url);
  const configuredIsSaved = providerModels.some((model) => model.id === configured);
  if (selectedModelName) options.add(selectedModelName);
  if (providerModels.length === 0 || configuredIsSaved) options.add(configured);
  for (const model of providerModels) {
    if (model.config?.enabled === false) continue;
    if (model.id) options.add(model.id);
  }
  const preset = Object.values(modelProviderPresets).find((item) => (
    item.provider === settings?.model_provider && item.baseURL === settings?.model_base_url
  )) ?? (settings?.model_base_url?.includes('deepseek.com') ? modelProviderPresets.deepseek : undefined);

  for (const item of preset?.models ?? []) {
    if (item) options.add(item);
  }
  if (preset?.reasoningModel) {
    options.add(preset.reasoningModel);
  }
  return Array.from(options).filter(Boolean);
}

function savedModelsForProvider(models: AvailableModel[], provider?: string, baseURL?: string) {
  const normalizedProvider = normalizeProvider(provider || '');
  const normalizedBaseURL = normalizeBaseURL(baseURL || '');
  return models.filter((model) => {
    if (normalizedProvider && !providerMatches(model.provider, normalizedProvider)) return false;
    if (normalizedProvider && !ownerMatchesProvider(model.owner, normalizedProvider)) return false;
    if (normalizedBaseURL && normalizeBaseURL(model.base_url || '') !== normalizedBaseURL) return false;
    return Boolean(model.id);
  });
}

function normalizeProvider(value: string) {
  return value.trim().toLowerCase();
}

function providerAliases(provider: string): Set<string> {
  if (['xai', 'xai_oauth', 'xai-oauth'].includes(provider)) {
    return new Set(['xai', 'xai_oauth', 'xai-oauth']);
  }
  return new Set([provider]);
}

function providerMatches(modelProvider: string | undefined, provider: string) {
  return providerAliases(provider).has(normalizeProvider(modelProvider || ''));
}

function ownerMatchesProvider(owner: string | undefined, provider: string) {
  const normalizedOwner = normalizeProvider(owner || '');
  if (!normalizedOwner) return true;
  if (!knownProviderOwnerValues.has(normalizedOwner)) return true;
  return providerAliases(provider).has(normalizedOwner);
}

const knownProviderOwnerValues = new Set([
  'anthropic',
  'gemini',
  'local',
  'openai',
  'openai_compatible',
  'openrouter',
  'xai',
  'xai-oauth',
  'xai_oauth',
]);

function normalizeBaseURL(value: string) {
  return value.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

function preferredDefaultModel(models: AvailableModel[]) {
  return models.find((model) => model.config?.role === 'default')?.id
    || models.find((model) => model.id.toLowerCase().includes('flash'))?.id
    || models[0]?.id
    || 'deepseek-v4-flash';
}

function preferredReasoningModel(models: AvailableModel[]) {
  return models.find((model) => model.config?.role === 'reasoning')?.id
    || models.find((model) => model.supports_reasoning)?.id
    || models.find((model) => model.id.toLowerCase().includes('pro'))?.id
    || models[0]?.id
    || '';
}

function executionTargetLabelFromTrace(trace: RunTrace | null, fallback: string) {
  const preferredNode = String(trace?.metadata?.preferred_node || trace?.route_result?.preferred_node || '');
  const allowWorker = Boolean(trace?.metadata?.allow_worker ?? trace?.route_result?.allow_worker);
  const match = executionTargetOptions.find((item) => item.preferredNode === preferredNode && item.allowWorker === allowWorker)
    ?? executionTargetOptions.find((item) => item.preferredNode === preferredNode);
  return match?.label || fallback;
}

function OnboardingPanel({
  status,
  createBackup,
  refreshAll,
  setError,
  setNotice,
}: {
  status: OnboardingStatus;
  createBackup: () => Promise<void>;
  refreshAll: () => Promise<void>;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
}) {
  const [provider, setProvider] = useState('openai_compatible');
  const [baseURL, setBaseURL] = useState('https://api.deepseek.com/v1');
  const [modelName, setModelName] = useState('deepseek-v4-flash');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramTokenVisible, setTelegramTokenVisible] = useState(false);
  const [workerToken, setWorkerToken] = useState('');

  async function runStep(action: () => Promise<void>, success: string) {
    setError('');
    try {
      await action();
      setNotice(success);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveAndTestModel() {
    await runStep(async () => {
      await desktopApi.saveModelConfig({ provider, base_url: baseURL, name: modelName, timeout_seconds: 60, max_retries: 1 });
      if (apiKey.trim()) {
        await desktopApi.saveSecret({ name: 'MODEL_API_KEY', value: apiKey.trim() });
        setApiKey('');
      }
      const result = await desktopApi.testModelConnection({ provider, base_url: baseURL, name: modelName, timeout_seconds: 60, max_retries: 1 });
      if (!result.ok) {
        throw new Error(result.error_summary || result.status);
      }
    }, '模型连接已验证。');
  }

  async function saveAndTestTelegram() {
    await runStep(async () => {
      if (telegramToken.trim()) {
        await desktopApi.saveSecret({ name: 'TELEGRAM_BOT_TOKEN', value: telegramToken.trim() });
        setTelegramToken('');
      }
      const result = await desktopApi.testTelegramConnection();
      if (!result.ok) {
        throw new Error(result.error_summary || result.status);
      }
    }, 'Telegram 连接已验证。');
  }

  async function generateWorkerToken() {
    await runStep(async () => {
      const result = await desktopApi.generateWorkerToken();
      setWorkerToken(result.token);
    }, '工作节点令牌已生成。');
  }

  async function finishOnboarding() {
    await runStep(async () => {
      await desktopApi.completeOnboarding();
    }, '初始化已完成。');
  }

  return (
    <section className="panel wide onboarding">
      <div className="onboarding-intro">
        <div>
          <p className="eyebrow">Joi 桌面 AI</p>
          <h2>先聊天判断，也能认真执行任务。</h2>
          <p>
            你可以直接说想法，也可以输入“认真执行”。Joi 会把长期记忆、当前任务、交付物和准备提醒你的事放在可检查的位置。
          </p>
        </div>
        <dl className="setup-readiness">
          <KV label="模型" value={status.model_configured ? '已配置' : '需要连接'} />
          <KV label="备份" value={status.first_backup_created ? `${status.backup_count} 个` : '需要创建'} />
          <KV label="Telegram" value={status.telegram_configured ? '已配置' : '可稍后'} />
          <KV label="工作节点" value={status.worker_configured ? '已配置' : '可稍后'} />
        </dl>
      </div>

      <div className="onboarding-capabilities" aria-label="Joi 可以怎么用">
        <article>
          <strong>聊聊</strong>
          <span>把纠结、偏好和方向说出来，Joi 会先给判断，不把临时情绪当长期人格。</span>
        </article>
        <article>
          <strong>认真执行</strong>
          <span>需要报告、计划或复盘时会生成任务步骤，结果会保留在执行详情里。</span>
        </article>
        <article>
          <strong>交付物</strong>
          <span>报告和 backlog 可以单独打开，也能作为下一轮对话上下文继续改。</span>
        </article>
        <article>
          <strong>提醒候选</strong>
          <span>提醒先进入审核队列，你可以发送、忽略、标记太烦或不准。</span>
        </article>
      </div>

      <details className="onboarding-config">
        <summary>连接模型并完成本地初始化</summary>
        <div className="settings-grid">
          <section>
            <h3>模型</h3>
            <label>
              服务商
              <input value={provider} onChange={(event) => setProvider(event.target.value)} />
            </label>
            <label>
              接口地址
              <input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} />
            </label>
            <label>
              模型
              <input value={modelName} onChange={(event) => setModelName(event.target.value)} />
            </label>
            <label>
              接口密钥
              <SecretInput value={apiKey} visible={apiKeyVisible} onChange={setApiKey} onToggleVisible={() => setApiKeyVisible((value) => !value)} />
            </label>
            <button type="button" onClick={saveAndTestModel}>保存并测试模型</button>
            {availableModels.length > 0 && <ModelList models={availableModels} />}
          </section>
          <section>
            <h3>可选能力</h3>
            <label>
              Telegram 令牌
              <SecretInput value={telegramToken} visible={telegramTokenVisible} onChange={setTelegramToken} onToggleVisible={() => setTelegramTokenVisible((value) => !value)} />
            </label>
            <button type="button" onClick={saveAndTestTelegram}>测试 Telegram</button>
            <button type="button" onClick={generateWorkerToken}>生成工作节点令牌</button>
            {workerToken && <code>{workerToken}</code>}
          </section>
          <section>
            <h3>备份</h3>
            <button type="button" onClick={createBackup}>创建首次备份</button>
            <button disabled={!status.model_configured || !status.first_backup_created} type="button" onClick={finishOnboarding}>完成</button>
          </section>
        </div>
      </details>
    </section>
  );
}

function TraceStage({
  firstModelCall,
  goBack,
  stepCount,
  trace,
}: {
  firstModelCall?: ModelCall;
  goBack: () => void;
  stepCount: number;
  trace: RunTrace | null;
}) {
  return (
    <section className="trace-stage">
      <header className="trace-stage-topbar">
        <button className="trace-stage-back-button" type="button" onClick={goBack}>返回对话</button>
        <span>执行过程</span>
      </header>
      <ScrollArea className="trace-stage-scroll">
        <TraceDetail firstModelCall={firstModelCall} stepCount={stepCount} trace={trace} />
      </ScrollArea>
    </section>
  );
}

function TracePanel({ trace, stepCount, firstModelCall }: { trace: RunTrace | null; stepCount: number; firstModelCall?: ModelCall }) {
  const actions = visibleExecutionActions(projectRunTraceToActions(trace));
  const traceUsage = summarizeModelCalls(trace?.model_calls ?? []);
  return (
    <section className="panel trace-panel">
      <h2>运行记录</h2>
      {trace ? (
        <>
          <dl>
            <KV label="状态" value={formatStatus(trace.status)} />
            <KV label="代理" value={trace.selected_agent_id} />
            <KV label="步骤" value={`${stepCount} 步`} />
            <KV label="模型" value={firstModelCall?.model_name ?? '无'} />
            <KV label="服务商" value={firstModelCall?.provider ?? '无'} />
            <KV label="令牌" value={`${formatTokenCount(traceUsage.total_tokens)} total`} />
          </dl>
          {actions.length > 0 ? <ExecutionActionFlow actions={actions} mode="detail" /> : <p className="empty">这次运行没有需要展示的执行动作。</p>}
        </>
      ) : (
        <p className="empty">发送一条消息后会生成运行记录。</p>
      )}
    </section>
  );
}

function TraceDetail({ trace, stepCount, firstModelCall }: { trace: RunTrace | null; stepCount: number; firstModelCall?: ModelCall }) {
  if (!trace) return <section className="panel wide"><p className="empty">暂无运行记录。</p></section>;
  const actions = visibleExecutionActions(projectRunTraceToActions(trace));
  const traceUsage = summarizeModelCalls(trace.model_calls ?? []);
  return (
    <section className="panel wide">
      <h2>执行过程</h2>
      <dl className="metrics">
        <KV label="状态" value={formatStatus(trace.status)} />
        <KV label="可见动作" value={`${actions.length} 个`} />
        <KV label="耗时" value={formatMilliseconds(firstModelCall?.latency_ms ?? 0)} />
        <KV label="本次令牌" value={`${formatTokenCount(traceUsage.total_tokens)} total`} />
        <KV label="本次成本" value={formatCost(traceUsage.cost_estimate)} />
      </dl>
      {actions.length > 0 ? (
        <ExecutionActionFlow actions={actions} mode="detail" />
      ) : (
        <p className="empty">这次运行没有可投影的执行动作。</p>
      )}
      <details className="developer-diagnostics">
        <summary>开发者诊断</summary>
        <dl className="metrics compact">
          <KV label="运行 ID" value={trace.id} />
          <KV label="代理" value={trace.selected_agent_id} />
          <KV label="提示词组装" value={`${trace.prompt_assemblies?.length ?? 0} 次`} />
          <KV label="记忆包" value={`${trace.memory_context_packs?.length ?? 0} 个`} />
          <KV label="模型调用" value={`${trace.model_calls?.length ?? 0} 次`} />
          <KV label="步骤数" value={`${stepCount} 步`} />
        </dl>
        <div className="split diagnostics-split">
          <StepList trace={trace} />
          <TraceRuntimeSummary trace={trace} />
        </div>
        <section className="run-event-section">
          <h3>Run Events</h3>
          <TraceDrawer events={sortBySeq(normalizeTraceEvents(trace))} />
        </section>
      </details>
    </section>
  );
}

function StepList({ trace }: { trace: RunTrace }) {
  return (
    <ol className="step-list">
      {trace.steps?.map((step) => (
        <li key={step.id}>
          <strong>{formatStepType(step.step_type)}</strong>
          <span>{step.title || formatStepType(step.step_type)} · {formatStatus(step.status)}</span>
          {step.output ? <CollapsedData label="查看步骤输出" value={step.output} /> : null}
          {step.input ? <CollapsedData label="查看步骤输入" value={step.input} /> : null}
        </li>
      ))}
    </ol>
  );
}

function SystemPanel({ health }: { health: SystemHealth | null }) {
  return (
    <section className="panel wide">
      <h2>系统状态</h2>
      <dl className="metrics">
        <KV label="SQLite" value={formatBoolean(Boolean(health?.service_status?.sqlite))} />
        <KV label="运行中任务" value={String(health?.queue_status?.active_tasks ?? 0)} />
        <KV label="异常任务" value={String(health?.queue_status?.dead_tasks ?? 0)} />
        <KV label="工作节点数量" value={String(health?.worker_status?.length ?? 0)} />
        <KV label="今日模型调用" value={String(health?.model_latency?.model_calls_today ?? 0)} />
        <KV label="警告" value={String(health?.warnings?.length ?? 0)} />
      </dl>
      <div className="settings-grid gui-grid">
        <InfoGroup title="服务状态" value={health?.service_status} />
        <InfoGroup title="任务队列" value={health?.queue_status} />
        <InfoGroup title="模型延迟" value={health?.model_latency} />
        <InfoGroup title="今日令牌" value={health?.token_cost_today} />
      </div>
      <CollapsedData label="高级详情" value={health ?? {}} />
    </section>
  );
}

function ClosureReportPanel({
  continueProductTaskByID,
  externalHandoffAudit,
  report,
}: {
  continueProductTaskByID: (id: string) => Promise<void>;
  externalHandoffAudit: ExternalHandoffAudit | null;
  report: RunClosureReport | null;
}) {
  const metrics = report?.metrics ?? {
    total_runs: 0,
    terminal_event_runs: 0,
    execution_runs: 0,
    execution_runs_with_task_or_refusal: 0,
    completed_tasks: 0,
    completed_tasks_with_evidence: 0,
    runs_with_tool_evidence: 0,
    runs_with_memory_events: 0,
    runs_with_proactive_events: 0,
    runs_with_handoff_events: 0,
    recoverable_runs: 0,
  };
  const items = report?.items ?? [];
  const handoffStatus = externalHandoffAudit?.status || 'unknown';
  const handoffReadiness = externalHandoffAudit?.readiness;
  const pendingExternalHandoffs = externalHandoffAudit?.pending_external_handoffs ?? [];

  return (
    <section className="settings-data-panel closure-report-panel">
      <h3>最近运行闭环报告</h3>
      <article className="row-card compact closure-run-card">
        <strong>外部入口 Handoff</strong>
        <small>
          状态：{formatExternalHandoffStatus(handoffStatus)}
          {handoffReadiness?.checked ? ` · 连接：${handoffReadiness.ok ? 'ready' : 'not ready'}` : ''}
        </small>
        <div className="closure-report-signals">
          <span>外部运行：{externalHandoffAudit?.metrics.external_runs ?? 0}</span>
          <span>Desktop 运行：{externalHandoffAudit?.metrics.desktop_runs ?? 0}</span>
          <span>已链接任务：{externalHandoffAudit?.metrics.linked_external_desktop_tasks ?? 0}</span>
          <span>入口：{externalHandoffAudit?.external_channels_seen.length ? externalHandoffAudit.external_channels_seen.join(', ') : '暂无'}</span>
        </div>
        {pendingExternalHandoffs.length ? (
          <div className="closure-report-signals">
            {pendingExternalHandoffs.slice(0, 3).map((handoff) => (
              <span className="closure-report-action-signal" key={handoff.external_run_id}>
                <span>
                  待接续：{formatChannelLabel(handoff.external_channel)} · {compactIdentifier(handoff.product_task_id)}
                  {handoff.latest_task_status ? ` · ${formatStatus(handoff.latest_task_status)}` : ''}
                </span>
                <button type="button" onClick={() => void continueProductTaskByID(handoff.product_task_id)}>继续</button>
              </span>
            ))}
            {pendingExternalHandoffs.length > 3 ? <span>另 {pendingExternalHandoffs.length - 3} 条待接续</span> : null}
          </div>
        ) : null}
        {externalHandoffAudit?.next_action ? <p>{externalHandoffAudit.next_action}</p> : null}
        {handoffReadiness?.checked ? (
          <div className="closure-report-signals">
            {Object.entries(handoffReadiness.credentials).map(([name, credential]) => (
              <span key={name}>{name}：{credential.present ? credential.source : 'missing'}</span>
            ))}
            {Object.entries(handoffReadiness.checks).map(([name, check]) => (
              <span key={name}>{name}：{check.ok ? 'passed' : check.status}</span>
            ))}
            {Object.entries(handoffReadiness.services).map(([name, service]) => (
              <span key={`service-${name}`}>{service.label || name}：{formatExternalServiceStatus(service)}</span>
            ))}
          </div>
        ) : null}
      </article>
      <dl className="metrics closure-report-metrics">
        <KV label="最近运行" value={`${metrics.total_runs} 条`} />
        <KV label="终态事件" value={`${metrics.terminal_event_runs} 条`} />
        <KV label="任务覆盖" value={`${metrics.execution_runs_with_task_or_refusal}/${metrics.execution_runs}`} />
        <KV label="任务证据" value={`${metrics.completed_tasks_with_evidence}/${metrics.completed_tasks}`} />
        <KV label="工具证据" value={`${metrics.runs_with_tool_evidence} 条`} />
        <KV label="记忆使用" value={`${metrics.runs_with_memory_events} 条`} />
        <KV label="主动闭环" value={`${metrics.runs_with_proactive_events} 条`} />
        <KV label="Handoff" value={`${metrics.runs_with_handoff_events} 条`} />
        <KV label="需恢复" value={`${metrics.recoverable_runs} 条`} />
      </dl>
      <RecordList
        emptyText="暂无运行闭环报告。"
        items={items.slice(0, 12)}
        renderItem={(item) => {
          const terminalLabel = item.terminal_event_present
            ? (item.terminal_event_type || item.terminal_status || '已记录')
            : '缺失';
          const updatedAt = formatShortTime(item.updated_at || item.created_at) || '未知时间';
          return (
            <article key={item.run_id} className="row-card compact closure-run-card">
              <strong>{compactIdentifier(item.run_id) || '未知运行'}</strong>
              <small>
                状态：{formatStatus(item.status)}
                {item.terminal_status ? ` · 终态：${formatStatus(item.terminal_status)}` : ''}
                {item.task_id ? ` · 任务：${compactIdentifier(item.task_id)}` : ''}
              </small>
              <div className="closure-report-signals">
                <span>终态事件：{terminalLabel}</span>
                <span>任务证据：{item.has_task_evidence ? '有' : '无'}</span>
                <span>工具：{item.tool_run_count} 次</span>
                <span>终态工具：{item.terminal_tool_event_count}</span>
                <span>记忆：{item.memory_event_count}</span>
                <span>主动：{item.proactive_event_count}</span>
                <span>Handoff：{item.handoff_event_count}</span>
                <span>恢复：{item.recovery_required ? '需要' : '无需'}</span>
              </div>
              {item.task_status || item.terminal_reason ? (
                <small>
                  {item.task_status ? `任务状态：${formatStatus(item.task_status)}` : ''}
                  {item.task_status && item.terminal_reason ? ' · ' : ''}
                  {item.terminal_reason ? `原因：${item.terminal_reason}` : ''}
                </small>
              ) : null}
              {item.task_evidence_summary ? <p>{item.task_evidence_summary}</p> : null}
              <small>更新：{updatedAt}</small>
            </article>
          );
        }}
      />
      <CollapsedData label="闭环报告 JSON" value={report ?? {}} />
    </section>
  );
}

function MemoryPanel({
  memories,
  memoryQuery,
  setMemoryQuery,
  refreshAll,
  updateMemory,
}: {
  memories: MemoryRecord[];
  memoryQuery: string;
  setMemoryQuery: (value: string) => void;
  refreshAll: () => Promise<void>;
  updateMemory: (id: string, action: string, extra?: Partial<MemoryRecord>) => Promise<void>;
}) {
  const inbox = memories.filter((memory) => memory.status !== 'confirmed' || memory.confidence < 0.6 || Boolean(memory.conflict_group_id) || Boolean(memory.merged_into_memory_id));

  async function editAndConfirm(memory: MemoryRecord) {
    const edited = window.prompt('确认前编辑记忆', memory.content);
    if (edited === null) return;
    await updateMemory(memory.id, 'edit_confirm', { content: edited, summary: memory.summary });
  }

  return (
    <section className="panel wide">
      <div className="section-header">
        <h2>记忆管理</h2>
        <div className="control-row">
          <input value={memoryQuery} placeholder="搜索记忆" onChange={(event) => setMemoryQuery(event.target.value)} />
          <button type="button" onClick={refreshAll}>搜索</button>
        </div>
      </div>
      <h3>待处理记忆</h3>
      <div className="table">
        {inbox.map((memory) => (
          <article key={`inbox-${memory.id}`} className="row-card">
            <div>
              <strong>{memory.summary || memory.type}</strong>
              <p>{memory.content}</p>
              <small>{formatStatus(memory.status)} · 置信度 {memory.confidence.toFixed(2)} · 重复 {memory.merged_into_memory_id || '无'} · 冲突 {memory.conflict_group_id || '无'}</small>
            </div>
            <div className="row-actions">
              <button type="button" onClick={() => updateMemory(memory.id, 'confirm')}>确认</button>
              <button type="button" onClick={() => editAndConfirm(memory)}>编辑并确认</button>
              <button type="button" onClick={() => updateMemory(memory.id, 'mark_global')}>全局</button>
              <button type="button" onClick={() => updateMemory(memory.id, 'mark_project')}>项目</button>
              <button type="button" onClick={() => updateMemory(memory.id, 'reject')}>别记</button>
              <button type="button" onClick={() => updateMemory(memory.id, 'delete')}>删除</button>
            </div>
          </article>
        ))}
        {inbox.length === 0 && <p className="empty">暂无待处理记忆。</p>}
      </div>
      <h3>已确认与搜索结果</h3>
      <div className="table">
        {memories.map((memory) => (
          <article key={memory.id} className="row-card">
            <div>
              <strong>{memory.summary || memory.type}</strong>
              <p>{memory.content}</p>
              <small>{formatStatus(memory.status)} · 置信度 {memory.confidence.toFixed(2)} · 命中 {memory.usage_count} · 反馈 {memory.positive_feedback}/{memory.negative_feedback}</small>
              {memory.conflict_group_id && <small>冲突：{memory.conflict_group_id} {memory.conflict_reason}</small>}
              {memory.source_event_ids?.length ? <small>来源：{memory.source_event_ids.join(', ')}</small> : null}
              {memory.metadata ? <CollapsedData label="高级详情" value={memory.metadata} /> : null}
            </div>
            <div className="row-actions">
              <button type="button" onClick={() => updateMemory(memory.id, memory.pinned ? 'unpin' : 'pin')}>{memory.pinned ? '取消置顶' : '置顶'}</button>
              <button type="button" onClick={() => updateMemory(memory.id, memory.disabled ? 'enable' : 'disable')}>{memory.disabled ? '启用' : '停用'}</button>
              <button type="button" onClick={() => updateMemory(memory.id, 'feedback_positive')}>有效</button>
              <button type="button" onClick={() => updateMemory(memory.id, 'feedback_negative')}>无效</button>
              <button type="button" onClick={() => updateMemory(memory.id, 'mark_conflict')}>标记冲突</button>
            </div>
          </article>
        ))}
        {memories.length === 0 && <p className="empty">没有匹配的记忆。</p>}
      </div>
    </section>
  );
}

function NodesPanel({
  nodes,
  audit,
  setNodeDisabled,
  rotateWorkerToken,
}: {
  nodes: NodeRecord[];
  audit: WorkerGatewayAuditRecord[];
  setNodeDisabled: (nodeID: string, disabled: boolean) => Promise<void>;
  rotateWorkerToken: () => Promise<void>;
}) {
  return (
    <section className="panel wide">
      <div className="section-header">
        <h2>节点与执行</h2>
        <button type="button" onClick={rotateWorkerToken}>重置工作节点令牌</button>
      </div>
      <div className="table">
        {nodes.map((node) => (
          <article key={node.id} className="row-card">
            <div>
              <strong>{node.id}</strong>
              <p>{node.name} · {formatNodeRole(node.role)} · {formatStatus(node.status)}</p>
              <small>自动分配 {formatBoolean(node.auto_assign_enabled)} · 手动指定 {formatBoolean(node.manual_assign_enabled)}</small>
              <small>能力：{(node.capabilities ?? []).join('、') || '未注册'}</small>
              {node.metadata ? <CollapsedData label="高级详情" value={node.metadata} /> : null}
            </div>
            <div className="row-actions">
              {node.status === 'disabled' ? (
                <button type="button" onClick={() => setNodeDisabled(node.id, false)}>启用</button>
              ) : (
                <button type="button" onClick={() => setNodeDisabled(node.id, true)}>停用</button>
              )}
            </div>
          </article>
        ))}
        {nodes.length === 0 && <p className="empty">暂无注册节点。</p>}
      </div>
      <h3>网关审计</h3>
      <div className="table">
        {audit.map((item) => (
          <article key={item.id} className="row-card compact">
            <strong>{item.node_id || '未知节点'} · {formatAction(item.action)} · {formatStatus(item.status)}</strong>
            <small>{item.reason}</small>
            {item.metadata ? <CollapsedData label="高级详情" value={item.metadata} /> : null}
          </article>
        ))}
        {audit.length === 0 && <p className="empty">暂无网关审计记录。</p>}
      </div>
    </section>
  );
}

function CostsPanel({ usage, calls, health }: { usage: Record<string, unknown>[]; calls: ModelCall[]; health: SystemHealth | null }) {
  const today = health?.token_cost_today ?? {};
  return (
    <section className="panel wide">
      <h2>成本用量</h2>
      <dl className="metrics">
        <KV label="今日总令牌" value={formatTokenCount(today.total_tokens)} />
        <KV label="今日输入令牌" value={formatTokenCount(today.input_tokens)} />
        <KV label="今日输出令牌" value={formatTokenCount(today.output_tokens)} />
        <KV label="缓存命中" value={`${formatTokenCount(today.cached_input_tokens)} (${formatRatio(today.cache_hit_ratio)})`} />
        <KV label="预估成本" value={formatCost(today.estimated_cost)} />
      </dl>
      <div className="table">
        {usage.map((item, index) => (
          <article key={`${item.provider}-${item.model}-${item.agent}-${index}`} className="row-card compact">
            <strong>{String(item.agent || '未知代理')}</strong>
            <small>
              {String(item.provider)} / {String(item.model)} · 调用 {formatTokenCount(item.calls)} 次 · 总 {formatTokenCount(item.total_tokens)}
              {' '}· 输入/输出 {formatTokenCount(item.input_tokens)}/{formatTokenCount(item.output_tokens)}
              {' '}· 缓存 {formatTokenCount(item.cached_input_tokens)} ({formatRatio(item.cache_hit_ratio)})
              {' '}· reasoning {formatTokenCount(item.reasoning_tokens)}
              {' '}· {formatCost(item.estimated_cost)}
            </small>
            <small>平均延迟 {formatMilliseconds(item.avg_latency_ms)} · 错误 {formatTokenCount(item.error_calls)} · 最近 {String(item.last_call_at || '无')}</small>
          </article>
        ))}
        {calls.map((call) => (
          <article key={call.id} className="row-card compact">
            <strong>{formatStatus(call.status)} · {formatUsageStatus(call.usage_status)}</strong>
            <small>
              {call.provider} / {call.model_name} · 总 {formatTokenCount(modelCallTotalTokens(call))}
              {' '}· 输入/输出 {formatTokenCount(call.input_tokens)}/{formatTokenCount(call.output_tokens)}
              {' '}· 缓存 {formatTokenCount(call.cached_input_tokens)}
              {' '}· reasoning {formatTokenCount(call.reasoning_tokens)}
              {' '}· {formatCost(call.cost_estimate)}
              {' '}· {formatMilliseconds(call.latency_ms)}
            </small>
            {call.metadata ? <CollapsedData label="高级详情" value={call.metadata} /> : null}
          </article>
        ))}
        {usage.length === 0 && calls.length === 0 && <p className="empty">暂无模型用量记录。</p>}
      </div>
    </section>
  );
}

function ConfirmationsPanel({ confirmations, decide }: { confirmations: ConfirmationRecord[]; decide: (id: string, approve: boolean) => Promise<void> }) {
  return (
    <section className="panel wide">
      <h2>确认队列</h2>
      <div className="table">
        {confirmations.map((item) => (
          <article key={item.id} className="row-card">
            <div>
              <strong>{item.requested_action}</strong>
              <p>{item.capability_id} · 风险 {formatRiskLevel(item.risk_level)} · {formatStatus(item.status)}</p>
              <small>任务：{item.run_id || '无'}{item.turn_id ? ` · Turn ${compactIdentifier(item.turn_id)}` : ''}{item.call_id ? ` · Call ${compactIdentifier(item.call_id)}` : ''}</small>
              {item.approval_scope || item.approval_key ? (
                <small>审批：{item.approval_scope || 'once'}{item.approval_key ? ` · ${compactIdentifier(item.approval_key)}` : ''}</small>
              ) : null}
              {item.input ? <CollapsedData label="查看请求参数" value={item.input} /> : null}
            </div>
            {item.status === 'pending' && (
              <div className="row-actions">
                <button type="button" onClick={() => decide(item.id, true)}>批准</button>
                <button type="button" onClick={() => decide(item.id, false)}>拒绝</button>
              </div>
            )}
          </article>
        ))}
        {confirmations.length === 0 && <p className="empty">暂无待确认请求。</p>}
      </div>
    </section>
  );
}

function compactIdentifier(value?: string) {
  if (!value) return '';
  return value.length > 22 ? `${value.slice(0, 14)}...${value.slice(-5)}` : value;
}

function SettingsPanel({
  settings,
  secretStatus,
  refreshAll,
  setNotice,
}: {
  settings: SettingsRecord | null;
  secretStatus: SecretStatus | null;
  refreshAll: () => Promise<void>;
  setNotice: (value: string) => void;
}) {
  const [secretName, setSecretName] = useState('MODEL_API_KEY');
  const [secretValue, setSecretValue] = useState('');
  const [secretValueVisible, setSecretValueVisible] = useState(false);
  const [testStatus, setTestStatus] = useState('');
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [provider, setProvider] = useState(settings?.model_provider ?? 'openai_compatible');
  const [baseURL, setBaseURL] = useState(settings?.model_base_url ?? 'https://api.deepseek.com/v1');
  const [modelName, setModelName] = useState(settings?.model_name ?? 'deepseek-v4-flash');
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramTokenVisible, setTelegramTokenVisible] = useState(false);
  const [telegramAllowed, setTelegramAllowed] = useState(settings?.telegram_allowed_user_ids ?? '');
  const [telegramEnabled, setTelegramEnabled] = useState(settings?.telegram_enabled ?? false);
  const [telegramChatID, setTelegramChatID] = useState('');
  const [xaiLoginBusy, setXAILoginBusy] = useState(false);
  const [workerGatewayEnabled, setWorkerGatewayEnabled] = useState(settings?.worker_gateway_enabled ?? true);
  const [backupDir, setBackupDir] = useState(settings?.backup_dir ?? '');
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(settings?.auto_backup_enabled ?? false);

  useEffect(() => {
    setProvider(settings?.model_provider ?? 'openai_compatible');
    setBaseURL(settings?.model_base_url ?? 'https://api.deepseek.com/v1');
    setModelName(settings?.model_name ?? 'deepseek-v4-flash');
    setTelegramAllowed(settings?.telegram_allowed_user_ids ?? '');
    setTelegramEnabled(settings?.telegram_enabled ?? false);
    setWorkerGatewayEnabled(settings?.worker_gateway_enabled ?? true);
    setBackupDir(settings?.backup_dir ?? '');
    setAutoBackupEnabled(settings?.auto_backup_enabled ?? false);
  }, [settings?.model_provider, settings?.model_base_url, settings?.model_name, settings?.telegram_allowed_user_ids, settings?.telegram_enabled, settings?.worker_gateway_enabled, settings?.backup_dir, settings?.auto_backup_enabled]);

  async function saveSecret() {
    await desktopApi.saveSecret({ name: secretName, value: secretValue });
    setSecretValue('');
    setNotice(`${secretName} 已保存到钥匙串`);
    await refreshAll();
  }

  async function testModel() {
    const result = await desktopApi.testModelConnection({ provider, base_url: baseURL, name: modelName, timeout_seconds: 60, max_retries: 1 });
    setTestStatus(`模型：${formatStatus(result.status)}${result.error_summary ? ` · ${result.error_summary}` : ''}`);
  }

  async function saveModel() {
    await desktopApi.saveModelConfig({ provider, base_url: baseURL, name: modelName, timeout_seconds: 60, max_retries: 1 });
    setNotice('模型服务已保存');
    await refreshAll();
  }

  async function loginXAIOAuth() {
    setXAILoginBusy(true);
    setTestStatus('xAI：正在等待浏览器授权');
    try {
      const result = await desktopApi.loginXAIOAuth();
      setProvider(result.provider);
      setBaseURL(result.base_url);
      setModelName(result.model_name);
      setTestStatus(`xAI：已登录 · ${result.scope}`);
      setNotice('xAI OAuth 已登录并切换到 grok-4.3');
      await refreshAll();
    } catch (error) {
      setTestStatus(`xAI：登录失败 · ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setXAILoginBusy(false);
    }
  }

  async function saveOperationalSettings() {
    await desktopApi.saveOperationalSettings({
      telegram_enabled: telegramEnabled,
      telegram_allowed_user_ids: telegramAllowed,
      worker_gateway_enabled: workerGatewayEnabled,
      backup_dir: backupDir,
      auto_backup_enabled: autoBackupEnabled,
    });
    setNotice('桌面设置已保存');
    await refreshAll();
  }

  async function saveTelegram() {
    await desktopApi.saveTelegramConfig({ token: telegramToken, allowed_user_ids: telegramAllowed, enabled: telegramEnabled });
    setTelegramToken('');
    setNotice('Telegram 设置已保存');
    await refreshAll();
  }

  async function testTelegram() {
    const result = await desktopApi.testTelegramConnection();
    setTestStatus(`Telegram：${formatStatus(result.status)}${result.error_summary ? ` · ${result.error_summary}` : ''}`);
  }

  async function sendTelegramTest() {
    const result = await desktopApi.sendTestTelegramMessage({ chat_id: telegramChatID, message: 'Joi 桌面端 Telegram 测试' });
    setTestStatus(`Telegram 消息：${formatStatus(result.status)}${result.error_summary ? ` · ${result.error_summary}` : ''}`);
  }

  async function generateWorkerToken() {
    const result = await desktopApi.generateWorkerToken();
    setNotice(`工作节点令牌已生成：${result.token}`);
    await refreshAll();
  }

  async function exportDiagnostics() {
    const result = await desktopApi.exportDiagnostics();
    setNotice(`诊断信息已导出：${result.path}`);
  }

  return (
    <section className="panel wide">
      <h2>常规设置</h2>
      <dl className="metrics">
        <KV label="版本" value={settings?.version ?? '0.1.1'} />
        <KV label="应用模式" value={formatAppMode(settings?.app_mode)} />
        <KV label="数据存储" value={settings?.data_store ?? 'sqlite'} />
        <KV label="任务队列" value={settings?.task_queue ?? 'sqlite'} />
        <KV label="需要 Docker" value={formatBoolean(Boolean(settings?.docker_required))} />
        <KV label="模型服务商" value={settings?.model_provider ?? ''} />
        <KV label="模型" value={settings?.model_name ?? ''} />
        <KV label="Telegram" value={settings?.telegram_enabled ? '已配置' : '未配置'} />
        <KV label="iMessage" value={settings?.imessage_enabled ? '已启用' : '未配置'} />
        <KV label="工作节点网关" value={settings?.worker_gateway ?? ''} />
      </dl>
      <div className="settings-grid">
        <section>
          <h3>模型服务</h3>
          <div className="control-row">
            <label>
              服务商
              <input value={provider} onChange={(event) => setProvider(event.target.value)} />
            </label>
            <label>
              接口地址
              <input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} />
            </label>
            <label>
              模型
              <input value={modelName} onChange={(event) => setModelName(event.target.value)} />
            </label>
            <button type="button" onClick={saveModel}>保存模型</button>
            <button type="button" onClick={loginXAIOAuth} disabled={xaiLoginBusy}>{xaiLoginBusy ? '等待 xAI 授权' : '登录 xAI'}</button>
          </div>
          {availableModels.length > 0 && <ModelList models={availableModels} />}
        </section>
        <section>
          <h3>Telegram</h3>
          <div className="control-row">
            <label className="check">
              <input checked={telegramEnabled} type="checkbox" onChange={(event) => setTelegramEnabled(event.target.checked)} />
              启用
            </label>
            <label>
              机器人令牌
              <SecretInput value={telegramToken} visible={telegramTokenVisible} onChange={setTelegramToken} onToggleVisible={() => setTelegramTokenVisible((value) => !value)} />
            </label>
            <label>
              允许用户 ID
              <input value={telegramAllowed} onChange={(event) => setTelegramAllowed(event.target.value)} />
            </label>
            <button type="button" onClick={saveTelegram}>保存 Telegram</button>
          </div>
          <div className="control-row">
            <label>
              测试会话 ID
              <input value={telegramChatID} onChange={(event) => setTelegramChatID(event.target.value)} />
            </label>
            <button type="button" onClick={testTelegram}>测试机器人</button>
            <button type="button" onClick={sendTelegramTest}>发送测试消息</button>
          </div>
        </section>
        <section>
          <h3>运行配置</h3>
          <div className="control-row">
            <label className="check">
              <input checked={workerGatewayEnabled} type="checkbox" onChange={(event) => setWorkerGatewayEnabled(event.target.checked)} />
              工作节点网关
            </label>
            <label className="check">
              <input checked={autoBackupEnabled} type="checkbox" onChange={(event) => setAutoBackupEnabled(event.target.checked)} />
              自动备份
            </label>
            <label>
              备份路径
              <input value={backupDir} onChange={(event) => setBackupDir(event.target.value)} />
            </label>
            <button type="button" onClick={saveOperationalSettings}>保存运行配置</button>
          </div>
        </section>
        <section>
          <h3>密钥</h3>
          <div className="control-row">
            <label>
              类型
              <select value={secretName} onChange={(event) => setSecretName(event.target.value)}>
                <option value="MODEL_API_KEY">MODEL_API_KEY</option>
                <option value="TELEGRAM_BOT_TOKEN">TELEGRAM_BOT_TOKEN</option>
                <option value="PHOTON_PROJECT_SECRET">PHOTON_PROJECT_SECRET</option>
                <option value="PHOTON_DASHBOARD_TOKEN">PHOTON_DASHBOARD_TOKEN</option>
                <option value="WORKER_TOKEN">WORKER_TOKEN</option>
                <option value="NODE_SECRET">NODE_SECRET</option>
                <option value="ADMIN_TOKEN">ADMIN_TOKEN</option>
              </select>
            </label>
            <label>
              值
              <SecretInput value={secretValue} visible={secretValueVisible} onChange={setSecretValue} onToggleVisible={() => setSecretValueVisible((value) => !value)} />
            </label>
            <button type="button" onClick={saveSecret}>保存</button>
          </div>
          <div className="secret-status">
            {Object.entries(secretStatus?.secrets ?? {}).map(([name, present]) => (
              <span key={name}>{name}：{present ? '已配置' : '缺失'}</span>
            ))}
          </div>
        </section>
        <section>
          <h3>连接测试</h3>
          <div className="control-row">
            <button type="button" onClick={testModel}>测试模型</button>
            <button type="button" onClick={generateWorkerToken}>生成工作节点令牌</button>
            <button type="button" onClick={exportDiagnostics}>导出诊断</button>
          </div>
          {testStatus && <p className="empty">{testStatus}</p>}
        </section>
      </div>
      <section className="settings-data-panel">
        <h3>本地数据位置</h3>
        <dl>
          <KV label="SQLite 路径" value={settings?.sqlite_path ?? '未设置'} />
          <KV label="日志目录" value={settings?.log_dir ?? '未设置'} />
          <KV label="备份目录" value={settings?.backup_dir ?? '未设置'} />
          <KV label="模型接口" value={settings?.model_base_url ?? '未设置'} />
        </dl>
        <CollapsedData label="高级详情" value={{ sqlite_path: settings?.sqlite_path, log_dir: settings?.log_dir, backup_dir: settings?.backup_dir, model_base_url: settings?.model_base_url }} />
      </section>
    </section>
  );
}

function BackupsPanel({ backups, createBackup, restoreBackup }: { backups: BackupRecord[]; createBackup: () => Promise<void>; restoreBackup: (path: string) => Promise<void> }) {
  const [path, setPath] = useState('');
  return (
    <section className="panel wide">
      <div className="section-header">
        <h2>备份恢复</h2>
        <button type="button" onClick={createBackup}>创建备份</button>
      </div>
      <div className="control-row">
        <input placeholder="输入备份路径" value={path} onChange={(event) => setPath(event.target.value)} />
        <button disabled={!path.trim()} type="button" onClick={() => restoreBackup(path.trim())}>恢复</button>
      </div>
      <div className="table">
        {backups.map((backup) => (
          <article key={backup.path} className="row-card compact">
            <strong>{backup.name}</strong>
            <small>{backup.modified} · {Math.round(backup.size / 1024)} KB</small>
            <small>{backup.path}</small>
            {backup.manifest ? <CollapsedData label="查看备份清单" value={backup.manifest} /> : null}
            <button type="button" onClick={() => restoreBackup(backup.path)}>恢复</button>
          </article>
        ))}
        {backups.length === 0 && <p className="empty">暂无备份。</p>}
      </div>
    </section>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function InfoGroup({ title, value }: { title: string; value?: Record<string, unknown> }) {
  const entries = Object.entries(value ?? {});
  return (
    <section>
      <h3>{title}</h3>
      {entries.length ? (
        <dl className="compact-kv">
          {entries.map(([key, item]) => (
            <KV key={key} label={formatFieldName(key)} value={formatDisplayValue(item)} />
          ))}
        </dl>
      ) : (
        <p className="empty">暂无数据。</p>
      )}
    </section>
  );
}

function TraceRuntimeSummary({ trace }: { trace: RunTrace }) {
  const routeEntries = Object.entries(trace.route_result ?? {}).filter(([, value]) => typeof value !== 'object' || value === null);
  const usedMemories = extractUsedMemories(trace);
  const traceUsage = summarizeModelCalls(trace.model_calls ?? []);
  return (
    <section className="runtime-summary">
      <h3>运行摘要</h3>
      <dl className="compact-kv">
        {routeEntries.map(([key, value]) => (
          <KV key={key} label={formatFieldName(key)} value={formatDisplayValue(value)} />
        ))}
        <KV label="提示词组装" value={`${trace.prompt_assemblies?.length ?? 0} 次`} />
        <KV label="记忆上下文" value={`${trace.memory_context_packs?.length ?? 0} 个`} />
        <KV label="本次使用记忆" value={`${usedMemories.length} 条`} />
        <KV label="本次总令牌" value={formatTokenCount(traceUsage.total_tokens)} />
        <KV label="本次预估成本" value={formatCost(traceUsage.cost_estimate)} />
      </dl>
      <InsightList empty="本次没有注入 confirmed memory。">
        {usedMemories.map((result) => (
          <InsightItem key={`trace-memory-${result.memory.id}`} title={result.memory.summary || result.memory.type} body={result.memory.content}>
            <small>score {result.score.toFixed(2)} · {formatMemoryReason(result.reason)}</small>
          </InsightItem>
        ))}
      </InsightList>
      <div className="table">
        {(trace.model_calls ?? []).map((call) => (
          <article key={call.id} className="row-card compact">
            <strong>{call.provider} / {call.model_name}</strong>
            <small>
              {formatUsageStatus(call.usage_status)} · 总 {formatTokenCount(modelCallTotalTokens(call))}
              {' '}· 输入/输出 {formatTokenCount(call.input_tokens)}/{formatTokenCount(call.output_tokens)}
              {' '}· 缓存 {formatTokenCount(call.cached_input_tokens)}
              {' '}· reasoning {formatTokenCount(call.reasoning_tokens)}
              {' '}· {formatCost(call.cost_estimate)}
            </small>
          </article>
        ))}
        {(trace.prompt_assemblies ?? []).map((item) => (
          <article key={item.id} className="row-card compact">
            <strong>提示词组装</strong>
            <small>缓存键：{item.prompt_cache_key || '无'}</small>
            <small>前缀：{item.prefix_hash || '无'} · 动态尾部：{item.dynamic_tail_hash || '无'}</small>
          </article>
        ))}
        {(trace.memory_context_packs ?? []).map((item) => (
          <article key={item.id} className="row-card compact">
            <strong>记忆上下文</strong>
            <small>版本：{item.memory_profile_version || '无'} · 动态召回：{item.dynamic_retrieval?.length ?? 0} 条</small>
            {(item.dynamic_retrieval ?? []).slice(0, 3).map((raw, index) => {
              const result = normalizeMemorySearchResult(raw);
              if (!result) return null;
              return <small key={`${item.id}-memory-${index}`}>{result.memory.summary || result.memory.content} · {formatMemoryReason(result.reason)}</small>;
            })}
          </article>
        ))}
      </div>
      <CollapsedData label="高级详情" value={{ route_result: trace.route_result, prompt_assemblies: trace.prompt_assemblies, memory_context_packs: trace.memory_context_packs }} />
    </section>
  );
}

function CollapsedData({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="json-details">
      <summary>{label}</summary>
      <pre>{formatRawData(value)}</pre>
    </details>
  );
}

function formatRawData(value: unknown) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function objectFromUnknown(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function booleanFromUnknown(value: unknown): boolean {
  return value === true || value === 'true';
}

function conversationTitle(item: ConversationSummary) {
  return item.title || item.last_message || '未命名对话';
}

function classToken(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'unknown';
}

function formatShortTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDisplayValue(value: unknown): string {
  if (typeof value === 'boolean') return formatBoolean(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value || '未设置';
  if (Array.isArray(value)) return `${value.length} 项`;
  if (value === null || value === undefined) return '未设置';
  return '已配置';
}

function formatBoolean(value: boolean) {
  return value ? '是' : '否';
}

function formatAppMode(mode?: string) {
  const labels: Record<string, string> = {
    desktop: '桌面模式',
    server: '服务端模式',
  };
  return labels[mode ?? ''] ?? (mode || '未设置');
}

function estimateTerminalSize(element: HTMLElement): { cols: number; rows: number } {
  const rect = element.getBoundingClientRect();
  const cols = Math.floor(Math.max(320, rect.width) / TERMINAL_APPROX_CHAR_WIDTH);
  const rows = Math.floor(Math.max(180, rect.height) / TERMINAL_APPROX_ROW_HEIGHT);
  return {
    cols: Math.max(40, Math.min(160, cols)),
    rows: Math.max(10, Math.min(48, rows)),
  };
}

function terminalShellLabel(shell: string) {
  const parts = shell.split('/').filter(Boolean);
  const label = parts[parts.length - 1] || 'zsh';
  return label.toUpperCase();
}

function safeErrorText(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

function formatStatus(status: string) {
  const labels: Record<string, string> = {
    succeeded: '成功',
    success: '成功',
    completed: '已完成',
    ok: '正常',
    preview: '预览',
    pending: '待处理',
    running: '运行中',
    queued: '已派发',
    waiting_confirmation: '等待确认',
    paused: '已暂停',
    verifying: '验证中',
    failed: '失败',
    error: '错误',
    blocked: '已阻止',
    disabled: '已停用',
    enabled: '已启用',
    configured: '已配置',
    missing: '缺失',
    required: '必填',
    optional: '可选',
    unknown: '未知',
  };
  return labels[status] ?? status;
}

function formatUsageStatus(status?: string) {
  const labels: Record<string, string> = {
    recorded: '已记录用量',
    provider_missing: '未返回用量',
    estimated: '估算用量',
    failed: '用量失败',
  };
  return labels[status || ''] ?? (status || '用量未知');
}

function formatChannelLabel(channel?: string) {
  const labels: Record<string, string> = {
    desktop: 'Desktop',
    telegram: 'Telegram',
    imessage: 'iMessage',
  };
  return labels[channel ?? ''] ?? (channel || '未知入口');
}

function formatExternalHandoffStatus(status: string) {
  const labels: Record<string, string> = {
    sqlite_missing: '数据库缺失',
    schema_missing: 'Schema 缺失',
    external_not_ready: '外部入口未就绪',
    awaiting_external_input: '等待外部消息',
    awaiting_desktop_continuation: '等待 Desktop 继续',
    live_handoff_linked: '已链接',
    unknown: '未知',
  };
  return labels[status] ?? status;
}

function formatExternalServiceStatus(service: ExternalHandoffAudit['readiness']['services'][string]) {
  if (service.ready) return 'ready';
  if (!service.enabled) return 'disabled';
  if (!service.configured) return 'not configured';
  if (!service.running) return 'not running';
  if (service.last_error) return `failed: ${compactInlineText(service.last_error, 80)}`;
  return 'not ready';
}

function compactInlineText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
}

function formatStepType(type: string) {
  const labels: Record<string, string> = {
    input_received: '收到输入',
    router_selected: '选择路由',
    skill_selected: '选择 Skill',
    skill_plan_generated: '生成 Skill 计划',
    skill_rejected: '拒绝 Skill',
    prompt_assembled: '组装提示词',
    model_call_finished: '模型调用完成',
    agent_output_parsed: '解析代理输出',
    agent_call_finished: '代理运行完成',
    response_generated: '生成回复',
    capability_requested: '请求能力',
    capability_semantic_checked: '语义校验',
    capability_rejected: '拒绝能力',
    policy_checked: '策略检查',
    workflow_compiled: '编译 Workflow',
    tool_compiled: '编译工具链',
    node_selected: '选择节点',
    tool_started: '工具开始',
    tool_step_started: '工具步骤开始',
    tool_step_completed: '工具步骤完成',
    mcp_tool_call_started: 'MCP 调用开始',
    mcp_tool_call_completed: 'MCP 调用完成',
    tool_finished: '工具完成',
    capability_blocked: '能力被阻止',
    policy_blocked: '策略阻止',
  };
  return labels[type] ?? type;
}

function formatNodeRole(role: string) {
  const labels: Record<string, string> = {
    main: '主节点',
    main_node: '主节点',
    worker: '工作节点',
    remote: '远端节点',
  };
  return labels[role] ?? role;
}

function formatAction(action: string) {
  const labels: Record<string, string> = {
    register: '注册',
    heartbeat: '心跳',
    dispatch: '派发',
    token_rotated: '令牌重置',
    disable: '停用',
    enable: '启用',
  };
  return labels[action] ?? action;
}

function formatRiskLevel(level: string) {
  const labels: Record<string, string> = {
    read_only: '只读',
    write_candidate: '写入候选',
    browser_interaction: '浏览器交互',
    workspace_write: '工作区写入',
    state_change: '状态变更',
    destructive: '破坏性',
    unsafe: '不安全',
    low: '低',
    medium: '中',
    high: '高',
    critical: '严重',
  };
  return labels[level] ?? level;
}

function formatArtifactType(type: string) {
  const labels: Record<string, string> = {
    report: '报告',
    plan: '方案',
    summary: '摘要',
    diff: 'Diff',
    decision: '决策',
    memory_digest: '记忆摘要',
    research_note: '研究笔记',
    code_patch: '代码补丁',
  };
  return labels[type] ?? type;
}

function formatFieldName(key: string) {
  const labels: Record<string, string> = {
    sqlite: 'SQLite',
    orchestrator: '编排核心',
    active_tasks: '运行中任务',
    dead_tasks: '异常任务',
    queued_tasks: '排队任务',
    worker_status: '工作节点',
    model_calls_today: '今日模型调用',
    avg_latency_ms: '平均延迟',
    input_tokens: '输入令牌',
    output_tokens: '输出令牌',
    cached_input_tokens: '缓存输入令牌',
    cache_write_input_tokens: '缓存写入令牌',
    reasoning_tokens: '推理令牌',
    total_tokens: '总令牌',
    cache_hit_ratio: '缓存命中率',
    estimated_cost: '预估成本',
    provider: '服务商',
    model: '模型',
    agent: '代理',
    confidence: '置信度',
    intent: '意图',
    lead_agent: '主代理',
    route_mode: '路由模式',
    route_source: '路由来源',
    fallback_reason: '降级原因',
  };
  return labels[key] ?? key.replace(/_/g, ' ');
}
