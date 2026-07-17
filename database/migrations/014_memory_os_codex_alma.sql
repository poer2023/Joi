ALTER TABLE memories
ADD COLUMN IF NOT EXISTS layer TEXT NOT NULL DEFAULT 'knowledge',
ADD COLUMN IF NOT EXISTS memory_key TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS evidence_kind TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN IF NOT EXISTS evidence_authority INTEGER NOT NULL DEFAULT 20,
ADD COLUMN IF NOT EXISTS evidence_count INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NOT NULL DEFAULT 'active',
ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'conversation',
ADD COLUMN IF NOT EXISTS context_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS supersedes_memory_id TEXT REFERENCES memories(id),
ADD COLUMN IF NOT EXISTS review_reason TEXT,
ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS auto_managed BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS retention_policy TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE memory_usage_logs
ADD COLUMN IF NOT EXISTS normalized_score REAL,
ADD COLUMN IF NOT EXISTS recalled BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS influence_state TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS rank INTEGER,
ADD COLUMN IF NOT EXISTS pipeline_version TEXT NOT NULL DEFAULT 'legacy';

CREATE TABLE IF NOT EXISTS memory_observations (
  id TEXT PRIMARY KEY,
  memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
  memory_key TEXT NOT NULL,
  layer TEXT NOT NULL,
  type TEXT NOT NULL,
  statement TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  scope_type TEXT NOT NULL DEFAULT 'user',
  scope_id TEXT,
  privacy_level TEXT NOT NULL DEFAULT 'internal',
  evidence_kind TEXT NOT NULL,
  evidence_authority INTEGER NOT NULL DEFAULT 20,
  confidence REAL NOT NULL DEFAULT 0.5,
  polarity INTEGER NOT NULL DEFAULT 0,
  context_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_event_id TEXT,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'recorded',
  review_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memory_events (
  id TEXT PRIMARY KEY,
  memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'memory_runtime',
  source_event_id TEXT,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  before_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memory_policies (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memory_generation_inputs (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  user_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  assistant_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  eligible_after TIMESTAMPTZ NOT NULL,
  external_context_used BOOLEAN NOT NULL DEFAULT FALSE,
  exclusion_reason TEXT NOT NULL DEFAULT '',
  controls JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS memory_maintenance_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running',
  trigger_source TEXT NOT NULL DEFAULT 'runtime',
  processed_input_count INTEGER NOT NULL DEFAULT 0,
  generated_observation_count INTEGER NOT NULL DEFAULT 0,
  expired_count INTEGER NOT NULL DEFAULT 0,
  merged_count INTEGER NOT NULL DEFAULT 0,
  embedding_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

ALTER TABLE memory_maintenance_runs
ADD COLUMN IF NOT EXISTS processed_input_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS generated_observation_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_memories_layer_lifecycle
ON memories(layer, lifecycle_state, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memories_memory_key
ON memories(memory_key, scope_type, scope_id, status);

CREATE INDEX IF NOT EXISTS idx_memory_observations_key
ON memory_observations(memory_key, scope_type, scope_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_events_memory
ON memory_events(memory_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_generation_status
ON memory_generation_inputs(status, eligible_after, created_at);

CREATE INDEX IF NOT EXISTS idx_memory_maintenance_finished
ON memory_maintenance_runs(finished_at DESC);

INSERT INTO memory_policies (id, version, config, status)
VALUES (
  'memory_policy_v3',
  3,
  '{"version":3,"use_memories":true,"generate_memories":true,"disable_on_external_context":true,"background_idle_seconds":300,"stable_profile_limit":8,"dynamic_limit":6,"relevance_threshold":0.48,"state_ttl_days":14,"provisional_retention_days":90,"episode_retention_days":365,"implicit_promotion_evidence":3,"physical_delete_automatic":false}'::jsonb,
  'active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('014_memory_os_codex_alma')
ON CONFLICT (version) DO NOTHING;
