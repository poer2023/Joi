package store

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strconv"
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
	raw, err := os.ReadFile(schemaPath)
	if err != nil {
		return err
	}
	return db.ApplySQLiteSchemaSQL(ctx, string(raw))
}

func (db *DB) ApplySQLiteSchemaSQL(ctx context.Context, schemaSQL string) error {
	if err := db.ApplySQLitePragmas(ctx); err != nil {
		return err
	}
	hasConversations, err := db.sqliteTableExists(ctx, "conversations")
	if err != nil {
		return err
	}
	if hasConversations {
		if err := db.EnsureSQLiteConversationLifecycle(ctx); err != nil {
			return err
		}
	}
	hasConfirmations, err := db.sqliteTableExists(ctx, "confirmation_requests")
	if err != nil {
		return err
	}
	if hasConfirmations {
		if err := db.EnsureSQLiteConfirmationLifecycle(ctx); err != nil {
			return err
		}
	}
	if _, err := db.sql.ExecContext(ctx, schemaSQL); err != nil {
		return err
	}
	if err := db.EnsureSQLiteRunEventLifecycle(ctx); err != nil {
		return err
	}
	if err := db.EnsureSQLiteConversationLifecycle(ctx); err != nil {
		return err
	}
	if err := db.EnsureSQLiteConfirmationLifecycle(ctx); err != nil {
		return err
	}
	return db.RebuildSQLiteMemoryFTS(ctx)
}

func (db *DB) sqliteTableExists(ctx context.Context, table string) (bool, error) {
	var count int
	if err := db.sql.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func (db *DB) EnsureSQLiteConversationLifecycle(ctx context.Context) error {
	additions := []struct {
		column string
		sql    string
	}{
		{"lifecycle_status", `ALTER TABLE conversations ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active'`},
		{"group_id", `ALTER TABLE conversations ADD COLUMN group_id TEXT`},
		{"pinned", `ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`},
		{"archived_at", `ALTER TABLE conversations ADD COLUMN archived_at TEXT`},
		{"trashed_at", `ALTER TABLE conversations ADD COLUMN trashed_at TEXT`},
		{"purge_after", `ALTER TABLE conversations ADD COLUMN purge_after TEXT`},
		{"restored_at", `ALTER TABLE conversations ADD COLUMN restored_at TEXT`},
	}
	for _, addition := range additions {
		exists, err := db.sqliteColumnExists(ctx, "conversations", addition.column)
		if err != nil {
			return err
		}
		if !exists {
			if _, err := db.sql.ExecContext(ctx, addition.sql); err != nil {
				return err
			}
		}
	}
	_, err := db.sql.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS conversation_groups (
		  id TEXT PRIMARY KEY,
		  name TEXT NOT NULL,
		  sort_order INTEGER NOT NULL DEFAULT 0,
		  collapsed INTEGER NOT NULL DEFAULT 0,
		  metadata TEXT NOT NULL DEFAULT '{}',
		  created_at TEXT NOT NULL DEFAULT (datetime('now')),
		  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS conversation_lifecycle_events (
		  id TEXT PRIMARY KEY,
		  conversation_id TEXT NOT NULL REFERENCES conversations(id),
		  action TEXT NOT NULL,
		  actor TEXT NOT NULL DEFAULT 'desktop_ui',
		  reason TEXT NOT NULL DEFAULT '',
		  previous_status TEXT NOT NULL DEFAULT '',
		  next_status TEXT NOT NULL DEFAULT '',
		  metadata TEXT NOT NULL DEFAULT '{}',
		  created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);

		UPDATE conversations
		SET lifecycle_status='active'
		WHERE lifecycle_status IS NULL OR lifecycle_status='';

		CREATE INDEX IF NOT EXISTS idx_conversations_lifecycle ON conversations(lifecycle_status, pinned DESC, updated_at DESC);
		CREATE INDEX IF NOT EXISTS idx_conversations_group ON conversations(group_id, lifecycle_status, updated_at DESC);
		CREATE INDEX IF NOT EXISTS idx_conversation_groups_sort ON conversation_groups(sort_order, updated_at DESC);
		CREATE INDEX IF NOT EXISTS idx_conversation_lifecycle_events_conversation ON conversation_lifecycle_events(conversation_id, created_at DESC);
	`)
	return err
}

func (db *DB) EnsureSQLiteRunEventLifecycle(ctx context.Context) error {
	exists, err := db.sqliteTableExists(ctx, "run_events")
	if err != nil || !exists {
		return err
	}
	columns, err := db.sqliteColumnSet(ctx, "run_events")
	if err != nil {
		return err
	}
	needsRebuild := !columns["turn_id"] || !columns["payload"] || columns["item_id"] || columns["snapshot"] || columns["delta"]
	if !needsRebuild {
		_, err := db.sql.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id, seq)`)
		return err
	}
	return db.rebuildSQLiteRunEvents(ctx, columns)
}

