package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

type Handlers struct {
	db     *store.DB
	logger *slog.Logger
}

func NewHandlers(db *store.DB, logger *slog.Logger) *Handlers {
	return &Handlers{db: db, logger: logger}
}

func (h *Handlers) Health(w http.ResponseWriter, r *http.Request) {
	writeOK(w, http.StatusOK, map[string]any{
		"service": "orchestrator-core",
		"status":  "ok",
	}, "")
}

func (h *Handlers) Ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if err := h.db.Ping(ctx); err != nil {
		h.logger.Error("database readiness check failed", "service", "orchestrator-core", "error", err)
		writeError(w, http.StatusServiceUnavailable, "DATABASE_ERROR", "Database is not ready", map[string]any{
			"component": "postgres",
		}, "")
		return
	}

	writeOK(w, http.StatusOK, map[string]any{
		"service":  "orchestrator-core",
		"status":   "ready",
		"database": "ok",
	}, "")
}

func (h *Handlers) Metrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	_, _ = w.Write([]byte(h.db.MetricsText(r.Context())))
}

func (h *Handlers) SystemHealth(w http.ResponseWriter, r *http.Request) {
	health, err := h.db.SystemHealth(r.Context())
	if err != nil {
		writeStoreReadError(w, err, "")
		return
	}
	writeOK(w, http.StatusOK, health, "")
}

type SendChatRequest struct {
	ConversationID string      `json:"conversation_id"`
	Channel        string      `json:"channel"`
	Message        string      `json:"message"`
	Options        ChatOptions `json:"options"`
}

type ChatOptions struct {
	ExplicitAgent string `json:"explicit_agent"`
	PreferredNode string `json:"preferred_node"`
	AllowTools    bool   `json:"allow_tools"`
	AllowWorker   bool   `json:"allow_worker"`
}

func (h *Handlers) SendChat(w http.ResponseWriter, r *http.Request) {
	var request SendChatRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid JSON request body", map[string]any{}, "")
		return
	}

	if strings.TrimSpace(request.Message) == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "message is required", map[string]any{
			"field": "message",
		}, "")
		return
	}

	result, err := h.db.SendChat(r.Context(), store.SendChatParams{
		ConversationID: request.ConversationID,
		Channel:        request.Channel,
		UserID:         "default_user",
		Message:        request.Message,
		PreferredNode:  request.Options.PreferredNode,
		AllowWorker:    request.Options.AllowWorker,
	})
	if err != nil {
		h.logger.Error("chat send failed", "service", "orchestrator-core", "error", err)
		writeError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to create chat run", map[string]any{}, "")
		return
	}

	writeOK(w, http.StatusOK, result, result.RunID)
}

func (h *Handlers) GetRun(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("id")
	run, err := h.db.GetRun(r.Context(), runID)
	if err != nil {
		writeStoreReadError(w, err, runID)
		return
	}

	writeOK(w, http.StatusOK, run, run.ID)
}

func (h *Handlers) GetRunSteps(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("id")
	steps, err := h.db.ListRunSteps(r.Context(), runID)
	if err != nil {
		writeStoreReadError(w, err, runID)
		return
	}

	writeOK(w, http.StatusOK, map[string]any{
		"run_id": runID,
		"steps":  steps,
	}, runID)
}

func (h *Handlers) ListAgents(w http.ResponseWriter, r *http.Request) {
	agents, err := h.db.ListAgents(r.Context())
	if err != nil {
		writeStoreReadError(w, err, "")
		return
	}

	writeOK(w, http.StatusOK, map[string]any{
		"agents": agents,
	}, "")
}

type SearchMemoriesRequest struct {
	Query   string `json:"query"`
	RunID   string `json:"run_id"`
	AgentID string `json:"agent_id"`
	Limit   int    `json:"limit"`
}

type ProposeMemoryRequest struct {
	Type           string   `json:"type"`
	Content        string   `json:"content"`
	Summary        string   `json:"summary"`
	ScopeType      string   `json:"scope_type"`
	ScopeID        string   `json:"scope_id"`
	PrivacyLevel   string   `json:"privacy_level"`
	Confidence     float64  `json:"confidence"`
	SourceEventIDs []string `json:"source_event_ids"`
}

type MemoryFeedbackRequest struct {
	RunID    string `json:"run_id"`
	Feedback string `json:"feedback"`
	Comment  string `json:"comment"`
}

