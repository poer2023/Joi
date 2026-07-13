import {
  desktopBindingMethods,
  type DesktopBindings,
  type JoiPreloadApi,
  type ApprovalDecisionRequest,
  type ApprovalResumeRunRequest,
  type ArtifactDetail,
  type ArtifactSummary,
  type AutomationDefinition,
  type AutomationDefinitionRequest,
  type AutomationRunRecord,
  type AutomationTriggerNowRequest,
  type AutomationTriggerRecord,
  type AutomationWebhookEndpoint,
  type AutomationWebhookTestRequest,
  type AvailableModel,
  type BackupRecord,
  type CapabilityRecord,
  type ChatRequest,
  type ChatResponse,
  type CheckpointSummary,
  type ConnectExternalMirrorRoomRequest,
  type CompleteCheckpointRequest,
  type ConfirmationRecord,
  type ConversationActionRequest,
  type ConversationActionResponse,
  type ConversationDetail,
  type ConversationFilter,
  type ConversationGroup,
  type ConversationGroupRequest,
  type ConversationMessage,
  type ConversationSummary,
  type ConnectionTest,
  type CreateProjectPersonaRequest,
  type CreateSharedRoomRequest,
  type EvaluateRoomPermissionsRequest,
  type ExternalHandoffAudit,
  type GenerateProjectPersonaCandidatesRequest,
  type InputMode,
  type InterruptRunRequest,
  type LogCleanupPreview,
  type LogCleanupRequest,
  type LogCleanupResult,
  type LogEntry,
  type LogFilter,
  type MCPServerRecord,
  type MCPWrapToolRequest,
  type MemoryCandidateDecisionRequest,
  type MemoryCandidateFilter,
  type MemoryCorrectionRequest,
  type MemoryDeleteRequest,
  type MemoryRecord,
  type MemorySearchResult,
  type MessengerProject,
  type MessengerRoom,
  type ModelCall,
  type ModelConfigRequest,
  type ModelConnectionTestRequest,
  type ModelListRequest,
  type ModelRuntimeConfig,
  type ModelSettingsRequest,
  type NodeRecord,
  type OnboardingStatus,
  type OpenLoop,
  type PermissionProfile,
  type PersonaCandidate,
  type PersonaMessengerExportRequest,
  type PersonaMessengerExportResult,
  type PersonaMessengerSnapshot,
  type PhotonIMessageSetupRequest,
  type PhotonIMessageSetupResult,
  type PhotonIMessageStatus,
  type ProactiveMessage,
  type ProductTask,
  type ProductTaskCloseRequest,
  type ProductTaskDetail,
  type ProductTaskFilter,
  type ProductTaskReopenRequest,
  type ProjectPersona,
  type PreviewExternalPersonaMessageRequest,
  type ReflectionResult,
  type RecordExternalConnectorFailureRequest,
  type RecordExternalConnectorInboundRequest,
  type RecordExternalConnectorOutboundRequest,
  type RecordNotificationOpenedRequest,
  type RecoverableRunRecord,
  type RedirectRunRequest,
  type RedirectRunResponse,
  type RollbackProjectPersonaRequest,
  type RoomPermissionAudit,
  type RetryExternalConnectorEventRequest,
  type RunClosureReport,
  type RunEvent,
  type RunTrace,
  type RunTraceSpan,
  type RunTraceSpanFilter,
  type RunTraceSpanSummary,
  type RuntimeMode,
  type RoutingFeedbackRequest,
  type SecretStatus,
  type SetRouteLockRequest,
  type SettingsRecord,
  type SkillRecord,
  type SystemHealth,
  type TerminalSessionEvent,
  type TerminalSessionInfo,
  type TerminalSessionInputRequest,
  type TerminalSessionKillRequest,
  type TerminalSessionResizeRequest,
  type TerminalSessionSnapshot,
  type TerminalSessionStartRequest,
  type ToolRunRecord,
  type ToolWorkflowRecord,
  type UpdateMessengerProjectRequest,
  type UpdateMessengerRoomRequest,
  type UpdateProjectPersonaRequest,
  type WorkerGatewayAuditRecord,
  type WorkspaceSettings,
} from '../../../../../packages/shared-types/src/desktop-api';
export type {
  ApprovalDecisionRequest,
  ApprovalResumeRunRequest,
  ArtifactDetail,
  ArtifactSummary,
  AutomationDefinition,
  AutomationDefinitionRequest,
  AutomationRunRecord,
  AutomationTriggerNowRequest,
  AutomationTriggerRecord,
  AutomationWebhookEndpoint,
  AutomationWebhookTestRequest,
  AvailableModel,
  BackupRecord,
  CapabilityRecord,
  ChatRequest,
  ChatResponse,
  CheckpointSummary,
  ConnectExternalMirrorRoomRequest,
  CompleteCheckpointRequest,
  ConfirmationRecord,
  ConversationActionRequest,
  ConversationActionResponse,
  ConversationDetail,
  ConversationFilter,
  ConversationGroup,
  ConversationGroupRequest,
  ConversationMessage,
  ConversationSummary,
  ConnectionTest,
  CreateProjectPersonaRequest,
  CreateSharedRoomRequest,
  EvaluateRoomPermissionsRequest,
  ExternalHandoffAudit,
  GenerateProjectPersonaCandidatesRequest,
  InputMode,
  InterruptRunRequest,
  LogCleanupPreview,
  LogCleanupRequest,
  LogCleanupResult,
  LogEntry,
  LogFilter,
  MCPServerRecord,
  MCPWrapToolRequest,
  MemoryCandidateDecisionRequest,
  MemoryCandidateFilter,
  MemoryCorrectionRequest,
  MemoryDeleteRequest,
  MemoryRecord,
  MemorySearchResult,
  MessengerProject,
  MessengerRoom,
  ModelCall,
  ModelConfigRequest,
  ModelConnectionTestRequest,
  ModelListRequest,
  ModelRuntimeConfig,
  ModelSettingsRequest,
  NodeRecord,
  OnboardingStatus,
  OpenLoop,
  PermissionProfile,
  PersonaCandidate,
  PersonaMessengerExportRequest,
  PersonaMessengerExportResult,
  PersonaMessengerSnapshot,
  PhotonIMessageSetupRequest,
  PhotonIMessageSetupResult,
  PhotonIMessageStatus,
  ProactiveMessage,
  ProductTask,
  ProductTaskCloseRequest,
  ProductTaskDetail,
  ProductTaskFilter,
  ProductTaskReopenRequest,
  ProjectPersona,
  PreviewExternalPersonaMessageRequest,
  ReflectionResult,
  RecordExternalConnectorFailureRequest,
  RecordExternalConnectorInboundRequest,
  RecordExternalConnectorOutboundRequest,
  RecoverableRunRecord,
  RedirectRunRequest,
  RedirectRunResponse,
  RollbackProjectPersonaRequest,
  RoomPermissionAudit,
  RetryExternalConnectorEventRequest,
  RunClosureReport,
  RunEvent,
  RunTrace,
  RunTraceSpan,
  RunTraceSpanFilter,
  RunTraceSpanSummary,
  RuntimeMode,
  RoutingFeedbackRequest,
  SecretStatus,
  SetRouteLockRequest,
  SettingsRecord,
  SkillRecord,
  SystemHealth,
  TerminalSessionEvent,
  TerminalSessionInfo,
  TerminalSessionInputRequest,
  TerminalSessionKillRequest,
  TerminalSessionResizeRequest,
  TerminalSessionSnapshot,
  TerminalSessionStartRequest,
  ToolRunRecord,
  ToolWorkflowRecord,
  UpdateMessengerProjectRequest,
  UpdateMessengerRoomRequest,
  UpdateProjectPersonaRequest,
  WorkerGatewayAuditRecord,
  WorkspaceSettings,
} from '../../../../../packages/shared-types/src/desktop-api';

declare global {
  interface Window {
    joi?: JoiPreloadApi;
  }
}

const PREVIEW_ROOM_OVERRIDES_STORAGE_KEY = 'joi.preview.roomOverrides.v1';
const previewRoomOverrides = loadPreviewRoomOverrides();

function loadPreviewRoomOverrides(): Map<string, Partial<MessengerRoom>> {
  const overrides = new Map<string, Partial<MessengerRoom>>();
  if (typeof window === 'undefined') return overrides;
  try {
    const raw = window.localStorage.getItem(PREVIEW_ROOM_OVERRIDES_STORAGE_KEY);
    if (!raw) return overrides;
    const parsed = JSON.parse(raw) as Record<string, Partial<MessengerRoom>>;
    for (const [roomID, override] of Object.entries(parsed)) {
      if (override && typeof override === 'object') {
        overrides.set(roomID, override);
      }
    }
  } catch {
    window.localStorage.removeItem(PREVIEW_ROOM_OVERRIDES_STORAGE_KEY);
  }
  return overrides;
}

function persistPreviewRoomOverrides() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      PREVIEW_ROOM_OVERRIDES_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(previewRoomOverrides.entries())),
    );
  } catch {
    // Preview persistence should never block the desktop API mock.
  }
}

function applyPreviewRoomOverrides(rooms: MessengerRoom[]): MessengerRoom[] {
  return rooms.map((room) => {
    const override = previewRoomOverrides.get(room.id);
    if (!override) return room;
    return {
      ...room,
      ...override,
      metadata: {
        ...(room.metadata ?? {}),
        ...(override.metadata ?? {}),
      },
    };
  });
}

type MessengerRoomMember = NonNullable<MessengerRoom['members']>[number];

type PreviewProjectSpec = {
  projectID: string;
  projectName: string;
  goal: string;
  domain: string;
  phase: string;
  personaID: string;
  personaName: string;
  handle: string;
  avatar: string;
  tagline: string;
  intro: string;
  status: string;
  roomID: string;
  conversationID: string;
  runID: string;
  threadID: string;
  artifactID: string;
  lastMessage: string;
  nextAction: string;
  modelName: string;
  toolName: string;
};

