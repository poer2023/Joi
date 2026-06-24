package turnruntime

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

type SQLStore interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

type HistoryStore struct {
	db SQLStore
}

func NewHistoryStore(db SQLStore) *HistoryStore {
	return &HistoryStore{db: db}
}

func (s *HistoryStore) CreateTurn(ctx context.Context, runID string, metadata map[string]any) (TurnRecord, error) {
	if strings.TrimSpace(runID) == "" {
		return TurnRecord{}, errors.New("run_id is required")
	}
	turnID, err := store.NewID("turn_")
	if err != nil {
		return TurnRecord{}, err
	}
	var turnIndex int
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(turn_index), 0) + 1 FROM turns WHERE run_id=?`, runID).Scan(&turnIndex); err != nil {
		return TurnRecord{}, err
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO turns (id, run_id, turn_index, status, metadata)
		VALUES (?, ?, ?, 'running', ?)
	`, turnID, runID, turnIndex, mustJSON(metadata)); err != nil {
		return TurnRecord{}, err
	}
	return s.GetTurn(ctx, turnID)
}

func (s *HistoryStore) GetTurn(ctx context.Context, turnID string) (TurnRecord, error) {
	var record TurnRecord
	var metadataRaw string
	var activeModelCallID sql.NullString
	var cancellationKey sql.NullString
	var startedAtRaw string
	var finishedAtRaw sql.NullString
	if err := s.db.QueryRowContext(ctx, `
		SELECT id, run_id, turn_index, status, COALESCE(active_model_call_id, ''), COALESCE(cancellation_key, ''),
		       started_at, finished_at, metadata
		FROM turns
		WHERE id=?
	`, turnID).Scan(&record.ID, &record.RunID, &record.TurnIndex, &record.Status, &activeModelCallID, &cancellationKey, &startedAtRaw, &finishedAtRaw, &metadataRaw); err != nil {
		return TurnRecord{}, err
	}
	record.ActiveModelCallID = activeModelCallID.String
	record.CancellationKey = cancellationKey.String
	record.StartedAt = parseSQLiteTime(startedAtRaw)
	if finishedAtRaw.Valid && strings.TrimSpace(finishedAtRaw.String) != "" {
		finishedAt := parseSQLiteTime(finishedAtRaw.String)
		record.FinishedAt = &finishedAt
	}
	record.Metadata = decodeObject(metadataRaw)
	return record, nil
}

