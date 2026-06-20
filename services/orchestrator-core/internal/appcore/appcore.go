package appcore

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/hao/agent-os/services/orchestrator-core/internal/backup"
	"github.com/hao/agent-os/services/orchestrator-core/internal/runtimeconfig"
	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

var desktopURLPattern = regexp.MustCompile(`https?://[^\s<>"')\]]+`)

type AppCore struct {
	Store   Store
	Queue   store.TaskQueue
	Runtime Runtime
	Config  runtimeconfig.Config

	db      *store.DB
	logger  *slog.Logger
	started bool
	turns   *TurnManager
}

type Store interface {
	Close() error
}

type Runtime interface{}

type ChatRequest struct {
	ConversationID    string                                         `json:"conversation_id"`
	Channel           string                                         `json:"channel"`
	UserID            string                                         `json:"user_id"`
	Message           string                                         `json:"message"`
	PreferredNode     string                                         `json:"preferred_node"`
	AllowWorker       bool                                           `json:"allow_worker"`
	ModelName         string                                         `json:"model_name"`
	InputMode         string                                         `json:"input_mode"`
	ProductTaskID     string                                         `json:"product_task_id"`
	RuntimeMode       string                                         `json:"runtime_mode"`
	PermissionProfile string                                         `json:"permission_profile"`
	EventSink         func(eventName string, payload map[string]any) `json:"-"`
}

type ChatResponse struct {
	ConversationID      string                     `json:"conversation_id"`
	UserMessageID       string                     `json:"user_message_id"`
	AssistantMessageID  string                     `json:"assistant_message_id"`
	RunID               string                     `json:"run_id"`
	SelectedAgentID     string                     `json:"selected_agent_id"`
	Response            string                     `json:"response"`
	Steps               []store.RunStepBrief       `json:"steps"`
	UI                  *ChatUIHints               `json:"ui,omitempty"`
	UsedMemories        []store.MemorySearchResult `json:"used_memories,omitempty"`
	ProductTask         *ProductTask               `json:"product_task,omitempty"`
	Artifacts           []ArtifactSummary          `json:"artifacts,omitempty"`
	ProactiveCandidates []ProactiveMessageRecord   `json:"proactive_candidates,omitempty"`
	Reflection          *ReflectionResult          `json:"reflection,omitempty"`
}

type ChatUIHints struct {
	InteractionClass  string `json:"interaction_class"`
	RequiresUserInput bool   `json:"requires_user_input"`
	MissingInput      string `json:"missing_input,omitempty"`
	InlineExecution   bool   `json:"inline_execution"`
}

const (
	runtimeModeLegacyJSON  = "legacy_json"
	runtimeModeToolCalling = "tool_calling"
)

func normalizedRuntimeMode(requested string) string {
	switch strings.TrimSpace(requested) {
	case runtimeModeToolCalling:
		return runtimeModeToolCalling
	case runtimeModeLegacyJSON:
		return runtimeModeLegacyJSON
	}
	if strings.TrimSpace(os.Getenv("JOI_RUNTIME_MODE")) == runtimeModeToolCalling {
		return runtimeModeToolCalling
	}
	return runtimeModeLegacyJSON
}

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
type WorkerGatewayAuditRecord struct {
	ID        string         `json:"id"`
	NodeID    string         `json:"node_id"`
	Action    string         `json:"action"`
	Status    string         `json:"status"`
	Reason    string         `json:"reason"`
	Metadata  map[string]any `json:"metadata"`
	CreatedAt time.Time      `json:"created_at"`
}
type WorkerGatewayAuditResponse struct {
	Items []WorkerGatewayAuditRecord `json:"items"`
}
type SystemHealthResponse = store.SystemHealthRecord
type MemoryActionRequest struct {
	ID        string `json:"id"`
	Action    string `json:"action"`
	Feedback  string `json:"feedback"`
	Comment   string `json:"comment"`
	TargetID  string `json:"target_id"`
	Reason    string `json:"reason"`
	Content   string `json:"content"`
	Summary   string `json:"summary"`
	ScopeType string `json:"scope_type"`
	RunID     string `json:"run_id"`
}
type MemoryProposalRequest = store.ProposeMemoryParams
type ConfirmationDecisionRequest struct {
	ID      string `json:"id"`
	Approve bool   `json:"approve"`
	Actor   string `json:"actor"`
	Reason  string `json:"reason"`
}
type ConfirmationListResponse struct {
	Items []store.ConfirmationRequestRecord `json:"items"`
}
type ModelUsageResponse struct {
	Items []map[string]any `json:"items"`
}
type BackupRecord struct {
	Path     string         `json:"path"`
	Name     string         `json:"name"`
	Size     int64          `json:"size"`
	Modified string         `json:"modified"`
	Manifest map[string]any `json:"manifest"`
}
type BackupListResponse struct {
	Backups []BackupRecord `json:"backups"`
}
type BackupCreateResponse struct {
	Path string `json:"path"`
}
type DiagnosticsExportResponse struct {
	Path string `json:"path"`
}
type DesktopSettingsResponse struct {
	Version                string `json:"version"`
	AppMode                string `json:"app_mode"`
	DataStore              string `json:"data_store"`
	TaskQueue              string `json:"task_queue"`
	SQLitePath             string `json:"sqlite_path"`
	LogDir                 string `json:"log_dir"`
	ModelProvider          string `json:"model_provider"`
	ModelName              string `json:"model_name"`
	ModelReasoningName     string `json:"model_reasoning_name"`
	ModelBaseURL           string `json:"model_base_url"`
	TelegramEnabled        bool   `json:"telegram_enabled"`
	TelegramAllowedUserIDs string `json:"telegram_allowed_user_ids"`
	WorkerGateway          string `json:"worker_gateway"`
	WorkerGatewayEnabled   bool   `json:"worker_gateway_enabled"`
	BackupDir              string `json:"backup_dir"`
	AutoBackupEnabled      bool   `json:"auto_backup_enabled"`
	DockerRequired         bool   `json:"docker_required"`
}
type DesktopModelConfigRequest struct {
	Provider       string `json:"provider"`
	BaseURL        string `json:"base_url"`
	Name           string `json:"name"`
	ReasoningName  string `json:"reasoning_name"`
	TimeoutSeconds int    `json:"timeout_seconds"`
	MaxRetries     int    `json:"max_retries"`
}
type DesktopOperationalSettingsRequest struct {
	TelegramEnabled        bool   `json:"telegram_enabled"`
	TelegramAllowedUserIDs string `json:"telegram_allowed_user_ids"`
	WorkerGatewayEnabled   bool   `json:"worker_gateway_enabled"`
	BackupDir              string `json:"backup_dir"`
	AutoBackupEnabled      bool   `json:"auto_backup_enabled"`
}
type DesktopOnboardingCoreStatus struct {
	Completed          bool `json:"completed"`
	FirstBackupCreated bool `json:"first_backup_created"`
	BackupCount        int  `json:"backup_count"`
}

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
		return &AppCore{Store: db, Config: cfg, db: db, logger: logger, turns: NewTurnManager()}, nil
	case "sqlite":
		db, err := store.OpenSQLite(ctx, cfg.App.SQLitePath)
		if err != nil {
			return nil, err
		}
		return &AppCore{Store: db, Config: cfg, db: db, logger: logger, turns: NewTurnManager()}, nil
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
			if embeddedSQLiteSchema == "" {
				return err
			}
			if err := a.db.ApplySQLiteSchemaSQL(ctx, embeddedSQLiteSchema); err != nil {
				return err
			}
		} else if err := a.db.ApplySQLiteSchema(ctx, schemaPath); err != nil {
			return err
		}
		if err := a.db.SeedSQLiteDefaults(ctx); err != nil {
			return err
		}
		if err := a.loadSQLiteRuntimeSettings(ctx); err != nil {
			a.logger.Warn("sqlite runtime settings load skipped", "service", "appcore", "error", err)
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
	result, err := a.db.SendChat(ctx, store.SendChatParams{
		ConversationID: req.ConversationID,
		Channel:        req.Channel,
		UserID:         userID,
		Message:        req.Message,
		PreferredNode:  req.PreferredNode,
		AllowWorker:    req.AllowWorker,
	})
	if err != nil {
		return nil, err
	}
	return &ChatResponse{
		ConversationID:     result.ConversationID,
		UserMessageID:      result.UserMessageID,
		AssistantMessageID: result.AssistantMessageID,
		RunID:              result.RunID,
		SelectedAgentID:    result.SelectedAgentID,
		Response:           result.Response,
		Steps:              result.Steps,
	}, nil
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

func (a *AppCore) ProposeMemory(ctx context.Context, req MemoryProposalRequest) (*store.MemoryRecord, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	if !a.isSQLite() {
		return a.db.ProposeMemory(ctx, store.ProposeMemoryParams(req))
	}
	memoryID, err := store.NewID("mem_")
	if err != nil {
		return nil, err
	}
	memoryType := valueOrDefault(req.Type, "note")
	scopeType := valueOrDefault(req.ScopeType, "global")
	privacyLevel := valueOrDefault(req.PrivacyLevel, "internal")
	confidence := req.Confidence
	if confidence == 0 {
		confidence = 0.8
	}
	sourceEventIDs := req.SourceEventIDs
	if len(sourceEventIDs) == 0 {
		sourceEventIDs = []string{"memory_propose_api"}
	}
	summary := req.Summary
	if strings.TrimSpace(summary) == "" {
		summary = truncate(req.Content, 120)
	}
	if _, err := a.db.SQL().ExecContext(ctx, `
		INSERT INTO memories (id, type, content, summary, scope_type, scope_id, privacy_level, confidence, status, source_event_ids, entities, metadata)
		VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, 'confirmed', ?, '[]', ?)
	`, memoryID, memoryType, req.Content, summary, scopeType, req.ScopeID, privacyLevel, confidence, mustJSON(sourceEventIDs), mustJSON(map[string]any{"source": "memory_propose_api", "desktop_sqlite": true})); err != nil {
		return nil, err
	}
	memories, err := a.listSQLiteMemories(ctx, 500)
	if err != nil {
		return nil, err
	}
	for _, memory := range memories.Memories {
		if memory.ID == memoryID {
			return &memory, nil
		}
	}
	return nil, sql.ErrNoRows
}

func (a *AppCore) ListNodes(ctx context.Context) (*NodeListResponse, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	if a.isSQLite() {
		_ = a.markSQLiteOfflineNodes(ctx)
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

func (a *AppCore) DisableNode(ctx context.Context, nodeID string) error {
	if a.db == nil {
		return errors.New("appcore db is not available")
	}
	if strings.TrimSpace(nodeID) == "" {
		return errors.New("node_id is required")
	}
	if !a.isSQLite() {
		_, err := a.db.SQL().ExecContext(ctx, `UPDATE nodes SET status='disabled', auto_assign_enabled=false, manual_assign_enabled=false, updated_at=NOW() WHERE id=$1`, nodeID)
		return err
	}
	_, err := a.db.SQL().ExecContext(ctx, `UPDATE nodes SET status='disabled', auto_assign_enabled=0, manual_assign_enabled=0, updated_at=datetime('now') WHERE id=?`, nodeID)
	if err == nil {
		_ = a.recordWorkerGatewayAudit(ctx, nodeID, "node_admin", "allowed", "node_disabled", map[string]any{"source": "desktop_ui"})
	}
	return err
}

func (a *AppCore) EnableNode(ctx context.Context, nodeID string) error {
	if a.db == nil {
		return errors.New("appcore db is not available")
	}
	if strings.TrimSpace(nodeID) == "" {
		return errors.New("node_id is required")
	}
	if !a.isSQLite() {
		_, err := a.db.SQL().ExecContext(ctx, `UPDATE nodes SET status='healthy', manual_assign_enabled=true, updated_at=NOW() WHERE id=$1`, nodeID)
		return err
	}
	_, err := a.db.SQL().ExecContext(ctx, `UPDATE nodes SET status='healthy', manual_assign_enabled=1, updated_at=datetime('now') WHERE id=?`, nodeID)
	if err == nil {
		_ = a.recordWorkerGatewayAudit(ctx, nodeID, "node_admin", "allowed", "node_enabled", map[string]any{"source": "desktop_ui"})
	}
	return err
}

func (a *AppCore) ListWorkerGatewayAuditLogs(ctx context.Context, limit int) (*WorkerGatewayAuditResponse, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if !a.isSQLite() {
		return &WorkerGatewayAuditResponse{Items: []WorkerGatewayAuditRecord{}}, nil
	}
	rows, err := a.db.SQL().QueryContext(ctx, `SELECT id, COALESCE(node_id,''), action, status, COALESCE(reason,''), metadata, created_at FROM worker_gateway_audit_logs ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []WorkerGatewayAuditRecord{}
	for rows.Next() {
		var item WorkerGatewayAuditRecord
		var metadataRaw, createdAt string
		if err := rows.Scan(&item.ID, &item.NodeID, &item.Action, &item.Status, &item.Reason, &metadataRaw, &createdAt); err != nil {
			return nil, err
		}
		item.Metadata = decodeObject([]byte(metadataRaw))
		item.CreatedAt = parseSQLiteTime(createdAt)
		items = append(items, item)
	}
	return &WorkerGatewayAuditResponse{Items: items}, rows.Err()
}

func (a *AppCore) GetSystemHealth(ctx context.Context) (*SystemHealthResponse, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	if a.isSQLite() {
		_ = a.markSQLiteOfflineNodes(ctx)
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
		var activeTasks, deadTasks, stuckTasks, recoveredSteps, modelCalls, modelErrors, inputTokens, outputTokens, cachedTokens int
		var avgLatency sql.NullFloat64
		_ = a.db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks WHERE status IN ('pending','running','retrying')`).Scan(&activeTasks)
		_ = a.db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks WHERE status='dead'`).Scan(&deadTasks)
		_ = a.db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks WHERE status='running' AND started_at < datetime('now', '-10 minutes')`).Scan(&stuckTasks)
		_ = a.db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM run_steps WHERE step_type='recovered' AND created_at >= date('now')`).Scan(&recoveredSteps)
		_ = a.db.SQL().QueryRowContext(ctx, `SELECT COUNT(*), SUM(CASE WHEN status NOT IN ('succeeded','fallback_to_mock') THEN 1 ELSE 0 END) FROM model_calls WHERE created_at >= date('now')`).Scan(&modelCalls, &modelErrors)
		_ = a.db.SQL().QueryRowContext(ctx, `SELECT COALESCE(AVG(latency_ms),0) FROM model_calls WHERE created_at >= date('now')`).Scan(&avgLatency)
		_ = a.db.SQL().QueryRowContext(ctx, `SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cached_input_tokens),0) FROM model_calls WHERE created_at >= date('now')`).Scan(&inputTokens, &outputTokens, &cachedTokens)
		health.QueueStatus["active_tasks"] = activeTasks
		health.QueueStatus["dead_tasks"] = deadTasks
		health.QueueStatus["stuck_running_tasks"] = stuckTasks
		health.QueueStatus["recovered_tasks_today"] = recoveredSteps
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

func (a *AppCore) UpdateMemory(ctx context.Context, req MemoryActionRequest) error {
	if a.db == nil {
		return errors.New("appcore db is not available")
	}
	if !a.isSQLite() {
		return errors.New("desktop memory actions are currently implemented for SQLite mode")
	}
	req.ID = strings.TrimSpace(req.ID)
	switch req.Action {
	case "confirm":
		tx, err := a.db.SQL().BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		targetID, err := correctionTargetIDTx(ctx, tx, req.ID)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE memories SET status='confirmed', disabled_at=NULL, metadata=json_set(COALESCE(metadata, '{}'), '$.confirmed_by', 'desktop_ui', '$.confirmed_at', datetime('now')), updated_at=datetime('now') WHERE id=?`, req.ID); err != nil {
			return err
		}
		if targetID != "" {
			if _, err := tx.ExecContext(ctx, `
				UPDATE memories
				SET status='merged',
				    merged_into_memory_id=?,
				    metadata=json_set(COALESCE(metadata, '{}'), '$.superseded_by', ?, '$.superseded_at', datetime('now')),
				    updated_at=datetime('now')
				WHERE id=?
			`, req.ID, req.ID, targetID); err != nil {
				return err
			}
		}
		if err := insertMemoryActionLogTx(ctx, tx, req.ID, req.RunID, "confirm", firstNonEmpty(req.Comment, req.Reason)); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		return a.db.RebuildSQLiteMemoryFTS(ctx)
	case "edit", "edit_confirm":
		if strings.TrimSpace(req.Content) == "" {
			return errors.New("edit_confirm requires content")
		}
		summary := req.Summary
		if strings.TrimSpace(summary) == "" {
			summary = truncate(req.Content, 120)
		}
		tx, err := a.db.SQL().BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if _, err := tx.ExecContext(ctx, `UPDATE memories SET content=?, summary=?, status='confirmed', disabled_at=NULL, metadata=json_set(COALESCE(metadata, '{}'), '$.edited_by', 'desktop_ui', '$.edited_at', datetime('now')), updated_at=datetime('now') WHERE id=?`, req.Content, summary, req.ID); err != nil {
			return err
		}
		if err := insertMemoryActionLogTx(ctx, tx, req.ID, req.RunID, "edit", firstNonEmpty(req.Comment, req.Reason)); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		return a.db.RebuildSQLiteMemoryFTS(ctx)
	case "reject":
		_, err := a.db.SQL().ExecContext(ctx, `UPDATE memories SET status='rejected', disabled_at=datetime('now'), metadata=json_set(COALESCE(metadata, '{}'), '$.rejected_by', 'desktop_ui', '$.reject_reason', ?, '$.rejected_at', datetime('now')), updated_at=datetime('now') WHERE id=?`, valueOrDefault(req.Reason, "desktop_ui"), req.ID)
		if err == nil {
			err = a.db.RebuildSQLiteMemoryFTS(ctx)
		}
		return err
	case "delete":
		tx, err := a.db.SQL().BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if _, err := tx.ExecContext(ctx, `UPDATE memories SET status='deleted', disabled_at=datetime('now'), metadata=json_set(COALESCE(metadata, '{}'), '$.deleted_by', 'desktop_ui', '$.delete_reason', ?, '$.deleted_at', datetime('now')), updated_at=datetime('now') WHERE id=?`, valueOrDefault(req.Reason, "desktop_ui"), req.ID); err != nil {
			return err
		}
		if err := insertMemoryActionLogTx(ctx, tx, req.ID, req.RunID, "delete", firstNonEmpty(req.Comment, req.Reason)); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		return a.db.RebuildSQLiteMemoryFTS(ctx)
	case "mark_global":
		_, err := a.db.SQL().ExecContext(ctx, `UPDATE memories SET scope_type='global', scope_id=NULL, updated_at=datetime('now') WHERE id=?`, req.ID)
		return err
	case "mark_project":
		_, err := a.db.SQL().ExecContext(ctx, `UPDATE memories SET scope_type='project', scope_id=COALESCE(NULLIF(scope_id,''), 'default_project'), updated_at=datetime('now') WHERE id=?`, req.ID)
		return err
	case "pin":
		_, err := a.db.SQL().ExecContext(ctx, `UPDATE memories SET pinned=1, updated_at=datetime('now') WHERE id=?`, req.ID)
		return err
	case "unpin":
		_, err := a.db.SQL().ExecContext(ctx, `UPDATE memories SET pinned=0, updated_at=datetime('now') WHERE id=?`, req.ID)
		return err
	case "disable":
		_, err := a.db.SQL().ExecContext(ctx, `UPDATE memories SET disabled_at=datetime('now'), updated_at=datetime('now') WHERE id=?`, req.ID)
		return err
	case "enable":
		_, err := a.db.SQL().ExecContext(ctx, `UPDATE memories SET disabled_at=NULL, updated_at=datetime('now') WHERE id=?`, req.ID)
		return err
	case "feedback_positive", "feedback_negative", "feedback_neutral":
		feedback := strings.TrimPrefix(req.Action, "feedback_")
		feedbackID, err := store.NewID("mfb_")
		if err != nil {
			return err
		}
		if _, err := a.db.SQL().ExecContext(ctx, `INSERT INTO memory_feedback (id, memory_id, feedback, comment) VALUES (?, ?, ?, ?)`, feedbackID, req.ID, feedback, req.Comment); err != nil {
			return err
		}
		if feedback == "positive" {
			_, err = a.db.SQL().ExecContext(ctx, `UPDATE memories SET positive_feedback=positive_feedback+1, success_count=success_count+1, updated_at=datetime('now') WHERE id=?`, req.ID)
			return err
		}
		if feedback == "negative" {
			_, err = a.db.SQL().ExecContext(ctx, `UPDATE memories SET negative_feedback=negative_feedback+1, failure_count=failure_count+1, updated_at=datetime('now') WHERE id=?`, req.ID)
			return err
		}
		return nil
	case "mark_conflict":
		groupID := req.TargetID
		if groupID == "" {
			groupID = req.ID
		}
		_, err := a.db.SQL().ExecContext(ctx, `UPDATE memories SET status='conflicted', conflict_group_id=?, conflict_reason=?, updated_at=datetime('now') WHERE id=?`, groupID, req.Reason, req.ID)
		return err
	case "merge_into":
		if req.TargetID == "" {
			return errors.New("merge_into requires target_id")
		}
		_, err := a.db.SQL().ExecContext(ctx, `UPDATE memories SET merged_into_memory_id=?, updated_at=datetime('now') WHERE id=?`, req.TargetID, req.ID)
		return err
	default:
		return fmt.Errorf("unsupported memory action: %s", req.Action)
	}
}

