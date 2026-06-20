package turnruntime

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

var ErrMaxModelSteps = errors.New("max model steps exceeded")

type ToolCallingRuntime struct {
	History       *HistoryStore
	Events        *EventStore
	Model         ModelClient
	Router        ToolRouter
	MaxModelSteps int
}

func NewToolCallingRuntime(db SQLStore, model ModelClient, router ToolRouter) *ToolCallingRuntime {
	return &ToolCallingRuntime{
		History:       NewHistoryStore(db),
		Events:        NewEventStore(db),
		Model:         model,
		Router:        router,
		MaxModelSteps: 6,
	}
}

func (r *ToolCallingRuntime) RunTurn(ctx context.Context, input TurnInput) (*TurnResult, error) {
	if r == nil || r.History == nil || r.Events == nil || r.Model == nil || r.Router == nil {
		return nil, errors.New("tool calling runtime is not configured")
	}
	maxSteps := r.MaxModelSteps
	if maxSteps <= 0 {
		maxSteps = 6
	}
	turn, err := r.History.CreateTurn(ctx, input.RunID, map[string]any{
		"agent_id":         input.AgentID,
		"runtime_mode":     RuntimeModeToolCalling,
		"prompt_cache_key": input.PromptCacheKey,
	})
	if err != nil {
		return nil, err
	}
	if err := r.emit(ctx, input, turn.ID, "turn.started", map[string]any{"turn_id": turn.ID, "turn_index": turn.TurnIndex}); err != nil {
		return nil, err
	}
	userItem, err := r.History.AppendTurnItem(ctx, TurnItemRecord{
		RunID:     input.RunID,
		TurnID:    turn.ID,
		TurnIndex: turn.TurnIndex,
		ItemType:  "message",
		Role:      "user",
		Content:   input.Message,
		Metadata:  map[string]any{"message_id": input.UserMessageID, "conversation_id": input.ConversationID},
	})
	if err != nil {
		_ = r.History.FinishTurn(ctx, turn.ID, "failed")
		return nil, err
	}
	items := []TurnItemRecord{userItem}
	tools, err := r.Router.ModelVisibleTools(ctx, input.RunID, input.AgentID)
	if err != nil {
		_ = r.History.FinishTurn(ctx, turn.ID, "failed")
		return nil, err
	}
	if err := r.emit(ctx, input, turn.ID, "tools.resolved", map[string]any{"count": len(tools), "tools": tools}); err != nil {
		_ = r.History.FinishTurn(ctx, turn.ID, "failed")
		return nil, err
	}
	result := &TurnResult{}
	availableTools := toolSpecNames(tools)
	for step := 1; step <= maxSteps; step++ {
		if err := r.emit(ctx, input, turn.ID, "model.started", map[string]any{"step": step}); err != nil {
			_ = r.History.FinishTurn(ctx, turn.ID, "failed")
			return nil, err
		}
		if err := r.emit(ctx, input, turn.ID, "model_call.started", map[string]any{"step": step}); err != nil {
			_ = r.History.FinishTurn(ctx, turn.ID, "failed")
			return nil, err
		}
		stream, err := r.Model.StreamTurn(ctx, ModelTurnRequest{
			ModelName:    input.ModelName,
			Instructions: input.CacheablePrefix,
			Items:        items,
			Tools:        tools,
		})
		if err != nil {
			_ = r.History.FinishTurn(ctx, turn.ID, "failed")
			return nil, err
		}
		var assistant strings.Builder
		toolCalls := []ToolCall{}
		for event := range stream {
			if event.TextDelta != "" {
				assistant.WriteString(event.TextDelta)
			}
			if event.ToolCall != nil {
				toolCalls = append(toolCalls, *event.ToolCall)
			}
			if event.Usage != nil {
				result.Usage.InputTokens += event.Usage.InputTokens
				result.Usage.OutputTokens += event.Usage.OutputTokens
				result.Usage.CachedInputTokens += event.Usage.CachedInputTokens
			}
			if err := r.emit(ctx, input, turn.ID, eventTypeForModelEvent(event), payloadForModelEvent(event, step)); err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
		}
		if ctx.Err() != nil {
			_ = r.History.FinishTurn(context.Background(), turn.ID, "aborted")
			_ = r.emit(context.Background(), input, turn.ID, "turn.aborted", map[string]any{"turn_id": turn.ID, "status": "aborted", "reason": ctx.Err().Error()})
			return nil, ctx.Err()
		}
		if err := r.emit(ctx, input, turn.ID, "model.completed", map[string]any{"step": step, "text_length": len([]rune(assistant.String())), "tool_call_count": len(toolCalls)}); err != nil {
			_ = r.History.FinishTurn(ctx, turn.ID, "failed")
			return nil, err
		}
		if len(toolCalls) == 0 {
			finalMessage := strings.TrimSpace(assistant.String())
			if finalMessage == "" {
				finalMessage = "模型没有返回可展示内容。"
			}
			assistantItem, err := r.History.AppendTurnItem(ctx, TurnItemRecord{
				RunID:     input.RunID,
				TurnID:    turn.ID,
				TurnIndex: turn.TurnIndex,
				ItemType:  "message",
				Role:      "assistant",
				Content:   finalMessage,
				Metadata:  map[string]any{"model_step": step},
			})
			if err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
			items = append(items, assistantItem)
			if err := r.History.FinishTurn(ctx, turn.ID, "completed"); err != nil {
				return nil, err
			}
			if err := r.emit(ctx, input, turn.ID, "turn.completed", map[string]any{"turn_id": turn.ID, "status": "completed"}); err != nil {
				return nil, err
			}
			if err := r.emit(ctx, input, turn.ID, "turn.finished", map[string]any{"turn_id": turn.ID, "status": "completed"}); err != nil {
				return nil, err
			}
			result.FinalMessage = finalMessage
			return result, nil
		}
		for _, call := range toolCalls {
			if strings.TrimSpace(call.ID) == "" {
				call.ID = fmt.Sprintf("call_%d_%d", turn.TurnIndex, step)
			}
			call.Name = strings.TrimSpace(call.Name)
			if call.Arguments == nil {
				call.Arguments = map[string]any{}
			}
			callItem, err := r.History.AppendTurnItem(ctx, TurnItemRecord{
				RunID:     input.RunID,
				TurnID:    turn.ID,
				TurnIndex: turn.TurnIndex,
				ItemType:  "tool_call",
				CallID:    call.ID,
				ToolName:  call.Name,
				Arguments: call.Arguments,
				Metadata:  map[string]any{"model_step": step},
			})
			if err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
			items = append(items, callItem)
			if err := r.emit(ctx, input, turn.ID, "tool.call.started", map[string]any{"call_id": call.ID, "tool_name": call.Name, "arguments": call.Arguments}); err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
			if err := r.emit(ctx, input, turn.ID, "tool.started", map[string]any{"call_id": call.ID, "tool_name": call.Name, "arguments": call.Arguments}); err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
			toolResult, err := dispatchToolCall(ctx, r.Router, availableTools, call)
			if err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
			if ctx.Err() != nil {
				_ = r.History.FinishTurn(context.Background(), turn.ID, "aborted")
				_ = r.emit(context.Background(), input, turn.ID, "turn.aborted", map[string]any{"turn_id": turn.ID, "status": "aborted", "reason": ctx.Err().Error()})
				return nil, ctx.Err()
			}
			output := normalizeObject(toolResult.Output)
			status := statusFromToolResult(output, toolResult.Error)
			if status == "failed" && output["error"] == nil {
				output["error"] = toolResult.Error
			}
			outputItem, err := r.History.AppendTurnItem(ctx, TurnItemRecord{
				RunID:     input.RunID,
				TurnID:    turn.ID,
				TurnIndex: turn.TurnIndex,
				ItemType:  "tool_output",
				CallID:    call.ID,
				ToolName:  call.Name,
				Output:    output,
				Status:    status,
				Metadata:  map[string]any{"model_step": step},
			})
			if err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
			items = append(items, outputItem)
			if toolResult.ToolRunID != "" {
				result.ToolRunIDs = append(result.ToolRunIDs, toolResult.ToolRunID)
			}
			if err := r.emit(ctx, input, turn.ID, "tool.output.delta", map[string]any{"call_id": call.ID, "tool_name": call.Name, "status": status, "output": output}); err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
			if status == "failed" {
				if err := r.emit(ctx, input, turn.ID, "tool.failed", map[string]any{"call_id": call.ID, "tool_name": call.Name, "status": status, "output": output, "error": toolResult.Error}); err != nil {
					_ = r.History.FinishTurn(ctx, turn.ID, "failed")
					return nil, err
				}
			}
			if err := r.emit(ctx, input, turn.ID, "tool.finished", map[string]any{"call_id": call.ID, "tool_name": call.Name, "status": status, "output": output}); err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
			if status == "waiting_confirmation" || status == "waiting_tool" {
				if err := r.History.FinishTurn(ctx, turn.ID, status); err != nil {
					return nil, err
				}
				if err := r.emit(ctx, input, turn.ID, "turn.finished", map[string]any{"turn_id": turn.ID, "status": status}); err != nil {
					return nil, err
				}
				result.Status = status
				result.FinalMessage = strings.TrimSpace(fmt.Sprint(output["message"]))
				return result, nil
			}
		}
	}
	_ = r.History.FinishTurn(ctx, turn.ID, "failed")
	return nil, ErrMaxModelSteps
}

