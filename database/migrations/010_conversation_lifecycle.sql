ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS group_id TEXT,
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS conversation_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  collapsed BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_lifecycle_events (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'desktop_ui',
  reason TEXT NOT NULL DEFAULT '',
  previous_status TEXT NOT NULL DEFAULT '',
  next_status TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

UPDATE conversations
SET lifecycle_status='active'
WHERE lifecycle_status IS NULL OR lifecycle_status='';

CREATE INDEX IF NOT EXISTS idx_conversations_lifecycle ON conversations(lifecycle_status, pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_group ON conversations(group_id, lifecycle_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_groups_sort ON conversation_groups(sort_order, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_lifecycle_events_conversation ON conversation_lifecycle_events(conversation_id, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('010_conversation_lifecycle')
ON CONFLICT(version) DO NOTHING;
