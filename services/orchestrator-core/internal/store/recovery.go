package store

import (
	"context"
	"time"
)

func (db *DB) RecoverInterruptedTasks(ctx context.Context) error {
	_, err := db.sql.ExecContext(ctx, `
		UPDATE tasks
		SET status='pending', started_at=NULL, error=jsonb_build_object('recovered', true, 'reason', 'orchestrator_restart')
		WHERE status IN ('running', 'retrying')
	`)
	return err
}

func (db *DB) RecoverStuckTasks(ctx context.Context, maxAge time.Duration) error {
	_, err := db.sql.ExecContext(ctx, `
		WITH stuck AS (
			UPDATE tasks
			SET status = CASE
					WHEN COALESCE((SELECT COUNT(*) FROM task_attempts WHERE task_attempts.task_id = tasks.id), 0) >= 3 THEN 'dead'
					ELSE 'retrying'
				END,
				error = jsonb_build_object('reason', 'stuck_task_recovery'),
				finished_at = CASE
					WHEN COALESCE((SELECT COUNT(*) FROM task_attempts WHERE task_attempts.task_id = tasks.id), 0) >= 3 THEN NOW()
					ELSE NULL
				END
			WHERE status='running' AND started_at < NOW() - $1::interval
			RETURNING id, run_id, status
		)
		INSERT INTO run_steps (id, run_id, step_type, title, status, input, output, finished_at, duration_ms)
		SELECT 'step_' || md5(random()::text || clock_timestamp()::text), run_id,
		       CASE WHEN status='dead' THEN 'dead' ELSE 'retrying' END,
		       CASE WHEN status='dead' THEN 'Task marked dead' ELSE 'Task retrying' END,
		       'succeeded',
		       jsonb_build_object('task_id', id),
		       jsonb_build_object('reason', 'stuck_task_recovery'),
		       NOW(),
		       0
		FROM stuck
		WHERE run_id IS NOT NULL
	`, intervalLiteral(maxAge))
	return err
}

func (db *DB) MarkOfflineNodes(ctx context.Context, maxAge time.Duration) error {
	_, err := db.sql.ExecContext(ctx, `
		WITH lost AS (
			UPDATE nodes
			SET status='offline',
			    failed_heartbeat_count = failed_heartbeat_count + 1,
			    last_failure_at = NOW(),
			    last_failure_reason = 'heartbeat_timeout',
			    updated_at = NOW()
			WHERE role='worker'
			  AND status <> 'offline'
			  AND last_heartbeat_at IS NOT NULL
			  AND last_heartbeat_at < NOW() - $1::interval
			RETURNING id
		)
		UPDATE tasks
		SET status='retrying', error=jsonb_build_object('reason', 'worker_lost')
		WHERE status='running' AND assigned_node_id IN (SELECT id FROM lost)
	`, intervalLiteral(maxAge))
	return err
}

func intervalLiteral(duration time.Duration) string {
	seconds := int(duration.Seconds())
	if seconds <= 0 {
		seconds = 120
	}
	return stringInt(seconds) + " seconds"
}

func stringInt(value int) string {
	if value == 0 {
		return "0"
	}
	out := []byte{}
	for value > 0 {
		out = append([]byte{byte('0' + value%10)}, out...)
		value /= 10
	}
	return string(out)
}
