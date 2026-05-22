package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/hao/agent-os/services/orchestrator-core/pkg/appcore"
	"github.com/hao/agent-os/services/orchestrator-core/pkg/runtimeconfig"
)

type DesktopApp struct {
	core         *appcore.AppCore
	lifecycle    *appcore.LifecycleManager
	logger       *slog.Logger
	startupError error
}

type DesktopChatRequest struct {
	ConversationID string `json:"conversation_id"`
	Channel        string `json:"channel"`
	UserID         string `json:"user_id"`
	Message        string `json:"message"`
	PreferredNode  string `json:"preferred_node"`
	AllowWorker    bool   `json:"allow_worker"`
}

type DesktopChatResponse struct {
	ConversationID     string             `json:"conversation_id"`
	UserMessageID      string             `json:"user_message_id"`
	AssistantMessageID string             `json:"assistant_message_id"`
	RunID              string             `json:"run_id"`
	SelectedAgentID    string             `json:"selected_agent_id"`
	Response           string             `json:"response"`
	Steps              []DesktopRunStep   `json:"steps"`
	ModelCalls         []DesktopModelCall `json:"model_calls"`
}

type DesktopRunTrace struct {
	ID                 string                     `json:"id"`
	ConversationID     string                     `json:"conversation_id"`
	UserMessageID      string                     `json:"user_message_id"`
	Status             string                     `json:"status"`
	SelectedAgentID    string                     `json:"selected_agent_id"`
	RouteResult        map[string]any             `json:"route_result"`
	Metadata           map[string]any             `json:"metadata"`
	PromptAssemblies   []DesktopPromptAssembly    `json:"prompt_assemblies"`
	ModelCalls         []DesktopModelCall         `json:"model_calls"`
	MemoryContextPacks []DesktopMemoryContextPack `json:"memory_context_packs"`
	Steps              []DesktopRunStep           `json:"steps"`
}

type DesktopRunStep struct {
	ID       string         `json:"id"`
	StepType string         `json:"step_type"`
	Title    string         `json:"title"`
	Status   string         `json:"status"`
	Input    map[string]any `json:"input,omitempty"`
	Output   map[string]any `json:"output,omitempty"`
	Error    map[string]any `json:"error,omitempty"`
}

type DesktopPromptAssembly struct {
	ID                   string         `json:"id"`
	AgentID              string         `json:"agent_id"`
	ModelID              string         `json:"model_id"`
	PrefixHash           string         `json:"prefix_hash"`
	DynamicTailHash      string         `json:"dynamic_tail_hash"`
	PromptCacheKey       string         `json:"prompt_cache_key"`
	MemoryProfileVersion string         `json:"memory_profile_version"`
	ToolSchemaVersion    string         `json:"tool_schema_version"`
	Metadata             map[string]any `json:"metadata"`
}

type DesktopModelCall struct {
	ID                    string         `json:"id"`
	Provider              string         `json:"provider"`
	ModelName             string         `json:"model_name"`
	Status                string         `json:"status"`
	InputTokens           int            `json:"input_tokens"`
	OutputTokens          int            `json:"output_tokens"`
	CachedInputTokens     int            `json:"cached_input_tokens"`
	CacheablePrefixTokens int            `json:"cacheable_prefix_tokens"`
	DynamicTailTokens     int            `json:"dynamic_tail_tokens"`
	LatencyMs             int            `json:"latency_ms"`
	PromptCacheKey        string         `json:"prompt_cache_key"`
	PrefixHash            string         `json:"prefix_hash"`
	DynamicTailHash       string         `json:"dynamic_tail_hash"`
	Metadata              map[string]any `json:"metadata"`
}

type DesktopMemoryContextPack struct {
	ID                   string         `json:"id"`
	AgentID              string         `json:"agent_id"`
	MemoryProfileVersion string         `json:"memory_profile_version"`
	Profile              []any          `json:"profile"`
	ProjectFacts         []any          `json:"project_facts"`
	RelevantEpisodes     []any          `json:"relevant_episodes"`
	Heuristics           []any          `json:"heuristics"`
	AntiPatterns         []any          `json:"anti_patterns"`
	OpenIssues           []any          `json:"open_issues"`
	DynamicRetrieval     []any          `json:"dynamic_retrieval"`
	Metadata             map[string]any `json:"metadata"`
}

