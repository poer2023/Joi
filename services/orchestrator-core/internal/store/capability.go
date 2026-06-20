package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"syscall"
	"time"
)

var htmlScriptPattern = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>`)
var htmlStylePattern = regexp.MustCompile(`(?is)<style[^>]*>.*?</style>`)
var htmlNoScriptPattern = regexp.MustCompile(`(?is)<noscript[^>]*>.*?</noscript>`)
var htmlCommentPattern = regexp.MustCompile(`(?is)<!--.*?-->`)
var htmlTitlePattern = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
var htmlMetaTitlePattern = regexp.MustCompile(`(?is)<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["']`)
var htmlBlockPattern = regexp.MustCompile(`(?is)<(?:h1|h2|h3|h4|p|li|blockquote|figcaption)[^>]*>(.*?)</(?:h1|h2|h3|h4|p|li|blockquote|figcaption)>`)
var htmlBlockBreakPattern = regexp.MustCompile(`(?i)<\s*/?\s*(?:br|p|div|section|article|main|header|footer|li|ul|ol|h1|h2|h3|h4|blockquote|figcaption)\b[^>]*>`)
var htmlTagPattern = regexp.MustCompile(`<[^>]+>`)
var linkPattern = regexp.MustCompile(`href=["']([^"']+)["']`)

const maxReadableTextRunes = 12000
const maxReadableSummaryRunes = 900
const minReadableTextRunes = 80

type readableHTMLExtraction struct {
	Title  string
	Text   string
	Source string
}

var ErrPolicyDenied = errors.New("policy denied")
var ErrCapabilityMismatch = errors.New("capability mismatch")
var ErrCapabilityMissing = errors.New("capability missing")
var ErrMissingArgument = errors.New("missing capability argument")

type CapabilityRequest struct {
	Type          string         `json:"type"`
	Capability    string         `json:"capability"`
	Goal          string         `json:"goal"`
	Inputs        map[string]any `json:"inputs"`
	Risk          string         `json:"risk"`
	RunID         string         `json:"run_id"`
	CallID        string         `json:"call_id"`
	TurnID        string         `json:"turn_id"`
	ApprovalScope string         `json:"approval_scope"`
	ApprovalKey   string         `json:"approval_key"`
	PreferredNode string         `json:"preferred_node"`
	AllowWorker   bool           `json:"allow_worker"`
	Source        string         `json:"source"`
	Evidence      string         `json:"evidence"`
}

type ToolWorkflow struct {
	WorkflowName string             `json:"workflow_name"`
	Capability   string             `json:"capability"`
	RiskLevel    string             `json:"risk_level"`
	Steps        []ToolWorkflowStep `json:"steps"`
}

type ToolWorkflowStep struct {
	Tool      string         `json:"tool"`
	Args      map[string]any `json:"args"`
	RiskLevel string         `json:"risk_level"`
}

type CapabilityExecutionResult struct {
	CapabilityRequest CapabilityRequest `json:"capability_request"`
	PolicyDecision    map[string]any    `json:"policy_decision"`
	Workflow          ToolWorkflow      `json:"workflow"`
	SelectedNodeID    string            `json:"selected_node_id"`
	ToolRunID         string            `json:"tool_run_id"`
	NormalizedResult  map[string]any    `json:"normalized_result"`
}

type WebResearchPolicy struct {
	AllowPrivateHosts bool     `json:"allow_private_hosts"`
	AllowedHosts      []string `json:"allowed_hosts"`
}

func BlockedResearchURLWithPolicy(rawURL string, policy WebResearchPolicy) (bool, string) {
	return blockedResearchURLWithPolicy(rawURL, policy)
}

func (db *DB) CompileAndRecordCapability(ctx context.Context, request CapabilityRequest) (*CapabilityExecutionResult, error) {
	compiled, err := CompileCapability(ctx, db.sql, request)
	if err != nil {
		return nil, err
	}
	request = compiled.CapabilityRequest
	result, err := executeCapabilityLocally(ctx, request)
	if err != nil {
		return nil, err
	}
	result.PolicyDecision = compiled.PolicyDecision
	result.Workflow = compiled.Workflow
	result.SelectedNodeID = "main-node"

	toolRunID, err := NewID("toolrun_")
	if err != nil {
		return nil, err
	}
	if _, err := db.sql.ExecContext(ctx, `
		INSERT INTO tool_runs (id, run_id, capability_id, workflow_name, tool_name, node_id, risk_level, status, input, output, finished_at, duration_ms, assignment_reason)
		VALUES ($1, $2, $3, $4, $4, 'main-node', 'read_only', 'succeeded', $5, $6, NOW(), 0, 'default_main_node')
	`, toolRunID, nullString(request.RunID), request.Capability, result.Workflow.WorkflowName, mustJSON(SanitizeForTrace(request)), mustJSON(SanitizeForTrace(result.NormalizedResult))); err != nil {
		return nil, err
	}
	result.ToolRunID = toolRunID

	if request.RunID != "" {
		_ = db.writeCapabilityTraceSteps(ctx, request.RunID, result)
	}
	return result, nil
}

func executeServerDiagnose(ctx context.Context, request CapabilityRequest) (*CapabilityExecutionResult, error) {
	if request.Type == "" {
		request.Type = "capability_request"
	}
	if request.Risk == "" {
		request.Risk = "read_only"
	}
	if request.Capability != "server_diagnose" {
		return nil, fmt.Errorf("unsupported capability: %s", request.Capability)
	}
	if normalizedRisk(request.Risk) != "read_only" {
		return nil, ErrPolicyDenied
	}

	serviceName := stringInput(request.Inputs, "service_name", "unknown")
	port := intInput(request.Inputs, "port", 0)
	url := stringInput(request.Inputs, "url", "")
	workflow := ToolWorkflow{
		WorkflowName: "server_diagnose_v1",
		Capability:   "server_diagnose",
		RiskLevel:    "read_only",
		Steps: []ToolWorkflowStep{
			{Tool: "docker_list_containers", Args: map[string]any{"filter_name": serviceName}, RiskLevel: "read_only"},
			{Tool: "docker_inspect_container", Args: map[string]any{"container_name": serviceName}, RiskLevel: "read_only"},
			{Tool: "docker_read_logs", Args: map[string]any{"container_name": serviceName, "tail": 200}, RiskLevel: "read_only"},
			{Tool: "check_port", Args: map[string]any{"host": "127.0.0.1", "port": port}, RiskLevel: "read_only"},
			{Tool: "http_probe", Args: map[string]any{"url": url}, RiskLevel: "read_only"},
			{Tool: "system_disk_usage", Args: map[string]any{"path": "/"}, RiskLevel: "read_only"},
			{Tool: "system_memory_usage", Args: map[string]any{}, RiskLevel: "read_only"},
		},
	}

	containers := dockerListContainers(ctx, serviceName)
	inspect := dockerInspectContainer(ctx, serviceName)
	logs := dockerReadLogs(ctx, serviceName, 200)
	portResult := checkPort("127.0.0.1", port)
	httpResult := httpProbe(ctx, url)
	disk := systemDiskUsage("/")
	memory := systemMemoryUsage()

	containerFound := false
	running := false
	restartCount := 0
	if items, ok := containers["containers"].([]string); ok && len(items) > 0 {
		containerFound = true
	}
	if status, ok := inspect["running"].(bool); ok {
		running = status
	}
	if count, ok := inspect["restart_count"].(int); ok {
		restartCount = count
	}
	normalized := map[string]any{
		"service":         serviceName,
		"container_found": containerFound,
		"running":         running,
		"restart_count":   restartCount,
		"recent_errors":   extractErrorLines(logs),
		"important_logs":  logs["lines"],
		"docker": map[string]any{
			"list_containers": containers,
			"inspect":         inspect,
			"logs":            logs,
		},
		"port":   portResult,
		"http":   httpResult,
		"disk":   disk,
		"memory": memory,
		"mode":   "readonly_runtime",
	}

	return &CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision: map[string]any{
			"risk":     "read_only",
			"decision": "allow",
			"reason":   "server_diagnose_v1 uses only whitelisted read-only tool functions",
		},
		Workflow:         workflow,
		SelectedNodeID:   "main-node",
		NormalizedResult: normalized,
	}, nil
}

