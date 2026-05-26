package appcore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

type ConversationListResponse struct {
	Conversations []ConversationSummary `json:"conversations"`
}

type ConversationFilter struct {
	View    string `json:"view"`
	GroupID string `json:"group_id"`
	Limit   int    `json:"limit"`
}

type ConversationGroup struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	SortOrder int            `json:"sort_order"`
	Collapsed bool           `json:"collapsed"`
	Metadata  map[string]any `json:"metadata"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}

type ConversationGroupListResponse struct {
	Groups []ConversationGroup `json:"groups"`
}

type ConversationGroupRequest struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	SortOrder int            `json:"sort_order"`
	Collapsed bool           `json:"collapsed"`
	Metadata  map[string]any `json:"metadata"`
}

type ConversationActionRequest struct {
	ID      string `json:"id"`
	Reason  string `json:"reason"`
	GroupID string `json:"group_id"`
}

type ConversationActionResponse struct {
	Conversation ConversationSummary `json:"conversation"`
}

type ConversationSummary struct {
	ID              string         `json:"id"`
	Channel         string         `json:"channel"`
	UserID          string         `json:"user_id"`
	Title           string         `json:"title"`
	ActiveAgentID   string         `json:"active_agent_id"`
	Topic           string         `json:"topic"`
	GroupID         string         `json:"group_id"`
	LifecycleStatus string         `json:"lifecycle_status"`
	Pinned          bool           `json:"pinned"`
	LastMessage     string         `json:"last_message"`
	LastRole        string         `json:"last_role"`
	LatestRunID     string         `json:"latest_run_id"`
	MessageCount    int            `json:"message_count"`
	Metadata        map[string]any `json:"metadata"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	ArchivedAt      *time.Time     `json:"archived_at,omitempty"`
	TrashedAt       *time.Time     `json:"trashed_at,omitempty"`
	PurgeAfter      *time.Time     `json:"purge_after,omitempty"`
	RestoredAt      *time.Time     `json:"restored_at,omitempty"`
}

type ConversationDetail struct {
	Conversation ConversationSummary   `json:"conversation"`
	Messages     []ConversationMessage `json:"messages"`
}

type ConversationMessage struct {
	ID             string         `json:"id"`
	ConversationID string         `json:"conversation_id"`
	Role           string         `json:"role"`
	Content        string         `json:"content"`
	RunID          string         `json:"run_id"`
	Attachments    []any          `json:"attachments"`
	Metadata       map[string]any `json:"metadata"`
	CreatedAt      time.Time      `json:"created_at"`
}

type CapabilityListResponse struct {
	Capabilities []store.CapabilityRecord `json:"capabilities"`
}

type ToolWorkflowListResponse struct {
	Workflows []ToolWorkflowRecord `json:"workflows"`
}

type ToolWorkflowRecord struct {
	ID           string                   `json:"id"`
	CapabilityID string                   `json:"capability_id"`
	Name         string                   `json:"name"`
	Version      string                   `json:"version"`
	RiskLevel    string                   `json:"risk_level"`
	Steps        []store.ToolWorkflowStep `json:"steps"`
	Enabled      bool                     `json:"enabled"`
	Metadata     map[string]any           `json:"metadata"`
	CreatedAt    time.Time                `json:"created_at"`
	UpdatedAt    time.Time                `json:"updated_at"`
}

type ToolRunListResponse struct {
	ToolRuns []ToolRunRecord `json:"tool_runs"`
}

type ToolRunRecord struct {
	ID               string         `json:"id"`
	RunID            string         `json:"run_id"`
	TaskID           string         `json:"task_id"`
	CapabilityID     string         `json:"capability_id"`
	WorkflowName     string         `json:"workflow_name"`
	ToolID           string         `json:"tool_id"`
	ToolName         string         `json:"tool_name"`
	NodeID           string         `json:"node_id"`
	AssignmentReason string         `json:"assignment_reason"`
	RiskLevel        string         `json:"risk_level"`
	Status           string         `json:"status"`
	Input            map[string]any `json:"input"`
	Output           map[string]any `json:"output"`
	Error            map[string]any `json:"error,omitempty"`
	StartedAt        time.Time      `json:"started_at"`
	FinishedAt       *time.Time     `json:"finished_at"`
	DurationMs       *int           `json:"duration_ms"`
	CreatedAt        time.Time      `json:"created_at"`
}

