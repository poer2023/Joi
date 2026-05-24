package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strconv"
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
	InputMode      string `json:"input_mode"`
	ProductTaskID  string `json:"product_task_id"`
}

type DesktopChatResponse struct {
	ConversationID      string                    `json:"conversation_id"`
	UserMessageID       string                    `json:"user_message_id"`
	AssistantMessageID  string                    `json:"assistant_message_id"`
	RunID               string                    `json:"run_id"`
	SelectedAgentID     string                    `json:"selected_agent_id"`
	Response            string                    `json:"response"`
	Steps               []DesktopRunStep          `json:"steps"`
	ModelCalls          []DesktopModelCall        `json:"model_calls"`
	ProductTask         *DesktopProductTask       `json:"product_task,omitempty"`
	Artifacts           []DesktopArtifactSummary  `json:"artifacts,omitempty"`
	ProactiveCandidates []DesktopProactiveMessage `json:"proactive_candidates,omitempty"`
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

type DesktopConversationListResponse struct {
	Conversations []DesktopConversationSummary `json:"conversations"`
}

type DesktopConversationDetailResponse struct {
	Conversation DesktopConversationSummary   `json:"conversation"`
	Messages     []DesktopConversationMessage `json:"messages"`
}

type DesktopCapabilityListResponse struct {
	Capabilities []DesktopCapabilityRecord `json:"capabilities"`
}

type DesktopToolWorkflowListResponse struct {
	Workflows []DesktopToolWorkflowRecord `json:"workflows"`
}

type DesktopToolRunListResponse struct {
	ToolRuns []DesktopToolRunRecord `json:"tool_runs"`
}

type DesktopToolWorkflowEnabledRequest struct {
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
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

type DesktopProductTaskFilter struct {
	Status string `json:"status"`
	Limit  int    `json:"limit"`
}

type DesktopArtifactFilter struct {
	ProductTaskID string `json:"product_task_id"`
	Type          string `json:"type"`
	Limit         int    `json:"limit"`
}

type DesktopOpenLoopFilter struct {
	Status string `json:"status"`
	Limit  int    `json:"limit"`
}

type DesktopProactiveMessageFilter struct {
	Status string `json:"status"`
	Limit  int    `json:"limit"`
}

type DesktopProactiveDecisionRequest struct {
	ID       string `json:"id"`
	Action   string `json:"action"`
	Feedback string `json:"feedback"`
}

type DesktopConversationSummary struct {
	ID            string         `json:"id"`
	Channel       string         `json:"channel"`
	UserID        string         `json:"user_id"`
	Title         string         `json:"title"`
	ActiveAgentID string         `json:"active_agent_id"`
	Topic         string         `json:"topic"`
	LastMessage   string         `json:"last_message"`
	LastRole      string         `json:"last_role"`
	LatestRunID   string         `json:"latest_run_id"`
	MessageCount  int            `json:"message_count"`
	Metadata      map[string]any `json:"metadata"`
	CreatedAt     string         `json:"created_at,omitempty"`
	UpdatedAt     string         `json:"updated_at,omitempty"`
}

type DesktopConversationMessage struct {
	ID             string         `json:"id"`
	ConversationID string         `json:"conversation_id"`
	Role           string         `json:"role"`
	Content        string         `json:"content"`
	RunID          string         `json:"run_id"`
	Attachments    []any          `json:"attachments"`
	Metadata       map[string]any `json:"metadata"`
	CreatedAt      string         `json:"created_at,omitempty"`
}

type DesktopCapabilityRecord struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	RiskLevel   string         `json:"risk_level"`
	Enabled     bool           `json:"enabled"`
	Metadata    map[string]any `json:"metadata"`
}

type DesktopToolWorkflowStep struct {
	Tool      string         `json:"tool"`
	Args      map[string]any `json:"args,omitempty"`
	RiskLevel string         `json:"risk_level"`
}

type DesktopToolWorkflowRecord struct {
	ID           string                    `json:"id"`
	CapabilityID string                    `json:"capability_id"`
	Name         string                    `json:"name"`
	Version      string                    `json:"version"`
	RiskLevel    string                    `json:"risk_level"`
	Steps        []DesktopToolWorkflowStep `json:"steps"`
	Enabled      bool                      `json:"enabled"`
	Metadata     map[string]any            `json:"metadata"`
	CreatedAt    string                    `json:"created_at,omitempty"`
	UpdatedAt    string                    `json:"updated_at,omitempty"`
}

type DesktopToolRunRecord struct {
	ID               string         `json:"id"`
	RunID            string         `json:"run_id,omitempty"`
	TaskID           string         `json:"task_id,omitempty"`
	CapabilityID     string         `json:"capability_id,omitempty"`
	WorkflowName     string         `json:"workflow_name,omitempty"`
	ToolID           string         `json:"tool_id,omitempty"`
	ToolName         string         `json:"tool_name"`
	NodeID           string         `json:"node_id,omitempty"`
	AssignmentReason string         `json:"assignment_reason,omitempty"`
	RiskLevel        string         `json:"risk_level"`
	Status           string         `json:"status"`
	Input            map[string]any `json:"input,omitempty"`
	Output           map[string]any `json:"output,omitempty"`
	Error            map[string]any `json:"error,omitempty"`
	StartedAt        string         `json:"started_at,omitempty"`
	FinishedAt       string         `json:"finished_at,omitempty"`
	DurationMs       *int           `json:"duration_ms,omitempty"`
	CreatedAt        string         `json:"created_at,omitempty"`
}

type DesktopProductTaskListResponse struct {
	Tasks []DesktopProductTask `json:"tasks"`
}

type DesktopProductTask struct {
	ID                        string         `json:"id"`
	Title                     string         `json:"title"`
	Description               string         `json:"description"`
	Status                    string         `json:"status"`
	Mode                      string         `json:"mode"`
	Priority                  string         `json:"priority"`
	CreatedFromConversationID string         `json:"created_from_conversation_id,omitempty"`
	CreatedFromMessageID      string         `json:"created_from_message_id,omitempty"`
	LatestRunID               string         `json:"latest_run_id,omitempty"`
	OwnerUserID               string         `json:"owner_user_id,omitempty"`
	SourceChannel             string         `json:"source_channel,omitempty"`
	RiskLevel                 string         `json:"risk_level"`
	ProgressPercent           int            `json:"progress_percent"`
	CurrentStepID             string         `json:"current_step_id,omitempty"`
	Summary                   string         `json:"summary,omitempty"`
	Metadata                  map[string]any `json:"metadata,omitempty"`
	CreatedAt                 string         `json:"created_at,omitempty"`
	UpdatedAt                 string         `json:"updated_at,omitempty"`
	CompletedAt               string         `json:"completed_at,omitempty"`
}

type DesktopProductTaskStep struct {
	ID             string         `json:"id"`
	ProductTaskID  string         `json:"product_task_id"`
	Title          string         `json:"title"`
	Description    string         `json:"description,omitempty"`
	Status         string         `json:"status"`
	SortOrder      int            `json:"sort_order"`
	CapabilityID   string         `json:"capability_id,omitempty"`
	ToolWorkflowID string         `json:"tool_workflow_id,omitempty"`
	RunID          string         `json:"run_id,omitempty"`
	ToolRunID      string         `json:"tool_run_id,omitempty"`
	WorkerTaskID   string         `json:"worker_task_id,omitempty"`
	Summary        string         `json:"summary,omitempty"`
	Input          map[string]any `json:"input,omitempty"`
	Output         map[string]any `json:"output,omitempty"`
	Error          map[string]any `json:"error,omitempty"`
	StartedAt      string         `json:"started_at,omitempty"`
	FinishedAt     string         `json:"finished_at,omitempty"`
	CreatedAt      string         `json:"created_at,omitempty"`
	UpdatedAt      string         `json:"updated_at,omitempty"`
}

type DesktopProductTaskDetail struct {
	Task         DesktopProductTask       `json:"task"`
	Steps        []DesktopProductTaskStep `json:"steps"`
	Deliverables []DesktopArtifactSummary `json:"deliverables"`
}

type DesktopArtifactListResponse struct {
	Artifacts []DesktopArtifactSummary `json:"artifacts"`
}

type DesktopArtifactSummary struct {
	ID                   string         `json:"id"`
	Type                 string         `json:"type"`
	Title                string         `json:"title"`
	ContentFormat        string         `json:"content_format"`
	SourceProductTaskID  string         `json:"source_product_task_id,omitempty"`
	SourceRunID          string         `json:"source_run_id,omitempty"`
	SourceConversationID string         `json:"source_conversation_id,omitempty"`
	SourceMessageID      string         `json:"source_message_id,omitempty"`
	Version              int            `json:"version"`
	Status               string         `json:"status"`
	Metadata             map[string]any `json:"metadata,omitempty"`
	CreatedAt            string         `json:"created_at,omitempty"`
	UpdatedAt            string         `json:"updated_at,omitempty"`
}

type DesktopArtifactDetail struct {
	DesktopArtifactSummary
	Content         string   `json:"content"`
	LinkedMemoryIDs []string `json:"linked_memory_ids,omitempty"`
}

type DesktopOpenLoopListResponse struct {
	OpenLoops []DesktopOpenLoop `json:"open_loops"`
}

type DesktopOpenLoop struct {
	ID                   string         `json:"id"`
	Topic                string         `json:"topic"`
	Description          string         `json:"description,omitempty"`
	Status               string         `json:"status"`
	SourceConversationID string         `json:"source_conversation_id,omitempty"`
	SourceRunID          string         `json:"source_run_id,omitempty"`
	SourceProductTaskID  string         `json:"source_product_task_id,omitempty"`
	SuggestedFollowup    string         `json:"suggested_followup,omitempty"`
	Priority             string         `json:"priority"`
	DueAt                string         `json:"due_at,omitempty"`
	Metadata             map[string]any `json:"metadata,omitempty"`
	CreatedAt            string         `json:"created_at,omitempty"`
	UpdatedAt            string         `json:"updated_at,omitempty"`
	ClosedAt             string         `json:"closed_at,omitempty"`
}

type DesktopProactiveMessageListResponse struct {
	Messages []DesktopProactiveMessage `json:"messages"`
}

type DesktopProactiveMessage struct {
	ID                  string         `json:"id"`
	Type                string         `json:"type"`
	Title               string         `json:"title"`
	Body                string         `json:"body"`
	Reason              string         `json:"reason"`
	SourceMemoryIDs     []string       `json:"source_memory_ids,omitempty"`
	SourceOpenLoopID    string         `json:"source_open_loop_id,omitempty"`
	SourceProductTaskID string         `json:"source_product_task_id,omitempty"`
	Score               float64        `json:"score"`
	Status              string         `json:"status"`
	Channel             string         `json:"channel"`
	SendAfter           string         `json:"send_after,omitempty"`
	ExpiresAt           string         `json:"expires_at,omitempty"`
	Feedback            string         `json:"feedback,omitempty"`
	Metadata            map[string]any `json:"metadata,omitempty"`
	CreatedAt           string         `json:"created_at,omitempty"`
	UpdatedAt           string         `json:"updated_at,omitempty"`
	SentAt              string         `json:"sent_at,omitempty"`
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
	RunID     string `json:"run_id"`
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
	OK              bool                    `json:"ok"`
	Status          string                  `json:"status"`
	ErrorSummary    string                  `json:"error_summary"`
	AvailableModels []DesktopAvailableModel `json:"available_models"`
}

type DesktopAvailableModel struct {
	ID                string                    `json:"id"`
	DisplayName       string                    `json:"display_name"`
	Owner             string                    `json:"owner"`
	Object            string                    `json:"object"`
	Created           string                    `json:"created"`
	ContextWindow     int                       `json:"context_window"`
	MaxOutputTokens   int                       `json:"max_output_tokens"`
	InputPricePer1M   float64                   `json:"input_price_per_1m"`
	OutputPricePer1M  float64                   `json:"output_price_per_1m"`
	SupportsJSONMode  bool                      `json:"supports_json_mode"`
	SupportsToolCalls bool                      `json:"supports_tool_calling"`
	SupportsReasoning bool                      `json:"supports_reasoning"`
	SupportedParams   []string                  `json:"supported_parameters"`
	Config            DesktopModelRuntimeConfig `json:"config"`
	Metadata          map[string]any            `json:"metadata"`
}

type DesktopModelRuntimeConfig struct {
	Role              string  `json:"role"`
	Enabled           bool    `json:"enabled"`
	Temperature       float64 `json:"temperature"`
	MaxOutputTokens   int     `json:"max_output_tokens"`
	TimeoutSeconds    int     `json:"timeout_seconds"`
	MaxRetries        int     `json:"max_retries"`
	SupportsJSONMode  bool    `json:"supports_json_mode"`
	SupportsToolCalls bool    `json:"supports_tool_calling"`
	SupportsReasoning bool    `json:"supports_reasoning"`
}

type DesktopModelConnectionTestRequest struct {
	Provider       string `json:"provider"`
	BaseURL        string `json:"base_url"`
	Name           string `json:"name"`
	APIKey         string `json:"api_key"`
	TimeoutSeconds int    `json:"timeout_seconds"`
}

type DesktopModelSettingsRequest struct {
	Provider          string  `json:"provider"`
	BaseURL           string  `json:"base_url"`
	ModelID           string  `json:"model_id"`
	DisplayName       string  `json:"display_name"`
	Role              string  `json:"role"`
	Enabled           bool    `json:"enabled"`
	Temperature       float64 `json:"temperature"`
	MaxOutputTokens   int     `json:"max_output_tokens"`
	TimeoutSeconds    int     `json:"timeout_seconds"`
	MaxRetries        int     `json:"max_retries"`
	SupportsJSONMode  bool    `json:"supports_json_mode"`
	SupportsToolCalls bool    `json:"supports_tool_calling"`
	SupportsReasoning bool    `json:"supports_reasoning"`
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

type DesktopWorkspaceSettings struct {
	AllowedRoots                 []string `json:"allowed_roots"`
	DefaultRoot                  string   `json:"default_root"`
	BrowserAllowedHosts          []string `json:"browser_allowed_hosts"`
	WebResearchAllowPrivateHosts bool     `json:"web_research_allow_private_hosts"`
	FileAnalyzeMaxBytes          int      `json:"file_analyze_max_bytes"`
	WorkspaceSearchMaxResults    int      `json:"workspace_search_max_results"`
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
		InputMode:      req.InputMode,
		ProductTaskID:  req.ProductTaskID,
	})
	if err != nil {
		return nil, err
	}
	trace, _ := a.core.GetRunTrace(context.Background(), result.RunID)
	response := &DesktopChatResponse{
		ConversationID:      result.ConversationID,
		UserMessageID:       result.UserMessageID,
		AssistantMessageID:  result.AssistantMessageID,
		RunID:               result.RunID,
		SelectedAgentID:     result.SelectedAgentID,
		Response:            result.Response,
		Steps:               make([]DesktopRunStep, 0, len(result.Steps)),
		ProductTask:         convertProductTaskPtr(result.ProductTask),
		Artifacts:           convertArtifactSummaries(result.Artifacts),
		ProactiveCandidates: convertProactiveMessages(result.ProactiveCandidates),
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

func (a *DesktopApp) ListConversations() (*DesktopConversationListResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.ListConversations(context.Background(), 50)
	if err != nil {
		return nil, err
	}
	return &DesktopConversationListResponse{Conversations: convertConversationSummaries(result.Conversations)}, nil
}

func (a *DesktopApp) GetConversation(conversationID string) (*DesktopConversationDetailResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.GetConversation(context.Background(), conversationID)
	if err != nil {
		return nil, err
	}
	return &DesktopConversationDetailResponse{Conversation: convertConversationSummary(result.Conversation), Messages: convertConversationMessages(result.Messages)}, nil
}

func (a *DesktopApp) ListCapabilities() (*DesktopCapabilityListResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.ListCapabilities(context.Background())
	if err != nil {
		return nil, err
	}
	return &DesktopCapabilityListResponse{Capabilities: convertCapabilities(result.Capabilities)}, nil
}

func (a *DesktopApp) ListToolWorkflows() (*DesktopToolWorkflowListResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.ListToolWorkflows(context.Background())
	if err != nil {
		return nil, err
	}
	return &DesktopToolWorkflowListResponse{Workflows: convertToolWorkflows(result.Workflows)}, nil
}

func (a *DesktopApp) ListToolRuns() (*DesktopToolRunListResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.ListToolRuns(context.Background(), 50)
	if err != nil {
		return nil, err
	}
	return &DesktopToolRunListResponse{ToolRuns: convertToolRuns(result.ToolRuns)}, nil
}

func (a *DesktopApp) SetToolWorkflowEnabled(req DesktopToolWorkflowEnabledRequest) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.core.SetToolWorkflowEnabled(context.Background(), req.Name, req.Enabled)
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

func (a *DesktopApp) ListProductTasks(filter DesktopProductTaskFilter) (*DesktopProductTaskListResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.ListProductTasks(context.Background(), appcore.ProductTaskFilter{Status: filter.Status, Limit: filter.Limit})
	if err != nil {
		return nil, err
	}
	return &DesktopProductTaskListResponse{Tasks: convertProductTasks(result.Tasks)}, nil
}

func (a *DesktopApp) GetProductTask(id string) (*DesktopProductTaskDetail, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.GetProductTask(context.Background(), id)
	if err != nil {
		return nil, err
	}
	return convertProductTaskDetail(result), nil
}

func (a *DesktopApp) ListArtifacts(filter DesktopArtifactFilter) (*DesktopArtifactListResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.ListArtifacts(context.Background(), appcore.ArtifactFilter{ProductTaskID: filter.ProductTaskID, Type: filter.Type, Limit: filter.Limit})
	if err != nil {
		return nil, err
	}
	return &DesktopArtifactListResponse{Artifacts: convertArtifactSummaries(result.Artifacts)}, nil
}

func (a *DesktopApp) GetArtifact(id string) (*DesktopArtifactDetail, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.GetArtifact(context.Background(), id)
	if err != nil {
		return nil, err
	}
	return convertArtifactDetail(result), nil
}

func (a *DesktopApp) ListOpenLoops(filter DesktopOpenLoopFilter) (*DesktopOpenLoopListResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.ListOpenLoops(context.Background(), appcore.OpenLoopFilter{Status: filter.Status, Limit: filter.Limit})
	if err != nil {
		return nil, err
	}
	return &DesktopOpenLoopListResponse{OpenLoops: convertOpenLoops(result.OpenLoops)}, nil
}

func (a *DesktopApp) ListProactiveMessages(filter DesktopProactiveMessageFilter) (*DesktopProactiveMessageListResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	result, err := a.core.ListProactiveMessages(context.Background(), appcore.ProactiveMessageFilter{Status: filter.Status, Limit: filter.Limit})
	if err != nil {
		return nil, err
	}
	return &DesktopProactiveMessageListResponse{Messages: convertProactiveMessages(result.Messages)}, nil
}

func (a *DesktopApp) DecideProactiveMessage(req DesktopProactiveDecisionRequest) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.core.DecideProactiveMessage(context.Background(), req.ID, req.Action, req.Feedback)
}

func (a *DesktopApp) UpdateMemory(req DesktopMemoryActionRequest) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.core.UpdateMemory(context.Background(), appcore.MemoryActionRequest{ID: req.ID, Action: req.Action, Feedback: req.Feedback, Comment: req.Comment, TargetID: req.TargetID, Reason: req.Reason, Content: req.Content, Summary: req.Summary, ScopeType: req.ScopeType, RunID: req.RunID})
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

func (a *DesktopApp) GetWorkspaceSettings() (*DesktopWorkspaceSettings, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	settings, err := a.core.GetWorkspaceSettings(context.Background())
	if err != nil {
		return nil, err
	}
	return &DesktopWorkspaceSettings{AllowedRoots: settings.AllowedRoots, DefaultRoot: settings.DefaultRoot, BrowserAllowedHosts: settings.BrowserAllowedHosts, WebResearchAllowPrivateHosts: settings.WebResearchAllowPrivateHosts, FileAnalyzeMaxBytes: settings.FileAnalyzeMaxBytes, WorkspaceSearchMaxResults: settings.WorkspaceSearchMaxResults}, nil
}

func (a *DesktopApp) SaveWorkspaceSettings(req DesktopWorkspaceSettings) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.core.SaveWorkspaceSettings(context.Background(), appcore.WorkspaceSettingsRequest{AllowedRoots: req.AllowedRoots, DefaultRoot: req.DefaultRoot, BrowserAllowedHosts: req.BrowserAllowedHosts, WebResearchAllowPrivateHosts: req.WebResearchAllowPrivateHosts, FileAnalyzeMaxBytes: req.FileAnalyzeMaxBytes, WorkspaceSearchMaxResults: req.WorkspaceSearchMaxResults})
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
	modelConfigured := desktopModelConfigured(settings, secrets.Secrets)
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

func (a *DesktopApp) TestModelConnection(req DesktopModelConnectionTestRequest) (*DesktopConnectionTestResponse, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	settings, err := a.core.GetDesktopSettings(context.Background())
	if err != nil {
		return nil, err
	}
	provider := valueOrDefault(strings.TrimSpace(req.Provider), settings.ModelProvider)
	baseURL := valueOrDefault(strings.TrimSpace(req.BaseURL), settings.ModelBaseURL)
	modelName := valueOrDefault(strings.TrimSpace(req.Name), settings.ModelName)
	if provider == "mock_provider" {
		if !desktopMockProviderAllowed() {
			return &DesktopConnectionTestResponse{OK: false, Status: "mock_disabled", ErrorSummary: "mock_provider is disabled by ALLOW_MOCK_PROVIDER"}, nil
		}
		if strings.TrimSpace(modelName) == "" {
			return &DesktopConnectionTestResponse{OK: false, Status: "missing_model_config", ErrorSummary: "mock model name is required"}, nil
		}
		return &DesktopConnectionTestResponse{
			OK:     true,
			Status: "succeeded",
			AvailableModels: []DesktopAvailableModel{{
				ID:                modelName,
				DisplayName:       modelName,
				Owner:             "mock_provider",
				Object:            "model",
				SupportsJSONMode:  true,
				SupportsToolCalls: false,
				Metadata:          map[string]any{"mock_provider": true},
			}},
		}, nil
	}
	apiKey := strings.TrimSpace(req.APIKey)
	if apiKey == "" {
		apiKey = os.Getenv("MODEL_API_KEY")
	}
	if apiKey == "" {
		apiKey, _ = keychainGet("MODEL_API_KEY")
	}
	if apiKey == "" {
		return &DesktopConnectionTestResponse{OK: false, Status: "missing_api_key", ErrorSummary: "MODEL_API_KEY is not configured"}, nil
	}
	if baseURL == "" || modelName == "" {
		return &DesktopConnectionTestResponse{OK: false, Status: "missing_model_config", ErrorSummary: "model base URL and model name are required"}, nil
	}
	timeoutSeconds := req.TimeoutSeconds
	if timeoutSeconds <= 0 {
		timeoutSeconds = 30
	}
	models, err := fetchOpenAICompatibleModels(context.Background(), baseURL, apiKey, timeoutSeconds)
	if err != nil {
		return &DesktopConnectionTestResponse{OK: false, Status: "failed", ErrorSummary: err.Error()}, nil
	}
	if len(models) == 0 {
		return &DesktopConnectionTestResponse{OK: false, Status: "empty_model_list", ErrorSummary: "provider returned no available models"}, nil
	}
	_ = a.upsertFetchedModels(context.Background(), provider, baseURL, models)
	models = a.applySavedModelSettings(context.Background(), provider, baseURL, models)
	if !modelListContains(models, modelName) {
		return &DesktopConnectionTestResponse{OK: true, Status: "succeeded", AvailableModels: models, ErrorSummary: fmt.Sprintf("%s key is valid, but %q was not found in the available model list", provider, modelName)}, nil
	}
	return &DesktopConnectionTestResponse{OK: true, Status: "succeeded", AvailableModels: models}, nil
}

func (a *DesktopApp) SaveModelSettings(req DesktopModelSettingsRequest) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	provider := strings.TrimSpace(req.Provider)
	baseURL := strings.TrimSpace(req.BaseURL)
	modelID := strings.TrimSpace(req.ModelID)
	if provider == "" || baseURL == "" || modelID == "" {
		return errors.New("provider, base_url, and model_id are required")
	}
	if req.TimeoutSeconds <= 0 {
		req.TimeoutSeconds = 60
	}
	if req.MaxRetries < 0 {
		req.MaxRetries = 0
	}
	metadata := map[string]any{
		"source":                "desktop_model_settings",
		"role":                  strings.TrimSpace(req.Role),
		"temperature":           req.Temperature,
		"max_output_tokens":     req.MaxOutputTokens,
		"timeout_seconds":       req.TimeoutSeconds,
		"max_retries":           req.MaxRetries,
		"supports_json_mode":    req.SupportsJSONMode,
		"supports_tool_calling": req.SupportsToolCalls,
		"supports_reasoning":    req.SupportsReasoning,
	}
	recordID := desktopModelRecordID(provider, baseURL, modelID)
	_, err := a.core.DB().SQL().ExecContext(context.Background(), `
		INSERT INTO models (id, provider, model_name, display_name, base_url, supports_json_mode, supports_tool_calling, enabled, metadata, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
		ON CONFLICT(id) DO UPDATE SET
			provider=excluded.provider,
			model_name=excluded.model_name,
			display_name=excluded.display_name,
			base_url=excluded.base_url,
			supports_json_mode=excluded.supports_json_mode,
			supports_tool_calling=excluded.supports_tool_calling,
			enabled=excluded.enabled,
			metadata=excluded.metadata,
			updated_at=datetime('now')
	`, recordID, provider, modelID, valueOrDefault(req.DisplayName, modelID), baseURL, boolInt(req.SupportsJSONMode), boolInt(req.SupportsToolCalls), boolInt(req.Enabled), mustMarshalJSON(metadata))
	if err != nil {
		return err
	}
	settings, _ := a.core.GetDesktopSettings(context.Background())
	if req.Role == "default" && settings != nil {
		return a.core.SaveDesktopModelConfig(context.Background(), appcore.DesktopModelConfigRequest{
			Provider:       provider,
			BaseURL:        baseURL,
			Name:           modelID,
			TimeoutSeconds: req.TimeoutSeconds,
			MaxRetries:     req.MaxRetries,
		})
	}
	if req.Role == "reasoning" {
		_, _ = a.core.DB().SQL().ExecContext(context.Background(), `
			INSERT INTO desktop_settings (key, value, updated_at)
			VALUES ('model.reasoning_name', ?, datetime('now'))
			ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
		`, modelID)
	}
	return nil
}