func executeCapabilityLocally(ctx context.Context, request CapabilityRequest) (*CapabilityExecutionResult, error) {
	request.Capability = CanonicalCapabilityName(request.Capability)
	switch request.Capability {
	case "server_diagnose":
		return executeServerDiagnose(ctx, request)
	case "web_research":
		return executeWebResearch(ctx, request)
	case "browser_read":
		return executeWebResearch(ctx, request)
	case "system_health_check":
		return executeSystemHealthCheck(ctx, nil, request)
	case "desktop_app_list":
		return executeDesktopAppList(ctx, request)
	case "desktop_app_inspect":
		return executeDesktopAppInspect(ctx, request)
	case "computer_observe":
		return executeComputerObserve(ctx, request)
	default:
		return nil, fmt.Errorf("unsupported capability: %s", request.Capability)
	}
}

func executeComputerObserve(ctx context.Context, request CapabilityRequest) (*CapabilityExecutionResult, error) {
	target := strings.TrimSpace(stringInput(request.Inputs, "target", "joi_current_window"))
	if target == "" {
		target = "joi_current_window"
	}
	if target != "joi_current_window" {
		return nil, ErrPolicyDenied
	}
	normalized := map[string]any{
		"status":               "succeeded",
		"target":               target,
		"window_title":         "Joi",
		"bundle_id":            "com.hao.joi.desktop",
		"visible_text_summary": "Joi desktop current window is visible to the local desktop runtime. This read-only capability does not click, type, drag, or operate other apps.",
		"buttons":              []string{},
		"inputs":               []string{},
		"truncated":            false,
		"privacy_level":        "private_content",
		"interaction_allowed":  false,
	}
	return &CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    map[string]any{"risk": "read_only", "decision": "allow", "reason": "computer_observe_v1 is read-only and limited to joi_current_window"},
		Workflow: ToolWorkflow{
			WorkflowName: "computer_observe_v1",
			Capability:   "computer_observe",
			RiskLevel:    "read_only",
			Steps:        []ToolWorkflowStep{{Tool: "computer_observe_visible_ui", Args: map[string]any{"target": target}, RiskLevel: "read_only"}},
		},
		SelectedNodeID:   "main-node",
		NormalizedResult: normalized,
	}, nil
}