func (a *AppCore) ListConversations(ctx context.Context, filter ConversationFilter) (*ConversationListResponse, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	if a.isSQLite() {
		if err := a.db.EnsureSQLiteConversationLifecycle(ctx); err != nil {
			return nil, err
		}
	}
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	lastMessageOrder := "m.rowid DESC"
	latestRunOrder := "r.rowid DESC"
	if !a.isSQLite() {
		lastMessageOrder = "m.created_at DESC, m.id DESC"
		latestRunOrder = "r.created_at DESC, r.id DESC"
	}
	where, args := conversationListWhere(a.isSQLite(), filter)
	query := fmt.Sprintf(`
		SELECT c.id, c.channel, c.user_id, COALESCE(c.title, ''), COALESCE(c.active_agent_id, ''),
		       COALESCE(c.topic, ''), COALESCE(c.group_id, ''), COALESCE(c.lifecycle_status, 'active'),
		       c.pinned, c.archived_at, c.trashed_at, c.purge_after, c.restored_at,
		       c.metadata, c.created_at, c.updated_at,
		       COALESCE((SELECT m.content FROM messages m WHERE m.conversation_id=c.id ORDER BY %s LIMIT 1), '') AS last_message,
		       COALESCE((SELECT m.role FROM messages m WHERE m.conversation_id=c.id ORDER BY %s LIMIT 1), '') AS last_role,
		       COALESCE((SELECT r.id FROM runs r WHERE r.conversation_id=c.id ORDER BY %s LIMIT 1), '') AS latest_run_id,
		       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id) AS message_count
		FROM conversations c
		%s
		ORDER BY c.pinned DESC, c.updated_at DESC, c.created_at DESC
		LIMIT %d
	`, lastMessageOrder, lastMessageOrder, latestRunOrder, where, limit)
	rows, err := a.db.SQL().QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	conversations := []ConversationSummary{}
	for rows.Next() {
		conversation, err := scanConversationSummary(rows)
		if err != nil {
			return nil, err
		}
		conversations = append(conversations, conversation)
	}
	return &ConversationListResponse{Conversations: conversations}, rows.Err()
}