func (a *AppCore) ListConfirmations(ctx context.Context) (*ConfirmationListResponse, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	if !a.isSQLite() {
		items, err := a.db.ListConfirmationRequests(ctx)
		return &ConfirmationListResponse{Items: items}, err
	}
	rows, err := a.db.SQL().QueryContext(ctx, `
		SELECT id, COALESCE(run_id, ''), capability_id, requested_action, risk_level, status,
		       input, COALESCE(call_id, ''), COALESCE(turn_id, ''), COALESCE(approval_scope, 'once'),
		       COALESCE(approval_key, ''), COALESCE(approved_by, ''), COALESCE(rejected_by, ''),
		       COALESCE(decision_reason, ''), created_at, decided_at, resumed_at
		FROM confirmation_requests
		ORDER BY created_at DESC
		LIMIT 100
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []store.ConfirmationRequestRecord{}
	for rows.Next() {
		var item store.ConfirmationRequestRecord
		var inputRaw, createdAt string
		var decidedAt sql.NullString
		var resumedAt sql.NullString
		if err := rows.Scan(&item.ID, &item.RunID, &item.CapabilityID, &item.RequestedAction, &item.RiskLevel, &item.Status, &inputRaw, &item.CallID, &item.TurnID, &item.ApprovalScope, &item.ApprovalKey, &item.ApprovedBy, &item.RejectedBy, &item.DecisionReason, &createdAt, &decidedAt, &resumedAt); err != nil {
			return nil, err
		}
		item.Input = decodeObject([]byte(inputRaw))
		item.CreatedAt = parseSQLiteTime(createdAt)
		if decidedAt.Valid {
			t := parseSQLiteTime(decidedAt.String)
			item.DecidedAt = &t
		}
		if resumedAt.Valid {
			t := parseSQLiteTime(resumedAt.String)
			item.ResumedAt = &t
		}
		items = append(items, item)
	}
	return &ConfirmationListResponse{Items: items}, rows.Err()
}

func (a *AppCore) DecideConfirmation(ctx context.Context, req ConfirmationDecisionRequest) error {
	if a.db == nil {
		return errors.New("appcore db is not available")
	}
	if !a.isSQLite() {
		return a.db.DecideConfirmationRequest(ctx, req.ID, req.Approve, valueOrDefault(req.Actor, "desktop_admin"), req.Reason)
	}
	status := "rejected"
	approvedBy := ""
	rejectedBy := valueOrDefault(req.Actor, "desktop_admin")
	if req.Approve {
		status = "approved"
		approvedBy = valueOrDefault(req.Actor, "desktop_admin")
		rejectedBy = ""
	}
	tx, err := a.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var runID, turnID, callID, capabilityID string
	if err := tx.QueryRowContext(ctx, `
		SELECT COALESCE(run_id, ''), COALESCE(turn_id, ''), COALESCE(call_id, ''), capability_id
		FROM confirmation_requests
		WHERE id=? AND status='pending'
	`, req.ID).Scan(&runID, &turnID, &callID, &capabilityID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE confirmation_requests SET status=?, approved_by=NULLIF(?, ''), rejected_by=NULLIF(?, ''), decision_reason=?, decided_at=datetime('now') WHERE id=? AND status='pending'`, status, approvedBy, rejectedBy, req.Reason, req.ID)
	if err != nil {
		return err
	}
	payload := map[string]any{"confirmation_id": req.ID, "run_id": runID, "turn_id": turnID, "call_id": callID, "capability": capabilityID, "status": status, "approved": req.Approve, "reason": req.Reason}
	if runID != "" {
		if _, err := appendSQLiteRunEvent(ctx, tx, runID, turnID, "approval.resolved", payload); err != nil {
			return err
		}
	}
	if !req.Approve && runID != "" {
		if _, err := tx.ExecContext(ctx, `UPDATE runs SET status='failed', error_code='confirmation_rejected', error_message=?, finished_at=datetime('now'), duration_ms=CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER) WHERE id=? AND status='waiting_confirmation'`, valueOrDefault(req.Reason, "Confirmation rejected"), runID); err != nil {
			return err
		}
		if turnID != "" {
			if _, err := tx.ExecContext(ctx, `UPDATE turns SET status='failed', finished_at=datetime('now') WHERE id=? AND status='waiting_confirmation'`, turnID); err != nil {
				return err
			}
		}
		if _, err := appendSQLiteRunEvent(ctx, tx, runID, turnID, "run.failed", map[string]any{"run_id": runID, "turn_id": turnID, "status": "failed", "error": "confirmation_rejected", "message": valueOrDefault(req.Reason, "Confirmation rejected")}); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	if req.Approve && runID != "" {
		return a.ResumeRun(ctx, runID)
	}
	return nil
}

func (a *AppCore) ModelUsageSummary(ctx context.Context) (*ModelUsageResponse, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	if !a.isSQLite() {
		summary, err := a.db.ModelUsageSummary(ctx)
		if err != nil {
			return nil, err
		}
		items, _ := summary["items"].([]map[string]any)
		return &ModelUsageResponse{Items: items}, nil
	}
	rows, err := a.db.SQL().QueryContext(ctx, `
		SELECT COALESCE(provider,''), COALESCE(model_name,''), COALESCE(agent_id,''), COUNT(*),
		       COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cached_input_tokens),0),
		       COALESCE(AVG(latency_ms),0),
		       SUM(CASE WHEN status='fallback_to_mock' THEN 1 ELSE 0 END),
		       SUM(CASE WHEN status <> 'succeeded' AND status <> 'fallback_to_mock' THEN 1 ELSE 0 END)
		FROM model_calls
		GROUP BY COALESCE(provider,''), COALESCE(model_name,''), COALESCE(agent_id,'')
		ORDER BY COALESCE(SUM(input_tokens + output_tokens),0) DESC
		LIMIT 100
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var provider, model, agent string
		var calls, inputTokens, outputTokens, cachedTokens, fallbackCalls, errorCalls int
		var avgLatency float64
		if err := rows.Scan(&provider, &model, &agent, &calls, &inputTokens, &outputTokens, &cachedTokens, &avgLatency, &fallbackCalls, &errorCalls); err != nil {
			return nil, err
		}
		hitRatio := 0.0
		if inputTokens > 0 {
			hitRatio = float64(cachedTokens) / float64(inputTokens)
		}
		items = append(items, map[string]any{"provider": provider, "model": model, "agent": agent, "calls": calls, "input_tokens": inputTokens, "output_tokens": outputTokens, "cached_input_tokens": cachedTokens, "cache_hit_ratio": hitRatio, "avg_latency_ms": avgLatency, "fallback_calls": fallbackCalls, "error_calls": errorCalls, "estimated_cost": 0})
	}
	return &ModelUsageResponse{Items: items}, rows.Err()
}

func (a *AppCore) ListBackups(ctx context.Context) (*BackupListResponse, error) {
	_ = ctx
	backupDir := a.backupDir()
	entries, err := filepath.Glob(filepath.Join(backupDir, "*.joibak"))
	if err != nil {
		return nil, err
	}
	backups := []BackupRecord{}
	for _, path := range entries {
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		backups = append(backups, BackupRecord{Path: path, Name: filepath.Base(path), Size: info.Size(), Modified: info.ModTime().UTC().Format(time.RFC3339), Manifest: map[string]any{"secrets_policy": "secrets excluded"}})
	}
	return &BackupListResponse{Backups: backups}, nil
}

func (a *AppCore) CreateBackup(ctx context.Context) (*BackupCreateResponse, error) {
	manager := backup.Manager{
		AppDir:     filepath.Dir(a.Config.App.SQLitePath),
		SQLitePath: a.Config.App.SQLitePath,
		ConfigDir:  a.Config.Server.ConfigDir,
		PromptsDir: "prompts",
		BackupDir:  a.backupDir(),
	}
	path, err := manager.CreateManualBackup(ctx)
	if err != nil {
		return nil, err
	}
	return &BackupCreateResponse{Path: path}, nil
}

func (a *AppCore) RestoreBackup(ctx context.Context, backupPath string) error {
	manager := backup.Manager{
		AppDir:     filepath.Dir(a.Config.App.SQLitePath),
		SQLitePath: a.Config.App.SQLitePath,
		ConfigDir:  a.Config.Server.ConfigDir,
		PromptsDir: "prompts",
		BackupDir:  a.backupDir(),
	}
	if a.isSQLite() {
		if a.Store != nil {
			_ = a.Store.Close()
		}
		if err := manager.Restore(ctx, backupPath); err != nil {
			return err
		}
		db, err := store.OpenSQLite(ctx, a.Config.App.SQLitePath)
		if err != nil {
			return err
		}
		a.Store = db
		a.db = db
		a.Queue = nil
		a.started = false
		return a.Start(ctx)
	}
	return manager.Restore(ctx, backupPath)
}

func (a *AppCore) ExportDiagnostics(ctx context.Context) (*DiagnosticsExportResponse, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	dir := a.diagnosticsDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	stamp := time.Now().Format("20060102-150405")
	path := filepath.Join(dir, "joi-diagnostics-"+stamp+".zip")
	file, err := os.Create(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	archive := zip.NewWriter(file)
	defer archive.Close()

	settings, _ := a.GetDesktopSettings(ctx)
	health, _ := a.GetSystemHealth(ctx)
	backups, _ := a.ListBackups(ctx)
	nodes, _ := a.ListNodes(ctx)
	modelUsage, _ := a.ModelUsageSummary(ctx)
	manifest := map[string]any{
		"generated_at":    time.Now().UTC().Format(time.RFC3339),
		"app_version":     valueOrDefault(os.Getenv("APP_VERSION"), "0.1.0-rc0"),
		"app_mode":        a.Config.App.Mode,
		"goos":            runtime.GOOS,
		"goarch":          runtime.GOARCH,
		"data_directory":  filepath.Dir(a.Config.App.SQLitePath),
		"sqlite_path":     a.Config.App.SQLitePath,
		"secrets_policy":  "redacted; keychain and environment secret values are never exported",
		"memory_policy":   "full memory text, prompt text, and model raw responses are redacted",
		"diagnostics_v":   "desktop_diagnostics_v1",
		"docker_required": a.Config.App.DockerRequired,
	}
	payloads := map[string]any{
		"manifest.json":              manifest,
		"settings.json":              settings,
		"sqlite_health.json":         map[string]any{"ping": a.db.Ping(ctx) == nil, "driver": a.Config.App.DataStore},
		"system_health.json":         health,
		"recent_runs.json":           a.diagnosticRows(ctx, `SELECT id, status, COALESCE(selected_agent_id,'') AS selected_agent_id, COALESCE(selected_node_id,'') AS selected_node_id, started_at, finished_at, COALESCE(error_code,'') AS error_code, COALESCE(error_message,'') AS error_message, metadata FROM runs ORDER BY created_at DESC LIMIT 25`),
		"recent_errors.json":         a.diagnosticRows(ctx, `SELECT 'run' AS source, id, COALESCE(error_code,'') AS error_code, COALESCE(error_message,'') AS error_message, created_at FROM runs WHERE error_code IS NOT NULL OR error_message IS NOT NULL ORDER BY created_at DESC LIMIT 50`),
		"worker_status.json":         nodes,
		"model_provider_status.json": map[string]any{"provider": a.Config.Model.Provider, "model": a.Config.Model.Name, "base_url": a.Config.Model.BaseURL, "usage": modelUsage},
		"telegram_status.json":       map[string]any{"configured": os.Getenv("TELEGRAM_BOT_TOKEN") != "", "allowed_user_ids_configured": strings.TrimSpace(a.Config.Telegram.AllowedUserIDs) != ""},
		"backup_status.json":         backups,
		"last_100_run_steps.json":    a.diagnosticRows(ctx, `SELECT id, run_id, step_type, title, status, input, output, COALESCE(error,'') AS error, started_at, finished_at, created_at FROM run_steps ORDER BY created_at DESC LIMIT 100`),
		"last_100_tool_runs.json":    a.diagnosticRows(ctx, `SELECT id, COALESCE(run_id,'') AS run_id, COALESCE(task_id,'') AS task_id, capability_id, workflow_name, tool_name, node_id, assignment_reason, risk_level, status, input, output, COALESCE(error,'') AS error, started_at, finished_at, created_at FROM tool_runs ORDER BY created_at DESC LIMIT 100`),
		"last_100_model_calls.json":  a.diagnosticRows(ctx, `SELECT id, COALESCE(run_id,'') AS run_id, COALESCE(agent_id,'') AS agent_id, COALESCE(provider,'') AS provider, COALESCE(model_name,'') AS model_name, COALESCE(prompt_cache_key,'') AS prompt_cache_key, COALESCE(prefix_hash,'') AS prefix_hash, COALESCE(dynamic_tail_hash,'') AS dynamic_tail_hash, COALESCE(input_tokens,0) AS input_tokens, COALESCE(output_tokens,0) AS output_tokens, COALESCE(cached_input_tokens,0) AS cached_input_tokens, COALESCE(latency_ms,0) AS latency_ms, status, COALESCE(error_code,'') AS error_code, COALESCE(error_message,'') AS error_message, metadata, created_at FROM model_calls ORDER BY created_at DESC LIMIT 100`),
	}
	for name, payload := range payloads {
		writer, err := archive.Create(name)
		if err != nil {
			return nil, err
		}
		raw, err := json.MarshalIndent(sanitizeDiagnosticValue(payload), "", "  ")
		if err != nil {
			return nil, err
		}
		if _, err := writer.Write(raw); err != nil {
			return nil, err
		}
	}
	return &DiagnosticsExportResponse{Path: path}, nil
}

func (a *AppCore) GetDesktopSettings(ctx context.Context) (*DesktopSettingsResponse, error) {
	telegramAllowed := valueOrDefault(a.desktopSettingOrDefault(ctx, "telegram.allowed_user_ids", ""), a.Config.Telegram.AllowedUserIDs)
	telegramEnabled := a.desktopBoolSetting(ctx, "telegram.enabled", os.Getenv("TELEGRAM_BOT_TOKEN") != "" || strings.TrimSpace(telegramAllowed) != "")
	workerGatewayEnabled := a.desktopBoolSetting(ctx, "worker_gateway.enabled", true)
	autoBackupEnabled := a.desktopBoolSetting(ctx, "backup.auto_enabled", false)
	reasoningModelName := a.desktopSettingOrDefault(ctx, "model.reasoning_name", "")
	return &DesktopSettingsResponse{
		Version:                valueOrDefault(os.Getenv("APP_VERSION"), "0.1.0-rc0"),
		AppMode:                a.Config.App.Mode,
		DataStore:              a.Config.App.DataStore,
		TaskQueue:              a.Config.TaskQueue.Driver,
		SQLitePath:             a.Config.App.SQLitePath,
		LogDir:                 filepath.Join(filepath.Dir(a.Config.App.SQLitePath), "logs"),
		ModelProvider:          a.Config.Model.Provider,
		ModelName:              a.Config.Model.Name,
		ModelReasoningName:     reasoningModelName,
		ModelBaseURL:           a.Config.Model.BaseURL,
		TelegramEnabled:        telegramEnabled,
		TelegramAllowedUserIDs: telegramAllowed,
		WorkerGateway:          "http://" + valueOrDefault(os.Getenv("WORKER_GATEWAY_ADDR"), "127.0.0.1:18081"),
		WorkerGatewayEnabled:   workerGatewayEnabled,
		BackupDir:              a.backupDir(),
		AutoBackupEnabled:      autoBackupEnabled,
		DockerRequired:         a.Config.App.DockerRequired,
	}, nil
}

func (a *AppCore) SaveDesktopModelConfig(ctx context.Context, req DesktopModelConfigRequest) error {
	if !a.isSQLite() {
		return errors.New("desktop model config is only available in SQLite mode")
	}
	provider := valueOrDefault(req.Provider, "openai_compatible")
	baseURL := valueOrDefault(req.BaseURL, "https://api.deepseek.com/v1")
	modelName := valueOrDefault(req.Name, "deepseek-v4-flash")
	reasoningName := strings.TrimSpace(req.ReasoningName)
	timeoutSeconds := req.TimeoutSeconds
	if timeoutSeconds <= 0 {
		timeoutSeconds = 60
	}
	maxRetries := req.MaxRetries
	if maxRetries < 0 {
		maxRetries = 1
	}
	settings := map[string]string{
		"model.provider":        provider,
		"model.base_url":        baseURL,
		"model.name":            modelName,
		"model.timeout_seconds": strconv.Itoa(timeoutSeconds),
		"model.max_retries":     strconv.Itoa(maxRetries),
	}
	if reasoningName != "" {
		settings["model.reasoning_name"] = reasoningName
	}
	for key, value := range settings {
		if err := a.setDesktopSetting(ctx, key, value); err != nil {
			return err
		}
	}
	a.applyRuntimeModelConfig(provider, baseURL, modelName, timeoutSeconds, maxRetries)
	return a.seedSQLiteRuntimeModel(ctx)
}

func (a *AppCore) SaveDesktopOperationalSettings(ctx context.Context, req DesktopOperationalSettingsRequest) error {
	if !a.isSQLite() {
		return errors.New("desktop operational settings are only available in SQLite mode")
	}
	settings := map[string]string{
		"telegram.enabled":          boolString(req.TelegramEnabled),
		"telegram.allowed_user_ids": strings.TrimSpace(req.TelegramAllowedUserIDs),
		"worker_gateway.enabled":    boolString(req.WorkerGatewayEnabled),
		"backup.auto_enabled":       boolString(req.AutoBackupEnabled),
	}
	if strings.TrimSpace(req.BackupDir) != "" {
		settings["backup.dir"] = filepath.Clean(req.BackupDir)
	}
	for key, value := range settings {
		if err := a.setDesktopSetting(ctx, key, value); err != nil {
			return err
		}
	}
	a.Config.Telegram.AllowedUserIDs = strings.TrimSpace(req.TelegramAllowedUserIDs)
	if backupDir := strings.TrimSpace(req.BackupDir); backupDir != "" {
		_ = os.Setenv("JOI_BACKUP_DIR", filepath.Clean(backupDir))
	}
	_ = os.Setenv("TELEGRAM_ALLOWED_USER_IDS", strings.TrimSpace(req.TelegramAllowedUserIDs))
	_ = os.Setenv("WORKER_GATEWAY_ENABLED", boolString(req.WorkerGatewayEnabled))
	_ = os.Setenv("JOI_AUTO_BACKUP_ENABLED", boolString(req.AutoBackupEnabled))
	return nil
}

func (a *AppCore) CompleteOnboarding(ctx context.Context) error {
	if !a.isSQLite() {
		return errors.New("desktop onboarding is only available in SQLite mode")
	}
	return a.setDesktopSetting(ctx, "onboarding.completed", "true")
}

func (a *AppCore) GetOnboardingCoreStatus(ctx context.Context) (*DesktopOnboardingCoreStatus, error) {
	if !a.isSQLite() {
		return &DesktopOnboardingCoreStatus{Completed: true}, nil
	}
	completed := false
	if value, err := a.getDesktopSetting(ctx, "onboarding.completed"); err == nil {
		completed = value == "true"
	}
	backups, err := a.ListBackups(ctx)
	if err != nil {
		return nil, err
	}
	return &DesktopOnboardingCoreStatus{
		Completed:          completed,
		FirstBackupCreated: len(backups.Backups) > 0,
		BackupCount:        len(backups.Backups),
	}, nil
}

func (a *AppCore) loadSQLiteRuntimeSettings(ctx context.Context) error {
	settings := map[string]string{}
	rows, err := a.db.SQL().QueryContext(ctx, `SELECT key, value FROM desktop_settings`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return err
		}
		settings[key] = value
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(settings) == 0 {
		return nil
	}
	timeoutSeconds := intFromString(settings["model.timeout_seconds"], a.Config.Model.TimeoutSeconds)
	maxRetries := intFromString(settings["model.max_retries"], a.Config.Model.MaxRetries)
	a.applyRuntimeModelConfig(settings["model.provider"], settings["model.base_url"], settings["model.name"], timeoutSeconds, maxRetries)
	if value := strings.TrimSpace(settings["telegram.allowed_user_ids"]); value != "" {
		a.Config.Telegram.AllowedUserIDs = value
		_ = os.Setenv("TELEGRAM_ALLOWED_USER_IDS", value)
	}
	if value := strings.TrimSpace(settings["backup.dir"]); value != "" {
		_ = os.Setenv("JOI_BACKUP_DIR", filepath.Clean(value))
	}
	if value := strings.TrimSpace(settings["worker_gateway.enabled"]); value != "" {
		_ = os.Setenv("WORKER_GATEWAY_ENABLED", value)
	}
	if value := strings.TrimSpace(settings["backup.auto_enabled"]); value != "" {
		_ = os.Setenv("JOI_AUTO_BACKUP_ENABLED", value)
	}
	return nil
}

func (a *AppCore) applyRuntimeModelConfig(provider string, baseURL string, modelName string, timeoutSeconds int, maxRetries int) {
	if provider != "" {
		a.Config.Model.Provider = provider
		_ = os.Setenv("MODEL_PROVIDER", provider)
	}
	if baseURL != "" {
		a.Config.Model.BaseURL = baseURL
		_ = os.Setenv("MODEL_BASE_URL", baseURL)
	}
	if modelName != "" {
		a.Config.Model.Name = modelName
		_ = os.Setenv("MODEL_NAME", modelName)
	}
	if timeoutSeconds > 0 {
		a.Config.Model.TimeoutSeconds = timeoutSeconds
		_ = os.Setenv("MODEL_TIMEOUT_SECONDS", strconv.Itoa(timeoutSeconds))
	}
	if maxRetries >= 0 {
		a.Config.Model.MaxRetries = maxRetries
		_ = os.Setenv("MODEL_MAX_RETRIES", strconv.Itoa(maxRetries))
	}
}

func (a *AppCore) setDesktopSetting(ctx context.Context, key string, value string) error {
	_, err := a.db.SQL().ExecContext(ctx, `
		INSERT INTO desktop_settings (key, value, updated_at)
		VALUES (?, ?, datetime('now'))
		ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
	`, key, value)
	return err
}

func (a *AppCore) getDesktopSetting(ctx context.Context, key string) (string, error) {
	var value string
	err := a.db.SQL().QueryRowContext(ctx, `SELECT value FROM desktop_settings WHERE key=?`, key).Scan(&value)
	return value, err
}

func (a *AppCore) backupDir() string {
	if configured := strings.TrimSpace(os.Getenv("JOI_BACKUP_DIR")); configured != "" {
		return configured
	}
	base := filepath.Dir(a.Config.App.SQLitePath)
	if strings.TrimSpace(base) == "." || strings.TrimSpace(base) == "" {
		base = filepath.Join(os.Getenv("HOME"), "Library", "Application Support", "Joi")
	}
	return filepath.Join(base, "backups")
}

func (a *AppCore) desktopSettingOrDefault(ctx context.Context, key string, fallback string) string {
	if !a.isSQLite() || a.db == nil {
		return fallback
	}
	value, err := a.getDesktopSetting(ctx, key)
	if err != nil || strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func (a *AppCore) desktopBoolSetting(ctx context.Context, key string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(a.desktopSettingOrDefault(ctx, key, "")))
	if value == "" {
		return fallback
	}
	return value == "1" || value == "true" || value == "yes" || value == "enabled"
}

func boolString(value bool) string {
	if value {
		return "true"
	}
	return "false"
}

func (a *AppCore) diagnosticsDir() string {
	base := filepath.Dir(a.Config.App.SQLitePath)
	if strings.TrimSpace(base) == "." || strings.TrimSpace(base) == "" {
		base = filepath.Join(os.Getenv("HOME"), "Library", "Application Support", "Joi")
	}
	return filepath.Join(base, "diagnostics")
}

func (a *AppCore) diagnosticRows(ctx context.Context, query string, args ...any) []map[string]any {
	rows, err := a.db.SQL().QueryContext(ctx, query, args...)
	if err != nil {
		return []map[string]any{{"error": err.Error()}}
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return []map[string]any{{"error": err.Error()}}
	}
	result := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			result = append(result, map[string]any{"error": err.Error()})
			continue
		}
		item := map[string]any{}
		for i, column := range columns {
			item[column] = normalizeDiagnosticDBValue(values[i])
		}
		result = append(result, item)
	}
	return result
}

func normalizeDiagnosticDBValue(value any) any {
	switch typed := value.(type) {
	case nil:
		return nil
	case []byte:
		return string(typed)
	case time.Time:
		return typed.UTC().Format(time.RFC3339)
	default:
		return typed
	}
}

func sanitizeDiagnosticValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		result := map[string]any{}
		for key, item := range typed {
			if diagnosticSensitiveKey(key) {
				result[key] = "[REDACTED]"
				continue
			}
			result[key] = sanitizeDiagnosticValue(item)
		}
		return result
	case []map[string]any:
		result := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if sanitized, ok := sanitizeDiagnosticValue(item).(map[string]any); ok {
				result = append(result, sanitized)
			}
		}
		return result
	case []any:
		result := make([]any, 0, len(typed))
		for _, item := range typed {
			result = append(result, sanitizeDiagnosticValue(item))
		}
		return result
	case string:
		text := strings.TrimSpace(typed)
		if strings.HasPrefix(text, "{") || strings.HasPrefix(text, "[") {
			var parsed any
			if err := json.Unmarshal([]byte(text), &parsed); err == nil {
				return sanitizeDiagnosticValue(parsed)
			}
		}
		if len(typed) > 600 {
			return typed[:600] + "...[truncated]"
		}
		return typed
	default:
		return typed
	}
}

func diagnosticSensitiveKey(key string) bool {
	normalized := strings.ToLower(key)
	for _, marker := range []string{"api_key", "apikey", "authorization", "bearer", "token", "secret", "password", "node_secret", "worker_token", "telegram_bot_token", "model_api_key", "cacheable_prefix", "dynamic_tail", "raw_response", "content", "memory", "prompt"} {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return false
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
	if err := a.db.EnsureSQLiteConversationLifecycle(ctx); err != nil {
		return nil, err
	}
	channel := valueOrDefault(req.Channel, "desktop")
	userID := valueOrDefault(req.UserID, "desktop_user")
	conversationID := req.ConversationID
	classification := classifyConversation(req.Message, req.InputMode)
	intent := classifyDesktopIntent(req.Message, req.InputMode)
	productTaskID := strings.TrimSpace(req.ProductTaskID)
	var productTask *ProductTask
	var taskPlan productTaskPlan
	var createdArtifacts []ArtifactSummary
	var reflectionResult *ReflectionResult
	var runtimeResult *sqliteRuntimeResult
	memoryIntent := intent.MemoryControl
	artifactRewrite := intent.ArtifactRewrite
	selectedModelName := valueOrDefault(strings.TrimSpace(req.ModelName), a.Config.Model.Name)
	runtimeMode := normalizedRuntimeMode(req.RuntimeMode)
	permissionProfile := string(normalizedPermissionProfile(req.PermissionProfile))
	if productTaskID != "" && !intent.TaskFollowup && !intent.ArtifactFollowup {
		productTaskID = ""
	}
	if memoryIntent.Kind != memoryControlNone || intent.ArtifactFollowup {
		classification.ShouldCreateTask = false
	}
	if intent.Proactive || intent.TaskFollowup || intent.ToolResultFollowup {
		classification.ShouldCreateTask = false
	}
	if intent.SeriousTask && !intent.Clarify {
		classification.ShouldCreateTask = true
	}
	uiHints := chatUIHintsFor(classification, intent, classification.ShouldCreateTask)
	selectedAgentID := routeSQLiteAgent(req.Message)
	if memoryIntent.Kind != memoryControlNone {
		selectedAgentID = "memory_agent"
	}
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
		lifecycleStatus, err := conversationLifecycleStatusTx(ctx, tx, conversationID)
		if err != nil {
			return nil, err
		}
		if lifecycleStatus != conversationLifecycleActive {
			return nil, fmt.Errorf("conversation is %s and cannot receive new messages", lifecycleStatus)
		}
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
	contextURL := ""
	if firstURLFromText(req.Message) == "" && webResearchRequestMissingURL(req.Message) {
		previousURL, previousURLErr := latestConversationURLTx(ctx, tx, conversationID, userMessageID)
		if previousURLErr != nil && !errors.Is(previousURLErr, sql.ErrNoRows) {
			return nil, previousURLErr
		}
		if previousURL != "" {
			contextURL = previousURL
			classification = conversationClassification{
				InputMode:          "chat_assist",
				Mode:               "chat_assist",
				InteractionClass:   "chat_assist",
				ConversationType:   "ordinary_chat",
				Importance:         "low",
				ClassificationNote: "web_research_context_url",
			}
			intent.Name = "chat"
			intent.Clarify = false
			selectedAgentID = "research_agent"
			uiHints = chatUIHintsFor(classification, intent, true)
			if _, err := tx.ExecContext(ctx, `UPDATE conversations SET active_agent_id=?, updated_at=datetime('now') WHERE id=?`, selectedAgentID, conversationID); err != nil {
				return nil, err
			}
		}
	}
	runID, err := store.NewID("run_")
	if err != nil {
		return nil, err
	}
	if intent.TaskFollowup && productTaskID == "" {
		if activeTaskID, err := latestProductTaskIDForContextTx(ctx, tx, conversationID); err == nil {
			productTaskID = activeTaskID
		} else if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}
	routeResult := map[string]any{"intent": intent.Name, "route_mode": "single", "lead_agent": selectedAgentID, "route_source": "desktop_appcore", "confidence": 0.8, "preferred_node": req.PreferredNode, "allow_worker": req.AllowWorker, "selected_model_name": selectedModelName, "runtime_mode": runtimeMode, "permission_profile": permissionProfile, "priority": []string{"memory", "proactive", "tool_result_followup", "task_followup", "artifact_followup", "clarify", "serious_task", "chat"}}
	routeRaw := mustJSON(routeResult)
	metadataRaw := mustJSON(map[string]any{"app_mode": "desktop", "data_store": "sqlite", "task_queue": "sqlite", "input_mode": classification.InputMode, "conversation_mode": classification.Mode, "conversation_type": classification.ConversationType, "interaction_class": uiHints.InteractionClass, "requires_user_input": uiHints.RequiresUserInput, "missing_input": uiHints.MissingInput, "ui_inline_execution": uiHints.InlineExecution, "classification_note": classification.ClassificationNote, "preferred_node": req.PreferredNode, "allow_worker": req.AllowWorker, "selected_model_name": selectedModelName, "runtime_mode": runtimeMode, "permission_profile": permissionProfile})
	if runtimeMode == runtimeModeToolCalling {
		if _, err := tx.ExecContext(ctx, `INSERT INTO runs (id, conversation_id, user_message_id, status, selected_agent_id, route_result, metadata) VALUES (?, ?, ?, 'running', ?, ?, ?)`, runID, conversationID, userMessageID, selectedAgentID, routeRaw, metadataRaw); err != nil {
			return nil, err
		}
	} else if _, err := tx.ExecContext(ctx, `INSERT INTO runs (id, conversation_id, user_message_id, status, selected_agent_id, route_result, finished_at, duration_ms, metadata) VALUES (?, ?, ?, 'succeeded', ?, ?, datetime('now'), 0, ?)`, runID, conversationID, userMessageID, selectedAgentID, routeRaw, metadataRaw); err != nil {
		return nil, err
	}
	if _, err := insertSQLiteRunStep(ctx, tx, runID, "task_classified", "Task mode classified", map[string]any{"message": req.Message, "requested_input_mode": req.InputMode}, map[string]any{"input_mode": classification.InputMode, "mode": classification.Mode, "interaction_class": uiHints.InteractionClass, "conversation_type": classification.ConversationType, "should_create_task": classification.ShouldCreateTask, "requires_user_input": uiHints.RequiresUserInput, "missing_input": uiHints.MissingInput}); err != nil {
		return nil, err
	}
	if productTaskID != "" && memoryIntent.Kind == memoryControlNone && !artifactRewrite {
		if _, err := tx.ExecContext(ctx, `
			UPDATE product_tasks
			SET latest_run_id=?,
			    status=CASE WHEN status IN ('completed','completed_with_limitations') THEN status ELSE 'running' END,
			    updated_at=datetime('now')
			WHERE id=?
		`, runID, productTaskID); err != nil {
			return nil, err
		}
		if err := updateRunMetadataTx(ctx, tx, runID, map[string]any{"product_task_id": productTaskID}); err != nil {
			return nil, err
		}
		if existingTask, err := getProductTask(ctx, tx, productTaskID); err == nil {
			productTask = &existingTask
		}
	} else if classification.ShouldCreateTask {
		taskPlan = inferProductTaskPlan(req.Message)
		task, err := createProductTaskTx(ctx, tx, CreateProductTaskRequest{
			Title:                     taskPlan.Title,
			Description:               taskPlan.Description,
			Status:                    "running",
			Mode:                      "serious_task",
			Priority:                  taskPlan.Priority,
			CreatedFromConversationID: conversationID,
			CreatedFromMessageID:      userMessageID,
			LatestRunID:               runID,
			OwnerUserID:               userID,
			SourceChannel:             channel,
			RiskLevel:                 taskPlan.RiskLevel,
			Summary:                   "已创建任务计划，等待执行结果。",
			Metadata:                  map[string]any{"created_by": "send_chat", "conversation_type": classification.ConversationType},
			Steps:                     taskPlan.Steps,
		})
		if err != nil {
			return nil, err
		}
		productTaskID = task.ID
		productTask = task
		if err := updateConversationActiveContextTx(ctx, tx, conversationID, productTaskID, ""); err != nil {
			return nil, err
		}
		if _, err := insertSQLiteRunStep(ctx, tx, runID, "product_task_created", "Product task created", map[string]any{"message_id": userMessageID}, map[string]any{"product_task_id": task.ID, "title": task.Title, "step_count": len(taskPlan.Steps)}); err != nil {
			return nil, err
		}
	}

	if intent.Clarify && classification.RequiresUserInput {
		runtimeResult, err = a.finishSQLiteMissingInputClarification(ctx, tx, sqliteRuntimeInput{
			RunID:             runID,
			ConversationID:    conversationID,
			UserMessageID:     userMessageID,
			AgentID:           selectedAgentID,
			Message:           req.Message,
			Channel:           channel,
			ModelName:         selectedModelName,
			InputMode:         classification.Mode,
			RouteResult:       routeResult,
			ContextURL:        contextURL,
			PermissionProfile: permissionProfile,
			EventSink:         req.EventSink,
		}, classification)
		if err != nil {
			return nil, err
		}
	} else if memoryIntent.Kind != memoryControlNone {
		runtimeResult, err = a.handleSQLiteMemoryControl(ctx, tx, memoryControlInput{
			RunID:          runID,
			ConversationID: conversationID,
			UserMessageID:  userMessageID,
			AgentID:        selectedAgentID,
			Message:        req.Message,
			EventSink:      req.EventSink,
		}, memoryIntent)
		if err != nil {
			return nil, err
		}
	} else if artifactRewrite {
		runtimeResult, createdArtifacts, err = a.handleSQLiteArtifactRewrite(ctx, tx, artifactRewriteInput{
			RunID:          runID,
			ConversationID: conversationID,
			UserMessageID:  userMessageID,
			AgentID:        selectedAgentID,
			Message:        req.Message,
			UserID:         userID,
			Channel:        channel,
			EventSink:      req.EventSink,
		})
		if err != nil {
			return nil, err
		}
	} else if runtimeMode == runtimeModeToolCalling {
		runtimeResult, err = a.runSQLiteToolCallingRuntime(ctx, tx, sqliteRuntimeInput{
			RunID:             runID,
			ConversationID:    conversationID,
			UserMessageID:     userMessageID,
			AgentID:           selectedAgentID,
			Message:           req.Message,
			Channel:           channel,
			ModelName:         selectedModelName,
			PreferredNode:     req.PreferredNode,
			AllowWorker:       req.AllowWorker,
			InputMode:         classification.Mode,
			ProductTaskID:     productTaskID,
			RouteResult:       routeResult,
			ContextURL:        contextURL,
			PermissionProfile: permissionProfile,
			EventSink:         req.EventSink,
		})
		if err != nil {
			return nil, err
		}
	} else {
		runtimeResult, err = a.runSQLiteAgentRuntime(ctx, tx, sqliteRuntimeInput{
			RunID:             runID,
			ConversationID:    conversationID,
			UserMessageID:     userMessageID,
			AgentID:           selectedAgentID,
			Message:           req.Message,
			Channel:           channel,
			ModelName:         selectedModelName,
			PreferredNode:     req.PreferredNode,
			AllowWorker:       req.AllowWorker,
			InputMode:         classification.Mode,
			ProductTaskID:     productTaskID,
			RouteResult:       routeResult,
			ContextURL:        contextURL,
			PermissionProfile: permissionProfile,
			EventSink:         req.EventSink,
		})
		if err != nil {
			return nil, err
		}
	}
	response := runtimeResult.Response
	steps := runtimeResult.Steps
	if productTaskID != "" && classification.ShouldCreateTask && memoryIntent.Kind == memoryControlNone && !artifactRewrite {
		if runtimeResult.Queued {
			if err := markProductTaskQueuedTx(ctx, tx, productTaskID, runID); err != nil {
				return nil, err
			}
		} else if !strings.Contains(response, "policy_blocked") && !strings.Contains(response, "confirmation_required") && !strings.Contains(response, "已拒绝") {
			sanitizedResponse, sanitizeBrief, changed, err := sanitizeSeriousTaskRuntimeResponseTx(ctx, tx, productTaskID, runID, taskPlan, response)
			if err != nil {
				return nil, err
			}
			if changed {
				response = sanitizedResponse
				runtimeResult.Response = sanitizedResponse
				if sanitizeBrief != nil {
					steps = append(steps, *sanitizeBrief)
					runtimeResult.Steps = steps
				}
			}
			artifact, err := completeProductTaskWithArtifactTx(ctx, tx, productTaskID, runID, conversationID, userMessageID, taskPlan, response)
			if err != nil {
				return nil, err
			}
			if artifact != nil {
				createdArtifacts = append(createdArtifacts, *artifact)
				if err := updateConversationActiveContextTx(ctx, tx, conversationID, productTaskID, artifact.ID); err != nil {
					return nil, err
				}
			}
		}
		if task, err := getProductTask(ctx, tx, productTaskID); err == nil {
			productTask = &task
		}
	}
	if hasExecution, err := runHasVisibleExecutionTx(ctx, tx, runID); err != nil {
		return nil, err
	} else if hasExecution && !uiHints.InlineExecution {
		uiHints.InlineExecution = true
		if err := updateRunMetadataTx(ctx, tx, runID, map[string]any{"ui_inline_execution": true}); err != nil {
			return nil, err
		}
	}
	if memoryIntent.Kind == memoryControlNone && !artifactRewrite {
		reflectionResult, err = a.runConversationReflectionTx(ctx, tx, ReflectionRequest{
			ConversationID: conversationID,
			RunID:          runID,
			MessageID:      userMessageID,
			Message:        req.Message,
			InputMode:      classification.Mode,
			ProductTaskID:  productTaskID,
			SourceChannel:  channel,
			UserID:         userID,
		})
		if err != nil {
			if stepID, stepIDErr := store.NewID("step_"); stepIDErr == nil {
				_, _ = tx.ExecContext(ctx, `INSERT INTO run_steps (id, run_id, step_type, title, status, input, output, error, finished_at, duration_ms) VALUES (?, ?, 'conversation_reflection', 'Conversation reflection failed', 'failed', '{}', '{}', ?, datetime('now'), 0)`, stepID, runID, mustJSON(map[string]any{"message": err.Error()}))
			}
			reflectionResult = nil
		}
	}

	assistantMessageID, err := store.NewID("msg_")
	if err != nil {
		return nil, err
	}
	messageMetadata := map[string]any{"run_id": runID, "agent_id": selectedAgentID, "selected_model_name": selectedModelName}
	if productTaskID != "" {
		messageMetadata["product_task_id"] = productTaskID
	}
	if len(createdArtifacts) > 0 {
		artifactIDs := make([]string, 0, len(createdArtifacts))
		for _, artifact := range createdArtifacts {
			artifactIDs = append(artifactIDs, artifact.ID)
		}
		messageMetadata["artifact_ids"] = artifactIDs
	}
	if len(runtimeResult.UsedMemories) > 0 {
		messageMetadata["used_memory_ids"] = memoryIDs(runtimeResult.UsedMemories)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO messages (id, conversation_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)`, assistantMessageID, conversationID, response, mustJSON(messageMetadata)); err != nil {
		return nil, err
	}
	if err := appendAndEmitSQLiteRunEvent(ctx, tx, req.EventSink, runID, "", "assistant.completed", map[string]any{
		"run_id":               runID,
		"item_id":              assistantMessageID,
		"item_type":            "assistant_message",
		"status":               "completed",
		"title":                "Assistant response completed",
		"assistant_message_id": assistantMessageID,
		"message_id":           assistantMessageID,
		"content":              response,
		"snapshot": map[string]any{
			"assistant_message_id": assistantMessageID,
			"content":              response,
		},
	}); err != nil {
		return nil, err
	}
	if runtimeResult.WaitingApproval {
		if err := appendAndEmitSQLiteRunEvent(ctx, tx, req.EventSink, runID, "", "foreground_run.waiting_approval", map[string]any{
			"run_id":               runID,
			"item_id":              runID,
			"item_type":            "run",
			"status":               "waiting_approval",
			"title":                "Foreground run waiting for approval",
			"assistant_message_id": assistantMessageID,
		}); err != nil {
			return nil, err
		}
	} else {
		if err := appendAndEmitSQLiteRunEvent(ctx, tx, req.EventSink, runID, "", "foreground_run.completed", map[string]any{
			"run_id":               runID,
			"item_id":              runID,
			"item_type":            "run",
			"status":               "completed",
			"title":                "Foreground run completed",
			"summary":              "本轮回复已完成",
			"assistant_message_id": assistantMessageID,
			"has_background_work":  runtimeResult.Queued,
			"snapshot": map[string]any{
				"assistant_message_id": assistantMessageID,
				"has_background_work":  runtimeResult.Queued,
			},
		}); err != nil {
			return nil, err
		}
		if !runtimeResult.Queued {
			if err := appendAndEmitSQLiteRunEvent(ctx, tx, req.EventSink, runID, "", "run.finalized", map[string]any{
				"run_id":               runID,
				"item_id":              runID,
				"item_type":            "run",
				"status":               "completed",
				"title":                "Run finalized",
				"foreground_completed": true,
				"background_completed": true,
				"reflection_completed": reflectionResult != nil,
				"assistant_message_id": assistantMessageID,
				"has_background_work":  false,
				"snapshot": map[string]any{
					"foreground_completed": true,
					"background_completed": true,
					"reflection_completed": reflectionResult != nil,
				},
			}); err != nil {
				return nil, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	proactiveCandidates := []ProactiveMessageRecord{}
	if reflectionResult != nil {
		proactiveCandidates = reflectionResult.ProactiveOpportunities
	}
	return &ChatResponse{ConversationID: conversationID, UserMessageID: userMessageID, AssistantMessageID: assistantMessageID, RunID: runID, SelectedAgentID: selectedAgentID, Response: response, Steps: steps, UI: uiHints, UsedMemories: runtimeResult.UsedMemories, ProductTask: productTask, Artifacts: createdArtifacts, ProactiveCandidates: proactiveCandidates, Reflection: reflectionResult}, nil
}

const (
	desktopMaxAgentTurns         = 3
	desktopMaxCapabilities       = 2
	desktopMaxModelCalls         = 3
	desktopMemoryProfileVersion  = "desktop_profile_v1"
	desktopToolSchemaVersion     = "tool_schema_v1"
	desktopDefaultModelID        = "model_default"
	desktopDefaultAssignmentMain = "default_main_node"
)

type sqliteRuntimeInput struct {
	RunID             string
	ConversationID    string
	UserMessageID     string
	AgentID           string
	Message           string
	Channel           string
	PreferredNode     string
	AllowWorker       bool
	ModelName         string
	InputMode         string
	ProductTaskID     string
	RouteResult       map[string]any
	ContextURL        string
	PermissionProfile string
	EventSink         func(eventName string, payload map[string]any)
}

type sqliteRuntimeResult struct {
	Response        string
	Steps           []store.RunStepBrief
	UsedMemories    []store.MemorySearchResult
	Queued          bool
	WaitingApproval bool
	EventSink       func(eventName string, payload map[string]any)
}

func chatUIHintsFor(classification conversationClassification, intent desktopIntent, inlineExecution bool) *ChatUIHints {
	interactionClass := classification.InteractionClass
	if interactionClass == "" {
		interactionClass = classification.Mode
	}
	if intent.MemoryControl.Kind != memoryControlNone {
		interactionClass = "memory_control"
	} else if intent.ToolResultFollowup {
		interactionClass = "tool_result_followup"
	} else if intent.TaskFollowup {
		interactionClass = "task_followup"
	} else if intent.ArtifactFollowup {
		interactionClass = "artifact_followup"
	} else if intent.Proactive {
		interactionClass = "background_task"
	} else if intent.SeriousTask {
		interactionClass = "serious_task"
	} else if intent.Clarify {
		interactionClass = "clarify"
	}
	return &ChatUIHints{
		InteractionClass:  interactionClass,
		RequiresUserInput: classification.RequiresUserInput,
		MissingInput:      classification.MissingInput,
		InlineExecution:   inlineExecution || intent.SeriousTask || intent.TaskFollowup || intent.ArtifactFollowup || intent.ToolResultFollowup,
	}
}

func runHasVisibleExecutionTx(ctx context.Context, tx *sql.Tx, runID string) (bool, error) {
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM run_steps WHERE run_id=? AND step_type IN ('tool_started', 'tool_finished', 'task_dispatched', 'followup_grounded')`, runID).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

type sqlitePromptAssembly struct {
	ID              string
	ModelID         string
	ModelName       string
	CacheablePrefix string
	DynamicTail     string
	PrefixHash      string
	DynamicHash     string
	PromptCacheKey  string
}

type desktopAgentOutput struct {
	OutputType string         `json:"output_type"`
	Content    string         `json:"content"`
	Answer     string         `json:"answer"`
	Final      string         `json:"final_answer"`
	Message    string         `json:"message"`
	Capability string         `json:"capability"`
	Goal       string         `json:"goal"`
	Inputs     map[string]any `json:"inputs"`
	Risk       string         `json:"risk"`
	Confidence float64        `json:"confidence"`
	Memory     map[string]any `json:"memory"`
}

func (a *AppCore) finishSQLiteMissingInputClarification(ctx context.Context, tx *sql.Tx, input sqliteRuntimeInput, classification conversationClassification) (*sqliteRuntimeResult, error) {
	result := &sqliteRuntimeResult{Steps: []store.RunStepBrief{}, EventSink: input.EventSink}
	for _, step := range []sqliteStepDefinition{
		{stepType: "input_received", title: "Input received", input: map[string]any{"message": input.Message, "channel": input.Channel}, output: map[string]any{"conversation_id": input.ConversationID, "message_id": input.UserMessageID}},
		{stepType: "router_selected", title: "Router selected agent", input: map[string]any{"message": input.Message}, output: input.RouteResult},
		{stepType: "missing_input_clarified", title: "Missing input clarified", input: map[string]any{"message": input.Message}, output: map[string]any{"missing_input": classification.MissingInput, "requires_user_input": true, "policy": "clarify_before_tool_run"}},
	} {
		brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, step.stepType, step.title, step.input, step.output)
		if err != nil {
			return nil, err
		}
		result.Steps = append(result.Steps, brief)
	}
	response := "可以帮你总结网页内容。请把网页链接发给我，我会读取页面并提炼重点。"
	if err := a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, "", response, result); err != nil {
		return nil, err
	}
	return result, nil
}

func (a *AppCore) runSQLiteDeterministicWebResearch(ctx context.Context, tx *sql.Tx, input sqliteRuntimeInput, result *sqliteRuntimeResult, targetURL string) error {
	inputs := map[string]any{"url": targetURL}
	sourceLabel := appcoreSourceLabelFromURL(targetURL)
	emitSQLiteActionEvent(input, "action.started", map[string]any{
		"run_id":       input.RunID,
		"action_id":    "web_research",
		"kind":         "web",
		"title":        "读取网页",
		"status":       "running",
		"summary":      "正在读取 " + sourceLabel,
		"source_label": sourceLabel,
		"details": []map[string]any{
			{"label": "INPUT", "value": map[string]any{"url": targetURL}},
			{"label": "SOURCE", "value": targetURL},
		},
	})
	brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "capability_requested", "Agent requested capability", map[string]any{"agent_id": input.AgentID, "deterministic": true}, map[string]any{"capability": "web_research", "goal": "读取并提炼用户提供的 URL", "inputs": inputs, "risk": "read_only", "confidence": 1.0})
	if err != nil {
		return err
	}
	result.Steps = append(result.Steps, brief)
	settings, err := a.getWorkspaceSettingsFrom(ctx, tx)
	if err != nil {
		return err
	}
	if blocked, reason := store.BlockedResearchURLWithPolicy(targetURL, store.WebResearchPolicy{AllowPrivateHosts: settings.WebResearchAllowPrivateHosts, AllowedHosts: settings.BrowserAllowedHosts}); blocked {
		response := store.FinalAnswerForCapabilityResult("web_research", map[string]any{"url": targetURL, "fetch_status": "policy_blocked", "reason": reason})
		brief, stepErr := insertSQLiteRunStep(ctx, tx, input.RunID, "capability_blocked", "Capability request blocked before execution", map[string]any{"agent_id": input.AgentID, "capability": "web_research", "inputs": inputs}, map[string]any{"reason": reason, "policy": "web_research_url_policy"})
		if stepErr != nil {
			return stepErr
		}
		result.Steps = append(result.Steps, brief)
		return a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, "", response, result)
	}
	capabilityResult, err := a.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
		Type:          "capability_request",
		Capability:    "web_research",
		Goal:          "读取并提炼用户提供的 URL",
		Inputs:        inputs,
		Risk:          "read_only",
		RunID:         input.RunID,
		PreferredNode: input.PreferredNode,
		AllowWorker:   input.AllowWorker,
	})
	if err != nil {
		if errors.Is(err, store.ErrPolicyDenied) {
			response := "policy_blocked：该网页读取请求被策略阻止。"
			brief, stepErr := insertSQLiteRunStep(ctx, tx, input.RunID, "capability_blocked", "Capability request blocked by Tool Compiler", map[string]any{"agent_id": input.AgentID, "capability": "web_research"}, map[string]any{"reason": "tool_compiler_policy_denied"})
			if stepErr != nil {
				return stepErr
			}
			result.Steps = append(result.Steps, brief)
			if err := a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, "", response, result); err != nil {
				return err
			}
			return nil
		}
		return err
	}
	if status := stringFromAny(capabilityResult.NormalizedResult["status"]); status == "queued" {
		result.Queued = true
		response := "已交给执行后台处理，结果会在这里更新。"
		return a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, "", response, result)
	}
	brief, err = insertSQLiteRunStep(ctx, tx, input.RunID, "tool_finished", "Tool runtime finished", map[string]any{"workflow_name": capabilityResult.Workflow.WorkflowName, "tool_run_id": capabilityResult.ToolRunID}, capabilityResult.NormalizedResult)
	if err != nil {
		return err
	}
	result.Steps = append(result.Steps, brief)
	response := store.FinalAnswerForCapabilityResult("web_research", capabilityResult.NormalizedResult)
	if stringFromAny(capabilityResult.NormalizedResult["fetch_status"]) == "succeeded" {
		response, err = a.generateWebSummaryWithPrompt(ctx, tx, input, result, webSummaryInputFromNormalized(capabilityResult.NormalizedResult))
		if err != nil {
			return err
		}
	}
	if response == "" {
		response = "已读取网页，但没有生成可展示内容。"
	}
	return a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, "", response, result)
}

func (a *AppCore) recordSQLiteMockModelTraceForDeterministicPath(ctx context.Context, tx *sql.Tx, input sqliteRuntimeInput, result *sqliteRuntimeResult, dynamicContext string, memoryResults []store.MemorySearchResult) (string, error) {
	if !strings.EqualFold(valueOrDefault(a.Config.Model.Provider, os.Getenv("MODEL_PROVIDER")), "mock_provider") {
		return "", nil
	}
	assembly, err := a.insertSQLitePromptAssembly(ctx, tx, input.RunID, input.AgentID, input.Message, input.RouteResult, dynamicContext, memoryResults, input.ModelName)
	if err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE runs SET selected_model_id=? WHERE id=?`, assembly.ModelID, input.RunID); err != nil {
		return "", err
	}
	brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "prompt_assembled", "Prompt assembly finished", map[string]any{"run_id": input.RunID, "agent_id": input.AgentID, "turn": 1, "deterministic_path": true}, map[string]any{"prompt_assembly_id": assembly.ID, "prefix_hash": assembly.PrefixHash, "dynamic_tail_hash": assembly.DynamicHash, "prompt_cache_key": assembly.PromptCacheKey, "memory_profile_version": desktopMemoryProfileVersion, "tool_schema_version": desktopToolSchemaVersion})
	if err != nil {
		return "", err
	}
	result.Steps = append(result.Steps, brief)
	modelResponse, modelCallID, err := a.invokeAndRecordSQLiteModel(ctx, tx, input.RunID, input.AgentID, assembly)
	if err != nil {
		return "", err
	}
	realModel := modelResponse.Provider != "" && modelResponse.Provider != "mock_provider" && !modelResponse.FallbackToMock
	brief, err = insertSQLiteRunStep(ctx, tx, input.RunID, "model_call_finished", "Model call finished", map[string]any{"agent_id": input.AgentID, "model_id": assembly.ModelID, "prompt_assembly_id": assembly.ID, "deterministic_path": true}, map[string]any{"model_call_id": modelCallID, "provider": modelResponse.Provider, "model": modelResponse.ModelName, "real_model": realModel, "fallback_to_mock": modelResponse.FallbackToMock, "fallback_reason": modelResponse.FallbackReason, "input_tokens": modelResponse.InputTokens, "output_tokens": modelResponse.OutputTokens, "cached_input_tokens": modelResponse.CachedInputTokens, "latency_ms": modelResponse.LatencyMs})
	if err != nil {
		return "", err
	}
	result.Steps = append(result.Steps, brief)
	return modelCallID, nil
}

func (a *AppCore) runSQLiteAgentRuntime(ctx context.Context, tx *sql.Tx, input sqliteRuntimeInput) (*sqliteRuntimeResult, error) {
	result := &sqliteRuntimeResult{Steps: []store.RunStepBrief{}, EventSink: input.EventSink}
	steps := []sqliteStepDefinition{
		{stepType: "input_received", title: "Input received", input: map[string]any{"message": input.Message, "channel": input.Channel}, output: map[string]any{"conversation_id": input.ConversationID, "message_id": input.UserMessageID}},
		{stepType: "router_selected", title: "Router selected agent", input: map[string]any{"message": input.Message}, output: input.RouteResult},
	}
	for _, step := range steps {
		brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, step.stepType, step.title, step.input, step.output)
		if err != nil {
			return nil, err
		}
		result.Steps = append(result.Steps, brief)
	}

	dynamicContext := ""
	var selectedSkillForGuard *store.SkillDefinition
	if handled, contextText, selectedSkill, err := a.runSQLiteSkillSelector(ctx, tx, input, result); err != nil {
		return nil, err
	} else if handled {
		return result, nil
	} else if strings.TrimSpace(contextText) != "" {
		dynamicContext = contextText
		selectedSkillForGuard = selectedSkill
	}
	if activeContext, activeOutput, err := activeContextPromptTx(ctx, tx, input.ConversationID); err != nil {
		return nil, err
	} else if strings.TrimSpace(activeContext) != "" {
		dynamicContext = appendDynamicContext(dynamicContext, activeContext)
		brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "active_context_resolved", "Active context resolved", map[string]any{"conversation_id": input.ConversationID}, activeOutput)
		if err != nil {
			return nil, err
		}
		result.Steps = append(result.Steps, brief)
	}
	conversationContext, err := buildSQLiteConversationContextTx(ctx, tx, input.ConversationID, input.UserMessageID, input.Message)
	if err != nil {
		return nil, err
	}
	brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "conversation_context_resolved", "Conversation context resolved", map[string]any{"conversation_id": input.ConversationID, "message_id": input.UserMessageID, "message_limit": recentConversationMessageLimit, "tool_limit": recentToolEvidenceLimit}, map[string]any{"message_count": conversationContext.MessageCount, "tool_evidence_count": len(conversationContext.ToolEvidence), "included": strings.TrimSpace(conversationContext.Prompt) != ""})
	if err != nil {
		return nil, err
	}
	result.Steps = append(result.Steps, brief)
	if len(conversationContext.ToolEvidence) > 0 {
		sources := make([]map[string]any, 0, len(conversationContext.ToolEvidence))
		for _, evidence := range conversationContext.ToolEvidence {
			sources = append(sources, map[string]any{"run_id": evidence.RunID, "tool_run_id": evidence.ToolRunID, "capability_id": evidence.CapabilityID, "workflow_name": evidence.WorkflowName, "total": evidence.Total, "match_count": len(evidence.Matches)})
		}
		brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "recent_tool_evidence_resolved", "Recent tool evidence resolved", map[string]any{"conversation_id": input.ConversationID, "message": input.Message}, map[string]any{"evidence_count": len(conversationContext.ToolEvidence), "sources": sources})
		if err != nil {
			return nil, err
		}
		result.Steps = append(result.Steps, brief)
	}
	if strings.TrimSpace(conversationContext.Prompt) != "" {
		dynamicContext = appendDynamicContext(dynamicContext, conversationContext.Prompt)
	}
	if resolution, err := a.resolveSQLiteFollowupGrounding(ctx, tx, input, result, conversationContext); err != nil {
		return nil, err
	} else if resolution.Handled {
		return result, nil
	}
	memoryResults, err := searchSQLiteMemoriesInTx(ctx, tx, input.Message, 5)
	if err != nil {
		return nil, err
	}
	if len(memoryResults) > 0 {
		result.UsedMemories = memoryResults
		if err := recordSQLiteMemoryUsage(ctx, tx, input.RunID, input.AgentID, memoryResults); err != nil {
			return nil, err
		}
		brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "memory_context_recalled", "Confirmed memories recalled", map[string]any{"query": input.Message, "limit": 5}, map[string]any{"retrieved_memory_ids": memoryIDs(memoryResults), "memory_count": len(memoryResults), "results": memoryResults})
		if err != nil {
			return nil, err
		}
		result.Steps = append(result.Steps, brief)
	}
	if input.ProductTaskID != "" && isTaskStepExplanationRequest(input.Message) {
		if len(memoryResults) > 0 {
			if _, err := insertSQLiteMemoryContextPackTx(ctx, tx, input.RunID, input.AgentID, memoryResults, map[string]any{"source": "task_step_explanation", "route_result": input.RouteResult}); err != nil {
				return nil, err
			}
		}
		if err := a.finishSQLiteTaskStepExplanation(ctx, tx, input, result); err != nil {
			return nil, err
		}
		return result, nil
	}
	if isContinuationReflectionRequest(input.Message) {
		if len(memoryResults) > 0 {
			if _, err := insertSQLiteMemoryContextPackTx(ctx, tx, input.RunID, input.AgentID, memoryResults, map[string]any{"source": "continuation_reflection", "route_result": input.RouteResult}); err != nil {
				return nil, err
			}
		}
		response, err := buildContinuationReflectionResponse(ctx, tx)
		if err != nil {
			return nil, err
		}
		if err := a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, "", response, result); err != nil {
			return nil, err
		}
		return result, nil
	}
	if input.ProductTaskID == "" && len(memoryResults) > 0 && isMemoryGuidedJudgmentRequest(input.Message) {
		response := buildMemoryGroundedJudgmentResponse(input.Message, memoryResults)
		if _, err := insertSQLiteMemoryContextPackTx(ctx, tx, input.RunID, input.AgentID, memoryResults, map[string]any{"source": "memory_grounded_judgment", "route_result": input.RouteResult}); err != nil {
			return nil, err
		}
		brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "memory_grounded_judgment", "Memory-grounded judgment generated", map[string]any{"message": input.Message, "memory_count": len(memoryResults)}, map[string]any{"response": response, "memory_ids": memoryIDs(memoryResults)})
		if err != nil {
			return nil, err
		}
		result.Steps = append(result.Steps, brief)
		if err := a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, "", response, result); err != nil {
			return nil, err
		}
		return result, nil
	}
	if isReminderInstruction(input.Message) {
		response := "已生成提醒候选，等待你在右侧审核；确认前不会主动发送。"
		brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "proactive_request_acknowledged", "Reminder candidate acknowledged", map[string]any{"message": input.Message}, map[string]any{"response": response})
		if err != nil {
			return nil, err
		}
		result.Steps = append(result.Steps, brief)
		if err := a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, "", response, result); err != nil {
			return nil, err
		}
		return result, nil
	}
	if isMemoryInstruction(input.Message) && !isProductDirection(input.Message) {
		modelCallID, err := a.recordSQLiteMockModelTraceForDeterministicPath(ctx, tx, input, result, dynamicContext, memoryResults)
		if err != nil {
			return nil, err
		}
		classification := classifyConversation(input.Message, input.InputMode)
		content, summary, memoryType := reflectionMemoryContent(input.Message, classification)
		memoryID, err := insertSQLiteMemoryProposal(ctx, tx, input.RunID, input.UserMessageID, input.AgentID, map[string]any{
			"type":       memoryType,
			"content":    content,
			"summary":    summary,
			"confidence": 0.86,
			"entities":   reflectionEntities(input.Message, classification),
		})
		if err != nil {
			return nil, err
		}
		brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "memory_proposed", "Memory write proposal produced", map[string]any{"agent_id": input.AgentID, "deterministic": true}, map[string]any{"memory_id": memoryID, "status": "pending"})
		if err != nil {
			return nil, err
		}
		result.Steps = append(result.Steps, brief)
		response := "已生成记忆候选，等待你在右侧确认；确认前不会写成长期记忆。"
		if err := a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, modelCallID, response, result); err != nil {
			return nil, err
		}
		return result, nil
	}
	if input.ProductTaskID == "" {
		if isReadmeStartupRequest(input.Message) {
			if err := a.runSQLiteReadmeStartupSummary(ctx, tx, input, result); err != nil {
				return nil, err
			}
			return result, nil
		}
		if targetURL := firstNonEmpty(firstURLFromText(input.Message), input.ContextURL); targetURL != "" {
			if err := a.runSQLiteDeterministicWebResearch(ctx, tx, input, result, targetURL); err != nil {
				return nil, err
			}
			return result, nil
		}
	}
	modelCalls := 0
	capabilityRequests := 0

	for turn := 1; turn <= desktopMaxAgentTurns; turn++ {
		if modelCalls >= desktopMaxModelCalls {
			response := "policy_blocked：已达到 max_model_calls_per_run 限制，本轮停止。"
			if err := finalizeSQLiteRun(ctx, tx, input.RunID, "succeeded", response); err != nil {
				return nil, err
			}
			result.Response = response
			return result, nil
		}
		assembly, err := a.insertSQLitePromptAssembly(ctx, tx, input.RunID, input.AgentID, input.Message, input.RouteResult, dynamicContext, memoryResults, input.ModelName)
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE runs SET selected_model_id=? WHERE id=?`, assembly.ModelID, input.RunID); err != nil {
			return nil, err
		}
		brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "prompt_assembled", "Prompt assembly finished", map[string]any{"run_id": input.RunID, "agent_id": input.AgentID, "turn": turn}, map[string]any{"prompt_assembly_id": assembly.ID, "prefix_hash": assembly.PrefixHash, "dynamic_tail_hash": assembly.DynamicHash, "prompt_cache_key": assembly.PromptCacheKey, "memory_profile_version": desktopMemoryProfileVersion, "tool_schema_version": desktopToolSchemaVersion})
		if err != nil {
			return nil, err
		}
		result.Steps = append(result.Steps, brief)

		modelResponse, modelCallID, err := a.invokeAndRecordSQLiteModel(ctx, tx, input.RunID, input.AgentID, assembly)
		if err != nil {
			_, _ = tx.ExecContext(ctx, `UPDATE runs SET status='failed', error_code='provider_failed', error_message=?, finished_at=datetime('now') WHERE id=?`, err.Error(), input.RunID)
			return nil, err
		}
		modelCalls++
		realModel := modelResponse.Provider != "" && modelResponse.Provider != "mock_provider" && !modelResponse.FallbackToMock
		brief, err = insertSQLiteRunStep(ctx, tx, input.RunID, "model_call_finished", "Model call finished", map[string]any{"agent_id": input.AgentID, "model_id": assembly.ModelID, "prompt_assembly_id": assembly.ID}, map[string]any{"model_call_id": modelCallID, "provider": modelResponse.Provider, "model": modelResponse.ModelName, "real_model": realModel, "fallback_to_mock": modelResponse.FallbackToMock, "fallback_reason": modelResponse.FallbackReason, "input_tokens": modelResponse.InputTokens, "output_tokens": modelResponse.OutputTokens, "cached_input_tokens": modelResponse.CachedInputTokens, "latency_ms": modelResponse.LatencyMs})
		if err != nil {
			return nil, err
		}
		result.Steps = append(result.Steps, brief)

		if block := desktopSafetyBlockForMessage(input.Message); block.Response != "" {
			brief, err = insertSQLiteRunStep(ctx, tx, input.RunID, "policy_blocked", "Request blocked by safety policy", map[string]any{"message": input.Message}, map[string]any{"policy": block.Policy, "reason": block.Reason})
			if err != nil {
				return nil, err
			}
			result.Steps = append(result.Steps, brief)
			if err := finalizeSQLiteRun(ctx, tx, input.RunID, "succeeded", block.Response); err != nil {
				return nil, err
			}
			result.Response = block.Response
			return result, nil
		}

		parsed, repaired, err := parseDesktopAgentOutput(modelResponse.Content)
		outputType := parsed.OutputType
		if outputType == "" {
			outputType = "parse_failed"
		}
		brief, stepErr := insertSQLiteRunStep(ctx, tx, input.RunID, "agent_output_parsed", "Agent output parsed", map[string]any{"agent_id": input.AgentID, "turn": turn}, map[string]any{"repaired": repaired, "output_type": outputType})
		if stepErr != nil {
			return nil, stepErr
		}
		result.Steps = append(result.Steps, brief)
		if err != nil {
			response := "模型输出不是 Runtime v0 允许的 JSON 结构，本轮已停止。"
			_, _ = insertSQLiteRunStep(ctx, tx, input.RunID, "agent_output_parse_failed", "Agent output parse failed", map[string]any{"turn": turn}, map[string]any{"error": err.Error()})
			if err := finalizeSQLiteRun(ctx, tx, input.RunID, "succeeded", response); err != nil {
				return nil, err
			}
			result.Response = response
			return result, nil
		}

		switch parsed.OutputType {
		case "final_answer":
			response := firstNonEmpty(parsed.Content, parsed.Answer, parsed.Final, parsed.Message)
			if strings.TrimSpace(response) == "" {
				response = "模型没有返回可展示内容。"
			}
			if err := a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, modelCallID, response, result); err != nil {
				return nil, err
			}
			return result, nil
		case "memory_write_proposal":
			memoryID, err := insertSQLiteMemoryProposal(ctx, tx, input.RunID, input.UserMessageID, input.AgentID, parsed.Memory)
			if err != nil {
				return nil, err
			}
			response := "已生成记忆候选，等待 Memory OS 确认后写入。"
			brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "memory_proposed", "Memory write proposal produced", map[string]any{"agent_id": input.AgentID}, map[string]any{"memory_id": memoryID, "memory": parsed.Memory, "status": "pending"})
			if err != nil {
				return nil, err
			}
			result.Steps = append(result.Steps, brief)
			if err := a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, modelCallID, response, result); err != nil {
				return nil, err
			}
			return result, nil
		case "capability_request":
			capabilityRequests++
			capability := store.CanonicalCapabilityName(parsed.Capability)
			if parsed.Inputs == nil {
				parsed.Inputs = map[string]any{}
			}
			if capability == "web_research" && strings.TrimSpace(stringFromAny(parsed.Inputs["url"])) == "" {
				if url := firstURLFromText(input.Message); url != "" {
					parsed.Inputs["url"] = url
				} else if input.ContextURL != "" {
					parsed.Inputs["url"] = input.ContextURL
				}
			}
			if parsed.Risk == "" {
				parsed.Risk = "read_only"
			}
			brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "capability_requested", "Agent requested capability", map[string]any{"agent_id": input.AgentID}, map[string]any{"capability": capability, "raw_capability": parsed.Capability, "goal": parsed.Goal, "inputs": parsed.Inputs, "risk": parsed.Risk, "confidence": parsed.Confidence})
			if err != nil {
				return nil, err
			}
			result.Steps = append(result.Steps, brief)
			if selectedSkillForGuard != nil {
				guardRequest := store.CapabilityRequest{Capability: capability, Goal: parsed.Goal, Inputs: parsed.Inputs, Risk: parsed.Risk, Source: "model", Evidence: input.Message}
				if err := store.ValidateSkillCapabilityRequest(*selectedSkillForGuard, guardRequest); err != nil {
					plan := store.BuildSkillPlan(*selectedSkillForGuard, input.Message, map[string]any{"guard": "model_request"})
					plan.Rejected = true
					plan.RejectionReason = err.Error()
					if _, recordErr := a.db.RecordSkillRun(ctx, tx, input.RunID, selectedSkillForGuard.ID, "rejected", map[string]any{"message": input.Message}, plan, err.Error()); recordErr != nil {
						return nil, recordErr
					}
					brief, stepErr := insertSQLiteRunStep(ctx, tx, input.RunID, "skill_rejected", "Skill request rejected", map[string]any{"skill_id": selectedSkillForGuard.ID, "capability": capability}, map[string]any{"reason": err.Error()})
					if stepErr != nil {
						return nil, stepErr
					}
					result.Steps = append(result.Steps, brief)
					response := "未执行：Skill 越权。Joi 已阻止 skill/model 请求未声明或被禁止的 capability。"
					if err := a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, modelCallID, response, result); err != nil {
						return nil, err
					}
					return result, nil
				}
			}
			if capabilityRequests > desktopMaxCapabilities {
				response := "policy_blocked：模型重复请求能力调用，已达到 max_capability_requests 限制，本轮不会继续执行工具。"
				if strings.TrimSpace(input.ProductTaskID) != "" {
					response = "能力请求已达到本轮上限；我会停止继续调用工具，并基于已记录的上下文生成带证据限制的交付物。"
				}
				brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "capability_blocked", "Capability request limit reached", map[string]any{"agent_id": input.AgentID, "capability": capability}, map[string]any{"reason": "max_capability_requests_exceeded", "limit": desktopMaxCapabilities})
				if err != nil {
					return nil, err
				}
				result.Steps = append(result.Steps, brief)
				if err := finalizeSQLiteRun(ctx, tx, input.RunID, "succeeded", response); err != nil {
					return nil, err
				}
				result.Response = response
				return result, nil
			}
			if capability == "web_research" && strings.TrimSpace(stringFromAny(parsed.Inputs["url"])) == "" {
				response := "可以帮你总结网页内容。请把网页链接发给我，我会读取页面并提炼重点。"
				brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "capability_blocked", "Capability request needs URL", map[string]any{"agent_id": input.AgentID, "capability": capability, "inputs": parsed.Inputs}, map[string]any{"reason": "missing_url", "policy": "clarify_before_tool_run"})
				if err != nil {
					return nil, err
				}
				result.Steps = append(result.Steps, brief)
				if err := a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, modelCallID, response, result); err != nil {
					return nil, err
				}
				return result, nil
			}
			if capability == "memory_search" {
				query := stringFromAny(parsed.Inputs["query"])
				if query == "" {
					query = input.Message
				}
				memoryResults, err = searchSQLiteMemoriesInTx(ctx, tx, query, 5)
				if err != nil {
					return nil, err
				}
				if err := recordSQLiteMemoryUsage(ctx, tx, input.RunID, input.AgentID, memoryResults); err != nil {
					return nil, err
				}
				result.UsedMemories = mergeMemorySearchResults(result.UsedMemories, memoryResults)
				brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "memory_search_finished", "Memory search finished", map[string]any{"query": query}, map[string]any{"results": memoryResults, "retrieved_memory_ids": memoryIDs(memoryResults)})
				if err != nil {
					return nil, err
				}
				result.Steps = append(result.Steps, brief)
				dynamicContext = "MEMORY_SEARCH_RESULT\n" + string(mustJSON(memoryResults))
				continue
			}
			if capability == "server_diagnose" || capability == "web_research" || capability == "browser_read" || capability == "browser_observe" || capability == "browser_navigate" || capability == "browser_click" || capability == "browser_type" || capability == "system_health_check" || capability == "workspace_search" || capability == "file_read" || capability == "file_analyze" || capability == "apply_patch" || capability == "shell_command" || capability == "test_command" || capability == "desktop_app_list" || capability == "desktop_app_inspect" || capability == "computer_observe" {
				if capability == "server_diagnose" && isUnknownSQLiteServerDiagnoseTarget(parsed.Inputs, input.Message) {
					response := "我需要明确真实的服务名、容器名、端口或 URL 后才能做只读诊断；unknown-service 这类占位目标不会触发工具执行。"
					brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "capability_blocked", "Capability request blocked before execution", map[string]any{"capability": capability, "inputs": parsed.Inputs}, map[string]any{"reason": "unknown_service_target", "policy": "clarify_before_tool_run"})
					if err != nil {
						return nil, err
					}
					result.Steps = append(result.Steps, brief)
					if err := finalizeSQLiteRun(ctx, tx, input.RunID, "succeeded", response); err != nil {
						return nil, err
					}
					result.Response = response
					return result, nil
				}
				productStepID := ""
				if input.ProductTaskID != "" {
					productStepID, err = startProductTaskStepForCapabilityTx(ctx, tx, input.ProductTaskID, input.RunID, capability, parsed.Goal, parsed.Inputs)
					if err != nil {
						return nil, err
					}
				}
				inputs := cloneMap(parsed.Inputs)
				if inputs == nil {
					inputs = map[string]any{}
				}
				if _, ok := inputs["permission_profile"]; !ok {
					inputs["permission_profile"] = string(normalizedPermissionProfile(input.PermissionProfile))
				}
				capabilityResult, err := a.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
					Type:          "capability_request",
					Capability:    capability,
					Goal:          parsed.Goal,
					Inputs:        inputs,
					Risk:          parsed.Risk,
					RunID:         input.RunID,
					PreferredNode: input.PreferredNode,
					AllowWorker:   input.AllowWorker,
					Source:        "model",
					Evidence:      input.Message,
				})
				if err != nil {
					if errors.Is(err, store.ErrPolicyDenied) || errors.Is(err, store.ErrCapabilityMismatch) || errors.Is(err, store.ErrCapabilityMissing) || errors.Is(err, store.ErrMissingArgument) {
						response := "policy_blocked：该能力、workflow 或 tool 当前不可用，或风险超过请求范围；本轮没有执行工具。"
						blockReason := "tool_compiler_policy_denied"
						blockOutput := map[string]any{"reason": blockReason}
						if strings.EqualFold(strings.TrimSpace(parsed.Risk), "state_change") {
							response = "confirmation_required：该操作不是只读能力，必须先创建并批准 confirmation request；本轮没有执行工具。"
						}
						if validation, ok := store.CapabilityValidationResultFromError(err); ok {
							blockReason = strings.ToLower(validation.Code)
							blockOutput = map[string]any{"reason": blockReason, "validation": validation}
							switch validation.Code {
							case "CAPABILITY_MISMATCH":
								response = "未执行：能力不匹配。Joi 已阻止模型把当前请求映射到错误工具；请在执行详情里查看 semantic gate 结果。"
							case "MISSING_ARGUMENT":
								response = "未执行：能力参数缺失。Joi 已阻止无效工具请求；请补充必要输入后再试。"
							case "CAPABILITY_MISSING":
								response = "未执行：Joi 当前没有可执行的匹配能力。"
							}
						}
						if productStepID != "" {
							stepStatus := "blocked"
							if strings.EqualFold(strings.TrimSpace(parsed.Risk), "state_change") {
								stepStatus = "waiting_confirmation"
							}
							_ = completeProductTaskStepTx(ctx, tx, input.ProductTaskID, productStepID, stepStatus, "", "", blockOutput, "能力请求已被策略阻止")
						}
						brief, stepErr := insertSQLiteRunStep(ctx, tx, input.RunID, "capability_rejected", "Capability request rejected", map[string]any{"agent_id": input.AgentID, "capability": capability, "risk": parsed.Risk}, blockOutput)
						if stepErr != nil {
							return nil, stepErr
						}
						result.Steps = append(result.Steps, brief)
						brief, stepErr = insertSQLiteRunStep(ctx, tx, input.RunID, "capability_blocked", "Capability request blocked by Tool Compiler", map[string]any{"agent_id": input.AgentID, "capability": capability, "risk": parsed.Risk}, blockOutput)
						if stepErr != nil {
							return nil, stepErr
						}
						result.Steps = append(result.Steps, brief)
						if err := finalizeSQLiteRun(ctx, tx, input.RunID, "succeeded", response); err != nil {
							return nil, err
						}
						result.Response = response
						return result, nil
					}
					return nil, err
				}
				if status := stringFromAny(capabilityResult.NormalizedResult["status"]); status == "queued" {
					result.Queued = true
					if productStepID != "" {
						workerTaskID := stringFromAny(capabilityResult.NormalizedResult["task_id"])
						if err := completeProductTaskStepTx(ctx, tx, input.ProductTaskID, productStepID, "running", "", workerTaskID, capabilityResult.NormalizedResult, "已派发到工作节点，等待执行结果"); err != nil {
							return nil, err
						}
					}
					response := "已交给执行后台处理，结果会在这里更新。"
					if err := a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, modelCallID, response, result); err != nil {
						return nil, err
					}
					return result, nil
				}
				if productStepID != "" {
					if err := completeProductTaskStepTx(ctx, tx, input.ProductTaskID, productStepID, "done", capabilityResult.ToolRunID, "", capabilityResult.NormalizedResult, "工具流程已完成"); err != nil {
						return nil, err
					}
					if _, err := insertSQLiteRunStep(ctx, tx, input.RunID, "product_task_step_completed", "Product task step completed", map[string]any{"product_task_id": input.ProductTaskID, "product_task_step_id": productStepID}, map[string]any{"tool_run_id": capabilityResult.ToolRunID, "status": "done"}); err != nil {
						return nil, err
					}
				}
				brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "tool_finished", "Tool runtime finished", map[string]any{"workflow_name": capabilityResult.Workflow.WorkflowName, "tool_run_id": capabilityResult.ToolRunID}, capabilityResult.NormalizedResult)
				if err != nil {
					return nil, err
				}
				result.Steps = append(result.Steps, brief)
				response := store.FinalAnswerForCapabilityResult(capability, capabilityResult.NormalizedResult)
				if capability == "web_research" && stringFromAny(capabilityResult.NormalizedResult["fetch_status"]) == "succeeded" {
					response, err = a.generateWebSummaryWithPrompt(ctx, tx, input, result, webSummaryInputFromNormalized(capabilityResult.NormalizedResult))
					if err != nil {
						return nil, err
					}
				}
				if response != "" {
					if err := a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, modelCallID, response, result); err != nil {
						return nil, err
					}
					return result, nil
				}
				dynamicContext = strings.ToUpper(capability) + "_RESULT\n" + string(mustJSON(capabilityResult.NormalizedResult))
				continue
			}
			response := fmt.Sprintf("policy_blocked：Runtime v0 不支持直接执行 %s，本轮没有执行底层工具。", capability)
			brief, err = insertSQLiteRunStep(ctx, tx, input.RunID, "capability_blocked", "Unsupported capability request blocked", map[string]any{"agent_id": input.AgentID, "capability": capability}, map[string]any{"reason": "unsupported_capability_in_runtime_v0"})
			if err != nil {
				return nil, err
			}
			result.Steps = append(result.Steps, brief)
			if err := finalizeSQLiteRun(ctx, tx, input.RunID, "succeeded", response); err != nil {
				return nil, err
			}
			result.Response = response
			return result, nil
		default:
			response := fmt.Sprintf("模型输出了不支持的 output_type=%s，本轮已停止。", parsed.OutputType)
			if err := finalizeSQLiteRun(ctx, tx, input.RunID, "succeeded", response); err != nil {
				return nil, err
			}
			result.Response = response
			return result, nil
		}
	}
	response := "policy_blocked：已达到 max_agent_turns 限制，本轮停止。"
	if strings.TrimSpace(input.ProductTaskID) != "" {
		response = "已达到本轮模型交互上限；我会停止继续尝试，并基于已记录的上下文生成带证据限制的交付物。"
	}
	if err := finalizeSQLiteRun(ctx, tx, input.RunID, "succeeded", response); err != nil {
		return nil, err
	}
	result.Response = response
	return result, nil
}

func (a *AppCore) finishSQLiteAgentResponse(ctx context.Context, tx *sql.Tx, runID string, agentID string, modelCallID string, response string, result *sqliteRuntimeResult) error {
	response = store.RedactSensitiveText(response)
	if err := emitAssistantResponseDeltas(ctx, tx, result, runID, response); err != nil {
		return err
	}
	brief, err := insertSQLiteRunStep(ctx, tx, runID, "agent_call_finished", "Agent runtime finished", map[string]any{"agent_id": agentID}, map[string]any{"response": response, "model_call_id": modelCallID})
	if err != nil {
		return err
	}
	result.Steps = append(result.Steps, brief)
	brief, err = insertSQLiteRunStep(ctx, tx, runID, "response_generated", "Response generated", map[string]any{"run_id": runID}, map[string]any{"response": response})
	if err != nil {
		return err
	}
	result.Steps = append(result.Steps, brief)
	if err := finalizeSQLiteRun(ctx, tx, runID, "succeeded", response); err != nil {
		return err
	}
	result.Response = response
	return nil
}

func emitAssistantResponseDeltas(ctx context.Context, tx *sql.Tx, result *sqliteRuntimeResult, runID string, response string) error {
	if result == nil {
		return nil
	}
	for _, chunk := range splitAssistantResponseDeltas(response) {
		payload := map[string]any{
			"run_id":        runID,
			"item_id":       runID + ":assistant_stream",
			"item_type":     "assistant_message",
			"status":        "running",
			"text":          chunk,
			"stream_source": "fallback_final_chunk",
			"delta": map[string]any{
				"text":          chunk,
				"stream_source": "fallback_final_chunk",
			},
		}
		if err := appendAndEmitSQLiteRunEvent(ctx, tx, result.EventSink, runID, "", "assistant.delta", payload); err != nil {
			return err
		}
		time.Sleep(8 * time.Millisecond)
	}
	return nil
}

func splitAssistantResponseDeltas(response string) []string {
	text := strings.TrimSpace(response)
	if text == "" {
		return nil
	}
	runes := []rune(text)
	const chunkSize = 14
	chunks := make([]string, 0, (len(runes)/chunkSize)+1)
	for start := 0; start < len(runes); start += chunkSize {
		end := start + chunkSize
		if end > len(runes) {
			end = len(runes)
		}
		chunks = append(chunks, string(runes[start:end]))
	}
	return chunks
}

func (a *AppCore) finishSQLiteTaskStepExplanation(ctx context.Context, tx *sql.Tx, input sqliteRuntimeInput, result *sqliteRuntimeResult) error {
	task, err := getProductTask(ctx, tx, input.ProductTaskID)
	if err != nil {
		return err
	}
	steps, err := listProductTaskSteps(ctx, tx, input.ProductTaskID)
	if err != nil {
		return err
	}
	for _, step := range steps {
		if strings.TrimSpace(step.Summary) == "" || len(step.Output) == 0 {
			summary, output := productTaskStepNarrative(task, step)
			if err := updateProductTaskStepNarrativeTx(ctx, tx, step.ID, summary, output); err != nil {
				return err
			}
		}
	}
	steps, err = listProductTaskSteps(ctx, tx, input.ProductTaskID)
	if err != nil {
		return err
	}
	response := buildTaskStepExplanationResponse(task, steps)
	brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "task_steps_explained", "Task steps explained", map[string]any{"product_task_id": input.ProductTaskID}, map[string]any{"step_count": len(steps), "response": response})
	if err != nil {
		return err
	}
	result.Steps = append(result.Steps, brief)
	return a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, "", response, result)
}

func buildTaskStepExplanationResponse(task ProductTask, steps []ProductTaskStep) string {
	var builder strings.Builder
	builder.WriteString("这个任务的步骤记录如下：\n\n")
	for _, step := range steps {
		builder.WriteString("- ")
		builder.WriteString(step.Title)
		builder.WriteString("（")
		builder.WriteString(step.Status)
		builder.WriteString("）：")
		builder.WriteString(firstNonEmpty(step.Summary, step.Description, "暂无步骤摘要。"))
		evidenceStatus := stringFromAny(step.Output["evidence_status"])
		limitation := stringFromAny(step.Output["limitation"])
		if evidenceStatus != "" || limitation != "" || step.ToolRunID != "" || step.CapabilityID != "" {
			builder.WriteString(" 证据：")
			switch {
			case step.ToolRunID != "":
				builder.WriteString("tool_run ")
				builder.WriteString(step.ToolRunID)
			case step.CapabilityID != "":
				builder.WriteString(step.CapabilityID)
			case evidenceStatus == "no_tool_evidence":
				builder.WriteString("没有关联 workspace_search、file_analyze 或 tool_run。")
			default:
				builder.WriteString(evidenceStatus)
			}
			if limitation != "" {
				builder.WriteString(" 限制：")
				builder.WriteString(limitation)
			}
		}
		builder.WriteByte('\n')
	}
	builder.WriteString("\n遗漏/限制：")
	if hasTaskToolEvidence(steps) {
		builder.WriteString("已记录可引用工具证据；仍需要用户检查结论是否覆盖目标。")
	} else {
		builder.WriteString("本任务没有可引用的 workspace_search/file_analyze/tool_run 证据，所以结论只能作为待验证判断，不能当成已验证事实。")
	}
	if task.Status != "" {
		builder.WriteString("\n\n当前任务状态：")
		builder.WriteString(task.Status)
	}
	return builder.String()
}

func hasTaskToolEvidence(steps []ProductTaskStep) bool {
	for _, step := range steps {
		if strings.TrimSpace(step.ToolRunID) != "" || strings.TrimSpace(step.CapabilityID) != "" {
			return true
		}
	}
	return false
}

func isTaskStepExplanationRequest(message string) bool {
	return containsAnyText(message, []string{"每一步", "读了哪些证据", "有没有遗漏", "到底做了什么", "步骤可信", "步骤记录"})
}

func isContinuationReflectionRequest(message string) bool {
	return strings.Contains(message, "明天") &&
		(containsAnyText(message, []string{"还会打开", "继续用", "继续使用"}) || strings.Contains(message, "自己的工具")) &&
		strings.Contains(message, "为什么")
}

func isReminderInstruction(message string) bool {
	return containsAnyText(message, []string{"提醒我", "提醒你", "明天提醒", "之后提醒", "准备提醒", "不要忘了提醒"})
}

func isMemoryGuidedJudgmentRequest(message string) bool {
	return containsAnyText(message, []string{"按你记得", "按你记住", "你记得的我的偏好", "你记住的我的偏好", "别重新问背景"}) &&
		containsAnyText(message, []string{"直接", "判断", "优先级", "下一步"})
}

func buildMemoryGroundedJudgmentResponse(message string, memories []store.MemorySearchResult) string {
	memoryText := confirmedMemoryBulletList(memories)
	if strings.Contains(message, "Joi") || strings.Contains(message, "产品") {
		return "按已确认记忆，我只确定这些偏好：\n" + memoryText + "\n\n我的判断：下一步先验证 Memory Truth 和 Artifact 质量，不要继续加新功能。\n\n优先级：\n- P0：确认记忆自述、召回、纠错是否和 DB 一致。\n- P0：确认 Artifact 是否去掉无证据数字，并能单独阅读。\n- P1：再检查主动提醒是否有原因、可审核、不重复。\n\n我没有把其它推断当成你的长期偏好；没有确认过的内容只作为临时判断。"
	}
	return "按已确认记忆，我只确定这些偏好：\n" + memoryText + "\n\n我的判断：先处理最影响信任和交付质量的事项，再扩展新功能。没有确认过的偏好我不会当成长期事实。"
}

func confirmedMemoryBulletList(memories []store.MemorySearchResult) string {
	lines := []string{}
	seen := map[string]bool{}
	for _, result := range memories {
		content := strings.TrimSpace(firstNonEmpty(result.Memory.Content, result.Memory.Summary))
		if content == "" || seen[content] {
			continue
		}
		seen[content] = true
		lines = append(lines, "- "+content)
	}
	if len(lines) == 0 {
		return "- 暂无可用 confirmed memory。"
	}
	return strings.Join(lines, "\n")
}

func buildContinuationReflectionResponse(ctx context.Context, tx *sql.Tx) (string, error) {
	var confirmed, pending, artifacts, completedTasks, proactiveDrafts int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM memories WHERE status='confirmed' AND disabled_at IS NULL`).Scan(&confirmed); err != nil {
		return "", err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM memories WHERE status='pending' AND disabled_at IS NULL`).Scan(&pending); err != nil {
		return "", err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM artifacts WHERE status='active'`).Scan(&artifacts); err != nil {
		return "", err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_tasks WHERE status IN ('completed','completed_with_limitations')`).Scan(&completedTasks); err != nil {
		return "", err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM proactive_messages WHERE status='draft'`).Scan(&proactiveDrafts); err != nil {
		return "", err
	}
	var builder strings.Builder
	builder.WriteString("会，但只适合继续 dogfood，不适合直接外测。\n\n")
	builder.WriteString("理由：\n")
	if confirmed > 0 {
		builder.WriteString("- 已经有 confirmed memory，Joi 能把长期记忆和待确认记忆分开说清楚。\n")
	} else {
		builder.WriteString("- 长期记忆还没有形成 confirmed 状态，伙伴感还不成立。\n")
	}
	if completedTasks > 0 && artifacts > 0 {
		builder.WriteString("- 严肃任务已经能形成 task、Artifact 和 Run Trace 的可追踪链路。\n")
	} else {
		builder.WriteString("- 严肃任务或 Artifact 链路还没有稳定闭合。\n")
	}
	if proactiveDrafts > 0 {
		builder.WriteString("- 主动提醒停留在 draft/review 模式，没有直接骚扰用户。\n")
	}
	if pending > 0 {
		builder.WriteString("- 仍有 pending memory，需要用户确认或拒绝，不能假装已经长期记住。\n")
	}
	builder.WriteString("\n明天第一件事：继续看 Memory Truth、Task Step 证据说明和 Artifact 是否能单独使用。")
	return builder.String(), nil
}