func fetchOpenAICompatibleModels(ctx context.Context, baseURL string, apiKey string, timeoutSeconds int) ([]DesktopAvailableModel, error) {
	endpoint := openAICompatibleModelsEndpoint(baseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: time.Duration(timeoutSeconds) * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("model list returned %s: %s", resp.Status, strings.TrimSpace(string(raw)))
	}
	return parseOpenAICompatibleModels(raw)
}

func openAICompatibleModelsEndpoint(baseURL string) string {
	endpoint := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(endpoint, "/chat/completions") {
		return strings.TrimSuffix(endpoint, "/chat/completions") + "/models"
	}
	if strings.HasSuffix(endpoint, "/models") {
		return endpoint
	}
	if strings.HasSuffix(endpoint, "/v1") {
		return endpoint + "/models"
	}
	return endpoint + "/v1/models"
}

func parseOpenAICompatibleModels(raw []byte) ([]DesktopAvailableModel, error) {
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	items, ok := payload["data"].([]any)
	if !ok {
		items, _ = payload["models"].([]any)
	}
	models := make([]DesktopAvailableModel, 0, len(items))
	for _, item := range items {
		object, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id := firstString(object, "id", "name", "model")
		if id == "" {
			continue
		}
		supportedParams := stringSliceFromAny(object["supported_parameters"])
		topProvider := objectFromAny(object["top_provider"])
		pricing := objectFromAny(object["pricing"])
		contextWindow := firstInt(object, "context_window", "context_length", "max_context_length", "input_token_limit")
		if contextWindow == 0 {
			contextWindow = firstInt(topProvider, "context_length", "max_context_length")
		}
		maxOutputTokens := firstInt(object, "max_output_tokens", "output_token_limit")
		if maxOutputTokens == 0 {
			maxOutputTokens = firstInt(topProvider, "max_completion_tokens", "max_output_tokens")
		}
		supportsJSON := boolFromAny(object["supports_json_mode"]) || containsAnyString(supportedParams, "response_format", "json_schema", "structured_outputs")
		supportsToolCalls := boolFromAny(object["supports_tool_calling"]) || containsAnyString(supportedParams, "tools", "tool_choice", "function_calling")
		supportsReasoning := boolFromAny(object["supports_reasoning"]) || containsAnyString(supportedParams, "reasoning", "reasoning_effort") || strings.Contains(strings.ToLower(id), "reasoner")
		models = append(models, DesktopAvailableModel{
			ID:                id,
			DisplayName:       firstString(object, "display_name", "displayName", "name"),
			Owner:             firstString(object, "owned_by", "owner", "organization"),
			Object:            firstString(object, "object", "type"),
			Created:           stringFromNumberish(object["created"]),
			ContextWindow:     contextWindow,
			MaxOutputTokens:   maxOutputTokens,
			InputPricePer1M:   firstPricePer1M(object, pricing, "input_price_per_1m", "prompt_price_per_1m", "prompt"),
			OutputPricePer1M:  firstPricePer1M(object, pricing, "output_price_per_1m", "completion_price_per_1m", "completion"),
			SupportsJSONMode:  supportsJSON,
			SupportsToolCalls: supportsToolCalls,
			SupportsReasoning: supportsReasoning,
			SupportedParams:   supportedParams,
			Config: DesktopModelRuntimeConfig{
				Role:              "",
				Enabled:           true,
				Temperature:       0.7,
				MaxOutputTokens:   maxOutputTokens,
				TimeoutSeconds:    60,
				MaxRetries:        1,
				SupportsJSONMode:  supportsJSON,
				SupportsToolCalls: supportsToolCalls,
				SupportsReasoning: supportsReasoning,
			},
			Metadata: object,
		})
	}
	return models, nil
}

