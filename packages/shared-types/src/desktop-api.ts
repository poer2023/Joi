export type ChatRequest = {
  conversation_id?: string;
  room_id?: string;
  channel?: string;
  user_id?: string;
  principal_id?: string;
  message: string;
  reply_to_message_id?: string;
  mentions?: string[];
  scope_override?: MessengerScopeOverride;
  route_lock_action?: 'lock' | 'unlock' | 'none';
  preferred_node?: string;
  allow_worker?: boolean;
  model_provider?: string;
  model_name?: string;
  model_base_url?: string;
  reasoning_effort?: string;
  workspace_root?: string;
  input_mode?: InputMode;
  product_task_id?: string;
  parent_run_id?: string;
  redirected_from_run_id?: string;
  runtime_mode?: RuntimeMode;
  permission_profile?: PermissionProfile;
  attachments?: unknown[];
  memory_controls?: Partial<MemoryTaskControls>;
};

export type MemoryTaskControls = {
  use_memories: boolean;
  generate_memories: boolean;
  disable_on_external_context: boolean;
  external_context_used?: boolean;
};

export type MessengerRoomType = 'private_hub' | 'project_dm' | 'shared' | 'human_dm' | 'external_mirror' | string;

export type MessengerPersonaStatus = 'active' | 'warm' | 'dormant' | 'archived' | 'deleted' | string;

export type MessengerScopeOverride = 'current_project' | 'temporary' | 'other_project' | 'cross_project' | 'auto_route' | 'specified_persona' | 'locked_persona' | 'room_scope' | 'multi_project' | string;

export type MessengerProject = {
  id: string;
  name: string;
  goal?: string;
  domain?: string;
  phase?: string;
  risk_level?: string;
  status: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  archived_at?: string;
};

