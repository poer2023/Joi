package appcore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

type workspacePatchOp struct {
	Kind  string
	Path  string
	Lines []string
}

type workspacePatchChange struct {
	Operation string `json:"operation"`
	Path      string `json:"path"`
	Bytes     int    `json:"bytes"`
	Lines     int    `json:"lines"`

	mode    fs.FileMode
	content []byte
}

func (a *AppCore) executeSQLiteApplyPatch(ctx context.Context, tx *sql.Tx, request store.CapabilityRequest, workflow store.ToolWorkflow, policy map[string]any) (*store.CapabilityExecutionResult, error) {
	profile := normalizedPermissionProfile(stringFromAny(request.Inputs["permission_profile"]))
	if !permissionProfileAllowsWorkspaceWrite(profile) {
		return nil, store.ErrPolicyDenied
	}
	settings, err := a.getWorkspaceSettingsFrom(ctx, tx)
	if err != nil {
		return nil, err
	}
	patch := stringFromAny(request.Inputs["patch"])
	if strings.TrimSpace(patch) == "" {
		return nil, errors.New("apply_patch patch is required")
	}
	ops, err := parseWorkspaceApplyPatch(patch)
	if err != nil {
		return nil, err
	}
	changes, err := prepareWorkspacePatchChanges(ops, *settings)
	if err != nil {
		return nil, err
	}
	for _, change := range changes {
		if err := writeWorkspaceFileAtomic(change.Path, change.content, change.mode); err != nil {
			return nil, err
		}
	}
	changedFiles := make([]map[string]any, 0, len(changes))
	for _, change := range changes {
		changedFiles = append(changedFiles, map[string]any{
			"operation": change.Operation,
			"path":      change.Path,
			"bytes":     change.Bytes,
			"lines":     change.Lines,
		})
	}
	normalized := map[string]any{
		"status":             "completed",
		"changed_files":      changedFiles,
		"changed_file_count": len(changedFiles),
		"permission_profile": string(profile),
		"summary":            fmt.Sprintf("已应用 workspace patch，修改 %d 个文件。", len(changedFiles)),
		"mode":               "apply_patch_v1_workspace",
	}
	return &store.CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    policy,
		Workflow:          workflow,
		SelectedNodeID:    "main-node",
		NormalizedResult:  normalized,
	}, nil
}

func parseWorkspaceApplyPatch(patch string) ([]workspacePatchOp, error) {
	patch = strings.ReplaceAll(patch, "\r\n", "\n")
	patch = strings.ReplaceAll(patch, "\r", "\n")
	lines := strings.Split(patch, "\n")
	if len(lines) < 2 || strings.TrimSpace(lines[0]) != "*** Begin Patch" {
		return nil, errors.New("patch must start with *** Begin Patch")
	}
	ops := []workspacePatchOp{}
	for i := 1; i < len(lines); {
		line := lines[i]
		if strings.TrimSpace(line) == "" {
			i++
			continue
		}
		if strings.TrimSpace(line) == "*** End Patch" {
			if len(ops) == 0 {
				return nil, errors.New("patch contains no file operations")
			}
			return ops, nil
		}
		var op workspacePatchOp
		switch {
		case strings.HasPrefix(line, "*** Add File: "):
			op.Kind = "add"
			op.Path = strings.TrimSpace(strings.TrimPrefix(line, "*** Add File: "))
		case strings.HasPrefix(line, "*** Update File: "):
			op.Kind = "update"
			op.Path = strings.TrimSpace(strings.TrimPrefix(line, "*** Update File: "))
		case strings.HasPrefix(line, "*** Delete File: "):
			return nil, errors.New("apply_patch delete file is not enabled")
		case strings.HasPrefix(line, "*** Move to: "):
			return nil, errors.New("apply_patch move file is not enabled")
		default:
			return nil, fmt.Errorf("unsupported patch header: %s", line)
		}
		if op.Path == "" {
			return nil, errors.New("patch file path is required")
		}
		i++
		for i < len(lines) {
			next := lines[i]
			if strings.HasPrefix(next, "*** ") && !strings.HasPrefix(next, "*** End of File") {
				break
			}
			op.Lines = append(op.Lines, next)
			i++
		}
		ops = append(ops, op)
	}
	return nil, errors.New("patch must end with *** End Patch")
}

