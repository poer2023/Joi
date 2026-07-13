import { Terminal } from '@xterm/xterm';
import { Component, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
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
  type ConversationDetail,
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
  type MessengerRoom,
  type MCPServerRecord,
  type ModelCall,
  type NodeRecord,
  type OnboardingStatus,
  type OpenLoop,
  type PhotonIMessageStatus,
  type PersonaCandidate,
  type PersonaMessengerSnapshot,
  type ProactiveMessage,
  type ProductTask,
  type ProductTaskDetail,
  type ProjectPersona,
  type RunClosureReport,
  type RunTrace,
  type RunTraceSpan,
  type RunTraceSpanSummary,
  type SecretStatus,
  type SettingsRecord,
  type SkillRecord,
  type SystemHealth,
  type TerminalSessionEvent,
  type TerminalSessionInfo,
  type ToolRunRecord,
  type ToolWorkflowRecord,
  type UpdateMessengerProjectRequest,
  type UpdateMessengerRoomRequest,
  type UpdateProjectPersonaRequest,
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
import {
  messagesForConversationHydration,
  resolveConversationRoom,
  shouldRestoreThreadMessages,
} from './features/chat/conversationHydration';
import type { MessageThreadAnnotation, NormalizedRunEvent } from './features/chat/types';
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
type RightInspectorTab = 'overview' | 'runs' | 'threads' | 'assets' | 'memory' | 'member';
type MessengerRoomMember = NonNullable<MessengerRoom['members']>[number];
type MessengerThread = PersonaMessengerSnapshot['threads'][number];
type ComposerAttachment = {
  id: string;
  name: string;
  size: number;
  mime_type: string;
  kind: 'image' | 'video' | 'file';
  preview_url?: string;
  last_modified?: number;
};
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
  { id: 'observability', label: '运行与用量', description: '运行记录、用量与本地清理' },
  { id: 'dataMemory', label: '数据与记忆', description: '数据存储与记忆管理' },
  { id: 'capabilities', label: '能力与工具', description: '插件、工具与能力配置' },
  { id: 'nodesExecution', label: '节点与执行', description: '工作节点与执行资源' },
  { id: 'privacySecurity', label: '隐私与安全', description: '隐私设置与安全控制' },
  { id: 'advanced', label: '支持', description: '诊断、导出与问题修复' },
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
const DEFAULT_SIDEBAR_WIDTH = 250;
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
const logLevelOptions = ['info', 'warn', 'error', 'fatal'];
const logRiskOptions = ['read_only', 'write_candidate', 'browser_interaction', 'workspace_write', 'state_change', 'destructive', 'unsafe'];
const logCategoryOptions = ['ipc', 'runtime', 'terminal', 'external', 'worker_gateway', 'settings', 'system', 'run', 'tool', 'model'];
const defaultLogCleanupScopes: LogCleanupRequest['scopes'] = ['app_logs', 'run_events', 'run_steps', 'tool_runs', 'model_calls', 'worker_gateway_audit_logs', 'log_files'];
const executionTargetOptions: Array<{ value: ExecutionTarget; label: string; preferredNode: string; allowWorker: boolean }> = [
  { value: 'main-node', label: '本机', preferredNode: 'main-node', allowWorker: false },
  { value: 'auto', label: '自动', preferredNode: 'auto', allowWorker: true },
  { value: 'local-worker-1', label: '本机 Worker', preferredNode: 'local-worker-1', allowWorker: true },
  { value: 'vps-la-1', label: '远端 Worker', preferredNode: 'vps-la-1', allowWorker: true },
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
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [pendingUserMessage, setPendingUserMessage] = useState<ConversationMessage | null>(null);
  const [streamingAssistantMessage, setStreamingAssistantMessage] = useState<StreamingAssistantMessage | null>(null);
  const [activeExecutionActions, setActiveExecutionActions] = useState<ExecutionAction[]>([]);
  const [activeExecutionStatus, setActiveExecutionStatus] = useState<ExecutionRunStatus>('pending');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const executionTarget: ExecutionTarget = 'main-node';
  const [inputMode, setInputMode] = useState<InputMode>('auto');
  const [selectedModelName, setSelectedModelName] = useState('');
  const [chat, setChat] = useState<ChatResponse | null>(null);
  const [trace, setTrace] = useState<RunTrace | null>(null);
  const [traceSpanAudit, setTraceSpanAudit] = useState<{ spans: RunTraceSpan[]; summary: RunTraceSpanSummary }>({
    spans: [],
    summary: {
      total: 0,
      model_count: 0,
      tool_count: 0,
      error_count: 0,
      external_side_effect_count: 0,
      total_tokens: 0,
      total_cost_estimate: 0,
    },
  });
  const [runEventsByRunId, setRunEventsByRunId] = useState<Record<string, NormalizedRunEvent[]>>({});
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<ConversationSummary[]>([]);
  const [trashedConversations, setTrashedConversations] = useState<ConversationSummary[]>([]);
  const [currentConversationID, setCurrentConversationID] = useState('');
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [messenger, setMessenger] = useState<PersonaMessengerSnapshot | null>(null);
  const [currentRoomID, setCurrentRoomID] = useState('room_private_hub');
  const [composerScope, setComposerScope] = useState('auto_route');
  const [projectCreatorOpen, setProjectCreatorOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState({ name: '', goal: '', domain: '', phase: '' });
  const [personaCandidates, setPersonaCandidates] = useState<PersonaCandidate[]>([]);
  const [selectedPersonaCandidateID, setSelectedPersonaCandidateID] = useState('');
  const [projectCreatorBusy, setProjectCreatorBusy] = useState(false);
  const [todayPanelOpen, setTodayPanelOpen] = useState(false);
  const [checkpointBusy, setCheckpointBusy] = useState(false);
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
  const activeRoom = useMemo(() => {
    return resolveConversationRoom(messenger?.rooms, currentConversationID, currentRoomID);
  }, [currentConversationID, currentRoomID, messenger]);
  const activePersona = useMemo(() => {
    if (!messenger || !activeRoom?.persona_id) return null;
    return messenger.personas.find((persona) => persona.id === activeRoom.persona_id) ?? null;
  }, [activeRoom?.persona_id, messenger]);
  const roomRouteLock = useMemo(() => {
    if (!messenger || !activeRoom) return null;
    return messenger.route_locks.find((lock) => lock.room_id === activeRoom.id && lock.status === 'active') ?? null;
  }, [activeRoom, messenger]);
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

  function openProjectCreator() {
    setProjectCreatorOpen(true);
    setProjectDraft({ name: '', goal: '', domain: '', phase: '' });
    setPersonaCandidates([]);
    setSelectedPersonaCandidateID('');
  }

  async function generateProjectCandidates() {
    const projectName = projectDraft.name.trim();
    if (!projectName) {
      showError('请输入项目名称');
      return;
    }
    setProjectCreatorBusy(true);
    try {
      const result = await desktopApi.generateProjectPersonaCandidates({
        project_name: projectName,
        project_goal: projectDraft.goal.trim(),
        domain: projectDraft.domain.trim(),
        phase: projectDraft.phase.trim(),
      });
      setPersonaCandidates(result.candidates);
      setSelectedPersonaCandidateID(result.candidates[0]?.id || '');
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setProjectCreatorBusy(false);
    }
  }

  async function createProjectFromSelectedCandidate() {
    const projectName = projectDraft.name.trim();
    if (!projectName) {
      showError('请输入项目名称');
      return;
    }
    setProjectCreatorBusy(true);
    try {
      const selected = personaCandidates.find((candidate) => candidate.id === selectedPersonaCandidateID) ?? personaCandidates[0];
      const result = await desktopApi.createProjectPersona({
        project_name: projectName,
        project_goal: projectDraft.goal.trim(),
        domain: projectDraft.domain.trim(),
        phase: projectDraft.phase.trim(),
        candidate_id: selected?.id,
        persona_choice: selected ? {
          display_name: selected.display_name,
          handle: selected.handle,
          avatar: selected.avatar,
          tagline: selected.tagline,
          self_intro: selected.self_intro,
          traits: selected.traits,
          disagreement_style: selected.disagreement_style,
          uncertainty_style: selected.uncertainty_style,
        } : undefined,
      });
      setProjectCreatorOpen(false);
      setPersonaCandidates([]);
      setSelectedPersonaCandidateID('');
      showNotice(`${result.persona.display_name} 已加入私人总群`);
      await refreshAll();
      await loadRoom(result.room);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setProjectCreatorBusy(false);
    }
  }

  async function rollbackPersonaVersion(personaID: string, targetVersion: number) {
    try {
      const persona = await desktopApi.rollbackProjectPersona({
        persona_id: personaID,
        target_version: targetVersion,
        change_reason: `Rollback to version ${targetVersion}`,
      });
      showNotice(`${persona.display_name} 已回滚到版本快照 ${targetVersion}`);
      await refreshAll();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  async function updateMessengerRoom(req: UpdateMessengerRoomRequest) {
    try {
      const result = await desktopApi.updateMessengerRoom(req);
      setMessenger((current) => current ? {
        ...current,
        rooms: current.rooms.map((room) => room.id === result.room.id ? result.room : room),
      } : current);
      setConversations((current) => current.map((conversation) => (
        conversation.id === result.room.conversation_id
          ? { ...conversation, title: result.room.title }
          : conversation
      )));
      showNotice('群资料已更新');
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  async function updateMessengerProject(req: UpdateMessengerProjectRequest) {
    try {
      await desktopApi.updateMessengerProject(req);
      showNotice('项目关联已更新');
      await refreshAll();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  async function retryExternalConnectorEvent(eventID: string) {
    try {
      await desktopApi.retryExternalConnectorEvent({
        event_id: eventID,
        reason: 'manual retry from connector inspector',
      });
      showNotice('外部消息已加入重试队列');
      await refreshAll();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  async function updateProjectPersona(req: UpdateProjectPersonaRequest) {
    try {
      await desktopApi.updateProjectPersona(req);
      showNotice('个体资料已更新');
      await refreshAll();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  function addComposerAttachments(files: FileList | File[]) {
    const nextFiles = Array.from(files);
    if (nextFiles.length === 0) return;
    setComposerAttachments((current) => [
      ...current,
      ...nextFiles.map((file) => ({
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name: file.name,
        size: file.size,
        mime_type: file.type || 'application/octet-stream',
        kind: attachmentKind(file),
        preview_url: file.type.startsWith('image/') || file.type.startsWith('video/') ? URL.createObjectURL(file) : undefined,
        last_modified: file.lastModified,
      })),
    ]);
  }

  function removeComposerAttachment(id: string) {
    setComposerAttachments((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.preview_url) URL.revokeObjectURL(target.preview_url);
      return current.filter((item) => item.id !== id);
    });
  }

  function clearComposerAttachments() {
    setComposerAttachments([]);
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
        messengerSnapshot,
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
        traceSpanList,
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
        desktopApi.listPersonaMessenger(),
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
        desktopApi.listRunTraceSpans({ limit: 200 }),
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
      setMessenger(messengerSnapshot);
      const currentRoomStillVisible = messengerSnapshot.rooms.some((room) => room.id === currentRoomID);
      const nextRoomID = currentRoomStillVisible ? currentRoomID : messengerSnapshot.rooms[0]?.id ?? '';
      if (nextRoomID && !currentRoomStillVisible) {
        setCurrentRoomID(nextRoomID);
      }
      const nextRoom = messengerSnapshot.rooms.find((room) => room.id === nextRoomID);
      if (
        nextRoom?.conversation_id
        && (!currentRoomStillVisible || !currentConversationID)
        && currentConversationID !== nextRoom.conversation_id
      ) {
        void loadConversation(nextRoom.conversation_id);
      }
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
      setTraceSpanAudit(traceSpanList);
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
    const attachments = composerAttachments;
    const requestMessage = prompt || attachmentOnlyPrompt(attachments);
    if (!requestMessage && attachments.length === 0) return;
    const currentActiveRunID = latestActiveRunId(runEventsByRunId) || chat?.run_id || trace?.id || '';
    if (isSubmitting && currentActiveRunID) {
      setMessage('');
      clearComposerAttachments();
      showNotice('已追加到当前任务。');
      try {
        const redirected = await desktopApi.redirectRun({
          run_id: currentActiveRunID,
          message: requestMessage,
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
        setMessage(prompt);
        setComposerAttachments(attachments);
        showError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    setTrace(null);
    setStreamingAssistantMessage(null);
    setActiveExecutionActions([]);
    setActiveExecutionStatus('pending');
    if (isSubmitting) return;
    const optimisticActions = createOptimisticExecutionActions(requestMessage);
    const roomConversationID = activeRoom?.conversation_id || '';
    const pendingConversationID = currentConversationID || roomConversationID || 'pending-conversation';
    pendingConversationIDRef.current = pendingConversationID;
    pendingAssistantIDRef.current = '';
    receivedAssistantDeltaRef.current = false;
    receivedAssistantDeltaRunIDRef.current = '';
    Object.keys(runCompletedFallbackTimersRef.current).forEach(clearRunCompletedFallback);
    setLastPrompt(requestMessage);
    setPendingUserMessage({
      id: `pending-${Date.now()}`,
      conversation_id: pendingConversationID,
      role: 'user',
      content: prompt,
      attachments,
    });
    setMessage('');
    clearComposerAttachments();
    setActiveExecutionActions(optimisticActions);
    setActiveExecutionStatus(optimisticActions.length > 0 ? 'running' : 'pending');
    setIsSubmitting(true);
    const routing = executionTargetOptions.find((item) => item.value === executionTarget) ?? executionTargetOptions[0];
    const personaModelName = activeRoom?.type === 'project_dm' ? configuredPersonaModelName(activePersona?.model_strategy) : '';
    const modelName = personaModelName || selectedModelName || settings?.model_name || 'deepseek-v4-flash';
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const result = await desktopApi.sendChat({
        conversation_id: currentConversationID || roomConversationID || undefined,
        room_id: activeRoom?.id,
        channel: 'desktop',
        user_id: 'desktop_user',
        message: requestMessage,
        attachments: attachments.map(attachmentForRequest),
        mentions: extractPersonaMentions(prompt, messenger?.personas ?? []),
        scope_override: composerScope,
        route_lock_action: roomRouteLock ? 'lock' : 'none',
        preferred_node: routing.preferredNode,
        allow_worker: routing.allowWorker,
        model_name: modelName,
        input_mode: inputMode,
        product_task_id: activeProductTaskID || undefined,
        runtime_mode: 'tool_calling',
        permission_profile: permissionProfileForPrompt(inputMode, requestMessage),
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
      setComposerAttachments(attachments);
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

  async function applyLoadedConversation(detail: ConversationDetail, requestID: number): Promise<boolean> {
    if (loadConversationRequestRef.current !== requestID) return false;
    setCurrentConversationID(detail.conversation.id);
    setConversationMessages(detail.messages ?? []);
    setChat(null);
    if (detail.conversation.latest_run_id) {
      const runTrace = await desktopApi.getRunTrace(detail.conversation.latest_run_id);
      if (loadConversationRequestRef.current !== requestID) return false;
      setTrace(runTrace);
      setRunEventsByRunId((current) => mergeRunEvents(current, detail.conversation.latest_run_id || '', normalizeTraceEvents(runTrace)));
    } else {
      setTrace(null);
    }
    setActiveTab('chat');
    return true;
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
      await applyLoadedConversation(detail, requestID);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadConversationForMessage(messageID: string): Promise<boolean> {
    const requestID = loadConversationRequestRef.current + 1;
    loadConversationRequestRef.current = requestID;
    setError('');
    setNotice('');
    setConversationMessages([]);
    setChat(null);
    setTrace(null);
    setPendingUserMessage(null);
    setStreamingAssistantMessage(null);
    setActiveExecutionActions([]);
    setActiveExecutionStatus('pending');
    pendingAssistantIDRef.current = '';
    pendingConversationIDRef.current = '';
    const detail = await findConversationDetailForMessage(messageID);
    return applyLoadedConversation(detail, requestID);
  }

  async function findConversationDetailForMessage(messageID: string): Promise<ConversationDetail> {
    try {
      return await desktopApi.getConversationForMessage(messageID);
    } catch (directError) {
      const listed = await desktopApi.listConversations({ view: 'all', limit: 200 });
      for (const conversation of listed.conversations ?? []) {
        const detail = await desktopApi.getConversation(conversation.id);
        if (detail.messages.some((item) => item.id === messageID)) return detail;
      }
      throw directError;
    }
  }

  async function loadRoom(room: MessengerRoom) {
    setCurrentRoomID(room.id);
    setComposerScope(defaultScopeForRoom(room));
    if (room.conversation_id) {
      await loadConversation(room.conversation_id);
      return;
    }
    setCurrentConversationID('');
    setConversationMessages([]);
    setChat(null);
    setTrace(null);
    setActiveTab('chat');
  }

  async function toggleActiveRouteLock() {
    if (!activeRoom) return;
    if (roomRouteLock) {
      await desktopApi.setRouteLock({ room_id: activeRoom.id, action: 'unlock' });
      await refreshAll();
      return;
    }
    const personaID = activeRoom.persona_id || activeRoom.floor_holder_persona_id || activePersona?.id || '';
    if (!personaID) {
      showNotice('当前房间没有可锁定的项目人格');
      return;
    }
    await desktopApi.setRouteLock({ room_id: activeRoom.id, persona_id: personaID, action: 'lock' });
    await refreshAll();
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

  async function openRunTrace(runID: string, destination: 'panel' | 'stage' = 'stage') {
    if (!runID) return;
    try {
      const runTrace = await desktopApi.getRunTrace(runID);
      setTrace(runTrace);
      setRunEventsByRunId((current) => mergeRunEvents(current, runID, normalizeTraceEvents(runTrace)));
      if (destination === 'stage') setActiveTab('trace');
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  async function completeTodayCheckpoint() {
    const items = messenger?.checkpoint.items ?? [];
    setCheckpointBusy(true);
    try {
      const checkpoint = await desktopApi.completeCheckpoint({
        acknowledged_items: items.map((item) => item.id),
      });
      setMessenger((current) => current ? { ...current, checkpoint } : current);
      showNotice('今日检查已建立新基线');
      setTodayPanelOpen(false);
      await refreshAll();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckpointBusy(false);
    }
  }

  async function exportCurrentMessengerData() {
    try {
      const result = await desktopApi.exportPersonaMessengerData({
        room_id: activeRoom?.id,
        project_id: activeRoom?.project_id || activePersona?.project_id,
        persona_id: activePersona?.id,
        include_messages: true,
        include_trace: true,
      });
      showNotice(`Persona Messenger 数据已导出：${result.path}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
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
    showNotice('已请求中断当前运行。');
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
    await desktopApi.generateWorkerToken();
    showNotice('执行器连接凭证已更新。');
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
    <main ref={shellRef} data-theme="light" className={`im-app-shell app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${inSettingsArea ? 'settings-mode' : ''}`} style={shellStyle}>
      {inSettingsArea ? (
        <SettingsTopControls collapsed={sidebarCollapsed} goBack={() => setActiveTab('chat')} toggleCollapsed={toggleSidebarCollapsed} />
      ) : (
        <SidebarTopControls
          collapsed={sidebarCollapsed}
          openProjectCreator={openProjectCreator}
          setActiveTab={setActiveTab}
          toggleCollapsed={toggleSidebarCollapsed}
        />
      )}
      {inSettingsArea ? (
        <SettingsSidebar
          activeCategory={settingsCategory}
          collapsed={sidebarCollapsed}
          selectSettingsObject={selectSettingsObject}
        />
      ) : (
        <ConversationSidebar
          activeTab={activeTab}
          archiveConversation={archiveConversation}
          chat={chat}
          collapsed={sidebarCollapsed}
          conversations={conversations}
          currentRoomID={currentRoomID}
          currentConversationID={currentConversationID}
          loadConversation={loadConversation}
          loadRoom={loadRoom}
          messenger={messenger}
          setActiveTab={setActiveTab}
          trace={trace}
        />
      )}
      {!sidebarCollapsed && <div aria-label="调整侧边栏宽度" className="sidebar-resizer" role="separator" onPointerDown={startSidebarResize} />}

      <section className="im-workspace app__editor tk-content-panel">
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
              key={currentConversationID || chat?.conversation_id || 'new'}
              activePersona={activePersona}
              activeProductTask={activeProductTaskDetail}
              activeRoom={activeRoom}
              attachments={composerAttachments}
              artifacts={artifacts}
              activeExecutionActions={activeExecutionActions}
              autoRightPanelCollapsed={autoRightPanelCollapsed}
              chat={chat}
              conversationMessages={conversationMessages}
              cancelRun={cancelRun}
              continueProductTask={continueProductTask}
              decideConfirmation={decideConfirmation}
              decideProactiveMessage={decideProactiveMessage}
              exportCurrentMessengerData={exportCurrentMessengerData}
              health={health}
              inputMode={inputMode}
              isSubmitting={isSubmitting}
              memories={memories}
              messenger={messenger}
              openArtifact={openArtifact}
              openLoops={openLoops}
              openRunTrace={openRunTrace}
              loadConversationForMessage={loadConversationForMessage}
              lastPrompt={lastPrompt}
              message={message}
              pendingUserMessage={pendingUserMessage}
              streamingAssistantMessage={streamingAssistantMessage}
              proactiveMessages={proactiveMessages}
              productTasks={productTasks}
              runEventsByRunId={runEventsByRunId}
              savedModels={savedModels}
              selectProductTask={selectProductTask}
              settings={settings}
              roomRouteLock={roomRouteLock}
              setActiveTab={setActiveTab}
              addAttachments={addComposerAttachments}
              setMessage={setMessage}
              removeAttachment={removeComposerAttachment}
              startRightPanelResize={startRightPanelResize}
              updateMemory={updateMemory}
              submit={submit}
              trace={trace}
              traceSpanAudit={traceSpanAudit}
              updateMessengerProject={updateMessengerProject}
              updateMessengerRoom={updateMessengerRoom}
              updateProjectPersona={updateProjectPersona}
              workspaceSettings={workspaceSettings}
              rollbackPersonaVersion={rollbackPersonaVersion}
              retryExternalConnectorEvent={retryExternalConnectorEvent}
            />
          </RenderCrashBoundary>
        )}
        {artifactViewer && activeTab === 'chat' && (
          <ArtifactViewer artifact={artifactViewer} close={() => setArtifactViewer(null)} />
        )}

        {todayPanelOpen && (
          <TodayCheckpointPanel
            busy={checkpointBusy}
            checkpoint={messenger?.checkpoint ?? null}
            onClose={() => setTodayPanelOpen(false)}
            onComplete={() => void completeTodayCheckpoint()}
          />
        )}

        {projectCreatorOpen && (
          <ProjectPersonaCreatorModal
            busy={projectCreatorBusy}
            candidates={personaCandidates}
            draft={projectDraft}
            onClose={() => setProjectCreatorOpen(false)}
            onCreate={() => void createProjectFromSelectedCandidate()}
            onDraftChange={setProjectDraft}
            onGenerate={() => void generateProjectCandidates()}
            onSelectCandidate={setSelectedPersonaCandidateID}
            selectedCandidateID={selectedPersonaCandidateID}
          />
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
  const setDraft = (patch: Partial<ModelSettingsDraft>) => onChange({ ...draft, ...patch });

  return (
    <div className="settings-modal-backdrop" role="presentation">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="model-settings-title">
        <header className="settings-modal-header">
          <div>
            <small>模型配置</small>
            <h2 id="model-settings-title">{draft.display_name || draft.model_id}</h2>
          </div>
          <button className="modal-close-button" type="button" aria-label="关闭弹窗" onClick={onClose}>×</button>
        </header>

        <dl className="model-info-grid">
          <KV label="提供方" value={model?.owner || '未提供'} />
          <KV label="上下文容量" value={model?.context_window ? formatNumber(model.context_window) : '未提供'} />
          <KV label="最大输出" value={model?.max_output_tokens ? formatNumber(model.max_output_tokens) : '未提供'} />
          <KV label="输入价格" value={model?.input_price_per_1m ? `$${model.input_price_per_1m.toFixed(2)} / 1M` : '未提供'} />
          <KV label="输出价格" value={model?.output_price_per_1m ? `$${model.output_price_per_1m.toFixed(2)} / 1M` : '未提供'} />
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
              <label><input checked={draft.supports_json_mode} type="checkbox" onChange={(event) => setDraft({ supports_json_mode: event.target.checked })} /> 结构化输出</label>
              <label><input checked={draft.supports_tool_calling} type="checkbox" onChange={(event) => setDraft({ supports_tool_calling: event.target.checked })} /> 使用工具</label>
              <label><input checked={draft.supports_reasoning} type="checkbox" onChange={(event) => setDraft({ supports_reasoning: event.target.checked })} /> 推理能力</label>
            </div>
          </div>
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
  selectSettingsObject,
}: {
  activeCategory: SettingsCategory;
  collapsed: boolean;
  selectSettingsObject: (category: SettingsCategory, objectID?: string) => void;
}) {
  if (collapsed) {
    return <aside aria-hidden="true" className="im-sidebar sidebar-placeholder app__sidebar tk-sidebar" />;
  }

  return (
    <aside className="im-sidebar settings-sidebar app__sidebar tk-sidebar">
      <ScrollArea className="settings-menu tk-sidebar-scroll" aria-label="设置菜单">
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
  const [automationPrompt, setAutomationPrompt] = useState('请处理这个自动化任务，并参考收到的事件信息完成任务。');
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
      setAutomationPrompt(isWebhook ? '收到外部事件后，请按任务说明完成处理。' : '请处理这个定时自动化任务。');
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
    setAutomationPrompt(selected.prompt_template || '请处理这个自动化任务。');
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
        <div className="model-settings-stack">
          <div className="settings-form model-settings-form">
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
          </div>
          {modelSettingsDraft && (
            <ModelSettingsDialog
              draft={modelSettingsDraft}
              model={visibleAvailableModels.find((model) => model.id === modelSettingsDraft.model_id)}
              onChange={setModelSettingsDraft}
              onClose={() => setModelSettingsDraft(null)}
              onSave={saveModelSettings}
            />
          )}
          <div className="detail-actions model-settings-actions">
            <button className="secondary-button" type="button" onClick={() => {
              setModelBaseURL(modelPreset.baseURL);
              setModelName(modelPreset.defaultModel);
              setReasoningModel(modelPreset.reasoningModel);
            }}>重置</button>
            <button type="button" onClick={saveModelDetail}>保存</button>
          </div>
          <details className="settings-advanced model-settings-advanced">
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
        <DetailHeader title={existing ? existing.name : kind === 'webhook' ? '新建外部触发任务' : '新建定时任务'} description={kind === 'webhook' ? '收到指定外部事件后自动执行任务' : 'Joi 打开时按设定时间自动运行'} />
        <div className="settings-form">
          <label className="field-row">
            <span>名称</span>
            <input value={automationName} onChange={(event) => setAutomationName(event.target.value)} />
          </label>
          {kind === 'schedule' ? (
            <>
              <label className="field-row">
                <span>运行方式</span>
                <select value={automationScheduleType} onChange={(event) => setAutomationScheduleType(event.target.value)}>
                  <option value="interval">每隔一段时间</option>
                  <option value="daily">每天</option>
                  <option value="weekly">每周</option>
                  <option value="cron">自定义时间规则</option>
                  <option value="once">仅运行一次</option>
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
                  <span>自定义时间规则</span>
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
          ) : null}
          <label className="field-row">
            <span>任务说明</span>
            <textarea value={automationPromptForDisplay(automationPrompt)} onChange={(event) => setAutomationPrompt(event.target.value)} rows={5} />
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
              <KV label="下次运行" value={existing.next_fire_at || '未计算'} />
              <KV label="上次运行" value={existing.last_fire_at || '无'} />
              <KV label="最近结果" value={formatStatus(automationState.lastRunStatus)} />
            </dl>
            {automationState.banner && (
              <p className={automationState.banner.tone === 'error' ? 'terminal-error' : 'logs-notice'}>
                {automationState.banner.title} · {automationState.banner.message}
              </p>
            )}
            {existing.kind === 'webhook' && (
              <section>
                <h3>外部触发地址</h3>
                <div className="detail-actions">
                  <button type="button" onClick={() => void loadAutomationEndpoint(existing.id)}>显示地址</button>
                  <button type="button" onClick={() => void copyAutomationEndpoint(existing.id)}>复制地址</button>
                  <button type="button" onClick={() => void rotateAutomationWebhookSecret(existing.id)}>更新验证密钥</button>
                  {automationState.secretValueAvailable && <button type="button" onClick={() => void copyAutomationSecret()}>复制新密钥</button>}
                  <button type="button" onClick={() => void testAutomationWebhook(existing.id)}>测试触发</button>
                </div>
                {automationEndpoint?.automation_id === existing.id && (
                  <dl className="compact-kv">
                    <KV label="触发地址" value={automationState.webhookUrl || automationEndpoint.url} />
                    <KV label="验证密钥" value={automationState.secretConfigured ? '已配置' : '未配置'} />
                    {automationState.secretValueAvailable && <KV label="新密钥" value="已生成，只能复制一次" />}
                  </dl>
                )}
              </section>
            )}
            <section>
              <h3>最近触发</h3>
              <RecordList
                emptyText="暂无触发记录。"
                items={recentTriggers}
                renderItem={(trigger) => (
                  <article key={trigger.id} className="row-card compact">
                    <strong>{formatStatus(trigger.status)}</strong>
                    <small>{formatAutomationTriggerType(trigger.trigger_type)} · {formatShortTime(trigger.created_at)}</small>
                    {trigger.error_message && <small>{trigger.error_message}</small>}
                  </article>
                )}
              />
            </section>
            <section>
              <h3>最近运行</h3>
              <RecordList
                emptyText="暂无运行记录。"
                items={recentRuns}
                renderItem={(run) => (
                  <article key={run.id} className="row-card compact">
                    <strong>{formatStatus(run.status)}</strong>
                    <small>第 {run.attempt_number} 次尝试 · {formatShortTime(run.created_at)}</small>
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
      return (
        <section className="settings-detail-panel">
          <CostsPanel calls={calls} health={health} usage={usage} />
        </section>
      );
    }
    if (activeObject.id === 'log-cleanup') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="清理运行记录" description="先预览范围，再清理不再需要的本地运行记录" />
          <DiagnosticsLogCleanup onNotice={setNotice} />
        </section>
      );
    }
    return (
      <section className="settings-detail-panel">
        <DetailHeader title="运行记录" description="按结果、风险和功能查看本机最近活动" />
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
    const enabledCapabilities = capabilities.filter((capability) => capability.enabled);
    const connectedExtensions = mcpServers.filter((server) => server.status === 'active' || server.status === 'connected');
    return (
      <section className="settings-detail-panel">
        <DetailHeader title="能力概览" description="查看 Joi 可以完成的任务、已连接扩展和允许访问的范围" />
        <dl className="metrics">
          <KV label="可用能力" value={`${enabledCapabilities.length} 项`} />
          <KV label="任务流程" value={`${workflows.filter((workflow) => workflow.enabled).length} 项`} />
          <KV label="已连接扩展" value={`${connectedExtensions.length} 个`} />
          <KV label="已启用技能" value={`${skills.filter((skill) => skill.enabled).length} 个`} />
          <KV label="最近使用" value={`${toolRuns.length} 次`} />
          <KV label="默认文件夹" value={displayPathName(workspaceSettings?.default_root)} />
        </dl>

        <h3>可用能力</h3>
        <div className="capability-grid">
          {capabilities.map((capability) => (
            <article key={capability.id} className="row-card compact capability-contract-card">
              <div className="capability-contract-title">
                <strong>{capabilityDisplayName(capability.id, capability.description)}</strong>
                <small>{capability.enabled ? '已启用' : '已停用'}</small>
              </div>
              <p>{capabilityUserDescription(capability.id, capability.description)}</p>
              <small>风险：{formatRiskLevel(capability.risk_level)}</small>
            </article>
          ))}
          {capabilities.length === 0 && <p className="empty">暂无可用能力。</p>}
        </div>

        <h3>已连接扩展</h3>
        <RecordList
          emptyText="暂无已连接扩展。"
          items={mcpServers}
          renderItem={(server) => (
            <article key={server.id} className="row-card">
              <div>
                <strong>{extensionDisplayName(server.name)}</strong>
                <p>{formatConnectionStatus(server.status)}</p>
                <small>{server.tools.length} 项功能 · {server.tools.filter((tool) => Boolean(tool.wrapped_as)).length} 项已授权</small>
              </div>
              <div className="row-actions">
                <button type="button" onClick={() => syncMCPServer(server.id)}>重新检查</button>
              </div>
            </article>
          )}
        />

        <h3>技能</h3>
        <RecordList
          emptyText="暂无已安装技能。"
          items={skills}
          renderItem={(skill) => (
            <article key={skill.id} className="row-card compact">
              <strong>{skillDisplayName(skill.name)}</strong>
              <p>{skillUserDescription(skill.name, skill.description)}</p>
              <small>{skill.enabled ? '已启用' : '已停用'} · 需要 {skill.required_capabilities.length} 项能力</small>
            </article>
          )}
        />

        <h3>访问范围</h3>
        <div className="settings-form compact">
          <div className="field-row">
            <span>可访问文件夹</span>
            <div className="connection-status">
              <strong>{workspaceSettings?.allowed_roots?.length ?? 0} 个</strong>
              <small>{workspaceSettings?.allowed_roots?.map(displayPathName).join('、') || '未设置'}</small>
            </div>
          </div>
          <div className="field-row">
            <span>可访问网站</span>
            <div className="connection-status">
              <strong>{workspaceSettings?.browser_allowed_hosts?.length ?? 0} 个</strong>
              <small>{workspaceSettings?.browser_allowed_hosts?.join('、') || '未单独授权'}</small>
            </div>
          </div>
        </div>

        <h3>最近使用</h3>
        <RecordList
          emptyText="暂无能力使用记录。"
          items={latestRuns}
          renderItem={(run) => (
            <article key={run.id} className="row-card compact">
              <strong>{capabilityDisplayName(run.capability_id || run.tool_name)} · {formatStatus(run.status)}</strong>
              <small>{formatRiskLevel(run.risk_level)} · {formatMilliseconds(run.duration_ms ?? 0)} · {formatShortTime(run.finished_at || run.created_at)}</small>
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
          <DetailHeader title="执行器连接" description="允许这台 Mac 连接额外执行器分担任务" />
          <div className="settings-form">
            <label className="field-row">
              <span>允许连接执行器</span>
              <input checked={workerGatewayEnabled} type="checkbox" onChange={(event) => setWorkerGatewayEnabled(event.target.checked)} />
            </label>
            <div className="field-row">
              <span>连接状态</span>
              <div className="connection-status">
                <span className={`live-dot ${workerGatewayEnabled ? 'on' : ''}`} />
                <strong>{workerGatewayEnabled ? '已启用' : '已停用'}</strong>
                <small>额外执行器可在授权后接收任务</small>
                <button type="button" onClick={rotateWorkerToken}>更新连接凭证</button>
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
          <DetailHeader title="连接记录" description="查看执行器的连接、状态更新和任务分配" />
          <RecordList
            emptyText="暂无执行器连接记录。"
            items={audit}
            renderItem={(item) => (
              <article key={item.id} className="row-card compact">
                <strong>{nodeDisplayName(item.node_id)} · {formatAction(item.action)} · {formatStatus(item.status)}</strong>
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
            <span>连接状态</span>
            <div className="connection-status">
              <span className={`live-dot ${selectedNode?.status !== 'disabled' && selectedNode ? 'on' : ''}`} />
              <strong>{selectedNode ? formatStatus(selectedNode.status) : '未注册'}</strong>
              <small>{selectedNode ? `可用能力 ${selectedNode.capabilities?.length ?? 0} 项` : '尚未注册'}</small>
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
                <option value="MODEL_API_KEY">模型服务密钥</option>
                <option value="TELEGRAM_BOT_TOKEN">Telegram 机器人令牌</option>
                <option value="WORKER_TOKEN">执行器连接凭证</option>
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
            {Object.entries(secretStatus?.secrets ?? {}).filter(([name]) => isUserFacingSecret(name)).map(([name, present]) => (
              <span key={name}>{secretDisplayName(name)}：{present ? '已配置' : '未配置'}</span>
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
                  <strong>{item.requested_action || capabilityDisplayName(item.capability_id)}</strong>
                  <p>风险 {formatRiskLevel(item.risk_level)} · {formatStatus(item.status)}</p>
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
    return (
      <section className="settings-detail-panel">
        <DetailHeader title="诊断与支持" description="检查本机状态；需要技术支持时再导出脱敏诊断包" />
        <dl className="metrics">
          <KV label="本地数据" value={Boolean(health?.service_status?.sqlite) ? '正常' : '需要检查'} />
          <KV label="今日模型调用" value={String(health?.model_latency?.model_calls_today ?? 0)} />
          <KV label="已连接执行器" value={String(health?.worker_status?.length ?? 0)} />
          <KV label="待处理问题" value={String(health?.warnings?.length ?? 0)} />
        </dl>
        <div className="detail-actions">
          <button type="button" onClick={async () => {
            const result = await desktopApi.exportDiagnostics();
            setNotice(`诊断包已导出：${result.path}`);
          }}>导出脱敏诊断包</button>
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
      { id: 'logs', label: '运行记录', description: '查看最近活动、结果与问题' },
      { id: 'token-usage', label: '用量统计', description: '模型用量、缓存命中与成本' },
      { id: 'log-cleanup', label: '清理记录', description: '预览并清理本地运行记录' },
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
      { id: 'builtin', label: '能力概览', description: '查看 Joi 可以做什么以及访问范围' },
    ];
  }
  if (category === 'nodesExecution') {
    const fallbackNodeNames: Record<string, string> = {
      'main-node': '这台 Mac',
      'local-worker': '本机执行器',
      'vps-la-1': '远程执行器',
    };
    const nodeItems = ['main-node', 'local-worker', 'vps-la-1'].map((id) => {
      const node = nodes.find((item) => item.id === id);
      return { id, label: node?.name || fallbackNodeNames[id], description: node ? `${formatNodeRole(node.role)} · ${formatStatus(node.status)}` : '尚未连接' };
    });
    return [
      ...nodeItems,
      { id: 'worker-gateway', label: '执行器连接', description: '连接本机或远程执行器' },
      { id: 'assignment-policy', label: '分配策略', description: '任务派发规则' },
      { id: 'node-audit', label: '连接记录', description: '查看执行器连接与派发状态' },
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
    { id: 'diagnostics', label: '诊断与支持', description: '检查状态、导出诊断和修复问题' },
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
              {memoryProposalWhy(memory) ? <small>{memoryProposalWhy(memory)}</small> : null}
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
  currentRoomID,
  currentConversationID,
  loadConversation,
  loadRoom,
  messenger,
  setActiveTab,
  trace,
}: {
  activeTab: Tab;
  archiveConversation: (conversationID: string) => Promise<void>;
  chat: ChatResponse | null;
  collapsed: boolean;
  conversations: ConversationSummary[];
  currentRoomID: string;
  currentConversationID: string;
  loadConversation: (conversationID: string) => Promise<void>;
  loadRoom: (room: MessengerRoom) => Promise<void>;
  messenger: PersonaMessengerSnapshot | null;
  setActiveTab: (tab: Tab) => void;
  trace: RunTrace | null;
}) {
  if (collapsed) {
    return <aside aria-hidden="true" className="im-sidebar sidebar-placeholder app__sidebar tk-sidebar" />;
  }

  const rooms = messenger?.rooms ?? [];
  const groupedRooms = groupMessengerRooms(rooms);
  const isRoomContext = activeTab === 'chat' || activeTab === 'trace';

  return (
    <aside className="im-sidebar app__sidebar tk-sidebar">
      <ScrollArea className="conversation-list tk-sidebar-scroll">
        {rooms.length ? (
          <>
            {groupedRooms.map((group) => (
              <section key={group.id} className="messenger-room-section">
                {group.rooms.map((room) => {
                  const active = currentRoomID === room.id || (!currentRoomID && currentConversationID && room.conversation_id === currentConversationID);
                  return (
                    <div key={room.id} className={`conversation-row-wrap messenger-room-wrap ${active && isRoomContext ? 'active' : ''}`}>
                      <button
                        className={`conversation-item conversation-chat-item messenger-room-item ${active && isRoomContext ? 'active' : ''}`}
                        type="button"
                        onClick={() => void loadRoom(room)}
                      >
                        <RoomAvatar room={room} personas={messenger?.personas ?? []} />
                        <span className="room-list-copy">
                          <strong>{room.title}</strong>
                          <em>{compactRoomLastMessage(room.last_message)}</em>
                        </span>
                      </button>
                    </div>
                  );
                })}
              </section>
            ))}
          </>
        ) : conversations.length ? conversations.map((item) => {
          const active = currentConversationID === item.id || (!currentConversationID && chat?.conversation_id === item.id);
          return (
            <div key={item.id} className={`conversation-row-wrap ${active && isRoomContext ? 'active' : ''}`}>
              <button
                className={`conversation-item conversation-chat-item ${active && isRoomContext ? 'active' : ''}`}
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
      <footer className="sidebar-footer">
        <span aria-hidden="true" className="user-avatar user-avatar-self">你</span>
        <span className="sidebar-user-name">你</span>
        <button
          aria-label="设置"
          className="footer-settings-button"
          title="设置"
          type="button"
          onClick={() => setActiveTab('settings')}
        >
          <SidebarIcon name="settings" />
        </button>
      </footer>
    </aside>
  );
}

function groupMessengerRooms(rooms: MessengerRoom[]) {
  const groups = [
    { id: 'hub', label: '私人总群', rooms: rooms.filter((room) => room.type === 'private_hub') },
    { id: 'project_dm', label: '项目人格私聊', rooms: rooms.filter((room) => room.type === 'project_dm') },
    { id: 'shared', label: '共享与外部房间', rooms: rooms.filter((room) => room.type === 'shared' || room.type === 'external_mirror') },
    { id: 'human', label: '真人私聊', rooms: rooms.filter((room) => room.type === 'human_dm') },
  ];
  const known = new Set(groups.flatMap((group) => group.rooms.map((room) => room.id)));
  const other = rooms.filter((room) => !known.has(room.id));
  if (other.length) groups.push({ id: 'other', label: '其他房间', rooms: other });
  return groups
    .map((group) => ({
      ...group,
      rooms: [...group.rooms].sort(compareMessengerRooms),
    }))
    .filter((group) => group.rooms.length > 0);
}

function compareMessengerRooms(a: MessengerRoom, b: MessengerRoom) {
  const priority = roomPriorityScore(b) - roomPriorityScore(a);
  if (priority !== 0) return priority;
  return Date.parse(b.last_activity_at || '') - Date.parse(a.last_activity_at || '');
}

function roomPriorityScore(room: MessengerRoom) {
  return (room.pending_approval_count > 0 ? 1000 : 0)
    + (room.unread_count > 0 ? 600 : 0)
    + (room.failed_run_count > 0 ? 400 : 0)
    + (room.running_run_count > 0 ? 200 : 0);
}

function defaultScopeForRoom(room: MessengerRoom) {
  if (room.type === 'project_dm') return 'current_project';
  if (room.type === 'private_hub' || room.type === 'shared' || room.type === 'external_mirror') return 'auto_route';
  return 'room_scope';
}

function extractPersonaMentions(message: string, personas: ProjectPersona[]) {
  return personas
    .filter((persona) => {
      const handle = persona.handle.startsWith('@') ? persona.handle : `@${persona.handle}`;
      if (message.includes(handle)) return true;
      return message.includes(`@${persona.display_name}`);
    })
    .map((persona) => persona.id);
}

function composerPlaceholder(room: MessengerRoom | null, persona: ProjectPersona | null) {
  if (!room) return '输入消息...';
  if (room.type === 'project_dm') return `和 ${persona?.display_name || room.title} 说项目任务...`;
  if (room.type === 'private_hub') return '发到私人总群，或 @ 指定项目人格...';
  if (room.type === 'shared') return '发到共享房间，项目人格会按参与策略回复...';
  return '输入消息...';
}

function compactRoomLastMessage(value?: string) {
  const text = value?.trim().replace(/\s+/g, ' ') || '暂无消息';
  return text.length > 42 ? `${text.slice(0, 42)}...` : text;
}

function RoomAvatar({ room, personas }: { room: MessengerRoom; personas: ProjectPersona[] }) {
  const persona = room.persona_id ? personas.find((item) => item.id === room.persona_id) : undefined;
  const avatar = roomAvatarValue(room) || persona?.avatar || '';
  const label = avatar && !isImageAvatar(avatar)
    ? avatar.slice(0, 2)
    : room.type === 'private_hub' ? '总' : (persona?.display_name || room.title || '房').slice(0, 1);
  const showPersonaIndicator = Boolean(persona) && room.type === 'project_dm';
  return (
    <span className={`room-avatar room-avatar-${classToken(room.type)}`}>
      {avatar && isImageAvatar(avatar) ? <img src={avatar} alt="" /> : label}
      {showPersonaIndicator ? <i aria-label="项目人格" title="项目人格" /> : null}
    </span>
  );
}

function roomAvatarValue(room: MessengerRoom | null | undefined) {
  const avatar = typeof room?.avatar === 'string' ? room.avatar.trim() : '';
  if (avatar) return avatar;
  const metadataAvatar = room?.metadata?.avatar;
  return typeof metadataAvatar === 'string' ? metadataAvatar.trim() : '';
}

function memoriesForPrivateProject(
  memories: MemoryRecord[],
  persona: ProjectPersona,
  project: PersonaMessengerSnapshot['projects'][number] | null,
) {
  const projectID = project?.id || persona.project_id;
  const entityHints = new Set([
    persona.id,
    persona.display_name,
    persona.handle,
    projectID,
    project?.name || '',
  ].filter(Boolean));
  return memories.filter((memory) => {
    if (memory.scope_id === persona.id || memory.scope_id === projectID) return true;
    if (memory.metadata?.persona_id === persona.id || memory.metadata?.project_id === projectID) return true;
    return (memory.entities ?? []).some((entity) => entityHints.has(entity));
  });
}

function isImageAvatar(value: string) {
  return /^https?:\/\//i.test(value) || value.startsWith('data:image/') || value.startsWith('file:');
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read avatar file'));
    reader.readAsDataURL(file);
  });
}

function attachmentKind(file: File): ComposerAttachment['kind'] {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'svg'].includes(extension)) return 'image';
  if (['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv'].includes(extension)) return 'video';
  return 'file';
}

function attachmentForRequest(attachment: ComposerAttachment) {
  return {
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    mime_type: attachment.mime_type,
    kind: attachment.kind,
    preview_url: attachment.preview_url,
    last_modified: attachment.last_modified,
  };
}

function attachmentOnlyPrompt(attachments: ComposerAttachment[]) {
  if (attachments.length === 0) return '';
  const names = attachments.map((item) => item.name).slice(0, 3).join('、');
  const suffix = attachments.length > 3 ? ` 等 ${attachments.length} 个附件` : '';
  return `请查看我上传的${attachments.length}个附件：${names}${suffix}`;
}

function formatAttachmentSize(size: number) {
  if (!size) return '附件';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function ComposerAttachmentPreview({ attachment }: { attachment: ComposerAttachment }) {
  if (attachment.kind === 'image' && attachment.preview_url) {
    return <img className="composer-attachment-preview" src={attachment.preview_url} alt="" />;
  }
  if (attachment.kind === 'video' && attachment.preview_url) {
    return <video className="composer-attachment-preview" src={attachment.preview_url} muted playsInline preload="metadata" />;
  }
  return (
    <span className="composer-attachment-preview composer-attachment-glyph" aria-hidden="true">
      <AttachmentKindIcon kind={attachment.kind} />
    </span>
  );
}

function AttachmentKindIcon({ kind }: { kind: ComposerAttachment['kind'] }) {
  if (kind === 'image') {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M5 5h14v14H5z" />
        <path d="m7 16 4-4 3 3 2-2 3 3" />
        <path d="M9 9h.01" />
      </svg>
    );
  }
  if (kind === 'video') {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M5 7h10v10H5z" />
        <path d="m15 10 4-2v8l-4-2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function handleTopControlClickAction(
  event: ReactMouseEvent<HTMLButtonElement>,
  action: () => void,
) {
  event.preventDefault();
  event.stopPropagation();
  action();
}

function SidebarTopControls({
  collapsed,
  openProjectCreator,
  setActiveTab,
  toggleCollapsed,
}: {
  collapsed: boolean;
  openProjectCreator: () => void;
  setActiveTab: (tab: Tab) => void;
  toggleCollapsed: () => void;
}) {
  const openSearch = () => setActiveTab('memory');

  return (
    <div className="sidebar-top-controls">
      <button
        aria-label="新建项目人格"
        className="round-icon-button"
        title="新建项目人格"
        type="button"
        onClick={(event) => handleTopControlClickAction(event, openProjectCreator)}
      >
        <SidebarIcon name="plus" />
      </button>
      <button
        aria-label="搜索"
        className="round-icon-button"
        title="搜索"
        type="button"
        onClick={(event) => handleTopControlClickAction(event, openSearch)}
      >
        <SidebarIcon name="search" />
      </button>
      <button
        aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        className="round-icon-button collapse-sidebar-button"
        title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        type="button"
        onClick={(event) => handleTopControlClickAction(event, toggleCollapsed)}
      >
        <SidebarIcon name={collapsed ? 'expand' : 'collapse'} />
      </button>
    </div>
  );
}

function ProjectPersonaCreatorModal({
  busy,
  candidates,
  draft,
  onClose,
  onCreate,
  onDraftChange,
  onGenerate,
  onSelectCandidate,
  selectedCandidateID,
}: {
  busy: boolean;
  candidates: PersonaCandidate[];
  draft: { name: string; goal: string; domain: string; phase: string };
  onClose: () => void;
  onCreate: () => void;
  onDraftChange: (draft: { name: string; goal: string; domain: string; phase: string }) => void;
  onGenerate: () => void;
  onSelectCandidate: (id: string) => void;
  selectedCandidateID: string;
}) {
  const canCreate = Boolean(draft.name.trim()) && candidates.length > 0 && Boolean(selectedCandidateID);
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="project-persona-modal" role="dialog" aria-modal="true" aria-labelledby="project-persona-modal-title">
        <header>
          <h2 id="project-persona-modal-title">新建项目人格</h2>
          <button type="button" onClick={onClose}>关闭</button>
        </header>
        <div className="project-persona-form">
          <label>
            <span>项目名称</span>
            <input value={draft.name} onChange={(event) => onDraftChange({ ...draft, name: event.target.value })} />
          </label>
          <label>
            <span>目标</span>
            <textarea value={draft.goal} onChange={(event) => onDraftChange({ ...draft, goal: event.target.value })} />
          </label>
          <div className="project-persona-form-grid">
            <label>
              <span>领域</span>
              <input value={draft.domain} onChange={(event) => onDraftChange({ ...draft, domain: event.target.value })} />
            </label>
            <label>
              <span>阶段</span>
              <input value={draft.phase} onChange={(event) => onDraftChange({ ...draft, phase: event.target.value })} />
            </label>
          </div>
        </div>
        <div className="candidate-toolbar">
          <button type="button" disabled={busy || !draft.name.trim()} onClick={onGenerate}>生成 3 个候选</button>
        </div>
        <div className="persona-candidate-grid">
          {candidates.map((candidate) => (
            <button
              key={candidate.id}
              className={candidate.id === selectedCandidateID ? 'selected' : ''}
              type="button"
              onClick={() => onSelectCandidate(candidate.id)}
            >
              <strong>{candidate.display_name}</strong>
              <small>{candidate.handle}</small>
              <span>{candidate.tagline}</span>
              <em>{candidate.rationale}</em>
            </button>
          ))}
        </div>
        <footer>
          <button type="button" onClick={onClose}>取消</button>
          <button type="button" disabled={busy || !canCreate} onClick={onCreate}>创建项目私聊</button>
        </footer>
      </section>
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
  const toggleLabel = collapsed ? '展开设置菜单' : '折叠设置菜单';

  return (
    <div className="sidebar-top-controls settings-top-controls">
      <button
        aria-label="返回对话"
        className="round-icon-button"
        title="返回对话"
        type="button"
        onClick={(event) => handleTopControlClickAction(event, goBack)}
      >
        <SidebarIcon name="back" />
      </button>
      <button
        aria-label={toggleLabel}
        className="round-icon-button collapse-sidebar-button"
        title={toggleLabel}
        type="button"
        onClick={(event) => handleTopControlClickAction(event, toggleCollapsed)}
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
  addAttachments,
  activePersona,
  activeProductTask,
  activeRoom,
  activeExecutionActions,
  attachments,
  artifacts,
  autoRightPanelCollapsed,
  chat,
  conversationMessages,
  cancelRun,
  continueProductTask,
  decideConfirmation,
  decideProactiveMessage,
  exportCurrentMessengerData,
  health,
  inputMode,
  isSubmitting,
  lastPrompt,
  message,
  memories,
  messenger,
  openArtifact,
  openLoops,
  openRunTrace,
  loadConversationForMessage,
  pendingUserMessage,
  streamingAssistantMessage,
  proactiveMessages,
  productTasks,
  runEventsByRunId,
  savedModels,
  selectProductTask,
  settings,
  roomRouteLock,
  rollbackPersonaVersion,
  retryExternalConnectorEvent,
  removeAttachment,
  setActiveTab,
  setMessage,
  startRightPanelResize,
  updateMemory,
  submit,
  trace,
  traceSpanAudit,
  updateMessengerProject,
  updateMessengerRoom,
  updateProjectPersona,
  workspaceSettings,
}: {
  addAttachments: (files: FileList | File[]) => void;
  activePersona: ProjectPersona | null;
  activeProductTask: ProductTaskDetail | null;
  activeRoom: MessengerRoom | null;
  activeExecutionActions: ExecutionAction[];
  attachments: ComposerAttachment[];
  artifacts: ArtifactSummary[];
  autoRightPanelCollapsed: boolean;
  chat: ChatResponse | null;
  conversationMessages: ConversationMessage[];
  cancelRun: (runID: string) => Promise<void>;
  continueProductTask: (task: ProductTask) => Promise<void>;
  decideConfirmation: (id: string, approve: boolean, scope?: 'one_call' | 'current_run') => Promise<void>;
  decideProactiveMessage: (id: string, action: string, feedback?: string) => Promise<void>;
  exportCurrentMessengerData: () => Promise<void>;
  health: SystemHealth | null;
  inputMode: InputMode;
  isSubmitting: boolean;
  lastPrompt: string;
  message: string;
  memories: MemoryRecord[];
  messenger: PersonaMessengerSnapshot | null;
  openArtifact: (id: string) => Promise<void>;
  openLoops: OpenLoop[];
  openRunTrace: (runID: string, destination?: 'panel' | 'stage') => Promise<void>;
  loadConversationForMessage: (messageID: string) => Promise<boolean>;
  pendingUserMessage: ConversationMessage | null;
  streamingAssistantMessage: StreamingAssistantMessage | null;
  proactiveMessages: ProactiveMessage[];
  productTasks: ProductTask[];
  runEventsByRunId: Record<string, NormalizedRunEvent[]>;
  savedModels: AvailableModel[];
  selectProductTask: (id: string) => Promise<void>;
  settings: SettingsRecord | null;
  roomRouteLock: PersonaMessengerSnapshot['route_locks'][number] | null;
  rollbackPersonaVersion: (personaID: string, targetVersion: number) => Promise<void>;
  retryExternalConnectorEvent: (eventID: string) => Promise<void>;
  removeAttachment: (id: string) => void;
  setActiveTab: (tab: Tab) => void;
  setMessage: (value: string) => void;
  startRightPanelResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  updateMemory: (id: string, action: string, extra?: Partial<MemoryRecord>) => Promise<void>;
  submit: (event?: FormEvent) => Promise<void>;
  trace: RunTrace | null;
  traceSpanAudit: { spans: RunTraceSpan[]; summary: RunTraceSpanSummary };
  updateMessengerProject: (req: UpdateMessengerProjectRequest) => Promise<void>;
  updateMessengerRoom: (req: UpdateMessengerRoomRequest) => Promise<void>;
  updateProjectPersona: (req: UpdateProjectPersonaRequest) => Promise<void>;
  workspaceSettings: WorkspaceSettings | null;
}) {
  const settledMessages: ConversationMessage[] = conversationMessages.length
    ? conversationMessages
    : chat
      ? [
        { id: chat.user_message_id, conversation_id: chat.conversation_id, role: 'user', content: lastPrompt },
        ...(streamingAssistantMessage ? [] : [{ id: chat.assistant_message_id, conversation_id: chat.conversation_id, role: 'assistant' as const, content: chat.response, run_id: chat.run_id }]),
      ]
      : [];
  const visibleThreads = useMemo(() => visibleMessengerThreads(messenger, activeRoom), [activeRoom, messenger]);
  const visibleThreadSourceSignature = useMemo(
    () => visibleThreads.map(threadContentSignature).join('|'),
    [visibleThreads],
  );
  const threadMessageAnnotations = useMemo(
    () => buildThreadMessageAnnotations(visibleThreads, messenger?.recent_thread_events ?? []),
    [messenger?.recent_thread_events, visibleThreads],
  );
  const [restoredThreadMessages, setRestoredThreadMessages] = useState<ConversationMessage[]>([]);
  const [threadRestoreStatus, setThreadRestoreStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!shouldRestoreThreadMessages(settledMessages.length, visibleThreads.length)) {
      setRestoredThreadMessages([]);
      setThreadRestoreStatus('');
      return () => {
        cancelled = true;
      };
    }

    setRestoredThreadMessages([]);
    setThreadRestoreStatus('正在从线程恢复聊天内容...');
    void restoreMessagesForThreads(visibleThreads)
      .then((messages) => {
        if (cancelled) return;
        setRestoredThreadMessages(messages);
        setThreadRestoreStatus(messages.length ? '' : '当前线程没有可渲染的源消息。');
      })
      .catch((err) => {
        if (cancelled) return;
        setRestoredThreadMessages([]);
        setThreadRestoreStatus(err instanceof Error ? err.message : '无法恢复线程内容。');
      });

    return () => {
      cancelled = true;
    };
  }, [settledMessages.length, visibleThreads, visibleThreadSourceSignature]);

  const projectionMessages = useMemo(
    () => messagesForConversationHydration(settledMessages, restoredThreadMessages),
    [restoredThreadMessages, settledMessages],
  );
  const assetConversationID = settledMessages[0]?.conversation_id || chat?.conversation_id || activeRoom?.conversation_id || '';
  const candidateRunIds = new Set<string>();
  const assetRunIds = new Set<string>();
  for (const message of projectionMessages) {
    const runId = getMessageRunId(message);
    if (runId) candidateRunIds.add(runId);
  }
  for (const message of settledMessages) {
    const runId = getMessageRunId(message);
    if (runId) assetRunIds.add(runId);
  }
  const streamingRunId = streamingAssistantMessage ? getMessageRunId(streamingAssistantMessage) : '';
  if (streamingRunId) candidateRunIds.add(streamingRunId);
  if (streamingRunId) assetRunIds.add(streamingRunId);
  if (chat?.run_id) candidateRunIds.add(chat.run_id);
  if (chat?.run_id && (!assetConversationID || !chat.conversation_id || chat.conversation_id === assetConversationID)) assetRunIds.add(chat.run_id);
  if (trace?.id) candidateRunIds.add(trace.id);
  const pendingLiveRunId = (isSubmitting || pendingUserMessage) ? latestActiveRunId(runEventsByRunId) : '';
  const activeRunId = streamingRunId || chat?.run_id || trace?.id || pendingLiveRunId;
  if (activeRunId) candidateRunIds.add(activeRunId);
  const threadRunEventsByRunId = pickRunEvents(runEventsByRunId, candidateRunIds);
  const conversationProjection = useMemo(() => buildConversationRenderItems({
    messages: projectionMessages,
    pendingUserMessage,
    streamingAssistant: streamingAssistantMessage,
    runEventsByRunId: threadRunEventsByRunId,
    activeRunId,
    mode: inputMode,
  }), [activeRunId, inputMode, pendingUserMessage, projectionMessages, threadRunEventsByRunId, streamingAssistantMessage]);
  const renderItems = conversationProjection.items;
  const hasThread = renderItems.length > 0;
  const activeTaskBelongsToCurrentRun = Boolean(activeProductTask?.task.latest_run_id && activeProductTask.task.latest_run_id === (chat?.run_id || trace?.id));
  const latestTask = chat?.product_task ? { task: chat.product_task, steps: [], deliverables: chat.artifacts ?? [] } : activeTaskBelongsToCurrentRun ? activeProductTask : null;
  const executionActions = useMemo(() => projectRunTraceToActions(trace), [trace]);
  const visibleTraceActions = useMemo(() => visibleExecutionActions(executionActions), [executionActions]);
  const liveExecutionActions = activeExecutionActions.length > 0 ? activeExecutionActions : visibleTraceActions;
  const showInlineTaskCard = false;
  const [manualRightPanelCollapsed, setManualRightPanelCollapsed] = useState(true);
  const [rightInspectorTab, setRightInspectorTab] = useState<RightInspectorTab>('overview');
  const [selectedThreadID, setSelectedThreadID] = useState('');
  const [focusedMessageID, setFocusedMessageID] = useState('');
  const [focusMessageSerial, setFocusMessageSerial] = useState(0);
  const [threadLocateStatus, setThreadLocateStatus] = useState('');
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const rightPanelCollapsed = manualRightPanelCollapsed || autoRightPanelCollapsed;

  useEffect(() => {
    if (!focusedMessageID) return undefined;
    let clearTimer = 0;
    const frame = window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(messageAnchorSelector(focusedMessageID));
      if (!target) {
        setThreadLocateStatus('源消息暂未出现在当前聊天');
        return;
      }
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setThreadLocateStatus('已定位到原聊天');
      clearTimer = window.setTimeout(() => {
        setFocusedMessageID((current) => current === focusedMessageID ? '' : current);
      }, 6000);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (clearTimer) window.clearTimeout(clearTimer);
    };
  }, [focusedMessageID, focusMessageSerial, renderItems.length]);

  useEffect(() => {
    if (selectedThreadID && !visibleThreads.some((thread) => thread.id === selectedThreadID)) {
      setSelectedThreadID('');
    }
  }, [selectedThreadID, visibleThreadSourceSignature, visibleThreads]);

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;

    event.preventDefault();
    void submit();
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.currentTarget.files;
    if (files?.length) addAttachments(files);
    event.currentTarget.value = '';
  }

  async function locateThreadSource(thread: MessengerThread) {
    const sourceMessageID = firstThreadSourceMessageID(thread);
    if (!sourceMessageID) {
      setThreadLocateStatus('此线程尚未记录源消息');
      return;
    }
    setThreadLocateStatus('正在定位原聊天...');
    try {
      await loadConversationForMessage(sourceMessageID);
      setFocusedMessageID(sourceMessageID);
      setFocusMessageSerial((current) => current + 1);
    } catch (err) {
      setThreadLocateStatus(err instanceof Error ? err.message : '无法定位原聊天');
    }
  }

  function openThreadDetail(threadID: string) {
    if (!threadID) return;
    setSelectedThreadID(threadID);
    setManualRightPanelCollapsed(false);
    setRightInspectorTab('threads');
  }

  return (
    <section className={`chat-home companion-layout tk-workspace${rightPanelCollapsed ? ' companion-layout-right-collapsed' : ''}`}>
      <section className="chat-main-column tk-content-panel">
        <MessengerChatHeader
          room={activeRoom}
          persona={activePersona}
          personas={messenger?.personas ?? []}
          project={activeRoom?.project_id ? messenger?.projects.find((item) => item.id === activeRoom.project_id) ?? null : null}
          routeLock={roomRouteLock}
          onOpenInspector={() => setManualRightPanelCollapsed((current) => !current)}
        />

        <ScrollArea
          className={hasThread ? 'chat-thread' : 'chat-empty-state'}
          stickToBottom={hasThread}
          stickToBottomKey={hasThread ? projectionMessages[0]?.conversation_id || chat?.conversation_id || activeRunId || 'thread' : undefined}
        >
          {hasThread ? (
            <>
              <MessageList
                assistantAvatarSrc={joiAvatar}
                formatAssistantContent={userFacingAssistantText}
                items={renderItems}
                highlightedMessageId={focusedMessageID}
                onOpenArtifact={(artifactId) => void openArtifact(artifactId)}
                onOpenTask={(taskId) => void selectProductTask(taskId)}
                onOpenThread={openThreadDetail}
                onOpenTrace={(runID) => void openRunTrace(runID, 'stage')}
                onResolveApproval={(approvalId, approve, scope) => void decideConfirmation(approvalId, approve, scope)}
                selectedThreadId={selectedThreadID}
                threadAnnotations={threadMessageAnnotations}
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
            threadRestoreStatus ? <p className="empty">{threadRestoreStatus}</p> : null
          )}
        </ScrollArea>

        <form className="composer tk-floating-panel" aria-busy={isSubmitting} onSubmit={submit}>
          <textarea
            placeholder={isSubmitting ? '补充或修改当前任务...' : composerPlaceholder(activeRoom, activePersona)}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleComposerKeyDown}
          />
          {attachments.length ? (
            <div className="composer-attachment-list" aria-label="已选择附件">
              {attachments.map((attachment) => (
                <div key={attachment.id} className={`composer-attachment-chip composer-attachment-${attachment.kind}`}>
                  <ComposerAttachmentPreview attachment={attachment} />
                  <span className="composer-attachment-copy">
                    <strong>{attachment.name}</strong>
                    <small>{formatAttachmentSize(attachment.size)}</small>
                  </span>
                  <button
                    aria-label={`移除${attachment.name}`}
                    className="composer-attachment-remove"
                    title="移除"
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    <CloseTabIcon />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="composer-tools">
            <input
              ref={attachmentInputRef}
              className="visually-hidden"
              type="file"
              multiple
              onChange={handleAttachmentChange}
            />
            <button
              aria-label="上传文件、图片或视频"
              className="composer-attachment-button"
              title="上传文件、图片或视频"
              type="button"
              onClick={() => attachmentInputRef.current?.click()}
            >
              <PaperclipIcon />
            </button>
          </div>
          {isSubmitting && !message.trim() && attachments.length === 0 ? (
            <button
              className="send-button stop-button"
              disabled={!activeRunId}
              type="button"
              title={activeRunId ? '中断运行' : '等待运行开始'}
              onClick={() => void cancelRun(activeRunId)}
            >
              ■
            </button>
          ) : (
            <button
              className="send-button"
              disabled={!message.trim() && attachments.length === 0}
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
            className="companion-right-panel tk-right-panel"
            contentClassName="companion-right-panel-content tk-panel-body"
            aria-label="Joi 右侧检查器"
          >
            <CompanionInspectorPanel
              activeTab={rightInspectorTab}
              activeRoom={activeRoom}
              activePersona={activePersona}
              artifacts={artifacts}
              conversationMessages={settledMessages}
              currentConversationID={assetConversationID}
              currentRunIDs={Array.from(assetRunIds)}
              decideProactiveMessage={decideProactiveMessage}
              messenger={messenger}
              memories={memories}
              openLoops={openLoops}
              onOpenModelSettings={() => setActiveTab('settings')}
              proactiveMessages={proactiveMessages}
              rollbackPersonaVersion={rollbackPersonaVersion}
              retryExternalConnectorEvent={retryExternalConnectorEvent}
              savedModels={savedModels}
              setActiveTab={setRightInspectorTab}
              settings={settings}
              trace={trace}
              traceSpanAudit={traceSpanAudit}
              exportCurrentMessengerData={exportCurrentMessengerData}
              openRunTrace={openRunTrace}
              onLocateThreadSource={(thread) => void locateThreadSource(thread)}
              onSelectThread={setSelectedThreadID}
              selectedThreadID={selectedThreadID}
              threadLocateStatus={threadLocateStatus}
              updateMemory={updateMemory}
              updateMessengerProject={updateMessengerProject}
              updateMessengerRoom={updateMessengerRoom}
              updateProjectPersona={updateProjectPersona}
              workspaceSettings={workspaceSettings}
            />
          </ScrollArea>
        </>
      )}
    </section>
  );
}

function MessengerChatHeader({
  onOpenInspector,
  persona,
  personas,
  project,
  room,
  routeLock,
}: {
  onOpenInspector: () => void;
  persona: ProjectPersona | null;
  personas: ProjectPersona[];
  project: PersonaMessengerSnapshot['projects'][number] | null;
  room: MessengerRoom | null;
  routeLock: PersonaMessengerSnapshot['route_locks'][number] | null;
}) {
  const activePersonas = room?.members?.filter((member) => member.type === 'persona') ?? [];
  const lockedPersona = routeLock ? personas.find((item) => item.id === routeLock.persona_id) : null;
  return (
    <header className="messenger-chat-header breadcrumb-bar">
      <div className="messenger-chat-identity">
        {room ? <RoomAvatar room={room} personas={personas} /> : <span className="room-avatar">J</span>}
        <div>
          <strong>{room?.title || '私人总群'}</strong>
          <small>
            {room?.type === 'project_dm'
              ? `${project?.name || room.subtitle || 'Project'} · ${persona?.status || 'active'}`
              : `${room?.members?.filter((member) => member.type !== 'persona').length ?? 1} 位真人 · ${activePersonas.length} 个项目人格 · ${room?.running_run_count ?? 0} 个活跃任务`}
          </small>
        </div>
      </div>
      {room?.type !== 'project_dm' && activePersonas.length > 0 ? (
        <div className="active-persona-stack" aria-label="活跃项目人格">
          {activePersonas.slice(0, 4).map((member) => (
            <span key={member.id} title={`${member.display_name} · 项目人格`}>{member.display_name.slice(0, 1)}</span>
          ))}
        </div>
      ) : null}
      {lockedPersona ? (
        <span className="route-lock-chip">@{lockedPersona.display_name} 已锁定</span>
      ) : null}
      <button className="observe-button" type="button" aria-label="展开观察面板" title="展开观察面板" onClick={onOpenInspector}>
        <ExpandPanelIcon />
      </button>
    </header>
  );
}

function ExpandPanelIcon() {
  return (
    <svg className="observe-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 5H5v4" />
      <path d="M5 5l6 6" />
      <path d="M15 19h4v-4" />
      <path d="M19 19l-6-6" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg className="composer-attachment-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m21.4 11.6-8.8 8.8a6 6 0 0 1-8.5-8.5l9.4-9.4a4 4 0 0 1 5.7 5.7l-9.4 9.4a2 2 0 1 1-2.8-2.8l8.8-8.8" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg className="overview-room-edit-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function CloseTabIcon() {
  return (
    <svg className="right-inspector-tab-close-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
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
        <KV label="进度" value={`${Math.round(task.progress_percent)}%`} />
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

type RestoredThreadMessage = {
  key: string;
  message: ConversationMessage;
  threadIndex: number;
  messageIndex: number;
};

function visibleMessengerThreads(messenger: PersonaMessengerSnapshot | null, room: MessengerRoom | null): MessengerThread[] {
  return (messenger?.threads ?? []).filter((thread) => (
    !room || thread.room_id === room.id || thread.source_room_ids.includes(room.id)
  ));
}

function threadContentSignature(thread: MessengerThread): string {
  return [
    thread.id,
    thread.updated_at || '',
    thread.source_message_ids.join(','),
    thread.run_ids.join(','),
  ].join(':');
}

function buildThreadMessageAnnotations(
  threads: MessengerThread[],
  events: PersonaMessengerSnapshot['recent_thread_events'],
): Record<string, MessageThreadAnnotation> {
  const threadByID = new Map(threads.map((thread) => [thread.id, thread]));
  const annotations: Record<string, MessageThreadAnnotation> = {};

  for (const event of [...events].reverse()) {
    const messageID = event.message_id || '';
    const thread = threadByID.get(event.thread_id);
    if (!messageID || !thread) continue;
    const kind = threadAnnotationKind(event.event_type);
    if (!kind) continue;
    annotations[messageID] = {
      threadId: thread.id,
      kind,
      label: kind === 'created' ? '新线程' : '继续线程',
      title: thread.title || event.summary || '线程',
    };
  }

  return annotations;
}

function threadAnnotationKind(eventType: string): MessageThreadAnnotation['kind'] | '' {
  if (eventType === 'thread.created') return 'created';
  if (eventType === 'thread.continued') return 'continued';
  return '';
}

async function restoreMessagesForThreads(threads: MessengerThread[]): Promise<ConversationMessage[]> {
  const batches = await Promise.all(threads.map((thread, threadIndex) => restoreMessagesForThread(thread, threadIndex)));
  const byKey = new Map<string, RestoredThreadMessage>();
  for (const batch of batches) {
    for (const item of batch) {
      const existing = byKey.get(item.key);
      if (!existing || compareRestoredThreadMessages(item, existing) < 0) {
        byKey.set(item.key, item);
      }
    }
  }
  return [...byKey.values()]
    .sort(compareRestoredThreadMessages)
    .map((item) => item.message);
}

async function restoreMessagesForThread(thread: MessengerThread, threadIndex: number): Promise<RestoredThreadMessage[]> {
  const detail = await conversationDetailForThread(thread);
  if (!detail) {
    return fallbackThreadMessages(thread).map((message, messageIndex) => ({
      key: message.id,
      message,
      threadIndex,
      messageIndex,
    }));
  }

  const sourceMessageIDs = new Set(thread.source_message_ids.filter(Boolean));
  const runIDs = new Set(thread.run_ids.filter(Boolean));
  const messages = detail.messages.filter((message) => {
    const runID = getMessageRunId(message);
    return sourceMessageIDs.has(message.id) || Boolean(runID && runIDs.has(runID));
  });

  return messages.map((message, messageIndex) => ({
    key: message.id || `${thread.id}:${message.role}:${messageIndex}`,
    message,
    threadIndex,
    messageIndex,
  }));
}

async function conversationDetailForThread(thread: MessengerThread): Promise<ConversationDetail | null> {
  for (const messageID of thread.source_message_ids) {
    if (!messageID) continue;
    try {
      return await desktopApi.getConversationForMessage(messageID);
    } catch {
      // Threads can outlive individual source messages; try the next recorded anchor.
    }
  }
  return null;
}

function fallbackThreadMessages(thread: MessengerThread): ConversationMessage[] {
  if (!thread.title && !thread.goal && !thread.next_action) return [];
  const createdAt = thread.created_at || thread.updated_at;
  const updatedAt = thread.updated_at || thread.created_at;
  const conversationID = `thread:${thread.id}`;
  const messages: ConversationMessage[] = [];
  if (thread.title || thread.goal) {
    messages.push({
      id: `${thread.id}:thread-user`,
      conversation_id: conversationID,
      role: 'user',
      content: [thread.title, thread.goal].filter(Boolean).join('\n\n'),
      created_at: createdAt,
    });
  }
  if (thread.next_action) {
    messages.push({
      id: `${thread.id}:thread-assistant`,
      conversation_id: conversationID,
      role: 'assistant',
      content: thread.next_action,
      run_id: thread.run_ids.find(Boolean),
      created_at: updatedAt,
    });
  }
  return messages;
}

function compareRestoredThreadMessages(a: RestoredThreadMessage, b: RestoredThreadMessage): number {
  const timeA = a.message.created_at || '';
  const timeB = b.message.created_at || '';
  if (timeA !== timeB) return timeA.localeCompare(timeB);
  if (a.threadIndex !== b.threadIndex) return a.threadIndex - b.threadIndex;
  if (a.messageIndex !== b.messageIndex) return a.messageIndex - b.messageIndex;
  return a.key.localeCompare(b.key);
}

function firstThreadSourceMessageID(thread: MessengerThread): string {
  return thread.source_message_ids.find(Boolean) || '';
}

function messageAnchorSelector(messageID: string): string {
  return `[data-message-id="${messageID.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

function CompanionInspectorPanel({
  activeTab,
  activeRoom,
  activePersona,
  artifacts,
  conversationMessages,
  currentConversationID,
  currentRunIDs,
  decideProactiveMessage,
  messenger,
  memories,
  openLoops,
  onOpenModelSettings,
  proactiveMessages,
  rollbackPersonaVersion,
  exportCurrentMessengerData,
  retryExternalConnectorEvent,
  savedModels,
  setActiveTab,
  settings,
  onLocateThreadSource,
  onSelectThread,
  selectedThreadID,
  threadLocateStatus,
  trace,
  traceSpanAudit,
  openRunTrace,
  updateMemory,
  updateMessengerProject,
  updateMessengerRoom,
  updateProjectPersona,
  workspaceSettings,
}: {
  activeTab: RightInspectorTab;
  activeRoom: MessengerRoom | null;
  activePersona: ProjectPersona | null;
  artifacts: ArtifactSummary[];
  conversationMessages: ConversationMessage[];
  currentConversationID: string;
  currentRunIDs: string[];
  decideProactiveMessage: (id: string, action: string, feedback?: string) => Promise<void>;
  messenger: PersonaMessengerSnapshot | null;
  memories: MemoryRecord[];
  openLoops: OpenLoop[];
  onOpenModelSettings: () => void;
  proactiveMessages: ProactiveMessage[];
  rollbackPersonaVersion: (personaID: string, targetVersion: number) => Promise<void>;
  exportCurrentMessengerData: () => Promise<void>;
  retryExternalConnectorEvent: (eventID: string) => Promise<void>;
  savedModels: AvailableModel[];
  setActiveTab: (tab: RightInspectorTab) => void;
  settings: SettingsRecord | null;
  onLocateThreadSource: (thread: MessengerThread) => void;
  onSelectThread: (threadID: string) => void;
  selectedThreadID: string;
  threadLocateStatus: string;
  trace: RunTrace | null;
  traceSpanAudit: { spans: RunTraceSpan[]; summary: RunTraceSpanSummary };
  openRunTrace: (runID: string, destination?: 'panel' | 'stage') => Promise<void>;
  updateMemory: (id: string, action: string, extra?: Partial<MemoryRecord>) => Promise<void>;
  updateMessengerProject: (req: UpdateMessengerProjectRequest) => Promise<void>;
  updateMessengerRoom: (req: UpdateMessengerRoomRequest) => Promise<void>;
  updateProjectPersona: (req: UpdateProjectPersonaRequest) => Promise<void>;
  workspaceSettings: WorkspaceSettings | null;
}) {
  const [selectedMemberKey, setSelectedMemberKey] = useState<string | null>(null);
  const selectedMember = useMemo(() => {
    const members = activeRoom?.members ?? [];
    return members.find((member) => memberKey(member) === selectedMemberKey) ?? null;
  }, [activeRoom?.members, selectedMemberKey]);
  const selectedMemberPersona = selectedMember ? resolveMemberPersona(selectedMember, messenger, activePersona) : null;
  const effectiveTab: RightInspectorTab = activeTab === 'member' && !selectedMember ? 'overview' : activeTab;
  const staticTabs: Array<[RightInspectorTab, string]> = [
    ['overview', '概览'],
    ['runs', '运行'],
    ['threads', '线程'],
    ['assets', '文件'],
    ['memory', '记忆'],
  ];
  const memberTabLabel = selectedMember ? (selectedMemberPersona?.display_name || selectedMember.display_name || '成员') : '';
  const rightInspectorTabs: Array<[RightInspectorTab, string]> = selectedMember
    ? [...staticTabs, ['member', memberTabLabel]]
    : staticTabs;

  useEffect(() => {
    setSelectedMemberKey(null);
  }, [activeRoom?.id]);

  useEffect(() => {
    if (activeTab === 'member' && !selectedMember) {
      setActiveTab('overview');
    }
  }, [activeTab, selectedMember, setActiveTab]);

  function openMemberTab(member: MessengerRoomMember) {
    setSelectedMemberKey(memberKey(member));
    setActiveTab('member');
  }

  function closeMemberTab() {
    setSelectedMemberKey(null);
    if (activeTab === 'member') {
      setActiveTab('overview');
    }
  }

  return (
    <section className="right-inspector-shell tk-right-panel">
      <header className="right-inspector-header tk-panel-header">
        <div className="right-inspector-tabs tk-tabs-list" role="tablist" aria-label="右侧栏视图">
          {rightInspectorTabs.map(([tab, label]) => {
            const isTemporaryMemberTab = tab === 'member';
            const tabPanelID = isTemporaryMemberTab ? 'right-inspector-member-detail' : `right-inspector-${tab}`;
            const selected = effectiveTab === tab;
            return (
              <span
                key={tab}
                className={`right-inspector-tab-slot ${isTemporaryMemberTab ? 'right-inspector-tab-slot-temporary' : ''} ${selected ? 'active' : ''}`}
                role="presentation"
              >
                <button
                  id={`right-inspector-tab-${tab}`}
                  aria-controls={tabPanelID}
                  aria-selected={selected}
                  className={`tk-tab right-inspector-tab ${selected ? 'active' : ''}`}
                  role="tab"
                  title={label}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                >
                  <span>{label}</span>
                </button>
                {isTemporaryMemberTab ? (
                  <button
                    aria-label={`关闭${label}详情`}
                    className="right-inspector-tab-close"
                    title="关闭"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeMemberTab();
                    }}
                  >
                    <CloseTabIcon />
                  </button>
                ) : null}
              </span>
            );
          })}
        </div>
        <div className="right-inspector-header-drag-spacer" aria-hidden="true" />
      </header>
      {effectiveTab === 'member' && selectedMember ? (
        <MessengerMemberDetailPanel
          member={selectedMember}
          messenger={messenger}
          persona={selectedMemberPersona}
          rollbackPersonaVersion={rollbackPersonaVersion}
          retryExternalConnectorEvent={retryExternalConnectorEvent}
          room={activeRoom}
        />
      ) : effectiveTab === 'overview' ? (
        <MessengerOverviewPanel
          exportCurrentMessengerData={exportCurrentMessengerData}
          messenger={messenger}
          memories={memories}
          onOpenModelSettings={onOpenModelSettings}
          onSelectMember={openMemberTab}
          onSaveProject={updateMessengerProject}
          onSaveRoom={updateMessengerRoom}
          onSavePersona={updateProjectPersona}
          onOpenMemory={() => setActiveTab('memory')}
          room={activeRoom}
          savedModels={savedModels}
          settings={settings}
          workspaceSettings={workspaceSettings}
        />
      ) : effectiveTab === 'runs' ? (
        <MessengerRunsPanel
          messenger={messenger}
          openRunTrace={openRunTrace}
          trace={trace}
          traceSpanAudit={traceSpanAudit}
        />
      ) : effectiveTab === 'threads' ? (
        <MessengerThreadsPanel
          locateStatus={threadLocateStatus}
          messenger={messenger}
          onLocateThreadSource={onLocateThreadSource}
          onSelectThread={onSelectThread}
          openRunTrace={openRunTrace}
          room={activeRoom}
          selectedThreadID={selectedThreadID}
          trace={trace}
        />
      ) : effectiveTab === 'assets' ? (
        <MessengerAssetsPanel
          artifacts={artifacts}
          conversationID={currentConversationID}
          messages={conversationMessages}
          room={activeRoom}
          runIDs={currentRunIDs}
        />
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

function MessengerOverviewPanel({
  exportCurrentMessengerData,
  memories,
  messenger,
  onOpenMemory,
  onOpenModelSettings,
  onSelectMember,
  onSavePersona,
  onSaveProject,
  onSaveRoom,
  room,
  savedModels,
  settings,
  workspaceSettings,
}: {
  exportCurrentMessengerData: () => Promise<void>;
  memories: MemoryRecord[];
  messenger: PersonaMessengerSnapshot | null;
  onOpenMemory: () => void;
  onOpenModelSettings: () => void;
  onSelectMember: (member: MessengerRoomMember) => void;
  onSavePersona: (req: UpdateProjectPersonaRequest) => Promise<void>;
  onSaveProject: (req: UpdateMessengerProjectRequest) => Promise<void>;
  onSaveRoom: (req: UpdateMessengerRoomRequest) => Promise<void>;
  room: MessengerRoom | null;
  savedModels: AvailableModel[];
  settings: SettingsRecord | null;
  workspaceSettings: WorkspaceSettings | null;
}) {
  const members = room?.members ?? [];
  const activePersona = room?.persona_id
    ? messenger?.personas.find((persona) => persona.id === room.persona_id) ?? null
    : null;
  const activeProject = activePersona?.project_id
    ? messenger?.projects.find((project) => project.id === activePersona.project_id) ?? null
    : room?.project_id
      ? messenger?.projects.find((project) => project.id === room.project_id) ?? null
      : null;
  const currentAvatarValue = roomAvatarValue(room);
  const [roomTitleDraft, setRoomTitleDraft] = useState(room?.title ?? '');
  const [roomAvatarDraft, setRoomAvatarDraft] = useState(currentAvatarValue);
  const [roomTitleEditing, setRoomTitleEditing] = useState(false);
  const [savingRoom, setSavingRoom] = useState(false);
  const titleControlRef = useRef<HTMLSpanElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const normalizedTitleDraft = roomTitleDraft.trim();
  const normalizedAvatarDraft = roomAvatarDraft.trim();
  const avatarPreviewRoom = room ? {
    ...room,
    title: normalizedTitleDraft || room.title,
    avatar: normalizedAvatarDraft,
    metadata: {
      ...(room.metadata ?? {}),
      avatar: normalizedAvatarDraft,
    },
  } : null;

  useEffect(() => {
    setRoomTitleDraft(room?.title ?? '');
    setRoomAvatarDraft(roomAvatarValue(room));
    setRoomTitleEditing(false);
  }, [room?.id, room?.title, room?.avatar, room?.metadata]);

  function startRoomTitleEdit() {
    if (!room || savingRoom) return;
    setRoomTitleEditing(true);
    window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }

  async function saveRoomProfile(next: { title?: string; avatar?: string }) {
    if (!room) return;
    const title = next.title ?? normalizedTitleDraft;
    const avatar = next.avatar ?? normalizedAvatarDraft;
    if (!title.trim()) {
      setRoomTitleDraft(room.title);
      setRoomTitleEditing(false);
      return;
    }
    if (title.trim() === (room.title ?? '').trim() && avatar.trim() === currentAvatarValue) {
      setRoomTitleEditing(false);
      return;
    }
    setSavingRoom(true);
    try {
      await onSaveRoom({
        room_id: room.id,
        title: title.trim(),
        avatar: avatar.trim(),
      });
      setRoomTitleDraft(title.trim());
      setRoomAvatarDraft(avatar.trim());
      setRoomTitleEditing(false);
    } finally {
      setSavingRoom(false);
    }
  }

  async function saveRoomTitleOnBlur() {
    if (!roomTitleEditing) return;
    await saveRoomProfile({ title: normalizedTitleDraft });
  }

  function handleRoomTitleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      titleInputRef.current?.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setRoomTitleDraft(room?.title ?? '');
      setRoomTitleEditing(false);
      titleInputRef.current?.blur();
    }
  }

  async function handleRoomAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!room || !file || !file.type.startsWith('image/')) return;
    setSavingRoom(true);
    try {
      const dataURL = await readFileAsDataURL(file);
      setRoomAvatarDraft(dataURL);
      await saveRoomProfile({ title: normalizedTitleDraft || room.title, avatar: dataURL });
    } finally {
      setSavingRoom(false);
    }
  }

  useEffect(() => {
    if (!roomTitleEditing) return;

    function saveOnOutsidePointerDown(event: globalThis.PointerEvent) {
      const target = event.target;
      if (target instanceof Node && titleControlRef.current?.contains(target)) return;
      void saveRoomProfile({ title: normalizedTitleDraft });
    }

    window.addEventListener('pointerdown', saveOnOutsidePointerDown, true);
    return () => window.removeEventListener('pointerdown', saveOnOutsidePointerDown, true);
  }, [normalizedTitleDraft, roomTitleEditing]);

  if (room?.type === 'project_dm' && activePersona) {
    return (
      <PrivateProjectOverviewPanel
        exportCurrentMessengerData={exportCurrentMessengerData}
        memories={memories}
        onOpenModelSettings={onOpenModelSettings}
        onOpenMemory={onOpenMemory}
        onSavePersona={onSavePersona}
        onSaveProject={onSaveProject}
        persona={activePersona}
        project={activeProject}
        room={room}
        savedModels={savedModels}
        settings={settings}
        workspaceSettings={workspaceSettings}
      />
    );
  }

  return (
    <section
      id="right-inspector-overview"
      className="right-panel-section messenger-overview-panel"
      role="tabpanel"
      aria-labelledby="right-inspector-tab-overview"
    >
      <header>
        <small>对话概览</small>
        <h2>{room?.title || '当前聊天'}</h2>
      </header>
      <div className="overview-room-editor">
        <button
          aria-label="上传群头像"
          className="overview-room-avatar-preview"
          disabled={!room || savingRoom}
          title="上传群头像"
          type="button"
          onClick={() => avatarInputRef.current?.click()}
        >
          {avatarPreviewRoom ? <RoomAvatar room={avatarPreviewRoom} personas={messenger?.personas ?? []} /> : <span className="room-avatar">J</span>}
        </button>
        <input
          ref={avatarInputRef}
          className="visually-hidden"
          type="file"
          accept="image/*"
          onChange={(event) => void handleRoomAvatarUpload(event)}
        />
        <div className="overview-room-fields">
          <label className={`overview-room-title-field ${roomTitleEditing ? 'editing' : ''}`}>
            <span>群名</span>
            <span ref={titleControlRef} className="overview-room-title-control">
            <input
              ref={titleInputRef}
              disabled={!room}
              readOnly={!roomTitleEditing}
              type="text"
              value={roomTitleDraft}
              onChange={(event) => setRoomTitleDraft(event.target.value)}
              onBlur={() => void saveRoomTitleOnBlur()}
              onKeyDown={handleRoomTitleKeyDown}
            />
            <button
              aria-label="编辑群名"
              className="overview-room-edit-button"
              disabled={!room || savingRoom}
              title="编辑群名"
              type="button"
              onClick={startRoomTitleEdit}
            >
              <EditIcon />
            </button>
            </span>
          </label>
        </div>
      </div>
      {members.length > 0 ? (
        <section className="overview-member-section">
          <h3>已加入成员（{members.length}）</h3>
          <div className="member-list overview-member-list">
            {members.map((member) => {
              const persona = resolveMemberPersona(member, messenger, null);
              return (
                <button key={memberKey(member)} className="member-row member-row-button member-profile-row" type="button" onClick={() => onSelectMember(member)}>
                  <MemberProfileSummary member={member} persona={persona} room={room} />
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
      <div className="messenger-overview-actions">
        <button type="button" onClick={() => void exportCurrentMessengerData()}>
          导出数据
        </button>
      </div>
    </section>
  );
}

function PrivateProjectOverviewPanel({
  exportCurrentMessengerData,
  memories,
  onOpenModelSettings,
  onOpenMemory,
  onSavePersona,
  onSaveProject,
  persona,
  project,
  room,
  savedModels,
  settings,
  workspaceSettings,
}: {
  exportCurrentMessengerData: () => Promise<void>;
  memories: MemoryRecord[];
  onOpenModelSettings: () => void;
  onOpenMemory: () => void;
  onSavePersona: (req: UpdateProjectPersonaRequest) => Promise<void>;
  onSaveProject: (req: UpdateMessengerProjectRequest) => Promise<void>;
  persona: ProjectPersona;
  project: PersonaMessengerSnapshot['projects'][number] | null;
  room: MessengerRoom;
  savedModels: AvailableModel[];
  settings: SettingsRecord | null;
  workspaceSettings: WorkspaceSettings | null;
}) {
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const modelOptions = useMemo(() => connectedModelOptions(savedModels, settings), [savedModels, settings]);
  const modelOptionIds = useMemo(() => modelOptions.map((model) => model.id).join('|'), [modelOptions]);
  const defaultModelID = settings?.model_name || modelOptions[0]?.id || '';
  const currentProjectName = project?.name || '';
  const currentProjectLocalPath = projectLocalPathValue(project);
  const localPathPlaceholder = workspaceSettings?.default_root || '/Users/hao/project/...';
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    display_name: persona.display_name,
    avatar: persona.avatar || '',
    tagline: persona.tagline || '',
    self_intro: persona.self_intro || '',
    project_name: currentProjectName,
    project_local_path: currentProjectLocalPath,
    permission_summary: persona.permission_summary || '',
    model_strategy: normalizePersonaModelSelection(persona.model_strategy, modelOptions, defaultModelID),
  });
  const scopedMemories = useMemo(
    () => memoriesForPrivateProject(memories, persona, project),
    [memories, persona, project],
  );

  useEffect(() => {
    setDraft({
      display_name: persona.display_name,
      avatar: persona.avatar || '',
      tagline: persona.tagline || '',
      self_intro: persona.self_intro || '',
      project_name: project?.name || '',
      project_local_path: projectLocalPathValue(project),
      permission_summary: persona.permission_summary || '',
      model_strategy: normalizePersonaModelSelection(persona.model_strategy, modelOptions, defaultModelID),
    });
  }, [
    defaultModelID,
    modelOptionIds,
    persona.id,
    persona.version,
    persona.display_name,
    persona.avatar,
    persona.tagline,
    persona.self_intro,
    persona.permission_summary,
    persona.model_strategy,
    project?.id,
    project?.name,
    project?.metadata,
  ]);

  function updateDraft(field: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function savePrivateProjectProfile(next: Partial<typeof draft> = {}) {
    const merged = { ...draft, ...next };
    const displayName = merged.display_name.trim();
    const projectName = merged.project_name.trim();
    if (!displayName) return;
    setSaving(true);
    try {
      const nextPersona = {
        display_name: displayName,
        avatar: merged.avatar.trim(),
        tagline: merged.tagline.trim(),
        self_intro: merged.self_intro.trim(),
        permission_summary: merged.permission_summary.trim(),
        model_strategy: merged.model_strategy.trim(),
      };
      const currentPersonaModel = normalizePersonaModelSelection(persona.model_strategy, modelOptions, defaultModelID);
      const personaChanged = nextPersona.display_name !== persona.display_name
        || nextPersona.avatar !== (persona.avatar || '')
        || nextPersona.tagline !== (persona.tagline || '')
        || nextPersona.self_intro !== (persona.self_intro || '')
        || nextPersona.permission_summary !== (persona.permission_summary || '')
        || nextPersona.model_strategy !== currentPersonaModel;
      if (personaChanged) {
        await onSavePersona({
          persona_id: persona.id,
          base_version: persona.version,
          actor_id: 'desktop_user',
          actor_role: 'project_owner',
          room_id: room.id,
          ...nextPersona,
          change_reason: 'Update private project profile',
        });
      }
      const projectChanged = Boolean(project)
        && (projectName !== currentProjectName || merged.project_local_path.trim() !== currentProjectLocalPath);
      if (project && projectChanged) {
        await onSaveProject({
          project_id: project.id,
          name: projectName || currentProjectName,
          local_path: merged.project_local_path.trim(),
          actor_id: 'desktop_user',
        });
      }
      setDraft(merged);
    } finally {
      setSaving(false);
    }
  }

  async function handlePersonaAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    setSaving(true);
    try {
      const dataURL = await readFileAsDataURL(file);
      updateDraft('avatar', dataURL);
      await savePrivateProjectProfile({ avatar: dataURL });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      id="right-inspector-overview"
      className="right-panel-section private-project-overview-panel"
      role="tabpanel"
      aria-labelledby="right-inspector-tab-overview"
    >
      <header className="private-project-overview-header">
        <button
          aria-label="上传头像"
          className="private-project-avatar-button private-project-header-avatar-button"
          disabled={saving}
          title="上传头像"
          type="button"
          onClick={() => avatarInputRef.current?.click()}
        >
          <span className="room-avatar room-avatar-project_dm">
            {draft.avatar && isImageAvatar(draft.avatar)
              ? <img src={draft.avatar} alt="" />
              : (draft.display_name || persona.display_name || 'J').slice(0, 2)}
          </span>
        </button>
        <div className="private-project-overview-heading">
          <small>私聊</small>
          <h2>{persona.display_name}</h2>
        </div>
      </header>
      <input
        ref={avatarInputRef}
        className="visually-hidden private-project-avatar-input"
        type="file"
        accept="image/*"
        onChange={(event) => void handlePersonaAvatarUpload(event)}
      />
      <form className="private-project-editor" onSubmit={(event) => {
        event.preventDefault();
        void savePrivateProjectProfile();
      }}>
        <label className="private-project-field private-project-name-field">
          <span>名称</span>
          <input
            disabled={saving}
            value={draft.display_name}
            onChange={(event) => updateDraft('display_name', event.target.value)}
          />
        </label>
        <section className="private-project-section private-project-association" aria-label="项目关联">
          <div className="private-project-section-heading">
            <span>项目关联</span>
            <small>{project ? '已关联' : '未关联'}</small>
          </div>
          <label className="private-project-field">
            <span>项目名</span>
            <input
              disabled={saving || !project}
              placeholder="项目名称"
              value={draft.project_name}
              onChange={(event) => updateDraft('project_name', event.target.value)}
            />
          </label>
          <label className="private-project-field">
            <span>本地路径</span>
            <input
              disabled={saving || !project}
              placeholder={localPathPlaceholder}
              value={draft.project_local_path}
              onChange={(event) => updateDraft('project_local_path', event.target.value)}
            />
          </label>
        </section>
        <label className="private-project-field">
          <span>描述</span>
          <textarea
            disabled={saving}
            rows={3}
            value={draft.tagline}
            onChange={(event) => updateDraft('tagline', event.target.value)}
          />
        </label>
        <label className="private-project-field">
          <span>自述</span>
          <textarea
            disabled={saving}
            rows={4}
            value={draft.self_intro}
            onChange={(event) => updateDraft('self_intro', event.target.value)}
          />
        </label>
        <div className="inspector-metric-grid private-project-metrics">
          <KV label="状态" value={formatStatus(persona.status)} />
          <KV label="记忆" value={`${scopedMemories.length} 条`} />
        </div>
        <label className="private-project-field">
          <span>规则</span>
          <textarea
            disabled={saving}
            rows={3}
            value={draft.permission_summary}
            onChange={(event) => updateDraft('permission_summary', event.target.value)}
          />
        </label>
        <label className="private-project-field">
          <span>模型</span>
          <div className="private-project-model-row">
            <select
              disabled={saving || modelOptions.length === 0}
              value={draft.model_strategy}
              onChange={(event) => updateDraft('model_strategy', event.target.value)}
            >
              {modelOptions.length === 0 ? (
                <option value="">未接入模型</option>
              ) : modelOptions.map((model) => (
                <option key={modelOptionKey(model)} value={model.id}>
                  {modelOptionLabel(model)}
                </option>
              ))}
            </select>
            <button type="button" onClick={onOpenModelSettings}>设置</button>
          </div>
          <small>接入、密钥和模型列表在设置中维护。</small>
        </label>
        <div className="messenger-overview-actions">
          <button type="submit" disabled={saving}>{saving ? '保存中' : '保存'}</button>
          <button type="button" onClick={onOpenMemory}>记忆</button>
          <button type="button" onClick={() => void exportCurrentMessengerData()}>
            导出数据
          </button>
        </div>
      </form>
    </section>
  );
}

function TodayCheckpointPanel({
  busy,
  checkpoint,
  onClose,
  onComplete,
}: {
  busy: boolean;
  checkpoint: PersonaMessengerSnapshot['checkpoint'] | null;
  onClose: () => void;
  onComplete: () => void;
}) {
  const items = checkpoint?.items ?? [];
  const meaningfulItems = items.filter((item) => item.kind !== 'quiet');
  const itemCount = meaningfulItems.length;
  const sinceLabel = checkpoint?.since ? formatShortTime(checkpoint.since) : '最近 24 小时';
  return (
    <div className="today-checkpoint-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="今日检查"
        className="today-checkpoint-panel"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="today-checkpoint-header">
          <div>
            <small>今日概览</small>
            <h2>今日检查</h2>
            <p>自 {sinceLabel} 后有 {itemCount} 项需要看一眼</p>
          </div>
          <button className="round-icon-button" type="button" aria-label="关闭今日检查" title="关闭" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="today-checkpoint-metrics">
          <KV label="完成" value={String(checkpoint?.completed_count ?? 0)} />
          <KV label="失败" value={String(checkpoint?.failed_count ?? 0)} />
          <KV label="待审批" value={String(checkpoint?.pending_approval_count ?? 0)} />
          <KV label="无进展" value={String(checkpoint?.no_progress_project_count ?? 0)} />
          <KV label="新产物" value={String(checkpoint?.new_artifact_count ?? 0)} />
          <KV label="外部" value={String(checkpoint?.external_unhandled_count ?? 0)} />
          <KV label="成本" value={formatCost(checkpoint?.model_cost_estimate ?? 0)} />
        </div>
        <div className="today-checkpoint-list">
          {items.map((item) => (
            <article key={item.id} className={`today-checkpoint-item checkpoint-${classToken(item.severity || item.kind)}`}>
              <span className="today-checkpoint-mark">{checkpointItemMark(item.severity || item.kind)}</span>
              <div>
                <strong>{item.title}</strong>
                {item.body ? <p>{item.body}</p> : null}
              </div>
            </article>
          ))}
        </div>
        <footer className="today-checkpoint-actions">
          <button type="button" onClick={onClose}>稍后</button>
          <button type="button" disabled={busy} onClick={onComplete}>
            {busy ? '写入中...' : '全部已读'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function checkpointItemMark(kind: string) {
  if (kind === 'success' || kind.includes('completed')) return '✓';
  if (kind === 'error' || kind.includes('failed')) return '!';
  if (kind === 'warning' || kind.includes('approval') || kind.includes('external')) return '●';
  return '○';
}

function summarizeTraceSpansForDisplay(spans: RunTraceSpan[]): RunTraceSpanSummary {
  return spans.reduce<RunTraceSpanSummary>((summary, span) => {
    summary.total += 1;
    if (span.span_type === 'model_span') summary.model_count += 1;
    if (span.span_type === 'tool_span') summary.tool_count += 1;
    if (span.has_error) summary.error_count += 1;
    if (span.has_external_side_effect) summary.external_side_effect_count += 1;
    summary.total_tokens += Number(span.total_tokens ?? 0);
    summary.total_cost_estimate += Number(span.cost_estimate ?? 0);
    return summary;
  }, {
    total: 0,
    model_count: 0,
    tool_count: 0,
    error_count: 0,
    external_side_effect_count: 0,
    total_tokens: 0,
    total_cost_estimate: 0,
  });
}

function formatSpanTypeLabel(type: string) {
  if (type === 'model_span') return '模型调用';
  if (type === 'tool_span') return '能力调用';
  if (type === 'run_event') return '运行步骤';
  return '运行记录';
}

function MessengerRunsPanel({
  messenger,
  openRunTrace,
  trace,
  traceSpanAudit,
}: {
  messenger: PersonaMessengerSnapshot | null;
  openRunTrace: (runID: string, destination?: 'panel' | 'stage') => Promise<void>;
  trace: RunTrace | null;
  traceSpanAudit: { spans: RunTraceSpan[]; summary: RunTraceSpanSummary };
}) {
  const [roomFilter, setRoomFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [personaFilter, setPersonaFilter] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [spanTypeFilter, setSpanTypeFilter] = useState('');
  const [errorOnly, setErrorOnly] = useState(false);
  const [sideEffectOnly, setSideEffectOnly] = useState(false);
  const modelOptions = useMemo(() => Array.from(new Set(traceSpanAudit.spans.map((span) => span.model_name).filter(Boolean) as string[])).sort(), [traceSpanAudit.spans]);
  const statusOptions = useMemo(() => Array.from(new Set(traceSpanAudit.spans.map((span) => span.status).filter(Boolean))).sort(), [traceSpanAudit.spans]);
  const filteredSpans = useMemo(() => traceSpanAudit.spans.filter((span) => (
    (!roomFilter || span.room_id === roomFilter)
    && (!projectFilter || span.project_id === projectFilter)
    && (!personaFilter || span.persona_id === personaFilter)
    && (!modelFilter || span.model_name === modelFilter)
    && (!statusFilter || span.status === statusFilter)
    && (!spanTypeFilter || span.span_type === spanTypeFilter)
    && (!errorOnly || span.has_error)
    && (!sideEffectOnly || span.has_external_side_effect)
  )), [errorOnly, modelFilter, personaFilter, projectFilter, roomFilter, sideEffectOnly, spanTypeFilter, statusFilter, traceSpanAudit.spans]);
  const filteredSummary = useMemo(() => summarizeTraceSpansForDisplay(filteredSpans), [filteredSpans]);
  return (
    <section
      id="right-inspector-runs"
      className="right-panel-section messenger-runs-panel"
      role="tabpanel"
      aria-labelledby="right-inspector-tab-runs"
    >
      <header>
        <small>处理过程</small>
        <h2>运行</h2>
      </header>
      {trace ? (
        <>
          <div className="inspector-metric-grid">
            <KV label="状态" value={formatStatus(trace.status)} />
            <KV label="模型调用" value={String(trace.model_calls?.length ?? 0)} />
            <KV label="步骤" value={String(trace.steps?.length ?? 0)} />
          </div>
          <TraceDrawer events={sortBySeq(normalizeTraceEvents(trace))} />
        </>
      ) : <p className="empty">当前对话还没有运行记录。</p>}
      <section className="run-audit-panel">
        <header>
          <small>运行明细</small>
          <h3>活动与用量</h3>
        </header>
        <div className="inspector-metric-grid">
          <KV label="记录" value={String(filteredSummary.total)} />
          <KV label="模型" value={String(filteredSummary.model_count)} />
          <KV label="能力" value={String(filteredSummary.tool_count)} />
          <KV label="错误" value={String(filteredSummary.error_count)} />
          <KV label="令牌" value={formatTokenCount(filteredSummary.total_tokens)} />
          <KV label="成本" value={formatCost(filteredSummary.total_cost_estimate)} />
        </div>
        <div className="run-audit-filters">
          <label>
            <span>对话</span>
            <select value={roomFilter} onChange={(event) => setRoomFilter(event.target.value)}>
              <option value="">全部</option>
              {(messenger?.rooms ?? []).map((room) => <option key={room.id} value={room.id}>{room.title}</option>)}
            </select>
          </label>
          <label>
            <span>项目</span>
            <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
              <option value="">全部</option>
              {(messenger?.projects ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label>
            <span>项目人格</span>
            <select value={personaFilter} onChange={(event) => setPersonaFilter(event.target.value)}>
              <option value="">全部</option>
              {(messenger?.personas ?? []).map((persona) => <option key={persona.id} value={persona.id}>{persona.display_name}</option>)}
            </select>
          </label>
          <label>
            <span>模型</span>
            <select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)}>
              <option value="">全部</option>
              {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>
          <label>
            <span>状态</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">全部</option>
              {statusOptions.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}
            </select>
          </label>
          <label>
            <span>类型</span>
            <select value={spanTypeFilter} onChange={(event) => setSpanTypeFilter(event.target.value)}>
              <option value="">全部</option>
              <option value="model_span">模型调用</option>
              <option value="tool_span">能力调用</option>
              <option value="run_event">运行步骤</option>
            </select>
          </label>
          <button className={errorOnly ? 'active' : ''} type="button" onClick={() => setErrorOnly((value) => !value)}>只看错误</button>
          <button className={sideEffectOnly ? 'active' : ''} type="button" onClick={() => setSideEffectOnly((value) => !value)}>外部副作用</button>
        </div>
        <div className="run-audit-list">
          {filteredSpans.slice(0, 80).map((span) => (
            <article key={span.id} className={`run-audit-row ${span.has_error ? 'has-error' : ''}`}>
              <div>
                <strong>{userFacingSpanTitle(span)}</strong>
                <small>
                  {formatSpanTypeLabel(span.span_type)} · {formatStatus(span.status)}
                  {span.model_name ? ` · ${span.model_provider || 'model'} / ${span.model_name}` : ''}
                  {span.tool_name ? ` · ${capabilityDisplayName(span.tool_name)}` : ''}
                </small>
                <small>
                  {span.persona_name || '未指定项目人格'}
                  {span.project_name ? ` · ${span.project_name}` : ''}
                  {span.room_title ? ` · ${span.room_title}` : ''}
                </small>
                {span.error ? <p>本步骤遇到问题，可在“支持”中导出诊断包继续排查。</p> : null}
              </div>
              <div className="run-audit-meta">
                <time>{formatShortTime(span.created_at)}</time>
                <span>{formatTokenCount(span.total_tokens ?? 0)}</span>
                <span>{formatCost(span.cost_estimate ?? 0)}</span>
                <button type="button" onClick={() => void openRunTrace(span.run_id, 'panel')}>查看详情</button>
              </div>
            </article>
          ))}
          {filteredSpans.length === 0 ? <p className="empty">没有匹配当前筛选条件的运行记录。</p> : null}
        </div>
      </section>
    </section>
  );
}

function MessengerThreadsPanel({
  locateStatus,
  messenger,
  onLocateThreadSource,
  onSelectThread,
  openRunTrace,
  room,
  selectedThreadID,
  trace,
}: {
  locateStatus: string;
  messenger: PersonaMessengerSnapshot | null;
  onLocateThreadSource: (thread: MessengerThread) => void;
  onSelectThread: (threadID: string) => void;
  openRunTrace: (runID: string, destination?: 'panel' | 'stage') => Promise<void>;
  room: MessengerRoom | null;
  selectedThreadID: string;
  trace: RunTrace | null;
}) {
  const threadAction = trace?.route_result && typeof trace.route_result === 'object'
    ? trace.route_result
    : {};
  const visibleThreads = visibleMessengerThreads(messenger, room);
  const visibleThreadIDs = visibleThreads.map((thread) => thread.id).join('|');
  const selectedThread = visibleThreads.find((thread) => thread.id === selectedThreadID) ?? null;
  const eventsByThread = new Map<string, PersonaMessengerSnapshot['recent_thread_events']>();
  for (const event of messenger?.recent_thread_events ?? []) {
    eventsByThread.set(event.thread_id, [...(eventsByThread.get(event.thread_id) ?? []), event]);
  }

  useEffect(() => {
    if (selectedThreadID && !visibleThreads.some((thread) => thread.id === selectedThreadID)) {
      onSelectThread('');
    }
  }, [onSelectThread, selectedThreadID, visibleThreadIDs]);

  if (selectedThread) {
    const events = eventsByThread.get(selectedThread.id) ?? [];
    const sourceMessageID = firstThreadSourceMessageID(selectedThread);
    return (
      <section
        id="right-inspector-threads"
        className="right-panel-section messenger-thread-panel messenger-thread-detail"
        role="tabpanel"
        aria-labelledby="right-inspector-tab-threads"
      >
        <header className="thread-detail-header">
          <button className="thread-detail-back" type="button" onClick={() => onSelectThread('')}>返回线程列表</button>
          <div>
            <small>线程详情</small>
            <h2>{displayThreadTitle(selectedThread.title)}</h2>
          </div>
        </header>
        <p>{selectedThread.goal || '这条线程汇总同一段聊天、运行和交付物。'}</p>
        <div className="thread-detail-actions">
          <button
            type="button"
            disabled={!sourceMessageID}
            onClick={() => onLocateThreadSource(selectedThread)}
          >
            回到聊天位置
          </button>
          <span>{sourceMessageID ? locateStatus || '已关联原聊天位置' : '此线程尚未关联原聊天位置'}</span>
        </div>
        <div className="inspector-metric-grid">
          <KV label="状态" value={formatStatus(selectedThread.status)} />
          <KV label="优先级" value={formatThreadPriority(selectedThread.priority)} />
          <KV label="消息" value={String(selectedThread.message_count || selectedThread.source_message_ids.length)} />
          <KV label="运行" value={String(selectedThread.run_count || selectedThread.run_ids.length)} />
          <KV label="产物" value={String(selectedThread.artifact_count || selectedThread.artifact_ids.length)} />
          <KV label="最近运行" value={formatStatus(selectedThread.latest_run_status || 'none')} />
        </div>
        {selectedThread.next_action ? <p className="thread-next-action">{selectedThread.next_action}</p> : null}
        <section className="thread-detail-section">
          <h3>原聊天锚点</h3>
          <div className="thread-source-list">
            {selectedThread.source_message_ids.length === 0 ? <small>暂无聊天来源。</small> : selectedThread.source_message_ids.map((messageID, index) => (
              <button key={messageID} type="button" onClick={() => onLocateThreadSource({ ...selectedThread, source_message_ids: [messageID] })}>
                聊天位置 {index + 1}
              </button>
            ))}
          </div>
        </section>
        <section className="thread-detail-section">
          <h3>运行记录</h3>
          <div className="thread-source-list">
            {selectedThread.run_ids.length === 0 ? <small>暂无运行记录。</small> : selectedThread.run_ids.map((runID, index) => (
              <button key={runID} type="button" onClick={() => void openRunTrace(runID, 'panel')}>
                运行 {index + 1}
              </button>
            ))}
          </div>
        </section>
        <section className="thread-detail-section">
          <h3>事件</h3>
          {events.length === 0 ? <p className="empty">暂无线程事件。</p> : (
            <div className="thread-event-list">
              {events.slice(0, 12).map((event) => (
                <small key={event.id}>
                  {threadEventLabel(event.event_type)}
                </small>
              ))}
            </div>
          )}
        </section>
      </section>
    );
  }

  return (
    <section
      id="right-inspector-threads"
      className="right-panel-section messenger-thread-panel"
      role="tabpanel"
      aria-labelledby="right-inspector-tab-threads"
    >
      <header>
        <small>工作脉络</small>
        <h2>线程</h2>
      </header>
      <article className="thread-observer-card">
        <strong>{room?.subtitle || room?.title || '当前对话'}</strong>
        <p>这里按消息、运行和交付物整理持续工作的脉络。</p>
      </article>
      <div className="thread-observer-list">
        {visibleThreads.length === 0 ? <p className="empty">当前房间还没有项目线程。</p> : visibleThreads.map((thread) => {
          const events = (eventsByThread.get(thread.id) ?? []).slice(0, 3);
          return (
            <article key={thread.id} className={`thread-observer-card thread-status-${classToken(thread.status)}`}>
              <div className="thread-observer-row">
                <div>
                  <button className="thread-title-button" type="button" onClick={() => onSelectThread(thread.id)}>
                    <strong>{displayThreadTitle(thread.title)}</strong>
                  </button>
                  <small>{thread.project_name || '当前对话'} · {formatStatus(thread.status)}</small>
                </div>
                <span>{formatThreadPriority(thread.priority)}</span>
              </div>
              {thread.goal ? <p>{compactRoomLastMessage(thread.goal)}</p> : null}
              <div className="inspector-metric-grid">
                <KV label="消息" value={String(thread.message_count || thread.source_message_ids.length)} />
                <KV label="运行" value={String(thread.run_count || thread.run_ids.length)} />
                <KV label="产物" value={String(thread.artifact_count || thread.artifact_ids.length)} />
                <KV label="最近运行" value={formatStatus(thread.latest_run_status || 'none')} />
              </div>
              {thread.next_action ? <small>{thread.next_action}</small> : null}
              <div className="thread-card-actions">
                <button type="button" onClick={() => onSelectThread(thread.id)}>查看线程</button>
                <button type="button" disabled={!firstThreadSourceMessageID(thread)} onClick={() => onLocateThreadSource(thread)}>定位原聊天</button>
              </div>
              {events.length ? (
                <div className="thread-event-list">
                  {events.map((event) => (
                    <small key={event.id}>
                      {threadEventLabel(event.event_type)}
                    </small>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

type ConversationAssetItem = {
  id: string;
  title: string;
  source: 'uploaded' | 'generated';
  detail: string;
  previewUrl?: string;
  createdAt?: string;
};

function MessengerAssetsPanel({
  artifacts,
  conversationID,
  messages,
  room,
  runIDs,
}: {
  artifacts: ArtifactSummary[];
  conversationID: string;
  messages: ConversationMessage[];
  room: MessengerRoom | null;
  runIDs: string[];
}) {
  const visible = useMemo(
    () => currentConversationAssets({ artifacts, conversationID, messages, runIDs }).slice(0, 24),
    [artifacts, conversationID, messages, runIDs],
  );
  return (
    <section
      id="right-inspector-assets"
      className="right-panel-section messenger-assets-panel"
      role="tabpanel"
      aria-labelledby="right-inspector-tab-assets"
    >
      <header>
        <small>会话内容</small>
        <h2>文件与交付物</h2>
      </header>
      {visible.length === 0 ? <p className="empty">{room?.title || '当前会话'} 暂无上传或生成资产。</p> : (
        <div className="asset-mini-list">
          {visible.map((asset) => (
            <article key={asset.id} className={`asset-mini-row asset-source-${asset.source}${asset.previewUrl ? ' has-preview' : ''}`}>
              {asset.previewUrl ? <img className="asset-mini-preview" src={asset.previewUrl} alt="" /> : null}
              <div>
                <strong>{asset.title}</strong>
                <small>{asset.detail}</small>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function currentConversationAssets({
  artifacts,
  conversationID,
  messages,
  runIDs,
}: {
  artifacts: ArtifactSummary[];
  conversationID: string;
  messages: ConversationMessage[];
  runIDs: string[];
}): ConversationAssetItem[] {
  const messageIDs = new Set(messages.map((message) => message.id).filter(Boolean));
  const runIDSet = new Set(runIDs.filter(Boolean));
  for (const message of messages) {
    const runID = getMessageRunId(message);
    if (runID) runIDSet.add(runID);
  }

  const uploads = messages.flatMap((message) => attachmentAssetsForMessage(message));
  const generated = artifacts
    .filter((artifact) => artifactBelongsToCurrentConversation(artifact, conversationID, messageIDs, runIDSet))
    .map((artifact): ConversationAssetItem => ({
      id: `generated:${artifact.id}`,
      title: artifact.title,
      source: 'generated',
      detail: `生成 · ${formatArtifactType(artifact.type)}`,
      createdAt: artifact.updated_at || artifact.created_at,
    }));

  return [...uploads, ...generated].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function attachmentAssetsForMessage(message: ConversationMessage): ConversationAssetItem[] {
  if (!Array.isArray(message.attachments)) return [];
  return message.attachments.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const name = assetString(raw.name) || assetString(raw.filename) || `附件 ${index + 1}`;
    const mimeType = assetString(raw.mimeType) || assetString(raw.mime_type) || assetString(raw.type);
    const rawKind = assetString(raw.kind);
    const kind = rawKind || (mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : 'file');
    const size = assetNumber(raw.size);
    return [{
      id: `uploaded:${message.id}:${assetString(raw.id) || index}`,
      title: name,
      source: 'uploaded' as const,
      detail: `上传 · ${assetKindLabel(kind)}${size ? ` · ${formatAttachmentSize(size)}` : ''}`,
      previewUrl: assetString(raw.previewUrl) || assetString(raw.preview_url) || assetString(raw.url),
      createdAt: message.created_at,
    }];
  });
}

function artifactBelongsToCurrentConversation(
  artifact: ArtifactSummary,
  conversationID: string,
  messageIDs: Set<string>,
  runIDs: Set<string>,
): boolean {
  if (artifact.source_conversation_id && conversationID && artifact.source_conversation_id === conversationID) return true;
  if (artifact.source_message_id && messageIDs.has(artifact.source_message_id)) return true;
  if (artifact.source_run_id && runIDs.has(artifact.source_run_id)) return true;
  return false;
}

function assetKindLabel(kind: string): string {
  if (kind === 'image') return '图片';
  if (kind === 'video') return '视频';
  return '文件';
}

function assetString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function assetNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(number) ? number : 0;
}

function MessengerMemberDetailPanel({
  member,
  messenger,
  persona,
  rollbackPersonaVersion,
  retryExternalConnectorEvent,
  room,
}: {
  member: MessengerRoomMember;
  messenger: PersonaMessengerSnapshot | null;
  persona: ProjectPersona | null;
  rollbackPersonaVersion: (personaID: string, targetVersion: number) => Promise<void>;
  retryExternalConnectorEvent: (eventID: string) => Promise<void>;
  room: MessengerRoom | null;
}) {
  const project = persona
    ? messenger?.projects.find((item) => item.id === persona.project_id)
    : member.project_id
      ? messenger?.projects.find((item) => item.id === member.project_id)
      : null;
  const versions = persona
    ? (messenger?.persona_versions ?? []).filter((version) => version.persona_id === persona.id).sort((a, b) => b.version - a.version)
    : [];
  const roomConnectors = room ? (messenger?.room_connectors ?? []).filter((connector) => connector.room_id === room.id) : [];
  const visibleConnectors = persona
    ? roomConnectors.filter((connector) => connector.visible_persona_ids.includes(persona.id))
    : roomConnectors;
  const externalEvents = room ? (messenger?.recent_external_events ?? []).filter((event) => event.room_id === room.id).slice(0, 5) : [];
  const activity = memberActivityState(member, room, persona);
  return (
    <section
      id="right-inspector-member-detail"
      className="right-panel-section messenger-member-detail-panel"
      role="tabpanel"
      aria-labelledby="right-inspector-tab-member"
    >
      <header className="member-detail-header">
        <small>{persona ? '项目人格' : '成员'}</small>
        <h2>{persona?.display_name || member.display_name}</h2>
      </header>
      {persona ? (
        <>
          <div className="persona-card">
            <strong>{persona.display_name} <span>{persona.handle}</span></strong>
            <p>{persona.tagline}</p>
            <small>项目人格 · {project?.name || '未关联项目'}</small>
          </div>
          <PermissionAuditCard room={room} />
          <div className="inspector-metric-grid">
            <KV label="版本" value={String(persona.version)} />
            <KV label="状态" value={formatStatus(persona.status)} />
            <KV label="活跃状态" value={activity.label} />
            <KV label="权限" value={persona.permission_summary || '按项目权限'} />
            <KV label="模型策略" value={persona.model_strategy || '默认'} />
          </div>
          <CollapsedData label="性格维度" value={persona.traits} />
          <RoomConnectorList connectors={visibleConnectors} events={externalEvents} onRetry={retryExternalConnectorEvent} />
          <div className="persona-version-list">
            <h3>身份版本</h3>
            {versions.length === 0 ? <p className="empty">暂无版本记录。</p> : versions.map((version) => (
              <article key={version.id} className="persona-version-row">
                <div>
                  <strong>v{version.version}</strong>
                  <small>{version.change_reason || '身份更新'} · {formatShortTime(version.created_at)}</small>
                </div>
                <button
                  type="button"
                  disabled={version.version === persona.version}
                  onClick={() => void rollbackPersonaVersion(persona.id, version.version)}
                >
                  回滚
                </button>
              </article>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="member-row member-detail-card member-profile-row">
            <MemberProfileSummary member={member} persona={null} room={room} />
          </div>
          <PermissionAuditCard room={room} />
          <div className="inspector-metric-grid member-detail-facts">
            <KV label="类型" value={formatMemberType(member.type)} />
            <KV label="角色" value={member.role || 'member'} />
            <KV label="活跃状态" value={activity.label} />
            <KV label="可见项目" value={memberVisibleProjectsLabel(member, messenger)} />
            <KV label="审批" value={member.can_approve_high_risk ? '可批高风险' : '普通成员'} />
          </div>
          {member.visibility_scope ? <CollapsedData label="可见范围" value={{ visibility_scope: member.visibility_scope, visible_project_ids: member.visible_project_ids ?? [] }} /> : null}
          {member.metadata ? <CollapsedData label="成员元数据" value={member.metadata} /> : null}
          <RoomConnectorList connectors={visibleConnectors} events={externalEvents} onRetry={retryExternalConnectorEvent} />
        </>
      )}
    </section>
  );
}

function memberKey(member: MessengerRoomMember) {
  return [member.type, member.id, member.persona_id ?? '', member.project_id ?? ''].join(':');
}

function resolveMemberPersona(member: MessengerRoomMember, messenger: PersonaMessengerSnapshot | null, fallback: ProjectPersona | null) {
  const personaID = member.persona_id || (member.type === 'persona' ? member.id : '');
  if (!personaID) return null;
  return messenger?.personas.find((item) => item.id === personaID) ?? (fallback?.id === personaID ? fallback : null);
}

function MemberProfileSummary({
  member,
  persona,
  room,
}: {
  member: MessengerRoomMember;
  persona: ProjectPersona | null;
  room: MessengerRoom | null;
}) {
  const activity = memberActivityState(member, room, persona);
  return (
    <>
      <MemberAvatar member={member} persona={persona} />
      <span className="member-profile-copy">
        <strong>{persona?.display_name || member.display_name}</strong>
        <small>{memberDescriptionLine(member, persona, room)}</small>
      </span>
      <span className={`member-activity-badge member-activity-${activity.tone}`}>{activity.label}</span>
    </>
  );
}

function MemberAvatar({ member, persona }: { member: MessengerRoomMember; persona: ProjectPersona | null }) {
  const avatar = memberAvatarValue(member, persona);
  const label = avatar && !isImageAvatar(avatar)
    ? avatar.slice(0, 2)
    : (persona?.display_name || member.display_name || '成').slice(0, 1);
  return (
    <span className={`member-avatar member-avatar-${classToken(member.type)}`} aria-hidden="true">
      {avatar && isImageAvatar(avatar) ? <img src={avatar} alt="" /> : label}
    </span>
  );
}

function memberAvatarValue(member: MessengerRoomMember, persona: ProjectPersona | null) {
  const metadataAvatar = member.metadata?.avatar;
  if (typeof metadataAvatar === 'string' && metadataAvatar.trim()) return metadataAvatar.trim();
  return persona?.avatar?.trim() || '';
}

type MemberActivityTone = 'active' | 'locked' | 'idle' | 'owner';

function memberActivityState(
  member: MessengerRoomMember,
  room: MessengerRoom | null,
  persona: ProjectPersona | null,
): { label: string; tone: MemberActivityTone } {
  if (isRoomOwnerMember(member, room)) {
    return { label: '群主', tone: 'owner' };
  }
  const personaID = member.persona_id || (member.type === 'persona' ? member.id : '');
  if (personaID && room?.route_lock_persona_id === personaID) {
    return { label: '已锁定', tone: 'locked' };
  }
  if (personaID && room?.floor_holder_persona_id === personaID) {
    return { label: '当前发言', tone: 'active' };
  }
  if (persona?.status) {
    return {
      label: formatStatus(persona.status),
      tone: persona.status === 'active' || persona.status === 'running' ? 'active' : 'idle',
    };
  }
  const metadataStatus = memberMetadataStatus(member);
  if (metadataStatus) return metadataStatus;
  return {
    label: member.type === 'user' || member.type === 'human' ? '已加入' : '待命',
    tone: 'idle',
  };
}

function memberMetadataStatus(member: MessengerRoomMember): { label: string; tone: MemberActivityTone } | null {
  const raw = member.metadata?.presence ?? member.metadata?.status ?? member.metadata?.activity;
  if (typeof raw === 'string' && raw.trim()) {
    const value = raw.trim();
    return {
      label: formatStatus(value),
      tone: value === 'active' || value === 'online' || value === 'running' ? 'active' : 'idle',
    };
  }
  if (typeof member.metadata?.active === 'boolean') {
    return member.metadata.active ? { label: '活跃', tone: 'active' } : { label: '空闲', tone: 'idle' };
  }
  return null;
}

function memberDescriptionLine(member: MessengerRoomMember, persona: ProjectPersona | null, room: MessengerRoom | null) {
  if (isRoomOwnerMember(member, room) && (member.type === 'user' || member.type === 'human')) {
    return '登录用户 · 真人';
  }
  if (persona) {
    return persona.tagline || `${formatMemberType(member.type)} · ${persona.handle}`;
  }
  const parts = [
    formatMemberType(member.type),
    formatMemberRole(member.role),
    member.visible_project_ids?.length ? `${member.visible_project_ids.length} 个授权项目` : '',
    member.can_approve_high_risk ? '可批高风险' : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function isRoomOwnerMember(member: MessengerRoomMember, room: MessengerRoom | null) {
  const role = member.role?.trim().toLowerCase();
  if (role === 'owner' || role === 'room_owner') return true;
  return Boolean(room?.owner_user_id && member.id === room.owner_user_id);
}

function formatMemberRole(role?: string) {
  if (!role) return '';
  if (role === 'owner' || role === 'room_owner') return '群主';
  if (role === 'persona') return '';
  if (role === 'human_member') return '成员';
  return role;
}

function formatMemberType(type: string) {
  if (type === 'persona') return '项目人格';
  if (type === 'user' || type === 'human') return '真人';
  return type;
}

function memberVisibleProjectsLabel(member: MessengerRoomMember, messenger: PersonaMessengerSnapshot | null) {
  const ids = member.visible_project_ids ?? [];
  if (ids.length === 0) return member.project_id || '仅房间上下文';
  const projects = ids.map((id) => messenger?.projects.find((project) => project.id === id)?.name || id);
  return projects.join('、');
}

function PermissionAuditCard({ room }: { room: MessengerRoom | null }) {
  const audit = room?.permission_audit;
  if (!audit) return null;
  return (
    <div className="permission-audit-card">
      <h3>权限摘要</h3>
      <div className="inspector-metric-grid">
        <KV label="可见项目" value={audit.visible_project_ids.join('、') || '仅房间上下文'} />
        <KV label="审批" value={audit.can_approve_high_risk ? '可批高风险' : '不可批高风险'} />
        <KV label="私聊隔离" value={audit.can_read_private_persona_dm ? '允许当前上下文' : '禁止读取其他私聊'} />
        <KV label="AI 参与" value={audit.multi_human_ai_throttle ? `${audit.ai_participation} · 多真人节制` : audit.ai_participation} />
      </div>
      <small>{audit.summary}</small>
      {audit.reason_codes.length ? <small>{audit.reason_codes.join('、')}</small> : null}
    </div>
  );
}

function RoomConnectorList({
  connectors,
  events,
  onRetry,
}: {
  connectors: PersonaMessengerSnapshot['room_connectors'];
  events: PersonaMessengerSnapshot['recent_external_events'];
  onRetry: (eventID: string) => Promise<void>;
}) {
  return (
    <div className="room-connector-list">
      <h3>外部连接</h3>
      {connectors.length === 0 ? <p className="empty">暂无外部连接。</p> : connectors.map((connector) => (
        <article key={connector.id} className="connector-row">
          <div>
            <strong>{formatChannelLabel(connector.provider)}</strong>
            <small>{formatStatus(connector.status)}</small>
          </div>
          <span>{connector.visible_persona_ids.length} 个项目人格</span>
        </article>
      ))}
      {events.length > 0 ? (
        <div className="external-event-list">
          {events.map((event) => {
            const retryable = ['send_failed', 'pending', 'retry_scheduled'].includes(event.status);
            return (
              <article key={event.id} className={`external-event-row event-${classToken(event.status)}`}>
                <div className="external-event-row-header">
                  <div>
                    <strong>{formatStatus(event.status)}</strong>
                    <small>{formatChannelLabel(event.provider)}</small>
                  </div>
                  {retryable ? (
                    <button className="external-event-retry" type="button" onClick={() => void onRetry(event.id)}>
                      重试
                    </button>
                  ) : null}
                </div>
                {event.error ? <p>发送遇到问题，可以重试。</p> : <p>{compactRoomLastMessage(event.text)}</p>}
              </article>
            );
          })}
        </div>
      ) : null}
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
        <small>本机活动</small>
        <h2>运行记录</h2>
      </header>
      <div className="logs-filter-grid">
        <label className="field-row compact">
          <span>搜索</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索结果或功能" />
        </label>
        <label className="field-row compact">
          <span>重要程度</span>
          <select value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="">全部</option>
            {logLevelOptions.map((item) => <option key={item} value={item}>{formatLogLevel(item)}</option>)}
          </select>
        </label>
        <label className="field-row compact">
          <span>风险</span>
          <select value={risk} onChange={(event) => setRisk(event.target.value)}>
            <option value="">全部</option>
            {logRiskOptions.map((item) => <option key={item} value={item}>{formatRiskLevel(item)}</option>)}
          </select>
        </label>
        <label className="field-row compact">
          <span>类型</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">全部</option>
            {logCategoryOptions.map((item) => <option key={item} value={item}>{formatLogCategory(item)}</option>)}
          </select>
        </label>
      </div>
      <div className="logs-toolbar">
        <button type="button" onClick={() => setRefreshNonce((value) => value + 1)} disabled={loading}>
          {loading ? '刷新中' : '刷新'}
        </button>
        {runID ? <button type="button" onClick={() => setRunFilter(runID)}>只看本次运行</button> : null}
        <button type="button" onClick={() => void exportVisibleLogs()}>导出诊断记录</button>
      </div>
      {error ? <p className="terminal-error">{error}</p> : null}
      {notice ? <p className="logs-notice">{notice}</p> : null}
      <div className="log-entry-list">
        {logs.length === 0 ? (
          <p className="empty">暂无运行记录。</p>
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
        <span className="log-level-pill">{formatLogLevel(log.level)}</span>
        <span>{formatRiskLevel(log.risk_level)}</span>
        <time>{formatShortTime(log.created_at)}</time>
      </header>
      <strong>{friendlyLogSummary(log)}</strong>
      <small>{[formatLogCategory(log.category), log.status ? formatStatus(log.status) : '', log.duration_ms ? formatMilliseconds(log.duration_ms) : ''].filter(Boolean).join(' · ')}</small>
      {log.error ? <small className="terminal-error">本次运行遇到问题，可导出诊断记录后继续排查。</small> : null}
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
      setError('请先预览当前清理范围。');
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
      <h3>清理运行记录</h3>
      <dl className="metrics">
        <KV label="清理范围" value="运行记录、模型与工具活动、后台状态记录" />
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
          <span>包含详细执行过程</span>
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
          <span>包含后台连接记录</span>
        </label>
      </div>
      {preview ? (
        <div className="log-cleanup-preview">
          <strong>{preview.total_count} 项</strong>
          <div>
            {Object.entries(preview.counts).map(([scope, count]) => (
              <span key={scope}>{formatCleanupScope(scope)}：{count}</span>
            ))}
          </div>
          {preview.warnings.length > 0 ? <p>{preview.warnings.join(' · ')}</p> : null}
        </div>
      ) : null}
      {error ? <p className="terminal-error">{error}</p> : null}
      <div className="detail-actions">
        <button type="button" onClick={() => void previewCleanup()} disabled={busy}>预览清理范围</button>
        <button type="button" onClick={() => void clearLogs()} disabled={busy || !previewIsCurrent || !preview?.safe_to_clear}>
          清理运行记录
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
        <small>运行过程</small>
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
    <section className="terminal-event-stream" aria-label="运行步骤">
      <h3>最近步骤</h3>
      <ol>
        {events.map((event) => (
          <li key={event.id}>
            <span className={`status-dot ${event.status === 'running' ? 'running' : event.status === 'waiting_approval' ? 'waiting' : event.status === 'failed' ? 'failed' : 'done'}`} />
            <div>
              <strong>{threadEventLabel(event.type)}</strong>
              <small>
                {formatStatus(event.status || 'completed')}
                {event.title || event.summary ? ` · ${[event.title, event.summary].filter(Boolean).join(' · ')}` : ''}
                {event.error ? ' · 本步骤遇到问题' : ''}
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
      <h3>本次使用了这些记忆</h3>
      <InsightList empty="本次没有使用已确认记忆。">
        {usedMemories.map((result) => (
          <InsightItem key={`used-${result.memory.id}`} title={result.memory.summary || result.memory.type} body={result.memory.content}>
            <small>匹配度 {Math.round(result.score * 100)}% · {formatMemoryReason(result.reason)}</small>
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
              <small>{formatStatus(step.status)}{step.capability_id ? ` · ${capabilityDisplayName(step.capability_id)}` : ''}</small>
              {step.summary && <p>{step.summary}</p>}
            </div>
          </li>
        ))}
      </ol>
      <h3>交付物</h3>
      <InsightList empty="还没有交付物。">
        {detail.deliverables.map((artifact) => (
          <InsightItem key={artifact.id} title={artifact.title} body={formatArtifactType(artifact.type)}>
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
            <small>{formatArtifactType(artifact.type)} · 版本 {artifact.version}</small>
            <h2 id="artifact-title">{artifact.title}</h2>
          </div>
          <button type="button" aria-label="关闭交付物" onClick={close}>×</button>
        </header>
        <ScrollArea className="artifact-content">
          <ArtifactContent content={artifact.content} />
        </ScrollArea>
      </section>
    </div>
  );
}

function ArtifactContent({ content }: { content: string }) {
  const parsed = parseStructuredText(content);
  if (parsed && typeof parsed === 'object') {
    const rows = userFacingDetailRows(parsed);
    return rows.length ? (
      <dl className="compact-kv artifact-detail-grid">
        {rows.map((row, index) => <KV key={`${row.label}-${index}`} label={row.label} value={row.value} />)}
      </dl>
    ) : <p className="empty">该交付物只包含内部诊断数据，已在普通视图中隐藏。</p>;
  }
  return <div className="artifact-copy">{content || '暂无内容。'}</div>;
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
      {openTrace ? <button className="developer-diagnostics-link" type="button" onClick={openTrace}>查看完整过程</button> : null}
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
          <strong>{executionActionTitle(action)}</strong>
          <small>{executionActionDescription(action)}</small>
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
  if (isInternalExecutionDetail(detail.label)) return null;
  const rows = userFacingDetailRows(detail.value);
  const primitive = typeof detail.value === 'string' || typeof detail.value === 'number' || typeof detail.value === 'boolean';
  if (!primitive && rows.length === 0) return null;
  return (
    <section className="execution-action-detail">
      <h4>{executionDetailLabel(detail.label)}</h4>
      {primitive ? (
        <p className="execution-detail-copy">{formatDetailValue(detail.value, detail.label)}</p>
      ) : (
        <dl className="compact-kv execution-detail-grid">
          {rows.map((row, index) => <KV key={`${row.label}-${index}`} label={row.label} value={row.value} />)}
        </dl>
      )}
    </section>
  );
}

function isInternalExecutionDetail(label: string) {
  return /^(COMMAND|INPUT|REQUEST|ARGS|ARGUMENTS|METADATA|RAW)$/i.test(label.trim());
}

function executionDetailLabel(label: string) {
  const labels: Record<string, string> = {
    ERROR: '问题说明',
    LIMITATIONS: '限制',
    OUTPUT: '结果摘要',
    RESULT: '结果摘要',
    SOURCES: '参考来源',
  };
  return labels[label.toUpperCase()] || label;
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
  return `${executionActionTitle(action)}${suffix}`;
}

function executionActionTitle(action: ExecutionAction) {
  const title = action.title.trim();
  if (!/[_]|\b(?:tool|browser|runtime|trace|preview)\b/i.test(title)) return title;
  if (action.kind === 'web') return '浏览网页';
  if (action.kind === 'workspace') return '搜索工作区';
  if (action.kind === 'file') return '读取文件';
  if (action.kind === 'command') return '执行受控操作';
  if (action.kind === 'confirmation') return '等待你的确认';
  return '使用受控能力';
}

function executionActionDescription(action: ExecutionAction) {
  const description = action.description.trim();
  if (!description) return formatStatus(action.status);
  if (/[_]|\b(?:tool|browser|runtime|trace|preview|payload)\b/i.test(description)) return '已在授权范围内完成处理。';
  return description;
}

function userFacingSpanTitle(span: RunTraceSpan) {
  const title = span.title.trim();
  if (!/[_]|\b(?:tool|browser|runtime|trace|preview)\b/i.test(title)) return title;
  if (span.span_type === 'model_span') return '生成回复';
  if (span.span_type === 'tool_span') return span.tool_name ? capabilityDisplayName(span.tool_name) : '使用受控能力';
  return '处理任务';
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

function connectedModelOptions(models: AvailableModel[], settings: SettingsRecord | null) {
  const byID = new Map<string, AvailableModel>();
  for (const model of models) {
    if (!model.id || model.config?.enabled === false) continue;
    if (isNonUserSelectableModel(model, settings)) continue;
    const existing = byID.get(model.id);
    const matchesCurrent = model.id === settings?.model_name
      && (!settings?.model_provider || providerMatches(model.provider, settings.model_provider))
      && (!settings?.model_base_url || normalizeBaseURL(model.base_url || '') === normalizeBaseURL(settings.model_base_url));
    if (!existing || matchesCurrent) {
      byID.set(model.id, model);
    }
  }
  if (settings?.model_name && !byID.has(settings.model_name)) {
    byID.set(settings.model_name, {
      provider: settings.model_provider,
      base_url: settings.model_base_url,
      id: settings.model_name,
      display_name: settings.model_name,
      owner: settings.model_provider,
      config: {
        role: 'default',
        enabled: true,
        temperature: 0.7,
        timeout_seconds: 60,
        max_retries: 1,
        supports_json_mode: true,
        supports_tool_calling: true,
        supports_reasoning: false,
      },
    });
  }
  return Array.from(byID.values()).sort((a, b) => {
    if (a.id === settings?.model_name) return -1;
    if (b.id === settings?.model_name) return 1;
    return modelOptionLabel(a).localeCompare(modelOptionLabel(b));
  });
}

function isNonUserSelectableModel(model: AvailableModel, settings: SettingsRecord | null) {
  if (model.id === settings?.model_name) return false;
  const provider = normalizeProvider(model.provider || model.owner || '');
  return provider.includes('mock') || provider.includes('deterministic');
}

function normalizePersonaModelSelection(value: string | undefined, models: AvailableModel[], fallback: string) {
  const modelID = value?.trim() || '';
  if (modelID && models.some((model) => model.id === modelID)) return modelID;
  if (modelID && !/^使用.*模型/.test(modelID)) return modelID;
  return fallback;
}

function configuredPersonaModelName(value: string | undefined) {
  const modelID = value?.trim() || '';
  if (!modelID || /^使用.*模型/.test(modelID)) return '';
  return modelID;
}

function modelOptionKey(model: AvailableModel) {
  return [model.provider || '', model.base_url || '', model.id].join(':');
}

function modelOptionLabel(model: AvailableModel) {
  const provider = model.provider || model.owner || '';
  return `${model.display_name || model.id}${provider ? ` · ${provider}` : ''}`;
}

function projectLocalPathValue(project: PersonaMessengerSnapshot['projects'][number] | null) {
  const value = project?.metadata?.local_path;
  return typeof value === 'string' ? value : '';
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
        <KV label="处理步骤" value={`${stepCount} 步`} />
        <KV label="耗时" value={formatMilliseconds(firstModelCall?.latency_ms ?? 0)} />
        <KV label="本次令牌" value={`${formatTokenCount(traceUsage.total_tokens)} total`} />
        <KV label="本次成本" value={formatCost(traceUsage.cost_estimate)} />
      </dl>
      {actions.length > 0 ? (
        <ExecutionActionFlow actions={actions} mode="detail" />
      ) : (
        <p className="empty">这次运行没有可投影的执行动作。</p>
      )}
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
  const readinessCredentials = Object.values(handoffReadiness?.credentials ?? {});
  const readinessChecks = Object.values(handoffReadiness?.checks ?? {});
  const readinessServices = Object.values(handoffReadiness?.services ?? {});

  return (
    <section className="settings-data-panel closure-report-panel">
      <h3>最近运行完整性</h3>
      <article className="row-card compact closure-run-card">
        <strong>外部入口接续</strong>
        <small>
          状态：{formatExternalHandoffStatus(handoffStatus)}
          {handoffReadiness?.checked ? ` · 连接：${handoffReadiness.ok ? '正常' : '需要检查'}` : ''}
        </small>
        <div className="closure-report-signals">
          <span>外部触发：{externalHandoffAudit?.metrics.external_runs ?? 0}</span>
          <span>桌面任务：{externalHandoffAudit?.metrics.desktop_runs ?? 0}</span>
          <span>已关联：{externalHandoffAudit?.metrics.linked_external_desktop_tasks ?? 0}</span>
          <span>来源：{externalHandoffAudit?.external_channels_seen.length ? externalHandoffAudit.external_channels_seen.map(formatChannelLabel).join('、') : '暂无'}</span>
        </div>
        {pendingExternalHandoffs.length ? (
          <div className="closure-report-signals">
            {pendingExternalHandoffs.slice(0, 3).map((handoff) => (
              <span className="closure-report-action-signal" key={handoff.external_run_id}>
                <span>
                  待接续：{formatChannelLabel(handoff.external_channel)}
                  {handoff.latest_task_status ? ` · ${formatStatus(handoff.latest_task_status)}` : ''}
                </span>
                <button type="button" onClick={() => void continueProductTaskByID(handoff.product_task_id)}>继续</button>
              </span>
            ))}
            {pendingExternalHandoffs.length > 3 ? <span>另 {pendingExternalHandoffs.length - 3} 条待接续</span> : null}
          </div>
        ) : null}
        {externalHandoffAudit?.next_action ? <p>{userFacingNextAction(externalHandoffAudit.next_action)}</p> : null}
        {handoffReadiness?.checked ? (
          <div className="closure-report-signals">
            <span>连接凭证：{readinessCredentials.filter((item) => item.present).length}/{readinessCredentials.length}</span>
            <span>连接检查：{readinessChecks.filter((item) => item.ok).length}/{readinessChecks.length}</span>
            <span>相关服务：{readinessServices.filter((item) => formatExternalServiceStatus(item) === '正常').length}/{readinessServices.length}</span>
          </div>
        ) : null}
      </article>
      <dl className="metrics closure-report-metrics">
        <KV label="最近运行" value={`${metrics.total_runs} 条`} />
        <KV label="完整记录" value={`${metrics.terminal_event_runs} 条`} />
        <KV label="任务记录" value={`${metrics.execution_runs_with_task_or_refusal}/${metrics.execution_runs}`} />
        <KV label="结果依据" value={`${metrics.completed_tasks_with_evidence}/${metrics.completed_tasks}`} />
        <KV label="使用能力" value={`${metrics.runs_with_tool_evidence} 条`} />
        <KV label="参考记忆" value={`${metrics.runs_with_memory_events} 条`} />
        <KV label="主动跟进" value={`${metrics.runs_with_proactive_events} 条`} />
        <KV label="外部接续" value={`${metrics.runs_with_handoff_events} 条`} />
        <KV label="需恢复" value={`${metrics.recoverable_runs} 条`} />
      </dl>
      <RecordList
        emptyText="暂无运行闭环报告。"
        items={items.slice(0, 12)}
        renderItem={(item) => {
          const updatedAt = formatShortTime(item.updated_at || item.created_at) || '未知时间';
          return (
            <article key={item.run_id} className="row-card compact closure-run-card">
              <strong>运行记录 · {updatedAt}</strong>
              <small>
                状态：{formatStatus(item.status)}
                {item.terminal_status ? ` · 完成状态：${formatStatus(item.terminal_status)}` : ''}
              </small>
              <div className="closure-report-signals">
                <span>完整记录：{item.terminal_event_present ? '有' : '无'}</span>
                <span>结果依据：{item.has_task_evidence ? '有' : '无'}</span>
                <span>能力调用：{item.tool_run_count} 次</span>
                <span>参考记忆：{item.memory_event_count} 条</span>
                <span>主动跟进：{item.proactive_event_count} 条</span>
                <span>外部接续：{item.handoff_event_count} 条</span>
                <span>需要恢复：{item.recovery_required ? '是' : '否'}</span>
              </div>
              {item.task_status || item.terminal_reason ? (
                <small>
                  {item.task_status ? `任务状态：${formatStatus(item.task_status)}` : ''}
                  {item.task_status && item.terminal_reason ? ' · ' : ''}
                  {item.terminal_reason ? `原因：${item.terminal_reason}` : ''}
                </small>
              ) : null}
              {item.task_evidence_summary ? <p>{item.task_evidence_summary}</p> : null}
            </article>
          );
        }}
      />
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
              <small>{formatStatus(memory.status)} · 置信度 {memory.confidence.toFixed(2)} · {memory.conflict_group_id ? '存在冲突' : '无冲突'}</small>
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
              {memory.conflict_group_id && <small>{memory.conflict_reason || '这条记忆与现有内容不一致。'}</small>}
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
        <button type="button" onClick={rotateWorkerToken}>更新执行器连接凭证</button>
      </div>
      <div className="table">
        {nodes.map((node) => (
          <article key={node.id} className="row-card">
            <div>
              <strong>{node.name || nodeDisplayName(node.id)}</strong>
              <p>{formatNodeRole(node.role)} · {formatStatus(node.status)}</p>
              <small>自动分配 {formatBoolean(node.auto_assign_enabled)} · 手动指定 {formatBoolean(node.manual_assign_enabled)}</small>
              <small>可用能力：{node.capabilities?.length ?? 0} 项</small>
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
      <h3>连接记录</h3>
      <div className="table">
        {audit.map((item) => (
          <article key={item.id} className="row-card compact">
            <strong>{nodeDisplayName(item.node_id)} · {formatAction(item.action)} · {formatStatus(item.status)}</strong>
            <small>{item.reason}</small>
            {item.metadata ? <CollapsedData label="高级详情" value={item.metadata} /> : null}
          </article>
        ))}
        {audit.length === 0 && <p className="empty">暂无执行器连接记录。</p>}
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
              <strong>{item.requested_action || capabilityDisplayName(item.capability_id)}</strong>
              <p>风险 {formatRiskLevel(item.risk_level)} · {formatStatus(item.status)}</p>
              <small>{item.approval_scope === 'current_run' ? '本任务内授权' : '仅允许一次'}</small>
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
    await desktopApi.generateWorkerToken();
    setNotice('执行器连接凭证已更新。');
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
                <option value="MODEL_API_KEY">模型服务密钥</option>
                <option value="TELEGRAM_BOT_TOKEN">Telegram 机器人令牌</option>
                <option value="WORKER_TOKEN">执行器连接凭证</option>
              </select>
            </label>
            <label>
              值
              <SecretInput value={secretValue} visible={secretValueVisible} onChange={setSecretValue} onToggleVisible={() => setSecretValueVisible((value) => !value)} />
            </label>
            <button type="button" onClick={saveSecret}>保存</button>
          </div>
          <div className="secret-status">
            {Object.entries(secretStatus?.secrets ?? {}).filter(([name]) => isUserFacingSecret(name)).map(([name, present]) => (
              <span key={name}>{secretDisplayName(name)}：{present ? '已配置' : '未配置'}</span>
            ))}
          </div>
        </section>
        <section>
          <h3>连接测试</h3>
          <div className="control-row">
            <button type="button" onClick={testModel}>测试模型</button>
            <button type="button" onClick={generateWorkerToken}>更新执行器连接凭证</button>
            <button type="button" onClick={exportDiagnostics}>导出脱敏诊断包</button>
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
  const usedMemories = extractUsedMemories(trace);
  const traceUsage = summarizeModelCalls(trace.model_calls ?? []);
  return (
    <section className="runtime-summary">
      <h3>运行摘要</h3>
      <dl className="compact-kv">
        <KV label="参考记忆" value={`${usedMemories.length} 条`} />
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
      </div>
    </section>
  );
}

function CollapsedData({ label, value }: { label: string; value: unknown }) {
  const rows = userFacingDetailRows(value);
  if (rows.length === 0) return null;
  return (
    <details className="json-details user-facing-details">
      <summary>{userFacingDisclosureLabel(label)}</summary>
      <dl className="compact-kv user-facing-detail-grid">
        {rows.map((row, index) => (
          <KV key={`${row.label}-${index}`} label={row.label} value={row.value} />
        ))}
      </dl>
    </details>
  );
}

type UserFacingDetailRow = { label: string; value: string };

const hiddenDetailKeyPattern = /(^|_)(id|ids|token|secret|key|hash|schema|metadata|raw|payload|prompt|input|output|header|headers|sql|trace|contract|cache|internal|debug|stack|source_event|dedup|route|scope)(_|$)/i;

function userFacingDetailRows(value: unknown): UserFacingDetailRow[] {
  const parsed = parseStructuredText(value);
  return collectUserFacingDetailRows(parsed).slice(0, 18);
}

function collectUserFacingDetailRows(value: unknown, parentLabel = '', depth = 0): UserFacingDetailRow[] {
  if (value === null || value === undefined || depth > 2) return [];
  if (Array.isArray(value)) {
    if (value.length === 0) return parentLabel ? [{ label: parentLabel, value: '暂无' }] : [];
    if (value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
      return [{ label: parentLabel || '内容', value: value.slice(0, 8).map((item) => formatDetailValue(item, parentLabel)).join('、') }];
    }
    return [{ label: parentLabel || '项目', value: `${value.length} 项` }];
  }
  if (typeof value !== 'object') {
    return parentLabel ? [{ label: parentLabel, value: formatDetailValue(value, parentLabel) }] : [];
  }
  const rows: UserFacingDetailRow[] = [];
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (shouldHideDetailKey(key) || item === null || item === undefined || item === '') continue;
    const label = userFacingFieldLabel(key);
    if (Array.isArray(item)) {
      rows.push(...collectUserFacingDetailRows(item, label, depth + 1));
      continue;
    }
    if (typeof item === 'object') {
      rows.push(...collectUserFacingDetailRows(item, label, depth + 1));
      continue;
    }
    rows.push({ label, value: formatDetailValue(item, key) });
  }
  return rows;
}

function shouldHideDetailKey(key: string) {
  const normalized = key.trim().toLowerCase();
  return !normalized
    || normalized.startsWith('_')
    || hiddenDetailKeyPattern.test(normalized)
    || ['preview', 'entities', 'recent_usage', 'positive_examples', 'negative_examples', 'dynamic_tail', 'prefix'].includes(normalized);
}

function userFacingFieldLabel(key: string) {
  const labels: Record<string, string> = {
    active_tasks: '运行中任务',
    allowed: '是否允许',
    count: '数量',
    created_at: '创建时间',
    description: '说明',
    duration_ms: '耗时',
    enabled: '是否启用',
    error: '问题',
    error_code: '问题类型',
    error_message: '问题说明',
    futureEffect: '后续作用',
    item_count: '项目数量',
    message: '说明',
    model: '模型',
    model_name: '模型',
    name: '名称',
    provider: '服务',
    reason: '原因',
    require_mention: '群聊需唤醒',
    risk_level: '风险',
    sqlite: '本地数据',
    status: '状态',
    summary: '摘要',
    title: '标题',
    total_count: '总数',
    type: '类型',
    updated_at: '更新时间',
    url: '地址',
    version: '版本',
    why: '记住原因',
  };
  return labels[key] ?? formatFieldName(key);
}

function formatDetailValue(value: unknown, key: string) {
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return key.toLowerCase().includes('duration') ? formatMilliseconds(value) : String(value);
  const text = String(value).trim();
  if (!text) return '未设置';
  if (key.toLowerCase().includes('risk')) return formatRiskLevel(text);
  if (key.toLowerCase().includes('status')) return formatStatus(text);
  if (/(?:_at|time|date)$/i.test(key) && !Number.isNaN(Date.parse(text))) return formatShortTime(text);
  return text.length > 220 ? `${text.slice(0, 217)}…` : text;
}

function parseStructuredText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function userFacingDisclosureLabel(label: string) {
  if (/输出|结果/i.test(label)) return '结果摘要';
  if (/备份|清单/i.test(label)) return '内容摘要';
  if (/性格|范围/i.test(label)) return label;
  return '补充信息';
}

function capabilityDisplayName(id: string, fallbackDescription = '') {
  const labels: Record<string, string> = {
    bash: '运行受控命令',
    browser_open: '打开网页',
    browser_scroll: '浏览网页',
    debugger_attach: '连接调试器',
    desktop_app_list: '查看已安装应用',
    execute_code: '运行代码',
    file_analyze: '分析文件',
    github: '访问 GitHub',
    image_generate: '生成图片',
    ls: '查看文件夹',
    mcp_tool_call: '使用已授权扩展',
    read_file: '读取文件',
    session_search: '搜索历史会话',
    text_to_speech: '生成语音',
    video_generate: '生成视频',
    web_extract: '读取网页内容',
    web_search: '搜索网页',
    workspace_search: '搜索工作区',
    x_search: '搜索 X',
  };
  if (labels[id]) return labels[id];
  const description = fallbackDescription.trim();
  if (description && !/[{}\[\]_]/.test(description)) return description.length > 56 ? `${description.slice(0, 53)}…` : description;
  return '受控扩展能力';
}

function capabilityUserDescription(id: string, fallbackDescription = '') {
  const descriptions: Record<string, string> = {
    desktop_app_list: '查看本机已安装应用的名称和基本信息，不读取应用内容。',
    file_analyze: '在已授权文件夹内读取并分析你指定的文件。',
    workspace_search: '在已授权工作区中查找文件和内容。',
  };
  return descriptions[id] || (/[\u4e00-\u9fff]/.test(fallbackDescription) ? fallbackDescription : '在授权范围内完成任务；涉及写入或高风险操作时会先请求确认。');
}

function extensionDisplayName(value: string) {
  const labels: Record<string, string> = {
    'Local MCP Registry': '本地扩展中心',
  };
  return labels[value] || (/[\u4e00-\u9fff]/.test(value) ? value : '外部扩展');
}

function formatConnectionStatus(value?: string) {
  const labels: Record<string, string> = {
    active: '已连接',
    connected: '已连接',
    inactive: '未连接',
    not_configured: '尚未配置',
    offline: '离线',
  };
  return labels[value || ''] || '状态未知';
}

function skillDisplayName(value: string) {
  const labels: Record<string, string> = {
    'Desktop Inventory': '本机应用清单',
  };
  return labels[value] || (/[\u4e00-\u9fff]/.test(value) ? value : '扩展技能');
}

function skillUserDescription(name: string, description: string) {
  if (name === 'Desktop Inventory') return '列出本机已安装应用的名称和基本信息，不读取应用内容。';
  return /[\u4e00-\u9fff]/.test(description) ? description : '按需组合已授权能力完成特定任务。';
}

function displayPathName(value?: string) {
  const text = value?.trim();
  if (!text) return '未设置';
  return text.split('/').filter(Boolean).at(-1) || text;
}

function nodeDisplayName(value?: string) {
  const labels: Record<string, string> = {
    'local-worker': '本机执行器',
    'local-worker-1': '本机执行器',
    'main-node': '这台 Mac',
    'vps-la-1': '远程执行器',
  };
  return labels[value || ''] || '执行器';
}

function isUserFacingSecret(value: string) {
  return ['MODEL_API_KEY', 'TELEGRAM_BOT_TOKEN', 'WORKER_TOKEN'].includes(value);
}

function secretDisplayName(value: string) {
  const labels: Record<string, string> = {
    MODEL_API_KEY: '模型服务密钥',
    TELEGRAM_BOT_TOKEN: 'Telegram 机器人令牌',
    WORKER_TOKEN: '执行器连接凭证',
  };
  return labels[value] || '连接凭证';
}

function formatAutomationTriggerType(value?: string) {
  const labels: Record<string, string> = {
    cron: '自定义时间',
    daily: '每天',
    interval: '定时间隔',
    manual: '手动运行',
    once: '单次运行',
    webhook: '外部事件',
    weekly: '每周',
  };
  return labels[value || ''] || '自动触发';
}

function threadEventLabel(value: string) {
  if (value.includes('artifact')) return '交付物已更新';
  if (value.includes('message')) return '聊天内容已关联';
  if (value.includes('run') || value.includes('task')) return '运行状态已更新';
  if (value.includes('complete')) return '工作已完成';
  return '线程已更新';
}

function displayThreadTitle(value: string) {
  return value.replace(/\s*[·|]\s*[a-z][a-z0-9_-]*$/i, '').trim() || '未命名线程';
}

function formatThreadPriority(value?: string) {
  const labels: Record<string, string> = {
    high: '高',
    low: '低',
    normal: '普通',
    urgent: '紧急',
  };
  return labels[value || ''] || '普通';
}

function automationPromptForDisplay(value: string) {
  return value
    .replace(/\{\{\s*payload(?:\.[^}]+)?\s*\}\}/gi, '收到的事件信息')
    .replace(/payload\s*摘要\s*[:：]?/gi, '收到的信息：')
    .replace(/webhook/gi, '外部事件')
    .replace(/^Preview\b/i, '检查');
}

function formatLogLevel(value?: string) {
  const labels: Record<string, string> = {
    debug: '调试',
    error: '错误',
    fatal: '严重错误',
    info: '正常',
    trace: '详细过程',
    warn: '提醒',
    warning: '提醒',
  };
  return labels[value || ''] || '记录';
}

function formatLogCategory(value?: string) {
  const labels: Record<string, string> = {
    external: '外部连接',
    ipc: '桌面操作',
    model: '模型调用',
    run: '任务运行',
    runtime: 'Joi 运行',
    settings: '设置变更',
    system: '系统状态',
    terminal: '命令执行',
    tool: '能力调用',
    worker_gateway: '执行器连接',
  };
  return labels[value || ''] || 'Joi 活动';
}

function friendlyLogSummary(log: LogEntry) {
  const message = log.message?.trim() || '';
  if (message && /[\u4e00-\u9fff]/.test(message) && !/[{\[]/.test(message)) {
    return message.length > 140 ? `${message.slice(0, 137)}…` : message;
  }
  const category = formatLogCategory(log.category);
  if (log.error || ['failed', 'error', 'fatal'].includes(String(log.status || log.level).toLowerCase())) return `${category}遇到问题`;
  return `${category}已记录`;
}

function userFacingNextAction(value: string) {
  const text = value.trim();
  if (!text) return '';
  return /[\u4e00-\u9fff]/.test(text) ? text : '外部入口还有后续操作需要处理。';
}

function formatCleanupScope(value: string) {
  const labels: Record<string, string> = {
    app_logs: '应用活动',
    log_files: '本地记录文件',
    model_calls: '模型调用',
    run_events: '运行事件',
    run_steps: '运行步骤',
    tool_runs: '能力调用',
    worker_gateway_audit_logs: '执行器连接',
  };
  return labels[value] || '其他运行记录';
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
    active: '活跃',
    inactive: '未连接',
    online: '在线',
    offline: '离线',
    idle: '空闲',
    warm: '就绪',
    dormant: '休眠',
    reviewing: '复核中',
    none: '暂无',
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
    desktop: '桌面',
    telegram: 'Telegram',
    imessage: 'iMessage',
  };
  return labels[channel ?? ''] ?? (channel || '未知入口');
}

function formatExternalHandoffStatus(status: string) {
  const labels: Record<string, string> = {
    sqlite_missing: '数据库缺失',
    schema_missing: '数据结构缺失',
    external_not_ready: '外部入口未就绪',
    awaiting_external_input: '等待外部消息',
    awaiting_desktop_continuation: '等待桌面继续',
    live_handoff_linked: '已链接',
    unknown: '未知',
  };
  return labels[status] ?? status;
}

function formatExternalServiceStatus(service: ExternalHandoffAudit['readiness']['services'][string]) {
  if (service.ready) return '正常';
  if (!service.enabled) return '未启用';
  if (!service.configured) return '未配置';
  if (!service.running) return '未运行';
  if (service.last_error) return '需要检查';
  return '未就绪';
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
    ui_contract: '界面方案',
    checklist: '检查清单',
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
