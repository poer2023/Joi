package appcore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
	"github.com/hao/agent-os/services/orchestrator-core/internal/turnruntime"
)

type sqliteConfirmationResumeRequest struct {
	ConfirmationID  string
	RunID           string
	TurnID          string
	CallID          string
	CapabilityID    string
	RequestedAction string
	RiskLevel       string
	Input           map[string]any
	ConversationID  string
	UserMessageID   string
	AgentID         string
}

func (a *AppCore) ApproveConfirmation(ctx context.Context, confirmationID string, reason string) error {
	return a.DecideConfirmation(ctx, ConfirmationDecisionRequest{ID: confirmationID, Approve: true, Actor: "desktop_admin", Reason: reason})
}

func (a *AppCore) RejectConfirmation(ctx context.Context, confirmationID string, reason string) error {
	return a.DecideConfirmation(ctx, ConfirmationDecisionRequest{ID: confirmationID, Approve: false, Actor: "desktop_admin", Reason: reason})
}

func (a *AppCore) ResumeRun(ctx context.Context, runID string) error {
	if a.db == nil {
		return errors.New("appcore db is not available")
	}
	if !a.isSQLite() {
		return errors.New("resume is only available for sqlite desktop runtime")
	}
	return a.resumeSQLiteRun(ctx, runID, nil)
}

