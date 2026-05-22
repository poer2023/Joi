package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hao/agent-os/services/orchestrator-core/internal/appcore"
	"github.com/hao/agent-os/services/orchestrator-core/internal/runtimeconfig"
	coreserver "github.com/hao/agent-os/services/orchestrator-core/internal/server"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if os.Getenv("APP_MODE") == "" {
		_ = os.Setenv("APP_MODE", "server")
	}
	cfg := runtimeconfig.Load()
	runtimeconfig.LogCheck(logger, cfg)

	ctx := context.Background()
	core, err := appcore.NewAppCore(ctx, cfg, logger)
	if err != nil {
		logger.Error("failed to initialize app core", "service", "orchestrator-core", "error", err)
		os.Exit(1)
	}
	defer core.Shutdown(context.Background())
	if err := core.Start(ctx); err != nil {
		logger.Error("failed to start app core", "service", "orchestrator-core", "error", err)
		os.Exit(1)
	}

	server := coreserver.NewHTTPServer(core, logger, normalizePort(cfg.Server.Port))

	logger.Info("orchestrator-core listening", "service", "orchestrator-core", "addr", server.Addr)
	errCh := make(chan error, 1)
	go func() {
		errCh <- server.ListenAndServe()
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	select {
	case sig := <-stop:
		logger.Info("orchestrator-core shutting down", "signal", sig.String())
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			logger.Error("orchestrator-core graceful shutdown failed", "error", err)
			os.Exit(1)
		}
	case err := <-errCh:
		if err != nil && err != http.ErrServerClosed {
			logger.Error("orchestrator-core stopped", "service", "orchestrator-core", "error", err)
			os.Exit(1)
		}
	}
}

func normalizePort(value string) string {
	if value == "" {
		return ":8080"
	}
	if value[0] == ':' {
		return value
	}
	return ":" + value
}