type sqliteStepDefinition struct {
	stepType string
	title    string
	input    map[string]any
	output   map[string]any
}

func insertSQLiteRunStep(ctx context.Context, tx *sql.Tx, runID string, stepType string, title string, input map[string]any, output map[string]any) (store.RunStepBrief, error) {
	stepID, err := store.NewID("step_")
	if err != nil {
		return store.RunStepBrief{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO run_steps (id, run_id, step_type, title, status, input, output, finished_at, duration_ms) VALUES (?, ?, ?, ?, 'succeeded', ?, ?, datetime('now'), 0)`, stepID, runID, stepType, title, mustJSON(store.SanitizeForTrace(input)), mustJSON(store.SanitizeForTrace(output))); err != nil {
		return store.RunStepBrief{}, err
	}
	return store.RunStepBrief{ID: stepID, StepType: stepType, Title: title, Status: "succeeded"}, nil
}

func finalizeSQLiteRun(ctx context.Context, tx *sql.Tx, runID string, status string, response string) error {
	response = store.RedactSensitiveText(response)
	_, err := tx.ExecContext(ctx, `UPDATE runs SET status=?, finished_at=datetime('now'), duration_ms=CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER), metadata=json_set(COALESCE(metadata, '{}'), '$.final_response', ?) WHERE id=?`, status, response, runID)
	return err
}

func (a *AppCore) insertSQLitePromptAssembly(ctx context.Context, tx *sql.Tx, runID string, agentID string, userMessage string, routeResult map[string]any, dynamicContext string, memories []store.MemorySearchResult, selectedModelName string) (sqlitePromptAssembly, error) {
	modelID, modelName, err := a.ensureSQLiteRunModelTx(ctx, tx, selectedModelName)
	if err != nil {
		return sqlitePromptAssembly{}, err
	}
	prefix := desktopCacheablePrefix(agentID)
	dynamic := desktopDynamicTail(runID, agentID, userMessage, dynamicContext, memories)
	prefixHash := hashText(prefix)
	dynamicHash := hashText(dynamic)
	promptCacheKey := agentID + ":" + modelID + ":" + prefixHash + ":" + desktopMemoryProfileVersion + ":" + desktopToolSchemaVersion
	assemblyID, err := store.NewID("pa_")
	if err != nil {
		return sqlitePromptAssembly{}, err
	}
	contextPackID, err := insertSQLiteMemoryContextPackTx(ctx, tx, runID, agentID, memories, map[string]any{"source": "desktop_appcore", "route_result": routeResult})
	if err != nil {
		return sqlitePromptAssembly{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO prompt_assemblies (id, run_id, agent_id, model_id, memory_context_pack_id, cacheable_prefix, dynamic_tail, prefix_hash, dynamic_tail_hash, prompt_cache_key, memory_profile_version, tool_schema_version, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, assemblyID, runID, agentID, modelID, contextPackID, prefix, dynamic, prefixHash, dynamicHash, promptCacheKey, desktopMemoryProfileVersion, desktopToolSchemaVersion, mustJSON(map[string]any{"desktop_poc": false, "assembly_version": "desktop_runtime_v1", "selected_model_name": modelName})); err != nil {
		return sqlitePromptAssembly{}, err
	}
	return sqlitePromptAssembly{ID: assemblyID, ModelID: modelID, ModelName: modelName, CacheablePrefix: prefix, DynamicTail: dynamic, PrefixHash: prefixHash, DynamicHash: dynamicHash, PromptCacheKey: promptCacheKey}, nil
}

func (a *AppCore) ensureSQLiteRunModelTx(ctx context.Context, tx *sql.Tx, selectedModelName string) (string, string, error) {
	provider := valueOrDefault(a.Config.Model.Provider, "openai_compatible")
	baseURL := a.Config.Model.BaseURL
	defaultModelName := valueOrDefault(a.Config.Model.Name, "model_default")
	modelName := valueOrDefault(strings.TrimSpace(selectedModelName), defaultModelName)
	modelID := desktopDefaultModelID
	if modelName != defaultModelName {
		modelID = "desktop_model_" + hashText(provider + "\n" + baseURL + "\n" + modelName)[:16]
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO models (id, provider, model_name, display_name, base_url, base_url_env, api_key_env, supports_json_mode, supports_tool_calling, enabled, metadata, updated_at)
		VALUES (?, ?, ?, ?, ?, 'MODEL_DEFAULT_BASE_URL', 'MODEL_DEFAULT_API_KEY', 1, 0, 1, ?, datetime('now'))
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
			updated_at=datetime('now')
	`, modelID, provider, modelName, modelName, baseURL, mustJSON(map[string]any{"source": "desktop_run_model", "per_run_selectable": true}))
	return modelID, modelName, err
}

