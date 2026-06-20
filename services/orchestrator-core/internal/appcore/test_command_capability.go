package appcore

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

const (
	defaultTestCommandTimeoutSeconds = 60
	maxTestCommandTimeoutSeconds     = 180
	defaultTestCommandOutputBytes    = 120000
	maxTestCommandOutputBytes        = 240000
)

type limitedOutputBuffer struct {
	buffer    bytes.Buffer
	limit     int
	truncated bool
}

func (b *limitedOutputBuffer) Write(p []byte) (int, error) {
	if b.limit <= 0 {
		return len(p), nil
	}
	remaining := b.limit - b.buffer.Len()
	if remaining <= 0 {
		b.truncated = true
		return len(p), nil
	}
	if len(p) > remaining {
		_, _ = b.buffer.Write(p[:remaining])
		b.truncated = true
		return len(p), nil
	}
	_, _ = b.buffer.Write(p)
	return len(p), nil
}

func (a *AppCore) executeSQLiteTestCommand(ctx context.Context, tx *sql.Tx, request store.CapabilityRequest, workflow store.ToolWorkflow, policy map[string]any) (*store.CapabilityExecutionResult, error) {
	settings, err := a.getWorkspaceSettingsFrom(ctx, tx)
	if err != nil {
		return nil, err
	}
	argv := stringSliceFromAny(request.Inputs["cmd"])
	if len(argv) == 0 {
		return nil, errors.New("test_command cmd is required")
	}
	if err := validateTestCommandArgv(argv); err != nil {
		return nil, err
	}
	cwdInput := strings.TrimSpace(stringFromAny(request.Inputs["cwd"]))
	if cwdInput == "" {
		cwdInput = settings.DefaultRoot
	}
	cwd, err := ResolveWorkspacePath(cwdInput, *settings)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(cwd)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, errors.New("test_command cwd must be a directory")
	}
	timeoutSeconds := boundedTestCommandTimeout(request.Inputs["timeout_seconds"])
	maxOutputBytes := boundedTestCommandOutputBytes(request.Inputs["max_output_bytes"])
	runResult, err := runSandboxedCommand(ctx, SandboxExecRequest{
		Argv:           argv,
		Cwd:            cwd,
		Profile:        PermissionProfileReadOnly,
		TimeoutSeconds: timeoutSeconds,
		MaxOutputBytes: maxOutputBytes,
		ReadOnlyRoots:  settings.AllowedRoots,
		WritableRoots:  settings.AllowedRoots,
		Mode:           "test_command_v1_allowlisted_exec",
	})
	if err != nil {
		return nil, err
	}
	status := "succeeded"
	if runResult.Status != "completed" || runResult.ExitCode != 0 {
		status = "failed"
	}
	if runResult.Status == "timed_out" || runResult.Status == "aborted" {
		status = runResult.Status
	}
	normalized := map[string]any{
		"status":           status,
		"cmd":              argv,
		"cwd":              cwd,
		"exit_code":        runResult.ExitCode,
		"output":           runResult.Output,
		"stdout":           runResult.Stdout,
		"stderr":           runResult.Stderr,
		"output_truncated": runResult.Truncated,
		"truncated":        runResult.Truncated,
		"max_output_bytes": maxOutputBytes,
		"timeout_seconds":  timeoutSeconds,
		"duration_ms":      runResult.DurationMS,
		"sandbox":          runResult.Sandbox,
		"error":            runResult.Error,
		"summary":          fmt.Sprintf("test_command %s: %s", status, strings.Join(argv, " ")),
		"mode":             runResult.Mode,
	}
	return &store.CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    policy,
		Workflow:          workflow,
		SelectedNodeID:    "main-node",
		NormalizedResult:  normalized,
	}, nil
}

func validateTestCommandArgv(argv []string) error {
	if len(argv) == 0 {
		return errors.New("cmd is required")
	}
	for _, arg := range argv {
		if strings.TrimSpace(arg) == "" || strings.ContainsRune(arg, '\x00') {
			return store.ErrPolicyDenied
		}
	}
	bin := filepath.Base(argv[0])
	if bin != argv[0] {
		return store.ErrPolicyDenied
	}
	switch bin {
	case "go":
		if len(argv) >= 2 && argv[1] == "test" {
			for _, arg := range argv[2:] {
				if strings.HasPrefix(arg, "-exec") || strings.HasPrefix(arg, "-toolexec") {
					return store.ErrPolicyDenied
				}
			}
			return nil
		}
	case "npm":
		if len(argv) == 2 && argv[1] == "test" {
			return nil
		}
		if len(argv) >= 3 && argv[1] == "run" && allowedNPMTestScript(argv[2]) {
			return nil
		}
	case "pnpm", "yarn":
		if len(argv) >= 2 && allowedNPMTestScript(argv[1]) {
			return nil
		}
	}
	return store.ErrPolicyDenied
}

func allowedNPMTestScript(script string) bool {
	script = strings.TrimSpace(script)
	return script == "test" || script == "build" || strings.HasPrefix(script, "test:")
}

func stringSliceFromAny(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		items := []string{}
		for _, item := range typed {
			text := strings.TrimSpace(fmt.Sprint(item))
			if text != "" {
				items = append(items, text)
			}
		}
		return items
	default:
		return nil
	}
}

func boundedTestCommandTimeout(value any) int {
	timeout := intFromAny(value)
	if timeout <= 0 {
		timeout = defaultTestCommandTimeoutSeconds
	}
	if timeout > maxTestCommandTimeoutSeconds {
		timeout = maxTestCommandTimeoutSeconds
	}
	return timeout
}

func boundedTestCommandOutputBytes(value any) int {
	limit := intFromAny(value)
	if limit <= 0 {
		limit = defaultTestCommandOutputBytes
	}
	if limit > maxTestCommandOutputBytes {
		limit = maxTestCommandOutputBytes
	}
	return limit
}
