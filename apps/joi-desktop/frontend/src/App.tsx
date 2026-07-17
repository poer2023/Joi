import { Terminal } from '@xterm/xterm';
import { Component, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  CSSProperties,
  ErrorInfo,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
  ReactNode,
} from 'react';
import {
  desktopApi,
  type ArtifactDetail,
  type ArtifactSummary,
  type AgentModelPolicy,
  type AssistantWorkspaceSnapshot,
  type AutomationDefinition,
  type AutomationRunRecord,
  type AutomationTriggerRecord,
  type AutomationWebhookEndpoint,
  type AvailableModel,
  type BackupRecord,
  type BrowserWorkbenchResult,
  type ChatResponse,
  type CapabilityRecord,
  type ConversationDetail,
  type ConversationMessage,
  type ConversationSummary,
  type ConversationTree,
  type ConfirmationRecord,
  type ExternalHandoffAudit,
  type InputMode,
  type LogCleanupPreview,
  type LogCleanupRequest,
  type LogEntry,
  type MemoryRecord,
  type MemoryQualityMetrics,
  type MemorySearchResult,
  type MemorySystemSnapshot,
  type MessengerRoom,
  type MCPServerRecord,
  type ModelCall,
  type NodeRecord,
  type OnboardingStatus,
  type OpenLoop,
  type PhotonIMessageStatus,
  type PluginRecord,
  type PluginProviderConfig,
  type PersonaCandidate,
  type PersonaMessengerSnapshot,
  type ProactiveMessage,
  type ProductTask,
  type ProductTaskDetail,
  type ProjectPersona,
  type RunClosureReport,
  type RunQueuedMessage,
  type RunTrace,
  type RunTraceSpan,
  type RunTraceSpanSummary,
  type SecretStatus,
  type SettingsRecord,
  type SkillDetailRecord,
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
  type WorkspaceChangeSet,
  type WorkspaceSettings,
} from './api/desktop';
import { eventsOn, windowSetMinSize } from './api/runtime';
import { permissionProfileForPrompt } from './permissionProfile';
import joiAvatar from './assets/joi-avatar-circle.png';
import { ScrollArea } from './components/ScrollArea';
import { useLayerLifecycle, useReducedMotionPreference } from './components/useLayerLifecycle';
import { buildConversationRenderItems, deriveRunStatus, getMessageRunId, sortBySeq } from './features/chat/conversationProjector';
import {
  buildAutomationTelegramNotificationPolicy,
  getAutomationDetailState,
  getAutomationSettingsObjects,
  getAutomationTelegramNotificationDraft,
  getAutomationTelegramReadiness,
  getAutomationTelegramTargetError,
} from './features/automation/automationUiState';
import { CodexAutomationConsole } from './features/automation/CodexAutomationConsole';
import { automationSetupModelRoute } from './features/automation/automationParity';
import { MessageList } from './features/chat/components/MessageList';
import { ChatMessageScroller } from './features/chat/components/ChatMessageScroller';
import { TraceDrawer } from './features/chat/components/TraceDrawer';
import { normalizeRunEvent, normalizeRunEvents } from './features/chat/runEventNormalizer';
import { mergeAssistantTextChunk } from './features/chat/streamingText';
import { messagesForConversationHydration, shouldRestoreThreadMessages } from './features/chat/conversationHydration';
import {
  executionEventIsVisible,
  shouldQueueConversationSubmission,
  submissionKeyForConversation,
  withSubmissionActive,
} from './features/chat/submissionRegistry';
import type { MessageThreadAnnotation, NormalizedRunEvent } from './features/chat/types';
import {
  conversationChannelLabel,
  filterSingleAgentConversations,
  isMessagingConversationChannel,
  selectPrimaryJoiRoom,
  splitSingleAgentConversations,
  visibleSingleAgentConversations,
} from './features/workspace/singleAgentWorkspace';
import { executionRoutingForSettings } from './features/settings/settingsRuntime';
import { isLogFailure } from './features/logs/logPresentation';
import {
  acpPluginModelConfig,
  mergeACPPluginModels,
  selectACPPluginModel,
  type ACPPluginModelOption,
} from './features/settings/acpPluginModels';
import { visibleRecentTasksForHandoff } from './productTasks';
import {
  capabilityBackend,
  capabilityBackendLabel,
  capabilityStatusLabel,
} from './features/capabilities/capabilityPresentation';
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

type Tab = 'chat' | 'today' | 'trace' | 'system' | 'memory' | 'nodes' | 'costs' | 'confirmations' | 'settings' | 'backups';
type SettingsTab = Exclude<Tab, 'chat' | 'today'>;
type SettingsCategory = 'models' | 'chatEntrances' | 'automations' | 'observability' | 'dataMemory' | 'capabilities' | 'nodesExecution' | 'privacySecurity' | 'advanced';
type SelectSettingsObjectOptions = {
  preserveSidebar?: boolean;
};

