package appcore

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

func (a *AppCore) InterruptRun(ctx context.Context, runID string, reason string) error {
	if a == nil || a.db == nil {
		return errors.New("appcore db is not available")
	}
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return errors.New("run_id is required")
	}
	if reason = strings.TrimSpace(reason); reason == "" {
		reason = "user_interrupt"
	}
	if a.turns == nil {
		a.turns = NewTurnManager()
	}
	active, activeOK := a.turns.Interrupt(runID, reason)
	if activeOK {
		err := a.markSQLiteRunAborted(ctx, runID, active.TurnID, reason)
		a.turns.Finish(runID)
		return err
	}
	if !a.isSQLite() {
		return errors.New("interrupt is currently implemented for SQLite desktop mode")
	}
	var currentStatus string
	var turnID sql.NullString
	err := a.db.SQL().QueryRowContext(ctx, `
		SELECT status, (
			SELECT id
			FROM turns
			WHERE turns.run_id=runs.id AND status='running'
			ORDER BY turn_index DESC
			LIMIT 1
		)
		FROM runs
		WHERE id=?
	`, runID).Scan(&currentStatus, &turnID)
	if err != nil {
		return err
	}
	switch currentStatus {
	case "running", "waiting_tool", "waiting_confirmation", "queued":
		return a.markSQLiteRunAborted(ctx, runID, turnID.String, reason)
	default:
		return errors.New("run is not active")
	}
}

func (a *AppCore) markSQLiteRunAborted(ctx context.Context, runID string, turnID string, reason string) error {
	if !a.isSQLite() {
		return errors.New("interrupt is currently implemented for SQLite desktop mode")
	}
	if _, err := a.db.SQL().ExecContext(ctx, `
		UPDATE runs
		SET status='aborted',
		    error_code='interrupted',
		    error_message=?,
		    finished_at=datetime('now'),
		    duration_ms=CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER)
		WHERE id=?
	`, reason, runID); err != nil {
		return err
	}
	if strings.TrimSpace(turnID) != "" {
		if _, err := a.db.SQL().ExecContext(ctx, `
			UPDATE turns
			SET status='aborted',
			    finished_at=datetime('now')
			WHERE id=?
		`, turnID); err != nil {
			return err
		}
		if _, err := appendSQLiteRunEvent(ctx, a.db.SQL(), runID, turnID, "turn.aborted", map[string]any{"run_id": runID, "turn_id": turnID, "status": "aborted", "reason": reason}); err != nil {
			return err
		}
	}
	_, err := appendSQLiteRunEvent(ctx, a.db.SQL(), runID, turnID, "run.aborted", map[string]any{"run_id": runID, "status": "aborted", "reason": reason})
	return err
}