func (a *AppCore) resumeSQLiteRun(ctx context.Context, runID string, eventSink func(string, map[string]any)) error {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return errors.New("run_id is required")
	}
	tx, err := a.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	request, err := loadSQLiteConfirmationResumeRequest(ctx, tx, runID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	if request.CapabilityID != "apply_patch" {
		return fmt.Errorf("resume currently supports apply_patch only, got %s", request.CapabilityID)
	}
	assembly, err := loadSQLiteToolCallingPromptAssembly(ctx, tx, request.RunID)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE runs SET status='running', error_code=NULL, error_message=NULL, finished_at=NULL, duration_ms=NULL WHERE id=? AND status='waiting_confirmation'`, request.RunID); err != nil {
		return err
	}
	if request.TurnID != "" {
		if _, err := tx.ExecContext(ctx, `UPDATE turns SET status='running', finished_at=NULL WHERE id=?`, request.TurnID); err != nil {
			return err
		}
	}

	inputs := cloneMap(request.Input)
	if inputs == nil {
		inputs = map[string]any{}
	}
	inputs["permission_profile"] = string(PermissionProfileWorkspaceWrite)
	execution, err := a.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
		Type:          "capability_request",
		Capability:    request.CapabilityID,
		Goal:          request.RequestedAction,
		Inputs:        inputs,
		Risk:          "workspace_write",
		RunID:         request.RunID,
		CallID:        request.CallID,
		TurnID:        request.TurnID,
		ApprovalScope: "once",
		ApprovalKey:   request.CallID,
		Source:        "confirmation_resume",
		Evidence:      "approved_confirmation:" + request.ConfirmationID,
	})
	if err != nil {
		_ = markSQLiteResumeFailed(ctx, tx, request.RunID, request.TurnID, err)
		if commitErr := tx.Commit(); commitErr != nil {
			return commitErr
		}
		return err
	}
	output := normalizeResumeOutput(execution.NormalizedResult, execution.ToolRunID)
	if _, err := tx.ExecContext(ctx, `
		UPDATE turn_items
		SET output=?, status='completed', metadata=json_set(COALESCE(metadata, '{}'), '$.resumed_by_confirmation', ?)
		WHERE run_id=? AND call_id=? AND item_type='tool_output' AND status='waiting_confirmation'
	`, mustJSON(store.SanitizeForTrace(output)), request.ConfirmationID, request.RunID, request.CallID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE turn_items
		SET status='completed', metadata=json_set(COALESCE(metadata, '{}'), '$.resumed_by_confirmation', ?)
		WHERE run_id=? AND call_id=? AND item_type='tool_call'
	`, request.ConfirmationID, request.RunID, request.CallID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE confirmation_requests SET resumed_at=datetime('now') WHERE id=?`, request.ConfirmationID); err != nil {
		return err
	}
	if _, err := insertSQLiteRunStep(ctx, tx, request.RunID, "approval_resumed", "Approved tool execution resumed", map[string]any{"confirmation_id": request.ConfirmationID, "call_id": request.CallID, "capability": request.CapabilityID}, output); err != nil {
		return err
	}
	if _, err := appendSQLiteRunEvent(ctx, tx, request.RunID, request.TurnID, "tool.output.delta", map[string]any{"call_id": request.CallID, "tool_name": request.CapabilityID, "status": "completed", "output": output, "resumed": true}); err != nil {
		return err
	}
	if eventSink != nil {
		eventSink("tool.output.delta", map[string]any{"call_id": request.CallID, "tool_name": request.CapabilityID, "status": "completed", "output": output, "resumed": true})
	}
	if _, err := appendSQLiteRunEvent(ctx, tx, request.RunID, request.TurnID, "tool.finished", map[string]any{"call_id": request.CallID, "tool_name": request.CapabilityID, "status": "completed", "output": output, "resumed": true}); err != nil {
		return err
	}
	if eventSink != nil {
		eventSink("tool.finished", map[string]any{"call_id": request.CallID, "tool_name": request.CapabilityID, "status": "completed", "output": output, "resumed": true})
	}

	modelClient, modelProvider, clientName, realModel, fallbackReason := a.toolCallingModelClient(assembly)
	modelCallID, err := insertSQLiteToolCallingModelCall(ctx, tx, request.RunID, request.AgentID, assembly, modelProvider, clientName, realModel, fallbackReason)
	if err != nil {
		return err
	}
	routerInput := sqliteRuntimeInput{
		RunID:             request.RunID,
		ConversationID:    request.ConversationID,
		UserMessageID:     request.UserMessageID,
		AgentID:           request.AgentID,
		ModelName:         assembly.ModelName,
		PermissionProfile: string(PermissionProfileReadOnly),
		EventSink:         eventSink,
	}
	runtimeResult := &sqliteRuntimeResult{Steps: []store.RunStepBrief{}, EventSink: eventSink}
	router := &sqliteToolCallingRouter{core: a, tx: tx, input: routerInput, result: runtimeResult}
	runtime := turnruntime.NewToolCallingRuntime(tx, modelClient, router)
	turnResult, err := runtime.ResumeTurn(ctx, turnruntime.TurnInput{
		RunID:           request.RunID,
		ConversationID:  request.ConversationID,
		UserMessageID:   request.UserMessageID,
		AgentID:         request.AgentID,
		Message:         "",
		ModelID:         assembly.ModelID,
		ModelName:       assembly.ModelName,
		Provider:        valueOrDefault(a.Config.Model.Provider, "mock_provider"),
		CacheablePrefix: assembly.CacheablePrefix,
		DynamicTail:     assembly.DynamicTail,
		PromptCacheKey:  assembly.PromptCacheKey,
		EventSink:       eventSink,
	}, request.TurnID)
	if err != nil {
		_ = markSQLiteResumeFailed(ctx, tx, request.RunID, request.TurnID, err)
		if commitErr := tx.Commit(); commitErr != nil {
			return commitErr
		}
		return err
	}
	inputTokens := firstPositive(turnResult.Usage.InputTokens, len(strings.Fields(assembly.CacheablePrefix))+len(strings.Fields(assembly.DynamicTail)))
	outputTokens := firstPositive(turnResult.Usage.OutputTokens, len(strings.Fields(turnResult.FinalMessage)))
	if err := updateSQLiteToolCallingModelCallResult(ctx, tx, modelCallID, inputTokens, outputTokens, turnResult.Usage.CachedInputTokens, realModel, fallbackReason); err != nil {
		return err
	}
	brief, err := insertSQLiteRunStep(ctx, tx, request.RunID, "model_call_finished", "Model call finished", map[string]any{"agent_id": request.AgentID, "model_id": assembly.ModelID, "prompt_assembly_id": assembly.ID, "runtime_mode": runtimeModeToolCalling, "resumed": true}, map[string]any{"model_call_id": modelCallID, "provider": modelProvider, "model": assembly.ModelName, "real_model": realModel, "fallback_to_mock": !realModel, "fallback_reason": fallbackReason, "client": clientName, "input_tokens": inputTokens, "output_tokens": outputTokens, "cached_input_tokens": turnResult.Usage.CachedInputTokens, "tool_run_ids": turnResult.ToolRunIDs})
	if err != nil {
		return err
	}
	runtimeResult.Steps = append(runtimeResult.Steps, brief)
	if turnResult.Status == "waiting_confirmation" {
		response := valueOrDefault(strings.TrimSpace(turnResult.FinalMessage), "confirmation_required: 该工具请求需要批准后才能继续执行。")
		if _, err := tx.ExecContext(ctx, `UPDATE runs SET status='waiting_confirmation' WHERE id=?`, request.RunID); err != nil {
			return err
		}
		if _, err := appendSQLiteRunEvent(ctx, tx, request.RunID, request.TurnID, "run.waiting_confirmation", map[string]any{"run_id": request.RunID, "status": "waiting_confirmation", "message": response}); err != nil {
			return err
		}
		return tx.Commit()
	}
	response := valueOrDefault(strings.TrimSpace(turnResult.FinalMessage), "已执行批准的工具调用。")
	if err := a.finishSQLiteAgentResponse(ctx, tx, request.RunID, request.AgentID, modelCallID, response, runtimeResult); err != nil {
		return err
	}
	if _, err := appendSQLiteRunEvent(ctx, tx, request.RunID, request.TurnID, "run.completed", map[string]any{"run_id": request.RunID, "status": "succeeded", "resumed": true}); err != nil {
		return err
	}
	if eventSink != nil {
		eventSink("run.completed", map[string]any{"run_id": request.RunID, "status": "succeeded", "resumed": true})
	}
	if err := insertSQLiteAssistantMessageForResume(ctx, tx, request, response, modelCallID); err != nil {
		return err
	}
	if _, err := appendSQLiteRunEvent(ctx, tx, request.RunID, request.TurnID, "run.finalized", map[string]any{"run_id": request.RunID, "status": "completed", "resumed": true, "foreground_completed": true, "background_completed": true}); err != nil {
		return err
	}
	if eventSink != nil {
		eventSink("run.finalized", map[string]any{"run_id": request.RunID, "status": "completed", "resumed": true, "foreground_completed": true, "background_completed": true})
	}
	return tx.Commit()
}

func loadSQLiteConfirmationResumeRequest(ctx context.Context, tx *sql.Tx, runID string) (sqliteConfirmationResumeRequest, error) {
	var request sqliteConfirmationResumeRequest
	var inputRaw string
	if err := tx.QueryRowContext(ctx, `
		SELECT cr.id, COALESCE(cr.run_id, ''), COALESCE(cr.turn_id, ''), COALESCE(cr.call_id, ''),
		       cr.capability_id, cr.requested_action, cr.risk_level, cr.input,
		       COALESCE(r.conversation_id, ''), COALESCE(r.user_message_id, ''), COALESCE(r.selected_agent_id, '')
		FROM confirmation_requests cr
		JOIN runs r ON r.id=cr.run_id
		WHERE cr.run_id=? AND cr.status='approved' AND cr.resumed_at IS NULL
		ORDER BY cr.decided_at DESC, cr.created_at DESC
		LIMIT 1
	`, runID).Scan(&request.ConfirmationID, &request.RunID, &request.TurnID, &request.CallID, &request.CapabilityID, &request.RequestedAction, &request.RiskLevel, &inputRaw, &request.ConversationID, &request.UserMessageID, &request.AgentID); err != nil {
		return sqliteConfirmationResumeRequest{}, err
	}
	request.CapabilityID = store.CanonicalCapabilityName(request.CapabilityID)
	request.Input = decodeObject([]byte(inputRaw))
	return request, nil
}

func loadSQLiteToolCallingPromptAssembly(ctx context.Context, tx *sql.Tx, runID string) (sqlitePromptAssembly, error) {
	var assembly sqlitePromptAssembly
	if err := tx.QueryRowContext(ctx, `
		SELECT pa.id, pa.model_id, COALESCE(m.model_name, ''), pa.cacheable_prefix, pa.dynamic_tail,
		       pa.prefix_hash, pa.dynamic_tail_hash, pa.prompt_cache_key
		FROM prompt_assemblies pa
		LEFT JOIN models m ON m.id=pa.model_id
		WHERE pa.run_id=?
		ORDER BY pa.created_at DESC
		LIMIT 1
	`, runID).Scan(&assembly.ID, &assembly.ModelID, &assembly.ModelName, &assembly.CacheablePrefix, &assembly.DynamicTail, &assembly.PrefixHash, &assembly.DynamicHash, &assembly.PromptCacheKey); err != nil {
		return sqlitePromptAssembly{}, err
	}
	return assembly, nil
}

func normalizeResumeOutput(output map[string]any, toolRunID string) map[string]any {
	normalized := cloneMap(output)
	if normalized == nil {
		normalized = map[string]any{}
	}
	normalized["status"] = valueOrDefault(strings.TrimSpace(stringFromAny(normalized["status"])), "completed")
	if toolRunID != "" {
		normalized["tool_run_id"] = toolRunID
	}
	return normalized
}

func markSQLiteResumeFailed(ctx context.Context, tx *sql.Tx, runID string, turnID string, cause error) error {
	message := "resume failed"
	if cause != nil {
		message = cause.Error()
	}
	if _, err := tx.ExecContext(ctx, `UPDATE runs SET status='failed', error_code='resume_failed', error_message=?, finished_at=datetime('now'), duration_ms=CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER) WHERE id=?`, message, runID); err != nil {
		return err
	}
	if turnID != "" {
		if _, err := tx.ExecContext(ctx, `UPDATE turns SET status='failed', finished_at=datetime('now') WHERE id=?`, turnID); err != nil {
			return err
		}
	}
	_, err := appendSQLiteRunEvent(ctx, tx, runID, turnID, "run.failed", map[string]any{"run_id": runID, "turn_id": turnID, "status": "failed", "error": "resume_failed", "message": message})
	return err
}

func insertSQLiteAssistantMessageForResume(ctx context.Context, tx *sql.Tx, request sqliteConfirmationResumeRequest, response string, modelCallID string) error {
	return insertSQLiteAssistantMessageForToolResume(ctx, tx, request.ConversationID, request.RunID, request.AgentID, response, modelCallID, map[string]any{"resumed_from_confirmation_id": request.ConfirmationID})
}

func insertSQLiteAssistantMessageForToolResume(ctx context.Context, tx *sql.Tx, conversationID string, runID string, agentID string, response string, modelCallID string, metadata map[string]any) error {
	if strings.TrimSpace(conversationID) == "" {
		return nil
	}
	messageID, err := store.NewID("msg_")
	if err != nil {
		return err
	}
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["run_id"] = runID
	metadata["agent_id"] = agentID
	metadata["model_call_id"] = modelCallID
	_, err = tx.ExecContext(ctx, `INSERT INTO messages (id, conversation_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)`, messageID, conversationID, store.RedactSensitiveText(response), mustJSON(metadata))
	return err
}