export type ProjectPersona = {
  id: string;
  project_id: string;
  display_name: string;
  handle: string;
  avatar?: string;
  tagline?: string;
  self_intro?: string;
  traits: Record<string, number>;
  disagreement_style?: string;
  uncertainty_style?: string;
  status: MessengerPersonaStatus;
  version: number;
  capabilities: string[];
  permission_summary?: string;
  model_strategy?: string;
  model_reasoning_effort?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type PersonaCandidate = {
  id: string;
  display_name: string;
  handle: string;
  avatar?: string;
  tagline: string;
  self_intro: string;
  traits: Record<string, number>;
  disagreement_style: string;
  uncertainty_style: string;
  rationale: string;
};

export type PersonaVersion = {
  id: string;
  persona_id: string;
  version: number;
  changed_by: string;
  change_reason: string;
  before?: ProjectPersona;
  after?: ProjectPersona;
  applies_from_message_id?: string;
  created_at?: string;
};

export type MessengerRoom = {
  id: string;
  type: MessengerRoomType;
  title: string;
  avatar?: string;
  subtitle?: string;
  owner_user_id: string;
  project_id?: string;
  persona_id?: string;
  conversation_id?: string;
  default_ai_participation: string;
  floor_holder_persona_id?: string;
  route_lock_persona_id?: string;
  unread_count: number;
  pending_approval_count: number;
  failed_run_count: number;
  running_run_count: number;
  last_message?: string;
  last_role?: string;
  last_activity_at?: string;
  archived_at?: string;
  metadata?: Record<string, unknown>;
  members?: Array<{
    id: string;
    type: 'user' | 'human' | 'persona' | string;
    display_name: string;
    role?: string;
    persona_id?: string;
    project_id?: string;
    visibility_scope?: string;
    visible_project_ids?: string[];
    can_approve_high_risk?: boolean;
    metadata?: Record<string, unknown>;
  }>;
  permission_audit?: RoomPermissionAudit;
};

export type RoomConnector = {
  id: string;
  room_id: string;
  provider: string;
  connector_id: string;
  external_room_id: string;
  status: string;
  visible_persona_ids: string[];
  allow_temporary_invite: boolean;
  retry_count: number;
  last_error?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type ExternalConnectorEvent = {
  id: string;
  connector_id: string;
  provider: string;
  external_event_id: string;
  room_id: string;
  external_user_id: string;
  reply_to_external_message_id?: string;
  text: string;
  internal_message_id?: string;
  status: string;
  retry_count: number;
  error?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
};

export type RouteLock = {
  room_id: string;
  user_id: string;
  persona_id: string;
  started_at?: string;
  expires_at?: string;
  status: string;
};

export type RoutingDecision = {
  id: string;
  room_id: string;
  message_id?: string;
  run_id?: string;
  speaker_persona_id?: string;
  owner_project_id?: string;
  executor_persona_id?: string;
  collaborator_project_ids: string[];
  execution_scope: string;
  write_targets: string[];
  thread_action: Record<string, unknown>;
  confidence: number;
  risk: string;
  requires_confirmation: boolean;
  reason_codes: string[];
  created_at?: string;
};

export type MessengerThread = {
  id: string;
  project_id?: string;
  project_name?: string;
  room_id?: string;
  room_title?: string;
  owner_persona_id?: string;
  owner_persona_name?: string;
  title: string;
  goal?: string;
  status: string;
  priority: string;
  collaborator_persona_ids: string[];
  source_room_ids: string[];
  source_message_ids: string[];
  run_ids: string[];
  artifact_ids: string[];
  next_action?: string;
  message_count: number;
  run_count: number;
  artifact_count: number;
  latest_run_status?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
};

export type MessengerThreadEvent = {
  id: string;
  thread_id: string;
  room_id?: string;
  message_id?: string;
  run_id?: string;
  artifact_id?: string;
  product_task_id?: string;
  event_type: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
};

export type CheckpointSummary = {
  checkpoint_id?: string;
  checked_at?: string;
  covered_event_cursor?: string;
  since?: string;
  completed_count: number;
  failed_count: number;
  pending_approval_count: number;
  waiting_user_count: number;
  new_artifact_count: number;
  no_progress_project_count: number;
  model_cost_estimate: number;
  external_unhandled_count: number;
  items: Array<{
    id: string;
    kind: string;
    title: string;
    body?: string;
    severity?: 'info' | 'success' | 'warning' | 'error' | string;
    room_id?: string;
    project_id?: string;
    run_id?: string;
  }>;
};

export type PersonaMessengerSnapshot = {
  rooms: MessengerRoom[];
  projects: MessengerProject[];
  personas: ProjectPersona[];
  persona_versions: PersonaVersion[];
  room_connectors: RoomConnector[];
  recent_external_events: ExternalConnectorEvent[];
  route_locks: RouteLock[];
  recent_routing_decisions: RoutingDecision[];
  threads: MessengerThread[];
  recent_thread_events: MessengerThreadEvent[];
  checkpoint: CheckpointSummary;
};

export type GenerateProjectPersonaCandidatesRequest = {
  project_name: string;
  project_goal?: string;
  domain?: string;
  phase?: string;
};

export type CreateProjectPersonaRequest = {
  project_name: string;
  project_goal?: string;
  domain?: string;
  phase?: string;
  candidate_id?: string;
  persona_choice?: Partial<ProjectPersona>;
};

export type UpdateProjectPersonaRequest = {
  persona_id: string;
  base_version?: number;
  actor_id?: string;
  actor_role?: 'project_owner' | 'room_owner' | 'human_member' | 'guest' | string;
  room_id?: string;
  display_name?: string;
  handle?: string;
  avatar?: string;
  tagline?: string;
  self_intro?: string;
  traits?: Record<string, number>;
  disagreement_style?: string;
  uncertainty_style?: string;
  permission_summary?: string;
  model_strategy?: string;
  model_reasoning_effort?: string;
  change_reason: string;
};

export type RollbackProjectPersonaRequest = {
  persona_id: string;
  target_version: number;
  actor_id?: string;
  actor_role?: 'project_owner' | 'room_owner' | 'human_member' | 'guest' | string;
  room_id?: string;
  change_reason: string;
};

export type CreateSharedRoomRequest = {
  title: string;
  persona_ids: string[];
  human_members: Array<{
    display_name: string;
    external_user_id?: string;
    role?: 'human_member' | 'guest' | string;
    profile?: string;
    visible_project_ids?: string[];
    can_approve_high_risk?: boolean;
  }>;
  ai_participation?: 'active' | 'moderate' | 'mention_only' | 'silent' | 'temporary' | string;
  visible_project_ids?: string[];
  permission_summary?: string;
  tool_policy?: Record<string, unknown>;
};

export type UpdateMessengerRoomRequest = {
  room_id: string;
  title?: string;
  avatar?: string;
  actor_id?: string;
};

export type UpdateMessengerProjectRequest = {
  project_id: string;
  name?: string;
  local_path?: string;
  actor_id?: string;
};

export type ConnectExternalMirrorRoomRequest = {
  room_id?: string;
  provider: string;
  external_room_id: string;
  title?: string;
  persona_ids: string[];
  allow_temporary_invite?: boolean;
};

export type RecordExternalConnectorInboundRequest = {
  provider: string;
  external_room_id: string;
  external_event_id: string;
  external_user_id: string;
  text: string;
  reply_to_external_message_id?: string;
};

export type RecordExternalConnectorOutboundRequest = {
  connector_id?: string;
  provider?: string;
  external_room_id?: string;
  external_message_id: string;
  room_id?: string;
  persona_id: string;
  text: string;
  internal_message_id?: string;
  status?: 'sent' | 'pending' | 'send_failed' | string;
};

export type PreviewExternalPersonaMessageRequest = {
  room_id: string;
  persona_id: string;
  text: string;
};

export type RecordExternalConnectorFailureRequest = {
  connector_id: string;
  external_event_id?: string;
  room_id?: string;
  error: string;
  retryable?: boolean;
};

export type RetryExternalConnectorEventRequest = {
  event_id?: string;
  connector_id?: string;
  external_event_id?: string;
  reason?: string;
};

export type SetRouteLockRequest = {
  room_id: string;
  persona_id?: string;
  user_id?: string;
  action: 'lock' | 'unlock';
};

export type CompleteCheckpointRequest = {
  acknowledged_items?: string[];
  snoozed_items?: string[];
};

export type RoutingFeedbackRequest = {
  routing_decision_id?: string;
  room_id: string;
  message_id?: string;
  run_id?: string;
  action: 'reroute' | 'adjust_write_scope' | 'confirm' | 'reject' | string;
  target_persona_id?: string;
  write_targets?: string[];
  comment?: string;
};

export type PersonaMessengerExportRequest = {
  project_id?: string;
  persona_id?: string;
  room_id?: string;
  thread_id?: string;
  trace_run_id?: string;
  since?: string;
  until?: string;
  include_messages?: boolean;
  include_trace?: boolean;
};

export type PersonaMessengerExportResult = {
  path: string;
  manifest: {
    generated_at: string;
    filters: PersonaMessengerExportRequest;
    row_counts: Record<string, number>;
    secrets_policy: string;
  };
};

export type RoomPermissionAudit = {
  room_id: string;
  actor_id: string;
  actor_type: 'user' | 'human' | 'persona' | string;
  actor_role: string;
  authorized_project_ids: string[];
  visible_project_ids: string[];
  denied_project_ids: string[];
  can_read_room_history: boolean;
  can_read_private_persona_dm: boolean;
  can_modify_core_persona: boolean;
  can_approve_high_risk: boolean;
  ai_participation: string;
  multi_human_ai_throttle: boolean;
  reason_codes: string[];
  summary: string;
};

export type EvaluateRoomPermissionsRequest = {
  room_id: string;
  actor_id?: string;
  actor_type?: 'user' | 'human' | 'persona' | string;
  project_id?: string;
  persona_id?: string;
};

export type ChatResponse = {
  conversation_id: string;
  user_message_id: string;
  assistant_message_id: string;
  run_id: string;
  selected_agent_id: string;
  response: string;
  ui?: ChatUIHints;
  model_calls?: ModelCall[];
  used_memories?: MemorySearchResult[];
  product_task?: ProductTask;
  artifacts?: ArtifactSummary[];
  proactive_candidates?: ProactiveMessage[];
  reflection?: ReflectionResult;
};

export type ChatUIHints = {
  interaction_class: string;
  requires_user_input: boolean;
  missing_input?: string;
  inline_execution: boolean;
};

export type InputMode = 'auto' | 'chat_assist' | 'serious_task' | 'background_task';

export type RuntimeMode = 'legacy_json' | 'tool_calling';

export type PermissionProfile = 'read_only' | 'workspace_write' | 'danger_full_access';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | string;

export type LogRiskLevel =
  | 'read_only'
  | 'write_candidate'
  | 'browser_interaction'
  | 'workspace_write'
  | 'state_change'
  | 'destructive'
  | 'unsafe'
  | string;

export type LogEntry = {
  id: string;
  source_table: 'run_events' | 'app_logs' | 'worker_gateway_audit_logs' | string;
  level: LogLevel;
  risk_level: LogRiskLevel;
  category: string;
  feature_key: string;
  source: string;
  message: string;
  run_id?: string;
  turn_id?: string;
  conversation_id?: string;
  item_type?: string;
  item_id?: string;
  event_type?: string;
  action?: string;
  status?: string;
  payload?: Record<string, unknown>;
  error?: Record<string, unknown>;
  duration_ms?: number;
  hidden_by_default?: boolean;
  created_at?: string;
};

export type LogFilter = {
  query?: string;
  levels?: string[];
  risk_levels?: string[];
  categories?: string[];
  sources?: string[];
  run_id?: string;
  conversation_id?: string;
  since?: string;
  until?: string;
  include_trace?: boolean;
  include_worker_heartbeat?: boolean;
  limit?: number;
  cursor?: string;
};

export type LogCleanupScope =
  | 'app_logs'
  | 'run_events'
  | 'run_steps'
  | 'tool_runs'
  | 'model_calls'
  | 'worker_gateway_audit_logs'
  | 'log_files'
  | string;

export type LogCleanupRequest = {
  scopes: LogCleanupScope[];
  older_than?: string;
  run_id?: string;
  levels?: string[];
  categories?: string[];
  include_trace_delta?: boolean;
  include_worker_heartbeat?: boolean;
  reason?: string;
  actor?: string;
  dry_run?: boolean;
};

export type LogCleanupPreview = {
  scopes: LogCleanupScope[];
  counts: Record<string, number>;
  log_file_paths?: string[];
  total_count: number;
  safe_to_clear: boolean;
  warnings: string[];
};

export type LogCleanupResult = LogCleanupPreview & {
  cleanup_id: string;
  cleared_at: string;
};

export type AutomationKind = 'schedule' | 'webhook';

export type AutomationExecutionKind = 'cron' | 'heartbeat' | 'webhook';

export type AutomationStatus = 'ACTIVE' | 'PAUSED' | 'DELETED';

export type AutomationTriggerStatus = 'pending' | 'claimed' | 'running' | 'retry_scheduled' | 'succeeded' | 'failed' | 'cancelled' | 'deduped' | string;

export type AutomationRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'waiting_confirmation' | string;

export type AutomationDefinition = {
  id: string;
  kind: AutomationKind;
  execution_kind: AutomationExecutionKind;
  status: AutomationStatus;
  slug: string;
  name: string;
  description?: string;
  enabled: boolean;
  trigger_config: Record<string, unknown>;
  prompt_template: string;
  input_mode: InputMode;
  permission_profile: PermissionProfile;
  preferred_node: string;
  allow_worker: boolean;
  conversation_id?: string;
  principal_id?: string;
  dedup_policy: Record<string, unknown>;
  retry_policy: Record<string, unknown>;
  max_concurrency: number;
  notification_policy: Record<string, unknown>;
  rrule?: string;
  model?: string;
  model_provider?: string;
  model_base_url?: string;
  reasoning_effort?: string;
  execution_environment?: 'local' | string;
  target?: Record<string, unknown>;
  cwds: string[];
  target_thread_id?: string;
  is_draft?: boolean;
  next_fire_at?: string;
  last_fire_at?: string;
  metadata: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type AutomationDefinitionRequest = {
  id?: string;
  kind: AutomationKind;
  execution_kind?: AutomationExecutionKind;
  slug?: string;
  name: string;
  description?: string;
  enabled?: boolean;
  trigger_config?: Record<string, unknown>;
  prompt_template?: string;
  input_mode?: InputMode;
  permission_profile?: PermissionProfile;
  preferred_node?: string;
  allow_worker?: boolean;
  conversation_id?: string;
  principal_id?: string;
  dedup_policy?: Record<string, unknown>;
  retry_policy?: Record<string, unknown>;
  max_concurrency?: number;
  notification_policy?: Record<string, unknown>;
  rrule?: string;
  model?: string;
  model_provider?: string;
  model_base_url?: string;
  reasoning_effort?: string;
  execution_environment?: 'local' | string;
  target?: Record<string, unknown>;
  cwds?: string[];
  target_thread_id?: string;
  is_draft?: boolean;
  metadata?: Record<string, unknown>;
};

export type AutomationTriggerRecord = {
  id: string;
  automation_id: string;
  trigger_type: AutomationKind | 'manual' | string;
  dedup_key: string;
  payload: Record<string, unknown>;
  status: AutomationTriggerStatus;
  fire_at?: string;
  claimed_at?: string;
  claim_token?: string;
  run_id?: string;
  product_task_id?: string;
  attempt_count: number;
  next_attempt_at?: string;
  error_code?: string;
  error_message?: string;
  created_at?: string;
  updated_at?: string;
};

export type AutomationRunRecord = {
  id: string;
  automation_id: string;
  trigger_id: string;
  run_id?: string;
  product_task_id?: string;
  status: AutomationRunStatus;
  attempt_number: number;
  started_at?: string;
  finished_at?: string;
  output_summary?: string;
  error_code?: string;
  error_message?: string;
  conversation_id?: string;
  source_cwd?: string;
  automation_name?: string;
  read_at?: string;
  archived_at?: string;
  metadata: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type AutomationTriggerNowRequest = {
  id: string;
  payload?: Record<string, unknown>;
};

export type AutomationRunReadRequest = {
  id: string;
  read: boolean;
};

export type AutomationRunArchiveRequest = {
  id: string;
  archived: boolean;
};

export type AutomationWebhookEndpoint = {
  automation_id: string;
  slug: string;
  url: string;
  secret_ref?: string;
  secret_configured: boolean;
  secret_value_once?: string;
};

export type AutomationWebhookTestRequest = {
  id: string;
  payload?: Record<string, unknown>;
};

export type TaskContract = {
  objective: string;
  deliverables: string[];
  constraints: string[];
  success_checks: string[];
  capability_scope: string[];
  risk_level: string;
  mode: InputMode | string;
  verification_requirements: string[];
};

export type TaskVerification = {
  status: 'pending' | 'passed' | 'failed' | string;
  summary: string;
  checks: Array<{
    name: string;
    status: 'passed' | 'failed' | string;
    evidence?: Record<string, unknown>;
  }>;
  verified_at?: string;
};

export type InterruptRunRequest = {
  run_id: string;
  reason?: string;
  scope?: 'run' | 'task';
};

export type RedirectRunRequest = {
  run_id: string;
  message?: string;
  reason?: string;
  requested_mode?: InputMode;
  product_task_id?: string;
};

export type RedirectRunResponse = {
  redirected_run: RunTrace;
  new_run?: ChatResponse;
};

export type RunQueuedMessageKind = 'steering' | 'follow_up';
export type RunQueuedMessageStatus = 'pending' | 'delivered' | 'cancelled';

export type RunQueuedMessage = {
  id: string;
  run_id: string;
  conversation_id: string;
  kind: RunQueuedMessageKind;
  content: string;
  attachments: unknown[];
  status: RunQueuedMessageStatus | string;
  delivered_run_id?: string;
  created_at?: string;
  delivered_at?: string;
  metadata?: Record<string, unknown>;
};

export type EnqueueRunMessageRequest = {
  run_id: string;
  conversation_id?: string;
  kind: RunQueuedMessageKind;
  content: string;
  attachments?: unknown[];
};

export type CancelRunMessageRequest = {
  id: string;
  run_id?: string;
};

export type ApprovalDecisionRequest = {
  run_id: string;
  approval_request_id: string;
  decision: 'approve' | 'approved' | 'deny' | 'denied' | 'reject' | 'rejected' | string;
  decision_scope?: 'one_call' | 'current_run' | string;
  decided_by: string;
  decided_at?: string;
  reason?: string;
  edited_parameters?: Record<string, unknown>;
};

export type ApprovalDecisionResponse = {
  confirmation?: ConfirmationRecord;
};

export type ApprovalResumeRunRequest = {
  run_id: string;
  approval_request_id: string;
};

export type ApprovalResumeRunResponse = {
  resumed: boolean;
  trace?: RunTrace;
};

export type RecoverableRunRecord = {
  run_id: string;
  conversation_id?: string;
  status: string;
  recovery_status: 'needs_user_decision' | 'runtime_lost' | 'recoverable' | string;
  reason: string;
  latest_event?: RunEvent;
  trace?: RunTrace;
};

export type RunClosureReportItem = {
  run_id: string;
  conversation_id?: string;
  status: string;
  terminal_status?: string;
  terminal_reason?: string;
  terminal_event_present: boolean;
  terminal_event_type?: string;
  task_id?: string;
  task_status?: string;
  task_evidence_summary?: string;
  has_task_evidence: boolean;
  tool_run_count: number;
  terminal_tool_event_count: number;
  memory_event_count: number;
  proactive_event_count: number;
  handoff_event_count: number;
  recovery_required: boolean;
  created_at?: string;
  updated_at?: string;
};

export type RunClosureReport = {
  items: RunClosureReportItem[];
  metrics: {
    total_runs: number;
    terminal_event_runs: number;
    execution_runs: number;
    execution_runs_with_task_or_refusal: number;
    completed_tasks: number;
    completed_tasks_with_evidence: number;
    runs_with_tool_evidence: number;
    runs_with_memory_events: number;
    runs_with_proactive_events: number;
    runs_with_handoff_events: number;
    recoverable_runs: number;
  };
};

export type ExternalHandoffLink = {
  external_channel: string;
  external_run_id: string;
  desktop_run_id: string;
  product_task_id: string;
  principal_id?: string;
  conversation_id?: string;
  external_status?: string;
  desktop_status?: string;
  external_created_at?: string;
  desktop_created_at?: string;
};

export type PendingExternalHandoff = {
  external_channel: string;
  external_run_id: string;
  product_task_id: string;
  principal_id?: string;
  conversation_id?: string;
  external_status?: string;
  external_created_at?: string;
  latest_task_status?: string;
  latest_task_title?: string;
};

export type ExternalHandoffServiceStatus = {
  enabled: boolean;
  configured: boolean;
  running: boolean;
  ready: boolean;
  label?: string;
  last_poll_at?: string;
  last_event_at?: string;
  last_update_id?: number;
  last_error?: string;
  details?: Record<string, string | number | boolean | null>;
};

export type ExternalHandoffReadiness = {
  checked: boolean;
  ok: boolean;
  credentials: Record<string, { present: boolean; source: string }>;
  checks: Record<string, ConnectionTest>;
  services: Record<string, ExternalHandoffServiceStatus>;
  missing?: string[];
  failed_checks?: string[];
  failed_services?: string[];
  error?: string;
};

export type ExternalHandoffAudit = {
  ok: boolean;
  schema_current: boolean;
  missing_schema: string[];
  external_channels_seen: string[];
  linked_live_handoffs: ExternalHandoffLink[];
  pending_external_handoffs: PendingExternalHandoff[];
  metrics: {
    external_runs: number;
    desktop_runs: number;
    linked_external_desktop_tasks: number;
  };
  readiness: ExternalHandoffReadiness;
  status: 'sqlite_missing' | 'schema_missing' | 'external_not_ready' | 'awaiting_external_input' | 'awaiting_desktop_continuation' | 'live_handoff_linked' | 'unknown';
  next_action: string;
  error?: string;
};

export type RecordNotificationOpenedRequest = {
  id: string;
  actor?: string;
  external_delivery_id?: string;
};

export type ModelCall = {
  id: string;
  provider: string;
  model_name: string;
  status: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens?: number;
  reasoning_tokens?: number;
  total_tokens?: number;
  cacheable_prefix_tokens?: number;
  dynamic_tail_tokens?: number;
  cost_estimate?: number;
  latency_ms: number;
  usage_status?: string;
  finish_reason?: string;
  prompt_cache_key?: string;
  prefix_hash?: string;
  dynamic_tail_hash?: string;
  metadata?: Record<string, unknown>;
};

export type RunTraceSpanType = 'run_event' | 'model_span' | 'tool_span' | string;

export type RunTraceSpan = {
  id: string;
  run_id: string;
  span_type: RunTraceSpanType;
  event_type: string;
  title: string;
  status: string;
  room_id?: string;
  room_title?: string;
  project_id?: string;
  project_name?: string;
  persona_id?: string;
  persona_name?: string;
  model_provider?: string;
  model_name?: string;
  tool_name?: string;
  risk_level?: string;
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
  total_tokens?: number;
  cost_estimate?: number;
  error?: string;
  has_error: boolean;
  has_external_side_effect: boolean;
  created_at?: string;
  metadata?: Record<string, unknown>;
};

export type RunTraceSpanFilter = {
  since?: string;
  until?: string;
  room_id?: string;
  project_id?: string;
  persona_id?: string;
  model_provider?: string;
  model_name?: string;
  span_type?: string;
  status?: string;
  has_error?: boolean;
  has_external_side_effect?: boolean;
  limit?: number;
};

export type RunTraceSpanSummary = {
  total: number;
  model_count: number;
  tool_count: number;
  error_count: number;
  external_side_effect_count: number;
  total_tokens: number;
  total_cost_estimate: number;
};

export type RunTrace = {
  id: string;
  conversation_id?: string;
  user_message_id?: string;
  principal_id?: string;
  entry_channel?: string;
  requested_mode?: string;
  resolved_mode?: string;
  mode_source?: string;
  terminal_status?: string;
  terminal_reason?: string;
  parent_run_id?: string;
  redirected_from_run_id?: string;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  status: string;
  selected_agent_id: string;
  route_result?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  model_calls?: ModelCall[];
  prompt_assemblies?: Array<{ id: string; prefix_hash: string; dynamic_tail_hash: string; prompt_cache_key: string }>;
  memory_context_packs?: Array<{ id: string; memory_profile_version: string; dynamic_retrieval?: MemorySearchResult[] }>;
  events?: RunEvent[];
  steps?: Array<{
    id: string;
    run_id?: string;
    step_type: string;
    title: string;
    status: string;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
    error?: Record<string, unknown>;
    started_at?: string;
    finished_at?: string;
    duration_ms?: number;
    created_at?: string;
  }>;
};

export type RunEvent = {
  id: string;
  run_id: string;
  turn_id?: string;
  schema_version?: number;
  conversation_id?: string;
  seq: number;
  event_type: string;
  type?: string;
  item_id?: string;
  item_type?: string;
  parent_item_id?: string;
  status?: string;
  phase?: string;
  visibility?: string;
  source?: string;
  level?: LogLevel;
  risk_level?: LogRiskLevel;
  category?: string;
  feature_key?: string;
  message?: string;
  terminal?: boolean;
  title?: string;
  summary?: string;
  payload?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  delta?: Record<string, unknown> | string;
  usage?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  error?: string;
  created_at?: string;
};

export type ConversationSummary = {
  id: string;
  principal_id?: string;
  channel: string;
  user_id: string;
  title: string;
  active_agent_id?: string;
  topic?: string;
  group_id?: string;
  lifecycle_status?: 'active' | 'archived' | 'trashed' | 'purged' | string;
  pinned?: boolean;
  last_message?: string;
  last_role?: string;
  latest_run_id?: string;
  message_count: number;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  archived_at?: string;
  trashed_at?: string;
  purge_after?: string;
  restored_at?: string;
};

export type ConversationFilter = {
  view?: 'active' | 'archived' | 'trash' | 'all' | 'purged' | string;
  group_id?: string;
  query?: string;
  limit?: number;
};

export type ConversationActionRequest = {
  id: string;
  reason?: string;
  group_id?: string;
};

export type ConversationActionResponse = {
  conversation: ConversationSummary;
};

export type ConversationGroup = {
  id: string;
  name: string;
  sort_order: number;
  collapsed: boolean;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type ConversationGroupRequest = {
  id?: string;
  name: string;
  sort_order?: number;
  collapsed?: boolean;
  metadata?: Record<string, unknown>;
};

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | string;
  content: string;
  run_id?: string;
  attachments?: unknown[];
  metadata?: Record<string, unknown>;
  created_at?: string;
};

export type ConversationDetail = {
  conversation: ConversationSummary;
  messages: ConversationMessage[];
};

export type ConversationCompactionRecord = {
  id: string;
  conversation_id: string;
  source_run_id?: string;
  summary: string;
  first_kept_message_id?: string;
  covered_message_count: number;
  original_message_count: number;
  original_char_count: number;
  compacted_context_char_count: number;
  reason: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
};

export type ConversationTreeNode = {
  conversation_id: string;
  title: string;
  label?: string;
  summary?: string;
  parent_conversation_id?: string;
  branch_id?: string;
  from_message_id?: string;
  source_run_id?: string;
  copied_message_count: number;
  message_count: number;
  child_count: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
  latest_compaction?: ConversationCompactionRecord;
  children: ConversationTreeNode[];
};

export type ConversationTree = {
  root_conversation_id: string;
  active_conversation_id: string;
  node_count: number;
  root: ConversationTreeNode;
};

export type UpdateConversationBranchRequest = {
  conversation_id: string;
  label?: string;
  summary?: string;
};

export type CreateConversationBranchRequest = {
  source_conversation_id: string;
  from_message_id?: string;
  title?: string;
  source_run_id?: string;
};

export type ConversationBranchResult = {
  source_conversation_id: string;
  child_conversation_id: string;
  from_message_id: string;
  copied_message_count: number;
  source_message_count: number;
  source_unchanged: true;
};

export type CompactConversationRequest = {
  conversation_id: string;
  summary: string;
  keep_recent_messages?: number;
  reason?: string;
  source_run_id?: string;
};

export type CompactConversationResult = {
  compaction_id: string;
  conversation_id: string;
  summary: string;
  first_kept_message_id: string;
  covered_message_count: number;
  original_message_count: number;
  original_char_count: number;
  compacted_context_char_count: number;
  transcript_preserved: true;
};

export type ConversationExportResult = {
  path: string;
  conversation_id: string;
  branch_count: number;
  message_count: number;
};

export type ConversationImportResult = {
  conversation_id: string;
  imported_conversation_ids: string[];
  message_count: number;
};

export type CapabilityRecord = {
  id: string;
  name: string;
  description: string;
  risk_level: string;
  enabled: boolean;
  metadata?: Record<string, unknown>;
};

export type MCPToolRecord = {
  name: string;
  description: string;
  wrapped_as?: string;
  enabled: boolean;
  schema?: Record<string, unknown>;
};

export type MCPResourceRecord = {
  uri: string;
  name: string;
  description: string;
  mime_type: string;
};

export type MCPPromptRecord = {
  name: string;
  description: string;
  arguments?: string[];
};

export type MCPServerRecord = {
  id: string;
  name: string;
  transport: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
  status: string;
  trust: string;
  last_sync_at?: string;
  last_sync_error?: string;
  tools: MCPToolRecord[];
  resources: MCPResourceRecord[];
  prompts: MCPPromptRecord[];
  metadata?: Record<string, unknown>;
};

export type MCPServerConfigRequest = {
  id: string;
  name: string;
  transport?: 'stdio' | 'streamable_http' | 'sse' | string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
  trust?: string;
  metadata?: Record<string, unknown>;
};

export type MCPToolCallRequest = {
  server_id: string;
  tool_name: string;
  input?: Record<string, unknown>;
  timeout_ms?: number;
};

export type MCPToolCallResult = {
  server_id: string;
  tool_name: string;
  content: unknown[];
  structured_content?: Record<string, unknown>;
  is_error: boolean;
  duration_ms: number;
};

export type MCPWrapToolRequest = {
  capability_id?: string;
  description: string;
  intent_domain: string;
  positive_examples: string[];
  negative_examples: string[];
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  risk_level: string;
  privacy_level: string;
  ui_visibility: string;
  enabled?: boolean;
};

export type SkillRecord = {
  id: string;
  version: string;
  name: string;
  description: string;
  trigger_phrases: string[];
  required_capabilities: string[];
  forbidden_capabilities: string[];
  output_contract: string;
  enabled: boolean;
  metadata?: Record<string, unknown>;
  recent_run?: Record<string, unknown>;
};

export type SkillDetailRecord = {
  skill: SkillRecord;
  instructions: string;
  frontmatter: Record<string, unknown>;
  openai: Record<string, unknown>;
};

export type PluginRecord = {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  status: string;
  manifest_path?: string;
  capability_ids: string[];
  skill_ids: string[];
  mcp_server_ids: string[];
  provider_ids: string[];
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type PluginProviderConfig = {
  id: string;
  name: string;
  protocol: 'acp' | string;
  command: string;
  args: string[];
  runtime?: 'node' | 'binary' | string;
  env?: Record<string, string>;
  default_model?: string;
  models?: Array<{ id: string; name?: string }>;
  auth_method?: string;
  description?: string;
  plugin_id?: string;
  plugin_root?: string;
};

export type PluginInstallFromGitHubRequest = {
  source: string;
  ref?: string;
};

export type PluginProviderTestResult = {
  ok: boolean;
  status: string;
  provider_id: string;
  protocol?: string;
  command?: string;
  agent_name?: string;
  agent_version?: string;
  protocol_version?: number;
  current_model?: string;
  models?: Array<{ id: string; name?: string }>;
  error_summary?: string;
};

export type ToolWorkflowStep = {
  tool: string;
  args?: Record<string, unknown>;
  risk_level: string;
};

export type ToolWorkflowRecord = {
  id: string;
  capability_id: string;
  name: string;
  version: string;
  risk_level: string;
  steps: ToolWorkflowStep[];
  enabled: boolean;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type ToolRunRecord = {
  id: string;
  run_id?: string;
  task_id?: string;
  capability_id?: string;
  workflow_name?: string;
  tool_id?: string;
  tool_name: string;
  node_id?: string;
  assignment_reason?: string;
  risk_level: string;
  status: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: Record<string, unknown>;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  created_at?: string;
};

export type WorkspaceSettings = {
  allowed_roots: string[];
  default_root: string;
  browser_allowed_hosts: string[];
  web_research_allow_private_hosts: boolean;
  web_search_provider?: 'auto' | 'brave' | 'duckduckgo' | string;
  brave_search_api_key?: string;
  brave_search_api_key_configured?: boolean;
  file_analyze_max_bytes: number;
  workspace_search_max_results: number;
  browser_enabled?: boolean;
  github_default_repo?: string;
  github_api_base_url?: string;
  node_assignment_policy?: 'main_first' | 'auto' | 'manual' | string;
  allow_remote_execution?: boolean;
  privacy_local_only?: boolean;
  remote_execution_requires_confirmation?: boolean;
  diagnostic_redaction_enabled?: boolean;
  destructive_operations_disabled?: boolean;
  desktop_notifications_enabled?: boolean;
  desktop_notification_sound?: boolean;
  cli_enabled?: boolean;
  cli_socket_path?: string;
  webhook_chat_enabled?: boolean;
  webhook_chat_path?: string;
  wechat_claw_enabled?: boolean;
  wechat_claw_endpoint?: string;
  wechat_claw_allowed_senders?: string[];
};

export type GitHubConnectionResult = {
  status: 'ok' | 'missing_secret' | 'invalid_config' | 'error' | string;
  api_base_url: string;
  login?: string;
  repository?: string;
  rate_limit_remaining?: number;
  error_summary?: string;
};

export type SystemHealth = {
  service_status?: Record<string, unknown>;
  queue_status?: Record<string, unknown>;
  worker_status?: NodeRecord[];
  model_latency?: Record<string, unknown>;
  tool_failure_rate?: Record<string, unknown>;
  token_cost_today?: Record<string, unknown>;
  warnings?: unknown[];
};

export type MemoryRecord = {
  id: string;
  layer?: 'profile' | 'knowledge' | 'state' | 'episode' | string;
  type: string;
  memory_key?: string;
  content: string;
  summary: string;
  scope_type?: string;
  scope_id?: string;
  privacy_level?: string;
  evidence_kind?: string;
  evidence_authority?: number;
  evidence_count?: number;
  status: string;
  lifecycle_state?: string;
  confidence: number;
  pinned: boolean;
  disabled?: boolean;
  disabled_at?: string;
  usage_count: number;
  success_count: number;
  failure_count: number;
  positive_feedback: number;
  negative_feedback: number;
  source_event_ids?: string[];
  source_kind?: string;
  entities?: string[];
  context_tags?: string[];
  merged_into_memory_id?: string;
  supersedes_memory_id?: string;
  conflict_group_id?: string;
  conflict_reason?: string;
  review_reason?: string;
  valid_from?: string;
  valid_until?: string;
  last_verified_at?: string;
  archived_at?: string;
  auto_managed?: boolean;
  retention_policy?: string;
  recent_usage?: MemoryUsageLog[];
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  last_used_at?: string;
};

export type MemoryUsageLog = {
  id: string;
  run_id: string;
  agent_id: string;
  retrieval_score: number;
  normalized_score?: number;
  recalled?: boolean;
  injected: boolean;
  used_in_answer: boolean;
  influence_state?: 'unknown' | 'not_used' | 'inferred_used' | 'explicitly_used' | string;
  rank?: number;
  pipeline_version?: string;
  outcome: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
};

export type MemorySearchResult = {
  memory: MemoryRecord;
  score: number;
  reason: string;
  retrieval_source?: 'fts' | 'governance' | string;
  matched_terms?: string[];
  scope_match?: 'global' | 'user' | 'room' | 'project' | string;
  injected?: boolean;
  used_in_answer?: boolean;
  influence_state?: string;
  score_components?: Record<string, number>;
};

export type MemoryQualityMetrics = {
  confirmed_count: number;
  candidate_count: number;
  old_candidate_count: number;
  stale_confirmed_count: number;
  duplicate_candidate_count: number;
  recalled_count: number;
  injected_count: number;
  used_in_answer_count: number;
  unused_injection_count: number;
  positive_feedback_count: number;
  negative_feedback_count: number;
  injection_use_rate: number;
  scope_counts: Record<string, number>;
  layer_counts?: Record<string, number>;
  inferred_used_count?: number;
  abstention_count?: number;
  archived_count?: number;
  observed_count?: number;
  embedding_count?: number;
  generation_queue_count?: number;
  oldest_candidate_at?: string;
};

export type MemorySettingsRecord = {
  use_memories: boolean;
  generate_memories: boolean;
  disable_on_external_context: boolean;
  background_idle_seconds: number;
  pipeline_version: string;
};

export type MemoryMaintenanceRun = {
  id: string;
  status: string;
  trigger_source: string;
  processed_input_count: number;
  generated_observation_count: number;
  expired_count: number;
  merged_count: number;
  embedding_count: number;
  error_summary?: string;
  metadata?: Record<string, unknown>;
  started_at?: string;
  finished_at?: string;
};

export type MemorySystemSnapshot = {
  settings: MemorySettingsRecord;
  latest_maintenance?: MemoryMaintenanceRun;
  metrics: MemoryQualityMetrics;
};

export type MemoryCandidateFilter = {
  status?: string;
  limit?: number;
};

export type MemoryCandidateDecisionRequest = {
  id: string;
  decision: 'confirm' | 'correct' | 'reject' | 'delete' | string;
  run_id?: string;
  comment?: string;
  reason?: string;
  content?: string;
  summary?: string;
};

export type MemoryCorrectionRequest = {
  id: string;
  content: string;
  summary?: string;
  run_id?: string;
  comment?: string;
  reason?: string;
};

export type MemoryDeleteRequest = {
  id: string;
  run_id?: string;
  reason?: string;
  comment?: string;
};

export type ProductTask = {
  id: string;
  principal_id?: string;
  title: string;
  description: string;
  status: string;
  mode: InputMode | string;
  priority: string;
  created_from_conversation_id?: string;
  created_from_message_id?: string;
  latest_run_id?: string;
  owner_user_id?: string;
  source_channel?: string;
  risk_level: string;
  progress_percent: number;
  current_step_id?: string;
  summary?: string;
  source_conversation_id?: string;
  source_run_id?: string;
  source_turn_id?: string;
  mode_resolution_id?: string;
  terminal_status?: string;
  terminal_reason?: string;
  evidence_summary?: string;
  verification_status?: string;
  last_projected_at?: string;
  metadata?: Record<string, unknown>;
  task_contract?: TaskContract;
  verification?: TaskVerification;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
};

export type ProductTaskStep = {
  id: string;
  product_task_id: string;
  title: string;
  description?: string;
  status: string;
  sort_order: number;
  capability_id?: string;
  tool_workflow_id?: string;
  run_id?: string;
  tool_run_id?: string;
  worker_task_id?: string;
  summary?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: Record<string, unknown>;
  started_at?: string;
  finished_at?: string;
  created_at?: string;
  updated_at?: string;
};

export type ProductTaskDetail = {
  task: ProductTask;
  steps: ProductTaskStep[];
  deliverables: ArtifactSummary[];
};

export type ProductTaskFilter = {
  status?: string;
  limit?: number;
  conversation_id?: string;
  principal_id?: string;
  channel?: string;
};

export type ProductTaskCloseRequest = {
  id: string;
  outcome?: 'completed' | 'completed_with_limitations' | 'blocked' | 'failed' | 'cancelled' | string;
  reason?: string;
  actor?: string;
  run_id?: string;
};

export type ProductTaskReopenRequest = {
  id: string;
  reason?: string;
  actor?: string;
  run_id?: string;
};

export type ArtifactSummary = {
  id: string;
  type: string;
  title: string;
  content_format: string;
  source_product_task_id?: string;
  source_run_id?: string;
  source_conversation_id?: string;
  source_message_id?: string;
  version: number;
  status: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type ArtifactDetail = ArtifactSummary & {
  content: string;
  linked_memory_ids?: string[];
};

export type OpenLoop = {
  id: string;
  topic: string;
  description?: string;
  status: string;
  source_conversation_id?: string;
  source_run_id?: string;
  source_product_task_id?: string;
  suggested_followup?: string;
  priority: string;
  due_at?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
};

export type ProactiveMessage = {
  id: string;
  type: string;
  title: string;
  body: string;
  reason: string;
  source_memory_ids?: string[];
  source_open_loop_id?: string;
  source_product_task_id?: string;
  score: number;
  status: string;
  channel: string;
  send_after?: string;
  expires_at?: string;
  feedback?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  sent_at?: string;
};

export type ReflectionResult = {
  conversation_type: string;
  importance: string;
  should_create_task: boolean;
  memory_candidates?: MemoryRecord[];
  task_candidates?: Array<{ title: string; description: string; priority: string; mode: string; suggested_steps?: ProductTaskStep[] }>;
  open_loops?: OpenLoop[];
  proactive_opportunities?: ProactiveMessage[];
  product_task?: ProductTask;
};

export type NodeRecord = {
  id: string;
  name: string;
  role: string;
  status: string;
  capabilities?: unknown[];
  auto_assign_enabled: boolean;
  manual_assign_enabled: boolean;
  metadata?: Record<string, unknown>;
};

export type WorkerGatewayAuditRecord = {
  id: string;
  node_id: string;
  action: string;
  status: string;
  reason: string;
  metadata?: Record<string, unknown>;
};

export type ConfirmationRecord = {
  id: string;
  run_id: string;
  capability_id: string;
  requested_action: string;
  risk_level: string;
  status: string;
  input?: Record<string, unknown>;
  call_id?: string;
  turn_id?: string;
  approval_scope?: string;
  approval_key?: string;
  operation_id?: string;
  affected_paths?: string[];
  external_target?: string;
  reversible?: boolean;
  approved_by?: string;
  rejected_by?: string;
  decision_reason?: string;
  created_at?: string;
  decided_at?: string;
  resumed_at?: string;
};

export type BackupRecord = {
  path: string;
  name: string;
  size: number;
  modified: string;
  manifest?: Record<string, unknown>;
};

export type SettingsRecord = {
  version: string;
  app_mode: string;
  data_store: string;
  task_queue: string;
  sqlite_path: string;
  log_dir?: string;
  model_provider: string;
  model_name: string;
  model_reasoning_name?: string;
  model_reasoning_effort?: string;
  model_base_url: string;
  model_timeout_seconds?: number;
  model_max_retries?: number;
  telegram_enabled: boolean;
  telegram_allowed_user_ids?: string;
  imessage_enabled: boolean;
  imessage_allowed_users?: string;
  imessage_require_mention?: boolean;
  imessage_operator_phone?: string;
  imessage_assigned_number?: string;
  imessage_project_id?: string;
  imessage_home_channel?: string;
  imessage_sidecar_port?: number;
  worker_gateway: string;
  worker_gateway_enabled?: boolean;
  backup_dir: string;
  auto_backup_enabled?: boolean;
  docker_required: boolean;
};

export type SecretStatus = {
  secrets: Record<string, boolean>;
};

export type ConnectionTest = {
  ok: boolean;
  status: string;
  error_summary?: string;
  available_models?: AvailableModel[];
};

export type AvailableModel = {
  provider?: string;
  base_url?: string;
  id: string;
  display_name?: string;
  owner?: string;
  object?: string;
  created?: string;
  context_window?: number;
  max_output_tokens?: number;
  input_price_per_1m?: number;
  output_price_per_1m?: number;
  cached_input_price_per_1m?: number;
  supports_json_mode?: boolean;
  supports_tool_calling?: boolean;
  supports_reasoning?: boolean;
  supported_parameters?: string[];
  config?: ModelRuntimeConfig;
  metadata?: Record<string, unknown>;
};

export type ModelRuntimeConfig = {
  role?: string;
  enabled: boolean;
  temperature: number;
  max_output_tokens?: number;
  timeout_seconds: number;
  max_retries: number;
  supports_json_mode: boolean;
  supports_tool_calling: boolean;
  supports_reasoning: boolean;
};

export type ModelSettingsRequest = ModelRuntimeConfig & {
  provider: string;
  base_url: string;
  model_id: string;
  display_name?: string;
};

export type AgentModelPolicy = {
  agent_id: string;
  default_model_id?: string;
  fallback_model_ids: string[];
  cheap_model_id?: string;
  child_model_id?: string;
  tool_model_id?: string;
  long_context_model_id?: string;
  reasoning_effort?: string;
  max_failovers: number;
  enabled: boolean;
  metadata?: Record<string, unknown>;
  updated_at?: string;
};

export type AgentModelPolicyRequest = AgentModelPolicy;

export type BrowserWorkbenchAction =
  | 'open'
  | 'close'
  | 'list_tabs'
  | 'new_tab'
  | 'activate_tab'
  | 'close_tab'
  | 'navigate'
  | 'back'
  | 'forward'
  | 'reload'
  | 'observe'
  | 'click'
  | 'type'
  | 'press'
  | 'scroll'
  | 'upload'
  | 'screenshot'
  | 'vision'
  | 'get_images'
  | 'console'
  | 'network'
  | 'dialog'
  | 'evaluate'
  | 'cdp';

export type BrowserWorkbenchRequest = {
  action: BrowserWorkbenchAction | string;
  session_id?: string;
  tab_id?: number;
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
  delta_x?: number;
  delta_y?: number;
  paths?: string[];
  expression?: string;
  method?: string;
  params?: Record<string, unknown>;
  timeout_ms?: number;
  visible?: boolean;
};

export type BrowserWorkbenchResult = {
  session_id: string;
  action: string;
  active_tab_id?: number;
  url?: string;
  title?: string;
  text?: string;
  screenshot_path?: string;
  tabs?: Array<{ id: number; title: string; url: string; active: boolean }>;
  console?: Array<Record<string, unknown>>;
  network?: Array<Record<string, unknown>>;
  images?: Array<Record<string, unknown>>;
  result?: unknown;
};

export type DeveloperWorkbenchRequest = {
  action: string;
  input?: Record<string, unknown>;
  permission_profile?: PermissionProfile | string;
};

export type DeveloperWorkbenchResult = {
  action: string;
  output: Record<string, unknown>;
};

export type MediaWorkbenchRequest = {
  action: 'save_recording' | 'text_to_speech' | 'speech_transcribe' | 'analyze_image' | 'analyze_video' | 'generate_video' | string;
  path?: string;
  data_url?: string;
  mime_type?: string;
  text?: string;
  prompt?: string;
  voice?: string;
  language?: string;
  model?: string;
  format?: string;
  rate?: number;
  duration_seconds?: number;
  aspect_ratio?: string;
  resolution?: string;
  transcribe?: boolean;
};

export type MediaWorkbenchResult = {
  action: string;
  output: Record<string, unknown>;
};

export type AssistantActivitySession = {
  id: string;
  status: string;
  title: string;
  started_at?: string;
  ended_at?: string;
  event_count: number;
  summary?: string;
  metadata?: Record<string, unknown>;
};

export type AssistantActivityEvent = {
  id: string;
  session_id: string;
  event_type: string;
  app_name?: string;
  window_title?: string;
  text?: string;
  screenshot_path?: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
};

export type AssistantCalendarItem = {
  id: string;
  title: string;
  start_at: string;
  end_at?: string;
  status: string;
  source: string;
  notes?: string;
  external_id?: string;
  metadata?: Record<string, unknown>;
};

export type AssistantPlanNode = {
  id: string;
  plan_id: string;
  title: string;
  status: string;
  parent_id?: string;
  depends_on: string[];
  evidence: Array<Record<string, unknown>>;
  sort_order: number;
  metadata?: Record<string, unknown>;
};

export type AssistantPlan = {
  id: string;
  title: string;
  objective: string;
  status: string;
  conversation_id?: string;
  nodes: AssistantPlanNode[];
  review_summary?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
};

export type AssistantChannel = {
  id: string;
  provider: string;
  name: string;
  status: string;
  enabled: boolean;
  configured: boolean;
  last_sync_at?: string;
  metadata?: Record<string, unknown>;
};

export type AssistantWorkspaceSnapshot = {
  capture: { active: boolean; session_id?: string; interval_seconds: number };
  activity_sessions: AssistantActivitySession[];
  recent_activity: AssistantActivityEvent[];
  calendar: AssistantCalendarItem[];
  plans: AssistantPlan[];
  channels: AssistantChannel[];
};

export type AssistantActionRequest = {
  action: string;
  id?: string;
  session_id?: string;
  conversation_id?: string;
  title?: string;
  objective?: string;
  text?: string;
  start_at?: string;
  end_at?: string;
  interval_seconds?: number;
  provider?: string;
  enabled?: boolean;
  path?: string;
  data_url?: string;
  metadata?: Record<string, unknown>;
};

export type AssistantActionResult = {
  ok: boolean;
  action: string;
  item?: unknown;
  path?: string;
  text?: string;
  snapshot?: AssistantWorkspaceSnapshot;
};

export type OnboardingStatus = {
  required: boolean;
  completed: boolean;
  model_configured: boolean;
  telegram_configured: boolean;
  worker_configured: boolean;
  first_backup_created: boolean;
  backup_count: number;
  missing?: string[];
};

export type ModelConfigRequest = {
  provider: string;
  base_url: string;
  name: string;
  reasoning_name?: string;
  reasoning_effort?: string;
  timeout_seconds?: number;
  max_retries?: number;
};

export type ModelConnectionTestRequest = ModelConfigRequest & {
  api_key?: string;
};

export type XAIOAuthLoginResult = {
  status: 'succeeded';
  provider: 'xai_oauth' | 'grok_build';
  base_url: string;
  model_name: string;
  last_refresh: string;
  source: string;
  scope: string;
  expires_at?: string;
};

export type PhotonIMessageSetupRequest = {
  phone_number?: string;
  project_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  timeout_seconds?: number;
};

export type PhotonIMessageSetupResult = {
  status: 'succeeded';
  project_id: string;
  operator_phone?: string;
  assigned_number?: string;
  project_created: boolean;
  user_created: boolean;
};

export type PhotonIMessageStatus = {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  sidecar_running: boolean;
  sidecar_port?: number;
  project_id?: string;
  operator_phone?: string;
  assigned_number?: string;
  allowed_users?: string;
  require_mention?: boolean;
  last_error?: string;
};

export type TelegramInboundStatus = {
  enabled: boolean;
  configured: boolean;
  polling: boolean;
  allowed_user_ids_configured: boolean;
  active_runs: number;
  last_poll_at?: string;
  last_update_id?: number;
  last_error?: string;
};

export type TerminalSessionStatus = 'starting' | 'running' | 'exited' | 'failed';

export type TerminalSessionInfo = {
  id: string;
  shell: string;
  cwd: string;
  status: TerminalSessionStatus;
  pid?: number;
  cols: number;
  rows: number;
  started_at?: string;
  exited_at?: string;
  exit_code?: number;
  signal?: number;
  error?: string;
};

export type TerminalSessionSnapshot = {
  session?: TerminalSessionInfo;
  output: string;
};

export type TerminalSessionStartRequest = {
  id?: string;
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
};

export type TerminalSessionInputRequest = {
  id: string;
  data: string;
};

export type TerminalSessionResizeRequest = {
  id: string;
  cols: number;
  rows: number;
};

export type TerminalSessionKillRequest = {
  id: string;
};

export type TerminalSessionEvent = {
  id: string;
  type: 'output' | 'status' | 'exit' | 'error';
  data?: string;
  session?: TerminalSessionInfo;
  error?: string;
};

export type ModelListRequest = {
  provider?: string;
  base_url?: string;
};

export type DesktopBindings = {
  SendChat(req: ChatRequest): Promise<ChatResponse>;
  ListPersonaMessenger(): Promise<PersonaMessengerSnapshot>;
  GenerateProjectPersonaCandidates(req: GenerateProjectPersonaCandidatesRequest): Promise<{ candidates: PersonaCandidate[] }>;
  CreateProjectPersona(req: CreateProjectPersonaRequest): Promise<{ project: MessengerProject; persona: ProjectPersona; room: MessengerRoom }>;
  UpdateProjectPersona(req: UpdateProjectPersonaRequest): Promise<ProjectPersona>;
  RollbackProjectPersona(req: RollbackProjectPersonaRequest): Promise<ProjectPersona>;
  CreateSharedRoom(req: CreateSharedRoomRequest): Promise<{ room: MessengerRoom }>;
  UpdateMessengerRoom(req: UpdateMessengerRoomRequest): Promise<{ room: MessengerRoom }>;
  UpdateMessengerProject(req: UpdateMessengerProjectRequest): Promise<{ project: MessengerProject }>;
  ConnectExternalMirrorRoom(req: ConnectExternalMirrorRoomRequest): Promise<{ connector: RoomConnector; room: MessengerRoom }>;
  RecordExternalConnectorInbound(req: RecordExternalConnectorInboundRequest): Promise<{ event: ExternalConnectorEvent; room: MessengerRoom; message_id?: string; duplicate: boolean }>;
  RecordExternalConnectorOutbound(req: RecordExternalConnectorOutboundRequest): Promise<{ event: ExternalConnectorEvent; room: MessengerRoom; message_id: string; duplicate: boolean }>;
  PreviewExternalPersonaMessage(req: PreviewExternalPersonaMessageRequest): Promise<{ text: string; controls: string[]; persona_id: string; room_id: string }>;
  RecordExternalConnectorFailure(req: RecordExternalConnectorFailureRequest): Promise<{ event: ExternalConnectorEvent }>;
  RetryExternalConnectorEvent(req: RetryExternalConnectorEventRequest): Promise<{ event: ExternalConnectorEvent }>;
  SetRouteLock(req: SetRouteLockRequest): Promise<{ route_lock: RouteLock | null }>;
  CompleteCheckpoint(req: CompleteCheckpointRequest): Promise<CheckpointSummary>;
  RecordRoutingFeedback(req: RoutingFeedbackRequest): Promise<void>;
  ExportPersonaMessengerData(req?: PersonaMessengerExportRequest): Promise<PersonaMessengerExportResult>;
  EvaluateRoomPermissions(req: EvaluateRoomPermissionsRequest): Promise<RoomPermissionAudit>;
  ListAutomations(filter?: { kind?: AutomationKind; enabled?: boolean; limit?: number }): Promise<{ automations: AutomationDefinition[] }>;
  GetAutomation(id: string): Promise<AutomationDefinition>;
  SaveAutomation(req: AutomationDefinitionRequest): Promise<AutomationDefinition>;
  DeleteAutomation(id: string): Promise<void>;
  SetAutomationEnabled(req: { id: string; enabled: boolean }): Promise<AutomationDefinition>;
  TriggerAutomationNow(req: AutomationTriggerNowRequest): Promise<{ trigger: AutomationTriggerRecord }>;
  ListAutomationTriggers(filter?: { automation_id?: string; status?: string; limit?: number }): Promise<{ triggers: AutomationTriggerRecord[] }>;
  ListAutomationRuns(filter?: { automation_id?: string; trigger_id?: string; limit?: number }): Promise<{ runs: AutomationRunRecord[] }>;
  SetAutomationRunRead(req: AutomationRunReadRequest): Promise<AutomationRunRecord>;
  MarkAllAutomationRunsRead(req?: { automation_id?: string }): Promise<{ updated: number }>;
  SetAutomationRunArchived(req: AutomationRunArchiveRequest): Promise<AutomationRunRecord>;
  ArchiveAllAutomationRuns(req: { automation_id: string }): Promise<{ succeeded_count: number; failed_count: number }>;
  GetAutomationWebhookEndpoint(id: string): Promise<AutomationWebhookEndpoint>;
  RotateAutomationWebhookSecret(id: string): Promise<AutomationWebhookEndpoint>;
  TestAutomationWebhook(req: AutomationWebhookTestRequest): Promise<{ trigger: AutomationTriggerRecord }>;
  GetRunTrace(runID: string): Promise<RunTrace>;
  ListRunTraceSpans(filter?: RunTraceSpanFilter): Promise<{ spans: RunTraceSpan[]; summary: RunTraceSpanSummary }>;
  ListConversations(filter: ConversationFilter): Promise<{ conversations: ConversationSummary[] }>;
  GetConversation(conversationID: string): Promise<ConversationDetail>;
  GetConversationForMessage(messageID: string): Promise<ConversationDetail>;
  GetConversationTree(conversationID: string): Promise<ConversationTree>;
  CreateConversationBranch(req: CreateConversationBranchRequest): Promise<ConversationBranchResult>;
  CompactConversation(req: CompactConversationRequest): Promise<CompactConversationResult>;
  UpdateConversationBranch(req: UpdateConversationBranchRequest): Promise<ConversationTree>;
  ExportConversation(req: { conversation_id: string; path?: string }): Promise<ConversationExportResult>;
  ImportConversation(req: { path: string }): Promise<ConversationImportResult>;
  ListConversationGroups(): Promise<{ groups: ConversationGroup[] }>;
  SaveConversationGroup(req: ConversationGroupRequest): Promise<ConversationGroup>;
  DeleteConversationGroup(id: string): Promise<void>;
  MoveConversationToGroup(req: ConversationActionRequest): Promise<ConversationActionResponse>;
  ArchiveConversation(req: ConversationActionRequest): Promise<ConversationActionResponse>;
  TrashConversation(req: ConversationActionRequest): Promise<ConversationActionResponse>;
  RestoreConversation(req: ConversationActionRequest): Promise<ConversationActionResponse>;
  PurgeConversation(req: ConversationActionRequest): Promise<ConversationActionResponse>;
  ListCapabilities(): Promise<{ capabilities: CapabilityRecord[] }>;
  SetCapabilityEnabled(req: { id: string; enabled: boolean }): Promise<void>;
  ListMCPServers(): Promise<{ servers: MCPServerRecord[] }>;
  SaveMCPServer(req: MCPServerConfigRequest): Promise<{ server: MCPServerRecord }>;
  DeleteMCPServer(id: string): Promise<void>;
  SetMCPServerEnabled(req: { id: string; enabled: boolean }): Promise<{ server: MCPServerRecord }>;
  SyncMCPServer(id: string): Promise<{ server: MCPServerRecord }>;
  WrapMCPTool(serverID: string, toolName: string, req: MCPWrapToolRequest): Promise<{ capability: CapabilityRecord }>;
  InvokeMCPTool(req: MCPToolCallRequest): Promise<MCPToolCallResult>;
  ListSkills(): Promise<{ skills: SkillRecord[] }>;
  ReloadSkills(): Promise<{ skills: SkillRecord[]; discovered_count: number; removed_count: number }>;
  GetSkill(id: string): Promise<SkillDetailRecord>;
  SetSkillEnabled(req: { id: string; enabled: boolean }): Promise<void>;
  TestGitHubConnection(): Promise<GitHubConnectionResult>;
  ListPlugins(): Promise<{ plugins: PluginRecord[] }>;
  InstallPluginFromManifest(path: string): Promise<{ plugin: PluginRecord }>;
  InstallPluginFromGitHub(req: PluginInstallFromGitHubRequest): Promise<{ plugin: PluginRecord }>;
  TestPluginProvider(req: { plugin_id: string; provider_id?: string }): Promise<PluginProviderTestResult>;
  SetPluginEnabled(req: { id: string; enabled: boolean }): Promise<{ plugin: PluginRecord }>;
  RemovePlugin(id: string): Promise<void>;
  ListToolWorkflows(): Promise<{ workflows: ToolWorkflowRecord[] }>;
  ListToolRuns(): Promise<{ tool_runs: ToolRunRecord[] }>;
  SetToolWorkflowEnabled(req: { name: string; enabled: boolean }): Promise<void>;
  GetSystemHealth(): Promise<SystemHealth>;
  ListMemories(filter: { query?: string; limit?: number }): Promise<{ memories: MemoryRecord[]; metrics: MemoryQualityMetrics }>;
  GetMemorySystem(): Promise<MemorySystemSnapshot>;
  SaveMemorySettings(req: Partial<MemorySettingsRecord>): Promise<MemorySettingsRecord>;
  RunMemoryMaintenance(req?: { trigger_source?: string }): Promise<{ run: MemoryMaintenanceRun }>;
  UpdateMemory(req: { id: string; action: string; feedback?: string; comment?: string; target_id?: string; reason?: string; content?: string; summary?: string; scope_type?: string; run_id?: string }): Promise<void>;
  ListMemoriesUsedForRun(runID: string): Promise<{ memories: MemorySearchResult[] }>;
  ListMemoryCandidates(filter: MemoryCandidateFilter): Promise<{ memories: MemoryRecord[] }>;
  DecideMemoryCandidate(req: MemoryCandidateDecisionRequest): Promise<void>;
  CorrectMemory(req: MemoryCorrectionRequest): Promise<void>;
  DeleteMemory(req: MemoryDeleteRequest): Promise<void>;
  ListUserStates(filter?: { limit?: number }): Promise<{ memories: MemoryRecord[] }>;
  ListRelationshipStates(filter?: { limit?: number }): Promise<{ memories: MemoryRecord[] }>;
  ListProductTasks(filter: ProductTaskFilter): Promise<{ tasks: ProductTask[] }>;
  ListProductTasksByConversation(conversationID: string): Promise<{ tasks: ProductTask[] }>;
  ListProductTasksByPrincipal(principalID: string): Promise<{ tasks: ProductTask[] }>;
  GetProductTask(id: string): Promise<ProductTaskDetail>;
  CloseProductTask(req: ProductTaskCloseRequest): Promise<ProductTaskDetail>;
  ReopenProductTask(req: ProductTaskReopenRequest): Promise<ProductTaskDetail>;
  ListArtifacts(filter: { product_task_id?: string; type?: string; limit?: number }): Promise<{ artifacts: ArtifactSummary[] }>;
  GetArtifact(id: string): Promise<ArtifactDetail>;
  ListOpenLoops(filter: { status?: string; limit?: number }): Promise<{ open_loops: OpenLoop[] }>;
  DecideOpenLoop(req: { id: string; action: string; feedback?: string; due_at?: string }): Promise<void>;
  ListProactiveMessages(filter: { status?: string; limit?: number }): Promise<{ messages: ProactiveMessage[] }>;
  DecideProactiveMessage(req: { id: string; action: string; feedback?: string }): Promise<void>;
  RecordNotificationOpened(req: RecordNotificationOpenedRequest): Promise<void>;
  ListNodes(): Promise<{ nodes: NodeRecord[] }>;
  DisableNode(nodeID: string): Promise<void>;
  EnableNode(nodeID: string): Promise<void>;
  ListWorkerGatewayAuditLogs(): Promise<{ items: WorkerGatewayAuditRecord[] }>;
  GetModelUsage(): Promise<{ items: Record<string, unknown>[] }>;
  ListConfirmations(): Promise<{ items: ConfirmationRecord[] }>;
  DecideConfirmation(req: { id: string; approve: boolean; actor?: string; reason?: string; scope?: 'one_call' | 'current_run' | string }): Promise<void>;
  ListPendingApprovals(): Promise<{ items: ConfirmationRecord[] }>;
  DecideApproval(req: ApprovalDecisionRequest): Promise<ApprovalDecisionResponse>;
  ResumeApprovalRun(req: ApprovalResumeRunRequest): Promise<ApprovalResumeRunResponse>;
  InterruptRun(req: InterruptRunRequest): Promise<void>;
  RedirectRun(req: RedirectRunRequest): Promise<RedirectRunResponse>;
  EnqueueRunMessage(req: EnqueueRunMessageRequest): Promise<RunQueuedMessage>;
  ListRunMessages(req: { run_id: string; status?: string }): Promise<{ messages: RunQueuedMessage[] }>;
  CancelRunMessage(req: CancelRunMessageRequest): Promise<RunQueuedMessage>;
  ListRecoverableRuns(req?: { limit?: number }): Promise<{ runs: RecoverableRunRecord[] }>;
  GetRecentRunClosureReport(req?: { limit?: number }): Promise<RunClosureReport>;
  GetExternalHandoffAudit(): Promise<ExternalHandoffAudit>;
  ListBackups(): Promise<{ backups: BackupRecord[] }>;
  CreateBackup(): Promise<{ path: string }>;
  RestoreBackup(path: string): Promise<void>;
  ExportDiagnostics(): Promise<{ path: string }>;
  ListLogs(filter?: LogFilter): Promise<{ logs: LogEntry[]; next_cursor?: string }>;
  GetLogEntry(id: string): Promise<LogEntry | null>;
  PreviewLogCleanup(req: LogCleanupRequest): Promise<LogCleanupPreview>;
  ClearLogs(req: LogCleanupRequest): Promise<LogCleanupResult>;
  ExportLogs(filter?: LogFilter): Promise<{ path: string }>;
  GetSettings(): Promise<SettingsRecord>;
  GetWorkspaceSettings(): Promise<WorkspaceSettings>;
  SaveWorkspaceSettings(req: WorkspaceSettings): Promise<void>;
  ListSavedModels(req: ModelListRequest): Promise<{ models: AvailableModel[] }>;
  FetchAvailableModels(req?: ModelConnectionTestRequest): Promise<ConnectionTest>;
  SaveModelConfig(req: ModelConfigRequest): Promise<void>;
  SaveModelSettings(req: ModelSettingsRequest): Promise<void>;
  ListAgentModelPolicies(): Promise<{ policies: AgentModelPolicy[] }>;
  SaveAgentModelPolicy(req: AgentModelPolicyRequest): Promise<AgentModelPolicy>;
  ExecuteBrowserAction(req: BrowserWorkbenchRequest): Promise<BrowserWorkbenchResult>;
  ExecuteDeveloperAction(req: DeveloperWorkbenchRequest): Promise<DeveloperWorkbenchResult>;
  ExecuteMediaAction(req: MediaWorkbenchRequest): Promise<MediaWorkbenchResult>;
  GetAssistantWorkspace(): Promise<AssistantWorkspaceSnapshot>;
  ExecuteAssistantAction(req: AssistantActionRequest): Promise<AssistantActionResult>;
  SaveOperationalSettings(req: { telegram_enabled: boolean; telegram_allowed_user_ids?: string; imessage_enabled?: boolean; imessage_allowed_users?: string; imessage_require_mention?: boolean; imessage_home_channel?: string; worker_gateway_enabled: boolean; backup_dir?: string; auto_backup_enabled: boolean }): Promise<void>;
  SaveTelegramConfig(req: { token?: string; allowed_user_ids?: string; enabled: boolean }): Promise<void>;
  SendTestTelegramMessage(req: { chat_id?: string; message?: string }): Promise<ConnectionTest>;
  SetupPhotonIMessage(req: PhotonIMessageSetupRequest): Promise<PhotonIMessageSetupResult>;
  SaveIMessageConfig(req: { project_id?: string; project_secret?: string; dashboard_token?: string; phone_number?: string; assigned_number?: string; home_channel?: string; allowed_users?: string; require_mention?: boolean; enabled: boolean; sidecar_port?: number }): Promise<void>;
  GetIMessageStatus(): Promise<PhotonIMessageStatus>;
  TestIMessageConnection(): Promise<ConnectionTest>;
  SendTestIMessageMessage(req: { space_id?: string; message?: string }): Promise<ConnectionTest>;
  GetOnboardingStatus(): Promise<OnboardingStatus>;
  CompleteOnboarding(): Promise<void>;
  GetSecretStatus(): Promise<SecretStatus>;
  SaveSecret(req: { name: string; value: string }): Promise<void>;
  LoginXAIOAuth(): Promise<XAIOAuthLoginResult>;
  TestWebSearch(req?: { query?: string; max_results?: number }): Promise<Record<string, unknown>>;
  TestModelConnection(req?: ModelConnectionTestRequest): Promise<ConnectionTest>;
  TestTelegramConnection(): Promise<ConnectionTest>;
  GenerateWorkerToken(): Promise<{ token: string }>;
};

export type JoiPreloadApi = {
  invoke<T = unknown>(method: keyof DesktopBindings, payload?: unknown): Promise<T>;
  onRunEvent(callback: (event: unknown) => void): () => void;
  terminal: {
    start(req?: TerminalSessionStartRequest): Promise<TerminalSessionInfo>;
    input(req: TerminalSessionInputRequest): Promise<void>;
    resize(req: TerminalSessionResizeRequest): Promise<void>;
    kill(req: TerminalSessionKillRequest): Promise<void>;
    getStatus(id: string): Promise<TerminalSessionSnapshot>;
    onEvent(callback: (event: TerminalSessionEvent) => void): () => void;
  };
  app: {
    getVersion(): Promise<string>;
    openExternal(url: string): Promise<void>;
  };
};

export const desktopBindingMethods: Array<keyof DesktopBindings> = [
  'ArchiveConversation',
  'CloseProductTask',
  'CompleteOnboarding',
  'CompleteCheckpoint',
  'CompactConversation',
  'ConnectExternalMirrorRoom',
  'CorrectMemory',
  'CreateProjectPersona',
  'CreateSharedRoom',
  'CreateBackup',
  'CreateConversationBranch',
  'ClearLogs',
  'CancelRunMessage',
  'DecideConfirmation',
  'DecideApproval',
  'DecideMemoryCandidate',
  'DecideOpenLoop',
  'DecideProactiveMessage',
  'DeleteConversationGroup',
  'DeleteAutomation',
  'DeleteMemory',
  'DisableNode',
  'EnableNode',
  'EvaluateRoomPermissions',
  'ExportDiagnostics',
  'ExportConversation',
  'ExportLogs',
  'ExportPersonaMessengerData',
  'FetchAvailableModels',
  'GenerateProjectPersonaCandidates',
  'GenerateWorkerToken',
  'GetArtifact',
  'GetAutomation',
  'GetAutomationWebhookEndpoint',
  'GetConversation',
  'GetConversationForMessage',
  'GetConversationTree',
  'GetAssistantWorkspace',
  'GetExternalHandoffAudit',
  'GetLogEntry',
  'GetMemorySystem',
  'GetModelUsage',
  'GetOnboardingStatus',
  'GetProductTask',
  'GetRecentRunClosureReport',
  'GetRunTrace',
  'GetSecretStatus',
  'GetIMessageStatus',
  'GetSettings',
  'GetSystemHealth',
  'GetWorkspaceSettings',
  'InterruptRun',
  'ImportConversation',
  'InvokeMCPTool',
  'EnqueueRunMessage',
  'ListRecoverableRuns',
  'ListRunMessages',
  'ListRunTraceSpans',
  'ListPersonaMessenger',
  'ListArtifacts',
  'ListAutomationRuns',
  'ListAutomationTriggers',
  'ListAutomations',
  'ListBackups',
  'ListCapabilities',
  'SetCapabilityEnabled',
  'ListConfirmations',
  'ListConversationGroups',
  'ListConversations',
  'ListLogs',
  'LoginXAIOAuth',
  'ListMCPServers',
  'SaveMCPServer',
  'DeleteMCPServer',
  'SetMCPServerEnabled',
  'ListMemories',
  'ListMemoriesUsedForRun',
  'ListMemoryCandidates',
  'ListNodes',
  'ListOpenLoops',
  'ListPendingApprovals',
  'ListProductTasks',
  'ListProductTasksByConversation',
  'ListProductTasksByPrincipal',
  'ListProactiveMessages',
  'ListRelationshipStates',
  'ListSavedModels',
  'ListAgentModelPolicies',
  'ListSkills',
  'ReloadSkills',
  'GetSkill',
  'SetSkillEnabled',
  'TestGitHubConnection',
  'ListPlugins',
  'InstallPluginFromManifest',
  'InstallPluginFromGitHub',
  'TestPluginProvider',
  'SetPluginEnabled',
  'RemovePlugin',
  'ListToolRuns',
  'ListToolWorkflows',
  'ListWorkerGatewayAuditLogs',
  'ListUserStates',
  'MoveConversationToGroup',
  'PurgeConversation',
  'PreviewExternalPersonaMessage',
  'PreviewLogCleanup',
  'RecordExternalConnectorFailure',
  'RecordExternalConnectorInbound',
  'RecordExternalConnectorOutbound',
  'RecordNotificationOpened',
  'RecordRoutingFeedback',
  'ReopenProductTask',
  'RollbackProjectPersona',
  'RestoreBackup',
  'RestoreConversation',
  'RotateAutomationWebhookSecret',
  'RunMemoryMaintenance',
  'RedirectRun',
  'ResumeApprovalRun',
  'RetryExternalConnectorEvent',
  'SaveAutomation',
  'SaveConversationGroup',
  'SaveModelConfig',
  'SaveModelSettings',
  'SaveAgentModelPolicy',
  'SaveIMessageConfig',
  'SaveMemorySettings',
  'SaveOperationalSettings',
  'SaveSecret',
  'SaveTelegramConfig',
  'SaveWorkspaceSettings',
  'SendChat',
  'SendTestIMessageMessage',
  'SendTestTelegramMessage',
  'SetRouteLock',
  'SetToolWorkflowEnabled',
  'SetAutomationEnabled',
  'SetAutomationRunArchived',
  'SetAutomationRunRead',
  'SetupPhotonIMessage',
  'SyncMCPServer',
  'TestAutomationWebhook',
  'TestIMessageConnection',
  'TestModelConnection',
  'TestWebSearch',
  'TestTelegramConnection',
  'ExecuteBrowserAction',
  'ExecuteDeveloperAction',
  'ExecuteMediaAction',
  'ExecuteAssistantAction',
  'TrashConversation',
  'TriggerAutomationNow',
  'MarkAllAutomationRunsRead',
  'ArchiveAllAutomationRuns',
  'UpdateMemory',
  'UpdateConversationBranch',
  'UpdateMessengerProject',
  'UpdateProjectPersona',
  'UpdateMessengerRoom',
  'WrapMCPTool',
];
