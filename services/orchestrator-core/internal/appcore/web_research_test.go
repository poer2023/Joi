package appcore

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestSQLiteWebResearchPrivateHostPolicy(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("Joi private allowlist fixture"))
	}))
	defer server.Close()

	blocked, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "@research 阅读 " + server.URL + " 并总结。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(blocked.Response, "policy_blocked") {
		t.Fatalf("private host response should be policy_blocked: %s", blocked.Response)
	}
	blockedTrace, err := core.GetRunTrace(ctx, blocked.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !hasSQLiteStep(blockedTrace.Steps, "capability_blocked") || hasSQLiteStep(blockedTrace.Steps, "tool_finished") {
		t.Fatalf("private host should be blocked before tool execution: %+v", blockedTrace.Steps)
	}

	parsed, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	if err := core.SaveWorkspaceSettings(ctx, WorkspaceSettingsRequest{
		AllowedRoots:                 []string{root},
		DefaultRoot:                  root,
		BrowserAllowedHosts:          []string{parsed.Host},
		WebResearchAllowPrivateHosts: true,
		FileAnalyzeMaxBytes:          1024,
		WorkspaceSearchMaxResults:    10,
	}); err != nil {
		t.Fatal(err)
	}
	allowed, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "@research 阅读 " + server.URL + " 并总结。",
	})
	if err != nil {
		t.Fatal(err)
	}
	allowedOutput := latestToolRunOutput(t, ctx, core, allowed.RunID)
	if allowedOutput["fetch_status"] != "succeeded" {
		t.Fatalf("allowlisted private host did not fetch: %+v", allowedOutput)
	}
	if !strings.Contains(stringValue(allowedOutput["readable_text"]), "Joi private allowlist fixture") {
		t.Fatalf("allowlisted fetch did not return fixture text: %+v", allowedOutput)
	}
	if allowedOutput["truncated"] != false {
		t.Fatalf("small allowlisted response was unexpectedly truncated: %+v", allowedOutput)
	}
}

func TestSQLiteWebResearchMetadataIPAlwaysBlocked(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	root := t.TempDir()
	if err := core.SaveWorkspaceSettings(ctx, WorkspaceSettingsRequest{
		AllowedRoots:                 []string{root},
		DefaultRoot:                  root,
		BrowserAllowedHosts:          []string{"169.254.169.254"},
		WebResearchAllowPrivateHosts: true,
		FileAnalyzeMaxBytes:          1024,
		WorkspaceSearchMaxResults:    10,
	}); err != nil {
		t.Fatal(err)
	}
	result, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "@research 阅读 http://169.254.169.254/latest/meta-data/ 并总结。",
	})
	if err != nil {
		t.Fatal(err)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if hasSQLiteStep(trace.Steps, "tool_finished") {
		t.Fatalf("metadata IP should be blocked before tool execution")
	}
	if !strings.Contains(result.Response, "policy_blocked") {
		t.Fatalf("metadata IP response should be policy_blocked: %s", result.Response)
	}
}

func TestSQLiteWebResearchMissingURLAsksForLink(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	result, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "你可以帮我总结网页内容么",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result.Response, "网页链接") {
		t.Fatalf("missing-url response should ask for a link, got: %s", result.Response)
	}
	if result.ProductTask != nil {
		t.Fatalf("missing-url clarification should not create product task: %+v", result.ProductTask)
	}
	if result.UI == nil || result.UI.InteractionClass != "clarify" || !result.UI.RequiresUserInput || result.UI.MissingInput != "url" || result.UI.InlineExecution {
		t.Fatalf("missing-url UI hints not set for quiet clarification: %+v", result.UI)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !hasSQLiteStep(trace.Steps, "missing_input_clarified") {
		t.Fatalf("missing-url clarification should be traceable without capability noise: %+v", trace.Steps)
	}
	if hasSQLiteStep(trace.Steps, "capability_requested") || hasSQLiteStep(trace.Steps, "capability_blocked") {
		t.Fatalf("missing-url clarification should not request or block a capability: %+v", trace.Steps)
	}
	if hasSQLiteStep(trace.Steps, "tool_started") || hasSQLiteStep(trace.Steps, "tool_finished") {
		t.Fatalf("missing URL should clarify before tool execution: %+v", trace.Steps)
	}
	var toolRunCount int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM tool_runs WHERE run_id=?`, result.RunID).Scan(&toolRunCount); err != nil {
		t.Fatal(err)
	}
	if toolRunCount != 0 {
		t.Fatalf("missing URL should not create tool run, got %d", toolRunCount)
	}
}

func TestSQLiteWebResearchMissingURLStandaloneWebpageAsksForLink(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	result, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "你可以帮我总结网页么？",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result.Response, "网页链接") {
		t.Fatalf("missing-url response should ask for a link, got: %s", result.Response)
	}
	if result.ProductTask != nil || len(result.Artifacts) != 0 {
		t.Fatalf("standalone webpage clarification created task/artifact: task=%+v artifacts=%d", result.ProductTask, len(result.Artifacts))
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if trace.Metadata["interaction_class"] != "clarify" || trace.Metadata["ui_inline_execution"] != false {
		t.Fatalf("trace metadata should mark quiet clarification: %+v", trace.Metadata)
	}
	if hasSQLiteStep(trace.Steps, "capability_requested") || hasSQLiteStep(trace.Steps, "capability_blocked") || hasSQLiteStep(trace.Steps, "tool_started") {
		t.Fatalf("standalone webpage clarification should not enter tool flow: %+v", trace.Steps)
	}
}

func TestSQLiteWebResearchWithURLRunsWithoutProductTask(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("Joi public page summary fixture"))
	}))
	defer server.Close()
	parsed, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	if err := core.SaveWorkspaceSettings(ctx, WorkspaceSettingsRequest{
		AllowedRoots:                 []string{root},
		DefaultRoot:                  root,
		BrowserAllowedHosts:          []string{parsed.Host},
		WebResearchAllowPrivateHosts: true,
		FileAnalyzeMaxBytes:          1024,
		WorkspaceSearchMaxResults:    10,
	}); err != nil {
		t.Fatal(err)
	}
	result, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "请读取 " + server.URL + " 并总结",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ProductTask != nil || len(result.Artifacts) != 0 {
		t.Fatalf("URL summary should run capability without product task/artifact by default: task=%+v artifacts=%d", result.ProductTask, len(result.Artifacts))
	}
	if !strings.Contains(result.Response, "Joi public page summary fixture") {
		t.Fatalf("URL response should include extracted page content, got: %s", result.Response)
	}
	for _, leaked := range []string{"fetch_status", "task_attempts", "tool_runs", "Run Trace"} {
		if strings.Contains(result.Response, leaked) {
			t.Fatalf("URL response leaked internal field %q: %s", leaked, result.Response)
		}
	}
	if result.UI == nil || !result.UI.InlineExecution {
		t.Fatalf("URL capability run should allow inline execution UI: %+v", result.UI)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if len(trace.ModelCalls) != 0 {
		t.Fatalf("deterministic URL research should not record model calls, got: %+v", trace.ModelCalls)
	}
	for _, stepType := range []string{"capability_requested", "tool_started", "tool_finished"} {
		if !hasSQLiteStep(trace.Steps, stepType) {
			t.Fatalf("URL summary trace missing %s: %+v", stepType, trace.Steps)
		}
	}
}
