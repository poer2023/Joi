package appcore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

const (
	conversationLifecycleActive   = "active"
	conversationLifecycleArchived = "archived"
	conversationLifecycleTrashed  = "trashed"
	conversationLifecyclePurged   = "purged"
)

func (a *AppCore) ListConversationGroups(ctx context.Context) (*ConversationGroupListResponse, error) {
	if err := a.requireSQLiteConversationLifecycle(ctx); err != nil {
		return nil, err
	}
	rows, err := a.db.SQL().QueryContext(ctx, `
		SELECT id, name, sort_order, collapsed, metadata, created_at, updated_at
		FROM conversation_groups
		ORDER BY sort_order ASC, updated_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := []ConversationGroup{}
	for rows.Next() {
		group, err := scanConversationGroup(rows)
		if err != nil {
			return nil, err
		}
		groups = append(groups, group)
	}
	return &ConversationGroupListResponse{Groups: groups}, rows.Err()
}

func (a *AppCore) SaveConversationGroup(ctx context.Context, req ConversationGroupRequest) (*ConversationGroup, error) {
	if err := a.requireSQLiteConversationLifecycle(ctx); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, errors.New("conversation group name is required")
	}
	groupID := strings.TrimSpace(req.ID)
	var err error
	if groupID == "" {
		groupID, err = store.NewID("cgrp_")
		if err != nil {
			return nil, err
		}
	}
	collapsed := 0
	if req.Collapsed {
		collapsed = 1
	}
	metadata := req.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	_, err = a.db.SQL().ExecContext(ctx, `
		INSERT INTO conversation_groups (id, name, sort_order, collapsed, metadata, updated_at)
		VALUES (?, ?, ?, ?, ?, datetime('now'))
		ON CONFLICT(id) DO UPDATE SET
		  name=excluded.name,
		  sort_order=excluded.sort_order,
		  collapsed=excluded.collapsed,
		  metadata=excluded.metadata,
		  updated_at=datetime('now')
	`, groupID, name, req.SortOrder, collapsed, mustJSON(metadata))
	if err != nil {
		return nil, err
	}
	return getConversationGroup(ctx, a.db.SQL(), groupID)
}

func (a *AppCore) DeleteConversationGroup(ctx context.Context, groupID string) error {
	if err := a.requireSQLiteConversationLifecycle(ctx); err != nil {
		return err
	}
	groupID = strings.TrimSpace(groupID)
	if groupID == "" {
		return errors.New("conversation group id is required")
	}
	tx, err := a.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE conversations SET group_id=NULL, updated_at=datetime('now') WHERE group_id=?`, groupID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM conversation_groups WHERE id=?`, groupID)
	if err := requireRowsAffected(result, err, "conversation group not found"); err != nil {
		return err
	}
	return tx.Commit()
}

func (a *AppCore) MoveConversationToGroup(ctx context.Context, req ConversationActionRequest) (*ConversationActionResponse, error) {
	if err := a.requireSQLiteConversationLifecycle(ctx); err != nil {
		return nil, err
	}
	conversationID := strings.TrimSpace(req.ID)
	if conversationID == "" {
		return nil, errors.New("conversation id is required")
	}
	groupID := strings.TrimSpace(req.GroupID)
	tx, err := a.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if groupID != "" {
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM conversation_groups WHERE id=?)`, groupID).Scan(&exists); err != nil {
			return nil, err
		}
		if !exists {
			return nil, errors.New("conversation group not found")
		}
	}
	previousStatus, err := conversationLifecycleStatusTx(ctx, tx, conversationID)
	if err != nil {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `UPDATE conversations SET group_id=NULLIF(?, ''), updated_at=datetime('now') WHERE id=?`, groupID, conversationID)
	if err := requireRowsAffected(result, err, "conversation not found"); err != nil {
		return nil, err
	}
	if err := insertConversationLifecycleEventTx(ctx, tx, conversationID, "move_group", "desktop_ui", req.Reason, previousStatus, previousStatus, map[string]any{"group_id": groupID}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	conversation, err := a.getConversationSummary(ctx, conversationID)
	if err != nil {
		return nil, err
	}
	return &ConversationActionResponse{Conversation: conversation}, nil
}

func (a *AppCore) ArchiveConversation(ctx context.Context, req ConversationActionRequest) (*ConversationActionResponse, error) {
	return a.setConversationLifecycle(ctx, req, "archive", conversationLifecycleArchived)
}

