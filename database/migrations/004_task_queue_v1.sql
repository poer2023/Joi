CREATE INDEX IF NOT EXISTS idx_tasks_claim_pending
ON tasks(status, assigned_node_id, created_at)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_task_attempts_task_id
ON task_attempts(task_id, attempt_number);

CREATE INDEX IF NOT EXISTS idx_nodes_heartbeat
ON nodes(status, last_heartbeat_at);

INSERT INTO schema_migrations (version) VALUES ('004_task_queue_v1')
ON CONFLICT (version) DO NOTHING;
