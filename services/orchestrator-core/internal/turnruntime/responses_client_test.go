package turnruntime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResponsesClientParsesNonStreamingFunctionCalls(t *testing.T) {
	ctx := context.Background()
	var requestPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			t.Fatalf("path = %s, want /v1/responses", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("authorization header missing")
		}
		if err := json.NewDecoder(r.Body).Decode(&requestPayload); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"output":[{
				"type":"function_call",
				"id":"fc_1",
				"call_id":"call_search",
				"name":"workspace_search",
				"arguments":"{\"query\":\"SendChat\"}"
			}],
			"usage":{"input_tokens":13,"output_tokens":5,"input_tokens_details":{"cached_tokens":4}}
		}`))
	}))
	defer server.Close()

	client := ResponsesClient{BaseURL: server.URL, APIKey: "test-key", ModelName: "gpt-test"}
	events, err := collectModelEvents(ctx, client, ModelTurnRequest{
		Instructions: "rules",
		Items:        []TurnItemRecord{{ItemType: "message", Role: "user", Content: "find SendChat"}},
		Tools:        []ToolSpec{{Name: "workspace_search", Description: "Search workspace", Parameters: map[string]any{"type": "object"}}},
	})
	if err != nil {
		t.Fatalf("StreamTurn() error = %v", err)
	}
	if requestPayload["stream"] != false {
		t.Fatalf("stream request = %v, want false", requestPayload["stream"])
	}
	if !responsesRequestHasFunctionTool(t, requestPayload, "workspace_search") {
		t.Fatalf("request missing workspace_search function tool: %+v", requestPayload["tools"])
	}
	call := firstToolCallEvent(events)
	if call == nil || call.ID != "call_search" || call.Name != "workspace_search" || call.Arguments["query"] != "SendChat" {
		t.Fatalf("responses function call = %+v", call)
	}
	usage := firstUsageEvent(events)
	if usage == nil || usage.InputTokens != 13 || usage.OutputTokens != 5 || usage.CachedInputTokens != 4 {
		t.Fatalf("responses usage = %+v", usage)
	}
}

func TestResponsesClientAggregatesStreamingFunctionCallArguments(t *testing.T) {
	ctx := context.Background()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"type\":\"response.output_text.delta\",\"delta\":\"Thinking \"}\n\n"))
		_, _ = w.Write([]byte("data: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"type\":\"function_call\",\"id\":\"fc_1\",\"call_id\":\"call_stream\",\"name\":\"workspace_search\",\"arguments\":\"\"}}\n\n"))
		_, _ = w.Write([]byte("data: {\"type\":\"response.function_call_arguments.delta\",\"output_index\":0,\"delta\":\"{\\\"query\\\":\"}\n\n"))
		_, _ = w.Write([]byte("data: {\"type\":\"response.function_call_arguments.delta\",\"output_index\":0,\"delta\":\"\\\"SendChat\\\"}\"}\n\n"))
		_, _ = w.Write([]byte("data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":8,\"output_tokens\":3}}}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	client := ResponsesClient{BaseURL: server.URL + "/v1", APIKey: "test-key", ModelName: "gpt-test", Stream: true}
	events, err := collectModelEvents(ctx, client, ModelTurnRequest{
		Items: []TurnItemRecord{{ItemType: "message", Role: "user", Content: "find SendChat"}},
		Tools: []ToolSpec{{Name: "workspace_search", Description: "Search workspace", Parameters: map[string]any{"type": "object"}}},
	})
	if err != nil {
		t.Fatalf("StreamTurn() error = %v", err)
	}
	if text := strings.Join(textDeltas(events), ""); text != "Thinking " {
		t.Fatalf("text deltas = %q", text)
	}
	call := firstToolCallEvent(events)
	if call == nil || call.ID != "call_stream" || call.Name != "workspace_search" || call.Arguments["query"] != "SendChat" {
		t.Fatalf("stream responses call = %+v", call)
	}
	usage := firstUsageEvent(events)
	if usage == nil || usage.InputTokens != 8 || usage.OutputTokens != 3 {
		t.Fatalf("stream responses usage = %+v", usage)
	}
}

func TestResponsesInputItemsIncludeFunctionCallOutputs(t *testing.T) {
	input := responsesInputItems([]TurnItemRecord{
		{ItemType: "message", Role: "user", Content: "find SendChat"},
		{ItemType: "tool_call", CallID: "call_1", ToolName: "workspace_search", Arguments: map[string]any{"query": "SendChat"}},
		{ItemType: "tool_output", CallID: "call_1", ToolName: "workspace_search", Output: map[string]any{"status": "completed"}},
	})
	if len(input) != 3 {
		t.Fatalf("input len = %d, want 3: %+v", len(input), input)
	}
	if input[1]["type"] != "function_call" || input[1]["call_id"] != "call_1" {
		t.Fatalf("function_call item malformed: %+v", input[1])
	}
	if input[2]["type"] != "function_call_output" || input[2]["call_id"] != "call_1" || !strings.Contains(input[2]["output"].(string), "completed") {
		t.Fatalf("function_call_output item malformed: %+v", input[2])
	}
}

func responsesRequestHasFunctionTool(t *testing.T, payload map[string]any, name string) bool {
	t.Helper()
	tools, ok := payload["tools"].([]any)
	if !ok {
		return false
	}
	for _, rawTool := range tools {
		tool, _ := rawTool.(map[string]any)
		if tool["type"] == "function" && tool["name"] == name {
			return true
		}
	}
	return false
}
