package appcore

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

type ReflectionRequest struct {
	ConversationID string `json:"conversation_id"`
	RunID          string `json:"run_id"`
	MessageID      string `json:"message_id"`
	Message        string `json:"message"`
	InputMode      string `json:"input_mode"`
	ProductTaskID  string `json:"product_task_id"`
	SourceChannel  string `json:"source_channel"`
	UserID         string `json:"user_id"`
}

type ReflectionResult struct {
	ConversationType       string                    `json:"conversation_type"`
	Importance             string                    `json:"importance"`
	ShouldCreateTask       bool                      `json:"should_create_task"`
	MemoryCandidates       []store.MemoryRecord      `json:"memory_candidates"`
	TaskCandidates         []ReflectionTaskCandidate `json:"task_candidates"`
	OpenLoops              []OpenLoopRecord          `json:"open_loops"`
	ProactiveOpportunities []ProactiveMessageRecord  `json:"proactive_opportunities"`
	ProductTask            *ProductTask              `json:"product_task,omitempty"`
}

type ReflectionTaskCandidate struct {
	Title          string                   `json:"title"`
	Description    string                   `json:"description"`
	Priority       string                   `json:"priority"`
	Mode           string                   `json:"mode"`
	SuggestedSteps []ProductTaskStepRequest `json:"suggested_steps"`
}

type conversationClassification struct {
	InputMode          string
	Mode               string
	InteractionClass   string
	ConversationType   string
	Importance         string
	ShouldCreateTask   bool
	ShouldReflect      bool
	RequiresUserInput  bool
	MissingInput       string
	ClassificationNote string
}