type DesktopMemoryFilter struct {
	Query string `json:"query"`
	Limit int    `json:"limit"`
}

type DesktopMemoryListResponse struct {
	Memories []DesktopMemory `json:"memories"`
}

type DesktopMemory struct {
	ID               string         `json:"id"`
	Type             string         `json:"type"`
	Content          string         `json:"content"`
	Summary          string         `json:"summary"`
	Status           string         `json:"status"`
	Confidence       float64        `json:"confidence"`
	Pinned           bool           `json:"pinned"`
	Disabled         bool           `json:"disabled"`
	UsageCount       int            `json:"usage_count"`
	SuccessCount     int            `json:"success_count"`
	FailureCount     int            `json:"failure_count"`
	PositiveFeedback int            `json:"positive_feedback"`
	NegativeFeedback int            `json:"negative_feedback"`
	SourceEventIDs   []string       `json:"source_event_ids"`
	Entities         []any          `json:"entities"`
	MergedInto       string         `json:"merged_into_memory_id"`
	ConflictGroupID  string         `json:"conflict_group_id"`
	ConflictReason   string         `json:"conflict_reason"`
	Metadata         map[string]any `json:"metadata"`
}

type DesktopMemoryActionRequest struct {
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

type DesktopNodeListResponse struct {
	Nodes []DesktopNode `json:"nodes"`
}

type DesktopWorkerGatewayAuditResponse struct {
	Items []DesktopWorkerGatewayAuditRecord `json:"items"`
}

type DesktopWorkerGatewayAuditRecord struct {
	ID       string         `json:"id"`
	NodeID   string         `json:"node_id"`
	Action   string         `json:"action"`
	Status   string         `json:"status"`
	Reason   string         `json:"reason"`
	Metadata map[string]any `json:"metadata"`
}

type DesktopNode struct {
	ID                  string         `json:"id"`
	Name                string         `json:"name"`
	Role                string         `json:"role"`
	Status              string         `json:"status"`
	Capabilities        []any          `json:"capabilities"`
	AutoAssignEnabled   bool           `json:"auto_assign_enabled"`
	ManualAssignEnabled bool           `json:"manual_assign_enabled"`
	Metadata            map[string]any `json:"metadata"`
}

type DesktopSystemHealthResponse struct {
	ServiceStatus   map[string]any   `json:"service_status"`
	QueueStatus     map[string]any   `json:"queue_status"`
	WorkerStatus    []DesktopNode    `json:"worker_status"`
	ModelLatency    map[string]any   `json:"model_latency"`
	ToolFailureRate map[string]any   `json:"tool_failure_rate"`
	TokenCostToday  map[string]any   `json:"token_cost_today"`
	Warnings        []map[string]any `json:"warnings"`
}

type DesktopConfirmationListResponse struct {
	Items []DesktopConfirmation `json:"items"`
}

type DesktopConfirmation struct {
	ID              string         `json:"id"`
	RunID           string         `json:"run_id"`
	CapabilityID    string         `json:"capability_id"`
	RequestedAction string         `json:"requested_action"`
	RiskLevel       string         `json:"risk_level"`
	Status          string         `json:"status"`
	Input           map[string]any `json:"input"`
	ApprovedBy      string         `json:"approved_by"`
	RejectedBy      string         `json:"rejected_by"`
	DecisionReason  string         `json:"decision_reason"`
}

type DesktopConfirmationDecisionRequest struct {
	ID      string `json:"id"`
	Approve bool   `json:"approve"`
	Actor   string `json:"actor"`
	Reason  string `json:"reason"`
}

type DesktopModelUsageResponse struct {
	Items []map[string]any `json:"items"`
}

type DesktopBackupListResponse struct {
	Backups []appcore.BackupRecord `json:"backups"`
}

type DesktopBackupCreateResponse struct {
	Path string `json:"path"`
}

type DesktopDiagnosticsExportResponse struct {
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

type DesktopSecretRequest struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type DesktopSecretStatusResponse struct {
	Secrets map[string]bool `json:"secrets"`
}

type DesktopConnectionTestResponse struct {
	OK           bool   `json:"ok"`
	Status       string `json:"status"`
	ErrorSummary string `json:"error_summary"`
}

type DesktopWorkerTokenResponse struct {
	Token string `json:"token"`
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

type DesktopTelegramConfigRequest struct {
	Token          string `json:"token"`
	AllowedUserIDs string `json:"allowed_user_ids"`
	Enabled        bool   `json:"enabled"`
}

type DesktopTelegramTestMessageRequest struct {
	ChatID  string `json:"chat_id"`
	Message string `json:"message"`
}

type DesktopOnboardingStatusResponse struct {
	Required           bool     `json:"required"`
	Completed          bool     `json:"completed"`
	ModelConfigured    bool     `json:"model_configured"`
	TelegramConfigured bool     `json:"telegram_configured"`
	WorkerConfigured   bool     `json:"worker_configured"`
	FirstBackupCreated bool     `json:"first_backup_created"`
	BackupCount        int      `json:"backup_count"`
	Missing            []string `json:"missing"`
}

func NewDesktopApp() *DesktopApp {
	return &DesktopApp{logger: slog.New(slog.NewJSONHandler(os.Stdout, nil))}
}

func (a *DesktopApp) Startup(ctx context.Context) {
	loadKeychainSecrets()
	if os.Getenv("APP_MODE") == "" {
		_ = os.Setenv("APP_MODE", "desktop")
	}
	if os.Getenv("DATA_STORE") == "" {
		_ = os.Setenv("DATA_STORE", "sqlite")
	}
	if os.Getenv("TASK_QUEUE_DRIVER") == "" {
		_ = os.Setenv("TASK_QUEUE_DRIVER", "sqlite")
	}
	cfg := runtimeconfig.Load()
	runtimeconfig.LogCheck(a.logger, cfg)
	lifecycle := appcore.NewLifecycleManager(cfg, a.logger)
	if err := lifecycle.Start(ctx); err != nil {
		a.startupError = err
		return
	}
	a.lifecycle = lifecycle
	a.core = lifecycle.Core
}

func (a *DesktopApp) Shutdown(ctx context.Context) {
	if a.lifecycle != nil {
		_ = a.lifecycle.Shutdown(ctx)
	}
}

func (a *DesktopApp) SendChat(req DesktopChatRequest) (*DesktopChatResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.SendChat(context.Background(), appcore.ChatRequest{
		ConversationID: req.ConversationID,
		Channel:        req.Channel,
		UserID:         req.UserID,
		Message:        req.Message,
		PreferredNode:  req.PreferredNode,
		AllowWorker:    req.AllowWorker,
	})
	if err != nil {
		return nil, err
	}
	trace, _ := a.core.GetRunTrace(context.Background(), result.RunID)
	response := &DesktopChatResponse{
		ConversationID:     result.ConversationID,
		UserMessageID:      result.UserMessageID,
		AssistantMessageID: result.AssistantMessageID,
		RunID:              result.RunID,
		SelectedAgentID:    result.SelectedAgentID,
		Response:           result.Response,
		Steps:              make([]DesktopRunStep, 0, len(result.Steps)),
	}
	for _, step := range result.Steps {
		response.Steps = append(response.Steps, DesktopRunStep{ID: step.ID, StepType: step.StepType, Title: step.Title, Status: step.Status})
	}
	if trace != nil {
		response.ModelCalls = convertModelCalls(trace.ModelCalls)
	}
	return response, nil
}

func (a *DesktopApp) GetRunTrace(runID string) (*DesktopRunTrace, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	trace, err := a.core.GetRunTrace(context.Background(), runID)
	if err != nil {
		return nil, err
	}
	return convertRunTrace(trace), nil
}

func (a *DesktopApp) ListMemories(filter DesktopMemoryFilter) (*DesktopMemoryListResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.ListMemories(context.Background(), appcore.MemoryFilter{Query: filter.Query, Limit: filter.Limit})
	if err != nil {
		return nil, err
	}
	memories := make([]DesktopMemory, 0, len(result.Memories))
	for _, memory := range result.Memories {
		memories = append(memories, DesktopMemory{ID: memory.ID, Type: memory.Type, Content: memory.Content, Summary: memory.Summary, Status: memory.Status, Confidence: memory.Confidence, Pinned: memory.Pinned, Disabled: memory.DisabledAt != nil, UsageCount: memory.UsageCount, SuccessCount: memory.SuccessCount, FailureCount: memory.FailureCount, PositiveFeedback: memory.PositiveFeedback, NegativeFeedback: memory.NegativeFeedback, SourceEventIDs: memory.SourceEventIDs, Entities: memory.Entities, MergedInto: memory.MergedIntoMemoryID, ConflictGroupID: memory.ConflictGroupID, ConflictReason: memory.ConflictReason, Metadata: memory.Metadata})
	}
	return &DesktopMemoryListResponse{Memories: memories}, nil
}

func (a *DesktopApp) UpdateMemory(req DesktopMemoryActionRequest) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.core.UpdateMemory(context.Background(), appcore.MemoryActionRequest{ID: req.ID, Action: req.Action, Feedback: req.Feedback, Comment: req.Comment, TargetID: req.TargetID, Reason: req.Reason, Content: req.Content, Summary: req.Summary, ScopeType: req.ScopeType})
}

func (a *DesktopApp) ListNodes() (*DesktopNodeListResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.ListNodes(context.Background())
	if err != nil {
		return nil, err
	}
	return &DesktopNodeListResponse{Nodes: convertNodes(result.Nodes)}, nil
}

func (a *DesktopApp) DisableNode(nodeID string) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.core.DisableNode(context.Background(), nodeID)
}

func (a *DesktopApp) EnableNode(nodeID string) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.core.EnableNode(context.Background(), nodeID)
}

