package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/pkg/appcore"
	"github.com/hao/agent-os/services/orchestrator-core/pkg/runtimeconfig"
)

func main() {
	root, err := os.MkdirTemp("", "joi-diagnostics-check-*")
	if err != nil {
		fail(err)
	}
	defer os.RemoveAll(root)

	mustSet("APP_MODE", "desktop")
	mustSet("DATA_STORE", "sqlite")
	mustSet("TASK_QUEUE_DRIVER", "sqlite")
	mustSet("MODEL_PROVIDER", "mock_provider")
	mustSet("MODEL_NAME", "mock-model")
	mustSet("ALLOW_MOCK_PROVIDER", "true")
	mustSet("MODEL_API_KEY", "diagnostic-model-secret-value")
	mustSet("TELEGRAM_BOT_TOKEN", "diagnostic-telegram-secret-value")
	mustSet("WORKER_TOKEN", "diagnostic-worker-secret-value")
	mustSet("NODE_SECRET", "diagnostic-node-secret-value")
	mustSet("SQLITE_PATH", filepath.Join(root, "joi.db"))
	mustSet("SQLITE_SCHEMA_PATH", filepath.Join(repoRoot(), "database", "sqlite", "001_init_schema.sql"))

	ctx := context.Background()
	cfg := runtimeconfig.Load()
	core, err := appcore.NewAppCore(ctx, cfg, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err != nil {
		fail(err)
	}
	defer core.Shutdown(ctx)
	if err := core.Start(ctx); err != nil {
		fail(err)
	}
	if _, err := core.SendChat(ctx, appcore.ChatRequest{Channel: "desktop_diagnostics_check", UserID: "diagnostics_check", Message: "你现在是什么系统？用一句话回答。"}); err != nil {
		fail(err)
	}
	exported, err := core.ExportDiagnostics(ctx)
	if err != nil {
		fail(err)
	}
	leaks, entries, err := inspectZip(exported.Path)
	if err != nil {
		fail(err)
	}
	if len(leaks) > 0 {
		fail(fmt.Errorf("diagnostics export leaked sensitive values: %s", strings.Join(leaks, ", ")))
	}
	result := map[string]any{
		"ok":              true,
		"path":            exported.Path,
		"entries":         entries,
		"secrets_leaked":  false,
		"plaintext_check": "passed",
	}
	raw, _ := json.MarshalIndent(result, "", "  ")
	fmt.Println(string(raw))
}

func mustSet(key string, value string) {
	if err := os.Setenv(key, value); err != nil {
		fail(err)
	}
}

func inspectZip(path string) ([]string, []string, error) {
	reader, err := zip.OpenReader(path)
	if err != nil {
		return nil, nil, err
	}
	defer reader.Close()
	secretValues := []string{
		"diagnostic-model-secret-value",
		"diagnostic-telegram-secret-value",
		"diagnostic-worker-secret-value",
		"diagnostic-node-secret-value",
	}
	entries := []string{}
	leaks := []string{}
	for _, file := range reader.File {
		entries = append(entries, file.Name)
		rc, err := file.Open()
		if err != nil {
			return nil, nil, err
		}
		content, _ := io.ReadAll(io.LimitReader(rc, 2*1024*1024))
		_ = rc.Close()
		for _, secret := range secretValues {
			if bytes.Contains(content, []byte(secret)) {
				leaks = append(leaks, file.Name+":"+secret)
			}
		}
	}
	return leaks, entries, nil
}

func repoRoot() string {
	wd, _ := os.Getwd()
	for {
		if _, err := os.Stat(filepath.Join(wd, "database", "sqlite", "001_init_schema.sql")); err == nil {
			return wd
		}
		next := filepath.Dir(wd)
		if next == wd {
			return "."
		}
		wd = next
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
