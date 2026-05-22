package runtimeconfig

import (
	"log/slog"

	internal "github.com/hao/agent-os/services/orchestrator-core/internal/runtimeconfig"
)

type Config = internal.Config

func Load() Config {
	return internal.Load()
}

func LogCheck(logger *slog.Logger, cfg Config) {
	internal.LogCheck(logger, cfg)
}
