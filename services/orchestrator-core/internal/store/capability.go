package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
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

var htmlTagPattern = regexp.MustCompile(`<[^>]+>`)
var linkPattern = regexp.MustCompile(`href=["']([^"']+)["']`)

var ErrPolicyDenied = errors.New("policy denied")

type CapabilityRequest struct {
	Type          string         `json:"type"`
	Capability    string         `json:"capability"`
	Goal          string         `json:"goal"`
	Inputs        map[string]any `json:"inputs"`
	Risk          string         `json:"risk"`
	RunID         string         `json:"run_id"`
	PreferredNode string         `json:"preferred_node"`
	AllowWorker   bool           `json:"allow_worker"`
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

func (db *DB) CompileAndRecordCapability(ctx context.Context, request CapabilityRequest) (*CapabilityExecutionResult, error) {
	if request.Risk != "" && request.Risk != "read_only" {
		_, _ = db.CreateConfirmationRequest(ctx, request)
		return nil, ErrPolicyDenied
	}
	result, err := executeCapabilityLocally(ctx, request)
	if err != nil {
		return nil, err
	}

	toolRunID, err := NewID("toolrun_")
	if err != nil {
		return nil, err
	}
	if _, err := db.sql.ExecContext(ctx, `
		INSERT INTO tool_runs (id, run_id, capability_id, workflow_name, tool_name, node_id, risk_level, status, input, output, finished_at, duration_ms, assignment_reason)
		VALUES ($1, $2, $3, $4, $4, 'main-node', 'read_only', 'succeeded', $5, $6, NOW(), 0, 'default_main_node')
	`, toolRunID, nullString(request.RunID), request.Capability, result.Workflow.WorkflowName, mustJSON(request), mustJSON(result.NormalizedResult)); err != nil {
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
	if request.Risk != "read_only" {
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
	switch request.Capability {
	case "server_diagnose":
		return executeServerDiagnose(ctx, request)
	case "web_research":
		return executeWebResearch(ctx, request)
	case "system_health_check":
		return executeSystemHealthCheck(ctx, nil, request)
	default:
		return nil, fmt.Errorf("unsupported capability: %s", request.Capability)
	}
}

func executeWebResearch(ctx context.Context, request CapabilityRequest) (*CapabilityExecutionResult, error) {
	if request.Type == "" {
		request.Type = "capability_request"
	}
	if request.Risk == "" {
		request.Risk = "read_only"
	}
	if request.Risk != "read_only" {
		return nil, ErrPolicyDenied
	}
	url := stringInput(request.Inputs, "url", "")
	if url == "" {
		return nil, errors.New("web_research requires url")
	}
	if blocked, reason := blockedResearchURL(url); blocked {
		return &CapabilityExecutionResult{
			CapabilityRequest: request,
			PolicyDecision:    map[string]any{"risk": "read_only", "decision": "policy_blocked", "reason": reason},
			Workflow:          ToolWorkflow{WorkflowName: "web_research_v1", Capability: "web_research", RiskLevel: "read_only"},
			SelectedNodeID:    "main-node",
			NormalizedResult:  map[string]any{"url": url, "fetch_status": "policy_blocked", "reason": reason, "mode": "web_research_v1_readonly_fetch"},
		}, nil
	}
	workflow := ToolWorkflow{
		WorkflowName: "web_research_v1",
		Capability:   "web_research",
		RiskLevel:    "read_only",
		Steps: []ToolWorkflowStep{
			{Tool: "fetch_url", Args: map[string]any{"url": url}, RiskLevel: "read_only"},
			{Tool: "extract_readable_text", Args: map[string]any{}, RiskLevel: "read_only"},
			{Tool: "extract_links", Args: map[string]any{}, RiskLevel: "read_only"},
			{Tool: "summarize_sources", Args: map[string]any{}, RiskLevel: "read_only"},
		},
	}
	result := fetchReadableURL(ctx, url)
	return &CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    map[string]any{"risk": "read_only", "decision": "allow", "reason": "web_research_v1 only performs read-only HTTP fetch and extraction"},
		Workflow:          workflow,
		SelectedNodeID:    "main-node",
		NormalizedResult:  result,
	}, nil
}

func fetchReadableURL(ctx context.Context, url string) map[string]any {
	if blocked, reason := blockedResearchURL(url); blocked {
		return map[string]any{"url": url, "fetch_status": "policy_blocked", "reason": reason, "mode": "web_research_v1_readonly_fetch"}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return map[string]any{"url": url, "fetch_status": "failed", "error": err.Error()}
	}
	req.Header.Set("User-Agent", "AgentOS-WebResearch/0.1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return map[string]any{"url": url, "fetch_status": "failed", "error": err.Error()}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return map[string]any{"url": url, "fetch_status": "failed", "status_code": resp.StatusCode, "error": err.Error()}
	}
	body := string(raw)
	text := strings.Join(strings.Fields(htmlTagPattern.ReplaceAllString(body, " ")), " ")
	if len(text) > 1200 {
		text = text[:1200]
	}
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
		"readable_text": text,
		"links":         links,
		"summary":       summarizeText(text),
		"mode":          "web_research_v1_readonly_fetch",
	}
}

func summarizeText(text string) string {
	if text == "" {
		return ""
	}
	if len(text) > 280 {
		return text[:280]
	}
	return text
}

func executeSystemHealthCheck(ctx context.Context, tx execTx, request CapabilityRequest) (*CapabilityExecutionResult, error) {
	if request.Type == "" {
		request.Type = "capability_request"
	}
	if request.Risk == "" {
		request.Risk = "read_only"
	}
	if request.Risk != "read_only" {
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
	if lowerHost == "localhost" || strings.HasSuffix(lowerHost, ".localhost") {
		return true, "localhost_blocked"
	}
	if ip, err := netip.ParseAddr(lowerHost); err == nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return true, "internal_ip_blocked"
		}
	}
	return false, ""
}