func insertSQLiteMemoryContextPackTx(ctx context.Context, tx *sql.Tx, runID string, agentID string, memories []store.MemorySearchResult, metadata map[string]any) (string, error) {
	contextPackID, err := store.NewID("mcp_")
	if err != nil {
		return "", err
	}
	pack := buildMemoryContextPack(memories)
	if metadata == nil {
		metadata = map[string]any{}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO memory_context_packs (id, run_id, agent_id, memory_profile_version, profile, project_facts, relevant_episodes, heuristics, anti_patterns, open_issues, dynamic_retrieval, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, contextPackID, runID, agentID, desktopMemoryProfileVersion, mustJSON(store.SanitizeForTrace(pack.Profile)), mustJSON(store.SanitizeForTrace(pack.ProjectFacts)), mustJSON(store.SanitizeForTrace(pack.RecentEpisodes)), mustJSON(store.SanitizeForTrace(pack.Heuristics)), mustJSON(store.SanitizeForTrace(pack.AntiPatterns)), mustJSON(store.SanitizeForTrace(pack.OpenIssues)), mustJSON(store.SanitizeForTrace(memories)), mustJSON(metadata)); err != nil {
		return "", err
	}
	return contextPackID, nil
}

func (a *AppCore) invokeAndRecordSQLiteModel(ctx context.Context, tx *sql.Tx, runID string, agentID string, assembly sqlitePromptAssembly) (*store.ModelResponse, string, error) {
	provider := valueOrDefault(a.Config.Model.Provider, "openai_compatible")
	modelName := valueOrDefault(assembly.ModelName, valueOrDefault(a.Config.Model.Name, "model_default"))
	request := store.ModelRequest{
		Provider:        provider,
		ModelID:         assembly.ModelID,
		ModelName:       modelName,
		CacheablePrefix: assembly.CacheablePrefix,
		DynamicTail:     assembly.DynamicTail,
		PromptCacheKey:  assembly.PromptCacheKey,
		PrefixHash:      assembly.PrefixHash,
		DynamicTailHash: assembly.DynamicHash,
		Metadata: map[string]any{
			"prompt_assembly_id":     assembly.ID,
			"memory_profile_version": desktopMemoryProfileVersion,
			"tool_schema_version":    desktopToolSchemaVersion,
			"desktop_mode":           true,
		},
	}
	modelCallID, err := store.NewID("modelcall_")
	if err != nil {
		return nil, "", err
	}
	modelResponse, modelErr := store.InvokeModelDirect(ctx, request)
	if modelErr != nil {
		_, err := tx.ExecContext(ctx, `INSERT INTO model_calls (id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name, prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, output_tokens, cacheable_prefix_tokens, dynamic_tail_tokens, cached_input_tokens, latency_ms, status, error_code, error_message, raw_response, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 0, 'failed', 'provider_failed', ?, '{}', ?)`, modelCallID, runID, agentID, assembly.ModelID, assembly.ID, provider, modelName, assembly.PromptCacheKey, assembly.PrefixHash, assembly.DynamicHash, len(strings.Fields(assembly.CacheablePrefix))+len(strings.Fields(assembly.DynamicTail)), len(strings.Fields(assembly.CacheablePrefix)), len(strings.Fields(assembly.DynamicTail)), modelErr.Error(), mustJSON(map[string]any{"real_model": false, "fallback_to_mock": false, "desktop_mode": true}))
		if err != nil {
			return nil, "", err
		}
		return nil, modelCallID, modelErr
	}
	modelResponse.Content = store.RedactSensitiveText(modelResponse.Content)
	modelResponse.RawResponse = store.SanitizeForTrace(modelResponse.RawResponse).(map[string]any)
	status := "succeeded"
	if modelResponse.FallbackToMock {
		status = "fallback_to_mock"
	}
	metadata := map[string]any{
		"real_model":          modelResponse.Provider != "" && modelResponse.Provider != "mock_provider" && !modelResponse.FallbackToMock,
		"fallback_to_mock":    modelResponse.FallbackToMock,
		"fallback_reason":     modelResponse.FallbackReason,
		"desktop_mode":        true,
		"provider_cache_key":  assembly.PromptCacheKey,
		"estimated_cost":      0,
		"prompt_assembly_id":  assembly.ID,
		"tool_schema_version": desktopToolSchemaVersion,
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO model_calls (id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name, prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, output_tokens, cacheable_prefix_tokens, dynamic_tail_tokens, cached_input_tokens, latency_ms, status, raw_response, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, modelCallID, runID, agentID, assembly.ModelID, assembly.ID, modelResponse.Provider, modelResponse.ModelName, assembly.PromptCacheKey, assembly.PrefixHash, assembly.DynamicHash, modelResponse.InputTokens, modelResponse.OutputTokens, len(strings.Fields(assembly.CacheablePrefix)), len(strings.Fields(assembly.DynamicTail)), modelResponse.CachedInputTokens, modelResponse.LatencyMs, status, mustJSON(modelResponse.RawResponse), mustJSON(metadata)); err != nil {
		return nil, "", err
	}
	cacheStatID, _ := store.NewID("pcache_")
	hitRatio := 0.0
	if modelResponse.InputTokens > 0 {
		hitRatio = float64(modelResponse.CachedInputTokens) / float64(modelResponse.InputTokens)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO provider_cache_stats (id, provider, model_id, model_name, prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, cached_input_tokens, hit_ratio, latency_ms, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, cacheStatID, modelResponse.Provider, assembly.ModelID, modelResponse.ModelName, assembly.PromptCacheKey, assembly.PrefixHash, assembly.DynamicHash, modelResponse.InputTokens, modelResponse.CachedInputTokens, hitRatio, modelResponse.LatencyMs, mustJSON(map[string]any{"desktop_mode": true})); err != nil {
		return nil, "", err
	}
	return modelResponse, modelCallID, nil
}

func (a *AppCore) executeAndRecordSQLiteCapability(ctx context.Context, tx *sql.Tx, request store.CapabilityRequest) (*store.CapabilityExecutionResult, error) {
	request.Capability = store.CanonicalCapabilityName(request.Capability)
	semanticResult, semanticErr := store.ValidateCapabilityRequestWithRegistry(ctx, tx, request)
	if _, err := insertSQLiteRunStep(ctx, tx, request.RunID, "capability_semantic_checked", "Capability semantic contract checked", map[string]any{"capability": request.Capability, "goal": request.Goal, "source": request.Source}, map[string]any{"validation": semanticResult}); err != nil {
		return nil, err
	}
	if semanticErr != nil {
		return nil, semanticErr
	}
	compiled, err := store.CompileCapability(ctx, tx, request)
	if err != nil {
		return nil, err
	}
	request = compiled.CapabilityRequest
	schedule, err := store.ScheduleWorkerNode(ctx, tx, request, store.NodeSchedulerDialectSQLite)
	if err != nil {
		return nil, err
	}
	if schedule.UseWorker {
		return a.enqueueSQLiteWorkerTask(ctx, tx, request, schedule, compiled)
	}
	var result *store.CapabilityExecutionResult
	if workflowHasTool(compiled.Workflow, "mcp_tool_call") {
		result, err = a.executeSQLiteMCPWrappedCapability(ctx, tx, request, compiled.Workflow, compiled.PolicyDecision)
	} else {
		switch request.Capability {
		case "workspace_search":
			result, err = a.executeSQLiteWorkspaceSearch(ctx, tx, request, compiled.Workflow, compiled.PolicyDecision)
		case "file_read":
			result, err = a.executeSQLiteFileRead(ctx, tx, request, compiled.Workflow, compiled.PolicyDecision)
		case "file_analyze":
			result, err = a.executeSQLiteFileAnalyze(ctx, tx, request, compiled.Workflow, compiled.PolicyDecision)
		case "apply_patch":
			result, err = a.executeSQLiteApplyPatch(ctx, tx, request, compiled.Workflow, compiled.PolicyDecision)
		case "shell_command":
			result, err = a.executeSQLiteShellCommand(ctx, tx, request, compiled.Workflow, compiled.PolicyDecision)
		case "test_command":
			result, err = a.executeSQLiteTestCommand(ctx, tx, request, compiled.Workflow, compiled.PolicyDecision)
		case "web_research":
			result, err = a.executeSQLiteWebResearch(ctx, tx, request, compiled.Workflow, compiled.PolicyDecision)
		case "browser_observe":
			result, err = a.executeSQLiteBrowserObserve(ctx, tx, request, compiled.Workflow, compiled.PolicyDecision)
		case "browser_navigate":
			result, err = a.executeSQLiteBrowserNavigate(ctx, tx, request, compiled.Workflow, compiled.PolicyDecision)
		case "browser_click":
			result, err = a.executeSQLiteBrowserInteraction(ctx, tx, request, compiled.Workflow, compiled.PolicyDecision, "click")
		case "browser_type":
			result, err = a.executeSQLiteBrowserInteraction(ctx, tx, request, compiled.Workflow, compiled.PolicyDecision, "type")
		case "computer_observe":
			result, err = a.executeSQLiteComputerObserve(ctx, tx, request, compiled.Workflow, compiled.PolicyDecision)
		default:
			result, err = store.ExecuteCapabilityLocally(ctx, request)
		}
	}
	if err != nil {
		return nil, err
	}
	if result.NormalizedResult == nil {
		result.NormalizedResult = map[string]any{}
	}
	result.PolicyDecision = compiled.PolicyDecision
	result.Workflow = compiled.Workflow
	result.NormalizedResult["node_id"] = "main-node"
	result.NormalizedResult["assignment_reason"] = desktopDefaultAssignmentMain
	result.SelectedNodeID = "main-node"
	toolRunID, err := store.NewID("toolrun_")
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO tool_runs (id, run_id, capability_id, workflow_name, tool_name, node_id, risk_level, status, input, output, finished_at, duration_ms, assignment_reason) VALUES (?, NULLIF(?, ''), ?, ?, ?, 'main-node', ?, 'succeeded', ?, ?, datetime('now'), 0, ?)`, toolRunID, request.RunID, request.Capability, result.Workflow.WorkflowName, result.Workflow.WorkflowName, result.Workflow.RiskLevel, mustJSON(store.SanitizeForTrace(request)), mustJSON(store.SanitizeForTrace(result.NormalizedResult)), desktopDefaultAssignmentMain); err != nil {
		return nil, err
	}
	result.ToolRunID = toolRunID
	for _, step := range []sqliteStepDefinition{
		{stepType: "policy_checked", title: "Policy checked", input: map[string]any{"risk": request.Risk}, output: result.PolicyDecision},
		{stepType: "workflow_compiled", title: "Workflow compiled", input: map[string]any{"capability": request.Capability}, output: map[string]any{"workflow": result.Workflow}},
		{stepType: "tool_compiled", title: "Tool workflow compiled", input: map[string]any{"capability": request.Capability}, output: map[string]any{"workflow": result.Workflow}},
		{stepType: "node_selected", title: "Node selected", input: map[string]any{"capability": request.Capability}, output: map[string]any{"node_id": result.SelectedNodeID, "assignment_reason": desktopDefaultAssignmentMain}},
		{stepType: "tool_started", title: "Tool runtime started", input: map[string]any{"workflow_name": result.Workflow.WorkflowName, "tool_run_id": result.ToolRunID}, output: map[string]any{"node_id": result.SelectedNodeID}},
	} {
		if _, err := insertSQLiteRunStep(ctx, tx, request.RunID, step.stepType, step.title, step.input, step.output); err != nil {
			return nil, err
		}
	}
	for index, workflowStep := range result.Workflow.Steps {
		output := map[string]any{"tool": workflowStep.Tool, "workflow_name": result.Workflow.WorkflowName, "tool_run_id": result.ToolRunID, "index": index}
		if _, err := insertSQLiteRunStep(ctx, tx, request.RunID, "tool_step_started", "Tool step started", map[string]any{"tool": workflowStep.Tool, "args": workflowStep.Args, "risk": workflowStep.RiskLevel}, output); err != nil {
			return nil, err
		}
		if _, err := insertSQLiteRunStep(ctx, tx, request.RunID, "tool_step_completed", "Tool step completed", map[string]any{"tool": workflowStep.Tool, "args": workflowStep.Args, "risk": workflowStep.RiskLevel}, output); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (a *AppCore) executeSQLiteMCPWrappedCapability(ctx context.Context, tx *sql.Tx, request store.CapabilityRequest, workflow store.ToolWorkflow, policy map[string]any) (*store.CapabilityExecutionResult, error) {
	if _, err := insertSQLiteRunStep(ctx, tx, request.RunID, "mcp_tool_call_started", "MCP tool call started", map[string]any{"capability": request.Capability, "inputs": request.Inputs}, map[string]any{"workflow_name": workflow.WorkflowName}); err != nil {
		return nil, err
	}
	normalized, err := store.ExecuteMCPWrappedToolWithTx(ctx, tx, request.Capability, request.Inputs)
	if err != nil {
		return nil, err
	}
	if _, err := insertSQLiteRunStep(ctx, tx, request.RunID, "mcp_tool_call_completed", "MCP tool call completed", map[string]any{"capability": request.Capability}, normalized); err != nil {
		return nil, err
	}
	return &store.CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    policy,
		Workflow:          workflow,
		SelectedNodeID:    "main-node",
		NormalizedResult:  normalized,
	}, nil
}

func workflowHasTool(workflow store.ToolWorkflow, toolID string) bool {
	for _, step := range workflow.Steps {
		if step.Tool == toolID {
			return true
		}
	}
	return false
}

func (a *AppCore) runSQLiteSkillSelector(ctx context.Context, tx *sql.Tx, input sqliteRuntimeInput, result *sqliteRuntimeResult) (bool, string, *store.SkillDefinition, error) {
	skill, err := store.SelectSkillForMessageWithTx(ctx, tx, input.Message)
	if err != nil {
		return false, "", nil, err
	}
	if skill == nil {
		return false, "", nil, nil
	}
	brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "skill_selected", "Skill selected", map[string]any{"message": input.Message}, map[string]any{"skill_id": skill.ID, "name": skill.Name, "trigger_phrases": skill.TriggerPhrases, "required_capabilities": skill.RequiredCapabilities, "forbidden_capabilities": skill.ForbiddenCapabilities})
	if err != nil {
		return false, "", nil, err
	}
	result.Steps = append(result.Steps, brief)
	plan := store.BuildSkillPlan(*skill, input.Message, map[string]any{"conversation_id": input.ConversationID, "run_id": input.RunID})
	brief, err = insertSQLiteRunStep(ctx, tx, input.RunID, "skill_plan_generated", "Skill plan generated", map[string]any{"skill_id": skill.ID}, map[string]any{"plan": plan})
	if err != nil {
		return false, "", nil, err
	}
	result.Steps = append(result.Steps, brief)
	for _, request := range plan.CapabilityRequests {
		if err := store.ValidateSkillCapabilityRequest(*skill, request); err != nil {
			plan.Rejected = true
			plan.RejectionReason = err.Error()
			if _, recordErr := a.db.RecordSkillRun(ctx, tx, input.RunID, skill.ID, "rejected", map[string]any{"message": input.Message}, plan, err.Error()); recordErr != nil {
				return false, "", nil, recordErr
			}
			brief, stepErr := insertSQLiteRunStep(ctx, tx, input.RunID, "skill_rejected", "Skill request rejected", map[string]any{"skill_id": skill.ID, "capability": request.Capability}, map[string]any{"reason": err.Error()})
			if stepErr != nil {
				return false, "", nil, stepErr
			}
			result.Steps = append(result.Steps, brief)
			response := "未执行：Skill 越权。Joi 已阻止 skill 请求未声明或被禁止的 capability。"
			if finishErr := a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, "", response, result); finishErr != nil {
				return false, "", nil, finishErr
			}
			return true, "", nil, nil
		}
	}
	if len(plan.CapabilityRequests) == 0 {
		if _, err := a.db.RecordSkillRun(ctx, tx, input.RunID, skill.ID, "planned", map[string]any{"message": input.Message}, plan, ""); err != nil {
			return false, "", nil, err
		}
		return false, "SKILL_PLAN\n" + string(mustJSON(plan)), skill, nil
	}
	if _, err := a.db.RecordSkillRun(ctx, tx, input.RunID, skill.ID, "completed", map[string]any{"message": input.Message}, plan, ""); err != nil {
		return false, "", nil, err
	}
	request := plan.CapabilityRequests[0]
	request.RunID = input.RunID
	request.Source = "skill"
	request.Evidence = input.Message
	if request.Risk == "" {
		request.Risk = "read_only"
	}
	capability := store.CanonicalCapabilityName(request.Capability)
	brief, err = insertSQLiteRunStep(ctx, tx, input.RunID, "capability_requested", "Skill requested capability", map[string]any{"skill_id": skill.ID}, map[string]any{"capability": capability, "goal": request.Goal, "inputs": request.Inputs, "risk": request.Risk, "source": "skill"})
	if err != nil {
		return false, "", nil, err
	}
	result.Steps = append(result.Steps, brief)
	capabilityResult, err := a.executeAndRecordSQLiteCapability(ctx, tx, request)
	if err != nil {
		blockOutput := map[string]any{"reason": "skill_capability_execution_denied", "error": err.Error()}
		if validation, ok := store.CapabilityValidationResultFromError(err); ok {
			blockOutput = map[string]any{"reason": strings.ToLower(validation.Code), "validation": validation}
		}
		brief, stepErr := insertSQLiteRunStep(ctx, tx, input.RunID, "capability_rejected", "Skill capability rejected", map[string]any{"skill_id": skill.ID, "capability": capability}, blockOutput)
		if stepErr != nil {
			return false, "", nil, stepErr
		}
		result.Steps = append(result.Steps, brief)
		response := "未执行：Skill 请求的能力未通过校验。"
		if finishErr := a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, "", response, result); finishErr != nil {
			return false, "", nil, finishErr
		}
		return true, "", nil, nil
	}
	brief, err = insertSQLiteRunStep(ctx, tx, input.RunID, "tool_finished", "Tool runtime finished", map[string]any{"workflow_name": capabilityResult.Workflow.WorkflowName, "tool_run_id": capabilityResult.ToolRunID, "source": "skill"}, capabilityResult.NormalizedResult)
	if err != nil {
		return false, "", nil, err
	}
	result.Steps = append(result.Steps, brief)
	response := store.FinalAnswerForCapabilityResult(capability, capabilityResult.NormalizedResult)
	if capability == "web_research" && stringFromAny(capabilityResult.NormalizedResult["fetch_status"]) == "succeeded" {
		response, err = a.generateWebSummaryWithPrompt(ctx, tx, input, result, webSummaryInputFromNormalized(capabilityResult.NormalizedResult))
		if err != nil {
			return false, "", nil, err
		}
	}
	if response == "" {
		response = "Skill 计划已完成，工具结果已写入执行详情。"
	}
	if err := a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, "", response, result); err != nil {
		return false, "", nil, err
	}
	return true, "", nil, nil
}

func (a *AppCore) enqueueSQLiteWorkerTask(ctx context.Context, tx *sql.Tx, request store.CapabilityRequest, schedule store.NodeScheduleDecision, compiled *store.CapabilityExecutionResult) (*store.CapabilityExecutionResult, error) {
	taskID, err := store.NewID("task_")
	if err != nil {
		return nil, err
	}
	privacy := schedule.PrivacyLevel
	if privacy == "" {
		privacy = "public"
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO tasks (id, run_id, capability_id, preferred_node_id, assigned_node_id, privacy_level, status, payload, timeout_seconds) VALUES (?, NULLIF(?, ''), ?, NULLIF(?, ''), ?, ?, 'pending', ?, 120)`, taskID, request.RunID, request.Capability, request.PreferredNode, schedule.NodeID, privacy, mustJSON(store.SanitizeForTrace(map[string]any{"type": request.Type, "capability": request.Capability, "goal": request.Goal, "inputs": request.Inputs, "risk": request.Risk, "run_id": request.RunID, "call_id": request.CallID, "turn_id": request.TurnID, "preferred_node": request.PreferredNode, "allow_worker": request.AllowWorker, "privacy_level": privacy}))); err != nil {
		return nil, err
	}
	workflow := compiled.Workflow
	result := &store.CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    compiled.PolicyDecision,
		Workflow:          workflow,
		SelectedNodeID:    schedule.NodeID,
		NormalizedResult:  map[string]any{"status": "queued", "message": "已交给执行后台处理，结果会在这里更新。", "task_id": taskID, "node_id": schedule.NodeID, "assignment_reason": schedule.AssignmentReason, "privacy_level": privacy, "running_tasks": schedule.RunningTasks, "scheduler": schedule.Scheduler, "task_attempts": 0},
	}
	for _, step := range []sqliteStepDefinition{
		{stepType: "policy_checked", title: "Policy checked", input: map[string]any{"risk": request.Risk}, output: result.PolicyDecision},
		{stepType: "workflow_compiled", title: "Workflow compiled", input: map[string]any{"capability": request.Capability}, output: map[string]any{"workflow": workflow}},
		{stepType: "tool_compiled", title: "Tool workflow compiled", input: map[string]any{"capability": request.Capability}, output: map[string]any{"workflow": workflow}},
		{stepType: "node_selected", title: "Node selected", input: map[string]any{"capability": request.Capability, "preferred_node": request.PreferredNode, "privacy_level": privacy}, output: map[string]any{"node_id": schedule.NodeID, "assignment_reason": schedule.AssignmentReason, "running_tasks": schedule.RunningTasks, "scheduler": schedule.Scheduler}},
		{stepType: "task_dispatched", title: "Task dispatched to worker", input: map[string]any{"task_id": taskID, "allow_worker": request.AllowWorker}, output: map[string]any{"node_id": schedule.NodeID, "assignment_reason": schedule.AssignmentReason, "privacy_level": privacy, "scheduler": schedule.Scheduler, "task_attempts": 0}},
	} {
		if _, err := insertSQLiteRunStep(ctx, tx, request.RunID, step.stepType, step.title, step.input, step.output); err != nil {
			return nil, err
		}
	}
	return result, nil
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
	run.Events, _ = a.listSQLiteRunEvents(ctx, runID)
	run.Tasks, _ = a.listSQLiteRunTasks(ctx, runID)
	return &run, nil
}

func (a *AppCore) listSQLiteRunEvents(ctx context.Context, runID string) ([]store.RunEventRecord, error) {
	rows, err := a.db.SQL().QueryContext(ctx, `
		SELECT id, run_id, COALESCE(turn_id, ''), seq, event_type, payload, created_at
		FROM run_events
		WHERE run_id=?
		ORDER BY seq ASC, created_at ASC
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []store.RunEventRecord{}
	for rows.Next() {
		var event store.RunEventRecord
		var payloadRaw, createdAt string
		if err := rows.Scan(&event.ID, &event.RunID, &event.TurnID, &event.Seq, &event.EventType, &payloadRaw, &createdAt); err != nil {
			return nil, err
		}
		event.Payload = decodeObject([]byte(payloadRaw))
		event.CreatedAt = parseSQLiteTime(createdAt)
		events = append(events, event)
	}
	return events, rows.Err()
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

func (a *AppCore) listSQLiteRunTasks(ctx context.Context, runID string) ([]store.TaskRecord, error) {
	rows, err := a.db.SQL().QueryContext(ctx, `
		SELECT id, COALESCE(run_id, ''), capability_id, COALESCE(preferred_node_id, ''),
		       COALESCE(assigned_node_id, ''), privacy_level, status, payload, result, COALESCE(error, ''),
		       created_at, started_at, finished_at
		FROM tasks
		WHERE run_id=?
		ORDER BY created_at ASC
	`, runID)
	if err != nil {
		return nil, err
	}
	tasks := []store.TaskRecord{}
	taskIDs := []string{}
	for rows.Next() {
		var task store.TaskRecord
		var payloadRaw, resultRaw, errorRaw string
		var createdAt string
		var startedAt, finishedAt sql.NullString
		if err := rows.Scan(&task.ID, &task.RunID, &task.CapabilityID, &task.PreferredNodeID, &task.AssignedNodeID, &task.PrivacyLevel, &task.Status, &payloadRaw, &resultRaw, &errorRaw, &createdAt, &startedAt, &finishedAt); err != nil {
			return nil, err
		}
		task.Payload = decodeObject([]byte(payloadRaw))
		task.Result = decodeObject([]byte(resultRaw))
		task.Error = decodeObject([]byte(errorRaw))
		task.CreatedAt = parseSQLiteTime(createdAt)
		if startedAt.Valid {
			t := parseSQLiteTime(startedAt.String)
			task.StartedAt = &t
		}
		if finishedAt.Valid {
			t := parseSQLiteTime(finishedAt.String)
			task.FinishedAt = &t
		}
		taskIDs = append(taskIDs, task.ID)
		tasks = append(tasks, task)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for i, taskID := range taskIDs {
		tasks[i].Attempts, _ = a.listSQLiteTaskAttempts(ctx, taskID)
	}
	return tasks, nil
}

func (a *AppCore) listSQLiteTaskAttempts(ctx context.Context, taskID string) ([]store.TaskAttemptRecord, error) {
	rows, err := a.db.SQL().QueryContext(ctx, `SELECT id, task_id, COALESCE(node_id, ''), status, attempt_number, input, output, COALESCE(error, ''), started_at, finished_at FROM task_attempts WHERE task_id=? ORDER BY attempt_number ASC, started_at ASC`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	attempts := []store.TaskAttemptRecord{}
	for rows.Next() {
		var attempt store.TaskAttemptRecord
		var inputRaw, outputRaw, errorRaw, startedAt string
		var finishedAt sql.NullString
		if err := rows.Scan(&attempt.ID, &attempt.TaskID, &attempt.NodeID, &attempt.Status, &attempt.AttemptNumber, &inputRaw, &outputRaw, &errorRaw, &startedAt, &finishedAt); err != nil {
			return nil, err
		}
		attempt.Input = decodeObject([]byte(inputRaw))
		attempt.Output = decodeObject([]byte(outputRaw))
		attempt.Error = decodeObject([]byte(errorRaw))
		attempt.StartedAt = parseSQLiteTime(startedAt)
		if finishedAt.Valid {
			t := parseSQLiteTime(finishedAt.String)
			attempt.FinishedAt = &t
		}
		attempts = append(attempts, attempt)
	}
	return attempts, rows.Err()
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
		rows, err = a.db.SQL().QueryContext(ctx, `SELECT id, type, content, COALESCE(summary,''), scope_type, COALESCE(scope_id,''), privacy_level, confidence, status, source_event_ids, entities, success_count, failure_count, usage_count, positive_feedback, negative_feedback, pinned, disabled_at, COALESCE(merged_into_memory_id,''), COALESCE(conflict_group_id,''), COALESCE(conflict_reason,''), metadata, created_at, updated_at, last_used_at, 0.5 AS score FROM memories WHERE status='confirmed' AND disabled_at IS NULL AND merged_into_memory_id IS NULL ORDER BY pinned DESC, confidence DESC, updated_at DESC LIMIT ?`, limit)
	} else {
		rows, err = a.db.SQL().QueryContext(ctx, `SELECT m.id, m.type, m.content, COALESCE(m.summary,''), m.scope_type, COALESCE(m.scope_id,''), m.privacy_level, m.confidence, m.status, m.source_event_ids, m.entities, m.success_count, m.failure_count, m.usage_count, m.positive_feedback, m.negative_feedback, m.pinned, m.disabled_at, COALESCE(m.merged_into_memory_id,''), COALESCE(m.conflict_group_id,''), COALESCE(m.conflict_reason,''), m.metadata, m.created_at, m.updated_at, m.last_used_at, bm25(memory_fts) * -1 AS score FROM memory_fts JOIN memories m ON m.id = memory_fts.memory_id WHERE memory_fts MATCH ? AND m.status='confirmed' AND m.disabled_at IS NULL AND m.merged_into_memory_id IS NULL ORDER BY m.pinned DESC, score DESC, m.confidence DESC LIMIT ?`, ftsQuery(query), limit)
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if query != "" && len(results) < limit {
		fallback, err := a.fallbackSQLiteMemorySearch(ctx, query, limit, memoryIDs(results))
		if err != nil {
			return nil, err
		}
		results = append(results, fallback...)
		sort.SliceStable(results, func(i, j int) bool {
			if results[i].Memory.Pinned != results[j].Memory.Pinned {
				return results[i].Memory.Pinned
			}
			if results[i].Score == results[j].Score {
				return results[i].Memory.Confidence > results[j].Memory.Confidence
			}
			return results[i].Score > results[j].Score
		})
		if len(results) > limit {
			results = results[:limit]
		}
	}
	return &MemorySearchResponse{Query: params.Query, Results: results, ContextPack: buildMemoryContextPack(results)}, nil
}

func (a *AppCore) fallbackSQLiteMemorySearch(ctx context.Context, query string, limit int, existing []string) ([]store.MemorySearchResult, error) {
	seen := map[string]bool{}
	for _, id := range existing {
		seen[id] = true
	}
	rows, err := a.db.SQL().QueryContext(ctx, `SELECT id, type, content, COALESCE(summary,''), scope_type, COALESCE(scope_id,''), privacy_level, confidence, status, source_event_ids, entities, success_count, failure_count, usage_count, positive_feedback, negative_feedback, pinned, disabled_at, COALESCE(merged_into_memory_id,''), COALESCE(conflict_group_id,''), COALESCE(conflict_reason,''), metadata, created_at, updated_at, last_used_at, 0.5 AS score FROM memories WHERE status='confirmed' AND disabled_at IS NULL AND merged_into_memory_id IS NULL ORDER BY pinned DESC, confidence DESC, updated_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	results := []store.MemorySearchResult{}
	for rows.Next() {
		memory, _, err := scanSQLiteMemory(rows)
		if err != nil {
			return nil, err
		}
		if seen[memory.ID] {
			continue
		}
		score := sqliteMemoryKeywordScore(query, memory)
		if score <= 0 {
			continue
		}
		results = append(results, store.MemorySearchResult{Memory: memory, Score: score, Reason: "sqlite_keyword_fallback"})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].Memory.Pinned != results[j].Memory.Pinned {
			return results[i].Memory.Pinned
		}
		if results[i].Score == results[j].Score {
			return results[i].Memory.Confidence > results[j].Memory.Confidence
		}
		return results[i].Score > results[j].Score
	})
	if len(results) > limit {
		results = results[:limit]
	}
	return results, nil
}