func (a *DesktopApp) ListWorkerGatewayAuditLogs() (*DesktopWorkerGatewayAuditResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.ListWorkerGatewayAuditLogs(context.Background(), 50)
	if err != nil {
		return nil, err
	}
	items := make([]DesktopWorkerGatewayAuditRecord, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, DesktopWorkerGatewayAuditRecord{ID: item.ID, NodeID: item.NodeID, Action: item.Action, Status: item.Status, Reason: item.Reason, Metadata: item.Metadata})
	}
	return &DesktopWorkerGatewayAuditResponse{Items: items}, nil
}

func (a *DesktopApp) GetSystemHealth() (*DesktopSystemHealthResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	health, err := a.core.GetSystemHealth(context.Background())
	if err != nil {
		return nil, err
	}
	return &DesktopSystemHealthResponse{
		ServiceStatus:   health.ServiceStatus,
		QueueStatus:     health.QueueStatus,
		WorkerStatus:    convertNodes(health.WorkerStatus),
		ModelLatency:    health.ModelLatency,
		ToolFailureRate: health.ToolFailureRate,
		TokenCostToday:  health.TokenCostToday,
		Warnings:        health.Warnings,
	}, nil
}

func (a *DesktopApp) ListConfirmations() (*DesktopConfirmationListResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.ListConfirmations(context.Background())
	if err != nil {
		return nil, err
	}
	items := make([]DesktopConfirmation, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, DesktopConfirmation{ID: item.ID, RunID: item.RunID, CapabilityID: item.CapabilityID, RequestedAction: item.RequestedAction, RiskLevel: item.RiskLevel, Status: item.Status, Input: item.Input, ApprovedBy: item.ApprovedBy, RejectedBy: item.RejectedBy, DecisionReason: item.DecisionReason})
	}
	return &DesktopConfirmationListResponse{Items: items}, nil
}

