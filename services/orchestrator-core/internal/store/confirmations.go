package store

import (
	"context"
	"database/sql"
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
	ApprovedBy      string         `json:"approved_by"`
	RejectedBy      string         `json:"rejected_by"`
	DecisionReason  string         `json:"decision_reason"`
	CreatedAt       time.Time      `json:"created_at"`
	DecidedAt       *time.Time     `json:"decided_at"`
}

func (db *DB) CreateConfirmationRequest(ctx context.Context, request CapabilityRequest) (*ConfirmationRequestRecord, error) {
	id, err := NewID("confirm_")
	if err != nil {
		return nil, err
	}
	_, err = db.sql.ExecContext(ctx, `
		INSERT INTO confirmation_requests (id, run_id, capability_id, requested_action, risk_level, input)
		VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6)
	`, id, request.RunID, request.Capability, request.Goal, request.Risk, mustJSON(request.Inputs))
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

func (db *DB) ListConfirmationRequests(ctx context.Context) ([]ConfirmationRequestRecord, error) {
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, COALESCE(run_id, ''), capability_id, requested_action, risk_level, status,
		       input, COALESCE(approved_by, ''), COALESCE(rejected_by, ''), COALESCE(decision_reason, ''),
		       created_at, decided_at
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
		if err := rows.Scan(&record.ID, &record.RunID, &record.CapabilityID, &record.RequestedAction, &record.RiskLevel, &record.Status, &inputRaw, &record.ApprovedBy, &record.RejectedBy, &record.DecisionReason, &record.CreatedAt, &decidedAt); err != nil {
			return nil, err
		}
		record.Input = decodeObject(inputRaw)
		record.DecidedAt = nullTimePtr(decidedAt)
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
