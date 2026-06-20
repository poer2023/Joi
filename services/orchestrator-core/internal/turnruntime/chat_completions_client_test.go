package turnruntime

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChatCompletionsClientParsesNonStreamingToolCalls(t *testing.T) {
	ctx := context.Background()
	var requestPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path = %s, want /v1/chat/completions", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("authorization header missing")
		}
		if err := json.NewDecoder(r.Body).Decode(&requestPayload); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"choices":[{
				"message":{
					"role":"assistant",
					"content":null,
					"tool_calls":[{
						"id":"call_search",
						"type":"function",
						"function":{"name":"workspace_search","arguments":"{\"query\":\"SendChat\",\"max_results\":3}"}
					}]
				}
			}],
			"usage":{"prompt_tokens":11,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":5}}
		}`))
	}))
	defer server.Close()

	client := ChatCompletionsClient{BaseURL: server.URL, APIKey: "test-key", ModelName: "gpt-test"}
	events, err := collectModelEvents(ctx, client, ModelTurnRequest{
		Instructions: "system rules",
		Items: []TurnItemRecord{
			{ItemType: "message", Role: "user", Content: "find SendChat"},
		},
		Tools: []ToolSpec{{Name: "workspace_search", Description: "Search workspace", Parameters: map[string]any{"type": "object"}}},
	})
	if err != nil {
		t.Fatalf("StreamTurn() error = %v", err)
	}
	if requestPayload["stream"] != false {
		t.Fatalf("stream request = %v, want false", requestPayload["stream"])
	}
	if !requestHasTool(t, requestPayload, "workspace_search") {
		t.Fatalf("request missing workspace_search tool: %+v", requestPayload["tools"])
	}
	usage := firstUsageEvent(events)
	if usage == nil || usage.InputTokens != 11 || usage.OutputTokens != 7 || usage.CachedInputTokens != 5 {
		t.Fatalf("usage = %+v", usage)
	}
	call := firstToolCallEvent(events)
	if call == nil || call.ID != "call_search" || call.Name != "workspace_search" || call.Arguments["query"] != "SendChat" || int(call.Arguments["max_results"].(float64)) != 3 {
		t.Fatalf("tool call = %+v", call)
	}
}

func TestChatCompletionsClientAggregatesStreamingToolCalls(t *testing.T) {
	ctx := context.Background()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"Searching \"}}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_stream\",\"type\":\"function\",\"function\":{\"name\":\"workspace_search\",\"arguments\":\"{\\\"query\\\":\"}}]}}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"SendChat\\\"}\"}}]}}],\"usage\":{\"prompt_tokens\":4,\"completion_tokens\":2}}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	client := ChatCompletionsClient{BaseURL: server.URL + "/v1", APIKey: "test-key", ModelName: "gpt-test", Stream: true}
	events, err := collectModelEvents(ctx, client, ModelTurnRequest{
		Items: []TurnItemRecord{{ItemType: "message", Role: "user", Content: "find SendChat"}},
		Tools: []ToolSpec{{Name: "workspace_search", Description: "Search workspace", Parameters: map[string]any{"type": "object"}}},
	})
	if err != nil {
		t.Fatalf("StreamTurn() error = %v", err)
	}
	if text := strings.Join(textDeltas(events), ""); text != "Searching " {
		t.Fatalf("text deltas = %q", text)
	}
	call := firstToolCallEvent(events)
	if call == nil || call.ID != "call_stream" || call.Name != "workspace_search" || call.Arguments["query"] != "SendChat" {
		t.Fatalf("stream tool call = %+v", call)
	}
	usage := firstUsageEvent(events)
	if usage == nil || usage.InputTokens != 4 || usage.OutputTokens != 2 {
		t.Fatalf("stream usage = %+v", usage)
	}
}

func TestChatCompletionMessagesIncludeToolOutputs(t *testing.T) {
	messages := chatCompletionMessages(ModelTurnRequest{
		Instructions: "rules",
		Items: []TurnItemRecord{
			{ItemType: "message", Role: "user", Content: "find SendChat"},
			{ItemType: "tool_call", CallID: "call_1", ToolName: "workspace_search", Arguments: map[string]any{"query": "SendChat"}},
			{ItemType: "tool_output", CallID: "call_1", ToolName: "workspace_search", Output: map[string]any{"status": "completed"}},
		},
	})
	if len(messages) != 4 {
		t.Fatalf("messages len = %d, want 4: %+v", len(messages), messages)
	}
	if messages[2]["role"] != "assistant" || messages[2]["tool_calls"] == nil {
		t.Fatalf("tool call message malformed: %+v", messages[2])
	}
	if messages[3]["role"] != "tool" || messages[3]["tool_call_id"] != "call_1" || !strings.Contains(messages[3]["content"].(string), "completed") {
		t.Fatalf("tool output message malformed: %+v", messages[3])
	}
}

func TestChatCompletionsClientDisablesDeepSeekV4Thinking(t *testing.T) {
	ctx := context.Background()
	var requestPayload map[string]any
	httpClient := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != "https://api.deepseek.com/v1/chat/completions" {
			t.Fatalf("url = %s, want DeepSeek chat completions endpoint", r.URL.String())
		}
		if err := json.NewDecoder(r.Body).Decode(&requestPayload); err != nil {
			return nil, err
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"choices":[{"message":{"role":"assistant","content":"ok"}}]}`)),
			Request:    r,
		}, nil
	})}

	client := ChatCompletionsClient{BaseURL: "https://api.deepseek.com/v1", APIKey: "test-key", ModelName: "deepseek-v4-flash", HTTPClient: httpClient}
	if _, err := collectModelEvents(ctx, client, ModelTurnRequest{
		Items: []TurnItemRecord{{ItemType: "message", Role: "user", Content: "hello"}},
		Tools: []ToolSpec{{Name: "workspace_search", Description: "Search workspace", Parameters: map[string]any{"type": "object"}}},
	}); err != nil {
		t.Fatalf("StreamTurn() error = %v", err)
	}
	thinking, _ := requestPayload["thinking"].(map[string]any)
	if thinking["type"] != "disabled" {
		t.Fatalf("thinking = %+v, want disabled", requestPayload["thinking"])
	}
}

