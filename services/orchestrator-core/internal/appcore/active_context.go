package appcore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

type artifactRewriteInput struct {
	RunID          string
	ConversationID string
	UserMessageID  string
	AgentID        string
	Message        string
	UserID         string
	Channel        string
	EventSink      func(eventName string, payload map[string]any)
}

func isArtifactRewriteRequest(message string) bool {
	lower := strings.ToLower(message)
	hasArtifact := strings.Contains(message, "Artifact") || strings.Contains(message, "交付物") || strings.Contains(message, "刚才那份") || strings.Contains(message, "这份")
	hasRewrite := strings.Contains(message, "改成") || strings.Contains(message, "改写") || strings.Contains(message, "重写") || strings.Contains(lower, "backlog")
	return hasArtifact && hasRewrite
}

func (a *AppCore) handleSQLiteArtifactRewrite(ctx context.Context, tx *sql.Tx, input artifactRewriteInput) (*sqliteRuntimeResult, []ArtifactSummary, error) {
	result := &sqliteRuntimeResult{Steps: []store.RunStepBrief{}, EventSink: input.EventSink}
	for _, step := range []sqliteStepDefinition{
		{stepType: "input_received", title: "Input received", input: map[string]any{"message": input.Message, "channel": input.Channel}, output: map[string]any{"conversation_id": input.ConversationID, "message_id": input.UserMessageID}},
		{stepType: "router_selected", title: "Router selected agent", input: map[string]any{"message": input.Message}, output: map[string]any{"intent": "artifact_followup", "route_mode": "single", "lead_agent": input.AgentID, "route_source": "desktop_appcore"}},
	} {
		brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, step.stepType, step.title, step.input, step.output)
		if err != nil {
			return nil, nil, err
		}
		result.Steps = append(result.Steps, brief)
	}

	source, err := latestArtifactForContextTx(ctx, tx, input.ConversationID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			response := "我没有找到可改写的上一份 Artifact；请先打开或生成一份交付物。"
			if err := finalizeArtifactRewriteResponse(ctx, tx, input.RunID, input.AgentID, response, result); err != nil {
				return nil, nil, err
			}
			return result, nil, nil
		}
		return nil, nil, err
	}
	brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "active_context_resolved", "Active context resolved", map[string]any{"conversation_id": input.ConversationID}, map[string]any{"artifact_id": source.ID, "product_task_id": source.SourceProductTaskID})
	if err != nil {
		return nil, nil, err
	}
	result.Steps = append(result.Steps, brief)

	content := buildBacklogFromArtifact(source, input.Message)
	artifact, err := createArtifactTx(ctx, tx, CreateArtifactRequest{
		Type:                 "backlog",
		Title:                source.Title + " - Backlog",
		Content:              content,
		ContentFormat:        "markdown",
		SourceProductTaskID:  source.SourceProductTaskID,
		SourceRunID:          input.RunID,
		SourceConversationID: input.ConversationID,
		SourceMessageID:      input.UserMessageID,
		LinkedMemoryIDs:      source.LinkedMemoryIDs,
		Metadata: map[string]any{
			"source":             "artifact_rewrite",
			"source_artifact_id": source.ID,
			"rewrite_request":    input.Message,
		},
	})
	if err != nil {
		return nil, nil, err
	}
	brief, err = insertSQLiteRunStep(ctx, tx, input.RunID, "artifact_rewritten", "Artifact rewritten", map[string]any{"source_artifact_id": source.ID}, map[string]any{"artifact_id": artifact.ID, "title": artifact.Title, "type": artifact.Type})
	if err != nil {
		return nil, nil, err
	}
	result.Steps = append(result.Steps, brief)
	if err := updateConversationActiveContextTx(ctx, tx, input.ConversationID, source.SourceProductTaskID, artifact.ID); err != nil {
		return nil, nil, err
	}
	response := "已基于上一份 Artifact 生成 backlog 版本，不需要你重新提供内容。"
	if err := finalizeArtifactRewriteResponse(ctx, tx, input.RunID, input.AgentID, response, result); err != nil {
		return nil, nil, err
	}
	return result, []ArtifactSummary{*artifact}, nil
}

func latestArtifactForContextTx(ctx context.Context, tx *sql.Tx, conversationID string) (ArtifactDetail, error) {
	if strings.TrimSpace(conversationID) != "" {
		artifact, err := queryLatestArtifactTx(ctx, tx, `WHERE status='active' AND source_conversation_id=?`, conversationID)
		if err == nil || !errors.Is(err, sql.ErrNoRows) {
			return artifact, err
		}
	}
	return queryLatestArtifactTx(ctx, tx, `WHERE status='active'`)
}

