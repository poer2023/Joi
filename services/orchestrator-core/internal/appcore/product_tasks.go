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

type ProductTaskFilter struct {
	Status string `json:"status"`
	Limit  int    `json:"limit"`
}

type ProductTask struct {
	ID                        string         `json:"id"`
	Title                     string         `json:"title"`
	Description               string         `json:"description"`
	Status                    string         `json:"status"`
	Mode                      string         `json:"mode"`
	Priority                  string         `json:"priority"`
	CreatedFromConversationID string         `json:"created_from_conversation_id"`
	CreatedFromMessageID      string         `json:"created_from_message_id"`
	LatestRunID               string         `json:"latest_run_id"`
	OwnerUserID               string         `json:"owner_user_id"`
	SourceChannel             string         `json:"source_channel"`
	RiskLevel                 string         `json:"risk_level"`
	ProgressPercent           int            `json:"progress_percent"`
	CurrentStepID             string         `json:"current_step_id"`
	Summary                   string         `json:"summary"`
	Metadata                  map[string]any `json:"metadata"`
	CreatedAt                 time.Time      `json:"created_at"`
	UpdatedAt                 time.Time      `json:"updated_at"`
	CompletedAt               *time.Time     `json:"completed_at,omitempty"`
}

type ProductTaskStep struct {
	ID             string         `json:"id"`
	ProductTaskID  string         `json:"product_task_id"`
	Title          string         `json:"title"`
	Description    string         `json:"description"`
	Status         string         `json:"status"`
	SortOrder      int            `json:"sort_order"`
	CapabilityID   string         `json:"capability_id"`
	ToolWorkflowID string         `json:"tool_workflow_id"`
	RunID          string         `json:"run_id"`
	ToolRunID      string         `json:"tool_run_id"`
	WorkerTaskID   string         `json:"worker_task_id"`
	Summary        string         `json:"summary"`
	Input          map[string]any `json:"input"`
	Output         map[string]any `json:"output"`
	Error          map[string]any `json:"error,omitempty"`
	StartedAt      *time.Time     `json:"started_at,omitempty"`
	FinishedAt     *time.Time     `json:"finished_at,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

type ProductTaskDetail struct {
	Task         ProductTask       `json:"task"`
	Steps        []ProductTaskStep `json:"steps"`
	Deliverables []ArtifactSummary `json:"deliverables"`
}

type ProductTaskListResponse struct {
	Tasks []ProductTask `json:"tasks"`
}

type CreateProductTaskRequest struct {
	Title                     string                   `json:"title"`
	Description               string                   `json:"description"`
	Status                    string                   `json:"status"`
	Mode                      string                   `json:"mode"`
	Priority                  string                   `json:"priority"`
	CreatedFromConversationID string                   `json:"created_from_conversation_id"`
	CreatedFromMessageID      string                   `json:"created_from_message_id"`
	LatestRunID               string                   `json:"latest_run_id"`
	OwnerUserID               string                   `json:"owner_user_id"`
	SourceChannel             string                   `json:"source_channel"`
	RiskLevel                 string                   `json:"risk_level"`
	Summary                   string                   `json:"summary"`
	Metadata                  map[string]any           `json:"metadata"`
	Steps                     []ProductTaskStepRequest `json:"steps"`
}

type ProductTaskStepRequest struct {
	ID             string         `json:"id"`
	ProductTaskID  string         `json:"product_task_id"`
	Title          string         `json:"title"`
	Description    string         `json:"description"`
	Status         string         `json:"status"`
	SortOrder      int            `json:"sort_order"`
	CapabilityID   string         `json:"capability_id"`
	ToolWorkflowID string         `json:"tool_workflow_id"`
	RunID          string         `json:"run_id"`
	ToolRunID      string         `json:"tool_run_id"`
	WorkerTaskID   string         `json:"worker_task_id"`
	Summary        string         `json:"summary"`
	Input          map[string]any `json:"input"`
	Output         map[string]any `json:"output"`
	Error          map[string]any `json:"error"`
}

type productTaskPlan struct {
	Title         string
	Description   string
	Priority      string
	RiskLevel     string
	Steps         []ProductTaskStepRequest
	ArtifactType  string
	ArtifactTitle string
}

type queryContextRunner interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

type queryRowContextRunner interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (a *AppCore) ListProductTasks(ctx context.Context, filter ProductTaskFilter) (*ProductTaskListResponse, error) {
	if err := a.requireSQLiteProductAPI(); err != nil {
		return nil, err
	}
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	status := strings.TrimSpace(filter.Status)
	args := []any{}
	where := ""
	if status == "active" {
		where = "WHERE status IN ('planning','running','waiting_confirmation','blocked')"
	} else if status != "" {
		where = "WHERE status=?"
		args = append(args, status)
	}
	query := fmt.Sprintf(`
		SELECT id, title, description, status, mode, priority, COALESCE(created_from_conversation_id, ''),
		       COALESCE(created_from_message_id, ''), COALESCE(latest_run_id, ''), owner_user_id,
		       source_channel, risk_level, progress_percent, COALESCE(current_step_id, ''), summary,
		       metadata, created_at, updated_at, completed_at
		FROM product_tasks
		%s
		ORDER BY updated_at DESC, created_at DESC
		LIMIT ?
	`, where)
	args = append(args, limit)
	rows, err := a.db.SQL().QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tasks, err := scanProductTasks(rows)
	if err != nil {
		return nil, err
	}
	return &ProductTaskListResponse{Tasks: tasks}, rows.Err()
}

func (a *AppCore) GetProductTask(ctx context.Context, id string) (*ProductTaskDetail, error) {
	if err := a.requireSQLiteProductAPI(); err != nil {
		return nil, err
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, errors.New("product_task id is required")
	}
	task, err := getProductTask(ctx, a.db.SQL(), id)
	if err != nil {
		return nil, err
	}
	steps, err := listProductTaskSteps(ctx, a.db.SQL(), id)
	if err != nil {
		return nil, err
	}
	deliverables, err := listArtifactSummaries(ctx, a.db.SQL(), ArtifactFilter{ProductTaskID: id, Limit: 100})
	if err != nil {
		return nil, err
	}
	return &ProductTaskDetail{Task: task, Steps: steps, Deliverables: deliverables}, nil
}

func (a *AppCore) CreateProductTask(ctx context.Context, req CreateProductTaskRequest) (*ProductTask, error) {
	if err := a.requireSQLiteProductAPI(); err != nil {
		return nil, err
	}
	tx, err := a.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	task, err := createProductTaskTx(ctx, tx, req)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return task, nil
}

func (a *AppCore) UpdateProductTaskStatus(ctx context.Context, id string, status string) error {
	if err := a.requireSQLiteProductAPI(); err != nil {
		return err
	}
	id = strings.TrimSpace(id)
	status = normalizeProductTaskStatus(status)
	if id == "" {
		return errors.New("product_task id is required")
	}
	completedExpr := "completed_at"
	if status == "completed" || status == "completed_with_limitations" {
		completedExpr = "datetime('now')"
	}
	result, err := a.db.SQL().ExecContext(ctx, fmt.Sprintf(`UPDATE product_tasks SET status=?, completed_at=%s, updated_at=datetime('now') WHERE id=?`, completedExpr), status, id)
	return requireRowsAffected(result, err, "product task not found")
}

func (a *AppCore) UpsertProductTaskStep(ctx context.Context, req ProductTaskStepRequest) (*ProductTaskStep, error) {
	if err := a.requireSQLiteProductAPI(); err != nil {
		return nil, err
	}
	tx, err := a.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	stepID, err := upsertProductTaskStepTx(ctx, tx, req)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	steps, err := listProductTaskSteps(ctx, a.db.SQL(), req.ProductTaskID)
	if err != nil {
		return nil, err
	}
	for _, step := range steps {
		if step.ID == stepID {
			return &step, nil
		}
	}
	return nil, sql.ErrNoRows
}

func (a *AppCore) requireSQLiteProductAPI() error {
	if a.db == nil {
		return errors.New("appcore db is not available")
	}
	if !a.isSQLite() {
		return errors.New("product task desktop APIs are implemented for SQLite desktop mode")
	}
	return nil
}

func createProductTaskTx(ctx context.Context, tx *sql.Tx, req CreateProductTaskRequest) (*ProductTask, error) {
	taskID, err := store.NewID("ptask_")
	if err != nil {
		return nil, err
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = truncate(req.Description, 80)
	}
	if title == "" {
		title = "未命名任务"
	}
	status := normalizeProductTaskStatus(req.Status)
	mode := normalizeInputMode(req.Mode)
	if mode == "" || mode == "auto" || mode == "chat_assist" {
		mode = "serious_task"
	}
	metadata := req.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["schema"] = "product_task_v0"
	_, err = tx.ExecContext(ctx, `
		INSERT INTO product_tasks (id, title, description, status, mode, priority, created_from_conversation_id,
			created_from_message_id, latest_run_id, owner_user_id, source_channel, risk_level, progress_percent,
			summary, metadata, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?, datetime('now'))
	`, taskID, title, req.Description, status, mode, valueOrDefault(req.Priority, "normal"), req.CreatedFromConversationID, req.CreatedFromMessageID, req.LatestRunID, valueOrDefault(req.OwnerUserID, "default_user"), valueOrDefault(req.SourceChannel, "desktop"), valueOrDefault(req.RiskLevel, "read_only"), initialProgressForStatus(status), req.Summary, mustJSON(metadata))
	if err != nil {
		return nil, err
	}
	for index, step := range req.Steps {
		step.ProductTaskID = taskID
		if step.SortOrder == 0 {
			step.SortOrder = index + 1
		}
		if _, err := upsertProductTaskStepTx(ctx, tx, step); err != nil {
			return nil, err
		}
	}
	if req.LatestRunID != "" {
		if err := updateRunMetadataTx(ctx, tx, req.LatestRunID, map[string]any{"product_task_id": taskID}); err != nil {
			return nil, err
		}
	}
	task, err := getProductTask(ctx, tx, taskID)
	if err != nil {
		return nil, err
	}
	return &task, nil
}

func upsertProductTaskStepTx(ctx context.Context, tx *sql.Tx, req ProductTaskStepRequest) (string, error) {
	if strings.TrimSpace(req.ProductTaskID) == "" {
		return "", errors.New("product_task_id is required")
	}
	stepID := strings.TrimSpace(req.ID)
	var err error
	if stepID == "" {
		stepID, err = store.NewID("pstep_")
		if err != nil {
			return "", err
		}
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "执行步骤"
	}
	status := normalizeProductTaskStepStatus(req.Status)
	input := req.Input
	if input == nil {
		input = map[string]any{}
	}
	output := req.Output
	if output == nil {
		output = map[string]any{}
	}
	errorRaw := any(nil)
	if len(req.Error) > 0 {
		errorRaw = mustJSON(req.Error)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO product_task_steps (id, product_task_id, title, description, status, sort_order, capability_id,
			tool_workflow_id, run_id, tool_run_id, worker_task_id, summary, input, output, error, started_at,
			finished_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''),
			?, ?, ?, ?, CASE WHEN ?='running' THEN datetime('now') ELSE NULL END,
			CASE WHEN ? IN ('done','failed','skipped','blocked') THEN datetime('now') ELSE NULL END, datetime('now'))
		ON CONFLICT(id) DO UPDATE SET
			title=excluded.title,
			description=excluded.description,
			status=excluded.status,
			sort_order=excluded.sort_order,
			capability_id=excluded.capability_id,
			tool_workflow_id=excluded.tool_workflow_id,
			run_id=excluded.run_id,
			tool_run_id=excluded.tool_run_id,
			worker_task_id=excluded.worker_task_id,
			summary=excluded.summary,
			input=excluded.input,
			output=excluded.output,
			error=excluded.error,
			started_at=COALESCE(product_task_steps.started_at, excluded.started_at),
			finished_at=COALESCE(excluded.finished_at, product_task_steps.finished_at),
			updated_at=datetime('now')
	`, stepID, req.ProductTaskID, title, req.Description, status, req.SortOrder, req.CapabilityID, req.ToolWorkflowID, req.RunID, req.ToolRunID, req.WorkerTaskID, req.Summary, mustJSON(input), mustJSON(output), errorRaw, status, status)
	if err != nil {
		return "", err
	}
	return stepID, nil
}