const previewProjectSpecs: PreviewProjectSpec[] = [
  {
    projectID: 'prj_joi_desktop',
    projectName: 'Joi Desktop',
    goal: '约束桌面聊天主界面、右侧检查器和执行反馈的 MVP 体验。',
    domain: 'desktop_agent_os',
    phase: 'ui_contract',
    personaID: 'per_joi_desktop',
    personaName: 'Joi',
    handle: '@joi-desktop',
    avatar: 'J',
    tagline: '本地桌面 Agent OS 项目人格',
    intro: '我负责把聊天、任务、运行日志和本地状态组织成一个可验证的桌面工作台。',
    status: 'active',
    roomID: 'room_joi_desktop_dm',
    conversationID: 'conv_joi_desktop_dm',
    runID: 'run_joi_ui_contract',
    threadID: 'thread_joi_ui_contract',
    artifactID: 'art_joi_ui_contract',
    lastMessage: '右侧概览、成员详情和 mock 约束已进入联调。',
    nextAction: '核对预览布局里的成员详情临时 tab。',
    modelName: 'gpt-5-codex',
    toolName: 'browser_preview',
  },
  {
    projectID: 'prj_ui_system',
    projectName: 'UI System',
    goal: '沉淀 Messenger 风格、间距、边框和紧凑面板规范。',
    domain: 'product_design',
    phase: 'style_lock',
    personaID: 'per_ui_system',
    personaName: 'Mira UI',
    handle: '@mira-ui',
    avatar: 'UI',
    tagline: '界面约束与交互细节负责人',
    intro: '我负责把用户标注的低级 UI 问题转成可复用的布局约束。',
    status: 'active',
    roomID: 'room_ui_system_dm',
    conversationID: 'conv_ui_system_dm',
    runID: 'run_ui_spacing_review',
    threadID: 'thread_ui_spacing',
    artifactID: 'art_ui_spacing_rules',
    lastMessage: '边框内距、hover 灰和输入框编辑状态需要保持一致。',
    nextAction: '把成员列表和表单行纳入同一套密度规则。',
    modelName: 'gpt-5-codex',
    toolName: 'css_audit',
  },
  {
    projectID: 'prj_runtime_ops',
    projectName: 'Runtime Ops',
    goal: '约束 Run Trace、工具调用和确认流在桌面端的可观测形态。',
    domain: 'orchestrator_runtime',
    phase: 'traceable_mvp',
    personaID: 'per_runtime_ops',
    personaName: 'Rune Ops',
    handle: '@rune-ops',
    avatar: 'RO',
    tagline: '运行、线程与工具审计负责人',
    intro: '我负责让每一次模型、工具和节点调度都能被追踪和解释。',
    status: 'warm',
    roomID: 'room_runtime_ops_dm',
    conversationID: 'conv_runtime_ops_dm',
    runID: 'run_runtime_trace_pass',
    threadID: 'thread_runtime_trace',
    artifactID: 'art_runtime_trace_map',
    lastMessage: '运行 tab 需要能看到模型、工具、成本和副作用。',
    nextAction: '补齐失败/等待审批状态的展示样例。',
    modelName: 'deepseek-v4-flash',
    toolName: 'run_trace_audit',
  },
  {
    projectID: 'prj_memory_os',
    projectName: 'Memory OS',
    goal: '把长期记忆、候选建议和本轮召回整理成可编辑的信息架构。',
    domain: 'memory_system',
    phase: 'reviewable_memory',
    personaID: 'per_memory_os',
    personaName: 'Mnemo',
    handle: '@mnemo',
    avatar: 'ME',
    tagline: '记忆召回、候选和反馈负责人',
    intro: '我负责把可追溯、可编辑、可停用的记忆展示成用户能审阅的工作流。',
    status: 'active',
    roomID: 'room_memory_os_dm',
    conversationID: 'conv_memory_os_dm',
    runID: 'run_memory_review',
    threadID: 'thread_memory_review',
    artifactID: 'art_memory_policy',
    lastMessage: '记忆 tab 需要同时展示本轮召回和新建议。',
    nextAction: '验证 pending memory 的确认/修改/别记操作入口。',
    modelName: 'gpt-5-codex',
    toolName: 'memory_retrieval',
  },
  {
    projectID: 'prj_gateway',
    projectName: 'Worker Gateway',
    goal: '约束主节点、Worker、外部入口和镜像房间的边界。',
    domain: 'worker_gateway',
    phase: 'capability_routing',
    personaID: 'per_worker_gateway',
    personaName: 'Gate',
    handle: '@gate',
    avatar: 'GW',
    tagline: '节点、能力和外部入口边界负责人',
    intro: '我负责让本地桌面、Worker 和外部连接保持最小授权与可观测。',
    status: 'dormant',
    roomID: 'room_worker_gateway_dm',
    conversationID: 'conv_worker_gateway_dm',
    runID: 'run_gateway_capability_scan',
    threadID: 'thread_gateway_boundary',
    artifactID: 'art_gateway_matrix',
    lastMessage: '外部连接只作为入口，不能绕过本地 runtime 策略。',
    nextAction: '保留一个等待唤醒状态，约束非活跃成员展示。',
    modelName: 'deepseek-v4-flash',
    toolName: 'capability_registry',
  },
];

function previewIso(minutesAgo = 0) {
  return new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
}

function previewHumanMember(): MessengerRoomMember {
  return {
    id: 'desktop_user',
    type: 'user',
    display_name: '你',
    role: 'owner',
    can_approve_high_risk: true,
    visible_project_ids: previewProjectSpecs.map((item) => item.projectID),
    metadata: { presence: 'online', description: '登录用户 · 真人' },
  };
}

function previewPersonaMember(spec: PreviewProjectSpec): MessengerRoomMember {
  return {
    id: spec.personaID,
    type: 'persona',
    display_name: spec.personaName,
    role: 'persona',
    persona_id: spec.personaID,
    project_id: spec.projectID,
    metadata: { presence: spec.status, avatar: spec.avatar },
  };
}

function previewTraits(index: number): Record<string, number> {
  return {
    directness: 0.72 + index * 0.03,
    warmth: 0.48 + index * 0.04,
    humor: 0.1 + index * 0.02,
    verbosity: 0.42 + index * 0.03,
    initiative: 0.68 + index * 0.04,
    risk_sensitivity: 0.78 + index * 0.03,
    divergence: 0.3 + index * 0.05,
  };
}

function previewProjects(now = previewIso()): MessengerProject[] {
  return previewProjectSpecs.map((spec) => ({
    id: spec.projectID,
    name: spec.projectName,
    goal: spec.goal,
    domain: spec.domain,
    phase: spec.phase,
    risk_level: spec.projectID === 'prj_gateway' ? 'medium' : 'low',
    status: 'active',
    summary: spec.goal,
    metadata: { preview: true, primary_persona_id: spec.personaID },
    created_at: previewIso(1440),
    updated_at: now,
  }));
}

function previewPersonas(now = previewIso()): ProjectPersona[] {
  return previewProjectSpecs.map((spec, index) => ({
    id: spec.personaID,
    project_id: spec.projectID,
    display_name: spec.personaName,
    handle: spec.handle,
    avatar: spec.avatar,
    tagline: spec.tagline,
    self_intro: spec.intro,
    traits: previewTraits(index),
    disagreement_style: '直接指出风险，并给出可执行替代路径',
    uncertainty_style: '说明不确定来源、影响范围和验证方式',
    status: spec.status,
    version: 2,
    capabilities: ['chat', 'runs', 'threads', 'assets', 'memory'],
    permission_summary: '默认只读；写入、外部副作用和高风险操作需要确认',
    model_strategy: spec.modelName,
    metadata: { preview: true, room_id: spec.roomID },
    created_at: previewIso(1440),
    updated_at: now,
  }));
}

function previewRooms(now = previewIso()): MessengerRoom[] {
  const hubMembers = [previewHumanMember(), ...previewProjectSpecs.map(previewPersonaMember)];
  const rooms: MessengerRoom[] = [{
    id: 'room_private_hub',
    type: 'private_hub',
    title: '私人总群',
    avatar: '总',
    subtitle: '你和五个项目人格',
    owner_user_id: 'desktop_user',
    conversation_id: 'conv_private_hub',
    default_ai_participation: 'moderate',
    floor_holder_persona_id: previewProjectSpecs[0]?.personaID,
    unread_count: 0,
    pending_approval_count: 1,
    failed_run_count: 0,
    running_run_count: 1,
    last_message: '五个项目人格已加入，正在约束 UI 样式和功能。',
    last_activity_at: now,
    members: hubMembers,
    metadata: { preview: true, project_count: previewProjectSpecs.length },
  }];

  for (const [index, spec] of previewProjectSpecs.entries()) {
    rooms.push({
      id: spec.roomID,
      type: 'project_dm',
      title: spec.personaName,
      avatar: spec.avatar,
      subtitle: `${spec.projectName} · ${spec.status}`,
      owner_user_id: 'desktop_user',
      project_id: spec.projectID,
      persona_id: spec.personaID,
      conversation_id: spec.conversationID,
      default_ai_participation: 'moderate',
      floor_holder_persona_id: index < 2 ? spec.personaID : undefined,
      route_lock_persona_id: spec.projectID === 'prj_runtime_ops' ? spec.personaID : undefined,
      unread_count: index === 1 ? 1 : 0,
      pending_approval_count: spec.projectID === 'prj_gateway' ? 1 : 0,
      failed_run_count: spec.projectID === 'prj_runtime_ops' ? 1 : 0,
      running_run_count: spec.projectID === 'prj_joi_desktop' ? 1 : 0,
      last_message: spec.lastMessage,
      last_activity_at: previewIso(index * 18),
      members: [previewHumanMember(), previewPersonaMember(spec)],
      metadata: { preview: true, run_id: spec.runID, thread_id: spec.threadID },
    });
  }

  return applyPreviewRoomOverrides(rooms);
}

function previewPersonaVersions(now = previewIso()) {
  return previewProjectSpecs.flatMap((spec) => [
    {
      id: `pver_${spec.personaID}_2`,
      persona_id: spec.personaID,
      version: 2,
      changed_by: 'desktop_user',
      change_reason: '按新 Messenger 设计理念补充职责与展示状态',
      created_at: now,
    },
    {
      id: `pver_${spec.personaID}_1`,
      persona_id: spec.personaID,
      version: 1,
      changed_by: 'desktop_user',
      change_reason: '预览初始身份',
      created_at: previewIso(1440),
    },
  ]);
}

function previewThreads(now = previewIso()): PersonaMessengerSnapshot['threads'] {
  return previewProjectSpecs.map((spec, index) => ({
    id: spec.threadID,
    project_id: spec.projectID,
    project_name: spec.projectName,
    room_id: spec.roomID,
    room_title: spec.personaName,
    owner_persona_id: spec.personaID,
    owner_persona_name: spec.personaName,
    title: `${spec.projectName} · ${spec.phase}`,
    goal: spec.goal,
    status: index === 4 ? 'waiting_confirmation' : index === 2 ? 'reviewing' : 'running',
    priority: index === 0 ? 'high' : 'normal',
    collaborator_persona_ids: previewProjectSpecs.filter((item) => item.personaID !== spec.personaID).slice(0, 2).map((item) => item.personaID),
    source_room_ids: ['room_private_hub', spec.roomID],
    source_message_ids: [`msg_${spec.conversationID}_user`, `msg_${spec.conversationID}_assistant`],
    run_ids: [spec.runID],
    artifact_ids: [spec.artifactID],
    next_action: spec.nextAction,
    message_count: 8 + index,
    run_count: 2 + index,
    artifact_count: 1,
    latest_run_status: index === 4 ? 'waiting_confirmation' : 'succeeded',
    metadata: { preview: true },
    created_at: previewIso(900 - index * 40),
    updated_at: now,
  }));
}

function previewThreadEvents(now = previewIso()): PersonaMessengerSnapshot['recent_thread_events'] {
  return previewProjectSpecs.flatMap((spec, index) => [
    {
      id: `tevt_${spec.threadID}_run`,
      thread_id: spec.threadID,
      room_id: spec.roomID,
      message_id: `msg_${spec.conversationID}_assistant`,
      run_id: spec.runID,
      event_type: 'run.linked',
      summary: '最近一次运行已关联到项目线程。',
      created_at: previewIso(index * 20),
    },
    {
      id: `tevt_${spec.threadID}_artifact`,
      thread_id: spec.threadID,
      room_id: spec.roomID,
      artifact_id: spec.artifactID,
      event_type: 'artifact.created',
      summary: '生成了一份可检查的 UI/功能约束产物。',
      created_at: now,
    },
  ]);
}

function previewArtifacts(now = previewIso()): ArtifactSummary[] {
  return previewProjectSpecs.flatMap((spec, index) => [
    {
      id: spec.artifactID,
      type: index === 0 ? 'ui_contract' : 'spec',
      title: `${spec.projectName} 约束草案`,
      content_format: 'markdown',
      source_run_id: spec.runID,
      source_conversation_id: spec.conversationID,
      source_message_id: `msg_${spec.conversationID}_assistant`,
      version: 1,
      status: 'active',
      metadata: { preview: true, project_id: spec.projectID, room_id: spec.roomID },
      created_at: previewIso(index * 30),
      updated_at: now,
    },
    {
      id: `art_${spec.projectID}_checklist`,
      type: 'checklist',
      title: `${spec.projectName} 验收清单`,
      content_format: 'markdown',
      source_run_id: spec.runID,
      source_conversation_id: spec.conversationID,
      version: 1,
      status: 'draft',
      metadata: { preview: true, project_id: spec.projectID, room_id: spec.roomID },
      created_at: previewIso(index * 35),
      updated_at: now,
    },
  ]);
}

