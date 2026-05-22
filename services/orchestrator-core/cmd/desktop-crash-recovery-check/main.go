package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/hao/agent-os/services/orchestrator-core/internal/appcore"
	"github.com/hao/agent-os/services/orchestrator-core/internal/runtimeconfig"
	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

func main() {
	root, err := os.MkdirTemp("", "joi-desktop-crash-recovery-*")
	must(err)
	defer os.RemoveAll(root)

	dbPath := filepath.Join(root, "joi.db")
	schemaPath := filepath.Join(repoRoot(), "database", "sqlite", "001_init_schema.sql")
	ctx := context.Background()

	db, err := store.OpenSQLite(ctx, dbPath)
	must(err)
	must(db.ApplySQLiteSchema(ctx, schemaPath))
	must(db.SeedSQLiteDefaults(ctx))
	must(seedInterruptedState(ctx, db.SQL()))
	must(db.Close())

	mustSet("APP_MODE", "desktop")
	mustSet("DATA_STORE", "sqlite")
	mustSet("TASK_QUEUE_DRIVER", "sqlite")
	mustSet("SQLITE_PATH", dbPath)
	mustSet("SQLITE_SCHEMA_PATH", schemaPath)
	mustSet("MODEL_PROVIDER", "mock_provider")
	mustSet("ALLOW_MOCK_PROVIDER", "true")

	core, err := appcore.NewAppCore(ctx, runtimeconfig.Load(), slog.New(slog.NewJSONHandler(os.Stderr, nil)))
	must(err)
	must(core.Start(ctx))
	defer core.Shutdown(ctx)

	sqlDB := core.DB().SQL()
	out := map[string]any{}
	out["sqlite_integrity"] = sqliteIntegrity(ctx, sqlDB)
	out["permanent_running_tasks"] = scalarInt(ctx, sqlDB, `SELECT COUNT(*) FROM tasks WHERE status='running'`)
	out["task_status"] = scalarString(ctx, sqlDB, `SELECT status FROM tasks WHERE id='task_crash_recovery'`)
	out["attempt_status"] = scalarString(ctx, sqlDB, `SELECT status FROM task_attempts WHERE task_id='task_crash_recovery'`)
	out["tool_run_status"] = scalarString(ctx, sqlDB, `SELECT status FROM tool_runs WHERE task_id='task_crash_recovery'`)
	out["recovered_run_steps"] = scalarInt(ctx, sqlDB, `SELECT COUNT(*) FROM run_steps WHERE run_id='run_crash_recovery' AND step_type='recovered'`)
	out["interrupted_tool_runs"] = scalarInt(ctx, sqlDB, `SELECT COUNT(*) FROM tool_runs WHERE task_id='task_crash_recovery' AND error LIKE '%interrupted%'`)
	health, err := core.GetSystemHealth(ctx)
	must(err)
	out["system_health_recovered_tasks_today"] = health.QueueStatus["recovered_tasks_today"]
	out["system_health_stuck_running_tasks"] = health.QueueStatus["stuck_running_tasks"]

	ok := out["sqlite_integrity"] == "ok" &&
		out["permanent_running_tasks"] == 0 &&
		out["attempt_status"] == "failed" &&
		out["tool_run_status"] == "failed" &&
		out["recovered_run_steps"].(int) > 0 &&
		out["interrupted_tool_runs"].(int) > 0
	out["ok"] = ok
	writeJSON(out)
	if !ok {
		os.Exit(1)
	}
}

func seedInterruptedState(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO conversations (id, channel, user_id, title)
		VALUES ('conv_crash_recovery', 'desktop_check', 'desktop_check', 'Crash recovery check');
		INSERT INTO messages (id, conversation_id, role, content)
		VALUES ('msg_crash_recovery', 'conv_crash_recovery', 'user', 'simulate interrupted worker task');
		INSERT INTO runs (id, conversation_id, user_message_id, status, selected_agent_id, selected_node_id, route_result, metadata)
		VALUES ('run_crash_recovery', 'conv_crash_recovery', 'msg_crash_recovery', 'running', 'research_agent', 'vps-la-1', '{}', '{}');
		INSERT INTO nodes (id, name, role, status, capabilities, manual_assign_enabled, auto_assign_enabled, last_heartbeat_at, metadata)
		VALUES ('vps-la-1', 'VPS LA 1', 'worker', 'healthy', '["web_research_v1"]', 1, 0, datetime('now', '-20 minutes'), '{}')
		ON CONFLICT(id) DO UPDATE SET status='healthy', capabilities='["web_research_v1"]', last_heartbeat_at=datetime('now', '-20 minutes');
		INSERT INTO tasks (id, run_id, capability_id, preferred_node_id, assigned_node_id, status, payload, started_at)
		VALUES ('task_crash_recovery', 'run_crash_recovery', 'web_research_v1', 'vps-la-1', 'vps-la-1', 'running', '{"url":"https://example.com"}', datetime('now', '-10 minutes'));
		INSERT INTO task_attempts (id, task_id, node_id, status, attempt_number, input, started_at)
		VALUES ('attempt_crash_recovery', 'task_crash_recovery', 'vps-la-1', 'running', 1, '{"url":"https://example.com"}', datetime('now', '-10 minutes'));
		INSERT INTO tool_runs (id, run_id, task_id, capability_id, workflow_name, tool_name, node_id, assignment_reason, risk_level, status, input, started_at)
		VALUES ('toolrun_crash_recovery', 'run_crash_recovery', 'task_crash_recovery', 'web_research_v1', 'web_research_v1', 'web_research_v1', 'vps-la-1', 'user_selected', 'read_only', 'running', '{"url":"https://example.com"}', datetime('now', '-10 minutes'));
	`)
	return err
}

func sqliteIntegrity(ctx context.Context, db *sql.DB) string {
	var out string
	_ = db.QueryRowContext(ctx, `PRAGMA integrity_check`).Scan(&out)
	return out
}

func scalarInt(ctx context.Context, db *sql.DB, query string) int {
	var out int
	_ = db.QueryRowContext(ctx, query).Scan(&out)
	return out
}

func scalarString(ctx context.Context, db *sql.DB, query string) string {
	var out string
	_ = db.QueryRowContext(ctx, query).Scan(&out)
	return out
}

func repoRoot() string {
	wd, _ := os.Getwd()
	for {
		if _, err := os.Stat(filepath.Join(wd, "database", "sqlite", "001_init_schema.sql")); err == nil {
			return wd
		}
		next := filepath.Dir(wd)
		if next == wd {
			return "."
		}
		wd = next
	}
}

func mustSet(key string, value string) {
	if err := os.Setenv(key, value); err != nil {
		must(err)
	}
}

func writeJSON(value any) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	_ = encoder.Encode(value)
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
