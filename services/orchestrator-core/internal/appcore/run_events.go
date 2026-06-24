package appcore

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

type sqliteRunEventWriter interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// joi-log-coverage: covered-by appendSQLiteRunEvent structured run_events writes.
func appendSQLiteRunEvent(ctx context.Context, db sqliteRunEventWriter, runID string, turnID string, eventType string, payload map[string]any) (string, error) {
	runID = strings.TrimSpace(runID)
	eventType = strings.TrimSpace(eventType)
	if runID == "" {
		return "", errors.New("run_id is required")
	}
	if eventType == "" {
		return "", errors.New("event_type is required")
	}
	eventID, err := store.NewID("event_")
	if err != nil {
		return "", err
	}
	var seq int
	if err := db.QueryRowContext(ctx, `SELECT COALESCE(MAX(seq), 0) + 1 FROM run_events WHERE run_id=?`, runID).Scan(&seq); err != nil {
		return "", err
	}
	sanitizedPayload := sanitizedPayloadMap(payload)
	level, riskLevel, category, featureKey, message := runEventLogFields(eventType, sanitizedPayload)
	conversationID := payloadString(sanitizedPayload, "conversation_id")
	itemType := payloadString(sanitizedPayload, "item_type")
	itemID := payloadString(sanitizedPayload, "item_id", "call_id")
	visibility := payloadString(sanitizedPayload, "visibility")
	source := payloadString(sanitizedPayload, "source")
	terminal := payloadBoolInt(sanitizedPayload, "terminal")
	_, err = db.ExecContext(ctx, `
			INSERT INTO run_events (id, run_id, turn_id, conversation_id, seq, event_type, item_type, item_id, visibility, source, terminal, level, risk_level, category, feature_key, message, payload)
			VALUES (?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?)
		`, eventID, runID, strings.TrimSpace(turnID), conversationID, seq, eventType, itemType, itemID, visibility, source, terminal, level, riskLevel, category, featureKey, message, mustJSON(sanitizedPayload))
	if err != nil {
		return "", err
	}
	return eventID, nil
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

func appendAndEmitSQLiteRunEvent(ctx context.Context, db sqliteRunEventWriter, sink func(string, map[string]any), runID string, turnID string, eventType string, payload map[string]any) error {
	if _, err := appendSQLiteRunEvent(ctx, db, runID, turnID, eventType, payload); err != nil {
		return err
	}
	if sink != nil {
		sink(eventType, cloneMap(payload))
	}
	return nil
}
