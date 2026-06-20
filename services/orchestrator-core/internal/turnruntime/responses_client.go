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

type ResponsesClient struct {
	BaseURL        string
	APIKey         string
	ModelName      string
	TimeoutSeconds int
	Stream         bool
	HTTPClient     *http.Client
}

func (c ResponsesClient) StreamTurn(ctx context.Context, request ModelTurnRequest) (<-chan ModelEvent, error) {
	modelName := strings.TrimSpace(firstNonEmpty(c.ModelName, request.ModelName))
	if modelName == "" {
		return nil, errors.New("responses model name is required")
	}
	endpoint := responsesEndpoint(c.BaseURL)
	if endpoint == "" {
		return nil, errors.New("responses base URL is required")
	}
	if strings.TrimSpace(c.APIKey) == "" {
		return nil, errors.New("responses API key is required")
	}
	body := map[string]any{
		"model":               modelName,
		"instructions":        request.Instructions,
		"input":               responsesInputItems(request.Items),
		"tools":               responsesTools(request.Tools),
		"tool_choice":         "auto",
		"parallel_tool_calls": false,
		"stream":              c.Stream,
	}
	if len(request.Tools) == 0 {
		delete(body, "tools")
		delete(body, "tool_choice")
	}
	if strings.TrimSpace(request.Instructions) == "" {
		delete(body, "instructions")
	}
	if c.Stream {
		return c.streamTurn(ctx, endpoint, body)
	}
	return c.nonStreamingTurn(ctx, endpoint, body)
}

func (c ResponsesClient) nonStreamingTurn(ctx context.Context, endpoint string, body map[string]any) (<-chan ModelEvent, error) {
	raw, err := c.postJSON(ctx, endpoint, body)
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	modelEvents := modelEventsFromResponsesPayload(payload)
	events := make(chan ModelEvent, len(modelEvents))
	for _, event := range modelEvents {
		events <- event
	}
	close(events)
	return events, nil
}

func (c ResponsesClient) streamTurn(ctx context.Context, endpoint string, body map[string]any) (<-chan ModelEvent, error) {
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
		return nil, fmt.Errorf("responses provider returned %s: %s", resp.Status, string(raw))
	}
	events := make(chan ModelEvent, 16)
	go func() {
		defer close(events)
		defer resp.Body.Close()
		streamResponsesEvents(ctx, resp.Body, events)
	}()
	return events, nil
}

func (c ResponsesClient) postJSON(ctx context.Context, endpoint string, body map[string]any) ([]byte, error) {
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
		return nil, fmt.Errorf("responses provider returned %s: %s", resp.Status, string(raw))
	}
	return raw, nil
}

func (c ResponsesClient) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	timeout := c.TimeoutSeconds
	if timeout <= 0 {
		timeout = 60
	}
	return &http.Client{Timeout: time.Duration(timeout) * time.Second}
}

func responsesEndpoint(baseURL string) string {
	endpoint := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if endpoint == "" {
		return ""
	}
	if strings.HasSuffix(endpoint, "/responses") {
		return endpoint
	}
	if strings.HasSuffix(endpoint, "/v1") {
		return endpoint + "/responses"
	}
	return endpoint + "/v1/responses"
}

func responsesInputItems(items []TurnItemRecord) []map[string]any {
	input := []map[string]any{}
	for _, item := range items {
		switch item.ItemType {
		case "message":
			role := strings.TrimSpace(item.Role)
			if role == "" {
				role = "user"
			}
			contentType := "input_text"
			if role == "assistant" {
				contentType = "output_text"
			}
			input = append(input, map[string]any{
				"role": role,
				"content": []map[string]any{
					{"type": contentType, "text": item.Content},
				},
			})
		case "tool_call":
			input = append(input, map[string]any{
				"type":      "function_call",
				"call_id":   item.CallID,
				"name":      item.ToolName,
				"arguments": mustJSONString(item.Arguments),
			})
		case "tool_output":
			input = append(input, map[string]any{
				"type":    "function_call_output",
				"call_id": item.CallID,
				"output":  mustJSONString(item.Output),
			})
		}
	}
	return input
}

func responsesTools(specs []ToolSpec) []map[string]any {
	tools := make([]map[string]any, 0, len(specs))
	for _, spec := range specs {
		tools = append(tools, map[string]any{
			"type":        "function",
			"name":        spec.Name,
			"description": spec.Description,
			"parameters":  spec.Parameters,
		})
	}
	return tools
}