func (a *DesktopApp) upsertFetchedModels(ctx context.Context, provider string, baseURL string, models []DesktopAvailableModel) error {
	for _, model := range models {
		recordID := desktopModelRecordID(provider, baseURL, model.ID)
		if _, err := a.core.DB().SQL().ExecContext(ctx, `
			INSERT INTO models (id, provider, model_name, display_name, base_url, supports_json_mode, supports_tool_calling, context_window, input_price_per_1m, output_price_per_1m, enabled, metadata, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, 0), NULLIF(?, 0), NULLIF(?, 0), 1, ?, datetime('now'))
			ON CONFLICT(id) DO UPDATE SET
				provider=excluded.provider,
				model_name=excluded.model_name,
				display_name=excluded.display_name,
				base_url=excluded.base_url,
				context_window=excluded.context_window,
				input_price_per_1m=excluded.input_price_per_1m,
				output_price_per_1m=excluded.output_price_per_1m,
				updated_at=datetime('now')
		`, recordID, provider, model.ID, valueOrDefault(model.DisplayName, model.ID), baseURL, boolInt(model.SupportsJSONMode), boolInt(model.SupportsToolCalls), model.ContextWindow, model.InputPricePer1M, model.OutputPricePer1M, mustMarshalJSON(map[string]any{"source": "provider_model_list", "raw": model.Metadata})); err != nil {
			return err
		}
	}
	return nil
}

