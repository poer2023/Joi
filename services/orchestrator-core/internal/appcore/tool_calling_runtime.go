package appcore

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
	"github.com/hao/agent-os/services/orchestrator-core/internal/turnruntime"
)

type sqliteToolCallingRouter struct {
	core   *AppCore
	tx     *sql.Tx
	input  sqliteRuntimeInput
	result *sqliteRuntimeResult
}

func (a *AppCore) runSQLiteToolCallingRuntime(ctx context.Context, tx *sql.Tx, input sqliteRuntimeInput) (*sqliteRuntimeResult, error) {
	result := &sqliteRuntimeResult{Steps: []store.RunStepBrief{}, EventSink: input.EventSink}
	if a.turns == nil {
		a.turns = NewTurnManager()
	}
	runCtx, cancel := context.WithCancel(ctx)
	if err := a.turns.Start(input.RunID, "", input.ConversationID, cancel); err != nil {
		cancel()
		return nil, err
	}
	defer a.turns.Finish(input.RunID)
	eventSink := func(eventName string, payload map[string]any) {
		if eventName == "turn.started" {
			a.turns.UpdateTurnID(input.RunID, stringFromAny(payload["turn_id"]))
		}
		if input.EventSink != nil {
			input.EventSink(eventName, payload)
		}
	}
	if _, err := appendSQLiteRunEvent(ctx, tx, input.RunID, "", "run.started", map[string]any{"run_id": input.RunID, "conversation_id": input.ConversationID, "status": "running"}); err != nil {
		cancel()
		return nil, err
	}
	eventSink("run.started", map[string]any{"run_id": input.RunID, "conversation_id": input.ConversationID, "status": "running"})
	for _, step := range []sqliteStepDefinition{
		{stepType: "input_received", title: "Input received", input: map[string]any{"message": input.Message, "channel": input.Channel}, output: map[string]any{"conversation_id": input.ConversationID, "message_id": input.UserMessageID}},
		{stepType: "router_selected", title: "Router selected agent", input: map[string]any{"message": input.Message}, output: input.RouteResult},
	} {
		brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, step.stepType, step.title, step.input, step.output)
		if err != nil {
			return nil, err
		}
		result.Steps = append(result.Steps, brief)
	}
	assembly, err := a.insertSQLitePromptAssembly(ctx, tx, input.RunID, input.AgentID, input.Message, input.RouteResult, "", nil, input.ModelName)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE runs SET selected_model_id=? WHERE id=?`, assembly.ModelID, input.RunID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE models SET supports_tool_calling=1, updated_at=datetime('now') WHERE id=?`, assembly.ModelID); err != nil {
		return nil, err
	}
	brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "prompt_assembled", "Prompt assembly finished", map[string]any{"run_id": input.RunID, "agent_id": input.AgentID, "runtime_mode": runtimeModeToolCalling}, map[string]any{"prompt_assembly_id": assembly.ID, "prefix_hash": assembly.PrefixHash, "dynamic_tail_hash": assembly.DynamicHash, "prompt_cache_key": assembly.PromptCacheKey, "memory_profile_version": desktopMemoryProfileVersion, "tool_schema_version": desktopToolSchemaVersion})
	if err != nil {
		return nil, err
	}
	result.Steps = append(result.Steps, brief)
	modelClient, modelProvider, clientName, realModel, fallbackReason := a.toolCallingModelClient(assembly)
	modelCallID, err := insertSQLiteToolCallingModelCall(ctx, tx, input.RunID, input.AgentID, assembly, modelProvider, clientName, realModel, fallbackReason)
	if err != nil {
		return nil, err
	}
	router := &sqliteToolCallingRouter{core: a, tx: tx, input: input, result: result}
	runtime := turnruntime.NewToolCallingRuntime(tx, modelClient, router)
	turnResult, err := runtime.RunTurn(runCtx, turnruntime.TurnInput{
		RunID:           input.RunID,
		ConversationID:  input.ConversationID,
		UserMessageID:   input.UserMessageID,
		AgentID:         input.AgentID,
		Message:         input.Message,
		ModelID:         assembly.ModelID,
		ModelName:       assembly.ModelName,
		Provider:        valueOrDefault(a.Config.Model.Provider, "mock_provider"),
		CacheablePrefix: assembly.CacheablePrefix,
		DynamicTail:     assembly.DynamicTail,
		PromptCacheKey:  assembly.PromptCacheKey,
		EventSink:       eventSink,
	})
	if err != nil {
		if errors.Is(err, context.Canceled) {
			_, _ = tx.ExecContext(ctx, `UPDATE runs SET status='aborted', error_code='interrupted', error_message='Run interrupted by user', finished_at=datetime('now'), duration_ms=CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER) WHERE id=?`, input.RunID)
			if active, ok := a.turns.Get(input.RunID); ok && active.TurnID != "" {
				_, _ = tx.ExecContext(ctx, `UPDATE turns SET status='aborted', finished_at=datetime('now') WHERE id=?`, active.TurnID)
				_, _ = appendSQLiteRunEvent(ctx, tx, input.RunID, active.TurnID, "run.aborted", map[string]any{"run_id": input.RunID, "status": "aborted", "reason": "interrupted"})
			}
			eventSink("run.failed", map[string]any{"run_id": input.RunID, "status": "aborted", "message": "Run interrupted by user"})
			return nil, err
		}
		_, _ = tx.ExecContext(ctx, `UPDATE runs SET status='failed', error_code='tool_calling_runtime_failed', error_message=?, finished_at=datetime('now') WHERE id=?`, err.Error(), input.RunID)
		_, _ = appendSQLiteRunEvent(ctx, tx, input.RunID, "", "run.failed", map[string]any{"run_id": input.RunID, "status": "failed", "error": err.Error()})
		return nil, err
	}
	inputTokens := firstPositive(turnResult.Usage.InputTokens, len(strings.Fields(assembly.CacheablePrefix))+len(strings.Fields(assembly.DynamicTail)))
	outputTokens := firstPositive(turnResult.Usage.OutputTokens, len(strings.Fields(turnResult.FinalMessage)))
	if err := updateSQLiteToolCallingModelCallResult(ctx, tx, modelCallID, inputTokens, outputTokens, turnResult.Usage.CachedInputTokens, realModel, fallbackReason); err != nil {
		return nil, err
	}
	brief, err = insertSQLiteRunStep(ctx, tx, input.RunID, "model_call_finished", "Model call finished", map[string]any{"agent_id": input.AgentID, "model_id": assembly.ModelID, "prompt_assembly_id": assembly.ID, "runtime_mode": runtimeModeToolCalling}, map[string]any{"model_call_id": modelCallID, "provider": modelProvider, "model": assembly.ModelName, "real_model": realModel, "fallback_to_mock": !realModel, "fallback_reason": fallbackReason, "client": clientName, "input_tokens": inputTokens, "output_tokens": outputTokens, "cached_input_tokens": turnResult.Usage.CachedInputTokens, "tool_run_ids": turnResult.ToolRunIDs})
	if err != nil {
		return nil, err
	}
	result.Steps = append(result.Steps, brief)
	if turnResult.Status == "waiting_confirmation" {
		response := strings.TrimSpace(turnResult.FinalMessage)
		if response == "" {
			response = "confirmation_required: 该工具请求需要批准后才能继续执行。"
		}
		if _, err := tx.ExecContext(ctx, `UPDATE runs SET status='waiting_confirmation' WHERE id=?`, input.RunID); err != nil {
			return nil, err
		}
		if _, err := appendSQLiteRunEvent(ctx, tx, input.RunID, "", "run.waiting_confirmation", map[string]any{"run_id": input.RunID, "status": "waiting_confirmation", "message": response}); err != nil {
			return nil, err
		}
		eventSink("run.waiting_confirmation", map[string]any{"run_id": input.RunID, "status": "waiting_confirmation", "message": response})
		result.Response = response
		result.WaitingApproval = true
		return result, nil
	}
	if turnResult.Status == "waiting_tool" {
		response := strings.TrimSpace(turnResult.FinalMessage)
		if response == "" {
			response = "已交给执行后台处理，结果会在这里更新。"
		}
		if _, err := tx.ExecContext(ctx, `UPDATE runs SET status='waiting_tool' WHERE id=?`, input.RunID); err != nil {
			return nil, err
		}
		if _, err := appendSQLiteRunEvent(ctx, tx, input.RunID, "", "run.waiting_tool", map[string]any{"run_id": input.RunID, "status": "waiting_tool", "message": response}); err != nil {
			return nil, err
		}
		eventSink("run.waiting_tool", map[string]any{"run_id": input.RunID, "status": "waiting_tool", "message": response})
		result.Response = response
		result.Queued = true
		return result, nil
	}
	response := strings.TrimSpace(turnResult.FinalMessage)
	if response == "" {
		response = "模型没有返回可展示内容。"
	}
	if err := a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, modelCallID, response, result); err != nil {
		return nil, err
	}
	if _, err := appendSQLiteRunEvent(ctx, tx, input.RunID, "", "run.completed", map[string]any{"run_id": input.RunID, "status": "succeeded"}); err != nil {
		return nil, err
	}
	eventSink("run.completed", map[string]any{"run_id": input.RunID, "status": "succeeded"})
	return result, nil
}

