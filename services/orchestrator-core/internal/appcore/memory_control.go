package appcore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

type MemoryStateSummary struct {
	Confirmed []store.MemoryRecord `json:"confirmed"`
	Pending   []store.MemoryRecord `json:"pending"`
	Temporary []MemoryStateItem    `json:"temporary"`
}

type MemoryStateItem struct {
	Type    string `json:"type"`
	Summary string `json:"summary"`
	Source  string `json:"source"`
}

type memoryControlKind string

const (
	memoryControlNone       memoryControlKind = ""
	memoryControlSelfQuery  memoryControlKind = "self_query"
	memoryControlDeletion   memoryControlKind = "deletion"
	memoryControlCorrection memoryControlKind = "correction"
)

type memoryControlIntent struct {
	Kind memoryControlKind
}

type memoryControlInput struct {
	RunID          string
	ConversationID string
	UserMessageID  string
	AgentID        string
	Message        string
	EventSink      func(eventName string, payload map[string]any)
}

func (a *AppCore) GetMemoryStateSummary(ctx context.Context) (*MemoryStateSummary, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	if !a.isSQLite() {
		return nil, errors.New("memory state summary is implemented for SQLite desktop mode")
	}
	rows, err := a.db.SQL().QueryContext(ctx, `
		SELECT id, type, content, COALESCE(summary,''), scope_type, COALESCE(scope_id,''), privacy_level,
		       confidence, status, source_event_ids, entities, success_count, failure_count, usage_count,
		       positive_feedback, negative_feedback, pinned, disabled_at, COALESCE(merged_into_memory_id,''),
		       COALESCE(conflict_group_id,''), COALESCE(conflict_reason,''), metadata, created_at, updated_at,
		       last_used_at, 0.5 AS score
		FROM memories
		WHERE status IN ('confirmed','pending') AND disabled_at IS NULL AND merged_into_memory_id IS NULL
		ORDER BY status='confirmed' DESC, pinned DESC, updated_at DESC
		LIMIT 100
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	summary := &MemoryStateSummary{Confirmed: []store.MemoryRecord{}, Pending: []store.MemoryRecord{}, Temporary: []MemoryStateItem{}}
	for rows.Next() {
		memory, _, err := scanSQLiteMemory(rows)
		if err != nil {
			return nil, err
		}
		switch memory.Status {
		case "confirmed":
			summary.Confirmed = append(summary.Confirmed, memory)
		case "pending":
			summary.Pending = append(summary.Pending, memory)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	summary.Temporary = listTemporaryMemoryItems(ctx, a.db.SQL())
	return summary, nil
}

func (a *AppCore) handleSQLiteMemoryControl(ctx context.Context, tx *sql.Tx, input memoryControlInput, intent memoryControlIntent) (*sqliteRuntimeResult, error) {
	result := &sqliteRuntimeResult{Steps: []store.RunStepBrief{}, EventSink: input.EventSink}
	for _, step := range []sqliteStepDefinition{
		{stepType: "input_received", title: "Input received", input: map[string]any{"message": input.Message, "channel": "desktop"}, output: map[string]any{"conversation_id": input.ConversationID, "message_id": input.UserMessageID}},
		{stepType: "router_selected", title: "Router selected agent", input: map[string]any{"message": input.Message}, output: map[string]any{"intent": "memory_control", "route_mode": "single", "lead_agent": input.AgentID, "route_source": "desktop_appcore", "handler": intent.Kind}},
	} {
		brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, step.stepType, step.title, step.input, step.output)
		if err != nil {
			return nil, err
		}
		result.Steps = append(result.Steps, brief)
	}

	var deleted []store.MemoryRecord
	var correctionID string
	var correctionTargetID string
	if intent.Kind == memoryControlDeletion {
		var err error
		deleted, err = softDeleteSQLiteMemoriesForRequest(ctx, tx, input.RunID, input.Message)
		if err != nil {
			return nil, err
		}
		brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "memory_deleted", "Memory deletion handled", map[string]any{"message": input.Message}, map[string]any{"deleted_memory_ids": memoryRecordIDs(deleted), "deleted_count": len(deleted)})
		if err != nil {
			return nil, err
		}
		result.Steps = append(result.Steps, brief)
	}
	if intent.Kind == memoryControlCorrection {
		var err error
		correctionID, correctionTargetID, err = proposeSQLiteMemoryCorrection(ctx, tx, input)
		if err != nil {
			return nil, err
		}
		brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "memory_correction_proposed", "Memory correction proposed", map[string]any{"message": input.Message}, map[string]any{"memory_id": correctionID, "target_memory_id": correctionTargetID, "status": "pending"})
		if err != nil {
			return nil, err
		}
		result.Steps = append(result.Steps, brief)
	}

	summary, err := memoryStateSummaryTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	confirmedResults := memoryRecordsAsSearchResults(summary.Confirmed, "memory_control_summary")
	if err := recordSQLiteMemoryUsage(ctx, tx, input.RunID, input.AgentID, confirmedResults); err != nil {
		return nil, err
	}
	if len(confirmedResults) > 0 {
		if _, err := insertSQLiteMemoryContextPackTx(ctx, tx, input.RunID, input.AgentID, confirmedResults, map[string]any{"source": "memory_control_summary", "handler": intent.Kind}); err != nil {
			return nil, err
		}
	}
	result.UsedMemories = confirmedResults
	brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "memory_state_summary", "Memory state summary returned", map[string]any{"handler": intent.Kind}, map[string]any{"confirmed_count": len(summary.Confirmed), "pending_count": len(summary.Pending), "temporary_count": len(summary.Temporary), "deleted_count": len(deleted), "correction_id": correctionID, "target_memory_id": correctionTargetID})
	if err != nil {
		return nil, err
	}
	result.Steps = append(result.Steps, brief)
	response := buildMemoryControlResponse(summary, deleted, correctionID, correctionTargetID)
	if err := finalizeMemoryControlResponse(ctx, tx, input.RunID, input.AgentID, response, result); err != nil {
		return nil, err
	}
	return result, nil
}

func classifyMemoryControlIntent(message string) memoryControlIntent {
	switch {
	case isMemoryDeletionInstruction(message):
		return memoryControlIntent{Kind: memoryControlDeletion}
	case isMemoryCorrectionInstruction(message):
		return memoryControlIntent{Kind: memoryControlCorrection}
	case isMemorySelfQuery(message):
		return memoryControlIntent{Kind: memoryControlSelfQuery}
	default:
		return memoryControlIntent{}
	}
}

func isMemorySelfQuery(message string) bool {
	normalized := strings.ToLower(strings.TrimSpace(message))
	if normalized == "" {
		return false
	}
	if strings.Contains(normalized, "按你记得") || strings.Contains(normalized, "按你记住") {
		return false
	}
	hasMemoryWord := containsAnyText(message, []string{"记忆", "记住了", "记住", "长期记忆", "临时状态", "待确认"})
	hasQuestionWord := containsAnyText(message, []string{"什么", "哪些", "列出", "现在", "查看", "告诉我"})
	return hasMemoryWord && hasQuestionWord && !strings.Contains(message, "请记住") && !strings.Contains(message, "帮我记")
}

func isMemoryDeletionInstruction(message string) bool {
	return containsAnyText(message, []string{"删除", "删掉", "清掉", "忘掉"}) && containsAnyText(message, []string{"记忆", "记住", "内容", "情绪"})
}

func isMemoryCorrectionInstruction(message string) bool {
	return containsAnyText(message, []string{"理解错", "纠正", "改掉", "不是"}) && strings.Contains(message, "不是") && strings.Contains(message, "是")
}

func memoryStateSummaryTx(ctx context.Context, tx *sql.Tx) (*MemoryStateSummary, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT id, type, content, COALESCE(summary,''), scope_type, COALESCE(scope_id,''), privacy_level,
		       confidence, status, source_event_ids, entities, success_count, failure_count, usage_count,
		       positive_feedback, negative_feedback, pinned, disabled_at, COALESCE(merged_into_memory_id,''),
		       COALESCE(conflict_group_id,''), COALESCE(conflict_reason,''), metadata, created_at, updated_at,
		       last_used_at, 0.5 AS score
		FROM memories
		WHERE status IN ('confirmed','pending') AND disabled_at IS NULL AND merged_into_memory_id IS NULL
		ORDER BY status='confirmed' DESC, pinned DESC, updated_at DESC
		LIMIT 100
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	summary := &MemoryStateSummary{Confirmed: []store.MemoryRecord{}, Pending: []store.MemoryRecord{}, Temporary: []MemoryStateItem{}}
	for rows.Next() {
		memory, _, err := scanSQLiteMemory(rows)
		if err != nil {
			return nil, err
		}
		switch memory.Status {
		case "confirmed":
			summary.Confirmed = append(summary.Confirmed, memory)
		case "pending":
			summary.Pending = append(summary.Pending, memory)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	summary.Temporary = listTemporaryMemoryItems(ctx, tx)
	return summary, nil
}

func listTemporaryMemoryItems(ctx context.Context, runner queryContextRunner) []MemoryStateItem {
	rows, err := runner.QueryContext(ctx, `
		SELECT topic, suggested_followup, COALESCE(source_run_id, '')
		FROM open_loops
		WHERE status IN ('open','snoozed')
		ORDER BY updated_at DESC
		LIMIT 20
	`)
	if err != nil {
		return []MemoryStateItem{}
	}
	defer rows.Close()
	items := []MemoryStateItem{}
	for rows.Next() {
		var topic, followup, source string
		if err := rows.Scan(&topic, &followup, &source); err != nil {
			continue
		}
		summary := topic
		if followup != "" {
			summary = topic + "；" + followup
		}
		items = append(items, MemoryStateItem{Type: "open_loop", Summary: summary, Source: source})
	}
	return items
}

func softDeleteSQLiteMemoriesForRequest(ctx context.Context, tx *sql.Tx, runID string, message string) ([]store.MemoryRecord, error) {
	summary, err := memoryStateSummaryTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	targets := []store.MemoryRecord{}
	for _, memory := range append(summary.Confirmed, summary.Pending...) {
		if memoryMatchesDeletionRequest(memory, message) {
			targets = append(targets, memory)
		}
	}
	for _, memory := range targets {
		if _, err := tx.ExecContext(ctx, `
			UPDATE memories
			SET status='deleted',
			    disabled_at=datetime('now'),
			    metadata=json_set(COALESCE(metadata, '{}'), '$.deleted_by', 'memory_control', '$.deleted_run_id', ?, '$.deleted_at', datetime('now')),
			    updated_at=datetime('now')
			WHERE id=?
		`, runID, memory.ID); err != nil {
			return nil, err
		}
	}
	return targets, nil
}

func memoryMatchesDeletionRequest(memory store.MemoryRecord, message string) bool {
	text := strings.ToLower(memory.Content + " " + memory.Summary)
	request := strings.ToLower(message)
	for _, token := range []string{"情绪", "烦", "焦虑", "今天", "临时"} {
		if strings.Contains(request, token) && strings.Contains(text, token) {
			return true
		}
	}
	if strings.Contains(request, memory.ID) {
		return true
	}
	return false
}

func proposeSQLiteMemoryCorrection(ctx context.Context, tx *sql.Tx, input memoryControlInput) (string, string, error) {
	target, err := latestCorrectableMemory(ctx, tx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", "", err
	}
	hasTarget := err == nil
	corrected := correctedMemoryContent(input.Message)
	if corrected == "" {
		corrected = input.Message
	}
	memoryID, err := store.NewID("mem_")
	if err != nil {
		return "", "", err
	}
	targetID := ""
	if hasTarget {
		targetID = target.ID
	}
	if targetID != "" {
		var existingID string
		err := tx.QueryRowContext(ctx, `
			SELECT id
			FROM memories
			WHERE status='pending'
			  AND json_extract(metadata, '$.correction')=1
			  AND json_extract(metadata, '$.target_memory_id')=?
			ORDER BY updated_at DESC
			LIMIT 1
		`, targetID).Scan(&existingID)
		if err == nil {
			_, err = tx.ExecContext(ctx, `
				UPDATE memories
				SET content=?, summary=?, source_event_ids=?, metadata=json_set(COALESCE(metadata, '{}'), '$.last_correction_run_id', ?), updated_at=datetime('now')
				WHERE id=?
			`, corrected, truncate(corrected, 100), mustJSON([]string{input.ConversationID, input.UserMessageID, input.RunID}), input.RunID, existingID)
			return existingID, targetID, err
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", "", err
		}
	}
	metadata := map[string]any{
		"candidate_source": "memory_control",
		"candidate_reason": "用户纠正已有记忆",
		"correction":       true,
		"target_memory_id": targetID,
		"run_id":           input.RunID,
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, metadata)
		VALUES (?, 'user_preference', ?, ?, 'project', 'internal', 0.86, 'pending', ?, '["Memory"]', ?)
	`, memoryID, corrected, truncate(corrected, 100), mustJSON([]string{input.ConversationID, input.UserMessageID, input.RunID}), mustJSON(metadata)); err != nil {
		return "", "", err
	}
	if targetID != "" {
		_, _ = tx.ExecContext(ctx, `UPDATE memories SET metadata=json_set(COALESCE(metadata, '{}'), '$.pending_correction_id', ?, '$.pending_correction_run_id', ?), updated_at=datetime('now') WHERE id=?`, memoryID, input.RunID, targetID)
	}
	return memoryID, targetID, nil
}