func (db *DB) writeCapabilityTraceSteps(ctx context.Context, runID string, result *CapabilityExecutionResult) error {
	steps := []stepDefinition{
		{stepType: "capability_requested", title: "Capability requested", input: map[string]any{"run_id": runID}, output: map[string]any{"capability_request": result.CapabilityRequest}},
		{stepType: "policy_checked", title: "Policy checked", input: map[string]any{"risk": result.CapabilityRequest.Risk}, output: result.PolicyDecision},
		{stepType: "tool_compiled", title: "Tool workflow compiled", input: map[string]any{"capability": result.CapabilityRequest.Capability}, output: map[string]any{"workflow": result.Workflow}},
		{stepType: "node_selected", title: "Node selected", input: map[string]any{"capability": result.CapabilityRequest.Capability}, output: map[string]any{"node_id": result.SelectedNodeID, "assignment_reason": "default_main_node"}},
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
		`, stepID, runID, step.stepType, step.title, mustJSON(step.input), mustJSON(step.output)); err != nil {
			return err
		}
	}
	return nil
}

func executeAndRecordCapabilityInTx(ctx context.Context, tx execTx, request CapabilityRequest) (*CapabilityExecutionResult, error) {
	if request.Risk != "" && request.Risk != "read_only" {
		confirmationID, _ := NewID("confirm_")
		_, _ = tx.ExecContext(ctx, `
			INSERT INTO confirmation_requests (id, run_id, capability_id, requested_action, risk_level, input)
			VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6)
		`, confirmationID, request.RunID, request.Capability, request.Goal, request.Risk, mustJSON(request.Inputs))
		return nil, ErrPolicyDenied
	}
	if request.Capability == "system_health_check" {
		result, err := executeSystemHealthCheck(ctx, tx, request)
		if err != nil {
			return nil, err
		}
		result.NormalizedResult["node_id"] = "main-node"
		result.NormalizedResult["assignment_reason"] = "default_main_node"
		toolRunID, err := NewID("toolrun_")
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO tool_runs (id, run_id, capability_id, workflow_name, tool_name, node_id, risk_level, status, input, output, finished_at, duration_ms, assignment_reason)
			VALUES ($1, $2, $3, $4, $4, 'main-node', 'read_only', 'succeeded', $5, $6, NOW(), 0, 'default_main_node')
		`, toolRunID, nullString(request.RunID), request.Capability, result.Workflow.WorkflowName, mustJSON(request), mustJSON(result.NormalizedResult)); err != nil {
			return nil, err
		}
		result.ToolRunID = toolRunID
		return result, nil
	}
	if nodeID, ok := workerDispatchNode(request); ok {
		return enqueueWorkerTask(ctx, tx, request, nodeID)
	}
	result, err := executeCapabilityLocally(ctx, request)
	if err != nil {
		return nil, err
	}
	result.NormalizedResult["node_id"] = "main-node"
	result.NormalizedResult["assignment_reason"] = "default_main_node"
	toolRunID, err := NewID("toolrun_")
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO tool_runs (id, run_id, capability_id, workflow_name, tool_name, node_id, risk_level, status, input, output, finished_at, duration_ms, assignment_reason)
		VALUES ($1, $2, $3, $4, $4, 'main-node', 'read_only', 'succeeded', $5, $6, NOW(), 0, 'default_main_node')
	`, toolRunID, nullString(request.RunID), request.Capability, result.Workflow.WorkflowName, mustJSON(request), mustJSON(result.NormalizedResult)); err != nil {
		return nil, err
	}
	result.ToolRunID = toolRunID
	return result, nil
}

func workerDispatchNode(request CapabilityRequest) (string, bool) {
	if request.PreferredNode != "" && request.PreferredNode != "main-node" && request.PreferredNode != "auto" {
		return request.PreferredNode, true
	}
	if request.PreferredNode == "auto" && request.AllowWorker {
		return "local-worker-1", true
	}
	return "", false
}

func enqueueWorkerTask(ctx context.Context, tx execTx, request CapabilityRequest, nodeID string) (*CapabilityExecutionResult, error) {
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
		AssignedNodeID:  nodeID,
		PrivacyLevel:    "internal",
		Payload:         map[string]any{"type": request.Type, "capability": request.Capability, "goal": request.Goal, "inputs": request.Inputs, "risk": request.Risk, "run_id": request.RunID, "preferred_node": request.PreferredNode, "allow_worker": request.AllowWorker},
		TimeoutSeconds:  120,
	}); err != nil {
		return nil, err
	}
	if request.RunID != "" {
		if err := insertRunStep(ctx, tx, request.RunID, "node_selected", "Node selected", map[string]any{"capability": request.Capability, "preferred_node": request.PreferredNode}, map[string]any{"node_id": nodeID, "assignment_reason": assignmentReason(request)}); err != nil {
			return nil, err
		}
		if err := insertRunStep(ctx, tx, request.RunID, "task_dispatched", "Task dispatched to worker", map[string]any{"task_id": taskID, "allow_worker": request.AllowWorker}, map[string]any{"node_id": nodeID, "assignment_reason": assignmentReason(request), "task_attempts": 0}); err != nil {
			return nil, err
		}
	}
	workflowName := request.Capability + "_v1"
	if request.Capability == "server_diagnose" {
		workflowName = "server_diagnose_v1"
	}
	workflow := ToolWorkflow{WorkflowName: workflowName, Capability: request.Capability, RiskLevel: "read_only"}
	result := &CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    map[string]any{"risk": "read_only", "decision": "allow", "reason": "queued for local worker"},
		Workflow:          workflow,
		SelectedNodeID:    nodeID,
		NormalizedResult:  map[string]any{"status": "queued", "task_id": taskID, "node_id": nodeID, "assignment_reason": assignmentReason(request)},
	}
	return result, nil
}

type execTx interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
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
	`, stepID, runID, stepType, title, mustJSON(input), mustJSON(output))
	return err
}

func assignmentReason(request CapabilityRequest) string {
	if request.PreferredNode == "auto" {
		return "auto_allow_worker"
	}
	return "user_selected"
}

func dockerListContainers(ctx context.Context, serviceName string) map[string]any {
	output, err := exec.CommandContext(ctx, "docker", "ps", "-a", "--filter", "name="+serviceName, "--format", "{{.Names}}|{{.Status}}|{{.Image}}").CombinedOutput()
	if err != nil {
		return map[string]any{"available": false, "error": err.Error()}
	}
	lines := nonEmptyLines(string(output))
	return map[string]any{"available": true, "containers": lines}
}

func dockerInspectContainer(ctx context.Context, serviceName string) map[string]any {
	output, err := exec.CommandContext(ctx, "docker", "inspect", serviceName, "--format", "{{.State.Running}}|{{.RestartCount}}|{{.State.Status}}").CombinedOutput()
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
	output, err := exec.CommandContext(ctx, "docker", "logs", "--tail", fmt.Sprintf("%d", tail), serviceName).CombinedOutput()
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
