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
	blockedOutput := latestToolRunOutput(t, ctx, core, blocked.RunID)
	if blockedOutput["fetch_status"] != "policy_blocked" || blockedOutput["reason"] != "private_host_not_allowed" {
		t.Fatalf("private host was not blocked by default: %+v", blockedOutput)
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
