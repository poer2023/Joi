package appcore

import (
	"bufio"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

const (
	defaultWorkspaceSearchByteLimit = 512 * 1024
	maxWorkspaceSearchResults       = 200
	maxFileAnalyzeExcerpts          = 12
	maxFileAnalyzeSnippetBytes      = 220
)

type workspaceSearchResult struct {
	Path      string `json:"path"`
	Line      int    `json:"line"`
	Snippet   string `json:"snippet"`
	Truncated bool   `json:"truncated"`
}

type fileAnalyzeExcerpt struct {
	Line    int    `json:"line"`
	Snippet string `json:"snippet"`
}

func (a *AppCore) executeSQLiteWorkspaceSearch(ctx context.Context, tx *sql.Tx, request store.CapabilityRequest, workflow store.ToolWorkflow, policy map[string]any) (*store.CapabilityExecutionResult, error) {
	settings, err := a.getWorkspaceSettingsFrom(ctx, tx)
	if err != nil {
		return nil, err
	}
	rootInput := strings.TrimSpace(stringFromAny(request.Inputs["root"]))
	if rootInput == "" {
		rootInput = settings.DefaultRoot
	}
	root, err := ResolveWorkspacePath(rootInput, *settings)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, errors.New("workspace_search root must be a directory")
	}
	query := strings.TrimSpace(stringFromAny(request.Inputs["query"]))
	if query == "" {
		query = strings.TrimSpace(request.Goal)
	}
	if query == "" {
		return nil, errors.New("workspace_search query is required")
	}
	glob := strings.TrimSpace(stringFromAny(request.Inputs["glob"]))
	maxResults := boundedWorkspaceSearchLimit(request.Inputs["max_results"], settings.WorkspaceSearchMaxResults)
	tokens := workspaceQueryTokens(query)
	if len(tokens) == 0 {
		tokens = []string{strings.ToLower(query)}
	}

	results := []workspaceSearchResult{}
	truncated := false
	walkErr := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if path != root && entry.IsDir() && shouldSkipWorkspaceSearchDir(path, entry.Name()) {
			return filepath.SkipDir
		}
		if entry.IsDir() {
			return nil
		}
		if entry.Type()&fs.ModeSymlink != 0 || shouldSkipWorkspaceSearchFile(path, entry.Name(), glob) {
			return nil
		}
		resolved, err := ResolveWorkspacePath(path, *settings)
		if err != nil || resolved != filepath.Clean(path) {
			return nil
		}
		matches, fileTruncated := searchWorkspaceFile(path, root, tokens, maxResults-len(results))
		if fileTruncated {
			truncated = true
		}
		results = append(results, matches...)
		if len(results) >= maxResults {
			truncated = true
			return errWorkspaceSearchLimit
		}
		return nil
	})
	if walkErr != nil && !errors.Is(walkErr, errWorkspaceSearchLimit) {
		return nil, walkErr
	}
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].Path == results[j].Path {
			return results[i].Line < results[j].Line
		}
		return results[i].Path < results[j].Path
	})
	summary := fmt.Sprintf("在 %s 中搜索 %q，命中 %d 条。", root, query, len(results))
	if truncated {
		summary += " 结果已按上限截断。"
	}
	normalized := map[string]any{
		"status":      "completed",
		"query":       query,
		"root":        root,
		"glob":        glob,
		"max_results": maxResults,
		"results":     results,
		"truncated":   truncated,
		"summary":     summary,
		"mode":        "workspace_search_v1_go_walk",
	}
	return &store.CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    policy,
		Workflow:          workflow,
		SelectedNodeID:    "main-node",
		NormalizedResult:  normalized,
	}, nil
}

func (a *AppCore) executeSQLiteFileAnalyze(ctx context.Context, tx *sql.Tx, request store.CapabilityRequest, workflow store.ToolWorkflow, policy map[string]any) (*store.CapabilityExecutionResult, error) {
	settings, err := a.getWorkspaceSettingsFrom(ctx, tx)
	if err != nil {
		return nil, err
	}
	pathInput := strings.TrimSpace(stringFromAny(request.Inputs["path"]))
	if pathInput == "" {
		return nil, errors.New("file_analyze path is required")
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
		return nil, errors.New("file_analyze path must be a file")
	}
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(resolved), "."))
	if !allowedFileAnalyzeExtension(ext) {
		return nil, fmt.Errorf("file_analyze unsupported extension: %s", ext)
	}
	maxBytes := settings.FileAnalyzeMaxBytes
	if maxBytes <= 0 {
		maxBytes = defaultFileAnalyzeMaxBytes
	}
	raw, truncated, err := readBoundedFile(resolved, maxBytes)
	if err != nil {
		return nil, err
	}
	text := string(raw)
	question := strings.TrimSpace(stringFromAny(request.Inputs["question"]))
	if question == "" {
		question = strings.TrimSpace(request.Goal)
	}
	excerpts := selectFileAnalyzeExcerpts(text, question)
	summary := summarizeAuthorizedFile(resolved, text, question, excerpts, truncated)
	normalized := map[string]any{
		"status":    "completed",
		"path":      resolved,
		"size":      info.Size(),
		"extension": ext,
		"summary":   summary,
		"excerpts":  excerpts,
		"truncated": truncated,
		"max_bytes": maxBytes,
		"mode":      "file_analyze_v1_bounded_read",
	}
	return &store.CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    policy,
		Workflow:          workflow,
		SelectedNodeID:    "main-node",
		NormalizedResult:  normalized,
	}, nil
}

