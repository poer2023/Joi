package api

import (
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/internal/appcore"
)

func NewRouter(core *appcore.AppCore, logger *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	handlers := NewHandlers(core, logger)

	mux.HandleFunc("GET /health", handlers.Health)
	mux.HandleFunc("GET /ready", handlers.Ready)
	mux.HandleFunc("GET /metrics", handlers.Metrics)
	mux.HandleFunc("GET /api/system-health", handlers.SystemHealth)
	mux.HandleFunc("POST /api/chat/send", handlers.SendChat)
	mux.HandleFunc("GET /api/conversations", handlers.ListConversations)
	mux.HandleFunc("GET /api/conversations/{id}", handlers.GetConversation)
	mux.HandleFunc("GET /api/runs/{id}", handlers.GetRun)
	mux.HandleFunc("GET /api/runs/{id}/steps", handlers.GetRunSteps)
	mux.HandleFunc("GET /api/agents", handlers.ListAgents)
	mux.HandleFunc("GET /api/memories", handlers.ListMemories)
	mux.HandleFunc("POST /api/memories/search", handlers.SearchMemories)
	mux.HandleFunc("GET /api/memories/merge-suggestions", handlers.ListMemoryMergeSuggestions)
	mux.HandleFunc("POST /api/memories/propose", handlers.ProposeMemory)
	mux.HandleFunc("POST /api/memories/{id}/feedback", handlers.RecordMemoryFeedback)
	mux.HandleFunc("PATCH /api/memories/{id}", handlers.UpdateMemoryGovernance)
	mux.HandleFunc("GET /api/capabilities", handlers.ListCapabilities)
	mux.HandleFunc("GET /api/tool-workflows", handlers.ListToolWorkflows)
	mux.HandleFunc("GET /api/tool-runs", handlers.ListToolRuns)
	mux.HandleFunc("POST /api/capabilities/{id}/test", handlers.TestCapability)
	mux.HandleFunc("GET /api/model-calls", handlers.ListModelCalls)
	mux.HandleFunc("GET /api/model-usage-summary", handlers.ModelUsageSummary)
	mux.HandleFunc("GET /api/provider-cache-stats", handlers.ListProviderCacheStats)
	mux.HandleFunc("GET /api/model-provider/health", handlers.ModelProviderHealth)
	mux.HandleFunc("GET /api/nodes", handlers.ListNodes)
	mux.HandleFunc("POST /api/nodes/main-node/heartbeat", handlers.HeartbeatMainNode)
	mux.HandleFunc("GET /api/confirmations", handlers.ListConfirmations)
	mux.HandleFunc("POST /api/confirmations/{id}/approve", handlers.ApproveConfirmation)
	mux.HandleFunc("POST /api/confirmations/{id}/reject", handlers.RejectConfirmation)

	return withCORS(withRequestLog(logger, withAdminAuth(mux)))
}

func withAdminAuth(next http.Handler) http.Handler {
	adminToken := os.Getenv("ADMIN_TOKEN")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if adminToken == "" || !adminProtectedPath(r.URL.Path) || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		token := strings.TrimSpace(r.Header.Get("X-Admin-Token"))
		if token == "" {
			auth := strings.TrimSpace(r.Header.Get("Authorization"))
			token = strings.TrimPrefix(auth, "Bearer ")
		}
		if token != adminToken {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "admin token required", map[string]any{"path": r.URL.Path}, "")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func adminProtectedPath(path string) bool {
	protectedPrefixes := []string{
		"/api/runs/",
		"/api/conversations",
		"/api/memories",
		"/api/nodes",
		"/api/tool-workflows",
		"/api/tool-runs",
		"/api/model-calls",
		"/api/model-usage-summary",
		"/api/provider-cache-stats",
		"/api/model-provider/health",
		"/api/confirmations",
		"/api/system-health",
		"/metrics",
	}
	for _, prefix := range protectedPrefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

func withRequestLog(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		logger.Info(
			"http request",
			"service", "orchestrator-core",
			"method", r.Method,
			"path", r.URL.Path,
		)
		next.ServeHTTP(w, r)
	})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
