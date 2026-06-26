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
  UpdateProjectPersonaRequest,
  WorkerGatewayAuditRecord,
  WorkspaceSettings,
} from '../../../../../packages/shared-types/src/desktop-api';

declare global {
  interface Window {
    joi?: JoiPreloadApi;
  }
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

function bindings(): DesktopBindings {
  if (window.joi?.invoke) {
    return electronBindings(window.joi);
  }
  return {
      async SendChat(req) {
        const runID = `run_preview_${Date.now()}`;
        return {
          conversation_id: 'conv_preview',
          user_message_id: 'msg_preview_user',
          assistant_message_id: 'msg_preview_assistant',
          run_id: runID,
          selected_agent_id: 'general_agent',
          response: `Preview mode: ${req.message}`,
          model_calls: [],
        };
      },
      async ListPersonaMessenger() {
        const now = new Date().toISOString();
        return {
          projects: [{
            id: 'prj_preview',
            name: 'Joi Desktop',
            goal: '预览 Persona Messenger',
            domain: 'desktop_agent_os',
            phase: 'mvp',
            risk_level: 'low',
            status: 'active',
            summary: '浏览器预览中的 Joi 项目人格工作空间。',
            created_at: now,
            updated_at: now,
          }],
          personas: [{
            id: 'per_preview',
            project_id: 'prj_preview',
            display_name: 'Joi',
            handle: '@joi-desktop',
            tagline: '本地桌面 Agent OS 项目人格',
            self_intro: '我负责把消息、任务、记忆和运行日志组织成可验证的工作空间。',
            traits: { directness: 0.78, warmth: 0.5, humor: 0.12, verbosity: 0.46, initiative: 0.7, risk_sensitivity: 0.84, divergence: 0.32 },
            disagreement_style: '直接指出风险，并给出替代路径',
            uncertainty_style: '说明不确定来源和验证路径',
            status: 'active',
            version: 1,
            capabilities: ['chat', 'memory', 'trace', 'terminal'],
            permission_summary: '默认只读；高风险动作需要审批',
            model_strategy: '使用桌面默认模型策略',
          }],
          rooms: [{
            id: 'room_private_hub',
            type: 'private_hub',
            title: '私人总群',
            subtitle: '你和所有项目人格',
            owner_user_id: 'desktop_user',
            persona_id: 'per_preview',
            conversation_id: 'conv_preview',
            default_ai_participation: 'moderate',
            floor_holder_persona_id: 'per_preview',
            unread_count: 0,
            pending_approval_count: 0,
            failed_run_count: 0,
            running_run_count: 0,
            last_message: 'Joi 加入了群聊',
            last_activity_at: now,
            members: [
              { id: 'desktop_user', type: 'user', display_name: '你', role: 'owner' },
              { id: 'per_preview', type: 'persona', display_name: 'Joi', role: 'persona', persona_id: 'per_preview', project_id: 'prj_preview' },
            ],
          }, {
            id: 'room_preview_dm',
            type: 'project_dm',
            title: 'Joi',
            subtitle: 'Joi Desktop',
            owner_user_id: 'desktop_user',
            project_id: 'prj_preview',
            persona_id: 'per_preview',
            conversation_id: 'conv_preview',
            default_ai_participation: 'moderate',
            floor_holder_persona_id: 'per_preview',
            unread_count: 0,
            pending_approval_count: 0,
            failed_run_count: 0,
            running_run_count: 0,
            last_message: '浏览器预览中的 Project DM',
            last_activity_at: now,
            members: [
              { id: 'desktop_user', type: 'user', display_name: '你', role: 'owner' },
              { id: 'per_preview', type: 'persona', display_name: 'Joi', role: 'persona', persona_id: 'per_preview', project_id: 'prj_preview' },
            ],
          }],
          persona_versions: [{
            id: 'pver_preview_1',
            persona_id: 'per_preview',
            version: 1,
            changed_by: 'desktop_user',
            change_reason: '预览初始身份',
            created_at: now,
          }],
	          room_connectors: [],
	          recent_external_events: [],
	          route_locks: [],
	          recent_routing_decisions: [],
	          threads: [],
	          recent_thread_events: [],
	          checkpoint: {
            since: now,
            completed_count: 0,
            failed_count: 0,
            pending_approval_count: 0,
            waiting_user_count: 0,
            new_artifact_count: 0,
            no_progress_project_count: 0,
            model_cost_estimate: 0,
            external_unhandled_count: 0,
            items: [{ id: 'preview_quiet', kind: 'quiet', title: '预览模式暂无需要检查的变化', severity: 'info' }],
          },
        };
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
        return {
          id: runID,
          conversation_id: 'conv_preview',
          status: 'preview',
          selected_agent_id: 'general_agent',
          steps: [
            { id: 'step_preview_1', step_type: 'input_received', title: 'Input received', status: 'succeeded' },
            { id: 'step_preview_2', step_type: 'response_generated', title: 'Response generated', status: 'succeeded' },
          ],
        };
      },
      async ListRunTraceSpans() {
        return {
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
        };
      },
      async ListConversations(filter: ConversationFilter = { view: 'active', limit: 100 }) {
        if (filter.view && filter.view !== 'active') {
          return { conversations: [] };
        }
        return {
          conversations: [
            {
              id: 'conv_preview',
              channel: 'preview',
              user_id: 'desktop_user',
              title: 'Preview conversation',
              active_agent_id: 'general_agent',
              last_message: 'Preview mode',
              last_role: 'assistant',
              latest_run_id: '',
              message_count: 2,
              lifecycle_status: 'active',
            },
          ],
        };
      },
      async ListConversationGroups() {
        return { groups: [{ id: 'cgrp_preview', name: '默认分组', sort_order: 1, collapsed: false }] };
      },
      async SaveConversationGroup(req) {
        return { id: req.id || `cgrp_preview_${Date.now()}`, name: req.name, sort_order: req.sort_order ?? 0, collapsed: Boolean(req.collapsed), metadata: req.metadata ?? {} };
      },
      async DeleteConversationGroup() {},
      async MoveConversationToGroup() {
        return { conversation: { id: 'conv_preview', channel: 'preview', user_id: 'desktop_user', title: 'Preview conversation', message_count: 2, lifecycle_status: 'active' } };
      },
      async ArchiveConversation() {
        return { conversation: { id: 'conv_preview', channel: 'preview', user_id: 'desktop_user', title: 'Preview conversation', message_count: 2, lifecycle_status: 'archived' } };
      },
      async TrashConversation() {
        return { conversation: { id: 'conv_preview', channel: 'preview', user_id: 'desktop_user', title: 'Preview conversation', message_count: 2, lifecycle_status: 'trashed', purge_after: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString() } };
      },
      async RestoreConversation() {
        return { conversation: { id: 'conv_preview', channel: 'preview', user_id: 'desktop_user', title: 'Preview conversation', message_count: 2, lifecycle_status: 'active' } };
      },
      async PurgeConversation() {
        return { conversation: { id: 'conv_preview', channel: 'preview', user_id: 'desktop_user', title: '[已永久清理]', message_count: 2, lifecycle_status: 'purged' } };
      },
      async GetConversation() {
        return {
          conversation: {
            id: 'conv_preview',
            channel: 'preview',
            user_id: 'desktop_user',
            title: 'Preview conversation',
            active_agent_id: 'general_agent',
            last_message: 'Preview mode',
            last_role: 'assistant',
            latest_run_id: '',
            message_count: 2,
          },
          messages: [
            { id: 'msg_preview_user', conversation_id: 'conv_preview', role: 'user', content: 'Preview request' },
            { id: 'msg_preview_assistant', conversation_id: 'conv_preview', role: 'assistant', content: 'Preview response', run_id: '' },
          ],
        };
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
        return { tool_runs: [] };
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
      async ListMemories() {
        return { memories: [] };
      },
      async UpdateMemory() {},
      async ListMemoriesUsedForRun() {
        return { memories: [] };
      },
      async ListMemoryCandidates() {
        return { memories: [] };
      },
      async DecideMemoryCandidate() {},
      async CorrectMemory() {},
      async DeleteMemory() {},
      async ListUserStates() {
        return { memories: [] };
      },
      async ListRelationshipStates() {
        return { memories: [] };
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
      async ListArtifacts() {
        return { artifacts: [] };
      },
      async GetArtifact(id) {
        return {
          id,
          type: 'report',
          title: 'Preview artifact',
          content_format: 'markdown',
          version: 1,
          status: 'active',
          content: '# Preview artifact\n\n这里会显示任务交付物。',
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
}

export const desktopApi = {
  sendChat: (req: ChatRequest) => bindings().SendChat(req),
  listPersonaMessenger: () => bindings().ListPersonaMessenger(),
  generateProjectPersonaCandidates: (req: GenerateProjectPersonaCandidatesRequest) => bindings().GenerateProjectPersonaCandidates(req),
  createProjectPersona: (req: CreateProjectPersonaRequest) => bindings().CreateProjectPersona(req),
  updateProjectPersona: (req: UpdateProjectPersonaRequest) => bindings().UpdateProjectPersona(req),
  rollbackProjectPersona: (req: RollbackProjectPersonaRequest) => bindings().RollbackProjectPersona(req),
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