func (a *AppCore) GetConversation(ctx context.Context, conversationID string) (*ConversationDetail, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil, errors.New("conversation_id is required")
	}
	conversation, err := a.getConversationSummary(ctx, conversationID)
	if err != nil {
		return nil, err
	}
	placeholder := "?"
	orderBy := "m.rowid ASC"
	if !a.isSQLite() {
		placeholder = "$1"
		orderBy = "m.created_at ASC, CASE m.role WHEN 'user' THEN 0 ELSE 1 END, m.id ASC"
	}
	rows, err := a.db.SQL().QueryContext(ctx, fmt.Sprintf(`
		SELECT m.id, m.conversation_id, m.role, m.content, m.attachments, m.metadata, m.created_at,
		       COALESCE((SELECT r.id FROM runs r WHERE r.user_message_id=m.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1), '') AS user_run_id
		FROM messages m
		WHERE m.conversation_id=%s
		ORDER BY %s
	`, placeholder, orderBy), conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := []ConversationMessage{}
	for rows.Next() {
		var message ConversationMessage
		var attachmentsRaw, metadataRaw, createdAt, userRunID string
		if err := rows.Scan(&message.ID, &message.ConversationID, &message.Role, &message.Content, &attachmentsRaw, &metadataRaw, &createdAt, &userRunID); err != nil {
			return nil, err
		}
		message.Attachments = decodeArray([]byte(attachmentsRaw))
		message.Metadata = decodeObject([]byte(metadataRaw))
		message.CreatedAt = parseSQLiteTime(createdAt)
		if runID, ok := message.Metadata["run_id"].(string); ok {
			message.RunID = runID
		}
		if message.RunID == "" {
			message.RunID = userRunID
		}
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &ConversationDetail{Conversation: conversation, Messages: messages}, nil
}

func (a *AppCore) ListCapabilities(ctx context.Context) (*CapabilityListResponse, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	capabilities, err := a.db.ListCapabilities(ctx)
	if err != nil {
		return nil, err
	}
	return &CapabilityListResponse{Capabilities: capabilities}, nil
}

func (a *AppCore) ListToolWorkflows(ctx context.Context) (*ToolWorkflowListResponse, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	rows, err := a.db.SQL().QueryContext(ctx, `
		SELECT id, capability_id, name, version, risk_level, steps, enabled, metadata, created_at, updated_at
		FROM tool_workflows
		ORDER BY capability_id ASC, name ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	workflows := []ToolWorkflowRecord{}
	for rows.Next() {
		var workflow ToolWorkflowRecord
		var stepsRaw, metadataRaw, createdAt, updatedAt string
		if err := rows.Scan(&workflow.ID, &workflow.CapabilityID, &workflow.Name, &workflow.Version, &workflow.RiskLevel, &stepsRaw, &workflow.Enabled, &metadataRaw, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		workflow.Steps = []store.ToolWorkflowStep{}
		_ = unmarshalJSONString(stepsRaw, &workflow.Steps)
		workflow.Metadata = decodeObject([]byte(metadataRaw))
		workflow.CreatedAt = parseSQLiteTime(createdAt)
		workflow.UpdatedAt = parseSQLiteTime(updatedAt)
		workflows = append(workflows, workflow)
	}
	return &ToolWorkflowListResponse{Workflows: workflows}, rows.Err()
}

func (a *AppCore) ListToolRuns(ctx context.Context, limit int) (*ToolRunListResponse, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := a.db.SQL().QueryContext(ctx, fmt.Sprintf(`
		SELECT id, COALESCE(run_id, ''), COALESCE(task_id, ''), COALESCE(capability_id, ''),
		       COALESCE(workflow_name, ''), COALESCE(tool_id, ''), tool_name, COALESCE(node_id, ''),
		       COALESCE(assignment_reason, ''), risk_level, status, input, output, COALESCE(error, ''),
		       started_at, finished_at, duration_ms, created_at
		FROM tool_runs
		ORDER BY created_at DESC, started_at DESC
		LIMIT %d
	`, limit))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	toolRuns := []ToolRunRecord{}
	for rows.Next() {
		var record ToolRunRecord
		var inputRaw, outputRaw, errorRaw, startedAt, createdAt string
		var finishedAt sql.NullString
		var durationMs sql.NullInt32
		if err := rows.Scan(&record.ID, &record.RunID, &record.TaskID, &record.CapabilityID, &record.WorkflowName, &record.ToolID, &record.ToolName, &record.NodeID, &record.AssignmentReason, &record.RiskLevel, &record.Status, &inputRaw, &outputRaw, &errorRaw, &startedAt, &finishedAt, &durationMs, &createdAt); err != nil {
			return nil, err
		}
		record.Input = decodeObject([]byte(inputRaw))
		record.Output = decodeObject([]byte(outputRaw))
		errorRaw = strings.TrimSpace(store.RedactSensitiveText(errorRaw))
		record.Error = decodeObject([]byte(errorRaw))
		if errorRaw != "" && len(record.Error) == 0 {
			record.Error = map[string]any{"message": errorRaw}
		}
		record.StartedAt = parseSQLiteTime(startedAt)
		record.CreatedAt = parseSQLiteTime(createdAt)
		if finishedAt.Valid {
			t := parseSQLiteTime(finishedAt.String)
			record.FinishedAt = &t
		}
		record.DurationMs = nullIntPtr(durationMs)
		toolRuns = append(toolRuns, record)
	}
	return &ToolRunListResponse{ToolRuns: toolRuns}, rows.Err()
}

func (a *AppCore) SetToolWorkflowEnabled(ctx context.Context, workflowName string, enabled bool) error {
	if a.db == nil {
		return errors.New("appcore db is not available")
	}
	workflowName = strings.TrimSpace(workflowName)
	if workflowName == "" {
		return errors.New("workflow name is required")
	}
	if !a.isSQLite() {
		result, err := a.db.SQL().ExecContext(ctx, `UPDATE tool_workflows SET enabled=$1, updated_at=NOW() WHERE id=$2 OR name=$2`, enabled, workflowName)
		return requireRowsAffected(result, err, "tool workflow not found")
	}
	enabledValue := 0
	if enabled {
		enabledValue = 1
	}
	result, err := a.db.SQL().ExecContext(ctx, `UPDATE tool_workflows SET enabled=?, updated_at=datetime('now') WHERE id=? OR name=?`, enabledValue, workflowName, workflowName)
	return requireRowsAffected(result, err, "tool workflow not found")
}

func (a *AppCore) getConversationSummary(ctx context.Context, conversationID string) (ConversationSummary, error) {
	placeholder := "?"
	lastMessageOrder := "m.rowid DESC"
	latestRunOrder := "r.rowid DESC"
	if !a.isSQLite() {
		placeholder = "$1"
		lastMessageOrder = "m.created_at DESC, m.id DESC"
		latestRunOrder = "r.created_at DESC, r.id DESC"
	}
	rows, err := a.db.SQL().QueryContext(ctx, fmt.Sprintf(`
		SELECT c.id, c.channel, c.user_id, COALESCE(c.title, ''), COALESCE(c.active_agent_id, ''),
		       COALESCE(c.topic, ''), COALESCE(c.group_id, ''), COALESCE(c.lifecycle_status, 'active'),
		       c.pinned, c.archived_at, c.trashed_at, c.purge_after, c.restored_at,
		       c.metadata, c.created_at, c.updated_at,
		       COALESCE((SELECT m.content FROM messages m WHERE m.conversation_id=c.id ORDER BY %s LIMIT 1), '') AS last_message,
		       COALESCE((SELECT m.role FROM messages m WHERE m.conversation_id=c.id ORDER BY %s LIMIT 1), '') AS last_role,
		       COALESCE((SELECT r.id FROM runs r WHERE r.conversation_id=c.id ORDER BY %s LIMIT 1), '') AS latest_run_id,
		       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id) AS message_count
		FROM conversations c
		WHERE c.id=%s
	`, lastMessageOrder, lastMessageOrder, latestRunOrder, placeholder), conversationID)
	if err != nil {
		return ConversationSummary{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return ConversationSummary{}, err
		}
		return ConversationSummary{}, sql.ErrNoRows
	}
	conversation, err := scanConversationSummary(rows)
	if err != nil {
		return ConversationSummary{}, err
	}
	return conversation, rows.Err()
}

type conversationSummaryScanner interface {
	Scan(dest ...any) error
}

func scanConversationSummary(scanner conversationSummaryScanner) (ConversationSummary, error) {
	var conversation ConversationSummary
	var metadataRaw, createdAt, updatedAt string
	var archivedAt, trashedAt, purgeAfter, restoredAt sql.NullString
	if err := scanner.Scan(&conversation.ID, &conversation.Channel, &conversation.UserID, &conversation.Title, &conversation.ActiveAgentID, &conversation.Topic, &conversation.GroupID, &conversation.LifecycleStatus, &conversation.Pinned, &archivedAt, &trashedAt, &purgeAfter, &restoredAt, &metadataRaw, &createdAt, &updatedAt, &conversation.LastMessage, &conversation.LastRole, &conversation.LatestRunID, &conversation.MessageCount); err != nil {
		return ConversationSummary{}, err
	}
	if conversation.LifecycleStatus == "" {
		conversation.LifecycleStatus = "active"
	}
	conversation.Metadata = decodeObject([]byte(metadataRaw))
	conversation.CreatedAt = parseSQLiteTime(createdAt)
	conversation.UpdatedAt = parseSQLiteTime(updatedAt)
	conversation.ArchivedAt = nullSQLiteTimePtr(archivedAt)
	conversation.TrashedAt = nullSQLiteTimePtr(trashedAt)
	conversation.PurgeAfter = nullSQLiteTimePtr(purgeAfter)
	conversation.RestoredAt = nullSQLiteTimePtr(restoredAt)
	return conversation, nil
}

func conversationListWhere(sqlite bool, filter ConversationFilter) (string, []any) {
	view := normalizeConversationView(filter.View)
	clauses := []string{}
	args := []any{}
	switch view {
	case "archived":
		clauses = append(clauses, "COALESCE(c.lifecycle_status, 'active')='archived'")
	case "trash":
		clauses = append(clauses, "COALESCE(c.lifecycle_status, 'active')='trashed'")
	case "all":
		clauses = append(clauses, "COALESCE(c.lifecycle_status, 'active')<>'purged'")
	case "purged":
		clauses = append(clauses, "COALESCE(c.lifecycle_status, 'active')='purged'")
	default:
		clauses = append(clauses, "COALESCE(c.lifecycle_status, 'active')='active'")
	}
	groupID := strings.TrimSpace(filter.GroupID)
	if groupID != "" {
		if groupID == "__ungrouped" {
			clauses = append(clauses, "(c.group_id IS NULL OR c.group_id='')")
		} else {
			placeholder := "?"
			if !sqlite {
				placeholder = fmt.Sprintf("$%d", len(args)+1)
			}
			clauses = append(clauses, "c.group_id="+placeholder)
			args = append(args, groupID)
		}
	}
	if len(clauses) == 0 {
		return "", args
	}
	return "WHERE " + strings.Join(clauses, " AND "), args
}

func normalizeConversationView(view string) string {
	switch strings.TrimSpace(strings.ToLower(view)) {
	case "archive", "archived":
		return "archived"
	case "trash", "trashed", "recycle_bin":
		return "trash"
	case "all":
		return "all"
	case "purged":
		return "purged"
	default:
		return "active"
	}
}

func nullSQLiteTimePtr(value sql.NullString) *time.Time {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	t := parseSQLiteTime(value.String)
	return &t
}

func unmarshalJSONString(raw string, dest any) error {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	return json.Unmarshal([]byte(raw), dest)
}

func requireRowsAffected(result sql.Result, err error, notFoundMessage string) error {
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err == nil && affected == 0 {
		return errors.New(notFoundMessage)
	}
	return nil
}