func (a *DesktopApp) DecideConfirmation(req DesktopConfirmationDecisionRequest) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.core.DecideConfirmation(context.Background(), appcore.ConfirmationDecisionRequest{ID: req.ID, Approve: req.Approve, Actor: req.Actor, Reason: req.Reason})
}

func (a *DesktopApp) GetModelUsage() (*DesktopModelUsageResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.ModelUsageSummary(context.Background())
	if err != nil {
		return nil, err
	}
	return &DesktopModelUsageResponse{Items: result.Items}, nil
}

func (a *DesktopApp) ListBackups() (*DesktopBackupListResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.ListBackups(context.Background())
	if err != nil {
		return nil, err
	}
	return &DesktopBackupListResponse{Backups: result.Backups}, nil
}

func (a *DesktopApp) CreateBackup() (*DesktopBackupCreateResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.CreateBackup(context.Background())
	if err != nil {
		return nil, err
	}
	return &DesktopBackupCreateResponse{Path: result.Path}, nil
}

func (a *DesktopApp) RestoreBackup(path string) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.core.RestoreBackup(context.Background(), path)
}

func (a *DesktopApp) ExportDiagnostics() (*DesktopDiagnosticsExportResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.ExportDiagnostics(context.Background())
	if err != nil {
		return nil, err
	}
	return &DesktopDiagnosticsExportResponse{Path: result.Path}, nil
}

