package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/hao/agent-os/services/orchestrator-core/internal/appcore"
	"github.com/hao/agent-os/services/orchestrator-core/internal/backup"
	"github.com/hao/agent-os/services/orchestrator-core/internal/runtimeconfig"
)

func main() {
	ctx := context.Background()
	setDefault("APP_MODE", "desktop")
	setDefault("DATA_STORE", "sqlite")
	setDefault("TASK_QUEUE_DRIVER", "sqlite")
	cfg := runtimeconfig.Load()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	core, err := appcore.NewAppCore(ctx, cfg, logger)
	must(err)
	must(core.Start(ctx))

	chat, err := core.SendChat(ctx, appcore.ChatRequest{Channel: "desktop_check", UserID: "desktop_check", Message: "Desktop PoC check"})
	must(err)
	trace, err := core.GetRunTrace(ctx, chat.RunID)
	must(err)
	memory, err := core.SearchMemories(ctx, appcore.MemorySearchRequest{Query: "desktop", Limit: 5})
	must(err)
	health, err := core.GetSystemHealth(ctx)
	must(err)

	appDir := filepath.Dir(cfg.App.SQLitePath)
	backupPath, err := backup.Manager{
		AppDir:     appDir,
		SQLitePath: cfg.App.SQLitePath,
		ConfigDir:  filepath.Join(rootDir(), "configs"),
		PromptsDir: filepath.Join(rootDir(), "prompts"),
		BackupDir:  filepath.Join(appDir, "backups"),
	}.CreateManualBackup(ctx)
	must(err)
	must(core.Shutdown(ctx))

	reopened, err := appcore.NewAppCore(ctx, cfg, logger)
	must(err)
	must(reopened.Start(ctx))
	defer reopened.Shutdown(ctx)
	persistedTrace, err := reopened.GetRunTrace(ctx, chat.RunID)
	must(err)

	payload := map[string]any{
		"ok":                     true,
		"app_mode":               cfg.App.Mode,
		"data_store":             cfg.App.DataStore,
		"task_queue":             cfg.TaskQueue.Driver,
		"docker_required":        cfg.App.DockerRequired,
		"sqlite_path":            cfg.App.SQLitePath,
		"run_id":                 chat.RunID,
		"run_steps":              len(trace.Steps),
		"prompt_assemblies":      len(trace.PromptAssemblies),
		"model_calls":            len(trace.ModelCalls),
		"memory_context_packs":   len(trace.MemoryContextPacks),
		"memory_results":         len(memory.Results),
		"system_health_services": health.ServiceStatus,
		"backup_path":            backupPath,
		"persisted_run_steps":    len(persistedTrace.Steps),
	}
	if len(trace.ModelCalls) > 0 {
		payload["model_call_status"] = trace.ModelCalls[0].Status
		payload["model_call_provider"] = trace.ModelCalls[0].Provider
		payload["fallback_to_mock"] = trace.ModelCalls[0].Metadata["fallback_to_mock"]
		payload["real_model"] = trace.ModelCalls[0].Metadata["real_model"]
		payload["input_tokens"] = trace.ModelCalls[0].InputTokens
		payload["output_tokens"] = trace.ModelCalls[0].OutputTokens
		payload["cached_input_tokens"] = trace.ModelCalls[0].CachedInputTokens
		payload["latency_ms"] = trace.ModelCalls[0].LatencyMs
	}
	raw, _ := json.MarshalIndent(payload, "", "  ")
	fmt.Println(string(raw))
}

func setDefault(key string, value string) {
	if os.Getenv(key) == "" {
		_ = os.Setenv(key, value)
	}
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func rootDir() string {
	wd, _ := os.Getwd()
	for i := 0; i < 6; i++ {
		if _, err := os.Stat(filepath.Join(wd, "docs")); err == nil {
			return wd
		}
		wd = filepath.Dir(wd)
	}
	return "."
}
