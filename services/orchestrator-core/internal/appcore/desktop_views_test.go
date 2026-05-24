package appcore

import (
	"context"
	"strings"
	"testing"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

func TestSQLiteChatWorkbenchLoadsRealConversations(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	chat, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "你好，请简短回应。",
	})
	if err != nil {
		t.Fatal(err)
	}

	list, err := core.ListConversations(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Conversations) != 1 {
		t.Fatalf("conversations got %d, want 1", len(list.Conversations))
	}
	if list.Conversations[0].ID != chat.ConversationID || list.Conversations[0].LatestRunID != chat.RunID {
		t.Fatalf("conversation summary mismatch: %+v chat=%+v", list.Conversations[0], chat)
	}

	detail, err := core.GetConversation(ctx, chat.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Conversation.ID != chat.ConversationID || len(detail.Messages) != 2 {
		t.Fatalf("conversation detail mismatch: %+v", detail)
	}
	if detail.Messages[0].Role != "user" || detail.Messages[1].Role != "assistant" {
		t.Fatalf("unexpected message roles: %+v", detail.Messages)
	}
	if detail.Messages[0].RunID != chat.RunID || detail.Messages[1].RunID != chat.RunID {
		t.Fatalf("messages should link to run %s: %+v", chat.RunID, detail.Messages)
	}
}

func TestSQLiteCapabilityConsoleListsRegistryWorkflowsAndToolRuns(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	chat, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "在当前项目里找 Run Trace 的设计文档",
	})
	if err != nil {
		t.Fatal(err)
	}

	capabilities, err := core.ListCapabilities(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !hasCapabilityRecord(capabilities.Capabilities, "file_analyze") || !hasCapabilityRecord(capabilities.Capabilities, "workspace_search") {
		t.Fatalf("kernel capabilities missing: %+v", capabilities.Capabilities)
	}

	workflows, err := core.ListToolWorkflows(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !hasWorkflowRecord(workflows.Workflows, "file_analyze_v1") || !hasWorkflowRecord(workflows.Workflows, "workspace_search_v1") {
		t.Fatalf("kernel workflows missing: %+v", workflows.Workflows)
	}

	toolRuns, err := core.ListToolRuns(ctx, 20)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, run := range toolRuns.ToolRuns {
		if run.RunID == chat.RunID && run.WorkflowName == "workspace_search_v1" && run.Status == "succeeded" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("workspace_search tool run missing from console data: %+v", toolRuns.ToolRuns)
	}

	settings, err := core.GetWorkspaceSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(settings.AllowedRoots) == 0 || settings.DefaultRoot == "" {
		t.Fatalf("workspace settings missing roots: %+v", settings)
	}
}

func TestSQLiteDisabledWorkflowChatIsRejectedWithTrace(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	if err := core.SetToolWorkflowEnabled(ctx, "workspace_search_v1", false); err != nil {
		t.Fatal(err)
	}
	workflows, err := core.ListToolWorkflows(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, workflow := range workflows.Workflows {
		if workflow.Name == "workspace_search_v1" && workflow.Enabled {
			t.Fatalf("workflow remained enabled: %+v", workflow)
		}
	}

	chat, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "在当前项目里找 Run Trace 的设计文档",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(chat.Response, "policy_blocked") {
		t.Fatalf("disabled workflow response should be policy_blocked: %s", chat.Response)
	}
	trace, err := core.GetRunTrace(ctx, chat.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !hasSQLiteStep(trace.Steps, "capability_requested") || !hasSQLiteStep(trace.Steps, "capability_blocked") {
		t.Fatalf("disabled workflow trace missing rejection steps: %+v", trace.Steps)
	}
	if hasSQLiteStep(trace.Steps, "tool_finished") {
		t.Fatalf("disabled workflow should not finish a tool")
	}
	var toolRunCount int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM tool_runs WHERE run_id=?`, chat.RunID).Scan(&toolRunCount); err != nil {
		t.Fatal(err)
	}
	if toolRunCount != 0 {
		t.Fatalf("disabled workflow created %d tool runs", toolRunCount)
	}
}

func hasCapabilityRecord(records []store.CapabilityRecord, id string) bool {
	for _, record := range records {
		if record.ID == id && record.Enabled {
			return true
		}
	}
	return false
}

func hasWorkflowRecord(records []ToolWorkflowRecord, name string) bool {
	for _, record := range records {
		if record.Name == name && len(record.Steps) > 0 {
			return true
		}
	}
	return false
}
