package appcore

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/hao/agent-os/services/orchestrator-core/internal/runtimeconfig"
	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

type AppCore struct {
	Store   Store
	Queue   store.TaskQueue
	Runtime Runtime
	Config  runtimeconfig.Config

	db      *store.DB
	logger  *slog.Logger
	started bool
}

type Store interface {
	Close() error
}

type Runtime interface{}

type ChatRequest struct {
	ConversationID string `json:"conversation_id"`
	Channel        string `json:"channel"`
	UserID         string `json:"user_id"`
	Message        string `json:"message"`
	PreferredNode  string `json:"preferred_node"`
	AllowWorker    bool   `json:"allow_worker"`
}

type ChatResponse = store.SendChatResult
type RunTrace = store.RunRecord
type MemorySearchRequest = store.SearchMemoriesParams
type MemorySearchResponse = store.SearchMemoriesResponse
type MemoryFilter struct {
	Query string `json:"query"`
	Limit int    `json:"limit"`
}
type MemoryListResponse struct {
	Memories []store.MemoryRecord `json:"memories"`
}
type NodeListResponse struct {
	Nodes []store.NodeRecord `json:"nodes"`
}
type SystemHealthResponse = store.SystemHealthRecord

func NewAppCore(ctx context.Context, cfg runtimeconfig.Config, logger *slog.Logger) (*AppCore, error) {
	if logger == nil {
		logger = slog.Default()
	}
	switch cfg.App.DataStore {
	case "", "postgres":
		db, err := store.Open(ctx, cfg.Database.URL)
		if err != nil {
			return nil, err
		}
		return &AppCore{Store: db, Config: cfg, db: db, logger: logger}, nil
	case "sqlite":
		db, err := store.OpenSQLite(ctx, cfg.App.SQLitePath)
		if err != nil {
			return nil, err
		}
		return &AppCore{Store: db, Config: cfg, db: db, logger: logger}, nil
	default:
		return nil, errors.New("unsupported DATA_STORE: " + cfg.App.DataStore)
	}
}

func (a *AppCore) Start(ctx context.Context) error {
	if a.started {
		return nil
	}
	if a.db == nil {
		return errors.New("appcore store is not initialized")
	}
	if a.isSQLite() {
		schemaPath, err := sqliteSchemaPath()
		if err != nil {
			return err
		}
		if err := a.db.ApplySQLiteSchema(ctx, schemaPath); err != nil {
			return err
		}
		if err := a.db.SeedSQLiteDefaults(ctx); err != nil {
			return err
		}
		if err := a.seedSQLiteRuntimeModel(ctx); err != nil {
			return err
		}
		if err := a.db.RecoverSQLiteTasks(ctx, 2*time.Minute); err != nil {
			a.logger.Warn("sqlite task recovery skipped", "service", "appcore", "error", err)
		}
		queue, err := store.NewTaskQueue(a.db.SQL(), a.Config.TaskQueue.Driver)
		if err != nil {
			return err
		}
		a.Queue = queue
		a.started = true
		return nil
	}
	if err := a.db.ApplyMigrations(ctx, a.Config.Server.MigrationsDir); err != nil {
		return err
	}
	if err := a.db.SeedRegistryFromDir(ctx, a.Config.Server.ConfigDir); err != nil {
		a.logger.Warn("registry seed skipped", "service", "appcore", "error", err, "config_dir", a.Config.Server.ConfigDir)
	}
	if err := a.db.RecoverInterruptedTasks(ctx); err != nil {
		a.logger.Warn("task recovery skipped", "service", "appcore", "error", err)
	}
	_ = a.db.RecoverStuckTasks(ctx, 2*time.Minute)
	_ = a.db.MarkOfflineNodes(ctx, 90*time.Second)
	if err := a.db.RegisterMainNode(ctx); err != nil {
		return err
	}
	queue, err := store.NewTaskQueue(a.db.SQL(), a.Config.TaskQueue.Driver)
	if err != nil {
		return err
	}
	a.Queue = queue
	a.started = true
	return nil
}

func (a *AppCore) Shutdown(ctx context.Context) error {
	_ = ctx
	if a.Store == nil {
		return nil
	}
	return a.Store.Close()
}

func (a *AppCore) SendChat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	if a.isSQLite() {
		return a.sendSQLiteChat(ctx, req)
	}
	userID := req.UserID
	if userID == "" {
		userID = "default_user"
	}
	return a.db.SendChat(ctx, store.SendChatParams{
		ConversationID: req.ConversationID,
		Channel:        req.Channel,
		UserID:         userID,
		Message:        req.Message,
		PreferredNode:  req.PreferredNode,
		AllowWorker:    req.AllowWorker,
	})
}

func (a *AppCore) GetRunTrace(ctx context.Context, runID string) (*RunTrace, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	if a.isSQLite() {
		return a.getSQLiteRun(ctx, runID)
	}
	return a.db.GetRun(ctx, runID)
}

func (a *AppCore) SearchMemories(ctx context.Context, req MemorySearchRequest) (*MemorySearchResponse, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	if a.isSQLite() {
		return a.searchSQLiteMemories(ctx, req)
	}
	return a.db.SearchMemories(ctx, req)
}