func ExecuteCapabilityLocally(ctx context.Context, request CapabilityRequest) (*CapabilityExecutionResult, error) {
	return executeCapabilityLocally(ctx, request)
}

func CanonicalCapabilityName(capability string) string {
	switch capability {
	case "server_diagnose_v1":
		return "server_diagnose"
	case "desktop_app_list_v1":
		return "desktop_app_list"
	case "desktop_app_inspect_v1":
		return "desktop_app_inspect"
	case "computer_observe_v1":
		return "computer_observe"
	case "browser_read_v1":
		return "browser_read"
	case "browser_observe_v1":
		return "browser_observe"
	case "browser_navigate_v1":
		return "browser_navigate"
	case "browser_click_v1":
		return "browser_click"
	case "browser_type_v1":
		return "browser_type"
	case "file_read_v1":
		return "file_read"
	case "shell_command_v1":
		return "shell_command"
	case "web_research_v1", "web_research_v2", "fetch_url":
		return "web_research"
	case "system_health_check_v1":
		return "system_health_check"
	default:
		return capability
	}
}

func FinalAnswerForCapabilityResult(capability string, normalized map[string]any) string {
	return finalAnswerForCapabilityResult(CanonicalCapabilityName(capability), normalized)
}

func executeWebResearch(ctx context.Context, request CapabilityRequest) (*CapabilityExecutionResult, error) {
	return ExecuteWebResearchWithPolicy(ctx, request, WebResearchPolicy{})
}

func ExecuteWebResearchWithPolicy(ctx context.Context, request CapabilityRequest, policy WebResearchPolicy) (*CapabilityExecutionResult, error) {
	if request.Type == "" {
		request.Type = "capability_request"
	}
	if request.Risk == "" {
		request.Risk = "read_only"
	}
	if normalizedRisk(request.Risk) != "read_only" {
		return nil, ErrPolicyDenied
	}
	url := stringInput(request.Inputs, "url", "")
	if url == "" {
		return nil, errors.New("web_research requires url")
	}
	if blocked, reason := blockedResearchURLWithPolicy(url, policy); blocked {
		return &CapabilityExecutionResult{
			CapabilityRequest: request,
			PolicyDecision:    map[string]any{"risk": "read_only", "decision": "policy_blocked", "reason": reason},
			Workflow:          ToolWorkflow{WorkflowName: "web_research_v2", Capability: "web_research", RiskLevel: "read_only"},
			SelectedNodeID:    "main-node",
			NormalizedResult:  map[string]any{"url": url, "fetch_status": "policy_blocked", "reason": reason, "mode": "web_research_v2_readonly_fetch"},
		}, nil
	}
	workflow := ToolWorkflow{
		WorkflowName: "web_research_v2",
		Capability:   "web_research",
		RiskLevel:    "read_only",
		Steps: []ToolWorkflowStep{
			{Tool: "fetch_url", Args: map[string]any{"url": url}, RiskLevel: "read_only"},
			{Tool: "extract_readable_text", Args: map[string]any{}, RiskLevel: "read_only"},
			{Tool: "extract_links", Args: map[string]any{}, RiskLevel: "read_only"},
			{Tool: "summarize_sources", Args: map[string]any{}, RiskLevel: "read_only"},
		},
	}
	result := FetchReadableURLWithPolicy(ctx, url, policy)
	return &CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    map[string]any{"risk": "read_only", "decision": "allow", "reason": "web_research_v2 only performs read-only HTTP fetch and extraction"},
		Workflow:          workflow,
		SelectedNodeID:    "main-node",
		NormalizedResult:  result,
	}, nil
}

func fetchReadableURL(ctx context.Context, url string) map[string]any {
	return FetchReadableURLWithPolicy(ctx, url, WebResearchPolicy{})
}

func FetchReadableURLWithPolicy(ctx context.Context, url string, policy WebResearchPolicy) map[string]any {
	if blocked, reason := blockedResearchURLWithPolicy(url, policy); blocked {
		return map[string]any{"url": url, "fetch_status": "policy_blocked", "reason": reason, "mode": "web_research_v2_readonly_fetch"}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return map[string]any{"url": url, "fetch_status": "failed", "error": err.Error()}
	}
	req.Header.Set("User-Agent", "AgentOS-WebResearch/0.1")
	client := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("redirect_limit_exceeded")
			}
			if blocked, reason := blockedResearchURLWithPolicy(req.URL.String(), policy); blocked {
				return errors.New(reason)
			}
			return nil
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		return map[string]any{"url": url, "fetch_status": "failed", "error": err.Error()}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024+1))
	if err != nil {
		return map[string]any{"url": url, "fetch_status": "failed", "status_code": resp.StatusCode, "error": err.Error()}
	}
	truncated := false
	if len(raw) > 1024*1024 {
		raw = raw[:1024*1024]
		truncated = true
	}
	body := string(raw)
	extraction := extractReadableHTML(body)
	text, readableTextTruncated := truncateTextRunes(extraction.Text, maxReadableTextRunes)
	links := []string{}
	for _, match := range linkPattern.FindAllStringSubmatch(body, 20) {
		if len(match) > 1 {
			links = append(links, match[1])
		}
	}
	return map[string]any{
		"url":           url,
		"fetch_status":  "succeeded",
		"status_code":   resp.StatusCode,
		"content_type":  resp.Header.Get("Content-Type"),
		"title":         extraction.Title,
		"readable_text": text,
		"text_length":   runeCount(text),
		"links":         links,
		"summary":       summarizeText(text),
		"extraction": map[string]any{
			"source":                  extraction.Source,
			"readable_text_truncated": readableTextTruncated,
		},
		"truncated": truncated,
		"mode":      "web_research_v2_readonly_fetch",
	}
}