func (r *ToolCallingRuntime) ResumeTurn(ctx context.Context, input TurnInput, turnID string) (*TurnResult, error) {
	if r == nil || r.History == nil || r.Events == nil || r.Model == nil || r.Router == nil {
		return nil, errors.New("tool calling runtime is not configured")
	}
	turn, err := r.History.GetTurn(ctx, turnID)
	if err != nil {
		return nil, err
	}
	if err := r.emit(ctx, input, turn.ID, "turn.resumed", map[string]any{"turn_id": turn.ID, "turn_index": turn.TurnIndex}); err != nil {
		return nil, err
	}
	items, err := r.History.ListTurnItems(ctx, input.RunID)
	if err != nil {
		_ = r.History.FinishTurn(ctx, turn.ID, "failed")
		return nil, err
	}
	filtered := make([]TurnItemRecord, 0, len(items))
	for _, item := range items {
		if item.TurnID == "" || item.TurnID == turn.ID {
			filtered = append(filtered, item)
		}
	}
	tools, err := r.Router.ModelVisibleTools(ctx, input.RunID, input.AgentID)
	if err != nil {
		_ = r.History.FinishTurn(ctx, turn.ID, "failed")
		return nil, err
	}
	if err := r.emit(ctx, input, turn.ID, "tools.resolved", map[string]any{"count": len(tools), "tools": tools, "resumed": true}); err != nil {
		_ = r.History.FinishTurn(ctx, turn.ID, "failed")
		return nil, err
	}
	return r.continueTurn(ctx, input, turn, filtered, tools, 1)
}