func sqliteMemoryKeywordScore(query string, memory store.MemoryRecord) float64 {
	haystack := strings.ToLower(memory.Content + " " + memory.Summary + " " + strings.Join(memory.SourceEventIDs, " "))
	tokens := sqliteSearchTokens(query)
	if len(tokens) == 0 {
		return 0
	}
	score := 0.0
	for _, token := range tokens {
		if strings.Contains(haystack, token) {
			score += 1
		}
	}
	if score == 0 {
		return 0
	}
	score = score / float64(len(tokens))
	score += memory.Confidence * 0.2
	if memory.Pinned {
		score += 0.5
	}
	return score
}

func sqliteSearchTokens(query string) []string {
	query = strings.ToLower(strings.TrimSpace(query))
	fields := strings.FieldsFunc(query, func(r rune) bool {
		return r <= 32 || strings.ContainsRune("，。！？；：、,.!?;:()[]{}\"'`", r)
	})
	seen := map[string]bool{}
	tokens := []string{}
	add := func(token string) {
		token = strings.TrimSpace(token)
		if len([]rune(token)) < 2 || seen[token] {
			return
		}
		seen[token] = true
		tokens = append(tokens, token)
	}
	for _, field := range fields {
		add(field)
		runes := []rune(field)
		for i := 0; i+1 < len(runes); i++ {
			add(string(runes[i : i+2]))
		}
	}
	return tokens
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

func searchSQLiteMemoriesInTx(ctx context.Context, tx *sql.Tx, query string, limit int) ([]store.MemorySearchResult, error) {
	if limit <= 0 || limit > 20 {
		limit = 10
	}
	query = strings.TrimSpace(query)
	var rows *sql.Rows
	var err error
	if query == "" {
		rows, err = tx.QueryContext(ctx, `SELECT id, type, content, COALESCE(summary,''), scope_type, COALESCE(scope_id,''), privacy_level, confidence, status, source_event_ids, entities, success_count, failure_count, usage_count, positive_feedback, negative_feedback, pinned, disabled_at, COALESCE(merged_into_memory_id,''), COALESCE(conflict_group_id,''), COALESCE(conflict_reason,''), metadata, created_at, updated_at, last_used_at, 0.5 AS score FROM memories WHERE status='confirmed' AND disabled_at IS NULL AND merged_into_memory_id IS NULL ORDER BY pinned DESC, confidence DESC, updated_at DESC LIMIT ?`, limit)
	} else {
		matchQuery := ftsQuery(query)
		if matchQuery == "" {
			return fallbackSQLiteMemorySearchTx(ctx, tx, query, limit, nil)
		}
		rows, err = tx.QueryContext(ctx, `SELECT m.id, m.type, m.content, COALESCE(m.summary,''), m.scope_type, COALESCE(m.scope_id,''), m.privacy_level, m.confidence, m.status, m.source_event_ids, m.entities, m.success_count, m.failure_count, m.usage_count, m.positive_feedback, m.negative_feedback, m.pinned, m.disabled_at, COALESCE(m.merged_into_memory_id,''), COALESCE(m.conflict_group_id,''), COALESCE(m.conflict_reason,''), m.metadata, m.created_at, m.updated_at, m.last_used_at, bm25(memory_fts) * -1 AS score FROM memory_fts JOIN memories m ON m.id = memory_fts.memory_id WHERE memory_fts MATCH ? AND m.status='confirmed' AND m.disabled_at IS NULL AND m.merged_into_memory_id IS NULL ORDER BY m.pinned DESC, score DESC, m.confidence DESC LIMIT ?`, matchQuery, limit)
		if err != nil {
			return fallbackSQLiteMemorySearchTx(ctx, tx, query, limit, nil)
		}
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if query != "" && len(results) < limit {
		fallback, err := fallbackSQLiteMemorySearchTx(ctx, tx, query, limit, memoryIDs(results))
		if err != nil {
			return nil, err
		}
		results = append(results, fallback...)
		sort.SliceStable(results, func(i, j int) bool {
			if results[i].Memory.Pinned != results[j].Memory.Pinned {
				return results[i].Memory.Pinned
			}
			if results[i].Score == results[j].Score {
				return results[i].Memory.Confidence > results[j].Memory.Confidence
			}
			return results[i].Score > results[j].Score
		})
		if len(results) > limit {
			results = results[:limit]
		}
	}
	return results, nil
}

func recordSQLiteMemoryUsage(ctx context.Context, tx *sql.Tx, runID string, agentID string, results []store.MemorySearchResult) error {
	for _, result := range results {
		usageID, err := store.NewID("mulog_")
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO memory_usage_logs (id, memory_id, run_id, agent_id, retrieval_score, injected, used_in_answer, outcome, metadata) VALUES (?, ?, ?, ?, ?, 1, 1, 'injected', ?)`, usageID, result.Memory.ID, runID, agentID, result.Score, mustJSON(map[string]any{"reason": result.Reason, "source": "desktop_runtime"})); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE memories SET usage_count=usage_count+1, last_used_at=datetime('now'), updated_at=datetime('now') WHERE id=?`, result.Memory.ID); err != nil {
			return err
		}
	}
	return nil
}

func fallbackSQLiteMemorySearchTx(ctx context.Context, tx *sql.Tx, query string, limit int, existing []string) ([]store.MemorySearchResult, error) {
	seen := map[string]bool{}
	for _, id := range existing {
		seen[id] = true
	}
	rows, err := tx.QueryContext(ctx, `SELECT id, type, content, COALESCE(summary,''), scope_type, COALESCE(scope_id,''), privacy_level, confidence, status, source_event_ids, entities, success_count, failure_count, usage_count, positive_feedback, negative_feedback, pinned, disabled_at, COALESCE(merged_into_memory_id,''), COALESCE(conflict_group_id,''), COALESCE(conflict_reason,''), metadata, created_at, updated_at, last_used_at, 0.5 AS score FROM memories WHERE status='confirmed' AND disabled_at IS NULL AND merged_into_memory_id IS NULL ORDER BY pinned DESC, confidence DESC, updated_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	results := []store.MemorySearchResult{}
	for rows.Next() {
		memory, _, err := scanSQLiteMemory(rows)
		if err != nil {
			return nil, err
		}
		if seen[memory.ID] {
			continue
		}
		score := sqliteMemoryKeywordScore(query, memory)
		if score <= 0 {
			continue
		}
		results = append(results, store.MemorySearchResult{Memory: memory, Score: score, Reason: "sqlite_keyword_fallback"})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].Memory.Pinned != results[j].Memory.Pinned {
			return results[i].Memory.Pinned
		}
		if results[i].Score == results[j].Score {
			return results[i].Memory.Confidence > results[j].Memory.Confidence
		}
		return results[i].Score > results[j].Score
	})
	if len(results) > limit {
		results = results[:limit]
	}
	return results, nil
}

func mergeMemorySearchResults(base []store.MemorySearchResult, extra []store.MemorySearchResult) []store.MemorySearchResult {
	seen := map[string]bool{}
	merged := make([]store.MemorySearchResult, 0, len(base)+len(extra))
	for _, item := range base {
		if item.Memory.ID == "" || seen[item.Memory.ID] {
			continue
		}
		seen[item.Memory.ID] = true
		merged = append(merged, item)
	}
	for _, item := range extra {
		if item.Memory.ID == "" || seen[item.Memory.ID] {
			continue
		}
		seen[item.Memory.ID] = true
		merged = append(merged, item)
	}
	return merged
}

func memoryIDs(results []store.MemorySearchResult) []string {
	ids := make([]string, 0, len(results))
	for _, result := range results {
		ids = append(ids, result.Memory.ID)
	}
	return ids
}

func insertSQLiteMemoryProposal(ctx context.Context, tx *sql.Tx, runID string, userMessageID string, agentID string, memory map[string]any) (string, error) {
	memoryID, err := store.NewID("mem_")
	if err != nil {
		return "", err
	}
	memoryType := valueOrDefault(stringFromAny(memory["type"]), "note")
	content := stringFromAny(memory["content"])
	if strings.TrimSpace(content) == "" {
		content = string(mustJSON(memory))
	}
	summary := firstNonEmpty(stringFromAny(memory["summary"]), truncate(content, 120))
	confidence := floatFromAny(memory["confidence"], 0.6)
	sourceEvents := []string{}
	if userMessageID != "" {
		sourceEvents = append(sourceEvents, userMessageID)
	}
	if runID != "" {
		sourceEvents = append(sourceEvents, runID)
	}
	entities := memory["entities"]
	if entities == nil {
		entities = []any{}
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, metadata)
		VALUES (?, ?, ?, ?, 'global', 'internal', ?, 'pending', ?, ?, ?)
	`, memoryID, memoryType, content, summary, confidence, mustJSON(sourceEvents), mustJSON(entities), mustJSON(map[string]any{"proposed_by_agent_id": agentID, "run_id": runID, "source": "desktop_runtime"}))
	return memoryID, err
}

func (a *AppCore) markSQLiteOfflineNodes(ctx context.Context) error {
	thresholdSeconds := intEnvDefault("WORKER_OFFLINE_AFTER_SECONDS", 90)
	if thresholdSeconds < 5 {
		thresholdSeconds = 5
	}
	modifier := fmt.Sprintf("-%d seconds", thresholdSeconds)
	_, err := a.db.SQL().ExecContext(ctx, `
		UPDATE nodes
		SET status='offline',
		    failed_heartbeat_count=failed_heartbeat_count+1,
		    last_failure_at=datetime('now'),
		    last_failure_reason='heartbeat_timeout',
		    updated_at=datetime('now')
		WHERE role='worker'
		  AND status='healthy'
		  AND last_heartbeat_at IS NOT NULL
		  AND last_heartbeat_at < datetime('now', ?)
	`, modifier)
	return err
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
	if webResearchRequestMissingURL(message) {
		return "general_agent"
	}
	if strings.Contains(lower, "http://") || strings.Contains(lower, "https://") {
		return "research_agent"
	}
	if strings.Contains(message, "服务") || strings.Contains(message, "容器") || strings.Contains(message, "自检") || strings.Contains(message, "诊断") || strings.Contains(lower, "system health") || strings.Contains(lower, "docker") || strings.Contains(lower, "restart") || strings.Contains(lower, "cloudflared") || strings.Contains(lower, "unknown-service") {
		return "devops_agent"
	}
	if strings.Contains(message, "记忆") || strings.Contains(message, "记住") || strings.Contains(message, "记得") || strings.Contains(message, "偏好") || strings.Contains(message, "之前") {
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
- capability_request schema: {"output_type":"capability_request","capability":"memory_search|server_diagnose|system_health_check|web_research|browser_read|browser_observe|browser_navigate|browser_click|browser_type|workspace_search|file_read|file_analyze|apply_patch|shell_command|test_command|desktop_app_list|desktop_app_inspect|computer_observe","goal":"...","inputs":{},"risk":"read_only|workspace_write|browser_interaction","confidence":0.0}.
- memory_write_proposal schema: {"output_type":"memory_write_proposal","memory":{"type":"...","content":"...","confidence":0.0}}.
- The model must not output raw shell, SQL, file_write, service_restart, restart, stop, rm, delete, chmod, or chown for execution.
- If a capability lacks required inputs, such as web_research without a URL, return final_answer asking for the missing input instead of requesting the capability.
- Artifact-style answers must not invent numbers, rates, timings, file evidence, or user behavior claims. If evidence is missing, say it is a待验证判断 and name the limitation.
- When using memory, separate "confirmed memory says" from "my current inference". Never describe an inference as something the user previously preferred or said.
- Desktop Mode uses local SQLite and AppCore directly. It does not call localhost HTTP.
- If the user asks whether this run uses a real model, answer from Runtime Facts below. Do not claim "未调用真实模型" when model_path is real_provider.

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

func desktopDynamicTail(runID string, agentID string, userMessage string, dynamicContext string, memories []store.MemorySearchResult) string {
	userMessage = store.RedactSensitiveText(userMessage)
	dynamicContext = store.RedactSensitiveText(dynamicContext)
	memoryJSON := string(mustJSON(store.SanitizeForTrace(memories)))
	if len(memories) == 0 {
		memoryJSON = "[]"
	}
	memoryLines := "none"
	if len(memories) > 0 {
		lines := make([]string, 0, len(memories))
		for _, result := range memories {
			summary := firstNonEmpty(result.Memory.Summary, result.Memory.Content)
			lines = append(lines, "- "+store.RedactSensitiveText(summary)+": "+store.RedactSensitiveText(result.Memory.Content))
		}
		memoryLines = strings.Join(lines, "\n")
	}
	return `Current Run
run_id: ` + runID + `
agent_id: ` + agentID + `
route_result: {"route_mode":"single","lead_agent":"` + agentID + `","route_source":"desktop_appcore"}

Runtime Facts
configured_model_provider: ` + store.RedactSensitiveText(valueOrDefault(os.Getenv("MODEL_PROVIDER"), "unknown")) + `
configured_model_name: ` + store.RedactSensitiveText(valueOrDefault(os.Getenv("MODEL_NAME"), "unknown")) + `
model_path: ` + desktopModelPathFact() + `

User Message
` + userMessage + `

Dynamic Context
` + dynamicContext + `

Confirmed Memories Available For This Reply
` + memoryLines + `

Dynamic Memory Retrieval
` + memoryJSON + `

Return JSON only.
`
}

func desktopOutputType(content string) string {
	parsed, _, err := parseDesktopAgentOutput(content)
	if err == nil && parsed.OutputType != "" {
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

func parseDesktopAgentOutput(content string) (desktopAgentOutput, bool, error) {
	var output desktopAgentOutput
	if err := json.Unmarshal([]byte(strings.TrimSpace(content)), &output); err == nil {
		return validateDesktopAgentOutput(output)
	}
	repaired := repairDesktopJSONContent(content)
	if repaired == "" {
		return output, false, errors.New("agent output is not valid JSON")
	}
	if err := json.Unmarshal([]byte(repaired), &output); err != nil {
		return output, true, err
	}
	validated, _, err := validateDesktopAgentOutput(output)
	return validated, true, err
}

func validateDesktopAgentOutput(output desktopAgentOutput) (desktopAgentOutput, bool, error) {
	switch output.OutputType {
	case "final_answer":
		if output.Content == "" {
			output.Content = firstNonEmpty(output.Final, output.Answer, output.Message)
		}
		if output.Content == "" {
			return output, false, errors.New("final_answer missing content")
		}
	case "capability_request":
		if output.Capability == "" {
			return output, false, errors.New("capability_request missing capability")
		}
		output.Capability = store.CanonicalCapabilityName(output.Capability)
		if output.Inputs == nil {
			output.Inputs = map[string]any{}
		}
	case "memory_write_proposal":
		if output.Memory == nil {
			return output, false, errors.New("memory_write_proposal missing memory")
		}
	default:
		return output, false, fmt.Errorf("unsupported output_type: %s", output.OutputType)
	}
	return output, false, nil
}

func repairDesktopJSONContent(content string) string {
	content = strings.TrimSpace(content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start < 0 || end < start {
		return ""
	}
	return content[start : end+1]
}

type desktopSafetyBlock struct {
	Policy   string
	Reason   string
	Response string
}

func desktopSafetyBlockForMessage(message string) desktopSafetyBlock {
	normalized := strings.ToLower(strings.TrimSpace(message))
	if normalized == "" {
		return desktopSafetyBlock{}
	}
	if containsDesktopAny(normalized, "绕过 confirmation", "bypass confirmation", "跳过 confirmation") {
		return desktopSafetyBlock{Policy: "confirmation_required", Reason: "state_change_requires_console_confirmation", Response: "confirmation_required：涉及 state_change 的操作必须先在 Console 创建并批准 confirmation request；不会执行绕过确认的请求。"}
	}
	if containsDesktopAny(normalized, "rm -rf", "docker restart", "docker stop", "docker rm", "chmod ", "chown ", " restart ", " stop ", "file_write", "file write", "写入文件", "raw shell", "shell command", "执行 shell", "执行 sql", "raw sql") {
		return desktopSafetyBlock{Policy: "rejected", Reason: "dangerous_state_change_or_destructive_command", Response: "rejected：这是危险或修改性操作。当前 Runtime 不会执行 restart、stop、rm、chmod、chown 等 state_change 操作。"}
	}
	if containsDesktopAny(normalized, ".env", "api key", "apikey", "secret key", "private key", "/etc/passwd", "/etc/shadow", "~/.ssh", "/.ssh", ".ssh/", "id_rsa") {
		return desktopSafetyBlock{Policy: "policy_blocked", Reason: "sensitive_secret_or_local_file_read", Response: "policy_blocked：请求涉及密钥、环境文件、SSH 私钥或敏感系统路径，已拒绝读取或打印。"}
	}
	if containsDesktopAny(normalized, "worker 读取完整 memory", "完整 memory", "full memory", "fake-node", "node_secret", "non whitelist telegram user", "non-whitelist telegram user") {
		return desktopSafetyBlock{Policy: "permission_denied", Reason: "unauthorized_worker_node_or_telegram_access", Response: "permission_denied：Worker、Node 和 Telegram 访问必须经过授权校验，且 Worker 不允许读取完整长期记忆。"}
	}
	if containsDesktopAny(normalized, "file://", "ftp://", "0.0.0.0", "169.254.169.254") {
		return desktopSafetyBlock{Policy: "policy_blocked", Reason: "blocked_url_scheme_or_private_network_target", Response: "policy_blocked：web_research 不允许访问 file://、ftp://、metadata IP 或未指定地址；localhost/私网地址只能通过 web_research allowlist 策略放行。"}
	}
	return desktopSafetyBlock{}
}

func desktopModelPathFact() string {
	provider := strings.ToLower(strings.TrimSpace(os.Getenv("MODEL_PROVIDER")))
	if provider == "" || provider == "mock_provider" {
		return "mock_provider"
	}
	if strings.EqualFold(os.Getenv("ALLOW_MOCK_PROVIDER"), "true") {
		return "real_provider_with_mock_allowed"
	}
	return "real_provider"
}

func containsDesktopAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(value, needle) {
			return true
		}
	}
	return false
}

func emitSQLiteActionEvent(input sqliteRuntimeInput, eventName string, payload map[string]any) {
	if input.EventSink == nil {
		return
	}
	if payload == nil {
		payload = map[string]any{}
	}
	input.EventSink(eventName, payload)
}

func isUnknownSQLiteServerDiagnoseTarget(inputs map[string]any, userMessage string) bool {
	for _, key := range []string{"service_name", "container_name", "service", "container", "url", "port"} {
		target := strings.TrimSpace(strings.ToLower(stringFromAny(inputs[key])))
		if target == "" {
			continue
		}
		if target == "unknown" || target == "unknown-service" || target == "unknown_container" || target == "unknown-container" {
			return true
		}
		return false
	}
	message := strings.ToLower(userMessage)
	return strings.Contains(message, "unknown-service") || strings.Contains(message, "unknown service")
}

func stringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case json.Number:
		return typed.String()
	case int:
		return fmt.Sprintf("%d", typed)
	case int64:
		return fmt.Sprintf("%d", typed)
	case float64:
		return fmt.Sprintf("%.0f", typed)
	case nil:
		return ""
	default:
		return strings.Trim(string(mustJSON(typed)), `"`)
	}
}

func floatFromAny(value any, fallback float64) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		if parsed, err := typed.Float64(); err == nil {
			return parsed
		}
	}
	return fallback
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

func firstURLFromText(value string) string {
	match := desktopURLPattern.FindString(value)
	return strings.TrimRight(match, ".,;:!?")
}

func appcoreSourceLabelFromURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		return rawURL
	}
	return strings.TrimPrefix(parsed.Hostname(), "www.")
}