func (a *DesktopApp) GetSettings() (*DesktopSettingsResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	settings, err := a.core.GetDesktopSettings(context.Background())
	if err != nil {
		return nil, err
	}
	return &DesktopSettingsResponse{Version: settings.Version, AppMode: settings.AppMode, DataStore: settings.DataStore, TaskQueue: settings.TaskQueue, SQLitePath: settings.SQLitePath, LogDir: settings.LogDir, ModelProvider: settings.ModelProvider, ModelName: settings.ModelName, ModelBaseURL: settings.ModelBaseURL, TelegramEnabled: settings.TelegramEnabled, TelegramAllowedUserIDs: settings.TelegramAllowedUserIDs, WorkerGateway: settings.WorkerGateway, WorkerGatewayEnabled: settings.WorkerGatewayEnabled, BackupDir: settings.BackupDir, AutoBackupEnabled: settings.AutoBackupEnabled, DockerRequired: settings.DockerRequired}, nil
}

func (a *DesktopApp) SaveModelConfig(req DesktopModelConfigRequest) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.core.SaveDesktopModelConfig(context.Background(), appcore.DesktopModelConfigRequest{
		Provider:       req.Provider,
		BaseURL:        req.BaseURL,
		Name:           req.Name,
		TimeoutSeconds: req.TimeoutSeconds,
		MaxRetries:     req.MaxRetries,
	})
}

func (a *DesktopApp) SaveOperationalSettings(req DesktopOperationalSettingsRequest) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.core.SaveDesktopOperationalSettings(context.Background(), appcore.DesktopOperationalSettingsRequest{TelegramEnabled: req.TelegramEnabled, TelegramAllowedUserIDs: req.TelegramAllowedUserIDs, WorkerGatewayEnabled: req.WorkerGatewayEnabled, BackupDir: req.BackupDir, AutoBackupEnabled: req.AutoBackupEnabled})
}

func (a *DesktopApp) SaveTelegramConfig(req DesktopTelegramConfigRequest) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	if strings.TrimSpace(req.Token) != "" {
		if err := keychainSet("TELEGRAM_BOT_TOKEN", strings.TrimSpace(req.Token)); err != nil {
			return err
		}
		_ = os.Setenv("TELEGRAM_BOT_TOKEN", strings.TrimSpace(req.Token))
	}
	settings, _ := a.core.GetDesktopSettings(context.Background())
	return a.core.SaveDesktopOperationalSettings(context.Background(), appcore.DesktopOperationalSettingsRequest{TelegramEnabled: req.Enabled, TelegramAllowedUserIDs: req.AllowedUserIDs, WorkerGatewayEnabled: settings == nil || settings.WorkerGatewayEnabled, BackupDir: valueOrDefault(settingsValue(settings, "backup_dir"), ""), AutoBackupEnabled: settings != nil && settings.AutoBackupEnabled})
}

