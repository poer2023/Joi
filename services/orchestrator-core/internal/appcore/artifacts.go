package appcore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

type ArtifactFilter struct {
	ProductTaskID string `json:"product_task_id"`
	Type          string `json:"type"`
	Limit         int    `json:"limit"`
}

type ArtifactSummary struct {
	ID                   string         `json:"id"`
	Type                 string         `json:"type"`
	Title                string         `json:"title"`
	ContentFormat        string         `json:"content_format"`
	SourceProductTaskID  string         `json:"source_product_task_id"`
	SourceRunID          string         `json:"source_run_id"`
	SourceConversationID string         `json:"source_conversation_id"`
	SourceMessageID      string         `json:"source_message_id"`
	Version              int            `json:"version"`
	Status               string         `json:"status"`
	Metadata             map[string]any `json:"metadata"`
	CreatedAt            time.Time      `json:"created_at"`
	UpdatedAt            time.Time      `json:"updated_at"`
}

type ArtifactDetail struct {
	ArtifactSummary
	Content         string   `json:"content"`
	LinkedMemoryIDs []string `json:"linked_memory_ids"`
}

type ArtifactListResponse struct {
	Artifacts []ArtifactSummary `json:"artifacts"`
}

type CreateArtifactRequest struct {
	Type                 string         `json:"type"`
	Title                string         `json:"title"`
	Content              string         `json:"content"`
	ContentFormat        string         `json:"content_format"`
	SourceProductTaskID  string         `json:"source_product_task_id"`
	SourceRunID          string         `json:"source_run_id"`
	SourceConversationID string         `json:"source_conversation_id"`
	SourceMessageID      string         `json:"source_message_id"`
	LinkedMemoryIDs      []string       `json:"linked_memory_ids"`
	Metadata             map[string]any `json:"metadata"`
}

type OpenLoopFilter struct {
	Status string `json:"status"`
	Limit  int    `json:"limit"`
}

type OpenLoopRecord struct {
	ID                   string         `json:"id"`
	Topic                string         `json:"topic"`
	Description          string         `json:"description"`
	Status               string         `json:"status"`
	SourceConversationID string         `json:"source_conversation_id"`
	SourceRunID          string         `json:"source_run_id"`
	SourceProductTaskID  string         `json:"source_product_task_id"`
	SuggestedFollowup    string         `json:"suggested_followup"`
	Priority             string         `json:"priority"`
	DueAt                *time.Time     `json:"due_at,omitempty"`
	Metadata             map[string]any `json:"metadata"`
	CreatedAt            time.Time      `json:"created_at"`
	UpdatedAt            time.Time      `json:"updated_at"`
	ClosedAt             *time.Time     `json:"closed_at,omitempty"`
}

type OpenLoopListResponse struct {
	OpenLoops []OpenLoopRecord `json:"open_loops"`
}

type ProactiveMessageFilter struct {
	Status string `json:"status"`
	Limit  int    `json:"limit"`
}

type ProactiveMessageRecord struct {
	ID                  string         `json:"id"`
	Type                string         `json:"type"`
	Title               string         `json:"title"`
	Body                string         `json:"body"`
	Reason              string         `json:"reason"`
	SourceMemoryIDs     []string       `json:"source_memory_ids"`
	SourceOpenLoopID    string         `json:"source_open_loop_id"`
	SourceProductTaskID string         `json:"source_product_task_id"`
	Score               float64        `json:"score"`
	Status              string         `json:"status"`
	Channel             string         `json:"channel"`
	SendAfter           *time.Time     `json:"send_after,omitempty"`
	ExpiresAt           *time.Time     `json:"expires_at,omitempty"`
	Feedback            string         `json:"feedback"`
	Metadata            map[string]any `json:"metadata"`
	CreatedAt           time.Time      `json:"created_at"`
	UpdatedAt           time.Time      `json:"updated_at"`
	SentAt              *time.Time     `json:"sent_at,omitempty"`
}

type ProactiveMessageListResponse struct {
	Messages []ProactiveMessageRecord `json:"messages"`
}

func (a *AppCore) CreateArtifact(ctx context.Context, req CreateArtifactRequest) (*ArtifactSummary, error) {
	if err := a.requireSQLiteProductAPI(); err != nil {
		return nil, err
	}
	tx, err := a.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	artifact, err := createArtifactTx(ctx, tx, req)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return artifact, nil
}

