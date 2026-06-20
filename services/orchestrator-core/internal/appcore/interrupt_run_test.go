package appcore

import (
	"context"
	"testing"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

func TestInterruptRunCancelsActiveTurnAndMarksAborted(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	runID := insertMinimalRun(t, ctx, core.DB().SQL())
	turnID, err := store.NewID("turn_")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := core.DB().SQL().ExecContext(ctx, `
		INSERT INTO turns (id, run_id, turn_index, status, metadata)
		VALUES (?, ?, 1, 'running', '{}')
	`, turnID, runID); err != nil {
		t.Fatal(err)
	}
	cancelled := false
	if core.turns == nil {
		core.turns = NewTurnManager()
	}
	if err := core.turns.Start(runID, turnID, "conv_security_worker_payload", func() { cancelled = true }); err != nil {
		t.Fatal(err)
	}
	if err := core.InterruptRun(ctx, runID, "test_interrupt"); err != nil {
		t.Fatal(err)
	}
	if !cancelled {
		t.Fatalf("InterruptRun did not call active cancel func")
	}
	var runStatus string
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT status FROM runs WHERE id=?`, runID).Scan(&runStatus); err != nil {
		t.Fatal(err)
	}
	if runStatus != "aborted" {
		t.Fatalf("run status = %s, want aborted", runStatus)
	}
	var turnStatus string
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT status FROM turns WHERE id=?`, turnID).Scan(&turnStatus); err != nil {
		t.Fatal(err)
	}
	if turnStatus != "aborted" {
		t.Fatalf("turn status = %s, want aborted", turnStatus)
	}
	if !runHasEvent(t, ctx, core, runID, "run.aborted") || !runHasEvent(t, ctx, core, runID, "turn.aborted") {
		t.Fatalf("interrupt events missing")
	}
	if _, ok := core.turns.Get(runID); ok {
		t.Fatalf("active turn should be removed after interrupt")
	}
}

func runHasEvent(t *testing.T, ctx context.Context, core *AppCore, runID string, eventType string) bool {
	t.Helper()
	var count int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM run_events WHERE run_id=? AND event_type=?`, runID, eventType).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count > 0
}