func (a *DesktopApp) GetOnboardingStatus() (*DesktopOnboardingStatusResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	coreStatus, err := a.core.GetOnboardingCoreStatus(context.Background())
	if err != nil {
		return nil, err
	}
	settings, err := a.core.GetDesktopSettings(context.Background())
	if err != nil {
		return nil, err
	}
	secrets, err := a.GetSecretStatus()
	if err != nil {
		return nil, err
	}
	modelConfigured := settings.ModelProvider != "" && settings.ModelProvider != "mock_provider" && settings.ModelName != "" && settings.ModelBaseURL != "" && secrets.Secrets["MODEL_API_KEY"]
	telegramConfigured := secrets.Secrets["TELEGRAM_BOT_TOKEN"]
	workerConfigured := secrets.Secrets["WORKER_TOKEN"]
	missing := []string{}
	if !modelConfigured {
		missing = append(missing, "model_provider_or_api_key")
	}
	if !coreStatus.FirstBackupCreated {
		missing = append(missing, "first_backup")
	}
	return &DesktopOnboardingStatusResponse{
		Required:           !coreStatus.Completed || !modelConfigured || !coreStatus.FirstBackupCreated,
		Completed:          coreStatus.Completed,
		ModelConfigured:    modelConfigured,
		TelegramConfigured: telegramConfigured,
		WorkerConfigured:   workerConfigured,
		FirstBackupCreated: coreStatus.FirstBackupCreated,
		BackupCount:        coreStatus.BackupCount,
		Missing:            missing,
	}, nil
}

func (a *DesktopApp) CompleteOnboarding() error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.core.CompleteOnboarding(context.Background())
}

func (a *DesktopApp) GetSecretStatus() (*DesktopSecretStatusResponse, error) {
	status := map[string]bool{}
	for _, name := range desktopSecretNames() {
		value := os.Getenv(name)
		if value == "" {
			value, _ = keychainGet(name)
		}
		status[name] = value != ""
	}
	return &DesktopSecretStatusResponse{Secrets: status}, nil
}

func (a *DesktopApp) SaveSecret(req DesktopSecretRequest) error {
	if !allowedDesktopSecret(req.Name) {
		return errors.New("unsupported secret name")
	}
	if strings.TrimSpace(req.Value) == "" {
		return errors.New("secret value is required")
	}
	if err := keychainSet(req.Name, req.Value); err != nil {
		return err
	}
	return os.Setenv(req.Name, req.Value)
}

func (a *DesktopApp) TestModelConnection() (*DesktopConnectionTestResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.SendChat(context.Background(), appcore.ChatRequest{Channel: "desktop_settings", UserID: "desktop_settings", Message: "model connection smoke test"})
	if err != nil {
		return &DesktopConnectionTestResponse{OK: false, Status: "failed", ErrorSummary: err.Error()}, nil
	}
	trace, _ := a.core.GetRunTrace(context.Background(), result.RunID)
	status := "succeeded"
	realModel := false
	fallbackToMock := false
	if trace != nil && len(trace.ModelCalls) > 0 {
		call := trace.ModelCalls[len(trace.ModelCalls)-1]
		status = call.Status
		if value, ok := call.Metadata["real_model"].(bool); ok {
			realModel = value
		}
		if value, ok := call.Metadata["fallback_to_mock"].(bool); ok {
			fallbackToMock = value
		}
	}
	if status != "succeeded" || !realModel || fallbackToMock {
		return &DesktopConnectionTestResponse{OK: false, Status: status, ErrorSummary: "model call did not complete with real_model=true and fallback_to_mock=false"}, nil
	}
	return &DesktopConnectionTestResponse{OK: true, Status: status}, nil
}

