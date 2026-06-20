package appcore

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
	"github.com/hao/agent-os/services/orchestrator-core/internal/turnruntime"
)

type sqliteWorkerRunResumeContext struct {
	RunID          string
	TurnID         string
	CallID         string
	CapabilityID   string
	ConversationID string
	UserMessageID  string
	AgentID        string
}

func (a *AppCore) resumeSQLiteWorkerTaskResult(ctx context.Context, task gatewayTaskRecord, output map[string]any, toolRunID string) error {
	runID := strings.TrimSpace(task.RunID)
	callID := strings.TrimSpace(stringFromAny(task.Payload["call_id"]))
	turnID := strings.TrimSpace(stringFromAny(task.Payload["turn_id"]))
	if runID == "" || callID == "" || turnID == "" {
		return nil
	}
	tx, err := a.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	resume, err := loadSQLiteWorkerRunResumeContext(ctx, tx, task, callID, turnID)
	if err != nil {
		return err
	}
	assembly, err := loadSQLiteToolCallingPromptAssembly(ctx, tx, runID)
	if err != nil {
		return err
	}
	normalized := normalizeResumeOutput(output, toolRunID)
	normalized["task_id"] = task.ID
	normalized["node_id"] = task.AssignedNodeID
	if _, err := tx.ExecContext(ctx, `UPDATE runs SET status='running', error_code=NULL, error_message=NULL, finished_at=NULL, duration_ms=NULL WHERE id=? AND status IN ('waiting_tool','queued','running')`, runID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE turns SET status='running', finished_at=NULL WHERE id=?`, turnID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE turn_items
		SET output=?, status='completed', metadata=json_set(COALESCE(metadata, '{}'), '$.resumed_by_worker_task', ?)
		WHERE run_id=? AND call_id=? AND item_type='tool_output' AND status IN ('waiting_tool','completed')
	`, mustJSON(store.SanitizeForTrace(normalized)), task.ID, runID, callID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE turn_items
		SET status='completed', metadata=json_set(COALESCE(metadata, '{}'), '$.resumed_by_worker_task', ?)
		WHERE run_id=? AND call_id=? AND item_type='tool_call'
	`, task.ID, runID, callID); err != nil {
		return err
	}
	if _, err := insertSQLiteRunStep(ctx, tx, runID, "worker_result_resumed", "Worker result resumed model turn", map[string]any{"task_id": task.ID, "call_id": callID, "capability": resume.CapabilityID}, normalized); err != nil {
		return err
	}
	if _, err := appendSQLiteRunEvent(ctx, tx, runID, turnID, "tool.output.delta", map[string]any{"call_id": callID, "tool_name": resume.CapabilityID, "status": "completed", "output": normalized, "resumed": true, "task_id": task.ID}); err != nil {
		return err
	}
	if _, err := appendSQLiteRunEvent(ctx, tx, runID, turnID, "tool.finished", map[string]any{"call_id": callID, "tool_name": resume.CapabilityID, "status": "completed", "output": normalized, "resumed": true, "task_id": task.ID}); err != nil {
		return err
	}

	modelClient, modelProvider, clientName, realModel, fallbackReason := a.toolCallingModelClient(assembly)
	modelCallID, err := insertSQLiteToolCallingModelCall(ctx, tx, runID, resume.AgentID, assembly, modelProvider, clientName, realModel, fallbackReason)
	if err != nil {
		return err
	}
	routerInput := sqliteRuntimeInput{
		RunID:             runID,
		ConversationID:    resume.ConversationID,
		UserMessageID:     resume.UserMessageID,
		AgentID:           resume.AgentID,
		ModelName:         assembly.ModelName,
		PermissionProfile: string(PermissionProfileReadOnly),
	}
	runtimeResult := &sqliteRuntimeResult{Steps: []store.RunStepBrief{}}
	router := &sqliteToolCallingRouter{core: a, tx: tx, input: routerInput, result: runtimeResult}
	runtime := turnruntime.NewToolCallingRuntime(tx, modelClient, router)
	turnResult, err := runtime.ResumeTurn(ctx, turnruntime.TurnInput{
		RunID:           runID,
		ConversationID:  resume.ConversationID,
		UserMessageID:   resume.UserMessageID,
		AgentID:         resume.AgentID,
		Message:         "",
		ModelID:         assembly.ModelID,
		ModelName:       assembly.ModelName,
		Provider:        valueOrDefault(a.Config.Model.Provider, "mock_provider"),
		CacheablePrefix: assembly.CacheablePrefix,
		DynamicTail:     assembly.DynamicTail,
		PromptCacheKey:  assembly.PromptCacheKey,
	}, turnID)
	if err != nil {
		_ = markSQLiteResumeFailed(ctx, tx, runID, turnID, err)
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
	brief, err := insertSQLiteRunStep(ctx, tx, runID, "model_call_finished", "Model call finished", map[string]any{"agent_id": resume.AgentID, "model_id": assembly.ModelID, "prompt_assembly_id": assembly.ID, "runtime_mode": runtimeModeToolCalling, "resumed_from_worker": true}, map[string]any{"model_call_id": modelCallID, "provider": modelProvider, "model": assembly.ModelName, "real_model": realModel, "fallback_to_mock": !realModel, "fallback_reason": fallbackReason, "client": clientName, "input_tokens": inputTokens, "output_tokens": outputTokens, "cached_input_tokens": turnResult.Usage.CachedInputTokens, "tool_run_ids": turnResult.ToolRunIDs})
	if err != nil {
		return err
	}
	runtimeResult.Steps = append(runtimeResult.Steps, brief)
	if turnResult.Status == "waiting_confirmation" || turnResult.Status == "waiting_tool" {
		status := turnResult.Status
		response := valueOrDefault(strings.TrimSpace(turnResult.FinalMessage), "工具请求仍在等待。")
		if _, err := tx.ExecContext(ctx, `UPDATE runs SET status=? WHERE id=?`, status, runID); err != nil {
			return err
		}
		if _, err := appendSQLiteRunEvent(ctx, tx, runID, turnID, "run."+status, map[string]any{"run_id": runID, "status": status, "message": response}); err != nil {
			return err
		}
		return tx.Commit()
	}
	response := valueOrDefault(strings.TrimSpace(turnResult.FinalMessage), "Worker 工具结果已回灌模型。")
	if err := a.finishSQLiteAgentResponse(ctx, tx, runID, resume.AgentID, modelCallID, response, runtimeResult); err != nil {
		return err
	}
	if _, err := appendSQLiteRunEvent(ctx, tx, runID, turnID, "run.completed", map[string]any{"run_id": runID, "status": "succeeded", "resumed_from_worker": true}); err != nil {
		return err
	}
	if err := insertSQLiteAssistantMessageForToolResume(ctx, tx, resume.ConversationID, runID, resume.AgentID, response, modelCallID, map[string]any{"resumed_from_worker_task_id": task.ID}); err != nil {
		return err
	}
	if _, err := appendSQLiteRunEvent(ctx, tx, runID, turnID, "run.finalized", map[string]any{"run_id": runID, "status": "completed", "resumed_from_worker": true, "foreground_completed": true, "background_completed": true}); err != nil {
		return err
	}
	return tx.Commit()
}

func loadSQLiteWorkerRunResumeContext(ctx context.Context, tx *sql.Tx, task gatewayTaskRecord, callID string, turnID string) (sqliteWorkerRunResumeContext, error) {
	if strings.TrimSpace(task.RunID) == "" || strings.TrimSpace(callID) == "" || strings.TrimSpace(turnID) == "" {
		return sqliteWorkerRunResumeContext{}, errors.New("worker resume requires run_id, call_id, and turn_id")
	}
	var resume sqliteWorkerRunResumeContext
	if err := tx.QueryRowContext(ctx, `
		SELECT r.id, COALESCE(r.conversation_id, ''), COALESCE(r.user_message_id, ''), COALESCE(r.selected_agent_id, '')
		FROM runs r
		WHERE r.id=?
	`, task.RunID).Scan(&resume.RunID, &resume.ConversationID, &resume.UserMessageID, &resume.AgentID); err != nil {
		return sqliteWorkerRunResumeContext{}, err
	}
	resume.TurnID = turnID
	resume.CallID = callID
	resume.CapabilityID = store.CanonicalCapabilityName(task.CapabilityID)
	return resume, nil
}
