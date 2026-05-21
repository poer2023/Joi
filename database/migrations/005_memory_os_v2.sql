ALTER TABLE memories
ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS merged_into_memory_id TEXT REFERENCES memories(id),
ADD COLUMN IF NOT EXISTS conflict_group_id TEXT,
ADD COLUMN IF NOT EXISTS conflict_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_governance
ON memories(status, pinned, disabled_at, merged_into_memory_id);

CREATE INDEX IF NOT EXISTS idx_memory_usage_memory_id
ON memory_usage_logs(memory_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_feedback_memory_id
ON memory_feedback(memory_id, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('005_memory_os_v2')
ON CONFLICT (version) DO NOTHING;