func (r *ToolCallingRuntime) continueTurn(ctx context.Context, input TurnInput, turn TurnRecord, items []TurnItemRecord, tools []ToolSpec, firstStep int) (*TurnResult, error) {
	maxSteps := r.MaxModelSteps
	if maxSteps <= 0 {
		maxSteps = 6
	}
	if firstStep <= 0 {
		firstStep = 1
	}
	result := &TurnResult{}
	availableTools := toolSpecNames(tools)
	for step := firstStep; step <= maxSteps; step++ {
		if err := r.emit(ctx, input, turn.ID, "model.started", map[string]any{"step": step, "resumed": true}); err != nil {
			_ = r.History.FinishTurn(ctx, turn.ID, "failed")
			return nil, err
		}
		if err := r.emit(ctx, input, turn.ID, "model_call.started", map[string]any{"step": step}); err != nil {
			_ = r.History.FinishTurn(ctx, turn.ID, "failed")
			return nil, err
		}
		stream, err := r.Model.StreamTurn(ctx, ModelTurnRequest{
			ModelName:    input.ModelName,
			Instructions: input.CacheablePrefix,
			Items:        items,
			Tools:        tools,
		})
		if err != nil {
			_ = r.History.FinishTurn(ctx, turn.ID, "failed")
			return nil, err
		}
		var assistant strings.Builder
		toolCalls := []ToolCall{}
		for event := range stream {
			if event.TextDelta != "" {
				assistant.WriteString(event.TextDelta)
			}
			if event.ToolCall != nil {
				toolCalls = append(toolCalls, *event.ToolCall)
			}
			if event.Usage != nil {
				result.Usage.InputTokens += event.Usage.InputTokens
				result.Usage.OutputTokens += event.Usage.OutputTokens
				result.Usage.CachedInputTokens += event.Usage.CachedInputTokens
			}
			if err := r.emit(ctx, input, turn.ID, eventTypeForModelEvent(event), payloadForModelEvent(event, step)); err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
		}
		if ctx.Err() != nil {
			_ = r.History.FinishTurn(context.Background(), turn.ID, "aborted")
			_ = r.emit(context.Background(), input, turn.ID, "turn.aborted", map[string]any{"turn_id": turn.ID, "status": "aborted", "reason": ctx.Err().Error()})
			return nil, ctx.Err()
		}
		if err := r.emit(ctx, input, turn.ID, "model.completed", map[string]any{"step": step, "text_length": len([]rune(assistant.String())), "tool_call_count": len(toolCalls), "resumed": true}); err != nil {
			_ = r.History.FinishTurn(ctx, turn.ID, "failed")
			return nil, err
		}
		if len(toolCalls) == 0 {
			finalMessage := strings.TrimSpace(assistant.String())
			if finalMessage == "" {
				finalMessage = "模型没有返回可展示内容。"
			}
			assistantItem, err := r.History.AppendTurnItem(ctx, TurnItemRecord{
				RunID:     input.RunID,
				TurnID:    turn.ID,
				TurnIndex: turn.TurnIndex,
				ItemType:  "message",
				Role:      "assistant",
				Content:   finalMessage,
				Metadata:  map[string]any{"model_step": step, "resumed": true},
			})
			if err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
			items = append(items, assistantItem)
			if err := r.History.FinishTurn(ctx, turn.ID, "completed"); err != nil {
				return nil, err
			}
			if err := r.emit(ctx, input, turn.ID, "turn.completed", map[string]any{"turn_id": turn.ID, "status": "completed"}); err != nil {
				return nil, err
			}
			if err := r.emit(ctx, input, turn.ID, "turn.finished", map[string]any{"turn_id": turn.ID, "status": "completed"}); err != nil {
				return nil, err
			}
			result.FinalMessage = finalMessage
			return result, nil
		}
		for _, call := range toolCalls {
			if strings.TrimSpace(call.ID) == "" {
				call.ID = fmt.Sprintf("call_%d_%d", turn.TurnIndex, step)
			}
			call.Name = strings.TrimSpace(call.Name)
			if call.Arguments == nil {
				call.Arguments = map[string]any{}
			}
			callItem, err := r.History.AppendTurnItem(ctx, TurnItemRecord{
				RunID:     input.RunID,
				TurnID:    turn.ID,
				TurnIndex: turn.TurnIndex,
				ItemType:  "tool_call",
				CallID:    call.ID,
				ToolName:  call.Name,
				Arguments: call.Arguments,
				Metadata:  map[string]any{"model_step": step, "resumed": true},
			})
			if err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
			items = append(items, callItem)
			if err := r.emit(ctx, input, turn.ID, "tool.call.started", map[string]any{"call_id": call.ID, "tool_name": call.Name, "arguments": call.Arguments, "resumed": true}); err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
			if err := r.emit(ctx, input, turn.ID, "tool.started", map[string]any{"call_id": call.ID, "tool_name": call.Name, "arguments": call.Arguments}); err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
			toolResult, err := dispatchToolCall(ctx, r.Router, availableTools, call)
			if err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
			if ctx.Err() != nil {
				_ = r.History.FinishTurn(context.Background(), turn.ID, "aborted")
				_ = r.emit(context.Background(), input, turn.ID, "turn.aborted", map[string]any{"turn_id": turn.ID, "status": "aborted", "reason": ctx.Err().Error()})
				return nil, ctx.Err()
			}
			output := normalizeObject(toolResult.Output)
			status := statusFromToolResult(output, toolResult.Error)
			if status == "failed" && output["error"] == nil {
				output["error"] = toolResult.Error
			}
			outputItem, err := r.History.AppendTurnItem(ctx, TurnItemRecord{
				RunID:     input.RunID,
				TurnID:    turn.ID,
				TurnIndex: turn.TurnIndex,
				ItemType:  "tool_output",
				CallID:    call.ID,
				ToolName:  call.Name,
				Output:    output,
				Status:    status,
				Metadata:  map[string]any{"model_step": step, "resumed": true},
			})
			if err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
			items = append(items, outputItem)
			if toolResult.ToolRunID != "" {
				result.ToolRunIDs = append(result.ToolRunIDs, toolResult.ToolRunID)
			}
			if err := r.emit(ctx, input, turn.ID, "tool.output.delta", map[string]any{"call_id": call.ID, "tool_name": call.Name, "status": status, "output": output, "resumed": true}); err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
			if status == "failed" {
				if err := r.emit(ctx, input, turn.ID, "tool.failed", map[string]any{"call_id": call.ID, "tool_name": call.Name, "status": status, "output": output, "error": toolResult.Error, "resumed": true}); err != nil {
					_ = r.History.FinishTurn(ctx, turn.ID, "failed")
					return nil, err
				}
			}
			if err := r.emit(ctx, input, turn.ID, "tool.finished", map[string]any{"call_id": call.ID, "tool_name": call.Name, "status": status, "output": output}); err != nil {
				_ = r.History.FinishTurn(ctx, turn.ID, "failed")
				return nil, err
			}
			if status == "waiting_confirmation" || status == "waiting_tool" {
				if err := r.History.FinishTurn(ctx, turn.ID, status); err != nil {
					return nil, err
				}
				if err := r.emit(ctx, input, turn.ID, "turn.finished", map[string]any{"turn_id": turn.ID, "status": status}); err != nil {
					return nil, err
				}
				result.Status = status
				result.FinalMessage = strings.TrimSpace(fmt.Sprint(output["message"]))
				return result, nil
			}
		}
	}
	_ = r.History.FinishTurn(ctx, turn.ID, "failed")
	return nil, ErrMaxModelSteps
}