func (a *DesktopApp) TestTelegramConnection() (*DesktopConnectionTestResponse, error) {
	token := os.Getenv("TELEGRAM_BOT_TOKEN")
	if token == "" {
		token, _ = keychainGet("TELEGRAM_BOT_TOKEN")
	}
	if token == "" {
		return &DesktopConnectionTestResponse{OK: false, Status: "missing_token", ErrorSummary: "TELEGRAM_BOT_TOKEN is not configured"}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.telegram.org/bot"+token+"/getMe", nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return &DesktopConnectionTestResponse{OK: false, Status: "failed", ErrorSummary: err.Error()}, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &DesktopConnectionTestResponse{OK: false, Status: resp.Status, ErrorSummary: "telegram getMe returned non-2xx"}, nil
	}
	return &DesktopConnectionTestResponse{OK: true, Status: "succeeded"}, nil
}

func (a *DesktopApp) SendTestTelegramMessage(req DesktopTelegramTestMessageRequest) (*DesktopConnectionTestResponse, error) {
	token := os.Getenv("TELEGRAM_BOT_TOKEN")
	if token == "" {
		token, _ = keychainGet("TELEGRAM_BOT_TOKEN")
	}
	if token == "" {
		return &DesktopConnectionTestResponse{OK: false, Status: "missing_token", ErrorSummary: "TELEGRAM_BOT_TOKEN is not configured"}, nil
	}
	chatID := strings.TrimSpace(req.ChatID)
	if chatID == "" {
		settings, _ := a.core.GetDesktopSettings(context.Background())
		if settings != nil {
			chatID = firstCSV(settings.TelegramAllowedUserIDs)
		}
	}
	if chatID == "" {
		return &DesktopConnectionTestResponse{OK: false, Status: "missing_chat_id", ErrorSummary: "No Telegram chat ID or allowed user ID configured"}, nil
	}
	message := valueOrDefault(req.Message, "Joi Desktop Telegram test")
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	body := strings.NewReader("chat_id=" + url.QueryEscape(chatID) + "&text=" + url.QueryEscape(message))
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+token+"/sendMessage", body)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return &DesktopConnectionTestResponse{OK: false, Status: "failed", ErrorSummary: err.Error()}, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &DesktopConnectionTestResponse{OK: false, Status: resp.Status, ErrorSummary: "telegram sendMessage returned non-2xx"}, nil
	}
	return &DesktopConnectionTestResponse{OK: true, Status: "succeeded"}, nil
}

func (a *DesktopApp) GenerateWorkerToken() (*DesktopWorkerTokenResponse, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	token := "joi_worker_" + hex.EncodeToString(raw)
	if err := keychainSet("WORKER_TOKEN", token); err != nil {
		return nil, err
	}
	_ = os.Setenv("WORKER_TOKEN", token)
	return &DesktopWorkerTokenResponse{Token: token}, nil
}

func (a *DesktopApp) ensureReady() error {
	if a.startupError != nil {
		return a.startupError
	}
	if a.core == nil {
		return errors.New("desktop app core is not initialized")
	}
	return nil
}