func (a *AppCore) AttachArtifactToTask(ctx context.Context, productTaskID string, artifactID string) error {
	if err := a.requireSQLiteProductAPI(); err != nil {
		return err
	}
	productTaskID = strings.TrimSpace(productTaskID)
	artifactID = strings.TrimSpace(artifactID)
	if productTaskID == "" || artifactID == "" {
		return errors.New("product_task_id and artifact_id are required")
	}
	var artifactType, title string
	if err := a.db.SQL().QueryRowContext(ctx, `SELECT type, title FROM artifacts WHERE id=?`, artifactID).Scan(&artifactType, &title); err != nil {
		return err
	}
	deliverableID, err := store.NewID("pdeliv_")
	if err != nil {
		return err
	}
	_, err = a.db.SQL().ExecContext(ctx, `
		INSERT INTO product_task_deliverables (id, product_task_id, artifact_id, type, title, sort_order)
		VALUES (?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order)+1 FROM product_task_deliverables WHERE product_task_id=?), 1))
	`, deliverableID, productTaskID, artifactID, artifactType, title, productTaskID)
	return err
}

func (a *AppCore) ListArtifacts(ctx context.Context, filter ArtifactFilter) (*ArtifactListResponse, error) {
	if err := a.requireSQLiteProductAPI(); err != nil {
		return nil, err
	}
	artifacts, err := listArtifactSummaries(ctx, a.db.SQL(), filter)
	if err != nil {
		return nil, err
	}
	return &ArtifactListResponse{Artifacts: artifacts}, nil
}

