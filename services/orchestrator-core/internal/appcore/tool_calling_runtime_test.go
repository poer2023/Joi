package appcore

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hao/agent-os/services/orchestrator-core/internal/runtimeconfig"
	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

func TestToolCallingRuntimeWorkspaceSearchFileAnalyzeFinalAnswer(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "send_chat.go"), []byte(`package appcore

func SendChat() string {
	return "ok"
}
`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := core.SaveWorkspaceSettings(ctx, WorkspaceSettingsRequest{
		AllowedRoots:              []string{root},
		DefaultRoot:               root,
		FileAnalyzeMaxBytes:       4096,
		WorkspaceSearchMaxResults: 10,
	}); err != nil {
		t.Fatal(err)
	}

	result, err := core.SendChat(ctx, ChatRequest{
		Channel:     "test",
		UserID:      "tester",
		Message:     "Find SendChat symbol",
		InputMode:   "chat_assist",
		RuntimeMode: "tool_calling",
	})
	if err != nil {
		t.Fatalf("SendChat() error = %v", err)
	}
	if !strings.Contains(result.Response, "工具调用闭环") || !strings.Contains(result.Response, "send_chat.go") {
		t.Fatalf("unexpected response: %s", result.Response)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if trace.Status != "succeeded" {
		t.Fatalf("run status = %s, want succeeded", trace.Status)
	}
	for _, stepType := range []string{"prompt_assembled", "model_call_finished", "capability_requested", "tool_finished", "response_generated"} {
		if !hasSQLiteStep(trace.Steps, stepType) {
			t.Fatalf("tool calling trace missing %s", stepType)
		}
	}
	if hasSQLiteStep(trace.Steps, "agent_output_parse_failed") {
		t.Fatalf("tool calling runtime should not parse legacy JSON output: %+v", trace.Steps)
	}
	if !runHasTurnItem(t, ctx, core, result.RunID, "tool_call", "workspace_search") ||
		!runHasTurnItem(t, ctx, core, result.RunID, "tool_output", "file_analyze") {
		t.Fatalf("turn_items missing expected tool call/output")
	}
}

func TestToolCallingRuntimeToolErrorFeedsBackToModel(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	result, err := core.SendChat(ctx, ChatRequest{
		Channel:     "test",
		UserID:      "tester",
		Message:     "missing path",
		RuntimeMode: "tool_calling",
	})
	if err != nil {
		t.Fatalf("SendChat() error = %v", err)
	}
	if !strings.Contains(result.Response, "补充") {
		t.Fatalf("response should ask for missing input, got %s", result.Response)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if trace.Status != "succeeded" {
		t.Fatalf("run status = %s, want succeeded", trace.Status)
	}
	if !runHasTurnOutputError(t, ctx, core, result.RunID, "file_analyze", "MISSING_ARGUMENT") {
		t.Fatalf("missing MISSING_ARGUMENT tool output")
	}
}

func TestToolCallingRuntimeShellAndTestCommandFinalAnswer(t *testing.T) {
	ctx := context.Background()
	providerCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls++
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("provider path = %s", r.URL.Path)
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		switch latestProviderToolMessageName(payload) {
		case "":
			writeSSEToolCall(w, "call_shell_pwd", "shell_command", `{"cmd":["pwd"],"reason":"inspect workspace cwd"}`)
		case "shell_command":
			writeSSEToolCall(w, "call_go_test", "test_command", `{"cmd":["go","test","./..."],"reason":"run unit tests","timeout_seconds":30,"max_output_bytes":20000}`)
		case "test_command":
			_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Shell and test tools completed from real tool output.\"}}],\"usage\":{\"prompt_tokens\":8,\"completion_tokens\":6}}\n\n")
			_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
		default:
			t.Fatalf("unexpected last tool message: %s", latestProviderToolMessageName(payload))
		}
	}))
	defer server.Close()
	t.Setenv("MODEL_API_KEY", "test-key")
	var cfg runtimeconfig.Config
	cfg.App.Mode = "desktop"
	cfg.App.DataStore = "sqlite"
	cfg.App.SQLitePath = filepath.Join(t.TempDir(), "joi.db")
	cfg.Model.Provider = "openai_compatible"
	cfg.Model.BaseURL = server.URL
	cfg.Model.Name = "gpt-test"
	cfg.Model.TimeoutSeconds = 30
	cfg.TaskQueue.Driver = "sqlite"
	core, err := NewAppCore(ctx, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := core.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer core.Shutdown(ctx)

	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.com/joi-tool-e2e\n\ngo 1.23\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "sample_test.go"), []byte(`package sample

import "testing"

func TestSample(t *testing.T) {}
`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := core.SaveWorkspaceSettings(ctx, WorkspaceSettingsRequest{
		AllowedRoots:              []string{root},
		DefaultRoot:               root,
		FileAnalyzeMaxBytes:       4096,
		WorkspaceSearchMaxResults: 10,
	}); err != nil {
		t.Fatal(err)
	}

	result, err := core.SendChat(ctx, ChatRequest{
		Channel:           "test",
		UserID:            "tester",
		Message:           "Run pwd and then go test ./...",
		RuntimeMode:       "tool_calling",
		PermissionProfile: "read_only",
	})
	if err != nil {
		t.Fatalf("SendChat() error = %v", err)
	}
	if providerCalls != 3 {
		t.Fatalf("provider calls = %d, want 3", providerCalls)
	}
	if !strings.Contains(result.Response, "Shell and test tools completed") {
		t.Fatalf("unexpected response: %s", result.Response)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if trace.Status != "succeeded" {
		t.Fatalf("run status = %s, want succeeded", trace.Status)
	}
	for _, toolName := range []string{"shell_command", "test_command"} {
		if !runHasTurnItem(t, ctx, core, result.RunID, "tool_call", toolName) ||
			!runHasTurnItemStatus(t, ctx, core, result.RunID, "tool_output", toolName, "completed") {
			t.Fatalf("missing completed %s tool call/output", toolName)
		}
	}
	if !runToolOutputContains(t, ctx, core, result.RunID, "shell_command", root) {
		t.Fatalf("shell output did not include workspace cwd")
	}
	if !runToolOutputContains(t, ctx, core, result.RunID, "test_command", "ok") {
		t.Fatalf("test output did not include go test success")
	}
}

func TestToolCallingRuntimeFinalAcceptancePatchAndTestLoop(t *testing.T) {
	ctx := context.Background()
	providerCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls++
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("provider path = %s", r.URL.Path)
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		switch latestProviderToolMessageName(payload) {
		case "":
			writeSSEToolCall(w, "call_search_target", "workspace_search", `{"query":"func Message","goal":"find the code to edit"}`)
		case "workspace_search":
			writeSSEToolCall(w, "call_read_target", "file_read", `{"path":"target.go","start_line":1,"end_line":80,"goal":"read target.go before patch"}`)
		case "file_read":
			writeSSEToolCall(w, "call_patch_target", "apply_patch", `{"patch":"*** Begin Patch\n*** Update File: target.go\n@@\n func Message() string {\n-\treturn \"old\"\n+\treturn \"new\"\n }\n*** End Patch\n","reason":"make test pass"}`)
		case "apply_patch":
			writeSSEToolCall(w, "call_test_target", "test_command", `{"cmd":["go","test","./..."],"goal":"verify patched code","timeout_seconds":30,"max_output_bytes":20000}`)
		case "test_command":
			_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Final acceptance loop completed with patch and tests from real tool output.\"}}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":8}}\n\n")
			_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
		default:
			t.Fatalf("unexpected last tool message: %s", latestProviderToolMessageName(payload))
		}
	}))
	defer server.Close()
	t.Setenv("MODEL_API_KEY", "test-key")
	var cfg runtimeconfig.Config
	cfg.App.Mode = "desktop"
	cfg.App.DataStore = "sqlite"
	cfg.App.SQLitePath = filepath.Join(t.TempDir(), "joi.db")
	cfg.Model.Provider = "openai_compatible"
	cfg.Model.BaseURL = server.URL
	cfg.Model.Name = "gpt-test"
	cfg.Model.TimeoutSeconds = 30
	cfg.TaskQueue.Driver = "sqlite"
	core, err := NewAppCore(ctx, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := core.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer core.Shutdown(ctx)

	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.com/joi-final-acceptance\n\ngo 1.23\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "target.go"), []byte(`package sample

func Message() string {
	return "old"
}
`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "target_test.go"), []byte(`package sample

import "testing"

func TestMessage(t *testing.T) {
	if Message() != "new" {
		t.Fatalf("Message() = %q, want new", Message())
	}
}
`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := core.SaveWorkspaceSettings(ctx, WorkspaceSettingsRequest{
		AllowedRoots:              []string{root},
		DefaultRoot:               root,
		FileAnalyzeMaxBytes:       4096,
		WorkspaceSearchMaxResults: 10,
	}); err != nil {
		t.Fatal(err)
	}

	result, err := core.SendChat(ctx, ChatRequest{
		Channel:           "test",
		UserID:            "tester",
		Message:           "Find target.go, patch it so tests pass, then run go test ./...",
		RuntimeMode:       "tool_calling",
		PermissionProfile: "workspace_write",
	})
	if err != nil {
		t.Fatalf("SendChat() error = %v", err)
	}
	if providerCalls != 5 {
		t.Fatalf("provider calls = %d, want 5", providerCalls)
	}
	if !strings.Contains(result.Response, "Final acceptance loop completed") {
		t.Fatalf("unexpected response: %s", result.Response)
	}
	raw, err := os.ReadFile(filepath.Join(root, "target.go"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `return "new"`) || strings.Contains(string(raw), `return "old"`) {
		t.Fatalf("target.go was not patched:\n%s", raw)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if trace.Status != "succeeded" {
		t.Fatalf("run status = %s, want succeeded", trace.Status)
	}
	for _, toolName := range []string{"workspace_search", "file_read", "apply_patch", "test_command"} {
		if !runHasTurnItem(t, ctx, core, result.RunID, "tool_call", toolName) ||
			!runHasTurnItemStatus(t, ctx, core, result.RunID, "tool_output", toolName, "completed") {
			t.Fatalf("missing completed %s tool call/output", toolName)
		}
	}
	if !runToolOutputContains(t, ctx, core, result.RunID, "apply_patch", "target.go") {
		t.Fatalf("patch output did not include target.go")
	}
	if !runToolOutputContains(t, ctx, core, result.RunID, "test_command", "ok") {
		t.Fatalf("test output did not include go test success")
	}
}

func TestToolCallingRuntimeTestFailureFeedsBackThenPatchAndRetest(t *testing.T) {
	ctx := context.Background()
	providerCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls++
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("provider path = %s", r.URL.Path)
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		switch providerCalls {
		case 1:
			writeSSEToolCall(w, "call_test_initial_failure", "test_command", `{"cmd":["go","test","./..."],"goal":"run the existing test suite first","timeout_seconds":30,"max_output_bytes":20000}`)
		case 2:
			if latestProviderToolMessageName(payload) != "test_command" || !strings.Contains(latestProviderToolMessageContent(payload), "FAIL") {
				t.Fatalf("second model call did not receive failing test output: %+v", payload)
			}
			writeSSEToolCall(w, "call_search_after_failure", "workspace_search", `{"query":"func Message","goal":"locate code responsible for failing test"}`)
		case 3:
			if latestProviderToolMessageName(payload) != "workspace_search" {
				t.Fatalf("third model call latest tool = %s, want workspace_search", latestProviderToolMessageName(payload))
			}
			writeSSEToolCall(w, "call_read_after_failure", "file_read", `{"path":"target.go","start_line":1,"end_line":80,"goal":"read target.go before editing"}`)
		case 4:
			if latestProviderToolMessageName(payload) != "file_read" || !strings.Contains(latestProviderToolMessageContent(payload), `return \"old\"`) {
				t.Fatalf("fourth model call did not receive file_read output: %+v", payload)
			}
			writeSSEToolCall(w, "call_patch_after_failure", "apply_patch", `{"patch":"*** Begin Patch\n*** Update File: target.go\n@@\n func Message() string {\n-\treturn \"old\"\n+\treturn \"new\"\n }\n*** End Patch\n","reason":"fix failing TestMessage expectation"}`)
		case 5:
			if latestProviderToolMessageName(payload) != "apply_patch" || !strings.Contains(latestProviderToolMessageContent(payload), "target.go") {
				t.Fatalf("fifth model call did not receive apply_patch output: %+v", payload)
			}
			writeSSEToolCall(w, "call_test_after_patch", "test_command", `{"cmd":["go","test","./..."],"goal":"verify the patch fixed the failing test","timeout_seconds":30,"max_output_bytes":20000}`)
		case 6:
			if latestProviderToolMessageName(payload) != "test_command" || !strings.Contains(latestProviderToolMessageContent(payload), "ok") {
				t.Fatalf("sixth model call did not receive passing test output: %+v", payload)
			}
			_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Recovered from failing test output, patched target.go, and verified go test ./... passed.\"}}],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":9}}\n\n")
			_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
		default:
			t.Fatalf("unexpected provider call %d; latest tool=%s", providerCalls, latestProviderToolMessageName(payload))
		}
	}))
	defer server.Close()
	t.Setenv("MODEL_API_KEY", "test-key")
	var cfg runtimeconfig.Config
	cfg.App.Mode = "desktop"
	cfg.App.DataStore = "sqlite"
	cfg.App.SQLitePath = filepath.Join(t.TempDir(), "joi.db")
	cfg.Model.Provider = "openai_compatible"
	cfg.Model.BaseURL = server.URL
	cfg.Model.Name = "gpt-test"
	cfg.Model.TimeoutSeconds = 30
	cfg.TaskQueue.Driver = "sqlite"
	core, err := NewAppCore(ctx, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := core.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer core.Shutdown(ctx)

	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.com/joi-failure-recovery\n\ngo 1.23\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "target.go"), []byte(`package sample

func Message() string {
	return "old"
}
`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "target_test.go"), []byte(`package sample

import "testing"

func TestMessage(t *testing.T) {
	if Message() != "new" {
		t.Fatalf("Message() = %q, want new", Message())
	}
}
`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := core.SaveWorkspaceSettings(ctx, WorkspaceSettingsRequest{
		AllowedRoots:              []string{root},
		DefaultRoot:               root,
		FileAnalyzeMaxBytes:       4096,
		WorkspaceSearchMaxResults: 10,
	}); err != nil {
		t.Fatal(err)
	}

	result, err := core.SendChat(ctx, ChatRequest{
		Channel:           "test",
		UserID:            "tester",
		Message:           "Run tests, inspect failures, patch target.go, and rerun tests until it passes.",
		RuntimeMode:       "tool_calling",
		PermissionProfile: "workspace_write",
	})
	if err != nil {
		t.Fatalf("SendChat() error = %v", err)
	}
	if providerCalls != 6 {
		t.Fatalf("provider calls = %d, want 6", providerCalls)
	}
	if !strings.Contains(result.Response, "Recovered from failing test output") {
		t.Fatalf("unexpected response: %s", result.Response)
	}
	raw, err := os.ReadFile(filepath.Join(root, "target.go"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `return "new"`) || strings.Contains(string(raw), `return "old"`) {
		t.Fatalf("target.go was not patched:\n%s", raw)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if trace.Status != "succeeded" {
		t.Fatalf("run status = %s, want succeeded", trace.Status)
	}
	for _, toolName := range []string{"test_command", "workspace_search", "file_read", "apply_patch"} {
		if !runHasTurnItem(t, ctx, core, result.RunID, "tool_call", toolName) {
			t.Fatalf("missing %s tool call", toolName)
		}
	}
	if !runHasTurnItemStatus(t, ctx, core, result.RunID, "tool_output", "test_command", "failed") {
		t.Fatalf("missing failed initial test output")
	}
	if !runHasTurnItemStatus(t, ctx, core, result.RunID, "tool_output", "test_command", "completed") {
		t.Fatalf("missing completed final test output")
	}
	if !runToolOutputContains(t, ctx, core, result.RunID, "test_command", "FAIL") || !runToolOutputContains(t, ctx, core, result.RunID, "test_command", "ok") {
		t.Fatalf("test outputs did not preserve both failure and success evidence")
	}
	if !runToolOutputContains(t, ctx, core, result.RunID, "apply_patch", "target.go") {
		t.Fatalf("patch output did not include target.go")
	}
	for _, eventType := range []string{"model.started", "model.completed", "tool.call.started", "tool.output.delta", "tool.failed", "tool.finished", "run.completed"} {
		if !runHasEvent(t, ctx, core, result.RunID, eventType) {
			t.Fatalf("missing run event %s", eventType)
		}
	}
}

func TestToolCallingRuntimeApplyPatchPausesForConfirmation(t *testing.T) {
	ctx := context.Background()
	providerCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls++
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("provider path = %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		writeSSEToolCall(w, "call_apply_patch_confirm", "apply_patch", `{"patch":"*** Begin Patch\n*** Update File: target.txt\n@@\n-old\n+new\n*** End Patch\n","reason":"test confirmation pause"}`)
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()
	t.Setenv("MODEL_API_KEY", "test-key")
	var cfg runtimeconfig.Config
	cfg.App.Mode = "desktop"
	cfg.App.DataStore = "sqlite"
	cfg.App.SQLitePath = filepath.Join(t.TempDir(), "joi.db")
	cfg.Model.Provider = "openai_compatible"
	cfg.Model.BaseURL = server.URL
	cfg.Model.Name = "gpt-test"
	cfg.Model.TimeoutSeconds = 30
	cfg.TaskQueue.Driver = "sqlite"
	core, err := NewAppCore(ctx, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := core.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer core.Shutdown(ctx)
	root := t.TempDir()
	targetPath := filepath.Join(root, "target.txt")
	if err := os.WriteFile(targetPath, []byte("old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := core.SaveWorkspaceSettings(ctx, WorkspaceSettingsRequest{AllowedRoots: []string{root}, DefaultRoot: root}); err != nil {
		t.Fatal(err)
	}

	result, err := core.SendChat(ctx, ChatRequest{
		Channel:     "test",
		UserID:      "tester",
		Message:     "Patch target.txt",
		RuntimeMode: "tool_calling",
	})
	if err != nil {
		t.Fatalf("SendChat() error = %v", err)
	}
	if !strings.Contains(result.Response, "confirmation_required") {
		t.Fatalf("response = %q, want confirmation_required", result.Response)
	}
	if providerCalls != 1 {
		t.Fatalf("provider calls = %d, want 1 before confirmation", providerCalls)
	}
	raw, err := os.ReadFile(targetPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "old\n" {
		t.Fatalf("patch executed before confirmation, file = %q", string(raw))
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if trace.Status != "waiting_confirmation" {
		t.Fatalf("run status = %s, want waiting_confirmation", trace.Status)
	}
	confirmations, err := core.ListConfirmations(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(confirmations.Items) != 1 {
		t.Fatalf("confirmations = %d, want 1", len(confirmations.Items))
	}
	item := confirmations.Items[0]
	if item.CallID != "call_apply_patch_confirm" || item.TurnID == "" || item.ApprovalScope != "once" || item.ApprovalKey != "call_apply_patch_confirm" {
		t.Fatalf("confirmation anchor = %+v", item)
	}
	if !runHasTurnItemStatus(t, ctx, core, result.RunID, "tool_output", "apply_patch", "waiting_confirmation") {
		t.Fatalf("missing waiting apply_patch tool output")
	}
	if !runHasEvent(t, ctx, core, result.RunID, "approval.requested") || !runHasEvent(t, ctx, core, result.RunID, "run.waiting_confirmation") {
		t.Fatalf("missing approval/run waiting events")
	}
	if err := core.DecideConfirmation(ctx, ConfirmationDecisionRequest{ID: item.ID, Approve: false, Actor: "test", Reason: "reject test"}); err != nil {
		t.Fatal(err)
	}
	trace, err = core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if trace.Status != "failed" {
		t.Fatalf("run status after rejection = %s, want failed", trace.Status)
	}
	if !runHasEvent(t, ctx, core, result.RunID, "approval.resolved") || !runHasEvent(t, ctx, core, result.RunID, "run.failed") {
		t.Fatalf("missing approval resolved/run failed events")
	}
}

func TestToolCallingRuntimeApplyPatchApprovalResumesRun(t *testing.T) {
	ctx := context.Background()
	providerCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls++
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("provider path = %s", r.URL.Path)
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		switch latestProviderToolMessageName(payload) {
		case "":
			writeSSEToolCall(w, "call_apply_patch_resume", "apply_patch", `{"patch":"*** Begin Patch\n*** Update File: target.txt\n@@\n-old\n+new\n*** End Patch\n","reason":"test confirmation resume"}`)
		case "apply_patch":
			_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Patch resumed final answer.\"}}],\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":5}}\n\n")
			_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
		default:
			t.Fatalf("unexpected last tool message: %s", latestProviderToolMessageName(payload))
		}
	}))
	defer server.Close()
	t.Setenv("MODEL_API_KEY", "test-key")
	var cfg runtimeconfig.Config
	cfg.App.Mode = "desktop"
	cfg.App.DataStore = "sqlite"
	cfg.App.SQLitePath = filepath.Join(t.TempDir(), "joi.db")
	cfg.Model.Provider = "openai_compatible"
	cfg.Model.BaseURL = server.URL
	cfg.Model.Name = "gpt-test"
	cfg.Model.TimeoutSeconds = 30
	cfg.TaskQueue.Driver = "sqlite"
	core, err := NewAppCore(ctx, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := core.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer core.Shutdown(ctx)
	root := t.TempDir()
	targetPath := filepath.Join(root, "target.txt")
	if err := os.WriteFile(targetPath, []byte("old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := core.SaveWorkspaceSettings(ctx, WorkspaceSettingsRequest{AllowedRoots: []string{root}, DefaultRoot: root}); err != nil {
		t.Fatal(err)
	}

	result, err := core.SendChat(ctx, ChatRequest{
		Channel:     "test",
		UserID:      "tester",
		Message:     "Patch target.txt",
		RuntimeMode: "tool_calling",
	})
	if err != nil {
		t.Fatalf("SendChat() error = %v", err)
	}
	if providerCalls != 1 {
		t.Fatalf("provider calls before approval = %d, want 1", providerCalls)
	}
	confirmations, err := core.ListConfirmations(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(confirmations.Items) != 1 {
		t.Fatalf("confirmations = %d, want 1", len(confirmations.Items))
	}
	if err := core.DecideConfirmation(ctx, ConfirmationDecisionRequest{ID: confirmations.Items[0].ID, Approve: true, Actor: "test", Reason: "approve test"}); err != nil {
		t.Fatal(err)
	}
	if providerCalls != 2 {
		t.Fatalf("provider calls after approval = %d, want 2", providerCalls)
	}
	raw, err := os.ReadFile(targetPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "new\n" {
		t.Fatalf("patch result = %q, want new", string(raw))
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if trace.Status != "succeeded" {
		t.Fatalf("run status after approval = %s, want succeeded", trace.Status)
	}
	if !runHasTurnItemStatus(t, ctx, core, result.RunID, "tool_output", "apply_patch", "completed") {
		t.Fatalf("missing completed apply_patch tool output")
	}
	if !runHasEvent(t, ctx, core, result.RunID, "approval.resolved") || !runHasEvent(t, ctx, core, result.RunID, "run.completed") {
		t.Fatalf("missing approval resolved/run completed events")
	}
	var confirmationStatus, resumedAt string
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT status, COALESCE(resumed_at, '') FROM confirmation_requests WHERE id=?`, confirmations.Items[0].ID).Scan(&confirmationStatus, &resumedAt); err != nil {
		t.Fatal(err)
	}
	if confirmationStatus != "approved" || resumedAt == "" {
		t.Fatalf("confirmation status/resumed_at = %q/%q, want approved/resumed", confirmationStatus, resumedAt)
	}
	var finalMessages int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM messages WHERE conversation_id=? AND role='assistant' AND content LIKE '%Patch resumed final answer%'`, result.ConversationID).Scan(&finalMessages); err != nil {
		t.Fatal(err)
	}
	if finalMessages == 0 {
		t.Fatalf("missing resumed assistant final message")
	}
}

func TestToolCallingRuntimeWorkerAckResumesRun(t *testing.T) {
	ctx := context.Background()
	providerCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls++
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("provider path = %s", r.URL.Path)
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		switch latestProviderToolMessageName(payload) {
		case "":
			writeSSEToolCall(w, "call_worker_web_research", "web_research", `{"url":"https://example.com","goal":"read example"}`)
		case "web_research":
			_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Worker resumed final answer.\"}}],\"usage\":{\"prompt_tokens\":8,\"completion_tokens\":5}}\n\n")
			_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
		default:
			t.Fatalf("unexpected last tool message: %s", latestProviderToolMessageName(payload))
		}
	}))
	defer server.Close()
	t.Setenv("MODEL_API_KEY", "test-key")
	var cfg runtimeconfig.Config
	cfg.App.Mode = "desktop"
	cfg.App.DataStore = "sqlite"
	cfg.App.SQLitePath = filepath.Join(t.TempDir(), "joi.db")
	cfg.Model.Provider = "openai_compatible"
	cfg.Model.BaseURL = server.URL
	cfg.Model.Name = "gpt-test"
	cfg.Model.TimeoutSeconds = 30
	cfg.TaskQueue.Driver = "sqlite"
	core, err := NewAppCore(ctx, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := core.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer core.Shutdown(ctx)
	if _, err := core.DB().SQL().ExecContext(ctx, `
		INSERT INTO nodes (id, name, role, status, capabilities, assign_policy, auto_assign_enabled, manual_assign_enabled, last_heartbeat_at, metadata)
		VALUES ('worker-web', 'Worker Web', 'worker', 'healthy', '["web_research_v1"]', '{"allow_private_context":true}', 1, 1, datetime('now'), '{}')
		ON CONFLICT(id) DO UPDATE SET status='healthy', capabilities=excluded.capabilities, manual_assign_enabled=1, updated_at=datetime('now');
	`); err != nil {
		t.Fatal(err)
	}

	result, err := core.SendChat(ctx, ChatRequest{
		Channel:       "test",
		UserID:        "tester",
		Message:       "@research read https://example.com",
		RuntimeMode:   "tool_calling",
		PreferredNode: "worker-web",
		AllowWorker:   true,
	})
	if err != nil {
		t.Fatalf("SendChat() error = %v", err)
	}
	if providerCalls != 1 {
		t.Fatalf("provider calls before worker ack = %d, want 1", providerCalls)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if trace.Status != "waiting_tool" {
		t.Fatalf("run status = %s, want waiting_tool", trace.Status)
	}
	if !runHasTurnItemStatus(t, ctx, core, result.RunID, "tool_output", "web_research", "waiting_tool") {
		t.Fatalf("missing waiting web_research tool output")
	}
	task, err := core.Queue.Claim(ctx, "worker-web")
	if err != nil {
		t.Fatal(err)
	}
	if task == nil {
		t.Fatalf("worker did not claim task")
	}
	if err := core.ackWorkerGatewayTask(ctx, "worker-web", task.ID, store.TaskResult{Output: map[string]any{"status": "completed", "fetch_status": "succeeded", "summary": "Example worker summary"}}); err != nil {
		t.Fatal(err)
	}
	if providerCalls != 2 {
		t.Fatalf("provider calls after worker ack = %d, want 2", providerCalls)
	}
	trace, err = core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if trace.Status != "succeeded" {
		t.Fatalf("run status after worker ack = %s, want succeeded", trace.Status)
	}
	if !runHasTurnItemStatus(t, ctx, core, result.RunID, "tool_output", "web_research", "completed") {
		t.Fatalf("missing completed web_research tool output")
	}
	if !runHasEvent(t, ctx, core, result.RunID, "run.completed") {
		t.Fatalf("missing run.completed event")
	}
	var finalMessages int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM messages WHERE conversation_id=? AND role='assistant' AND content LIKE '%Worker resumed final answer%'`, result.ConversationID).Scan(&finalMessages); err != nil {
		t.Fatal(err)
	}
	if finalMessages == 0 {
		t.Fatalf("missing worker resumed final assistant message")
	}
}

func TestToolCallingRuntimeUsesChatCompletionsClientWhenConfigured(t *testing.T) {
	ctx := context.Background()
	providerCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls++
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("provider path = %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("provider authorization missing")
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload["stream"] != true {
			t.Fatalf("provider request should stream: %+v", payload)
		}
		lastToolName := latestProviderToolMessageName(payload)
		w.Header().Set("Content-Type", "text/event-stream")
		switch lastToolName {
		case "":
			writeSSEToolCall(w, "call_workspace_search_real", "workspace_search", `{"query":"SendChat","glob":"*.go","max_results":5}`)
		case "workspace_search":
			writeSSEToolCall(w, "call_file_analyze_real", "file_analyze", `{"path":"send_chat.go","question":"Summarize SendChat"}`)
		case "file_analyze":
			_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"真实 tool_calls 客户端已完成。\"}}],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":4}}\n\n")
			_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
		default:
			t.Fatalf("unexpected last tool message: %s", lastToolName)
		}
	}))
	defer server.Close()
	t.Setenv("MODEL_API_KEY", "test-key")
	var cfg runtimeconfig.Config
	cfg.App.Mode = "desktop"
	cfg.App.DataStore = "sqlite"
	cfg.App.SQLitePath = filepath.Join(t.TempDir(), "joi.db")
	cfg.Model.Provider = "openai_compatible"
	cfg.Model.BaseURL = server.URL
	cfg.Model.Name = "gpt-test"
	cfg.Model.TimeoutSeconds = 30
	cfg.TaskQueue.Driver = "sqlite"
	core, err := NewAppCore(ctx, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := core.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer core.Shutdown(ctx)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "send_chat.go"), []byte(`package appcore

func SendChat() string {
	return "ok"
}
`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := core.SaveWorkspaceSettings(ctx, WorkspaceSettingsRequest{
		AllowedRoots:              []string{root},
		DefaultRoot:               root,
		FileAnalyzeMaxBytes:       4096,
		WorkspaceSearchMaxResults: 10,
	}); err != nil {
		t.Fatal(err)
	}

	result, err := core.SendChat(ctx, ChatRequest{
		Channel:     "test",
		UserID:      "tester",
		Message:     "Find SendChat symbol",
		InputMode:   "chat_assist",
		RuntimeMode: "tool_calling",
	})
	if err != nil {
		t.Fatalf("SendChat() error = %v", err)
	}
	if result.Response != "真实 tool_calls 客户端已完成。" {
		trace, _ := core.GetRunTrace(ctx, result.RunID)
		t.Fatalf("response = %q; providerCalls=%d; steps=%+v", result.Response, providerCalls, trace.Steps)
	}
	if providerCalls != 3 {
		t.Fatalf("provider calls = %d, want 3", providerCalls)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if len(trace.ModelCalls) != 1 {
		t.Fatalf("model calls = %d, want 1", len(trace.ModelCalls))
	}
	if trace.ModelCalls[0].Provider != "openai_compatible" || trace.ModelCalls[0].Status != "succeeded" {
		t.Fatalf("model call not recorded as real provider: %+v", trace.ModelCalls[0])
	}
	if trace.ModelCalls[0].InputTokens <= 0 || trace.ModelCalls[0].OutputTokens <= 0 {
		t.Fatalf("model call usage not updated: %+v", trace.ModelCalls[0])
	}
	var supportsToolCalling int
	if err := core.DB().SQL().QueryRowContext(ctx, `
		SELECT m.supports_tool_calling
		FROM runs r
		JOIN models m ON m.id = r.selected_model_id
		WHERE r.id=?
	`, result.RunID).Scan(&supportsToolCalling); err != nil {
		t.Fatal(err)
	}
	if supportsToolCalling != 1 {
		t.Fatalf("selected model supports_tool_calling = %d, want 1", supportsToolCalling)
	}
}

func TestToolCallingRuntimeUsesResponsesClientWhenConfigured(t *testing.T) {
	ctx := context.Background()
	providerCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls++
		if r.URL.Path != "/v1/responses" {
			t.Fatalf("provider path = %s", r.URL.Path)
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		lastOutputCallID := latestResponsesFunctionOutputCallID(payload)
		w.Header().Set("Content-Type", "text/event-stream")
		switch lastOutputCallID {
		case "":
			writeResponsesSSEToolCall(w, 0, "call_workspace_search_response", "workspace_search", `{"query":"SendChat","glob":"*.go","max_results":5}`)
		case "call_workspace_search_response":
			writeResponsesSSEToolCall(w, 0, "call_file_analyze_response", "file_analyze", `{"path":"send_chat.go","question":"Summarize SendChat"}`)
		case "call_file_analyze_response":
			_, _ = fmt.Fprint(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Responses tool_calls 客户端已完成。\"}\n\n")
			_, _ = fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":9,\"output_tokens\":4}}}\n\n")
			_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
		default:
			t.Fatalf("unexpected output call_id: %s", lastOutputCallID)
		}
	}))
	defer server.Close()
	t.Setenv("MODEL_API_KEY", "test-key")
	t.Setenv("JOI_MODEL_API", "responses")
	var cfg runtimeconfig.Config
	cfg.App.Mode = "desktop"
	cfg.App.DataStore = "sqlite"
	cfg.App.SQLitePath = filepath.Join(t.TempDir(), "joi.db")
	cfg.Model.Provider = "openai_compatible"
	cfg.Model.BaseURL = server.URL
	cfg.Model.Name = "gpt-test"
	cfg.Model.TimeoutSeconds = 30
	cfg.TaskQueue.Driver = "sqlite"
	core, err := NewAppCore(ctx, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := core.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer core.Shutdown(ctx)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "send_chat.go"), []byte(`package appcore

func SendChat() string {
	return "ok"
}
`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := core.SaveWorkspaceSettings(ctx, WorkspaceSettingsRequest{
		AllowedRoots:              []string{root},
		DefaultRoot:               root,
		FileAnalyzeMaxBytes:       4096,
		WorkspaceSearchMaxResults: 10,
	}); err != nil {
		t.Fatal(err)
	}

	result, err := core.SendChat(ctx, ChatRequest{
		Channel:     "test",
		UserID:      "tester",
		Message:     "Find SendChat symbol",
		InputMode:   "chat_assist",
		RuntimeMode: "tool_calling",
	})
	if err != nil {
		t.Fatalf("SendChat() error = %v", err)
	}
	if result.Response != "Responses tool_calls 客户端已完成。" {
		t.Fatalf("response = %q", result.Response)
	}
	if providerCalls != 3 {
		t.Fatalf("provider calls = %d, want 3", providerCalls)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if len(trace.ModelCalls) != 1 || trace.ModelCalls[0].Metadata["client"] != "responses_tools" {
		t.Fatalf("model call should use responses client: %+v", trace.ModelCalls)
	}
}

func TestLegacyJSONRuntimeStillWorks(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	result, err := core.SendChat(ctx, ChatRequest{
		Channel:   "test",
		UserID:    "tester",
		Message:   "你好。",
		InputMode: "chat_assist",
	})
	if err != nil {
		t.Fatalf("SendChat() error = %v", err)
	}
	if !strings.Contains(result.Response, "Agent Runtime JSON") {
		t.Fatalf("legacy response changed: %s", result.Response)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if trace.Metadata["runtime_mode"] != "legacy_json" {
		t.Fatalf("runtime_mode = %v, want legacy_json", trace.Metadata["runtime_mode"])
	}
	if runHasAnyTurnItems(t, ctx, core, result.RunID) {
		t.Fatalf("legacy runtime should not write turn_items")
	}
}

func latestProviderToolMessageName(payload map[string]any) string {
	messages, _ := payload["messages"].([]any)
	for index := len(messages) - 1; index >= 0; index-- {
		message, _ := messages[index].(map[string]any)
		if message["role"] == "tool" {
			return strings.TrimSpace(fmt.Sprint(message["name"]))
		}
	}
	return ""
}

func latestProviderToolMessageContent(payload map[string]any) string {
	messages, _ := payload["messages"].([]any)
	for index := len(messages) - 1; index >= 0; index-- {
		message, _ := messages[index].(map[string]any)
		if message["role"] == "tool" {
			return strings.TrimSpace(fmt.Sprint(message["content"]))
		}
	}
	return ""
}

func writeSSEToolCall(w http.ResponseWriter, callID string, name string, arguments string) {
	escapedArgs, _ := json.Marshal(arguments)
	_, _ = fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":%q,\"type\":\"function\",\"function\":{\"name\":%q,\"arguments\":%s}}]}}],\"usage\":{\"prompt_tokens\":6,\"completion_tokens\":3}}\n\n", callID, name, escapedArgs)
	_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
}

func latestResponsesFunctionOutputCallID(payload map[string]any) string {
	input, _ := payload["input"].([]any)
	for index := len(input) - 1; index >= 0; index-- {
		item, _ := input[index].(map[string]any)
		if item["type"] == "function_call_output" {
			return strings.TrimSpace(fmt.Sprint(item["call_id"]))
		}
	}
	return ""
}

func writeResponsesSSEToolCall(w http.ResponseWriter, outputIndex int, callID string, name string, arguments string) {
	escapedArgs, _ := json.Marshal(arguments)
	_, _ = fmt.Fprintf(w, "data: {\"type\":\"response.output_item.added\",\"output_index\":%d,\"item\":{\"type\":\"function_call\",\"id\":\"fc_%d\",\"call_id\":%q,\"name\":%q,\"arguments\":\"\"}}\n\n", outputIndex, outputIndex, callID, name)
	_, _ = fmt.Fprintf(w, "data: {\"type\":\"response.function_call_arguments.done\",\"output_index\":%d,\"arguments\":%s}\n\n", outputIndex, escapedArgs)
	_, _ = fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":6,\"output_tokens\":3}}}\n\n")
	_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
}

func runHasTurnItem(t *testing.T, ctx context.Context, core *AppCore, runID string, itemType string, toolName string) bool {
	t.Helper()
	var count int
	if err := core.db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM turn_items WHERE run_id=? AND item_type=? AND tool_name=?`, runID, itemType, toolName).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count > 0
}

func runHasTurnItemStatus(t *testing.T, ctx context.Context, core *AppCore, runID string, itemType string, toolName string, status string) bool {
	t.Helper()
	var count int
	if err := core.db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM turn_items WHERE run_id=? AND item_type=? AND tool_name=? AND status=?`, runID, itemType, toolName, status).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count > 0
}

func runHasAnyTurnItems(t *testing.T, ctx context.Context, core *AppCore, runID string) bool {
	t.Helper()
	var count int
	if err := core.db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM turn_items WHERE run_id=?`, runID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count > 0
}

func runHasTurnOutputError(t *testing.T, ctx context.Context, core *AppCore, runID string, toolName string, errorCode string) bool {
	t.Helper()
	var count int
	if err := core.db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM turn_items WHERE run_id=? AND item_type='tool_output' AND tool_name=? AND output LIKE ?`, runID, toolName, "%"+errorCode+"%").Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count > 0
}

func runToolOutputContains(t *testing.T, ctx context.Context, core *AppCore, runID string, toolName string, needle string) bool {
	t.Helper()
	var count int
	if err := core.db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM turn_items WHERE run_id=? AND item_type='tool_output' AND tool_name=? AND output LIKE ?`, runID, toolName, "%"+needle+"%").Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count > 0
}
