package store

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

type ConfirmationRequestRecord struct {
	ID              string         `json:"id"`
	RunID           string         `json:"run_id"`
	CapabilityID    string         `json:"capability_id"`
	RequestedAction string         `json:"requested_action"`
	RiskLevel       string         `json:"risk_level"`
	Status          string         `json:"status"`
	Input           map[string]any `json:"input"`
	CallID          string         `json:"call_id"`
	TurnID          string         `json:"turn_id"`
	ApprovalScope   string         `json:"approval_scope"`
	ApprovalKey     string         `json:"approval_key"`
	ApprovedBy      string         `json:"approved_by"`
	RejectedBy      string         `json:"rejected_by"`
	DecisionReason  string         `json:"decision_reason"`
	CreatedAt       time.Time      `json:"created_at"`
	DecidedAt       *time.Time     `json:"decided_at"`
	ResumedAt       *time.Time     `json:"resumed_at"`
}

func (db *DB) CreateConfirmationRequest(ctx context.Context, request CapabilityRequest) (*ConfirmationRequestRecord, error) {
	id, err := NewID("confirm_")
	if err != nil {
		return nil, err
	}
	_, err = db.sql.ExecContext(ctx, `
		INSERT INTO confirmation_requests (id, run_id, capability_id, requested_action, risk_level, input, call_id, turn_id, approval_scope, approval_key)
		VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, NULLIF($7, ''), NULLIF($8, ''), $9, $10)
	`, id, request.RunID, request.Capability, request.Goal, request.Risk, mustJSON(request.Inputs), request.CallID, request.TurnID, confirmationApprovalScope(request), confirmationApprovalKey(request))
	if err != nil {
		return nil, err
	}
	items, err := db.ListConfirmationRequests(ctx)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if item.ID == id {
			return &item, nil
		}
	}
	return nil, nil
}

func confirmationApprovalScope(request CapabilityRequest) string {
	scope := strings.TrimSpace(request.ApprovalScope)
	if scope == "" {
		return "once"
	}
	return scope
}

func confirmationApprovalKey(request CapabilityRequest) string {
	if key := strings.TrimSpace(request.ApprovalKey); key != "" {
		return key
	}
	if callID := strings.TrimSpace(request.CallID); callID != "" {
		return callID
	}
	return ""
}

func (db *DB) ListConfirmationRequests(ctx context.Context) ([]ConfirmationRequestRecord, error) {
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, COALESCE(run_id, ''), capability_id, requested_action, risk_level, status,
		       input, COALESCE(call_id, ''), COALESCE(turn_id, ''), COALESCE(approval_scope, 'once'),
		       COALESCE(approval_key, ''), COALESCE(approved_by, ''), COALESCE(rejected_by, ''),
		       COALESCE(decision_reason, ''), created_at, decided_at, resumed_at
		FROM confirmation_requests
		ORDER BY created_at DESC
		LIMIT 100
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	records := []ConfirmationRequestRecord{}
	for rows.Next() {
		var record ConfirmationRequestRecord
		var inputRaw []byte
		var decidedAt sql.NullTime
		var resumedAt sql.NullTime
		if err := rows.Scan(&record.ID, &record.RunID, &record.CapabilityID, &record.RequestedAction, &record.RiskLevel, &record.Status, &inputRaw, &record.CallID, &record.TurnID, &record.ApprovalScope, &record.ApprovalKey, &record.ApprovedBy, &record.RejectedBy, &record.DecisionReason, &record.CreatedAt, &decidedAt, &resumedAt); err != nil {
			return nil, err
		}
		record.Input = decodeObject(inputRaw)
		record.DecidedAt = nullTimePtr(decidedAt)
		record.ResumedAt = nullTimePtr(resumedAt)
		records = append(records, record)
	}
	return records, rows.Err()
}

func (db *DB) DecideConfirmationRequest(ctx context.Context, id string, approve bool, actor string, reason string) error {
	status := "rejected"
	approvedBy := ""
	rejectedBy := actor
	if approve {
		status = "approved"
		approvedBy = actor
		rejectedBy = ""
	}
	_, err := db.sql.ExecContext(ctx, `
		UPDATE confirmation_requests
		SET status=$2, approved_by=NULLIF($3, ''), rejected_by=NULLIF($4, ''), decision_reason=$5, decided_at=NOW()
		WHERE id=$1 AND status='pending'
	`, id, status, approvedBy, rejectedBy, reason)
	return err
}