func (s *HistoryStore) FinishTurn(ctx context.Context, turnID string, status string) error {
	if strings.TrimSpace(turnID) == "" {
		return errors.New("turn_id is required")
	}
	if strings.TrimSpace(status) == "" {
		status = "completed"
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE turns
		SET status=?, finished_at=datetime('now')
		WHERE id=?
	`, status, turnID)
	return err
}

func (s *HistoryStore) AppendTurnItem(ctx context.Context, item TurnItemRecord) (TurnItemRecord, error) {
	if strings.TrimSpace(item.RunID) == "" {
		return TurnItemRecord{}, errors.New("run_id is required")
	}
	if strings.TrimSpace(item.ItemType) == "" {
		return TurnItemRecord{}, errors.New("item_type is required")
	}
	if item.Status == "" {
		item.Status = "completed"
	}
	itemID, err := store.NewID("titem_")
	if err != nil {
		return TurnItemRecord{}, err
	}
	var seq int
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(seq), 0) + 1 FROM turn_items WHERE run_id=?`, item.RunID).Scan(&seq); err != nil {
		return TurnItemRecord{}, err
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO turn_items (
			id, run_id, turn_id, turn_index, seq, item_type, role, call_id, tool_name,
			arguments, content, output, status, provider_item_id, metadata
		) VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, NULLIF(?, ''), ?)
	`, itemID, item.RunID, item.TurnID, item.TurnIndex, seq, item.ItemType, item.Role, item.CallID, item.ToolName, mustJSON(item.Arguments), item.Content, mustJSON(item.Output), item.Status, item.ProviderItemID, mustJSON(item.Metadata)); err != nil {
		return TurnItemRecord{}, err
	}
	item.ID = itemID
	item.Seq = seq
	return item, nil
}

func (s *HistoryStore) ListTurnItems(ctx context.Context, runID string) ([]TurnItemRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, run_id, COALESCE(turn_id, ''), turn_index, seq, item_type,
		       COALESCE(role, ''), COALESCE(call_id, ''), COALESCE(tool_name, ''),
		       arguments, content, output, status, COALESCE(provider_item_id, ''), metadata, created_at
		FROM turn_items
		WHERE run_id=?
		ORDER BY seq ASC
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []TurnItemRecord{}
	for rows.Next() {
		var item TurnItemRecord
		var argumentsRaw, outputRaw, metadataRaw string
		var createdAtRaw string
		if err := rows.Scan(&item.ID, &item.RunID, &item.TurnID, &item.TurnIndex, &item.Seq, &item.ItemType, &item.Role, &item.CallID, &item.ToolName, &argumentsRaw, &item.Content, &outputRaw, &item.Status, &item.ProviderItemID, &metadataRaw, &createdAtRaw); err != nil {
			return nil, err
		}
		item.CreatedAt = parseSQLiteTime(createdAtRaw)
		item.Arguments = decodeObject(argumentsRaw)
		item.Output = decodeObject(outputRaw)
		item.Metadata = decodeObject(metadataRaw)
		items = append(items, item)
	}
	return items, rows.Err()
}

type EventStore struct {
	db SQLStore
}

func NewEventStore(db SQLStore) *EventStore {
	return &EventStore{db: db}
}

// joi-log-coverage: covered-by AppendRunEvent structured run_events writes.
func (s *EventStore) AppendRunEvent(ctx context.Context, runID string, turnID string, eventType string, payload map[string]any) (RunEventRecord, error) {
	if strings.TrimSpace(runID) == "" {
		return RunEventRecord{}, errors.New("run_id is required")
	}
	if strings.TrimSpace(eventType) == "" {
		return RunEventRecord{}, errors.New("event_type is required")
	}
	eventID, err := store.NewID("event_")
	if err != nil {
		return RunEventRecord{}, err
	}
	var seq int
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(seq), 0) + 1 FROM run_events WHERE run_id=?`, runID).Scan(&seq); err != nil {
		return RunEventRecord{}, err
	}
	sanitizedPayload := sanitizedPayloadMap(payload)
	level, riskLevel, category, featureKey, message := runEventLogFields(eventType, sanitizedPayload)
	conversationID := payloadString(sanitizedPayload, "conversation_id")
	itemType := payloadString(sanitizedPayload, "item_type")
	itemID := payloadString(sanitizedPayload, "item_id", "call_id")
	visibility := payloadString(sanitizedPayload, "visibility")
	source := payloadString(sanitizedPayload, "source")
	terminal := payloadBoolInt(sanitizedPayload, "terminal")
	if _, err := s.db.ExecContext(ctx, `
			INSERT INTO run_events (id, run_id, turn_id, conversation_id, seq, event_type, item_type, item_id, visibility, source, terminal, level, risk_level, category, feature_key, message, payload)
			VALUES (?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?)
		`, eventID, runID, turnID, conversationID, seq, eventType, itemType, itemID, visibility, source, terminal, level, riskLevel, category, featureKey, message, mustJSON(sanitizedPayload)); err != nil {
		return RunEventRecord{}, err
	}
	return RunEventRecord{ID: eventID, RunID: runID, TurnID: turnID, Seq: seq, EventType: eventType, Payload: cloneObject(sanitizedPayload)}, nil
}

func sanitizedPayloadMap(payload map[string]any) map[string]any {
	sanitized, _ := store.SanitizeForTrace(payload).(map[string]any)
	if sanitized == nil {
		return map[string]any{}
	}
	return sanitized
}