func (a *DesktopApp) applySavedModelSettings(ctx context.Context, provider string, baseURL string, models []DesktopAvailableModel) []DesktopAvailableModel {
	settings, _ := a.core.GetDesktopSettings(ctx)
	for index, model := range models {
		if settings != nil && model.ID == settings.ModelName && model.Config.Role == "" {
			model.Config.Role = "default"
		}
		recordID := desktopModelRecordID(provider, baseURL, model.ID)
		var enabled int
		var supportsJSON int
		var supportsTool int
		var contextWindow sql.NullInt64
		var inputPrice sql.NullFloat64
		var outputPrice sql.NullFloat64
		var rawMetadata string
		err := a.core.DB().SQL().QueryRowContext(ctx, `
			SELECT enabled, supports_json_mode, supports_tool_calling, context_window, input_price_per_1m, output_price_per_1m, metadata
			FROM models
			WHERE id = ?
		`, recordID).Scan(&enabled, &supportsJSON, &supportsTool, &contextWindow, &inputPrice, &outputPrice, &rawMetadata)
		if err == nil {
			model.Config.Enabled = enabled != 0
			model.SupportsJSONMode = supportsJSON != 0
			model.SupportsToolCalls = supportsTool != 0
			model.Config.SupportsJSONMode = model.SupportsJSONMode
			model.Config.SupportsToolCalls = model.SupportsToolCalls
			if contextWindow.Valid && model.ContextWindow == 0 {
				model.ContextWindow = int(contextWindow.Int64)
			}
			if inputPrice.Valid && model.InputPricePer1M == 0 {
				model.InputPricePer1M = inputPrice.Float64
			}
			if outputPrice.Valid && model.OutputPricePer1M == 0 {
				model.OutputPricePer1M = outputPrice.Float64
			}
			applyModelMetadataConfig(&model, rawMetadata)
		}
		models[index] = model
	}
	return models
}

