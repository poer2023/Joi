package appcore

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

type WorkerGatewayConfig struct {
	Core   *AppCore
	Addr   string
	Token  string
	Logger *slog.Logger
}

type WorkerGateway struct {
	server *http.Server
	addr   string
	mu     sync.Mutex
	events map[string][]time.Time
	locks  map[string]time.Time
}

func StartWorkerGateway(ctx context.Context, cfg WorkerGatewayConfig) (*WorkerGateway, error) {
	_ = ctx
	if cfg.Core == nil {
		return nil, errors.New("worker gateway requires app core")
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	mux := http.NewServeMux()
	gateway := &WorkerGateway{events: map[string][]time.Time{}, locks: map[string]time.Time{}}
	mux.HandleFunc("POST /worker/register", gateway.guard(cfg, "register", gateway.handleRegister(cfg.Core)))
	mux.HandleFunc("POST /worker/heartbeat", gateway.guard(cfg, "heartbeat", gateway.handleHeartbeat(cfg.Core)))
	mux.HandleFunc("POST /worker/tasks/claim", gateway.guard(cfg, "claim", gateway.handleClaim(cfg.Core)))
	mux.HandleFunc("POST /worker/tasks/{id}/ack", gateway.guard(cfg, "ack", gateway.handleAck(cfg.Core)))
	mux.HandleFunc("POST /worker/tasks/{id}/fail", gateway.guard(cfg, "fail", gateway.handleFail(cfg.Core)))
	server := &http.Server{Addr: cfg.Addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	listener, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		return nil, err
	}
	gateway.server = server
	gateway.addr = listener.Addr().String()
	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			cfg.Logger.Warn("worker gateway stopped", "service", "worker-gateway", "error", err)
		}
	}()
	cfg.Logger.Info("worker gateway listening", "service", "worker-gateway", "addr", gateway.addr)
	return gateway, nil
}

func (g *WorkerGateway) Shutdown(ctx context.Context) error {
	if g == nil || g.server == nil {
		return nil
	}
	return g.server.Shutdown(ctx)
}

func (g *WorkerGateway) Addr() string {
	if g == nil {
		return ""
	}
	return g.addr
}

func (g *WorkerGateway) guard(cfg WorkerGatewayConfig, action string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		nodeID := strings.TrimSpace(r.Header.Get("X-Worker-Node-ID"))
		if nodeID == "" {
			writeWorkerJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "node_id_header_required"})
			return
		}
		authKey := remoteAuthKey(r)
		if lockedUntil := g.lockedUntil(authKey); !lockedUntil.IsZero() {
			_ = cfg.Core.recordWorkerGatewayAudit(r.Context(), nodeID, action, "denied", "auth_lockout", map[string]any{"locked_until": lockedUntil.UTC().Format(time.RFC3339)})
			writeWorkerJSON(w, http.StatusTooManyRequests, map[string]any{"ok": false, "error": "auth_lockout"})
			return
		}
		if expectedToken := cfg.currentToken(); expectedToken != "" {
			token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if token == "" {
				token = r.Header.Get("X-Worker-Token")
			}
			if token != expectedToken {
				g.recordFailedAuth(authKey)
				_ = cfg.Core.recordWorkerGatewayAudit(r.Context(), nodeID, action, "denied", "bad_token", map[string]any{"remote_addr": r.RemoteAddr})
				writeWorkerJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "permission_denied"})
				return
			}
		}
		if !workerNodeAllowed(nodeID) {
			_ = cfg.Core.recordWorkerGatewayAudit(r.Context(), nodeID, action, "denied", "node_not_allowlisted", map[string]any{})
			writeWorkerJSON(w, http.StatusForbidden, map[string]any{"ok": false, "error": "node_not_allowlisted"})
			return
		}
		if denied, reason := cfg.Core.workerGatewayNodeDenied(r.Context(), nodeID); denied {
			_ = cfg.Core.recordWorkerGatewayAudit(r.Context(), nodeID, action, "denied", reason, map[string]any{})
			writeWorkerJSON(w, http.StatusForbidden, map[string]any{"ok": false, "error": reason})
			return
		}
		if err := cfg.Core.acceptWorkerGatewayNonce(r.Context(), nodeID, r.Header.Get("X-Worker-Timestamp"), r.Header.Get("X-Worker-Nonce")); err != nil {
			_ = cfg.Core.recordWorkerGatewayAudit(r.Context(), nodeID, action, "denied", err.Error(), map[string]any{})
			writeWorkerJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		if !g.rateAllowed(nodeID+":"+action, rateLimitForAction(action), time.Minute) {
			_ = cfg.Core.recordWorkerGatewayAudit(r.Context(), nodeID, action, "denied", "rate_limited", map[string]any{})
			writeWorkerJSON(w, http.StatusTooManyRequests, map[string]any{"ok": false, "error": "rate_limited"})
			return
		}
		next(w, r)
	}
}

