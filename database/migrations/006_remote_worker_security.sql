ALTER TABLE nodes
ADD COLUMN IF NOT EXISTS node_secret_hash TEXT,
ADD COLUMN IF NOT EXISTS auto_assign_enabled BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS manual_assign_enabled BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS failed_heartbeat_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_failure_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_nodes_assign_enabled
ON nodes(status, auto_assign_enabled, manual_assign_enabled);

INSERT INTO schema_migrations (version) VALUES ('006_remote_worker_security')
ON CONFLICT (version) DO NOTHING;
