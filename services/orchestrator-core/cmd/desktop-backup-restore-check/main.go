package main

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/internal/appcore"
	"github.com/hao/agent-os/services/orchestrator-core/internal/runtimeconfig"
)

func main() {
	setDefault("APP_MODE", "desktop")
	setDefault("DATA_STORE", "sqlite")
	setDefault("TASK_QUEUE_DRIVER", "sqlite")
	setDefault("MODEL_PROVIDER", "mock_provider")
	setDefault("ALLOW_MOCK_PROVIDER", "true")

	ctx := context.Background()
	cfg := runtimeconfig.Load()
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	core, err := appcore.NewAppCore(ctx, cfg, logger)
	must(err)
	must(core.Start(ctx))
	must(core.SaveDesktopModelConfig(ctx, appcore.DesktopModelConfigRequest{Provider: "mock_provider", Name: "mock-model", TimeoutSeconds: 60, MaxRetries: 1}))
	_, err = core.DB().SQL().ExecContext(ctx, `
		INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, metadata, updated_at)
		VALUES ('mem_restore_drill_marker', 'project_fact', 'Desktop restore drill memory marker', 'Desktop restore drill memory marker', 'global', 'internal', 0.99, 'confirmed', '[]', '["restore","drill"]', '{"source":"desktop_backup_restore_check"}', datetime('now'))
		ON CONFLICT(id) DO UPDATE SET content=excluded.content, summary=excluded.summary, status=excluded.status, updated_at=datetime('now')
	`)
	must(err)
	chat, err := core.SendChat(ctx, appcore.ChatRequest{Channel: "desktop_restore_check", UserID: "desktop_restore_check", Message: "请记住：Desktop restore drill memory marker。"})
	must(err)
	backupResult, err := core.CreateBackup(ctx)
	must(err)
	must(core.Shutdown(ctx))

	for _, suffix := range []string{"", "-wal", "-shm"} {
		path := cfg.App.SQLitePath + suffix
		if _, err := os.Stat(path); err == nil {
			must(os.Rename(path, path+".moved"))
		}
	}

	restored, err := appcore.NewAppCore(ctx, cfg, logger)
	must(err)
	must(restored.Start(ctx))
	must(restored.RestoreBackup(ctx, backupResult.Path))
	trace, err := restored.GetRunTrace(ctx, chat.RunID)
	must(err)
	memories, err := restored.ListMemories(ctx, appcore.MemoryFilter{Query: "restore drill", Limit: 10})
	must(err)
	settings, err := restored.GetDesktopSettings(ctx)
	must(err)
	must(restored.Shutdown(ctx))

	payload := map[string]any{
		"ok":                   true,
		"backup_path":          backupResult.Path,
		"restored_run_id":      trace.ID,
		"restored_steps":       len(trace.Steps),
		"restored_memories":    len(memories.Memories),
		"restored_model":       settings.ModelName,
		"secrets_in_backup":    backupContainsSecrets(backupResult.Path),
		"restored_sqlite_path": cfg.App.SQLitePath,
	}
	raw, _ := json.MarshalIndent(payload, "", "  ")
	fmt.Println(string(raw))
	if payload["secrets_in_backup"].(bool) {
		os.Exit(1)
	}
}

func backupContainsSecrets(path string) bool {
	reader, err := zip.OpenReader(path)
	if err != nil {
		return true
	}
	defer reader.Close()
	for _, file := range reader.File {
		name := strings.ToLower(file.Name)
		if strings.Contains(name, "secret") || strings.HasSuffix(name, ".env") {
			return true
		}
	}
	return false
}

func setDefault(key string, value string) {
	if strings.TrimSpace(os.Getenv(key)) == "" {
		_ = os.Setenv(key, value)
	}
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