func applyModelMetadataConfig(model *DesktopAvailableModel, rawMetadata string) {
	var metadata map[string]any
	if err := json.Unmarshal([]byte(rawMetadata), &metadata); err != nil {
		return
	}
	if role := firstString(metadata, "role"); role != "" {
		model.Config.Role = role
	}
	if value := numberFromAny(metadata["temperature"]); value != 0 {
		model.Config.Temperature = value
	}
	if value := intFromAny(metadata["max_output_tokens"]); value != 0 {
		model.Config.MaxOutputTokens = value
	}
	if value := intFromAny(metadata["timeout_seconds"]); value != 0 {
		model.Config.TimeoutSeconds = value
	}
	if value, ok := optionalIntFromAny(metadata["max_retries"]); ok {
		model.Config.MaxRetries = value
	}
	if value, ok := metadata["supports_reasoning"]; ok {
		model.SupportsReasoning = boolFromAny(value)
		model.Config.SupportsReasoning = model.SupportsReasoning
	}
	if value, ok := metadata["supports_json_mode"]; ok {
		model.SupportsJSONMode = boolFromAny(value)
		model.Config.SupportsJSONMode = model.SupportsJSONMode
	}
	if value, ok := metadata["supports_tool_calling"]; ok {
		model.SupportsToolCalls = boolFromAny(value)
		model.Config.SupportsToolCalls = model.SupportsToolCalls
	}
}