type SelectSettingsObject = (
  category: SettingsCategory,
  objectID?: string,
  options?: SelectSettingsObjectOptions,
) => void;
type RightInspectorTab = 'overview' | 'conversation' | 'runs' | 'assets' | 'memory' | 'member';
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
  models: 'routing',
  chatEntrances: 'telegram',
  automations: 'new-schedule',
  observability: 'logs',
  dataMemory: 'memory-inbox',
  capabilities: 'builtin',
  nodesExecution: 'main-node',
  privacySecurity: 'privacy-policy',
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
const logLevelOptions = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const logRiskOptions = ['read_only', 'write_candidate', 'browser_interaction', 'workspace_write', 'state_change', 'destructive', 'unsafe'];
const logCategoryOptions = ['ipc', 'runtime', 'terminal', 'external', 'worker_gateway', 'settings', 'system', 'run', 'tool', 'model'];
const defaultLogCleanupScopes: LogCleanupRequest['scopes'] = ['app_logs', 'run_events', 'run_steps', 'tool_runs', 'model_calls', 'worker_gateway_audit_logs', 'log_files'];
const reasoningEffortOptions = [
  { value: 'none', label: '关闭' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];
const webSearchProviderOptions = [
  { value: 'auto', label: '自动' },
  { value: 'brave', label: 'Brave Search API' },
  { value: 'duckduckgo', label: 'DuckDuckGo HTML' },
];
const MAX_PRELOADED_CONVERSATION_RUN_TRACES = 32;

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

function mergeConversationMessages(
  current: ConversationMessage[],
  incoming: ConversationMessage[],
): ConversationMessage[] {
  if (incoming.length === 0) return current;
  const incomingByID = new Map(incoming.map((message) => [message.id, message]));
  const currentIDs = new Set(current.map((message) => message.id));
  return [
    ...current.map((message) => incomingByID.has(message.id)
      ? { ...message, ...incomingByID.get(message.id)! }
      : message),
    ...incoming.filter((message) => !currentIDs.has(message.id)),
  ];
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

function latestActiveRunId(
  eventsByRunId: Record<string, NormalizedRunEvent[]>,
  conversationID = '',
): string {
  let latest = '';
  let latestSeq = -1;
  for (const [runId, events] of Object.entries(eventsByRunId)) {
    if (!runId || events.length === 0) continue;
    if (!runEventsBelongToConversation(events, conversationID)) continue;
    const sorted = sortBySeq(events);
    const runStatus = deriveRunStatus(sorted);
    if (runStatus !== 'running' && runStatus !== 'queued' && runStatus !== 'pending' && runStatus !== 'waiting_approval') continue;
    const lastRunning = [...sorted].reverse().find((event) => (
      event.type === 'run.started'
      || event.type === 'turn.started'
      || event.status === 'running'
      || event.status === 'waiting_approval'
    ));
    if (!lastRunning) continue;
    if (lastRunning.seq >= latestSeq) {
      latest = runId;
      latestSeq = lastRunning.seq;
    }
  }
  return latest;
}

function runMessageQueuesEqual(current: RunQueuedMessage[], next: RunQueuedMessage[]): boolean {
  return current.length === next.length && JSON.stringify(current) === JSON.stringify(next);
}

function runEventsBelongToConversation(events: NormalizedRunEvent[], conversationID: string): boolean {
  if (!conversationID) return true;
  const explicitConversationIDs = new Set(events.map((event) => event.conversationId).filter(Boolean));
  return explicitConversationIDs.size === 0 || explicitConversationIDs.has(conversationID);
}

function normalizeTraceEvents(trace: RunTrace | null): NormalizedRunEvent[] {
  return normalizeRunEvents(trace?.events ?? [])
    .filter((event) => Boolean(event.runId))
    .map((event) => ({
      ...event,
      runStartedAt: trace?.started_at,
      runCompletedAt: trace?.finished_at,
      runDurationMs: trace?.duration_ms,
    }));
}

function runIdsForConversationRunTraces(messages: ConversationMessage[], latestRunID?: string): string[] {
  const seen = new Set<string>();
  const runIds: string[] = [];
  for (const message of messages) {
    const runID = getMessageRunId(message);
    if (!runID || seen.has(runID)) continue;
    seen.add(runID);
    runIds.push(runID);
  }
  if (latestRunID && !seen.has(latestRunID)) {
    seen.add(latestRunID);
    runIds.push(latestRunID);
  }
  if (runIds.length <= MAX_PRELOADED_CONVERSATION_RUN_TRACES) return runIds;
  const recentRunIds = runIds.slice(-MAX_PRELOADED_CONVERSATION_RUN_TRACES);
  if (!latestRunID || recentRunIds.includes(latestRunID)) return recentRunIds;
  return [...recentRunIds.slice(1), latestRunID];
}

async function loadConversationRunTraces(messages: ConversationMessage[], latestRunID?: string): Promise<RunTrace[]> {
  const runIds = runIdsForConversationRunTraces(messages, latestRunID);
  const traces = await Promise.all(runIds.map(async (runID) => {
    try {
      return await desktopApi.getRunTrace(runID);
    } catch {
      return null;
    }
  }));
  return traces.filter((trace): trace is RunTrace => Boolean(trace?.id));
}

function shouldRevealLiveProcessEvent(event: NormalizedRunEvent): boolean {
  const type = event.type.toLowerCase();
  if (type === 'model.started' || type === 'model.completed') return true;
  if (type === 'work_summary.updated' || type === 'plan.created' || type === 'plan.updated') return true;
  if (type.startsWith('tool.')) return true;
  return false;
}

function liveProcessEventDelay(event: NormalizedRunEvent): number {
  const type = event.type.toLowerCase();
  if (type === 'tool.output_delta' || type === 'tool.completed' || type === 'tool.failed') return 120;
  if (type.startsWith('tool.')) return 90;
  if (type === 'model.completed') return 160;
  return 110;
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
  const [immersiveMode, setImmersiveMode] = useState(false);
  const [message, setMessage] = useState('');
  const [lastPrompt, setLastPrompt] = useState('');
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [pendingUserMessage, setPendingUserMessage] = useState<ConversationMessage | null>(null);
  const [streamingAssistantMessage, setStreamingAssistantMessage] = useState<StreamingAssistantMessage | null>(null);
  const [activeExecutionActions, setActiveExecutionActions] = useState<ExecutionAction[]>([]);
  const [activeExecutionStatus, setActiveExecutionStatus] = useState<ExecutionRunStatus>('pending');
  const [activeSubmissionKeys, setActiveSubmissionKeys] = useState<Set<string>>(() => new Set());
  const [queuedMessageMode, setQueuedMessageMode] = useState<'steering' | 'follow_up'>('steering');
  const [pendingRunMessages, setPendingRunMessages] = useState<RunQueuedMessage[]>([]);
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
  const isSubmitting = activeSubmissionKeys.has(submissionKeyForConversation(currentConversationID));
  const [loadingConversationID, setLoadingConversationID] = useState('');
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [messenger, setMessenger] = useState<PersonaMessengerSnapshot | null>(null);
  const [currentRoomID, setCurrentRoomID] = useState('room_private_hub');
  const [composerScope, setComposerScope] = useState('auto_route');
  const [projectCreatorOpen, setProjectCreatorOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState({ name: '', goal: '', domain: '', phase: '' });
  const [personaCandidates, setPersonaCandidates] = useState<PersonaCandidate[]>([]);
  const [selectedPersonaCandidateID, setSelectedPersonaCandidateID] = useState('');
  const [projectCreatorBusy, setProjectCreatorBusy] = useState(false);
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [capabilities, setCapabilities] = useState<CapabilityRecord[]>([]);
  const [workflows, setWorkflows] = useState<ToolWorkflowRecord[]>([]);
  const [mcpServers, setMCPServers] = useState<MCPServerRecord[]>([]);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [toolRuns, setToolRuns] = useState<ToolRunRecord[]>([]);
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [closureReport, setClosureReport] = useState<RunClosureReport | null>(null);
  const [externalHandoffAudit, setExternalHandoffAudit] = useState<ExternalHandoffAudit | null>(null);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [memoryMetrics, setMemoryMetrics] = useState<MemoryQualityMetrics | null>(null);
  const [memorySystem, setMemorySystem] = useState<MemorySystemSnapshot | null>(null);
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
  const [sidebarPreference, setSidebarPreference] = useState<'auto' | 'collapsed' | 'expanded'>('auto');
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadQuery, setThreadQuery] = useState('');
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
  const streamingAssistantBaseRef = useRef<StreamingAssistantMessage | null>(null);
  const streamingAssistantQueueRef = useRef<string[]>([]);
  const streamingAssistantTimerRef = useRef<number | null>(null);
  const streamingAssistantDisplayedRef = useRef('');
  const streamingAssistantPlannedRef = useRef('');
  const streamingAssistantCompletionRef = useRef<{ runId?: string; content?: string } | null>(null);
  const liveProcessEventQueueRef = useRef<NormalizedRunEvent[]>([]);
  const liveProcessEventTimerRef = useRef<number | null>(null);
  const loadConversationRequestRef = useRef(0);
  const activeSubmissionKeysRef = useRef<Set<string>>(new Set());
  const latestSubmissionByKeyRef = useRef<Map<string, string>>(new Map());
  const runConversationIDsRef = useRef<Map<string, string>>(new Map());
  const currentConversationIDRef = useRef(currentConversationID);
  currentConversationIDRef.current = currentConversationID;
  const initialConversationSelectionRef = useRef(false);
  const newThreadRequestedRef = useRef(false);

  function setCurrentConversationView(conversationID: string) {
    currentConversationIDRef.current = conversationID;
    setCurrentConversationID(conversationID);
  }

  function markSubmissionActive(submissionKey: string, active: boolean) {
    const next = withSubmissionActive(activeSubmissionKeysRef.current, submissionKey, active);
    activeSubmissionKeysRef.current = next;
    setActiveSubmissionKeys(next);
  }

  const stepCount = useMemo(() => trace?.steps?.length ?? 0, [trace]);
  const firstModelCall = trace?.model_calls?.[0] ?? chat?.model_calls?.[0];
  const activeRunID = useMemo(() => (
    isSubmitting ? latestActiveRunId(runEventsByRunId, currentConversationID) || chat?.run_id || trace?.id || '' : ''
  ), [chat?.run_id, currentConversationID, isSubmitting, runEventsByRunId, trace?.id]);
  const inSettingsArea = activeTab !== 'chat' && activeTab !== 'today' && activeTab !== 'trace';
  const autoSidebarCollapsed = sidebarPreference === 'auto' && windowWidth < sidebarWidth + CHAT_MAIN_MIN_WIDTH;
  const sidebarCollapsed = sidebarPreference === 'collapsed' || autoSidebarCollapsed;
  const visibleSidebarCollapsed = immersiveMode || sidebarCollapsed;
  const activeSidebarWidth = sidebarCollapsed ? 0 : sidebarWidth;
  const maxRightPanelWidth = Math.max(
    RIGHT_PANEL_MIN_WIDTH,
    Math.min(RIGHT_PANEL_MAX_WIDTH, windowWidth - activeSidebarWidth - COMPANION_MAIN_MIN_WIDTH),
  );
  const activeRightPanelWidth = Math.min(rightPanelWidth, maxRightPanelWidth);
  const activeRoom = useMemo(() => selectPrimaryJoiRoom(messenger), [messenger]);
  const visibleConversations = useMemo(
    () => visibleSingleAgentConversations(conversations, messenger),
    [conversations, messenger],
  );
  const filteredConversations = useMemo(
    () => filterSingleAgentConversations(visibleConversations, threadQuery),
    [threadQuery, visibleConversations],
  );
  const currentConversation = useMemo(
    () => visibleConversations.find((conversation) => conversation.id === currentConversationID) ?? null,
    [currentConversationID, visibleConversations],
  );
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
    resetStreamingAssistantQueue();
    resetLiveProcessEventQueue();
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
    if (!activeRunID) {
      if (!isSubmitting) {
        setPendingRunMessages((current) => current.length > 0 ? [] : current);
      }
      return undefined;
    }
    let cancelled = false;
    let refreshing = false;
    const refreshQueue = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const result = await desktopApi.listRunMessages({ run_id: activeRunID, status: 'pending' });
        if (!cancelled) {
          const nextMessages = result.messages ?? [];
          setPendingRunMessages((current) => runMessageQueuesEqual(current, nextMessages) ? current : nextMessages);
        }
      } catch {
        // The run event stream remains authoritative if queue inspection briefly races startup.
      } finally {
        refreshing = false;
      }
    };
    void refreshQueue();
    const timer = window.setInterval(() => void refreshQueue(), 900);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeRunID, isSubmitting]);

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
    if (!immersiveMode) return;
    if (activeTab !== 'chat' || onboarding?.required || artifactViewer) {
      setImmersiveMode(false);
    }
  }, [activeTab, artifactViewer, immersiveMode, onboarding?.required]);

  useEffect(() => {
    const setWindowButtonVisibility = window.joi?.app.setWindowButtonVisibility;
    if (!setWindowButtonVisibility) return undefined;
    void setWindowButtonVisibility(!immersiveMode).catch(() => undefined);
    return () => {
      if (immersiveMode) {
        void setWindowButtonVisibility(true).catch(() => undefined);
      }
    };
  }, [immersiveMode]);

  useEffect(() => {
    function handleImmersiveShortcut(event: KeyboardEvent) {
      const toggleShortcut = event.metaKey
        && event.shiftKey
        && !event.altKey
        && event.key.toLowerCase() === 'f';
      if (toggleShortcut) {
        if (activeTab !== 'chat' || onboarding?.required || artifactViewer) return;
        event.preventDefault();
        event.stopPropagation();
        setImmersiveMode((current) => !current);
        return;
      }
      if (immersiveMode && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setImmersiveMode(false);
      }
    }

    window.addEventListener('keydown', handleImmersiveShortcut, true);
    return () => window.removeEventListener('keydown', handleImmersiveShortcut, true);
  }, [activeTab, artifactViewer, immersiveMode, onboarding?.required]);

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

  function selectSettingsObject(
    category: SettingsCategory,
    objectID?: string,
    options?: SelectSettingsObjectOptions,
  ) {
    setSettingsCategory(category);
    setSettingsObjectByCategory((current) => ({
      ...current,
      [category]: objectID ?? current[category] ?? defaultSettingsObjectByCategory[category],
    }));
    if (objectID && !options?.preserveSidebar) {
      setSidebarPreference('collapsed');
    }
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

  function resetStreamingAssistantQueue() {
    if (streamingAssistantTimerRef.current !== null) {
      window.clearTimeout(streamingAssistantTimerRef.current);
      streamingAssistantTimerRef.current = null;
    }
    streamingAssistantBaseRef.current = null;
    streamingAssistantQueueRef.current = [];
    streamingAssistantDisplayedRef.current = '';
    streamingAssistantPlannedRef.current = '';
    streamingAssistantCompletionRef.current = null;
  }

  function primeStreamingAssistant(base: StreamingAssistantMessage) {
    const currentBase = streamingAssistantBaseRef.current;
    const incomingRunID = base.run_id || '';
    const currentRunID = currentBase?.run_id || '';
    if (!currentBase || (incomingRunID && currentRunID && incomingRunID !== currentRunID)) {
      resetStreamingAssistantQueue();
      streamingAssistantBaseRef.current = { ...base, content: '', complete: false };
      setStreamingAssistantMessage({ ...base, content: '', complete: false });
      return;
    }
    streamingAssistantBaseRef.current = {
      ...currentBase,
      ...base,
      content: currentBase.content || base.content || '',
      complete: false,
    };
  }

  function enqueueAssistantText(base: StreamingAssistantMessage, text: string, splitLargeChunk = false) {
    const visibleText = userFacingAssistantText(text);
    if (!visibleText) return;
    primeStreamingAssistant(base);
    const plannedBefore = streamingAssistantPlannedRef.current;
    const plannedAfter = mergeAssistantTextChunk(plannedBefore, visibleText);
    const pendingText = plannedAfter.startsWith(plannedBefore)
      ? plannedAfter.slice(plannedBefore.length)
      : visibleText;
    streamingAssistantPlannedRef.current = plannedAfter;
    const chunks = splitLargeChunk ? splitStreamingChunks(pendingText) : [pendingText];
    streamingAssistantQueueRef.current.push(...chunks.filter(Boolean));
    pumpStreamingAssistantQueue();
  }

  function completeStreamingAssistant(runId?: string, finalText?: string) {
    const visibleFinalText = finalText ? userFacingAssistantText(finalText) : '';
    if (visibleFinalText) {
      const base = streamingAssistantBaseRef.current || {
        id: pendingAssistantIDRef.current || `streaming-${runId || Date.now()}`,
        conversation_id: pendingConversationIDRef.current || currentConversationID || 'pending-conversation',
        role: 'assistant' as const,
        content: '',
        run_id: runId,
      };
      const plannedBefore = streamingAssistantPlannedRef.current;
      const plannedAfter = visibleFinalText.startsWith(plannedBefore)
        ? visibleFinalText
        : mergeAssistantTextChunk(plannedBefore, visibleFinalText);
      const missingText = plannedAfter.startsWith(plannedBefore)
        ? plannedAfter.slice(plannedBefore.length)
        : '';
      if (missingText) {
        enqueueAssistantText(base, missingText, true);
      }
      streamingAssistantPlannedRef.current = plannedAfter;
    }
    streamingAssistantCompletionRef.current = {
      runId,
      content: visibleFinalText || undefined,
    };
    if (streamingAssistantQueueRef.current.length === 0 && streamingAssistantTimerRef.current === null) {
      markQueuedStreamingAssistantComplete();
    }
  }

  function pumpStreamingAssistantQueue() {
    if (streamingAssistantTimerRef.current !== null) return;
    const nextChunk = streamingAssistantQueueRef.current[0];
    if (!nextChunk) {
      markQueuedStreamingAssistantComplete();
      return;
    }
    streamingAssistantTimerRef.current = window.setTimeout(() => {
      streamingAssistantTimerRef.current = null;
      const chunk = streamingAssistantQueueRef.current.shift();
      if (chunk) {
        setStreamingAssistantMessage((current) => {
          const base = current || streamingAssistantBaseRef.current;
          if (!base) return current;
          const nextContent = mergeAssistantTextChunk(String(base.content || ''), chunk);
          streamingAssistantDisplayedRef.current = nextContent;
          const nextMessage = { ...base, content: nextContent, complete: false };
          streamingAssistantBaseRef.current = nextMessage;
          return nextMessage;
        });
      }
      if (streamingAssistantQueueRef.current.length > 0) {
        pumpStreamingAssistantQueue();
        return;
      }
      markQueuedStreamingAssistantComplete();
    }, streamingChunkDelay(nextChunk));
  }

  function markQueuedStreamingAssistantComplete() {
    const completion = streamingAssistantCompletionRef.current;
    if (!completion) return;
    setStreamingAssistantMessage((current) => {
      if (!current) return current;
      if (completion.runId && current.run_id && current.run_id !== completion.runId) return current;
      const content = completion.content || String(current.content || '');
      streamingAssistantDisplayedRef.current = content;
      const nextMessage = { ...current, content, complete: true };
      streamingAssistantBaseRef.current = nextMessage;
      return nextMessage;
    });
    streamingAssistantCompletionRef.current = null;
  }

  function resetLiveProcessEventQueue() {
    if (liveProcessEventTimerRef.current !== null) {
      window.clearTimeout(liveProcessEventTimerRef.current);
      liveProcessEventTimerRef.current = null;
    }
    liveProcessEventQueueRef.current = [];
  }

  function mergeRunEventForProjection(event: NormalizedRunEvent) {
    if (!event.runId) return;
    setRunEventsByRunId((current) => mergeRunEvents(current, event.runId, [event]));
  }

  function enqueueLiveProcessEvent(event: NormalizedRunEvent) {
    liveProcessEventQueueRef.current.push(event);
    pumpLiveProcessEventQueue();
  }

  function pumpLiveProcessEventQueue() {
    if (liveProcessEventTimerRef.current !== null) return;
    const nextEvent = liveProcessEventQueueRef.current.shift();
    if (!nextEvent) return;
    liveProcessEventTimerRef.current = window.setTimeout(() => {
      liveProcessEventTimerRef.current = null;
      mergeRunEventForProjection(nextEvent);
      pumpLiveProcessEventQueue();
    }, liveProcessEventDelay(nextEvent));
  }

  function dispatchExecutionEvent(event: ExecutionEvent) {
    const normalized = normalizeRunEvent(event);
    const eventType = normalized.type || event.type || event.event || '';
    if (normalized.runId && normalized.conversationId) {
      runConversationIDsRef.current.set(normalized.runId, normalized.conversationId);
    }
    const eventConversationID = normalized.conversationId
      || (normalized.runId ? runConversationIDsRef.current.get(normalized.runId) || '' : '');
    const eventIsVisible = executionEventIsVisible({
      eventConversationID,
      currentConversationID: currentConversationIDRef.current,
      activeSubmissionKeys: activeSubmissionKeysRef.current,
    });
    if (normalized.runId && eventType !== 'assistant.delta' && eventType !== 'model.delta') {
      if (eventIsVisible && eventType !== 'run.started' && shouldRevealLiveProcessEvent(normalized)) {
        enqueueLiveProcessEvent(normalized);
      } else {
        mergeRunEventForProjection(normalized);
      }
    }

    if (!eventType || !eventIsVisible) return;

    if (eventType === 'run.started') {
      setActiveExecutionStatus('running');
      receivedAssistantDeltaRef.current = false;
      receivedAssistantDeltaRunIDRef.current = '';
      resetStreamingAssistantQueue();
      resetLiveProcessEventQueue();
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
      void desktopApi.listConfirmations()
        .then((result) => setConfirmations(result.items ?? []))
        .catch(() => undefined);
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
      const conversationID = eventConversationID || pendingConversationIDRef.current || currentConversationIDRef.current || 'pending-conversation';
      receivedAssistantDeltaRef.current = true;
      receivedAssistantDeltaRunIDRef.current = runID;
      const streamSource = String(normalized.delta.stream_source || '');
      enqueueAssistantText({
        id: messageID,
        conversation_id: conversationID,
        role: 'assistant',
        content: '',
        run_id: runID,
      }, text, streamSource === 'fallback_final_chunk' || text.length > 80);
      return;
    }

    if (eventType === 'assistant.completed') {
      if (normalized.status === 'waiting_approval') return;
      const text = String(normalized.delta.text ?? event.text ?? event.delta ?? '');
      if (normalized.runId) {
        assistantCompletedRunIDsRef.current.add(normalized.runId);
        clearRunCompletedFallback(normalized.runId);
      }
      if (text && !receivedAssistantDeltaRef.current) {
        receivedAssistantDeltaRef.current = true;
        receivedAssistantDeltaRunIDRef.current = normalized.runId;
      }
      completeStreamingAssistant(normalized.runId, text);
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
        savedModelList,
        desktopSettings,
        secrets,
        onboardingStatus,
      ] = await Promise.all([
        desktopApi.listPersonaMessenger(),
        desktopApi.listConversations({ view: 'active', limit: 100 }),
        desktopApi.listConversations({ view: 'archived', limit: 100 }),
        desktopApi.listConversations({ view: 'trash', limit: 100 }),
        desktopApi.listSavedModels({}),
        desktopApi.getSettings(),
        desktopApi.getSecretStatus(),
        desktopApi.getOnboardingStatus(),
      ]);
      setMessenger(messengerSnapshot);
      const primaryRoom = selectPrimaryJoiRoom(messengerSnapshot);
      setCurrentRoomID(primaryRoom?.id ?? '');
      const nextConversations = conversationList.conversations ?? [];
      const nextVisibleConversations = visibleSingleAgentConversations(nextConversations, messengerSnapshot);
      setConversations(nextConversations);
      if (!initialConversationSelectionRef.current) {
        initialConversationSelectionRef.current = true;
        const initialConversation = nextVisibleConversations.find((item) => item.id === primaryRoom?.conversation_id)
          ?? nextVisibleConversations[0];
        if (initialConversation && !newThreadRequestedRef.current) {
          void loadConversation(initialConversation.id);
        }
      }
      setArchivedConversations(archivedConversationList.conversations ?? []);
      setTrashedConversations(trashedConversationList.conversations ?? []);
      setSavedModels(savedModelList.models ?? []);
      setSettings(desktopSettings);
      setSecretStatus(secrets);
      setOnboarding(onboardingStatus);

      const [
        capabilityList,
        workflowList,
        mcpServerList,
        skillList,
        pluginList,
        toolRunList,
        workspaceConfig,
        systemHealth,
        runClosureReport,
        handoffAudit,
        memoryList,
        memorySystemSnapshot,
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
        confirmationList,
        backupList,
      ] = await Promise.all([
        desktopApi.listCapabilities(),
        desktopApi.listToolWorkflows(),
        desktopApi.listMCPServers(),
        desktopApi.listSkills(),
        desktopApi.listPlugins(),
        desktopApi.listToolRuns(),
        desktopApi.getWorkspaceSettings(),
        desktopApi.getSystemHealth(),
        desktopApi.getRecentRunClosureReport({ limit: 50 }),
        desktopApi.getExternalHandoffAudit(),
        desktopApi.listMemories({ query: memoryQuery, limit: 50 }),
        desktopApi.getMemorySystem(),
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
        desktopApi.listConfirmations(),
        desktopApi.listBackups(),
      ]);
      setCapabilities(capabilityList.capabilities ?? []);
      setWorkflows(workflowList.workflows ?? []);
      setMCPServers(mcpServerList.servers ?? []);
      setSkills(skillList.skills ?? []);
      setPlugins(pluginList.plugins ?? []);
      setToolRuns(toolRunList.tool_runs ?? []);
      setWorkspaceSettings(workspaceConfig);
      setHealth(systemHealth);
      setClosureReport(runClosureReport);
      setExternalHandoffAudit(handoffAudit);
      setMemories(memoryList.memories ?? []);
      setMemoryMetrics(memoryList.metrics ?? null);
      setMemorySystem(memorySystemSnapshot);
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
      setConfirmations(confirmationList.items ?? []);
      setBackups(backupList.backups ?? []);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshChatIndex() {
    const [messengerSnapshot, conversationList] = await Promise.all([
      desktopApi.listPersonaMessenger(),
      desktopApi.listConversations({ view: 'active', limit: 100 }),
    ]);
    setMessenger(messengerSnapshot);
    setCurrentRoomID(selectPrimaryJoiRoom(messengerSnapshot)?.id ?? '');
    setConversations(conversationList.conversations ?? []);
  }

  async function syncMCPServer(serverID: string) {
    setError('');
    try {
      const result = await desktopApi.syncMCPServer(serverID);
      setMCPServers((current) => current.map((server) => (server.id === serverID ? result.server : server)));
      showNotice('MCP 真实连接已验证，工具、资源与 Prompt 清单已刷新。');
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
    const submissionConversationID = currentConversationIDRef.current;
    const submissionKey = submissionKeyForConversation(submissionConversationID);
    const currentlySubmitting = shouldQueueConversationSubmission(activeSubmissionKeysRef.current, submissionConversationID);
    const currentActiveRunID = latestActiveRunId(runEventsByRunId, submissionConversationID)
      || (currentlySubmitting ? chat?.run_id || trace?.id || '' : '');
    if (currentlySubmitting) {
      if (!currentActiveRunID) return;
      setMessage('');
      clearComposerAttachments();
      try {
        const queued = await desktopApi.enqueueRunMessage({
          run_id: currentActiveRunID,
          conversation_id: submissionConversationID || undefined,
          kind: queuedMessageMode,
          content: requestMessage,
          attachments: attachments.map(attachmentForRequest),
        });
        setPendingRunMessages((current) => [...current.filter((item) => item.id !== queued.id), queued]);
        showNotice(queuedMessageMode === 'steering'
          ? '已入队：会在当前运行的下一个可用转折点立即引导。'
          : '已入队：当前运行完成后在同一会话继续。');
      } catch (err) {
        setMessage(prompt);
        setComposerAttachments(attachments);
        showError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const submissionToken = `submission-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const previousChat = chat;
    const previousTrace = trace;
    latestSubmissionByKeyRef.current.set(submissionKey, submissionToken);
    markSubmissionActive(submissionKey, true);
    setChat(null);
    setTrace(null);
    resetStreamingAssistantQueue();
    resetLiveProcessEventQueue();
    setStreamingAssistantMessage(null);
    setActiveExecutionActions([]);
    setActiveExecutionStatus('pending');
    const optimisticActions = createOptimisticExecutionActions(requestMessage);
    const pendingConversationID = currentConversationID || 'pending-conversation';
    pendingConversationIDRef.current = pendingConversationID;
    pendingAssistantIDRef.current = '';
    receivedAssistantDeltaRef.current = false;
    receivedAssistantDeltaRunIDRef.current = '';
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
    const routing = executionRoutingForSettings(workspaceSettings);
    const personaModelName = activeRoom?.type === 'project_dm' ? configuredPersonaModelName(activePersona?.model_strategy) : '';
    const modelName = personaModelName || selectedModelName || settings?.model_name || 'deepseek-v4-flash';

    let result: ChatResponse;
    try {
      await Promise.race([
        new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())),
        sleep(120),
      ]);
      result = await desktopApi.sendChat({
        conversation_id: submissionConversationID || undefined,
        room_id: activeRoom?.id,
        channel: 'desktop',
        user_id: 'desktop_user',
        message: requestMessage,
        attachments: attachments.map(attachmentForRequest),
        mentions: [],
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
    } catch (err) {
      const submissionStillVisible = currentConversationIDRef.current === submissionConversationID;
      if (latestSubmissionByKeyRef.current.get(submissionKey) === submissionToken) {
        latestSubmissionByKeyRef.current.delete(submissionKey);
      }
      markSubmissionActive(submissionKey, false);
      if (submissionStillVisible) {
        resetStreamingAssistantQueue();
        resetLiveProcessEventQueue();
        pendingAssistantIDRef.current = '';
        pendingConversationIDRef.current = '';
        setChat(previousChat);
        setTrace(previousTrace);
        setPendingUserMessage(null);
        setStreamingAssistantMessage(null);
        setActiveExecutionActions([]);
        setActiveExecutionStatus('failed');
        setMessage(prompt);
        setComposerAttachments(attachments);
        showError(err instanceof Error ? err.message : String(err));
      } else {
        showNotice('原会话中的消息执行失败，可在 Today 中查看并恢复。');
      }
      return;
    }

    if (currentConversationIDRef.current !== submissionConversationID) {
      if (latestSubmissionByKeyRef.current.get(submissionKey) === submissionToken) {
        latestSubmissionByKeyRef.current.delete(submissionKey);
      }
      markSubmissionActive(submissionKey, false);
      if (result.run_id && result.conversation_id) {
        runConversationIDsRef.current.set(result.run_id, result.conversation_id);
      }
      showNotice('消息已在原会话完成。');
      void refreshChatIndex().catch(() => undefined);
      return;
    }

    latestSubmissionByKeyRef.current.delete(submissionKey);
    latestSubmissionByKeyRef.current.set(submissionKeyForConversation(result.conversation_id), result.run_id);
    runConversationIDsRef.current.set(result.run_id, result.conversation_id);
    setChat(result);
    setTrace(null);
    pendingAssistantIDRef.current = result.assistant_message_id;
    pendingConversationIDRef.current = result.conversation_id;
    newThreadRequestedRef.current = false;
    setCurrentConversationView(result.conversation_id);
    setPendingUserMessage((current) => current ? {
      ...current,
      id: result.user_message_id,
      conversation_id: result.conversation_id,
    } : current);
    if (result.product_task?.id) setActiveProductTaskID(result.product_task.id);
    if (result.artifacts?.[0]?.id) {
      setArtifacts((current) => [result.artifacts![0], ...current.filter((item) => item.id !== result.artifacts![0].id)]);
    }

    const committedMessages: ConversationMessage[] = [
      {
        id: result.user_message_id,
        conversation_id: result.conversation_id,
        role: 'user',
        content: prompt,
        attachments,
      },
      {
        id: result.assistant_message_id,
        conversation_id: result.conversation_id,
        role: 'assistant',
        content: result.response,
        run_id: result.run_id,
      },
    ];
    setConversationMessages((current) => mergeConversationMessages(current, committedMessages));
    setPendingUserMessage(null);
    resetLiveProcessEventQueue();
    resetStreamingAssistantQueue();
    setStreamingAssistantMessage(null);
    setActiveExecutionStatus('completed');
    setMessage('');
    markSubmissionActive(submissionKey, false);

    try {
      const [taskResult, traceResult, conversationResult] = await Promise.allSettled([
        result.product_task?.id ? desktopApi.getProductTask(result.product_task.id) : Promise.resolve(null),
        desktopApi.getRunTrace(result.run_id),
        desktopApi.getConversation(result.conversation_id),
      ]);

      if (
        latestSubmissionByKeyRef.current.get(submissionKeyForConversation(result.conversation_id)) !== result.run_id
        || currentConversationIDRef.current !== result.conversation_id
      ) return;

      if (taskResult.status === 'fulfilled' && taskResult.value) {
        setActiveProductTaskDetail(taskResult.value);
      }
      if (traceResult.status === 'fulfilled') {
        const runTrace = traceResult.value;
        setTrace(runTrace);
        setRunEventsByRunId((current) => mergeRunEvents(current, result.run_id, normalizeTraceEvents(runTrace)));
        setActiveExecutionActions(visibleExecutionActions(projectRunTraceToActions(runTrace)));
        setActiveExecutionStatus(normalizeRunExecutionStatus(runTrace.status));
      }
      if (conversationResult.status === 'fulfilled') {
        setConversationMessages((current) => mergeConversationMessages(
          current,
          conversationResult.value.messages ?? [],
        ));
        setActiveExecutionActions([]);
        setActiveExecutionStatus('pending');
      }

      const syncFailed = taskResult.status === 'rejected'
        || traceResult.status === 'rejected'
        || conversationResult.status === 'rejected';
      if (syncFailed) showNotice('消息已发送；部分详情会在下次刷新时补齐。');
    } finally {
      if (
        latestSubmissionByKeyRef.current.get(submissionKeyForConversation(result.conversation_id)) === result.run_id
        && currentConversationIDRef.current === result.conversation_id
      ) {
        latestSubmissionByKeyRef.current.delete(submissionKeyForConversation(result.conversation_id));
        pendingAssistantIDRef.current = '';
        pendingConversationIDRef.current = '';
        void refreshChatIndex().catch(() => undefined);
      }
    }
  }

  async function applyLoadedConversation(detail: ConversationDetail, requestID: number): Promise<boolean> {
    if (loadConversationRequestRef.current !== requestID) return false;
    const messages = detail.messages ?? [];
    const latestRunID = detail.conversation.latest_run_id || undefined;
    const runTraces = await loadConversationRunTraces(messages, latestRunID);
    if (loadConversationRequestRef.current !== requestID) return false;
    const focusedTrace = latestRunID
      ? runTraces.find((runTrace) => runTrace.id === latestRunID) || null
      : runTraces[runTraces.length - 1] || null;
    newThreadRequestedRef.current = false;
    setCurrentConversationView(detail.conversation.id);
    setConversationMessages(messages);
    setChat(null);
    setTrace(focusedTrace);
    setPendingUserMessage(null);
    setStreamingAssistantMessage(null);
    setActiveExecutionActions([]);
    setActiveExecutionStatus('pending');
    pendingAssistantIDRef.current = '';
    pendingConversationIDRef.current = '';
    if (runTraces.length > 0) {
      setRunEventsByRunId((current) => (
        runTraces.reduce(
          (next, runTrace) => mergeRunEvents(next, runTrace.id, normalizeTraceEvents(runTrace)),
          current,
        )
      ));
    }
    setActiveTab('chat');
    return true;
  }

  async function loadConversation(conversationID: string) {
    const requestID = loadConversationRequestRef.current + 1;
    loadConversationRequestRef.current = requestID;
    setError('');
    setNotice('');
    setLoadingConversationID(conversationID);
    try {
      const detail = await desktopApi.getConversation(conversationID);
      await applyLoadedConversation(detail, requestID);
    } catch (err) {
      if (loadConversationRequestRef.current === requestID) {
        showError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (loadConversationRequestRef.current === requestID) {
        setLoadingConversationID('');
      }
    }
  }

  async function loadConversationForMessage(messageID: string): Promise<boolean> {
    const requestID = loadConversationRequestRef.current + 1;
    loadConversationRequestRef.current = requestID;
    setError('');
    setNotice('');
    setLoadingConversationID('');
    const detail = await findConversationDetailForMessage(messageID);
    if (loadConversationRequestRef.current !== requestID) return false;
    setLoadingConversationID(detail.conversation.id);
    try {
      return await applyLoadedConversation(detail, requestID);
    } finally {
      if (loadConversationRequestRef.current === requestID) {
        setLoadingConversationID('');
      }
    }
  }

  async function createAutomationWithJoi(request: string): Promise<void> {
    setError('');
    setNotice('');
    const instruction = [
      '你正在帮助用户创建 Joi 已安排任务。',
      '先确认任务目标、时间安排、时区、执行方式和目标上下文；信息不足时必须调用 request_user_input，只问一个最关键的问题并给出 2-3 个互斥选项。',
      '信息足够后调用 automation_update，mode 必须是 suggested_create。它只会生成暂停草稿，用户会在“已安排”页面审核并启用。',
      'cron 表示每次运行创建新任务；heartbeat 表示继续一个现有任务，必须提供 target_thread_id。',
      `用户需求：${request}`,
    ].join('\n');
    try {
      const setupModel = automationSetupModelRoute(settings, savedModels);
      if (!setupModel?.hostToolRuntime) {
        throw new Error('使用 Joi 创建已安排任务需要一个已配置、可调用 Joi 工具的 API 模型。请先在“模型”中配置 DeepSeek、OpenAI 或 xAI。');
      }
      const response = await desktopApi.sendChat({
        channel: 'automation_setup',
        user_id: 'desktop_user',
        message: instruction,
        model_provider: setupModel.provider,
        model_name: setupModel.model,
        model_base_url: setupModel.baseURL,
        reasoning_effort: setupModel.reasoningEffort,
        input_mode: 'chat_assist',
        runtime_mode: 'tool_calling',
        permission_profile: 'read_only',
      });
      await refreshAll();
      await loadConversation(response.conversation_id);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
      throw error;
    }
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
    setCurrentConversationView('');
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
        setCurrentConversationView(conversation.conversation.id);
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

  async function resolveTodayRecovery(runID: string, action: 'retry' | 'abandon') {
    setCheckpointBusy(true);
    try {
      const result = await desktopApi.resolveRecoverableRun({
        run_id: runID,
        action,
        reason: action === 'abandon' ? 'abandoned from Today' : 'retried from Today',
      });
      if (result.new_run) {
        setChat(result.new_run);
        await loadConversation(result.new_run.conversation_id);
        showNotice('已从安全检查点继续任务');
      } else {
        showNotice('已结束该中断任务，保留原运行记录');
      }
      await refreshAll();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckpointBusy(false);
    }
  }

  async function decideTodayOpenLoop(id: string, action: 'done' | 'snooze') {
    setCheckpointBusy(true);
    try {
      await desktopApi.decideOpenLoop({ id, action, feedback: `today_${action}` });
      await refreshAll();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckpointBusy(false);
    }
  }

  async function decideTodayProactiveMessage(id: string, action: 'approve' | 'dismiss') {
    setCheckpointBusy(true);
    try {
      await desktopApi.decideProactiveMessage({ id, action, feedback: `today_${action}` });
      await refreshAll();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckpointBusy(false);
    }
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
      await refreshAll();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckpointBusy(false);
    }
  }

  async function decideConfirmation(id: string, approve: boolean, scope: 'one_call' | 'current_run' = 'one_call') {
    try {
      const runID = confirmations.find((item) => item.id === id)?.run_id || trace?.id || chat?.run_id || '';
      await desktopApi.decideConfirmation({
        id,
        approve,
        actor: 'desktop_user',
        reason: approve ? `approved_in_desktop:${scope}` : 'rejected_in_desktop',
        scope,
      });
      if (runID) {
        const runTrace = await desktopApi.getRunTrace(runID);
        setTrace(runTrace);
        setRunEventsByRunId((current) => mergeRunEvents(current, runID, normalizeTraceEvents(runTrace)));
      }
      await refreshAll();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancelRun(runID: string) {
    if (!runID) return;
    await desktopApi.interruptRun({ run_id: runID, reason: 'cancelled_in_desktop' });
    showNotice(`已请求中断运行：${compactIdentifier(runID)}`);
  }

  async function cancelQueuedRunMessage(messageID: string, runID: string) {
    try {
      const cancelled = await desktopApi.cancelRunMessage({ id: messageID, run_id: runID });
      setPendingRunMessages((current) => current.filter((item) => item.id !== cancelled.id));
      showNotice('已取消尚未交给模型的追加消息。');
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
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
    setLoadingConversationID('');
    newThreadRequestedRef.current = true;
    Object.keys(runCompletedFallbackTimersRef.current).forEach(clearRunCompletedFallback);
    setActiveTab('chat');
    setChat(null);
    setTrace(null);
    setCurrentConversationView('');
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
    setThreadSearchOpen(false);
    setThreadQuery('');
    pendingAssistantIDRef.current = '';
    pendingConversationIDRef.current = '';
    receivedAssistantDeltaRef.current = false;
    receivedAssistantDeltaRunIDRef.current = '';
  }

  function toggleSidebarCollapsed() {
    setSidebarPreference(sidebarCollapsed ? 'expanded' : 'collapsed');
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
    <main ref={shellRef} data-theme="light" className={`im-app-shell app-shell ${visibleSidebarCollapsed ? 'sidebar-collapsed' : ''} ${inSettingsArea ? 'settings-mode' : ''} ${immersiveMode ? 'immersive-mode' : ''}`} style={shellStyle}>
      {inSettingsArea ? (
        <SettingsWindowTitlebar
          activeCategory={settingsCategory}
          activeObjectID={settingsObjectByCategory[settingsCategory]}
          automations={automations}
          collapsed={visibleSidebarCollapsed}
          goBack={() => setActiveTab('chat')}
          nodes={nodes}
          selectSettingsObject={selectSettingsObject}
          toggleCollapsed={toggleSidebarCollapsed}
        />
      ) : (
        <SidebarTopControls
          collapsed={visibleSidebarCollapsed}
          newThread={startNewChat}
          searchOpen={threadSearchOpen}
          toggleSearch={() => setThreadSearchOpen((current) => !current)}
          toggleCollapsed={toggleSidebarCollapsed}
        />
      )}
      {inSettingsArea ? (
        <SettingsSidebar
          activeCategory={settingsCategory}
          collapsed={visibleSidebarCollapsed}
          selectSettingsObject={selectSettingsObject}
        />
      ) : (
        <ConversationSidebar
          activeTab={activeTab}
          archiveConversation={archiveConversation}
          chat={chat}
          checkpointCount={messenger?.checkpoint.items.filter(isVisibleTodayCheckpointItem).length ?? 0}
          collapsed={visibleSidebarCollapsed}
          conversations={filteredConversations}
          currentConversationID={currentConversationID}
          loadingConversationID={loadingConversationID}
          loadConversation={loadConversation}
          openToday={() => {
            setArtifactViewer(null);
            setActiveTab('today');
            void refreshAll();
          }}
          query={threadQuery}
          searchOpen={threadSearchOpen}
          setQuery={setThreadQuery}
          setActiveTab={setActiveTab}
          trace={trace}
        />
      )}
      {!visibleSidebarCollapsed && !inSettingsArea && <div aria-label="调整侧边栏宽度" className="sidebar-resizer" role="separator" onPointerDown={startSidebarResize} />}

      <section className="im-workspace app__editor tk-content-panel">
        {!immersiveMode ? (
          <NotificationStack
            chatOffset={activeTab === 'chat' && !onboarding?.required}
            error={error}
            errorKey={errorKey}
            notice={notice}
            noticeKey={noticeKey}
            onDismissError={() => setError('')}
            onDismissNotice={() => setNotice('')}
          />
        ) : null}

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
              currentThreadChannel={currentConversation?.channel || ''}
              currentThreadTitle={currentConversation ? conversationTitle(currentConversation) : ''}
              attachments={composerAttachments}
              artifacts={artifacts}
              activeExecutionActions={activeExecutionActions}
              autoRightPanelCollapsed={autoRightPanelCollapsed}
              chat={chat}
              conversationMessages={conversationMessages}
              currentConversationID={currentConversationID}
              cancelRun={cancelRun}
              continueProductTask={continueProductTask}
              decideConfirmation={decideConfirmation}
              decideProactiveMessage={decideProactiveMessage}
              health={health}
              inputMode={inputMode}
              immersiveMode={immersiveMode}
              isSubmitting={isSubmitting}
              memories={memories}
              messenger={messenger}
              openArtifact={openArtifact}
              openLoops={openLoops}
              openRunTrace={openRunTrace}
              openConversation={loadConversation}
              loadConversationForMessage={loadConversationForMessage}
              lastPrompt={lastPrompt}
              message={message}
              pendingUserMessage={pendingUserMessage}
              pendingRunMessages={pendingRunMessages}
              queuedMessageMode={queuedMessageMode}
              streamingAssistantMessage={streamingAssistantMessage}
              proactiveMessages={proactiveMessages}
              productTasks={productTasks}
              runEventsByRunId={runEventsByRunId}
              savedModels={savedModels}
              sidebarCollapsed={visibleSidebarCollapsed}
              selectProductTask={selectProductTask}
              settings={settings}
              roomRouteLock={roomRouteLock}
              setActiveTab={setActiveTab}
              addAttachments={addComposerAttachments}
              setMessage={setMessage}
              setQueuedMessageMode={setQueuedMessageMode}
              cancelQueuedRunMessage={cancelQueuedRunMessage}
              removeAttachment={removeComposerAttachment}
              startRightPanelResize={startRightPanelResize}
              updateMemory={updateMemory}
              submit={submit}
              toggleImmersiveMode={() => setImmersiveMode((current) => !current)}
              toggleSidebarCollapsed={toggleSidebarCollapsed}
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

        {!onboarding?.required && activeTab === 'today' && (
          <TodayCheckpointPage
            busy={checkpointBusy}
            checkpoint={messenger?.checkpoint ?? null}
            onComplete={() => void completeTodayCheckpoint()}
            onDecideApproval={(id, approve) => void decideConfirmation(id, approve)}
            onDecideOpenLoop={(id, action) => void decideTodayOpenLoop(id, action)}
            onDecideProactive={(id, action) => void decideTodayProactiveMessage(id, action)}
            onOpenArtifact={(id) => {
              setActiveTab('chat');
              void openArtifact(id);
            }}
            onOpenRun={(id) => void openRunTrace(id, 'stage')}
            onOpenTask={(id) => void selectProductTask(id)}
            onResolveRecovery={(id, action) => void resolveTodayRecovery(id, action)}
            sidebarCollapsed={sidebarCollapsed}
            toggleSidebarCollapsed={toggleSidebarCollapsed}
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

        {!onboarding?.required && activeTab !== 'chat' && activeTab !== 'today' && activeTab !== 'trace' && (
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
              conversations={conversations}
              closureReport={closureReport}
              continueProductTaskByID={continueProductTaskByID}
              externalHandoffAudit={externalHandoffAudit}
              createBackup={createBackup}
              decideConfirmation={decideConfirmation}
              firstModelCall={firstModelCall}
              health={health}
              memories={memories}
              memoryMetrics={memoryMetrics}
              memorySystem={memorySystem}
              memoryQuery={memoryQuery}
              mcpServers={mcpServers}
              nodes={nodes}
              plugins={plugins}
              refreshAll={refreshAll}
              openConversation={loadConversation}
              createAutomationWithJoi={createAutomationWithJoi}
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
  const layer = useLayerLifecycle<HTMLElement>(onClose);

  async function saveAndClose() {
    await onSave();
    layer.requestClose();
  }

  return (
    <div
      className={`settings-modal-backdrop ui-layer${layer.isClosing ? ' is-closing' : ''}`}
      role="presentation"
      onMouseDown={layer.requestClose}
    >
      <section
        ref={layer.surfaceRef}
        className={`settings-modal ui-dialog-surface${layer.isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-settings-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-modal-header">
          <div>
            <small>模型配置</small>
            <h2 id="model-settings-title">{draft.display_name || draft.model_id}</h2>
            <p>{draft.model_id}</p>
          </div>
          <button className="modal-close-button" type="button" aria-label="关闭弹窗" onClick={layer.requestClose}>×</button>
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
            <input data-layer-initial-focus value={draft.display_name} onChange={(event) => setDraft({ display_name: event.target.value })} />
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
            <span>最大回复长度</span>
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
          <button className="secondary-button" type="button" onClick={layer.requestClose}>取消</button>
          <button type="button" onClick={() => void saveAndClose()}>确认保存</button>
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
  selectSettingsObject: SelectSettingsObject;
}) {
  return (
    <aside
      aria-hidden={collapsed || undefined}
      className="im-sidebar settings-sidebar app__sidebar tk-sidebar"
      inert={collapsed ? true : undefined}
    >
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
  conversations,
  closureReport,
  continueProductTaskByID,
  externalHandoffAudit,
  createBackup,
  decideConfirmation,
  firstModelCall,
  health,
  memories,
  memoryMetrics,
  memorySystem,
  memoryQuery,
  mcpServers,
  nodes,
  plugins,
  refreshAll,
  openConversation,
  createAutomationWithJoi,
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
  conversations: ConversationSummary[];
  closureReport: RunClosureReport | null;
  continueProductTaskByID: (id: string) => Promise<void>;
  externalHandoffAudit: ExternalHandoffAudit | null;
  createBackup: () => Promise<void>;
  decideConfirmation: (id: string, approve: boolean) => Promise<void>;
  firstModelCall?: ModelCall;
  health: SystemHealth | null;
  memories: MemoryRecord[];
  memoryMetrics: MemoryQualityMetrics | null;
  memorySystem: MemorySystemSnapshot | null;
  memoryQuery: string;
  mcpServers: MCPServerRecord[];
  nodes: NodeRecord[];
  plugins: PluginRecord[];
  refreshAll: () => Promise<void>;
  openConversation: (id: string) => Promise<void>;
  createAutomationWithJoi: (request: string) => Promise<void>;
  restoreBackup: (path: string) => Promise<void>;
  restoreConversation: (conversationID: string) => Promise<void>;
  rotateWorkerToken: () => Promise<void>;
  savedModels: AvailableModel[];
  secretStatus: SecretStatus | null;
  selectSettingsObject: SelectSettingsObject;
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
  const objectItems = getSettingsObjects(activeCategory, nodes, automations);
  const activeObject = objectItems.find((item) => item.id === activeObjectID) ?? objectItems[0];
  const modelPreset = modelProviderPresets[activeObject.id] ?? modelProviderPresets.compatible;
  const [provider, setProvider] = useState(modelPreset.provider);
  const [modelBaseURL, setModelBaseURL] = useState(modelPreset.baseURL);
  const [modelName, setModelName] = useState(modelPreset.defaultModel);
  const [reasoningModel, setReasoningModel] = useState(modelPreset.reasoningModel);
  const [modelReasoningEffort, setModelReasoningEffort] = useState(settings?.model_reasoning_effort || 'low');
  const [modelApiKey, setModelApiKey] = useState('');
  const [modelApiKeyVisible, setModelApiKeyVisible] = useState(false);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [modelSettingsDraft, setModelSettingsDraft] = useState<ModelSettingsDraft | null>(null);
  const [modelTimeout, setModelTimeout] = useState('60');
  const [modelRetryCount, setModelRetryCount] = useState('3');
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
  const [webSearchProvider, setWebSearchProvider] = useState(workspaceSettings?.web_search_provider || 'auto');
  const [braveSearchApiKey, setBraveSearchApiKey] = useState('');
  const [braveSearchApiKeyVisible, setBraveSearchApiKeyVisible] = useState(false);
  const [webSearchTestQuery, setWebSearchTestQuery] = useState('OpenAI news');
  const [allowedRootsText, setAllowedRootsText] = useState((workspaceSettings?.allowed_roots ?? []).join('\n'));
  const [defaultRoot, setDefaultRoot] = useState(workspaceSettings?.default_root ?? '');
  const [fileMaxBytes, setFileMaxBytes] = useState(String(workspaceSettings?.file_analyze_max_bytes ?? 10_485_760));
  const [browserEnabled, setBrowserEnabled] = useState(workspaceSettings?.browser_enabled ?? true);
  const [browserHostsText, setBrowserHostsText] = useState((workspaceSettings?.browser_allowed_hosts ?? []).join(', '));
  const [browserPrivateHosts, setBrowserPrivateHosts] = useState(workspaceSettings?.web_research_allow_private_hosts ?? false);
  const [browserWorkbenchURL, setBrowserWorkbenchURL] = useState('https://example.com');
  const [browserWorkbenchSelector, setBrowserWorkbenchSelector] = useState('body');
  const [browserWorkbenchText, setBrowserWorkbenchText] = useState('');
  const [browserWorkbenchSessionID, setBrowserWorkbenchSessionID] = useState('');
  const [browserWorkbenchResult, setBrowserWorkbenchResult] = useState<BrowserWorkbenchResult | null>(null);
  const [browserWorkbenchBusy, setBrowserWorkbenchBusy] = useState('');
  const [githubDefaultRepo, setGithubDefaultRepo] = useState(workspaceSettings?.github_default_repo ?? '');
  const [githubApiBaseURL, setGithubApiBaseURL] = useState(workspaceSettings?.github_api_base_url ?? 'https://api.github.com');
  const [githubToken, setGithubToken] = useState('');
  const [githubTokenVisible, setGithubTokenVisible] = useState(false);
  const [pluginManifestPath, setPluginManifestPath] = useState('');
  const [pluginGitHubSource, setPluginGitHubSource] = useState('https://github.com/poer2023/joi-codex-acp-plugin');
  const [pluginBusy, setPluginBusy] = useState('');
  const [pluginTestStatus, setPluginTestStatus] = useState<Record<string, string>>({});
  const [pluginProviderModels, setPluginProviderModels] = useState<Record<string, ACPPluginModelOption[]>>({});
  const [pluginSelectedModels, setPluginSelectedModels] = useState<Record<string, string>>({});
  const [skillQuery, setSkillQuery] = useState('');
  const [skillScope, setSkillScope] = useState('all');
  const [skillDetail, setSkillDetail] = useState<SkillDetailRecord | null>(null);
  const [skillBusy, setSkillBusy] = useState(false);
  const [mcpDraft, setMCPDraft] = useState({ id: '', name: '', transport: 'stdio', command: '', args: '', url: '', env: '', headers: '' });
  const [mcpToolInputs, setMCPToolInputs] = useState<Record<string, string>>({});
  const [mcpToolResults, setMCPToolResults] = useState<Record<string, unknown>>({});
  const [mcpBusy, setMCPBusy] = useState('');
  const [nodeAssignmentPolicy, setNodeAssignmentPolicy] = useState(workspaceSettings?.node_assignment_policy ?? 'main_first');
  const [allowRemoteExecution, setAllowRemoteExecution] = useState(workspaceSettings?.allow_remote_execution ?? false);
  const [privacyLocalOnly, setPrivacyLocalOnly] = useState(workspaceSettings?.privacy_local_only ?? true);
  const [remoteExecutionRequiresConfirmation, setRemoteExecutionRequiresConfirmation] = useState(workspaceSettings?.remote_execution_requires_confirmation ?? true);
  const [diagnosticRedactionEnabled, setDiagnosticRedactionEnabled] = useState(workspaceSettings?.diagnostic_redaction_enabled ?? true);
  const [desktopNotificationsEnabled, setDesktopNotificationsEnabled] = useState(workspaceSettings?.desktop_notifications_enabled ?? true);
  const [desktopNotificationSound, setDesktopNotificationSound] = useState(workspaceSettings?.desktop_notification_sound ?? true);
  const [githubTestStatus, setGithubTestStatus] = useState('');
  const [workerGatewayEnabled, setWorkerGatewayEnabled] = useState(settings?.worker_gateway_enabled ?? true);
  const [memoryControlBusy, setMemoryControlBusy] = useState('');
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
  const [automationTelegramNotify, setAutomationTelegramNotify] = useState(false);
  const [automationTelegramTarget, setAutomationTelegramTarget] = useState('');
  const [automationEndpoint, setAutomationEndpoint] = useState<AutomationWebhookEndpoint | null>(null);
  const [automationBusy, setAutomationBusy] = useState('');
  const automationTelegramReadiness = getAutomationTelegramReadiness({
    telegramEnabled: Boolean(settings?.telegram_enabled),
    tokenStatusKnown: Boolean(secretStatus),
    tokenConfigured: Boolean(secretStatus?.secrets?.TELEGRAM_BOT_TOKEN),
    allowedUserIDs: settings?.telegram_allowed_user_ids || '',
  });
  const automationTelegramTargetError = getAutomationTelegramTargetError({
    enabled: automationTelegramNotify,
    chatID: automationTelegramTarget,
    allowedChatIDs: automationTelegramReadiness.allowedChatIDs,
  });
  const inbox = memories.filter((memory) => memory.status !== 'rejected' && !isMemoryDisabled(memory) && (memory.status !== 'confirmed' || memory.confidence < 0.6 || Boolean(memory.conflict_group_id) || Boolean(memory.merged_into_memory_id)));
  const confirmedMemories = memories.filter((memory) => memory.status === 'confirmed' && !memory.disabled);
  const conflictedMemories = memories.filter((memory) => Boolean(memory.conflict_group_id));
  const searchedMemories = memories.filter((memory) => {
    if (!memoryQuery.trim()) return true;
    return `${memory.summary} ${memory.content} ${memory.type}`.toLowerCase().includes(memoryQuery.trim().toLowerCase());
  });

  async function saveMemoryControl(patch: Partial<MemorySystemSnapshot['settings']>) {
    setMemoryControlBusy('saving');
    try {
      await desktopApi.saveMemorySettings(patch);
      await refreshAll();
      setNotice('记忆控制已保存。');
    } catch (err) {
      setNotice(`记忆控制保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMemoryControlBusy('');
    }
  }

  async function runMemoryMaintenanceNow() {
    setMemoryControlBusy('maintenance');
    try {
      const result = await desktopApi.runMemoryMaintenance({ trigger_source: 'desktop_ui' });
      await refreshAll();
      setNotice(`记忆维护已完成：处理 ${result.run.processed_input_count} 条输入，生成 ${result.run.generated_observation_count} 条观察。`);
    } catch (err) {
      setNotice(`记忆维护失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMemoryControlBusy('');
    }
  }

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
    setModelReasoningEffort(normalizeReasoningEffortValue(settings?.model_reasoning_effort || 'low'));
    setAvailableModels(models);
    setTestStatus('');
  }, [activeObject.id, savedModels, settings?.model_base_url, settings?.model_name, settings?.model_reasoning_effort, settings?.model_reasoning_name]);

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
    setWebSearchProvider(workspaceSettings?.web_search_provider || 'auto');
    setAllowedRootsText((workspaceSettings?.allowed_roots ?? []).join('\n'));
    setDefaultRoot(workspaceSettings?.default_root ?? '');
    setFileMaxBytes(String(workspaceSettings?.file_analyze_max_bytes ?? 10_485_760));
    setBrowserEnabled(workspaceSettings?.browser_enabled ?? true);
    setBrowserHostsText((workspaceSettings?.browser_allowed_hosts ?? []).join(', '));
    setBrowserPrivateHosts(workspaceSettings?.web_research_allow_private_hosts ?? false);
    setGithubDefaultRepo(workspaceSettings?.github_default_repo ?? '');
    setGithubApiBaseURL(workspaceSettings?.github_api_base_url ?? 'https://api.github.com');
    setNodeAssignmentPolicy(workspaceSettings?.node_assignment_policy ?? 'main_first');
    setAllowRemoteExecution(workspaceSettings?.allow_remote_execution ?? false);
    setPrivacyLocalOnly(workspaceSettings?.privacy_local_only ?? true);
    setRemoteExecutionRequiresConfirmation(workspaceSettings?.remote_execution_requires_confirmation ?? true);
    setDiagnosticRedactionEnabled(workspaceSettings?.diagnostic_redaction_enabled ?? true);
    setDesktopNotificationsEnabled(workspaceSettings?.desktop_notifications_enabled ?? true);
    setDesktopNotificationSound(workspaceSettings?.desktop_notification_sound ?? true);
  }, [workspaceSettings]);

  useEffect(() => {
    setAutomationEndpoint(null);
    const selected = automations.find((automation) => automation.id === activeObject.id);
    if (!selected) {
      const isWebhook = activeObject.id === 'new-webhook';
      const notificationDraft = getAutomationTelegramNotificationDraft(undefined, settings?.telegram_allowed_user_ids || '');
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
      setAutomationTelegramNotify(notificationDraft.enabled);
      setAutomationTelegramTarget(notificationDraft.chatID);
      return;
    }
    const config = selected.trigger_config ?? {};
    const notificationDraft = getAutomationTelegramNotificationDraft(selected, settings?.telegram_allowed_user_ids || '');
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
    setAutomationTelegramNotify(notificationDraft.enabled);
    setAutomationTelegramTarget(notificationDraft.chatID);
  }, [activeObject.id, automations, settings?.telegram_allowed_user_ids]);

  async function saveModelDetail() {
    await desktopApi.saveModelConfig({
      provider,
      base_url: modelBaseURL,
      name: modelName,
      reasoning_name: reasoningModel,
      reasoning_effort: modelReasoningEffort,
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
      setModelReasoningEffort('low');
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
      temperature: String(config?.temperature ?? 0.7),
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
    void refreshAll();
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
    setNotice(`${secretDisplayName(secretName)}已保存到钥匙串`);
    await refreshAll();
  }

  async function saveWebSearchSettings() {
    const base = workspaceSettings ?? defaultWorkspaceSettings();
    await desktopApi.saveWorkspaceSettings({
      ...base,
      web_search_provider: webSearchProvider,
    });
    if (braveSearchApiKey.trim()) {
      await desktopApi.saveSecret({ name: 'BRAVE_SEARCH_API_KEY', value: braveSearchApiKey.trim() });
      setBraveSearchApiKey('');
    }
    setNotice('网页搜索设置已保存');
    await refreshAll();
  }

  async function saveWorkspacePatch(patch: Partial<WorkspaceSettings>, message: string) {
    await desktopApi.saveWorkspaceSettings({
      ...(workspaceSettings ?? defaultWorkspaceSettings()),
      ...patch,
    });
    setNotice(message);
    await refreshAll();
  }

  async function toggleCapability(capability: CapabilityRecord) {
    await desktopApi.setCapabilityEnabled({ id: capability.id, enabled: !capability.enabled });
    setNotice(`${capability.name || capability.id} 已${capability.enabled ? '停用' : '启用'}`);
    await refreshAll();
  }

  async function toggleSkill(skill: SkillRecord) {
    await desktopApi.setSkillEnabled({ id: skill.id, enabled: !skill.enabled });
    setNotice(`${skill.name} 已${skill.enabled ? '停用' : '启用'}`);
    await refreshAll();
  }

  async function reloadSkills() {
    setSkillBusy(true);
    try {
      const result = await desktopApi.reloadSkills();
      await refreshAll();
      setNotice(`Skill 已刷新 · 发现 ${result.discovered_count} 个${result.removed_count ? ` · 移除 ${result.removed_count} 个失效项` : ''}`);
    } catch (error) {
      setNotice(`Skill 刷新失败 · ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSkillBusy(false);
    }
  }

  async function inspectSkill(skill: SkillRecord) {
    setSkillBusy(true);
    try {
      setSkillDetail(await desktopApi.getSkill(skill.id));
    } catch (error) {
      setNotice(`Skill 读取失败 · ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSkillBusy(false);
    }
  }

  async function copySkillInvocation(skill: SkillRecord) {
    const invocation = String(skill.metadata?.invocation_name || `$${skill.name}`);
    await navigator.clipboard.writeText(invocation);
    setNotice(`${invocation} 已复制`);
  }

  async function installPlugin() {
    const path = pluginManifestPath.trim();
    if (!path) {
      setNotice('请输入本地 plugin.json 路径');
      return;
    }
    const result = await desktopApi.installPluginFromManifest(path);
    setPluginManifestPath('');
    setNotice(`${result.plugin.name} 已安装`);
    await refreshAll();
  }

  async function installPluginFromGitHub() {
    const source = pluginGitHubSource.trim();
    if (!source) {
      setNotice('请输入 GitHub 插件地址');
      return;
    }
    setPluginBusy('github-install');
    try {
      const result = await desktopApi.installPluginFromGitHub({ source });
      setNotice(`${result.plugin.name} 已从 GitHub 安装`);
      await refreshAll();
    } catch (error) {
      setNotice(`GitHub 安装失败 · ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPluginBusy('');
    }
  }

  async function testPluginProvider(plugin: PluginRecord, provider: PluginProviderConfig) {
    const key = `${plugin.id}:${provider.id}`;
    setPluginBusy(`test:${key}`);
    setPluginTestStatus((current) => ({ ...current, [key]: '测试中' }));
    try {
      const result = await desktopApi.testPluginProvider({ plugin_id: plugin.id, provider_id: provider.id });
      const testedModels = mergeACPPluginModels(result.models);
      if (result.ok && testedModels.length > 0) {
        setPluginProviderModels((current) => ({ ...current, [key]: testedModels }));
        setPluginSelectedModels((current) => ({
          ...current,
          [key]: selectACPPluginModel(testedModels, [
            current[key],
            settings?.model_provider === provider.id ? settings.model_name : undefined,
            result.current_model,
            provider.default_model,
          ]),
        }));
      }
      const models = testedModels.length > 0
        ? `${testedModels.length} 个模型${result.current_model ? ` · 当前 ${result.current_model}` : ''}`
        : '由 Codex 账户决定';
      const message = result.ok
        ? `可用 · ${result.agent_name || 'ACP agent'} ${result.agent_version || ''} · ${models}`
        : `失败 · ${result.error_summary || result.status}`;
      setPluginTestStatus((current) => ({ ...current, [key]: message }));
      setNotice(`${provider.name}：${message}`);
    } finally {
      setPluginBusy('');
    }
  }

  async function usePluginProvider(plugin: PluginRecord, provider: PluginProviderConfig) {
    const key = `${plugin.id}:${provider.id}`;
    const configuredModel = settings?.model_provider === provider.id ? settings.model_name : undefined;
    const models = mergeACPPluginModels(
      pluginProviderModels[key],
      provider.models,
      configuredModel ? [{ id: configuredModel, name: configuredModel }] : undefined,
    );
    const selectedModel = selectACPPluginModel(models, [pluginSelectedModels[key], configuredModel, provider.default_model]);
    await desktopApi.saveModelConfig(acpPluginModelConfig(provider.id, selectedModel));
    setPluginSelectedModels((current) => ({ ...current, [key]: selectedModel }));
    setNotice(`${provider.name} · ${selectedModel} 已设为当前模型入口`);
    await refreshAll();
  }

  async function togglePlugin(plugin: PluginRecord) {
    await desktopApi.setPluginEnabled({ id: plugin.id, enabled: !plugin.enabled });
    setNotice(`${plugin.name} 已${plugin.enabled ? '停用' : '启用'}`);
    await refreshAll();
  }

  async function removePlugin(plugin: PluginRecord) {
    if (!window.confirm(`移除插件“${plugin.name}”？插件注册的能力、Skill 与 MCP 配置也会一并移除。`)) return;
    await desktopApi.removePlugin(plugin.id);
    setNotice(`${plugin.name} 已移除`);
    await refreshAll();
  }

  async function saveMCPDraft() {
    const command = mcpDraft.command.trim();
    const url = mcpDraft.url.trim();
    if (mcpDraft.transport === 'stdio' && !command) {
      setNotice('MCP stdio server 必须填写命令');
      return;
    }
    if (mcpDraft.transport !== 'stdio' && !url) {
      setNotice('远程 MCP server 必须填写 URL');
      return;
    }
    try {
      const seed = command || new URL(url).hostname;
      const id = mcpDraft.id.trim() || `mcp_${seed.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()}`;
      await desktopApi.saveMCPServer({
        id,
        name: mcpDraft.name.trim() || id,
        transport: mcpDraft.transport,
        command: mcpDraft.transport === 'stdio' ? command : undefined,
        args: mcpDraft.transport === 'stdio' ? splitCommandArguments(mcpDraft.args) : undefined,
        url: mcpDraft.transport === 'stdio' ? undefined : url,
        env: parseStringJSONObject(mcpDraft.env, '环境变量'),
        headers: parseStringJSONObject(mcpDraft.headers, 'HTTP Headers'),
        enabled: true,
        trust: 'untrusted_until_wrapped',
      });
      setMCPDraft({ id: '', name: '', transport: 'stdio', command: '', args: '', url: '', env: '', headers: '' });
      setNotice('MCP Server 已保存，下一步可建立真实连接并同步清单');
      await refreshAll();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }

  async function invokeMCPToolFromSettings(server: MCPServerRecord, toolName: string) {
    const key = `${server.id}:${toolName}`;
    setMCPBusy(key);
    try {
      const inputText = mcpToolInputs[key]?.trim() || '{}';
      const input = parseJSONObject(inputText, `${toolName} 输入`);
      const result = await desktopApi.invokeMCPTool({ server_id: server.id, tool_name: toolName, input, timeout_ms: 60_000 });
      setMCPToolResults((current) => ({ ...current, [key]: result }));
      setNotice(result.is_error ? `MCP ${toolName} 返回错误` : `MCP ${toolName} 已真实执行`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMCPToolResults((current) => ({ ...current, [key]: { error: message } }));
      setNotice(message);
    } finally {
      setMCPBusy('');
    }
  }

  async function runBrowserWorkbench(action: string, extra: Record<string, unknown> = {}) {
    setBrowserWorkbenchBusy(action);
    try {
      const result = await desktopApi.executeBrowserAction({
        action,
        session_id: browserWorkbenchSessionID || undefined,
        visible: true,
        ...extra,
      });
      setBrowserWorkbenchResult(result);
      if (action === 'close') setBrowserWorkbenchSessionID('');
      else if (result.session_id) setBrowserWorkbenchSessionID(result.session_id);
      setNotice(`浏览器 ${action} 已完成`);
      return result;
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBrowserWorkbenchBusy('');
    }
  }

  async function testDesktopNotification() {
    if (!desktopNotificationsEnabled) {
      setNotice('桌面通知已停用，请先启用并保存');
      return;
    }
    if (typeof Notification === 'undefined') {
      setNotice('当前渲染环境不支持系统通知');
      return;
    }
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission !== 'granted') {
      setNotice('macOS 未授予 Joi 通知权限');
      return;
    }
    new Notification('Joi 通知测试', { body: '桌面通知入口工作正常', silent: !desktopNotificationSound });
    setNotice('已发送桌面通知测试');
  }

  async function testWebSearchSettings() {
    const result = await desktopApi.testWebSearch({
      query: webSearchTestQuery.trim() || 'Brave Search API',
      max_results: 3,
    });
    const status = String(result.status || 'unknown');
    const providerLabel = String(result.provider || result.mode || webSearchProvider);
    const count = Number(result.result_count || 0);
    const summary = String(result.summary || '');
    setTestStatus(`网页搜索：${formatStatus(status)} · ${providerLabel} · ${count} 条${summary ? ` · ${summary}` : ''}`);
  }

  async function testGitHubSettings() {
    if (githubToken.trim()) {
      await desktopApi.saveSecret({ name: 'GITHUB_TOKEN', value: githubToken.trim() });
      setGithubToken('');
    }
    await desktopApi.saveWorkspaceSettings({
      ...(workspaceSettings ?? defaultWorkspaceSettings()),
      github_default_repo: githubDefaultRepo.trim(),
      github_api_base_url: githubApiBaseURL.trim() || 'https://api.github.com',
    });
    const result = await desktopApi.testGitHubConnection();
    const message = result.status === 'ok'
      ? `GitHub 已连接${result.login ? ` · ${result.login}` : ''}${result.repository ? ` · ${result.repository}` : ''}${result.rate_limit_remaining !== undefined ? ` · 剩余 ${result.rate_limit_remaining}` : ''}`
      : `GitHub 连接失败 · ${result.error_summary || formatStatus(result.status)}`;
    setGithubTestStatus(message);
    setNotice(message);
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
    if (automationTelegramNotify && !automationTelegramReadiness.ready) {
      setNotice(`Telegram 推送未就绪 · ${automationTelegramReadiness.message}`);
      return;
    }
    if (automationTelegramTargetError) {
      setNotice(automationTelegramTargetError);
      return;
    }
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
        notification_policy: buildAutomationTelegramNotificationPolicy({
          enabled: automationTelegramNotify,
          chatID: automationTelegramTarget,
          allowedUserIDs: settings?.telegram_allowed_user_ids || '',
        }),
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
    if (activeObject.id === 'routing') {
      return <ModelRoutingWorkbench savedModels={savedModels} />;
    }
    if (activeObject.id === 'codex-acp') {
      const providers = plugins.flatMap((plugin) => (
        pluginProviderConfigs(plugin).map((provider) => ({ plugin, provider }))
      )).filter(({ provider }) => provider.protocol === 'acp');
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="Codex ACP" description="使用本机 Codex 登录，通过 ACP 测试连接并获取账户可用模型" />
          <RecordList
            emptyText="尚未安装 Codex ACP provider。请先在“能力与工具 → Plugins”安装 Codex ACP 插件。"
            items={providers}
            renderItem={({ plugin, provider }) => {
              const key = `${plugin.id}:${provider.id}`;
              const providerActive = settings?.model_provider === provider.id;
              const configuredModel = providerActive ? settings?.model_name : undefined;
              const modelOptions = mergeACPPluginModels(
                pluginProviderModels[key],
                provider.models,
                configuredModel ? [{ id: configuredModel, name: configuredModel }] : undefined,
              );
              const selectedModel = selectACPPluginModel(modelOptions, [
                pluginSelectedModels[key],
                configuredModel,
                provider.default_model,
              ]);
              const active = providerActive && settings?.model_name === selectedModel;
              return (
                <article className="row-card" key={key}>
                  <div>
                    <strong>{provider.name}</strong>
                    <p>{provider.description || '认证沿用本机 Codex 登录，无需 API Key 或接口地址。'}</p>
                    <small>{plugin.name} · {provider.protocol.toUpperCase()} · {plugin.enabled ? '已启用' : '已停用'}</small>
                    <label className="field-row">
                      <span>模型</span>
                      <select
                        aria-label={`${provider.name} 模型`}
                        disabled={!plugin.enabled || Boolean(pluginBusy)}
                        value={selectedModel}
                        onChange={(event) => setPluginSelectedModels((current) => ({ ...current, [key]: event.target.value }))}
                      >
                        {modelOptions.map((model) => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}
                      </select>
                    </label>
                    {pluginTestStatus[key] ? <small role="status">{pluginTestStatus[key]}</small> : null}
                  </div>
                  <div className="row-actions">
                    <button type="button" className="secondary-button" disabled={!plugin.enabled || Boolean(pluginBusy)} onClick={() => void testPluginProvider(plugin, provider)}>测试连接</button>
                    <button type="button" className="secondary-button" disabled={!plugin.enabled || Boolean(pluginBusy)} onClick={() => void testPluginProvider(plugin, provider)}>获取模型</button>
                    <button type="button" disabled={!plugin.enabled || active || Boolean(pluginBusy)} onClick={() => void usePluginProvider(plugin, provider)}>{active ? '使用中' : providerActive ? '切换模型' : '设为当前'}</button>
                  </div>
                </article>
              );
            }}
          />
        </section>
      );
    }
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
            <label className="field-row">
              <span>思考等级</span>
              <select value={modelReasoningEffort} onChange={(event) => setModelReasoningEffort(event.target.value)}>
                {reasoningEffortOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
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
    if (activeObject.id === 'voice-video') {
      return <MediaWorkbenchPanel />;
    }
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

    if (activeObject.id === 'desktop-notify') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="桌面通知" description="配置并测试 macOS Notification Center 权限、声音与显示效果" />
          <div className="settings-form">
            <label className="field-row"><span>启用通知</span><input checked={desktopNotificationsEnabled} type="checkbox" onChange={(event) => setDesktopNotificationsEnabled(event.target.checked)} /></label>
            <label className="field-row"><span>播放声音</span><input checked={desktopNotificationSound} type="checkbox" onChange={(event) => setDesktopNotificationSound(event.target.checked)} /></label>
            <div className="detail-actions">
              <button className="secondary-button" type="button" onClick={testDesktopNotification}>发送测试通知</button>
              <button type="button" onClick={() => saveWorkspacePatch({ desktop_notifications_enabled: desktopNotificationsEnabled, desktop_notification_sound: desktopNotificationSound }, '桌面通知设置已保存')}>保存</button>
            </div>
          </div>
        </section>
      );
    }

    if (activeObject.id === 'webhook') {
      const webhookAutomations = automations.filter((automation) => automation.kind === 'webhook');
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="Webhook" description="查看真实的 HMAC 自动化 Hook；Endpoint、Secret 与运行记录由自动化 Runtime 管理" />
          <dl className="metrics">
            <KV label="Hook 数量" value={`${webhookAutomations.length} 个`} />
            <KV label="已启用" value={`${webhookAutomations.filter((automation) => automation.enabled).length} 个`} />
          </dl>
          <RecordList
            emptyText="暂无 Webhook。点击下方按钮创建真实 HMAC Hook。"
            items={webhookAutomations}
            renderItem={(automation) => (
              <article key={automation.id} className="row-card compact">
                <div><strong>{automation.name}</strong><p>{automation.slug} · {automation.enabled ? '已启用' : '已停用'}</p></div>
                <button type="button" onClick={() => selectSettingsObject('automations', automation.id)}>管理</button>
              </article>
            )}
          />
          <div className="detail-actions">
            <button type="button" onClick={() => selectSettingsObject('automations', 'new-webhook')}>新建 HMAC Hook</button>
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
    return (
      <CodexAutomationConsole
        activeObjectID={activeObject.id}
        automations={automations}
        runs={automationRuns}
        triggers={automationTriggers}
        conversations={conversations}
        savedModels={savedModels}
        settings={settings}
        secretStatus={secretStatus}
        workspaceSettings={workspaceSettings}
        selectAutomation={(id) => selectSettingsObject('automations', id)}
        refreshAll={refreshAll}
        setNotice={setNotice}
        openConversation={openConversation}
        createWithJoi={createAutomationWithJoi}
      />
    );
    /* Legacy settings-form implementation is retained below for one release as a source-level rollback reference. */
    const existing = selectedAutomation()!;
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
          <div className="field-row">
            <span>完成后通知</span>
            <div className="connection-status">
              <label className="automation-notification-toggle">
                <input
                  checked={automationTelegramNotify}
                  disabled={!automationTelegramReadiness.ready}
                  type="checkbox"
                  onChange={(event) => {
                    setAutomationTelegramNotify(event.target.checked);
                    if (event.target.checked && !automationTelegramTarget.trim()) {
                      setAutomationTelegramTarget(automationTelegramReadiness.defaultChatID);
                    }
                  }}
                />
                <strong>完成后推送到 Telegram</strong>
              </label>
              <small>{automationTelegramReadiness.message}</small>
            </div>
          </div>
          {automationTelegramNotify && (
            <label className="field-row">
              <span>目标用户 / Chat ID</span>
              <input
                inputMode="numeric"
                placeholder={`默认 ${automationTelegramReadiness.defaultChatID || '白名单首位用户'}`}
                value={automationTelegramTarget}
                onChange={(event) => setAutomationTelegramTarget(event.target.value)}
              />
            </label>
          )}
          {automationTelegramTargetError && <p className="terminal-error" role="alert">{automationTelegramTargetError}</p>}
          <div className="detail-actions">
            <button
              type="button"
              onClick={() => void saveAutomation(kind)}
              disabled={automationBusy === 'save' || Boolean(automationTelegramTargetError) || (automationTelegramNotify && !automationTelegramReadiness.ready)}
            >
              {automationBusy === 'save' ? '保存中' : '保存'}
            </button>
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
              <p className={automationState.banner!.tone === 'error' ? 'terminal-error' : 'logs-notice'}>
                {automationState.banner!.title} · {automationState.banner!.message}
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
                    <KV label="触发地址" value={automationState.webhookUrl || automationEndpoint!.url} />
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
    if (activeObject.id === 'assistant-workspace') {
      return <AssistantWorkspacePanel />;
    }
    if (activeObject.id === 'memory-health') {
      const metrics = memoryMetrics;
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="记忆健康" description="查看召回质量、作用域隔离和候选生命周期，不自动删除数据" />
          <section>
            <h3>硬记忆 · 人格宪法</h3>
            {memorySystem?.constitution ? (
              <article className="row-card compact">
                <strong>{memorySystem.constitution.name} Constitution v{memorySystem.constitution.version} · {memorySystem.constitution.status === 'active' ? '已启用' : formatStatus(memorySystem.constitution.status)}</strong>
                <small>{memorySystem.constitution.identity}</small>
                <small>
                  用户明确编写 · 始终进入稳定提示词 · 不参与自动召回、衰减、合并或删除
                </small>
                <details className="settings-advanced">
                  <summary>查看完整硬记忆</summary>
                  <pre tabIndex={0}>{memorySystem.constitution.compiled_prompt}</pre>
                </details>
              </article>
            ) : <p className="empty">尚未加载 Joi 人格宪法。</p>}
          </section>
          <section>
            <h3>记忆控制</h3>
            <div className="settings-form compact">
              <label className="field-row">
                <span>在回答中使用记忆</span>
                <input
                  checked={memorySystem?.settings.use_memories ?? true}
                  disabled={Boolean(memoryControlBusy)}
                  type="checkbox"
                  onChange={(event) => void saveMemoryControl({ use_memories: event.target.checked })}
                />
              </label>
              <label className="field-row">
                <span>从任务中生成记忆</span>
                <input
                  checked={memorySystem?.settings.generate_memories ?? true}
                  disabled={Boolean(memoryControlBusy)}
                  type="checkbox"
                  onChange={(event) => void saveMemoryControl({ generate_memories: event.target.checked })}
                />
              </label>
              <label className="field-row">
                <span>使用外部内容时停止生成</span>
                <input
                  checked={memorySystem?.settings.disable_on_external_context ?? true}
                  disabled={Boolean(memoryControlBusy)}
                  type="checkbox"
                  onChange={(event) => void saveMemoryControl({ disable_on_external_context: event.target.checked })}
                />
              </label>
            </div>
            <div className="detail-toolbar">
              <button disabled={Boolean(memoryControlBusy)} type="button" onClick={() => void runMemoryMaintenanceNow()}>
                {memoryControlBusy === 'maintenance' ? '正在维护…' : '立即整理记忆'}
              </button>
              <small>
                后台空闲 {memorySystem?.settings.background_idle_seconds ?? 300} 秒后整理 · {memorySystem?.settings.pipeline_version ?? 'memory_os_v4_hygiene'}
              </small>
            </div>
            {memorySystem?.latest_maintenance ? (
              <p className="empty">
                最近维护：{formatStatus(memorySystem.latest_maintenance.status)} · {formatShortTime(memorySystem.latest_maintenance.finished_at || memorySystem.latest_maintenance.started_at)} ·
                处理 {memorySystem.latest_maintenance.processed_input_count} 条，归档 {memorySystem.latest_maintenance.expired_count} 条，合并 {memorySystem.latest_maintenance.merged_count} 条
              </p>
            ) : null}
          </section>
          <dl className="compact-kv">
            <KV label="已确认" value={`${metrics?.confirmed_count ?? 0} 条`} />
            <KV label="待处理" value={`${metrics?.candidate_count ?? 0} 条`} />
            <KV label="召回 / 注入" value={`${metrics?.recalled_count ?? 0} / ${metrics?.injected_count ?? 0}`} />
            <KV label="推断用于回答" value={`${metrics?.used_in_answer_count ?? 0} 条 · ${formatRatio(metrics?.injection_use_rate ?? 0)}`} />
            <KV label="未产生可见影响" value={`${metrics?.unused_injection_count ?? 0} 条`} />
            <KV label="反馈" value={`有效 ${metrics?.positive_feedback_count ?? 0} · 无效 ${metrics?.negative_feedback_count ?? 0}`} />
          </dl>
          <section>
            <h3>作用域分布</h3>
            <div className="table">
              {Object.entries(metrics?.scope_counts ?? {}).length > 0
                ? Object.entries(metrics?.scope_counts ?? {}).map(([scope, count]) => (
                  <article className="row-card compact" key={scope}>
                    <strong>{formatMemoryScope(scope)}</strong>
                    <small>{count} 条已确认记忆</small>
                  </article>
                ))
                : <p className="empty">暂无已确认记忆。</p>}
            </div>
          </section>
          <section>
            <h3>分层分布</h3>
            <div className="table">
              {(['persona', 'profile', 'knowledge', 'state', 'episode'] as const).map((layer) => (
                <article className="row-card compact" key={layer}>
                  <strong>{formatMemoryLayer(layer)}</strong>
                  <small>{metrics?.layer_counts?.[layer] ?? 0} 条{layer === 'persona' ? '用户编写硬记忆' : '已确认记忆'}</small>
                </article>
              ))}
            </div>
          </section>
          <section>
            <h3>生命周期提示</h3>
            <div className="table">
              <article className="row-card compact">
                <strong>{metrics?.old_candidate_count ? `${metrics.old_candidate_count} 条候选等待超过 7 天` : '没有超期候选'}</strong>
                <small>{metrics?.oldest_candidate_at ? `最早候选 ${formatShortTime(metrics.oldest_candidate_at)}` : '候选队列当前为空或都很新'}</small>
              </article>
              <article className="row-card compact">
                <strong>{metrics?.duplicate_candidate_count ? `${metrics.duplicate_candidate_count} 条重复候选需要合并` : '没有重复候选'}</strong>
                <small>重复项仍通过确认、纠正、合并或删除流程治理。</small>
              </article>
              <article className="row-card compact">
                <strong>{metrics?.stale_confirmed_count ? `${metrics.stale_confirmed_count} 条确认记忆超过 90 天未使用` : '没有长期未使用记忆'}</strong>
                <small>这里只提示，不自动停用或物理删除。</small>
              </article>
            </div>
          </section>
        </section>
      );
    }
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
    if (activeObject.id === 'builtin') {
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
    if (activeObject.id === 'builtin') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="内置能力" description="启用或停用 Joi Runtime 已注册的受控能力" />
          <dl className="metrics">
            <KV label="能力总数" value={`${capabilities.length} 个`} />
            <KV label="已启用" value={`${capabilities.filter((item) => item.enabled).length} 个`} />
            <KV label="需要确认" value={`${capabilities.filter((item) => item.risk_level !== 'read_only').length} 个`} />
          </dl>
          <RecordList
            emptyText="暂无已注册能力。"
            items={capabilities}
            renderItem={(capability) => {
              const backend = capabilityBackend(capability);
              return (
                <article key={capability.id} className="row-card compact">
                  <div>
                    <strong>{capability.name || capability.id}</strong>
                    <p>{capability.description || '无描述'}</p>
                    <small>{capability.id} · {formatRiskLevel(capability.risk_level)} · {capabilityBackendLabel(backend)}</small>
                  </div>
                  <button type="button" className={capability.enabled ? 'secondary-button' : ''} disabled={backend !== 'implemented'} onClick={() => void toggleCapability(capability)}>{backend === 'planned' ? '未接后端' : backend === 'alias' ? '随主能力' : capability.enabled ? '停用' : '启用'}</button>
                </article>
              );
            }}
          />
        </section>
      );
    }

    if (activeObject.id === 'skills') {
      const normalizedQuery = skillQuery.trim().toLowerCase();
      const skillScopes = [...new Set(skills.map((skill) => String(skill.metadata?.scope || 'legacy')))];
      const filteredSkills = skills.filter((skill) => {
        const scope = String(skill.metadata?.scope || 'legacy');
        if (skillScope !== 'all' && scope !== skillScope) return false;
        if (!normalizedQuery) return true;
        return [skill.name, skill.description, String(skill.metadata?.path || ''), String(skill.metadata?.invocation_name || '')]
          .some((value) => value.toLowerCase().includes(normalizedQuery));
      });
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="Skills" description="发现并管理 Codex 兼容的 SKILL.md；正文仅在查看或本轮匹配后载入" />
          <dl className="metrics">
            <KV label="已发现" value={`${skills.length} 个`} />
            <KV label="已启用" value={`${skills.filter((item) => item.enabled).length} 个`} />
            <KV label="文件 Skill" value={`${skills.filter((item) => item.metadata?.source === 'filesystem_skill').length} 个`} />
            <KV label="仅显式调用" value={`${skills.filter((item) => item.metadata?.allow_implicit_invocation === false).length} 个`} />
          </dl>
          <div className="detail-toolbar skill-toolbar">
            <input aria-label="搜索 Skill" placeholder="搜索名称、描述或路径" value={skillQuery} onChange={(event) => setSkillQuery(event.target.value)} />
            <select aria-label="Skill 来源" value={skillScope} onChange={(event) => setSkillScope(event.target.value)}>
              <option value="all">全部来源</option>
              {skillScopes.map((scope) => <option key={scope} value={scope}>{skillScopeLabel(scope)}</option>)}
            </select>
            <button type="button" className="secondary-button" disabled={skillBusy} onClick={() => void reloadSkills()}>{skillBusy ? '刷新中…' : '刷新发现'}</button>
          </div>
          {skillDetail ? (
            <article className="skill-detail-card" aria-live="polite">
              <div className="skill-detail-heading">
                <div>
                  <strong>{skillDetail.skill.name}</strong>
                  <small>{String(skillDetail.skill.metadata?.path || '数据库内置 Skill')}</small>
                </div>
                <button type="button" className="secondary-button" onClick={() => setSkillDetail(null)}>关闭详情</button>
              </div>
              <pre tabIndex={0}>{skillDetail.instructions || '该旧版 Skill 没有文件正文。'}</pre>
              <CollapsedData label="Frontmatter 与 agents/openai.yaml" value={{ frontmatter: skillDetail.frontmatter, openai: skillDetail.openai, resources: skillDetail.skill.metadata?.resources }} />
            </article>
          ) : null}
          <RecordList
            emptyText={skills.length ? '没有匹配当前筛选的 Skill。' : '尚未发现 Skill。可在 .agents/skills、~/.agents/skills、~/.codex/skills 或 Plugin 中添加。'}
            items={filteredSkills}
            renderItem={(skill) => {
              const metadata = skill.metadata || {};
              const interfaceMetadata = metadata.interface && typeof metadata.interface === 'object' ? metadata.interface as Record<string, unknown> : {};
              return (
                <article key={skill.id} className="row-card skill-row-card">
                  <div>
                    <strong>{String(interfaceMetadata.display_name || skill.name)} · {skill.version}</strong>
                    <p>{String(interfaceMetadata.short_description || skill.description || '无描述')}</p>
                    <small>{String(metadata.invocation_name || `$${skill.name}`)} · {skillScopeLabel(String(metadata.scope || 'legacy'))} · {metadata.allow_implicit_invocation === false ? '仅显式调用' : '可自动匹配'}</small>
                    <small>{String(metadata.path || '数据库内置')} · 依赖能力：{skill.required_capabilities.join('、') || '无'}</small>
                    {Array.isArray(metadata.validation_errors) && metadata.validation_errors.length ? <small className="skill-validation-error">格式问题：{metadata.validation_errors.map(String).join('；')}</small> : null}
                  </div>
                  <div className="skill-card-actions">
                    <button type="button" className="secondary-button" disabled={!metadata.path || skillBusy} onClick={() => void inspectSkill(skill)}>查看</button>
                    <button type="button" className="secondary-button" onClick={() => void copySkillInvocation(skill)}>复制调用名</button>
                    <button type="button" className={skill.enabled ? 'secondary-button' : ''} onClick={() => void toggleSkill(skill)}>{skill.enabled ? '停用' : '启用'}</button>
                  </div>
                </article>
              );
            }}
          />
        </section>
      );
    }

    if (activeObject.id === 'plugins') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="Plugins" description="从 GitHub 或本地 manifest 安装插件，并统一管理 provider、能力、Skill 与 MCP" />
          <div className="detail-toolbar">
            <input aria-label="GitHub 插件地址" placeholder="https://github.com/owner/repo" value={pluginGitHubSource} onChange={(event) => setPluginGitHubSource(event.target.value)} />
            <button type="button" disabled={!pluginGitHubSource.trim() || Boolean(pluginBusy)} onClick={() => void installPluginFromGitHub()}>{pluginBusy === 'github-install' ? '安装中…' : '从 GitHub 安装'}</button>
          </div>
          <div className="detail-toolbar">
            <input placeholder="/absolute/path/to/plugin.json" value={pluginManifestPath} onChange={(event) => setPluginManifestPath(event.target.value)} />
            <button type="button" disabled={!pluginManifestPath.trim()} onClick={() => void installPlugin()}>安装本地插件</button>
          </div>
          <p className="empty">GitHub 安装只接受 github.com 仓库并使用锁文件安装依赖；卸载只清理 Joi 受管插件目录，不删除 Codex 登录或用户工作区。</p>
          <RecordList
            emptyText="暂无插件。"
            items={plugins}
            renderItem={(plugin) => {
              const core = plugin.metadata?.core === true;
              const providers = pluginProviderConfigs(plugin);
              return (
                <article key={plugin.id} className="row-card">
                  <div>
                    <strong>{plugin.name} · {plugin.version}</strong>
                    <p>{plugin.description || '无描述'}</p>
                    <small>{plugin.status} · Provider {plugin.provider_ids.length} · 能力 {plugin.capability_ids.length} · Skills {plugin.skill_ids.length} · MCP {plugin.mcp_server_ids.length}</small>
                    {plugin.manifest_path ? <small>{plugin.manifest_path}</small> : null}
                    {typeof plugin.metadata?.source_url === 'string' ? <small>{plugin.metadata.source_url}{plugin.metadata.revision ? ` · ${String(plugin.metadata.revision).slice(0, 12)}` : ''}</small> : null}
                    {providers.map((provider) => {
                      const key = `${plugin.id}:${provider.id}`;
                      const providerActive = settings?.model_provider === provider.id;
                      const configuredModel = providerActive ? settings?.model_name : undefined;
                      const modelOptions = mergeACPPluginModels(
                        pluginProviderModels[key],
                        provider.models,
                        configuredModel ? [{ id: configuredModel, name: configuredModel }] : undefined,
                      );
                      const selectedModel = selectACPPluginModel(modelOptions, [
                        pluginSelectedModels[key],
                        configuredModel,
                        provider.default_model,
                      ]);
                      const active = providerActive && settings?.model_name === selectedModel;
                      return (
                        <div className="plugin-provider-row" key={provider.id}>
                          <div>
                            <strong>{provider.name}</strong>
                            <small>{provider.protocol.toUpperCase()} · {providerActive ? `当前 ${settings?.model_name}` : selectedModel}</small>
                            {modelOptions.length > 0 ? (
                              <select
                                aria-label={`${provider.name} 模型`}
                                disabled={!plugin.enabled || Boolean(pluginBusy)}
                                value={selectedModel}
                                onChange={(event) => setPluginSelectedModels((current) => ({ ...current, [key]: event.target.value }))}
                              >
                                {modelOptions.map((model) => (
                                  <option key={model.id} value={model.id}>{model.name || model.id}</option>
                                ))}
                              </select>
                            ) : null}
                            {pluginTestStatus[key] ? <small>{pluginTestStatus[key]}</small> : null}
                          </div>
                          <div className="row-actions">
                            <button type="button" className="secondary-button" disabled={!plugin.enabled || Boolean(pluginBusy)} onClick={() => void testPluginProvider(plugin, provider)}>测试</button>
                            <button type="button" disabled={!plugin.enabled || active || Boolean(pluginBusy)} onClick={() => void usePluginProvider(plugin, provider)}>{active ? '使用中' : providerActive ? '切换模型' : '设为当前'}</button>
                          </div>
                        </div>
                      );
                    })}
                    <CollapsedData label="注册清单" value={{ provider_ids: plugin.provider_ids, capability_ids: plugin.capability_ids, skill_ids: plugin.skill_ids, mcp_server_ids: plugin.mcp_server_ids }} />
                  </div>
                  <div className="row-actions">
                    <button type="button" className={plugin.enabled ? 'secondary-button' : ''} disabled={core} onClick={() => void togglePlugin(plugin)}>{core ? '核心插件' : plugin.enabled ? '停用' : '启用'}</button>
                    {!core ? <button type="button" onClick={() => void removePlugin(plugin)}>移除</button> : null}
                  </div>
                </article>
              );
            }}
          />
        </section>
      );
    }

    if (activeObject.id === 'mcp') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="MCP 运行时" description="由 Joi 持有真实 MCP Client 连接，支持 stdio、Streamable HTTP 和 SSE；可实际调用工具，也可包装为受控 Capability 交给模型" />
          <div className="settings-form compact">
            <label className="field-row"><span>ID</span><input placeholder="留空自动生成" value={mcpDraft.id} onChange={(event) => setMCPDraft((current) => ({ ...current, id: event.target.value }))} /></label>
            <label className="field-row"><span>名称</span><input value={mcpDraft.name} onChange={(event) => setMCPDraft((current) => ({ ...current, name: event.target.value }))} /></label>
            <label className="field-row"><span>传输</span><select value={mcpDraft.transport} onChange={(event) => setMCPDraft((current) => ({ ...current, transport: event.target.value }))}><option value="stdio">stdio</option><option value="streamable_http">Streamable HTTP</option><option value="sse">SSE</option></select></label>
            {mcpDraft.transport === 'stdio' ? (
              <>
                <label className="field-row"><span>命令</span><input placeholder="npx" value={mcpDraft.command} onChange={(event) => setMCPDraft((current) => ({ ...current, command: event.target.value }))} /></label>
                <label className="field-row"><span>参数</span><input placeholder="-y @modelcontextprotocol/server-filesystem /path" value={mcpDraft.args} onChange={(event) => setMCPDraft((current) => ({ ...current, args: event.target.value }))} /></label>
                <label className="field-row"><span>环境变量 JSON</span><textarea rows={3} placeholder={'{"KEY":"value"}'} value={mcpDraft.env} onChange={(event) => setMCPDraft((current) => ({ ...current, env: event.target.value }))} /></label>
              </>
            ) : (
              <>
                <label className="field-row"><span>URL</span><input placeholder="https://example.com/mcp" value={mcpDraft.url} onChange={(event) => setMCPDraft((current) => ({ ...current, url: event.target.value }))} /></label>
                <label className="field-row"><span>Headers JSON</span><textarea rows={3} placeholder={'{"Authorization":"Bearer ..."}'} value={mcpDraft.headers} onChange={(event) => setMCPDraft((current) => ({ ...current, headers: event.target.value }))} /></label>
              </>
            )}
            <div className="detail-actions"><button type="button" onClick={() => void saveMCPDraft()}>保存 Server</button></div>
          </div>
          <RecordList
            emptyText="暂无 MCP Server。"
            items={mcpServers}
            renderItem={(server) => (
              <article key={server.id} className="row-card">
                <div>
                  <strong>{server.name} · {formatStatus(server.status)}</strong>
                  <p>{server.command ? `${server.command} ${(server.args ?? []).join(' ')}` : server.url || '未配置连接入口'}</p>
                  <small>{server.transport} · {server.trust} · 工具 {server.tools.length} · 资源 {server.resources.length} · Prompt {server.prompts.length}</small>
                  {server.last_sync_error ? <small className="error-text">{server.last_sync_error}</small> : null}
                  {server.tools.map((tool) => {
                    const key = `${server.id}:${tool.name}`;
                    return (
                    <div key={tool.name} className="mcp-tool-runtime-card">
                      <div><strong>{tool.name}</strong><small>{tool.description || '无描述'}{tool.wrapped_as ? ` · 已包装 ${tool.wrapped_as}` : ''}</small></div>
                      <textarea rows={3} aria-label={`${tool.name} JSON 输入`} value={mcpToolInputs[key] || '{}'} onChange={(event) => setMCPToolInputs((current) => ({ ...current, [key]: event.target.value }))} />
                      <div className="row-actions">
                        <button type="button" disabled={Boolean(mcpBusy)} onClick={() => void invokeMCPToolFromSettings(server, tool.name)}>{mcpBusy === key ? '调用中…' : '真实调用'}</button>
                        {!tool.wrapped_as ? <button className="secondary-button" type="button" onClick={() => void wrapMCPTool(server, tool.name)}>包装为 Capability</button> : null}
                      </div>
                      {mcpToolResults[key] !== undefined ? <CollapsedData label="查看调用结果" value={mcpToolResults[key]} /> : null}
                    </div>
                    );
                  })}
                  {(server.resources.length || server.prompts.length) ? <CollapsedData label="资源与 Prompt 清单" value={{ resources: server.resources, prompts: server.prompts }} /> : null}
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => void syncMCPServer(server.id)}>同步</button>
                  <button type="button" className="secondary-button" onClick={async () => { await desktopApi.setMCPServerEnabled({ id: server.id, enabled: server.enabled === false }); await refreshAll(); }}>{server.enabled === false ? '启用' : '停用'}</button>
                  <button type="button" onClick={async () => { if (!window.confirm(`删除 MCP Server“${server.name}”？`)) return; await desktopApi.deleteMCPServer(server.id); await refreshAll(); }}>删除</button>
                </div>
              </article>
            )}
          />
        </section>
      );
    }

    if (activeObject.id === 'developer') {
      return <DeveloperWorkbenchPanel workspaceSettings={workspaceSettings} />;
    }

    if (activeObject.id === 'filesystem') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="文件系统" description="限定 Joi 可读取或写入的工作区根目录和单文件大小" />
          <div className="settings-form">
            <label className="field-row"><span>允许根目录</span><textarea rows={5} value={allowedRootsText} onChange={(event) => setAllowedRootsText(event.target.value)} /></label>
            <label className="field-row"><span>默认根目录</span><input value={defaultRoot} onChange={(event) => setDefaultRoot(event.target.value)} /></label>
            <label className="field-row"><span>单文件上限 (bytes)</span><input inputMode="numeric" value={fileMaxBytes} onChange={(event) => setFileMaxBytes(event.target.value)} /></label>
            <div className="detail-actions"><button type="button" onClick={() => void saveWorkspacePatch({ allowed_roots: splitSettingsList(allowedRootsText), default_root: defaultRoot.trim(), file_analyze_max_bytes: Math.max(1, Number(fileMaxBytes) || 1) }, '文件系统边界已保存')}>保存</button></div>
          </div>
        </section>
      );
    }

    if (activeObject.id === 'browser') {
      return (
        <section className="settings-detail-panel browser-workbench-panel">
          <DetailHeader title="自管浏览器" description="由 Joi Electron 直接持有隔离会话，支持多标签、DOM 观察、点击输入、上传、弹窗、控制台、网络、截图、Vision 和受控 CDP" />
          <section className="workbench-card">
            <div className="browser-workbench-address-row">
              <div className="browser-workbench-nav">
                <button type="button" aria-label="后退" disabled={!browserWorkbenchSessionID || Boolean(browserWorkbenchBusy)} onClick={() => void runBrowserWorkbench('back')}>←</button>
                <button type="button" aria-label="前进" disabled={!browserWorkbenchSessionID || Boolean(browserWorkbenchBusy)} onClick={() => void runBrowserWorkbench('forward')}>→</button>
                <button type="button" aria-label="刷新" disabled={!browserWorkbenchSessionID || Boolean(browserWorkbenchBusy)} onClick={() => void runBrowserWorkbench('reload')}>↻</button>
              </div>
              <input value={browserWorkbenchURL} onChange={(event) => setBrowserWorkbenchURL(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runBrowserWorkbench(browserWorkbenchSessionID ? 'navigate' : 'open', { url: browserWorkbenchURL }); }} />
              <button type="button" disabled={Boolean(browserWorkbenchBusy) || !browserWorkbenchURL.trim()} onClick={() => void runBrowserWorkbench(browserWorkbenchSessionID ? 'navigate' : 'open', { url: browserWorkbenchURL })}>{browserWorkbenchBusy === 'open' || browserWorkbenchBusy === 'navigate' ? '打开中…' : browserWorkbenchSessionID ? '前往' : '打开'}</button>
            </div>
            <div className="browser-session-line"><span className={`live-dot ${browserWorkbenchSessionID ? 'on' : ''}`} /><strong>{browserWorkbenchSessionID || '未启动浏览器会话'}</strong>{browserWorkbenchResult?.title ? <small>{browserWorkbenchResult.title}</small> : null}</div>
            <div className="detail-actions workbench-action-wrap">
              {[
                ['observe', '观察 DOM'], ['vision', '视觉分析'], ['screenshot', '截图'], ['list_tabs', '标签页'], ['console', '控制台'], ['network', '网络'], ['get_images', '图片'],
              ].map(([action, label]) => <button className="secondary-button" key={action} type="button" disabled={!browserWorkbenchSessionID || Boolean(browserWorkbenchBusy)} onClick={() => void runBrowserWorkbench(action)}>{browserWorkbenchBusy === action ? '处理中…' : label}</button>)}
              <button type="button" disabled={!browserWorkbenchSessionID || Boolean(browserWorkbenchBusy)} onClick={() => void runBrowserWorkbench('new_tab', { url: 'about:blank' })}>新标签</button>
              <button className="danger-button" type="button" disabled={!browserWorkbenchSessionID || Boolean(browserWorkbenchBusy)} onClick={() => void runBrowserWorkbench('close')}>关闭会话</button>
            </div>
          </section>
          <section className="workbench-card">
            <div className="inline-field-grid">
              <label><span>CSS Selector</span><input value={browserWorkbenchSelector} onChange={(event) => setBrowserWorkbenchSelector(event.target.value)} /></label>
              <label><span>输入文本</span><input value={browserWorkbenchText} onChange={(event) => setBrowserWorkbenchText(event.target.value)} /></label>
            </div>
            <div className="detail-actions">
              <button className="secondary-button" type="button" disabled={!browserWorkbenchSessionID || !browserWorkbenchSelector.trim() || Boolean(browserWorkbenchBusy)} onClick={() => void runBrowserWorkbench('click', { selector: browserWorkbenchSelector })}>点击</button>
              <button type="button" disabled={!browserWorkbenchSessionID || !browserWorkbenchSelector.trim() || Boolean(browserWorkbenchBusy)} onClick={() => void runBrowserWorkbench('type', { selector: browserWorkbenchSelector, text: browserWorkbenchText })}>输入</button>
              <button className="secondary-button" type="button" disabled={!browserWorkbenchSessionID || Boolean(browserWorkbenchBusy)} onClick={() => void runBrowserWorkbench('press', { key: 'Enter' })}>按 Enter</button>
              <button className="secondary-button" type="button" disabled={!browserWorkbenchSessionID || Boolean(browserWorkbenchBusy)} onClick={() => void runBrowserWorkbench('scroll', { delta_y: 720 })}>向下滚动</button>
            </div>
          </section>
          {browserWorkbenchResult?.screenshot_path ? <img className="browser-workbench-screenshot" src={localPathURL(browserWorkbenchResult.screenshot_path)} alt="浏览器截图" /> : null}
          {browserWorkbenchResult ? <CollapsedData label="查看浏览器运行结果" value={browserWorkbenchResult} /> : null}
          <details className="settings-advanced">
            <summary>网站访问边界</summary>
            <div className="settings-form">
              <label className="field-row"><span>启用浏览器能力</span><input checked={browserEnabled} type="checkbox" onChange={(event) => setBrowserEnabled(event.target.checked)} /></label>
              <label className="field-row"><span>允许 Host</span><textarea rows={4} placeholder="example.com, docs.example.com" value={browserHostsText} onChange={(event) => setBrowserHostsText(event.target.value)} /></label>
              <label className="field-row"><span>允许私有 Host</span><input checked={browserPrivateHosts} type="checkbox" onChange={(event) => setBrowserPrivateHosts(event.target.checked)} /></label>
              <div className="detail-actions"><button type="button" onClick={() => void saveWorkspacePatch({ browser_enabled: browserEnabled, browser_allowed_hosts: splitSettingsList(browserHostsText), web_research_allow_private_hosts: browserPrivateHosts }, '浏览器能力设置已保存')}>保存边界</button></div>
            </div>
          </details>
        </section>
      );
    }

    if (activeObject.id === 'github') {
      const tokenConfigured = Boolean(secretStatus?.secrets?.GITHUB_TOKEN);
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="GitHub" description="配置 GitHub API、默认仓库与本地钥匙串令牌" />
          <div className="settings-form">
            <label className="field-row"><span>API Base URL</span><input value={githubApiBaseURL} onChange={(event) => setGithubApiBaseURL(event.target.value)} /></label>
            <label className="field-row"><span>默认仓库</span><input placeholder="owner/repo" value={githubDefaultRepo} onChange={(event) => setGithubDefaultRepo(event.target.value)} /></label>
            <label className="field-row"><span>Token</span><SecretInput placeholder={tokenConfigured ? '已配置；留空不更新' : 'ghp_...'} value={githubToken} visible={githubTokenVisible} onChange={setGithubToken} onToggleVisible={() => setGithubTokenVisible((value) => !value)} /></label>
            <div className="connection-status"><span className={`live-dot ${tokenConfigured || githubToken.trim() ? 'on' : ''}`} /><strong>{tokenConfigured ? 'Token 已配置' : 'Token 未配置'}</strong><small>令牌只写入 macOS Keychain，不进入 SQLite。</small></div>
            {githubTestStatus ? <p className="empty">{githubTestStatus}</p> : null}
            <div className="detail-actions">
              <button className="secondary-button" type="button" onClick={() => void testGitHubSettings()}>测试连接</button>
              <button type="button" onClick={async () => { if (githubToken.trim()) { await desktopApi.saveSecret({ name: 'GITHUB_TOKEN', value: githubToken.trim() }); setGithubToken(''); } await saveWorkspacePatch({ github_default_repo: githubDefaultRepo.trim(), github_api_base_url: githubApiBaseURL.trim() || 'https://api.github.com' }, 'GitHub 设置已保存'); }}>保存</button>
            </div>
          </div>
        </section>
      );
    }

    if (activeObject.id === 'custom-tools') {
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="自定义工具" description="管理 Capability Runtime 已编译的 Tool Workflow" />
          <p className="empty">新工具通过 Plugin manifest 或 MCP 包装注册；模型不能绕过 Workflow 直接执行底层命令。</p>
          <RecordList
            emptyText="暂无 Tool Workflow。"
            items={workflows}
            renderItem={(workflow) => (
              <article key={workflow.id} className="row-card">
                <div><strong>{workflow.name} · {workflow.version}</strong><p>{workflow.capability_id} · {formatRiskLevel(workflow.risk_level)}</p><small>{workflow.steps.map((step) => step.tool).join(' → ')}</small><CollapsedData label="Workflow" value={workflow} /></div>
                <button type="button" className={workflow.enabled ? 'secondary-button' : ''} onClick={() => void setWorkflowEnabled(workflow.name, !workflow.enabled)}>{workflow.enabled ? '停用' : '启用'}</button>
              </article>
            )}
          />
        </section>
      );
    }

    if (activeObject.id === 'web-search') {
      const braveConfigured = Boolean(secretStatus?.secrets?.BRAVE_SEARCH_API_KEY);
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="网页搜索" description="配置 web_research 查询使用的搜索服务" />
          <div className="settings-form">
            <label className="field-row">
              <span>搜索服务</span>
              <select value={webSearchProvider} onChange={(event) => setWebSearchProvider(event.target.value)}>
                {webSearchProviderOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="field-row">
              <span>Brave API Key</span>
              <SecretInput
                placeholder="留空表示使用已保存密钥"
                value={braveSearchApiKey}
                visible={braveSearchApiKeyVisible}
                onChange={setBraveSearchApiKey}
                onToggleVisible={() => setBraveSearchApiKeyVisible((value) => !value)}
              />
            </label>
            <div className="field-row">
              <span>连接状态</span>
              <div className="connection-status">
                <span className={`live-dot ${webSearchProvider !== 'brave' || braveConfigured || braveSearchApiKey.trim() ? 'on' : ''}`} />
                <strong>{braveConfigured ? 'Brave 已配置' : 'Brave 未配置'}</strong>
                <small>Auto 会在 Brave key 可用时优先使用 Brave，否则回落 DuckDuckGo。</small>
              </div>
            </div>
            <label className="field-row">
              <span>测试查询</span>
              <input value={webSearchTestQuery} onChange={(event) => setWebSearchTestQuery(event.target.value)} />
            </label>
            <div className="detail-actions">
              <button type="button" onClick={saveWebSearchSettings}>保存</button>
              <button type="button" onClick={testWebSearchSettings}>测试搜索</button>
            </div>
          </div>
          <dl className="metrics">
            <KV label="当前 provider" value={workspaceSettings?.web_search_provider || 'auto'} />
            <KV label="Brave Key" value={braveConfigured ? '已配置' : '缺失'} />
            <KV label="私有 host" value={workspaceSettings?.web_research_allow_private_hosts ? '允许 allowlist' : '默认拒绝'} />
            <KV label="结果上限" value={`${workspaceSettings?.workspace_search_max_results ?? 0} 条`} />
          </dl>
          {testStatus && <p className="empty">{testStatus}</p>}
        </section>
      );
    }
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
          {nativeCapabilities.map((capability) => {
            const backend = capabilityBackend(capability);
            return (
              <article key={capability.id} className={`row-card compact capability-contract-card capability-backend-${backend}`}>
                <div className="capability-contract-title">
                  <strong>{capability.id}</strong>
                  <small className={`capability-backend-status ${capability.enabled ? '' : 'is-disabled'}`}>
                    {capabilityStatusLabel(capability)}
                  </small>
                </div>
                <p>{capability.description || '未记录描述'}</p>
                <dl className="compact-kv">
                  <KV label="backend" value={capabilityBackendLabel(backend)} />
                  <KV label="intent" value={String(metadataValue(capability, 'intent_domain') ?? '未设置')} />
                  <KV label="risk" value={formatRiskLevel(String(metadataValue(capability, 'risk_level') ?? capability.risk_level))} />
                  <KV label="privacy" value={String(metadataValue(capability, 'privacy_level') ?? 'public')} />
                  <KV label="workflow" value={String(metadataValue(capability, 'workflow_id') ?? '未绑定')} />
                </dl>
                <CollapsedData
                  label="查看 contract"
                  value={{
                    backend,
                    positive_examples: metadataArray(capability, 'positive_examples'),
                    negative_examples: metadataArray(capability, 'negative_examples'),
                    input_schema: metadataValue(capability, 'input_schema') ?? {},
                    output_schema: metadataValue(capability, 'output_schema') ?? {},
                  }}
                />
              </article>
            );
          })}
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
                <small>工作节点通过网关注册并获取任务；网关开关在下次启动 Joi 时生效</small>
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
      const effectiveRouting = executionRoutingForSettings({
        ...(workspaceSettings ?? defaultWorkspaceSettings()),
        node_assignment_policy: nodeAssignmentPolicy,
        allow_remote_execution: allowRemoteExecution,
        privacy_local_only: privacyLocalOnly,
        remote_execution_requires_confirmation: remoteExecutionRequiresConfirmation,
      });
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="分配策略" description="控制主节点和工作节点如何接收任务" />
          <div className="settings-form">
            <label className="field-row">
              <span>默认策略</span>
              <select value={nodeAssignmentPolicy} onChange={(event) => setNodeAssignmentPolicy(event.target.value)}>
                <option value="main_first">主节点优先</option>
                <option value="auto">高峰期自动派发</option>
                <option value="manual">仅手动指定</option>
              </select>
            </label>
            <label className="field-row">
              <span>允许远端执行</span>
              <input checked={allowRemoteExecution} type="checkbox" onChange={(event) => setAllowRemoteExecution(event.target.checked)} />
            </label>
            <p className="empty">主节点始终具备完整任务能力；Worker 只接收最小必要上下文，不接收长期记忆或 Secret。</p>
            <div className="connection-status">
              <span className={`live-dot ${effectiveRouting.allowWorker ? 'on' : ''}`} />
              <strong>{effectiveRouting.allowWorker ? '允许自动派发' : '当前固定主节点'}</strong>
              <small>生效原因：{effectiveRouting.reason}</small>
            </div>
            <div className="detail-actions"><button type="button" onClick={() => void saveWorkspacePatch({ node_assignment_policy: nodeAssignmentPolicy, allow_remote_execution: allowRemoteExecution }, '节点分配策略已保存')}>保存</button></div>
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
          <DetailHeader title="密钥管理" description="管理当前桌面入口使用的本地凭证" />
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
      const pendingConfirmations = confirmations.filter((item) => item.status === 'pending');
      return (
        <section className="settings-detail-panel">
          <DetailHeader title="待确认操作" description="需要你同意后才能继续的高风险操作" />
          <RecordList
            emptyText="暂无待确认请求。"
            items={pendingConfirmations}
            renderItem={(item) => (
              <article key={item.id} className="row-card">
                <div>
                  <strong>{confirmationActionLabel(item.requested_action, item.capability_id)}</strong>
                  <p>风险 {formatRiskLevel(item.risk_level)}</p>
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => decideConfirmation(item.id, true)}>批准</button>
                  <button type="button" onClick={() => decideConfirmation(item.id, false)}>拒绝</button>
                </div>
              </article>
            )}
          />
        </section>
      );
    }
    const effectiveRouting = executionRoutingForSettings({
      ...(workspaceSettings ?? defaultWorkspaceSettings()),
      node_assignment_policy: nodeAssignmentPolicy,
      allow_remote_execution: allowRemoteExecution,
      privacy_local_only: privacyLocalOnly,
      remote_execution_requires_confirmation: remoteExecutionRequiresConfirmation,
    });
    return (
      <section className="settings-detail-panel">
        <DetailHeader title="安全策略" description="控制数据是否离开本机以及远端执行的确认方式" />
        <div className="settings-form">
          <label className="field-row"><span>本地优先</span><input checked={privacyLocalOnly} type="checkbox" onChange={(event) => setPrivacyLocalOnly(event.target.checked)} /></label>
          <label className="field-row"><span>允许远端执行</span><input checked={allowRemoteExecution} type="checkbox" onChange={(event) => setAllowRemoteExecution(event.target.checked)} /></label>
          <label className="field-row"><span>远端执行前确认</span><input checked={remoteExecutionRequiresConfirmation} disabled={!allowRemoteExecution} type="checkbox" onChange={(event) => setRemoteExecutionRequiresConfirmation(event.target.checked)} /></label>
          <label className="field-row"><span>禁止破坏性操作</span><input checked readOnly type="checkbox" /></label>
          <p className="empty">
            {effectiveRouting.allowWorker
              ? '远端执行可用；高风险操作仍会进入待确认操作。'
              : '当前保持本机执行，远端执行器不会自动接收任务。'}
          </p>
          <div className="detail-actions">
            <button type="button" onClick={() => void saveWorkspacePatch({
              allow_remote_execution: allowRemoteExecution,
              destructive_operations_disabled: true,
              privacy_local_only: privacyLocalOnly,
              remote_execution_requires_confirmation: remoteExecutionRequiresConfirmation,
            }, '安全策略已保存')}>保存</button>
          </div>
        </div>
      </section>
    );
  }

  function renderAdvancedDetail() {
    return (
      <section className="settings-detail-panel">
        <DetailHeader title="支持与诊断" description="检查本机状态，需要排查问题时再导出诊断包" />
        <dl className="metrics">
          <KV label="本地数据" value={Boolean(health?.service_status?.sqlite) ? '正常' : '需要检查'} />
          <KV label="待处理问题" value={String(health?.warnings?.length ?? 0)} />
          <KV label="诊断保护" value={diagnosticRedactionEnabled ? '自动脱敏' : '基础脱敏'} />
        </dl>
        <p className="empty">诊断包保存在本机；密钥、授权信息和完整用户路径不会直接导出。</p>
        <div className="detail-actions">
          <button type="button" onClick={async () => {
            const result = await desktopApi.exportDiagnostics();
            setNotice(`诊断包已导出：${result.path}`);
          }}>导出脱敏诊断包</button>
        </div>
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

  if (activeCategory === 'automations') {
    return (
      <div className="settings-console automation-settings-console">
        <main className="settings-detail automation-settings-detail">{renderAutomationDetail()}</main>
      </div>
    );
  }

  return (
    <div className="settings-console">
      <ScrollArea as="main" className="settings-detail" resetScrollKey={`${activeCategory}:${activeObject.id}`}>
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
    provider: 'grok_build',
    baseURL: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.5',
    reasoningModel: 'grok-4.5',
    models: ['grok-4.5'],
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
  const providerMatches = savedProvider === preset.provider || (activeObjectID === 'grok' && ['xai', 'xai_oauth', 'xai-oauth', 'grok_build', 'grok-build'].includes(savedProvider));
  return providerMatches && normalizeModelBaseURL(savedBaseURL) === normalizeModelBaseURL(preset.baseURL);
}

function normalizeModelBaseURL(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function getSettingsObjects(category: SettingsCategory, nodes: NodeRecord[], automations: AutomationDefinition[] = []) {
  if (category === 'models') {
    return [
      { id: 'routing', label: '路由策略', description: '按 Agent 与任务用途选模型、降级和思考强度' },
      { id: 'codex-acp', label: 'Codex ACP', description: '本机 Codex 登录、连接测试与模型发现' },
      { id: 'openai', label: 'OpenAI', description: 'OpenAI API 与模型参数' },
      { id: 'deepseek', label: 'DeepSeek', description: 'DeepSeek API 连接与模型参数' },
      { id: 'gemini', label: 'Gemini', description: 'Google Gemini 模型配置' },
      { id: 'claude', label: 'Claude', description: 'Anthropic Claude 模型配置' },
      { id: 'grok', label: 'Grok Build', description: 'xAI OAuth · Grok 4.5 agent runtime' },
      { id: 'local', label: '本地模型', description: '本地推理服务与模型' },
      { id: 'openrouter', label: 'OpenRouter', description: '多模型路由服务' },
      { id: 'compatible', label: '自定义兼容', description: 'OpenAI Compatible 接口' },
    ];
  }
  if (category === 'chatEntrances') {
    return [
      { id: 'voice-video', label: '语音与视频', description: '录音、转写、朗读、视频生成与理解' },
      { id: 'telegram', label: 'Telegram', description: 'Telegram Bot 入口' },
      { id: 'imessage', label: 'iMessage', description: 'Photon 托管 iMessage 入口' },
      { id: 'desktop-notify', label: '桌面通知', description: '本机通知入口' },
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
      { id: 'assistant-workspace', label: '个人助理', description: '活动记录、日历、计划与渠道闭环' },
      { id: 'memory-health', label: '记忆健康', description: '召回质量、作用域与生命周期' },
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
      { id: 'mcp', label: 'MCP 运行时', description: '连接、同步并真正调用 MCP 工具' },
      { id: 'browser', label: '浏览器', description: '自管会话、多标签、DOM、网络与视觉' },
      { id: 'developer', label: '开发工具', description: '原生 LSP、LLDB、代码执行与沙箱' },
      { id: 'filesystem', label: '文件系统', description: '工作区根目录与读写边界' },
      { id: 'skills', label: 'Skills', description: '发现、检索并管理 Codex 兼容技能' },
      { id: 'plugins', label: 'Plugins', description: '安装并管理 provider 与扩展' },
      { id: 'custom-tools', label: '工具流程', description: '受控 Capability Workflow' },
      { id: 'github', label: 'GitHub', description: '令牌、默认仓库与 API' },
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
      { id: 'privacy-policy', label: '安全策略', description: '本地与远端执行边界' },
      { id: 'secrets', label: '密钥管理', description: '本地钥匙串与密钥状态' },
      { id: 'dangerous-actions', label: '待确认操作', description: '需要用户确认的高风险操作' },
    ];
  }
  return [
    { id: 'diagnostics', label: '支持与诊断', description: '检查状态并导出脱敏诊断包' },
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

function ModelRoutingWorkbench({ savedModels }: { savedModels: AvailableModel[] }) {
  const [policies, setPolicies] = useState<AgentModelPolicy[]>([]);
  const [selectedAgentID, setSelectedAgentID] = useState('general_agent');
  const [draft, setDraft] = useState<AgentModelPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function loadPolicies() {
    setBusy(true);
    try {
      const result = await desktopApi.listAgentModelPolicies();
      setPolicies(result.policies ?? []);
      const selected = result.policies.find((item) => item.agent_id === selectedAgentID) || result.policies[0] || null;
      if (selected) {
        setSelectedAgentID(selected.agent_id);
        setDraft({ ...selected, fallback_model_ids: [...selected.fallback_model_ids] });
      }
      setStatus('');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadPolicies();
  }, []);

  useEffect(() => {
    const selected = policies.find((item) => item.agent_id === selectedAgentID);
    if (selected) setDraft({ ...selected, fallback_model_ids: [...selected.fallback_model_ids] });
  }, [policies, selectedAgentID]);

  const modelOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const model of savedModels) values.set(model.id, model.display_name || model.id);
    if (draft) {
      for (const id of [draft.default_model_id, draft.cheap_model_id, draft.child_model_id, draft.tool_model_id, draft.long_context_model_id, ...draft.fallback_model_ids]) {
        if (id && !values.has(id)) values.set(id, id);
      }
    }
    return [...values.entries()].map(([id, label]) => ({ id, label }));
  }, [draft, savedModels]);

  async function savePolicy() {
    if (!draft) return;
    setBusy(true);
    try {
      const saved = await desktopApi.saveAgentModelPolicy({
        ...draft,
        fallback_model_ids: [...new Set(draft.fallback_model_ids.map((item) => item.trim()).filter(Boolean))],
        max_failovers: Math.max(0, Math.min(8, Number(draft.max_failovers) || 0)),
      });
      setPolicies((current) => [...current.filter((item) => item.agent_id !== saved.agent_id), saved]);
      setDraft(saved);
      setStatus('路由策略已保存。模型失败时会在同一 Run 内记录尝试并按顺序降级。');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function patchDraft(patch: Partial<AgentModelPolicy>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
  }

  return (
    <section className="settings-detail-panel model-routing-workbench">
      <DetailHeader title="模型路由" description="Agent 是岗位，模型是可替换的执行引擎；主任务、子 Agent、工具与长上下文可独立选型" />
      <div className="settings-horizontal-split">
        <div className="routing-agent-list" role="tablist" aria-label="Agent 路由策略">
          {policies.map((policy) => (
            <button
              key={policy.agent_id}
              className={selectedAgentID === policy.agent_id ? 'active' : ''}
              role="tab"
              aria-selected={selectedAgentID === policy.agent_id}
              type="button"
              onClick={() => setSelectedAgentID(policy.agent_id)}
            >
              <strong>{agentDisplayName(policy.agent_id)}</strong>
              <small>{policy.enabled ? policy.default_model_id || '跟随默认' : '已停用'}</small>
            </button>
          ))}
        </div>
        {draft ? (
          <div className="settings-form routing-policy-form">
            <label className="field-row"><span>启用策略</span><input type="checkbox" checked={draft.enabled} onChange={(event) => patchDraft({ enabled: event.target.checked })} /></label>
            <ModelRouteSelect label="默认模型" value={draft.default_model_id || ''} options={modelOptions} onChange={(value) => patchDraft({ default_model_id: value || undefined })} />
            <label className="field-row">
              <span>故障转移链</span>
              <input
                placeholder="model-a, model-b"
                value={draft.fallback_model_ids.join(', ')}
                onChange={(event) => patchDraft({ fallback_model_ids: splitSettingsList(event.target.value) })}
              />
            </label>
            <ModelRouteSelect label="低成本任务" value={draft.cheap_model_id || ''} options={modelOptions} onChange={(value) => patchDraft({ cheap_model_id: value || undefined })} />
            <ModelRouteSelect label="子 Agent" value={draft.child_model_id || ''} options={modelOptions} onChange={(value) => patchDraft({ child_model_id: value || undefined })} />
            <ModelRouteSelect label="工具密集" value={draft.tool_model_id || ''} options={modelOptions} onChange={(value) => patchDraft({ tool_model_id: value || undefined })} />
            <ModelRouteSelect label="长上下文" value={draft.long_context_model_id || ''} options={modelOptions} onChange={(value) => patchDraft({ long_context_model_id: value || undefined })} />
            <label className="field-row"><span>思考强度</span><select value={draft.reasoning_effort || ''} onChange={(event) => patchDraft({ reasoning_effort: event.target.value })}><option value="">跟随模型</option><option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
            <label className="field-row"><span>最多降级次数</span><input type="number" min="0" max="8" value={draft.max_failovers} onChange={(event) => patchDraft({ max_failovers: Number(event.target.value) })} /></label>
          </div>
        ) : <p className="empty">{busy ? '正在读取路由策略…' : '暂无可用 Agent。'}</p>}
      </div>
      <div className="detail-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void loadPolicies()}>重新读取</button>
        <button type="button" disabled={busy || !draft} onClick={() => void savePolicy()}>{busy ? '处理中…' : '保存路由策略'}</button>
      </div>
      {status ? <p className="settings-inline-status" role="status">{status}</p> : null}
    </section>
  );
}

function ModelRouteSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; label: string }>;
  value: string;
}) {
  return (
    <label className="field-row">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">跟随默认</option>
        {options.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
      </select>
    </label>
  );
}

function agentDisplayName(agentID: string) {
  const labels: Record<string, string> = {
    general_agent: '通用 Agent',
    research_agent: '研究 Agent',
    memory_agent: '记忆 Agent',
    devops_agent: '运维 Agent',
  };
  return labels[agentID] || agentID;
}

function DeveloperWorkbenchPanel({ workspaceSettings }: { workspaceSettings: WorkspaceSettings | null }) {
  const defaultRoot = workspaceSettings?.default_root || workspaceSettings?.allowed_roots?.[0] || '/Users/hao/project/Joi';
  const [tab, setTab] = useState<'code' | 'lsp' | 'debugger'>('code');
  const [language, setLanguage] = useState('javascript');
  const [code, setCode] = useState("const values = [2, 3, 5];\nconsole.log(values.reduce((sum, value) => sum + value, 0));");
  const [path, setPath] = useState(`${defaultRoot}/apps/joi-desktop/frontend/src/App.tsx`);
  const [line, setLine] = useState('1');
  const [character, setCharacter] = useState('0');
  const [newName, setNewName] = useState('renamedSymbol');
  const [debugTarget, setDebugTarget] = useState('');
  const [debugSessionID, setDebugSessionID] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');

  async function execute(action: string, input: Record<string, unknown>) {
    setBusy(action);
    setStatus('');
    try {
      const response = await desktopApi.executeDeveloperAction({ action, input, permission_profile: 'danger_full_access' });
      setResult(response.output);
      const session = objectFromUnknown(response.output.session);
      if (action === 'debugger_attach' && typeof session.id === 'string') setDebugSessionID(session.id);
      if (action === 'debugger_stop') setDebugSessionID('');
      setStatus(String(response.output.summary || `${action} 已完成`));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="settings-detail-panel developer-workbench-panel">
      <DetailHeader title="原生开发工具" description="直接使用语言服务器、LLDB、短命代码内核与 macOS sandbox，输出会回到 Run Trace" />
      <SettingsInlineTabs tabs={[['code', '代码执行'], ['lsp', 'LSP'], ['debugger', 'LLDB']]} active={tab} onChange={(value) => setTab(value as typeof tab)} />
      {tab === 'code' ? (
        <div className="workbench-pane">
          <div className="settings-form">
            <label className="field-row"><span>语言</span><select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="javascript">JavaScript</option><option value="typescript">TypeScript</option><option value="python">Python</option><option value="swift">Swift</option><option value="shell">Shell</option></select></label>
            <label className="field-row workbench-code-field"><span>代码</span><textarea rows={9} value={code} onChange={(event) => setCode(event.target.value)} /></label>
            <label className="field-row"><span>工作目录</span><input value={defaultRoot} readOnly /></label>
          </div>
          <div className="detail-actions">
            <button type="button" disabled={Boolean(busy) || !code.trim()} onClick={() => void execute('execute_code', { language, code, cwd: defaultRoot, timeout_seconds: 60 })}>{busy === 'execute_code' ? '执行中…' : '执行代码'}</button>
            <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void execute('sandbox_run', { cmd: ['/usr/bin/env', 'pwd'], cwd: defaultRoot, network: false })}>验证沙箱</button>
          </div>
        </div>
      ) : null}
      {tab === 'lsp' ? (
        <div className="workbench-pane">
          <div className="settings-form">
            <label className="field-row"><span>源文件</span><input value={path} onChange={(event) => setPath(event.target.value)} /></label>
            <label className="field-row"><span>位置</span><span className="inline-field-pair"><input type="number" min="1" value={line} onChange={(event) => setLine(event.target.value)} aria-label="行" /><input type="number" min="0" value={character} onChange={(event) => setCharacter(event.target.value)} aria-label="列" /></span></label>
            <label className="field-row"><span>重命名为</span><input value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
          </div>
          <div className="detail-actions workbench-action-wrap">
            {[
              ['lsp_diagnostics', '诊断'], ['lsp_symbols', '符号'], ['lsp_hover', '悬停'], ['lsp_definition', '定义'], ['lsp_references', '引用'], ['lsp_code_actions', '修复建议'],
            ].map(([action, label]) => <button className="secondary-button" key={action} type="button" disabled={Boolean(busy) || !path.trim()} onClick={() => void execute(action, { path, line: Number(line), character: Number(character) })}>{busy === action ? '运行中…' : label}</button>)}
            <button type="button" disabled={Boolean(busy) || !path.trim() || !newName.trim()} onClick={() => void execute('lsp_rename', { path, line: Number(line), character: Number(character), new_name: newName })}>应用重命名</button>
            <button type="button" disabled={Boolean(busy) || !path.trim()} onClick={() => void execute('lsp_format', { path })}>格式化文件</button>
          </div>
        </div>
      ) : null}
      {tab === 'debugger' ? (
        <div className="workbench-pane">
          <div className="settings-form">
            <label className="field-row"><span>可执行文件</span><input placeholder="/absolute/path/to/binary" value={debugTarget} onChange={(event) => setDebugTarget(event.target.value)} /></label>
            <div className="field-row"><span>会话</span><div className="connection-status"><span className={`live-dot ${debugSessionID ? 'on' : ''}`} /><strong>{debugSessionID || '未连接'}</strong></div></div>
          </div>
          <div className="detail-actions workbench-action-wrap">
            <button type="button" disabled={Boolean(busy) || !debugTarget.trim() || Boolean(debugSessionID)} onClick={() => void execute('debugger_attach', { target: debugTarget })}>启动 LLDB</button>
            {[
              ['debugger_threads', '线程'], ['debugger_stack', '调用栈'], ['debugger_locals', '局部变量'],
            ].map(([action, label]) => <button className="secondary-button" key={action} type="button" disabled={Boolean(busy) || !debugSessionID} onClick={() => void execute(action, { session_id: debugSessionID })}>{label}</button>)}
            <button className="secondary-button" type="button" disabled={Boolean(busy) || !debugSessionID} onClick={() => void execute('debugger_step', { session_id: debugSessionID, action: 'run' })}>运行</button>
            <button type="button" disabled={Boolean(busy) || !debugSessionID} onClick={() => void execute('debugger_stop', { session_id: debugSessionID })}>结束会话</button>
          </div>
        </div>
      ) : null}
      {status ? <p className="settings-inline-status" role="status">{status}</p> : null}
      {result ? <CollapsedData label="查看原生结果" value={result} /> : null}
    </section>
  );
}

function SettingsInlineTabs({
  active,
  onChange,
  tabs,
}: {
  active: string;
  onChange: (value: string) => void;
  tabs: string[][];
}) {
  return (
    <div className="settings-inline-tabs" role="tablist">
      {tabs.map(([id, label]) => <button key={id} className={active === id ? 'active' : ''} role="tab" aria-selected={active === id} type="button" onClick={() => onChange(id)}>{label}</button>)}
    </div>
  );
}

function MediaWorkbenchPanel() {
  const [tab, setTab] = useState<'voice' | 'video'>('voice');
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [speechText, setSpeechText] = useState('你好，我是 Joi。这是本机语音合成测试。');
  const [speechVoice, setSpeechVoice] = useState('Ting-Ting');
  const [speechRate, setSpeechRate] = useState('185');
  const [videoPrompt, setVideoPrompt] = useState('一个清晰、克制的产品动效：蓝色光点沿白色网格移动，16:9。');
  const [videoDuration, setVideoDuration] = useState('4');
  const [videoAspect, setVideoAspect] = useState('16:9');
  const [videoResolution, setVideoResolution] = useState('480p');
  const [selectedMediaPath, setSelectedMediaPath] = useState('');
  const [selectedMediaKind, setSelectedMediaKind] = useState<'image' | 'video'>('video');
  const [transcribeVideo, setTranscribeVideo] = useState(false);
  const [output, setOutput] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => {
    recorderRef.current?.stop();
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function runMedia(action: string, request: Record<string, unknown>) {
    setBusy(action);
    setStatus('');
    try {
      const result = await desktopApi.executeMediaAction({ action, ...request });
      setOutput(result.output);
      setStatus(String(result.output.summary || `${action} 已完成`));
      return result.output;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy('');
    }
  }

  async function startRecording() {
    setStatus('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
      const mimeType = candidates.find((candidate) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordingChunksRef.current = [];
      recordingStreamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) recordingChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        void (async () => {
          setRecordingState('saving');
          try {
            const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
            const dataURL = await blobToDataURL(blob);
            const saved = await runMedia('save_recording', { data_url: dataURL, mime_type: blob.type });
            if (saved) setStatus('录音已保存，可直接转写或播放。');
          } finally {
            recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
            recordingStreamRef.current = null;
            recorderRef.current = null;
            setRecordingState('idle');
          }
        })();
      };
      recorder.start(250);
      setRecordingState('recording');
      setStatus('正在使用麦克风录音…');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      setRecordingState('idle');
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }

  async function transcribeCurrentAudio() {
    const filePath = mediaOutputPath(output);
    if (!filePath) {
      setStatus('请先录音或选择可转写的音频。');
      return;
    }
    const result = await runMedia('speech_transcribe', { path: filePath, model: 'tiny', language: 'auto' });
    if (typeof result?.transcript === 'string') setSpeechText(result.transcript);
  }

  function chooseMedia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] as (File & { path?: string }) | undefined;
    event.currentTarget.value = '';
    if (!file?.path) {
      setStatus('请在 Joi Desktop 安装版中选择本地图片或视频。');
      return;
    }
    setSelectedMediaPath(file.path);
    setSelectedMediaKind(file.type.startsWith('image/') ? 'image' : 'video');
    setStatus(`已选择：${file.name}`);
  }

  const previewURL = mediaOutputPreviewURL(output);
  const outputKind = mediaOutputKind(output);
  const contactSheetURL = typeof output?.contact_sheet_url === 'string' ? output.contact_sheet_url : '';

  return (
    <section className="settings-detail-panel media-workbench-panel">
      <DetailHeader title="语音与视频" description="录音、本地 Whisper 转写、macOS TTS、xAI 视频生成，以及基于 FFmpeg + Vision 的本地视频理解" />
      <SettingsInlineTabs tabs={[['voice', '语音'], ['video', '视频']]} active={tab} onChange={(value) => setTab(value as typeof tab)} />
      {tab === 'voice' ? (
        <div className="workbench-pane media-voice-pane">
          <section className="workbench-card">
            <div className="workbench-card-heading"><div><strong>麦克风</strong><small>录音保存到 Joi 本地数据目录</small></div><span className={`live-dot ${recordingState === 'recording' ? 'on' : ''}`} /></div>
            <div className="detail-actions">
              {recordingState === 'recording'
                ? <button className="danger-button" type="button" onClick={stopRecording}>停止并保存</button>
                : <button type="button" disabled={recordingState === 'saving' || Boolean(busy)} onClick={() => void startRecording()}>{recordingState === 'saving' ? '保存中…' : '开始录音'}</button>}
              <button className="secondary-button" type="button" disabled={Boolean(busy) || !mediaOutputPath(output)} onClick={() => void transcribeCurrentAudio()}>{busy === 'speech_transcribe' ? '转写中…' : '本地转写'}</button>
            </div>
          </section>
          <section className="workbench-card">
            <div className="workbench-card-heading"><div><strong>文字朗读</strong><small>本地 macOS 语音引擎，输出可播放音频</small></div></div>
            <textarea rows={5} value={speechText} onChange={(event) => setSpeechText(event.target.value)} />
            <div className="inline-field-grid">
              <label><span>声音</span><input value={speechVoice} onChange={(event) => setSpeechVoice(event.target.value)} /></label>
              <label><span>语速</span><input type="number" min="80" max="450" value={speechRate} onChange={(event) => setSpeechRate(event.target.value)} /></label>
            </div>
            <div className="detail-actions"><button type="button" disabled={Boolean(busy) || !speechText.trim()} onClick={() => void runMedia('text_to_speech', { text: speechText, voice: speechVoice, rate: Number(speechRate), format: 'mp3' })}>{busy === 'text_to_speech' ? '生成中…' : '生成朗读'}</button></div>
          </section>
        </div>
      ) : null}
      {tab === 'video' ? (
        <div className="workbench-pane media-video-pane">
          <section className="workbench-card">
            <div className="workbench-card-heading"><div><strong>本地理解</strong><small>提取关键帧、媒体信息、画面文字和可选语音转写</small></div></div>
            <input ref={mediaInputRef} className="visually-hidden" type="file" accept="image/*,video/*" onChange={chooseMedia} />
            <div className="media-file-picker">
              <button type="button" className="secondary-button" onClick={() => mediaInputRef.current?.click()}>选择图片或视频</button>
              <span>{selectedMediaPath || '尚未选择'}</span>
            </div>
            {selectedMediaKind === 'video' ? <label className="compact-check"><input type="checkbox" checked={transcribeVideo} onChange={(event) => setTranscribeVideo(event.target.checked)} />同时用本地 Whisper 转写音轨</label> : null}
            <div className="detail-actions"><button type="button" disabled={Boolean(busy) || !selectedMediaPath} onClick={() => void runMedia(selectedMediaKind === 'image' ? 'analyze_image' : 'analyze_video', { path: selectedMediaPath, transcribe: transcribeVideo, model: 'tiny', language: 'auto' })}>{busy.startsWith('analyze_') ? '分析中…' : '分析媒体'}</button></div>
          </section>
          <section className="workbench-card">
            <div className="workbench-card-heading"><div><strong>生成视频</strong><small>xAI grok-imagine-video，完成后保存 MP4</small></div></div>
            <textarea rows={5} value={videoPrompt} onChange={(event) => setVideoPrompt(event.target.value)} />
            <div className="inline-field-grid three">
              <label><span>时长</span><input type="number" min="1" max="15" value={videoDuration} onChange={(event) => setVideoDuration(event.target.value)} /></label>
              <label><span>比例</span><select value={videoAspect} onChange={(event) => setVideoAspect(event.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option><option>4:3</option><option>3:4</option></select></label>
              <label><span>分辨率</span><select value={videoResolution} onChange={(event) => setVideoResolution(event.target.value)}><option>480p</option><option>720p</option></select></label>
            </div>
            <div className="detail-actions"><button type="button" disabled={Boolean(busy) || !videoPrompt.trim()} onClick={() => void runMedia('generate_video', { prompt: videoPrompt, duration_seconds: Number(videoDuration), aspect_ratio: videoAspect, resolution: videoResolution })}>{busy === 'generate_video' ? '生成与下载中…' : '生成视频'}</button></div>
          </section>
        </div>
      ) : null}
      {status ? <p className="settings-inline-status" role="status">{status}</p> : null}
      {output ? (
        <section className="media-output-card">
          <div className="workbench-card-heading"><div><strong>最近结果</strong><small>{String(output.summary || output.mode || '')}</small></div></div>
          {previewURL && outputKind === 'audio' ? <audio controls src={previewURL} /> : null}
          {previewURL && outputKind === 'video' ? <video controls playsInline src={previewURL} /> : null}
          {contactSheetURL ? <img src={contactSheetURL} alt="视频关键帧接触表" /> : null}
          {typeof output.transcript === 'string' ? <pre>{output.transcript}</pre> : null}
          {typeof output.recognized_text === 'string' && output.recognized_text ? <pre>{output.recognized_text}</pre> : null}
          <CollapsedData label="查看媒体分析结果" value={output} />
        </section>
      ) : null}
    </section>
  );
}

function AssistantWorkspacePanel() {
  const [tab, setTab] = useState<'activity' | 'calendar' | 'plans' | 'channels'>('activity');
  const [snapshot, setSnapshot] = useState<AssistantWorkspaceSnapshot | null>(null);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');
  const [activityTitle, setActivityTitle] = useState('专注工作');
  const [activityInterval, setActivityInterval] = useState('60');
  const [calendarTitle, setCalendarTitle] = useState('回顾 Joi 进度');
  const [calendarStart, setCalendarStart] = useState(nextLocalDateTimeValue(60));
  const [calendarEnd, setCalendarEnd] = useState(nextLocalDateTimeValue(120));
  const [calendarNotes, setCalendarNotes] = useState('');
  const [planTitle, setPlanTitle] = useState('实现与验证计划');
  const [planObjective, setPlanObjective] = useState('完成任务，为每个节点保留证据并复盘。');
  const [selectedPlanID, setSelectedPlanID] = useState('');
  const [planNodeTitle, setPlanNodeTitle] = useState('运行实际验收测试');
  const [channelProvider, setChannelProvider] = useState('discord');
  const [channelWebhook, setChannelWebhook] = useState('');
  const [channelTarget, setChannelTarget] = useState('');
  const [channelMessage, setChannelMessage] = useState('来自 Joi 个人助理的连接测试。');

  async function refresh() {
    setBusy('refresh');
    try {
      const next = await desktopApi.getAssistantWorkspace();
      setSnapshot(next);
      if (!selectedPlanID && next.plans[0]) setSelectedPlanID(next.plans[0].id);
      setStatus('');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function action(actionName: string, request: Record<string, unknown> = {}) {
    setBusy(actionName);
    setStatus('');
    try {
      const result = await desktopApi.executeAssistantAction({ action: actionName, ...request });
      if (result.snapshot) setSnapshot(result.snapshot);
      const item = objectFromUnknown(result.item);
      if (actionName === 'create_plan' && typeof item.id === 'string') setSelectedPlanID(item.id);
      setStatus(assistantActionStatus(actionName, result));
      return result;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy('');
    }
  }

  const selectedPlan = snapshot?.plans.find((plan) => plan.id === selectedPlanID) || snapshot?.plans[0] || null;
  const capture = snapshot?.capture;

  return (
    <section className="settings-detail-panel assistant-workspace-panel">
      <DetailHeader title="个人助理工作台" description="把屏幕活动、日历草稿、证据化计划与外部渠道组成可观察、可停止、可复盘的闭环" />
      <SettingsInlineTabs tabs={[['activity', '活动'], ['calendar', '日历'], ['plans', '计划'], ['channels', '渠道']]} active={tab} onChange={(value) => setTab(value as typeof tab)} />
      {tab === 'activity' ? (
        <div className="workbench-pane">
          <section className="workbench-card assistant-capture-card">
            <div className="workbench-card-heading">
              <div><strong>工作活动捕获</strong><small>定时记录前台 app、窗口、截图和本地 OCR；原图只保存在 Joi 本地目录</small></div>
              <span className={`assistant-capture-state ${capture?.active ? 'active' : ''}`}>{capture?.active ? '记录中' : '已停止'}</span>
            </div>
            <div className="inline-field-grid">
              <label><span>会话名称</span><input value={activityTitle} onChange={(event) => setActivityTitle(event.target.value)} /></label>
              <label><span>间隔（秒）</span><input type="number" min="15" max="3600" value={activityInterval} onChange={(event) => setActivityInterval(event.target.value)} /></label>
            </div>
            <div className="detail-actions">
              {capture?.active
                ? <button className="danger-button" type="button" disabled={Boolean(busy)} onClick={() => void action('stop_activity', { session_id: capture.session_id })}>停止并生成摘要</button>
                : <button type="button" disabled={Boolean(busy)} onClick={() => void action('start_activity', { title: activityTitle, interval_seconds: Number(activityInterval) })}>开始记录</button>}
              <button className="secondary-button" type="button" disabled={Boolean(busy) || !capture?.active} onClick={() => void action('capture_activity_now', { session_id: capture?.session_id })}>立即捕获一次</button>
            </div>
          </section>
          <RecordList
            emptyText="暂无活动记录。"
            items={snapshot?.recent_activity.slice(0, 12) || []}
            renderItem={(event) => (
              <article className="row-card assistant-activity-row" key={event.id}>
                {event.screenshot_path ? <img src={localPathURL(event.screenshot_path)} alt="活动截图" /> : null}
                <div><strong>{event.app_name || '未知 app'}{event.window_title ? ` · ${event.window_title}` : ''}</strong><p>{compactQueueMessage(event.text || '未识别到可读文字')}</p><small>{formatShortTime(event.created_at)}</small></div>
              </article>
            )}
          />
        </div>
      ) : null}
      {tab === 'calendar' ? (
        <div className="workbench-pane">
          <section className="workbench-card">
            <div className="workbench-card-heading"><div><strong>日历草稿</strong><small>先在 Joi 中审核，再显式发布到 macOS 默认日历</small></div></div>
            <div className="settings-form">
              <label className="field-row"><span>标题</span><input value={calendarTitle} onChange={(event) => setCalendarTitle(event.target.value)} /></label>
              <label className="field-row"><span>开始</span><input type="datetime-local" value={calendarStart} onChange={(event) => setCalendarStart(event.target.value)} /></label>
              <label className="field-row"><span>结束</span><input type="datetime-local" value={calendarEnd} onChange={(event) => setCalendarEnd(event.target.value)} /></label>
              <label className="field-row"><span>备注</span><textarea rows={3} value={calendarNotes} onChange={(event) => setCalendarNotes(event.target.value)} /></label>
            </div>
            <div className="detail-actions"><button type="button" disabled={Boolean(busy) || !calendarTitle.trim() || !calendarStart} onClick={() => void action('create_calendar_item', { title: calendarTitle, start_at: new Date(calendarStart).toISOString(), end_at: calendarEnd ? new Date(calendarEnd).toISOString() : undefined, text: calendarNotes })}>保存草稿</button></div>
          </section>
          <RecordList
            emptyText="暂无日历草稿。"
            items={snapshot?.calendar || []}
            renderItem={(item) => (
              <article className="row-card" key={item.id}>
                <div><strong>{item.title}</strong><p>{formatShortTime(item.start_at)}{item.end_at ? ` → ${formatShortTime(item.end_at)}` : ''}</p><small>{item.status === 'published' ? `已发布·${item.external_id || 'macOS 日历'}` : '待发布草稿'}</small></div>
                {item.status !== 'published' ? <button type="button" disabled={Boolean(busy)} onClick={() => void action('publish_calendar_item', { id: item.id })}>发布到日历</button> : null}
              </article>
            )}
          />
        </div>
      ) : null}
      {tab === 'plans' ? (
        <div className="workbench-pane">
          <section className="workbench-card">
            <div className="workbench-card-heading"><div><strong>创建计划</strong><small>每个节点有状态、依赖和证据，最后生成复盘</small></div></div>
            <div className="settings-form">
              <label className="field-row"><span>名称</span><input value={planTitle} onChange={(event) => setPlanTitle(event.target.value)} /></label>
              <label className="field-row"><span>目标</span><textarea rows={3} value={planObjective} onChange={(event) => setPlanObjective(event.target.value)} /></label>
            </div>
            <div className="detail-actions"><button type="button" disabled={Boolean(busy) || !planTitle.trim()} onClick={() => void action('create_plan', { title: planTitle, objective: planObjective })}>创建计划</button></div>
          </section>
          {snapshot?.plans.length ? (
            <div className="assistant-plan-workspace">
              <select value={selectedPlan?.id || ''} onChange={(event) => setSelectedPlanID(event.target.value)}>{snapshot.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select>
              {selectedPlan ? (
                <section className="workbench-card">
                  <div className="workbench-card-heading"><div><strong>{selectedPlan.title}</strong><small>{selectedPlan.objective}</small></div><span>{selectedPlan.nodes.filter((node) => node.status === 'completed').length}/{selectedPlan.nodes.length}</span></div>
                  <div className="assistant-plan-nodes">
                    {selectedPlan.nodes.map((node) => (
                      <button key={node.id} className={node.status === 'completed' ? 'completed' : ''} type="button" onClick={() => void action('update_plan_node', { id: node.id, metadata: { status: node.status === 'completed' ? 'pending' : 'completed', evidence: node.status === 'completed' ? [] : [{ kind: 'manual_confirmation', at: new Date().toISOString() }] } })}><span>{node.status === 'completed' ? '✓' : '○'}</span><strong>{node.title}</strong><small>{node.evidence.length} 条证据</small></button>
                    ))}
                  </div>
                  <div className="inline-add-row"><input value={planNodeTitle} onChange={(event) => setPlanNodeTitle(event.target.value)} placeholder="新步骤" /><button type="button" disabled={Boolean(busy) || !planNodeTitle.trim()} onClick={() => void action('add_plan_node', { id: selectedPlan.id, title: planNodeTitle })}>添加</button></div>
                  <div className="detail-actions"><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void action('review_plan', { id: selectedPlan.id })}>生成复盘</button></div>
                  {selectedPlan.review_summary ? <p className="settings-inline-status">{selectedPlan.review_summary}</p> : null}
                </section>
              ) : null}
            </div>
          ) : <p className="empty">暂无计划。</p>}
        </div>
      ) : null}
      {tab === 'channels' ? (
        <div className="workbench-pane">
          <section className="workbench-card">
            <div className="workbench-card-heading"><div><strong>渠道连接</strong><small>Telegram / iMessage 复用现有连接；Discord / 飞书 webhook 仅写入 macOS Keychain</small></div></div>
            <div className="settings-form">
              <label className="field-row"><span>渠道</span><select value={channelProvider} onChange={(event) => setChannelProvider(event.target.value)}><option value="telegram">Telegram</option><option value="imessage">iMessage</option><option value="discord">Discord</option><option value="feishu">飞书</option><option value="email">邮件</option></select></label>
              {(channelProvider === 'discord' || channelProvider === 'feishu') ? <label className="field-row"><span>Webhook</span><SecretInput placeholder="https://..." value={channelWebhook} visible={false} onChange={setChannelWebhook} onToggleVisible={() => undefined} /></label> : null}
              <label className="field-row"><span>目标</span><input placeholder={channelProvider === 'email' ? 'name@example.com' : 'chat / space id'} value={channelTarget} onChange={(event) => setChannelTarget(event.target.value)} /></label>
              <label className="field-row"><span>消息</span><textarea rows={3} value={channelMessage} onChange={(event) => setChannelMessage(event.target.value)} /></label>
            </div>
            <div className="detail-actions">
              {(channelProvider === 'discord' || channelProvider === 'feishu') ? <button className="secondary-button" type="button" disabled={Boolean(busy) || !channelWebhook.trim()} onClick={() => void action('configure_channel', { provider: channelProvider, title: channelProvider === 'discord' ? 'Discord' : '飞书', enabled: true, metadata: { webhook_url: channelWebhook, configured: true } })}>保存连接</button> : null}
              <button type="button" disabled={Boolean(busy) || !channelMessage.trim()} onClick={() => void action('send_channel_message', { provider: channelProvider, id: channelTarget, title: 'Joi', text: channelMessage, metadata: { target: channelTarget } })}>发送测试</button>
            </div>
          </section>
          <div className="assistant-channel-grid">
            {(snapshot?.channels || []).map((channel) => <article key={channel.id}><span className={`live-dot ${channel.enabled && channel.configured ? 'on' : ''}`} /><div><strong>{channel.name}</strong><small>{channel.status}</small></div></article>)}
          </div>
        </div>
      ) : null}
      {status ? <p className="settings-inline-status" role="status">{status}</p> : null}
      <div className="detail-actions"><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void refresh()}>{busy === 'refresh' ? '刷新中…' : '刷新工作台'}</button></div>
    </section>
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
              <small>作用域：{formatMemoryScope(memory.scope_type)}{memory.scope_id ? ` · ${memory.scope_id}` : ''}{memoryAgeLabel(memory) ? ` · ${memoryAgeLabel(memory)}` : ''}</small>
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

function formatMemoryScope(scope?: string): string {
  if (scope === 'global') return '全局';
  if (scope === 'user') return '当前用户';
  if (scope === 'room') return '当前房间';
  if (scope === 'project') return '项目';
  return scope || '全局';
}

function formatMemoryLayer(layer?: string): string {
  if (layer === 'persona') return '人格宪法';
  if (layer === 'profile') return '稳定档案';
  if (layer === 'knowledge') return '知识与规则';
  if (layer === 'state') return '当前状态';
  if (layer === 'episode') return '任务情节';
  return layer || '知识与规则';
}

function memoryAgeLabel(memory: MemoryRecord): string {
  const timestamp = memory.last_used_at || memory.updated_at || memory.created_at;
  if (!timestamp) return '';
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return '';
  const days = Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
  if (['pending', 'candidate', 'proposed', 'conflicted'].includes(memory.status)) return `已等待 ${days} 天`;
  return memory.last_used_at ? `${days} 天前使用` : `${days} 天前更新`;
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
  checkpointCount,
  collapsed,
  conversations,
  currentConversationID,
  loadingConversationID,
  loadConversation,
  openToday,
  query,
  searchOpen,
  setQuery,
  setActiveTab,
  trace,
}: {
  activeTab: Tab;
  archiveConversation: (conversationID: string) => Promise<void>;
  chat: ChatResponse | null;
  checkpointCount: number;
  collapsed: boolean;
  conversations: ConversationSummary[];
  currentConversationID: string;
  loadingConversationID: string;
  loadConversation: (conversationID: string) => Promise<void>;
  openToday: () => void;
  query: string;
  searchOpen: boolean;
  setQuery: (query: string) => void;
  setActiveTab: (tab: Tab) => void;
  trace: RunTrace | null;
}) {
  const isRoomContext = activeTab === 'chat' || activeTab === 'trace';
  const conversationSections = splitSingleAgentConversations(conversations);

  function renderConversationRow(item: ConversationSummary, channelRow: boolean) {
    const active = currentConversationID === item.id || (!currentConversationID && chat?.conversation_id === item.id);
    return (
      <div key={item.id} className={`conversation-row-wrap ${channelRow ? 'channel-conversation-row' : ''} ${active && isRoomContext ? 'active' : ''}`}>
        <button
          className={`conversation-item conversation-chat-item ${active && isRoomContext ? 'active' : ''}`}
          aria-busy={loadingConversationID === item.id || undefined}
          type="button"
          onClick={() => {
            if (loadingConversationID !== item.id) void loadConversation(item.id);
          }}
        >
          <span className="thread-list-copy">
            {channelRow ? (
              <span className={`channel-source-badge channel-source-${classToken(item.channel)}`}>
                {conversationChannelLabel(item.channel)}
              </span>
            ) : <strong>{conversationTitle(item)}</strong>}
          </span>
          <span className="thread-list-meta">
            <time>{formatShortTime(item.updated_at)}</time>
          </span>
        </button>
        <div className="conversation-row-actions">
          <button type="button" onClick={() => void archiveConversation(item.id)}>归档</button>
        </div>
      </div>
    );
  }

  return (
    <aside
      aria-hidden={collapsed || undefined}
      className="im-sidebar app__sidebar tk-sidebar"
      inert={collapsed ? true : undefined}
    >
      <div className="thread-sidebar-heading">
        <strong>会话</strong>
        <span>{conversations.length}</span>
      </div>
      <button
        aria-current={activeTab === 'today' ? 'page' : undefined}
        className={`sidebar-today-item ${activeTab === 'today' ? 'active' : ''}`}
        type="button"
        onClick={openToday}
      >
        <TodayIcon />
        <span>今日</span>
        <span className={`sidebar-today-count ${checkpointCount === 0 ? 'quiet' : ''}`}>{checkpointCount}</span>
      </button>
      {searchOpen ? (
        <label className="thread-search-field">
          <span className="sr-only">搜索线程</span>
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索线程" />
        </label>
      ) : null}
      <ScrollArea className="conversation-list tk-sidebar-scroll">
        {conversationSections.channels.length ? (
          <section className="conversation-sidebar-section channel-sidebar-section" aria-label="渠道">
            <div className="conversation-section-heading">
              <strong>渠道</strong>
              <span>{conversationSections.channels.length}</span>
            </div>
            {conversationSections.channels.map((item) => renderConversationRow(item, true))}
          </section>
        ) : null}
        {conversationSections.threads.length ? (
          <section className="conversation-sidebar-section thread-sidebar-section" aria-label="线程">
            <div className="conversation-section-heading">
              <strong>线程</strong>
              <span>{conversationSections.threads.length}</span>
            </div>
            {conversationSections.threads.map((item) => renderConversationRow(item, false))}
          </section>
        ) : null}
        {!conversations.length ? (
          <div className="thread-list-empty">
            <strong>{query ? '没有匹配线程' : (chat ? '当前线程' : '还没有线程')}</strong>
            <small>{query ? '换个关键词试试' : '点击左上角 + 创建新线程'}</small>
          </div>
        ) : null}
      </ScrollArea>
      <footer className="sidebar-footer">
        <span aria-hidden="true" className="user-avatar user-avatar-self">你</span>
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

function handleTitlebarControlPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
  if (event.button !== 0 || !event.isPrimary) return;
  event.preventDefault();
  event.stopPropagation();
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture is unavailable for synthetic keyboard/browser activations.
  }
}

function handleTitlebarControlPointerUp(
  event: ReactPointerEvent<HTMLButtonElement>,
  action: () => void,
) {
  if (event.button !== 0 || !event.isPrimary) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  const releasedInside = event.clientX >= rect.left
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom;
  try {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  } catch {
    // The browser may release capture automatically before React observes it.
  }
  if (!releasedInside) return;
  action();
}

function handleTitlebarControlClickAction(
  event: ReactMouseEvent<HTMLButtonElement>,
  action: () => void,
) {
  event.preventDefault();
  event.stopPropagation();
  // Pointer activation is handled on pointerup so Electron's draggable
  // titlebar cannot swallow the matching click. A zero-detail click is a
  // keyboard or accessibility activation and still needs to run the action.
  if (event.detail === 0) action();
}

function SidebarTopControls({
  collapsed,
  newThread,
  searchOpen,
  toggleSearch,
  toggleCollapsed,
}: {
  collapsed: boolean;
  newThread: () => void;
  searchOpen: boolean;
  toggleSearch: () => void;
  toggleCollapsed: () => void;
}) {
  return (
    <div className="sidebar-top-controls">
      <button
        aria-label="新建线程"
        className="round-icon-button"
        title="新建线程"
        type="button"
        onClick={(event) => handleTopControlClickAction(event, newThread)}
      >
        <SidebarIcon name="plus" />
      </button>
      <button
        aria-label="搜索线程"
        aria-pressed={searchOpen}
        className={`round-icon-button ${searchOpen ? 'active' : ''}`}
        title="搜索线程"
        type="button"
        onClick={(event) => handleTopControlClickAction(event, toggleSearch)}
      >
        <SidebarIcon name="search" />
      </button>
      <button
        aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        className="round-icon-button collapse-sidebar-button"
        title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        type="button"
        onClick={(event) => handleTitlebarControlClickAction(event, toggleCollapsed)}
        onPointerDown={handleTitlebarControlPointerDown}
        onPointerUp={(event) => handleTitlebarControlPointerUp(event, toggleCollapsed)}
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
  const layer = useLayerLifecycle<HTMLElement>(onClose);
  return (
    <div
      className={`modal-backdrop ui-layer${layer.isClosing ? ' is-closing' : ''}`}
      role="presentation"
      onMouseDown={layer.requestClose}
    >
      <section
        ref={layer.surfaceRef}
        className={`project-persona-modal ui-dialog-surface${layer.isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-persona-modal-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="project-persona-modal-title">新建项目人格</h2>
          <button type="button" onClick={layer.requestClose}>关闭</button>
        </header>
        <div className="project-persona-form">
          <label>
            <span>项目名称</span>
            <input data-layer-initial-focus value={draft.name} onChange={(event) => onDraftChange({ ...draft, name: event.target.value })} />
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
          <button type="button" onClick={layer.requestClose}>取消</button>
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
        onClick={(event) => handleTitlebarControlClickAction(event, toggleCollapsed)}
        onPointerDown={handleTitlebarControlPointerDown}
        onPointerUp={(event) => handleTitlebarControlPointerUp(event, toggleCollapsed)}
      >
        <SidebarIcon name={collapsed ? 'expand' : 'collapse'} />
      </button>
    </div>
  );
}

function SettingsWindowTitlebar({
  activeCategory,
  activeObjectID,
  automations,
  collapsed,
  goBack,
  nodes,
  selectSettingsObject,
  toggleCollapsed,
}: {
  activeCategory: SettingsCategory;
  activeObjectID: string;
  automations: AutomationDefinition[];
  collapsed: boolean;
  goBack: () => void;
  nodes: NodeRecord[];
  selectSettingsObject: SelectSettingsObject;
  toggleCollapsed: () => void;
}) {
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const activeCategoryMeta = settingsCategories.find((category) => category.id === activeCategory) ?? settingsCategories[0];
  const objectItems = getSettingsObjects(activeCategory, nodes, automations);
  const activeObject = objectItems.find((item) => item.id === activeObjectID) ?? objectItems[0];
  const showObjectTabs = activeCategory !== 'automations' && Boolean(activeObject);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeCategory, activeObject?.id, collapsed]);

  return (
    <div className="settings-window-titlebar">
      <SettingsTopControls collapsed={collapsed} goBack={goBack} toggleCollapsed={toggleCollapsed} />
      {showObjectTabs ? (
        <div className="settings-titlebar-tabs">
          <nav
            aria-label={`${activeCategoryMeta.label}对象`}
            className="settings-object-tabs"
            onWheel={(event) => {
              if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
              const previousScrollLeft = event.currentTarget.scrollLeft;
              event.currentTarget.scrollLeft += event.deltaY;
              if (event.currentTarget.scrollLeft !== previousScrollLeft) event.preventDefault();
            }}
          >
            <div className="settings-object-list" role="tablist">
              {objectItems.map((item) => {
                const active = activeObject.id === item.id;
                return (
                  <button
                    key={item.id}
                    ref={active ? activeTabRef : undefined}
                    aria-selected={active}
                    className={`settings-object-item ${active ? 'active' : ''}`}
                    role="tab"
                    type="button"
                    onClick={() => selectSettingsObject(activeCategory, item.id, { preserveSidebar: true })}
                  >
                    <strong>{item.label}</strong>
                  </button>
                );
              })}
            </div>
          </nav>
          <div aria-hidden="true" className="settings-titlebar-drag-handle" />
        </div>
      ) : null}
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
  currentConversationID,
  currentThreadChannel,
  currentThreadTitle,
  cancelRun,
  continueProductTask,
  decideConfirmation,
  decideProactiveMessage,
  health,
  inputMode,
  immersiveMode,
  isSubmitting,
  lastPrompt,
  message,
  memories,
  messenger,
  openArtifact,
  openLoops,
  openRunTrace,
  openConversation,
  loadConversationForMessage,
  pendingUserMessage,
  pendingRunMessages,
  queuedMessageMode,
  streamingAssistantMessage,
  proactiveMessages,
  productTasks,
  runEventsByRunId,
  savedModels,
  sidebarCollapsed,
  selectProductTask,
  settings,
  roomRouteLock,
  rollbackPersonaVersion,
  retryExternalConnectorEvent,
  removeAttachment,
  cancelQueuedRunMessage,
  setActiveTab,
  setMessage,
  setQueuedMessageMode,
  startRightPanelResize,
  updateMemory,
  submit,
  toggleImmersiveMode,
  toggleSidebarCollapsed,
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
  currentConversationID: string;
  currentThreadChannel: string;
  currentThreadTitle: string;
  cancelRun: (runID: string) => Promise<void>;
  continueProductTask: (task: ProductTask) => Promise<void>;
  decideConfirmation: (id: string, approve: boolean, scope?: 'one_call' | 'current_run') => Promise<void>;
  decideProactiveMessage: (id: string, action: string, feedback?: string) => Promise<void>;
  health: SystemHealth | null;
  inputMode: InputMode;
  immersiveMode: boolean;
  isSubmitting: boolean;
  lastPrompt: string;
  message: string;
  memories: MemoryRecord[];
  messenger: PersonaMessengerSnapshot | null;
  openArtifact: (id: string) => Promise<void>;
  openLoops: OpenLoop[];
  openRunTrace: (runID: string, destination?: 'panel' | 'stage') => Promise<void>;
  openConversation: (conversationID: string) => Promise<void>;
  loadConversationForMessage: (messageID: string) => Promise<boolean>;
  pendingUserMessage: ConversationMessage | null;
  pendingRunMessages: RunQueuedMessage[];
  queuedMessageMode: 'steering' | 'follow_up';
  streamingAssistantMessage: StreamingAssistantMessage | null;
  proactiveMessages: ProactiveMessage[];
  productTasks: ProductTask[];
  runEventsByRunId: Record<string, NormalizedRunEvent[]>;
  savedModels: AvailableModel[];
  sidebarCollapsed: boolean;
  selectProductTask: (id: string) => Promise<void>;
  settings: SettingsRecord | null;
  roomRouteLock: PersonaMessengerSnapshot['route_locks'][number] | null;
  rollbackPersonaVersion: (personaID: string, targetVersion: number) => Promise<void>;
  retryExternalConnectorEvent: (eventID: string) => Promise<void>;
  removeAttachment: (id: string) => void;
  cancelQueuedRunMessage: (messageID: string, runID: string) => Promise<void>;
  setActiveTab: (tab: Tab) => void;
  setMessage: (value: string) => void;
  setQueuedMessageMode: (value: 'steering' | 'follow_up') => void;
  startRightPanelResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  updateMemory: (id: string, action: string, extra?: Partial<MemoryRecord>) => Promise<void>;
  submit: (event?: FormEvent) => Promise<void>;
  toggleImmersiveMode: () => void;
  toggleSidebarCollapsed: () => void;
  trace: RunTrace | null;
  traceSpanAudit: { spans: RunTraceSpan[]; summary: RunTraceSpanSummary };
  updateMessengerProject: (req: UpdateMessengerProjectRequest) => Promise<void>;
  updateMessengerRoom: (req: UpdateMessengerRoomRequest) => Promise<void>;
  updateProjectPersona: (req: UpdateProjectPersonaRequest) => Promise<void>;
  workspaceSettings: WorkspaceSettings | null;
}) {
  const reducedMotion = useReducedMotionPreference();
  const visibleChat = chat && (!currentConversationID || chat.conversation_id === currentConversationID)
    ? chat
    : null;
  const currentStreamingAssistant = streamingAssistantMessage
    && (!currentConversationID || streamingAssistantMessage.conversation_id === currentConversationID)
    ? streamingAssistantMessage
    : null;
  const fallbackSettledMessages = useMemo<ConversationMessage[]>(() => visibleChat
      ? [
        { id: visibleChat.user_message_id, conversation_id: visibleChat.conversation_id, role: 'user', content: lastPrompt },
        ...(currentStreamingAssistant ? [] : [{ id: visibleChat.assistant_message_id, conversation_id: visibleChat.conversation_id, role: 'assistant' as const, content: visibleChat.response, run_id: visibleChat.run_id }]),
      ]
      : [], [currentStreamingAssistant, lastPrompt, visibleChat]);
  const settledMessages = conversationMessages.length ? conversationMessages : fallbackSettledMessages;
  const visibleThreads = useMemo(
    () => currentThreadTitle ? visibleMessengerThreads(messenger, activeRoom) : [],
    [activeRoom, currentThreadTitle, messenger],
  );
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
  const assetConversationID = settledMessages[0]?.conversation_id || currentConversationID || visibleChat?.conversation_id || activeRoom?.conversation_id || '';
  const scopedStreamingAssistant = currentStreamingAssistant
    && (!assetConversationID || currentStreamingAssistant.conversation_id === assetConversationID)
    ? currentStreamingAssistant
    : null;
  const scopedPendingUserMessage = pendingUserMessage
    && (!assetConversationID || pendingUserMessage.conversation_id === assetConversationID)
    ? pendingUserMessage
    : null;
  const chatRunId = visibleChat && (!assetConversationID || visibleChat.conversation_id === assetConversationID)
    ? visibleChat.run_id
    : '';
  const traceRunId = trace && (!assetConversationID || trace.conversation_id === assetConversationID)
    ? trace.id
    : '';
  const streamingRunId = scopedStreamingAssistant ? getMessageRunId(scopedStreamingAssistant) : '';
  const pendingLiveRunId = (isSubmitting || scopedPendingUserMessage)
    ? latestActiveRunId(runEventsByRunId, assetConversationID)
    : '';
  const activeRunId = pendingLiveRunId || streamingRunId || chatRunId || traceRunId || '';
  const { assetRunIds, candidateRunIds } = useMemo(() => {
    const candidates = new Set<string>();
    const assets = new Set<string>();
    for (const item of projectionMessages) {
      const runId = getMessageRunId(item);
      if (runId) candidates.add(runId);
    }
    for (const item of settledMessages) {
      const runId = getMessageRunId(item);
      if (runId) assets.add(runId);
    }
    if (streamingRunId) {
      candidates.add(streamingRunId);
      assets.add(streamingRunId);
    }
    if (chatRunId) {
      candidates.add(chatRunId);
      assets.add(chatRunId);
    }
    if (traceRunId) candidates.add(traceRunId);
    if (activeRunId) candidates.add(activeRunId);
    return { assetRunIds: assets, candidateRunIds: candidates };
  }, [activeRunId, chatRunId, projectionMessages, settledMessages, streamingRunId, traceRunId]);
  const threadRunEventsByRunId = useMemo(
    () => pickRunEvents(runEventsByRunId, candidateRunIds),
    [candidateRunIds, runEventsByRunId],
  );
  const currentAssetRunIds = useMemo(() => Array.from(assetRunIds), [assetRunIds]);
  const conversationProjection = useMemo(() => buildConversationRenderItems({
    messages: projectionMessages,
    conversationId: assetConversationID,
    pendingUserMessage: scopedPendingUserMessage,
    streamingAssistant: scopedStreamingAssistant,
    runEventsByRunId: threadRunEventsByRunId,
    activeRunId,
    mode: inputMode,
  }), [activeRunId, assetConversationID, inputMode, projectionMessages, scopedPendingUserMessage, scopedStreamingAssistant, threadRunEventsByRunId]);
  const renderItems = conversationProjection.items;
  const hasThread = renderItems.length > 0;
  const activeTaskBelongsToCurrentRun = Boolean(activeProductTask?.task.latest_run_id && activeProductTask.task.latest_run_id === (chatRunId || traceRunId));
  const activeTaskDetail = activeTaskBelongsToCurrentRun ? activeProductTask : null;
  const visibleTrace = traceRunId ? trace : null;
  const executionActions = useMemo(() => projectRunTraceToActions(visibleTrace), [visibleTrace]);
  const visibleTraceActions = useMemo(() => visibleExecutionActions(executionActions), [executionActions]);
  const liveExecutionActions = activeExecutionActions.length > 0 ? activeExecutionActions : visibleTraceActions;
  const [rightPanelPreference, setRightPanelPreference] = useState<'collapsed' | 'expanded' | 'auto'>('collapsed');
  const [rightInspectorTab, setRightInspectorTab] = useState<RightInspectorTab>('conversation');
  const [selectedThreadID, setSelectedThreadID] = useState('');
  const [focusedMessageID, setFocusedMessageID] = useState('');
  const [focusMessageSerial, setFocusMessageSerial] = useState(0);
  const [threadLocateStatus, setThreadLocateStatus] = useState('');
  const [conversationTree, setConversationTree] = useState<ConversationTree | null>(null);
  const [conversationTreeBusy, setConversationTreeBusy] = useState(false);
  const [conversationTreeStatus, setConversationTreeStatus] = useState('');
  const [conversationBranchLabel, setConversationBranchLabel] = useState('');
  const [conversationBranchSummary, setConversationBranchSummary] = useState('');
  const [conversationCompactionSummary, setConversationCompactionSummary] = useState('');
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const conversationImportInputRef = useRef<HTMLInputElement | null>(null);
  const chatHomeRef = useRef<HTMLElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const rightPanelCollapsed = rightPanelPreference === 'collapsed'
    || (rightPanelPreference === 'auto' && autoRightPanelCollapsed);
  const effectiveRightPanelCollapsed = immersiveMode || rightPanelCollapsed;
  const conversationTreeOpen = !rightPanelCollapsed && rightInspectorTab === 'conversation';

  useEffect(() => {
    if (!activeTaskDetail) return;
    setRightPanelPreference('expanded');
  }, [activeTaskDetail?.task.id]);

  useEffect(() => {
    const root = chatHomeRef.current;
    const composer = composerRef.current;
    if (!root || !composer) return undefined;
    const reserveScope = root.closest<HTMLElement>('.im-app-shell') ?? root;

    let frame = 0;
    const updateReserve = () => {
      frame = 0;
      const reserve = Math.ceil(composer.getBoundingClientRect().height + 36);
      reserveScope.style.setProperty('--composer-reserve', `${reserve}px`);
    };
    const scheduleUpdate = () => {
      if (frame === 0) frame = window.requestAnimationFrame(updateReserve);
    };
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(composer);
    scheduleUpdate();

    return () => {
      observer.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
      reserveScope.style.removeProperty('--composer-reserve');
    };
  }, [immersiveMode]);

  async function refreshConversationTree(conversationID = assetConversationID) {
    if (!conversationID) {
      setConversationTree(null);
      return;
    }
    setConversationTreeBusy(true);
    try {
      const next = await desktopApi.getConversationTree(conversationID);
      setConversationTree(next);
      const active = findConversationTreeNode(next.root, next.active_conversation_id);
      setConversationBranchLabel(active?.label || '');
      setConversationBranchSummary(active?.summary || '');
      setConversationCompactionSummary((current) => current || buildManualConversationSummary(settledMessages));
      setConversationTreeStatus('');
    } catch (err) {
      setConversationTreeStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setConversationTreeBusy(false);
    }
  }

  useEffect(() => {
    if (!conversationTreeOpen) return;
    if (!assetConversationID) {
      setConversationTree(null);
      return;
    }
    if (conversationTree?.active_conversation_id === assetConversationID) return;
    void refreshConversationTree();
  }, [assetConversationID, conversationTree?.active_conversation_id, conversationTreeOpen]);

  async function createConversationBranch() {
    if (!assetConversationID) return;
    setConversationTreeBusy(true);
    try {
      const result = await desktopApi.createConversationBranch({
        source_conversation_id: assetConversationID,
        from_message_id: settledMessages[settledMessages.length - 1]?.id,
        source_run_id: activeRunId || undefined,
      });
      setConversationTreeStatus(`已创建分支，复制 ${result.copied_message_count} 条消息，原会话保持不变。`);
      await openConversation(result.child_conversation_id);
    } catch (err) {
      setConversationTreeStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setConversationTreeBusy(false);
    }
  }

  async function saveConversationBranchMetadata() {
    if (!assetConversationID) return;
    setConversationTreeBusy(true);
    try {
      const next = await desktopApi.updateConversationBranch({
        conversation_id: assetConversationID,
        label: conversationBranchLabel,
        summary: conversationBranchSummary,
      });
      setConversationTree(next);
      setConversationTreeStatus('分支名称和说明已保存。');
    } catch (err) {
      setConversationTreeStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setConversationTreeBusy(false);
    }
  }

  async function compactCurrentConversation() {
    if (!assetConversationID || !conversationCompactionSummary.trim()) return;
    setConversationTreeBusy(true);
    try {
      const result = await desktopApi.compactConversation({
        conversation_id: assetConversationID,
        summary: conversationCompactionSummary.trim(),
        keep_recent_messages: 8,
        reason: 'manual_workbench',
        source_run_id: activeRunId || undefined,
      });
      await refreshConversationTree(assetConversationID);
      setConversationTreeStatus(`已压缩 ${result.covered_message_count} 条早期消息的模型上下文；完整记录未删除。`);
    } catch (err) {
      setConversationTreeStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setConversationTreeBusy(false);
    }
  }

  async function exportConversationTree() {
    if (!assetConversationID) return;
    setConversationTreeBusy(true);
    try {
      const result = await desktopApi.exportConversation({ conversation_id: assetConversationID });
      setConversationTreeStatus(`已导出 ${result.message_count} 条消息与 ${result.branch_count} 个分支：${result.path}`);
    } catch (err) {
      setConversationTreeStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setConversationTreeBusy(false);
    }
  }

  async function importConversationTree(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] as (File & { path?: string }) | undefined;
    event.currentTarget.value = '';
    if (!file?.path) {
      setConversationTreeStatus('请在 Joi Desktop 安装版中选择 .joi-conversation.json 文件。');
      return;
    }
    setConversationTreeBusy(true);
    try {
      const result = await desktopApi.importConversation({ path: file.path });
      setConversationTreeStatus(`已导入 ${result.imported_conversation_ids.length} 个会话节点。`);
      await openConversation(result.conversation_id);
    } catch (err) {
      setConversationTreeStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setConversationTreeBusy(false);
    }
  }

  useEffect(() => {
    if (!focusedMessageID) return undefined;
    let clearTimer = 0;
    const frame = window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(messageAnchorSelector(focusedMessageID));
      if (!target) {
        setThreadLocateStatus('源消息暂未出现在当前聊天');
        return;
      }
      target.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
      setThreadLocateStatus('已定位到原聊天');
      clearTimer = window.setTimeout(() => {
        setFocusedMessageID((current) => current === focusedMessageID ? '' : current);
      }, 6000);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (clearTimer) window.clearTimeout(clearTimer);
    };
  }, [focusedMessageID, focusMessageSerial, reducedMotion, renderItems.length]);

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
    const thread = visibleThreads.find((item) => item.id === threadID);
    if (!thread) return;
    setSelectedThreadID(threadID);
    void locateThreadSource(thread);
  }

  return (
    <section
      ref={chatHomeRef}
      className={`chat-home companion-layout tk-workspace${effectiveRightPanelCollapsed ? ' companion-layout-right-collapsed' : ''}${immersiveMode ? ' immersive-chat-home' : ''}`}
    >
      <section className="chat-main-column tk-content-panel">
        {immersiveMode ? (
          <button
            aria-label="退出沉浸模式"
            className="immersive-mode-restore-button"
            title="退出沉浸模式 (Esc)"
            type="button"
            onClick={toggleImmersiveMode}
          >
            <RestoreChromeIcon />
          </button>
        ) : (
          <MessengerChatHeader
            inspectorOpen={!rightPanelCollapsed}
            onOpenInspector={() => setRightPanelPreference(rightPanelCollapsed ? 'expanded' : 'collapsed')}
            onOpenProfile={() => {
              setRightInspectorTab('overview');
              setRightPanelPreference('expanded');
            }}
            onToggleImmersiveMode={toggleImmersiveMode}
            sidebarCollapsed={sidebarCollapsed}
            threadChannel={currentThreadChannel}
            threadTitle={currentThreadTitle}
            toggleSidebarCollapsed={toggleSidebarCollapsed}
          />
        )}

        {hasThread ? (
          <ChatMessageScroller key={projectionMessages[0]?.conversation_id || visibleChat?.conversation_id || activeRunId || 'thread'}>
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
                useMessageScrollerItems
              />
              {isSubmitting && (pendingLiveRunId || scopedPendingUserMessage) && !scopedStreamingAssistant && !renderItems.some((item) => item.type === 'message' && item.role === 'assistant') && (
                <article className="message-row assistant-message pending-message">
                  <img className="message-avatar assistant" src={joiAvatar} alt="Joi" />
                  <div className="message-bubble">
                    <p>正在处理...</p>
                  </div>
                </article>
              )}
            </>
          </ChatMessageScroller>
        ) : (
          <ScrollArea className="chat-empty-state">
            {threadRestoreStatus ? <p className="empty">{threadRestoreStatus}</p> : null}
          </ScrollArea>
        )}

        {!immersiveMode ? (
          <form ref={composerRef} className="composer tk-floating-panel" aria-busy={isSubmitting} onSubmit={submit}>
          {isSubmitting ? (
            <div className="composer-run-queue-toolbar" aria-label="运行中消息控制">
              <span className="composer-run-live"><i aria-hidden="true" />运行中</span>
              <div className="composer-run-mode-tabs" role="tablist" aria-label="追加消息方式">
                <button
                  className={queuedMessageMode === 'steering' ? 'active' : ''}
                  role="tab"
                  aria-selected={queuedMessageMode === 'steering'}
                  type="button"
                  onClick={() => setQueuedMessageMode('steering')}
                >
                  现在引导
                </button>
                <button
                  className={queuedMessageMode === 'follow_up' ? 'active' : ''}
                  role="tab"
                  aria-selected={queuedMessageMode === 'follow_up'}
                  type="button"
                  onClick={() => setQueuedMessageMode('follow_up')}
                >
                  完成后继续
                </button>
              </div>
            </div>
          ) : null}
          <textarea
            placeholder={isSubmitting
              ? queuedMessageMode === 'steering' ? '立即引导当前运行...' : '当前运行完成后继续...'
              : '和 Joi 说点什么，或交给她一个任务...'}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleComposerKeyDown}
          />
          {pendingRunMessages.length ? (
            <div className="composer-run-queue" aria-label="等待处理的追加消息">
              {pendingRunMessages.map((item) => (
                <div className={`composer-run-queue-chip queue-${item.kind}`} key={item.id}>
                  <span>{item.kind === 'steering' ? '引导' : '随后'} · {compactQueueMessage(item.content)}</span>
                  <button
                    type="button"
                    aria-label="取消这条追加消息"
                    title="取消排队"
                    onClick={() => void cancelQueuedRunMessage(item.id, item.run_id)}
                  >
                    <CloseTabIcon />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
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
            <span className="composer-tools-spacer" />
            {isSubmitting ? (
              <button
                className="send-button stop-button"
                disabled={!activeRunId}
                type="button"
                title={activeRunId ? '中断当前运行' : '等待运行 ID'}
                aria-label="中断当前运行"
                onClick={() => void cancelRun(activeRunId)}
              >
                ■
              </button>
            ) : null}
            <button
              className="send-button"
              disabled={!message.trim() && attachments.length === 0}
              type="button"
              title={isSubmitting ? (queuedMessageMode === 'steering' ? '入队为当前引导' : '入队为完成后继续') : '发送'}
              aria-label={isSubmitting ? '追加消息' : '发送消息'}
              onClick={() => void submit()}
            >
              ↑
            </button>
          </div>
          </form>
        ) : null}
      </section>
      <div
        aria-hidden={effectiveRightPanelCollapsed || undefined}
        aria-label="调整右侧栏宽度"
        className={`right-panel-resizer${effectiveRightPanelCollapsed ? ' collapsed' : ''}`}
        role="separator"
        onPointerDown={startRightPanelResize}
      />
      <ScrollArea
        as="aside"
        aria-hidden={effectiveRightPanelCollapsed || undefined}
        aria-label="Joi 右侧检查器"
        className={`companion-right-panel tk-right-panel${effectiveRightPanelCollapsed ? ' collapsed' : ''}`}
        contentClassName="companion-right-panel-content tk-panel-body"
        inert={effectiveRightPanelCollapsed ? true : undefined}
      >
        {activeTaskDetail ? (
          <TaskExecutionPanel
            cancelRun={cancelRun}
            continueProductTask={continueProductTask}
            detail={activeTaskDetail}
            openArtifact={openArtifact}
            openTrace={() => {
              if (activeTaskDetail.task.latest_run_id) {
                void openRunTrace(activeTaskDetail.task.latest_run_id, 'stage');
              }
            }}
          />
        ) : null}
        <CompanionInspectorPanel
          activeTab={rightInspectorTab}
          activeRoom={activeRoom}
          activePersona={activePersona}
          artifacts={artifacts}
          conversationTreePanel={(
            <ConversationTreeInspectorPanel
              busy={conversationTreeBusy}
              branchLabel={conversationBranchLabel}
              branchSummary={conversationBranchSummary}
              compactionSummary={conversationCompactionSummary}
              importInputRef={conversationImportInputRef}
              onBranch={() => void createConversationBranch()}
              onCompact={() => void compactCurrentConversation()}
              onExport={() => void exportConversationTree()}
              onImport={importConversationTree}
              onOpenConversation={(conversationID) => void openConversation(conversationID)}
              onSaveMetadata={() => void saveConversationBranchMetadata()}
              setBranchLabel={setConversationBranchLabel}
              setBranchSummary={setConversationBranchSummary}
              setCompactionSummary={setConversationCompactionSummary}
              status={conversationTreeStatus}
              tree={conversationTree}
            />
          )}
          conversationMessages={settledMessages}
          currentConversationID={assetConversationID}
          currentRunIDs={currentAssetRunIds}
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
          trace={visibleTrace}
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
    </section>
  );
}

function MessengerChatHeader({
  inspectorOpen,
  onOpenInspector,
  onOpenProfile,
  onToggleImmersiveMode,
  sidebarCollapsed,
  threadChannel,
  threadTitle,
  toggleSidebarCollapsed,
}: {
  inspectorOpen: boolean;
  onOpenInspector: () => void;
  onOpenProfile: () => void;
  onToggleImmersiveMode: () => void;
  sidebarCollapsed: boolean;
  threadChannel: string;
  threadTitle: string;
  toggleSidebarCollapsed: () => void;
}) {
  const messagingChannel = isMessagingConversationChannel(threadChannel);
  return (
    <header className="messenger-chat-header breadcrumb-bar">
      {sidebarCollapsed && (
        <button
          aria-label="展开侧边栏"
          className="round-icon-button messenger-sidebar-expand-button"
          title="展开侧边栏"
          type="button"
          onClick={(event) => handleTitlebarControlClickAction(event, toggleSidebarCollapsed)}
          onPointerDown={handleTitlebarControlPointerDown}
          onPointerUp={(event) => handleTitlebarControlPointerUp(event, toggleSidebarCollapsed)}
        >
          <SidebarIcon name="expand" />
        </button>
      )}
      <div className="messenger-chat-identity">
        <button
          aria-label="打开会话资料"
          className="messenger-chat-profile-button"
          title="打开会话资料"
          type="button"
          onClick={(event) => handleTitlebarControlClickAction(event, onOpenProfile)}
          onPointerDown={handleTitlebarControlPointerDown}
          onPointerUp={(event) => handleTitlebarControlPointerUp(event, onOpenProfile)}
        >
          <img className="joi-thread-header-avatar" src={joiAvatar} alt="" />
          <span className="messenger-chat-profile-copy">
            <strong>Joi</strong>
            <span className="messenger-chat-source-line">
              {messagingChannel ? (
                <span className={`channel-source-badge channel-source-${classToken(threadChannel)}`}>
                  {conversationChannelLabel(threadChannel)}
                </span>
              ) : null}
              <small>
                {threadTitle || '新线程'}
                {!messagingChannel && threadChannel ? ` · ${conversationChannelLabel(threadChannel)}` : ''}
              </small>
            </span>
          </span>
        </button>
      </div>
      <button
        className="observe-button immersive-mode-button"
        type="button"
        aria-label="进入沉浸模式"
        title="进入沉浸模式 (⌘⇧F)"
        onClick={(event) => handleTitlebarControlClickAction(event, onToggleImmersiveMode)}
        onPointerDown={handleTitlebarControlPointerDown}
        onPointerUp={(event) => handleTitlebarControlPointerUp(event, onToggleImmersiveMode)}
      >
        <ImmersiveModeIcon />
      </button>
      <button
        className={`observe-button ${inspectorOpen ? 'active' : ''}`}
        type="button"
        aria-expanded={inspectorOpen}
        aria-label={inspectorOpen ? '收起观察面板' : '展开观察面板'}
        title={inspectorOpen ? '收起观察面板' : '展开观察面板'}
        onClick={(event) => handleTitlebarControlClickAction(event, onOpenInspector)}
        onPointerDown={handleTitlebarControlPointerDown}
        onPointerUp={(event) => handleTitlebarControlPointerUp(event, onOpenInspector)}
      >
        <ExpandPanelIcon />
      </button>
    </header>
  );
}

function ConversationTreeInspectorPanel({
  branchLabel,
  branchSummary,
  busy,
  compactionSummary,
  importInputRef,
  onBranch,
  onCompact,
  onExport,
  onImport,
  onOpenConversation,
  onSaveMetadata,
  setBranchLabel,
  setBranchSummary,
  setCompactionSummary,
  status,
  tree,
}: {
  branchLabel: string;
  branchSummary: string;
  busy: boolean;
  compactionSummary: string;
  importInputRef: RefObject<HTMLInputElement | null>;
  onBranch: () => void;
  onCompact: () => void;
  onExport: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpenConversation: (conversationID: string) => void;
  onSaveMetadata: () => void;
  setBranchLabel: (value: string) => void;
  setBranchSummary: (value: string) => void;
  setCompactionSummary: (value: string) => void;
  status: string;
  tree: ConversationTree | null;
}) {
  const activeNode = tree ? findConversationTreeNode(tree.root, tree.active_conversation_id) : null;
  const hasBranches = Boolean(tree && tree.node_count > 1);
  return (
    <section
      id="right-inspector-conversation"
      className="conversation-workbench-panel right-inspector-tab-panel"
      role="tabpanel"
      aria-labelledby="right-inspector-tab-conversation"
    >
      <ScrollArea className="conversation-workbench-body" contentClassName="conversation-workbench-content">
        <section className="conversation-tree-section">
          <div className="conversation-tree-context">
            <span>只跟随当前会话，不包含其他历史会话。</span>
            <small>{tree ? (hasBranches ? `${tree.node_count} 个版本` : '尚无其他分支') : (busy ? '正在读取…' : '暂不可用')}</small>
          </div>
          {tree ? (
            <ConversationTreeRows node={tree.root} depth={0} onOpenConversation={onOpenConversation} />
          ) : (
            <p className="empty">{busy ? '正在读取分支…' : '当前会话暂时无法读取。'}</p>
          )}
        </section>
        <section className="conversation-branch-create">
          <p>保留当前会话，从这里创建一个独立版本。</p>
          <button className="primary" type="button" onClick={onBranch} disabled={busy || !activeNode}>从这里新开分支</button>
        </section>
        <details className="conversation-workbench-advanced">
          <summary><strong>高级</strong><span>命名、上下文与迁移</span></summary>
          <div className="conversation-workbench-advanced-body">
            <section className="conversation-workbench-section">
              <div className="conversation-workbench-section-title">
                <strong>当前版本信息</strong>
                <span>{activeNode ? `${activeNode.message_count} 条消息` : '—'}</span>
              </div>
              <label>
                <span>名称</span>
                <input value={branchLabel} placeholder="例如：方案 B" onChange={(event) => setBranchLabel(event.target.value)} />
              </label>
              <label>
                <span>说明</span>
                <textarea value={branchSummary} placeholder="这个版本验证什么" onChange={(event) => setBranchSummary(event.target.value)} />
              </label>
              <button type="button" onClick={onSaveMetadata} disabled={busy || !activeNode}>保存版本信息</button>
            </section>
            <section className="conversation-workbench-section">
                <div className="conversation-workbench-section-title">
                  <strong>上下文压缩</strong>
                  <span>{activeNode?.latest_compaction ? `已覆盖 ${activeNode.latest_compaction.covered_message_count} 条` : '尚未手动压缩'}</span>
                </div>
                <p>只替换下一轮提供给模型的早期上下文，不删聊天记录；最近 8 条消息保持原文。</p>
                <label>
                  <span>可恢复检查点摘要</span>
                  <textarea className="conversation-compaction-summary" value={compactionSummary} onChange={(event) => setCompactionSummary(event.target.value)} />
                </label>
                <button className="primary" type="button" onClick={onCompact} disabled={busy || !activeNode || !compactionSummary.trim()}>压缩当前上下文</button>
            </section>
            <section className="conversation-workbench-section conversation-portability-section">
                <div className="conversation-workbench-section-title"><strong>迁移</strong><span>Joi JSON</span></div>
                <input ref={importInputRef} className="visually-hidden" type="file" accept=".json,.joi-conversation.json" onChange={onImport} />
                <div className="conversation-workbench-action-row">
                  <button type="button" onClick={onExport} disabled={busy || !tree}>导出全部分支</button>
                  <button type="button" onClick={() => importInputRef.current?.click()} disabled={busy}>导入会话分支</button>
                </div>
            </section>
          </div>
        </details>
      </ScrollArea>
      {status ? <div className="conversation-workbench-status" role="status">{status}</div> : null}
      {busy ? <div className="conversation-workbench-progress" aria-hidden="true" /> : null}
    </section>
  );
}

function ConversationTreeRows({
  depth,
  node,
  onOpenConversation,
}: {
  depth: number;
  node: ConversationTree['root'];
  onOpenConversation: (conversationID: string) => void;
}) {
  return (
    <div className="conversation-tree-branch">
      <button
        className={`conversation-tree-node ${node.active ? 'active' : ''}`}
        style={{ '--conversation-tree-depth': depth } as CSSProperties}
        type="button"
        onClick={() => onOpenConversation(node.conversation_id)}
      >
        <span className="conversation-tree-rail" aria-hidden="true" />
        <span className="conversation-tree-dot" aria-hidden="true" />
        <span className="conversation-tree-node-copy">
          <strong>{node.label || node.title}</strong>
          <small>{node.message_count} 条消息{node.latest_compaction ? ` · 压缩 ${node.latest_compaction.covered_message_count} 条` : ''}</small>
          {node.summary ? <em>{node.summary}</em> : null}
        </span>
        {node.active ? <span className="conversation-tree-active-badge">当前</span> : null}
      </button>
      {node.children.map((child) => (
        <ConversationTreeRows key={child.conversation_id} node={child} depth={depth + 1} onOpenConversation={onOpenConversation} />
      ))}
    </div>
  );
}

function TodayIcon() {
  return (
    <svg className="sidebar-today-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 4h12v16H6z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
      <path d="m14 16 1.5 1.5L19 14" />
    </svg>
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

function ImmersiveModeIcon() {
  return (
    <svg className="observe-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 4H4v4" />
      <path d="M16 4h4v4" />
      <path d="M20 16v4h-4" />
      <path d="M8 20H4v-4" />
    </svg>
  );
}

function RestoreChromeIcon() {
  return (
    <svg className="observe-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 4v5H4" />
      <path d="M15 4v5h5" />
      <path d="M20 15h-5v5" />
      <path d="M4 15h5v5" />
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
        <KV label="验证" value={formatStatus(task.verification?.status || task.verification_status || 'pending')} />
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
  conversationTreePanel,
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
  retryExternalConnectorEvent,
  savedModels,
  setActiveTab,
  settings,
  onLocateThreadSource,
  onSelectThread,
  selectedThreadID,
  threadLocateStatus,
  trace,
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
  conversationTreePanel: ReactNode;
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
  retryExternalConnectorEvent: (eventID: string) => Promise<void>;
  savedModels: AvailableModel[];
  setActiveTab: (tab: RightInspectorTab) => void;
  settings: SettingsRecord | null;
  onLocateThreadSource: (thread: MessengerThread) => void;
  onSelectThread: (threadID: string) => void;
  selectedThreadID: string;
  threadLocateStatus: string;
  trace: RunTrace | null;
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
    ['conversation', '分支'],
    ['runs', '运行'],
    ['assets', '产物'],
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
      ) : effectiveTab === 'conversation' ? (
        conversationTreePanel
      ) : effectiveTab === 'runs' ? (
        <CurrentRunSummaryPanel
          openRunTrace={openRunTrace}
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
      <CurrentJoiOverviewPanel
        memories={memories}
        onOpenModelSettings={onOpenModelSettings}
        onOpenMemory={onOpenMemory}
        onSavePersona={onSavePersona}
        persona={activePersona}
        project={activeProject}
        room={room}
        savedModels={savedModels}
        settings={settings}
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
      {room ? (
        <RoomPersonaModelSettings
          messenger={messenger}
          onOpenModelSettings={onOpenModelSettings}
          onSavePersona={onSavePersona}
          room={room}
          savedModels={savedModels}
          settings={settings}
        />
      ) : null}
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
    </section>
  );
}

function RoomPersonaModelSettings({
  messenger,
  onOpenModelSettings,
  onSavePersona,
  room,
  savedModels,
  settings,
}: {
  messenger: PersonaMessengerSnapshot | null;
  onOpenModelSettings: () => void;
  onSavePersona: (req: UpdateProjectPersonaRequest) => Promise<void>;
  room: MessengerRoom;
  savedModels: AvailableModel[];
  settings: SettingsRecord | null;
}) {
  const modelOptions = useMemo(() => connectedModelOptions(savedModels, settings), [savedModels, settings]);
  const defaultModelID = settings?.model_name || modelOptions[0]?.id || '';
  const personas = useMemo(() => {
    const byID = new Map((messenger?.personas ?? []).map((persona) => [persona.id, persona]));
    return (room.members ?? [])
      .filter((member) => member.type === 'persona')
      .map((member) => byID.get(member.persona_id || member.id))
      .filter((persona): persona is ProjectPersona => Boolean(persona));
  }, [messenger?.personas, room.members]);
  const [savingPersonaID, setSavingPersonaID] = useState('');
  const [openModelMenu, setOpenModelMenu] = useState<{ personaID: string; top: number; right: number } | null>(null);

  useEffect(() => {
    if (!openModelMenu) return;

    function handlePointerDown(event: globalThis.PointerEvent) {
      const target = event.target;
      if (target instanceof Element && (target.closest('.overview-model-menu') || target.closest('.overview-model-trigger'))) return;
      setOpenModelMenu(null);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setOpenModelMenu(null);
    }

    function handleScroll() {
      setOpenModelMenu(null);
    }

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [openModelMenu]);

  if (personas.length === 0) return null;

  async function savePersonaModel(persona: ProjectPersona, modelID: string) {
    const selectedModelID = normalizePersonaModelSelection(modelID, modelOptions, defaultModelID);
    if (!selectedModelID) return;
    const currentModelID = normalizePersonaModelSelection(persona.model_strategy, modelOptions, defaultModelID);
    if (selectedModelID === currentModelID) return;
    setSavingPersonaID(persona.id);
    try {
      await onSavePersona({
        persona_id: persona.id,
        base_version: persona.version,
        actor_id: 'desktop_user',
        actor_role: 'project_owner',
        room_id: room.id,
        model_strategy: selectedModelID,
        change_reason: 'Update persona model from room overview',
      });
    } finally {
      setSavingPersonaID('');
    }
  }

  async function savePersonaReasoningEffort(persona: ProjectPersona, effort: string) {
    const selectedEffort = normalizeReasoningEffortValue(effort);
    const currentEffort = normalizeReasoningEffortValue(persona.model_reasoning_effort || settings?.model_reasoning_effort || 'low');
    if (selectedEffort === currentEffort) return;
    setSavingPersonaID(persona.id);
    try {
      await onSavePersona({
        persona_id: persona.id,
        base_version: persona.version,
        actor_id: 'desktop_user',
        actor_role: 'project_owner',
        room_id: room.id,
        model_reasoning_effort: selectedEffort,
        change_reason: 'Update persona reasoning effort from room overview',
      });
    } finally {
      setSavingPersonaID('');
    }
  }

  function toggleModelMenu(persona: ProjectPersona, event: ReactMouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const menuHeight = Math.min(520, Math.max(240, window.innerHeight - 24));
    const menuTop = Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - menuHeight - 12));
    setOpenModelMenu((current) => (
      current?.personaID === persona.id
        ? null
        : {
          personaID: persona.id,
          top: menuTop,
          right: Math.max(window.innerWidth - rect.right, 12),
        }
    ));
  }

  return (
    <section className="overview-model-section" aria-label="项目人格模型">
      <div className="overview-model-section-heading">
        <h3>模型</h3>
        <button type="button" onClick={onOpenModelSettings}>设置</button>
      </div>
      {modelOptions.length === 0 ? (
        <p className="empty">设置中还没有可选模型。</p>
      ) : (
        <div className="overview-model-list">
          {personas.map((persona) => {
            const selectedModelID = normalizePersonaModelSelection(persona.model_strategy, modelOptions, defaultModelID);
            const selectedModel = modelOptions.find((model) => model.id === selectedModelID);
            const saving = savingPersonaID === persona.id;
            return (
              <div key={persona.id} className="overview-model-row">
                <span className="overview-model-persona">
                  <strong>{persona.display_name}</strong>
                  <small>{persona.handle || persona.tagline || '项目人格'}</small>
                </span>
                <button
                  className="overview-model-trigger"
                  type="button"
                  aria-expanded={openModelMenu?.personaID === persona.id}
                  aria-haspopup="menu"
                  disabled={saving}
                  onClick={(event) => toggleModelMenu(persona, event)}
                >
                  <span>{selectedModel ? modelDisplayName(selectedModel) : selectedModelID || '未接入模型'}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
      {openModelMenu ? (
        <OverviewPersonaModelMenu
          defaultModelID={defaultModelID}
          menu={openModelMenu}
          modelOptions={modelOptions}
          onSelectModel={savePersonaModel}
          onSelectReasoning={savePersonaReasoningEffort}
          personas={personas}
          savingPersonaID={savingPersonaID}
          settings={settings}
        />
      ) : null}
    </section>
  );
}

function OverviewPersonaModelMenu({
  defaultModelID,
  menu,
  modelOptions,
  onSelectModel,
  onSelectReasoning,
  personas,
  savingPersonaID,
  settings,
}: {
  defaultModelID: string;
  menu: { personaID: string; top: number; right: number };
  modelOptions: AvailableModel[];
  onSelectModel: (persona: ProjectPersona, modelID: string) => Promise<void>;
  onSelectReasoning: (persona: ProjectPersona, effort: string) => Promise<void>;
  personas: ProjectPersona[];
  savingPersonaID: string;
  settings: SettingsRecord | null;
}) {
  const persona = personas.find((item) => item.id === menu.personaID);
  if (!persona) return null;

  const selectedModelID = normalizePersonaModelSelection(persona.model_strategy, modelOptions, defaultModelID);
  const selectedModel = modelOptions.find((model) => model.id === selectedModelID);
  const canSelectReasoning = selectedModel ? modelSupportsReasoningEffort(selectedModel, settings) : false;
  const selectedReasoningEffort = normalizeReasoningEffortValue(persona.model_reasoning_effort || settings?.model_reasoning_effort || 'low');
  const saving = savingPersonaID === persona.id;
  const menuStyle: CSSProperties = {
    top: menu.top,
    right: menu.right,
  };

  return (
    <div className="overview-model-menu" style={menuStyle} role="menu" aria-label={`${persona.display_name} 模型与思考等级`}>
      <div className="overview-model-menu-column overview-model-menu-models">
        <strong>模型</strong>
        <div>
          {modelOptions.map((model) => {
            const selected = model.id === selectedModelID;
            return (
              <button
                key={modelOptionKey(model)}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={selected ? 'selected' : ''}
                disabled={saving}
                onClick={() => void onSelectModel(persona, model.id)}
              >
                {modelDisplayName(model)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="overview-model-menu-column overview-model-menu-reasoning" aria-label="思考程度">
        <strong>思考程度</strong>
        {canSelectReasoning ? (
          <div>
            {reasoningEffortOptions.map((option) => {
              const selected = option.value === selectedReasoningEffort;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={selected ? 'selected' : ''}
                  disabled={saving}
                  onClick={() => void onSelectReasoning(persona, option.value)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        ) : (
          <p>当前模型不支持思考等级</p>
        )}
      </div>
    </div>
  );
}

function CurrentJoiOverviewPanel({
  memories,
  onOpenModelSettings,
  onOpenMemory,
  onSavePersona,
  persona,
  project,
  room,
  savedModels,
  settings,
}: {
  memories: MemoryRecord[];
  onOpenModelSettings: () => void;
  onOpenMemory: () => void;
  onSavePersona: (req: UpdateProjectPersonaRequest) => Promise<void>;
  persona: ProjectPersona;
  project: PersonaMessengerSnapshot['projects'][number] | null;
  room: MessengerRoom;
  savedModels: AvailableModel[];
  settings: SettingsRecord | null;
}) {
  const modelOptions = useMemo(() => connectedModelOptions(savedModels, settings), [savedModels, settings]);
  const defaultModelID = settings?.model_name || modelOptions[0]?.id || '';
  const selectedModelID = normalizePersonaModelSelection(persona.model_strategy, modelOptions, defaultModelID);
  const scopedMemories = useMemo(
    () => memoriesForPrivateProject(memories, persona, project).filter((memory) => (
      !isMemoryDisabled(memory) && !isLegacyJoiSurfaceMemory(memory)
    )),
    [memories, persona, project],
  );
  const [savingModel, setSavingModel] = useState(false);

  async function saveModel(modelID: string) {
    const nextModelID = normalizePersonaModelSelection(modelID, modelOptions, defaultModelID);
    if (!nextModelID || nextModelID === selectedModelID) return;
    setSavingModel(true);
    try {
      await onSavePersona({
        persona_id: persona.id,
        base_version: persona.version,
        actor_id: 'desktop_user',
        actor_role: 'project_owner',
        room_id: room.id,
        model_strategy: nextModelID,
        change_reason: 'Update Joi model from conversation overview',
      });
    } finally {
      setSavingModel(false);
    }
  }

  return (
    <section
      id="right-inspector-overview"
      className="right-panel-section current-joi-overview-panel"
      role="tabpanel"
      aria-labelledby="right-inspector-tab-overview"
    >
      <header className="current-joi-overview-header">
        <img src={joiAvatar} alt="" />
        <div>
          <small>当前会话</small>
          <h2>Joi</h2>
        </div>
      </header>
      <div className="inspector-metric-grid current-joi-overview-metrics">
        <KV label="状态" value={formatStatus(persona.status)} />
        <KV label="可用记忆" value={`${scopedMemories.length} 条`} />
      </div>
      <section className="current-joi-model-card" aria-label="当前回复模型">
        <div className="current-joi-section-heading">
          <div>
            <small>回复模型</small>
            <h3>当前模型</h3>
          </div>
          <button type="button" onClick={onOpenModelSettings}>设置</button>
        </div>
        <select
          aria-label="当前模型"
          disabled={savingModel || modelOptions.length === 0}
          value={selectedModelID}
          onChange={(event) => void saveModel(event.target.value)}
        >
          {modelOptions.length === 0 ? (
            <option value="">未接入模型</option>
          ) : modelOptions.map((model) => (
            <option key={modelOptionKey(model)} value={model.id}>
              {modelOptionLabel(model)}
            </option>
          ))}
        </select>
      </section>
      <button className="current-joi-memory-link" type="button" onClick={onOpenMemory}>
        <span>
          <strong>本轮记忆</strong>
          <small>查看召回内容并反馈准确性</small>
        </span>
        <span aria-hidden="true">›</span>
      </button>
    </section>
  );
}

function PrivateProjectOverviewPanel({
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
        </div>
      </form>
    </section>
  );
}

function TodayCheckpointPage({
  busy,
  checkpoint,
  onComplete,
  onDecideApproval,
  onDecideOpenLoop,
  onDecideProactive,
  onOpenArtifact,
  onOpenRun,
  onOpenTask,
  onResolveRecovery,
  sidebarCollapsed,
  toggleSidebarCollapsed,
}: {
  busy: boolean;
  checkpoint: PersonaMessengerSnapshot['checkpoint'] | null;
  onComplete: () => void;
  onDecideApproval: (id: string, approve: boolean) => void;
  onDecideOpenLoop: (id: string, action: 'done' | 'snooze') => void;
  onDecideProactive: (id: string, action: 'approve' | 'dismiss') => void;
  onOpenArtifact: (id: string) => void;
  onOpenRun: (id: string) => void;
  onOpenTask: (id: string) => void;
  onResolveRecovery: (id: string, action: 'retry' | 'abandon') => void;
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
}) {
  const items = checkpoint?.items ?? [];
  const meaningfulItems = items.filter(isVisibleTodayCheckpointItem);
  const quietItem = items.find((item) => item.kind === 'quiet');
  const itemCount = meaningfulItems.length;
  const sinceLabel = checkpoint?.since ? formatShortTime(checkpoint.since) : '最近 24 小时';
  return (
    <section className="today-page" aria-labelledby="today-page-title">
      <header className="today-page-header">
        {sidebarCollapsed ? (
          <button
            aria-label="展开侧边栏"
            className="round-icon-button today-sidebar-expand-button"
            title="展开侧边栏"
            type="button"
            onClick={(event) => handleTitlebarControlClickAction(event, toggleSidebarCollapsed)}
            onPointerDown={handleTitlebarControlPointerDown}
            onPointerUp={(event) => handleTitlebarControlPointerUp(event, toggleSidebarCollapsed)}
          >
            <SidebarIcon name="expand" />
          </button>
        ) : null}
        <div>
          <small>Today</small>
          <h1 id="today-page-title">今日检查</h1>
          <p>自 {sinceLabel} 后有 {itemCount} 项需要看一眼</p>
        </div>
      </header>
      <ScrollArea
        className="today-page-scroll"
        contentClassName="today-page-content"
        viewportAriaLabel="今日待处理事项"
        viewportTabIndex={0}
      >
        <div className="today-checkpoint-metrics">
          <KV label="需恢复" value={String(checkpoint?.recoverable_count ?? 0)} />
          <KV label="进行中" value={String(checkpoint?.active_task_count ?? 0)} />
          <KV label="待办" value={String(checkpoint?.open_loop_count ?? 0)} />
          <KV label="完成" value={String(checkpoint?.completed_count ?? 0)} />
          <KV label="失败" value={String(checkpoint?.failed_count ?? 0)} />
          <KV label="待审批" value={String(checkpoint?.pending_approval_count ?? 0)} />
          <KV label="无进展" value={String(checkpoint?.no_progress_project_count ?? 0)} />
          <KV label="新产物" value={String(checkpoint?.new_artifact_count ?? 0)} />
          <KV label="外部" value={String(checkpoint?.external_unhandled_count ?? 0)} />
          <KV label="成本" value={formatCost(checkpoint?.model_cost_estimate ?? 0)} />
        </div>
        <section className="today-page-items" aria-labelledby="today-page-items-title">
          <header>
            <strong id="today-page-items-title">需要处理</strong>
            <span>{itemCount}</span>
          </header>
          <div className="today-checkpoint-list">
            {meaningfulItems.map((item) => (
              <article key={item.id} className={`today-checkpoint-item checkpoint-${classToken(item.severity || item.kind)}`}>
                <span className="today-checkpoint-mark">{checkpointItemMark(item.severity || item.kind)}</span>
                <div>
                  <strong>{item.title}</strong>
                  {item.body ? <p>{item.body}</p> : null}
                  {item.kind === 'recovery_required' && item.run_id ? (
                    <div className="row-actions">
                      <button type="button" disabled={busy} onClick={() => onResolveRecovery(item.run_id!, 'retry')}>
                        {item.safe_to_retry === false ? '核对并继续' : '继续任务'}
                      </button>
                      <button type="button" disabled={busy} onClick={() => onResolveRecovery(item.run_id!, 'abandon')}>结束任务</button>
                      <button type="button" disabled={busy} onClick={() => onOpenRun(item.run_id!)}>查看记录</button>
                    </div>
                  ) : null}
                  {item.approval_id ? (
                    <div className="row-actions">
                      <button type="button" disabled={busy} onClick={() => onDecideApproval(item.approval_id!, true)}>批准</button>
                      <button type="button" disabled={busy} onClick={() => onDecideApproval(item.approval_id!, false)}>拒绝</button>
                    </div>
                  ) : null}
                  {item.product_task_id && item.kind === 'active_task' ? (
                    <div className="row-actions"><button type="button" disabled={busy} onClick={() => onOpenTask(item.product_task_id!)}>查看任务</button></div>
                  ) : null}
                  {item.open_loop_id && item.kind === 'open_loop' ? (
                    <div className="row-actions">
                      <button type="button" disabled={busy} onClick={() => onDecideOpenLoop(item.open_loop_id!, 'done')}>已处理</button>
                      <button type="button" disabled={busy} onClick={() => onDecideOpenLoop(item.open_loop_id!, 'snooze')}>稍后</button>
                    </div>
                  ) : null}
                  {item.proactive_message_id ? (
                    <div className="row-actions">
                      <button type="button" disabled={busy} onClick={() => onDecideProactive(item.proactive_message_id!, 'approve')}>采用</button>
                      <button type="button" disabled={busy} onClick={() => onDecideProactive(item.proactive_message_id!, 'dismiss')}>忽略</button>
                    </div>
                  ) : null}
                  {item.artifact_id ? (
                    <div className="row-actions"><button type="button" disabled={busy} onClick={() => onOpenArtifact(item.artifact_id!)}>查看产物</button></div>
                  ) : null}
                  {!item.artifact_id && !item.approval_id && item.run_id && item.kind !== 'recovery_required' && item.kind !== 'active_task' ? (
                    <div className="row-actions"><button type="button" disabled={busy} onClick={() => onOpenRun(item.run_id!)}>查看运行</button></div>
                  ) : null}
                </div>
              </article>
            ))}
            {meaningfulItems.length === 0 ? (
              <div className="today-page-empty">
                <span className="today-checkpoint-mark">✓</span>
                <div>
                  <strong>{quietItem?.title || '今天没有需要处理的事项'}</strong>
                  <p>{quietItem?.body || '新的任务、审批或提醒出现后，会集中显示在这里。'}</p>
                </div>
              </div>
            ) : null}
          </div>
          <footer className="today-checkpoint-actions">
            <button type="button" disabled={busy || itemCount === 0} onClick={onComplete}>
              {busy ? '写入中...' : '全部已读'}
            </button>
          </footer>
        </section>
      </ScrollArea>
    </section>
  );
}

function checkpointItemMark(kind: string) {
  if (kind === 'success' || kind.includes('completed')) return '✓';
  if (kind === 'error' || kind.includes('failed')) return '!';
  if (kind === 'warning' || kind.includes('approval') || kind.includes('external')) return '●';
  return '○';
}

function isVisibleTodayCheckpointItem(item: PersonaMessengerSnapshot['checkpoint']['items'][number]) {
  return item.kind !== 'quiet' && !item.kind.endsWith('_total');
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

function CurrentRunSummaryPanel({
  openRunTrace,
  trace,
}: {
  openRunTrace: (runID: string, destination?: 'panel' | 'stage') => Promise<void>;
  trace: RunTrace | null;
}) {
  const visibleActions = useMemo(
    () => visibleExecutionActions(projectRunTraceToActions(trace)),
    [trace],
  );
  const recentActions = visibleActions.slice(-6);

  return (
    <section
      id="right-inspector-runs"
      className="right-panel-section current-run-summary-panel"
      role="tabpanel"
      aria-labelledby="right-inspector-tab-runs"
    >
      <header>
        <small>当前对话</small>
        <h2>运行</h2>
      </header>
      {trace ? (
        <>
          <div className="inspector-metric-grid">
            <KV label="状态" value={formatStatus(trace.status)} />
            <KV label="模型调用" value={String(trace.model_calls?.length ?? 0)} />
            <KV label="动作" value={String(visibleActions.length)} />
          </div>
          {recentActions.length > 0 ? (
            <div className="current-run-action-list">
              <strong>最近动作</strong>
              {recentActions.map((action) => (
                <div key={action.id} className={`current-run-action-row status-${action.status}`}>
                  <span className={`status-dot ${action.status === 'running' || action.status === 'queued' ? 'running' : action.status === 'waiting_approval' ? 'waiting' : action.status === 'failed' || action.status === 'blocked' || action.status === 'limited' ? 'failed' : 'done'}`} />
                  <span>
                    <strong>{executionActionTitle(action)}</strong>
                    <small>{formatStatus(action.status)}</small>
                  </span>
                </div>
              ))}
            </div>
          ) : <p className="empty">本次运行没有需要展示的外部动作。</p>}
          <button className="current-run-detail-button" type="button" onClick={() => void openRunTrace(trace.id, 'panel')}>
            查看完整执行过程
          </button>
        </>
      ) : <p className="empty">当前对话还没有运行记录。</p>}
    </section>
  );
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
        <strong>{displayThreadTitle(room?.subtitle || room?.title || '当前对话')}</strong>
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
        <small>当前对话</small>
        <h2>产物</h2>
      </header>
      {visible.length === 0 ? <p className="empty">当前对话还没有上传文件或生成产物。</p> : (
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
    .filter(generatedArtifactIsFileAsset)
    .map((artifact): ConversationAssetItem => ({
      id: `generated:${artifact.id}`,
      title: artifact.title,
      source: 'generated',
      detail: `生成 · ${artifactAssetKindLabel(artifact)}`,
      previewUrl: generatedArtifactPreviewUrl(artifact),
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

function generatedArtifactIsFileAsset(artifact: ArtifactSummary): boolean {
  const type = normalizeAssetToken(artifact.type);
  const format = normalizeAssetToken(artifact.content_format);
  const metadata = artifact.metadata ?? {};
  const mimeType = normalizeAssetToken(assetString(metadata.mime_type) || assetString(metadata.mimeType) || assetString(metadata.content_type) || assetString(metadata.contentType));
  const fileRef = assetString(metadata.file_name)
    || assetString(metadata.filename)
    || assetString(metadata.file_path)
    || assetString(metadata.path)
    || assetString(metadata.download_url)
    || assetString(metadata.downloadUrl)
    || assetString(metadata.preview_url)
    || assetString(metadata.previewUrl)
    || assetString(metadata.url);

  if (type.includes('image') || type.includes('file') || type.includes('attachment') || type.includes('media')) return true;
  if (format.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'binary', 'file'].includes(format)) return true;
  if (mimeType.startsWith('image/') || (mimeType && !mimeType.startsWith('text/') && mimeType !== 'text/markdown' && mimeType !== 'application/json')) return true;
  return Boolean(fileRef);
}

function generatedArtifactPreviewUrl(artifact: ArtifactSummary): string | undefined {
  const metadata = artifact.metadata ?? {};
  const url = assetString(metadata.preview_url) || assetString(metadata.previewUrl) || assetString(metadata.url) || assetString(metadata.download_url) || assetString(metadata.downloadUrl);
  return url || undefined;
}

function artifactAssetKindLabel(artifact: ArtifactSummary): string {
  const type = normalizeAssetToken(artifact.type);
  const format = normalizeAssetToken(artifact.content_format);
  const metadata = artifact.metadata ?? {};
  const mimeType = normalizeAssetToken(assetString(metadata.mime_type) || assetString(metadata.mimeType) || assetString(metadata.content_type) || assetString(metadata.contentType));
  if (type.includes('image') || format.startsWith('image/') || mimeType.startsWith('image/')) return '图片';
  if (type.includes('video') || format.startsWith('video/') || mimeType.startsWith('video/')) return '视频';
  if (type.includes('audio') || format.startsWith('audio/') || mimeType.startsWith('audio/')) return '音频';
  return '文件';
}

function normalizeAssetToken(value: string) {
  return value.trim().toLowerCase();
}

function assetKindLabel(kind: string): string {
  if (kind === 'image') return '图片';
  if (kind === 'video') return '视频';
  if (kind === 'audio') return '音频';
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
        <small>{persona ? 'Project Persona' : 'Member'}</small>
        <h2>{persona?.display_name || member.display_name}</h2>
      </header>
      {persona ? (
        <>
          <div className="persona-card">
            <strong>{persona.display_name} <span>{persona.handle}</span></strong>
            <p>{persona.tagline}</p>
            <small>项目人格 · {project?.name || persona.project_id}</small>
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
            <KV label="角色" value={formatMemberRole(member.role) || '成员'} />
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
  const failed = isLogFailure(log);
  return (
    <article className={`log-entry-row log-level-${classToken(failed ? 'error' : log.level)}`}>
      <header>
        <span className="log-level-pill">{formatLogLevel(log.level)}</span>
        <span>{formatRiskLevel(log.risk_level)}</span>
        <time>{formatShortTime(log.created_at)}</time>
      </header>
      <strong>{friendlyLogSummary(log)}</strong>
      <small>{[formatLogCategory(log.category), log.status ? formatStatus(log.status) : '', log.duration_ms ? formatMilliseconds(log.duration_ms) : ''].filter(Boolean).join(' · ')}</small>
      {failed ? <small className="terminal-error">本次运行遇到问题，可导出诊断记录后继续排查。</small> : null}
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
      <h3>清理运行记录</h3>
      <dl className="metrics">
        <KV label="范围" value="本机活动、运行事件、模型与能力使用记录" />
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
          <span>包含详细过程</span>
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
          <span>包含执行器状态记录</span>
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
          清理记录
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
  const usedMemories = extractUsedMemories(trace)
    .filter((result) => !isLegacyJoiSurfaceMemory(result.memory))
    .slice(0, 4);
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
      <InsightList empty="本轮没有使用已确认记忆。">
        {usedMemories.map((result) => (
          <InsightItem key={`used-${result.memory.id}`} title={memoryInsightTitle(result.memory)} body={memoryInsightBody(result.memory)}>
            <small>匹配度 {memoryMatchPercent(result.score)}% · {formatMemoryReason(result.reason)}</small>
            <button type="button" onClick={() => updateMemory(result.memory.id, 'feedback_positive')}>准确</button>
            <button type="button" onClick={() => updateMemory(result.memory.id, 'feedback_negative')}>不准确</button>
            <button type="button" onClick={() => updateMemory(result.memory.id, 'disable')}>停用</button>
          </InsightItem>
        ))}
      </InsightList>
      <h3>本次建议</h3>
      <InsightList empty="本轮没有新的学习建议。">
        {pending.map((memory) => (
          <InsightItem key={memory.id} title={memoryInsightTitle(memory)} body={memoryInsightBody(memory)}>
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
      <WorkspaceChangeSetPanel productTaskID={task.id} runID={task.latest_run_id || ''} />
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
  const layer = useLayerLifecycle<HTMLElement>(close);
  const verification = artifactVerification(artifact);
  return (
    <div
      className={`artifact-viewer-backdrop ui-layer${layer.isClosing ? ' is-closing' : ''}`}
      role="presentation"
      onMouseDown={layer.requestClose}
    >
      <section
        ref={layer.surfaceRef}
        className={`artifact-viewer ui-dialog-surface${layer.isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="artifact-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <small>{formatArtifactType(artifact.type)} · 版本 {artifact.version}</small>
            <h2 id="artifact-title">{artifact.title}</h2>
          </div>
          <button type="button" aria-label="关闭交付物" onClick={layer.requestClose}>×</button>
        </header>
        <ScrollArea className="artifact-content">
          <ArtifactContent content={artifact.content} />
          {verification ? (
            <div className={`task-verification-block verification-${verification.status}`}>
              <h3>验证结果</h3>
              <p>{verification.summary || formatStatus(verification.status)}</p>
              {verification.checks.length > 0 ? (
                <ul>
                  {verification.checks.map((check) => (
                    <li key={check.name}>{check.name} · {formatStatus(check.status)}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <WorkspaceChangeSetPanel
            productTaskID={artifact.source_product_task_id || ''}
            runID={artifact.source_run_id || ''}
          />
        </ScrollArea>
      </section>
    </div>
  );
}

function WorkspaceChangeSetPanel({ productTaskID, runID }: { productTaskID: string; runID: string }) {
  const [changeSets, setChangeSets] = useState<WorkspaceChangeSet[]>([]);
  const [busyID, setBusyID] = useState('');
  const [panelError, setPanelError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!productTaskID && !runID) {
      setChangeSets([]);
      return () => {
        cancelled = true;
      };
    }
    void desktopApi.listWorkspaceChangeSets({
      product_task_id: productTaskID || undefined,
      run_id: productTaskID ? undefined : runID || undefined,
      limit: 20,
    }).then((result) => {
      if (!cancelled) setChangeSets(result.change_sets ?? []);
    }).catch((err) => {
      if (!cancelled) setPanelError(safeErrorText(err));
    });
    return () => {
      cancelled = true;
    };
  }, [productTaskID, runID]);

  async function revertChangeSet(changeSet: WorkspaceChangeSet) {
    if (!changeSet.reversible || changeSet.status !== 'applied') return;
    const confirmed = window.confirm(`撤销这次对 ${changeSet.files.length} 个文件的改动？如果文件之后又被修改，Joi 会拒绝覆盖。`);
    if (!confirmed) return;
    setBusyID(changeSet.id);
    setPanelError('');
    try {
      const reverted = await desktopApi.revertWorkspaceChangeSet({
        id: changeSet.id,
        reason: 'reverted from delivery view',
      });
      setChangeSets((current) => current.map((item) => item.id === reverted.id ? reverted : item));
    } catch (err) {
      setPanelError(safeErrorText(err));
    } finally {
      setBusyID('');
    }
  }

  if (changeSets.length === 0 && !panelError) return null;
  return (
    <div className="task-contract-block">
      <h3>文件改动</h3>
      {changeSets.map((changeSet) => (
        <div key={changeSet.id} className="insight-item">
          <strong>{changeSet.files.length} 个文件 · {formatStatus(changeSet.status)}</strong>
          <p>{changeSet.files.map((file) => file.path).join('、') || '没有文件改动'}</p>
          {changeSet.status === 'applied' ? (
            <div className="insight-actions">
              <button
                type="button"
                disabled={!changeSet.reversible || busyID === changeSet.id}
                onClick={() => void revertChangeSet(changeSet)}
              >
                {busyID === changeSet.id ? '正在撤销…' : changeSet.reversible ? '撤销这次改动' : '不可安全撤销'}
              </button>
            </div>
          ) : null}
        </div>
      ))}
      {panelError ? <p role="alert">{panelError}</p> : null}
    </div>
  );
}

function artifactVerification(artifact: ArtifactDetail): NonNullable<ProductTask['verification']> | null {
  const value = artifact.metadata?.verification;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const checks = Array.isArray(raw.checks) ? raw.checks.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const check = item as Record<string, unknown>;
    return [{
      name: String(check.name || '验证项'),
      status: String(check.status || 'pending'),
      evidence: check.evidence && typeof check.evidence === 'object' && !Array.isArray(check.evidence)
        ? check.evidence as Record<string, unknown>
        : undefined,
    }];
  }) : [];
  return {
    status: String(raw.status || artifact.metadata?.verification_status || 'pending'),
    summary: String(raw.summary || ''),
    checks,
    verified_at: typeof raw.verified_at === 'string' ? raw.verified_at : undefined,
  };
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

function isLegacyJoiSurfaceMemory(memory: MemoryRecord) {
  const text = `${memory.summary || ''}\n${memory.content || ''}`;
  return /五个项目人格|私人总群群主|群主\s*Owner/i.test(text)
    || /预览\s*UI[\s\S]*(?:房间|成员详情)[\s\S]*线程[\s\S]*资产[\s\S]*记忆/i.test(text);
}

function memoryMatchPercent(score: number) {
  return Math.max(0, Math.min(100, Math.round(score * 100)));
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

function memoryInsightTitle(memory: MemoryRecord) {
  return memory.summary?.trim() || memory.content?.trim() || memory.type || '记忆';
}

function memoryInsightBody(memory: MemoryRecord) {
  const title = memoryInsightTitle(memory).replace(/\s+/g, ' ').trim();
  const body = memory.content?.replace(/\s+/g, ' ').trim() || '';
  return body && body !== title ? body : undefined;
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
  const normalized = reason.toLowerCase();
  if (normalized === 'sqlite_fts5') return '全文召回';
  if (normalized === 'sqlite_keyword_fallback') return '关键词召回';
  if (normalized.includes('confirmed')) return normalized.includes('global') ? '全局已确认' : '已确认';
  if (normalized.includes('semantic') || normalized.includes('vector')) return '语义召回';
  return '相关记忆';
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
  const parts = text.match(/[\u4e00-\u9fff]|[^\S\r\n]+|[\r\n]+|[A-Za-z0-9_'-]+|./gu) ?? [text];
  const chunks: string[] = [];
  let current = '';
  for (const part of parts) {
    current += part;
    const hasCjk = /[\u4e00-\u9fff]/u.test(current);
    const limit = hasCjk ? 8 : 24;
    if (/[。！？.!?\n]$/u.test(part) || current.length >= limit) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

function streamingChunkDelay(chunk: string) {
  return Math.min(80, Math.max(18, chunk.length * 6));
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

function pluginProviderConfigs(plugin: PluginRecord): PluginProviderConfig[] {
  const value = plugin.metadata?.providers;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const provider = item as Record<string, unknown>;
    const id = String(provider.id || '').trim();
    const name = String(provider.name || id).trim();
    const protocol = String(provider.protocol || '').trim();
    const command = String(provider.command || '').trim();
    if (!id || !name || !protocol || !command) return [];
    const models = Array.isArray(provider.models)
      ? provider.models.flatMap((model) => {
        if (!model || typeof model !== 'object' || Array.isArray(model)) return [];
        const record = model as Record<string, unknown>;
        const modelID = String(record.id || '').trim();
        return modelID ? [{ id: modelID, name: String(record.name || modelID) }] : [];
      })
      : [];
    return [{
      id,
      name,
      protocol,
      command,
      args: Array.isArray(provider.args) ? provider.args.map(String) : [],
      runtime: typeof provider.runtime === 'string' ? provider.runtime : undefined,
      default_model: typeof provider.default_model === 'string' ? provider.default_model : undefined,
      auth_method: typeof provider.auth_method === 'string' ? provider.auth_method : undefined,
      description: typeof provider.description === 'string' ? provider.description : undefined,
      models,
      plugin_id: plugin.id,
    }];
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
  return model.display_name || model.id;
}

function modelDisplayName(model: AvailableModel) {
  return model.display_name || model.id;
}

function modelSupportsReasoningEffort(model: AvailableModel, settings: SettingsRecord | null) {
  if (model.supports_reasoning || model.config?.supports_reasoning) return true;
  const provider = normalizeProvider(model.provider || model.owner || settings?.model_provider || '');
  const modelID = model.id.trim().toLowerCase();
  if (providerAliases('grok_build').has(provider) && modelID.startsWith('grok-4.')) return true;
  return modelID.includes('reasoning') && !modelID.includes('non-reasoning');
}

function projectLocalPathValue(project: PersonaMessengerSnapshot['projects'][number] | null) {
  const value = project?.metadata?.local_path;
  return typeof value === 'string' ? value : '';
}

function normalizeProvider(value: string) {
  return value.trim().toLowerCase();
}

function providerAliases(provider: string): Set<string> {
  if (['xai', 'xai_oauth', 'xai-oauth', 'grok_build', 'grok-build'].includes(provider)) {
    return new Set(['xai', 'xai_oauth', 'xai-oauth', 'grok_build', 'grok-build']);
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
  'grok_build',
  'grok-build',
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

function normalizeReasoningEffortValue(value: string | undefined) {
  return value && reasoningEffortOptions.some((option) => option.value === value) ? value : 'low';
}

function splitSettingsList(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function defaultWorkspaceSettings(): WorkspaceSettings {
  return {
    allowed_roots: ['/Users/hao/project/Joi'],
    default_root: '/Users/hao/project/Joi',
    browser_allowed_hosts: [],
    web_research_allow_private_hosts: false,
    web_search_provider: 'auto',
    file_analyze_max_bytes: 256 * 1024,
    workspace_search_max_results: 50,
    browser_enabled: true,
    github_api_base_url: 'https://api.github.com',
    node_assignment_policy: 'main_first',
    allow_remote_execution: false,
    privacy_local_only: true,
    remote_execution_requires_confirmation: true,
    diagnostic_redaction_enabled: true,
    destructive_operations_disabled: true,
    desktop_notifications_enabled: true,
    desktop_notification_sound: true,
    cli_enabled: false,
    cli_socket_path: '',
    webhook_chat_enabled: false,
    webhook_chat_path: '/hooks/joi-chat',
    wechat_claw_enabled: false,
    wechat_claw_endpoint: '',
    wechat_claw_allowed_senders: [],
  };
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

function compactQueueMessage(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 72 ? `${normalized.slice(0, 72)}…` : normalized;
}

function findConversationTreeNode(node: ConversationTree['root'], conversationID: string): ConversationTree['root'] | null {
  if (node.conversation_id === conversationID) return node;
  for (const child of node.children) {
    const found = findConversationTreeNode(child, conversationID);
    if (found) return found;
  }
  return null;
}

function buildManualConversationSummary(messages: ConversationMessage[]) {
  const selected = messages.slice(-14);
  if (!selected.length) return '';
  const transcript = selected.map((item) => {
    const role = item.role === 'assistant' ? 'Joi' : item.role === 'user' ? '用户' : item.role;
    const content = item.content.replace(/\s+/g, ' ').trim();
    return `${role}：${content.length > 320 ? `${content.slice(0, 320)}…` : content}`;
  });
  return [
    '会话检查点（完整原始记录仍保留）',
    ...transcript,
  ].join('\n');
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
      setNotice('Grok Build 已登录并切换到 grok-4.5');
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
                <option value="BRAVE_SEARCH_API_KEY">BRAVE_SEARCH_API_KEY</option>
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
            <small>匹配度 {memoryMatchPercent(result.score)}% · {formatMemoryReason(result.reason)}</small>
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

function skillScopeLabel(scope: string) {
  const labels: Record<string, string> = {
    repo: '当前仓库',
    user: '用户 Skills',
    compat: 'Codex 兼容',
    admin: '管理员',
    system: 'Joi 内置',
    extra: '扩展来源',
    legacy: '旧版注册项',
  };
  return labels[scope] || scope;
}

function capabilityDisplayName(id: string, fallbackDescription = '') {
  const labels: Record<string, string> = {
    bash: '运行受控命令',
    browser_open: '打开网页',
    browser_scroll: '浏览网页',
    debugger_attach: '连接调试器',
    debugger_breakpoint: '设置调试断点',
    debugger_step: '单步调试',
    debugger_evaluate: '读取调试变量',
    debugger_stop: '结束调试',
    delegate_task: '创建子 Agent',
    desktop_app_list: '查看已安装应用',
    execute_code: '运行代码',
    file_analyze: '分析文件',
    github: '访问 GitHub',
    image_generate: '生成图片',
    find_roots: '查找可操作窗口',
    observe_ui: '观察界面',
    search_ui: '搜索界面元素',
    expand_ui: '展开界面元素',
    inspect_ui: '检查界面元素',
    read_text: '读取界面文本',
    wait_for: '等待界面状态',
    act_ui: '操作屏幕',
    ls: '查看文件夹',
    mcp_tool_call: '使用已授权扩展',
    read_file: '读取文件',
    session_search: '搜索历史会话',
    session_summary: '读取会话摘要',
    session_branch: '创建会话分支',
    session_compact: '压缩会话上下文',
    speech_transcribe: '转写语音',
    text_to_speech: '生成语音',
    video_generate: '生成视频',
    lsp_definition: '查找代码定义',
    lsp_references: '查找代码引用',
    lsp_diagnostics: '检查代码诊断',
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
  const labels: Record<string, string> = { 'Local MCP Registry': '本地扩展中心' };
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
  const labels: Record<string, string> = { 'Desktop Inventory': '本机应用清单' };
  return labels[value] || (/[\u4e00-\u9fff]/.test(value) ? value : '扩展技能');
}

function skillUserDescription(name: string, description: string) {
  if (name === 'Desktop Inventory') return '列出本机已安装应用的名称和基本信息，不读取应用内容。';
  return /[\u4e00-\u9fff]/.test(description) ? description : '按需组合已授权能力完成特定任务。';
}

function displayPathName(value?: string) {
  const text = value?.trim();
  if (!text) return '未设置';
  const parts = text.split('/').filter(Boolean);
  return parts[parts.length - 1] || text;
}

function automationPromptForDisplay(value: string) {
  return value
    .replace(/\{\{\s*payload(?:\.[^}]+)?\s*\}\}/gi, '收到的事件信息')
    .replace(/payload\s*摘要\s*[:：]?/gi, '收到的信息：')
    .replace(/webhook/gi, '外部事件')
    .replace(/^Preview\b/i, '检查');
}

function formatAutomationTriggerType(value?: string) {
  const labels: Record<string, string> = {
    cron: '自定义时间', daily: '每天', interval: '定时间隔', manual: '手动运行', once: '单次运行', webhook: '外部事件', weekly: '每周',
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
  const labels: Record<string, string> = { high: '高', low: '低', normal: '普通', urgent: '紧急' };
  return labels[value || ''] || '普通';
}

function formatLogLevel(value?: string) {
  const labels: Record<string, string> = {
    debug: '调试', error: '错误', fatal: '严重错误', info: '正常', trace: '详细过程', warn: '提醒', warning: '提醒',
  };
  return labels[value || ''] || '记录';
}

function formatLogCategory(value?: string) {
  const labels: Record<string, string> = {
    external: '外部连接', ipc: '桌面操作', model: '模型调用', run: '任务运行', runtime: 'Joi 运行', settings: '设置变更', system: '系统状态', terminal: '命令执行', tool: '能力调用', worker_gateway: '执行器连接',
  };
  return labels[value || ''] || 'Joi 活动';
}

function friendlyLogSummary(log: LogEntry) {
  const message = log.message?.trim() || '';
  if (message && /[\u4e00-\u9fff]/.test(message) && !/[{\[]/.test(message)) {
    return message.length > 140 ? `${message.slice(0, 137)}…` : message;
  }
  const category = formatLogCategory(log.category);
  if (isLogFailure(log)) return `${category}遇到问题`;
  return `${category}已记录`;
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
  return labels[value] || '运行记录';
}

function userFacingNextAction(value: string) {
  const text = value.trim();
  if (!text) return '';
  return /[\u4e00-\u9fff]/.test(text) ? text : '外部入口还有后续操作需要处理。';
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

function parseJSONObject(value: string, label: string): Record<string, unknown> {
  const text = value.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} 必须是 JSON 对象`);
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(`${label} JSON 格式不正确：${err.message}`);
    throw err;
  }
}

function parseStringJSONObject(value: string, label: string): Record<string, string> {
  const parsed = parseJSONObject(value, label);
  return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, String(item)]));
}

function splitCommandArguments(value: string): string[] {
  const matches = value.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\S+/g) || [];
  return matches.map((item) => {
    const quoted = item.match(/^(['"])([\s\S]*)\1$/);
    return quoted ? quoted[2].replace(/\\(['"\\])/g, '$1') : item;
  }).filter(Boolean);
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Unable to read recording'));
    reader.readAsDataURL(blob);
  });
}

function mediaOutputAttachment(output: Record<string, unknown> | null): Record<string, unknown> {
  return objectFromUnknown(output?.attachment);
}

function mediaOutputPath(output: Record<string, unknown> | null): string {
  return typeof output?.file_path === 'string' ? output.file_path : '';
}

function mediaOutputPreviewURL(output: Record<string, unknown> | null): string {
  const attachment = mediaOutputAttachment(output);
  if (typeof attachment.preview_url === 'string') return attachment.preview_url;
  if (typeof output?.preview_url === 'string') return output.preview_url;
  return mediaOutputPath(output) ? localPathURL(mediaOutputPath(output)) : '';
}

function mediaOutputKind(output: Record<string, unknown> | null): string {
  const attachment = mediaOutputAttachment(output);
  if (typeof attachment.kind === 'string') return attachment.kind;
  const mime = typeof output?.mime_type === 'string' ? output.mime_type : '';
  return mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : '';
}

function localPathURL(path: string): string {
  if (!path) return '';
  if (/^[a-z]+:/i.test(path)) return path;
  return `file://${encodeURI(path)}`;
}

function nextLocalDateTimeValue(offsetMinutes: number): string {
  const date = new Date(Date.now() + offsetMinutes * 60_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function assistantActionStatus(action: string, result: { item?: unknown; text?: string }) {
  const labels: Record<string, string> = {
    start_activity: '活动记录已启动。',
    stop_activity: '活动记录已停止并生成摘要。',
    capture_activity_now: '已保存一次真实屏幕活动。',
    create_calendar_item: '日历草稿已保存。',
    publish_calendar_item: '事件已发布到 macOS 日历。',
    create_plan: '计划已创建。',
    add_plan_node: '计划节点已添加。',
    update_plan_node: '计划节点已更新。',
    review_plan: '计划复盘已更新。',
    configure_channel: '渠道密钥已保存到 macOS Keychain。',
    send_channel_message: '消息已通过真实渠道发送。',
  };
  return result.text || labels[action] || `${action} 已完成。`;
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

function isUserFacingSecret(value: string) {
  return ['MODEL_API_KEY', 'TELEGRAM_BOT_TOKEN', 'WORKER_TOKEN'].includes(value);
}

function confirmationActionLabel(action: string, capabilityID: string) {
  const text = action.trim();
  if (/[一-鿿]/.test(text)) return text;
  const normalized = `${text} ${capabilityID}`.toLowerCase();
  if (normalized.includes('apply_patch') || normalized.includes('file_write')) return '修改工作区文件';
  if (normalized.includes('shell') || normalized.includes('command') || normalized.includes('bash')) return '运行本机命令';
  if (normalized.includes('delete') || normalized.includes('remove')) return '删除内容';
  return capabilityDisplayName(capabilityID);
}

function secretDisplayName(value: string) {
  const labels: Record<string, string> = {
    MODEL_API_KEY: '模型服务密钥',
    TELEGRAM_BOT_TOKEN: 'Telegram 机器人令牌',
    WORKER_TOKEN: '执行器连接凭证',
  };
  return labels[value] || '连接凭证';
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
    prepared: '已准备',
    applied: '已应用',
    reverted: '已撤销',
    passed: '已通过',
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
