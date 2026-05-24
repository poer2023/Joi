CREATE TABLE IF NOT EXISTS product_tasks (
  id TEXT PRIMARY KEY,
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
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
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
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  error JSONB,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  linked_memory_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_task_deliverables (
  id TEXT PRIMARY KEY,
  product_task_id TEXT NOT NULL REFERENCES product_tasks(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  due_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS proactive_messages (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_memory_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_open_loop_id TEXT REFERENCES open_loops(id),
  source_product_task_id TEXT REFERENCES product_tasks(id),
  score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  channel TEXT NOT NULL DEFAULT 'desktop',
  send_after TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  feedback TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_product_tasks_status
ON product_tasks(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_tasks_conversation
ON product_tasks(created_from_conversation_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_tasks_latest_run
ON product_tasks(latest_run_id);

CREATE INDEX IF NOT EXISTS idx_product_task_steps_task
ON product_task_steps(product_task_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_product_task_steps_run
ON product_task_steps(run_id);

CREATE INDEX IF NOT EXISTS idx_artifacts_task
ON artifacts(source_product_task_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_artifacts_run
ON artifacts(source_run_id);

CREATE INDEX IF NOT EXISTS idx_product_task_deliverables_task
ON product_task_deliverables(product_task_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_open_loops_status
ON open_loops(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_proactive_messages_status
ON proactive_messages(status, score DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_proactive_messages_open_loop
ON proactive_messages(source_open_loop_id, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('009_product_task_memory_artifact')
ON CONFLICT (version) DO NOTHING;
