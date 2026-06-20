package turnruntime

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

func TestHistoryStoreCreatesTurnsAndItems(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t, ctx)
	runID := seedRun(t, ctx, db)

	history := NewHistoryStore(db.SQL())
	turn, err := history.CreateTurn(ctx, runID, map[string]any{"source": "test"})
	if err != nil {
		t.Fatalf("CreateTurn() error = %v", err)
	}
	if turn.TurnIndex != 1 || turn.Status != "running" {
		t.Fatalf("turn = %+v, want index 1 running", turn)
	}
	if turn.Metadata["source"] != "test" {
		t.Fatalf("turn metadata = %+v, want source=test", turn.Metadata)
	}

	if _, err := history.AppendTurnItem(ctx, TurnItemRecord{
		RunID:     runID,
		TurnID:    turn.ID,
		TurnIndex: turn.TurnIndex,
		ItemType:  "message",
		Role:      "user",
		Content:   "find SendChat",
	}); err != nil {
		t.Fatalf("AppendTurnItem(message) error = %v", err)
	}
	if _, err := history.AppendTurnItem(ctx, TurnItemRecord{
		RunID:     runID,
		TurnID:    turn.ID,
		TurnIndex: turn.TurnIndex,
		ItemType:  "tool_call",
		CallID:    "call_1",
		ToolName:  "workspace_search",
		Arguments: map[string]any{"query": "SendChat"},
	}); err != nil {
		t.Fatalf("AppendTurnItem(tool_call) error = %v", err)
	}

	items, err := history.ListTurnItems(ctx, runID)
	if err != nil {
		t.Fatalf("ListTurnItems() error = %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("items len = %d, want 2", len(items))
	}
	if items[0].Seq != 1 || items[1].Seq != 2 {
		t.Fatalf("item seqs = %d,%d, want 1,2", items[0].Seq, items[1].Seq)
	}
	if items[1].Arguments["query"] != "SendChat" {
		t.Fatalf("tool call args = %+v, want query", items[1].Arguments)
	}
}

func TestEventStoreAppendsRunEventsAfterSeq(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t, ctx)
	runID := seedRun(t, ctx, db)
	history := NewHistoryStore(db.SQL())
	turn, err := history.CreateTurn(ctx, runID, nil)
	if err != nil {
		t.Fatalf("CreateTurn() error = %v", err)
	}

	events := NewEventStore(db.SQL())
	if _, err := events.AppendRunEvent(ctx, runID, turn.ID, "turn.started", map[string]any{"turn_index": turn.TurnIndex}); err != nil {
		t.Fatalf("AppendRunEvent(turn.started) error = %v", err)
	}
	if _, err := events.AppendRunEvent(ctx, runID, turn.ID, "assistant.delta", map[string]any{"text": "hello"}); err != nil {
		t.Fatalf("AppendRunEvent(assistant.delta) error = %v", err)
	}

	list, err := events.ListRunEvents(ctx, runID, 0)
	if err != nil {
		t.Fatalf("ListRunEvents() error = %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("events len = %d, want 2", len(list))
	}
	if list[0].Seq != 1 || list[1].Seq != 2 {
		t.Fatalf("event seqs = %d,%d, want 1,2", list[0].Seq, list[1].Seq)
	}
	if list[1].Payload["text"] != "hello" {
		t.Fatalf("assistant delta payload = %+v, want text", list[1].Payload)
	}

	afterFirst, err := events.ListRunEvents(ctx, runID, 1)
	if err != nil {
		t.Fatalf("ListRunEvents(afterSeq) error = %v", err)
	}
	if len(afterFirst) != 1 || afterFirst[0].EventType != "assistant.delta" {
		t.Fatalf("afterFirst = %+v, want assistant.delta only", afterFirst)
	}
}

func newTestDB(t *testing.T, ctx context.Context) *store.DB {
	t.Helper()
	db, err := store.OpenSQLite(ctx, filepath.Join(t.TempDir(), "joi.db"))
	if err != nil {
		t.Fatalf("OpenSQLite() error = %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	schemaPath := filepath.Join("..", "..", "..", "..", "database", "sqlite", "001_init_schema.sql")
	if err := db.ApplySQLiteSchema(ctx, schemaPath); err != nil {
		t.Fatalf("ApplySQLiteSchema() error = %v", err)
	}
	return db
}

func seedRun(t *testing.T, ctx context.Context, db *store.DB) string {
	t.Helper()
	conversationID, err := store.NewID("conv_")
	if err != nil {
		t.Fatalf("NewID(conversation) error = %v", err)
	}
	messageID, err := store.NewID("msg_")
	if err != nil {
		t.Fatalf("NewID(message) error = %v", err)
	}
	runID, err := store.NewID("run_")
	if err != nil {
		t.Fatalf("NewID(run) error = %v", err)
	}
	if _, err := db.SQL().ExecContext(ctx, `INSERT OR IGNORE INTO agents (id, name, description, system_prompt) VALUES ('general_agent', 'General Agent', 'test agent', '')`); err != nil {
		t.Fatalf("insert agent error = %v", err)
	}
	if _, err := db.SQL().ExecContext(ctx, `INSERT INTO conversations (id, channel, user_id, active_agent_id, title) VALUES (?, 'test', 'tester', 'general_agent', 'test')`, conversationID); err != nil {
		t.Fatalf("insert conversation error = %v", err)
	}
	if _, err := db.SQL().ExecContext(ctx, `INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', 'hello')`, messageID, conversationID); err != nil {
		t.Fatalf("insert message error = %v", err)
	}
	if _, err := db.SQL().ExecContext(ctx, `INSERT INTO runs (id, conversation_id, user_message_id, status, selected_agent_id) VALUES (?, ?, ?, 'running', 'general_agent')`, runID, conversationID, messageID); err != nil {
		t.Fatalf("insert run error = %v", err)
	}
	return runID
}
