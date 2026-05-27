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

	list, err := core.ListConversations(ctx, ConversationFilter{Limit: 10})
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

func TestSQLiteConversationTrashRestoreHidesPackageAndRestoresMemory(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	chat, err := core.SendChat(ctx, ChatRequest{
		Channel:   "test",
		UserID:    "tester",
		InputMode: "serious_task",
		Message:   "请整理一份 Joi 会话管理方案。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if chat.ProductTask == nil || len(chat.Artifacts) == 0 {
		t.Fatalf("expected task and artifact before trash: task=%+v artifacts=%d", chat.ProductTask, len(chat.Artifacts))
	}
	pendingID, err := store.NewID("mem_")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := core.DB().SQL().ExecContext(ctx, `
		INSERT INTO memories (id, type, content, summary, status, source_event_ids, entities, metadata)
		VALUES (?, 'user_preference', '用户临时说明：这条只属于会话回收测试。', '会话回收测试临时说明', 'pending', ?, '[]', '{}')
	`, pendingID, mustJSON([]string{chat.ConversationID})); err != nil {
		t.Fatal(err)
	}
	confirmed, err := core.ProposeMemory(ctx, MemoryProposalRequest{
		Type:           "project_fact",
		Content:        "Joi 会话回收测试确认记忆应保留。",
		Summary:        "会话回收确认记忆",
		SourceEventIDs: []string{chat.ConversationID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := core.UpdateMemory(ctx, MemoryActionRequest{ID: confirmed.ID, Action: "confirm"}); err != nil {
		t.Fatal(err)
	}

	if _, err := core.TrashConversation(ctx, ConversationActionRequest{ID: chat.ConversationID, Reason: "test_trash"}); err != nil {
		t.Fatal(err)
	}
	activeList, err := core.ListConversations(ctx, ConversationFilter{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(activeList.Conversations) != 0 {
		t.Fatalf("trashed conversation remained active: %+v", activeList.Conversations)
	}
	trashList, err := core.ListConversations(ctx, ConversationFilter{View: "trash", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(trashList.Conversations) != 1 || trashList.Conversations[0].LifecycleStatus != "trashed" || trashList.Conversations[0].PurgeAfter == nil {
		t.Fatalf("trash list mismatch: %+v", trashList.Conversations)
	}
	taskList, err := core.ListProductTasks(ctx, ProductTaskFilter{Status: "active", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(taskList.Tasks) != 0 {
		t.Fatalf("trashed conversation task remained visible: %+v", taskList.Tasks)
	}
	artifactList, err := core.ListArtifacts(ctx, ArtifactFilter{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(artifactList.Artifacts) != 0 {
		t.Fatalf("trashed conversation artifact remained visible: %+v", artifactList.Artifacts)
	}
	memories, err := core.ListMemories(ctx, MemoryFilter{Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if !hasMemory(memories.Memories, confirmed.ID) || hasMemory(memories.Memories, pendingID) {
		t.Fatalf("trash memory policy mismatch: confirmed=%s pending=%s list=%+v", confirmed.ID, pendingID, memories.Memories)
	}

	if _, err := core.RestoreConversation(ctx, ConversationActionRequest{ID: chat.ConversationID, Reason: "test_restore"}); err != nil {
		t.Fatal(err)
	}
	activeList, err = core.ListConversations(ctx, ConversationFilter{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(activeList.Conversations) != 1 || activeList.Conversations[0].LifecycleStatus != "active" {
		t.Fatalf("restore active list mismatch: %+v", activeList.Conversations)
	}
	memories, err = core.ListMemories(ctx, MemoryFilter{Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if !hasMemory(memories.Memories, confirmed.ID) || !hasMemory(memories.Memories, pendingID) {
		t.Fatalf("restore memory policy mismatch: confirmed=%s pending=%s list=%+v", confirmed.ID, pendingID, memories.Memories)
	}
}

func TestSQLiteConversationArchiveRejectsNewMessages(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	chat, err := core.SendChat(ctx, ChatRequest{Channel: "test", UserID: "tester", Message: "你好。"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := core.ArchiveConversation(ctx, ConversationActionRequest{ID: chat.ConversationID, Reason: "test_archive"}); err != nil {
		t.Fatal(err)
	}
	if _, err := core.SendChat(ctx, ChatRequest{ConversationID: chat.ConversationID, Channel: "test", UserID: "tester", Message: "继续。"}); err == nil || !strings.Contains(err.Error(), "archived") {
		t.Fatalf("expected archived conversation send rejection, got %v", err)
	}
}

func TestSQLiteConversationPurgeRedactsButKeepsTraceReadable(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	chat, err := core.SendChat(ctx, ChatRequest{
		Channel:   "test",
		UserID:    "tester",
		InputMode: "serious_task",
		Message:   "请整理一份可永久清理的测试报告。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(chat.Artifacts) == 0 {
		t.Fatalf("expected artifact before purge")
	}
	artifactID := chat.Artifacts[0].ID
	if _, err := core.TrashConversation(ctx, ConversationActionRequest{ID: chat.ConversationID, Reason: "test_trash"}); err != nil {
		t.Fatal(err)
	}
	if _, err := core.PurgeConversation(ctx, ConversationActionRequest{ID: chat.ConversationID, Reason: "test_purge"}); err != nil {
		t.Fatal(err)
	}
	detail, err := core.GetConversation(ctx, chat.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Conversation.LifecycleStatus != "purged" {
		t.Fatalf("expected purged conversation: %+v", detail.Conversation)
	}
	for _, message := range detail.Messages {
		if message.Content != "[已永久清理]" {
			t.Fatalf("message was not redacted: %+v", message)
		}
	}
	trace, err := core.GetRunTrace(ctx, chat.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if len(trace.Steps) == 0 {
		t.Fatalf("purged trace should remain readable")
	}
	artifact, err := core.GetArtifact(ctx, artifactID)
	if err != nil {
		t.Fatal(err)
	}
	if artifact.Content != "[已永久清理]" || artifact.Status != "deleted" {
		t.Fatalf("artifact not redacted after purge: %+v", artifact)
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
	if !hasCapabilityRecord(capabilities.Capabilities, "desktop_app_list") {
		t.Fatalf("desktop_app_list capability missing: %+v", capabilities.Capabilities)
	}

	workflows, err := core.ListToolWorkflows(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !hasWorkflowRecord(workflows.Workflows, "file_analyze_v1") || !hasWorkflowRecord(workflows.Workflows, "workspace_search_v1") {
		t.Fatalf("kernel workflows missing: %+v", workflows.Workflows)
	}
	if !hasWorkflowRecord(workflows.Workflows, "desktop_app_list_v1") {
		t.Fatalf("desktop_app_list_v1 workflow missing: %+v", workflows.Workflows)
	}

	mcpServers, err := core.ListMCPServers(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(mcpServers.Servers) == 0 || !strings.Contains(stringValue(mcpServers.Servers[0].Metadata["policy"]), "wrapped") {
		t.Fatalf("MCP inventory policy missing: %+v", mcpServers.Servers)
	}
	skills, err := core.ListSkills(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(skills.Skills) == 0 || len(skills.Skills[0].RequiredCapabilities) == 0 {
		t.Fatalf("skill registry missing required capabilities: %+v", skills.Skills)
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

func hasMemory(records []store.MemoryRecord, id string) bool {
	for _, record := range records {
		if record.ID == id {
			return true
		}
	}
	return false
}