function previewMemoryRecords(now = previewIso()): MemoryRecord[] {
  const confirmed = previewProjectSpecs.map((spec, index) => ({
    id: `mem_${spec.projectID}_constraint`,
    type: 'project_constraint',
    content: `${spec.projectName} 的预览 UI 必须通过房间、运行、线程、资产、记忆五个入口同时验证。`,
    summary: `${spec.projectName} 预览约束`,
    scope_type: 'project',
    scope_id: spec.projectID,
    privacy_level: 'local',
    status: 'confirmed',
    confidence: 0.86 + index * 0.02,
    pinned: index < 2,
    usage_count: 4 + index,
    success_count: 3 + index,
    failure_count: 0,
    positive_feedback: 2 + index,
    negative_feedback: 0,
    source_event_ids: [spec.runID],
    entities: [spec.projectName, spec.personaName],
    recent_usage: [{
      id: `muse_${spec.runID}`,
      run_id: spec.runID,
      agent_id: spec.personaID,
      retrieval_score: 0.91 - index * 0.03,
      injected: true,
      used_in_answer: true,
      outcome: 'helpful',
      created_at: previewIso(index * 25),
    }],
    metadata: { preview: true, run_id: spec.runID },
    created_at: previewIso(1200 - index * 30),
    updated_at: now,
    last_used_at: previewIso(index * 25),
  }));

  return [
    ...confirmed,
    {
      id: 'mem_desktop_user_owner',
      type: 'user_state',
      content: '登录用户是私人总群群主 owner，可查看五个项目人格并触发高风险确认。',
      summary: '登录用户是群主 Owner',
      scope_type: 'user',
      scope_id: 'desktop_user',
      privacy_level: 'local',
      status: 'confirmed',
      confidence: 0.94,
      pinned: true,
      usage_count: 7,
      success_count: 6,
      failure_count: 0,
      positive_feedback: 5,
      negative_feedback: 0,
      source_event_ids: ['run_joi_ui_contract'],
      entities: ['desktop_user', 'owner'],
      metadata: { preview: true },
      created_at: previewIso(1500),
      updated_at: now,
      last_used_at: previewIso(10),
    },
    {
      id: 'mem_candidate_member_detail_tab',
      type: 'ui_candidate',
      content: '点击概览成员后应在右侧顶栏临时增加成员详情 tab，hover/focus 时显示关闭按钮。',
      summary: '成员详情临时 tab 候选',
      scope_type: 'room',
      scope_id: 'room_private_hub',
      privacy_level: 'local',
      status: 'proposed',
      confidence: 0.71,
      pinned: false,
      usage_count: 1,
      success_count: 0,
      failure_count: 0,
      positive_feedback: 0,
      negative_feedback: 0,
      source_event_ids: ['run_joi_ui_contract'],
      entities: ['member_detail', 'right_inspector_tab'],
      metadata: {
        preview: true,
        run_id: 'run_joi_ui_contract',
        why: '用户要求从概览成员进入独立详情页',
        futureEffect: '后续实现成员页时复用临时 tab 交互',
      },
      created_at: previewIso(8),
      updated_at: now,
    },
  ];
}

function previewUsedMemoryResults(runID: string): MemorySearchResult[] {
  const memories = previewMemoryRecords();
  const scoped = memories.filter((memory) => memory.status === 'confirmed' && (memory.source_event_ids?.includes(runID) || memory.id === 'mem_desktop_user_owner'));
  return scoped.slice(0, 4).map((memory, index) => ({
    memory,
    score: 0.91 - index * 0.05,
    reason: index === 0 ? 'sqlite_fts5' : 'sqlite_keyword_fallback',
  }));
}

function previewRunTraceSpans(now = previewIso()): RunTraceSpan[] {
  return previewProjectSpecs.flatMap((spec, index) => {
    const status = index === 4 ? 'waiting_confirmation' : index === 2 ? 'failed' : 'succeeded';
    return [
      {
        id: `span_${spec.runID}_route`,
        run_id: spec.runID,
        span_type: 'run_event',
        event_type: 'route.decided',
        title: `${spec.personaName} 路由到 ${spec.projectName}`,
        status: 'succeeded',
        room_id: spec.roomID,
        room_title: spec.personaName,
        project_id: spec.projectID,
        project_name: spec.projectName,
        persona_id: spec.personaID,
        persona_name: spec.personaName,
        duration_ms: 42 + index * 8,
        total_tokens: 0,
        cost_estimate: 0,
        has_error: false,
        has_external_side_effect: false,
        created_at: previewIso(index * 18),
        metadata: { preview: true },
      },
      {
        id: `span_${spec.runID}_model`,
        run_id: spec.runID,
        span_type: 'model_span',
        event_type: 'model.completed',
        title: `${spec.personaName} 生成方案`,
        status,
        room_id: spec.roomID,
        room_title: spec.personaName,
        project_id: spec.projectID,
        project_name: spec.projectName,
        persona_id: spec.personaID,
        persona_name: spec.personaName,
        model_provider: spec.modelName.includes('deepseek') ? 'deepseek' : 'openai',
        model_name: spec.modelName,
        duration_ms: 1600 + index * 240,
        input_tokens: 1200 + index * 110,
        output_tokens: 420 + index * 55,
        cached_input_tokens: 320,
        total_tokens: 1620 + index * 165,
        cost_estimate: 0.002 + index * 0.0007,
        error: index === 2 ? '预览样例：工具结果缺少截图证据，等待重新检查。' : undefined,
        has_error: index === 2,
        has_external_side_effect: false,
        created_at: previewIso(index * 18 + 1),
        metadata: { preview: true },
      },
      {
        id: `span_${spec.runID}_tool`,
        run_id: spec.runID,
        span_type: 'tool_span',
        event_type: 'tool.completed',
        title: `${spec.toolName} 输出检查结果`,
        status: index === 4 ? 'waiting_confirmation' : 'succeeded',
        room_id: spec.roomID,
        room_title: spec.personaName,
        project_id: spec.projectID,
        project_name: spec.projectName,
        persona_id: spec.personaID,
        persona_name: spec.personaName,
        tool_name: spec.toolName,
        risk_level: index === 4 ? 'confirmation_required' : 'read_only',
        duration_ms: 520 + index * 90,
        total_tokens: 0,
        cost_estimate: 0,
        has_error: false,
        has_external_side_effect: index === 4,
        created_at: now,
        metadata: { preview: true, artifact_id: spec.artifactID },
      },
    ];
  });
}