func (a *AppCore) executeSQLiteWebResearch(ctx context.Context, tx *sql.Tx, request store.CapabilityRequest, workflow store.ToolWorkflow, policy map[string]any) (*store.CapabilityExecutionResult, error) {
	settings, err := a.getWorkspaceSettingsFrom(ctx, tx)
	if err != nil {
		return nil, err
	}
	result, err := store.ExecuteWebResearchWithPolicy(ctx, request, store.WebResearchPolicy{
		AllowPrivateHosts: settings.WebResearchAllowPrivateHosts,
		AllowedHosts:      settings.BrowserAllowedHosts,
	})
	if err != nil {
		return nil, err
	}
	result.PolicyDecision = policy
	result.Workflow = workflow
	if result.NormalizedResult == nil {
		result.NormalizedResult = map[string]any{}
	}
	result.NormalizedResult["allow_private_hosts"] = settings.WebResearchAllowPrivateHosts
	result.NormalizedResult["allowed_hosts"] = settings.BrowserAllowedHosts
	return result, nil
}

var errWorkspaceSearchLimit = errors.New("workspace search result limit reached")

func boundedWorkspaceSearchLimit(value any, fallback int) int {
	limit := fallback
	if parsed := intFromAny(value); parsed > 0 {
		limit = parsed
	}
	if limit <= 0 {
		limit = defaultWorkspaceSearchLimit
	}
	if limit > maxWorkspaceSearchResults {
		limit = maxWorkspaceSearchResults
	}
	return limit
}

func intFromAny(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		var parsed int
		if _, err := fmt.Sscanf(strings.TrimSpace(typed), "%d", &parsed); err == nil {
			return parsed
		}
	}
	return 0
}

func shouldSkipWorkspaceSearchDir(path string, name string) bool {
	if forbiddenWorkspacePath(path) {
		return true
	}
	switch strings.ToLower(name) {
	case ".git", "node_modules", "dist", "build", "coverage", "output", ".next", ".wails", ".turbo", ".cache":
		return true
	default:
		return false
	}
}

func shouldSkipWorkspaceSearchFile(path string, name string, glob string) bool {
	if forbiddenWorkspacePath(path) {
		return true
	}
	if strings.HasPrefix(name, ".") && name != ".gitignore" {
		return true
	}
	if glob != "" {
		matched, err := filepath.Match(glob, name)
		if err != nil || !matched {
			return true
		}
	}
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
	if ext == "" {
		return true
	}
	return !workspaceSearchExtension(ext)
}

func workspaceSearchExtension(ext string) bool {
	switch ext {
	case "md", "txt", "json", "csv", "ts", "tsx", "go", "sql", "log", "yaml", "yml", "js", "jsx", "css", "html":
		return true
	default:
		return false
	}
}

func searchWorkspaceFile(path string, root string, tokens []string, remaining int) ([]workspaceSearchResult, bool) {
	if remaining <= 0 {
		return nil, true
	}
	info, err := os.Stat(path)
	if err != nil || info.Size() > defaultWorkspaceSearchByteLimit {
		return nil, err == nil
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, false
	}
	defer file.Close()
	results := []workspaceSearchResult{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 256*1024)
	lineNo := 0
	for scanner.Scan() {
		lineNo++
		line := scanner.Text()
		if !utf8.ValidString(line) {
			continue
		}
		if workspaceLineMatches(line, tokens) {
			rel := path
			if r, err := filepath.Rel(root, path); err == nil {
				rel = r
			}
			results = append(results, workspaceSearchResult{
				Path:      filepath.ToSlash(rel),
				Line:      lineNo,
				Snippet:   sanitizeSnippet(line, 220),
				Truncated: false,
			})
			if len(results) >= remaining {
				return results, true
			}
		}
	}
	return results, scanner.Err() != nil
}

