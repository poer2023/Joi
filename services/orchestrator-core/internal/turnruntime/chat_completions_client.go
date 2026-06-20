package turnruntime

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type ChatCompletionsClient struct {
	BaseURL        string
	APIKey         string
	ModelName      string
	TimeoutSeconds int
	Stream         bool
	HTTPClient     *http.Client
}

func (c ChatCompletionsClient) StreamTurn(ctx context.Context, request ModelTurnRequest) (<-chan ModelEvent, error) {
	modelName := strings.TrimSpace(firstNonEmpty(c.ModelName, request.ModelName))
	if modelName == "" {
		return nil, errors.New("chat completions model name is required")
	}
	endpoint := chatCompletionsEndpoint(c.BaseURL)
	if endpoint == "" {
		return nil, errors.New("chat completions base URL is required")
	}
	if strings.TrimSpace(c.APIKey) == "" {
		return nil, errors.New("chat completions API key is required")
	}
	body := map[string]any{
		"model":       modelName,
		"messages":    chatCompletionMessages(request),
		"tools":       chatCompletionTools(request.Tools),
		"tool_choice": "auto",
		"stream":      c.Stream,
	}
	if shouldDisableThinkingMode(c.BaseURL, modelName) {
		body["thinking"] = map[string]any{"type": "disabled"}
	}
	if len(request.Tools) == 0 {
		delete(body, "tools")
		delete(body, "tool_choice")
	}
	if c.Stream {
		return c.streamTurn(ctx, endpoint, body)
	}
	return c.nonStreamingTurn(ctx, endpoint, body)
}

func (c ChatCompletionsClient) nonStreamingTurn(ctx context.Context, endpoint string, body map[string]any) (<-chan ModelEvent, error) {
	raw, err := c.postJSON(ctx, endpoint, body)
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	modelEvents := modelEventsFromChatCompletionPayload(payload)
	events := make(chan ModelEvent, len(modelEvents))
	for _, event := range modelEvents {
		events <- event
	}
	close(events)
	return events, nil
}

func (c ChatCompletionsClient) streamTurn(ctx context.Context, endpoint string, body map[string]any) (<-chan ModelEvent, error) {
	rawBody, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(rawBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Accept", "text/event-stream")
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("chat completions provider returned %s: %s", resp.Status, string(raw))
	}
	events := make(chan ModelEvent, 16)
	go func() {
		defer close(events)
		defer resp.Body.Close()
		streamChatCompletionEvents(ctx, resp.Body, events)
	}()
	return events, nil
}

func (c ChatCompletionsClient) postJSON(ctx context.Context, endpoint string, body map[string]any) ([]byte, error) {
	rawBody, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(rawBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("chat completions provider returned %s: %s", resp.Status, string(raw))
	}
	return raw, nil
}

func (c ChatCompletionsClient) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	timeout := c.TimeoutSeconds
	if timeout <= 0 {
		timeout = 60
	}
	return &http.Client{Timeout: time.Duration(timeout) * time.Second}
}

func chatCompletionsEndpoint(baseURL string) string {
	endpoint := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if endpoint == "" {
		return ""
	}
	if strings.HasSuffix(endpoint, "/chat/completions") {
		return endpoint
	}
	if strings.HasSuffix(endpoint, "/v1") {
		return endpoint + "/chat/completions"
	}
	return endpoint + "/v1/chat/completions"
}

func shouldDisableThinkingMode(baseURL string, modelName string) bool {
	baseURL = strings.ToLower(strings.TrimSpace(baseURL))
	modelName = strings.ToLower(strings.TrimSpace(modelName))
	if !strings.Contains(baseURL, "deepseek.com") {
		return false
	}
	return strings.HasPrefix(modelName, "deepseek-v4-")
}

func chatCompletionMessages(request ModelTurnRequest) []map[string]any {
	messages := []map[string]any{}
	if strings.TrimSpace(request.Instructions) != "" {
		messages = append(messages, map[string]any{"role": "system", "content": request.Instructions})
	}
	for _, item := range request.Items {
		switch item.ItemType {
		case "message":
			role := strings.TrimSpace(item.Role)
			if role == "" {
				role = "user"
			}
			messages = append(messages, map[string]any{"role": role, "content": item.Content})
		case "tool_call":
			messages = append(messages, map[string]any{
				"role":    "assistant",
				"content": nil,
				"tool_calls": []map[string]any{
					chatCompletionToolCall(item.CallID, item.ToolName, item.Arguments),
				},
			})
		case "tool_output":
			messages = append(messages, map[string]any{
				"role":         "tool",
				"tool_call_id": item.CallID,
				"name":         item.ToolName,
				"content":      mustJSONString(item.Output),
			})
		}
	}
	return messages
}

func chatCompletionToolCall(callID string, name string, arguments map[string]any) map[string]any {
	if strings.TrimSpace(callID) == "" {
		callID = "call_missing_id"
	}
	return map[string]any{
		"id":   callID,
		"type": "function",
		"function": map[string]any{
			"name":      name,
			"arguments": mustJSONString(arguments),
		},
	}
}

func chatCompletionTools(specs []ToolSpec) []map[string]any {
	tools := make([]map[string]any, 0, len(specs))
	for _, spec := range specs {
		tools = append(tools, map[string]any{
			"type": "function",
			"function": map[string]any{
				"name":        spec.Name,
				"description": spec.Description,
				"parameters":  spec.Parameters,
			},
		})
	}
	return tools
}