func readableHTMLText(body string) string {
	return extractReadableHTML(body).Text
}

func summarizeText(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	lines := []string{}
	totalRunes := 0
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		lineRunes := runeCount(line)
		if totalRunes > 0 && totalRunes+lineRunes+1 > maxReadableSummaryRunes {
			break
		}
		lines = append(lines, line)
		totalRunes += lineRunes + 1
	}
	if len(lines) == 0 {
		return truncateRunes(text, maxReadableSummaryRunes)
	}
	summary := strings.Join(lines, " ")
	return truncateRunes(summary, maxReadableSummaryRunes)
}

func extractReadableHTML(body string) readableHTMLExtraction {
	title := extractHTMLTitle(body)
	if !strings.Contains(body, "<") {
		text := normalizeReadableText(body)
		source := "plain_text"
		if runeCount(text) < minReadableTextRunes {
			source = "insufficient"
		}
		return readableHTMLExtraction{Title: title, Text: text, Source: source}
	}
	cleaned := stripNonContentHTML(body)
	fragment, source := articleHTMLFragment(cleaned)
	text := extractStructuredText(fragment)
	if runeCount(text) < minReadableTextRunes && fragment != cleaned {
		if fallback := extractStructuredText(cleaned); runeCount(fallback) > runeCount(text) {
			text = fallback
			source = "document"
		}
	}
	if text == "" {
		text = htmlFragmentToText(fragment)
	}
	if runeCount(text) < minReadableTextRunes {
		source = "insufficient"
	}
	return readableHTMLExtraction{Title: title, Text: text, Source: source}
}

func stripNonContentHTML(body string) string {
	body = htmlCommentPattern.ReplaceAllString(body, " ")
	body = htmlScriptPattern.ReplaceAllString(body, " ")
	body = htmlStylePattern.ReplaceAllString(body, " ")
	body = htmlNoScriptPattern.ReplaceAllString(body, " ")
	return body
}

func extractHTMLTitle(body string) string {
	if match := htmlMetaTitlePattern.FindStringSubmatch(body); len(match) > 1 {
		return singleLineText(match[1])
	}
	if match := htmlTitlePattern.FindStringSubmatch(body); len(match) > 1 {
		return singleLineText(match[1])
	}
	return ""
}

func articleHTMLFragment(body string) (string, string) {
	lower := strings.ToLower(body)
	startMarkers := []struct {
		marker string
		source string
	}{
		{`class="article-body`, "article_body"},
		{`class='article-body`, "article_body"},
		{`class="article__main__wrapper`, "article_body"},
		{`class='article__main__wrapper`, "article_body"},
		{`class="post-content`, "article_body"},
		{`class='post-content`, "article_body"},
		{`class="article-content`, "article_body"},
		{`class='article-content`, "article_body"},
		{`class="entry-content`, "article_body"},
		{`class='entry-content`, "article_body"},
		{`class="markdown-body`, "article_body"},
		{`class='markdown-body`, "article_body"},
		{`<article`, "article"},
		{`<main`, "main"},
	}
	start := -1
	source := "document"
	for _, marker := range startMarkers {
		if idx := strings.Index(lower, marker.marker); idx >= 0 {
			start = tagStartBefore(body, idx)
			source = marker.source
			break
		}
	}
	if start < 0 {
		return body, source
	}
	end := len(body)
	endMarkers := []string{
		`class="article-side`,
		`class='article-side`,
		`class="comments`,
		`class='comments`,
		`id="comments`,
		`id='comments`,
		`<footer`,
		`</article`,
		`</main`,
	}
	for _, marker := range endMarkers {
		if idx := strings.Index(lower[start:], marker); idx > 0 {
			candidate := start + idx
			if strings.HasPrefix(marker, "class=") || strings.HasPrefix(marker, "id=") {
				candidate = tagStartBefore(body, candidate)
			}
			if candidate > start && candidate < end {
				end = candidate
			}
		}
	}
	return body[start:end], source
}

func tagStartBefore(body string, idx int) int {
	if idx <= 0 || idx > len(body) {
		return idx
	}
	if start := strings.LastIndex(body[:idx], "<"); start >= 0 {
		return start
	}
	return idx
}

func extractStructuredText(fragment string) string {
	lines := []string{}
	seen := map[string]bool{}
	for _, match := range htmlBlockPattern.FindAllStringSubmatch(fragment, -1) {
		if len(match) < 2 {
			continue
		}
		for _, line := range splitReadableLines(htmlFragmentToText(match[1])) {
			if seen[line] {
				continue
			}
			seen[line] = true
			lines = append(lines, line)
		}
	}
	if len(lines) == 0 {
		return htmlFragmentToText(fragment)
	}
	return strings.Join(lines, "\n")
}

