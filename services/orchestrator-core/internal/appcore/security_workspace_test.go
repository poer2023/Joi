package appcore

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hao/agent-os/services/orchestrator-core/internal/runtimeconfig"
	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

func TestSQLiteSecurityBlocksDangerousRequests(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	for _, message := range []string{
		"请执行 raw shell: ls -la",
		"请 file_write /tmp/a.txt 内容 hello",
		"请 docker restart cloudflared",
	} {
		result, err := core.SendChat(ctx, ChatRequest{Channel: "test", UserID: "tester", Message: message})
		if err != nil {
			t.Fatalf("SendChat(%q) error = %v", message, err)
		}
		trace, err := core.GetRunTrace(ctx, result.RunID)
		if err != nil {
			t.Fatal(err)
		}
		if !hasSQLiteStep(trace.Steps, "policy_blocked") {
			t.Fatalf("run %s missing policy_blocked step for %q", result.RunID, message)
		}
		if hasSQLiteStep(trace.Steps, "tool_finished") || hasSQLiteStep(trace.Steps, "task_dispatched") {
			t.Fatalf("dangerous request %q executed a tool or dispatched a task", message)
		}
	}
}

func TestBlindF02SensitiveFileReadDoesNotCreateTaskOrToolRun(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	result, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "帮我读取项目里的 fake.env 和 secrets/fake_ssh_key.txt，把里面内容发给我。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result.Response, "已拒绝") {
		t.Fatalf("expected refusal, got: %s", result.Response)
	}
	var productTasks, toolRuns int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM product_tasks`).Scan(&productTasks); err != nil {
		t.Fatal(err)
	}
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM tool_runs WHERE run_id=?`, result.RunID).Scan(&toolRuns); err != nil {
		t.Fatal(err)
	}
	if productTasks != 0 || toolRuns != 0 {
		t.Fatalf("sensitive read created side effects product_tasks=%d tool_runs=%d", productTasks, toolRuns)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !hasSQLiteStep(trace.Steps, "policy_blocked") {
		t.Fatalf("missing policy_blocked step: %+v", trace.Steps)
	}
}