func modelEventsFromChatCompletionPayload(payload map[string]any) []ModelEvent {
	events := []ModelEvent{}
	if usage := usageFromChatCompletionPayload(payload); usage != nil {
		events = append(events, ModelEvent{Type: "usage", Usage: usage})
	}
	message := firstChatCompletionMessage(payload)
	if len(message) == 0 {
		return events
	}
	if content, ok := message["content"].(string); ok && content != "" {
		events = append(events, ModelEvent{Type: "assistant.delta", TextDelta: content})
	}
	for _, call := range toolCallsFromChatMessage(message) {
		events = append(events, ModelEvent{Type: "tool_call", ToolCall: &call})
	}
	return events
}

func firstChatCompletionMessage(payload map[string]any) map[string]any {
	choices, ok := payload["choices"].([]any)
	if !ok || len(choices) == 0 {
		return nil
	}
	choice, ok := choices[0].(map[string]any)
	if !ok {
		return nil
	}
	message, ok := choice["message"].(map[string]any)
	if !ok {
		return nil
	}
	return message
}

func toolCallsFromChatMessage(message map[string]any) []ToolCall {
	rawCalls, ok := message["tool_calls"].([]any)
	if !ok {
		return nil
	}
	calls := []ToolCall{}
	for _, rawCall := range rawCalls {
		callMap, ok := rawCall.(map[string]any)
		if !ok {
			continue
		}
		function, _ := callMap["function"].(map[string]any)
		calls = append(calls, ToolCall{
			ID:        strings.TrimSpace(fmt.Sprint(callMap["id"])),
			Name:      strings.TrimSpace(fmt.Sprint(function["name"])),
			Arguments: parseToolArguments(fmt.Sprint(function["arguments"])),
		})
	}
	return calls
}

type streamingToolCallAccumulator struct {
	ID        string
	Name      string
	Arguments strings.Builder
}

func streamChatCompletionEvents(ctx context.Context, body io.Reader, events chan<- ModelEvent) {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	toolCalls := map[int]*streamingToolCallAccumulator{}
	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(data), &payload); err != nil {
			events <- ModelEvent{Type: "model.error", Message: err.Error(), Raw: map[string]any{"chunk": data}}
			continue
		}
		if usage := usageFromChatCompletionPayload(payload); usage != nil {
			events <- ModelEvent{Type: "usage", Usage: usage}
		}
		choices, _ := payload["choices"].([]any)
		for _, rawChoice := range choices {
			choice, _ := rawChoice.(map[string]any)
			delta, _ := choice["delta"].(map[string]any)
			if content, ok := delta["content"].(string); ok && content != "" {
				events <- ModelEvent{Type: "assistant.delta", TextDelta: content}
			}
			accumulateStreamingToolCalls(delta, toolCalls)
		}
	}
	indexes := sortedToolCallIndexes(toolCalls)
	for _, index := range indexes {
		acc := toolCalls[index]
		events <- ModelEvent{Type: "tool_call", ToolCall: &ToolCall{
			ID:        acc.ID,
			Name:      acc.Name,
			Arguments: parseToolArguments(acc.Arguments.String()),
		}}
	}
}

func accumulateStreamingToolCalls(delta map[string]any, toolCalls map[int]*streamingToolCallAccumulator) {
	rawCalls, ok := delta["tool_calls"].([]any)
	if !ok {
		return
	}
	for _, rawCall := range rawCalls {
		callMap, ok := rawCall.(map[string]any)
		if !ok {
			continue
		}
		index := intFromAny(callMap["index"])
		acc := toolCalls[index]
		if acc == nil {
			acc = &streamingToolCallAccumulator{}
			toolCalls[index] = acc
		}
		if id, ok := callMap["id"].(string); ok && id != "" {
			acc.ID = id
		}
		function, _ := callMap["function"].(map[string]any)
		if name, ok := function["name"].(string); ok && name != "" {
			acc.Name = name
		}
		if args, ok := function["arguments"].(string); ok && args != "" {
			acc.Arguments.WriteString(args)
		}
	}
}

func usageFromChatCompletionPayload(payload map[string]any) *TokenUsage {
	usage, ok := payload["usage"].(map[string]any)
	if !ok {
		return nil
	}
	result := &TokenUsage{
		InputTokens:  intFromAny(usage["prompt_tokens"]),
		OutputTokens: intFromAny(usage["completion_tokens"]),
	}
	if details, ok := usage["prompt_tokens_details"].(map[string]any); ok {
		result.CachedInputTokens = intFromAny(details["cached_tokens"])
	}
	return result
}

func parseToolArguments(raw string) map[string]any {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return map[string]any{}
	}
	value := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return map[string]any{"_raw_arguments": raw, "_parse_error": err.Error()}
	}
	return value
}

func mustJSONString(value map[string]any) string {
	if value == nil {
		return "{}"
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(raw)
}

func intFromAny(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		parsed, _ := typed.Int64()
		return int(parsed)
	default:
		return 0
	}
}

func sortedToolCallIndexes(toolCalls map[int]*streamingToolCallAccumulator) []int {
	indexes := make([]int, 0, len(toolCalls))
	for index := range toolCalls {
		indexes = append(indexes, index)
	}
	for i := 1; i < len(indexes); i++ {
		for j := i; j > 0 && indexes[j-1] > indexes[j]; j-- {
			indexes[j-1], indexes[j] = indexes[j], indexes[j-1]
		}
	}
	return indexes
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
