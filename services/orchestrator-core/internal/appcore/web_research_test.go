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
	var streamed []string
	result, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "请读取 " + server.URL + " 并总结",
		EventSink: func(eventName string, payload map[string]any) {
			if eventName == "assistant.delta" {
				streamed = append(streamed, stringValue(payload["text"]))
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ProductTask != nil || len(result.Artifacts) != 0 {
		t.Fatalf("URL summary should run capability without product task/artifact by default: task=%+v artifacts=%d", result.ProductTask, len(result.Artifacts))
	}
	if len(streamed) < 2 || strings.Join(streamed, "") != result.Response {
		t.Fatalf("URL summary should stream final response deltas before completion: chunks=%d joined=%q response=%q", len(streamed), strings.Join(streamed, ""), result.Response)
	}
	for _, heading := range []string{"一句话总结：", "主要内容：", "值得关注：", "来源："} {
		if !strings.Contains(result.Response, heading) {
			t.Fatalf("URL response should be structured summary and include %q, got: %s", heading, result.Response)
		}
	}
	if strings.Contains(result.Response, "正文提要") {
		t.Fatalf("URL response should not expose raw excerpt framing, got: %s", result.Response)
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
	for _, stepType := range []string{"capability_requested", "tool_started", "tool_finished", "web_summary_written"} {
		if !hasSQLiteStep(trace.Steps, stepType) {
			t.Fatalf("URL summary trace missing %s: %+v", stepType, trace.Steps)
		}
	}
}

func TestSQLiteWebResearchFollowupUsesPreviousURL(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(`<html><head><title>Followup Page</title></head><body><article><h1>Followup Page</h1><p>Joi followup URL reuse fixture explains app summaries and report reuse.</p></article></body></html>`))
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
	first, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "帮我总结这个网站内容 " + server.URL,
	})
	if err != nil {
		t.Fatal(err)
	}
	followup, err := core.SendChat(ctx, ChatRequest{
		ConversationID: first.ConversationID,
		Channel:        "test",
		UserID:         "tester",
		Message:        "帮我把这个网页总结整理成一份 Markdown 报告",
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(followup.Response, "请把网页链接发给我") || strings.Contains(followup.Response, "网页链接") {
		t.Fatalf("follow-up should reuse previous URL instead of asking again: %s", followup.Response)
	}
	if !strings.Contains(followup.Response, "一句话总结：") || !strings.Contains(followup.Response, server.URL) {
		t.Fatalf("follow-up should summarize previous URL with source, got: %s", followup.Response)
	}
	if followup.UI == nil || !followup.UI.InlineExecution {
		t.Fatalf("follow-up URL reuse should still be inline execution: %+v", followup.UI)
	}
	trace, err := core.GetRunTrace(ctx, followup.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !hasSQLiteCapability(trace.Steps, "web_research") || !hasSQLiteStep(trace.Steps, "tool_finished") {
		t.Fatalf("follow-up URL reuse should execute web_research: %+v", trace.Steps)
	}
}
