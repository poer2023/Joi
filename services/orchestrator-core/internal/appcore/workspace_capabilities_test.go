package appcore

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

func TestSQLiteWorkspaceSearchCapability(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	result, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "在当前项目里找 Run Trace 的设计文档",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result.Response, "Run Trace") {
		t.Fatalf("response does not mention Run Trace: %s", result.Response)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	for _, stepType := range []string{"capability_requested", "policy_checked", "tool_compiled", "node_selected", "tool_started", "tool_finished"} {
		if !hasSQLiteStep(trace.Steps, stepType) {
			t.Fatalf("workspace_search trace missing %s", stepType)
		}
	}
	if !hasSQLiteCapability(trace.Steps, "workspace_search") {
		t.Fatalf("trace missing workspace_search capability request")
	}
	output := latestToolRunOutput(t, ctx, core, result.RunID)
	if output["mode"] != "workspace_search_v1_go_walk" {
		t.Fatalf("unexpected mode: %+v", output)
	}
	results := mapSliceForTest(t, output["results"])
	if len(results) == 0 {
		t.Fatalf("workspace_search returned no results: %+v", output)
	}
	foundTraceDoc := false
	for _, item := range results {
		path, _ := item["path"].(string)
		snippet, _ := item["snippet"].(string)
		if strings.Contains(path, "docs/14_RUN_TRACE_OBSERVABILITY.md") || strings.Contains(snippet, "Run Trace") {
			foundTraceDoc = true
			break
		}
	}
	if !foundTraceDoc {
		t.Fatalf("workspace_search did not return Run Trace doc evidence: %+v", results)
	}
}

func TestSQLiteFileAnalyzeCapability(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	result, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "读一下 AGENTS.md，总结 capability 实现不能违反哪些红线",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result.Response, "Tool Compiler") || !strings.Contains(result.Response, "Run Trace") {
		t.Fatalf("response missing capability red-line summary: %s", result.Response)
	}
	if len([]rune(result.Response)) > 1800 {
		t.Fatalf("file_analyze response appears too close to raw full-file output: %d runes", len([]rune(result.Response)))
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	for _, stepType := range []string{"capability_requested", "policy_checked", "tool_compiled", "node_selected", "tool_started", "tool_finished"} {
		if !hasSQLiteStep(trace.Steps, stepType) {
			t.Fatalf("file_analyze trace missing %s", stepType)
		}
	}
	if !hasSQLiteCapability(trace.Steps, "file_analyze") {
		t.Fatalf("trace missing file_analyze capability request")
	}
	output := latestToolRunOutput(t, ctx, core, result.RunID)
	if !strings.HasSuffix(stringValue(output["path"]), "AGENTS.md") {
		t.Fatalf("unexpected analyzed path: %+v", output)
	}
	if output["extension"] != "md" || output["truncated"] != false {
		t.Fatalf("unexpected file metadata: %+v", output)
	}
	if intValue(output["size"]) <= 0 {
		t.Fatalf("missing file size: %+v", output)
	}
	excerpts := mapSliceForTest(t, output["excerpts"])
	if len(excerpts) == 0 {
		t.Fatalf("file_analyze returned no excerpts: %+v", output)
	}
}

func TestSQLiteFileAnalyzeRejectsSymlinkEscape(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.md"), []byte("secret=SHOULD_NOT_READ"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret.md"), filepath.Join(root, "linked.md")); err != nil {
		t.Fatal(err)
	}
	if err := core.SaveWorkspaceSettings(ctx, WorkspaceSettingsRequest{
		AllowedRoots:              []string{root},
		DefaultRoot:               root,
		FileAnalyzeMaxBytes:       1024,
		WorkspaceSearchMaxResults: 10,
	}); err != nil {
		t.Fatal(err)
	}
	runID := insertMinimalRun(t, ctx, core.DB().SQL())
	tx, err := core.DB().SQL().BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = core.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
		Type:       "capability_request",
		Capability: "file_analyze",
		Goal:       "try symlink escape",
		Inputs:     map[string]any{"path": filepath.Join(root, "linked.md"), "question": "summarize"},
		Risk:       "read_only",
		RunID:      runID,
	})
	_ = tx.Rollback()
	if err == nil {
		t.Fatalf("symlink escape was allowed")
	}
}

func hasSQLiteCapability(steps []store.RunStepRecord, capability string) bool {
	for _, step := range steps {
		if step.StepType != "capability_requested" {
			continue
		}
		if got, _ := step.Output["capability"].(string); store.CanonicalCapabilityName(got) == capability {
			return true
		}
	}
	return false
}

func latestToolRunOutput(t *testing.T, ctx context.Context, core *AppCore, runID string) map[string]any {
	t.Helper()
	var raw string
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT output FROM tool_runs WHERE run_id=? ORDER BY created_at DESC LIMIT 1`, runID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	output := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &output); err != nil {
		t.Fatal(err)
	}
	return output
}

func mapSliceForTest(t *testing.T, value any) []map[string]any {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	items := []map[string]any{}
	if err := json.Unmarshal(raw, &items); err != nil {
		t.Fatal(err)
	}
	return items
}

func stringValue(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

func intValue(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return 0
	}
}
