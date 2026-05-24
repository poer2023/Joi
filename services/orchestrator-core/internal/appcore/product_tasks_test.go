package appcore

import (
	"context"
	"strings"
	"testing"
)

func TestCompanionDirectionReflectionCreatesReviewableCandidates(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	chat, err := core.SendChat(ctx, ChatRequest{
		Channel:   "test",
		UserID:    "tester",
		Message:   "我想把 Joi 做成伙伴式前台 + 严肃执行后台，记住这个方向。",
		InputMode: "auto",
	})
	if err != nil {
		t.Fatal(err)
	}
	if chat.ProductTask != nil {
		t.Fatalf("product task should not be created for direction chat: %+v", chat.ProductTask)
	}

	var memoryCount, openLoopCount, proactiveCount, productTaskCount int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM memories WHERE status='pending' AND json_extract(metadata, '$.candidate_source')='conversation_reflection'`).Scan(&memoryCount); err != nil {
		t.Fatal(err)
	}
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM open_loops WHERE status='open'`).Scan(&openLoopCount); err != nil {
		t.Fatal(err)
	}
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM proactive_messages WHERE status='draft'`).Scan(&proactiveCount); err != nil {
		t.Fatal(err)
	}
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM product_tasks`).Scan(&productTaskCount); err != nil {
		t.Fatal(err)
	}
	if memoryCount == 0 || openLoopCount == 0 || proactiveCount == 0 {
		t.Fatalf("reflection counts memory=%d open_loop=%d proactive=%d", memoryCount, openLoopCount, proactiveCount)
	}
	if productTaskCount != 0 {
		t.Fatalf("unexpected product tasks: %d", productTaskCount)
	}
	trace, err := core.GetRunTrace(ctx, chat.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !hasSQLiteStep(trace.Steps, "conversation_reflection") || !hasSQLiteStep(trace.Steps, "proactive_candidate_created") {
		t.Fatalf("reflection trace steps missing: %+v", trace.Steps)
	}
}