function summarizePreviewSpans(spans: RunTraceSpan[]): RunTraceSpanSummary {
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

function filterPreviewSpans(spans: RunTraceSpan[], filter: RunTraceSpanFilter = {}) {
  return spans.filter((span) => (
    (!filter.room_id || span.room_id === filter.room_id)
    && (!filter.project_id || span.project_id === filter.project_id)
    && (!filter.persona_id || span.persona_id === filter.persona_id)
    && (!filter.model_provider || span.model_provider === filter.model_provider)
    && (!filter.model_name || span.model_name === filter.model_name)
    && (!filter.span_type || span.span_type === filter.span_type)
    && (!filter.status || span.status === filter.status)
    && (typeof filter.has_error !== 'boolean' || span.has_error === filter.has_error)
    && (typeof filter.has_external_side_effect !== 'boolean' || span.has_external_side_effect === filter.has_external_side_effect)
  )).slice(0, filter.limit ?? spans.length);
}

function previewConversationSummaries(now = previewIso()): ConversationSummary[] {
  const rooms = previewRooms(now);
  const roomByConversationID = new Map(rooms.map((room) => [room.conversation_id, room]));
  const hubRoom = roomByConversationID.get('conv_private_hub');
  return [
    {
      id: 'conv_private_hub',
      channel: 'preview',
      user_id: 'desktop_user',
      title: hubRoom?.title || '私人总群',
      active_agent_id: 'multi_project_router',
      last_message: hubRoom?.last_message || '五个项目人格已加入，正在约束 UI 样式和功能。',
      last_role: 'assistant',
      latest_run_id: previewProjectSpecs[0]?.runID,
      message_count: 6,
      lifecycle_status: 'active',
      metadata: { room_id: 'room_private_hub', preview: true },
      created_at: previewIso(1440),
      updated_at: hubRoom?.last_activity_at || now,
    },
    ...previewProjectSpecs.map((spec, index) => {
      const room = roomByConversationID.get(spec.conversationID);
      return {
        id: spec.conversationID,
        channel: 'preview',
        user_id: 'desktop_user',
        title: room?.title || spec.personaName,
        active_agent_id: spec.personaID,
        last_message: room?.last_message || spec.lastMessage,
        last_role: 'assistant',
        latest_run_id: spec.runID,
        message_count: 4 + index,
        lifecycle_status: 'active',
        metadata: { room_id: spec.roomID, project_id: spec.projectID, preview: true },
        created_at: previewIso(1200 - index * 30),
        updated_at: room?.last_activity_at || previewIso(index * 18),
      };
    }),
  ];
}

function previewConversationDetail(conversationID = 'conv_private_hub'): ConversationDetail {
  const now = previewIso();
  const summaries = previewConversationSummaries(now);
  const conversation = summaries.find((item) => item.id === conversationID) ?? summaries[0];
  const spec = previewProjectSpecs.find((item) => item.conversationID === conversation.id);
  if (!spec) {
    return {
      conversation,
      messages: [
        { id: 'msg_conv_private_hub_user', conversation_id: conversation.id, role: 'user', content: '把五个项目人格都填进 mock，右侧所有 tab 都要能约束样式。', created_at: previewIso(20) },
        { id: 'msg_conv_private_hub_assistant', conversation_id: conversation.id, role: 'assistant', content: '已加入 Joi、Mira UI、Rune Ops、Mnemo、Gate，并为运行、线程、资产和记忆准备联动数据。', run_id: previewProjectSpecs[0]?.runID, created_at: now },
      ],
    };
  }
  return {
    conversation,
    messages: [
      { id: `msg_${spec.conversationID}_user`, conversation_id: conversation.id, role: 'user', content: `检查 ${spec.projectName} 的私聊、运行和产物展示。`, created_at: previewIso(24) },
      { id: `msg_${spec.conversationID}_assistant`, conversation_id: conversation.id, role: 'assistant', content: `${spec.personaName}: ${spec.lastMessage}`, run_id: spec.runID, created_at: previewIso(18) },
      { id: `msg_${spec.conversationID}_user_follow`, conversation_id: conversation.id, role: 'user', content: spec.nextAction, created_at: previewIso(12) },
      { id: `msg_${spec.conversationID}_assistant_follow`, conversation_id: conversation.id, role: 'assistant', content: `我会把这条约束写入 ${spec.threadID}，并生成 ${spec.artifactID}。`, run_id: spec.runID, created_at: now },
    ],
  };
}

function previewConversationForMessage(messageID: string): ConversationDetail {
  const summaries = previewConversationSummaries();
  const detail = summaries
    .map((summary) => previewConversationDetail(summary.id))
    .find((item) => item.messages.some((message) => message.id === messageID));
  return detail ?? previewConversationDetail('conv_private_hub');
}

function previewRunEvents(spec: PreviewProjectSpec, usedMemories: MemorySearchResult[]): RunEvent[] {
  const isMemoryProject = spec.projectID === 'prj_memory_os';
  const isRuntimeProject = spec.projectID === 'prj_runtime_ops';
  const isGatewayProject = spec.projectID === 'prj_gateway';
  const primaryCallID = `call_${spec.runID}_${spec.toolName}`;
  const toolTerminalEvent = isGatewayProject ? 'tool.approval_required' : isRuntimeProject ? 'tool.failed' : 'tool.completed';
  const toolTerminalStatus = isGatewayProject ? 'waiting_confirmation' : isRuntimeProject ? 'failed' : 'completed';
  const primaryToolSummary = isMemoryProject
    ? `检索 ${usedMemories.length} 条 confirmed memory，并标记本轮实际使用的上下文。`
    : isRuntimeProject
      ? '预览样例：工具结果缺少截图证据，需要回到浏览器复查。'
      : isGatewayProject
        ? '外部入口能力涉及副作用，等待 owner 确认后才会继续。'
        : `${spec.toolName} 已产出 ${spec.projectName} 的检查证据。`;
  const events: RunEvent[] = [
    {
      id: `evt_${spec.runID}_mode`,
      run_id: spec.runID,
      seq: 1,
      event_type: 'run.mode_resolved',
      item_type: 'mode_resolution',
      item_id: `mode_${spec.runID}`,
      status: 'completed',
      visibility: 'trace_only',
      summary: '桌面预览进入 tool-calling 运行模式',
      payload: { resolved_mode: 'tool_calling', mode_source: 'preview_mock' },
      created_at: previewIso(9),
    },
    {
      id: `evt_${spec.runID}_plan`,
      run_id: spec.runID,
      seq: 2,
      event_type: 'plan.created',
      item_type: 'plan',
      item_id: `plan_${spec.runID}`,
      status: 'completed',
      visibility: 'transcript',
      summary: `确认 ${spec.projectName} 的私聊、运行、线程、资产和记忆展示目标。`,
      payload: { step: 0 },
      created_at: previewIso(8),
    },
    {
      id: `evt_${spec.runID}_thinking_scope`,
      run_id: spec.runID,
      seq: 3,
      event_type: 'work_summary.updated',
      item_type: 'work_summary',
      item_id: `thinking_${spec.runID}_scope`,
      status: 'completed',
      visibility: 'transcript',
      summary: isMemoryProject
        ? '比对本轮召回、pending memory 候选和右侧记忆 tab 的审阅入口。'
        : `检查 ${spec.personaName} 当前房间是否能支撑 ${spec.phase} 阶段的样式约束。`,
      payload: { step: 1 },
      created_at: previewIso(7),
    },
    {
      id: `evt_${spec.runID}_tool_requested`,
      run_id: spec.runID,
      seq: 4,
      event_type: 'tool.call_requested',
      item_type: 'tool_run',
      item_id: primaryCallID,
      status: 'requested',
      source: 'model_provider',
      visibility: 'tool',
      summary: `请求执行 ${spec.toolName}`,
      payload: {
        call_id: primaryCallID,
        tool_name: spec.toolName,
        operation: isMemoryProject ? 'recall-confirmed-memories' : spec.projectName,
        query: isMemoryProject ? 'current room memory context' : spec.goal,
        step: 2,
      },
      created_at: previewIso(6),
    },
    {
      id: `evt_${spec.runID}_tool_started`,
      run_id: spec.runID,
      seq: 5,
      event_type: 'tool.started',
      item_type: 'tool_run',
      item_id: primaryCallID,
      status: 'running',
      source: 'tool',
      visibility: 'tool',
      summary: `执行 ${spec.toolName}`,
      payload: {
        call_id: primaryCallID,
        tool_name: spec.toolName,
        operation: isMemoryProject ? 'recall-confirmed-memories' : spec.projectName,
        step: 2,
      },
      created_at: previewIso(5),
    },
    {
      id: `evt_${spec.runID}_tool_finished`,
      run_id: spec.runID,
      seq: 6,
      event_type: toolTerminalEvent,
      item_type: 'tool_run',
      item_id: primaryCallID,
      status: toolTerminalStatus,
      source: 'tool',
      visibility: isGatewayProject ? 'approval' : 'tool',
      summary: primaryToolSummary,
      payload: {
        call_id: primaryCallID,
        tool_name: spec.toolName,
        operation: isMemoryProject ? 'recall-confirmed-memories' : spec.projectName,
        step: 2,
      },
      snapshot: isMemoryProject
        ? { memory_ids: usedMemories.map((item) => item.memory.id), result_count: usedMemories.length }
        : { artifact_id: spec.artifactID, preview: true },
      error: isRuntimeProject ? primaryToolSummary : undefined,
      created_at: previewIso(4),
    },
  ];

  if (isMemoryProject) {
    const candidateCallID = `call_${spec.runID}_memory_candidate_prepare`;
    events.push(
      {
        id: `evt_${spec.runID}_candidate_requested`,
        run_id: spec.runID,
        seq: 7,
        event_type: 'tool.call_requested',
        item_type: 'tool_run',
        item_id: candidateCallID,
        status: 'requested',
        source: 'model_provider',
        visibility: 'tool',
        summary: '请求生成 pending memory 候选',
        payload: {
          call_id: candidateCallID,
          tool_name: 'memory_candidate_prepare',
          operation: 'prepare-pending-memory',
          step: 3,
        },
        created_at: previewIso(3.5),
      },
      {
        id: `evt_${spec.runID}_candidate_finished`,
        run_id: spec.runID,
        seq: 8,
        event_type: 'tool.completed',
        item_type: 'tool_run',
        item_id: candidateCallID,
        status: 'completed',
        source: 'tool',
        visibility: 'tool',
        summary: '生成 2 条 pending memory 建议，等待用户确认、修改或别记。',
        payload: {
          call_id: candidateCallID,
          tool_name: 'memory_candidate_prepare',
          operation: 'prepare-pending-memory',
          step: 3,
        },
        snapshot: { pending_count: 2, controls: ['确认', '修改', '别记'] },
        created_at: previewIso(3),
      },
      {
        id: `evt_${spec.runID}_thinking_finish`,
        run_id: spec.runID,
        seq: 9,
        event_type: 'work_summary.updated',
        item_type: 'work_summary',
        item_id: `thinking_${spec.runID}_finish`,
        status: 'completed',
        visibility: 'transcript',
        summary: '把本轮召回和新建议分开呈现，避免把未确认记忆混入长期记忆。',
        payload: { step: 4 },
        created_at: previewIso(2),
      },
    );
  } else {
    events.push({
      id: `evt_${spec.runID}_thinking_finish`,
      run_id: spec.runID,
      seq: 7,
      event_type: 'work_summary.updated',
      item_type: 'work_summary',
      item_id: `thinking_${spec.runID}_finish`,
      status: isRuntimeProject ? 'failed' : isGatewayProject ? 'waiting_confirmation' : 'completed',
      visibility: 'transcript',
      summary: isRuntimeProject
        ? '停止宣称已完成，先把缺失证据作为失败态展示。'
        : isGatewayProject
          ? '等待 owner 决定是否允许外部入口继续触发能力调用。'
          : `整理 ${spec.threadID} 与 ${spec.artifactID} 的后续约束。`,
      payload: { step: 3 },
      created_at: previewIso(2),
    });
  }

  events.push({
    id: `evt_${spec.runID}_artifact`,
    run_id: spec.runID,
    seq: isMemoryProject ? 10 : 8,
    event_type: 'artifact.created',
    item_type: 'artifact',
    item_id: spec.artifactID,
    status: isRuntimeProject ? 'failed' : isGatewayProject ? 'waiting_confirmation' : 'completed',
    visibility: 'trace_only',
    title: '生成产物',
    summary: spec.artifactID,
    created_at: previewIso(1),
  });

  return events;
}

function previewRunTrace(runID = previewProjectSpecs[0]?.runID): RunTrace {
  const spec = previewProjectSpecs.find((item) => item.runID === runID) ?? previewProjectSpecs[0];
  const usedMemories = previewUsedMemoryResults(spec.runID);
  return {
    id: runID,
    conversation_id: spec.conversationID,
    principal_id: 'desktop_user',
    entry_channel: 'desktop',
    requested_mode: 'chat',
    resolved_mode: 'tool_calling',
    mode_source: 'preview_mock',
    terminal_status: 'not_required',
    status: spec.projectID === 'prj_gateway' ? 'waiting_confirmation' : spec.projectID === 'prj_runtime_ops' ? 'failed' : 'succeeded',
    selected_agent_id: spec.personaID,
    route_result: {
      room_id: spec.roomID,
      project_id: spec.projectID,
      persona_id: spec.personaID,
      thread_id: spec.threadID,
      write_targets: ['thread', 'artifact', 'memory_candidate'],
    },
    metadata: { preview: true, project_name: spec.projectName },
    memory_context_packs: [{
      id: `mcp_${spec.runID}`,
      memory_profile_version: 'preview-v1',
      dynamic_retrieval: usedMemories,
    }],
    events: previewRunEvents(spec, usedMemories),
    steps: [
      { id: `step_${spec.runID}_input`, run_id: spec.runID, step_type: 'input_received', title: '接收请求', status: 'succeeded', created_at: previewIso(9), duration_ms: 20 },
      { id: `step_${spec.runID}_route`, run_id: spec.runID, step_type: 'route_project_persona', title: `路由到 ${spec.personaName}`, status: 'succeeded', created_at: previewIso(8), duration_ms: 56 },
      { id: `step_${spec.runID}_respond`, run_id: spec.runID, step_type: 'response_generated', title: '生成预览响应', status: spec.projectID === 'prj_runtime_ops' ? 'failed' : 'succeeded', created_at: previewIso(4), duration_ms: 1420 },
    ],
  };
}

function createPreviewMessengerSnapshot(now = previewIso()): PersonaMessengerSnapshot {
  return {
    projects: previewProjects(now),
    personas: previewPersonas(now),
    rooms: previewRooms(now),
    persona_versions: previewPersonaVersions(now),
    room_connectors: previewProjectSpecs.map((spec) => ({
      id: `rconn_${spec.roomID}_desktop`,
      room_id: spec.roomID,
      provider: 'desktop',
      connector_id: `desktop:${spec.projectID}`,
      external_room_id: spec.roomID,
      status: spec.projectID === 'prj_gateway' ? 'paused' : 'active',
      visible_persona_ids: [spec.personaID],
      allow_temporary_invite: spec.projectID !== 'prj_gateway',
      retry_count: 0,
      metadata: { preview: true },
      created_at: previewIso(1200),
      updated_at: now,
    })),
    recent_external_events: [{
      id: 'extev_preview_gateway_waiting',
      connector_id: 'rconn_room_worker_gateway_dm_desktop',
      provider: 'desktop',
      external_event_id: 'preview_gateway_waiting',
      room_id: 'room_worker_gateway_dm',
      external_user_id: 'desktop_user',
      text: '等待用户确认 Worker Gateway 外部入口策略。',
      status: 'waiting_confirmation',
      retry_count: 0,
      metadata: { preview: true },
      created_at: now,
    }],
    route_locks: [{
      room_id: 'room_runtime_ops_dm',
      user_id: 'desktop_user',
      persona_id: 'per_runtime_ops',
      started_at: previewIso(30),
      status: 'active',
    }],
    recent_routing_decisions: previewProjectSpecs.map((spec, index) => ({
      id: `rdec_${spec.runID}`,
      room_id: spec.roomID,
      message_id: `msg_${spec.conversationID}_user`,
      run_id: spec.runID,
      speaker_persona_id: spec.personaID,
      owner_project_id: spec.projectID,
      executor_persona_id: spec.personaID,
      collaborator_project_ids: previewProjectSpecs.filter((item) => item.projectID !== spec.projectID).slice(0, 2).map((item) => item.projectID),
      execution_scope: 'project_dm',
      write_targets: ['thread', 'artifact', 'memory_candidate'],
      thread_action: { action: 'attach', thread_id: spec.threadID },
      confidence: 0.82 + index * 0.02,
      risk: index === 4 ? 'medium' : 'low',
      requires_confirmation: index === 4,
      reason_codes: ['PREVIEW_PROJECT_ROOM', 'PERSONA_MATCH'],
      created_at: previewIso(index * 18),
    })),
    threads: previewThreads(now),
    recent_thread_events: previewThreadEvents(now),
    checkpoint: {
      since: previewIso(1440),
      completed_count: 4,
      failed_count: 1,
      pending_approval_count: 1,
      waiting_user_count: 1,
      new_artifact_count: previewProjectSpecs.length,
      no_progress_project_count: 0,
      model_cost_estimate: summarizePreviewSpans(previewRunTraceSpans(now)).total_cost_estimate,
      external_unhandled_count: 1,
      items: previewProjectSpecs.map((spec, index) => ({
        id: `chk_${spec.projectID}`,
        kind: index === 2 ? 'failed_run' : index === 4 ? 'approval' : 'completed',
        title: spec.projectName,
        body: spec.lastMessage,
        severity: index === 2 ? 'warning' : index === 4 ? 'info' : 'success',
        room_id: spec.roomID,
        project_id: spec.projectID,
        run_id: spec.runID,
      })),
    },
  };
}

function electronBindings(api: JoiPreloadApi): DesktopBindings {
  const mapped = {} as Record<keyof DesktopBindings, (payload?: unknown) => Promise<unknown>>;
  for (const method of desktopBindingMethods) {
    mapped[method] = (payload?: unknown) => api.invoke(method, payload);
  }
  mapped.WrapMCPTool = (serverID?: unknown, toolName?: unknown, req?: unknown) => api.invoke('WrapMCPTool', {
    server_id: serverID,
    tool_name: toolName,
    request: req,
  });
  return mapped as unknown as DesktopBindings;
}

const BROWSER_BRIDGE_URL = 'http://127.0.0.1:18083';
let browserBridgeUnavailable = false;

function shouldUseBrowserBridge(): boolean {
  if (browserBridgeUnavailable) return false;
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === '127.0.0.1' || host === 'localhost';
}

async function invokeBrowserBridge<T>(method: keyof DesktopBindings, payload?: unknown): Promise<T> {
  const response = await postBrowserBridgeJson(`${BROWSER_BRIDGE_URL}/invoke`, { method, payload });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Joi browser bridge ${method} failed: HTTP ${response.status}`);
  }
  const envelope = JSON.parse(response.body) as {
    ok?: boolean;
    data?: T;
    error?: { message?: string };
  };
  if (!envelope.ok) {
    throw new Error(envelope.error?.message || `Joi browser bridge ${method} failed`);
  }
  return envelope.data as T;
}

function postBrowserBridgeJson(url: string, body: unknown): Promise<{ status: number; body: string }> {
  const rawBody = JSON.stringify(body);
  if (typeof fetch === 'function') {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawBody,
    }).then(async (response) => ({
      status: response.status,
      body: await response.text(),
    }));
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
    xhr.onerror = () => reject(new TypeError('Joi browser bridge request failed'));
    xhr.send(rawBody);
  });
}

function browserBridgeBindings(fallback: DesktopBindings): DesktopBindings {
  const mapped = {} as Record<keyof DesktopBindings, (payload?: unknown) => Promise<unknown>>;
  for (const method of desktopBindingMethods) {
    if (method === 'WrapMCPTool') continue;
    mapped[method] = async (payload?: unknown) => {
      try {
        return await invokeBrowserBridge(method, payload);
      } catch (error) {
        if (error instanceof TypeError) {
          browserBridgeUnavailable = true;
          return (fallback[method] as (payload?: unknown) => Promise<unknown>)(payload);
        }
        throw error;
      }
    };
  }
  mapped.WrapMCPTool = async (serverID?: unknown, toolName?: unknown, req?: unknown) => {
    try {
      return await invokeBrowserBridge('WrapMCPTool', {
        server_id: serverID,
        tool_name: toolName,
        request: req,
      });
    } catch (error) {
      if (error instanceof TypeError) {
        browserBridgeUnavailable = true;
        return fallback.WrapMCPTool(serverID as string, toolName as string, req as MCPWrapToolRequest);
      }
      throw error;
    }
  };
  return mapped as unknown as DesktopBindings;
}

function bindings(): DesktopBindings {
  if (window.joi?.invoke) {
    return electronBindings(window.joi);
  }
  const preview: DesktopBindings = {
      async SendChat(req) {
        const runID = `run_preview_${Date.now()}`;
        const room = previewRooms().find((item) => item.id === req.room_id);
        const conversationID = req.conversation_id || room?.conversation_id || 'conv_private_hub';
        return {
          conversation_id: conversationID,
          user_message_id: `msg_${runID}_user`,
          assistant_message_id: `msg_${runID}_assistant`,
          run_id: runID,
          selected_agent_id: room?.persona_id || 'multi_project_router',
          response: `Preview mode: ${req.message}`,
          model_calls: [],
        };
      },
      async ListPersonaMessenger() {
        return createPreviewMessengerSnapshot();
      },
      async GenerateProjectPersonaCandidates(req) {
        const name = req.project_name?.trim() || 'New Project';
        return {
          candidates: ['Builder', 'Pilot', 'Scout'].map((suffix, index) => ({
            id: `pcand_preview_${index + 1}`,
            display_name: `${name} ${suffix}`,
            handle: `@${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix.toLowerCase()}`,
            tagline: `负责 ${name} 的项目人格`,
            self_intro: '我会把目标拆成可验证的下一步。',
            traits: { directness: 0.7 + index * 0.04, warmth: 0.5, humor: 0.15, verbosity: 0.42, initiative: 0.7, risk_sensitivity: 0.8, divergence: 0.35 + index * 0.1 },
            disagreement_style: '明确指出风险，并提供替代方案',
            uncertainty_style: '说明不确定来源和验证路径',
            rationale: '浏览器预览候选。',
          })),
        };
      },
      async CreateProjectPersona(req) {
        const snapshot = await this.ListPersonaMessenger();
        return { project: snapshot.projects[0], persona: snapshot.personas[0], room: snapshot.rooms[1] };
      },
      async UpdateProjectPersona(req) {
        const snapshot = await this.ListPersonaMessenger();
        return { ...snapshot.personas[0], ...req, id: req.persona_id, version: snapshot.personas[0].version + 1 };
      },
      async RollbackProjectPersona(req) {
        const snapshot = await this.ListPersonaMessenger();
        return { ...snapshot.personas[0], id: req.persona_id, version: snapshot.personas[0].version + 1 };
      },
      async UpdateMessengerRoom(req) {
        const snapshot = await this.ListPersonaMessenger();
        const room = snapshot.rooms.find((item) => item.id === req.room_id) ?? snapshot.rooms[0];
        const title = req.title?.trim() || room.title;
        const requestedAvatar = req.avatar;
        const hasAvatarUpdate = typeof requestedAvatar === 'string';
        const avatar = hasAvatarUpdate ? requestedAvatar.trim() : room.avatar ?? '';
        const nextRoom = {
          ...room,
          title,
          avatar: avatar || undefined,
          metadata: {
            ...(room.metadata ?? {}),
            ...(hasAvatarUpdate ? { avatar: avatar || undefined } : {}),
            updated_from: 'browser_preview',
          },
        };
        previewRoomOverrides.set(room.id, nextRoom);
        persistPreviewRoomOverrides();
        return { room: nextRoom };
      },
      async UpdateMessengerProject(req) {
        const snapshot = await this.ListPersonaMessenger();
        const project = snapshot.projects.find((item) => item.id === req.project_id) ?? snapshot.projects[0];
        const metadata = { ...(project.metadata ?? {}) };
        if (typeof req.local_path === 'string') {
          const localPath = req.local_path.trim();
          if (localPath) {
            metadata.local_path = localPath;
          } else {
            delete metadata.local_path;
          }
        }
        return {
          project: {
            ...project,
            id: req.project_id || project.id,
            name: req.name?.trim() || project.name,
            metadata,
            updated_at: new Date().toISOString(),
          },
        };
      },
      async CreateSharedRoom(req) {
        const snapshot = await this.ListPersonaMessenger();
        return {
          room: {
            ...snapshot.rooms[0],
            id: 'room_preview_shared',
            type: 'shared',
            title: req.title,
            subtitle: req.permission_summary || '共享房间',
            members: [
              { id: 'desktop_user', type: 'user', display_name: '你', role: 'room_owner' },
              ...req.human_members.map((member, index) => ({ id: member.external_user_id || `human_preview_${index}`, type: 'human', display_name: member.display_name, role: member.role || 'human_member' })),
              ...snapshot.personas.filter((persona) => req.persona_ids.includes(persona.id)).map((persona) => ({ id: persona.id, type: 'persona', display_name: persona.display_name, role: 'persona', persona_id: persona.id, project_id: persona.project_id })),
            ],
          },
        };
      },
      async ConnectExternalMirrorRoom(req) {
        const snapshot = await this.ListPersonaMessenger();
        const room = snapshot.rooms.find((item) => item.id === req.room_id) ?? snapshot.rooms[0];
        return {
          room,
          connector: {
            id: `rconn_preview_${req.provider}_${req.external_room_id}`,
            room_id: room.id,
            provider: req.provider,
            connector_id: `${req.provider}:${req.external_room_id}`,
            external_room_id: req.external_room_id,
            status: 'active',
            visible_persona_ids: req.persona_ids,
            allow_temporary_invite: Boolean(req.allow_temporary_invite),
            retry_count: 0,
            metadata: {},
          },
        };
      },
      async RecordExternalConnectorInbound(req) {
        const snapshot = await this.ListPersonaMessenger();
        return {
          room: snapshot.rooms[0],
          message_id: 'msg_preview_external',
          duplicate: false,
          event: {
            id: 'extev_preview',
            connector_id: `rconn_preview_${req.provider}_${req.external_room_id}`,
            provider: req.provider,
            external_event_id: req.external_event_id,
            room_id: snapshot.rooms[0].id,
            external_user_id: req.external_user_id,
            reply_to_external_message_id: req.reply_to_external_message_id,
            text: req.text,
            internal_message_id: 'msg_preview_external',
            status: 'received',
            retry_count: 0,
            metadata: {},
          },
        };
      },
      async RecordExternalConnectorOutbound(req) {
        const snapshot = await this.ListPersonaMessenger();
        const room = snapshot.rooms.find((item) => item.id === req.room_id) ?? snapshot.rooms[0];
        return {
          room,
          message_id: req.internal_message_id || 'msg_preview_external_outbound',
          duplicate: false,
          event: {
            id: 'extev_preview_outbound',
            connector_id: req.connector_id || `rconn_preview_${req.provider}_${req.external_room_id}`,
            provider: req.provider || 'preview',
            external_event_id: req.external_message_id,
            room_id: room.id,
            external_user_id: '',
            text: req.text,
            internal_message_id: req.internal_message_id || 'msg_preview_external_outbound',
            status: req.status || 'sent',
            retry_count: 0,
            metadata: { direction: 'outbound', persona_id: req.persona_id },
          },
        };
      },
      async PreviewExternalPersonaMessage(req) {
        const snapshot = await this.ListPersonaMessenger();
        const persona = snapshot.personas.find((item) => item.id === req.persona_id) ?? snapshot.personas[0];
        const project = snapshot.projects.find((item) => item.id === persona.project_id);
        return { room_id: req.room_id, persona_id: persona.id, text: `${persona.display_name} · ${project?.name || persona.project_id} ◇\n${req.text}`, controls: [`回复 ${persona.display_name}`, `锁定 ${persona.display_name}`, '查看运行'] };
      },
      async RecordExternalConnectorFailure(req) {
        return {
          event: {
            id: 'extev_preview_failure',
            connector_id: req.connector_id,
            provider: 'preview',
            external_event_id: req.external_event_id || 'failure_preview',
            room_id: req.room_id || 'room_private_hub',
            external_user_id: '',
            text: '',
            status: 'send_failed',
            retry_count: req.retryable === false ? 0 : 1,
            error: req.error,
            metadata: { retryable: req.retryable !== false },
          },
        };
      },
      async RetryExternalConnectorEvent(req) {
        return {
          event: {
            id: req.event_id || 'extev_preview_retry',
            connector_id: req.connector_id || 'rconn_preview',
            provider: 'preview',
            external_event_id: req.external_event_id || 'retry_preview',
            room_id: 'room_private_hub',
            external_user_id: '',
            text: '',
            status: 'retry_scheduled',
            retry_count: 1,
            metadata: { retry_reason: req.reason || '', retryable: true },
          },
        };
      },
      async SetRouteLock(req) {
        if (req.action === 'unlock' || !req.persona_id) return { route_lock: null };
        return { route_lock: { room_id: req.room_id, user_id: req.user_id || 'desktop_user', persona_id: req.persona_id, status: 'active', started_at: new Date().toISOString() } };
      },
      async CompleteCheckpoint() {
        const snapshot = await this.ListPersonaMessenger();
        return { ...snapshot.checkpoint, checkpoint_id: 'chk_preview', checked_at: new Date().toISOString(), items: [] };
      },
      async RecordRoutingFeedback() {},
      async EvaluateRoomPermissions(req) {
        const snapshot = await this.ListPersonaMessenger();
        const room = snapshot.rooms.find((item) => item.id === req.room_id) ?? snapshot.rooms[0];
        const actorID = req.actor_id || 'desktop_user';
        return room.permission_audit ?? {
          room_id: room.id,
          actor_id: actorID,
          actor_type: req.actor_type || 'user',
          actor_role: actorID === 'desktop_user' ? 'room_owner' : 'guest',
          authorized_project_ids: room.project_id ? [room.project_id] : [],
          visible_project_ids: room.project_id ? [room.project_id] : [],
          denied_project_ids: [],
          can_read_room_history: true,
          can_read_private_persona_dm: true,
          can_modify_core_persona: actorID === 'desktop_user',
          can_approve_high_risk: actorID === 'desktop_user',
          ai_participation: room.default_ai_participation,
          multi_human_ai_throttle: room.type === 'shared',
          reason_codes: ['PREVIEW_PERMISSION_AUDIT'],
          summary: 'preview permission audit',
        };
      },
      async ListAutomations() {
        return {
          automations: [
            {
              id: 'automation_preview_schedule',
              kind: 'schedule',
              slug: 'preview-schedule',
              name: 'Preview interval check',
              enabled: true,
              trigger_config: { type: 'interval', every_minutes: 60 },
              prompt_template: 'Preview {{payload}}',
              input_mode: 'background_task',
              permission_profile: 'read_only',
              preferred_node: 'main-node',
              allow_worker: false,
              dedup_policy: {},
              retry_policy: { max_attempts: 2, backoff_seconds: [60, 300] },
              max_concurrency: 1,
              notification_policy: {},
              metadata: {},
            },
          ],
        };
      },
      async GetAutomation(id) {
        return (await this.ListAutomations()).automations.find((item) => item.id === id || item.slug === id) ?? (await this.ListAutomations()).automations[0];
      },
      async SaveAutomation(req) {
        return {
          id: req.id || `automation_preview_${Date.now()}`,
          kind: req.kind,
          slug: req.slug || 'preview-automation',
          name: req.name,
          enabled: req.enabled ?? true,
          trigger_config: req.trigger_config ?? {},
          prompt_template: req.prompt_template ?? '',
          input_mode: req.input_mode ?? 'background_task',
          permission_profile: req.permission_profile ?? 'read_only',
          preferred_node: req.preferred_node ?? 'main-node',
          allow_worker: req.allow_worker ?? false,
          dedup_policy: req.dedup_policy ?? {},
          retry_policy: req.retry_policy ?? {},
          max_concurrency: req.max_concurrency ?? 1,
          notification_policy: req.notification_policy ?? {},
          metadata: req.metadata ?? {},
        };
      },
      async DeleteAutomation() {},
      async SetAutomationEnabled(req) {
        return { ...(await this.GetAutomation(req.id)), enabled: req.enabled };
      },
      async TriggerAutomationNow(req) {
        return {
          trigger: {
            id: `autotrig_preview_${Date.now()}`,
            automation_id: req.id,
            trigger_type: 'manual',
            dedup_key: 'preview',
            payload: req.payload ?? {},
            status: 'pending',
            attempt_count: 0,
          },
        };
      },
      async ListAutomationTriggers() {
        return { triggers: [] };
      },
      async ListAutomationRuns() {
        return { runs: [] };
      },
      async GetAutomationWebhookEndpoint(id) {
        return {
          automation_id: id,
          slug: 'preview-webhook',
          url: 'http://127.0.0.1:18082/automation/webhooks/preview-webhook',
          secret_ref: `JOI_AUTOMATION_WEBHOOK_SECRET_${id}`,
          secret_configured: true,
        };
      },
      async RotateAutomationWebhookSecret(id) {
        return {
          ...(await this.GetAutomationWebhookEndpoint(id)),
          secret_value_once: 'joi_whsec_preview',
        };
      },
      async TestAutomationWebhook(req) {
        return this.TriggerAutomationNow({ id: req.id, payload: req.payload });
      },
      async GetRunTrace(runID) {
        return previewRunTrace(runID);
      },
      async ListRunTraceSpans(filter: RunTraceSpanFilter = {}) {
        const spans = filterPreviewSpans(previewRunTraceSpans(), filter);
        return {
          spans,
          summary: summarizePreviewSpans(spans),
        };
      },
      async ListConversations(filter: ConversationFilter = { view: 'active', limit: 100 }) {
        if (filter.view && filter.view !== 'active' && filter.view !== 'all') {
          return { conversations: [] };
        }
        return { conversations: previewConversationSummaries().slice(0, filter.limit ?? 100) };
      },
      async ListConversationGroups() {
        return { groups: [{ id: 'cgrp_preview', name: '默认分组', sort_order: 1, collapsed: false }] };
      },
      async SaveConversationGroup(req) {
        return { id: req.id || `cgrp_preview_${Date.now()}`, name: req.name, sort_order: req.sort_order ?? 0, collapsed: Boolean(req.collapsed), metadata: req.metadata ?? {} };
      },
      async DeleteConversationGroup() {},
      async MoveConversationToGroup() {
        return { conversation: previewConversationSummaries()[0] };
      },
      async ArchiveConversation() {
        return { conversation: { ...previewConversationSummaries()[0], lifecycle_status: 'archived' } };
      },
      async TrashConversation() {
        return { conversation: { ...previewConversationSummaries()[0], lifecycle_status: 'trashed', purge_after: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString() } };
      },
      async RestoreConversation() {
        return { conversation: { ...previewConversationSummaries()[0], lifecycle_status: 'active' } };
      },
      async PurgeConversation() {
        return { conversation: { ...previewConversationSummaries()[0], title: '[已永久清理]', lifecycle_status: 'purged' } };
      },
      async GetConversation(conversationID = 'conv_private_hub') {
        return previewConversationDetail(conversationID);
      },
      async GetConversationForMessage(messageID = '') {
        return previewConversationForMessage(messageID);
      },
      async ListCapabilities() {
        return {
          capabilities: [
            { id: 'desktop_app_list', name: 'Desktop App List', description: 'List installed macOS applications as local metadata.', risk_level: 'read_only', enabled: true, metadata: { source: 'native', intent_domain: 'desktop_application_inventory' } },
            { id: 'workspace_search', name: 'Workspace Search', description: 'Search authorized workspace source and documents.', risk_level: 'read_only', enabled: true, metadata: { source: 'native', intent_domain: 'workspace_search' } },
            { id: 'file_analyze', name: 'File Analyze', description: 'Analyze an authorized workspace file.', risk_level: 'read_only', enabled: true, metadata: { source: 'native', intent_domain: 'authorized_file_read' } },
          ],
        };
      },
      async ListMCPServers() {
        return { servers: [{ id: 'local_mcp_registry', name: 'Local MCP Registry', transport: 'not_configured', status: 'inactive', trust: 'untrusted_until_wrapped', tools: [], resources: [], prompts: [], metadata: { policy: 'MCP tools require wrapping before execution.' } }] };
      },
      async SyncMCPServer(id) {
        return { server: { id, name: 'Local MCP Registry', transport: 'not_configured', status: 'inactive', trust: 'untrusted_until_wrapped', tools: [], resources: [], prompts: [], metadata: { last_sync_result: 'no configured MCP transport' } } };
      },
      async WrapMCPTool(serverID, toolName, req) {
        return { capability: { id: req.capability_id || `mcp_${serverID}_${toolName}`, name: toolName, description: req.description, risk_level: req.risk_level, enabled: true, metadata: { source: 'mcp_wrapped', intent_domain: req.intent_domain } } };
      },
      async ListSkills() {
        return { skills: [{ id: 'desktop_inventory_skill', version: 'v1', name: 'Desktop Inventory', description: 'List local installed applications without reading app content.', trigger_phrases: ['列出本地所有 app'], required_capabilities: ['desktop_app_list'], forbidden_capabilities: ['system_health_check'], output_contract: 'final_answer with bounded app metadata', enabled: true, metadata: { source: 'native_skill_registry' } }] };
      },
      async ListToolWorkflows() {
        return {
          workflows: [
            { id: 'workflow_desktop_app_list_v1', capability_id: 'desktop_app_list', name: 'desktop_app_list_v1', version: 'v1', risk_level: 'read_only', enabled: true, steps: [{ tool: 'desktop_list_app_bundles', risk_level: 'read_only' }] },
            { id: 'workflow_workspace_search_v1', capability_id: 'workspace_search', name: 'workspace_search_v1', version: 'v1', risk_level: 'read_only', enabled: true, steps: [{ tool: 'workspace_walk_search', risk_level: 'read_only' }] },
            { id: 'workflow_file_analyze_v1', capability_id: 'file_analyze', name: 'file_analyze_v1', version: 'v1', risk_level: 'read_only', enabled: true, steps: [{ tool: 'file_read_authorized', risk_level: 'read_only' }] },
          ],
        };
      },
      async ListToolRuns() {
        return {
          tool_runs: previewProjectSpecs.map((spec, index): ToolRunRecord => ({
            id: `toolrun_${spec.runID}`,
            run_id: spec.runID,
            task_id: spec.threadID,
            capability_id: spec.toolName,
            workflow_name: `${spec.projectName} preview workflow`,
            tool_id: spec.toolName,
            tool_name: spec.toolName,
            node_id: index < 3 ? 'main-node' : 'worker-preview',
            assignment_reason: 'preview_mock',
            risk_level: index === 4 ? 'medium' : 'read_only',
            status: index === 2 ? 'failed' : index === 4 ? 'waiting_confirmation' : 'succeeded',
            input: { room_id: spec.roomID, project_id: spec.projectID },
            output: { artifact_id: spec.artifactID },
            error: index === 2 ? { message: '预览样例：缺少截图证据' } : undefined,
            started_at: previewIso(index * 18 + 2),
            finished_at: index === 4 ? undefined : previewIso(index * 18),
            duration_ms: 520 + index * 90,
            created_at: previewIso(index * 18 + 2),
          })),
        };
      },
      async SetToolWorkflowEnabled() {},
      async GetSystemHealth() {
        return {
          service_status: { sqlite: true, orchestrator: 'preview' },
          queue_status: { active_tasks: 0 },
          worker_status: [],
          warnings: [],
        };
      },
      async ListMemories(filter: { query?: string; limit?: number } = {}) {
        const query = filter.query?.trim().toLowerCase() ?? '';
        const memories = previewMemoryRecords().filter((memory) => {
          if (!query) return true;
          return `${memory.summary} ${memory.content} ${memory.type} ${memory.entities?.join(' ') ?? ''}`.toLowerCase().includes(query);
        });
        return { memories: memories.slice(0, filter.limit ?? memories.length) };
      },
      async UpdateMemory() {},
      async ListMemoriesUsedForRun(runID) {
        return { memories: previewUsedMemoryResults(runID) };
      },
      async ListMemoryCandidates(filter: MemoryCandidateFilter = {}) {
        const memories = previewMemoryRecords()
          .filter((memory) => memory.status !== 'confirmed' && (!filter.status || memory.status === filter.status))
          .slice(0, filter.limit ?? 20);
        return { memories };
      },
      async DecideMemoryCandidate() {},
      async CorrectMemory() {},
      async DeleteMemory() {},
      async ListUserStates(filter: { limit?: number } = {}) {
        return { memories: previewMemoryRecords().filter((memory) => memory.scope_type === 'user').slice(0, filter.limit ?? 20) };
      },
      async ListRelationshipStates(filter: { limit?: number } = {}) {
        return {
          memories: previewMemoryRecords()
            .filter((memory) => memory.scope_type === 'room' || memory.scope_type === 'project')
            .slice(0, filter.limit ?? 20),
        };
      },
      async ListProductTasks() {
        return {
          tasks: [
            {
              id: 'ptask_preview',
              title: '整理 Joi 伙伴前台与执行后台闭环',
              description: 'Preview product task',
              status: 'running',
              mode: 'serious_task',
              priority: 'normal',
              latest_run_id: 'run_preview',
              risk_level: 'read_only',
              progress_percent: 45,
              current_step_id: 'pstep_preview_2',
            },
          ],
        };
      },
      async ListProductTasksByConversation() {
        return this.ListProductTasks({});
      },
      async ListProductTasksByPrincipal() {
        return this.ListProductTasks({});
      },
      async GetProductTask() {
        return {
          task: {
            id: 'ptask_preview',
            title: '整理 Joi 伙伴前台与执行后台闭环',
            description: 'Preview product task',
            status: 'running',
            mode: 'serious_task',
            priority: 'normal',
            latest_run_id: 'run_preview',
            risk_level: 'read_only',
            progress_percent: 45,
            current_step_id: 'pstep_preview_2',
          },
          steps: [
            { id: 'pstep_preview_1', product_task_id: 'ptask_preview', title: '理解目标与约束', status: 'done', sort_order: 1 },
            { id: 'pstep_preview_2', product_task_id: 'ptask_preview', title: '整理上下文与证据', status: 'running', sort_order: 2 },
            { id: 'pstep_preview_3', product_task_id: 'ptask_preview', title: '产出交付物', status: 'pending', sort_order: 3 },
          ],
          deliverables: [],
        };
      },
      async CloseProductTask(req) {
        return this.GetProductTask(req.id);
      },
      async ReopenProductTask(req) {
        return this.GetProductTask(req.id);
      },
      async GetRecentRunClosureReport() {
        return {
          items: [],
          metrics: {
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
          },
        };
      },
      async GetExternalHandoffAudit() {
        return {
          ok: true,
          schema_current: true,
          missing_schema: [],
          external_channels_seen: [],
          linked_live_handoffs: [],
          pending_external_handoffs: [],
          metrics: {
            external_runs: 0,
            desktop_runs: 0,
            linked_external_desktop_tasks: 0,
          },
          readiness: {
            checked: false,
            ok: false,
            credentials: {},
            checks: {},
            services: {},
          },
          status: 'unknown',
          next_action: '',
        };
      },
      async ListArtifacts(filter: { product_task_id?: string; type?: string; limit?: number } = {}) {
        const artifacts = previewArtifacts().filter((artifact) => (
          (!filter.product_task_id || artifact.source_product_task_id === filter.product_task_id || artifact.metadata?.project_id === filter.product_task_id)
          && (!filter.type || artifact.type === filter.type)
        ));
        return { artifacts: artifacts.slice(0, filter.limit ?? artifacts.length) };
      },
      async GetArtifact(id) {
        const artifact = previewArtifacts().find((item) => item.id === id) ?? previewArtifacts()[0];
        return {
          ...artifact,
          content: `# ${artifact.title}\n\n- 来源 Run：${artifact.source_run_id || 'preview'}\n- 关联项目：${String(artifact.metadata?.project_id || 'preview')}\n- 目标：用于约束浏览器预览 UI 的样式、状态和交互。`,
          linked_memory_ids: previewMemoryRecords().slice(0, 2).map((memory) => memory.id),
        };
      },
      async ListOpenLoops() {
        return { open_loops: [] };
      },
      async DecideOpenLoop() {},
      async ListProactiveMessages() {
        return { messages: [] };
      },
      async DecideProactiveMessage() {},
      async RecordNotificationOpened() {},
      async ListNodes() {
        return { nodes: [] };
      },
      async DisableNode() {},
      async EnableNode() {},
      async ListWorkerGatewayAuditLogs() {
        return { items: [] };
      },
      async GetModelUsage() {
        return { items: [] };
      },
      async ListConfirmations() {
        return { items: [] };
      },
      async DecideConfirmation() {},
      async ListPendingApprovals() {
        return { items: [] };
      },
      async DecideApproval() {
        return {};
      },
      async ResumeApprovalRun() {
        return { resumed: false };
      },
      async InterruptRun() {},
      async RedirectRun(req) {
        return {
          redirected_run: {
            id: req.run_id,
            status: 'redirected',
            selected_agent_id: 'general_agent',
            events: [{ id: 'evt_preview_redirected', run_id: req.run_id, seq: 1, event_type: 'run.redirected', terminal: true }],
            steps: [],
          },
        };
      },
      async ListRecoverableRuns() {
        return { runs: [] };
      },
      async ListBackups() {
        return { backups: [] };
      },
      async CreateBackup() {
        return { path: 'preview.joibak' };
      },
      async RestoreBackup() {},
      async ExportDiagnostics() {
        return { path: 'preview-diagnostics.zip' };
      },
      async ExportPersonaMessengerData(req?: PersonaMessengerExportRequest): Promise<PersonaMessengerExportResult> {
        const generated_at = new Date().toISOString();
        return {
          path: 'preview-persona-messenger-export.json',
          manifest: {
            generated_at,
            filters: req ?? {},
            row_counts: {},
            secrets_policy: 'preview export uses mock data only',
          },
        };
      },
      async ListLogs() {
        return { logs: [] };
      },
      async GetLogEntry() {
        return null;
      },
      async PreviewLogCleanup(req) {
        const scopes = req?.scopes ?? [];
        return { scopes, counts: {}, total_count: 0, safe_to_clear: true, warnings: [] };
      },
      async ClearLogs(req) {
        const scopes = req?.scopes ?? [];
        return { scopes, counts: {}, total_count: 0, safe_to_clear: true, warnings: [], cleanup_id: 'preview-cleanup', cleared_at: new Date().toISOString() };
      },
      async ExportLogs() {
        return { path: 'preview-logs.json' };
      },
      async GetSettings() {
        return {
          app_mode: 'desktop',
          version: '0.1.0-rc0',
          data_store: 'sqlite',
          task_queue: 'sqlite',
          sqlite_path: 'preview',
          log_dir: 'preview/logs',
          model_provider: 'openai_compatible',
          model_name: 'deepseek-v4-flash',
          model_reasoning_name: 'deepseek-v4-pro',
          model_base_url: '',
          telegram_enabled: false,
          telegram_allowed_user_ids: '',
          imessage_enabled: false,
          imessage_allowed_users: '',
          imessage_require_mention: false,
          imessage_operator_phone: '',
          imessage_assigned_number: '',
          imessage_project_id: '',
          imessage_home_channel: '',
          imessage_sidecar_port: 8790,
          worker_gateway: '',
          worker_gateway_enabled: true,
          backup_dir: 'preview/backups',
          auto_backup_enabled: false,
          docker_required: false,
        };
      },
      async GetWorkspaceSettings() {
        return {
          allowed_roots: ['/Users/hao/project/Joi'],
          default_root: '/Users/hao/project/Joi',
          browser_allowed_hosts: [],
          web_research_allow_private_hosts: false,
          file_analyze_max_bytes: 65536,
          workspace_search_max_results: 50,
        };
      },
      async SaveWorkspaceSettings() {},
      async ListSavedModels() {
        return {
          models: [
            {
              provider: 'openai_compatible',
              base_url: 'https://api.deepseek.com/v1',
              id: 'deepseek-v4-flash',
              display_name: 'DeepSeek V4 Flash',
              owner: 'deepseek',
              context_window: 64000,
              max_output_tokens: 8192,
              supports_json_mode: true,
              supports_tool_calling: true,
              supports_reasoning: false,
              supported_parameters: ['temperature', 'max_tokens', 'response_format', 'tools'],
              config: { role: 'default', enabled: true, temperature: 0.7, max_output_tokens: 8192, timeout_seconds: 60, max_retries: 1, supports_json_mode: true, supports_tool_calling: true, supports_reasoning: false },
            },
            {
              provider: 'openai_compatible',
              base_url: 'https://api.deepseek.com/v1',
              id: 'deepseek-v4-pro',
              display_name: 'DeepSeek V4 Pro',
              owner: 'deepseek',
              context_window: 128000,
              max_output_tokens: 16384,
              supports_json_mode: true,
              supports_tool_calling: true,
              supports_reasoning: true,
              supported_parameters: ['temperature', 'max_tokens', 'response_format', 'tools', 'reasoning'],
              config: { role: 'reasoning', enabled: true, temperature: 0.3, max_output_tokens: 16384, timeout_seconds: 90, max_retries: 1, supports_json_mode: true, supports_tool_calling: true, supports_reasoning: true },
            },
          ],
        };
      },
      async SaveModelConfig() {},
      async SaveModelSettings() {},
      async SaveOperationalSettings() {},
      async SaveTelegramConfig() {},
      async SendTestTelegramMessage() {
        return { ok: true, status: 'preview' };
      },
      async SetupPhotonIMessage() {
        return {
          status: 'succeeded',
          project_id: 'preview-photon-project',
          operator_phone: '+15551234567',
          assigned_number: '+15557654321',
          project_created: false,
          user_created: false,
        };
      },
      async SaveIMessageConfig() {},
      async GetIMessageStatus() {
        return {
          enabled: false,
          configured: false,
          connected: false,
          sidecar_running: false,
          sidecar_port: 8790,
          project_id: '',
          operator_phone: '',
          assigned_number: '',
          allowed_users: '',
          require_mention: false,
        };
      },
      async TestIMessageConnection() {
        return { ok: false, status: 'preview' };
      },
      async SendTestIMessageMessage() {
        return { ok: true, status: 'preview' };
      },
      async GetOnboardingStatus() {
        return { required: false, completed: true, model_configured: true, telegram_configured: false, worker_configured: false, first_backup_created: true, backup_count: 1 };
      },
      async CompleteOnboarding() {},
      async GetSecretStatus() {
        return { secrets: {} };
      },
      async SaveSecret() {},
      async TestModelConnection() {
        return { ok: true, status: 'preview' };
      },
      async FetchAvailableModels() {
        return {
          ok: true,
          status: 'preview',
          available_models: [
            {
              provider: 'openai_compatible',
              base_url: 'https://api.deepseek.com/v1',
              id: 'deepseek-v4-flash',
              display_name: 'DeepSeek V4 Flash',
              owner: 'deepseek',
              context_window: 64000,
              max_output_tokens: 8192,
              supports_json_mode: true,
              supports_tool_calling: true,
              supports_reasoning: false,
              supported_parameters: ['temperature', 'max_tokens', 'response_format', 'tools'],
              config: { role: 'general', enabled: true, temperature: 0.7, max_output_tokens: 8192, timeout_seconds: 60, max_retries: 1, supports_json_mode: true, supports_tool_calling: true, supports_reasoning: false },
            },
            {
              provider: 'openai_compatible',
              base_url: 'https://api.deepseek.com/v1',
              id: 'deepseek-v4-pro',
              display_name: 'DeepSeek V4 Pro',
              owner: 'deepseek',
              context_window: 128000,
              max_output_tokens: 16384,
              supports_json_mode: true,
              supports_tool_calling: true,
              supports_reasoning: true,
              supported_parameters: ['temperature', 'max_tokens', 'response_format', 'tools', 'reasoning'],
              config: { role: 'reasoning', enabled: true, temperature: 0.3, max_output_tokens: 16384, timeout_seconds: 90, max_retries: 1, supports_json_mode: true, supports_tool_calling: true, supports_reasoning: true },
            },
          ],
        };
      },
      async TestTelegramConnection() {
        return { ok: false, status: 'preview' };
      },
      async LoginXAIOAuth() {
        return {
          status: 'succeeded',
          provider: 'xai_oauth',
          base_url: 'https://api.x.ai/v1',
          model_name: 'grok-4.3',
          last_refresh: new Date().toISOString(),
          source: 'preview',
          scope: 'openid profile email offline_access grok-cli:access api:access',
        };
      },
      async GenerateWorkerToken() {
        return { token: 'preview-token' };
      },
    };
  return shouldUseBrowserBridge() ? browserBridgeBindings(preview) : preview;
}