func (a *AppCore) ListMemories(ctx context.Context, filter MemoryFilter) (*MemoryListResponse, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	if filter.Query != "" {
		result, err := a.SearchMemories(ctx, MemorySearchRequest{Query: filter.Query, Limit: filter.Limit})
		if err != nil {
			return nil, err
		}
		memories := make([]store.MemoryRecord, 0, len(result.Results))
		for _, item := range result.Results {
			memories = append(memories, item.Memory)
		}
		return &MemoryListResponse{Memories: memories}, nil
	}
	if a.isSQLite() {
		return a.listSQLiteMemories(ctx, filter.Limit)
	}
	memories, err := a.db.ListMemories(ctx)
	if err != nil {
		return nil, err
	}
	return &MemoryListResponse{Memories: memories}, nil
}

func (a *AppCore) ListNodes(ctx context.Context) (*NodeListResponse, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	if a.isSQLite() {
		nodes, err := a.listSQLiteNodes(ctx)
		if err != nil {
			return nil, err
		}
		return &NodeListResponse{Nodes: nodes}, nil
	}
	nodes, err := a.db.ListNodes(ctx)
	if err != nil {
		return nil, err
	}
	return &NodeListResponse{Nodes: nodes}, nil
}

func (a *AppCore) GetSystemHealth(ctx context.Context) (*SystemHealthResponse, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	if a.isSQLite() {
		nodes, _ := a.listSQLiteNodes(ctx)
		health := &SystemHealthResponse{
			ServiceStatus:   map[string]any{"orchestrator": "ok", "sqlite": a.db.Ping(ctx) == nil, "docker_required": false},
			QueueStatus:     map[string]any{},
			WorkerStatus:    nodes,
			RecentErrors:    []map[string]any{},
			ModelLatency:    map[string]any{},
			ToolFailureRate: map[string]any{},
			TokenCostToday:  map[string]any{},
			Warnings:        []map[string]any{},
		}
		var activeTasks, deadTasks, stuckTasks, modelCalls, modelErrors, inputTokens, outputTokens, cachedTokens int
		var avgLatency sql.NullFloat64
		_ = a.db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks WHERE status IN ('pending','running','retrying')`).Scan(&activeTasks)
		_ = a.db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks WHERE status='dead'`).Scan(&deadTasks)
		_ = a.db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks WHERE status='running' AND started_at < datetime('now', '-10 minutes')`).Scan(&stuckTasks)
		_ = a.db.SQL().QueryRowContext(ctx, `SELECT COUNT(*), SUM(CASE WHEN status NOT IN ('succeeded','fallback_to_mock') THEN 1 ELSE 0 END) FROM model_calls WHERE created_at >= date('now')`).Scan(&modelCalls, &modelErrors)
		_ = a.db.SQL().QueryRowContext(ctx, `SELECT COALESCE(AVG(latency_ms),0) FROM model_calls WHERE created_at >= date('now')`).Scan(&avgLatency)
		_ = a.db.SQL().QueryRowContext(ctx, `SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cached_input_tokens),0) FROM model_calls WHERE created_at >= date('now')`).Scan(&inputTokens, &outputTokens, &cachedTokens)
		health.QueueStatus["active_tasks"] = activeTasks
		health.QueueStatus["dead_tasks"] = deadTasks
		health.QueueStatus["stuck_running_tasks"] = stuckTasks
		health.ModelLatency["model_calls_today"] = modelCalls
		health.ModelLatency["model_errors_today"] = modelErrors
		health.ModelLatency["avg_latency_ms_today"] = avgLatency.Float64
		health.TokenCostToday["input_tokens"] = inputTokens
		health.TokenCostToday["output_tokens"] = outputTokens
		health.TokenCostToday["cached_input_tokens"] = cachedTokens
		health.TokenCostToday["estimated_cost"] = 0
		return health, nil
	}
	return a.db.SystemHealth(ctx)
}

func (a *AppCore) DB() *store.DB {
	return a.db
}

func (a *AppCore) isSQLite() bool {
	return a.Config.App.DataStore == "sqlite"
}

func (a *AppCore) seedSQLiteRuntimeModel(ctx context.Context) error {
	provider := valueOrDefault(a.Config.Model.Provider, "openai_compatible")
	modelName := valueOrDefault(a.Config.Model.Name, "model_default")
	baseURL := a.Config.Model.BaseURL
	_, err := a.db.SQL().ExecContext(ctx, `
		INSERT INTO models (id, provider, model_name, display_name, base_url, base_url_env, api_key_env, supports_json_mode, supports_tool_calling, enabled, metadata, updated_at)
		VALUES ('model_default', ?, ?, ?, ?, 'MODEL_DEFAULT_BASE_URL', 'MODEL_DEFAULT_API_KEY', 1, 0, 1, ?, datetime('now'))
		ON CONFLICT(id) DO UPDATE SET
			provider=excluded.provider,
			model_name=excluded.model_name,
			display_name=excluded.display_name,
			base_url=excluded.base_url,
			base_url_env=excluded.base_url_env,
			api_key_env=excluded.api_key_env,
			supports_json_mode=excluded.supports_json_mode,
			enabled=excluded.enabled,
			metadata=excluded.metadata,
			updated_at=datetime('now');
		UPDATE agents SET default_model_id='model_default', updated_at=datetime('now') WHERE id IN ('general_agent','devops_agent','research_agent','memory_agent','product_agent');
	`, provider, modelName, modelName, baseURL, mustJSON(map[string]any{"source": "desktop_runtime_config"}))
	return err
}

func sqliteSchemaPath() (string, error) {
	if explicit := strings.TrimSpace(os.Getenv("SQLITE_SCHEMA_PATH")); explicit != "" {
		return explicit, nil
	}
	candidates := []string{
		"database/sqlite/001_init_schema.sql",
		"../../database/sqlite/001_init_schema.sql",
		"../../../database/sqlite/001_init_schema.sql",
		"../../../../database/sqlite/001_init_schema.sql",
	}
	wd, _ := os.Getwd()
	if wd != "" {
		candidates = append(candidates, filepath.Join(wd, "database/sqlite/001_init_schema.sql"))
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	return "", errors.New("sqlite schema not found; set SQLITE_SCHEMA_PATH")
}

func (a *AppCore) sendSQLiteChat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	channel := valueOrDefault(req.Channel, "desktop")
	userID := valueOrDefault(req.UserID, "desktop_user")
	conversationID := req.ConversationID
	selectedAgentID := routeSQLiteAgent(req.Message)
	if strings.HasPrefix(strings.ToLower(req.Message), "@") {
		selectedAgentID = explicitSQLiteAgent(req.Message)
	}
	tx, err := a.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if conversationID == "" {
		conversationID, err = store.NewID("conv_")
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO conversations (id, channel, user_id, active_agent_id, title, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`, conversationID, channel, userID, selectedAgentID, truncate(req.Message, 80)); err != nil {
			return nil, err
		}
	} else {
		if _, err := tx.ExecContext(ctx, `UPDATE conversations SET active_agent_id=?, updated_at=datetime('now') WHERE id=?`, selectedAgentID, conversationID); err != nil {
			return nil, err
		}
	}

	userMessageID, err := store.NewID("msg_")
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', ?)`, userMessageID, conversationID, req.Message); err != nil {
		return nil, err
	}
	runID, err := store.NewID("run_")
	if err != nil {
		return nil, err
	}
	routeResult := map[string]any{"intent": "desktop_chat", "route_mode": "single", "lead_agent": selectedAgentID, "route_source": "desktop_appcore", "confidence": 0.8}
	routeRaw := mustJSON(routeResult)
	metadataRaw := mustJSON(map[string]any{"app_mode": "desktop", "data_store": "sqlite", "task_queue": "sqlite"})
	if _, err := tx.ExecContext(ctx, `INSERT INTO runs (id, conversation_id, user_message_id, status, selected_agent_id, route_result, finished_at, duration_ms, metadata) VALUES (?, ?, ?, 'succeeded', ?, ?, datetime('now'), 0, ?)`, runID, conversationID, userMessageID, selectedAgentID, routeRaw, metadataRaw); err != nil {
		return nil, err
	}

	modelID := "model_default"
	provider := valueOrDefault(a.Config.Model.Provider, "openai_compatible")
	modelName := valueOrDefault(a.Config.Model.Name, "model_default")
	prefix := desktopCacheablePrefix(selectedAgentID)
	dynamic := desktopDynamicTail(runID, selectedAgentID, req.Message, "")
	prefixHash := hashText(prefix)
	dynamicHash := hashText(dynamic)
	promptCacheKey := selectedAgentID + ":" + modelID + ":" + prefixHash + ":desktop_profile_v1:tool_schema_v1"
	contextPackID, _ := store.NewID("mcp_")
	assemblyID, _ := store.NewID("pa_")
	modelCallID, _ := store.NewID("mc_")
	if _, err := tx.ExecContext(ctx, `INSERT INTO memory_context_packs (id, run_id, agent_id, memory_profile_version, profile, project_facts, relevant_episodes, heuristics, anti_patterns, open_issues, dynamic_retrieval, metadata) VALUES (?, ?, ?, 'desktop_profile_v1', '[]', '[]', '[]', '[]', '[]', '[]', '[]', ?)`, contextPackID, runID, selectedAgentID, mustJSON(map[string]any{"source": "desktop_appcore"})); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO prompt_assemblies (id, run_id, agent_id, model_id, memory_context_pack_id, cacheable_prefix, dynamic_tail, prefix_hash, dynamic_tail_hash, prompt_cache_key, memory_profile_version, tool_schema_version, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'desktop_profile_v1', 'tool_schema_v1', ?)`, assemblyID, runID, selectedAgentID, modelID, contextPackID, prefix, dynamic, prefixHash, dynamicHash, promptCacheKey, mustJSON(map[string]any{"desktop_poc": true, "assembly_version": "desktop_v1"})); err != nil {
		return nil, err
	}

	modelRequest := store.ModelRequest{
		Provider:        provider,
		ModelID:         modelID,
		ModelName:       modelName,
		CacheablePrefix: prefix,
		DynamicTail:     dynamic,
		PromptCacheKey:  promptCacheKey,
		PrefixHash:      prefixHash,
		DynamicTailHash: dynamicHash,
		Metadata: map[string]any{
			"prompt_assembly_id":     assemblyID,
			"memory_profile_version": "desktop_profile_v1",
			"tool_schema_version":    "tool_schema_v1",
			"desktop_mode":           true,
		},
	}
	modelResponse, modelErr := store.InvokeModelDirect(ctx, modelRequest)
	if modelErr != nil {
		if _, err := tx.ExecContext(ctx, `INSERT INTO model_calls (id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name, prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, output_tokens, cached_input_tokens, latency_ms, status, error_code, error_message, raw_response, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'failed', 'provider_failed', ?, '{}', ?)`, modelCallID, runID, selectedAgentID, modelID, assemblyID, provider, modelName, promptCacheKey, prefixHash, dynamicHash, len(strings.Fields(prefix))+len(strings.Fields(dynamic)), modelErr.Error(), mustJSON(map[string]any{"real_model": false, "fallback_to_mock": false, "desktop_mode": true})); err != nil {
			return nil, err
		}
		return nil, modelErr
	}
	response := desktopFinalAnswer(modelResponse.Content)
	if response == "" {
		response = modelResponse.Content
	}
	if strings.TrimSpace(response) == "" {
		response = "模型没有返回可展示内容。"
	}
	status := "succeeded"
	if modelResponse.FallbackToMock {
		status = "fallback_to_mock"
	}
	metadata := map[string]any{
		"real_model":          modelResponse.Provider != "" && modelResponse.Provider != "mock_provider" && !modelResponse.FallbackToMock,
		"fallback_to_mock":    modelResponse.FallbackToMock,
		"fallback_reason":     modelResponse.FallbackReason,
		"desktop_mode":        true,
		"provider_cache_key":  promptCacheKey,
		"estimated_cost":      0,
		"prompt_assembly_id":  assemblyID,
		"tool_schema_version": "tool_schema_v1",
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO model_calls (id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name, prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, output_tokens, cacheable_prefix_tokens, dynamic_tail_tokens, cached_input_tokens, latency_ms, status, raw_response, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, modelCallID, runID, selectedAgentID, modelID, assemblyID, modelResponse.Provider, modelResponse.ModelName, promptCacheKey, prefixHash, dynamicHash, modelResponse.InputTokens, modelResponse.OutputTokens, len(strings.Fields(prefix)), len(strings.Fields(dynamic)), modelResponse.CachedInputTokens, modelResponse.LatencyMs, status, mustJSON(modelResponse.RawResponse), mustJSON(metadata)); err != nil {
		return nil, err
	}
	cacheStatID, _ := store.NewID("pcache_")
	hitRatio := 0.0
	if modelResponse.InputTokens > 0 {
		hitRatio = float64(modelResponse.CachedInputTokens) / float64(modelResponse.InputTokens)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO provider_cache_stats (id, provider, model_id, model_name, prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, cached_input_tokens, hit_ratio, latency_ms, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, cacheStatID, modelResponse.Provider, modelID, modelResponse.ModelName, promptCacheKey, prefixHash, dynamicHash, modelResponse.InputTokens, modelResponse.CachedInputTokens, hitRatio, modelResponse.LatencyMs, mustJSON(map[string]any{"desktop_mode": true})); err != nil {
		return nil, err
	}

	stepInputs := []struct {
		stepType string
		title    string
		input    map[string]any
		output   map[string]any
	}{
		{"input_received", "Input received", map[string]any{"message": req.Message, "channel": channel}, map[string]any{"conversation_id": conversationID, "message_id": userMessageID}},
		{"router_selected", "Router selected agent", map[string]any{"message": req.Message}, routeResult},
		{"prompt_assembled", "Prompt assembly finished", map[string]any{"run_id": runID}, map[string]any{"prompt_assembly_id": assemblyID, "prefix_hash": prefixHash, "dynamic_tail_hash": dynamicHash, "prompt_cache_key": promptCacheKey}},
		{"model_call_finished", "Model call finished", map[string]any{"agent_id": selectedAgentID, "model_id": modelID, "prompt_assembly_id": assemblyID}, map[string]any{"provider": modelResponse.Provider, "model": modelResponse.ModelName, "real_model": metadata["real_model"], "fallback_to_mock": modelResponse.FallbackToMock, "fallback_reason": modelResponse.FallbackReason, "input_tokens": modelResponse.InputTokens, "output_tokens": modelResponse.OutputTokens, "cached_input_tokens": modelResponse.CachedInputTokens, "latency_ms": modelResponse.LatencyMs}},
		{"agent_output_parsed", "Agent output parsed", map[string]any{"agent_id": selectedAgentID}, map[string]any{"output_type": desktopOutputType(modelResponse.Content)}},
		{"agent_call_finished", "Agent runtime finished", map[string]any{"agent_id": selectedAgentID}, map[string]any{"response": response, "model_call_id": modelCallID}},
		{"response_generated", "Response generated", map[string]any{"run_id": runID}, map[string]any{"response": response}},
	}
	steps := make([]store.RunStepBrief, 0, len(stepInputs))
	for _, item := range stepInputs {
		stepID, err := store.NewID("step_")
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO run_steps (id, run_id, step_type, title, status, input, output, finished_at, duration_ms) VALUES (?, ?, ?, ?, 'succeeded', ?, ?, datetime('now'), 0)`, stepID, runID, item.stepType, item.title, mustJSON(item.input), mustJSON(item.output)); err != nil {
			return nil, err
		}
		steps = append(steps, store.RunStepBrief{ID: stepID, StepType: item.stepType, Title: item.title, Status: "succeeded"})
	}

	assistantMessageID, err := store.NewID("msg_")
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO messages (id, conversation_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)`, assistantMessageID, conversationID, response, mustJSON(map[string]any{"run_id": runID, "agent_id": selectedAgentID})); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &ChatResponse{ConversationID: conversationID, UserMessageID: userMessageID, AssistantMessageID: assistantMessageID, RunID: runID, SelectedAgentID: selectedAgentID, Response: response, Steps: steps}, nil
}

func (a *AppCore) getSQLiteRun(ctx context.Context, runID string) (*RunTrace, error) {
	var run RunTrace
	var routeRaw, metadataRaw string
	var finishedAt, errorCode, errorMessage sql.NullString
	var durationMs sql.NullInt32
	var startedAt, createdAt string
	var selectedAgentID sql.NullString
	err := a.db.SQL().QueryRowContext(ctx, `
		SELECT id, conversation_id, user_message_id, status, selected_agent_id, route_result,
		       started_at, finished_at, duration_ms, error_code, error_message, metadata, created_at
		FROM runs WHERE id=?
	`, runID).Scan(&run.ID, &run.ConversationID, &run.UserMessageID, &run.Status, &selectedAgentID, &routeRaw, &startedAt, &finishedAt, &durationMs, &errorCode, &errorMessage, &metadataRaw, &createdAt)
	if err != nil {
		return nil, err
	}
	run.SelectedAgentID = selectedAgentID.String
	run.RouteResult = decodeObject([]byte(routeRaw))
	run.Metadata = decodeObject([]byte(metadataRaw))
	run.StartedAt = parseSQLiteTime(startedAt)
	run.CreatedAt = parseSQLiteTime(createdAt)
	if finishedAt.Valid {
		t := parseSQLiteTime(finishedAt.String)
		run.FinishedAt = &t
	}
	run.DurationMs = nullIntPtr(durationMs)
	run.ErrorCode = nullStringPtr(errorCode)
	run.ErrorMessage = nullStringPtr(errorMessage)
	run.Steps, _ = a.listSQLiteRunSteps(ctx, runID)
	run.PromptAssemblies, _ = a.listSQLitePromptAssemblies(ctx, runID)
	run.ModelCalls, _ = a.listSQLiteModelCalls(ctx, runID)
	run.MemoryContextPacks, _ = a.listSQLiteMemoryContextPacks(ctx, runID)
	return &run, nil
}

func (a *AppCore) listSQLiteRunSteps(ctx context.Context, runID string) ([]store.RunStepRecord, error) {
	rows, err := a.db.SQL().QueryContext(ctx, `SELECT id, run_id, step_type, title, status, input, output, COALESCE(error, ''), started_at, finished_at, duration_ms, created_at FROM run_steps WHERE run_id=? ORDER BY created_at ASC`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	steps := []store.RunStepRecord{}
	for rows.Next() {
		var step store.RunStepRecord
		var inputRaw, outputRaw, errorRaw string
		var startedAt, createdAt string
		var finishedAt sql.NullString
		var durationMs sql.NullInt32
		if err := rows.Scan(&step.ID, &step.RunID, &step.StepType, &step.Title, &step.Status, &inputRaw, &outputRaw, &errorRaw, &startedAt, &finishedAt, &durationMs, &createdAt); err != nil {
			return nil, err
		}
		step.Input = decodeObject([]byte(inputRaw))
		step.Output = decodeObject([]byte(outputRaw))
		step.Error = decodeObject([]byte(errorRaw))
		step.StartedAt = parseSQLiteTime(startedAt)
		step.CreatedAt = parseSQLiteTime(createdAt)
		if finishedAt.Valid {
			t := parseSQLiteTime(finishedAt.String)
			step.FinishedAt = &t
		}
		step.DurationMs = nullIntPtr(durationMs)
		steps = append(steps, step)
	}
	return steps, rows.Err()
}

func (a *AppCore) listSQLitePromptAssemblies(ctx context.Context, runID string) ([]store.PromptAssemblyRecord, error) {
	rows, err := a.db.SQL().QueryContext(ctx, `SELECT id, run_id, COALESCE(agent_id,''), COALESCE(model_id,''), COALESCE(prompt_template_id,''), COALESCE(memory_context_pack_id,''), cacheable_prefix, dynamic_tail, prefix_hash, dynamic_tail_hash, prompt_cache_key, memory_profile_version, tool_schema_version, metadata, created_at FROM prompt_assemblies WHERE run_id=? ORDER BY created_at ASC`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	records := []store.PromptAssemblyRecord{}
	for rows.Next() {
		var record store.PromptAssemblyRecord
		var metadataRaw, createdAt string
		if err := rows.Scan(&record.ID, &record.RunID, &record.AgentID, &record.ModelID, &record.PromptTemplateID, &record.MemoryContextPackID, &record.CacheablePrefix, &record.DynamicTail, &record.PrefixHash, &record.DynamicTailHash, &record.PromptCacheKey, &record.MemoryProfileVersion, &record.ToolSchemaVersion, &metadataRaw, &createdAt); err != nil {
			return nil, err
		}
		record.Metadata = decodeObject([]byte(metadataRaw))
		record.CreatedAt = parseSQLiteTime(createdAt)
		records = append(records, record)
	}
	return records, rows.Err()
}

func (a *AppCore) listSQLiteModelCalls(ctx context.Context, runID string) ([]store.ModelCallRecord, error) {
	rows, err := a.db.SQL().QueryContext(ctx, `SELECT id, COALESCE(run_id,''), COALESCE(agent_id,''), COALESCE(model_id,''), COALESCE(prompt_assembly_id,''), COALESCE(provider,''), COALESCE(model_name,''), COALESCE(prompt_cache_key,''), COALESCE(prefix_hash,''), COALESCE(dynamic_tail_hash,''), COALESCE(input_tokens,0), COALESCE(output_tokens,0), COALESCE(cacheable_prefix_tokens,0), COALESCE(dynamic_tail_tokens,0), COALESCE(cached_input_tokens,0), COALESCE(latency_ms,0), status, COALESCE(error_code,''), COALESCE(error_message,''), raw_response, metadata, created_at FROM model_calls WHERE run_id=? ORDER BY created_at ASC`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	records := []store.ModelCallRecord{}
	for rows.Next() {
		var record store.ModelCallRecord
		var rawResponseRaw, metadataRaw, createdAt string
		if err := rows.Scan(&record.ID, &record.RunID, &record.AgentID, &record.ModelID, &record.PromptAssemblyID, &record.Provider, &record.ModelName, &record.PromptCacheKey, &record.PrefixHash, &record.DynamicTailHash, &record.InputTokens, &record.OutputTokens, &record.CacheablePrefixTokens, &record.DynamicTailTokens, &record.CachedInputTokens, &record.LatencyMs, &record.Status, &record.ErrorCode, &record.ErrorMessage, &rawResponseRaw, &metadataRaw, &createdAt); err != nil {
			return nil, err
		}
		record.RawResponse = decodeObject([]byte(rawResponseRaw))
		record.Metadata = decodeObject([]byte(metadataRaw))
		record.CreatedAt = parseSQLiteTime(createdAt)
		records = append(records, record)
	}
	return records, rows.Err()
}

func (a *AppCore) listSQLiteMemoryContextPacks(ctx context.Context, runID string) ([]store.MemoryContextPackRecord, error) {
	rows, err := a.db.SQL().QueryContext(ctx, `SELECT id, run_id, COALESCE(agent_id,''), memory_profile_version, profile, project_facts, relevant_episodes, heuristics, anti_patterns, open_issues, dynamic_retrieval, metadata, created_at FROM memory_context_packs WHERE run_id=? ORDER BY created_at ASC`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	records := []store.MemoryContextPackRecord{}
	for rows.Next() {
		var record store.MemoryContextPackRecord
		var profileRaw, projectFactsRaw, relevantEpisodesRaw, heuristicsRaw, antiPatternsRaw, openIssuesRaw, dynamicRetrievalRaw, metadataRaw, createdAt string
		if err := rows.Scan(&record.ID, &record.RunID, &record.AgentID, &record.MemoryProfileVersion, &profileRaw, &projectFactsRaw, &relevantEpisodesRaw, &heuristicsRaw, &antiPatternsRaw, &openIssuesRaw, &dynamicRetrievalRaw, &metadataRaw, &createdAt); err != nil {
			return nil, err
		}
		record.Profile = decodeArray([]byte(profileRaw))
		record.ProjectFacts = decodeArray([]byte(projectFactsRaw))
		record.RelevantEpisodes = decodeArray([]byte(relevantEpisodesRaw))
		record.Heuristics = decodeArray([]byte(heuristicsRaw))
		record.AntiPatterns = decodeArray([]byte(antiPatternsRaw))
		record.OpenIssues = decodeArray([]byte(openIssuesRaw))
		record.DynamicRetrieval = decodeArray([]byte(dynamicRetrievalRaw))
		record.Metadata = decodeObject([]byte(metadataRaw))
		record.CreatedAt = parseSQLiteTime(createdAt)
		records = append(records, record)
	}
	return records, rows.Err()
}

func (a *AppCore) searchSQLiteMemories(ctx context.Context, params MemorySearchRequest) (*MemorySearchResponse, error) {
	limit := params.Limit
	if limit <= 0 || limit > 20 {
		limit = 10
	}
	query := strings.TrimSpace(params.Query)
	var rows *sql.Rows
	var err error
	if query == "" {
		rows, err = a.db.SQL().QueryContext(ctx, `SELECT id, type, content, COALESCE(summary,''), scope_type, COALESCE(scope_id,''), privacy_level, confidence, status, source_event_ids, entities, success_count, failure_count, usage_count, positive_feedback, negative_feedback, pinned, disabled_at, COALESCE(merged_into_memory_id,''), COALESCE(conflict_group_id,''), COALESCE(conflict_reason,''), metadata, created_at, updated_at, last_used_at, 0.5 AS score FROM memories WHERE status IN ('confirmed','pending','conflicted') AND disabled_at IS NULL AND merged_into_memory_id IS NULL ORDER BY pinned DESC, confidence DESC, updated_at DESC LIMIT ?`, limit)
	} else {
		rows, err = a.db.SQL().QueryContext(ctx, `SELECT m.id, m.type, m.content, COALESCE(m.summary,''), m.scope_type, COALESCE(m.scope_id,''), m.privacy_level, m.confidence, m.status, m.source_event_ids, m.entities, m.success_count, m.failure_count, m.usage_count, m.positive_feedback, m.negative_feedback, m.pinned, m.disabled_at, COALESCE(m.merged_into_memory_id,''), COALESCE(m.conflict_group_id,''), COALESCE(m.conflict_reason,''), m.metadata, m.created_at, m.updated_at, m.last_used_at, bm25(memory_fts) * -1 AS score FROM memory_fts JOIN memories m ON m.id = memory_fts.memory_id WHERE memory_fts MATCH ? AND m.status IN ('confirmed','pending','conflicted') AND m.disabled_at IS NULL AND m.merged_into_memory_id IS NULL ORDER BY m.pinned DESC, score DESC, m.confidence DESC LIMIT ?`, ftsQuery(query), limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	results := []store.MemorySearchResult{}
	for rows.Next() {
		memory, score, err := scanSQLiteMemory(rows)
		if err != nil {
			return nil, err
		}
		results = append(results, store.MemorySearchResult{Memory: memory, Score: score, Reason: "sqlite_fts5"})
	}
	return &MemorySearchResponse{Query: params.Query, Results: results, ContextPack: buildMemoryContextPack(results)}, rows.Err()
}

func (a *AppCore) listSQLiteMemories(ctx context.Context, limit int) (*MemoryListResponse, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := a.db.SQL().QueryContext(ctx, `SELECT id, type, content, COALESCE(summary,''), scope_type, COALESCE(scope_id,''), privacy_level, confidence, status, source_event_ids, entities, success_count, failure_count, usage_count, positive_feedback, negative_feedback, pinned, disabled_at, COALESCE(merged_into_memory_id,''), COALESCE(conflict_group_id,''), COALESCE(conflict_reason,''), metadata, created_at, updated_at, last_used_at, 0.5 AS score FROM memories WHERE status <> 'deleted' ORDER BY pinned DESC, updated_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	memories := []store.MemoryRecord{}
	for rows.Next() {
		memory, _, err := scanSQLiteMemory(rows)
		if err != nil {
			return nil, err
		}
		memories = append(memories, memory)
	}
	return &MemoryListResponse{Memories: memories}, rows.Err()
}

