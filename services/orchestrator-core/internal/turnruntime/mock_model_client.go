package turnruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type MockModelClient struct{}

func (c MockModelClient) StreamTurn(ctx context.Context, request ModelTurnRequest) (<-chan ModelEvent, error) {
	events := make(chan ModelEvent, 4)
	go func() {
		defer close(events)
		if ctx.Err() != nil {
			return
		}
		for _, item := range request.Items {
			if item.ItemType == "tool_output" && item.Status == "failed" {
				sendMockText(ctx, events, "工具调用缺少必要参数或被策略拒绝。请补充必要输入后我再继续。")
				return
			}
			if item.ItemType == "tool_output" {
				status := strings.TrimSpace(fmt.Sprint(item.Output["status"]))
				errorCode := ""
				if raw, ok := item.Output["error_code"]; ok && raw != nil {
					errorCode = strings.TrimSpace(fmt.Sprint(raw))
				}
				if status == "blocked" || status == "failed" || errorCode != "" {
					sendMockText(ctx, events, "工具调用缺少必要参数或被策略拒绝。请补充必要输入后我再继续。")
					return
				}
			}
		}
		if output, ok := latestToolOutput(request.Items, "file_analyze"); ok {
			summary := strings.TrimSpace(fmt.Sprint(output["summary"]))
			if summary == "" {
				summary = "文件读取完成。"
			}
			sendMockText(ctx, events, "已完成工具调用闭环。"+summary)
			return
		}
		if output, ok := latestToolOutput(request.Items, "workspace_search"); ok {
			path := firstWorkspaceSearchPath(output)
			if path == "" {
				path = "AGENTS.md"
			}
			sendMockToolCall(ctx, events, ToolCall{
				ID:   "call_file_analyze_1",
				Name: "file_analyze",
				Arguments: map[string]any{
					"path":     path,
					"question": "Summarize the evidence relevant to the user's request.",
				},
			})
			return
		}
		userMessage := latestUserMessage(request.Items)
		if strings.Contains(strings.ToLower(userMessage), "missing path") || strings.Contains(userMessage, "缺少 path") {
			sendMockToolCall(ctx, events, ToolCall{ID: "call_file_analyze_missing_path", Name: "file_analyze", Arguments: map[string]any{}})
			return
		}
		if strings.Contains(userMessage, "SendChat") || strings.Contains(strings.ToLower(userMessage), "sendchat") {
			sendMockToolCall(ctx, events, ToolCall{
				ID:   "call_workspace_search_1",
				Name: "workspace_search",
				Arguments: map[string]any{
					"query":       "SendChat",
					"glob":        "*.go",
					"max_results": 5,
				},
			})
			return
		}
		sendMockText(ctx, events, "tool_calling runtime 已启用。")
	}()
	return events, nil
}

func sendMockText(ctx context.Context, events chan<- ModelEvent, text string) {
	if text == "" || ctx.Err() != nil {
		return
	}
	events <- ModelEvent{Type: "assistant.delta", TextDelta: text}
}

func sendMockToolCall(ctx context.Context, events chan<- ModelEvent, call ToolCall) {
	if ctx.Err() != nil {
		return
	}
	events <- ModelEvent{Type: "tool_call", ToolCall: &call}
}

func latestUserMessage(items []TurnItemRecord) string {
	for index := len(items) - 1; index >= 0; index-- {
		if items[index].ItemType == "message" && items[index].Role == "user" {
			return items[index].Content
		}
	}
	return ""
}

func latestToolOutput(items []TurnItemRecord, toolName string) (map[string]any, bool) {
	for index := len(items) - 1; index >= 0; index-- {
		item := items[index]
		if item.ItemType == "tool_output" && item.ToolName == toolName {
			return normalizeObject(item.Output), true
		}
	}
	return nil, false
}

func firstWorkspaceSearchPath(output map[string]any) string {
	normalized := normalizeObject(output)
	results, ok := normalized["results"].([]any)
	if !ok || len(results) == 0 {
		return ""
	}
	first, ok := results[0].(map[string]any)
	if !ok {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(first["path"]))
}

func normalizeObject(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return value
	}
	normalized := map[string]any{}
	if err := json.Unmarshal(raw, &normalized); err != nil {
		return value
	}
	return normalized
}