func (a *AppCore) toolCallingModelClient(assembly sqlitePromptAssembly) (turnruntime.ModelClient, string, string, bool, string) {
	provider := valueOrDefault(strings.TrimSpace(a.Config.Model.Provider), os.Getenv("MODEL_PROVIDER"))
	if provider == "" {
		provider = "mock_provider"
	}
	modelName := valueOrDefault(strings.TrimSpace(assembly.ModelName), valueOrDefault(a.Config.Model.Name, os.Getenv("MODEL_NAME")))
	baseURL := valueOrDefault(strings.TrimSpace(a.Config.Model.BaseURL), os.Getenv("MODEL_BASE_URL"))
	apiKey := toolCallingAPIKey(baseURL)
	if provider == "openai_compatible" && strings.TrimSpace(baseURL) != "" && strings.TrimSpace(apiKey) != "" && strings.TrimSpace(modelName) != "" {
		if strings.EqualFold(strings.TrimSpace(os.Getenv("JOI_MODEL_API")), "responses") {
			return turnruntime.ResponsesClient{
				BaseURL:        baseURL,
				APIKey:         apiKey,
				ModelName:      modelName,
				TimeoutSeconds: a.Config.Model.TimeoutSeconds,
				Stream:         true,
			}, provider, "responses_tools", true, ""
		}
		return turnruntime.ChatCompletionsClient{
			BaseURL:        baseURL,
			APIKey:         apiKey,
			ModelName:      modelName,
			TimeoutSeconds: a.Config.Model.TimeoutSeconds,
			Stream:         true,
		}, provider, "chat_completions_tools", true, ""
	}
	fallbackReason := ""
	if provider == "openai_compatible" {
		fallbackReason = "provider config missing: MODEL_BASE_URL, MODEL_API_KEY, or MODEL_NAME is empty"
	}
	return turnruntime.MockModelClient{}, "mock_provider", "mock_tool_calling", false, fallbackReason
}