func (a *AppCore) RunConversationReflection(ctx context.Context, req ReflectionRequest) (*ReflectionResult, error) {
	if err := a.requireSQLiteProductAPI(); err != nil {
		return nil, err
	}
	tx, err := a.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := a.runConversationReflectionTx(ctx, tx, req)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func (a *AppCore) runConversationReflectionTx(ctx context.Context, tx *sql.Tx, req ReflectionRequest) (*ReflectionResult, error) {
	classification := classifyConversation(req.Message, req.InputMode)
	result := &ReflectionResult{
		ConversationType: classification.ConversationType,
		Importance:       classification.Importance,
		ShouldCreateTask: classification.ShouldCreateTask,
	}
	if !classification.ShouldReflect {
		if req.RunID != "" {
			_, err := insertSQLiteRunStep(ctx, tx, req.RunID, "conversation_reflection", "Conversation reflection skipped", map[string]any{"conversation_id": req.ConversationID}, map[string]any{"conversation_type": classification.ConversationType, "skipped": true})
			return result, err
		}
		return result, nil
	}

	sourceEvents := []string{}
	for _, value := range []string{req.ConversationID, req.MessageID, req.RunID} {
		if strings.TrimSpace(value) != "" {
			sourceEvents = append(sourceEvents, value)
		}
	}
	if shouldCreateMemoryCandidate(req.Message, classification) {
		memory, err := upsertReflectionMemoryCandidateTx(ctx, tx, req, classification, sourceEvents)
		if err != nil {
			return nil, err
		}
		if memory != nil {
			result.MemoryCandidates = append(result.MemoryCandidates, *memory)
		}
	}

	if classification.ShouldCreateTask {
		plan := inferProductTaskPlan(req.Message)
		result.TaskCandidates = append(result.TaskCandidates, ReflectionTaskCandidate{
			Title:          plan.Title,
			Description:    plan.Description,
			Priority:       plan.Priority,
			Mode:           "serious_task",
			SuggestedSteps: plan.Steps,
		})
	}

	openLoop, err := maybeCreateOpenLoopTx(ctx, tx, req, classification)
	if err != nil {
		return nil, err
	}
	if openLoop != nil {
		result.OpenLoops = append(result.OpenLoops, *openLoop)
	}

	proactive, err := maybeCreateProactiveDraftTx(ctx, tx, req, classification, result.MemoryCandidates, openLoop)
	if err != nil {
		return nil, err
	}
	if proactive != nil {
		result.ProactiveOpportunities = append(result.ProactiveOpportunities, *proactive)
		if req.RunID != "" {
			if _, err := insertSQLiteRunStep(ctx, tx, req.RunID, "proactive_candidate_created", "Proactive candidate created", map[string]any{"conversation_id": req.ConversationID}, map[string]any{"proactive_message_id": proactive.ID, "score": proactive.Score, "status": proactive.Status}); err != nil {
				return nil, err
			}
		}
	}

	if req.ProductTaskID != "" {
		task, err := getProductTask(ctx, tx, req.ProductTaskID)
		if err == nil {
			result.ProductTask = &task
		} else if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}

	if req.RunID != "" {
		_, err := insertSQLiteRunStep(ctx, tx, req.RunID, "conversation_reflection", "Conversation reflection finished", map[string]any{
			"conversation_id": req.ConversationID,
			"product_task_id": req.ProductTaskID,
		}, map[string]any{
			"conversation_type":    result.ConversationType,
			"importance":           result.Importance,
			"memory_candidates":    len(result.MemoryCandidates),
			"task_candidates":      len(result.TaskCandidates),
			"open_loops":           len(result.OpenLoops),
			"proactive_candidates": len(result.ProactiveOpportunities),
		})
		if err != nil {
			return nil, err
		}
	}
	return result, nil
}

func upsertReflectionMemoryCandidateTx(ctx context.Context, tx *sql.Tx, req ReflectionRequest, classification conversationClassification, sourceEvents []string) (*store.MemoryRecord, error) {
	content, summary, memoryType := reflectionMemoryContent(req.Message, classification)
	if strings.TrimSpace(content) == "" {
		return nil, nil
	}
	var existingID, existingStatus, metadataRaw string
	err := tx.QueryRowContext(ctx, `
		SELECT id, status, metadata
		FROM memories
		WHERE type=? AND content=? AND status IN ('pending','confirmed') AND disabled_at IS NULL
		ORDER BY updated_at DESC
		LIMIT 1
	`, memoryType, content).Scan(&existingID, &existingStatus, &metadataRaw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err == nil {
		metadata := decodeObject([]byte(metadataRaw))
		if existingStatus == "pending" {
			metadata["duplicate_count"] = intFromAny(metadata["duplicate_count"]) + 1
			metadata["last_duplicate_run_id"] = req.RunID
			_, err := tx.ExecContext(ctx, `UPDATE memories SET metadata=?, updated_at=datetime('now') WHERE id=?`, mustJSON(metadata), existingID)
			if err != nil {
				return nil, err
			}
		}
		if existingStatus == "confirmed" && req.RunID != "" {
			usageID, err := store.NewID("mulog_")
			if err != nil {
				return nil, err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO memory_usage_logs (id, memory_id, run_id, agent_id, retrieval_score, injected, used_in_answer, outcome, metadata) VALUES (?, ?, ?, 'reflection', 1, 0, 0, 'duplicate_confirmed', ?)`, usageID, existingID, req.RunID, mustJSON(map[string]any{"source": "conversation_reflection"})); err != nil {
				return nil, err
			}
		}
		return nil, nil
	}
	memoryID, err := store.NewID("mem_")
	if err != nil {
		return nil, err
	}
	confidence := 0.72
	if classification.Importance == "high" {
		confidence = 0.88
	}
	metadata := map[string]any{
		"candidate_source":  "conversation_reflection",
		"candidate_reason":  reflectionReason(classification),
		"conversation_type": classification.ConversationType,
		"raw_candidate": map[string]any{
			"type":       memoryType,
			"content":    content,
			"summary":    summary,
			"confidence": confidence,
		},
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, metadata)
		VALUES (?, ?, ?, ?, 'project', 'internal', ?, 'pending', ?, ?, ?)
	`, memoryID, memoryType, content, summary, confidence, mustJSON(sourceEvents), mustJSON(reflectionEntities(req.Message, classification)), mustJSON(metadata))
	if err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id, type, content, COALESCE(summary,''), scope_type, COALESCE(scope_id,''), privacy_level, confidence, status, source_event_ids, entities, success_count, failure_count, usage_count, positive_feedback, negative_feedback, pinned, disabled_at, COALESCE(merged_into_memory_id,''), COALESCE(conflict_group_id,''), COALESCE(conflict_reason,''), metadata, created_at, updated_at, last_used_at, 0.5 AS score FROM memories WHERE id=?`, memoryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if rows.Next() {
		memory, _, err := scanSQLiteMemory(rows)
		if err != nil {
			return nil, err
		}
		return &memory, rows.Err()
	}
	return nil, rows.Err()
}

func maybeCreateOpenLoopTx(ctx context.Context, tx *sql.Tx, req ReflectionRequest, classification conversationClassification) (*OpenLoopRecord, error) {
	if !shouldCreateOpenLoop(req.Message, classification) {
		return nil, nil
	}
	topic := openLoopTopic(req.Message, classification)
	var existingID string
	err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM open_loops
		WHERE status IN ('open','snoozed') AND topic=? AND COALESCE(source_product_task_id, '')=?
		ORDER BY updated_at DESC
		LIMIT 1
	`, topic, req.ProductTaskID).Scan(&existingID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err == nil {
		_, _ = tx.ExecContext(ctx, `UPDATE open_loops SET updated_at=datetime('now') WHERE id=?`, existingID)
		return getOpenLoop(ctx, tx, existingID)
	}
	openLoopID, err := store.NewID("loop_")
	if err != nil {
		return nil, err
	}
	priority := "normal"
	if classification.Importance == "high" {
		priority = "high"
	}
	description := truncate(req.Message, 240)
	followup := suggestedFollowup(req.Message, classification)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO open_loops (id, topic, description, status, source_conversation_id, source_run_id, source_product_task_id, suggested_followup, priority, metadata, updated_at)
		VALUES (?, ?, ?, 'open', NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, datetime('now'))
	`, openLoopID, topic, description, req.ConversationID, req.RunID, req.ProductTaskID, followup, priority, mustJSON(map[string]any{"source": "conversation_reflection", "conversation_type": classification.ConversationType}))
	if err != nil {
		return nil, err
	}
	return getOpenLoop(ctx, tx, openLoopID)
}

func maybeCreateProactiveDraftTx(ctx context.Context, tx *sql.Tx, req ReflectionRequest, classification conversationClassification, memories []store.MemoryRecord, openLoop *OpenLoopRecord) (*ProactiveMessageRecord, error) {
	if openLoop == nil && req.ProductTaskID == "" {
		return nil, nil
	}
	if classification.Mode == "serious_task" && req.ProductTaskID == "" && !isProactiveInstruction(req.Message, req.InputMode) {
		return nil, nil
	}
	score := proactiveScore(classification, openLoop != nil, len(memories) > 0)
	if score < 0.55 {
		return nil, nil
	}
	if openLoop != nil {
		var duplicate int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM proactive_messages WHERE source_open_loop_id=? AND created_at >= datetime('now', '-24 hours') AND status IN ('draft','queued','sent')`, openLoop.ID).Scan(&duplicate); err != nil {
			return nil, err
		}
		if duplicate > 0 {
			return nil, nil
		}
	}
	messageID, err := store.NewID("pro_")
	if err != nil {
		return nil, err
	}
	memoryIDs := make([]string, 0, len(memories))
	for _, memory := range memories {
		memoryIDs = append(memoryIDs, memory.ID)
	}
	title, body, reason := proactiveCopy(req.Message, classification, openLoop)
	if isGenericProactiveBody(body) {
		return nil, nil
	}
	var duplicateSimilar int
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM proactive_messages
		WHERE status IN ('draft','queued','sent')
		  AND created_at >= datetime('now', '-24 hours')
		  AND (body=? OR title=?)
	`, body, title).Scan(&duplicateSimilar); err != nil {
		return nil, err
	}
	if duplicateSimilar > 0 {
		return nil, nil
	}
	messageType := "companion"
	if req.ProductTaskID != "" {
		messageType = "task"
	} else if len(memories) > 0 {
		messageType = "memory"
	}
	action := proactiveAction(messageType)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO proactive_messages (id, type, title, body, reason, source_memory_ids, source_open_loop_id,
			source_product_task_id, score, status, channel, metadata, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, 'draft', 'desktop', ?, datetime('now'))
	`, messageID, messageType, title, body, reason, mustJSON(memoryIDs), openLoopID(openLoop), req.ProductTaskID, score, mustJSON(map[string]any{"source": "conversation_reflection", "reason": reason, "action": action, "conversation_type": classification.ConversationType, "review_required": true}))
	if err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT id, type, title, body, reason, source_memory_ids, COALESCE(source_open_loop_id, ''),
		       COALESCE(source_product_task_id, ''), score, status, channel, send_after, expires_at,
		       COALESCE(feedback, ''), metadata, created_at, updated_at, sent_at
		FROM proactive_messages
		WHERE id=?
	`, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if rows.Next() {
		item, err := scanProactiveMessage(rows)
		if err != nil {
			return nil, err
		}
		return &item, rows.Err()
	}
	return nil, rows.Err()
}

func getOpenLoop(ctx context.Context, tx *sql.Tx, id string) (*OpenLoopRecord, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT id, topic, description, status, COALESCE(source_conversation_id, ''), COALESCE(source_run_id, ''),
		       COALESCE(source_product_task_id, ''), suggested_followup, priority, due_at, metadata, created_at,
		       updated_at, closed_at
		FROM open_loops
		WHERE id=?
	`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if rows.Next() {
		item, err := scanOpenLoop(rows)
		if err != nil {
			return nil, err
		}
		return &item, rows.Err()
	}
	return nil, sql.ErrNoRows
}

func classifyConversation(message string, requestedMode string) conversationClassification {
	inputMode := normalizeInputMode(requestedMode)
	mode := inputMode
	if mode == "" || mode == "auto" {
		mode = inferredInputMode(message)
	}
	interactionClass := mode
	conversationType := "ordinary_chat"
	importance := "low"
	shouldReflect := false
	shouldCreateTask := false
	requiresUserInput := false
	missingInput := ""
	note := ""
	if mode == "clarify" {
		interactionClass = "clarify"
		conversationType = "clarification_request"
		requiresUserInput = true
		missingInput = "url"
		note = "web_research_missing_url"
	} else if mode == "serious_task" {
		conversationType = "serious_task_request"
		importance = "high"
		shouldReflect = true
		shouldCreateTask = true
	} else if mode == "background_task" {
		conversationType = "reminder_instruction"
		importance = "medium"
		shouldReflect = true
	} else if isMemoryInstruction(message) {
		conversationType = "memory_instruction"
		importance = "high"
		shouldReflect = true
	} else if isProductDirection(message) {
		conversationType = "product_direction"
		importance = "high"
		shouldReflect = true
	} else if containsAnyText(message, []string{"累", "压力", "迷茫", "难受"}) {
		conversationType = "emotional_support"
		importance = "low"
		shouldReflect = false
	}
	if inputMode == "chat_assist" {
		shouldCreateTask = false
		if shouldReflect || isMemoryInstruction(message) || isProductDirection(message) {
			shouldReflect = true
		}
	}
	return conversationClassification{InputMode: inputMode, Mode: mode, InteractionClass: interactionClass, ConversationType: conversationType, Importance: importance, ShouldCreateTask: shouldCreateTask, ShouldReflect: shouldReflect, RequiresUserInput: requiresUserInput, MissingInput: missingInput, ClassificationNote: note}
}

func normalizeInputMode(mode string) string {
	switch strings.TrimSpace(mode) {
	case "auto", "chat_assist", "serious_task", "background_task", "clarify":
		return strings.TrimSpace(mode)
	case "聊聊":
		return "chat_assist"
	case "认真执行":
		return "serious_task"
	case "后台任务":
		return "background_task"
	default:
		return "auto"
	}
}

func inferredInputMode(message string) string {
	lower := strings.ToLower(message)
	if desktopSafetyBlockForMessage(message).Response != "" {
		return "chat_assist"
	}
	if isMemoryRecallRequest(message) {
		return "chat_assist"
	}
	if isMemoryInstruction(message) || isMemorySelfQuery(message) || isMemoryCorrectionInstruction(message) || isMemoryDeletionInstruction(message) {
		return "chat_assist"
	}
	if containsAnyText(message, []string{"之后提醒", "下次提醒", "提醒我", "后台", "持续关注", "下次继续"}) {
		return "background_task"
	}
	if webResearchRequestMissingURL(message) {
		return "clarify"
	}
	if isExplicitSeriousTaskRequest(message) || containsAnyText(lower, []string{"implementation plan", "development plan", "deliverable"}) {
		return "serious_task"
	}
	return "chat_assist"
}

func isExplicitSeriousTaskRequest(message string) bool {
	lower := strings.ToLower(message)
	if containsAnyText(message, []string{"帮我分析"}) && containsAnyText(message, []string{"差距", "下一步", "开发计划", "计划", "方案", "问题"}) {
		return true
	}
	if containsAnyText(message, []string{
		"认真执行",
		"严肃执行",
		"生成报告",
		"写一份报告",
		"整理一份报告",
		"输出报告",
		"生成方案",
		"制定方案",
		"落地方案",
		"生成开发计划",
		"开发计划",
		"下一步开发计划",
		"实施计划",
		"执行计划",
		"交付物",
		"开发 spec",
		"开发spec",
		"生成 spec",
		"实现",
		"改代码",
		"写代码",
		"修复",
		"部署",
		"完整测试",
		"测试复测",
		"复测",
	}) {
		return true
	}
	return containsAnyText(lower, []string{
		"serious task",
		"execute seriously",
		"generate a report",
		"write a report",
		"implementation plan",
		"development plan",
		"deliverable",
		"spec",
		"implement",
		"fix",
		"deploy",
	})
}

func shouldCreateMemoryCandidate(message string, classification conversationClassification) bool {
	if classification.ConversationType == "emotional_support" {
		return false
	}
	if isMemorySelfQuery(message) || isMemoryCorrectionInstruction(message) || isMemoryDeletionInstruction(message) {
		return false
	}
	return isMemoryInstruction(message) || isProductDirection(message) || classification.Mode == "serious_task"
}

func shouldCreateOpenLoop(message string, classification conversationClassification) bool {
	return classification.Mode == "background_task" || isProductDirection(message) || classification.Mode == "serious_task"
}

func isMemoryInstruction(message string) bool {
	if isMemorySelfQuery(message) || isMemoryCorrectionInstruction(message) || isMemoryDeletionInstruction(message) {
		return false
	}
	return containsAnyText(message, []string{"记住", "帮我记", "以后你要记得", "请记下"})
}

func isMemoryRecallRequest(message string) bool {
	return containsAnyText(message, []string{"按你记得", "按你记住", "按你记忆", "别重新问背景"})
}

func isProductDirection(message string) bool {
	lower := strings.ToLower(message)
	return containsAnyText(message, []string{"产品方向", "伙伴", "执行后台", "伙伴式", "严肃执行", "方向"}) || containsAnyText(lower, []string{"product direction", "companion", "execution layer"})
}

func reflectionMemoryContent(message string, classification conversationClassification) (string, string, string) {
	if isProductDirection(message) {
		return "用户希望 Joi 同时具备伙伴式聊天、可追踪任务执行和可审核交付物闭环。", "Joi 方向：伙伴前台 + 执行后台", "product_goal"
	}
	if classification.Mode == "serious_task" {
		return "用户正在推进可追踪、可交付、可审计的严肃任务闭环。", "严肃任务闭环偏好", "working_preference"
	}
	if isMemoryInstruction(message) {
		cleaned := strings.TrimSpace(strings.TrimPrefix(message, "请记住："))
		cleaned = strings.TrimSpace(strings.TrimPrefix(cleaned, "记住："))
		if cleaned == "" {
			cleaned = truncate(message, 160)
		}
		return cleaned, truncate(cleaned, 80), "user_preference"
	}
	return "", "", ""
}

func reflectionReason(classification conversationClassification) string {
	switch classification.ConversationType {
	case "product_direction":
		return "用户明确表达 Joi 的长期产品方向。"
	case "serious_task_request":
		return "严肃任务执行后沉淀可复用工作偏好。"
	case "memory_instruction":
		return "用户明确要求记住该信息。"
	default:
		return "对话包含可审核的长期上下文。"
	}
}

func reflectionEntities(message string, classification conversationClassification) []string {
	entities := []string{}
	if strings.Contains(message, "Joi") || classification.ConversationType == "product_direction" {
		entities = append(entities, "Joi")
	}
	if classification.Mode == "serious_task" {
		entities = append(entities, "Product Task")
	}
	if len(entities) == 0 {
		entities = append(entities, "Conversation")
	}
	return entities
}

func openLoopTopic(message string, classification conversationClassification) string {
	if classification.Mode == "background_task" {
		return "用户请求后续提醒"
	}
	if classification.Mode == "serious_task" {
		return "继续推进：" + truncate(strings.TrimSpace(message), 48)
	}
	if isProductDirection(message) {
		return "Joi 伙伴前台与执行后台闭环"
	}
	return truncate(strings.TrimSpace(message), 64)
}

func suggestedFollowup(message string, classification conversationClassification) string {
	if classification.Mode == "background_task" {
		return explicitReminderBody(message)
	}
	if classification.Mode == "serious_task" {
		return "继续推进：" + truncate(strings.TrimSpace(message), 72)
	}
	if isProductDirection(message) {
		return "下一步优先确认 Memory、Task、Artifact 和主动触达的共同闭环。"
	}
	return "后续对话中继续接上这个话题。"
}

func proactiveScore(classification conversationClassification, hasOpenLoop bool, hasMemory bool) float64 {
	score := 0.45
	if classification.Importance == "high" {
		score += 0.25
	}
	if hasOpenLoop {
		score += 0.15
	}
	if hasMemory {
		score += 0.1
	}
	if classification.ConversationType == "emotional_support" {
		score -= 0.25
	}
	if score > 0.95 {
		score = 0.95
	}
	return score
}

func proactiveCopy(message string, classification conversationClassification, openLoop *OpenLoopRecord) (string, string, string) {
	if classification.Mode == "serious_task" {
		title := "任务后续可继续推进"
		body := "这个任务已经形成可追踪记录和交付物，下一步可以从任务卡继续。"
		if openLoop != nil && strings.TrimSpace(openLoop.SuggestedFollowup) != "" {
			body = openLoop.SuggestedFollowup
		}
		if openLoop != nil && strings.TrimSpace(openLoop.Topic) != "" {
			title = truncate(openLoop.Topic, 80)
		}
		return title, body, "严肃任务存在自然后续，需要保留为审核候选。"
	}
	if classification.Mode == "background_task" {
		body := explicitReminderBody(message)
		return "用户请求的提醒", body, "用户明确要求在之后提醒这件事。"
	}
	if openLoop != nil {
		return "下一步提醒", openLoop.SuggestedFollowup, "对话形成了未完成话题，适合进入桌面审核队列。"
	}
	return "记忆确认提醒", "我提取了一条待确认记忆，可以在右侧确认或修正。", "新记忆候选需要用户审核。"
}

func explicitReminderBody(message string) string {
	message = strings.TrimSpace(message)
	for _, marker := range []string{"提醒我：", "提醒我:", "明天你要提醒我：", "明天你要提醒我:"} {
		if index := strings.Index(message, marker); index >= 0 {
			body := strings.TrimSpace(message[index+len(marker):])
			if body != "" {
				return truncate(body, 180)
			}
		}
	}
	return truncate(message, 180)
}

func isGenericProactiveBody(body string) bool {
	return strings.TrimSpace(body) == "" || containsAnyText(body, []string{"在用户确认后生成提醒或主动触达候选", "继续努力"})
}

func proactiveAction(messageType string) string {
	switch messageType {
	case "task":
		return "review_task_followup"
	case "memory":
		return "review_memory_candidate"
	default:
		return "review_send_or_dismiss"
	}
}

func openLoopID(openLoop *OpenLoopRecord) string {
	if openLoop == nil {
		return ""
	}
	return openLoop.ID
}

func containsAnyText(value string, needles []string) bool {
	for _, needle := range needles {
		if strings.Contains(value, needle) {
			return true
		}
	}
	return false
}