func queryLatestArtifactTx(ctx context.Context, tx *sql.Tx, where string, args ...any) (ArtifactDetail, error) {
	var artifact ArtifactDetail
	var linkedRaw, metadataRaw, createdAt, updatedAt string
	query := `
		SELECT id, type, title, content, content_format, COALESCE(source_product_task_id, ''),
		       COALESCE(source_run_id, ''), COALESCE(source_conversation_id, ''), COALESCE(source_message_id, ''),
		       linked_memory_ids, version, status, metadata, created_at, updated_at
		FROM artifacts
		` + where + `
		ORDER BY updated_at DESC, created_at DESC
		LIMIT 1
	`
	err := tx.QueryRowContext(ctx, query, args...).Scan(&artifact.ID, &artifact.Type, &artifact.Title, &artifact.Content, &artifact.ContentFormat, &artifact.SourceProductTaskID, &artifact.SourceRunID, &artifact.SourceConversationID, &artifact.SourceMessageID, &linkedRaw, &artifact.Version, &artifact.Status, &metadataRaw, &createdAt, &updatedAt)
	if err != nil {
		return ArtifactDetail{}, err
	}
	artifact.LinkedMemoryIDs = decodeStringArray([]byte(linkedRaw))
	artifact.Metadata = decodeObject([]byte(metadataRaw))
	artifact.CreatedAt = parseSQLiteTime(createdAt)
	artifact.UpdatedAt = parseSQLiteTime(updatedAt)
	return artifact, nil
}

func getArtifactDetailTx(ctx context.Context, tx *sql.Tx, artifactID string) (ArtifactDetail, error) {
	var artifact ArtifactDetail
	var linkedRaw, metadataRaw, createdAt, updatedAt string
	err := tx.QueryRowContext(ctx, `
		SELECT id, type, title, content, content_format, COALESCE(source_product_task_id, ''),
		       COALESCE(source_run_id, ''), COALESCE(source_conversation_id, ''), COALESCE(source_message_id, ''),
		       linked_memory_ids, version, status, metadata, created_at, updated_at
		FROM artifacts
		WHERE id=?
	`, artifactID).Scan(&artifact.ID, &artifact.Type, &artifact.Title, &artifact.Content, &artifact.ContentFormat, &artifact.SourceProductTaskID, &artifact.SourceRunID, &artifact.SourceConversationID, &artifact.SourceMessageID, &linkedRaw, &artifact.Version, &artifact.Status, &metadataRaw, &createdAt, &updatedAt)
	if err != nil {
		return ArtifactDetail{}, err
	}
	artifact.LinkedMemoryIDs = decodeStringArray([]byte(linkedRaw))
	artifact.Metadata = decodeObject([]byte(metadataRaw))
	artifact.CreatedAt = parseSQLiteTime(createdAt)
	artifact.UpdatedAt = parseSQLiteTime(updatedAt)
	return artifact, nil
}

func buildBacklogFromArtifact(source ArtifactDetail, request string) string {
	body := artifactContentForRewrite(source.Content)
	if len([]rune(body)) > 2600 {
		runes := []rune(body)
		body = string(runes[:2600]) + "\n\n...[source artifact truncated]"
	}
	return "# " + source.Title + " - Backlog\n\n" +
		"## 来源\n\n" +
		"- Source artifact: " + source.ID + "\n" +
		"- Rewrite request: " + request + "\n\n" +
		"## P0\n\n" +
		"- 修复会阻断继续使用或影响信任的核心问题。\n" +
		"- 每项都需要绑定证据来源、验收标准和回归测试。\n\n" +
		"## P1\n\n" +
		"- 改善连续上下文、交付物复用和任务衔接。\n" +
		"- 完成后应能从上一份 artifact 继续工作，不要求用户重复粘贴。\n\n" +
		"## P2\n\n" +
		"- 降低提醒噪音，补齐反馈入口和体验 polish。\n\n" +
		"## 原始交付物摘要\n\n" +
		body + "\n"
}

func artifactContentForRewrite(content string) string {
	body := strings.TrimSpace(content)
	if body == "" {
		return ""
	}
	unsafeLedger := EvidenceLedger{}
	if !hasUnsupportedNumericClaimsWithoutEvidence(body, unsafeLedger) {
		return body
	}
	return removeMarkdownSection(body, "原始回复摘要") +
		"\n\n## 原始回复处理\n\n原始回复摘要包含未证实数字、比例或周期估算，改写时已排除；请以上方结论、行动项、执行记录和证据限制为准。"
}

func removeMarkdownSection(markdown string, heading string) string {
	headingLine := "## " + heading
	marker := "\n" + headingLine
	start := strings.Index(markdown, marker)
	if start < 0 && strings.HasPrefix(markdown, headingLine) {
		start = 0
	}
	if start < 0 {
		return strings.TrimSpace(markdown)
	}
	sectionStart := start
	searchFrom := sectionStart + len(marker)
	if sectionStart == 0 {
		searchFrom = len(headingLine)
	}
	next := strings.Index(markdown[searchFrom:], "\n## ")
	if next < 0 {
		return strings.TrimSpace(markdown[:sectionStart])
	}
	sectionEnd := searchFrom + next
	return strings.TrimSpace(markdown[:sectionStart] + markdown[sectionEnd:])
}

