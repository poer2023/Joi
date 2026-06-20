package appcore

import (
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
	defaultShellCommandTimeoutSeconds = 30
	maxShellCommandTimeoutSeconds     = 180
	defaultShellCommandOutputBytes    = 120000
	maxShellCommandOutputBytes        = 240000
)

func (a *AppCore) executeSQLiteShellCommand(ctx context.Context, tx *sql.Tx, request store.CapabilityRequest, workflow store.ToolWorkflow, policy map[string]any) (*store.CapabilityExecutionResult, error) {
	settings, err := a.getWorkspaceSettingsFrom(ctx, tx)
	if err != nil {
		return nil, err
	}
	argv := stringSliceFromAny(request.Inputs["cmd"])
	if len(argv) == 0 {
		return nil, errors.New("shell_command cmd is required")
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
		return nil, errors.New("shell_command cwd must be a directory")
	}
	if err := validateShellCommandArgv(argv, cwd, *settings); err != nil {
		return nil, err
	}
	timeoutSeconds := boundedShellCommandTimeout(request.Inputs["timeout_seconds"])
	maxOutputBytes := boundedShellCommandOutputBytes(request.Inputs["max_output_bytes"])
	runResult, err := runSandboxedCommand(ctx, SandboxExecRequest{
		Argv:           argv,
		Cwd:            cwd,
		Profile:        PermissionProfileReadOnly,
		TimeoutSeconds: timeoutSeconds,
		MaxOutputBytes: maxOutputBytes,
		ReadOnlyRoots:  settings.AllowedRoots,
		WritableRoots:  settings.AllowedRoots,
		Mode:           "shell_command_v1_exec_context",
	})
	if err != nil {
		return nil, err
	}
	normalized := map[string]any{
		"status":           runResult.Status,
		"cmd":              argv,
		"cwd":              cwd,
		"exit_code":        runResult.ExitCode,
		"stdout":           runResult.Stdout,
		"stderr":           runResult.Stderr,
		"output":           runResult.Output,
		"truncated":        runResult.Truncated,
		"output_truncated": runResult.Truncated,
		"duration_ms":      runResult.DurationMS,
		"max_output_bytes": maxOutputBytes,
		"timeout_seconds":  timeoutSeconds,
		"sandbox":          runResult.Sandbox,
		"error":            runResult.Error,
		"summary":          fmt.Sprintf("shell_command %s: %s", runResult.Status, strings.Join(argv, " ")),
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

func validateShellCommandArgv(argv []string, cwd string, settings WorkspaceSettingsResponse) error {
	if len(argv) == 0 {
		return errors.New("cmd is required")
	}
	if err := validateShellArgSafety(argv); err != nil {
		return err
	}
	bin := filepath.Base(argv[0])
	if bin != argv[0] {
		return policyDenied("shell_command executable paths are not allowed")
	}
	if forbiddenShellExecutable(bin) {
		return policyDenied("shell_command forbids executable %q", bin)
	}
	switch bin {
	case "pwd":
		if len(argv) != 1 {
			return policyDenied("pwd does not accept arguments in shell_command")
		}
		return nil
	case "ls":
		return validateShellWorkspaceArgs(argv[1:], cwd, settings, false, shellPathModeKnownPaths)
	case "cat":
		return validateShellWorkspaceArgs(argv[1:], cwd, settings, true, shellPathModeAllNonFlags)
	case "sed":
		return validateShellWorkspaceArgs(argv[1:], cwd, settings, false, shellPathModeKnownPaths)
	case "grep", "rg":
		return validateSearchCommandArgv(bin, argv[1:], cwd, settings)
	case "find":
		return validateFindCommandArgv(argv[1:], cwd, settings)
	case "git":
		return validateShellGitArgv(argv[1:], cwd, settings)
	case "go", "npm", "pnpm", "yarn":
		return validateTestCommandArgv(argv)
	default:
		return policyDenied("shell_command executable %q is not allowlisted", bin)
	}
}

func validateShellArgSafety(argv []string) error {
	for _, arg := range argv {
		trimmed := strings.TrimSpace(arg)
		if trimmed == "" || strings.ContainsRune(arg, '\x00') {
			return policyDenied("shell_command arguments must be non-empty strings")
		}
		if strings.HasPrefix(trimmed, "~") {
			return policyDenied("shell_command does not allow home-relative paths")
		}
		if shellPathHasParentTraversal(trimmed) {
			return policyDenied("shell_command does not allow parent-directory traversal")
		}
		if shellArgReferencesBlockedPath(trimmed) {
			return policyDenied("shell_command does not allow blocked sensitive paths")
		}
	}
	return nil
}

func forbiddenShellExecutable(bin string) bool {
	switch strings.ToLower(strings.TrimSpace(bin)) {
	case "rm", "mv", "cp", "chmod", "chown", "sudo", "curl", "wget", "brew", "docker", "sh", "bash", "zsh", "python", "python3", "node":
		return true
	default:
		return false
	}
}

type shellPathMode int

const (
	shellPathModeKnownPaths shellPathMode = iota
	shellPathModeAllNonFlags
)

func validateShellWorkspaceArgs(args []string, cwd string, settings WorkspaceSettingsResponse, mustExist bool, mode shellPathMode) error {
	for _, arg := range args {
		if strings.HasPrefix(arg, "-") {
			if shellFlagContainsAbsolutePath(arg) {
				return policyDenied("shell_command flags must not contain absolute paths")
			}
			continue
		}
		if mode == shellPathModeKnownPaths && !shellArgLooksLikePath(arg, cwd) {
			continue
		}
		if err := validateWorkspacePathArgument(arg, cwd, settings, mustExist); err != nil {
			return err
		}
	}
	return nil
}

func validateSearchCommandArgv(bin string, args []string, cwd string, settings WorkspaceSettingsResponse) error {
	for _, arg := range args {
		switch arg {
		case "--hidden", "--no-ignore", "--no-ignore-global", "--no-ignore-parent", "--follow":
			return policyDenied("%s flag %s is not allowed in shell_command", bin, arg)
		}
	}
	return validateShellWorkspaceArgs(args, cwd, settings, false, shellPathModeKnownPaths)
}

func validateFindCommandArgv(args []string, cwd string, settings WorkspaceSettingsResponse) error {
	if len(args) == 0 {
		return nil
	}
	for _, arg := range args {
		switch arg {
		case "-exec", "-execdir", "-ok", "-okdir", "-delete":
			return policyDenied("find action %s is not allowed in shell_command", arg)
		}
	}
	for _, arg := range args {
		if strings.HasPrefix(arg, "-") || arg == "!" || arg == "(" || arg == ")" {
			break
		}
		if err := validateWorkspacePathArgument(arg, cwd, settings, true); err != nil {
			return err
		}
	}
	return nil
}

func validateShellGitArgv(args []string, cwd string, settings WorkspaceSettingsResponse) error {
	if len(args) == 0 {
		return policyDenied("git subcommand is required")
	}
	subcommand := args[0]
	switch subcommand {
	case "status":
		for _, arg := range args[1:] {
			if !allowedGitStatusArg(arg) {
				return policyDenied("git status argument %s is not allowed", arg)
			}
		}
		return nil
	case "diff":
		for _, arg := range args[1:] {
			if strings.HasPrefix(arg, "--output") || arg == "--ext-diff" {
				return policyDenied("git diff argument %s is not allowed", arg)
			}
		}
		return validateShellWorkspaceArgs(args[1:], cwd, settings, false, shellPathModeKnownPaths)
	case "log":
		for _, arg := range args[1:] {
			if strings.HasPrefix(arg, "--output") || strings.HasPrefix(arg, "--exec") {
				return policyDenied("git log argument %s is not allowed", arg)
			}
		}
		return validateShellWorkspaceArgs(args[1:], cwd, settings, false, shellPathModeKnownPaths)
	default:
		return policyDenied("git subcommand %s is not allowed in shell_command", subcommand)
	}
}

func allowedGitStatusArg(arg string) bool {
	switch arg {
	case "--short", "-s", "--porcelain", "--porcelain=v1", "--porcelain=v2", "--branch", "-b", "-uno", "-u", "-uall":
		return true
	default:
		return shellArgLooksLikePath(arg, "")
	}
}

func validateWorkspacePathArgument(arg string, cwd string, settings WorkspaceSettingsResponse, mustExist bool) error {
	target := strings.TrimSpace(arg)
	if target == "" {
		return policyDenied("empty path argument")
	}
	if !filepath.IsAbs(target) {
		target = filepath.Join(cwd, target)
	}
	resolved, err := ResolveWorkspacePath(target, settings)
	if err != nil {
		return fmt.Errorf("%w: shell_command path %q is outside allowed workspace", store.ErrPolicyDenied, arg)
	}
	if mustExist {
		if _, err := os.Stat(resolved); err != nil {
			return fmt.Errorf("%w: shell_command path %q is not readable", store.ErrPolicyDenied, arg)
		}
	}
	return nil
}

func shellArgLooksLikePath(arg string, cwd string) bool {
	if arg == "." || arg == ".." || strings.HasPrefix(arg, "./") || strings.HasPrefix(arg, "../") || filepath.IsAbs(arg) {
		return true
	}
	if strings.Contains(arg, "/") {
		return true
	}
	if cwd != "" {
		if _, err := os.Stat(filepath.Join(cwd, arg)); err == nil {
			return true
		}
	}
	return false
}

func shellFlagContainsAbsolutePath(arg string) bool {
	return strings.Contains(arg, "=/") || strings.Contains(arg, ":/")
}

func shellPathHasParentTraversal(arg string) bool {
	normalized := filepath.ToSlash(filepath.Clean(arg))
	if normalized == ".." || strings.HasPrefix(normalized, "../") || strings.Contains(normalized, "/../") {
		return true
	}
	return false
}

func shellArgReferencesBlockedPath(arg string) bool {
	lower := strings.ToLower(filepath.ToSlash(arg))
	for _, blocked := range []string{"/.ssh", "/.git/config", "/.codex", "/.env", "/library/keychains", "/private/etc", "/etc", "/var/db"} {
		if lower == strings.TrimPrefix(blocked, "/") || strings.Contains(lower, blocked) {
			return true
		}
	}
	for _, part := range strings.FieldsFunc(lower, func(r rune) bool {
		return r == '/' || r == '\\' || r == '=' || r == ':'
	}) {
		if part == ".env" || part == "id_rsa" || strings.HasSuffix(part, ".keychain-db") {
			return true
		}
	}
	return false
}

func policyDenied(format string, args ...any) error {
	if len(args) == 0 {
		return fmt.Errorf("%w: %s", store.ErrPolicyDenied, format)
	}
	return fmt.Errorf("%w: %s", store.ErrPolicyDenied, fmt.Sprintf(format, args...))
}

func boundedShellCommandTimeout(value any) int {
	timeout := intFromAny(value)
	if timeout <= 0 {
		timeout = defaultShellCommandTimeoutSeconds
	}
	if timeout > maxShellCommandTimeoutSeconds {
		timeout = maxShellCommandTimeoutSeconds
	}
	return timeout
}

func boundedShellCommandOutputBytes(value any) int {
	limit := intFromAny(value)
	if limit <= 0 {
		limit = defaultShellCommandOutputBytes
	}
	if limit > maxShellCommandOutputBytes {
		limit = maxShellCommandOutputBytes
	}
	return limit
}
