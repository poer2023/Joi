package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
)

func TestCompileCapabilitySeedsAndPolicy(t *testing.T) {
	ctx := context.Background()
	db := openCapabilityTestDB(t, ctx)
	defer db.Close()

	for _, tc := range []struct {
		capability string
		workflow   string
	}{
		{"memory_search", "memory_search_v1"},
		{"server_diagnose", "server_diagnose_v1"},
		{"system_health_check", "system_health_check_v1"},
		{"web_research", "web_research_v2"},
		{"workspace_search", "workspace_search_v1"},
		{"file_analyze", "file_analyze_v1"},
	} {
		t.Run(tc.capability, func(t *testing.T) {
			result, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{Capability: tc.capability, Risk: "read_only"})
			if err != nil {
				t.Fatalf("CompileCapability() error = %v", err)
			}
			if result.Workflow.WorkflowName != tc.workflow {
				t.Fatalf("workflow = %s, want %s", result.Workflow.WorkflowName, tc.workflow)
			}
			if len(result.Workflow.Steps) == 0 {
				t.Fatalf("workflow %s has no steps", tc.workflow)
			}
		})
	}
}

func TestCompileCapabilityRejectsDisabledWorkflowAndTool(t *testing.T) {
	ctx := context.Background()
	db := openCapabilityTestDB(t, ctx)
	defer db.Close()

	if _, err := db.SQL().ExecContext(ctx, `UPDATE tool_workflows SET enabled=0 WHERE name='file_analyze_v1'`); err != nil {
		t.Fatal(err)
	}
	if _, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{Capability: "file_analyze", Risk: "read_only"}); !errors.Is(err, ErrPolicyDenied) {
		t.Fatalf("disabled workflow error = %v, want ErrPolicyDenied", err)
	}

	if _, err := db.SQL().ExecContext(ctx, `UPDATE tool_workflows SET enabled=1 WHERE name='file_analyze_v1'`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.SQL().ExecContext(ctx, `UPDATE tools SET enabled=0 WHERE id='file_read_authorized'`); err != nil {
		t.Fatal(err)
	}
	if _, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{Capability: "file_analyze", Risk: "read_only"}); !errors.Is(err, ErrPolicyDenied) {
		t.Fatalf("disabled tool error = %v, want ErrPolicyDenied", err)
	}
}

func TestCompileCapabilityRiskPolicy(t *testing.T) {
	ctx := context.Background()
	db := openCapabilityTestDB(t, ctx)
	defer db.Close()

	if _, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{Capability: "server_diagnose", Risk: "state_change", Goal: "restart service"}); !errors.Is(err, ErrPolicyDenied) {
		t.Fatalf("state_change error = %v, want ErrPolicyDenied", err)
	}
	var confirmations int
	if err := db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM confirmation_requests WHERE risk_level='state_change'`).Scan(&confirmations); err != nil {
		t.Fatal(err)
	}
	if confirmations != 1 {
		t.Fatalf("state_change confirmations = %d, want 1", confirmations)
	}

	if _, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{Capability: "server_diagnose", Risk: "destructive", Goal: "delete service"}); !errors.Is(err, ErrPolicyDenied) {
		t.Fatalf("destructive error = %v, want ErrPolicyDenied", err)
	}
	if err := db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM confirmation_requests`).Scan(&confirmations); err != nil {
		t.Fatal(err)
	}
	if confirmations != 1 {
		t.Fatalf("destructive risk should not create confirmation, got %d confirmations", confirmations)
	}

	if _, err := db.SQL().ExecContext(ctx, `UPDATE tool_workflows SET risk_level='state_change' WHERE name='server_diagnose_v1'`); err != nil {
		t.Fatal(err)
	}
	if _, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{Capability: "server_diagnose", Risk: "read_only", Goal: "diagnose service"}); !errors.Is(err, ErrPolicyDenied) {
		t.Fatalf("workflow risk escalation error = %v, want ErrPolicyDenied", err)
	}
	if err := db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM confirmation_requests`).Scan(&confirmations); err != nil {
		t.Fatal(err)
	}
	if confirmations != 2 {
		t.Fatalf("state_change workflow confirmations = %d, want 2", confirmations)
	}
}

func openCapabilityTestDB(t *testing.T, ctx context.Context) *DB {
	t.Helper()
	db, err := OpenSQLite(ctx, filepath.Join(t.TempDir(), "joi.db"))
	if err != nil {
		t.Fatal(err)
	}
	schemaPath := filepath.Join("..", "..", "..", "..", "database", "sqlite", "001_init_schema.sql")
	if err := db.ApplySQLiteSchema(ctx, schemaPath); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.SeedSQLiteDefaults(ctx); err != nil {
		db.Close()
		t.Fatal(err)
	}
	return db
}
