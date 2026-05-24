package appcore

import (
	"context"
	"log/slog"

	internal "github.com/hao/agent-os/services/orchestrator-core/internal/appcore"
	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
	"github.com/hao/agent-os/services/orchestrator-core/pkg/runtimeconfig"
)

type AppCore = internal.AppCore
type ChatRequest = internal.ChatRequest
type ChatResponse = internal.ChatResponse
type RunTrace = internal.RunTrace
type ConversationListResponse = internal.ConversationListResponse
type ConversationSummary = internal.ConversationSummary
type ConversationDetail = internal.ConversationDetail
type ConversationMessage = internal.ConversationMessage
type CapabilityRecord = store.CapabilityRecord
type CapabilityListResponse = internal.CapabilityListResponse
type ToolWorkflowListResponse = internal.ToolWorkflowListResponse
type ToolWorkflowRecord = internal.ToolWorkflowRecord
type ToolRunListResponse = internal.ToolRunListResponse
type ToolRunRecord = internal.ToolRunRecord
type MemorySearchRequest = internal.MemorySearchRequest
type MemorySearchResponse = internal.MemorySearchResponse
type MemoryFilter = internal.MemoryFilter
type MemoryListResponse = internal.MemoryListResponse
type NodeListResponse = internal.NodeListResponse
type WorkerGatewayAuditRecord = internal.WorkerGatewayAuditRecord
type WorkerGatewayAuditResponse = internal.WorkerGatewayAuditResponse
type SystemHealthResponse = internal.SystemHealthResponse
type LifecycleManager = internal.LifecycleManager
type ModelCallRecord = store.ModelCallRecord
type NodeRecord = store.NodeRecord
type MemoryActionRequest = internal.MemoryActionRequest
type ConfirmationDecisionRequest = internal.ConfirmationDecisionRequest
type ConfirmationListResponse = internal.ConfirmationListResponse
type ModelUsageResponse = internal.ModelUsageResponse
type BackupRecord = internal.BackupRecord
type BackupListResponse = internal.BackupListResponse
type BackupCreateResponse = internal.BackupCreateResponse
type DiagnosticsExportResponse = internal.DiagnosticsExportResponse
type DesktopSettingsResponse = internal.DesktopSettingsResponse
type DesktopModelConfigRequest = internal.DesktopModelConfigRequest
type DesktopOperationalSettingsRequest = internal.DesktopOperationalSettingsRequest
type DesktopOnboardingCoreStatus = internal.DesktopOnboardingCoreStatus
type WorkspaceSettingsResponse = internal.WorkspaceSettingsResponse
type WorkspaceSettingsRequest = internal.WorkspaceSettingsRequest
type ProductTaskFilter = internal.ProductTaskFilter
type ProductTask = internal.ProductTask
type ProductTaskStep = internal.ProductTaskStep
type ProductTaskDetail = internal.ProductTaskDetail
type ProductTaskListResponse = internal.ProductTaskListResponse
type CreateProductTaskRequest = internal.CreateProductTaskRequest
type ProductTaskStepRequest = internal.ProductTaskStepRequest
type ArtifactFilter = internal.ArtifactFilter
type ArtifactSummary = internal.ArtifactSummary
type ArtifactDetail = internal.ArtifactDetail
type ArtifactListResponse = internal.ArtifactListResponse
type CreateArtifactRequest = internal.CreateArtifactRequest
type OpenLoopFilter = internal.OpenLoopFilter
type OpenLoopRecord = internal.OpenLoopRecord
type OpenLoopListResponse = internal.OpenLoopListResponse
type ProactiveMessageFilter = internal.ProactiveMessageFilter
type ProactiveMessageRecord = internal.ProactiveMessageRecord
type ProactiveMessageListResponse = internal.ProactiveMessageListResponse
type ReflectionRequest = internal.ReflectionRequest
type ReflectionResult = internal.ReflectionResult

func NewAppCore(ctx context.Context, cfg runtimeconfig.Config, logger *slog.Logger) (*AppCore, error) {
	return internal.NewAppCore(ctx, cfg, logger)
}

func NewLifecycleManager(cfg runtimeconfig.Config, logger *slog.Logger) *LifecycleManager {
	return internal.NewLifecycleManager(cfg, logger)
}
