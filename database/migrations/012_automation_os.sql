CREATE TABLE IF NOT EXISTS automation_definitions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('schedule', 'webhook')),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  trigger_config TEXT NOT NULL DEFAULT '{}',
  prompt_template TEXT NOT NULL DEFAULT '',
  input_mode TEXT NOT NULL DEFAULT 'background_task',
  permission_profile TEXT NOT NULL DEFAULT 'read_only',
  preferred_node TEXT NOT NULL DEFAULT 'main-node',
  allow_worker INTEGER NOT NULL DEFAULT 0,
  agent_role_id TEXT NOT NULL DEFAULT 'general_agent',
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  principal_id TEXT REFERENCES principals(id) ON DELETE SET NULL,
  dedup_policy TEXT NOT NULL DEFAULT '{}',
  retry_policy TEXT NOT NULL DEFAULT '{}',
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  notification_policy TEXT NOT NULL DEFAULT '{}',
  next_fire_at TEXT,
  last_fire_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS automation_triggers (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL REFERENCES automation_definitions(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  fire_at TEXT,
  claimed_at TEXT,
  claim_token TEXT,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  product_task_id TEXT REFERENCES product_tasks(id) ON DELETE SET NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(automation_id, dedup_key)
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL REFERENCES automation_definitions(id) ON DELETE CASCADE,
  trigger_id TEXT NOT NULL REFERENCES automation_triggers(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  product_task_id TEXT REFERENCES product_tasks(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running',
  attempt_number INTEGER NOT NULL DEFAULT 1,
  started_at TEXT,
  finished_at TEXT,
  output_summary TEXT,
  error_code TEXT,
  error_message TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_automation_definitions_kind
ON automation_definitions(kind, enabled, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_definitions_enabled
ON automation_definitions(enabled, deleted_at, next_fire_at);

CREATE INDEX IF NOT EXISTS idx_automation_definitions_slug
ON automation_definitions(slug);

CREATE INDEX IF NOT EXISTS idx_automation_triggers_claim
ON automation_triggers(status, next_attempt_at, fire_at, created_at);

CREATE INDEX IF NOT EXISTS idx_automation_triggers_definition
ON automation_triggers(automation_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_definition
ON automation_runs(automation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_trigger
ON automation_runs(trigger_id, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('012_automation_os')
ON CONFLICT(version) DO NOTHING;