func htmlFragmentToText(fragment string) string {
	fragment = htmlBlockBreakPattern.ReplaceAllString(fragment, "\n")
	fragment = htmlTagPattern.ReplaceAllString(fragment, " ")
	return normalizeReadableText(fragment)
}

func normalizeReadableText(text string) string {
	text = html.UnescapeString(text)
	text = strings.ReplaceAll(text, "\u00a0", " ")
	return strings.Join(splitReadableLines(text), "\n")
}

func splitReadableLines(text string) []string {
	lines := []string{}
	for _, line := range strings.Split(text, "\n") {
		line = strings.Join(strings.Fields(line), " ")
		line = strings.TrimSpace(line)
		if line == "" || isBoilerplateReadableLine(line) {
			continue
		}
		lines = append(lines, line)
	}
	return lines
}

func singleLineText(text string) string {
	return strings.Join(strings.Fields(html.UnescapeString(htmlTagPattern.ReplaceAllString(text, " "))), " ")
}

func isBoilerplateReadableLine(line string) bool {
	normalized := strings.ToLower(strings.TrimSpace(line))
	switch normalized {
	case "登录", "注册", "首页", "发现", "搜索", "评论", "赞", "分享", "展开阅读全文", "read more", "sign in", "log in":
		return true
	}
	return false
}

func truncateTextRunes(text string, limit int) (string, bool) {
	if limit <= 0 {
		return "", text != ""
	}
	runes := []rune(text)
	if len(runes) <= limit {
		return text, false
	}
	return string(runes[:limit]), true
}

func runeCount(text string) int {
	return len([]rune(text))
}

