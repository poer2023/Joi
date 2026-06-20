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
	_, err = db.ExecContext(ctx, `
		INSERT INTO run_events (id, run_id, turn_id, seq, event_type, payload)
		VALUES (?, ?, NULLIF(?, ''), ?, ?, ?)
	`, eventID, runID, strings.TrimSpace(turnID), seq, eventType, mustJSON(store.SanitizeForTrace(payload)))
	if err != nil {
		return "", err
	}
	return eventID, nil
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
