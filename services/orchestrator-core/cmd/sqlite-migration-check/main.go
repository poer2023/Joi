package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

func main() {
	root, err := os.MkdirTemp("", "joi-sqlite-migration-*")
	must(err)
	defer os.RemoveAll(root)

	ctx := context.Background()
	dbPath := filepath.Join(root, "old-version-fixture.db")
	db, err := store.OpenSQLite(ctx, dbPath)
	must(err)
	must(seedOldVersionFixture(ctx, db.SQL()))

	schemaPath := filepath.Join(repoRoot(), "database", "sqlite", "001_init_schema.sql")
	must(db.ApplySQLiteSchema(ctx, schemaPath))
	must(db.ApplySQLiteSchema(ctx, schemaPath))
	must(db.SeedSQLiteDefaults(ctx))

	out := map[string]any{
		"ok":                          false,
		"fixture":                     dbPath,
		"sqlite_integrity":            scalarString(ctx, db.SQL(), `PRAGMA integrity_check`),
		"memories_readable":           scalarInt(ctx, db.SQL(), `SELECT COUNT(*) FROM memories WHERE id='mem_old_1' AND content LIKE '%Desktop%'`),
		"runs_readable":               scalarInt(ctx, db.SQL(), `SELECT COUNT(*) FROM runs WHERE id='run_old_1'`),
		"settings_readable":           scalarInt(ctx, db.SQL(), `SELECT COUNT(*) FROM desktop_settings WHERE key='app_mode' AND value='desktop'`),
		"agents_readable":             scalarInt(ctx, db.SQL(), `SELECT COUNT(*) FROM agents WHERE id='general_agent'`),
		"capabilities_readable":       scalarInt(ctx, db.SQL(), `SELECT COUNT(*) FROM capabilities WHERE id='memory_search'`),
		"codex_capabilities":          scalarInt(ctx, db.SQL(), `SELECT COUNT(*) FROM capabilities WHERE id IN ('file_read','apply_patch','shell_command','test_command','browser_observe','browser_navigate','browser_click','browser_type','computer_observe')`),
		"codex_tools":                 scalarInt(ctx, db.SQL(), `SELECT COUNT(*) FROM tools WHERE id IN ('file_read_bounded','patch_apply_workspace','shell_exec_sandboxed','browser_snapshot','browser_navigate_url','browser_click_element','browser_type_text','computer_observe_visible_ui')`),
		"codex_workflows":             scalarInt(ctx, db.SQL(), `SELECT COUNT(*) FROM tool_workflows WHERE name IN ('file_read_v1','apply_patch_v1','shell_command_v1','test_command_v1','browser_observe_v1','browser_navigate_v1','browser_click_v1','browser_type_v1','computer_observe_v1')`),
		"general_agent_codex_tools":   scalarInt(ctx, db.SQL(), `SELECT COUNT(*) FROM agents WHERE id='general_agent' AND capabilities LIKE '%shell_command%' AND capabilities LIKE '%browser_observe%' AND capabilities LIKE '%browser_navigate%' AND capabilities LIKE '%browser_click%' AND capabilities LIKE '%browser_type%' AND capabilities LIKE '%computer_observe%'`),
		"confirmation_resume_columns": scalarInt(ctx, db.SQL(), `SELECT COUNT(*) FROM pragma_table_info('confirmation_requests') WHERE name IN ('call_id','turn_id','approval_scope','approval_key','resumed_at')`),
		"run_events_runtime_columns":  scalarInt(ctx, db.SQL(), `SELECT COUNT(*) FROM pragma_table_info('run_events') WHERE name IN ('turn_id','payload')`),
		"run_events_legacy_columns":   scalarInt(ctx, db.SQL(), `SELECT COUNT(*) FROM pragma_table_info('run_events') WHERE name IN ('item_id','snapshot','delta')`),
		"run_events_insertable":       runEventsInsertable(ctx, db.SQL()),
		"fts_hit_count":               scalarInt(ctx, db.SQL(), `SELECT COUNT(*) FROM memory_fts WHERE memory_fts MATCH 'Desktop'`),
		"gateway_tables":              scalarInt(ctx, db.SQL(), `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('worker_gateway_nonces','worker_gateway_audit_logs')`),
	}
	ok := out["sqlite_integrity"] == "ok" &&
		out["memories_readable"] == 1 &&
		out["runs_readable"] == 1 &&
		out["settings_readable"] == 1 &&
		out["agents_readable"] == 1 &&
		out["capabilities_readable"] == 1 &&
		out["codex_capabilities"] == 9 &&
		out["codex_tools"] == 8 &&
		out["codex_workflows"] == 9 &&
		out["general_agent_codex_tools"] == 1 &&
		out["confirmation_resume_columns"] == 5 &&
		out["run_events_runtime_columns"] == 2 &&
		out["run_events_legacy_columns"] == 0 &&
		out["run_events_insertable"] == 1 &&
		out["fts_hit_count"].(int) >= 1 &&
		out["gateway_tables"] == 2
	out["ok"] = ok
	writeJSON(out)
	must(db.Close())
	if !ok {
		os.Exit(1)
	}
}

