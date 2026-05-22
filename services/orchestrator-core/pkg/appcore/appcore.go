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
type MemorySearchRequest = internal.MemorySearchRequest
type MemorySearchResponse = internal.MemorySearchResponse
type MemoryFilter = internal.MemoryFilter
type MemoryListResponse = internal.MemoryListResponse
type NodeListResponse = internal.NodeListResponse
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
type DesktopSettingsResponse = internal.DesktopSettingsResponse
type DesktopModelConfigRequest = internal.DesktopModelConfigRequest
type DesktopOnboardingCoreStatus = internal.DesktopOnboardingCoreStatus

func NewAppCore(ctx context.Context, cfg runtimeconfig.Config, logger *slog.Logger) (*AppCore, error) {
	return internal.NewAppCore(ctx, cfg, logger)
}

func NewLifecycleManager(cfg runtimeconfig.Config, logger *slog.Logger) *LifecycleManager {
	return internal.NewLifecycleManager(cfg, logger)
}
