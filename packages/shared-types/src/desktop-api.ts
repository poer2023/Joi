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
  model_name?: string;
  input_mode?: InputMode;
  product_task_id?: string;
  parent_run_id?: string;
  redirected_from_run_id?: string;
  runtime_mode?: RuntimeMode;
  permission_profile?: PermissionProfile;
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

export type AutomationTriggerStatus = 'pending' | 'claimed' | 'running' | 'retry_scheduled' | 'succeeded' | 'failed' | 'cancelled' | 'deduped' | string;

export type AutomationRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'waiting_confirmation' | string;

export type AutomationDefinition = {
  id: string;
  kind: AutomationKind;
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
  next_fire_at?: string;
  last_fire_at?: string;
  metadata: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type AutomationDefinitionRequest = {
  id?: string;
  kind: AutomationKind;
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
  metadata: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type AutomationTriggerNowRequest = {
  id: string;
  payload?: Record<string, unknown>;
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
  file_analyze_max_bytes: number;
  workspace_search_max_results: number;
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
  type: string;
  content: string;
  summary: string;
  scope_type?: string;
  scope_id?: string;
  privacy_level?: string;
  status: string;
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
  entities?: string[];
  merged_into_memory_id?: string;
  conflict_group_id?: string;
  conflict_reason?: string;
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
  injected: boolean;
  used_in_answer: boolean;
  outcome: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
};

export type MemorySearchResult = {
  memory: MemoryRecord;
  score: number;
  reason: string;
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
  model_base_url: string;
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
  timeout_seconds?: number;
  max_retries?: number;
};

export type ModelConnectionTestRequest = ModelConfigRequest & {
  api_key?: string;
};

export type XAIOAuthLoginResult = {
  status: 'succeeded';
  provider: 'xai_oauth';
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
  GetAutomationWebhookEndpoint(id: string): Promise<AutomationWebhookEndpoint>;
  RotateAutomationWebhookSecret(id: string): Promise<AutomationWebhookEndpoint>;
  TestAutomationWebhook(req: AutomationWebhookTestRequest): Promise<{ trigger: AutomationTriggerRecord }>;
  GetRunTrace(runID: string): Promise<RunTrace>;
  ListRunTraceSpans(filter?: RunTraceSpanFilter): Promise<{ spans: RunTraceSpan[]; summary: RunTraceSpanSummary }>;
  ListConversations(filter: ConversationFilter): Promise<{ conversations: ConversationSummary[] }>;
  GetConversation(conversationID: string): Promise<ConversationDetail>;
  ListConversationGroups(): Promise<{ groups: ConversationGroup[] }>;
  SaveConversationGroup(req: ConversationGroupRequest): Promise<ConversationGroup>;
  DeleteConversationGroup(id: string): Promise<void>;
  MoveConversationToGroup(req: ConversationActionRequest): Promise<ConversationActionResponse>;
  ArchiveConversation(req: ConversationActionRequest): Promise<ConversationActionResponse>;
  TrashConversation(req: ConversationActionRequest): Promise<ConversationActionResponse>;
  RestoreConversation(req: ConversationActionRequest): Promise<ConversationActionResponse>;
  PurgeConversation(req: ConversationActionRequest): Promise<ConversationActionResponse>;
  ListCapabilities(): Promise<{ capabilities: CapabilityRecord[] }>;
  ListMCPServers(): Promise<{ servers: MCPServerRecord[] }>;
  SyncMCPServer(id: string): Promise<{ server: MCPServerRecord }>;
  WrapMCPTool(serverID: string, toolName: string, req: MCPWrapToolRequest): Promise<{ capability: CapabilityRecord }>;
  ListSkills(): Promise<{ skills: SkillRecord[] }>;
  ListToolWorkflows(): Promise<{ workflows: ToolWorkflowRecord[] }>;
  ListToolRuns(): Promise<{ tool_runs: ToolRunRecord[] }>;
  SetToolWorkflowEnabled(req: { name: string; enabled: boolean }): Promise<void>;
  GetSystemHealth(): Promise<SystemHealth>;
  ListMemories(filter: { query?: string; limit?: number }): Promise<{ memories: MemoryRecord[] }>;
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
  'ConnectExternalMirrorRoom',
  'CorrectMemory',
  'CreateProjectPersona',
  'CreateSharedRoom',
  'CreateBackup',
  'ClearLogs',
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
  'ExportLogs',
  'ExportPersonaMessengerData',
  'FetchAvailableModels',
  'GenerateProjectPersonaCandidates',
  'GenerateWorkerToken',
  'GetArtifact',
  'GetAutomation',
  'GetAutomationWebhookEndpoint',
  'GetConversation',
  'GetExternalHandoffAudit',
  'GetLogEntry',
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
  'ListRecoverableRuns',
  'ListRunTraceSpans',
  'ListPersonaMessenger',
  'ListArtifacts',
  'ListAutomationRuns',
  'ListAutomationTriggers',
  'ListAutomations',
  'ListBackups',
  'ListCapabilities',
  'ListConfirmations',
  'ListConversationGroups',
  'ListConversations',
  'ListLogs',
  'LoginXAIOAuth',
  'ListMCPServers',
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
  'ListSkills',
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
  'RedirectRun',
  'ResumeApprovalRun',
  'RetryExternalConnectorEvent',
  'SaveAutomation',
  'SaveConversationGroup',
  'SaveModelConfig',
  'SaveModelSettings',
  'SaveIMessageConfig',
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
  'SetupPhotonIMessage',
  'SyncMCPServer',
  'TestAutomationWebhook',
  'TestIMessageConnection',
  'TestModelConnection',
  'TestTelegramConnection',
  'TrashConversation',
  'TriggerAutomationNow',
  'UpdateMemory',
  'UpdateProjectPersona',
  'WrapMCPTool',
];