func (a *AppCore) listSQLiteNodes(ctx context.Context) ([]store.NodeRecord, error) {
	rows, err := a.db.SQL().QueryContext(ctx, `SELECT id, name, role, status, capabilities, resources, network, assign_policy, auto_assign_enabled, manual_assign_enabled, failed_heartbeat_count, last_failure_at, COALESCE(last_failure_reason,''), last_heartbeat_at, COALESCE(version,''), metadata, created_at, updated_at FROM nodes ORDER BY id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	nodes := []store.NodeRecord{}
	for rows.Next() {
		var node store.NodeRecord
		var capabilitiesRaw, resourcesRaw, networkRaw, assignPolicyRaw, metadataRaw string
		var lastFailure, lastHeartbeat sql.NullString
		var createdAt, updatedAt string
		var autoAssign, manualAssign int
		if err := rows.Scan(&node.ID, &node.Name, &node.Role, &node.Status, &capabilitiesRaw, &resourcesRaw, &networkRaw, &assignPolicyRaw, &autoAssign, &manualAssign, &node.FailedHeartbeatCount, &lastFailure, &node.LastFailureReason, &lastHeartbeat, &node.Version, &metadataRaw, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		node.Capabilities = decodeArray([]byte(capabilitiesRaw))
		node.Resources = decodeObject([]byte(resourcesRaw))
		node.Network = decodeObject([]byte(networkRaw))
		node.AssignPolicy = decodeObject([]byte(assignPolicyRaw))
		node.AutoAssignEnabled = autoAssign != 0
		node.ManualAssignEnabled = manualAssign != 0
		node.CreatedAt = parseSQLiteTime(createdAt)
		node.UpdatedAt = parseSQLiteTime(updatedAt)
		if lastFailure.Valid {
			t := parseSQLiteTime(lastFailure.String)
			node.LastFailureAt = &t
		}
		if lastHeartbeat.Valid {
			t := parseSQLiteTime(lastHeartbeat.String)
			node.LastHeartbeatAt = &t
		}
		node.Metadata = decodeObject([]byte(metadataRaw))
		nodes = append(nodes, node)
	}
	return nodes, rows.Err()
}

func scanSQLiteMemory(rows *sql.Rows) (store.MemoryRecord, float64, error) {
	var memory store.MemoryRecord
	var sourceRaw, entitiesRaw, metadataRaw string
	var pinned int
	var disabledAt, lastUsedAt sql.NullString
	var createdAt, updatedAt string
	var score float64
	err := rows.Scan(&memory.ID, &memory.Type, &memory.Content, &memory.Summary, &memory.ScopeType, &memory.ScopeID, &memory.PrivacyLevel, &memory.Confidence, &memory.Status, &sourceRaw, &entitiesRaw, &memory.SuccessCount, &memory.FailureCount, &memory.UsageCount, &memory.PositiveFeedback, &memory.NegativeFeedback, &pinned, &disabledAt, &memory.MergedIntoMemoryID, &memory.ConflictGroupID, &memory.ConflictReason, &metadataRaw, &createdAt, &updatedAt, &lastUsedAt, &score)
	if err != nil {
		return store.MemoryRecord{}, 0, err
	}
	memory.Pinned = pinned != 0
	_ = json.Unmarshal([]byte(sourceRaw), &memory.SourceEventIDs)
	_ = json.Unmarshal([]byte(entitiesRaw), &memory.Entities)
	memory.Metadata = decodeObject([]byte(metadataRaw))
	memory.CreatedAt = parseSQLiteTime(createdAt)
	memory.UpdatedAt = parseSQLiteTime(updatedAt)
	if disabledAt.Valid {
		t := parseSQLiteTime(disabledAt.String)
		memory.DisabledAt = &t
	}
	if lastUsedAt.Valid {
		t := parseSQLiteTime(lastUsedAt.String)
		memory.LastUsedAt = &t
	}
	return memory, score, nil
}

func routeSQLiteAgent(message string) string {
	lower := strings.ToLower(message)
	if strings.Contains(lower, "http://") || strings.Contains(lower, "https://") {
		return "research_agent"
	}
	if strings.Contains(message, "服务") || strings.Contains(message, "容器") || strings.Contains(message, "自检") || strings.Contains(lower, "system health") {
		return "devops_agent"
	}
	if strings.Contains(message, "记忆") || strings.Contains(message, "偏好") || strings.Contains(message, "之前") {
		return "memory_agent"
	}
	return "general_agent"
}

func explicitSQLiteAgent(message string) string {
	lower := strings.ToLower(message)
	switch {
	case strings.Contains(lower, "@devops"):
		return "devops_agent"
	case strings.Contains(lower, "@research"):
		return "research_agent"
	case strings.Contains(lower, "@memory"):
		return "memory_agent"
	case strings.Contains(lower, "@product"):
		return "product_agent"
	default:
		return "general_agent"
	}
}

func hashText(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func desktopCacheablePrefix(agentID string) string {
	return `Agent OS Runtime Rules
- Orchestrator Core is code, not an LLM.
- Agent is a role; model is an execution engine.
- The model must only output one JSON object with output_type: final_answer, capability_request, or memory_write_proposal.
- final_answer schema: {"output_type":"final_answer","content":"..."}.
- capability_request schema: {"output_type":"capability_request","capability":"memory_search|system_health_check","goal":"...","inputs":{},"risk":"read_only","confidence":0.0}.
- memory_write_proposal schema: {"output_type":"memory_write_proposal","memory":{"type":"...","content":"...","confidence":0.0}}.
- The model must not output raw shell, SQL, file_write, service_restart, restart, stop, rm, delete, chmod, or chown for execution.
- Desktop Mode uses local SQLite and AppCore directly. It does not call localhost HTTP.

Agent
id: ` + agentID + `

Stable Memory Profile
version: desktop_profile_v1
profile: []
project_facts: []
heuristics: []
anti_patterns: []
open_issues: []

Tool Schema Version
tool_schema_v1
`
}

func desktopDynamicTail(runID string, agentID string, userMessage string, dynamicContext string) string {
	return `Current Run
run_id: ` + runID + `
agent_id: ` + agentID + `
route_result: {"route_mode":"single","lead_agent":"` + agentID + `","route_source":"desktop_appcore"}

User Message
` + userMessage + `

Dynamic Context
` + dynamicContext + `

Dynamic Memory Retrieval
[]

Return JSON only.
`
}

func desktopOutputType(content string) string {
	var parsed struct {
		OutputType string `json:"output_type"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(content)), &parsed); err == nil && parsed.OutputType != "" {
		return parsed.OutputType
	}
	return "plain_text"
}

