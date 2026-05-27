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
	if _, err := db.sql.ExecContext(ctx, schemaSQL); err != nil {
		return err
	}
	if err := db.EnsureSQLiteConversationLifecycle(ctx); err != nil {
		return err
	}
	return db.RebuildSQLiteMemoryFTS(ctx)
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

func (db *DB) sqliteColumnExists(ctx context.Context, table string, column string) (bool, error) {
	if table != "conversations" {
		return false, nil
	}
	rows, err := db.sql.QueryContext(ctx, `PRAGMA table_info(conversations)`)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, dataType string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
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
		  ('general_agent', 'General Agent', 'General purpose desktop agent.', 'mock-model', '["memory_search"]', '{"keywords":[]}', 1, '{"desktop_default":true}'),
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
		  ('workspace_search', 'Workspace Search', 'Search authorized workspace source and documents.', 'read_only', 1, '{"desktop_default":true}'),
		  ('file_analyze', 'File Analyze', 'Analyze an authorized workspace file.', 'read_only', 1, '{"desktop_default":true}'),
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
		  ('desktop_list_app_bundles', 'Desktop List App Bundles', 'List installed macOS .app bundles as bounded local metadata.', 'read_only', '["main-node"]', 10, 1, '{"desktop_default":true}'),
		  ('desktop_inspect_app_bundle', 'Desktop Inspect App Bundle', 'Inspect one installed macOS .app bundle as local metadata.', 'read_only', '["main-node"]', 10, 1, '{"desktop_default":true}'),
		  ('workspace_walk_search', 'Workspace Walk Search', 'Search authorized workspace paths without arbitrary shell flags.', 'read_only', '["main-node"]', 10, 1, '{"desktop_default":true}'),
		  ('file_read_authorized', 'File Read Authorized', 'Read a bounded authorized workspace file.', 'read_only', '["main-node"]', 10, 1, '{"desktop_default":true}'),
		  ('file_summarize_excerpts', 'File Summarize Excerpts', 'Summarize bounded file excerpts.', 'read_only', '["main-node"]', 10, 1, '{"desktop_default":true}'),
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
		  ('workflow_desktop_app_list_v1', 'desktop_app_list', 'desktop_app_list_v1', 'v1', 'read_only', '[{"tool":"desktop_list_app_bundles","args":{},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
		  ('workflow_desktop_app_inspect_v1', 'desktop_app_inspect', 'desktop_app_inspect_v1', 'v1', 'read_only', '[{"tool":"desktop_inspect_app_bundle","args":{},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
		  ('workflow_workspace_search_v1', 'workspace_search', 'workspace_search_v1', 'v1', 'read_only', '[{"tool":"workspace_walk_search","args":{},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
		  ('workflow_file_analyze_v1', 'file_analyze', 'file_analyze_v1', 'v1', 'read_only', '[{"tool":"file_read_authorized","args":{},"risk_level":"read_only"},{"tool":"file_summarize_excerpts","args":{},"risk_level":"read_only"}]', 1, '{"desktop_default":true}'),
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
	`, mustJSON([]string{"memory_search", "server_diagnose", "system_health_check", "web_research", "browser_read", "workspace_search", "file_analyze", "desktop_app_list", "desktop_app_inspect", "computer_observe"}), mustJSON(map[string]any{"execution": "local"}), mustJSON(map[string]any{"scope": "local"}), mustJSON(map[string]any{"manual_assignable": true, "auto_assignable": true, "allow_private_context": true, "allow_secret_context": false}), mustJSON(map[string]any{"registered_by": "desktop_appcore"}))
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
