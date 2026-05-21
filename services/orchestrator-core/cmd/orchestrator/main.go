package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hao/agent-os/services/orchestrator-core/internal/api"
	"github.com/hao/agent-os/services/orchestrator-core/internal/runtimeconfig"
	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg := runtimeconfig.Load()
	runtimeconfig.LogCheck(logger, cfg)

	db, err := store.Open(context.Background(), cfg.Database.URL)
	if err != nil {
		logger.Error("failed to open database", "service", "orchestrator-core", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := db.ApplyMigrations(context.Background(), cfg.Server.MigrationsDir); err != nil {
		logger.Error("failed to apply migrations", "service", "orchestrator-core", "error", err, "migrations_dir", cfg.Server.MigrationsDir)
		os.Exit(1)
	}

	if err := db.SeedRegistryFromDir(context.Background(), cfg.Server.ConfigDir); err != nil {
		logger.Warn("registry seed skipped", "service", "orchestrator-core", "error", err, "config_dir", cfg.Server.ConfigDir)
	}
	if err := db.RecoverInterruptedTasks(context.Background()); err != nil {
		logger.Warn("task recovery skipped", "service", "orchestrator-core", "error", err)
	}
	_ = db.RecoverStuckTasks(context.Background(), 2*time.Minute)
	_ = db.MarkOfflineNodes(context.Background(), 90*time.Second)
	if err := db.RegisterMainNode(context.Background()); err != nil {
		logger.Error("failed to register main-node", "service", "orchestrator-core", "error", err)
		os.Exit(1)
	}

	server := &http.Server{
		Addr:              normalizePort(cfg.Server.Port),
		Handler:           api.NewRouter(db, logger),
		ReadHeaderTimeout: 5 * time.Second,
	}

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
