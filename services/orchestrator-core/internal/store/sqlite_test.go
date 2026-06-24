package store

import (
	"context"
	"path/filepath"
	"testing"
)

func TestApplySQLiteSchemaMigratesLegacyRunEvents(t *testing.T) {
	ctx := context.Background()
	db, err := OpenSQLite(ctx, filepath.Join(t.TempDir(), "joi.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	schemaPath := filepath.Join("..", "..", "..", "..", "database", "sqlite", "001_init_schema.sql")
	if err := db.ApplySQLiteSchema(ctx, schemaPath); err != nil {
		t.Fatal(err)
	}
	if _, err := db.SQL().ExecContext(ctx, `
		INSERT INTO runs (id, status, route_result, metadata)
		VALUES ('run_legacy_events', 'running', '{}', '{}');

		DROP INDEX IF EXISTS idx_run_events_run_id;
		DROP TABLE run_events;
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
		INSERT INTO run_events (id, run_id, seq, event_type, item_id, item_type, status, metadata)
		VALUES ('evt_legacy_1', 'run_legacy_events', 1, 'legacy.item', 'item_1', 'tool', 'completed', '{"legacy":true}');
	`); err != nil {
		t.Fatal(err)
	}

	if err := db.ApplySQLiteSchema(ctx, schemaPath); err != nil {
		t.Fatal(err)
	}
	columns, err := db.sqliteColumnSet(ctx, "run_events")
	if err != nil {
		t.Fatal(err)
	}
	if !columns["turn_id"] || !columns["payload"] || !columns["level"] || !columns["risk_level"] || !columns["category"] || !columns["feature_key"] || !columns["message"] || !columns["conversation_id"] || !columns["item_id"] || !columns["item_type"] {
		t.Fatalf("run_events columns missing current fields: %+v", columns)
	}
	if columns["snapshot"] || columns["delta"] {
		t.Fatalf("run_events still has legacy columns after migration: %+v", columns)
	}
	if _, err := db.SQL().ExecContext(ctx, `
		INSERT INTO run_events (id, run_id, turn_id, seq, event_type, payload)
		VALUES ('evt_current_1', 'run_legacy_events', NULL, 2, 'assistant.completed', '{"ok":true}');
	`); err != nil {
		t.Fatalf("current run_events insert failed after migration: %v", err)
	}
	var count int
	if err := db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM run_events WHERE run_id='run_legacy_events'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("run_events count = %d, want 2", count)
	}
}