func startProductTaskStepForCapabilityTx(ctx context.Context, tx *sql.Tx, productTaskID string, runID string, capability string, goal string, input map[string]any) (string, error) {
	if strings.TrimSpace(productTaskID) == "" {
		return "", nil
	}
	var stepID string
	err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM product_task_steps
		WHERE product_task_id=?
		  AND status IN ('pending','running')
		  AND (capability_id=? OR capability_id IS NULL OR capability_id='')
		ORDER BY sort_order ASC, created_at ASC
		LIMIT 1
	`, productTaskID, capability).Scan(&stepID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	if errors.Is(err, sql.ErrNoRows) {
		stepID, err = store.NewID("pstep_")
		if err != nil {
			return "", err
		}
		var maxOrder int
		_ = tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(sort_order), 0) FROM product_task_steps WHERE product_task_id=?`, productTaskID).Scan(&maxOrder)
		title := strings.TrimSpace(goal)
		if title == "" {
			title = fmt.Sprintf("执行 %s", capability)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO product_task_steps (id, product_task_id, title, status, sort_order, capability_id, run_id, input, started_at, updated_at)
			VALUES (?, ?, ?, 'running', ?, NULLIF(?, ''), NULLIF(?, ''), ?, datetime('now'), datetime('now'))
		`, stepID, productTaskID, title, maxOrder+1, capability, runID, mustJSON(input)); err != nil {
			return "", err
		}
	} else {
		if _, err := tx.ExecContext(ctx, `
			UPDATE product_task_steps
			SET status='running', capability_id=NULLIF(?, ''), run_id=NULLIF(?, ''), input=?, started_at=COALESCE(started_at, datetime('now')), updated_at=datetime('now')
			WHERE id=?
		`, capability, runID, mustJSON(input), stepID); err != nil {
			return "", err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE product_tasks
		SET status='running', latest_run_id=NULLIF(?, ''), current_step_id=?, progress_percent=MAX(progress_percent, 20), updated_at=datetime('now')
		WHERE id=?
	`, runID, stepID, productTaskID); err != nil {
		return "", err
	}
	if _, err := insertSQLiteRunStep(ctx, tx, runID, "product_task_step_started", "Product task step started", map[string]any{"product_task_id": productTaskID, "capability": capability}, map[string]any{"product_task_step_id": stepID}); err != nil {
		return "", err
	}
	return stepID, nil
}

