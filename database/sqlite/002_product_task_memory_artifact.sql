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

INSERT INTO schema_migrations (version) VALUES ('002_product_task_memory_artifact')
ON CONFLICT(version) DO NOTHING;
