package appcore

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

func TestShellCommandRunsReadOnlyCommand(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	root := t.TempDir()
	saveTestWorkspace(t, ctx, core, root)
	result := executeShellCommandForTest(t, ctx, core, map[string]any{
		"cmd":              []any{"pwd"},
		"cwd":              root,
		"timeout_seconds":  10,
		"max_output_bytes": 20000,
	})
	if result.NormalizedResult["mode"] != "shell_command_v1_exec_context" {
		t.Fatalf("unexpected mode: %+v", result.NormalizedResult)
	}
	if result.NormalizedResult["status"] != "completed" || intValue(result.NormalizedResult["exit_code"]) != 0 {
		t.Fatalf("pwd failed: %+v", result.NormalizedResult)
	}
	if stringValue(result.NormalizedResult["stdout"]) == "" {
		t.Fatalf("stdout is empty: %+v", result.NormalizedResult)
	}
}

func TestShellCommandRejectsForbiddenCommand(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	root := t.TempDir()
	saveTestWorkspace(t, ctx, core, root)
	_, err := executeShellCommandForTestWithError(t, ctx, core, map[string]any{
		"cmd": []any{"rm", "-rf", "."},
		"cwd": root,
	})
	if !errors.Is(err, store.ErrPolicyDenied) {
		t.Fatalf("expected policy denial, got %v", err)
	}
}

func TestShellCommandRejectsCwdEscape(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	root := t.TempDir()
	outside := t.TempDir()
	saveTestWorkspace(t, ctx, core, root)
	_, err := executeShellCommandForTestWithError(t, ctx, core, map[string]any{
		"cmd": []any{"pwd"},
		"cwd": outside,
	})
	if err == nil {
		t.Fatalf("outside cwd was allowed")
	}
}

func TestShellCommandRejectsOutsidePathArgument(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	root := t.TempDir()
	saveTestWorkspace(t, ctx, core, root)
	_, err := executeShellCommandForTestWithError(t, ctx, core, map[string]any{
		"cmd": []any{"cat", "/etc/passwd"},
		"cwd": root,
	})
	if !errors.Is(err, store.ErrPolicyDenied) {
		t.Fatalf("expected policy denial, got %v", err)
	}
}

func TestShellCommandCancellationMarksAborted(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.com/joi-shell-cancel\n\ngo 1.23\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "sleep_test.go"), []byte(`package sample

import (
	"testing"
	"time"
)

func TestSleep(t *testing.T) {
	time.Sleep(5 * time.Second)
}
`), 0o644); err != nil {
		t.Fatal(err)
	}
	saveTestWorkspace(t, ctx, core, root)
	tx, err := core.DB().SQL().BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	runCtx, cancel := context.WithCancel(ctx)
	time.AfterFunc(200*time.Millisecond, cancel)
	result, err := core.executeSQLiteShellCommand(runCtx, tx, store.CapabilityRequest{
		Type:       "capability_request",
		Capability: "shell_command",
		Goal:       "run cancellable test command",
		Inputs: map[string]any{
			"cmd":             []any{"go", "test", "./..."},
			"cwd":             root,
			"timeout_seconds": 30,
		},
		Risk: "read_only",
	}, store.ToolWorkflow{WorkflowName: "shell_command_v1", Capability: "shell_command", RiskLevel: "read_only"}, map[string]any{"decision": "allow"})
	if err != nil {
		t.Fatal(err)
	}
	if result.NormalizedResult["status"] != "aborted" {
		t.Fatalf("expected aborted, got %+v", result.NormalizedResult)
	}
}

func TestSandboxReadOnlyBlocksOutsideWrite(t *testing.T) {
	requireSandboxExec(t)
	ctx := context.Background()
	root := realTempDir(t)
	outside := filepath.Join(realTempDir(t), "outside.txt")
	result, err := runSandboxedCommand(ctx, SandboxExecRequest{
		Argv:           []string{"/usr/bin/touch", outside},
		Cwd:            root,
		Profile:        PermissionProfileReadOnly,
		TimeoutSeconds: 5,
		MaxOutputBytes: 20000,
		ReadOnlyRoots:  []string{root},
		WritableRoots:  []string{root},
		Mode:           "sandbox_test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ExitCode == 0 {
		t.Fatalf("outside write succeeded: %+v", result)
	}
	if _, err := os.Stat(outside); err == nil {
		t.Fatalf("outside file was created")
	}
}

func TestSandboxWorkspaceWriteBlocksGitConfig(t *testing.T) {
	requireSandboxExec(t)
	ctx := context.Background()
	root := realTempDir(t)
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	okPath := filepath.Join(root, "ok.txt")
	result, err := runSandboxedCommand(ctx, SandboxExecRequest{
		Argv:           []string{"/usr/bin/touch", okPath},
		Cwd:            root,
		Profile:        PermissionProfileWorkspaceWrite,
		TimeoutSeconds: 5,
		MaxOutputBytes: 20000,
		ReadOnlyRoots:  []string{root},
		WritableRoots:  []string{root},
		Mode:           "sandbox_test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ExitCode != 0 {
		t.Fatalf("workspace write failed: %+v", result)
	}
	gitConfig := filepath.Join(root, ".git", "config")
	result, err = runSandboxedCommand(ctx, SandboxExecRequest{
		Argv:           []string{"/usr/bin/touch", gitConfig},
		Cwd:            root,
		Profile:        PermissionProfileWorkspaceWrite,
		TimeoutSeconds: 5,
		MaxOutputBytes: 20000,
		ReadOnlyRoots:  []string{root},
		WritableRoots:  []string{root},
		Mode:           "sandbox_test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ExitCode == 0 {
		t.Fatalf(".git/config write succeeded: %+v", result)
	}
	if _, err := os.Stat(gitConfig); err == nil {
		t.Fatalf(".git/config was created")
	}
}

func executeShellCommandForTest(t *testing.T, ctx context.Context, core *AppCore, inputs map[string]any) *store.CapabilityExecutionResult {
	t.Helper()
	result, err := executeShellCommandForTestWithError(t, ctx, core, inputs)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func executeShellCommandForTestWithError(t *testing.T, ctx context.Context, core *AppCore, inputs map[string]any) (*store.CapabilityExecutionResult, error) {
	t.Helper()
	runID := insertMinimalRun(t, ctx, core.DB().SQL())
	tx, err := core.DB().SQL().BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	return core.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
		Type:       "capability_request",
		Capability: "shell_command",
		Goal:       "run shell command",
		Inputs:     inputs,
		Risk:       "read_only",
		RunID:      runID,
		Evidence:   "run shell command",
	})
}

func requireSandboxExec(t *testing.T) {
	t.Helper()
	if runtime.GOOS != "darwin" {
		t.Skip("sandbox-exec is macOS-only")
	}
	if _, err := exec.LookPath("sandbox-exec"); err != nil {
		t.Skip("sandbox-exec not available")
	}
}

func realTempDir(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	return resolved
}