func executeSystemHealthCheck(ctx context.Context, tx execTx, request CapabilityRequest) (*CapabilityExecutionResult, error) {
	if request.Type == "" {
		request.Type = "capability_request"
	}
	if request.Risk == "" {
		request.Risk = "read_only"
	}
	if normalizedRisk(request.Risk) != "read_only" {
		return nil, ErrPolicyDenied
	}
	checks := map[string]any{
		"orchestrator":    map[string]any{"ok": true, "source": "current_process"},
		"console":         httpProbe(ctx, "http://localhost:3000"),
		"nats":            checkPort("127.0.0.1", 4222),
		"disk":            systemDiskUsage("/"),
		"postgres":        map[string]any{"checked": false, "reason": "database transaction not available"},
		"worker_runtime":  map[string]any{"checked": false, "reason": "database transaction not available"},
		"queue":           map[string]any{"checked": false, "reason": "database transaction not available"},
		"model":           map[string]any{"checked": false, "reason": "database transaction not available"},
		"cost":            map[string]any{"checked": false, "reason": "database transaction not available"},
		"recent_errors":   []map[string]any{},
		"recommendations": []string{},
	}
	if tx != nil {
		var workers, failedTasks, activeTasks, modelCalls, modelErrors, inputTokens, outputTokens, cachedTokens int
		var avgLatency float64
		_ = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM nodes WHERE role='worker' AND status='healthy'`).Scan(&workers)
		_ = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks WHERE status IN ('pending','running','retrying')`).Scan(&activeTasks)
		_ = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks WHERE status IN ('failed','dead') AND created_at > NOW() - INTERVAL '24 hours'`).Scan(&failedTasks)
		_ = tx.QueryRowContext(ctx, `SELECT COUNT(*), COUNT(*) FILTER (WHERE status <> 'succeeded' AND status <> 'fallback_to_mock'), COALESCE(AVG(latency_ms),0) FROM model_calls WHERE created_at >= CURRENT_DATE`).Scan(&modelCalls, &modelErrors, &avgLatency)
		_ = tx.QueryRowContext(ctx, `SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cached_input_tokens),0) FROM model_calls WHERE created_at >= CURRENT_DATE`).Scan(&inputTokens, &outputTokens, &cachedTokens)
		checks["postgres"] = map[string]any{"ok": true}
		checks["worker_runtime"] = map[string]any{"healthy_workers": workers}
		checks["queue"] = map[string]any{"active_tasks": activeTasks, "failed_or_dead_tasks_24h": failedTasks, "ok": failedTasks == 0}
		checks["model"] = map[string]any{"calls_today": modelCalls, "errors_today": modelErrors, "avg_latency_ms_today": avgLatency, "ok": modelErrors == 0}
		checks["cost"] = map[string]any{"input_tokens_today": inputTokens, "output_tokens_today": outputTokens, "cached_input_tokens_today": cachedTokens}
		checks["recent_errors"] = []map[string]any{{"failed_or_dead_tasks_24h": failedTasks}}
		if workers == 0 {
			checks["recommendations"] = []string{"worker-runtime 未显示 healthy 节点；如需远程或本机派发，请启动 worker。"}
		}
	}
	workflow := ToolWorkflow{
		WorkflowName: "system_health_check_v1",
		Capability:   "system_health_check",
		RiskLevel:    "read_only",
		Steps: []ToolWorkflowStep{
			{Tool: "postgres_ping", Args: map[string]any{}, RiskLevel: "read_only"},
			{Tool: "nats_port_check", Args: map[string]any{"port": 4222}, RiskLevel: "read_only"},
			{Tool: "console_http_probe", Args: map[string]any{"url": "http://localhost:3000"}, RiskLevel: "read_only"},
			{Tool: "system_disk_usage", Args: map[string]any{"path": "/"}, RiskLevel: "read_only"},
		},
	}
	return &CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    map[string]any{"risk": "read_only", "decision": "allow", "reason": "system_health_check_v1 only performs read-only checks"},
		Workflow:          workflow,
		SelectedNodeID:    "main-node",
		NormalizedResult:  map[string]any{"status": "completed", "checks": checks, "mode": "system_health_check_v1_readonly"},
	}, nil
}

func blockedResearchURL(rawURL string) (bool, string) {
	return blockedResearchURLWithPolicy(rawURL, WebResearchPolicy{})
}

func blockedResearchURLWithPolicy(rawURL string, policy WebResearchPolicy) (bool, string) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return true, "invalid_url"
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return true, "only_public_http_https_allowed"
	}
	host := parsed.Hostname()
	if host == "" {
		return true, "missing_host"
	}
	lowerHost := strings.ToLower(host)
	lowerHostPort := strings.ToLower(parsed.Host)
	if lowerHost == "localhost" || strings.HasSuffix(lowerHost, ".localhost") {
		if privateResearchHostAllowed(lowerHost, lowerHostPort, policy) {
			return false, ""
		}
		return true, "private_host_not_allowed"
	}
	if ip, err := netip.ParseAddr(lowerHost); err == nil {
		if ip.IsUnspecified() {
			return true, "unspecified_ip_blocked"
		}
		if isMetadataAddr(ip) || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return true, "metadata_ip_blocked"
		}
		if ip.IsLoopback() || ip.IsPrivate() {
			if privateResearchHostAllowed(lowerHost, lowerHostPort, policy) {
				return false, ""
			}
			return true, "private_host_not_allowed"
		}
	}
	return false, ""
}

func privateResearchHostAllowed(host string, hostPort string, policy WebResearchPolicy) bool {
	if !policy.AllowPrivateHosts {
		return false
	}
	host = strings.ToLower(strings.TrimSpace(host))
	hostPort = strings.ToLower(strings.TrimSpace(hostPort))
	for _, allowed := range policy.AllowedHosts {
		allowed = strings.ToLower(strings.TrimSpace(allowed))
		if allowed == "" {
			continue
		}
		if allowed == host || allowed == hostPort {
			return true
		}
	}
	return false
}

func isMetadataAddr(ip netip.Addr) bool {
	return ip == netip.MustParseAddr("169.254.169.254")
}

func (db *DB) writeCapabilityTraceSteps(ctx context.Context, runID string, result *CapabilityExecutionResult) error {
	steps := []stepDefinition{
		{stepType: "capability_requested", title: "Capability requested", input: map[string]any{"run_id": runID}, output: map[string]any{"capability_request": result.CapabilityRequest}},
		{stepType: "capability_semantic_checked", title: "Capability semantic contract checked", input: map[string]any{"capability": result.CapabilityRequest.Capability, "goal": result.CapabilityRequest.Goal, "source": result.CapabilityRequest.Source}, output: map[string]any{"validation": result.PolicyDecision["semantic_validation"]}},
		{stepType: "policy_checked", title: "Policy checked", input: map[string]any{"risk": result.CapabilityRequest.Risk}, output: result.PolicyDecision},
		{stepType: "workflow_compiled", title: "Workflow compiled", input: map[string]any{"capability": result.CapabilityRequest.Capability}, output: map[string]any{"workflow": result.Workflow}},
		{stepType: "tool_compiled", title: "Tool workflow compiled", input: map[string]any{"capability": result.CapabilityRequest.Capability}, output: map[string]any{"workflow": result.Workflow}},
		{stepType: "node_selected", title: "Node selected", input: map[string]any{"capability": result.CapabilityRequest.Capability}, output: map[string]any{"node_id": result.SelectedNodeID, "assignment_reason": "default_main_node"}},
		{stepType: "tool_started", title: "Tool runtime started", input: map[string]any{"workflow_name": result.Workflow.WorkflowName, "tool_run_id": result.ToolRunID}, output: map[string]any{"node_id": result.SelectedNodeID}},
		{stepType: "tool_finished", title: "Tool runtime finished", input: map[string]any{"workflow_name": result.Workflow.WorkflowName}, output: result.NormalizedResult},
	}
	for _, step := range steps {
		stepID, err := NewID("step_")
		if err != nil {
			return err
		}
		if _, err := db.sql.ExecContext(ctx, `
			INSERT INTO run_steps (id, run_id, step_type, title, status, input, output, finished_at, duration_ms)
			VALUES ($1, $2, $3, $4, 'succeeded', $5, $6, NOW(), 0)
		`, stepID, runID, step.stepType, step.title, mustJSON(SanitizeForTrace(step.input)), mustJSON(SanitizeForTrace(step.output))); err != nil {
			return err
		}
	}
	return nil
}

func executeAndRecordCapabilityInTx(ctx context.Context, tx execTx, request CapabilityRequest) (*CapabilityExecutionResult, error) {
	compilerTx, ok := tx.(capabilityCompilerTx)
	if !ok {
		return nil, errors.New("capability compiler requires queryable transaction")
	}
	compiled, err := CompileCapability(ctx, compilerTx, request)
	if err != nil {
		return nil, err
	}
	request = compiled.CapabilityRequest
	schedule, err := ScheduleWorkerNode(ctx, tx, request, NodeSchedulerDialectPostgres)
	if err != nil {
		return nil, err
	}
	if schedule.UseWorker {
		return enqueueWorkerTask(ctx, tx, request, schedule, compiled)
	}
	if request.Capability == "system_health_check" {
		result, err := executeSystemHealthCheck(ctx, tx, request)
		if err != nil {
			return nil, err
		}
		result.PolicyDecision = compiled.PolicyDecision
		result.Workflow = compiled.Workflow
		result.NormalizedResult["node_id"] = "main-node"
		result.NormalizedResult["assignment_reason"] = "default_main_node"
		toolRunID, err := NewID("toolrun_")
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO tool_runs (id, run_id, capability_id, workflow_name, tool_name, node_id, risk_level, status, input, output, finished_at, duration_ms, assignment_reason)
			VALUES ($1, $2, $3, $4, $4, 'main-node', 'read_only', 'succeeded', $5, $6, NOW(), 0, 'default_main_node')
		`, toolRunID, nullString(request.RunID), request.Capability, result.Workflow.WorkflowName, mustJSON(SanitizeForTrace(request)), mustJSON(SanitizeForTrace(result.NormalizedResult))); err != nil {
			return nil, err
		}
		result.ToolRunID = toolRunID
		return result, nil
	}
	result, err := executeCapabilityLocally(ctx, request)
	if err != nil {
		return nil, err
	}
	result.PolicyDecision = compiled.PolicyDecision
	result.Workflow = compiled.Workflow
	result.NormalizedResult["node_id"] = "main-node"
	result.NormalizedResult["assignment_reason"] = "default_main_node"
	toolRunID, err := NewID("toolrun_")
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO tool_runs (id, run_id, capability_id, workflow_name, tool_name, node_id, risk_level, status, input, output, finished_at, duration_ms, assignment_reason)
		VALUES ($1, $2, $3, $4, $4, 'main-node', 'read_only', 'succeeded', $5, $6, NOW(), 0, 'default_main_node')
	`, toolRunID, nullString(request.RunID), request.Capability, result.Workflow.WorkflowName, mustJSON(SanitizeForTrace(request)), mustJSON(SanitizeForTrace(result.NormalizedResult))); err != nil {
		return nil, err
	}
	result.ToolRunID = toolRunID
	return result, nil
}

func enqueueWorkerTask(ctx context.Context, tx execTx, request CapabilityRequest, schedule NodeScheduleDecision, compiled *CapabilityExecutionResult) (*CapabilityExecutionResult, error) {
	taskID, err := NewID("task_")
	if err != nil {
		return nil, err
	}
	queue, err := NewTaskQueue(tx, configuredTaskQueueDriver())
	if err != nil {
		return nil, err
	}
	if err := queue.Enqueue(ctx, Task{
		ID:              taskID,
		RunID:           request.RunID,
		CapabilityID:    request.Capability,
		PreferredNodeID: request.PreferredNode,
		AssignedNodeID:  schedule.NodeID,
		PrivacyLevel:    valueOrDefault(schedule.PrivacyLevel, "public"),
		Payload:         SanitizeForTrace(map[string]any{"type": request.Type, "capability": request.Capability, "goal": request.Goal, "inputs": request.Inputs, "risk": request.Risk, "run_id": request.RunID, "preferred_node": request.PreferredNode, "allow_worker": request.AllowWorker, "privacy_level": valueOrDefault(schedule.PrivacyLevel, "public")}).(map[string]any),
		TimeoutSeconds:  120,
	}); err != nil {
		return nil, err
	}
	if request.RunID != "" {
		if err := insertRunStep(ctx, tx, request.RunID, "node_selected", "Node selected", map[string]any{"capability": request.Capability, "preferred_node": request.PreferredNode, "privacy_level": valueOrDefault(schedule.PrivacyLevel, "public")}, map[string]any{"node_id": schedule.NodeID, "assignment_reason": schedule.AssignmentReason, "running_tasks": schedule.RunningTasks, "scheduler": schedule.Scheduler}); err != nil {
			return nil, err
		}
		if err := insertRunStep(ctx, tx, request.RunID, "task_dispatched", "Task dispatched to worker", map[string]any{"task_id": taskID, "allow_worker": request.AllowWorker}, map[string]any{"node_id": schedule.NodeID, "assignment_reason": schedule.AssignmentReason, "privacy_level": valueOrDefault(schedule.PrivacyLevel, "public"), "scheduler": schedule.Scheduler, "task_attempts": 0}); err != nil {
			return nil, err
		}
	}
	workflow := compiled.Workflow
	result := &CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    compiled.PolicyDecision,
		Workflow:          workflow,
		SelectedNodeID:    schedule.NodeID,
		NormalizedResult:  map[string]any{"status": "queued", "task_id": taskID, "node_id": schedule.NodeID, "assignment_reason": schedule.AssignmentReason, "privacy_level": valueOrDefault(schedule.PrivacyLevel, "public"), "running_tasks": schedule.RunningTasks, "scheduler": schedule.Scheduler},
	}
	return result, nil
}

type execTx interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func insertRunStep(ctx context.Context, tx execTx, runID string, stepType string, title string, input map[string]any, output map[string]any) error {
	stepID, err := NewID("step_")
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO run_steps (id, run_id, step_type, title, status, input, output, finished_at, duration_ms)
		VALUES ($1, $2, $3, $4, 'succeeded', $5, $6, NOW(), 0)
	`, stepID, runID, stepType, title, mustJSON(SanitizeForTrace(input)), mustJSON(SanitizeForTrace(output)))
	return err
}