func desktopFinalAnswer(content string) string {
	trimmed := strings.TrimSpace(content)
	var parsed struct {
		OutputType string         `json:"output_type"`
		Content    string         `json:"content"`
		Answer     string         `json:"answer"`
		Final      string         `json:"final_answer"`
		Message    string         `json:"message"`
		Capability string         `json:"capability"`
		Goal       string         `json:"goal"`
		Memory     map[string]any `json:"memory"`
	}
	if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
		return trimmed
	}
	switch parsed.OutputType {
	case "final_answer":
		return firstNonEmpty(parsed.Content, parsed.Answer, parsed.Final, parsed.Message)
	case "capability_request":
		if parsed.Capability == "system_health_check" {
			return "Joi Desktop 自检可用：SQLite、本地 AppCore、内置任务队列均已初始化。"
		}
		if parsed.Capability == "memory_search" {
			return "已识别为记忆召回问题；Desktop Runtime 已记录 capability_request，本轮未执行底层工具。"
		}
		return "Desktop Runtime 收到 capability_request：" + parsed.Capability
	case "memory_write_proposal":
		return "已生成记忆候选，等待 Memory OS 确认后写入。"
	default:
		return firstNonEmpty(parsed.Content, parsed.Answer, parsed.Final, parsed.Message, trimmed)
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func ftsQuery(query string) string {
	parts := strings.Fields(query)
	for i, part := range parts {
		parts[i] = strings.Trim(part, `"*:()`)
	}
	return strings.Join(parts, " OR ")
}

func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func valueOrDefault(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func mustJSON(value any) []byte {
	raw, err := json.Marshal(value)
	if err != nil {
		return []byte(`{}`)
	}
	return raw
}

func decodeObject(raw []byte) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil || value == nil {
		return map[string]any{}
	}
	return value
}

func decodeArray(raw []byte) []any {
	if len(raw) == 0 {
		return []any{}
	}
	var value []any
	if err := json.Unmarshal(raw, &value); err != nil || value == nil {
		return []any{}
	}
	return value
}

func nullIntPtr(value sql.NullInt32) *int {
	if !value.Valid {
		return nil
	}
	v := int(value.Int32)
	return &v
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func parseSQLiteTime(value string) time.Time {
	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return t
	}
	if t, err := time.Parse("2006-01-02 15:04:05", value); err == nil {
		return t
	}
	return time.Now().UTC()
}

func buildMemoryContextPack(results []store.MemorySearchResult) store.MemoryContextPack {
	pack := store.MemoryContextPack{}
	for _, result := range results {
		switch result.Memory.Type {
		case "profile":
			pack.Profile = append(pack.Profile, result)
		case "project_fact":
			pack.ProjectFacts = append(pack.ProjectFacts, result)
		case "heuristic":
			pack.Heuristics = append(pack.Heuristics, result)
		case "anti_pattern":
			pack.AntiPatterns = append(pack.AntiPatterns, result)
		case "open_issue":
			pack.OpenIssues = append(pack.OpenIssues, result)
		default:
			pack.RecentEpisodes = append(pack.RecentEpisodes, result)
		}
	}
	return pack
}