func completeProductTaskStepTx(ctx context.Context, tx *sql.Tx, productTaskID string, stepID string, status string, toolRunID string, workerTaskID string, output map[string]any, summary string) error {
	if strings.TrimSpace(productTaskID) == "" || strings.TrimSpace(stepID) == "" {
		return nil
	}
	status = normalizeProductTaskStepStatus(status)
	if output == nil {
		output = map[string]any{}
	}
	_, err := tx.ExecContext(ctx, `
		UPDATE product_task_steps
		SET status=?, tool_run_id=NULLIF(?, ''), worker_task_id=NULLIF(?, ''), output=?, summary=?, finished_at=CASE WHEN ? IN ('done','failed','skipped','blocked') THEN datetime('now') ELSE finished_at END, updated_at=datetime('now')
		WHERE id=? AND product_task_id=?
	`, status, toolRunID, workerTaskID, mustJSON(output), summary, status, stepID, productTaskID)
	if err != nil {
		return err
	}
	progress := 60
	if status == "done" {
		progress = 70
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE product_tasks
		SET progress_percent=MAX(progress_percent, ?), updated_at=datetime('now')
		WHERE id=?
	`, progress, productTaskID); err != nil {
		return err
	}
	return nil
}

func completeProductTaskWithArtifactTx(ctx context.Context, tx *sql.Tx, productTaskID string, runID string, conversationID string, messageID string, plan productTaskPlan, response string) (*ArtifactSummary, error) {
	if strings.TrimSpace(productTaskID) == "" {
		return nil, nil
	}
	steps, err := listProductTaskSteps(ctx, tx, productTaskID)
	if err != nil {
		return nil, err
	}
	task := ProductTask{ID: productTaskID, Title: plan.Title, Description: plan.Description, RiskLevel: plan.RiskLevel, LatestRunID: runID}
	for _, step := range steps {
		if step.Status == "pending" || step.Status == "running" {
			summary, output := productTaskStepNarrative(task, step)
			if err := completeProductTaskStepTx(ctx, tx, productTaskID, step.ID, "done", step.ToolRunID, step.WorkerTaskID, output, summary); err != nil {
				return nil, err
			}
			if _, err := insertSQLiteRunStep(ctx, tx, runID, "product_task_step_completed", "Product task step completed", map[string]any{"product_task_id": productTaskID, "product_task_step_id": step.ID}, map[string]any{"status": "done"}); err != nil {
				return nil, err
			}
		} else if strings.TrimSpace(step.Summary) == "" || len(step.Output) == 0 {
			summary, output := productTaskStepNarrative(task, step)
			if err := updateProductTaskStepNarrativeTx(ctx, tx, step.ID, summary, output); err != nil {
				return nil, err
			}
		}
	}
	steps, err = listProductTaskSteps(ctx, tx, productTaskID)
	if err != nil {
		return nil, err
	}
	artifactTitle := firstNonEmpty(plan.ArtifactTitle, "任务交付报告")
	ledger := buildEvidenceLedger(steps, response)
	safeResponse := evidenceSafeTaskResponse(plan, response, ledger)
	content := appendEvidenceLedgerSection(buildTaskArtifactContent(plan, safeResponse, steps, ledger), ledger)
	artifact, err := createArtifactTx(ctx, tx, CreateArtifactRequest{
		Type:                 valueOrDefault(plan.ArtifactType, "report"),
		Title:                artifactTitle,
		Content:              content,
		ContentFormat:        "markdown",
		SourceProductTaskID:  productTaskID,
		SourceRunID:          runID,
		SourceConversationID: conversationID,
		SourceMessageID:      messageID,
		Metadata:             map[string]any{"source": "send_chat_serious_task", "artifact_schema": "task_artifact_v0", "evidence_ledger": ledger, "evidence_refs": ledger.Refs},
	})
	if err != nil {
		return nil, err
	}
	status := "completed"
	if len(ledger.Limitations) > 0 {
		status = "completed_with_limitations"
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE product_tasks
		SET status=?, latest_run_id=NULLIF(?, ''), progress_percent=100, summary=?, completed_at=datetime('now'), updated_at=datetime('now')
		WHERE id=?
	`, status, runID, truncate(taskSummaryForCompletion(plan, safeResponse, ledger), 240), productTaskID); err != nil {
		return nil, err
	}
	if _, err := insertSQLiteRunStep(ctx, tx, runID, "evidence_ledger_created", "Evidence ledger created", map[string]any{"product_task_id": productTaskID}, map[string]any{"evidence_refs": len(ledger.Refs), "limitations": ledger.Limitations, "task_status": status}); err != nil {
		return nil, err
	}
	if _, err := insertSQLiteRunStep(ctx, tx, runID, "artifact_created", "Artifact created", map[string]any{"product_task_id": productTaskID}, map[string]any{"artifact_id": artifact.ID, "type": artifact.Type, "title": artifact.Title}); err != nil {
		return nil, err
	}
	return artifact, nil
}