type UpdateMemoryGovernanceRequest struct {
	Pinned            *bool  `json:"pinned"`
	Disabled          *bool  `json:"disabled"`
	MergeIntoMemoryID string `json:"merge_into_memory_id"`
	ConflictGroupID   string `json:"conflict_group_id"`
	ConflictReason    string `json:"conflict_reason"`
	MarkConflict      *bool  `json:"mark_conflict"`
	Outcome           string `json:"outcome"`
}

func (h *Handlers) ListMemories(w http.ResponseWriter, r *http.Request) {
	memories, err := h.db.ListMemories(r.Context())
	if err != nil {
		writeStoreReadError(w, err, "")
		return
	}

	writeOK(w, http.StatusOK, map[string]any{
		"memories": memories,
	}, "")
}

func (h *Handlers) SearchMemories(w http.ResponseWriter, r *http.Request) {
	var request SearchMemoriesRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid JSON request body", map[string]any{}, "")
		return
	}
	if strings.TrimSpace(request.Query) == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "query is required", map[string]any{"field": "query"}, request.RunID)
		return
	}

	result, err := h.db.SearchMemories(r.Context(), store.SearchMemoriesParams{
		Query:   request.Query,
		RunID:   request.RunID,
		AgentID: request.AgentID,
		Limit:   request.Limit,
	})
	if err != nil {
		writeStoreReadError(w, err, request.RunID)
		return
	}

	writeOK(w, http.StatusOK, result, request.RunID)
}

func (h *Handlers) ListMemoryMergeSuggestions(w http.ResponseWriter, r *http.Request) {
	suggestions, err := h.db.ListMemoryMergeSuggestions(r.Context())
	if err != nil {
		writeStoreReadError(w, err, "")
		return
	}
	writeOK(w, http.StatusOK, map[string]any{"suggestions": suggestions}, "")
}

func (h *Handlers) ProposeMemory(w http.ResponseWriter, r *http.Request) {
	var request ProposeMemoryRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid JSON request body", map[string]any{}, "")
		return
	}
	if strings.TrimSpace(request.Content) == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "content is required", map[string]any{"field": "content"}, "")
		return
	}

	memory, err := h.db.ProposeMemory(r.Context(), store.ProposeMemoryParams{
		Type:           request.Type,
		Content:        request.Content,
		Summary:        request.Summary,
		ScopeType:      request.ScopeType,
		ScopeID:        request.ScopeID,
		PrivacyLevel:   request.PrivacyLevel,
		Confidence:     request.Confidence,
		SourceEventIDs: request.SourceEventIDs,
	})
	if err != nil {
		writeStoreReadError(w, err, "")
		return
	}

	writeOK(w, http.StatusOK, memory, "")
}

func (h *Handlers) RecordMemoryFeedback(w http.ResponseWriter, r *http.Request) {
	var request MemoryFeedbackRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid JSON request body", map[string]any{}, "")
		return
	}
	memoryID := r.PathValue("id")
	if err := h.db.RecordMemoryFeedback(r.Context(), store.MemoryFeedbackParams{
		MemoryID: memoryID,
		RunID:    request.RunID,
		Feedback: request.Feedback,
		Comment:  request.Comment,
	}); err != nil {
		writeStoreReadError(w, err, "")
		return
	}
	feedback := request.Feedback
	if feedback == "" {
		feedback = "neutral"
	}
	writeOK(w, http.StatusOK, map[string]any{"memory_id": memoryID, "feedback": feedback}, "")
}

func (h *Handlers) UpdateMemoryGovernance(w http.ResponseWriter, r *http.Request) {
	var request UpdateMemoryGovernanceRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid JSON request body", map[string]any{}, "")
		return
	}
	memory, err := h.db.UpdateMemoryGovernance(r.Context(), store.UpdateMemoryGovernanceParams{
		MemoryID:          r.PathValue("id"),
		Pinned:            request.Pinned,
		Disabled:          request.Disabled,
		MergeIntoMemoryID: request.MergeIntoMemoryID,
		ConflictGroupID:   request.ConflictGroupID,
		ConflictReason:    request.ConflictReason,
		MarkConflict:      request.MarkConflict,
		Outcome:           request.Outcome,
	})
	if err != nil {
		writeStoreReadError(w, err, "")
		return
	}
	writeOK(w, http.StatusOK, map[string]any{"memory": memory}, "")
}

type TestCapabilityRequest struct {
	Goal   string         `json:"goal"`
	Inputs map[string]any `json:"inputs"`
	Risk   string         `json:"risk"`
	RunID  string         `json:"run_id"`
}