func TestShouldDisableThinkingModeOnlyForDeepSeekV4(t *testing.T) {
	for _, tc := range []struct {
		baseURL string
		model   string
		want    bool
	}{
		{"https://api.deepseek.com/v1", "deepseek-v4-flash", true},
		{"https://api.deepseek.com/v1", "deepseek-v4-pro", true},
		{"https://api.deepseek.com/v1", "deepseek-chat", false},
		{"https://example.com/v1", "deepseek-v4-flash", false},
	} {
		if got := shouldDisableThinkingMode(tc.baseURL, tc.model); got != tc.want {
			t.Fatalf("shouldDisableThinkingMode(%q, %q) = %v, want %v", tc.baseURL, tc.model, got, tc.want)
		}
	}
}

func collectModelEvents(ctx context.Context, client ModelClient, request ModelTurnRequest) ([]ModelEvent, error) {
	stream, err := client.StreamTurn(ctx, request)
	if err != nil {
		return nil, err
	}
	events := []ModelEvent{}
	for event := range stream {
		events = append(events, event)
	}
	return events, nil
}

func requestHasTool(t *testing.T, payload map[string]any, name string) bool {
	t.Helper()
	tools, ok := payload["tools"].([]any)
	if !ok {
		return false
	}
	for _, rawTool := range tools {
		tool, _ := rawTool.(map[string]any)
		function, _ := tool["function"].(map[string]any)
		if function["name"] == name {
			return true
		}
	}
	return false
}

func firstUsageEvent(events []ModelEvent) *TokenUsage {
	for _, event := range events {
		if event.Usage != nil {
			return event.Usage
		}
	}
	return nil
}

func firstToolCallEvent(events []ModelEvent) *ToolCall {
	for _, event := range events {
		if event.ToolCall != nil {
			return event.ToolCall
		}
	}
	return nil
}

func textDeltas(events []ModelEvent) []string {
	values := []string{}
	for _, event := range events {
		if event.TextDelta != "" {
			values = append(values, event.TextDelta)
		}
	}
	return values
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}