func (db *DB) rebuildSQLiteRunEvents(ctx context.Context, columns map[string]bool) error {
	legacyTable := "run_events_legacy_" + strconv.FormatInt(time.Now().UnixNano(), 10)
	if !sqliteIdentifierSafe(legacyTable) {
		return nil
	}
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		DROP INDEX IF EXISTS idx_run_events_run_seq;
		DROP INDEX IF EXISTS idx_run_events_run_item;
		DROP INDEX IF EXISTS idx_run_events_run_id;
	`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `ALTER TABLE run_events RENAME TO `+legacyTable); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		CREATE TABLE run_events (
		  id TEXT PRIMARY KEY,
		  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
		  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
		  seq INTEGER NOT NULL,
		  event_type TEXT NOT NULL,
		  payload TEXT NOT NULL DEFAULT '{}',
		  created_at TEXT NOT NULL DEFAULT (datetime('now')),
		  UNIQUE(run_id, seq)
		);
	`); err != nil {
		return err
	}

	if columns["id"] && columns["run_id"] && columns["seq"] && columns["event_type"] {
		turnExpr := "NULL"
		if columns["turn_id"] {
			turnExpr = "NULLIF(turn_id, '')"
		}
		payloadExpr := "'{}'"
		if columns["payload"] {
			payloadExpr = "COALESCE(NULLIF(payload, ''), '{}')"
		} else if columns["metadata"] {
			payloadExpr = "COALESCE(NULLIF(metadata, ''), '{}')"
		}
		createdExpr := "datetime('now')"
		if columns["created_at"] {
			createdExpr = "COALESCE(NULLIF(created_at, ''), datetime('now'))"
		}
		insertSQL := `
			INSERT OR IGNORE INTO run_events (id, run_id, turn_id, seq, event_type, payload, created_at)
			SELECT id, run_id, ` + turnExpr + `, seq, event_type, ` + payloadExpr + `, ` + createdExpr + `
			FROM ` + legacyTable + `
			WHERE COALESCE(run_id, '') <> ''
			  AND EXISTS (SELECT 1 FROM runs WHERE runs.id = ` + legacyTable + `.run_id)
		`
		if _, err := tx.ExecContext(ctx, insertSQL); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `DROP TABLE `+legacyTable); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id, seq)`); err != nil {
		return err
	}
	return tx.Commit()
}

func (db *DB) EnsureSQLiteConfirmationLifecycle(ctx context.Context) error {
	additions := []struct {
		column string
		sql    string
	}{
		{"call_id", `ALTER TABLE confirmation_requests ADD COLUMN call_id TEXT`},
		{"turn_id", `ALTER TABLE confirmation_requests ADD COLUMN turn_id TEXT`},
		{"approval_scope", `ALTER TABLE confirmation_requests ADD COLUMN approval_scope TEXT NOT NULL DEFAULT 'once'`},
		{"approval_key", `ALTER TABLE confirmation_requests ADD COLUMN approval_key TEXT NOT NULL DEFAULT ''`},
		{"resumed_at", `ALTER TABLE confirmation_requests ADD COLUMN resumed_at TEXT`},
	}
	for _, addition := range additions {
		exists, err := db.sqliteColumnExists(ctx, "confirmation_requests", addition.column)
		if err != nil {
			return err
		}
		if !exists {
			if _, err := db.sql.ExecContext(ctx, addition.sql); err != nil {
				return err
			}
		}
	}
	_, err := db.sql.ExecContext(ctx, `
		CREATE INDEX IF NOT EXISTS idx_confirmation_requests_call_id ON confirmation_requests(call_id);
		UPDATE confirmation_requests
		SET approval_scope='once'
		WHERE approval_scope IS NULL OR approval_scope='';
		UPDATE confirmation_requests
		SET approval_key=''
		WHERE approval_key IS NULL;
	`)
	return err
}

func (db *DB) sqliteColumnExists(ctx context.Context, table string, column string) (bool, error) {
	columns, err := db.sqliteColumnSet(ctx, table)
	if err != nil {
		return false, err
	}
	return columns[column], nil
}

func (db *DB) sqliteColumnSet(ctx context.Context, table string) (map[string]bool, error) {
	if !sqliteIdentifierSafe(table) {
		return map[string]bool{}, nil
	}
	rows, err := db.sql.QueryContext(ctx, `PRAGMA table_info(`+table+`)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns := map[string]bool{}
	for rows.Next() {
		var cid int
		var name, dataType string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &pk); err != nil {
			return nil, err
		}
		columns[name] = true
	}
	return columns, rows.Err()
}

