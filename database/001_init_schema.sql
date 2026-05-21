CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE models (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  base_url TEXT,
  base_url_env TEXT,
  api_key_env TEXT,
  supports_json_mode BOOLEAN NOT NULL DEFAULT FALSE,
  supports_tool_calling BOOLEAN NOT NULL DEFAULT FALSE,
  context_window INTEGER,
  input_price_per_1m NUMERIC(12,6),
  output_price_per_1m NUMERIC(12,6),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  default_model_id TEXT REFERENCES models(id),
  fallback_model_id TEXT REFERENCES models(id),
  cheap_model_id TEXT REFERENCES models(id),
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  memory_scope_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  tool_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  route_hints JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE capabilities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT 'read_only',
  input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT 'read_only',
  input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  allowed_nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  timeout_seconds INTEGER NOT NULL DEFAULT 30,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tool_workflows (
  id TEXT PRIMARY KEY,
  capability_id TEXT REFERENCES capabilities(id),
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT 'v1',
  risk_level TEXT NOT NULL DEFAULT 'read_only',
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'default_user',
  title TEXT,
  active_agent_id TEXT REFERENCES agents(id),
  active_project_id TEXT,
  topic TEXT,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  user_message_id TEXT REFERENCES messages(id),
  status TEXT NOT NULL DEFAULT 'pending',
  selected_agent_id TEXT REFERENCES agents(id),
  selected_model_id TEXT REFERENCES models(id),
  selected_node_id TEXT,
  route_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  step_type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  error JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE model_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  agent_id TEXT REFERENCES agents(id),
  model_id TEXT REFERENCES models(id),
  provider TEXT,
  model_name TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_estimate NUMERIC(12,6),
  latency_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  error_code TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'worker',
  status TEXT NOT NULL DEFAULT 'unknown',
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  resources JSONB NOT NULL DEFAULT '{}'::jsonb,
  network JSONB NOT NULL DEFAULT '{}'::jsonb,
  assign_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_heartbeat_at TIMESTAMPTZ,
  version TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  capability_id TEXT REFERENCES capabilities(id),
  workflow_id TEXT REFERENCES tool_workflows(id),
  preferred_node_id TEXT,
  assigned_node_id TEXT REFERENCES nodes(id),
  privacy_level TEXT NOT NULL DEFAULT 'internal',
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  error JSONB,
  timeout_seconds INTEGER NOT NULL DEFAULT 120,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE TABLE task_attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  node_id TEXT REFERENCES nodes(id),
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_number INTEGER NOT NULL DEFAULT 1,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  error JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE tool_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  task_id TEXT REFERENCES tasks(id),
  capability_id TEXT REFERENCES capabilities(id),
  workflow_name TEXT,
  tool_id TEXT REFERENCES tools(id),
  tool_name TEXT NOT NULL,
  node_id TEXT REFERENCES nodes(id),
  risk_level TEXT NOT NULL DEFAULT 'read_only',
  status TEXT NOT NULL DEFAULT 'pending',
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  error JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  scope_type TEXT NOT NULL DEFAULT 'global',
  scope_id TEXT,
  privacy_level TEXT NOT NULL DEFAULT 'internal',
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'pending',
  source_event_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  entities JSONB NOT NULL DEFAULT '[]'::jsonb,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  positive_feedback INTEGER NOT NULL DEFAULT 0,
  negative_feedback INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE TABLE memory_embeddings (
  id TEXT PRIMARY KEY,
  memory_id TEXT REFERENCES memories(id) ON DELETE CASCADE,
  embedding_model TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE memory_usage_logs (
  id TEXT PRIMARY KEY,
  memory_id TEXT REFERENCES memories(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id),
  agent_id TEXT REFERENCES agents(id),
  retrieval_score REAL,
  injected BOOLEAN NOT NULL DEFAULT FALSE,
  used_in_answer BOOLEAN NOT NULL DEFAULT FALSE,
  outcome TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE memory_feedback (
  id TEXT PRIMARY KEY,
  memory_id TEXT REFERENCES memories(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id),
  feedback TEXT NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE confirmations (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_runs_created_at ON runs(created_at DESC);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_run_steps_run_id ON run_steps(run_id);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_status ON memories(status);
CREATE INDEX idx_memories_scope ON memories(scope_type, scope_id);
CREATE INDEX idx_memories_entities ON memories USING GIN(entities);
CREATE INDEX idx_nodes_status ON nodes(status);
CREATE INDEX idx_nodes_capabilities ON nodes USING GIN(capabilities);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tool_runs_run_id ON tool_runs(run_id);
CREATE INDEX idx_memory_usage_run_id ON memory_usage_logs(run_id);