export const desktopApi = {
  sendChat: (req: ChatRequest) => bindings().SendChat(req),
  listPersonaMessenger: () => bindings().ListPersonaMessenger(),
  generateProjectPersonaCandidates: (req: GenerateProjectPersonaCandidatesRequest) => bindings().GenerateProjectPersonaCandidates(req),
  createProjectPersona: (req: CreateProjectPersonaRequest) => bindings().CreateProjectPersona(req),
  updateProjectPersona: (req: UpdateProjectPersonaRequest) => bindings().UpdateProjectPersona(req),
  rollbackProjectPersona: (req: RollbackProjectPersonaRequest) => bindings().RollbackProjectPersona(req),
  updateMessengerRoom: (req: UpdateMessengerRoomRequest) => bindings().UpdateMessengerRoom(req),
  updateMessengerProject: (req: UpdateMessengerProjectRequest) => bindings().UpdateMessengerProject(req),
  createSharedRoom: (req: CreateSharedRoomRequest) => bindings().CreateSharedRoom(req),
  connectExternalMirrorRoom: (req: ConnectExternalMirrorRoomRequest) => bindings().ConnectExternalMirrorRoom(req),
  recordExternalConnectorInbound: (req: RecordExternalConnectorInboundRequest) => bindings().RecordExternalConnectorInbound(req),
  recordExternalConnectorOutbound: (req: RecordExternalConnectorOutboundRequest) => bindings().RecordExternalConnectorOutbound(req),
  previewExternalPersonaMessage: (req: PreviewExternalPersonaMessageRequest) => bindings().PreviewExternalPersonaMessage(req),
  recordExternalConnectorFailure: (req: RecordExternalConnectorFailureRequest) => bindings().RecordExternalConnectorFailure(req),
  retryExternalConnectorEvent: (req: RetryExternalConnectorEventRequest) => bindings().RetryExternalConnectorEvent(req),
  setRouteLock: (req: SetRouteLockRequest) => bindings().SetRouteLock(req),
  completeCheckpoint: (req: CompleteCheckpointRequest = {}) => bindings().CompleteCheckpoint(req),
  recordRoutingFeedback: (req: RoutingFeedbackRequest) => bindings().RecordRoutingFeedback(req),
  evaluateRoomPermissions: (req: EvaluateRoomPermissionsRequest) => bindings().EvaluateRoomPermissions(req),
  getRunTrace: (runID: string) => bindings().GetRunTrace(runID),
  listRunTraceSpans: (filter: RunTraceSpanFilter = {}) => bindings().ListRunTraceSpans(filter),
  listConversations: (filter: ConversationFilter = { view: 'active', limit: 100 }) => bindings().ListConversations(filter),
  getConversation: (conversationID: string) => bindings().GetConversation(conversationID),
  getConversationForMessage: (messageID: string) => bindings().GetConversationForMessage(messageID),
  listConversationGroups: () => bindings().ListConversationGroups(),
  saveConversationGroup: (req: ConversationGroupRequest) => bindings().SaveConversationGroup(req),
  deleteConversationGroup: (id: string) => bindings().DeleteConversationGroup(id),
  moveConversationToGroup: (req: ConversationActionRequest) => bindings().MoveConversationToGroup(req),
  archiveConversation: (req: ConversationActionRequest) => bindings().ArchiveConversation(req),
  trashConversation: (req: ConversationActionRequest) => bindings().TrashConversation(req),
  restoreConversation: (req: ConversationActionRequest) => bindings().RestoreConversation(req),
  purgeConversation: (req: ConversationActionRequest) => bindings().PurgeConversation(req),
  listCapabilities: () => bindings().ListCapabilities(),
  listMCPServers: () => bindings().ListMCPServers(),
  syncMCPServer: (id: string) => bindings().SyncMCPServer(id),
  wrapMCPTool: (serverID: string, toolName: string, req: MCPWrapToolRequest) => bindings().WrapMCPTool(serverID, toolName, req),
  listSkills: () => bindings().ListSkills(),
  listToolWorkflows: () => bindings().ListToolWorkflows(),
  listToolRuns: () => bindings().ListToolRuns(),
  setToolWorkflowEnabled: (req: { name: string; enabled: boolean }) => bindings().SetToolWorkflowEnabled(req),
  getSystemHealth: () => bindings().GetSystemHealth(),
  listMemories: (filter: { query?: string; limit?: number }) => bindings().ListMemories(filter),
  updateMemory: (req: { id: string; action: string; feedback?: string; comment?: string; target_id?: string; reason?: string; content?: string; summary?: string; scope_type?: string; run_id?: string }) => bindings().UpdateMemory(req),
  listMemoriesUsedForRun: (runID: string) => bindings().ListMemoriesUsedForRun(runID),
  listMemoryCandidates: (filter: MemoryCandidateFilter = {}) => bindings().ListMemoryCandidates(filter),
  decideMemoryCandidate: (req: MemoryCandidateDecisionRequest) => bindings().DecideMemoryCandidate(req),
  correctMemory: (req: MemoryCorrectionRequest) => bindings().CorrectMemory(req),
  deleteMemory: (req: MemoryDeleteRequest) => bindings().DeleteMemory(req),
  listUserStates: (filter: { limit?: number } = {}) => bindings().ListUserStates(filter),
  listRelationshipStates: (filter: { limit?: number } = {}) => bindings().ListRelationshipStates(filter),
  listProductTasks: (filter: ProductTaskFilter) => bindings().ListProductTasks(filter),
  listProductTasksByConversation: (conversationID: string) => bindings().ListProductTasksByConversation(conversationID),
  listProductTasksByPrincipal: (principalID: string) => bindings().ListProductTasksByPrincipal(principalID),
  getProductTask: (id: string) => bindings().GetProductTask(id),
  closeProductTask: (req: ProductTaskCloseRequest) => bindings().CloseProductTask(req),
  reopenProductTask: (req: ProductTaskReopenRequest) => bindings().ReopenProductTask(req),
  getRecentRunClosureReport: (req: { limit?: number } = {}) => bindings().GetRecentRunClosureReport(req),
  getExternalHandoffAudit: () => bindings().GetExternalHandoffAudit(),
  listArtifacts: (filter: { product_task_id?: string; type?: string; limit?: number }) => bindings().ListArtifacts(filter),
  getArtifact: (id: string) => bindings().GetArtifact(id),
  listOpenLoops: (filter: { status?: string; limit?: number }) => bindings().ListOpenLoops(filter),
  decideOpenLoop: (req: { id: string; action: string; feedback?: string; due_at?: string }) => bindings().DecideOpenLoop(req),
  listProactiveMessages: (filter: { status?: string; limit?: number }) => bindings().ListProactiveMessages(filter),
  decideProactiveMessage: (req: { id: string; action: string; feedback?: string }) => bindings().DecideProactiveMessage(req),
  recordNotificationOpened: (req: RecordNotificationOpenedRequest) => bindings().RecordNotificationOpened(req),
  listNodes: () => bindings().ListNodes(),
  disableNode: (nodeID: string) => bindings().DisableNode(nodeID),
  enableNode: (nodeID: string) => bindings().EnableNode(nodeID),
  listWorkerGatewayAuditLogs: () => bindings().ListWorkerGatewayAuditLogs(),
  getModelUsage: () => bindings().GetModelUsage(),
  listConfirmations: () => bindings().ListConfirmations(),
  decideConfirmation: (req: { id: string; approve: boolean; actor?: string; reason?: string; scope?: 'one_call' | 'current_run' | string }) => bindings().DecideConfirmation(req),
  listPendingApprovals: () => bindings().ListPendingApprovals(),
  decideApproval: (req: ApprovalDecisionRequest) => bindings().DecideApproval(req),
  resumeApprovalRun: (req: ApprovalResumeRunRequest) => bindings().ResumeApprovalRun(req),
  interruptRun: (req: InterruptRunRequest) => bindings().InterruptRun(req),
  redirectRun: (req: RedirectRunRequest) => bindings().RedirectRun(req),
  listRecoverableRuns: (req: { limit?: number } = {}) => bindings().ListRecoverableRuns(req),
  listBackups: () => bindings().ListBackups(),
  createBackup: () => bindings().CreateBackup(),
  restoreBackup: (path: string) => bindings().RestoreBackup(path),
  exportDiagnostics: () => bindings().ExportDiagnostics(),
  exportPersonaMessengerData: (req: PersonaMessengerExportRequest = {}) => bindings().ExportPersonaMessengerData(req),
  listAutomations: (filter: { kind?: 'schedule' | 'webhook'; enabled?: boolean; limit?: number } = {}) => bindings().ListAutomations(filter),
  getAutomation: (id: string) => bindings().GetAutomation(id),
  saveAutomation: (req: AutomationDefinitionRequest) => bindings().SaveAutomation(req),
  deleteAutomation: (id: string) => bindings().DeleteAutomation(id),
  setAutomationEnabled: (req: { id: string; enabled: boolean }) => bindings().SetAutomationEnabled(req),
  triggerAutomationNow: (req: AutomationTriggerNowRequest) => bindings().TriggerAutomationNow(req),
  listAutomationTriggers: (filter: { automation_id?: string; status?: string; limit?: number } = {}) => bindings().ListAutomationTriggers(filter),
  listAutomationRuns: (filter: { automation_id?: string; trigger_id?: string; limit?: number } = {}) => bindings().ListAutomationRuns(filter),
  getAutomationWebhookEndpoint: (id: string) => bindings().GetAutomationWebhookEndpoint(id),
  rotateAutomationWebhookSecret: (id: string) => bindings().RotateAutomationWebhookSecret(id),
  testAutomationWebhook: (req: AutomationWebhookTestRequest) => bindings().TestAutomationWebhook(req),
  listLogs: (filter: LogFilter = {}) => bindings().ListLogs(filter),
  getLogEntry: (id: string) => bindings().GetLogEntry(id),
  previewLogCleanup: (req: LogCleanupRequest) => bindings().PreviewLogCleanup(req),
  clearLogs: (req: LogCleanupRequest) => bindings().ClearLogs(req),
  exportLogs: (filter: LogFilter = {}) => bindings().ExportLogs(filter),
  getSettings: () => bindings().GetSettings(),
  getWorkspaceSettings: () => bindings().GetWorkspaceSettings(),
  saveWorkspaceSettings: (req: WorkspaceSettings) => bindings().SaveWorkspaceSettings(req),
  listSavedModels: (req: ModelListRequest = {}) => bindings().ListSavedModels(req),
  fetchAvailableModels: (req?: ModelConnectionTestRequest) => bindings().FetchAvailableModels(req),
  saveModelConfig: (req: ModelConfigRequest) => bindings().SaveModelConfig(req),
  saveModelSettings: (req: ModelSettingsRequest) => bindings().SaveModelSettings(req),
  saveOperationalSettings: (req: { telegram_enabled: boolean; telegram_allowed_user_ids?: string; imessage_enabled?: boolean; imessage_allowed_users?: string; imessage_require_mention?: boolean; imessage_home_channel?: string; worker_gateway_enabled: boolean; backup_dir?: string; auto_backup_enabled: boolean }) => bindings().SaveOperationalSettings(req),
  saveTelegramConfig: (req: { token?: string; allowed_user_ids?: string; enabled: boolean }) => bindings().SaveTelegramConfig(req),
  sendTestTelegramMessage: (req: { chat_id?: string; message?: string }) => bindings().SendTestTelegramMessage(req),
  setupPhotonIMessage: (req: PhotonIMessageSetupRequest) => bindings().SetupPhotonIMessage(req),
  saveIMessageConfig: (req: { project_id?: string; project_secret?: string; dashboard_token?: string; phone_number?: string; assigned_number?: string; home_channel?: string; allowed_users?: string; require_mention?: boolean; enabled: boolean; sidecar_port?: number }) => bindings().SaveIMessageConfig(req),
  getIMessageStatus: () => bindings().GetIMessageStatus(),
  testIMessageConnection: () => bindings().TestIMessageConnection(),
  sendTestIMessageMessage: (req: { space_id?: string; message?: string }) => bindings().SendTestIMessageMessage(req),
  getOnboardingStatus: () => bindings().GetOnboardingStatus(),
  completeOnboarding: () => bindings().CompleteOnboarding(),
  getSecretStatus: () => bindings().GetSecretStatus(),
  saveSecret: (req: { name: string; value: string }) => bindings().SaveSecret(req),
  loginXAIOAuth: () => bindings().LoginXAIOAuth(),
  testModelConnection: (req?: ModelConnectionTestRequest) => bindings().TestModelConnection(req),
  testTelegramConnection: () => bindings().TestTelegramConnection(),
  generateWorkerToken: () => bindings().GenerateWorkerToken(),
};