type workerRegisterRequest struct {
	NodeID       string   `json:"node_id"`
	Name         string   `json:"name"`
	Capabilities []string `json:"capabilities"`
}

func (g *WorkerGateway) handleRegister(core *AppCore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req workerRegisterRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeWorkerJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		headerNodeID := strings.TrimSpace(r.Header.Get("X-Worker-Node-ID"))
		if req.NodeID == "" {
			req.NodeID = headerNodeID
		}
		if req.NodeID != headerNodeID {
			writeWorkerJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "node_id_mismatch"})
			return
		}
		if err := core.upsertWorkerNode(r.Context(), req); err != nil {
			writeWorkerJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		_ = core.recordWorkerGatewayAudit(r.Context(), req.NodeID, "register", "allowed", "registered", map[string]any{"capabilities": req.Capabilities})
		writeWorkerJSON(w, http.StatusOK, map[string]any{"ok": true, "node_id": req.NodeID})
	}
}

func (g *WorkerGateway) handleHeartbeat(core *AppCore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req workerRegisterRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		headerNodeID := strings.TrimSpace(r.Header.Get("X-Worker-Node-ID"))
		if req.NodeID == "" {
			req.NodeID = headerNodeID
		}
		if req.NodeID != headerNodeID {
			writeWorkerJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "node_id_mismatch"})
			return
		}
		if core.Queue != nil {
			_ = core.Queue.Heartbeat(r.Context(), req.NodeID)
		}
		_ = core.recordWorkerGatewayAudit(r.Context(), req.NodeID, "heartbeat", "allowed", "heartbeat", map[string]any{})
		writeWorkerJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func (g *WorkerGateway) handleClaim(core *AppCore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			NodeID string `json:"node_id"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		headerNodeID := strings.TrimSpace(r.Header.Get("X-Worker-Node-ID"))
		if req.NodeID == "" {
			req.NodeID = headerNodeID
		}
		if req.NodeID != headerNodeID {
			writeWorkerJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "node_id_mismatch"})
			return
		}
		if core.Queue == nil {
			writeWorkerJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "queue_not_ready"})
			return
		}
		task, err := core.Queue.Claim(r.Context(), req.NodeID)
		if err != nil {
			writeWorkerJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		if task != nil && !core.workerNodeCapabilityAllowed(r.Context(), req.NodeID, task.CapabilityID) {
			_ = core.Queue.Fail(r.Context(), task.ID, store.TaskError{Code: "permission_denied", Message: "node capability whitelist denied this task", Details: map[string]any{"node_id": req.NodeID, "capability": task.CapabilityID}})
			_ = core.recordWorkerGatewayAudit(r.Context(), req.NodeID, "claim", "denied", "capability_not_allowed", map[string]any{"task_id": task.ID, "capability": task.CapabilityID})
			writeWorkerJSON(w, http.StatusOK, map[string]any{"ok": true, "task": nil})
			return
		}
		_ = core.recordWorkerGatewayAudit(r.Context(), req.NodeID, "claim", "allowed", "claim", map[string]any{"task_id": taskIDOrEmpty(task)})
		writeWorkerJSON(w, http.StatusOK, map[string]any{"ok": true, "task": task})
	}
}

func (g *WorkerGateway) handleAck(core *AppCore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req store.TaskResult
		_ = json.NewDecoder(r.Body).Decode(&req)
		nodeID := strings.TrimSpace(r.Header.Get("X-Worker-Node-ID"))
		if err := core.ackWorkerGatewayTask(r.Context(), nodeID, r.PathValue("id"), req); err != nil {
			_ = core.recordWorkerGatewayAudit(r.Context(), nodeID, "ack", "denied", err.Error(), map[string]any{"task_id": r.PathValue("id")})
			writeWorkerJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		_ = core.recordWorkerGatewayAudit(r.Context(), nodeID, "ack", "allowed", "task_ack", map[string]any{"task_id": r.PathValue("id")})
		writeWorkerJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func (g *WorkerGateway) handleFail(core *AppCore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req store.TaskError
		_ = json.NewDecoder(r.Body).Decode(&req)
		nodeID := strings.TrimSpace(r.Header.Get("X-Worker-Node-ID"))
		if err := core.failWorkerGatewayTask(r.Context(), nodeID, r.PathValue("id"), req); err != nil {
			_ = core.recordWorkerGatewayAudit(r.Context(), nodeID, "fail", "denied", err.Error(), map[string]any{"task_id": r.PathValue("id")})
			writeWorkerJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		_ = core.recordWorkerGatewayAudit(r.Context(), nodeID, "fail", "allowed", "task_fail", map[string]any{"task_id": r.PathValue("id")})
		writeWorkerJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func (a *AppCore) upsertWorkerNode(ctx context.Context, req workerRegisterRequest) error {
	name := valueOrDefault(req.Name, req.NodeID)
	capabilities := req.Capabilities
	if capabilities == nil {
		capabilities = []string{}
	}
	if a.isSQLite() {
		_, err := a.db.SQL().ExecContext(ctx, `
			INSERT INTO nodes (id, name, role, status, capabilities, resources, network, assign_policy, auto_assign_enabled, manual_assign_enabled, last_heartbeat_at, version, metadata, updated_at)
			VALUES (?, ?, 'worker', 'healthy', ?, '{}', '{}', '{"desktop_gateway":true}', 0, 1, datetime('now'), '0.1.0', '{"registered_by":"worker_gateway"}', datetime('now'))
			ON CONFLICT(id) DO UPDATE SET
			  name=excluded.name,
			  status='healthy',
			  capabilities=excluded.capabilities,
			  last_heartbeat_at=datetime('now'),
			  updated_at=datetime('now')
		`, req.NodeID, name, mustJSON(capabilities))
		return err
	}
	_, err := a.db.SQL().ExecContext(ctx, `
		INSERT INTO nodes (id, name, role, status, capabilities, resources, network, assign_policy, auto_assign_enabled, manual_assign_enabled, last_heartbeat_at, version, metadata)
		VALUES ($1, $2, 'worker', 'healthy', $3, '{}', '{}', '{"desktop_gateway":true}', false, true, NOW(), '0.1.0', '{"registered_by":"worker_gateway"}')
		ON CONFLICT (id) DO UPDATE SET
			name=EXCLUDED.name,
			status='healthy',
			capabilities=EXCLUDED.capabilities,
			last_heartbeat_at=NOW(),
			updated_at=NOW()
	`, req.NodeID, name, mustJSON(capabilities))
	return err
}

func (a *AppCore) ackWorkerGatewayTask(ctx context.Context, nodeID string, taskID string, result store.TaskResult) error {
	result.Output = sanitizeWorkerGatewayOutput(result.Output)
	if !a.isSQLite() {
		return a.Queue.Ack(ctx, taskID, result)
	}
	task, err := a.sqliteTaskForGateway(ctx, taskID)
	if err != nil {
		return err
	}
	if task.AssignedNodeID != "" && task.AssignedNodeID != nodeID {
		return errors.New("permission_denied: task assigned to different node")
	}
	if task.Status != "running" {
		return errors.New("task_not_running")
	}
	if err := a.Queue.Ack(ctx, taskID, result); err != nil {
		return err
	}
	toolRunID, err := store.NewID("toolrun_")
	if err != nil {
		return err
	}
	assignmentReason := gatewayAssignmentReason(task)
	_, err = a.db.SQL().ExecContext(ctx, `
		INSERT INTO tool_runs (id, run_id, task_id, capability_id, workflow_name, tool_name, node_id, risk_level, status, input, output, finished_at, duration_ms, assignment_reason)
		VALUES (?, NULLIF(?, ''), ?, ?, ?, ?, ?, 'read_only', 'succeeded', ?, ?, datetime('now'), 0, ?)
	`, toolRunID, task.RunID, task.ID, task.CapabilityID, workflowNameForGateway(task.CapabilityID), workflowNameForGateway(task.CapabilityID), task.AssignedNodeID, mustJSON(task.Payload), mustJSON(result.Output), assignmentReason)
	if err != nil {
		return err
	}
	if task.RunID != "" {
		if err := a.insertGatewayRunStep(ctx, task.RunID, "worker_finished", "Worker task finished", "succeeded", map[string]any{"task_id": task.ID, "node_id": task.AssignedNodeID}, map[string]any{"result": result.Output, "worker_finished_at": time.Now().UTC().Format(time.RFC3339)}, nil); err != nil {
			return err
		}
		if err := a.insertGatewayRunStep(ctx, task.RunID, "tool_finished", "Worker tool runtime finished", "succeeded", map[string]any{"task_id": task.ID, "node_id": task.AssignedNodeID, "tool_run_id": toolRunID}, result.Output, nil); err != nil {
			return err
		}
	}
	return nil
}

var plainCSSBlockPattern = regexp.MustCompile(`(?m)(^|[\s}])(?:[a-z0-9_#.*:,.>+~\[\]="'\(\)-]+(?:\s+[a-z0-9_#.*:,.>+~\[\]="'\(\)-]+)*)\{[^{}]*\}`)

func sanitizeWorkerGatewayOutput(output map[string]any) map[string]any {
	if output == nil {
		return nil
	}
	contentType, _ := output["content_type"].(string)
	mode, _ := output["mode"].(string)
	if !strings.Contains(strings.ToLower(contentType), "html") && !strings.Contains(mode, "web_research") {
		return output
	}
	cleaned := make(map[string]any, len(output))
	for key, value := range output {
		cleaned[key] = value
	}
	if text, ok := output["readable_text"].(string); ok {
		cleaned["readable_text"] = stripPlainCSSBlocks(text)
	}
	if summary, ok := output["summary"].(string); ok {
		cleaned["summary"] = stripPlainCSSBlocks(summary)
	}
	return cleaned
}

func stripPlainCSSBlocks(text string) string {
	for {
		next := plainCSSBlockPattern.ReplaceAllString(text, "$1")
		if next == text {
			return strings.Join(strings.Fields(next), " ")
		}
		text = next
	}
}

func (a *AppCore) failWorkerGatewayTask(ctx context.Context, nodeID string, taskID string, taskErr store.TaskError) error {
	if !a.isSQLite() {
		return a.Queue.Fail(ctx, taskID, taskErr)
	}
	task, err := a.sqliteTaskForGateway(ctx, taskID)
	if err != nil {
		return err
	}
	if task.AssignedNodeID != "" && task.AssignedNodeID != nodeID {
		return errors.New("permission_denied: task assigned to different node")
	}
	if task.Status != "running" {
		return errors.New("task_not_running")
	}
	if err := a.Queue.Fail(ctx, taskID, taskErr); err != nil {
		return err
	}
	if task.RunID != "" {
		err = a.insertGatewayRunStep(ctx, task.RunID, "worker_failed", "Worker task failed", "failed", map[string]any{"task_id": task.ID, "node_id": task.AssignedNodeID}, map[string]any{}, map[string]any{"code": taskErr.Code, "message": taskErr.Message, "details": taskErr.Details})
	}
	return err
}

type gatewayTaskRecord struct {
	ID              string
	RunID           string
	CapabilityID    string
	PreferredNodeID string
	AssignedNodeID  string
	Status          string
	Payload         map[string]any
}

func (a *AppCore) sqliteTaskForGateway(ctx context.Context, taskID string) (gatewayTaskRecord, error) {
	var task gatewayTaskRecord
	var payloadRaw string
	err := a.db.SQL().QueryRowContext(ctx, `SELECT id, COALESCE(run_id,''), capability_id, COALESCE(preferred_node_id,''), COALESCE(assigned_node_id,''), status, payload FROM tasks WHERE id=?`, taskID).Scan(&task.ID, &task.RunID, &task.CapabilityID, &task.PreferredNodeID, &task.AssignedNodeID, &task.Status, &payloadRaw)
	if err != nil {
		return task, err
	}
	task.Payload = decodeObject([]byte(payloadRaw))
	return task, nil
}

func (a *AppCore) insertGatewayRunStep(ctx context.Context, runID string, stepType string, title string, status string, input map[string]any, output map[string]any, stepErr map[string]any) error {
	stepID, err := store.NewID("step_")
	if err != nil {
		return err
	}
	_, err = a.db.SQL().ExecContext(ctx, `INSERT INTO run_steps (id, run_id, step_type, title, status, input, output, error, finished_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 0)`, stepID, runID, stepType, title, status, mustJSON(input), mustJSON(output), mustJSON(stepErr))
	return err
}

func gatewayAssignmentReason(task gatewayTaskRecord) string {
	if task.PreferredNodeID == "auto" {
		return "auto_allow_worker"
	}
	return "user_selected"
}

func workflowNameForGateway(capabilityID string) string {
	switch capabilityID {
	case "web_research", "web_research_v1", "fetch_url":
		return "web_research_v1"
	case "system_health_check", "system_health_check_v1", "system_health_check_self":
		return "system_health_check_v1"
	default:
		return "server_diagnose_v1"
	}
}

func (cfg WorkerGatewayConfig) currentToken() string {
	if token := strings.TrimSpace(os.Getenv("WORKER_TOKEN")); token != "" {
		return token
	}
	return strings.TrimSpace(cfg.Token)
}

func workerNodeAllowed(nodeID string) bool {
	allowlist := strings.TrimSpace(os.Getenv("WORKER_ALLOWED_NODE_IDS"))
	if allowlist == "" {
		return true
	}
	for _, item := range strings.Split(allowlist, ",") {
		if strings.TrimSpace(item) == nodeID {
			return true
		}
	}
	return false
}

func (a *AppCore) workerGatewayNodeDenied(ctx context.Context, nodeID string) (bool, string) {
	if a == nil || a.db == nil || !a.isSQLite() {
		return false, ""
	}
	var status string
	err := a.db.SQL().QueryRowContext(ctx, `SELECT status FROM nodes WHERE id=?`, nodeID).Scan(&status)
	if err != nil {
		return false, ""
	}
	if status == "disabled" {
		return true, "node_disabled"
	}
	return false, ""
}

func (a *AppCore) workerNodeCapabilityAllowed(ctx context.Context, nodeID string, capability string) bool {
	if a == nil || a.db == nil || !a.isSQLite() {
		return true
	}
	var raw string
	err := a.db.SQL().QueryRowContext(ctx, `SELECT capabilities FROM nodes WHERE id=?`, nodeID).Scan(&raw)
	if err != nil {
		return false
	}
	return store.WorkerCapabilityMatches(decodeArray([]byte(raw)), capability)
}

func (a *AppCore) acceptWorkerGatewayNonce(ctx context.Context, nodeID string, timestampHeader string, nonce string) error {
	if strings.TrimSpace(timestampHeader) == "" {
		return errors.New("timestamp_required")
	}
	if strings.TrimSpace(nonce) == "" {
		return errors.New("nonce_required")
	}
	timestamp, err := time.Parse(time.RFC3339, timestampHeader)
	if err != nil {
		return errors.New("invalid_timestamp")
	}
	if delta := time.Since(timestamp); delta > 5*time.Minute || delta < -5*time.Minute {
		return errors.New("timestamp_out_of_window")
	}
	if a == nil || a.db == nil || !a.isSQLite() {
		return nil
	}
	_, _ = a.db.SQL().ExecContext(ctx, `DELETE FROM worker_gateway_nonces WHERE created_at < datetime('now', '-10 minutes')`)
	_, err = a.db.SQL().ExecContext(ctx, `INSERT INTO worker_gateway_nonces (nonce, node_id, created_at) VALUES (?, ?, datetime('now'))`, nonce, nodeID)
	if err != nil {
		return errors.New("replay_detected")
	}
	return nil
}

func (a *AppCore) recordWorkerGatewayAudit(ctx context.Context, nodeID string, action string, status string, reason string, metadata map[string]any) error {
	if a == nil || a.db == nil || !a.isSQLite() {
		return nil
	}
	id, err := store.NewID("wgaudit_")
	if err != nil {
		return err
	}
	_, err = a.db.SQL().ExecContext(ctx, `INSERT INTO worker_gateway_audit_logs (id, node_id, action, status, reason, metadata) VALUES (?, NULLIF(?, ''), ?, ?, ?, ?)`, id, nodeID, action, status, reason, mustJSON(metadata))
	return err
}

func (g *WorkerGateway) rateAllowed(key string, limit int, window time.Duration) bool {
	if limit <= 0 {
		return true
	}
	now := time.Now()
	g.mu.Lock()
	defer g.mu.Unlock()
	events := g.events[key]
	cutoff := now.Add(-window)
	filtered := events[:0]
	for _, event := range events {
		if event.After(cutoff) {
			filtered = append(filtered, event)
		}
	}
	if len(filtered) >= limit {
		g.events[key] = filtered
		return false
	}
	filtered = append(filtered, now)
	g.events[key] = filtered
	return true
}

func (g *WorkerGateway) lockedUntil(key string) time.Time {
	g.mu.Lock()
	defer g.mu.Unlock()
	until := g.locks[key]
	if !until.IsZero() && time.Now().Before(until) {
		return until
	}
	if !until.IsZero() {
		delete(g.locks, key)
	}
	return time.Time{}
}

func (g *WorkerGateway) recordFailedAuth(key string) {
	if g.rateAllowed("authfail:"+key, 5, 10*time.Minute) {
		return
	}
	g.mu.Lock()
	g.locks[key] = time.Now().Add(10 * time.Minute)
	g.mu.Unlock()
}

func rateLimitForAction(action string) int {
	switch action {
	case "heartbeat":
		return 60
	case "claim":
		return 40
	default:
		return 120
	}
}

func remoteAuthKey(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func taskIDOrEmpty(task *store.Task) string {
	if task == nil {
		return ""
	}
	return task.ID
}

func writeWorkerJSON(w http.ResponseWriter, status int, payload map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
