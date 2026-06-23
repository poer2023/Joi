PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS desktop_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  base_url TEXT,
  base_url_env TEXT,
  api_key_env TEXT,
  supports_json_mode INTEGER NOT NULL DEFAULT 0,
  supports_tool_calling INTEGER NOT NULL DEFAULT 0,
  context_window INTEGER,
  input_price_per_1m REAL,
  output_price_per_1m REAL,
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  default_model_id TEXT REFERENCES models(id),
  fallback_model_id TEXT REFERENCES models(id),
  cheap_model_id TEXT REFERENCES models(id),
  capabilities TEXT NOT NULL DEFAULT '[]',
  memory_scope_rules TEXT NOT NULL DEFAULT '{}',
  tool_policy TEXT NOT NULL DEFAULT '{}',
  route_hints TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS capabilities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT 'read_only',
  input_schema TEXT NOT NULL DEFAULT '{}',
  output_schema TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT 'read_only',
  input_schema TEXT NOT NULL DEFAULT '{}',
  output_schema TEXT NOT NULL DEFAULT '{}',
  allowed_nodes TEXT NOT NULL DEFAULT '[]',
  timeout_seconds INTEGER NOT NULL DEFAULT 30,
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tool_workflows (
  id TEXT PRIMARY KEY,
  capability_id TEXT REFERENCES capabilities(id),
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT 'v1',
  risk_level TEXT NOT NULL DEFAULT 'read_only',
  steps TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL DEFAULT 'stdio',
  command TEXT NOT NULL DEFAULT '',
  args TEXT NOT NULL DEFAULT '[]',
  env_secret_refs TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'inactive',
  trust TEXT NOT NULL DEFAULT 'untrusted_until_wrapped',
  last_sync_at TEXT,
  last_sync_error TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mcp_inventory_items (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  schema TEXT NOT NULL DEFAULT '{}',
  uri TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  arguments TEXT NOT NULL DEFAULT '[]',
  wrapped_capability_id TEXT REFERENCES capabilities(id),
  enabled INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(server_id, kind, name)
);

CREATE TABLE IF NOT EXISTS skill_definitions (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL DEFAULT 'v1',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  trigger_phrases TEXT NOT NULL DEFAULT '[]',
  required_capabilities TEXT NOT NULL DEFAULT '[]',
  forbidden_capabilities TEXT NOT NULL DEFAULT '[]',
  prompt TEXT NOT NULL DEFAULT '',
  output_contract TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skill_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  skill_id TEXT REFERENCES skill_definitions(id),
  status TEXT NOT NULL DEFAULT 'pending',
  input TEXT NOT NULL DEFAULT '{}',
  output_plan TEXT NOT NULL DEFAULT '{}',
  capability_requests TEXT NOT NULL DEFAULT '[]',
  rejection_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  principal_id TEXT,
  channel TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'default_user',
  title TEXT,
  active_agent_id TEXT REFERENCES agents(id),
  active_project_id TEXT,
  topic TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'active',
  group_id TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  trashed_at TEXT,
  purge_after TEXT,
  restored_at TEXT,
  expires_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversation_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  collapsed INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversation_lifecycle_events (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'desktop_ui',
  reason TEXT NOT NULL DEFAULT '',
  previous_status TEXT NOT NULL DEFAULT '',
  next_status TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  user_message_id TEXT REFERENCES messages(id),
  principal_id TEXT,
  entry_channel TEXT NOT NULL DEFAULT 'desktop',
  requested_mode TEXT NOT NULL DEFAULT 'auto',
  resolved_mode TEXT NOT NULL DEFAULT 'chat_assist',
  mode_source TEXT NOT NULL DEFAULT 'automatic',
  status TEXT NOT NULL DEFAULT 'pending',
  terminal_status TEXT,
  terminal_reason TEXT,
  selected_agent_id TEXT REFERENCES agents(id),
  selected_model_id TEXT REFERENCES models(id),
  selected_node_id TEXT,
  route_result TEXT NOT NULL DEFAULT '{}',
  resume_token TEXT,
  parent_run_id TEXT,
  redirected_from_run_id TEXT,
  cancel_requested_at TEXT,
  resumed_at TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  duration_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  step_type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  input TEXT NOT NULL DEFAULT '{}',
  output TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  mode_resolution_id TEXT,
  user_intent_summary TEXT,
  assistant_message_id TEXT,
  stream_status TEXT NOT NULL DEFAULT 'created',
  active_model_call_id TEXT,
  cancellation_key TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  completed_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  UNIQUE(run_id, turn_index)
);

CREATE TABLE IF NOT EXISTS turn_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  role TEXT,
  call_id TEXT,
  tool_name TEXT,
  arguments TEXT NOT NULL DEFAULT '{}',
  content TEXT NOT NULL DEFAULT '',
  output TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'completed',
  provider_item_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(run_id, seq)
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  conversation_id TEXT,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  item_type TEXT,
  item_id TEXT,
  parent_item_id TEXT,
  phase TEXT,
  visibility TEXT,
  source TEXT,
  terminal INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT,
  error_json TEXT,
  usage_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(run_id, seq)
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  agent_id TEXT REFERENCES agents(id),
  template_type TEXT NOT NULL DEFAULT 'agent_runtime',
  cache_policy TEXT NOT NULL DEFAULT '{}',
  content TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name, version, agent_id)
);