func convertRunTrace(trace *appcore.RunTrace) *DesktopRunTrace {
	result := &DesktopRunTrace{
		ID:                 trace.ID,
		ConversationID:     trace.ConversationID,
		UserMessageID:      trace.UserMessageID,
		Status:             trace.Status,
		SelectedAgentID:    trace.SelectedAgentID,
		RouteResult:        trace.RouteResult,
		Metadata:           trace.Metadata,
		PromptAssemblies:   make([]DesktopPromptAssembly, 0, len(trace.PromptAssemblies)),
		ModelCalls:         convertModelCalls(trace.ModelCalls),
		MemoryContextPacks: make([]DesktopMemoryContextPack, 0, len(trace.MemoryContextPacks)),
		Steps:              make([]DesktopRunStep, 0, len(trace.Steps)),
	}
	for _, assembly := range trace.PromptAssemblies {
		result.PromptAssemblies = append(result.PromptAssemblies, DesktopPromptAssembly{ID: assembly.ID, AgentID: assembly.AgentID, ModelID: assembly.ModelID, PrefixHash: assembly.PrefixHash, DynamicTailHash: assembly.DynamicTailHash, PromptCacheKey: assembly.PromptCacheKey, MemoryProfileVersion: assembly.MemoryProfileVersion, ToolSchemaVersion: assembly.ToolSchemaVersion, Metadata: assembly.Metadata})
	}
	for _, pack := range trace.MemoryContextPacks {
		result.MemoryContextPacks = append(result.MemoryContextPacks, DesktopMemoryContextPack{ID: pack.ID, AgentID: pack.AgentID, MemoryProfileVersion: pack.MemoryProfileVersion, Profile: pack.Profile, ProjectFacts: pack.ProjectFacts, RelevantEpisodes: pack.RelevantEpisodes, Heuristics: pack.Heuristics, AntiPatterns: pack.AntiPatterns, OpenIssues: pack.OpenIssues, DynamicRetrieval: pack.DynamicRetrieval, Metadata: pack.Metadata})
	}
	for _, step := range trace.Steps {
		result.Steps = append(result.Steps, DesktopRunStep{ID: step.ID, StepType: step.StepType, Title: step.Title, Status: step.Status, Input: step.Input, Output: step.Output, Error: step.Error})
	}
	return result
}

func convertModelCalls(calls []appcore.ModelCallRecord) []DesktopModelCall {
	result := make([]DesktopModelCall, 0, len(calls))
	for _, call := range calls {
		result = append(result, DesktopModelCall{ID: call.ID, Provider: call.Provider, ModelName: call.ModelName, Status: call.Status, InputTokens: call.InputTokens, OutputTokens: call.OutputTokens, CachedInputTokens: call.CachedInputTokens, CacheablePrefixTokens: call.CacheablePrefixTokens, DynamicTailTokens: call.DynamicTailTokens, LatencyMs: call.LatencyMs, PromptCacheKey: call.PromptCacheKey, PrefixHash: call.PrefixHash, DynamicTailHash: call.DynamicTailHash, Metadata: call.Metadata})
	}
	return result
}

func convertNodes(nodes []appcore.NodeRecord) []DesktopNode {
	result := make([]DesktopNode, 0, len(nodes))
	for _, node := range nodes {
		result = append(result, DesktopNode{ID: node.ID, Name: node.Name, Role: node.Role, Status: node.Status, Capabilities: node.Capabilities, AutoAssignEnabled: node.AutoAssignEnabled, ManualAssignEnabled: node.ManualAssignEnabled, Metadata: node.Metadata})
	}
	return result
}

const keychainService = "Joi Desktop"

func desktopSecretNames() []string {
	return []string{"MODEL_API_KEY", "TELEGRAM_BOT_TOKEN", "WORKER_TOKEN", "NODE_SECRET", "ADMIN_TOKEN"}
}

func allowedDesktopSecret(name string) bool {
	for _, allowed := range desktopSecretNames() {
		if name == allowed {
			return true
		}
	}
	return false
}

func loadKeychainSecrets() {
	for _, name := range desktopSecretNames() {
		if os.Getenv(name) != "" {
			continue
		}
		value, ok := keychainGet(name)
		if ok && value != "" {
			_ = os.Setenv(name, value)
		}
	}
}

func keychainSet(account string, value string) error {
	return exec.Command("security", "add-generic-password", "-a", account, "-s", keychainService, "-w", value, "-U").Run()
}

func keychainGet(account string) (string, bool) {
	output, err := exec.Command("security", "find-generic-password", "-a", account, "-s", keychainService, "-w").Output()
	if err != nil {
		return "", false
	}
	return strings.TrimSpace(string(output)), true
}

func settingsValue(settings *appcore.DesktopSettingsResponse, key string) string {
	if settings == nil {
		return ""
	}
	switch key {
	case "backup_dir":
		return settings.BackupDir
	default:
		return ""
	}
}

func firstCSV(value string) string {
	for _, item := range strings.Split(value, ",") {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func valueOrDefault(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
