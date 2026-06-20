package appcore

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

type SandboxRunner interface {
	Run(ctx context.Context, req SandboxExecRequest) (*SandboxExecResult, error)
}

type SandboxExecRequest struct {
	Argv           []string
	Cwd            string
	Profile        PermissionProfile
	TimeoutSeconds int
	MaxOutputBytes int
	ReadOnlyRoots  []string
	WritableRoots  []string
	Mode           string
}

type SandboxExecResult struct {
	Status     string         `json:"status"`
	ExitCode   int            `json:"exit_code"`
	Stdout     string         `json:"stdout"`
	Stderr     string         `json:"stderr"`
	Output     string         `json:"output"`
	Truncated  bool           `json:"truncated"`
	DurationMS int64          `json:"duration_ms"`
	Mode       string         `json:"mode"`
	Sandbox    map[string]any `json:"sandbox"`
	Error      string         `json:"error"`
}

type macOSSandboxRunner struct{}

func defaultSandboxRunner() SandboxRunner {
	return macOSSandboxRunner{}
}

func runSandboxedCommand(ctx context.Context, req SandboxExecRequest) (*SandboxExecResult, error) {
	return defaultSandboxRunner().Run(ctx, req)
}

func (macOSSandboxRunner) Run(ctx context.Context, req SandboxExecRequest) (*SandboxExecResult, error) {
	if len(req.Argv) == 0 {
		return nil, errors.New("sandbox command argv is required")
	}
	if strings.TrimSpace(req.Cwd) == "" {
		return nil, errors.New("sandbox command cwd is required")
	}
	if req.TimeoutSeconds <= 0 {
		req.TimeoutSeconds = defaultShellCommandTimeoutSeconds
	}
	if req.MaxOutputBytes <= 0 {
		req.MaxOutputBytes = defaultShellCommandOutputBytes
	}
	if req.Profile == "" {
		req.Profile = PermissionProfileReadOnly
	}

	tempDir, err := os.MkdirTemp("", "joi-sandbox-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tempDir)
	tempDir, err = filepath.EvalSymlinks(tempDir)
	if err != nil {
		return nil, err
	}
	for _, dir := range []string{"go-cache", "go-tmp", "npm-cache", "yarn-cache", "pnpm-home", "xdg-cache"} {
		if err := os.MkdirAll(filepath.Join(tempDir, dir), 0o700); err != nil {
			return nil, err
		}
	}

	runCtx, cancel := context.WithTimeout(ctx, time.Duration(req.TimeoutSeconds)*time.Second)
	defer cancel()

	executable := req.Argv[0]
	args := append([]string{}, req.Argv[1:]...)
	sandbox := map[string]any{
		"engine":          "none",
		"enforced":        false,
		"profile":         string(req.Profile),
		"temp_dir":        tempDir,
		"read_only_roots": append([]string{}, req.ReadOnlyRoots...),
		"writable_roots":  append([]string{}, req.WritableRoots...),
	}
	if req.Profile != PermissionProfileDangerFullAccess && runtime.GOOS == "darwin" {
		if sandboxExec, err := exec.LookPath("sandbox-exec"); err == nil {
			profile := macOSSandboxProfile(req, tempDir)
			executable = sandboxExec
			args = append([]string{"-p", profile, "--"}, req.Argv...)
			sandbox["engine"] = "sandbox-exec"
			sandbox["enforced"] = true
		} else {
			sandbox["reason"] = "sandbox-exec not found"
		}
	} else if req.Profile == PermissionProfileDangerFullAccess {
		sandbox["reason"] = "danger_full_access profile bypasses OS sandbox"
	} else {
		sandbox["reason"] = "macOS sandbox-exec is only available on darwin"
	}

	cmd := exec.CommandContext(runCtx, executable, args...)
	cmd.Dir = req.Cwd
	cmd.Env = sandboxCommandEnv(os.Environ(), tempDir)
	stdout := &limitedOutputBuffer{limit: req.MaxOutputBytes}
	stderr := &limitedOutputBuffer{limit: req.MaxOutputBytes}
	cmd.Stdout = stdout
	cmd.Stderr = stderr

	start := time.Now()
	err = cmd.Run()
	duration := time.Since(start).Milliseconds()

	exitCode := 0
	status := "completed"
	errorText := ""
	if err != nil {
		status = "failed"
		errorText = err.Error()
		exitCode = 1
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
		if runCtx.Err() == context.DeadlineExceeded {
			status = "timed_out"
			errorText = "command timed out"
		}
		if runCtx.Err() == context.Canceled {
			status = "aborted"
			errorText = "command aborted"
		}
	}
	stdoutText := storeRedacted(stdout.buffer.String())
	stderrText := storeRedacted(stderr.buffer.String())
	output := strings.TrimRight(stdoutText+"\n"+stderrText, "\n")
	return &SandboxExecResult{
		Status:     status,
		ExitCode:   exitCode,
		Stdout:     stdoutText,
		Stderr:     stderrText,
		Output:     output,
		Truncated:  stdout.truncated || stderr.truncated,
		DurationMS: duration,
		Mode:       req.Mode,
		Sandbox:    sandbox,
		Error:      errorText,
	}, nil
}

func macOSSandboxProfile(req SandboxExecRequest, tempDir string) string {
	var builder strings.Builder
	builder.WriteString("(version 1)\n")
	builder.WriteString("(deny default)\n")
	builder.WriteString("(allow process*)\n")
	builder.WriteString("(allow sysctl-read)\n")
	builder.WriteString("(allow mach-lookup)\n")
	builder.WriteString("(allow file-read*)\n")
	writeRoots := []string{tempDir}
	if req.Profile == PermissionProfileWorkspaceWrite {
		writeRoots = append(writeRoots, req.WritableRoots...)
	}
	if len(writeRoots) > 0 {
		builder.WriteString("(allow file-write*")
		for _, root := range cleanSandboxRoots(writeRoots) {
			builder.WriteString(" (subpath ")
			builder.WriteString(sandboxProfileString(root))
			builder.WriteString(")")
		}
		builder.WriteString(")\n")
	}
	if req.Profile == PermissionProfileWorkspaceWrite {
		for _, root := range cleanSandboxRoots(req.WritableRoots) {
			for _, blocked := range []string{".git", ".codex", ".env"} {
				builder.WriteString("(deny file-write* (subpath ")
				builder.WriteString(sandboxProfileString(filepath.Join(root, blocked)))
				builder.WriteString("))\n")
			}
		}
	}
	builder.WriteString("(deny network*)\n")
	return builder.String()
}

func sandboxCommandEnv(base []string, tempDir string) []string {
	values := append([]string{}, base...)
	overrides := map[string]string{
		"TMPDIR":            tempDir,
		"GOCACHE":           filepath.Join(tempDir, "go-cache"),
		"GOTMPDIR":          filepath.Join(tempDir, "go-tmp"),
		"NPM_CONFIG_CACHE":  filepath.Join(tempDir, "npm-cache"),
		"YARN_CACHE_FOLDER": filepath.Join(tempDir, "yarn-cache"),
		"PNPM_HOME":         filepath.Join(tempDir, "pnpm-home"),
		"XDG_CACHE_HOME":    filepath.Join(tempDir, "xdg-cache"),
	}
	for key, value := range overrides {
		values = setEnvValue(values, key, value)
	}
	return values
}

func setEnvValue(values []string, key string, value string) []string {
	prefix := key + "="
	for i, item := range values {
		if strings.HasPrefix(item, prefix) {
			values[i] = prefix + value
			return values
		}
	}
	return append(values, prefix+value)
}

func cleanSandboxRoots(roots []string) []string {
	cleaned := []string{}
	seen := map[string]bool{}
	for _, root := range roots {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		if resolved, err := filepath.EvalSymlinks(root); err == nil {
			root = resolved
		}
		root = filepath.Clean(root)
		if seen[root] {
			continue
		}
		seen[root] = true
		cleaned = append(cleaned, root)
	}
	return cleaned
}

func sandboxProfileString(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `"`, `\"`)
	return fmt.Sprintf(`"%s"`, replacer.Replace(value))
}

func storeRedacted(value string) string {
	return store.RedactSensitiveText(value)
}