func firstString(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := values[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func modelListContains(models []DesktopAvailableModel, modelName string) bool {
	for _, model := range models {
		if model.ID == modelName {
			return true
		}
	}
	return false
}

func desktopModelRecordID(provider string, baseURL string, modelID string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(provider) + "\n" + strings.TrimSpace(baseURL) + "\n" + strings.TrimSpace(modelID)))
	return "desktop_model_" + hex.EncodeToString(sum[:8])
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func boolFromAny(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		normalized := strings.ToLower(strings.TrimSpace(typed))
		return normalized == "true" || normalized == "1" || normalized == "yes"
	case float64:
		return typed != 0
	case int:
		return typed != 0
	default:
		return false
	}
}

func mustMarshalJSON(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(raw)
}

func objectFromAny(value any) map[string]any {
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	return map[string]any{}
}

func stringSliceFromAny(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
			result = append(result, strings.TrimSpace(text))
		}
	}
	return result
}

func containsAnyString(values []string, needles ...string) bool {
	for _, value := range values {
		normalized := strings.ToLower(value)
		for _, needle := range needles {
			if normalized == strings.ToLower(needle) {
				return true
			}
		}
	}
	return false
}

func firstInt(values map[string]any, keys ...string) int {
	for _, key := range keys {
		if value := intFromAny(values[key]); value != 0 {
			return value
		}
	}
	return 0
}