func (a *AppCore) GetArtifact(ctx context.Context, id string) (*ArtifactDetail, error) {
	if err := a.requireSQLiteProductAPI(); err != nil {
		return nil, err
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, errors.New("artifact id is required")
	}
	var detail ArtifactDetail
	var linkedRaw, metadataRaw, createdAt, updatedAt string
	var taskID, runID, conversationID, messageID sql.NullString
	err := a.db.SQL().QueryRowContext(ctx, `
		SELECT id, type, title, content, content_format, source_product_task_id, source_run_id,
		       source_conversation_id, source_message_id, linked_memory_ids, version, status, metadata,
		       created_at, updated_at
		FROM artifacts
		WHERE id=?
	`, id).Scan(&detail.ID, &detail.Type, &detail.Title, &detail.Content, &detail.ContentFormat, &taskID, &runID, &conversationID, &messageID, &linkedRaw, &detail.Version, &detail.Status, &metadataRaw, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	detail.SourceProductTaskID = taskID.String
	detail.SourceRunID = runID.String
	detail.SourceConversationID = conversationID.String
	detail.SourceMessageID = messageID.String
	detail.LinkedMemoryIDs = decodeStringArray([]byte(linkedRaw))
	detail.Metadata = decodeObject([]byte(metadataRaw))
	detail.CreatedAt = parseSQLiteTime(createdAt)
	detail.UpdatedAt = parseSQLiteTime(updatedAt)
	return &detail, nil
}

func (a *AppCore) ListOpenLoops(ctx context.Context, filter OpenLoopFilter) (*OpenLoopListResponse, error) {
	if err := a.requireSQLiteProductAPI(); err != nil {
		return nil, err
	}
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	status := strings.TrimSpace(filter.Status)
	if status == "" {
		status = "open"
	}
	rows, err := a.db.SQL().QueryContext(ctx, `
		SELECT id, topic, description, status, COALESCE(source_conversation_id, ''), COALESCE(source_run_id, ''),
		       COALESCE(source_product_task_id, ''), suggested_followup, priority, due_at, metadata, created_at,
		       updated_at, closed_at
		FROM open_loops
		WHERE status=?
		  AND `+conversationVisibleInPrimaryListsPredicate("open_loops.source_conversation_id")+`
		  AND `+productTaskConversationVisiblePredicate("open_loops.source_product_task_id")+`
		ORDER BY updated_at DESC, created_at DESC
		LIMIT ?
	`, status, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []OpenLoopRecord{}
	for rows.Next() {
		item, err := scanOpenLoop(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return &OpenLoopListResponse{OpenLoops: items}, rows.Err()
}

func (a *AppCore) ListProactiveMessages(ctx context.Context, filter ProactiveMessageFilter) (*ProactiveMessageListResponse, error) {
	if err := a.requireSQLiteProductAPI(); err != nil {
		return nil, err
	}
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	status := strings.TrimSpace(filter.Status)
	if status == "" {
		status = "draft"
	}
	rows, err := a.db.SQL().QueryContext(ctx, `
		SELECT id, type, title, body, reason, source_memory_ids, COALESCE(source_open_loop_id, ''),
		       COALESCE(source_product_task_id, ''), score, status, channel, send_after, expires_at,
		       COALESCE(feedback, ''), metadata, created_at, updated_at, sent_at
		FROM proactive_messages
		WHERE status=?
		  AND `+productTaskConversationVisiblePredicate("proactive_messages.source_product_task_id")+`
		  AND NOT EXISTS (
		    SELECT 1
		    FROM open_loops ol
		    JOIN conversations c ON c.id=ol.source_conversation_id
		    WHERE ol.id=proactive_messages.source_open_loop_id
		      AND COALESCE(c.lifecycle_status, 'active') IN ('archived','trashed','purged')
		  )
		ORDER BY score DESC, updated_at DESC, created_at DESC
		LIMIT ?
	`, status, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ProactiveMessageRecord{}
	for rows.Next() {
		item, err := scanProactiveMessage(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return &ProactiveMessageListResponse{Messages: items}, rows.Err()
}

func (a *AppCore) DecideProactiveMessage(ctx context.Context, id string, action string, feedback string) error {
	if err := a.requireSQLiteProductAPI(); err != nil {
		return err
	}
	id = strings.TrimSpace(id)
	action = strings.TrimSpace(action)
	if id == "" || action == "" {
		return errors.New("id and action are required")
	}
	status := ""
	switch action {
	case "send", "approve", "queue":
		status = "queued"
	case "sent":
		status = "sent"
	case "dismiss", "ignore":
		status = "dismissed"
	case "suppress", "never_again":
		status = "suppressed"
	case "useful", "annoying", "inaccurate":
		status = "dismissed"
		feedback = valueOrDefault(feedback, action)
	default:
		return fmt.Errorf("unsupported proactive action: %s", action)
	}
	setSentAt := ""
	if status == "sent" {
		setSentAt = ", sent_at=datetime('now')"
	}
	tx, err := a.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
		UPDATE proactive_messages
		SET status=?, feedback=NULLIF(?, ''), updated_at=datetime('now')`+setSentAt+`
		WHERE id=?
	`, status, feedback, id)
	if err := requireRowsAffected(result, err, "proactive message not found"); err != nil {
		return err
	}
	feedbackID, err := store.NewID("pfb_")
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO proactive_feedback (id, proactive_message_id, action, feedback) VALUES (?, ?, ?, NULLIF(?, ''))`, feedbackID, id, action, feedback); err != nil {
		return err
	}
	return tx.Commit()
}

func createArtifactTx(ctx context.Context, tx *sql.Tx, req CreateArtifactRequest) (*ArtifactSummary, error) {
	artifactID, err := store.NewID("art_")
	if err != nil {
		return nil, err
	}
	artifactType := normalizeArtifactType(req.Type)
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "未命名交付物"
	}
	format := valueOrDefault(req.ContentFormat, "markdown")
	metadata := req.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO artifacts (id, type, title, content, content_format, source_product_task_id, source_run_id,
			source_conversation_id, source_message_id, linked_memory_ids, metadata, updated_at)
		VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, datetime('now'))
	`, artifactID, artifactType, title, req.Content, format, req.SourceProductTaskID, req.SourceRunID, req.SourceConversationID, req.SourceMessageID, mustJSON(req.LinkedMemoryIDs), mustJSON(metadata))
	if err != nil {
		return nil, err
	}
	if req.SourceProductTaskID != "" {
		deliverableID, err := store.NewID("pdeliv_")
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO product_task_deliverables (id, product_task_id, artifact_id, type, title, sort_order)
			VALUES (?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order)+1 FROM product_task_deliverables WHERE product_task_id=?), 1))
		`, deliverableID, req.SourceProductTaskID, artifactID, artifactType, title, req.SourceProductTaskID); err != nil {
			return nil, err
		}
	}
	summary, err := getArtifactSummary(ctx, tx, artifactID)
	if err != nil {
		return nil, err
	}
	return &summary, nil
}

func listArtifactSummaries(ctx context.Context, runner queryContextRunner, filter ArtifactFilter) ([]ArtifactSummary, error) {
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	args := []any{}
	where := []string{
		"status <> 'deleted'",
		conversationVisibleInPrimaryListsPredicate("artifacts.source_conversation_id"),
		productTaskConversationVisiblePredicate("artifacts.source_product_task_id"),
	}
	if strings.TrimSpace(filter.ProductTaskID) != "" {
		where = append(where, "source_product_task_id=?")
		args = append(args, strings.TrimSpace(filter.ProductTaskID))
	}
	if strings.TrimSpace(filter.Type) != "" {
		where = append(where, "type=?")
		args = append(args, strings.TrimSpace(filter.Type))
	}
	args = append(args, limit)
	rows, err := runner.QueryContext(ctx, `
		SELECT id, type, title, content_format, COALESCE(source_product_task_id, ''), COALESCE(source_run_id, ''),
		       COALESCE(source_conversation_id, ''), COALESCE(source_message_id, ''), version, status, metadata,
		       created_at, updated_at
		FROM artifacts
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY updated_at DESC, created_at DESC
		LIMIT ?
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ArtifactSummary{}
	for rows.Next() {
		item, err := scanArtifactSummary(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func getArtifactSummary(ctx context.Context, runner queryRowContextRunner, id string) (ArtifactSummary, error) {
	row := runner.QueryRowContext(ctx, `
		SELECT id, type, title, content_format, COALESCE(source_product_task_id, ''), COALESCE(source_run_id, ''),
		       COALESCE(source_conversation_id, ''), COALESCE(source_message_id, ''), version, status, metadata,
		       created_at, updated_at
		FROM artifacts
		WHERE id=?
	`, id)
	return scanArtifactSummary(row)
}

type artifactSummaryScanner interface {
	Scan(dest ...any) error
}

func scanArtifactSummary(scanner artifactSummaryScanner) (ArtifactSummary, error) {
	var item ArtifactSummary
	var metadataRaw, createdAt, updatedAt string
	err := scanner.Scan(&item.ID, &item.Type, &item.Title, &item.ContentFormat, &item.SourceProductTaskID, &item.SourceRunID, &item.SourceConversationID, &item.SourceMessageID, &item.Version, &item.Status, &metadataRaw, &createdAt, &updatedAt)
	if err != nil {
		return ArtifactSummary{}, err
	}
	item.Metadata = decodeObject([]byte(metadataRaw))
	item.CreatedAt = parseSQLiteTime(createdAt)
	item.UpdatedAt = parseSQLiteTime(updatedAt)
	return item, nil
}

func scanOpenLoop(rows *sql.Rows) (OpenLoopRecord, error) {
	var item OpenLoopRecord
	var metadataRaw, createdAt, updatedAt string
	var dueAt, closedAt sql.NullString
	err := rows.Scan(&item.ID, &item.Topic, &item.Description, &item.Status, &item.SourceConversationID, &item.SourceRunID, &item.SourceProductTaskID, &item.SuggestedFollowup, &item.Priority, &dueAt, &metadataRaw, &createdAt, &updatedAt, &closedAt)
	if err != nil {
		return OpenLoopRecord{}, err
	}
	item.Metadata = decodeObject([]byte(metadataRaw))
	item.CreatedAt = parseSQLiteTime(createdAt)
	item.UpdatedAt = parseSQLiteTime(updatedAt)
	if dueAt.Valid {
		t := parseSQLiteTime(dueAt.String)
		item.DueAt = &t
	}
	if closedAt.Valid {
		t := parseSQLiteTime(closedAt.String)
		item.ClosedAt = &t
	}
	return item, nil
}

func scanProactiveMessage(rows *sql.Rows) (ProactiveMessageRecord, error) {
	var item ProactiveMessageRecord
	var memoryIDsRaw, metadataRaw, createdAt, updatedAt string
	var sendAfter, expiresAt, sentAt sql.NullString
	err := rows.Scan(&item.ID, &item.Type, &item.Title, &item.Body, &item.Reason, &memoryIDsRaw, &item.SourceOpenLoopID, &item.SourceProductTaskID, &item.Score, &item.Status, &item.Channel, &sendAfter, &expiresAt, &item.Feedback, &metadataRaw, &createdAt, &updatedAt, &sentAt)
	if err != nil {
		return ProactiveMessageRecord{}, err
	}
	item.SourceMemoryIDs = decodeStringArray([]byte(memoryIDsRaw))
	item.Metadata = decodeObject([]byte(metadataRaw))
	item.CreatedAt = parseSQLiteTime(createdAt)
	item.UpdatedAt = parseSQLiteTime(updatedAt)
	if sendAfter.Valid {
		t := parseSQLiteTime(sendAfter.String)
		item.SendAfter = &t
	}
	if expiresAt.Valid {
		t := parseSQLiteTime(expiresAt.String)
		item.ExpiresAt = &t
	}
	if sentAt.Valid {
		t := parseSQLiteTime(sentAt.String)
		item.SentAt = &t
	}
	return item, nil
}

func normalizeArtifactType(value string) string {
	switch strings.TrimSpace(value) {
	case "report", "plan", "summary", "diff", "decision", "memory_digest", "research_note", "code_patch", "backlog":
		return strings.TrimSpace(value)
	default:
		return "summary"
	}
}

func decodeStringArray(raw []byte) []string {
	values := []string{}
	if len(raw) == 0 {
		return values
	}
	var direct []string
	if err := unmarshalJSONString(string(raw), &direct); err == nil {
		return direct
	}
	for _, item := range decodeArray(raw) {
		if text, ok := item.(string); ok {
			values = append(values, text)
		}
	}
	return values
}