func runEventLogFields(eventType string, payload map[string]any) (string, string, string, string, string) {
	level := runEventLevel(eventType)
	riskLevel := payloadString(payload, "risk_level", "risk")
	if riskLevel == "" {
		riskLevel = runEventRisk(eventType)
	}
	category := runEventCategory(eventType, payload)
	featureKey := payloadString(payload, "feature_key", "capability", "tool_name")
	if featureKey == "" {
		featureKey = eventType
	}
	message := payloadString(payload, "message", "summary", "title")
	if message == "" {
		message = eventType
	}
	return level, riskLevel, category, featureKey, store.RedactSensitiveText(message)
}

func runEventLevel(eventType string) string {
	lower := strings.ToLower(eventType)
	switch {
	case strings.Contains(lower, "fatal"):
		return "fatal"
	case strings.Contains(lower, "failed"), strings.Contains(lower, "error"):
		return "error"
	case strings.Contains(lower, "denied"), strings.Contains(lower, "blocked"), strings.Contains(lower, "cancelled"), strings.Contains(lower, "aborted"):
		return "warn"
	case strings.Contains(lower, "delta"):
		return "trace"
	case strings.Contains(lower, "started"), strings.Contains(lower, "requested"):
		return "debug"
	default:
		return "info"
	}
}

func runEventRisk(eventType string) string {
	switch {
	case strings.HasPrefix(eventType, "approval."):
		return "state_change"
	case strings.HasPrefix(eventType, "tool."):
		return "workspace_write"
	default:
		return "read_only"
	}
}

func runEventCategory(eventType string, payload map[string]any) string {
	if category := payloadString(payload, "category"); category != "" {
		return category
	}
	if dot := strings.Index(eventType, "."); dot > 0 {
		return eventType[:dot]
	}
	return "runtime"
}

func payloadString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			if text := strings.TrimSpace(typed); text != "" {
				return text
			}
		case []byte:
			if text := strings.TrimSpace(string(typed)); text != "" {
				return text
			}
		}
	}
	return ""
}

func payloadBoolInt(payload map[string]any, key string) int {
	value, ok := payload[key]
	if !ok || value == nil {
		return 0
	}
	switch typed := value.(type) {
	case bool:
		if typed {
			return 1
		}
	case int:
		if typed != 0 {
			return 1
		}
	case float64:
		if typed != 0 {
			return 1
		}
	case string:
		text := strings.ToLower(strings.TrimSpace(typed))
		if text == "1" || text == "true" || text == "yes" {
			return 1
		}
	}
	return 0
}

func (s *EventStore) ListRunEvents(ctx context.Context, runID string, afterSeq int) ([]RunEventRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, run_id, COALESCE(turn_id, ''), seq, event_type, payload, created_at
		FROM run_events
		WHERE run_id=? AND seq > ?
		ORDER BY seq ASC
	`, runID, afterSeq)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []RunEventRecord{}
	for rows.Next() {
		var event RunEventRecord
		var payloadRaw string
		var createdAtRaw string
		if err := rows.Scan(&event.ID, &event.RunID, &event.TurnID, &event.Seq, &event.EventType, &payloadRaw, &createdAtRaw); err != nil {
			return nil, err
		}
		event.CreatedAt = parseSQLiteTime(createdAtRaw)
		event.Payload = decodeObject(payloadRaw)
		events = append(events, event)
	}
	return events, rows.Err()
}

func mustJSON(value map[string]any) string {
	if value == nil {
		return "{}"
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(raw)
}

func decodeObject(raw string) map[string]any {
	if strings.TrimSpace(raw) == "" {
		return map[string]any{}
	}
	value := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return map[string]any{}
	}
	return value
}

func cloneObject(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	cloned := make(map[string]any, len(value))
	for key, item := range value {
		cloned[key] = item
	}
	return cloned
}

func parseSQLiteTime(value string) time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}
	}
	for _, layout := range []string{
		"2006-01-02 15:04:05",
		time.RFC3339Nano,
		time.RFC3339,
	} {
		parsed, err := time.Parse(layout, value)
		if err == nil {
			return parsed
		}
	}
	return time.Time{}
}
