package appcore

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
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
	gateway := &WorkerGateway{}
	mux.HandleFunc("POST /worker/register", cfg.guard(gateway.handleRegister(cfg.Core)))
	mux.HandleFunc("POST /worker/heartbeat", cfg.guard(gateway.handleHeartbeat(cfg.Core)))
	mux.HandleFunc("POST /worker/tasks/claim", cfg.guard(gateway.handleClaim(cfg.Core)))
	mux.HandleFunc("POST /worker/tasks/{id}/ack", cfg.guard(gateway.handleAck(cfg.Core)))
	mux.HandleFunc("POST /worker/tasks/{id}/fail", cfg.guard(gateway.handleFail(cfg.Core)))
	server := &http.Server{Addr: cfg.Addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	gateway.server = server
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			cfg.Logger.Warn("worker gateway stopped", "service", "worker-gateway", "error", err)
		}
	}()
	cfg.Logger.Info("worker gateway listening", "service", "worker-gateway", "addr", cfg.Addr)
	return gateway, nil
}

func (g *WorkerGateway) Shutdown(ctx context.Context) error {
	if g == nil || g.server == nil {
		return nil
	}
	return g.server.Shutdown(ctx)
}

func (cfg WorkerGatewayConfig) guard(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if cfg.Token != "" {
			token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if token == "" {
				token = r.Header.Get("X-Worker-Token")
			}
			if token != cfg.Token {
				writeWorkerJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "permission_denied"})
				return
			}
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
		if req.NodeID == "" {
			writeWorkerJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "node_id_required"})
			return
		}
		if err := core.upsertWorkerNode(r.Context(), req); err != nil {
			writeWorkerJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeWorkerJSON(w, http.StatusOK, map[string]any{"ok": true, "node_id": req.NodeID})
	}
}

func (g *WorkerGateway) handleHeartbeat(core *AppCore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req workerRegisterRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.NodeID == "" {
			writeWorkerJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "node_id_required"})
			return
		}
		if core.Queue != nil {
			_ = core.Queue.Heartbeat(r.Context(), req.NodeID)
		}
		writeWorkerJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func (g *WorkerGateway) handleClaim(core *AppCore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			NodeID string `json:"node_id"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.NodeID == "" {
			writeWorkerJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "node_id_required"})
			return
		}
		task, err := core.Queue.Claim(r.Context(), req.NodeID)
		if err != nil {
			writeWorkerJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeWorkerJSON(w, http.StatusOK, map[string]any{"ok": true, "task": task})
	}
}

func (g *WorkerGateway) handleAck(core *AppCore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req store.TaskResult
		_ = json.NewDecoder(r.Body).Decode(&req)
		if err := core.ackWorkerGatewayTask(r.Context(), r.PathValue("id"), req); err != nil {
			writeWorkerJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeWorkerJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func (g *WorkerGateway) handleFail(core *AppCore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req store.TaskError
		_ = json.NewDecoder(r.Body).Decode(&req)
		if err := core.failWorkerGatewayTask(r.Context(), r.PathValue("id"), req); err != nil {
			writeWorkerJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
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

func (a *AppCore) ackWorkerGatewayTask(ctx context.Context, taskID string, result store.TaskResult) error {
	if !a.isSQLite() {
		return a.Queue.Ack(ctx, taskID, result)
	}
	task, err := a.sqliteTaskForGateway(ctx, taskID)
	if err != nil {
		return err
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

func (a *AppCore) failWorkerGatewayTask(ctx context.Context, taskID string, taskErr store.TaskError) error {
	if !a.isSQLite() {
		return a.Queue.Fail(ctx, taskID, taskErr)
	}
	task, err := a.sqliteTaskForGateway(ctx, taskID)
	if err != nil {
		return err
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
	Payload         map[string]any
}

func (a *AppCore) sqliteTaskForGateway(ctx context.Context, taskID string) (gatewayTaskRecord, error) {
	var task gatewayTaskRecord
	var payloadRaw string
	err := a.db.SQL().QueryRowContext(ctx, `SELECT id, COALESCE(run_id,''), capability_id, COALESCE(preferred_node_id,''), COALESCE(assigned_node_id,''), payload FROM tasks WHERE id=?`, taskID).Scan(&task.ID, &task.RunID, &task.CapabilityID, &task.PreferredNodeID, &task.AssignedNodeID, &payloadRaw)
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

func writeWorkerJSON(w http.ResponseWriter, status int, payload map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
