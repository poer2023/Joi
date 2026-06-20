package appcore

import (
	"bufio"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

const absoluteFileReadMaxBytes = 512 * 1024

type fileReadLine struct {
	Line      int    `json:"line"`
	Text      string `json:"text"`
	Truncated bool   `json:"truncated"`
}

func (a *AppCore) executeSQLiteFileRead(ctx context.Context, tx *sql.Tx, request store.CapabilityRequest, workflow store.ToolWorkflow, policy map[string]any) (*store.CapabilityExecutionResult, error) {
	if !permissionProfileAllowsFileRead(normalizedPermissionProfile(stringFromAny(request.Inputs["permission_profile"]))) {
		return nil, store.ErrPolicyDenied
	}
	settings, err := a.getWorkspaceSettingsFrom(ctx, tx)
	if err != nil {
		return nil, err
	}
	pathInput := strings.TrimSpace(stringFromAny(request.Inputs["path"]))
	if pathInput == "" {
		return nil, errors.New("file_read path is required")
	}
	resolved, err := ResolveWorkspacePath(pathInput, *settings)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, errors.New("file_read path must be a file")
	}
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(resolved), "."))
	if !allowedFileReadExtension(ext) {
		return nil, fmt.Errorf("file_read unsupported extension: %s", ext)
	}
	startLine := intFromAny(request.Inputs["start_line"])
	if startLine <= 0 {
		startLine = 1
	}
	endLine := intFromAny(request.Inputs["end_line"])
	if endLine > 0 && endLine < startLine {
		return nil, errors.New("file_read end_line must be greater than or equal to start_line")
	}
	maxBytes := boundedFileReadMaxBytes(request.Inputs["max_bytes"], settings.FileAnalyzeMaxBytes)
	content, lines, scannedLines, lastReturnedLine, truncated, err := readBoundedFileLineRange(resolved, startLine, endLine, maxBytes)
	if err != nil {
		return nil, err
	}
	reportedEndLine := endLine
	if reportedEndLine <= 0 {
		reportedEndLine = lastReturnedLine
	}
	summary := fmt.Sprintf("已读取授权 workspace 文件 %s 的 %d 行，字节上限 %d。", resolved, len(lines), maxBytes)
	if truncated {
		summary += " 内容已按上限截断。"
	}
	normalized := map[string]any{
		"status":             "completed",
		"path":               resolved,
		"size":               info.Size(),
		"extension":          ext,
		"start_line":         startLine,
		"end_line":           reportedEndLine,
		"scanned_lines":      scannedLines,
		"last_returned_line": lastReturnedLine,
		"line_count":         len(lines),
		"content":            content,
		"lines":              lines,
		"truncated":          truncated,
		"max_bytes":          maxBytes,
		"summary":            summary,
		"mode":               "file_read_v1_bounded_lines",
	}
	return &store.CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    policy,
		Workflow:          workflow,
		SelectedNodeID:    "main-node",
		NormalizedResult:  normalized,
	}, nil
}

func allowedFileReadExtension(ext string) bool {
	if allowedFileAnalyzeExtension(ext) || workspaceSearchExtension(ext) {
		return true
	}
	switch ext {
	case "c", "cc", "cpp", "h", "hpp", "java", "kt", "kts", "m", "mm", "mod", "php", "py", "rb", "rs", "sh", "swift", "toml", "xml":
		return true
	default:
		return false
	}
}

func boundedFileReadMaxBytes(value any, fallback int) int {
	limit := fallback
	if parsed := intFromAny(value); parsed > 0 {
		limit = parsed
	}
	if fallback > 0 && limit > fallback {
		limit = fallback
	}
	if limit <= 0 {
		limit = defaultFileAnalyzeMaxBytes
	}
	if limit > absoluteFileReadMaxBytes {
		limit = absoluteFileReadMaxBytes
	}
	return limit
}

func readBoundedFileLineRange(path string, startLine int, endLine int, maxBytes int) (string, []fileReadLine, int, int, bool, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", nil, 0, 0, false, err
	}
	defer file.Close()

	reader := bufio.NewReader(file)
	var builder strings.Builder
	lines := []fileReadLine{}
	scannedLines := 0
	lastReturnedLine := 0
	writtenBytes := 0
	truncated := false

	for {
		raw, readErr := reader.ReadString('\n')
		if len(raw) > 0 {
			scannedLines++
			if scannedLines >= startLine && (endLine <= 0 || scannedLines <= endLine) {
				lineText := strings.TrimSuffix(strings.TrimSuffix(raw, "\n"), "\r")
				if !utf8.ValidString(lineText) {
					return "", nil, scannedLines, lastReturnedLine, false, errors.New("file_read supports UTF-8 text files only")
				}
				lineText = store.RedactSensitiveText(lineText)
				piece := lineText
				if strings.HasSuffix(raw, "\n") {
					piece += "\n"
				}
				if writtenBytes+len(piece) > maxBytes {
					remaining := maxBytes - writtenBytes
					if remaining > 0 {
						partial := truncateUTF8Bytes(piece, remaining)
						builder.WriteString(partial)
						lines = append(lines, fileReadLine{Line: scannedLines, Text: strings.TrimSuffix(partial, "\n"), Truncated: true})
						lastReturnedLine = scannedLines
					}
					truncated = true
					break
				}
				builder.WriteString(piece)
				writtenBytes += len(piece)
				lines = append(lines, fileReadLine{Line: scannedLines, Text: lineText, Truncated: false})
				lastReturnedLine = scannedLines
			}
			if endLine > 0 && scannedLines >= endLine {
				break
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return "", nil, scannedLines, lastReturnedLine, false, readErr
		}
	}
	return builder.String(), lines, scannedLines, lastReturnedLine, truncated, nil
}

func truncateUTF8Bytes(value string, maxBytes int) string {
	if maxBytes <= 0 {
		return ""
	}
	if len(value) <= maxBytes {
		return value
	}
	for maxBytes > 0 && !utf8.ValidString(value[:maxBytes]) {
		maxBytes--
	}
	if maxBytes <= 0 {
		return ""
	}
	return value[:maxBytes]
}