func markProductTaskQueuedTx(ctx context.Context, tx *sql.Tx, productTaskID string, runID string) error {
	if productTaskID == "" {
		return nil
	}
	_, err := tx.ExecContext(ctx, `
		UPDATE product_tasks
		SET status='running', latest_run_id=NULLIF(?, ''), progress_percent=MAX(progress_percent, 40), updated_at=datetime('now')
		WHERE id=?
	`, runID, productTaskID)
	return err
}

func getProductTask(ctx context.Context, runner queryRowContextRunner, id string) (ProductTask, error) {
	var task ProductTask
	var createdFromConversationID, createdFromMessageID, latestRunID, currentStepID sql.NullString
	var metadataRaw, createdAt, updatedAt string
	var completedAt sql.NullString
	err := runner.QueryRowContext(ctx, `
		SELECT id, title, description, status, mode, priority, created_from_conversation_id, created_from_message_id,
		       latest_run_id, owner_user_id, source_channel, risk_level, progress_percent, current_step_id,
		       summary, metadata, created_at, updated_at, completed_at
		FROM product_tasks
		WHERE id=?
	`, id).Scan(&task.ID, &task.Title, &task.Description, &task.Status, &task.Mode, &task.Priority, &createdFromConversationID, &createdFromMessageID, &latestRunID, &task.OwnerUserID, &task.SourceChannel, &task.RiskLevel, &task.ProgressPercent, &currentStepID, &task.Summary, &metadataRaw, &createdAt, &updatedAt, &completedAt)
	if err != nil {
		return ProductTask{}, err
	}
	task.CreatedFromConversationID = createdFromConversationID.String
	task.CreatedFromMessageID = createdFromMessageID.String
	task.LatestRunID = latestRunID.String
	task.CurrentStepID = currentStepID.String
	task.Metadata = decodeObject([]byte(metadataRaw))
	task.CreatedAt = parseSQLiteTime(createdAt)
	task.UpdatedAt = parseSQLiteTime(updatedAt)
	if completedAt.Valid {
		t := parseSQLiteTime(completedAt.String)
		task.CompletedAt = &t
	}
	return task, nil
}