func statusFromToolResult(output map[string]any, toolError string) string {
	switch outputStatus(output) {
	case "waiting_confirmation":
		return "waiting_confirmation"
	case "queued", "waiting_tool":
		return "waiting_tool"
	case "failed", "blocked", "policy_blocked", "error", "aborted", "timed_out":
		return "failed"
	}
	if strings.TrimSpace(toolError) != "" {
		return "failed"
	}
	return "completed"
}

func outputStatus(output map[string]any) string {
	raw, ok := output["status"]
	if !ok || raw == nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(fmt.Sprint(raw)))
}

func dispatchToolCall(ctx context.Context, router ToolRouter, availableTools map[string]bool, call ToolCall) (*ToolResult, error) {
	if !availableTools[call.Name] {
		return &ToolResult{
			CallID: call.ID,
			Name:   call.Name,
			Output: map[string]any{
				"status":     "blocked",
				"error_code": "TOOL_NOT_AVAILABLE",
				"message":    "tool is not visible for this agent or is disabled",
				"tool_name":  call.Name,
			},
			Error: "tool is not visible for this agent or is disabled",
		}, nil
	}
	return router.Dispatch(ctx, call)
}

func (r *ToolCallingRuntime) emit(ctx context.Context, input TurnInput, turnID string, eventType string, payload map[string]any) error {
	if strings.TrimSpace(eventType) == "" {
		eventType = "runtime.event"
	}
	if payload == nil {
		payload = map[string]any{}
	}
	if _, err := r.Events.AppendRunEvent(ctx, input.RunID, turnID, eventType, payload); err != nil {
		return err
	}
	if input.EventSink != nil {
		input.EventSink(eventType, cloneObject(payload))
	}
	return nil
}

func toolSpecNames(specs []ToolSpec) map[string]bool {
	names := map[string]bool{}
	for _, spec := range specs {
		names[spec.Name] = true
	}
	return names
}

func eventTypeForModelEvent(event ModelEvent) string {
	if strings.TrimSpace(event.Type) != "" {
		return event.Type
	}
	if event.ToolCall != nil {
		return "tool_call"
	}
	if event.TextDelta != "" {
		return "assistant.delta"
	}
	return "model.event"
}

func payloadForModelEvent(event ModelEvent, step int) map[string]any {
	payload := map[string]any{"model_step": step}
	if event.TextDelta != "" {
		payload["text"] = event.TextDelta
		payload["delta"] = event.TextDelta
	}
	if event.Message != "" {
		payload["message"] = event.Message
	}
	if event.ToolCall != nil {
		payload["tool_call"] = event.ToolCall
		payload["call_id"] = event.ToolCall.ID
		payload["tool_name"] = event.ToolCall.Name
	}
	if event.Usage != nil {
		payload["usage"] = event.Usage
	}
	if event.Raw != nil {
		payload["raw"] = event.Raw
	}
	return payload
}