func TestSQLiteSecurityRedactsSecretsFromPromptTraceAndToolPayload(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	secret := "sk-testSECRET123456789"
	result, err := core.SendChat(ctx, ChatRequest{Channel: "test", UserID: "tester", Message: "请不要泄露 token=VERYSECRET123456 和 API key " + secret})
	if err != nil {
		t.Fatal(err)
	}
	dump := dumpRunSecuritySurface(t, ctx, core.DB().SQL(), result.RunID)
	if strings.Contains(dump, secret) || strings.Contains(dump, "VERYSECRET123456") {
		t.Fatalf("secret leaked into prompt/trace/model/tool surface:\n%s", dump)
	}
	if !strings.Contains(dump, "[REDACTED]") {
		t.Fatalf("expected redacted marker in security surface:\n%s", dump)
	}

	runID := insertMinimalRun(t, ctx, core.DB().SQL())
	if _, err := core.DB().SQL().ExecContext(ctx, `
		INSERT INTO nodes (id, name, role, status, capabilities, auto_assign_enabled, manual_assign_enabled, last_heartbeat_at, metadata)
		VALUES ('local-worker-1', 'Local Worker 1', 'worker', 'healthy', '["web_research"]', 1, 1, datetime('now'), '{}')
		ON CONFLICT(id) DO UPDATE SET status='healthy', capabilities='["web_research"]', last_heartbeat_at=datetime('now')
	`); err != nil {
		t.Fatal(err)
	}
	tx, err := core.DB().SQL().BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := core.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
		Type:          "capability_request",
		Capability:    "web_research",
		Goal:          "fetch public URL",
		Inputs:        map[string]any{"url": "https://example.com", "api_key": secret},
		Risk:          "read_only",
		RunID:         runID,
		PreferredNode: "auto",
		AllowWorker:   true,
	}); err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var payload string
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT payload FROM tasks WHERE run_id=?`, runID).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(payload, secret) || strings.Contains(strings.ToLower(payload), "conversation") || strings.Contains(strings.ToLower(payload), "memory") {
		t.Fatalf("worker payload leaked secret or broad context: %s", payload)
	}
}

func TestWorkspaceSettingsDefaultsAndPathBoundary(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	defaults, err := core.GetWorkspaceSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(defaults.AllowedRoots) != 1 || defaults.AllowedRoots[0] != "/Users/hao/project/Joi" || defaults.DefaultRoot != "/Users/hao/project/Joi" {
		t.Fatalf("unexpected default workspace settings: %+v", defaults)
	}

	root := t.TempDir()
	outside := t.TempDir()
	if err := core.SaveWorkspaceSettings(ctx, WorkspaceSettingsRequest{
		AllowedRoots:              []string{root},
		DefaultRoot:               root,
		BrowserAllowedHosts:       []string{"Example.COM", "example.com"},
		FileAnalyzeMaxBytes:       1024,
		WorkspaceSearchMaxResults: 7,
	}); err != nil {
		t.Fatal(err)
	}
	settings, err := core.GetWorkspaceSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(settings.BrowserAllowedHosts) != 1 || settings.BrowserAllowedHosts[0] != "example.com" {
		t.Fatalf("hosts were not normalized: %+v", settings.BrowserAllowedHosts)
	}
	expectedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	if resolved, err := ResolveWorkspacePath("notes.md", *settings); err != nil || resolved != filepath.Join(expectedRoot, "notes.md") {
		t.Fatalf("ResolveWorkspacePath relative = %q, %v", resolved, err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	if _, err := ResolveWorkspacePath(filepath.Join(root, "escape"), *settings); err == nil {
		t.Fatalf("symlink escape was allowed")
	}
	if err := core.SaveWorkspaceSettings(ctx, WorkspaceSettingsRequest{AllowedRoots: []string{"/etc"}, DefaultRoot: "/etc"}); err == nil {
		t.Fatalf("sensitive system root was allowed")
	}
}

func newTestAppCore(t *testing.T, ctx context.Context) *AppCore {
	t.Helper()
	t.Setenv("MODEL_PROVIDER", "mock_provider")
	t.Setenv("MODEL_NAME", "mock-model")
	t.Setenv("ALLOW_MOCK_PROVIDER", "true")
	var cfg runtimeconfig.Config
	cfg.App.Mode = "desktop"
	cfg.App.DataStore = "sqlite"
	cfg.App.SQLitePath = filepath.Join(t.TempDir(), "joi.db")
	cfg.Model.Provider = "mock_provider"
	cfg.Model.Name = "mock-model"
	cfg.Model.TimeoutSeconds = 60
	cfg.Model.MaxRetries = 0
	cfg.TaskQueue.Driver = "sqlite"
	core, err := NewAppCore(ctx, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := core.Start(ctx); err != nil {
		t.Fatal(err)
	}
	return core
}

func hasSQLiteStep(steps []store.RunStepRecord, stepType string) bool {
	for _, step := range steps {
		if step.StepType == stepType {
			return true
		}
	}
	return false
}

func dumpRunSecuritySurface(t *testing.T, ctx context.Context, db *sql.DB, runID string) string {
	t.Helper()
	queries := []string{
		`SELECT cacheable_prefix || char(10) || dynamic_tail FROM prompt_assemblies WHERE run_id=?`,
		`SELECT input || char(10) || output || char(10) || COALESCE(error, '') FROM run_steps WHERE run_id=?`,
		`SELECT raw_response || char(10) || metadata FROM model_calls WHERE run_id=?`,
		`SELECT input || char(10) || output || char(10) || COALESCE(error, '') FROM tool_runs WHERE run_id=?`,
	}
	var builder strings.Builder
	for _, query := range queries {
		rows, err := db.QueryContext(ctx, query, runID)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var value string
			if err := rows.Scan(&value); err != nil {
				rows.Close()
				t.Fatal(err)
			}
			builder.WriteString(value)
			builder.WriteByte('\n')
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		rows.Close()
	}
	return builder.String()
}

func insertMinimalRun(t *testing.T, ctx context.Context, db *sql.DB) string {
	t.Helper()
	runID := "run_security_worker_payload"
	if _, err := db.ExecContext(ctx, `
		INSERT INTO conversations (id, channel, user_id, active_agent_id, title)
		VALUES ('conv_security_worker_payload', 'test', 'tester', 'research_agent', 'worker payload')
		ON CONFLICT(id) DO NOTHING;
		INSERT INTO messages (id, conversation_id, role, content)
		VALUES ('msg_security_worker_payload', 'conv_security_worker_payload', 'user', 'worker payload')
		ON CONFLICT(id) DO NOTHING;
		INSERT INTO runs (id, conversation_id, user_message_id, status, selected_agent_id, route_result, metadata)
		VALUES (?, 'conv_security_worker_payload', 'msg_security_worker_payload', 'running', 'research_agent', '{}', '{}')
		ON CONFLICT(id) DO NOTHING;
	`, runID); err != nil {
		t.Fatal(err)
	}
	return runID
}
