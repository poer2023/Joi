package appcore

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/internal/runtimeconfig"
)

type LifecycleManager struct {
	Config runtimeconfig.Config
	Logger *slog.Logger

	Core          *AppCore
	WorkerGateway *WorkerGateway
}

func NewLifecycleManager(cfg runtimeconfig.Config, logger *slog.Logger) *LifecycleManager {
	if logger == nil {
		logger = slog.Default()
	}
	return &LifecycleManager{Config: cfg, Logger: logger}
}

func (m *LifecycleManager) Start(ctx context.Context) error {
	if err := m.initAppDirs(); err != nil {
		return err
	}
	core, err := NewAppCore(ctx, m.Config, m.Logger)
	if err != nil {
		return err
	}
	if err := core.Start(ctx); err != nil {
		_ = core.Shutdown(ctx)
		return err
	}
	m.Core = core
	if m.Config.App.Mode == "desktop" && strings.ToLower(strings.TrimSpace(os.Getenv("WORKER_GATEWAY_ENABLED"))) != "false" {
		gateway, err := StartWorkerGateway(ctx, WorkerGatewayConfig{
			Core:   core,
			Addr:   valueOrDefault(os.Getenv("WORKER_GATEWAY_ADDR"), "127.0.0.1:18081"),
			Token:  os.Getenv("WORKER_TOKEN"),
			Logger: m.Logger,
		})
		if err != nil {
			m.Logger.Warn("worker gateway skipped", "service", "appcore", "error", err)
		} else {
			m.WorkerGateway = gateway
		}
	}
	return nil
}

func (m *LifecycleManager) Shutdown(ctx context.Context) error {
	if m.WorkerGateway != nil {
		_ = m.WorkerGateway.Shutdown(ctx)
	}
	if m.Core != nil {
		return m.Core.Shutdown(ctx)
	}
	return nil
}

func (m *LifecycleManager) initAppDirs() error {
	if m.Config.App.SQLitePath == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(m.Config.App.SQLitePath), 0o700); err != nil {
		return err
	}
	base := filepath.Dir(m.Config.App.SQLitePath)
	for _, dir := range []string{filepath.Join(base, "backups"), filepath.Join(base, "logs"), filepath.Join(base, "diagnostics")} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
	}
	return nil
}