func updateConversationActiveContextTx(ctx context.Context, tx *sql.Tx, conversationID string, taskID string, artifactID string) error {
	if strings.TrimSpace(conversationID) == "" {
		return nil
	}
	_, err := tx.ExecContext(ctx, `
		UPDATE conversations
		SET metadata=json_set(
				COALESCE(metadata, '{}'),
				'$.last_task_id', COALESCE(NULLIF(?, ''), json_extract(COALESCE(metadata, '{}'), '$.last_task_id')),
				'$.last_artifact_id', COALESCE(NULLIF(?, ''), json_extract(COALESCE(metadata, '{}'), '$.last_artifact_id'))
			),
		    updated_at=datetime('now')
		WHERE id=?
	`, taskID, artifactID, conversationID)
	return err
}

func latestProductTaskIDForContextTx(ctx context.Context, tx *sql.Tx, conversationID string) (string, error) {
	if strings.TrimSpace(conversationID) != "" {
		var metadataRaw string
		if err := tx.QueryRowContext(ctx, `SELECT metadata FROM conversations WHERE id=?`, conversationID).Scan(&metadataRaw); err == nil {
			metadata := decodeObject([]byte(metadataRaw))
			if id := strings.TrimSpace(stringFromAny(metadata["last_task_id"])); id != "" {
				return id, nil
			}
		} else if !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		var id string
		err := tx.QueryRowContext(ctx, `
			SELECT id
			FROM product_tasks
			WHERE created_from_conversation_id=?
			ORDER BY updated_at DESC, created_at DESC
			LIMIT 1
		`, conversationID).Scan(&id)
		if err == nil {
			return id, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
	}
	var id string
	err := tx.QueryRowContext(ctx, `SELECT id FROM product_tasks ORDER BY updated_at DESC, created_at DESC LIMIT 1`).Scan(&id)
	return id, err
}

func activeContextPromptTx(ctx context.Context, tx *sql.Tx, conversationID string) (string, map[string]any, error) {
	if strings.TrimSpace(conversationID) == "" {
		return "", map[string]any{}, nil
	}
	var metadataRaw string
	if err := tx.QueryRowContext(ctx, `SELECT metadata FROM conversations WHERE id=?`, conversationID).Scan(&metadataRaw); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", map[string]any{}, nil
		}
		return "", nil, err
	}
	metadata := decodeObject([]byte(metadataRaw))
	taskID := strings.TrimSpace(stringFromAny(metadata["last_task_id"]))
	artifactID := strings.TrimSpace(stringFromAny(metadata["last_artifact_id"]))
	if taskID == "" {
		if id, err := latestProductTaskIDForContextTx(ctx, tx, conversationID); err == nil {
			taskID = id
		} else if !errors.Is(err, sql.ErrNoRows) {
			return "", nil, err
		}
	}
	var parts []string
	output := map[string]any{"last_task_id": taskID, "last_artifact_id": artifactID}
	if taskID != "" {
		if task, err := getProductTask(ctx, tx, taskID); err == nil {
			parts = append(parts, fmt.Sprintf("Active Task: %s\nid: %s\nstatus: %s\nsummary: %s", task.Title, task.ID, task.Status, truncate(task.Summary, 500)))
			output["task_title"] = task.Title
			output["task_status"] = task.Status
		} else if !errors.Is(err, sql.ErrNoRows) {
			return "", nil, err
		}
	}
	if artifactID != "" {
		if artifact, err := getArtifactDetailTx(ctx, tx, artifactID); err == nil {
			parts = append(parts, fmt.Sprintf("Active Artifact: %s\nid: %s\nsummary:\n%s", artifact.Title, artifact.ID, truncate(artifact.Content, 800)))
			output["artifact_title"] = artifact.Title
		} else if !errors.Is(err, sql.ErrNoRows) {
			return "", nil, err
		}
	}
	if len(parts) == 0 {
		return "", output, nil
	}
	return "ACTIVE_CONTEXT\n" + strings.Join(parts, "\n\n"), output, nil
}

func finalizeArtifactRewriteResponse(ctx context.Context, tx *sql.Tx, runID string, agentID string, response string, result *sqliteRuntimeResult) error {
	response = store.RedactSensitiveText(response)
	emitAssistantResponseDeltas(result, runID, response)
	brief, err := insertSQLiteRunStep(ctx, tx, runID, "agent_call_finished", "Artifact follow-up handled", map[string]any{"agent_id": agentID, "deterministic": true}, map[string]any{"response": response})
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