CREATE TABLE IF NOT EXISTS memory_context_packs (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id),
  memory_profile_version TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '[]',
  project_facts TEXT NOT NULL DEFAULT '[]',
  relevant_episodes TEXT NOT NULL DEFAULT '[]',
  heuristics TEXT NOT NULL DEFAULT '[]',
  anti_patterns TEXT NOT NULL DEFAULT '[]',
  open_issues TEXT NOT NULL DEFAULT '[]',
  dynamic_retrieval TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prompt_assemblies (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id),
  model_id TEXT REFERENCES models(id),
  prompt_template_id TEXT REFERENCES prompt_templates(id),
  memory_context_pack_id TEXT REFERENCES memory_context_packs(id),
  cacheable_prefix TEXT NOT NULL,
  dynamic_tail TEXT NOT NULL,
  prefix_hash TEXT NOT NULL,
  dynamic_tail_hash TEXT NOT NULL,
  prompt_cache_key TEXT NOT NULL,
  memory_profile_version TEXT NOT NULL,
  tool_schema_version TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS model_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  agent_id TEXT REFERENCES agents(id),
  model_id TEXT REFERENCES models(id),
  prompt_assembly_id TEXT REFERENCES prompt_assemblies(id),
  provider TEXT,
  model_name TEXT,
  prompt_cache_key TEXT,
  prefix_hash TEXT,
  dynamic_tail_hash TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cacheable_prefix_tokens INTEGER NOT NULL DEFAULT 0,
  dynamic_tail_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cost_estimate REAL,
  latency_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  streaming_enabled INTEGER NOT NULL DEFAULT 0,
  first_delta_at TEXT,
  completed_at TEXT,
  finish_reason TEXT,
  usage_status TEXT NOT NULL DEFAULT 'provider_missing',
  error_code TEXT,
  error_message TEXT,
  raw_response TEXT NOT NULL DEFAULT '{}',
  raw_finish_json TEXT NOT NULL DEFAULT '{}',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS provider_cache_stats (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_id TEXT REFERENCES models(id),
  model_name TEXT,
  prompt_cache_key TEXT NOT NULL,
  prefix_hash TEXT NOT NULL,
  dynamic_tail_hash TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  hit_ratio REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'worker',
  status TEXT NOT NULL DEFAULT 'unknown',
  capabilities TEXT NOT NULL DEFAULT '[]',
  resources TEXT NOT NULL DEFAULT '{}',
  network TEXT NOT NULL DEFAULT '{}',
  assign_policy TEXT NOT NULL DEFAULT '{}',
  node_secret_hash TEXT,
  auto_assign_enabled INTEGER NOT NULL DEFAULT 1,
  manual_assign_enabled INTEGER NOT NULL DEFAULT 1,
  failed_heartbeat_count INTEGER NOT NULL DEFAULT 0,
  last_failure_at TEXT,
  last_failure_reason TEXT,
  last_heartbeat_at TEXT,
  version TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  capability_id TEXT REFERENCES capabilities(id),
  workflow_id TEXT REFERENCES tool_workflows(id),
  preferred_node_id TEXT,
  assigned_node_id TEXT REFERENCES nodes(id),
  privacy_level TEXT NOT NULL DEFAULT 'internal',
  status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  timeout_seconds INTEGER NOT NULL DEFAULT 120,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS task_attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  node_id TEXT REFERENCES nodes(id),
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_number INTEGER NOT NULL DEFAULT 1,
  input TEXT NOT NULL DEFAULT '{}',
  output TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS worker_gateway_nonces (
  nonce TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS worker_gateway_audit_logs (
  id TEXT PRIMARY KEY,
  node_id TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tool_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id),
  tool_call_id TEXT,
  capability_id TEXT REFERENCES capabilities(id),
  workflow_name TEXT,
  tool_id TEXT REFERENCES tools(id),
  tool_name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  approval_request_id TEXT,
  node_id TEXT REFERENCES nodes(id),
  assignment_reason TEXT,
  risk_level TEXT NOT NULL DEFAULT 'read_only',
  side_effect_level TEXT NOT NULL DEFAULT 'none',
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  input TEXT NOT NULL DEFAULT '{}',
  output TEXT NOT NULL DEFAULT '{}',
  output_summary TEXT,
  artifact_id TEXT REFERENCES artifacts(id),
  error TEXT,
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_tasks (
  id TEXT PRIMARY KEY,
  principal_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planning',
  mode TEXT NOT NULL DEFAULT 'serious_task',
  priority TEXT NOT NULL DEFAULT 'normal',
  created_from_conversation_id TEXT REFERENCES conversations(id),
  created_from_message_id TEXT REFERENCES messages(id),
  latest_run_id TEXT REFERENCES runs(id),
  owner_user_id TEXT NOT NULL DEFAULT 'default_user',
  source_channel TEXT NOT NULL DEFAULT 'desktop',
  risk_level TEXT NOT NULL DEFAULT 'read_only',
  progress_percent INTEGER NOT NULL DEFAULT 0,
  current_step_id TEXT,
  summary TEXT NOT NULL DEFAULT '',
  source_conversation_id TEXT,
  source_run_id TEXT,
  source_turn_id TEXT,
  mode_resolution_id TEXT,
  terminal_status TEXT,
  terminal_reason TEXT,
  evidence_summary TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  last_projected_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS product_task_steps (
  id TEXT PRIMARY KEY,
  product_task_id TEXT NOT NULL REFERENCES product_tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  sort_order INTEGER NOT NULL DEFAULT 0,
  capability_id TEXT REFERENCES capabilities(id),
  tool_workflow_id TEXT REFERENCES tool_workflows(id),
  run_id TEXT REFERENCES runs(id),
  tool_run_id TEXT REFERENCES tool_runs(id),
  worker_task_id TEXT REFERENCES tasks(id),
  summary TEXT NOT NULL DEFAULT '',
  input TEXT NOT NULL DEFAULT '{}',
  output TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  content_format TEXT NOT NULL DEFAULT 'markdown',
  source_product_task_id TEXT REFERENCES product_tasks(id),
  source_run_id TEXT REFERENCES runs(id),
  source_conversation_id TEXT REFERENCES conversations(id),
  source_message_id TEXT REFERENCES messages(id),
  linked_memory_ids TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_task_deliverables (
  id TEXT PRIMARY KEY,
  product_task_id TEXT NOT NULL REFERENCES product_tasks(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS open_loops (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  source_conversation_id TEXT REFERENCES conversations(id),
  source_run_id TEXT REFERENCES runs(id),
  source_product_task_id TEXT REFERENCES product_tasks(id),
  suggested_followup TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal',
  due_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS proactive_messages (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_memory_ids TEXT NOT NULL DEFAULT '[]',
  source_open_loop_id TEXT REFERENCES open_loops(id),
  source_product_task_id TEXT REFERENCES product_tasks(id),
  score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  channel TEXT NOT NULL DEFAULT 'desktop',
  send_after TEXT,
  expires_at TEXT,
  feedback TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS proactive_feedback (
  id TEXT PRIMARY KEY,
  proactive_message_id TEXT NOT NULL REFERENCES proactive_messages(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  feedback TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS principals (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS channel_identities (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  external_thread_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'linked',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(channel, external_user_id, external_thread_id)
);

CREATE TABLE IF NOT EXISTS conversation_entry_links (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  channel_identity_id TEXT NOT NULL REFERENCES channel_identities(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  external_thread_id TEXT NOT NULL DEFAULT '',
  external_message_id TEXT NOT NULL DEFAULT '',
  selection_reason TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(channel_identity_id, conversation_id)
);

CREATE TABLE IF NOT EXISTS task_entry_links (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  channel_identity_id TEXT NOT NULL REFERENCES channel_identities(id) ON DELETE CASCADE,
  product_task_id TEXT NOT NULL REFERENCES product_tasks(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  external_task_ref TEXT NOT NULL DEFAULT '',
  selection_reason TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(channel_identity_id, product_task_id)
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  principal_id TEXT REFERENCES principals(id) ON DELETE SET NULL,
  channel_identity_id TEXT REFERENCES channel_identities(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  product_task_id TEXT REFERENCES product_tasks(id) ON DELETE SET NULL,
  open_loop_id TEXT REFERENCES open_loops(id) ON DELETE SET NULL,
  proactive_message_id TEXT REFERENCES proactive_messages(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'desktop',
  status TEXT NOT NULL DEFAULT 'pending',
  deep_link_target TEXT NOT NULL DEFAULT '',
  external_delivery_id TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  sent_at TEXT,
  opened_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  scope_type TEXT NOT NULL DEFAULT 'global',
  scope_id TEXT,
  privacy_level TEXT NOT NULL DEFAULT 'internal',
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'pending',
  source_event_ids TEXT NOT NULL DEFAULT '[]',
  entities TEXT NOT NULL DEFAULT '[]',
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  positive_feedback INTEGER NOT NULL DEFAULT 0,
  negative_feedback INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  disabled_at TEXT,
  merged_into_memory_id TEXT REFERENCES memories(id),
  conflict_group_id TEXT,
  conflict_reason TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts
USING fts5(memory_id UNINDEXED, content, summary, type, tokenize = 'unicode61');

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memory_fts(memory_id, content, summary, type)
  VALUES (new.id, new.content, COALESCE(new.summary, ''), new.type);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  DELETE FROM memory_fts WHERE memory_id = old.id;
  INSERT INTO memory_fts(memory_id, content, summary, type)
  VALUES (new.id, new.content, COALESCE(new.summary, ''), new.type);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  DELETE FROM memory_fts WHERE memory_id = old.id;
END;

CREATE TABLE IF NOT EXISTS memory_embeddings (
  id TEXT PRIMARY KEY,
  memory_id TEXT REFERENCES memories(id) ON DELETE CASCADE,
  embedding_model TEXT NOT NULL,
  embedding TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memory_usage_logs (
  id TEXT PRIMARY KEY,
  memory_id TEXT REFERENCES memories(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id),
  agent_id TEXT REFERENCES agents(id),
  retrieval_score REAL,
  injected INTEGER NOT NULL DEFAULT 0,
  used_in_answer INTEGER NOT NULL DEFAULT 0,
  outcome TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memory_feedback (
  id TEXT PRIMARY KEY,
  memory_id TEXT REFERENCES memories(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id),
  feedback TEXT NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS confirmations (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS confirmation_requests (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  capability_id TEXT REFERENCES capabilities(id),
  requested_action TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input TEXT NOT NULL DEFAULT '{}',
  call_id TEXT,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  approval_scope TEXT NOT NULL DEFAULT 'once',
  approval_key TEXT NOT NULL DEFAULT '',
  approved_by TEXT,
  rejected_by TEXT,
  decision_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  resumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_run_steps_run_id ON run_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_turns_run_id ON turns(run_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_turn_items_run_id ON turn_items(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_turn_items_call_id ON turn_items(call_id);
CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_run_events_conversation_created ON run_events(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_run_events_type ON run_events(run_id, event_type);
CREATE INDEX IF NOT EXISTS idx_run_events_item ON run_events(item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_confirmation_requests_call_id ON confirmation_requests(call_id);
CREATE INDEX IF NOT EXISTS idx_conversations_lifecycle ON conversations(lifecycle_status, pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_group ON conversations(group_id, lifecycle_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_groups_sort ON conversation_groups(sort_order, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_lifecycle_events_conversation ON conversation_lifecycle_events(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_prompt_assemblies_run_id ON prompt_assemblies(run_id);
CREATE INDEX IF NOT EXISTS idx_prompt_assemblies_cache_key ON prompt_assemblies(prompt_cache_key);
CREATE INDEX IF NOT EXISTS idx_model_calls_run_id ON model_calls(run_id);
CREATE INDEX IF NOT EXISTS idx_model_calls_prompt_assembly ON model_calls(prompt_assembly_id);
CREATE INDEX IF NOT EXISTS idx_provider_cache_stats_key ON provider_cache_stats(prompt_cache_key);
CREATE INDEX IF NOT EXISTS idx_memory_context_packs_run_id ON memory_context_packs(run_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_memories_governance ON memories(status, pinned, disabled_at, merged_into_memory_id);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_assign_enabled ON nodes(status, auto_assign_enabled, manual_assign_enabled);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_claim_pending ON tasks(status, assigned_node_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_attempts_task_id ON task_attempts(task_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_worker_gateway_audit_node ON worker_gateway_audit_logs(node_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_runs_run_id ON tool_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_tool_runs_node_id ON tool_runs(node_id);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_status ON mcp_servers(status, enabled);
CREATE INDEX IF NOT EXISTS idx_mcp_inventory_server ON mcp_inventory_items(server_id, kind, name);
CREATE INDEX IF NOT EXISTS idx_mcp_inventory_wrapped ON mcp_inventory_items(wrapped_capability_id);
CREATE INDEX IF NOT EXISTS idx_skill_definitions_enabled ON skill_definitions(enabled, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_runs_run_id ON skill_runs(run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_runs_skill_id ON skill_runs(skill_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_tasks_status ON product_tasks(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_tasks_conversation ON product_tasks(created_from_conversation_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_tasks_latest_run ON product_tasks(latest_run_id);
CREATE INDEX IF NOT EXISTS idx_product_task_steps_task ON product_task_steps(product_task_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_product_task_steps_run ON product_task_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(source_product_task_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(source_run_id);
CREATE INDEX IF NOT EXISTS idx_product_task_deliverables_task ON product_task_deliverables(product_task_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_open_loops_status ON open_loops(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_proactive_messages_status ON proactive_messages(status, score DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_proactive_messages_open_loop ON proactive_messages(source_open_loop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proactive_feedback_message ON proactive_feedback(proactive_message_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_usage_run_id ON memory_usage_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_memory_usage_memory_id ON memory_usage_logs(memory_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_feedback_memory_id ON memory_feedback(memory_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_confirmation_requests_status ON confirmation_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_principals_status ON principals(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_identities_principal ON channel_identities(principal_id, channel);
CREATE INDEX IF NOT EXISTS idx_conversation_entry_links_conversation ON conversation_entry_links(conversation_id, channel);
CREATE INDEX IF NOT EXISTS idx_task_entry_links_task ON task_entry_links(product_task_id, principal_id);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_target ON notification_deliveries(conversation_id, product_task_id, status);

INSERT INTO schema_migrations (version) VALUES ('001_init_schema')
ON CONFLICT(version) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('002_product_task_memory_artifact')
ON CONFLICT(version) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('010_conversation_lifecycle')
ON CONFLICT(version) DO NOTHING;
