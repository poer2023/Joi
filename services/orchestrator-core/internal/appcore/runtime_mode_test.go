package appcore

import (
	"context"
	"testing"
)

func TestSQLiteRuntimeModeStoredInRunTrace(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	result, err := core.SendChat(ctx, ChatRequest{
		Channel:     "test",
		UserID:      "tester",
		Message:     "你好。",
		RuntimeMode: "tool_calling",
	})
	if err != nil {
		t.Fatalf("SendChat() error = %v", err)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatalf("GetRunTrace() error = %v", err)
	}
	if trace.Metadata["runtime_mode"] != "tool_calling" {
		t.Fatalf("metadata runtime_mode = %v, want tool_calling", trace.Metadata["runtime_mode"])
	}
	if trace.RouteResult["runtime_mode"] != "tool_calling" {
		t.Fatalf("route_result runtime_mode = %v, want tool_calling", trace.RouteResult["runtime_mode"])
	}
}

func TestSQLiteChatRunEventsExposeForegroundLifecycle(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	streamed := []string{}
	result, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "你好，请简短回应。",
		EventSink: func(eventName string, _ map[string]any) {
			streamed = append(streamed, eventName)
		},
	})
	if err != nil {
		t.Fatalf("SendChat() error = %v", err)
	}
	trace, err := core.GetRunTrace(ctx, result.RunID)
	if err != nil {
		t.Fatalf("GetRunTrace() error = %v", err)
	}
	for _, eventType := range []string{"assistant.completed", "foreground_run.completed", "run.finalized"} {
		if !traceHasRunEvent(trace, eventType) {
			t.Fatalf("trace missing %s: %+v", eventType, trace.Events)
		}
		if !stringSliceContains(streamed, eventType) {
			t.Fatalf("event sink missing %s: %+v", eventType, streamed)
		}
	}
}

func traceHasRunEvent(trace *RunTrace, eventType string) bool {
	if trace == nil {
		return false
	}
	for _, event := range trace.Events {
		if event.EventType == eventType {
			return true
		}
	}
	return false
}

func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
