package store

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

func OpenSQLite(ctx context.Context, databasePath string) (*DB, error) {
	if strings.TrimSpace(databasePath) == "" {
		databasePath = "joi.db"
	}
	if err := os.MkdirAll(filepath.Dir(databasePath), 0o700); err != nil {
		return nil, err
	}
	sqlDB, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	db := &DB{sql: sqlDB}
	if err := db.ApplySQLitePragmas(ctx); err != nil {
		sqlDB.Close()
		return nil, err
	}
	if err := db.Ping(ctx); err != nil {
		sqlDB.Close()
		return nil, err
	}
	return db, nil
}

func (db *DB) ApplySQLitePragmas(ctx context.Context) error {
	pragmas := []string{
		`PRAGMA journal_mode=WAL`,
		`PRAGMA foreign_keys=ON`,
		`PRAGMA busy_timeout=5000`,
	}
	for _, pragma := range pragmas {
		if _, err := db.sql.ExecContext(ctx, pragma); err != nil {
			return err
		}
	}
	return nil
}

func (db *DB) ApplySQLiteSchema(ctx context.Context, schemaPath string) error {
	if err := db.ApplySQLitePragmas(ctx); err != nil {
		return err
	}
	raw, err := os.ReadFile(schemaPath)
	if err != nil {
		return err
	}
	_, err = db.sql.ExecContext(ctx, string(raw))
	return err
}

func (db *DB) SeedSQLiteDefaults(ctx context.Context) error {
	_, err := db.sql.ExecContext(ctx, `
		INSERT INTO models (id, provider, model_name, display_name, supports_json_mode, supports_tool_calling, enabled, metadata)
		VALUES ('mock-model', 'mock_provider', 'mock-model', 'Mock Model', 1, 0, 1, '{"desktop_default":true}')
		ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, model_name=excluded.model_name, display_name=excluded.display_name, enabled=excluded.enabled, updated_at=datetime('now');

		INSERT INTO agents (id, name, description, default_model_id, capabilities, route_hints, enabled, metadata)
		VALUES
		  ('general_agent', 'General Agent', 'General purpose desktop agent.', 'mock-model', '["memory_search"]', '{"keywords":[]}', 1, '{"desktop_default":true}'),
		  ('devops_agent', 'DevOps Agent', 'Read-only diagnostics agent.', 'mock-model', '["server_diagnose_v1","system_health_check_v1"]', '{"keywords":["服务","容器","诊断","自检"]}', 1, '{"desktop_default":true}'),
		  ('research_agent', 'Research Agent', 'Read-only URL research agent.', 'mock-model', '["web_research_v1","fetch_url"]', '{"keywords":["http","https","url","research"]}', 1, '{"desktop_default":true}'),
		  ('memory_agent', 'Memory Agent', 'Memory governance agent.', 'mock-model', '["memory_search","memory_write_proposal"]', '{"keywords":["记忆","偏好","之前"]}', 1, '{"desktop_default":true}')
		ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, default_model_id=excluded.default_model_id, capabilities=excluded.capabilities, route_hints=excluded.route_hints, enabled=excluded.enabled, updated_at=datetime('now');

		INSERT INTO capabilities (id, name, description, risk_level, enabled, metadata)
		VALUES
		  ('memory_search', 'Memory Search', 'Search local memory context.', 'read_only', 1, '{"desktop_default":true}'),
		  ('server_diagnose', 'Server Diagnose', 'Read-only server diagnostics capability alias.', 'read_only', 1, '{"desktop_default":true,"alias_for":"server_diagnose_v1"}'),
		  ('server_diagnose_v1', 'Server Diagnose v1', 'Read-only server diagnostics.', 'read_only', 1, '{"desktop_default":true}'),
		  ('system_health_check', 'System Health Check', 'Read-only Joi self-check capability alias.', 'read_only', 1, '{"desktop_default":true,"alias_for":"system_health_check_v1"}'),
		  ('system_health_check_v1', 'System Health Check v1', 'Read-only Joi self-check.', 'read_only', 1, '{"desktop_default":true}'),
		  ('web_research', 'Web Research', 'Read-only URL fetch capability alias.', 'read_only', 1, '{"desktop_default":true,"alias_for":"web_research_v1"}'),
		  ('web_research_v1', 'Web Research v1', 'Read-only URL fetch and summarization.', 'read_only', 1, '{"desktop_default":true}')
		ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, risk_level=excluded.risk_level, enabled=excluded.enabled, updated_at=datetime('now');
	`)
	if err != nil {
		return err
	}
	return db.RegisterSQLiteMainNode(ctx)
}

func (db *DB) RegisterSQLiteMainNode(ctx context.Context) error {
	_, err := db.sql.ExecContext(ctx, `
		INSERT INTO nodes (id, name, role, status, capabilities, resources, network, assign_policy, auto_assign_enabled, manual_assign_enabled, last_heartbeat_at, version, metadata, updated_at)
		VALUES ('main-node', 'Main Node', 'main-node', 'healthy', ?, ?, ?, ?, 1, 1, datetime('now'), '0.1.0', ?, datetime('now'))
		ON CONFLICT(id) DO UPDATE SET
			name=excluded.name,
			role=excluded.role,
			status=excluded.status,
			capabilities=excluded.capabilities,
			resources=excluded.resources,
			network=excluded.network,
			assign_policy=excluded.assign_policy,
			auto_assign_enabled=excluded.auto_assign_enabled,
			manual_assign_enabled=excluded.manual_assign_enabled,
			last_heartbeat_at=datetime('now'),
			version=excluded.version,
			metadata=excluded.metadata,
			updated_at=datetime('now')
	`, mustJSON([]string{"memory_search", "server_diagnose_v1", "system_health_check_v1", "web_research_v1"}), mustJSON(map[string]any{"execution": "local"}), mustJSON(map[string]any{"scope": "local"}), mustJSON(map[string]any{"manual_assignable": true, "auto_assignable": true, "allow_private_context": true, "allow_secret_context": false}), mustJSON(map[string]any{"registered_by": "desktop_appcore"}))
	return err
}

func (db *DB) RecoverSQLiteTasks(ctx context.Context, maxAge time.Duration) error {
	threshold := time.Now().Add(-maxAge).UTC().Format(time.RFC3339)
	_, err := db.sql.ExecContext(ctx, `
		UPDATE tasks
		SET status='retrying', error='{"code":"worker_lost","message":"Recovered stale running task"}', finished_at=datetime('now')
		WHERE status='running' AND started_at < ?
	`, threshold)
	return err
}