func toolCallingAPIKey(baseURL string) string {
	if value := os.Getenv("MODEL_API_KEY"); value != "" {
		return value
	}
	if strings.Contains(baseURL, "deepseek.com") {
		if value := os.Getenv("DEEPSEEK_API_KEY"); value != "" {
			return value
		}
	}
	return os.Getenv("MODEL_DEFAULT_API_KEY")
}

func insertSQLiteToolCallingModelCall(ctx context.Context, tx *sql.Tx, runID string, agentID string, assembly sqlitePromptAssembly, provider string, clientName string, realModel bool, fallbackReason string) (string, error) {
	modelCallID, err := store.NewID("modelcall_")
	if err != nil {
		return "", err
	}
	inputTokens := len(strings.Fields(assembly.CacheablePrefix)) + len(strings.Fields(assembly.DynamicTail))
	metadata := map[string]any{
		"real_model":          realModel,
		"fallback_to_mock":    !realModel,
		"fallback_reason":     fallbackReason,
		"desktop_mode":        true,
		"provider_cache_key":  assembly.PromptCacheKey,
		"estimated_cost":      0,
		"prompt_assembly_id":  assembly.ID,
		"tool_schema_version": desktopToolSchemaVersion,
		"runtime_mode":        runtimeModeToolCalling,
		"client":              clientName,
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO model_calls (
			id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name,
			prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, output_tokens,
			cacheable_prefix_tokens, dynamic_tail_tokens, cached_input_tokens, latency_ms,
			status, raw_response, metadata
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 0, 'running', ?, ?)
	`, modelCallID, runID, agentID, assembly.ModelID, assembly.ID, provider, assembly.ModelName, assembly.PromptCacheKey, assembly.PrefixHash, assembly.DynamicHash, inputTokens, len(strings.Fields(assembly.CacheablePrefix)), len(strings.Fields(assembly.DynamicTail)), mustJSON(map[string]any{"provider": provider, "runtime_mode": runtimeModeToolCalling, "client": clientName}), mustJSON(metadata))
	if err != nil {
		return "", err
	}
	return modelCallID, nil
}

func updateSQLiteToolCallingModelCallResult(ctx context.Context, tx *sql.Tx, modelCallID string, inputTokens int, outputTokens int, cachedInputTokens int, realModel bool, fallbackReason string) error {
	status := "succeeded"
	if !realModel {
		status = "fallback_to_mock"
	}
	_, err := tx.ExecContext(ctx, `
		UPDATE model_calls
		SET input_tokens=?,
		    output_tokens=?,
		    cached_input_tokens=?,
		    status=?,
			    metadata=json_set(
			        COALESCE(metadata, '{}'),
			        '$.real_model', json(?),
			        '$.fallback_to_mock', json(?),
			        '$.fallback_reason', ?
			    )
		WHERE id=?
	`, inputTokens, outputTokens, cachedInputTokens, status, boolJSON(realModel), boolJSON(!realModel), fallbackReason, modelCallID)
	return err
}

func firstPositive(values ...int) int {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func boolJSON(value bool) string {
	if value {
		return "true"
	}
	return "false"
}

func (r *sqliteToolCallingRouter) ModelVisibleTools(ctx context.Context, runID string, agentID string) ([]turnruntime.ToolSpec, error) {
	profile := normalizedPermissionProfile(r.input.PermissionProfile)
	maxRisk := maxToolRiskForPermissionProfile(profile)
	if maxRisk == "read_only" {
		maxRisk = "workspace_write"
	}
	return turnruntime.BuildToolSpecsForRisk(ctx, r.tx, agentID, maxRisk)
}

func (r *sqliteToolCallingRouter) Dispatch(ctx context.Context, call turnruntime.ToolCall) (*turnruntime.ToolResult, error) {
	capability := store.CanonicalCapabilityName(call.Name)
	inputs := cloneMap(call.Arguments)
	if inputs == nil {
		inputs = map[string]any{}
	}
	if _, ok := inputs["permission_profile"]; !ok {
		inputs["permission_profile"] = string(normalizedPermissionProfile(r.input.PermissionProfile))
	}
	goal := strings.TrimSpace(stringFromAny(inputs["goal"]))
	if goal == "" {
		goal = "Execute " + capability + " for the current user request."
	}
	risk := strings.TrimSpace(stringFromAny(inputs["risk"]))
	if risk == "" {
		risk = "read_only"
	}
	profile := normalizedPermissionProfile(stringFromAny(inputs["permission_profile"]))
	if risk == "read_only" && capability == "apply_patch" && permissionProfileAllowsWorkspaceWrite(profile) {
		risk = "workspace_write"
	}
	if risk == "read_only" && (capability == "browser_click" || capability == "browser_type") && profile == PermissionProfileDangerFullAccess {
		risk = "browser_interaction"
	}
	brief, err := insertSQLiteRunStep(ctx, r.tx, r.input.RunID, "capability_requested", "Model requested capability tool", map[string]any{"agent_id": r.input.AgentID, "call_id": call.ID, "tool_name": call.Name}, map[string]any{"capability": capability, "goal": goal, "inputs": inputs, "risk": risk, "source": "tool_calling"})
	if err != nil {
		return nil, err
	}
	r.result.Steps = append(r.result.Steps, brief)
	if capability == "memory_search" {
		return r.dispatchMemorySearch(ctx, call, inputs, goal)
	}
	if capability == "apply_patch" && !permissionProfileAllowsWorkspaceWrite(profile) {
		return r.pauseForToolConfirmation(ctx, call, capability, inputs, goal, "workspace_write")
	}
	execution, err := r.core.executeAndRecordSQLiteCapability(ctx, r.tx, store.CapabilityRequest{
		Type:          "capability_request",
		Capability:    capability,
		Goal:          goal,
		Inputs:        inputs,
		Risk:          risk,
		RunID:         r.input.RunID,
		CallID:        call.ID,
		TurnID:        r.activeTurnID(),
		ApprovalScope: "once",
		ApprovalKey:   call.ID,
		PreferredNode: r.input.PreferredNode,
		AllowWorker:   r.input.AllowWorker,
		Source:        "model_tool_call",
		Evidence:      r.input.Message,
	})
	if err != nil {
		if isToolCallingRecoverableCapabilityError(err) {
			output := toolCallingBlockedOutput(capability, err)
			brief, stepErr := insertSQLiteRunStep(ctx, r.tx, r.input.RunID, "capability_rejected", "Capability request rejected", map[string]any{"agent_id": r.input.AgentID, "capability": capability, "call_id": call.ID}, output)
			if stepErr != nil {
				return nil, stepErr
			}
			r.result.Steps = append(r.result.Steps, brief)
			return &turnruntime.ToolResult{CallID: call.ID, Name: call.Name, Output: output, Error: stringFromAny(output["message"])}, nil
		}
		return nil, err
	}
	if execution.NormalizedResult == nil {
		execution.NormalizedResult = map[string]any{}
	}
	brief, err = insertSQLiteRunStep(ctx, r.tx, r.input.RunID, "tool_finished", "Tool runtime finished", map[string]any{"workflow_name": execution.Workflow.WorkflowName, "tool_run_id": execution.ToolRunID, "call_id": call.ID}, execution.NormalizedResult)
	if err != nil {
		return nil, err
	}
	r.result.Steps = append(r.result.Steps, brief)
	return &turnruntime.ToolResult{
		CallID:    call.ID,
		Name:      call.Name,
		ToolRunID: execution.ToolRunID,
		Output:    execution.NormalizedResult,
	}, nil
}

func (r *sqliteToolCallingRouter) pauseForToolConfirmation(ctx context.Context, call turnruntime.ToolCall, capability string, inputs map[string]any, goal string, risk string) (*turnruntime.ToolResult, error) {
	confirmationID, err := store.NewID("confirm_")
	if err != nil {
		return nil, err
	}
	turnID := r.activeTurnID()
	approvalKey := strings.TrimSpace(call.ID)
	if approvalKey == "" {
		approvalKey = confirmationID
	}
	payload := map[string]any{
		"run_id":           r.input.RunID,
		"turn_id":          turnID,
		"call_id":          call.ID,
		"confirmation_id":  confirmationID,
		"capability":       capability,
		"risk":             risk,
		"approval_scope":   "once",
		"approval_key":     approvalKey,
		"requested_action": goal,
		"message":          "confirmation_required: workspace write requires approval before execution",
	}
	if _, err := r.tx.ExecContext(ctx, `
		INSERT INTO confirmation_requests (id, run_id, capability_id, requested_action, risk_level, input, call_id, turn_id, approval_scope, approval_key)
		VALUES (?, NULLIF(?, ''), ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), 'once', ?)
	`, confirmationID, r.input.RunID, capability, goal, risk, mustJSON(store.SanitizeForTrace(inputs)), call.ID, turnID, approvalKey); err != nil {
		return nil, err
	}
	if _, err := r.tx.ExecContext(ctx, `UPDATE runs SET status='waiting_confirmation' WHERE id=?`, r.input.RunID); err != nil {
		return nil, err
	}
	if turnID != "" {
		if _, err := r.tx.ExecContext(ctx, `UPDATE turns SET status='waiting_confirmation' WHERE id=?`, turnID); err != nil {
			return nil, err
		}
	}
	if call.ID != "" {
		if _, err := r.tx.ExecContext(ctx, `UPDATE turn_items SET status='waiting_confirmation' WHERE run_id=? AND call_id=? AND item_type='tool_call'`, r.input.RunID, call.ID); err != nil {
			return nil, err
		}
	}
	brief, err := insertSQLiteRunStep(ctx, r.tx, r.input.RunID, "approval_requested", "Tool execution waiting for confirmation", map[string]any{"agent_id": r.input.AgentID, "call_id": call.ID, "capability": capability}, payload)
	if err != nil {
		return nil, err
	}
	r.result.Steps = append(r.result.Steps, brief)
	if _, err := appendSQLiteRunEvent(ctx, r.tx, r.input.RunID, turnID, "approval.requested", payload); err != nil {
		return nil, err
	}
	if r.input.EventSink != nil {
		r.input.EventSink("approval.requested", payload)
	}
	output := cloneMap(payload)
	output["status"] = "waiting_confirmation"
	return &turnruntime.ToolResult{CallID: call.ID, Name: call.Name, Output: output}, nil
}

func (r *sqliteToolCallingRouter) activeTurnID() string {
	if r == nil || r.core == nil || r.core.turns == nil {
		return ""
	}
	active, ok := r.core.turns.Get(r.input.RunID)
	if !ok {
		return ""
	}
	return strings.TrimSpace(active.TurnID)
}

func (r *sqliteToolCallingRouter) dispatchMemorySearch(ctx context.Context, call turnruntime.ToolCall, inputs map[string]any, goal string) (*turnruntime.ToolResult, error) {
	query := strings.TrimSpace(stringFromAny(inputs["query"]))
	if query == "" {
		query = strings.TrimSpace(goal)
	}
	if query == "" {
		query = r.input.Message
	}
	results, err := searchSQLiteMemoriesInTx(ctx, r.tx, query, 5)
	if err != nil {
		return nil, err
	}
	if err := recordSQLiteMemoryUsage(ctx, r.tx, r.input.RunID, r.input.AgentID, results); err != nil {
		return nil, err
	}
	r.result.UsedMemories = mergeMemorySearchResults(r.result.UsedMemories, results)
	output := map[string]any{"status": "completed", "query": query, "results": results, "retrieved_memory_ids": memoryIDs(results)}
	brief, err := insertSQLiteRunStep(ctx, r.tx, r.input.RunID, "memory_search_finished", "Memory search finished", map[string]any{"query": query, "call_id": call.ID}, output)
	if err != nil {
		return nil, err
	}
	r.result.Steps = append(r.result.Steps, brief)
	return &turnruntime.ToolResult{CallID: call.ID, Name: call.Name, Output: output}, nil
}

func isToolCallingRecoverableCapabilityError(err error) bool {
	return errors.Is(err, store.ErrPolicyDenied) ||
		errors.Is(err, store.ErrCapabilityMismatch) ||
		errors.Is(err, store.ErrCapabilityMissing) ||
		errors.Is(err, store.ErrMissingArgument)
}

func toolCallingBlockedOutput(capability string, err error) map[string]any {
	output := map[string]any{
		"status":     "blocked",
		"error_code": "POLICY_DENIED",
		"message":    err.Error(),
		"capability": capability,
	}
	if validation, ok := store.CapabilityValidationResultFromError(err); ok {
		output["error_code"] = validation.Code
		output["validation"] = validation
		if validation.Message != "" {
			output["message"] = validation.Message
		}
	}
	return output
}

func cloneMap(value map[string]any) map[string]any {
	if value == nil {
		return nil
	}
	cloned := make(map[string]any, len(value))
	for key, item := range value {
		cloned[key] = item
	}
	return cloned
}