func intFromAny(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		parsed, _ := typed.Int64()
		return int(parsed)
	case string:
		parsed, _ := strconv.Atoi(strings.TrimSpace(typed))
		return parsed
	default:
		return 0
	}
}

func optionalIntFromAny(value any) (int, bool) {
	switch value.(type) {
	case nil:
		return 0, false
	default:
		return intFromAny(value), true
	}
}

func numberFromAny(value any) float64 {
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
		parsed, _ := typed.Float64()
		return parsed
	case string:
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed
	default:
		return 0
	}
}

func firstPricePer1M(model map[string]any, pricing map[string]any, keys ...string) float64 {
	for _, key := range keys {
		if value := numberFromAny(model[key]); value != 0 {
			return value
		}
		if value := numberFromAny(pricing[key]); value != 0 {
			if value < 0.01 {
				return value * 1_000_000
			}
			return value
		}
	}
	return 0
}

func stringFromNumberish(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return strconv.FormatInt(int64(typed), 10)
	case int64:
		return strconv.FormatInt(typed, 10)
	case int:
		return strconv.Itoa(typed)
	default:
		return ""
	}
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

func convertConversationSummaries(items []appcore.ConversationSummary) []DesktopConversationSummary {
	result := make([]DesktopConversationSummary, 0, len(items))
	for _, item := range items {
		result = append(result, convertConversationSummary(item))
	}
	return result
}

func convertConversationSummary(item appcore.ConversationSummary) DesktopConversationSummary {
	return DesktopConversationSummary{
		ID:            item.ID,
		Channel:       item.Channel,
		UserID:        item.UserID,
		Title:         item.Title,
		ActiveAgentID: item.ActiveAgentID,
		Topic:         item.Topic,
		LastMessage:   item.LastMessage,
		LastRole:      item.LastRole,
		LatestRunID:   item.LatestRunID,
		MessageCount:  item.MessageCount,
		Metadata:      item.Metadata,
		CreatedAt:     desktopTime(item.CreatedAt),
		UpdatedAt:     desktopTime(item.UpdatedAt),
	}
}

func convertConversationMessages(items []appcore.ConversationMessage) []DesktopConversationMessage {
	result := make([]DesktopConversationMessage, 0, len(items))
	for _, item := range items {
		result = append(result, DesktopConversationMessage{
			ID:             item.ID,
			ConversationID: item.ConversationID,
			Role:           item.Role,
			Content:        item.Content,
			RunID:          item.RunID,
			Attachments:    item.Attachments,
			Metadata:       item.Metadata,
			CreatedAt:      desktopTime(item.CreatedAt),
		})
	}
	return result
}

func convertCapabilities(items []appcore.CapabilityRecord) []DesktopCapabilityRecord {
	result := make([]DesktopCapabilityRecord, 0, len(items))
	for _, item := range items {
		result = append(result, DesktopCapabilityRecord{ID: item.ID, Name: item.Name, Description: item.Description, RiskLevel: item.RiskLevel, Enabled: item.Enabled, Metadata: item.Metadata})
	}
	return result
}

func convertToolWorkflows(items []appcore.ToolWorkflowRecord) []DesktopToolWorkflowRecord {
	result := make([]DesktopToolWorkflowRecord, 0, len(items))
	for _, item := range items {
		steps := make([]DesktopToolWorkflowStep, 0, len(item.Steps))
		for _, step := range item.Steps {
			steps = append(steps, DesktopToolWorkflowStep{Tool: step.Tool, Args: step.Args, RiskLevel: step.RiskLevel})
		}
		result = append(result, DesktopToolWorkflowRecord{
			ID:           item.ID,
			CapabilityID: item.CapabilityID,
			Name:         item.Name,
			Version:      item.Version,
			RiskLevel:    item.RiskLevel,
			Steps:        steps,
			Enabled:      item.Enabled,
			Metadata:     item.Metadata,
			CreatedAt:    desktopTime(item.CreatedAt),
			UpdatedAt:    desktopTime(item.UpdatedAt),
		})
	}
	return result
}

func convertToolRuns(items []appcore.ToolRunRecord) []DesktopToolRunRecord {
	result := make([]DesktopToolRunRecord, 0, len(items))
	for _, item := range items {
		result = append(result, DesktopToolRunRecord{
			ID:               item.ID,
			RunID:            item.RunID,
			TaskID:           item.TaskID,
			CapabilityID:     item.CapabilityID,
			WorkflowName:     item.WorkflowName,
			ToolID:           item.ToolID,
			ToolName:         item.ToolName,
			NodeID:           item.NodeID,
			AssignmentReason: item.AssignmentReason,
			RiskLevel:        item.RiskLevel,
			Status:           item.Status,
			Input:            item.Input,
			Output:           item.Output,
			Error:            item.Error,
			StartedAt:        desktopTime(item.StartedAt),
			FinishedAt:       desktopTimePtr(item.FinishedAt),
			DurationMs:       item.DurationMs,
			CreatedAt:        desktopTime(item.CreatedAt),
		})
	}
	return result
}

func convertProductTaskPtr(item *appcore.ProductTask) *DesktopProductTask {
	if item == nil {
		return nil
	}
	converted := convertProductTask(*item)
	return &converted
}

func convertProductTasks(items []appcore.ProductTask) []DesktopProductTask {
	result := make([]DesktopProductTask, 0, len(items))
	for _, item := range items {
		result = append(result, convertProductTask(item))
	}
	return result
}

func convertProductTask(item appcore.ProductTask) DesktopProductTask {
	return DesktopProductTask{
		ID:                        item.ID,
		Title:                     item.Title,
		Description:               item.Description,
		Status:                    item.Status,
		Mode:                      item.Mode,
		Priority:                  item.Priority,
		CreatedFromConversationID: item.CreatedFromConversationID,
		CreatedFromMessageID:      item.CreatedFromMessageID,
		LatestRunID:               item.LatestRunID,
		OwnerUserID:               item.OwnerUserID,
		SourceChannel:             item.SourceChannel,
		RiskLevel:                 item.RiskLevel,
		ProgressPercent:           item.ProgressPercent,
		CurrentStepID:             item.CurrentStepID,
		Summary:                   item.Summary,
		Metadata:                  item.Metadata,
		CreatedAt:                 desktopTime(item.CreatedAt),
		UpdatedAt:                 desktopTime(item.UpdatedAt),
		CompletedAt:               desktopTimePtr(item.CompletedAt),
	}
}

