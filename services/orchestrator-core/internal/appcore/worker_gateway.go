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
		if err := core.Queue.Ack(r.Context(), r.PathValue("id"), req); err != nil {
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
		if err := core.Queue.Fail(r.Context(), r.PathValue("id"), req); err != nil {
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

func writeWorkerJSON(w http.ResponseWriter, status int, payload map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
