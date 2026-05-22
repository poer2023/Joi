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
	"os"
	"path/filepath"
	"regexp"
	"runtime"
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
}
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

func (a *AppCore) UpdateMemory(ctx context.Context, req MemoryActionRequest) error {
	if a.db == nil {
		return errors.New("appcore db is not available")
	}
	if !a.isSQLite() {
		return errors.New("desktop memory actions are currently implemented for SQLite mode")
	}
	switch req.Action {
	case "confirm":
		_, err := a.db.SQL().ExecContext(ctx, `UPDATE memories SET status='confirmed', updated_at=datetime('now') WHERE id=?`, req.ID)
		return err
	case "edit_confirm":
		if strings.TrimSpace(req.Content) == "" {
			return errors.New("edit_confirm requires content")
		}
		summary := req.Summary
		if strings.TrimSpace(summary) == "" {
			summary = truncate(req.Content, 120)
		}
		_, err := a.db.SQL().ExecContext(ctx, `UPDATE memories SET content=?, summary=?, status='confirmed', updated_at=datetime('now') WHERE id=?`, req.Content, summary, req.ID)
		return err
	case "delete":
		_, err := a.db.SQL().ExecContext(ctx, `DELETE FROM memories WHERE id=?`, req.ID)
		return err
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
		       input, COALESCE(approved_by, ''), COALESCE(rejected_by, ''), COALESCE(decision_reason, ''),
		       created_at, decided_at
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
		if err := rows.Scan(&item.ID, &item.RunID, &item.CapabilityID, &item.RequestedAction, &item.RiskLevel, &item.Status, &inputRaw, &item.ApprovedBy, &item.RejectedBy, &item.DecisionReason, &createdAt, &decidedAt); err != nil {
			return nil, err
		}
		item.Input = decodeObject([]byte(inputRaw))
		item.CreatedAt = parseSQLiteTime(createdAt)
		if decidedAt.Valid {
			t := parseSQLiteTime(decidedAt.String)
			item.DecidedAt = &t
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
	_, err := a.db.SQL().ExecContext(ctx, `UPDATE confirmation_requests SET status=?, approved_by=NULLIF(?, ''), rejected_by=NULLIF(?, ''), decision_reason=?, decided_at=datetime('now') WHERE id=? AND status='pending'`, status, approvedBy, rejectedBy, req.Reason, req.ID)
	return err
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
	return &DesktopSettingsResponse{
		Version:                valueOrDefault(os.Getenv("APP_VERSION"), "0.1.0-rc0"),
		AppMode:                a.Config.App.Mode,
		DataStore:              a.Config.App.DataStore,
		TaskQueue:              a.Config.TaskQueue.Driver,
		SQLitePath:             a.Config.App.SQLitePath,
		LogDir:                 filepath.Join(filepath.Dir(a.Config.App.SQLitePath), "logs"),
		ModelProvider:          a.Config.Model.Provider,
		ModelName:              a.Config.Model.Name,
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
	baseURL := valueOrDefault(req.BaseURL, "https://api.deepseek.com")
	modelName := valueOrDefault(req.Name, "deepseek-chat")
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

	runtimeResult, err := a.runSQLiteAgentRuntime(ctx, tx, sqliteRuntimeInput{
		RunID:          runID,
		ConversationID: conversationID,
		UserMessageID:  userMessageID,
		AgentID:        selectedAgentID,
		Message:        req.Message,
		Channel:        channel,
		PreferredNode:  req.PreferredNode,
		AllowWorker:    req.AllowWorker,
		RouteResult:    routeResult,
	})
	if err != nil {
		return nil, err
	}
	response := runtimeResult.Response
	steps := runtimeResult.Steps

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
	RunID          string
	ConversationID string
	UserMessageID  string
	AgentID        string
	Message        string
	Channel        string
	PreferredNode  string
	AllowWorker    bool
	RouteResult    map[string]any
}

type sqliteRuntimeResult struct {
	Response string
	Steps    []store.RunStepBrief
}

type sqlitePromptAssembly struct {
	ID              string
	ModelID         string
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

func (a *AppCore) runSQLiteAgentRuntime(ctx context.Context, tx *sql.Tx, input sqliteRuntimeInput) (*sqliteRuntimeResult, error) {
	result := &sqliteRuntimeResult{Steps: []store.RunStepBrief{}}
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
	var memoryResults []store.MemorySearchResult
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
		assembly, err := a.insertSQLitePromptAssembly(ctx, tx, input.RunID, input.AgentID, input.Message, input.RouteResult, dynamicContext, memoryResults)
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
			if capabilityRequests > desktopMaxCapabilities {
				response := "policy_blocked：模型重复请求能力调用，已达到 max_capability_requests 限制，本轮不会继续执行工具。"
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
				brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "memory_search_finished", "Memory search finished", map[string]any{"query": query}, map[string]any{"results": memoryResults, "retrieved_memory_ids": memoryIDs(memoryResults)})
				if err != nil {
					return nil, err
				}
				result.Steps = append(result.Steps, brief)
				dynamicContext = "MEMORY_SEARCH_RESULT\n" + string(mustJSON(memoryResults))
				continue
			}
			if capability == "server_diagnose" || capability == "web_research" || capability == "system_health_check" {
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
				capabilityResult, err := a.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
					Type:          "capability_request",
					Capability:    capability,
					Goal:          parsed.Goal,
					Inputs:        parsed.Inputs,
					Risk:          parsed.Risk,
					RunID:         input.RunID,
					PreferredNode: input.PreferredNode,
					AllowWorker:   input.AllowWorker,
				})
				if err != nil {
					if errors.Is(err, store.ErrPolicyDenied) {
						response := "confirmation_required：该操作不是只读能力，必须先创建并批准 confirmation request；本轮没有执行工具。"
						if err := finalizeSQLiteRun(ctx, tx, input.RunID, "succeeded", response); err != nil {
							return nil, err
						}
						result.Response = response
						return result, nil
					}
					return nil, err
				}
				if status := stringFromAny(capabilityResult.NormalizedResult["status"]); status == "queued" {
					response := "已将任务派发到所选节点；worker 执行结果会写入 task_attempts、tool_runs 和 Run Trace。"
					if err := a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, modelCallID, response, result); err != nil {
						return nil, err
					}
					return result, nil
				}
				brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "tool_finished", "Tool runtime finished", map[string]any{"workflow_name": capabilityResult.Workflow.WorkflowName, "tool_run_id": capabilityResult.ToolRunID}, capabilityResult.NormalizedResult)
				if err != nil {
					return nil, err
				}
				result.Steps = append(result.Steps, brief)
				if response := store.FinalAnswerForCapabilityResult(capability, capabilityResult.NormalizedResult); response != "" {
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
	if err := finalizeSQLiteRun(ctx, tx, input.RunID, "succeeded", response); err != nil {
		return nil, err
	}
	result.Response = response
	return result, nil
}

func (a *AppCore) finishSQLiteAgentResponse(ctx context.Context, tx *sql.Tx, runID string, agentID string, modelCallID string, response string, result *sqliteRuntimeResult) error {
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
	if _, err := tx.ExecContext(ctx, `INSERT INTO run_steps (id, run_id, step_type, title, status, input, output, finished_at, duration_ms) VALUES (?, ?, ?, ?, 'succeeded', ?, ?, datetime('now'), 0)`, stepID, runID, stepType, title, mustJSON(input), mustJSON(output)); err != nil {
		return store.RunStepBrief{}, err
	}
	return store.RunStepBrief{ID: stepID, StepType: stepType, Title: title, Status: "succeeded"}, nil
}

func finalizeSQLiteRun(ctx context.Context, tx *sql.Tx, runID string, status string, response string) error {
	_, err := tx.ExecContext(ctx, `UPDATE runs SET status=?, finished_at=datetime('now'), duration_ms=CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER), metadata=json_set(COALESCE(metadata, '{}'), '$.final_response', ?) WHERE id=?`, status, response, runID)
	return err
}

func (a *AppCore) insertSQLitePromptAssembly(ctx context.Context, tx *sql.Tx, runID string, agentID string, userMessage string, routeResult map[string]any, dynamicContext string, memories []store.MemorySearchResult) (sqlitePromptAssembly, error) {
	modelID := desktopDefaultModelID
	prefix := desktopCacheablePrefix(agentID)
	dynamic := desktopDynamicTail(runID, agentID, userMessage, dynamicContext)
	prefixHash := hashText(prefix)
	dynamicHash := hashText(dynamic)
	promptCacheKey := agentID + ":" + modelID + ":" + prefixHash + ":" + desktopMemoryProfileVersion + ":" + desktopToolSchemaVersion
	contextPackID, err := store.NewID("mcp_")
	if err != nil {
		return sqlitePromptAssembly{}, err
	}
	assemblyID, err := store.NewID("pa_")
	if err != nil {
		return sqlitePromptAssembly{}, err
	}
	pack := buildMemoryContextPack(memories)
	if _, err := tx.ExecContext(ctx, `INSERT INTO memory_context_packs (id, run_id, agent_id, memory_profile_version, profile, project_facts, relevant_episodes, heuristics, anti_patterns, open_issues, dynamic_retrieval, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, contextPackID, runID, agentID, desktopMemoryProfileVersion, mustJSON(pack.Profile), mustJSON(pack.ProjectFacts), mustJSON(pack.RecentEpisodes), mustJSON(pack.Heuristics), mustJSON(pack.AntiPatterns), mustJSON(pack.OpenIssues), mustJSON(memories), mustJSON(map[string]any{"source": "desktop_appcore", "route_result": routeResult})); err != nil {
		return sqlitePromptAssembly{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO prompt_assemblies (id, run_id, agent_id, model_id, memory_context_pack_id, cacheable_prefix, dynamic_tail, prefix_hash, dynamic_tail_hash, prompt_cache_key, memory_profile_version, tool_schema_version, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, assemblyID, runID, agentID, modelID, contextPackID, prefix, dynamic, prefixHash, dynamicHash, promptCacheKey, desktopMemoryProfileVersion, desktopToolSchemaVersion, mustJSON(map[string]any{"desktop_poc": false, "assembly_version": "desktop_runtime_v1"})); err != nil {
		return sqlitePromptAssembly{}, err
	}
	return sqlitePromptAssembly{ID: assemblyID, ModelID: modelID, CacheablePrefix: prefix, DynamicTail: dynamic, PrefixHash: prefixHash, DynamicHash: dynamicHash, PromptCacheKey: promptCacheKey}, nil
}

func (a *AppCore) invokeAndRecordSQLiteModel(ctx context.Context, tx *sql.Tx, runID string, agentID string, assembly sqlitePromptAssembly) (*store.ModelResponse, string, error) {
	provider := valueOrDefault(a.Config.Model.Provider, "openai_compatible")
	modelName := valueOrDefault(a.Config.Model.Name, "model_default")
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
	if request.Risk != "" && request.Risk != "read_only" {
		confirmationID, _ := store.NewID("confirm_")
		_, _ = tx.ExecContext(ctx, `INSERT INTO confirmation_requests (id, run_id, capability_id, requested_action, risk_level, input) VALUES (?, NULLIF(?, ''), ?, ?, ?, ?)`, confirmationID, request.RunID, request.Capability, request.Goal, request.Risk, mustJSON(request.Inputs))
		return nil, store.ErrPolicyDenied
	}
	if nodeID, ok := sqliteWorkerDispatchNode(request); ok {
		return a.enqueueSQLiteWorkerTask(ctx, tx, request, nodeID)
	}
	result, err := store.ExecuteCapabilityLocally(ctx, request)
	if err != nil {
		return nil, err
	}
	result.NormalizedResult["node_id"] = "main-node"
	result.NormalizedResult["assignment_reason"] = desktopDefaultAssignmentMain
	result.SelectedNodeID = "main-node"
	toolRunID, err := store.NewID("toolrun_")
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO tool_runs (id, run_id, capability_id, workflow_name, tool_name, node_id, risk_level, status, input, output, finished_at, duration_ms, assignment_reason) VALUES (?, NULLIF(?, ''), ?, ?, ?, 'main-node', 'read_only', 'succeeded', ?, ?, datetime('now'), 0, ?)`, toolRunID, request.RunID, request.Capability, result.Workflow.WorkflowName, result.Workflow.WorkflowName, mustJSON(request), mustJSON(result.NormalizedResult), desktopDefaultAssignmentMain); err != nil {
		return nil, err
	}
	result.ToolRunID = toolRunID
	for _, step := range []sqliteStepDefinition{
		{stepType: "policy_checked", title: "Policy checked", input: map[string]any{"risk": request.Risk}, output: result.PolicyDecision},
		{stepType: "tool_compiled", title: "Tool workflow compiled", input: map[string]any{"capability": request.Capability}, output: map[string]any{"workflow": result.Workflow}},
		{stepType: "node_selected", title: "Node selected", input: map[string]any{"capability": request.Capability}, output: map[string]any{"node_id": result.SelectedNodeID, "assignment_reason": desktopDefaultAssignmentMain}},
	} {
		if _, err := insertSQLiteRunStep(ctx, tx, request.RunID, step.stepType, step.title, step.input, step.output); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func sqliteWorkerDispatchNode(request store.CapabilityRequest) (string, bool) {
	if request.PreferredNode != "" && request.PreferredNode != "main-node" && request.PreferredNode != "auto" {
		return request.PreferredNode, true
	}
	if request.PreferredNode == "auto" && request.AllowWorker {
		return "local-worker-1", true
	}
	return "", false
}

func (a *AppCore) enqueueSQLiteWorkerTask(ctx context.Context, tx *sql.Tx, request store.CapabilityRequest, nodeID string) (*store.CapabilityExecutionResult, error) {
	taskID, err := store.NewID("task_")
	if err != nil {
		return nil, err
	}
	reason := "user_selected"
	if request.PreferredNode == "auto" {
		reason = "auto_allow_worker"
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO tasks (id, run_id, capability_id, preferred_node_id, assigned_node_id, privacy_level, status, payload, timeout_seconds) VALUES (?, NULLIF(?, ''), ?, NULLIF(?, ''), ?, 'internal', 'pending', ?, 120)`, taskID, request.RunID, request.Capability, request.PreferredNode, nodeID, mustJSON(map[string]any{"type": request.Type, "capability": request.Capability, "goal": request.Goal, "inputs": request.Inputs, "risk": request.Risk, "run_id": request.RunID, "preferred_node": request.PreferredNode, "allow_worker": request.AllowWorker})); err != nil {
		return nil, err
	}
	workflow := store.ToolWorkflow{WorkflowName: request.Capability + "_v1", Capability: request.Capability, RiskLevel: "read_only"}
	if request.Capability == "server_diagnose" {
		workflow.WorkflowName = "server_diagnose_v1"
	}
	result := &store.CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    map[string]any{"risk": "read_only", "decision": "allow", "reason": "queued for worker gateway"},
		Workflow:          workflow,
		SelectedNodeID:    nodeID,
		NormalizedResult:  map[string]any{"status": "queued", "task_id": taskID, "node_id": nodeID, "assignment_reason": reason, "task_attempts": 0},
	}
	for _, step := range []sqliteStepDefinition{
		{stepType: "policy_checked", title: "Policy checked", input: map[string]any{"risk": request.Risk}, output: result.PolicyDecision},
		{stepType: "tool_compiled", title: "Tool workflow compiled", input: map[string]any{"capability": request.Capability}, output: map[string]any{"workflow": workflow}},
		{stepType: "node_selected", title: "Node selected", input: map[string]any{"capability": request.Capability, "preferred_node": request.PreferredNode}, output: map[string]any{"node_id": nodeID, "assignment_reason": reason}},
		{stepType: "task_dispatched", title: "Task dispatched to worker", input: map[string]any{"task_id": taskID, "allow_worker": request.AllowWorker}, output: map[string]any{"node_id": nodeID, "assignment_reason": reason, "task_attempts": 0}},
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
	run.Tasks, _ = a.listSQLiteRunTasks(ctx, runID)
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

func searchSQLiteMemoriesInTx(ctx context.Context, tx *sql.Tx, query string, limit int) ([]store.MemorySearchResult, error) {
	if limit <= 0 || limit > 20 {
		limit = 10
	}
	query = strings.TrimSpace(query)
	var rows *sql.Rows
	var err error
	if query == "" {
		rows, err = tx.QueryContext(ctx, `SELECT id, type, content, COALESCE(summary,''), scope_type, COALESCE(scope_id,''), privacy_level, confidence, status, source_event_ids, entities, success_count, failure_count, usage_count, positive_feedback, negative_feedback, pinned, disabled_at, COALESCE(merged_into_memory_id,''), COALESCE(conflict_group_id,''), COALESCE(conflict_reason,''), metadata, created_at, updated_at, last_used_at, 0.5 AS score FROM memories WHERE status IN ('confirmed','pending','conflicted') AND disabled_at IS NULL AND merged_into_memory_id IS NULL ORDER BY pinned DESC, confidence DESC, updated_at DESC LIMIT ?`, limit)
	} else {
		rows, err = tx.QueryContext(ctx, `SELECT m.id, m.type, m.content, COALESCE(m.summary,''), m.scope_type, COALESCE(m.scope_id,''), m.privacy_level, m.confidence, m.status, m.source_event_ids, m.entities, m.success_count, m.failure_count, m.usage_count, m.positive_feedback, m.negative_feedback, m.pinned, m.disabled_at, COALESCE(m.merged_into_memory_id,''), COALESCE(m.conflict_group_id,''), COALESCE(m.conflict_reason,''), m.metadata, m.created_at, m.updated_at, m.last_used_at, bm25(memory_fts) * -1 AS score FROM memory_fts JOIN memories m ON m.id = memory_fts.memory_id WHERE memory_fts MATCH ? AND m.status IN ('confirmed','pending','conflicted') AND m.disabled_at IS NULL AND m.merged_into_memory_id IS NULL ORDER BY m.pinned DESC, score DESC, m.confidence DESC LIMIT ?`, ftsQuery(query), limit)
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
	return results, rows.Err()
}

func recordSQLiteMemoryUsage(ctx context.Context, tx *sql.Tx, runID string, agentID string, results []store.MemorySearchResult) error {
	for _, result := range results {
		usageID, err := store.NewID("mulog_")
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO memory_usage_logs (id, memory_id, run_id, agent_id, retrieval_score, injected, used_in_answer, outcome, metadata) VALUES (?, ?, ?, ?, ?, 1, 0, 'retrieved', ?)`, usageID, result.Memory.ID, runID, agentID, result.Score, mustJSON(map[string]any{"reason": result.Reason, "source": "desktop_runtime"})); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE memories SET usage_count=usage_count+1, last_used_at=datetime('now'), updated_at=datetime('now') WHERE id=?`, result.Memory.ID); err != nil {
			return err
		}
	}
	return nil
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
	if strings.Contains(lower, "http://") || strings.Contains(lower, "https://") {
		return "research_agent"
	}
	if strings.Contains(message, "服务") || strings.Contains(message, "容器") || strings.Contains(message, "自检") || strings.Contains(message, "诊断") || strings.Contains(lower, "system health") || strings.Contains(lower, "docker") || strings.Contains(lower, "restart") || strings.Contains(lower, "cloudflared") || strings.Contains(lower, "unknown-service") {
		return "devops_agent"
	}
	if strings.Contains(message, "记忆") || strings.Contains(message, "记住") || strings.Contains(message, "偏好") || strings.Contains(message, "之前") {
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
- capability_request schema: {"output_type":"capability_request","capability":"memory_search|server_diagnose|web_research|system_health_check","goal":"...","inputs":{},"risk":"read_only","confidence":0.0}.
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
	if containsDesktopAny(normalized, "rm -rf", "docker restart", "docker stop", "docker rm", "chmod ", "chown ", " restart ", " stop ") {
		return desktopSafetyBlock{Policy: "rejected", Reason: "dangerous_state_change_or_destructive_command", Response: "rejected：这是危险或修改性操作。当前 Runtime 不会执行 restart、stop、rm、chmod、chown 等 state_change 操作。"}
	}
	if containsDesktopAny(normalized, ".env", "api key", "apikey", "secret key", "private key", "/etc/passwd", "/etc/shadow", "~/.ssh", "id_rsa") {
		return desktopSafetyBlock{Policy: "policy_blocked", Reason: "sensitive_secret_or_local_file_read", Response: "policy_blocked：请求涉及密钥、环境文件、SSH 私钥或敏感系统路径，已拒绝读取或打印。"}
	}
	if containsDesktopAny(normalized, "worker 读取完整 memory", "完整 memory", "full memory", "fake-node", "node_secret", "non whitelist telegram user", "non-whitelist telegram user") {
		return desktopSafetyBlock{Policy: "permission_denied", Reason: "unauthorized_worker_node_or_telegram_access", Response: "permission_denied：Worker、Node 和 Telegram 访问必须经过授权校验，且 Worker 不允许读取完整长期记忆。"}
	}
	if containsDesktopAny(normalized, "file://", "ftp://", "127.0.0.1", "localhost", "0.0.0.0", "169.254.169.254", "http://10.", "https://10.", "http://192.168.", "https://192.168.", "http://172.16.", "https://172.16.") {
		return desktopSafetyBlock{Policy: "policy_blocked", Reason: "blocked_url_scheme_or_private_network_target", Response: "policy_blocked：web_research 不允许访问 file://、ftp://、localhost、metadata IP 或私网地址。"}
	}
	return desktopSafetyBlock{}
}

func containsDesktopAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(value, needle) {
			return true
		}
	}
	return false
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
