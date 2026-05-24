package appcore

import (
	"context"
	"strings"
	"testing"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

func TestSQLiteNodeSchedulerAutoChoosesLeastRunningWorker(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	if _, err := core.DB().SQL().ExecContext(ctx, `
		INSERT INTO nodes (id, name, role, status, capabilities, auto_assign_enabled, manual_assign_enabled, last_heartbeat_at, metadata)
		VALUES
		  ('worker-a', 'Worker A', 'worker', 'healthy', '["web_research_v1"]', 1, 1, datetime('now'), '{}'),
		  ('worker-b', 'Worker B', 'worker', 'healthy', '["web_research_v1"]', 1, 1, datetime('now'), '{}')
		ON CONFLICT(id) DO UPDATE SET status='healthy', capabilities=excluded.capabilities, auto_assign_enabled=1, manual_assign_enabled=1, updated_at=datetime('now');

		INSERT INTO tasks (id, capability_id, assigned_node_id, privacy_level, status, payload)
		VALUES ('task_worker_a_running', 'web_research', 'worker-a', 'public', 'running', '{}')
		ON CONFLICT(id) DO NOTHING;
	`); err != nil {
		t.Fatal(err)
	}
	runID := insertMinimalRun(t, ctx, core.DB().SQL())
	tx, err := core.DB().SQL().BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	result, err := core.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
		Type:          "capability_request",
		Capability:    "web_research",
		Goal:          "queue public research",
		Inputs:        map[string]any{"url": "https://example.com"},
		Risk:          "read_only",
		RunID:         runID,
		PreferredNode: "auto",
		AllowWorker:   true,
	})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if result.SelectedNodeID != "worker-b" {
		t.Fatalf("selected node = %s, want worker-b", result.SelectedNodeID)
	}
	if result.NormalizedResult["assignment_reason"] != "auto_allow_worker" {
		t.Fatalf("unexpected assignment: %+v", result.NormalizedResult)
	}
	var assigned string
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT assigned_node_id FROM tasks WHERE run_id=?`, runID).Scan(&assigned); err != nil {
		t.Fatal(err)
	}
	if assigned != "worker-b" {
		t.Fatalf("task assigned_node_id = %s, want worker-b", assigned)
	}
}

func TestSQLiteNodeSchedulerAutoFallsBackToMainWhenNoEligibleWorker(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	runID := insertMinimalRun(t, ctx, core.DB().SQL())
	tx, err := core.DB().SQL().BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	result, err := core.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
		Type:          "capability_request",
		Capability:    "web_research",
		Goal:          "private URL should stay on main-node and be policy checked",
		Inputs:        map[string]any{"url": "http://127.0.0.1:1"},
		Risk:          "read_only",
		RunID:         runID,
		PreferredNode: "auto",
		AllowWorker:   true,
	})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if result.SelectedNodeID != "main-node" || result.NormalizedResult["assignment_reason"] != "default_main_node" {
		t.Fatalf("expected main-node fallback, got %+v", result.NormalizedResult)
	}
	var taskCount int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks WHERE run_id=?`, runID).Scan(&taskCount); err != nil {
		t.Fatal(err)
	}
	if taskCount != 0 {
		t.Fatalf("auto fallback should not enqueue worker task, got %d tasks", taskCount)
	}
}

func TestSQLiteNodeSchedulerManualFailureDoesNotFallback(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	if _, err := core.DB().SQL().ExecContext(ctx, `
		INSERT INTO nodes (id, name, role, status, capabilities, auto_assign_enabled, manual_assign_enabled, last_heartbeat_at, metadata)
		VALUES ('no-web-worker', 'No Web Worker', 'worker', 'healthy', '["system_health_check_self"]', 1, 1, datetime('now'), '{}')
		ON CONFLICT(id) DO UPDATE SET status='healthy', capabilities=excluded.capabilities, manual_assign_enabled=1, updated_at=datetime('now');
	`); err != nil {
		t.Fatal(err)
	}
	runID := insertMinimalRun(t, ctx, core.DB().SQL())
	tx, err := core.DB().SQL().BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = core.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
		Type:          "capability_request",
		Capability:    "web_research",
		Goal:          "manual node missing capability",
		Inputs:        map[string]any{"url": "https://example.com"},
		Risk:          "read_only",
		RunID:         runID,
		PreferredNode: "no-web-worker",
		AllowWorker:   true,
	})
	_ = tx.Rollback()
	if err == nil || !strings.Contains(err.Error(), "capability web_research is not registered") {
		t.Fatalf("manual invalid node error = %v", err)
	}
	var taskCount int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks WHERE run_id=?`, runID).Scan(&taskCount); err != nil {
		t.Fatal(err)
	}
	if taskCount != 0 {
		t.Fatalf("manual failure should not fallback or enqueue, got %d tasks", taskCount)
	}
}

func TestSQLiteNodeSchedulerWorkerCapabilityBoundary(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	if _, err := core.DB().SQL().ExecContext(ctx, `
		INSERT INTO nodes (id, name, role, status, capabilities, auto_assign_enabled, manual_assign_enabled, last_heartbeat_at, metadata)
		VALUES
		  ('diagnose-worker', 'Diagnose Worker', 'worker', 'healthy', '["server_diagnose_v1"]', 1, 1, datetime('now'), '{}'),
		  ('health-worker', 'Health Worker', 'worker', 'healthy', '["system_health_check_self"]', 1, 1, datetime('now'), '{}')
		ON CONFLICT(id) DO UPDATE SET status='healthy', capabilities=excluded.capabilities, auto_assign_enabled=1, manual_assign_enabled=1, updated_at=datetime('now');
	`); err != nil {
		t.Fatal(err)
	}

	runID := insertMinimalRun(t, ctx, core.DB().SQL())
	tx, err := core.DB().SQL().BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = core.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
		Type:          "capability_request",
		Capability:    "server_diagnose",
		Goal:          "server diagnose must not go to worker",
		Inputs:        map[string]any{"service_name": "cloudflared"},
		Risk:          "read_only",
		RunID:         runID,
		PreferredNode: "diagnose-worker",
		AllowWorker:   true,
	})
	_ = tx.Rollback()
	if err == nil || !strings.Contains(err.Error(), "not allowed on worker") {
		t.Fatalf("server_diagnose manual worker error = %v", err)
	}

	runID = insertMinimalRun(t, ctx, core.DB().SQL())
	tx, err = core.DB().SQL().BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	result, err := core.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
		Type:          "capability_request",
		Capability:    "system_health_check",
		Goal:          "health check can run on worker",
		Inputs:        map[string]any{},
		Risk:          "read_only",
		RunID:         runID,
		PreferredNode: "health-worker",
		AllowWorker:   true,
	})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if result.SelectedNodeID != "health-worker" || result.NormalizedResult["status"] != "queued" {
		t.Fatalf("system_health_check should queue on health-worker, got %+v", result.NormalizedResult)
	}
}
