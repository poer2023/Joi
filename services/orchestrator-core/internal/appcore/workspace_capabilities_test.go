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

func TestSQLiteDesktopAppListCapability(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	result, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "帮我列出本地所有 app",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result.Response, "本机应用") && !strings.Contains(result.Response, "本机 app") {
		t.Fatalf("desktop app list response should describe local apps: %s", result.Response)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	for _, stepType := range []string{"capability_requested", "capability_semantic_checked", "policy_checked", "workflow_compiled", "tool_step_started", "tool_step_completed", "tool_finished"} {
		if !hasSQLiteStep(trace.Steps, stepType) {
			t.Fatalf("desktop_app_list trace missing %s", stepType)
		}
	}
	if !hasSQLiteCapability(trace.Steps, "desktop_app_list") {
		t.Fatalf("trace missing desktop_app_list capability request")
	}
	if hasSQLiteCapability(trace.Steps, "system_health_check") {
		t.Fatalf("desktop app list should not request system_health_check: %+v", trace.Steps)
	}
	output := latestToolRunOutput(t, ctx, core, result.RunID)
	if output["mode"] != "desktop_app_list_v1_bundle_scan" {
		t.Fatalf("unexpected desktop_app_list mode: %+v", output)
	}
	apps := mapSliceForTest(t, output["apps"])
	if len(apps) > 0 {
		if strings.Contains(result.Response, "前几项包括") {
			t.Fatalf("desktop app list response should not be a preview-only summary: %s", result.Response)
		}
		for _, app := range apps {
			name := stringValue(app["name"])
			if name == "" {
				continue
			}
			if !strings.Contains(result.Response, name) {
				t.Fatalf("desktop app list response missing app name %q: %s", name, result.Response)
			}
		}
	}
	var healthRuns int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM tool_runs WHERE run_id=? AND capability_id='system_health_check'`, result.RunID).Scan(&healthRuns); err != nil {
		t.Fatal(err)
	}
	if healthRuns != 0 {
		t.Fatalf("desktop app list created %d system_health_check runs", healthRuns)
	}
}

func TestSQLiteDesktopAppFollowupGroundsOnPreviousToolResult(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	listResult, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "帮我列出本地所有 app",
	})
	if err != nil {
		t.Fatal(err)
	}
	listOutput := latestToolRunOutput(t, ctx, core, listResult.RunID)
	apps := mapSliceForTest(t, listOutput["apps"])
	if len(apps) == 0 {
		t.Fatalf("desktop_app_list returned no apps")
	}
	target := firstNonEmptyDesktopAppName(apps, "赛博朋克 2077", "Cyberpunk 2077")
	if target == "" {
		target = stringValue(apps[len(apps)-1]["name"])
	}
	if target == "" {
		t.Fatalf("could not choose app target from %+v", apps)
	}
	followup, err := core.SendChat(ctx, ChatRequest{
		ConversationID: listResult.ConversationID,
		Channel:        "test",
		UserID:         "tester",
		Message:        "你确定有" + target + "？",
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(followup.Response, "没有关于你设备上是否安装") || strings.Contains(followup.Response, "没有直接证据") {
		t.Fatalf("follow-up should not deny existing tool evidence: %s", followup.Response)
	}
	if !strings.Contains(followup.Response, "根据上一轮 desktop_app_list 工具结果") || !strings.Contains(followup.Response, "tool_run_id=") {
		t.Fatalf("follow-up should cite previous desktop_app_list evidence: %s", followup.Response)
	}
	if !strings.Contains(followup.Response, target) && !strings.Contains(target, "赛博朋克") {
		t.Fatalf("follow-up response missing target %q: %s", target, followup.Response)
	}
	if strings.Contains(target, "赛博朋克") || strings.Contains(target, "Cyberpunk") {
		for _, want := range []string{"/Users/hao/Applications/Cyberpunk 2077.app", "/Users/hao/Applications/赛博朋克 2077.app"} {
			if !appPathExistsInList(apps, want) {
				continue
			}
			if !strings.Contains(followup.Response, want) {
				t.Fatalf("cyberpunk follow-up response missing path %q: %s", want, followup.Response)
			}
		}
	}
	trace, err := core.GetRunTrace(ctx, followup.RunID)
	if err != nil {
		t.Fatal(err)
	}
	for _, stepType := range []string{"conversation_context_resolved", "recent_tool_evidence_resolved", "followup_grounded"} {
		if !hasSQLiteStep(trace.Steps, stepType) {
			t.Fatalf("follow-up trace missing %s", stepType)
		}
	}
	if hasSQLiteStep(trace.Steps, "model_call_finished") {
		t.Fatalf("grounded follow-up should answer from tool evidence before model call")
	}
	if countToolRunsForRun(t, ctx, core, followup.RunID) != 0 {
		t.Fatalf("grounded follow-up should not execute a new tool when previous evidence is enough")
	}
}

func TestSQLiteDesktopAppFollowupWithoutEvidenceRunsInspect(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	result, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "你确定有 TextEdit？",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result.Response, "desktop_app_inspect") {
		t.Fatalf("follow-up without evidence should report desktop_app_inspect confirmation: %s", result.Response)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	for _, stepType := range []string{"conversation_context_resolved", "capability_requested", "capability_semantic_checked", "tool_finished"} {
		if !hasSQLiteStep(trace.Steps, stepType) {
			t.Fatalf("inspect follow-up trace missing %s", stepType)
		}
	}
	if !hasSQLiteCapability(trace.Steps, "desktop_app_inspect") {
		t.Fatalf("trace missing desktop_app_inspect capability: %+v", trace.Steps)
	}
}

func TestSQLiteConversationContextPromptIncludesRecentHistoryAndSummarizedToolEvidence(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	listResult, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "帮我列出本地所有 app",
	})
	if err != nil {
		t.Fatal(err)
	}
	chat, err := core.SendChat(ctx, ChatRequest{
		ConversationID: listResult.ConversationID,
		Channel:        "test",
		UserID:         "tester",
		Message:        "谢谢，今天先这样",
	})
	if err != nil {
		t.Fatal(err)
	}
	trace, err := core.GetRunTrace(ctx, chat.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !hasSQLiteStep(trace.Steps, "conversation_context_resolved") || !hasSQLiteStep(trace.Steps, "recent_tool_evidence_resolved") {
		t.Fatalf("ordinary follow-up should resolve recent context and evidence: %+v", trace.Steps)
	}
	if hasSQLiteStep(trace.Steps, "followup_grounded") || hasSQLiteCapability(trace.Steps, "desktop_app_inspect") {
		t.Fatalf("ordinary chat should not trigger app confirmation: %+v", trace.Steps)
	}
	dynamicTail := latestPromptDynamicTail(t, ctx, core, chat.RunID)
	if !strings.Contains(dynamicTail, "RECENT_CONVERSATION") || !strings.Contains(dynamicTail, "RECENT_TOOL_EVIDENCE") {
		t.Fatalf("dynamic_tail missing recent context/evidence:\n%s", dynamicTail)
	}
	if strings.Contains(dynamicTail, "完整列表：") {
		t.Fatalf("dynamic_tail should not inject the full app-list answer:\n%s", dynamicTail)
	}
	if len([]rune(dynamicTail)) > 7000 {
		t.Fatalf("dynamic_tail should stay summarized, got %d runes", len([]rune(dynamicTail)))
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

func TestSQLiteReadmeStartupQuestionReturnsAnswerNotSearchDump(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte(`# Test Project

这是项目入口文档。

## 阅读顺序

1. AI_START_HERE.md
2. AGENTS.md
`), 0o644); err != nil {
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
	result, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "帮我看看 README 里这个项目怎么启动",
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(result.Response, "搜索完成") || strings.Contains(result.Response, "前 5 条") {
		t.Fatalf("README startup answer should not be a workspace search dump: %s", result.Response)
	}
	if !strings.Contains(result.Response, "README 里没有直接给出完整启动命令") || !strings.Contains(result.Response, "AI_START_HERE.md") {
		t.Fatalf("README startup answer should summarize what README actually says: %s", result.Response)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !hasSQLiteCapability(trace.Steps, "file_analyze") || !hasSQLiteStep(trace.Steps, "tool_finished") {
		t.Fatalf("README startup answer should use file_analyze trace: %+v", trace.Steps)
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

func latestPromptDynamicTail(t *testing.T, ctx context.Context, core *AppCore, runID string) string {
	t.Helper()
	var dynamicTail string
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT dynamic_tail FROM prompt_assemblies WHERE run_id=? ORDER BY created_at DESC LIMIT 1`, runID).Scan(&dynamicTail); err != nil {
		t.Fatal(err)
	}
	return dynamicTail
}

func countToolRunsForRun(t *testing.T, ctx context.Context, core *AppCore, runID string) int {
	t.Helper()
	var count int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM tool_runs WHERE run_id=?`, runID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func firstNonEmptyDesktopAppName(apps []map[string]any, preferred ...string) string {
	for _, want := range preferred {
		for _, app := range apps {
			name := stringValue(app["name"])
			if strings.EqualFold(name, want) {
				return name
			}
		}
	}
	for _, app := range apps {
		if name := stringValue(app["name"]); name != "" {
			return name
		}
	}
	return ""
}

func appPathExistsInList(apps []map[string]any, path string) bool {
	for _, app := range apps {
		if stringValue(app["path"]) == path {
			return true
		}
	}
	return false
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