func listProductTaskSteps(ctx context.Context, runner queryContextRunner, productTaskID string) ([]ProductTaskStep, error) {
	rows, err := runner.QueryContext(ctx, `
		SELECT id, product_task_id, title, description, status, sort_order, COALESCE(capability_id, ''),
		       COALESCE(tool_workflow_id, ''), COALESCE(run_id, ''), COALESCE(tool_run_id, ''), COALESCE(worker_task_id, ''),
		       summary, input, output, COALESCE(error, ''), started_at, finished_at, created_at, updated_at
		FROM product_task_steps
		WHERE product_task_id=?
		ORDER BY sort_order ASC, created_at ASC
	`, productTaskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	steps := []ProductTaskStep{}
	for rows.Next() {
		step, err := scanProductTaskStep(rows)
		if err != nil {
			return nil, err
		}
		steps = append(steps, step)
	}
	return steps, rows.Err()
}

func scanProductTasks(rows *sql.Rows) ([]ProductTask, error) {
	tasks := []ProductTask{}
	for rows.Next() {
		var task ProductTask
		var createdFromConversationID, createdFromMessageID, latestRunID, currentStepID sql.NullString
		var metadataRaw, createdAt, updatedAt string
		var completedAt sql.NullString
		if err := rows.Scan(&task.ID, &task.Title, &task.Description, &task.Status, &task.Mode, &task.Priority, &createdFromConversationID, &createdFromMessageID, &latestRunID, &task.OwnerUserID, &task.SourceChannel, &task.RiskLevel, &task.ProgressPercent, &currentStepID, &task.Summary, &metadataRaw, &createdAt, &updatedAt, &completedAt); err != nil {
			return nil, err
		}
		task.CreatedFromConversationID = createdFromConversationID.String
		task.CreatedFromMessageID = createdFromMessageID.String
		task.LatestRunID = latestRunID.String
		task.CurrentStepID = currentStepID.String
		task.Metadata = decodeObject([]byte(metadataRaw))
		task.CreatedAt = parseSQLiteTime(createdAt)
		task.UpdatedAt = parseSQLiteTime(updatedAt)
		if completedAt.Valid {
			t := parseSQLiteTime(completedAt.String)
			task.CompletedAt = &t
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func scanProductTaskStep(rows *sql.Rows) (ProductTaskStep, error) {
	var step ProductTaskStep
	var inputRaw, outputRaw, errorRaw, createdAt, updatedAt string
	var startedAt, finishedAt sql.NullString
	err := rows.Scan(&step.ID, &step.ProductTaskID, &step.Title, &step.Description, &step.Status, &step.SortOrder, &step.CapabilityID, &step.ToolWorkflowID, &step.RunID, &step.ToolRunID, &step.WorkerTaskID, &step.Summary, &inputRaw, &outputRaw, &errorRaw, &startedAt, &finishedAt, &createdAt, &updatedAt)
	if err != nil {
		return ProductTaskStep{}, err
	}
	step.Input = decodeObject([]byte(inputRaw))
	step.Output = decodeObject([]byte(outputRaw))
	step.Error = decodeObject([]byte(errorRaw))
	if startedAt.Valid {
		t := parseSQLiteTime(startedAt.String)
		step.StartedAt = &t
	}
	if finishedAt.Valid {
		t := parseSQLiteTime(finishedAt.String)
		step.FinishedAt = &t
	}
	step.CreatedAt = parseSQLiteTime(createdAt)
	step.UpdatedAt = parseSQLiteTime(updatedAt)
	return step, nil
}

func inferProductTaskPlan(message string) productTaskPlan {
	title := truncate(strings.TrimSpace(message), 64)
	title = strings.Trim(title, "。.!?？")
	if title == "" {
		title = "执行用户任务"
	}
	if strings.HasPrefix(title, "帮我") {
		title = strings.TrimSpace(strings.TrimPrefix(title, "帮我"))
	}
	if strings.HasPrefix(title, "请") {
		title = strings.TrimSpace(strings.TrimPrefix(title, "请"))
	}
	artifactType := "summary"
	if containsAnyText(message, []string{"报告", "分析", "调研", "差距", "总结"}) {
		artifactType = "report"
	}
	if strings.Contains(message, "计划") || strings.Contains(strings.ToLower(message), "plan") || strings.Contains(message, "spec") {
		artifactType = "plan"
	}
	steps := []ProductTaskStepRequest{
		{Title: "理解目标与约束", Description: "确认用户输入、模式、风险级别和可交付结果。", Status: "pending", SortOrder: 1},
		{Title: "整理上下文与证据", Description: "召回相关记忆、检查可用上下文，并保持 Run Trace 可追溯。", Status: "pending", SortOrder: 2},
		{Title: "执行分析或工具流程", Description: "通过 Capability/Tool Workflow 执行必要的只读流程。", Status: "pending", SortOrder: 3},
		{Title: "产出交付物", Description: "形成报告、方案、摘要或 diff，并关联来源 run。", Status: "pending", SortOrder: 4},
	}
	if containsAnyText(message, []string{"改代码", "实现", "部署", "删除", "写入"}) {
		steps = append(steps[:3], ProductTaskStepRequest{Title: "等待高风险确认", Description: "涉及状态变更时先生成确认请求，不直接执行破坏性操作。", Status: "pending", SortOrder: 4}, ProductTaskStepRequest{Title: "产出交付物", Description: "形成可审计结果。", Status: "pending", SortOrder: 5})
	}
	return productTaskPlan{
		Title:         title,
		Description:   message,
		Priority:      "normal",
		RiskLevel:     inferRiskLevel(message),
		Steps:         steps,
		ArtifactType:  artifactType,
		ArtifactTitle: title + " - 交付物",
	}
}

func updateProductTaskStepNarrativeTx(ctx context.Context, tx *sql.Tx, stepID string, summary string, output map[string]any) error {
	if strings.TrimSpace(stepID) == "" {
		return nil
	}
	_, err := tx.ExecContext(ctx, `
		UPDATE product_task_steps
		SET summary=?, output=?, updated_at=datetime('now')
		WHERE id=?
	`, summary, mustJSON(output), stepID)
	return err
}

func productTaskStepNarrative(task ProductTask, step ProductTaskStep) (string, map[string]any) {
	output := map[string]any{}
	for key, value := range step.Output {
		output[key] = value
	}
	output["source"] = "desktop_task_narrative"
	output["task_id"] = task.ID
	output["step_title"] = step.Title
	if strings.TrimSpace(step.CapabilityID) == "" && strings.TrimSpace(step.ToolRunID) == "" {
		output["evidence_status"] = "no_tool_evidence"
		output["limitation"] = "本步骤没有关联 workspace_search、file_analyze 或 tool_run 证据。"
	}
	title := step.Title
	switch {
	case strings.Contains(title, "理解目标"):
		return firstNonEmpty(step.Summary, "确认了用户目标、严肃任务模式、风险等级和预期交付物；输入来源是本轮用户消息。"), output
	case strings.Contains(title, "上下文") || strings.Contains(title, "证据"):
		return firstNonEmpty(step.Summary, "检查了可用记忆、Active Context 和 Run Trace 上下文；当前没有可引用的 workspace_search/file_analyze/tool_run 证据。"), output
	case strings.Contains(title, "执行"):
		return firstNonEmpty(step.Summary, "未执行修改性工具；没有工具证据时只产出待验证判断，不编造业务指标或文件结论。"), output
	case strings.Contains(title, "交付"):
		return firstNonEmpty(step.Summary, "生成 Artifact，并把证据引用和限制写入 evidence_ledger，便于后续审计。"), output
	default:
		return firstNonEmpty(step.Summary, "记录了该步骤的输入、输出和限制；没有证据时按待验证判断处理。"), output
	}
}

func taskSummaryForCompletion(plan productTaskPlan, response string, ledger EvidenceLedger) string {
	if len(ledger.Limitations) > 0 {
		return firstNonEmpty(plan.Title, "任务已完成") + "；已生成交付物，但存在证据限制。"
	}
	return firstNonEmpty(response, plan.Title, "任务已完成")
}

func sanitizeSeriousTaskRuntimeResponseTx(ctx context.Context, tx *sql.Tx, productTaskID string, runID string, plan productTaskPlan, response string) (string, *store.RunStepBrief, bool, error) {
	steps, err := listProductTaskSteps(ctx, tx, productTaskID)
	if err != nil {
		return response, nil, false, err
	}
	ledger := buildEvidenceLedger(steps, response)
	safeResponse := evidenceSafeTaskResponse(plan, response, ledger)
	if strings.TrimSpace(safeResponse) == strings.TrimSpace(response) {
		return response, nil, false, nil
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE run_steps
		SET output=json_set(COALESCE(NULLIF(output, ''), '{}'), '$.response', ?)
		WHERE run_id=?
		  AND step_type IN ('agent_call_finished', 'response_generated')
	`, safeResponse, runID); err != nil {
		return response, nil, false, err
	}
	if err := finalizeSQLiteRun(ctx, tx, runID, "succeeded", safeResponse); err != nil {
		return response, nil, false, err
	}
	brief, err := insertSQLiteRunStep(ctx, tx, runID, "response_evidence_sanitized", "Unsupported numeric claims removed from response", map[string]any{"product_task_id": productTaskID}, map[string]any{"reason": "unsupported_numeric_claims_without_evidence", "response": safeResponse})
	if err != nil {
		return response, nil, false, err
	}
	return safeResponse, &brief, true, nil
}

func buildTaskArtifactContent(plan productTaskPlan, response string, steps []ProductTaskStep, ledger EvidenceLedger) string {
	var builder strings.Builder
	builder.WriteString("# ")
	builder.WriteString(firstNonEmpty(plan.ArtifactTitle, plan.Title, "任务交付物"))
	builder.WriteString("\n\n")
	if plan.Description != "" {
		builder.WriteString("## 目标\n\n")
		builder.WriteString(plan.Description)
		builder.WriteString("\n\n")
	}
	builder.WriteString("## 结论\n\n")
	for _, item := range taskArtifactConclusions(plan, response, ledger) {
		builder.WriteString("- ")
		builder.WriteString(item)
		builder.WriteByte('\n')
	}
	builder.WriteByte('\n')
	builder.WriteString("## 行动项\n\n")
	for _, item := range taskArtifactActions(plan, ledger) {
		builder.WriteString("- ")
		builder.WriteString(item)
		builder.WriteByte('\n')
	}
	builder.WriteByte('\n')
	if len(steps) > 0 {
		builder.WriteString("## 执行记录\n\n")
		for _, step := range steps {
			builder.WriteString("- ")
			builder.WriteString(step.Title)
			summary := firstNonEmpty(step.Summary, step.Description)
			if summary != "" {
				builder.WriteString("：")
				builder.WriteString(summary)
			}
			builder.WriteByte('\n')
		}
		builder.WriteByte('\n')
	}
	if strings.TrimSpace(response) != "" && !isGenericRuntimeResponse(response) {
		builder.WriteString("## 原始回复摘要\n\n")
		builder.WriteString(strings.TrimSpace(evidenceSafeTaskResponse(plan, response, ledger)))
		builder.WriteString("\n")
	}
	return builder.String()
}

func evidenceSafeTaskResponse(plan productTaskPlan, response string, ledger EvidenceLedger) string {
	trimmed := strings.TrimSpace(response)
	if trimmed == "" {
		return ""
	}
	if !isTaskInappropriateRuntimeResponse(trimmed) && !hasUnsupportedNumericClaimsWithoutEvidence(trimmed, ledger) {
		return trimmed
	}
	if containsAnyText(plan.Title+" "+plan.Description+" "+trimmed, []string{"Joi", "产品问题", "优先改", "Memory", "Artifact"}) {
		return strings.TrimSpace(`我先按证据限制给判断，不写未验证周期、比例或得分：

- P0 先修 Memory Truth：确认记忆必须能被准确自述、召回，并写入 usage log。
- P0 再修 Task Evidence：严肃任务的步骤、证据、限制必须能被用户追问并看懂。
- P1 修 Artifact Usability：交付物离开聊天记录也要能读懂结论、依据、限制和下一步。

限制：本轮没有可引用的 workspace_search、file_analyze 或 tool_run 证据；任何实现周期、比例、得分都不能当作已验证事实。`)
	}
	return "原始回复包含无证据数字、比例或周期估算，已从交付物正文中移除。当前只能保留待验证判断；请先补充 evidence refs 或工具证据后再写具体数字。"
}

func isTaskInappropriateRuntimeResponse(response string) bool {
	return isGenericRuntimeResponse(response) || containsAnyText(response, []string{
		"已生成记忆候选",
		"等待 Memory OS",
		"写成长期记忆",
		"memory_write_proposal",
	})
}

func taskArtifactConclusions(plan productTaskPlan, response string, ledger EvidenceLedger) []string {
	text := plan.Title + " " + plan.Description + " " + response
	if containsAnyText(text, []string{"Joi", "产品问题", "优先改", "Memory", "Artifact"}) {
		prefix := ""
		if len(ledger.Refs) == 0 {
			prefix = "待验证判断："
		}
		return []string{
			prefix + "P0 先修 Memory Truth，确保已确认记忆能被准确自述、召回和写入 usage log。",
			prefix + "P0 再修 Task Evidence，让严肃任务的步骤、证据和限制能被用户追问并看懂。",
			prefix + "P1 修 Artifact Usability，让交付物离开聊天记录也能读懂结论、依据、限制和下一步。",
		}
	}
	if len(ledger.Refs) == 0 {
		return []string{
			"当前没有可引用工具证据；以下内容只能作为待验证判断。",
			"已建立任务、步骤、Run Trace 和 Artifact 的可追踪骨架。",
			"下一轮应优先补真实证据和可复核输出，而不是扩展新功能。",
		}
	}
	return []string{
		"任务已完成，并生成了带证据引用的交付物。",
		"关键依据已写入 evidence_ledger，可通过 Run Trace 继续审计。",
	}
}

func taskArtifactActions(plan productTaskPlan, ledger EvidenceLedger) []string {
	text := plan.Title + " " + plan.Description
	if containsAnyText(text, []string{"Joi", "产品问题", "优先改", "Memory", "Artifact"}) {
		return []string{
			"把 Memory 自述、确认、纠错和跨会话召回作为第一组回归用例。",
			"把 task step 的 summary/output/evidence/limitations 补齐到用户可读。",
			"把 Artifact Writer 调整为先给结论和行动项，再列证据与限制。",
		}
	}
	if len(ledger.Refs) == 0 {
		return []string{
			"先补证据来源；没有证据时保留待验证标记。",
			"把当前 Artifact 交给用户确认是否继续深化。",
		}
	}
	return []string{
		"根据 evidence refs 复核结论。",
		"把交付物改写成下一步执行清单。",
	}
}

func isGenericRuntimeResponse(response string) bool {
	return containsAnyText(response, []string{
		"这是通过 Agent Runtime JSON 输出解析后的回答",
		"当前链路已经经过 Prompt Assembly",
		"已生成记忆候选",
		"模型没有返回可展示内容",
	})
}

func updateRunMetadataTx(ctx context.Context, tx *sql.Tx, runID string, patch map[string]any) error {
	if strings.TrimSpace(runID) == "" || len(patch) == 0 {
		return nil
	}
	var raw string
	if err := tx.QueryRowContext(ctx, `SELECT metadata FROM runs WHERE id=?`, runID).Scan(&raw); err != nil {
		return err
	}
	metadata := decodeObject([]byte(raw))
	for key, value := range patch {
		metadata[key] = value
	}
	_, err := tx.ExecContext(ctx, `UPDATE runs SET metadata=? WHERE id=?`, mustJSON(metadata), runID)
	return err
}

func normalizeProductTaskStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "planning", "running", "waiting_confirmation", "completed", "completed_with_limitations", "failed", "cancelled", "blocked":
		return strings.TrimSpace(status)
	default:
		return "planning"
	}
}

func normalizeProductTaskStepStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "pending", "running", "done", "failed", "skipped", "waiting_confirmation", "blocked":
		return strings.TrimSpace(status)
	default:
		return "pending"
	}
}

func initialProgressForStatus(status string) int {
	switch status {
	case "running":
		return 10
	case "completed", "completed_with_limitations":
		return 100
	default:
		return 0
	}
}

func inferRiskLevel(message string) string {
	if containsAnyText(strings.ToLower(message), []string{"delete", "remove", "restart", "stop", "rm ", "write", "deploy"}) || containsAnyText(message, []string{"删除", "重启", "停止", "写入", "部署", "改代码", "实现"}) {
		return "state_change"
	}
	return "read_only"
}