func (h *Handlers) ListCapabilities(w http.ResponseWriter, r *http.Request) {
	capabilities, err := h.db.ListCapabilities(r.Context())
	if err != nil {
		writeStoreReadError(w, err, "")
		return
	}

	writeOK(w, http.StatusOK, map[string]any{
		"capabilities": capabilities,
	}, "")
}

func (h *Handlers) TestCapability(w http.ResponseWriter, r *http.Request) {
	var request TestCapabilityRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid JSON request body", map[string]any{}, request.RunID)
		return
	}

	result, err := h.db.CompileAndRecordCapability(r.Context(), store.CapabilityRequest{
		Type:       "capability_request",
		Capability: r.PathValue("id"),
		Goal:       request.Goal,
		Inputs:     request.Inputs,
		Risk:       request.Risk,
		RunID:      request.RunID,
	})
	if err != nil {
		code := "TOOL_COMPILE_FAILED"
		status := http.StatusBadRequest
		if errors.Is(err, store.ErrPolicyDenied) {
			code = "POLICY_DENIED"
			status = http.StatusForbidden
		}
		writeError(w, status, code, err.Error(), map[string]any{}, request.RunID)
		return
	}

	writeOK(w, http.StatusOK, result, request.RunID)
}

func (h *Handlers) ListModelCalls(w http.ResponseWriter, r *http.Request) {
	calls, err := h.db.ListRecentModelCalls(r.Context(), 100)
	if err != nil {
		writeStoreReadError(w, err, "")
		return
	}
	writeOK(w, http.StatusOK, map[string]any{"model_calls": calls}, "")
}

func (h *Handlers) ModelUsageSummary(w http.ResponseWriter, r *http.Request) {
	summary, err := h.db.ModelUsageSummary(r.Context())
	if err != nil {
		writeStoreReadError(w, err, "")
		return
	}
	writeOK(w, http.StatusOK, summary, "")
}

func (h *Handlers) ListProviderCacheStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.db.ListProviderCacheStats(r.Context(), 100)
	if err != nil {
		writeStoreReadError(w, err, "")
		return
	}
	writeOK(w, http.StatusOK, map[string]any{"provider_cache_stats": stats}, "")
}

func (h *Handlers) ModelProviderHealth(w http.ResponseWriter, r *http.Request) {
	health := h.db.ModelProviderHealth(r.Context())
	writeOK(w, http.StatusOK, health, "")
}

func (h *Handlers) ListNodes(w http.ResponseWriter, r *http.Request) {
	nodes, err := h.db.ListNodes(r.Context())
	if err != nil {
		writeStoreReadError(w, err, "")
		return
	}
	writeOK(w, http.StatusOK, map[string]any{"nodes": nodes}, "")
}

func (h *Handlers) HeartbeatMainNode(w http.ResponseWriter, r *http.Request) {
	node, err := h.db.HeartbeatMainNode(r.Context())
	if err != nil {
		writeStoreReadError(w, err, "")
		return
	}
	writeOK(w, http.StatusOK, node, "")
}

func (h *Handlers) ListConfirmations(w http.ResponseWriter, r *http.Request) {
	items, err := h.db.ListConfirmationRequests(r.Context())
	if err != nil {
		writeStoreReadError(w, err, "")
		return
	}
	writeOK(w, http.StatusOK, map[string]any{"confirmations": items}, "")
}

type ConfirmationDecisionRequest struct {
	Actor  string `json:"actor"`
	Reason string `json:"reason"`
}

func (h *Handlers) ApproveConfirmation(w http.ResponseWriter, r *http.Request) {
	h.decideConfirmation(w, r, true)
}

func (h *Handlers) RejectConfirmation(w http.ResponseWriter, r *http.Request) {
	h.decideConfirmation(w, r, false)
}

func (h *Handlers) decideConfirmation(w http.ResponseWriter, r *http.Request, approve bool) {
	var request ConfirmationDecisionRequest
	_ = json.NewDecoder(r.Body).Decode(&request)
	if request.Actor == "" {
		request.Actor = "console"
	}
	if err := h.db.DecideConfirmationRequest(r.Context(), r.PathValue("id"), approve, request.Actor, request.Reason); err != nil {
		writeStoreReadError(w, err, "")
		return
	}
	status := "rejected"
	if approve {
		status = "approved"
	}
	writeOK(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "status": status}, "")
}

func writeStoreReadError(w http.ResponseWriter, err error, traceID string) {
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "VALIDATION_ERROR", "Resource not found", map[string]any{}, traceID)
		return
	}
	writeError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to read resource", map[string]any{}, traceID)
}