func dockerListContainers(ctx context.Context, serviceName string) map[string]any {
	cmdCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	output, err := exec.CommandContext(cmdCtx, "docker", "ps", "-a", "--filter", "name="+serviceName, "--format", "{{.Names}}|{{.Status}}|{{.Image}}").CombinedOutput()
	if err != nil {
		return map[string]any{"available": false, "error": err.Error()}
	}
	lines := nonEmptyLines(string(output))
	return map[string]any{"available": true, "containers": lines}
}

func dockerInspectContainer(ctx context.Context, serviceName string) map[string]any {
	cmdCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	output, err := exec.CommandContext(cmdCtx, "docker", "inspect", serviceName, "--format", "{{.State.Running}}|{{.RestartCount}}|{{.State.Status}}").CombinedOutput()
	if err != nil {
		return map[string]any{"available": false, "error": strings.TrimSpace(string(output))}
	}
	parts := strings.Split(strings.TrimSpace(string(output)), "|")
	running := len(parts) > 0 && parts[0] == "true"
	restartCount := 0
	if len(parts) > 1 {
		fmt.Sscanf(parts[1], "%d", &restartCount)
	}
	status := ""
	if len(parts) > 2 {
		status = parts[2]
	}
	return map[string]any{"available": true, "running": running, "restart_count": restartCount, "status": status}
}