func prepareWorkspacePatchChanges(ops []workspacePatchOp, settings WorkspaceSettingsResponse) ([]workspacePatchChange, error) {
	changes := []workspacePatchChange{}
	seen := map[string]bool{}
	for _, op := range ops {
		resolved, err := ResolveWorkspacePath(op.Path, settings)
		if err != nil {
			return nil, err
		}
		if forbiddenWorkspaceWritePath(resolved) {
			return nil, errors.New("path is blocked by workspace write policy")
		}
		if seen[resolved] {
			return nil, fmt.Errorf("patch touches the same file more than once: %s", resolved)
		}
		seen[resolved] = true
		switch op.Kind {
		case "add":
			if _, err := os.Stat(resolved); err == nil {
				return nil, fmt.Errorf("add file already exists: %s", resolved)
			} else if !errors.Is(err, os.ErrNotExist) {
				return nil, err
			}
			content, err := contentForAddPatch(op.Lines)
			if err != nil {
				return nil, err
			}
			changes = append(changes, workspacePatchChange{Operation: "add", Path: resolved, Bytes: len(content), Lines: countLines(string(content)), mode: 0o644, content: content})
		case "update":
			info, err := os.Stat(resolved)
			if err != nil {
				return nil, err
			}
			if info.IsDir() {
				return nil, errors.New("apply_patch update path must be a file")
			}
			raw, err := os.ReadFile(resolved)
			if err != nil {
				return nil, err
			}
			next, err := contentForUpdatePatch(string(raw), op.Lines)
			if err != nil {
				return nil, err
			}
			changes = append(changes, workspacePatchChange{Operation: "update", Path: resolved, Bytes: len(next), Lines: countLines(next), mode: info.Mode().Perm(), content: []byte(next)})
		default:
			return nil, fmt.Errorf("unsupported patch operation: %s", op.Kind)
		}
	}
	return changes, nil
}

func contentForAddPatch(lines []string) ([]byte, error) {
	var builder strings.Builder
	for _, line := range lines {
		if line == "" {
			continue
		}
		if !strings.HasPrefix(line, "+") {
			return nil, errors.New("add file patch lines must start with +")
		}
		builder.WriteString(strings.TrimPrefix(line, "+"))
		builder.WriteByte('\n')
	}
	return []byte(builder.String()), nil
}

func contentForUpdatePatch(original string, patchLines []string) (string, error) {
	hunks := splitWorkspacePatchHunks(patchLines)
	if len(hunks) == 0 {
		return "", errors.New("update patch contains no hunks")
	}
	next := original
	cursor := 0
	for _, hunk := range hunks {
		oldBlock, newBlock, err := hunkBlocks(hunk)
		if err != nil {
			return "", err
		}
		if oldBlock == "" {
			return "", errors.New("update hunk must include context or removed lines")
		}
		index := strings.Index(next[cursor:], oldBlock)
		if index < 0 {
			return "", errors.New("update hunk did not match target file")
		}
		start := cursor + index
		next = next[:start] + newBlock + next[start+len(oldBlock):]
		cursor = start + len(newBlock)
	}
	return next, nil
}

func splitWorkspacePatchHunks(lines []string) [][]string {
	hunks := [][]string{}
	current := []string{}
	for _, line := range lines {
		if strings.HasPrefix(line, "@@") {
			if len(current) > 0 {
				hunks = append(hunks, current)
			}
			current = []string{}
			continue
		}
		if strings.HasPrefix(line, "*** End of File") || line == "" {
			continue
		}
		current = append(current, line)
	}
	if len(current) > 0 {
		hunks = append(hunks, current)
	}
	return hunks
}

func hunkBlocks(lines []string) (string, string, error) {
	var oldBlock strings.Builder
	var newBlock strings.Builder
	for _, line := range lines {
		if line == "" {
			continue
		}
		prefix := line[0]
		text := line[1:] + "\n"
		switch prefix {
		case ' ':
			oldBlock.WriteString(text)
			newBlock.WriteString(text)
		case '-':
			oldBlock.WriteString(text)
		case '+':
			newBlock.WriteString(text)
		default:
			return "", "", fmt.Errorf("unsupported update patch line: %s", line)
		}
	}
	return oldBlock.String(), newBlock.String(), nil
}

func forbiddenWorkspaceWritePath(path string) bool {
	if forbiddenWorkspacePath(path) {
		return true
	}
	for _, part := range strings.Split(filepath.ToSlash(filepath.Clean(path)), "/") {
		switch strings.ToLower(part) {
		case ".git", ".codex", "node_modules":
			return true
		}
	}
	return false
}

func writeWorkspaceFileAtomic(path string, content []byte, mode fs.FileMode) error {
	dir := filepath.Dir(path)
	temp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tempPath)
		}
	}()
	if _, err := temp.Write(content); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Chmod(mode); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempPath, path); err != nil {
		return err
	}
	cleanup = false
	return nil
}

func countLines(content string) int {
	if content == "" {
		return 0
	}
	count := strings.Count(content, "\n")
	if !strings.HasSuffix(content, "\n") {
		count++
	}
	return count
}
