package turnruntime

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type fakeToolRouter struct {
	tools []ToolSpec
}

type cancelingModelClient struct {
	cancel context.CancelFunc
}

type scriptedModelClient struct {
	calls  int
	events [][]ModelEvent
}

func (c cancelingModelClient) StreamTurn(ctx context.Context, request ModelTurnRequest) (<-chan ModelEvent, error) {
	events := make(chan ModelEvent)
	c.cancel()
	close(events)
	return events, nil
}

func (c *scriptedModelClient) StreamTurn(ctx context.Context, request ModelTurnRequest) (<-chan ModelEvent, error) {
	events := make(chan ModelEvent, 4)
	index := c.calls
	c.calls++
	go func() {
		defer close(events)
		if index >= len(c.events) {
			return
		}
		for _, event := range c.events[index] {
			if ctx.Err() != nil {
				return
			}
			events <- event
		}
	}()
	return events, nil
}

func (r fakeToolRouter) ModelVisibleTools(ctx context.Context, runID string, agentID string) ([]ToolSpec, error) {
	return r.tools, nil
}

func (r fakeToolRouter) Dispatch(ctx context.Context, call ToolCall) (*ToolResult, error) {
	switch call.Name {
	case "workspace_search":
		return &ToolResult{
			CallID: call.ID,
			Name:   call.Name,
			Output: map[string]any{
				"status": "completed",
				"results": []map[string]any{
					{"path": "send_chat.go", "line": 12, "snippet": "func SendChat() {}"},
				},
			},
		}, nil
	case "file_analyze":
		if call.Arguments["path"] == nil || strings.TrimSpace(call.Arguments["path"].(string)) == "" {
			return &ToolResult{
				CallID: call.ID,
				Name:   call.Name,
				Output: map[string]any{"status": "blocked", "error_code": "MISSING_ARGUMENT", "message": "file_analyze requires inputs.path"},
				Error:  "file_analyze requires inputs.path",
			}, nil
		}
		return &ToolResult{
			CallID:    call.ID,
			Name:      call.Name,
			ToolRunID: "toolrun_fake",
			Output:    map[string]any{"status": "completed", "summary": "SendChat dispatches desktop chat requests."},
		}, nil
	case "test_command":
		return &ToolResult{
			CallID: call.ID,
			Name:   call.Name,
			Output: map[string]any{"status": "failed", "exit_code": 1, "stdout": "FAIL example", "summary": "test_command failed: go test ./..."},
		}, nil
	default:
		return &ToolResult{CallID: call.ID, Name: call.Name, Output: map[string]any{"status": "blocked"}}, nil
	}
}

func TestToolCallingRuntimeWorkspaceSearchFileAnalyzeFinalAnswer(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t, ctx)
	runID := seedRun(t, ctx, db)
	runtime := NewToolCallingRuntime(db.SQL(), MockModelClient{}, fakeToolRouter{tools: readOnlyToolsForRuntimeTest()})

	result, err := runtime.RunTurn(ctx, TurnInput{
		RunID:          runID,
		ConversationID: "conv_test",
		UserMessageID:  "msg_test",
		AgentID:        "general_agent",
		Message:        "Find SendChat implementation",
		ModelName:      "mock-model",
	})
	if err != nil {
		t.Fatalf("RunTurn() error = %v", err)
	}
	if !strings.Contains(result.FinalMessage, "SendChat dispatches") {
		items, _ := NewHistoryStore(db.SQL()).ListTurnItems(ctx, runID)
		t.Fatalf("final message = %q; items = %+v", result.FinalMessage, items)
	}
	if len(result.ToolRunIDs) != 1 || result.ToolRunIDs[0] != "toolrun_fake" {
		t.Fatalf("tool run ids = %+v", result.ToolRunIDs)
	}
	items, err := NewHistoryStore(db.SQL()).ListTurnItems(ctx, runID)
	if err != nil {
		t.Fatalf("ListTurnItems() error = %v", err)
	}
	if !hasTurnItem(items, "tool_call", "workspace_search") || !hasTurnItem(items, "tool_output", "file_analyze") {
		t.Fatalf("turn items missing tool call/output: %+v", items)
	}
	events, err := NewEventStore(db.SQL()).ListRunEvents(ctx, runID, 0)
	if err != nil {
		t.Fatalf("ListRunEvents() error = %v", err)
	}
	for _, eventType := range []string{"model.started", "model.completed", "assistant.delta", "tool.call.started", "tool.output.delta", "tool.finished"} {
		if !hasRunEvent(events, eventType) {
			t.Fatalf("run events missing %s: %+v", eventType, events)
		}
	}
}