func latestCorrectableMemory(ctx context.Context, tx *sql.Tx) (store.MemoryRecord, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT id, type, content, COALESCE(summary,''), scope_type, COALESCE(scope_id,''), privacy_level,
		       confidence, status, source_event_ids, entities, success_count, failure_count, usage_count,
		       positive_feedback, negative_feedback, pinned, disabled_at, COALESCE(merged_into_memory_id,''),
		       COALESCE(conflict_group_id,''), COALESCE(conflict_reason,''), metadata, created_at, updated_at,
		       last_used_at, 0.5 AS score
		FROM memories
		WHERE status IN ('confirmed','pending') AND disabled_at IS NULL AND merged_into_memory_id IS NULL
		ORDER BY updated_at DESC
		LIMIT 1
	`)
	if err != nil {
		return store.MemoryRecord{}, err
	}
	defer rows.Close()
	if rows.Next() {
		memory, _, err := scanSQLiteMemory(rows)
		if err != nil {
			return store.MemoryRecord{}, err
		}
		return memory, rows.Err()
	}
	return store.MemoryRecord{}, sql.ErrNoRows
}

func correctedMemoryContent(message string) string {
	start := strings.Index(message, "不是")
	end := strings.Index(message, "。")
	if end < 0 {
		end = len(message)
	}
	if start >= 0 && end > start {
		return strings.TrimSpace(message[start:end])
	}
	return strings.TrimSpace(message)
}

func buildMemoryControlResponse(summary *MemoryStateSummary, deleted []store.MemoryRecord, correctionID string, correctionTargetID string) string {
	var builder strings.Builder
	if len(deleted) > 0 {
		builder.WriteString(fmt.Sprintf("已删除 %d 条匹配的记忆。\n\n", len(deleted)))
	}
	if correctionID != "" {
		builder.WriteString("已生成一条待确认的记忆修正")
		if correctionTargetID != "" {
			builder.WriteString("，并关联到原记忆。")
		} else {
			builder.WriteString("。")
		}
		builder.WriteString("确认后再替换长期记忆。\n\n")
	}
	builder.WriteString("我现在能看到这些记忆状态：\n\n")
	writeMemorySection(&builder, "长期记忆（已确认）", summary.Confirmed)
	writeMemorySection(&builder, "待确认记忆", summary.Pending)
	builder.WriteString("临时状态：\n")
	if len(summary.Temporary) == 0 {
		builder.WriteString("- 无\n\n")
	} else {
		for _, item := range summary.Temporary {
			builder.WriteString("- ")
			builder.WriteString(item.Type)
			builder.WriteString("：")
			builder.WriteString(item.Summary)
			builder.WriteByte('\n')
		}
		builder.WriteByte('\n')
	}
	builder.WriteString("你可以继续说“删除/修改某条记忆”，或者在右侧记忆面板确认、编辑、拒绝待确认项。")
	return strings.TrimSpace(builder.String())
}

func writeMemorySection(builder *strings.Builder, title string, memories []store.MemoryRecord) {
	builder.WriteString(title)
	builder.WriteString("：\n")
	if len(memories) == 0 {
		builder.WriteString("- 无\n\n")
		return
	}
	for _, memory := range memories {
		builder.WriteString("- ")
		builder.WriteString(firstNonEmpty(memory.Summary, memory.Content))
		if memory.Content != "" && memory.Content != memory.Summary {
			builder.WriteString("：")
			builder.WriteString(memory.Content)
		}
		builder.WriteString("（id: ")
		builder.WriteString(memory.ID)
		builder.WriteString("）\n")
	}
	builder.WriteByte('\n')
}

func finalizeMemoryControlResponse(ctx context.Context, tx *sql.Tx, runID string, agentID string, response string, result *sqliteRuntimeResult) error {
	response = store.RedactSensitiveText(response)
	if err := emitAssistantResponseDeltas(ctx, tx, result, runID, response); err != nil {
		return err
	}
	brief, err := insertSQLiteRunStep(ctx, tx, runID, "agent_call_finished", "Memory control handled", map[string]any{"agent_id": agentID, "deterministic": true}, map[string]any{"response": response})
	if err != nil {
		return err
	}
	result.Steps = append(result.Steps, brief)
	brief, err = insertSQLiteRunStep(ctx, tx, runID, "response_generated", "Response generated", map[string]any{"run_id": runID}, map[string]any{"response": response})
	if err != nil {
		return err
	}
	result.Steps = append(result.Steps, brief)
	if err := finalizeSQLiteRun(ctx, tx, runID, "succeeded", response); err != nil {
		return err
	}
	result.Response = response
	return nil
}

func memoryRecordsAsSearchResults(memories []store.MemoryRecord, reason string) []store.MemorySearchResult {
	results := make([]store.MemorySearchResult, 0, len(memories))
	for _, memory := range memories {
		results = append(results, store.MemorySearchResult{Memory: memory, Score: 1, Reason: reason})
	}
	return results
}

func memoryRecordIDs(memories []store.MemoryRecord) []string {
	ids := make([]string, 0, len(memories))
	for _, memory := range memories {
		ids = append(ids, memory.ID)
	}
	return ids
}

func correctionTargetIDTx(ctx context.Context, tx *sql.Tx, memoryID string) (string, error) {
	var metadataRaw string
	err := tx.QueryRowContext(ctx, `SELECT metadata FROM memories WHERE id=?`, memoryID).Scan(&metadataRaw)
	if err != nil {
		return "", err
	}
	metadata := decodeObject([]byte(metadataRaw))
	return strings.TrimSpace(stringFromAny(metadata["target_memory_id"])), nil
}

func insertMemoryActionLogTx(ctx context.Context, tx *sql.Tx, memoryID string, runID string, action string, comment string) error {
	if strings.TrimSpace(memoryID) == "" {
		return nil
	}
	feedbackID, err := store.NewID("mfb_")
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO memory_feedback (id, memory_id, run_id, feedback, comment)
		VALUES (?, ?, NULLIF(?, ''), ?, NULLIF(?, ''))
	`, feedbackID, memoryID, runID, action, comment)
	return err
}