func TestMemoryConfirmRecallUsagePromptLoop(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	first, err := core.SendChat(ctx, ChatRequest{
		Channel:   "test",
		UserID:    "tester",
		Message:   "Joi 的方向是伙伴式前台 + 严肃执行后台，记住。",
		InputMode: "auto",
	})
	if err != nil {
		t.Fatal(err)
	}

	var memoryID string
	if err := core.DB().SQL().QueryRowContext(ctx, `
		SELECT id
		FROM memories
		WHERE status='pending'
		  AND content LIKE '%伙伴式前台%'
		  AND content LIKE '%严肃执行后台%'
		ORDER BY created_at DESC
		LIMIT 1
	`).Scan(&memoryID); err != nil {
		t.Fatalf("expected pending product direction memory: %v", err)
	}
	if err := core.UpdateMemory(ctx, MemoryActionRequest{ID: memoryID, Action: "confirm", Reason: "test_confirm"}); err != nil {
		t.Fatal(err)
	}

	second, err := core.SendChat(ctx, ChatRequest{
		ConversationID: first.ConversationID,
		Channel:        "test",
		UserID:         "tester",
		Message:        "你记得我现在想把 Joi 做成什么吗？",
		InputMode:      "auto",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(second.Response, "伙伴式前台") || !strings.Contains(second.Response, "严肃执行后台") || !strings.Contains(second.Response, "可追踪") {
		t.Fatalf("memory-backed response missing product direction: %q", second.Response)
	}
	if len(second.UsedMemories) == 0 {
		t.Fatalf("expected used memories in chat response")
	}

	var confirmedCount int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM memories WHERE status='confirmed' AND id=?`, memoryID).Scan(&confirmedCount); err != nil {
		t.Fatal(err)
	}
	if confirmedCount != 1 {
		t.Fatalf("confirmed memory count got %d", confirmedCount)
	}
	var usageCount int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM memory_usage_logs WHERE run_id=? AND memory_id=? AND injected=1`, second.RunID, memoryID).Scan(&usageCount); err != nil {
		t.Fatal(err)
	}
	if usageCount == 0 {
		t.Fatalf("expected memory_usage_logs for run %s memory %s", second.RunID, memoryID)
	}
	var promptCount int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM prompt_assemblies WHERE run_id=? AND dynamic_tail LIKE '%伙伴式前台%' AND dynamic_tail LIKE '%严肃执行后台%'`, second.RunID).Scan(&promptCount); err != nil {
		t.Fatal(err)
	}
	if promptCount == 0 {
		t.Fatalf("expected prompt assembly to include confirmed memory")
	}
	trace, err := core.GetRunTrace(ctx, second.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !hasSQLiteStep(trace.Steps, "memory_context_recalled") {
		t.Fatalf("expected memory_context_recalled step: %+v", trace.Steps)
	}
	if len(trace.MemoryContextPacks) == 0 || len(trace.MemoryContextPacks[0].DynamicRetrieval) == 0 {
		t.Fatalf("expected trace memory context dynamic retrieval: %+v", trace.MemoryContextPacks)
	}
}

func TestBlindB01MemoryPreferenceDoesNotCreateTaskArtifactOrProactive(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	chat, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "我做产品决策时不喜欢鸡汤，也不喜欢你先问三个问题。你要直接判断，给我优先级。这个偏好请记住。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if chat.ProductTask != nil || len(chat.Artifacts) != 0 || len(chat.ProactiveCandidates) != 0 {
		t.Fatalf("memory preference created side effects: task=%+v artifacts=%d proactive=%d", chat.ProductTask, len(chat.Artifacts), len(chat.ProactiveCandidates))
	}
	var productTasks, artifacts, proactive int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM product_tasks`).Scan(&productTasks); err != nil {
		t.Fatal(err)
	}
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM artifacts`).Scan(&artifacts); err != nil {
		t.Fatal(err)
	}
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM proactive_messages`).Scan(&proactive); err != nil {
		t.Fatal(err)
	}
	if productTasks != 0 || artifacts != 0 || proactive != 0 {
		t.Fatalf("unexpected db side effects product_tasks=%d artifacts=%d proactive=%d", productTasks, artifacts, proactive)
	}
	var content string
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT content FROM memories WHERE status='pending' ORDER BY created_at DESC LIMIT 1`).Scan(&content); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(content, "不喜欢鸡汤") || !strings.Contains(content, "先问三个问题") || !strings.Contains(content, "直接判断") {
		t.Fatalf("memory candidate lost preference nuance: %q", content)
	}
}

func TestBlindB02ConfirmedMemorySelfQueryUsesDeterministicState(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	if _, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "我做产品决策时不喜欢鸡汤，也不喜欢你先问三个问题。你要直接判断，给我优先级。这个偏好请记住。",
	}); err != nil {
		t.Fatal(err)
	}
	var memoryID string
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT id FROM memories WHERE status='pending' ORDER BY created_at DESC LIMIT 1`).Scan(&memoryID); err != nil {
		t.Fatal(err)
	}
	if err := core.UpdateMemory(ctx, MemoryActionRequest{ID: memoryID, Action: "confirm"}); err != nil {
		t.Fatal(err)
	}

	chat, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "你现在记住了我什么？",
	})
	if err != nil {
		t.Fatal(err)
	}
	if chat.ProductTask != nil {
		t.Fatalf("memory self-query created product task: %+v", chat.ProductTask)
	}
	if !strings.Contains(chat.Response, "长期记忆") || !strings.Contains(chat.Response, "不喜欢鸡汤") || !strings.Contains(chat.Response, "直接判断") {
		t.Fatalf("self-query response did not list confirmed memory: %q", chat.Response)
	}
	trace, err := core.GetRunTrace(ctx, chat.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !hasSQLiteStep(trace.Steps, "memory_state_summary") {
		t.Fatalf("missing deterministic memory_state_summary step: %+v", trace.Steps)
	}
	var usageCount int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM memory_usage_logs WHERE run_id=? AND memory_id=?`, chat.RunID, memoryID).Scan(&usageCount); err != nil {
		t.Fatal(err)
	}
	if usageCount == 0 {
		t.Fatalf("expected memory_usage_logs for self-query run")
	}
}

func TestBlindB03MemoryGuidedJudgmentUsesOnlyConfirmedMemory(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	if _, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "我做产品决策时不喜欢鸡汤，也不喜欢你先问三个问题。你要直接判断，给我优先级。这个偏好请记住。",
	}); err != nil {
		t.Fatal(err)
	}
	var memoryID string
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT id FROM memories WHERE status='pending' ORDER BY created_at DESC LIMIT 1`).Scan(&memoryID); err != nil {
		t.Fatal(err)
	}
	if err := core.UpdateMemory(ctx, MemoryActionRequest{ID: memoryID, Action: "confirm"}); err != nil {
		t.Fatal(err)
	}

	chat, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "我又开始纠结 Joi 下一步该做什么了。你别重新问背景，按你记得的我的偏好，直接给我判断。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(chat.Response, "已确认记忆") || !strings.Contains(chat.Response, "不喜欢鸡汤") || !strings.Contains(chat.Response, "直接判断") {
		t.Fatalf("memory-grounded judgment did not cite confirmed memory: %q", chat.Response)
	}
	if strings.Contains(chat.Response, "快速试错") || strings.Contains(chat.Response, "倾向快速") {
		t.Fatalf("memory-grounded judgment over-inferred unconfirmed preference: %q", chat.Response)
	}
	var usageCount int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM memory_usage_logs WHERE run_id=? AND memory_id=?`, chat.RunID, memoryID).Scan(&usageCount); err != nil {
		t.Fatal(err)
	}
	if usageCount == 0 {
		t.Fatalf("expected memory_usage_logs for B03 run")
	}
	trace, err := core.GetRunTrace(ctx, chat.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !hasSQLiteStep(trace.Steps, "memory_grounded_judgment") {
		t.Fatalf("missing memory_grounded_judgment step: %+v", trace.Steps)
	}
	if len(trace.MemoryContextPacks) == 0 || len(trace.MemoryContextPacks[0].DynamicRetrieval) == 0 {
		t.Fatalf("expected B03 trace memory context pack: %+v", trace.MemoryContextPacks)
	}
}

func TestBlindB04MemoryCorrectionSupersedesOriginalOnConfirm(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	if _, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "我做产品决策时不喜欢鸡汤，也不喜欢你先问三个问题。你要直接判断，给我优先级。这个偏好请记住。",
	}); err != nil {
		t.Fatal(err)
	}
	var originalID string
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT id FROM memories WHERE status='pending' ORDER BY created_at DESC LIMIT 1`).Scan(&originalID); err != nil {
		t.Fatal(err)
	}
	if err := core.UpdateMemory(ctx, MemoryActionRequest{ID: originalID, Action: "confirm"}); err != nil {
		t.Fatal(err)
	}
	correction, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "你刚才理解错了。我不是讨厌所有问题，我是讨厌没有上下文的模板式问题。这个要改掉。",
	})
	if err != nil {
		t.Fatal(err)
	}
	var correctionID, targetID string
	if err := core.DB().SQL().QueryRowContext(ctx, `
		SELECT id, COALESCE(json_extract(metadata, '$.target_memory_id'), '')
		FROM memories
		WHERE status='pending' AND json_extract(metadata, '$.correction')=1
		ORDER BY created_at DESC
		LIMIT 1
	`).Scan(&correctionID, &targetID); err != nil {
		t.Fatal(err)
	}
	if targetID != originalID {
		t.Fatalf("correction target got %q want %q", targetID, originalID)
	}
	if err := core.UpdateMemory(ctx, MemoryActionRequest{ID: correctionID, Action: "confirm", RunID: correction.RunID}); err != nil {
		t.Fatal(err)
	}
	var originalStatus, mergedInto, correctedStatus string
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT status, COALESCE(merged_into_memory_id, '') FROM memories WHERE id=?`, originalID).Scan(&originalStatus, &mergedInto); err != nil {
		t.Fatal(err)
	}
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT status FROM memories WHERE id=?`, correctionID).Scan(&correctedStatus); err != nil {
		t.Fatal(err)
	}
	if originalStatus != "merged" || mergedInto != correctionID || correctedStatus != "confirmed" {
		t.Fatalf("correction confirm did not supersede original: original=%s merged_into=%s correction=%s", originalStatus, mergedInto, correctedStatus)
	}
	var actionLogs int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM memory_feedback WHERE memory_id=? AND feedback='confirm' AND run_id=?`, correctionID, correction.RunID).Scan(&actionLogs); err != nil {
		t.Fatal(err)
	}
	if actionLogs == 0 {
		t.Fatalf("expected memory action trace for correction confirm")
	}
}

func TestMemoryEditAndDeleteWriteActionLogs(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	memory, err := core.ProposeMemory(ctx, MemoryProposalRequest{
		Type:    "user_preference",
		Content: "用户偏好直接判断。",
		Summary: "直接判断偏好",
	})
	if err != nil {
		t.Fatal(err)
	}
	runID := insertMinimalRun(t, ctx, core.DB().SQL())
	if err := core.UpdateMemory(ctx, MemoryActionRequest{ID: memory.ID, Action: "edit", Content: "用户偏好直接判断并给优先级。", RunID: runID}); err != nil {
		t.Fatal(err)
	}
	if err := core.UpdateMemory(ctx, MemoryActionRequest{ID: memory.ID, Action: "delete", Reason: "test_delete", RunID: runID}); err != nil {
		t.Fatal(err)
	}
	var editLogs, deleteLogs int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM memory_feedback WHERE memory_id=? AND feedback='edit' AND run_id=?`, memory.ID, runID).Scan(&editLogs); err != nil {
		t.Fatal(err)
	}
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM memory_feedback WHERE memory_id=? AND feedback='delete' AND run_id=?`, memory.ID, runID).Scan(&deleteLogs); err != nil {
		t.Fatal(err)
	}
	if editLogs == 0 || deleteLogs == 0 {
		t.Fatalf("expected edit/delete action logs, got edit=%d delete=%d", editLogs, deleteLogs)
	}
}

func TestSeriousTaskCreatesProductTaskStepsArtifactAndTraceMetadata(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	chat, err := core.SendChat(ctx, ChatRequest{
		Channel:   "test",
		UserID:    "tester",
		Message:   "帮我分析 Alma 和 Joi 的差距，并给出下一步。",
		InputMode: "auto",
	})
	if err != nil {
		t.Fatal(err)
	}
	if chat.ProductTask == nil {
		t.Fatalf("expected product task")
	}
	if chat.ProductTask.LatestRunID != chat.RunID {
		t.Fatalf("latest_run_id got %q want %q", chat.ProductTask.LatestRunID, chat.RunID)
	}
	detail, err := core.GetProductTask(ctx, chat.ProductTask.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Steps) < 3 {
		t.Fatalf("steps got %d want at least 3", len(detail.Steps))
	}
	if len(detail.Deliverables) == 0 {
		t.Fatalf("expected task deliverable")
	}
	trace, err := core.GetRunTrace(ctx, chat.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := trace.Metadata["product_task_id"].(string); got != chat.ProductTask.ID {
		t.Fatalf("run metadata product_task_id got %q want %q metadata=%+v", got, chat.ProductTask.ID, trace.Metadata)
	}
	for _, stepType := range []string{"task_classified", "product_task_created", "artifact_created", "conversation_reflection"} {
		if !hasSQLiteStep(trace.Steps, stepType) {
			t.Fatalf("missing trace step %s: %+v", stepType, trace.Steps)
		}
	}
}

func TestBlindC01SeriousTaskWithoutEvidenceCompletesWithLimitations(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	chat, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "认真执行：帮我分析当前 Joi 最应该优先改的 3 个产品问题，并生成一份能给开发者看的计划。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if chat.ProductTask == nil {
		t.Fatalf("expected product task")
	}
	for _, fragment := range unsupportedMetricFragmentsForTest() {
		if strings.Contains(chat.Response, fragment) {
			t.Fatalf("chat response kept unsupported metric/timeline %q: %q", fragment, chat.Response)
		}
	}
	detail, err := core.GetProductTask(ctx, chat.ProductTask.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Task.Status != "completed_with_limitations" {
		t.Fatalf("task status got %q want completed_with_limitations", detail.Task.Status)
	}
	if len(detail.Deliverables) == 0 {
		t.Fatalf("expected deliverable")
	}
	artifact, err := core.GetArtifact(ctx, detail.Deliverables[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(artifact.Content, "证据与限制") || !strings.Contains(artifact.Content, "没有可引用") {
		t.Fatalf("artifact missing evidence limitations: %s", artifact.Content)
	}
	if !strings.Contains(artifact.Content, "## 结论") || !strings.Contains(artifact.Content, "## 行动项") || !strings.Contains(artifact.Content, "Memory Truth") {
		t.Fatalf("artifact is not standalone/actionable: %s", artifact.Content)
	}
	if strings.Contains(artifact.Content, "这是通过 Agent Runtime JSON 输出解析后的回答") {
		t.Fatalf("artifact leaked generic runtime response: %s", artifact.Content)
	}
	for _, fragment := range unsupportedMetricFragmentsForTest() {
		if strings.Contains(artifact.Content, fragment) {
			t.Fatalf("artifact kept unsupported metric/timeline %q: %s", fragment, artifact.Content)
		}
	}
	for _, step := range detail.Steps {
		if strings.TrimSpace(step.Summary) == "" {
			t.Fatalf("step summary should be populated: %+v", step)
		}
	}
	trace, err := core.GetRunTrace(ctx, chat.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !hasSQLiteStep(trace.Steps, "evidence_ledger_created") {
		t.Fatalf("missing evidence ledger trace step: %+v", trace.Steps)
	}
}

func TestBlindC01SeriousTaskWithMemoryDoesNotReturnMemoryCandidateCopy(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	if _, err := core.ProposeMemory(ctx, MemoryProposalRequest{
		Type:    "user_preference",
		Content: "用户做产品决策时不喜欢鸡汤，需要直接判断和优先级。",
		Summary: "产品决策偏好",
	}); err != nil {
		t.Fatal(err)
	}
	chat, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "认真执行：帮我分析当前 Joi 最应该优先改的 3 个产品问题，并生成一份能给开发者看的计划。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if chat.ProductTask == nil {
		t.Fatalf("expected product task")
	}
	if strings.Contains(chat.Response, "记忆候选") || strings.Contains(chat.Response, "长期记忆") {
		t.Fatalf("serious task response reused memory candidate copy: %q", chat.Response)
	}
	if !strings.Contains(chat.Response, "Memory Truth") || !strings.Contains(chat.Response, "Artifact") {
		t.Fatalf("serious task response missing task judgment: %q", chat.Response)
	}
}

func TestEvidenceSafeTaskResponseSanitizesUnsupportedNumbers(t *testing.T) {
	plan := productTaskPlan{
		Title:       "Joi 产品问题分析",
		Description: "分析当前 Joi 最应该优先改的产品问题。",
	}
	unsafeResponse := "建议 2 周内把 Memory 通过率提升到 90%，1 个月内完成 Artifact 重写。"
	ledger := buildEvidenceLedger(nil, unsafeResponse)
	safe := evidenceSafeTaskResponse(plan, unsafeResponse, ledger)
	if strings.Contains(safe, "2 周") || strings.Contains(safe, "90%") || strings.Contains(safe, "1 个月") {
		t.Fatalf("safe response kept unsupported claims: %q", safe)
	}
	if !strings.Contains(safe, "不写未验证周期") || !strings.Contains(safe, "证据限制") {
		t.Fatalf("safe response missing evidence boundary: %q", safe)
	}
	content := buildTaskArtifactContent(plan, unsafeResponse, nil, ledger)
	if strings.Contains(content, "2 周") || strings.Contains(content, "90%") || strings.Contains(content, "1 个月") {
		t.Fatalf("artifact content kept unsupported claims: %s", content)
	}
	if !strings.Contains(content, "证据与限制") && len(ledger.Limitations) == 0 {
		t.Fatalf("expected evidence limitations in ledger/content: ledger=%+v content=%s", ledger, content)
	}
}

func TestBlindC02TaskStepExplanationUsesStepEvidence(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	first, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "认真执行：帮我分析当前 Joi 最应该优先改的 3 个产品问题，并生成一份能给开发者看的计划。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.ProductTask == nil {
		t.Fatalf("expected product task")
	}
	followup, err := core.SendChat(ctx, ChatRequest{
		ConversationID: first.ConversationID,
		ProductTaskID:  first.ProductTask.ID,
		Channel:        "test",
		UserID:         "tester",
		Message:        "你每一步到底做了什么？读了哪些证据？有没有遗漏？",
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(followup.Response, "已生成记忆候选") {
		t.Fatalf("task explanation misrouted to memory candidate: %q", followup.Response)
	}
	if !strings.Contains(followup.Response, "步骤记录") || !strings.Contains(followup.Response, "证据") || !strings.Contains(followup.Response, "没有可引用") {
		t.Fatalf("task explanation missing step evidence and limitations: %q", followup.Response)
	}
	detail, err := core.GetProductTask(ctx, first.ProductTask.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, step := range detail.Steps {
		if strings.TrimSpace(step.Summary) == "" || len(step.Output) == 0 {
			t.Fatalf("expected persisted step narrative: %+v", step)
		}
	}
	trace, err := core.GetRunTrace(ctx, followup.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !hasSQLiteStep(trace.Steps, "task_steps_explained") {
		t.Fatalf("missing task_steps_explained trace step: %+v", trace.Steps)
	}
}

func TestBlindD02ArtifactRewriteUsesActiveContext(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	first, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "帮我分析 Alma 和 Joi 的差距，并给出下一步。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Artifacts) == 0 {
		t.Fatalf("expected initial artifact")
	}
	second, err := core.SendChat(ctx, ChatRequest{
		ConversationID: first.ConversationID,
		Channel:        "test",
		UserID:         "tester",
		Message:        "把这个 Artifact 改成一份给开发者看的 backlog，按 P0/P1/P2 排序。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(second.Response, "粘贴") || strings.Contains(second.Response, "没有找到") {
		t.Fatalf("artifact rewrite failed active context: %q", second.Response)
	}
	if len(second.Artifacts) != 1 || second.Artifacts[0].Type != "backlog" {
		t.Fatalf("expected backlog artifact, got %+v", second.Artifacts)
	}
	artifact, err := core.GetArtifact(ctx, second.Artifacts[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(artifact.Content, "## P0") || !strings.Contains(artifact.Content, first.Artifacts[0].ID) {
		t.Fatalf("backlog artifact missing priorities or source: %s", artifact.Content)
	}
	trace, err := core.GetRunTrace(ctx, second.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !hasSQLiteStep(trace.Steps, "active_context_resolved") || !hasSQLiteStep(trace.Steps, "artifact_rewritten") {
		t.Fatalf("missing active context rewrite steps: %+v", trace.Steps)
	}
}

func TestArtifactRewriteDropsUnsafeOriginalSummary(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	seed, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "先开一个测试会话。",
	})
	if err != nil {
		t.Fatal(err)
	}
	source, err := core.CreateArtifact(ctx, CreateArtifactRequest{
		Type:                 "report",
		Title:                "Unsafe source report",
		ContentFormat:        "markdown",
		SourceConversationID: seed.ConversationID,
		Content: "# Unsafe source report\n\n" +
			"## 结论\n\n- 先修 Memory Truth。\n\n" +
			"## 原始回复摘要\n\n建议 2 周内把 Memory 通过率提升到 90%，1 个月内完成 Artifact 重写。\n\n" +
			"## 行动项\n\n- 建立证据引用。\n",
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := core.SendChat(ctx, ChatRequest{
		ConversationID: seed.ConversationID,
		Channel:        "test",
		UserID:         "tester",
		Message:        "把这个 Artifact 改成一份给开发者看的 backlog，按 P0/P1/P2 排序。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Artifacts) != 1 {
		t.Fatalf("expected rewritten artifact, got %+v", second.Artifacts)
	}
	artifact, err := core.GetArtifact(ctx, second.Artifacts[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(artifact.Content, source.ID) || !strings.Contains(artifact.Content, "原始回复处理") {
		t.Fatalf("rewritten artifact missing source/sanitization note: %s", artifact.Content)
	}
	if strings.Contains(artifact.Content, "2 周") || strings.Contains(artifact.Content, "90%") || strings.Contains(artifact.Content, "1 个月") {
		t.Fatalf("rewritten artifact kept unsafe original summary: %s", artifact.Content)
	}
}

func TestH02ModePrioritySwitchesChatTaskAndProactive(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	first, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "我有点烦，不知道该不该继续。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.ProductTask != nil || len(first.Artifacts) != 0 {
		t.Fatalf("emotional chat created task/artifact: task=%+v artifacts=%d", first.ProductTask, len(first.Artifacts))
	}
	second, err := core.SendChat(ctx, ChatRequest{
		ConversationID: first.ConversationID,
		Channel:        "test",
		UserID:         "tester",
		Message:        "算了，认真执行，帮我做一个判断报告。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.ProductTask == nil {
		t.Fatalf("serious task turn did not create product task")
	}
	third, err := core.SendChat(ctx, ChatRequest{
		ConversationID: first.ConversationID,
		Channel:        "test",
		UserID:         "tester",
		Message:        "报告做完后，明天提醒我只改一个点。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if third.ProductTask != nil || len(third.Artifacts) != 0 {
		t.Fatalf("proactive-only turn created task/artifact: task=%+v artifacts=%d", third.ProductTask, len(third.Artifacts))
	}
	if strings.Contains(third.Response, "记忆候选") || !strings.Contains(third.Response, "提醒候选") {
		t.Fatalf("proactive response copy mislabels reminder as memory: %q", third.Response)
	}
	list, err := core.ListProactiveMessages(ctx, ProactiveMessageFilter{Status: "draft", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	foundSpecificReminder := false
	for _, item := range list.Messages {
		if strings.Contains(item.Body, "只改一个点") && strings.TrimSpace(item.Reason) != "" && stringValue(item.Metadata["action"]) != "" {
			foundSpecificReminder = true
		}
	}
	if !foundSpecificReminder {
		t.Fatalf("expected specific proactive draft with reason/action, got %+v", list.Messages)
	}
	trace, err := core.GetRunTrace(ctx, third.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := trace.RouteResult["intent"].(string); got != "proactive" {
		t.Fatalf("third turn intent got %q want proactive route=%+v", got, trace.RouteResult)
	}
}

func TestBlindH03ContinuationReflectionAnswersDirectly(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	_, err := core.ProposeMemory(ctx, MemoryProposalRequest{
		Type:    "user_preference",
		Content: "用户偏好直接判断和明确优先级。",
		Summary: "直接判断偏好",
	})
	if err != nil {
		t.Fatal(err)
	}
	task, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "认真执行：帮我分析当前 Joi 最应该优先改的 3 个产品问题，并生成一份能给开发者看的计划。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if task.ProductTask == nil || len(task.Artifacts) == 0 {
		t.Fatalf("expected task and artifact")
	}
	reply, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "如果这是你自己的工具，你明天还会打开它吗？为什么？请直接说。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(reply.Response, "会") || !strings.Contains(reply.Response, "dogfood") || strings.Contains(reply.Response, "Prompt Assembly") {
		t.Fatalf("expected direct continuation reflection, got %q", reply.Response)
	}
}

func TestActiveContextIsInjectedIntoPromptForTaskFollowup(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	first, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "帮我分析 Alma 和 Joi 的差距，并给出下一步。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.ProductTask == nil || len(first.Artifacts) == 0 {
		t.Fatalf("expected initial task and artifact")
	}
	followup, err := core.SendChat(ctx, ChatRequest{
		ConversationID: first.ConversationID,
		Channel:        "test",
		UserID:         "tester",
		Message:        "接着刚才那个产品问题分析任务，继续把它拆成一周开发计划。",
	})
	if err != nil {
		t.Fatal(err)
	}
	var promptCount int
	if err := core.DB().SQL().QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM prompt_assemblies
		WHERE run_id=? AND dynamic_tail LIKE '%ACTIVE_CONTEXT%' AND dynamic_tail LIKE ?
	`, followup.RunID, "%"+first.ProductTask.ID+"%").Scan(&promptCount); err != nil {
		t.Fatal(err)
	}
	if promptCount == 0 {
		t.Fatalf("expected active context injected into follow-up prompt")
	}
}

