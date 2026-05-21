CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  agent_id TEXT REFERENCES agents(id),
  template_type TEXT NOT NULL DEFAULT 'agent_runtime',
  cache_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  content TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(name, version, agent_id)
);

CREATE TABLE IF NOT EXISTS memory_context_packs (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id),
  memory_profile_version TEXT NOT NULL,
  profile JSONB NOT NULL DEFAULT '[]'::jsonb,
  project_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  relevant_episodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  heuristics JSONB NOT NULL DEFAULT '[]'::jsonb,
  anti_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  open_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  dynamic_retrieval JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE model_calls
  ADD COLUMN IF NOT EXISTS prompt_assembly_id TEXT REFERENCES prompt_assemblies(id),
  ADD COLUMN IF NOT EXISTS prompt_cache_key TEXT,
  ADD COLUMN IF NOT EXISTS prefix_hash TEXT,
  ADD COLUMN IF NOT EXISTS dynamic_tail_hash TEXT,
  ADD COLUMN IF NOT EXISTS cacheable_prefix_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dynamic_tail_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS raw_response JSONB NOT NULL DEFAULT '{}'::jsonb;

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
  hit_ratio NUMERIC(6,4) NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_assemblies_run_id ON prompt_assemblies(run_id);
CREATE INDEX IF NOT EXISTS idx_prompt_assemblies_cache_key ON prompt_assemblies(prompt_cache_key);
CREATE INDEX IF NOT EXISTS idx_model_calls_run_id ON model_calls(run_id);
CREATE INDEX IF NOT EXISTS idx_model_calls_prompt_assembly ON model_calls(prompt_assembly_id);
CREATE INDEX IF NOT EXISTS idx_provider_cache_stats_key ON provider_cache_stats(prompt_cache_key);
CREATE INDEX IF NOT EXISTS idx_memory_context_packs_run_id ON memory_context_packs(run_id);

INSERT INTO schema_migrations (version) VALUES ('002_prompt_assembly_cache')
ON CONFLICT (version) DO NOTHING;