func convertProductTaskSteps(items []appcore.ProductTaskStep) []DesktopProductTaskStep {
	result := make([]DesktopProductTaskStep, 0, len(items))
	for _, item := range items {
		result = append(result, DesktopProductTaskStep{
			ID:             item.ID,
			ProductTaskID:  item.ProductTaskID,
			Title:          item.Title,
			Description:    item.Description,
			Status:         item.Status,
			SortOrder:      item.SortOrder,
			CapabilityID:   item.CapabilityID,
			ToolWorkflowID: item.ToolWorkflowID,
			RunID:          item.RunID,
			ToolRunID:      item.ToolRunID,
			WorkerTaskID:   item.WorkerTaskID,
			Summary:        item.Summary,
			Input:          item.Input,
			Output:         item.Output,
			Error:          item.Error,
			StartedAt:      desktopTimePtr(item.StartedAt),
			FinishedAt:     desktopTimePtr(item.FinishedAt),
			CreatedAt:      desktopTime(item.CreatedAt),
			UpdatedAt:      desktopTime(item.UpdatedAt),
		})
	}
	return result
}

func convertProductTaskDetail(item *appcore.ProductTaskDetail) *DesktopProductTaskDetail {
	if item == nil {
		return nil
	}
	return &DesktopProductTaskDetail{
		Task:         convertProductTask(item.Task),
		Steps:        convertProductTaskSteps(item.Steps),
		Deliverables: convertArtifactSummaries(item.Deliverables),
	}
}

func convertArtifactSummaries(items []appcore.ArtifactSummary) []DesktopArtifactSummary {
	result := make([]DesktopArtifactSummary, 0, len(items))
	for _, item := range items {
		result = append(result, convertArtifactSummary(item))
	}
	return result
}

func convertArtifactSummary(item appcore.ArtifactSummary) DesktopArtifactSummary {
	return DesktopArtifactSummary{
		ID:                   item.ID,
		Type:                 item.Type,
		Title:                item.Title,
		ContentFormat:        item.ContentFormat,
		SourceProductTaskID:  item.SourceProductTaskID,
		SourceRunID:          item.SourceRunID,
		SourceConversationID: item.SourceConversationID,
		SourceMessageID:      item.SourceMessageID,
		Version:              item.Version,
		Status:               item.Status,
		Metadata:             item.Metadata,
		CreatedAt:            desktopTime(item.CreatedAt),
		UpdatedAt:            desktopTime(item.UpdatedAt),
	}
}

func convertArtifactDetail(item *appcore.ArtifactDetail) *DesktopArtifactDetail {
	if item == nil {
		return nil
	}
	return &DesktopArtifactDetail{
		DesktopArtifactSummary: convertArtifactSummary(item.ArtifactSummary),
		Content:                item.Content,
		LinkedMemoryIDs:        item.LinkedMemoryIDs,
	}
}

func convertOpenLoops(items []appcore.OpenLoopRecord) []DesktopOpenLoop {
	result := make([]DesktopOpenLoop, 0, len(items))
	for _, item := range items {
		result = append(result, DesktopOpenLoop{
			ID:                   item.ID,
			Topic:                item.Topic,
			Description:          item.Description,
			Status:               item.Status,
			SourceConversationID: item.SourceConversationID,
			SourceRunID:          item.SourceRunID,
			SourceProductTaskID:  item.SourceProductTaskID,
			SuggestedFollowup:    item.SuggestedFollowup,
			Priority:             item.Priority,
			DueAt:                desktopTimePtr(item.DueAt),
			Metadata:             item.Metadata,
			CreatedAt:            desktopTime(item.CreatedAt),
			UpdatedAt:            desktopTime(item.UpdatedAt),
			ClosedAt:             desktopTimePtr(item.ClosedAt),
		})
	}
	return result
}

func convertProactiveMessages(items []appcore.ProactiveMessageRecord) []DesktopProactiveMessage {
	result := make([]DesktopProactiveMessage, 0, len(items))
	for _, item := range items {
		result = append(result, DesktopProactiveMessage{
			ID:                  item.ID,
			Type:                item.Type,
			Title:               item.Title,
			Body:                item.Body,
			Reason:              item.Reason,
			SourceMemoryIDs:     item.SourceMemoryIDs,
			SourceOpenLoopID:    item.SourceOpenLoopID,
			SourceProductTaskID: item.SourceProductTaskID,
			Score:               item.Score,
			Status:              item.Status,
			Channel:             item.Channel,
			SendAfter:           desktopTimePtr(item.SendAfter),
			ExpiresAt:           desktopTimePtr(item.ExpiresAt),
			Feedback:            item.Feedback,
			Metadata:            item.Metadata,
			CreatedAt:           desktopTime(item.CreatedAt),
			UpdatedAt:           desktopTime(item.UpdatedAt),
			SentAt:              desktopTimePtr(item.SentAt),
		})
	}
	return result
}

func desktopTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.Format(time.RFC3339Nano)
}

func desktopTimePtr(value *time.Time) string {
	if value == nil {
		return ""
	}
	return desktopTime(*value)
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

func desktopModelConfigured(settings *appcore.DesktopSettingsResponse, secrets map[string]bool) bool {
	if settings == nil {
		return false
	}
	provider := strings.TrimSpace(settings.ModelProvider)
	modelName := strings.TrimSpace(settings.ModelName)
	baseURL := strings.TrimSpace(settings.ModelBaseURL)
	if provider == "mock_provider" {
		return modelName != "" && desktopMockProviderAllowed()
	}
	return provider != "" && modelName != "" && baseURL != "" && secrets["MODEL_API_KEY"]
}

func desktopMockProviderAllowed() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("ALLOW_MOCK_PROVIDER")))
	return value == "" || value == "true" || value == "1" || value == "yes"
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