func TestEvidenceLedgerConvertsFileAnalyzeOutputToEvidenceRefs(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	chat, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "认真执行：读一下 AGENTS.md，总结 capability 实现不能违反哪些红线，生成报告。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if chat.ProductTask == nil {
		t.Fatalf("expected product task")
	}
	detail, err := core.GetProductTask(ctx, chat.ProductTask.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Deliverables) == 0 {
		t.Fatalf("expected deliverable")
	}
	artifact, err := core.GetArtifact(ctx, detail.Deliverables[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	ledgerRaw, ok := artifact.Metadata["evidence_ledger"].(map[string]any)
	if !ok {
		t.Fatalf("missing evidence ledger metadata: %+v", artifact.Metadata)
	}
	refs := mapSliceForTest(t, ledgerRaw["refs"])
	if len(refs) == 0 {
		t.Fatalf("expected evidence refs from file_analyze: %+v", artifact.Metadata)
	}
	if !strings.Contains(artifact.Content, "file_analyze") || !strings.Contains(artifact.Content, "AGENTS.md") {
		t.Fatalf("artifact evidence section missing file evidence: %s", artifact.Content)
	}
}

func TestProactiveMessageDecisionUpdatesReviewState(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	_, err := core.SendChat(ctx, ChatRequest{
		Channel: "test",
		UserID:  "tester",
		Message: "我想把 Joi 做成伙伴式前台 + 严肃执行后台，记住这个方向。",
	})
	if err != nil {
		t.Fatal(err)
	}
	list, err := core.ListProactiveMessages(ctx, ProactiveMessageFilter{Status: "draft", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Messages) == 0 {
		t.Fatalf("expected proactive draft")
	}
	if err := core.DecideProactiveMessage(ctx, list.Messages[0].ID, "dismiss", "not_now"); err != nil {
		t.Fatal(err)
	}
	var status, feedback string
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT status, COALESCE(feedback, '') FROM proactive_messages WHERE id=?`, list.Messages[0].ID).Scan(&status, &feedback); err != nil {
		t.Fatal(err)
	}
	if status != "dismissed" || feedback != "not_now" {
		t.Fatalf("decision got status=%s feedback=%s", status, feedback)
	}
	var feedbackRows int
	if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM proactive_feedback WHERE proactive_message_id=? AND action='dismiss' AND feedback='not_now'`, list.Messages[0].ID).Scan(&feedbackRows); err != nil {
		t.Fatal(err)
	}
	if feedbackRows == 0 {
		t.Fatalf("expected proactive feedback table row")
	}
}

func unsupportedMetricFragmentsForTest() []string {
	return []string{"2 周", "1 个月", "90%", "80%", "通过率提升", "失败率下降"}
}