func workspaceLineMatches(line string, tokens []string) bool {
	haystack := strings.ToLower(line)
	if len(tokens) == 0 {
		return false
	}
	score := 0
	for _, token := range tokens {
		if strings.Contains(haystack, token) {
			score++
		}
	}
	if len(tokens) <= 2 {
		return score == len(tokens)
	}
	return score >= 2
}

func workspaceQueryTokens(query string) []string {
	query = strings.ToLower(strings.TrimSpace(query))
	fields := strings.FieldsFunc(query, func(r rune) bool {
		return r <= 32 || strings.ContainsRune("，。！？；：、,.!?;:()[]{}\"'`", r)
	})
	seen := map[string]bool{}
	tokens := []string{}
	for _, field := range fields {
		field = strings.TrimSpace(field)
		if len([]rune(field)) < 2 || seen[field] {
			continue
		}
		seen[field] = true
		tokens = append(tokens, field)
	}
	if len(tokens) > 0 {
		return tokens
	}
	return sqliteSearchTokens(query)
}

func allowedFileAnalyzeExtension(ext string) bool {
	switch ext {
	case "md", "txt", "json", "csv", "ts", "tsx", "go", "sql", "log", "yaml", "yml":
		return true
	default:
		return false
	}
}

func readBoundedFile(path string, maxBytes int) ([]byte, bool, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, false, err
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, int64(maxBytes+1)))
	if err != nil {
		return nil, false, err
	}
	truncated := len(raw) > maxBytes
	if truncated {
		raw = raw[:maxBytes]
	}
	return raw, truncated, nil
}

func selectFileAnalyzeExcerpts(text string, question string) []fileAnalyzeExcerpt {
	lines := strings.Split(text, "\n")
	tokens := sqliteSearchTokens(question)
	excerpts := []fileAnalyzeExcerpt{}
	addLine := func(index int) {
		if index < 0 || index >= len(lines) || len(excerpts) >= maxFileAnalyzeExcerpts {
			return
		}
		snippet := sanitizeSnippet(lines[index], maxFileAnalyzeSnippetBytes)
		if snippet == "" {
			return
		}
		for _, existing := range excerpts {
			if existing.Line == index+1 {
				return
			}
		}
		excerpts = append(excerpts, fileAnalyzeExcerpt{Line: index + 1, Snippet: snippet})
	}
	for index, line := range lines {
		lower := strings.ToLower(line)
		if strings.Contains(line, "架构红线") || strings.Contains(lower, "capability") || strings.Contains(lower, "tool compiler") || strings.Contains(lower, "run trace") {
			for offset := 0; offset < 5; offset++ {
				addLine(index + offset)
			}
			continue
		}
		if workspaceLineMatches(line, tokens) {
			addLine(index)
		}
		if len(excerpts) >= maxFileAnalyzeExcerpts {
			break
		}
	}
	if len(excerpts) == 0 {
		for index := 0; index < len(lines) && len(excerpts) < 4; index++ {
			addLine(index)
		}
	}
	return excerpts
}

func summarizeAuthorizedFile(path string, text string, question string, excerpts []fileAnalyzeExcerpt, truncated bool) string {
	base := filepath.Base(path)
	heading := firstMarkdownHeading(text)
	if heading == "" {
		heading = base
	}
	parts := []string{fmt.Sprintf("%s 是授权 workspace 内的 %s 文件，主题为 %s。", base, strings.TrimPrefix(filepath.Ext(path), "."), heading)}
	if strings.Contains(question, "红线") || strings.Contains(strings.ToLower(question), "capability") {
		parts = append(parts, "与 capability 相关的关键约束是：模型只能请求 Capability，Tool Compiler 负责编译固定 Workflow，底层工具执行和 Run Trace 写入必须由 Orchestrator Core 控制，Worker 只能接收最小必要上下文。")
	}
	if truncated {
		parts = append(parts, "读取内容达到上限，摘要基于截断后的前段内容。")
	}
	if len(excerpts) > 0 {
		parts = append(parts, fmt.Sprintf("已返回 %d 条相关摘录。", len(excerpts)))
	}
	return store.RedactSensitiveText(strings.Join(parts, " "))
}

func firstMarkdownHeading(text string) string {
	scanner := bufio.NewScanner(strings.NewReader(text))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "#") {
			return strings.TrimSpace(strings.TrimLeft(line, "#"))
		}
	}
	return ""
}

func sanitizeSnippet(line string, maxBytes int) string {
	line = strings.Join(strings.Fields(line), " ")
	line = strings.TrimSpace(line)
	if line == "" {
		return ""
	}
	line = store.RedactSensitiveText(line)
	if len(line) <= maxBytes {
		return line
	}
	runes := []rune(line)
	if len(runes) <= maxBytes {
		return line
	}
	return strings.TrimSpace(string(runes[:maxBytes])) + "..."
}