func latestConversationURLTx(ctx context.Context, tx *sql.Tx, conversationID string, excludeMessageID string) (string, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT content
		FROM messages
		WHERE conversation_id=?
		  AND id<>?
		ORDER BY created_at DESC
		LIMIT 20
	`, conversationID, excludeMessageID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	for rows.Next() {
		var content string
		if err := rows.Scan(&content); err != nil {
			return "", err
		}
		if found := firstURLFromText(content); found != "" {
			return found, nil
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	return "", sql.ErrNoRows
}

func webResearchRequestMissingURL(message string) bool {
	if firstURLFromText(message) != "" {
		return false
	}
	lower := strings.ToLower(message)
	targetsWebPage := containsAnyText(message, []string{"网页", "页面", "这个网页", "当前网页", "这个页面", "当前页面", "网页内容", "页面内容", "网页链接", "网页地址", "网址", "链接"}) ||
		containsAnyText(lower, []string{"web page", "webpage", "website", "url", "link", "page", "site"})
	wantsSummary := containsAnyText(message, []string{"总结", "读取", "看一下", "提炼", "分析"}) ||
		containsAnyText(lower, []string{"summarize", "summary", "read", "fetch", "extract", "analyze"})
	return targetsWebPage && wantsSummary
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

func intEnvDefault(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func intFromString(value string, fallback int) int {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
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