func sqliteIdentifierSafe(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
			continue
		}
		return false
	}
	return true
}

func (db *DB) RebuildSQLiteMemoryFTS(ctx context.Context) error {
	_, err := db.sql.ExecContext(ctx, `
		DELETE FROM memory_fts;
		INSERT INTO memory_fts(memory_id, content, summary, type)
		SELECT id, content, COALESCE(summary, ''), type
		FROM memories;
	`)
	return err
}

func (db *DB) SeedSQLiteDefaults(ctx context.Context) error {
	_, err := db.sql.ExecContext(ctx, `
		INSERT INTO models (id, provider, model_name, display_name, supports_json_mode, supports_tool_calling, enabled, metadata)
		VALUES ('mock-model', 'mock_provider', 'mock-model', 'Mock Model', 1, 0, 1, '{"desktop_default":true}')
		ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, model_name=excluded.model_name, display_name=excluded.display_name, enabled=excluded.enabled, updated_at=datetime('now');

		INSERT INTO agents (id, name, description, default_model_id, capabilities, route_hints, enabled, metadata)
		VALUES
		  ('general_agent', 'General Agent', 'General purpose desktop agent.', 'mock-model', '["memory_search","workspace_search","file_read","file_analyze","apply_patch","shell_command","test_command","browser_observe","browser_navigate","browser_click","browser_type","computer_observe"]', '{"keywords":[]}', 1, '{"desktop_default":true}'),
		  ('devops_agent', 'DevOps Agent', 'Read-only diagnostics agent.', 'mock-model', '["server_diagnose_v1","system_health_check_v1"]', '{"keywords":["服务","容器","诊断","自检"]}', 1, '{"desktop_default":true}'),
		  ('research_agent', 'Research Agent', 'Read-only URL research agent.', 'mock-model', '["web_research_v1","fetch_url"]', '{"keywords":["http","https","url","research"]}', 1, '{"desktop_default":true}'),
		  ('memory_agent', 'Memory Agent', 'Memory governance agent.', 'mock-model', '["memory_search","memory_write_proposal"]', '{"keywords":["记忆","偏好","之前"]}', 1, '{"desktop_default":true}'),
		  ('product_agent', 'Product Agent', 'Product planning agent without tool execution by default.', 'mock-model', '[]', '{"keywords":["产品","优先级","roadmap","product"]}', 1, '{"desktop_default":true}')
		ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, default_model_id=excluded.default_model_id, capabilities=excluded.capabilities, route_hints=excluded.route_hints, enabled=excluded.enabled, updated_at=datetime('now');

		INSERT INTO capabilities (id, name, description, risk_level, enabled, metadata)
		VALUES
		  ('memory_search', 'Memory Search', 'Search local memory context.', 'read_only', 1, '{"desktop_default":true}'),
		  ('server_diagnose', 'Server Diagnose', 'Read-only server diagnostics capability alias.', 'read_only', 1, '{"desktop_default":true,"alias_for":"server_diagnose_v1"}'),
		  ('server_diagnose_v1', 'Server Diagnose v1', 'Read-only server diagnostics.', 'read_only', 1, '{"desktop_default":true}'),
		  ('system_health_check', 'System Health Check', 'Read-only Joi self-check capability alias.', 'read_only', 1, '{"desktop_default":true,"alias_for":"system_health_check_v1"}'),
		  ('system_health_check_v1', 'System Health Check v1', 'Read-only Joi self-check.', 'read_only', 1, '{"desktop_default":true}'),
		  ('web_research', 'Web Research', 'Read-only URL fetch capability alias.', 'read_only', 1, '{"desktop_default":true,"alias_for":"web_research_v2"}'),
		  ('web_research_v1', 'Web Research v1', 'Read-only URL fetch and summarization legacy alias.', 'read_only', 1, '{"desktop_default":true,"alias_for":"web_research_v2"}'),
		  ('web_research_v2', 'Web Research v2', 'Read-only public HTTP/HTTPS fetch and summarization.', 'read_only', 1, '{"desktop_default":true}'),
		  ('browser_read', 'Browser Read', 'Read-only URL/page read through browser/web host policy.', 'read_only', 1, '{"desktop_default":true,"source":"native"}'),
		  ('browser_read_v1', 'Browser Read v1', 'Read-only URL/page read through browser/web host policy.', 'read_only', 1, '{"desktop_default":true,"alias_for":"browser_read"}'),
		  ('browser_observe', 'Browser Observe', 'Observe the frontmost local browser tab as private content.', 'read_only', 1, '{"desktop_default":true,"source":"native"}'),
		  ('browser_observe_v1', 'Browser Observe v1', 'Observe the frontmost local browser tab as private content.', 'read_only', 1, '{"desktop_default":true,"alias_for":"browser_observe"}'),
		  ('browser_navigate', 'Browser Navigate', 'Navigate the frontmost or default local browser to an allowlisted HTTP/HTTPS URL.', 'read_only', 1, '{"desktop_default":true,"source":"native"}'),
		  ('browser_navigate_v1', 'Browser Navigate v1', 'Navigate the frontmost or default local browser to an allowlisted HTTP/HTTPS URL.', 'read_only', 1, '{"desktop_default":true,"alias_for":"browser_navigate"}'),
		  ('browser_click', 'Browser Click', 'Click an element in the frontmost local browser with explicit interaction permission.', 'browser_interaction', 1, '{"desktop_default":true,"source":"native"}'),
		  ('browser_click_v1', 'Browser Click v1', 'Click an element in the frontmost local browser with explicit interaction permission.', 'browser_interaction', 1, '{"desktop_default":true,"alias_for":"browser_click"}'),
		  ('browser_type', 'Browser Type', 'Type text into an element in the frontmost local browser with explicit interaction permission.', 'browser_interaction', 1, '{"desktop_default":true,"source":"native"}'),
		  ('browser_type_v1', 'Browser Type v1', 'Type text into an element in the frontmost local browser with explicit interaction permission.', 'browser_interaction', 1, '{"desktop_default":true,"alias_for":"browser_type"}'),
		  ('workspace_search', 'Workspace Search', 'Search authorized workspace source and documents.', 'read_only', 1, '{"desktop_default":true}'),
		  ('file_read', 'File Read', 'Read a bounded authorized workspace file line range.', 'read_only', 1, '{"desktop_default":true}'),
		  ('file_analyze', 'File Analyze', 'Analyze an authorized workspace file.', 'read_only', 1, '{"desktop_default":true}'),
		  ('apply_patch', 'Apply Patch', 'Apply a bounded patch inside authorized workspace roots.', 'workspace_write', 1, '{"desktop_default":true}'),
		  ('shell_command', 'Shell Command', 'Run a tightly allowlisted read-only workspace command without shell string evaluation.', 'read_only', 1, '{"desktop_default":true}'),
		  ('test_command', 'Test Command', 'Run an allowlisted test/build command in an authorized workspace directory.', 'read_only', 1, '{"desktop_default":true}'),
		  ('desktop_app_list', 'Desktop App List', 'List installed macOS applications as local metadata.', 'read_only', 1, '{"desktop_default":true,"source":"native"}'),
		  ('desktop_app_list_v1', 'Desktop App List v1', 'List installed macOS applications as local metadata.', 'read_only', 1, '{"desktop_default":true,"alias_for":"desktop_app_list"}'),
		  ('desktop_app_inspect', 'Desktop App Inspect', 'Inspect one macOS application bundle as local metadata.', 'read_only', 1, '{"desktop_default":true,"source":"native"}'),
		  ('desktop_app_inspect_v1', 'Desktop App Inspect v1', 'Inspect one macOS application bundle as local metadata.', 'read_only', 1, '{"desktop_default":true,"alias_for":"desktop_app_inspect"}'),
		  ('computer_observe', 'Computer Observe', 'Read-only visible Joi desktop observation.', 'read_only', 1, '{"desktop_default":true,"source":"native"}'),
		  ('computer_observe_v1', 'Computer Observe v1', 'Read-only visible Joi desktop observation.', 'read_only', 1, '{"desktop_default":true,"alias_for":"computer_observe"}')
		ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, risk_level=excluded.risk_level, enabled=excluded.enabled, metadata=excluded.metadata, updated_at=datetime('now');

		INSERT INTO tools (id, name, description, risk_level, allowed_nodes, timeout_seconds, enabled, metadata)
		VALUES
		  ('memory_search_index', 'Memory Search Index', 'Read memory FTS index and build context excerpts.', 'read_only', '["main-node"]', 10, 1, '{"desktop_default":true}'),
		  ('docker_list_containers', 'Docker List Containers', 'List containers with fixed read-only arguments.', 'read_only', '["main-node"]', 5, 1, '{"desktop_default":true}'),
		  ('docker_inspect_container', 'Docker Inspect Container', 'Inspect a named container read-only.', 'read_only', '["main-node"]', 5, 1, '{"desktop_default":true}'),
		  ('docker_read_logs', 'Docker Read Logs', 'Read bounded container logs.', 'read_only', '["main-node"]', 5, 1, '{"desktop_default":true}'),
		  ('check_port', 'Check Port', 'Probe a TCP port without state changes.', 'read_only', '["main-node"]', 3, 1, '{"desktop_default":true}'),
		  ('http_probe', 'HTTP Probe', 'Probe a URL with a bounded GET request.', 'read_only', '["main-node"]', 5, 1, '{"desktop_default":true}'),
		  ('system_disk_usage', 'System Disk Usage', 'Read filesystem usage metadata.', 'read_only', '["main-node"]', 3, 1, '{"desktop_default":true}'),
		  ('system_memory_usage', 'System Memory Usage', 'Read process memory metadata.', 'read_only', '["main-node"]', 3, 1, '{"desktop_default":true}'),
		  ('postgres_ping', 'Postgres Ping', 'Read database health status.', 'read_only', '["main-node"]', 5, 1, '{"desktop_default":true}'),
		  ('nats_port_check', 'NATS Port Check', 'Read NATS port reachability.', 'read_only', '["main-node"]', 3, 1, '{"desktop_default":true}'),
		  ('console_http_probe', 'Console HTTP Probe', 'Probe console health endpoint.', 'read_only', '["main-node"]', 5, 1, '{"desktop_default":true}'),
		  ('fetch_url', 'Fetch URL', 'Fetch a public HTTP/HTTPS URL with bounded redirects and response size.', 'read_only', '["main-node","local-worker-1"]', 15, 1, '{"desktop_default":true}'),
		  ('extract_readable_text', 'Extract Readable Text', 'Extract bounded readable text from fetched content.', 'read_only', '["main-node","local-worker-1"]', 5, 1, '{"desktop_default":true}'),
		  ('extract_links', 'Extract Links', 'Extract bounded links from fetched content.', 'read_only', '["main-node","local-worker-1"]', 5, 1, '{"desktop_default":true}'),
		  ('summarize_sources', 'Summarize Sources', 'Summarize fetched public content.', 'read_only', '["main-node","local-worker-1"]', 5, 1, '{"desktop_default":true}'),
		  ('browser_snapshot', 'Browser Snapshot', 'Read the frontmost local browser tab title, URL, and bounded visible text.', 'read_only', '["main-node"]', 5, 1, '{"desktop_default":true}'),
		  ('browser_navigate_url', 'Browser Navigate URL', 'Navigate the local browser to a constrained HTTP/HTTPS URL.', 'read_only', '["main-node"]', 5, 1, '{"desktop_default":true}'),
		  ('browser_click_element', 'Browser Click Element', 'Click a DOM element in the frontmost browser tab.', 'browser_interaction', '["main-node"]', 5, 1, '{"desktop_default":true}'),
		  ('browser_type_text', 'Browser Type Text', 'Type text into a DOM element in the frontmost browser tab.', 'browser_interaction', '["main-node"]', 5, 1, '{"desktop_default":true}'),
		  ('desktop_list_app_bundles', 'Desktop List App Bundles', 'List installed macOS .app bundles as bounded local metadata.', 'read_only', '["main-node"]', 10, 1, '{"desktop_default":true}'),
		  ('desktop_inspect_app_bundle', 'Desktop Inspect App Bundle', 'Inspect one installed macOS .app bundle as local metadata.', 'read_only', '["main-node"]', 10, 1, '{"desktop_default":true}'),
		  ('workspace_walk_search', 'Workspace Walk Search', 'Search authorized workspace paths without arbitrary shell flags.', 'read_only', '["main-node"]', 10, 1, '{"desktop_default":true}'),
		  ('file_read_bounded', 'File Read Bounded', 'Read a bounded authorized workspace text file line range.', 'read_only', '["main-node"]', 10, 1, '{"desktop_default":true}'),
		  ('file_read_authorized', 'File Read Authorized', 'Read a bounded authorized workspace file.', 'read_only', '["main-node"]', 10, 1, '{"desktop_default":true}'),
		  ('file_summarize_excerpts', 'File Summarize Excerpts', 'Summarize bounded file excerpts.', 'read_only', '["main-node"]', 10, 1, '{"desktop_default":true}'),
		  ('patch_apply_workspace', 'Patch Apply Workspace', 'Apply a validated patch to authorized workspace files.', 'workspace_write', '["main-node"]', 10, 1, '{"desktop_default":true}'),
		  ('shell_exec_sandboxed', 'Shell Exec Sandboxed', 'Execute an allowlisted command without shell string evaluation.', 'read_only', '["main-node"]', 60, 1, '{"desktop_default":true}'),
		  ('computer_observe_visible_ui', 'Computer Observe Visible UI', 'Read visible Joi desktop UI state without interaction.', 'read_only', '["main-node"]', 5, 1, '{"desktop_default":true}'),
		  ('mcp_tool_call', 'MCP Tool Call', 'Call an MCP tool only through a wrapped Joi capability.', 'read_only', '["main-node"]', 30, 1, '{"desktop_default":true,"requires_wrapped_capability":true}')
		ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, risk_level=excluded.risk_level, allowed_nodes=excluded.allowed_nodes, timeout_seconds=excluded.timeout_seconds, enabled=excluded.enabled, updated_at=datetime('now');

		INSERT INTO tool_workflows (id, capability_id, name, version, risk_level, steps, enabled, metadata)
		VALUES
		  ('workflow_memory_search_v1', 'memory_search', 'memory_search_v1', 'v1', 'read_only', '[{"tool":"memory_search_index","args":{},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
		  ('workflow_server_diagnose_v1', 'server_diagnose', 'server_diagnose_v1', 'v1', 'read_only', '[{"tool":"docker_list_containers","args":{},"risk_level":"read_only"},{"tool":"docker_inspect_container","args":{},"risk_level":"read_only"},{"tool":"docker_read_logs","args":{"tail":200},"risk_level":"read_only"},{"tool":"check_port","args":{},"risk_level":"read_only"},{"tool":"http_probe","args":{},"risk_level":"read_only"},{"tool":"system_disk_usage","args":{},"risk_level":"read_only"},{"tool":"system_memory_usage","args":{},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
		  ('workflow_system_health_check_v1', 'system_health_check', 'system_health_check_v1', 'v1', 'read_only', '[{"tool":"postgres_ping","args":{},"risk_level":"read_only"},{"tool":"nats_port_check","args":{},"risk_level":"read_only"},{"tool":"console_http_probe","args":{},"risk_level":"read_only"},{"tool":"system_disk_usage","args":{},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
		  ('workflow_web_research_v2', 'web_research', 'web_research_v2', 'v2', 'read_only', '[{"tool":"fetch_url","args":{},"risk_level":"read_only"},{"tool":"extract_readable_text","args":{},"risk_level":"read_only"},{"tool":"extract_links","args":{},"risk_level":"read_only"},{"tool":"summarize_sources","args":{},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
		  ('workflow_browser_read_v1', 'browser_read', 'browser_read_v1', 'v1', 'read_only', '[{"tool":"fetch_url","args":{},"risk_level":"read_only"},{"tool":"extract_readable_text","args":{},"risk_level":"read_only"},{"tool":"extract_links","args":{},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
		  ('workflow_browser_observe_v1', 'browser_observe', 'browser_observe_v1', 'v1', 'read_only', '[{"tool":"browser_snapshot","args":{"target":"frontmost_browser"},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
		  ('workflow_browser_navigate_v1', 'browser_navigate', 'browser_navigate_v1', 'v1', 'read_only', '[{"tool":"browser_navigate_url","args":{"target":"frontmost_or_default_browser"},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
		  ('workflow_browser_click_v1', 'browser_click', 'browser_click_v1', 'v1', 'browser_interaction', '[{"tool":"browser_click_element","args":{"target":"frontmost_browser"},"risk_level":"browser_interaction"}]', 1, '{"desktop_default":true}'),
		  ('workflow_browser_type_v1', 'browser_type', 'browser_type_v1', 'v1', 'browser_interaction', '[{"tool":"browser_type_text","args":{"target":"frontmost_browser"},"risk_level":"browser_interaction"}]', 1, '{"desktop_default":true}'),
		  ('workflow_desktop_app_list_v1', 'desktop_app_list', 'desktop_app_list_v1', 'v1', 'read_only', '[{"tool":"desktop_list_app_bundles","args":{},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
		  ('workflow_desktop_app_inspect_v1', 'desktop_app_inspect', 'desktop_app_inspect_v1', 'v1', 'read_only', '[{"tool":"desktop_inspect_app_bundle","args":{},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
		  ('workflow_workspace_search_v1', 'workspace_search', 'workspace_search_v1', 'v1', 'read_only', '[{"tool":"workspace_walk_search","args":{},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
		  ('workflow_file_read_v1', 'file_read', 'file_read_v1', 'v1', 'read_only', '[{"tool":"file_read_bounded","args":{},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
		  ('workflow_file_analyze_v1', 'file_analyze', 'file_analyze_v1', 'v1', 'read_only', '[{"tool":"file_read_authorized","args":{},"risk_level":"read_only"},{"tool":"file_summarize_excerpts","args":{},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
		  ('workflow_apply_patch_v1', 'apply_patch', 'apply_patch_v1', 'v1', 'workspace_write', '[{"tool":"patch_apply_workspace","args":{},"risk_level":"workspace_write"}]', 1, '{"desktop_default":true}'),
		  ('workflow_shell_command_v1', 'shell_command', 'shell_command_v1', 'v1', 'read_only', '[{"tool":"shell_exec_sandboxed","args":{},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
		  ('workflow_test_command_v1', 'test_command', 'test_command_v1', 'v1', 'read_only', '[{"tool":"shell_exec_sandboxed","args":{},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
		  ('workflow_computer_observe_v1', 'computer_observe', 'computer_observe_v1', 'v1', 'read_only', '[{"tool":"computer_observe_visible_ui","args":{"target":"joi_current_window"},"risk_level":"read_only"}]', 1, '{"desktop_default":true}')
		ON CONFLICT(id) DO UPDATE SET capability_id=excluded.capability_id, name=excluded.name, version=excluded.version, risk_level=excluded.risk_level, steps=excluded.steps, enabled=excluded.enabled, metadata=excluded.metadata, updated_at=datetime('now');

		INSERT INTO mcp_servers (id, name, transport, command, args, env_secret_refs, enabled, status, trust, metadata)
		VALUES ('local_mcp_registry', 'Local MCP Registry', 'not_configured', '', '[]', '{}', 0, 'inactive', 'untrusted_until_wrapped', '{"policy":"MCP inventory is not executable until wrapped as a Joi capability."}')
		ON CONFLICT(id) DO UPDATE SET name=excluded.name, transport=excluded.transport, trust=excluded.trust, metadata=excluded.metadata, updated_at=datetime('now');

		INSERT INTO skill_definitions (id, version, name, description, trigger_phrases, required_capabilities, forbidden_capabilities, prompt, output_contract, enabled, metadata)
		VALUES
		  ('web_summary_skill', 'v1', 'Web Summary', 'Read an explicit URL and produce a concise sourced summary.', '["总结这个网站","读取 URL","web summary"]', '["web_research"]', '["file_analyze","server_diagnose","system_health_check"]', 'Generate a skill_plan that requests web_research for an explicit URL only.', '{"output_type":"skill_plan","capability_requests":["web_research"]}', 1, '{"source":"native_skill_seed","intent_domain":"public_web_read"}'),
		  ('desktop_inventory_skill', 'v1', 'Desktop Inventory', 'List local installed applications without reading app content.', '["列出本地所有 app","本机有哪些应用","本地所有应用","installed apps"]', '["desktop_app_list"]', '["system_health_check","server_diagnose","file_analyze"]', 'Generate a skill_plan that requests desktop_app_list only.', '{"output_type":"skill_plan","capability_requests":["desktop_app_list"]}', 1, '{"source":"native_skill_seed","intent_domain":"desktop_application_inventory"}')
		ON CONFLICT(id) DO UPDATE SET version=excluded.version, name=excluded.name, description=excluded.description, trigger_phrases=excluded.trigger_phrases, required_capabilities=excluded.required_capabilities, forbidden_capabilities=excluded.forbidden_capabilities, prompt=excluded.prompt, output_contract=excluded.output_contract, enabled=excluded.enabled, metadata=excluded.metadata, updated_at=datetime('now');
	`)
	if err != nil {
		return err
	}
	if err := db.seedSQLiteCapabilityContracts(ctx); err != nil {
		return err
	}
	return db.RegisterSQLiteMainNode(ctx)
}

