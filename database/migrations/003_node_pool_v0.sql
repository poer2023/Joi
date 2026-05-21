ALTER TABLE tool_runs
  ADD COLUMN IF NOT EXISTS assignment_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_tool_runs_node_id ON tool_runs(node_id);

INSERT INTO schema_migrations (version) VALUES ('003_node_pool_v0')
ON CONFLICT (version) DO NOTHING;