func TestToolCallingRuntimeMarksFailedToolOutputFromOutputStatus(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t, ctx)
	runID := seedRun(t, ctx, db)
	runtime := NewToolCallingRuntime(db.SQL(), &scriptedModelClient{
		events: [][]ModelEvent{
			{{Type: "tool_call", ToolCall: &ToolCall{ID: "call_failed_test", Name: "test_command", Arguments: map[string]any{"cmd": []any{"go", "test", "./..."}}}}},
			{{Type: "assistant.delta", TextDelta: "I saw the failed test output and will fix it."}},
		},
	}, fakeToolRouter{tools: []ToolSpec{{Name: "test_command", Risk: "read_only"}}})

	result, err := runtime.RunTurn(ctx, TurnInput{
		RunID:          runID,
		ConversationID: "conv_test",
		UserMessageID:  "msg_test",
		AgentID:        "general_agent",
		Message:        "run failing tests",
		ModelName:      "mock-model",
	})
	if err != nil {
		t.Fatalf("RunTurn() error = %v", err)
	}
	if !strings.Contains(result.FinalMessage, "failed test output") {
		t.Fatalf("final message = %q", result.FinalMessage)
	}
	items, err := NewHistoryStore(db.SQL()).ListTurnItems(ctx, runID)
	if err != nil {
		t.Fatalf("ListTurnItems() error = %v", err)
	}
	foundFailedOutput := false
	for _, item := range items {
		if item.ItemType == "tool_output" && item.ToolName == "test_command" && item.Status == "failed" {
			foundFailedOutput = true
		}
	}
	if !foundFailedOutput {
		t.Fatalf("missing failed test_command tool output: %+v", items)
	}
	events, err := NewEventStore(db.SQL()).ListRunEvents(ctx, runID, 0)
	if err != nil {
		t.Fatalf("ListRunEvents() error = %v", err)
	}
	if !hasRunEvent(events, "tool.failed") || !hasRunEvent(events, "tool.finished") {
		t.Fatalf("run events missing assistant/tool events: %+v", events)
	}
}

func TestToolCallingRuntimeToolErrorFeedsBackToModel(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t, ctx)
	runID := seedRun(t, ctx, db)
	runtime := NewToolCallingRuntime(db.SQL(), MockModelClient{}, fakeToolRouter{tools: readOnlyToolsForRuntimeTest()})

	result, err := runtime.RunTurn(ctx, TurnInput{
		RunID:          runID,
		ConversationID: "conv_test",
		UserMessageID:  "msg_test",
		AgentID:        "general_agent",
		Message:        "missing path",
		ModelName:      "mock-model",
	})
	if err != nil {
		t.Fatalf("RunTurn() error = %v", err)
	}
	if !strings.Contains(result.FinalMessage, "补充") {
		t.Fatalf("final message should ask for missing input, got %q", result.FinalMessage)
	}
	items, err := NewHistoryStore(db.SQL()).ListTurnItems(ctx, runID)
	if err != nil {
		t.Fatalf("ListTurnItems() error = %v", err)
	}
	foundFailedOutput := false
	for _, item := range items {
		if item.ItemType == "tool_output" && item.ToolName == "file_analyze" && item.Status == "failed" {
			foundFailedOutput = true
		}
	}
	if !foundFailedOutput {
		t.Fatalf("missing failed file_analyze tool output: %+v", items)
	}
}

func TestToolCallingRuntimeCancellationAbortsTurn(t *testing.T) {
	baseCtx := context.Background()
	ctx, cancel := context.WithCancel(baseCtx)
	db := newTestDB(t, baseCtx)
	runID := seedRun(t, baseCtx, db)
	runtime := NewToolCallingRuntime(db.SQL(), cancelingModelClient{cancel: cancel}, fakeToolRouter{tools: readOnlyToolsForRuntimeTest()})

	_, err := runtime.RunTurn(ctx, TurnInput{
		RunID:          runID,
		ConversationID: "conv_test",
		UserMessageID:  "msg_test",
		AgentID:        "general_agent",
		Message:        "cancel this turn",
		ModelName:      "mock-model",
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("RunTurn() error = %v, want context.Canceled", err)
	}
	events, err := NewEventStore(db.SQL()).ListRunEvents(baseCtx, runID, 0)
	if err != nil {
		t.Fatalf("ListRunEvents() error = %v", err)
	}
	if !hasRunEvent(events, "turn.aborted") {
		t.Fatalf("run events missing turn.aborted: %+v", events)
	}
	var status string
	if err := db.SQL().QueryRowContext(baseCtx, `SELECT status FROM turns WHERE run_id=? ORDER BY turn_index DESC LIMIT 1`, runID).Scan(&status); err != nil {
		t.Fatalf("query turn status: %v", err)
	}
	if status != "aborted" {
		t.Fatalf("turn status = %s, want aborted", status)
	}
}

func readOnlyToolsForRuntimeTest() []ToolSpec {
	return []ToolSpec{
		{Name: "workspace_search", Capability: "workspace_search", Risk: "read_only", Parameters: map[string]any{"type": "object"}},
		{Name: "file_analyze", Capability: "file_analyze", Risk: "read_only", Parameters: map[string]any{"type": "object"}},
	}
}

func hasTurnItem(items []TurnItemRecord, itemType string, toolName string) bool {
	for _, item := range items {
		if item.ItemType == itemType && item.ToolName == toolName {
			return true
		}
	}
	return false
}

func hasRunEvent(events []RunEventRecord, eventType string) bool {
	for _, event := range events {
		if event.EventType == eventType {
			return true
		}
	}
	return false
}