func (db *DB) seedSQLiteCapabilityContracts(ctx context.Context) error {
	for _, contract := range CapabilityContracts() {
		metadata := CapabilityContractMetadata(contract.ID)
		if _, err := db.sql.ExecContext(ctx, `UPDATE capabilities SET metadata=?, updated_at=datetime('now') WHERE id=?`, mustJSON(mergeCapabilityContractMetadata(contract.ID, metadata)), contract.ID); err != nil {
			return err
		}
	}
	return nil
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
	`, mustJSON([]string{"memory_search", "server_diagnose", "system_health_check", "web_research", "browser_read", "browser_observe", "browser_navigate", "browser_click", "browser_type", "workspace_search", "file_read", "file_analyze", "apply_patch", "shell_command", "test_command", "desktop_app_list", "desktop_app_inspect", "computer_observe"}), mustJSON(map[string]any{"execution": "local"}), mustJSON(map[string]any{"scope": "local"}), mustJSON(map[string]any{"manual_assignable": true, "auto_assignable": true, "allow_private_context": true, "allow_secret_context": false}), mustJSON(map[string]any{"registered_by": "desktop_appcore"}))
	return err
}

func (db *DB) RecoverSQLiteTasks(ctx context.Context, maxAge time.Duration) error {
	seconds := int(maxAge.Seconds())
	if seconds <= 0 {
		seconds = 120
	}
	cutoffModifier := "-" + strconv.Itoa(seconds) + " seconds"

	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, COALESCE(run_id, ''), COALESCE(assigned_node_id, ''),
		       COALESCE((SELECT COUNT(*) FROM task_attempts WHERE task_attempts.task_id = tasks.id), 0)
		FROM tasks
		WHERE status='running' AND started_at < datetime('now', ?)
	`, cutoffModifier)
	if err != nil {
		return err
	}
	type interruptedTask struct {
		id       string
		runID    string
		nodeID   string
		attempts int
	}
	affected := []interruptedTask{}
	for rows.Next() {
		var item interruptedTask
		if err := rows.Scan(&item.id, &item.runID, &item.nodeID, &item.attempts); err != nil {
			rows.Close()
			return err
		}
		affected = append(affected, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(affected) == 0 {
		return nil
	}

	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, task := range affected {
		nextStatus := "retrying"
		title := "Interrupted task recovered"
		if task.attempts >= 3 {
			nextStatus = "dead"
			title = "Interrupted task marked dead"
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE tasks
			SET status=?,
			    error='{"code":"worker_lost","message":"Recovered interrupted running task","recovered":true}',
			    finished_at=CASE WHEN ?='dead' THEN datetime('now') ELSE NULL END
			WHERE id=? AND status='running'
		`, nextStatus, nextStatus, task.id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE task_attempts
			SET status='failed',
			    error='{"code":"worker_lost","message":"Task attempt interrupted by app shutdown","recovered":true}',
			    finished_at=datetime('now')
			WHERE task_id=? AND status='running'
		`, task.id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE tool_runs
			SET status='failed',
			    error='{"code":"interrupted","message":"Tool run interrupted by app shutdown","recovered":true}',
			    finished_at=datetime('now')
			WHERE task_id=? AND status IN ('pending','running')
		`, task.id); err != nil {
			return err
		}
		if task.runID == "" {
			continue
		}
		stepID, err := NewID("step_")
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO run_steps (id, run_id, step_type, title, status, input, output, finished_at, duration_ms)
			VALUES (?, ?, 'recovered', ?, 'succeeded', ?, ?, datetime('now'), 0)
		`, stepID, task.runID, title, mustJSON(map[string]any{"task_id": task.id, "node_id": task.nodeID}), mustJSON(map[string]any{"recovered": true, "interrupted": true, "next_status": nextStatus})); err != nil {
			return err
		}
	}
	return tx.Commit()
}