func dockerReadLogs(ctx context.Context, serviceName string, tail int) map[string]any {
	cmdCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	output, err := exec.CommandContext(cmdCtx, "docker", "logs", "--tail", fmt.Sprintf("%d", tail), serviceName).CombinedOutput()
	if err != nil {
		return map[string]any{"available": false, "error": err.Error(), "lines": nonEmptyLines(string(output))}
	}
	return map[string]any{"available": true, "lines": nonEmptyLines(string(output))}
}

func checkPort(host string, port int) map[string]any {
	if port <= 0 {
		return map[string]any{"checked": false, "reason": "port not provided"}
	}
	address := fmt.Sprintf("%s:%d", host, port)
	conn, err := net.DialTimeout("tcp", address, 2*time.Second)
	if err != nil {
		return map[string]any{"checked": true, "address": address, "open": false, "error": err.Error()}
	}
	conn.Close()
	return map[string]any{"checked": true, "address": address, "open": true}
}

func httpProbe(ctx context.Context, url string) map[string]any {
	if url == "" {
		return map[string]any{"checked": false, "reason": "url not provided"}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return map[string]any{"checked": false, "error": err.Error()}
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return map[string]any{"checked": true, "url": url, "ok": false, "error": err.Error()}
	}
	defer resp.Body.Close()
	return map[string]any{"checked": true, "url": url, "ok": resp.StatusCode >= 200 && resp.StatusCode < 400, "status_code": resp.StatusCode}
}

func systemDiskUsage(path string) map[string]any {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return map[string]any{"path": path, "error": err.Error()}
	}
	total := uint64(stat.Blocks) * uint64(stat.Bsize)
	available := uint64(stat.Bavail) * uint64(stat.Bsize)
	used := total - available
	return map[string]any{"path": path, "total_bytes": total, "used_bytes": used, "available_bytes": available}
}

func systemMemoryUsage() map[string]any {
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	return map[string]any{"runtime_alloc_bytes": stats.Alloc, "runtime_sys_bytes": stats.Sys, "note": "process runtime memory; host-specific memory is not read through shell"}
}

func extractErrorLines(logs map[string]any) []string {
	values, ok := logs["lines"].([]string)
	if !ok {
		return []string{}
	}
	errors := []string{}
	for _, line := range values {
		lower := strings.ToLower(line)
		if strings.Contains(lower, "error") || strings.Contains(lower, "failed") || strings.Contains(lower, "panic") {
			errors = append(errors, line)
		}
	}
	return errors
}

func nonEmptyLines(value string) []string {
	lines := []string{}
	for _, line := range strings.Split(value, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

func stringInput(inputs map[string]any, key string, fallback string) string {
	if inputs == nil {
		return fallback
	}
	value, ok := inputs[key]
	if !ok {
		return fallback
	}
	text, ok := value.(string)
	if !ok || text == "" {
		return fallback
	}
	return text
}

func intInput(inputs map[string]any, key string, fallback int) int {
	if inputs == nil {
		return fallback
	}
	switch value := inputs[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	default:
		return fallback
	}
}