func modelEventsFromResponsesPayload(payload map[string]any) []ModelEvent {
	events := []ModelEvent{}
	if usage := usageFromResponsesPayload(payload); usage != nil {
		events = append(events, ModelEvent{Type: "usage", Usage: usage})
	}
	output, _ := payload["output"].([]any)
	for _, rawItem := range output {
		item, _ := rawItem.(map[string]any)
		switch item["type"] {
		case "message":
			for _, text := range responseOutputTexts(item) {
				events = append(events, ModelEvent{Type: "assistant.delta", TextDelta: text})
			}
		case "function_call":
			call := ToolCall{
				ID:        strings.TrimSpace(fmt.Sprint(firstNonEmpty(fmt.Sprint(item["call_id"]), fmt.Sprint(item["id"])))),
				Name:      strings.TrimSpace(fmt.Sprint(item["name"])),
				Arguments: parseToolArguments(fmt.Sprint(item["arguments"])),
			}
			events = append(events, ModelEvent{Type: "tool_call", ToolCall: &call})
		}
	}
	return events
}

func responseOutputTexts(item map[string]any) []string {
	content, _ := item["content"].([]any)
	texts := []string{}
	for _, rawContent := range content {
		contentItem, _ := rawContent.(map[string]any)
		if contentItem["type"] == "output_text" || contentItem["type"] == "input_text" {
			if text, ok := contentItem["text"].(string); ok && text != "" {
				texts = append(texts, text)
			}
		}
	}
	return texts
}

type responsesToolAccumulator struct {
	ID        string
	Name      string
	Arguments strings.Builder
}

func streamResponsesEvents(ctx context.Context, body io.Reader, events chan<- ModelEvent) {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	toolCalls := map[int]*responsesToolAccumulator{}
	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") || !strings.HasPrefix(line, "data:") {
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
		eventType := strings.TrimSpace(fmt.Sprint(payload["type"]))
		switch eventType {
		case "response.output_text.delta":
			if delta, ok := payload["delta"].(string); ok && delta != "" {
				events <- ModelEvent{Type: "assistant.delta", TextDelta: delta}
			}
		case "response.output_item.added":
			item, _ := payload["item"].(map[string]any)
			if item["type"] == "function_call" {
				index := intFromAny(payload["output_index"])
				acc := responsesAccumulator(toolCalls, index)
				acc.ID = strings.TrimSpace(fmt.Sprint(firstNonEmpty(fmt.Sprint(item["call_id"]), fmt.Sprint(item["id"]))))
				acc.Name = strings.TrimSpace(fmt.Sprint(item["name"]))
				if args, ok := item["arguments"].(string); ok && args != "" {
					acc.Arguments.WriteString(args)
				}
			}
		case "response.function_call_arguments.delta":
			index := intFromAny(payload["output_index"])
			if delta, ok := payload["delta"].(string); ok && delta != "" {
				responsesAccumulator(toolCalls, index).Arguments.WriteString(delta)
			}
		case "response.function_call_arguments.done":
			index := intFromAny(payload["output_index"])
			if arguments, ok := payload["arguments"].(string); ok && arguments != "" {
				acc := responsesAccumulator(toolCalls, index)
				acc.Arguments.Reset()
				acc.Arguments.WriteString(arguments)
			}
		case "response.completed", "response.done":
			response, _ := payload["response"].(map[string]any)
			if usage := usageFromResponsesPayload(response); usage != nil {
				events <- ModelEvent{Type: "usage", Usage: usage}
			}
		}
	}
	for _, index := range sortedResponsesToolCallIndexes(toolCalls) {
		acc := toolCalls[index]
		events <- ModelEvent{Type: "tool_call", ToolCall: &ToolCall{
			ID:        acc.ID,
			Name:      acc.Name,
			Arguments: parseToolArguments(acc.Arguments.String()),
		}}
	}
}

func responsesAccumulator(toolCalls map[int]*responsesToolAccumulator, index int) *responsesToolAccumulator {
	acc := toolCalls[index]
	if acc == nil {
		acc = &responsesToolAccumulator{}
		toolCalls[index] = acc
	}
	return acc
}

func sortedResponsesToolCallIndexes(toolCalls map[int]*responsesToolAccumulator) []int {
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

func usageFromResponsesPayload(payload map[string]any) *TokenUsage {
	usage, ok := payload["usage"].(map[string]any)
	if !ok {
		return nil
	}
	result := &TokenUsage{
		InputTokens:  intFromAny(firstExisting(usage, "input_tokens", "prompt_tokens")),
		OutputTokens: intFromAny(firstExisting(usage, "output_tokens", "completion_tokens")),
	}
	if details, ok := usage["input_tokens_details"].(map[string]any); ok {
		result.CachedInputTokens = intFromAny(details["cached_tokens"])
	}
	return result
}

func firstExisting(values map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := values[key]; ok {
			return value
		}
	}
	return nil
}