func seedOldVersionFixture(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, `
		CREATE TABLE schema_migrations (
		  version TEXT PRIMARY KEY,
		  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE desktop_settings (
		  key TEXT PRIMARY KEY,
		  value TEXT NOT NULL,
		  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE models (
		  id TEXT PRIMARY KEY,
		  provider TEXT NOT NULL,
		  model_name TEXT NOT NULL,
		  display_name TEXT NOT NULL,
		  base_url TEXT,
		  base_url_env TEXT,
		  api_key_env TEXT,
		  supports_json_mode INTEGER NOT NULL DEFAULT 0,
		  supports_tool_calling INTEGER NOT NULL DEFAULT 0,
		  context_window INTEGER,
		  input_price_per_1m REAL,
		  output_price_per_1m REAL,
		  enabled INTEGER NOT NULL DEFAULT 1,
		  metadata TEXT NOT NULL DEFAULT '{}',
		  created_at TEXT NOT NULL DEFAULT (datetime('now')),
		  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE agents (
		  id TEXT PRIMARY KEY,
		  name TEXT NOT NULL,
		  description TEXT NOT NULL DEFAULT '',
		  system_prompt TEXT NOT NULL DEFAULT '',
		  default_model_id TEXT,
		  fallback_model_id TEXT,
		  cheap_model_id TEXT,
		  capabilities TEXT NOT NULL DEFAULT '[]',
		  memory_scope_rules TEXT NOT NULL DEFAULT '{}',
		  tool_policy TEXT NOT NULL DEFAULT '{}',
		  route_hints TEXT NOT NULL DEFAULT '{}',
		  enabled INTEGER NOT NULL DEFAULT 1,
		  metadata TEXT NOT NULL DEFAULT '{}',
		  created_at TEXT NOT NULL DEFAULT (datetime('now')),
		  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE capabilities (
		  id TEXT PRIMARY KEY,
		  name TEXT NOT NULL,
		  description TEXT NOT NULL DEFAULT '',
		  risk_level TEXT NOT NULL DEFAULT 'read_only',
		  input_schema TEXT NOT NULL DEFAULT '{}',
		  output_schema TEXT NOT NULL DEFAULT '{}',
		  enabled INTEGER NOT NULL DEFAULT 1,
		  metadata TEXT NOT NULL DEFAULT '{}',
		  created_at TEXT NOT NULL DEFAULT (datetime('now')),
		  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE conversations (
		  id TEXT PRIMARY KEY,
		  channel TEXT NOT NULL,
		  user_id TEXT NOT NULL DEFAULT 'default_user',
		  title TEXT,
		  active_agent_id TEXT,
		  active_project_id TEXT,
		  topic TEXT,
		  expires_at TEXT,
		  metadata TEXT NOT NULL DEFAULT '{}',
		  created_at TEXT NOT NULL DEFAULT (datetime('now')),
		  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE messages (
		  id TEXT PRIMARY KEY,
		  conversation_id TEXT,
		  role TEXT NOT NULL,
		  content TEXT NOT NULL,
		  attachments TEXT NOT NULL DEFAULT '[]',
		  metadata TEXT NOT NULL DEFAULT '{}',
		  created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE runs (
		  id TEXT PRIMARY KEY,
		  conversation_id TEXT,
		  user_message_id TEXT,
		  status TEXT NOT NULL DEFAULT 'pending',
		  selected_agent_id TEXT,
		  selected_model_id TEXT,
		  selected_node_id TEXT,
		  route_result TEXT NOT NULL DEFAULT '{}',
		  started_at TEXT NOT NULL DEFAULT (datetime('now')),
		  finished_at TEXT,
		  duration_ms INTEGER,
		  error_code TEXT,
		  error_message TEXT,
		  metadata TEXT NOT NULL DEFAULT '{}',
		  created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE memories (
		  id TEXT PRIMARY KEY,
		  type TEXT NOT NULL,
		  content TEXT NOT NULL,
		  summary TEXT,
		  scope_type TEXT NOT NULL DEFAULT 'global',
		  scope_id TEXT,
		  privacy_level TEXT NOT NULL DEFAULT 'internal',
		  confidence REAL NOT NULL DEFAULT 0.5,
		  status TEXT NOT NULL DEFAULT 'pending',
		  source_event_ids TEXT NOT NULL DEFAULT '[]',
		  entities TEXT NOT NULL DEFAULT '[]',
		  success_count INTEGER NOT NULL DEFAULT 0,
		  failure_count INTEGER NOT NULL DEFAULT 0,
		  usage_count INTEGER NOT NULL DEFAULT 0,
		  positive_feedback INTEGER NOT NULL DEFAULT 0,
		  negative_feedback INTEGER NOT NULL DEFAULT 0,
		  pinned INTEGER NOT NULL DEFAULT 0,
		  disabled_at TEXT,
		  merged_into_memory_id TEXT,
		  conflict_group_id TEXT,
		  conflict_reason TEXT,
		  metadata TEXT NOT NULL DEFAULT '{}',
		  created_at TEXT NOT NULL DEFAULT (datetime('now')),
		  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
		  last_used_at TEXT
		);
		CREATE TABLE confirmation_requests (
		  id TEXT PRIMARY KEY,
		  run_id TEXT REFERENCES runs(id),
		  capability_id TEXT REFERENCES capabilities(id),
		  requested_action TEXT NOT NULL,
		  risk_level TEXT NOT NULL,
		  status TEXT NOT NULL DEFAULT 'pending',
		  input TEXT NOT NULL DEFAULT '{}',
		  approved_by TEXT,
		  rejected_by TEXT,
		  decision_reason TEXT,
		  created_at TEXT NOT NULL DEFAULT (datetime('now')),
		  decided_at TEXT
		);
		CREATE TABLE run_events (
		  id TEXT PRIMARY KEY,
		  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
		  seq INTEGER NOT NULL,
		  event_type TEXT NOT NULL,
		  item_id TEXT NOT NULL,
		  item_type TEXT NOT NULL,
		  status TEXT NOT NULL,
		  parent_item_id TEXT,
		  title TEXT NOT NULL DEFAULT '',
		  summary TEXT NOT NULL DEFAULT '',
		  snapshot TEXT NOT NULL DEFAULT '{}',
		  delta TEXT NOT NULL DEFAULT '{}',
		  error TEXT,
		  metadata TEXT NOT NULL DEFAULT '{}',
		  created_at TEXT NOT NULL DEFAULT (datetime('now')),
		  UNIQUE(run_id, seq)
		);
		CREATE INDEX idx_run_events_run_seq ON run_events(run_id, seq);

		INSERT INTO schema_migrations (version) VALUES ('desktop_rc0_old_fixture');
		INSERT INTO desktop_settings (key, value) VALUES ('app_mode', 'desktop');
		INSERT INTO models (id, provider, model_name, display_name, supports_json_mode, enabled)
		VALUES ('mock-model', 'mock_provider', 'mock-model', 'Mock Model', 1, 1);
		INSERT INTO agents (id, name, description, default_model_id, capabilities, enabled)
		VALUES ('general_agent', 'General Agent', 'Old fixture general agent', 'mock-model', '["memory_search"]', 1);
		INSERT INTO capabilities (id, name, description, risk_level, enabled)
		VALUES ('memory_search', 'Memory Search', 'Old fixture memory search', 'read_only', 1);
		INSERT INTO conversations (id, channel, user_id, title)
		VALUES ('conv_old_1', 'desktop', 'fixture', 'Old fixture');
		INSERT INTO messages (id, conversation_id, role, content)
		VALUES ('msg_old_1', 'conv_old_1', 'user', 'old fixture message');
		INSERT INTO runs (id, conversation_id, user_message_id, status, selected_agent_id)
		VALUES ('run_old_1', 'conv_old_1', 'msg_old_1', 'succeeded', 'general_agent');
		INSERT INTO run_events (id, run_id, seq, event_type, item_id, item_type, status, metadata)
		VALUES ('evt_old_1', 'run_old_1', 1, 'legacy.item', 'item_old_1', 'tool', 'completed', '{"legacy":true}');
		INSERT INTO memories (id, type, content, summary, status, confidence, pinned)
		VALUES ('mem_old_1', 'preference', 'Desktop mode should stay local first.', 'Desktop local first', 'confirmed', 0.9, 1);
	`)
	return err
}

func runEventsInsertable(ctx context.Context, db *sql.DB) int {
	_, err := db.ExecContext(ctx, `
		INSERT INTO run_events (id, run_id, turn_id, seq, event_type, payload)
		VALUES ('evt_current_check', 'run_old_1', NULL, 2, 'assistant.completed', '{"ok":true}')
	`)
	if err != nil {
		return 0
	}
	return 1
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