func (a *AppCore) TrashConversation(ctx context.Context, req ConversationActionRequest) (*ConversationActionResponse, error) {
	if err := a.requireSQLiteConversationLifecycle(ctx); err != nil {
		return nil, err
	}
	conversationID := strings.TrimSpace(req.ID)
	if conversationID == "" {
		return nil, errors.New("conversation id is required")
	}
	tx, err := a.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	previousStatus, err := conversationLifecycleStatusTx(ctx, tx, conversationID)
	if err != nil {
		return nil, err
	}
	if previousStatus == conversationLifecyclePurged {
		return nil, errors.New("purged conversation cannot be moved to trash")
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE conversations
		SET lifecycle_status='trashed',
		    trashed_at=datetime('now'),
		    purge_after=datetime('now', '+30 days'),
		    restored_at=NULL,
		    updated_at=datetime('now')
		WHERE id=?
	`, conversationID)
	if err := requireRowsAffected(result, err, "conversation not found"); err != nil {
		return nil, err
	}
	hiddenMemories, keptMemories, err := applyConversationTrashMemoryPolicyTx(ctx, tx, conversationID)
	if err != nil {
		return nil, err
	}
	if err := insertConversationLifecycleEventTx(ctx, tx, conversationID, "trash", "desktop_ui", req.Reason, previousStatus, conversationLifecycleTrashed, map[string]any{"hidden_memory_count": hiddenMemories, "kept_memory_count": keptMemories}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	if err := a.db.RebuildSQLiteMemoryFTS(ctx); err != nil {
		return nil, err
	}
	conversation, err := a.getConversationSummary(ctx, conversationID)
	if err != nil {
		return nil, err
	}
	return &ConversationActionResponse{Conversation: conversation}, nil
}

func (a *AppCore) RestoreConversation(ctx context.Context, req ConversationActionRequest) (*ConversationActionResponse, error) {
	if err := a.requireSQLiteConversationLifecycle(ctx); err != nil {
		return nil, err
	}
	conversationID := strings.TrimSpace(req.ID)
	if conversationID == "" {
		return nil, errors.New("conversation id is required")
	}
	tx, err := a.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	previousStatus, err := conversationLifecycleStatusTx(ctx, tx, conversationID)
	if err != nil {
		return nil, err
	}
	if previousStatus == conversationLifecyclePurged {
		return nil, errors.New("purged conversation cannot be restored")
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE conversations
		SET lifecycle_status='active',
		    archived_at=NULL,
		    trashed_at=NULL,
		    purge_after=NULL,
		    restored_at=datetime('now'),
		    updated_at=datetime('now')
		WHERE id=?
	`, conversationID)
	if err := requireRowsAffected(result, err, "conversation not found"); err != nil {
		return nil, err
	}
	restoredMemories, err := restoreConversationTrashMemoriesTx(ctx, tx, conversationID)
	if err != nil {
		return nil, err
	}
	if err := insertConversationLifecycleEventTx(ctx, tx, conversationID, "restore", "desktop_ui", req.Reason, previousStatus, conversationLifecycleActive, map[string]any{"restored_memory_count": restoredMemories}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	if err := a.db.RebuildSQLiteMemoryFTS(ctx); err != nil {
		return nil, err
	}
	conversation, err := a.getConversationSummary(ctx, conversationID)
	if err != nil {
		return nil, err
	}
	return &ConversationActionResponse{Conversation: conversation}, nil
}

func (a *AppCore) PurgeConversation(ctx context.Context, req ConversationActionRequest) (*ConversationActionResponse, error) {
	if err := a.requireSQLiteConversationLifecycle(ctx); err != nil {
		return nil, err
	}
	conversationID := strings.TrimSpace(req.ID)
	if conversationID == "" {
		return nil, errors.New("conversation id is required")
	}
	tx, err := a.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	previousStatus, err := conversationLifecycleStatusTx(ctx, tx, conversationID)
	if err != nil {
		return nil, err
	}
	if previousStatus != conversationLifecycleTrashed {
		return nil, errors.New("conversation must be trashed before purge")
	}
	if err := redactConversationPackageTx(ctx, tx, conversationID); err != nil {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE conversations
		SET title='[已永久清理]',
		    lifecycle_status='purged',
		    archived_at=NULL,
		    trashed_at=COALESCE(trashed_at, datetime('now')),
		    purge_after=NULL,
		    restored_at=NULL,
		    metadata=json_set(COALESCE(metadata, '{}'), '$.purged_at', datetime('now'), '$.purged_by', 'desktop_ui'),
		    updated_at=datetime('now')
		WHERE id=?
	`, conversationID)
	if err := requireRowsAffected(result, err, "conversation not found"); err != nil {
		return nil, err
	}
	if err := insertConversationLifecycleEventTx(ctx, tx, conversationID, "purge", "desktop_ui", req.Reason, previousStatus, conversationLifecyclePurged, map[string]any{"redaction": "tombstone"}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	if err := a.db.RebuildSQLiteMemoryFTS(ctx); err != nil {
		return nil, err
	}
	conversation, err := a.getConversationSummary(ctx, conversationID)
	if err != nil {
		return nil, err
	}
	return &ConversationActionResponse{Conversation: conversation}, nil
}

func (a *AppCore) setConversationLifecycle(ctx context.Context, req ConversationActionRequest, action string, nextStatus string) (*ConversationActionResponse, error) {
	if err := a.requireSQLiteConversationLifecycle(ctx); err != nil {
		return nil, err
	}
	conversationID := strings.TrimSpace(req.ID)
	if conversationID == "" {
		return nil, errors.New("conversation id is required")
	}
	tx, err := a.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	previousStatus, err := conversationLifecycleStatusTx(ctx, tx, conversationID)
	if err != nil {
		return nil, err
	}
	if previousStatus == conversationLifecyclePurged {
		return nil, errors.New("purged conversation cannot change lifecycle")
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE conversations
		SET lifecycle_status=?,
		    archived_at=CASE WHEN ?='archived' THEN COALESCE(archived_at, datetime('now')) ELSE archived_at END,
		    trashed_at=CASE WHEN ?='trashed' THEN COALESCE(trashed_at, datetime('now')) ELSE NULL END,
		    purge_after=CASE WHEN ?='trashed' THEN COALESCE(purge_after, datetime('now', '+30 days')) ELSE NULL END,
		    restored_at=NULL,
		    updated_at=datetime('now')
		WHERE id=?
	`, nextStatus, nextStatus, nextStatus, nextStatus, conversationID)
	if err := requireRowsAffected(result, err, "conversation not found"); err != nil {
		return nil, err
	}
	if err := insertConversationLifecycleEventTx(ctx, tx, conversationID, action, "desktop_ui", req.Reason, previousStatus, nextStatus, map[string]any{}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	conversation, err := a.getConversationSummary(ctx, conversationID)
	if err != nil {
		return nil, err
	}
	return &ConversationActionResponse{Conversation: conversation}, nil
}

func (a *AppCore) requireSQLiteConversationLifecycle(ctx context.Context) error {
	if a.db == nil {
		return errors.New("appcore db is not available")
	}
	if !a.isSQLite() {
		return errors.New("conversation lifecycle APIs are implemented for SQLite desktop mode")
	}
	return a.db.EnsureSQLiteConversationLifecycle(ctx)
}

func conversationLifecycleStatusTx(ctx context.Context, tx *sql.Tx, conversationID string) (string, error) {
	var status string
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(lifecycle_status, 'active') FROM conversations WHERE id=?`, conversationID).Scan(&status); err != nil {
		return "", err
	}
	if status == "" {
		status = conversationLifecycleActive
	}
	return status, nil
}

func insertConversationLifecycleEventTx(ctx context.Context, tx *sql.Tx, conversationID string, action string, actor string, reason string, previousStatus string, nextStatus string, metadata map[string]any) error {
	eventID, err := store.NewID("clevt_")
	if err != nil {
		return err
	}
	if metadata == nil {
		metadata = map[string]any{}
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO conversation_lifecycle_events (id, conversation_id, action, actor, reason, previous_status, next_status, metadata)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, eventID, conversationID, action, valueOrDefault(actor, "desktop_ui"), reason, previousStatus, nextStatus, mustJSON(metadata))
	return err
}

func applyConversationTrashMemoryPolicyTx(ctx context.Context, tx *sql.Tx, conversationID string) (int, int, error) {
	sourcePredicate := `EXISTS (SELECT 1 FROM json_each(memories.source_event_ids) WHERE value=?)`
	result, err := tx.ExecContext(ctx, `
		UPDATE memories
		SET status='deleted',
		    disabled_at=datetime('now'),
		    metadata=json_set(COALESCE(metadata, '{}'),
		      '$.deleted_by', 'conversation_trash',
		      '$.trash_source_conversation_id', ?,
		      '$.previous_status', status,
		      '$.deleted_at', datetime('now')),
		    updated_at=datetime('now')
		WHERE status IN ('pending','conflicted')
		  AND pinned=0
		  AND `+sourcePredicate, conversationID, conversationID)
	if err != nil {
		return 0, 0, err
	}
	hidden, _ := result.RowsAffected()
	result, err = tx.ExecContext(ctx, `
		UPDATE memories
		SET metadata=json_set(COALESCE(metadata, '{}'),
		      '$.source_conversation_trashed_at', datetime('now'),
		      '$.trash_source_conversation_id', ?),
		    updated_at=datetime('now')
		WHERE (status='confirmed' OR pinned=1)
		  AND `+sourcePredicate, conversationID, conversationID)
	if err != nil {
		return 0, 0, err
	}
	kept, _ := result.RowsAffected()
	return int(hidden), int(kept), nil
}

func restoreConversationTrashMemoriesTx(ctx context.Context, tx *sql.Tx, conversationID string) (int, error) {
	result, err := tx.ExecContext(ctx, `
		UPDATE memories
		SET status=CASE
		      WHEN json_extract(metadata, '$.previous_status') IN ('pending','conflicted') THEN json_extract(metadata, '$.previous_status')
		      ELSE 'pending'
		    END,
		    disabled_at=NULL,
		    metadata=json_remove(COALESCE(metadata, '{}'),
		      '$.deleted_by',
		      '$.trash_source_conversation_id',
		      '$.previous_status',
		      '$.deleted_at',
		      '$.source_conversation_trashed_at'),
		    updated_at=datetime('now')
		WHERE status='deleted'
		  AND json_extract(metadata, '$.deleted_by')='conversation_trash'
		  AND json_extract(metadata, '$.trash_source_conversation_id')=?
	`, conversationID)
	if err != nil {
		return 0, err
	}
	restored, _ := result.RowsAffected()
	_, err = tx.ExecContext(ctx, `
		UPDATE memories
		SET metadata=json_remove(COALESCE(metadata, '{}'), '$.source_conversation_trashed_at', '$.trash_source_conversation_id'),
		    updated_at=datetime('now')
		WHERE json_extract(metadata, '$.trash_source_conversation_id')=?
	`, conversationID)
	if err != nil {
		return 0, err
	}
	return int(restored), nil
}

func redactConversationPackageTx(ctx context.Context, tx *sql.Tx, conversationID string) error {
	redacted := "[已永久清理]"
	statements := []string{
		`UPDATE messages SET content=?, attachments='[]', metadata=json_set(COALESCE(metadata, '{}'), '$.redacted_at', datetime('now')) WHERE conversation_id=?`,
		`UPDATE prompt_assemblies SET cacheable_prefix=?, dynamic_tail=?, prefix_hash='redacted', dynamic_tail_hash='redacted', prompt_cache_key='redacted', metadata=json_set(COALESCE(metadata, '{}'), '$.redacted_at', datetime('now')) WHERE run_id IN (SELECT id FROM runs WHERE conversation_id=?)`,
		`UPDATE model_calls SET raw_response='{}', metadata=json_set(COALESCE(metadata, '{}'), '$.redacted_at', datetime('now')) WHERE run_id IN (SELECT id FROM runs WHERE conversation_id=?)`,
		`UPDATE tool_runs SET input='{}', output='{}', error=NULL WHERE run_id IN (SELECT id FROM runs WHERE conversation_id=?)`,
		`UPDATE tasks SET payload='{}', result='{}', error=NULL WHERE run_id IN (SELECT id FROM runs WHERE conversation_id=?)`,
		`UPDATE task_attempts SET input='{}', output='{}', error=NULL WHERE task_id IN (SELECT id FROM tasks WHERE run_id IN (SELECT id FROM runs WHERE conversation_id=?))`,
		`UPDATE run_steps SET input='{}', output='{}', error=NULL WHERE run_id IN (SELECT id FROM runs WHERE conversation_id=?)`,
		`UPDATE product_tasks SET title=?, description=?, summary=?, status=CASE WHEN status IN ('completed','completed_with_limitations') THEN status ELSE 'cancelled' END, metadata=json_set(COALESCE(metadata, '{}'), '$.redacted_at', datetime('now')), updated_at=datetime('now') WHERE created_from_conversation_id=?`,
		`UPDATE product_task_steps SET title=?, description=?, summary=?, input='{}', output='{}', error=NULL, updated_at=datetime('now') WHERE product_task_id IN (SELECT id FROM product_tasks WHERE created_from_conversation_id=?)`,
		`UPDATE artifacts SET title=?, content=?, status='deleted', metadata=json_set(COALESCE(metadata, '{}'), '$.redacted_at', datetime('now')), updated_at=datetime('now') WHERE source_conversation_id=? OR source_product_task_id IN (SELECT id FROM product_tasks WHERE created_from_conversation_id=?)`,
		`UPDATE open_loops SET topic=?, description=?, suggested_followup='', status='closed', metadata=json_set(COALESCE(metadata, '{}'), '$.redacted_at', datetime('now')), closed_at=COALESCE(closed_at, datetime('now')), updated_at=datetime('now') WHERE source_conversation_id=? OR source_product_task_id IN (SELECT id FROM product_tasks WHERE created_from_conversation_id=?)`,
		`UPDATE proactive_messages SET title=?, body=?, reason=?, status='dismissed', feedback='conversation_purged', metadata=json_set(COALESCE(metadata, '{}'), '$.redacted_at', datetime('now')), updated_at=datetime('now') WHERE source_product_task_id IN (SELECT id FROM product_tasks WHERE created_from_conversation_id=?) OR source_open_loop_id IN (SELECT id FROM open_loops WHERE source_conversation_id=?)`,
	}
	for index, statement := range statements {
		var args []any
		switch index {
		case 0:
			args = []any{redacted, conversationID}
		case 1:
			args = []any{redacted, redacted, conversationID}
		case 7:
			args = []any{redacted, redacted, redacted, conversationID}
		case 8:
			args = []any{redacted, redacted, redacted, conversationID}
		case 9, 10:
			args = []any{redacted, redacted, conversationID, conversationID}
		case 11:
			args = []any{redacted, redacted, redacted, conversationID, conversationID}
		default:
			args = []any{conversationID}
		}
		if _, err := tx.ExecContext(ctx, statement, args...); err != nil {
			return fmt.Errorf("redact conversation package step %d: %w", index, err)
		}
	}
	_, err := tx.ExecContext(ctx, `
		DELETE FROM memories
		WHERE status='deleted'
		  AND json_extract(metadata, '$.deleted_by')='conversation_trash'
		  AND json_extract(metadata, '$.trash_source_conversation_id')=?
	`, conversationID)
	return err
}

func scanConversationGroup(rows *sql.Rows) (ConversationGroup, error) {
	var group ConversationGroup
	var metadataRaw, createdAt, updatedAt string
	if err := rows.Scan(&group.ID, &group.Name, &group.SortOrder, &group.Collapsed, &metadataRaw, &createdAt, &updatedAt); err != nil {
		return ConversationGroup{}, err
	}
	group.Metadata = decodeObject([]byte(metadataRaw))
	group.CreatedAt = parseSQLiteTime(createdAt)
	group.UpdatedAt = parseSQLiteTime(updatedAt)
	return group, nil
}

func getConversationGroup(ctx context.Context, runner queryRowContextRunner, id string) (*ConversationGroup, error) {
	var group ConversationGroup
	var metadataRaw, createdAt, updatedAt string
	err := runner.QueryRowContext(ctx, `
		SELECT id, name, sort_order, collapsed, metadata, created_at, updated_at
		FROM conversation_groups
		WHERE id=?
	`, id).Scan(&group.ID, &group.Name, &group.SortOrder, &group.Collapsed, &metadataRaw, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	group.Metadata = decodeObject([]byte(metadataRaw))
	group.CreatedAt = parseSQLiteTime(createdAt)
	group.UpdatedAt = parseSQLiteTime(updatedAt)
	return &group, nil
}

func conversationVisibleInPrimaryListsPredicate(sourceConversationExpr string) string {
	return fmt.Sprintf(`NOT EXISTS (
		SELECT 1 FROM conversations c
		WHERE c.id=%s
		  AND COALESCE(c.lifecycle_status, 'active') IN ('archived','trashed','purged')
	)`, sourceConversationExpr)
}

func productTaskConversationVisiblePredicate(productTaskExpr string) string {
	return fmt.Sprintf(`NOT EXISTS (
		SELECT 1
		FROM product_tasks pt
		JOIN conversations c ON c.id=pt.created_from_conversation_id
		WHERE pt.id=%s
		  AND COALESCE(c.lifecycle_status, 'active') IN ('archived','trashed','purged')
	)`, productTaskExpr)
}
