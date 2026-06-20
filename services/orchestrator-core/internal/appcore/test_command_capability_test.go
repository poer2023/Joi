package appcore

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

func TestTestCommandCapabilityRunsGoTest(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.com/joi-test-command\n\ngo 1.23\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "sample_test.go"), []byte(`package sample

import "testing"

func TestSample(t *testing.T) {}
`), 0o644); err != nil {
		t.Fatal(err)
	}
	saveTestWorkspace(t, ctx, core, root)
	result := executeTestCommandForTest(t, ctx, core, map[string]any{
		"cmd":                []any{"go", "test", "./..."},
		"cwd":                root,
		"timeout_seconds":    30,
		"max_output_bytes":   20000,
		"permission_profile": "read_only",
	})
	if result.NormalizedResult["mode"] != "test_command_v1_allowlisted_exec" {
		t.Fatalf("unexpected mode: %+v", result.NormalizedResult)
	}
	if result.NormalizedResult["status"] != "succeeded" || intValue(result.NormalizedResult["exit_code"]) != 0 {
		t.Fatalf("go test failed: %+v", result.NormalizedResult)
	}
	if !strings.Contains(stringValue(result.NormalizedResult["output"]), "ok") {
		t.Fatalf("go test output missing ok: %+v", result.NormalizedResult)
	}
}

func TestTestCommandCapabilityRejectsUnsafeCommand(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	root := t.TempDir()
	saveTestWorkspace(t, ctx, core, root)
	_, err := executeTestCommandForTestWithError(t, ctx, core, map[string]any{
		"cmd": []any{"rm", "-rf", "."},
		"cwd": root,
	})
	if err == nil {
		t.Fatalf("unsafe test_command was allowed")
	}
}

func executeTestCommandForTest(t *testing.T, ctx context.Context, core *AppCore, inputs map[string]any) *store.CapabilityExecutionResult {
	t.Helper()
	result, err := executeTestCommandForTestWithError(t, ctx, core, inputs)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func executeTestCommandForTestWithError(t *testing.T, ctx context.Context, core *AppCore, inputs map[string]any) (*store.CapabilityExecutionResult, error) {
	t.Helper()
	runID := insertMinimalRun(t, ctx, core.DB().SQL())
	tx, err := core.DB().SQL().BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	return core.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
		Type:       "capability_request",
		Capability: "test_command",
		Goal:       "run tests",
		Inputs:     inputs,
		Risk:       "read_only",
		RunID:      runID,
		Evidence:   "run tests",
	})
}
