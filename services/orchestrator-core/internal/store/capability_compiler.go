package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type capabilityCompilerTx interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func CompileCapability(ctx context.Context, tx capabilityCompilerTx, request CapabilityRequest) (*CapabilityExecutionResult, error) {
	request.Type = valueOrDefault(request.Type, "capability_request")
	request.Capability = CanonicalCapabilityName(request.Capability)
	request.Risk = normalizedRisk(valueOrDefault(request.Risk, "read_only"))
	if request.Capability == "" {
		return nil, fmt.Errorf("capability is required")
	}
	semanticResult, err := ValidateCapabilityRequestWithRegistry(ctx, tx, request)
	if err != nil {
		return nil, err
	}
	if request.Risk == "destructive" || request.Risk == "unsafe" {
		return nil, ErrPolicyDenied
	}
	if request.Risk == "state_change" {
		_ = createCapabilityConfirmation(ctx, tx, request)
		return nil, ErrPolicyDenied
	}

	capabilityRisk, err := enabledCapabilityRisk(ctx, tx, request.Capability)
	if err != nil {
		return nil, err
	}
	if riskNeedsConfirmationOrReject(ctx, tx, request, capabilityRisk) {
		return nil, ErrPolicyDenied
	}

	workflow, workflowID, err := enabledWorkflow(ctx, tx, request.Capability)
	if err != nil {
		return nil, err
	}
	_ = workflowID
	if riskNeedsConfirmationOrReject(ctx, tx, request, workflow.RiskLevel) {
		return nil, ErrPolicyDenied
	}
	for _, step := range workflow.Steps {
		toolRisk, err := enabledToolRisk(ctx, tx, step.Tool)
		if err != nil {
			return nil, err
		}
		if step.RiskLevel == "" {
			step.RiskLevel = toolRisk
		}
		if riskNeedsConfirmationOrReject(ctx, tx, request, toolRisk) || riskNeedsConfirmationOrReject(ctx, tx, request, step.RiskLevel) {
			return nil, ErrPolicyDenied
		}
	}

	return &CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision: map[string]any{
			"risk":                request.Risk,
			"decision":            "allow",
			"reason":              "capability, semantic contract, workflow, and tools are enabled and within requested risk",
			"workflow_name":       workflow.WorkflowName,
			"semantic_validation": semanticResult,
		},
		Workflow: workflow,
	}, nil
}

func enabledCapabilityRisk(ctx context.Context, tx capabilityCompilerTx, capability string) (string, error) {
	var risk string
	var enabled bool
	err := tx.QueryRowContext(ctx, `SELECT risk_level, enabled FROM capabilities WHERE id=$1`, capability).Scan(&risk, &enabled)
	if errors.Is(err, sql.ErrNoRows) || !enabled {
		return "", ErrPolicyDenied
	}
	if err != nil {
		return "", err
	}
	return normalizedRisk(risk), nil
}

func enabledWorkflow(ctx context.Context, tx capabilityCompilerTx, capability string) (ToolWorkflow, string, error) {
	workflowName := defaultWorkflowName(capability)
	var id, name, risk string
	var stepsRaw []byte
	var enabled bool
	err := tx.QueryRowContext(ctx, `
		SELECT id, name, risk_level, steps, enabled
		FROM tool_workflows
		WHERE capability_id=$1 AND name=$2
		ORDER BY version DESC, updated_at DESC
		LIMIT 1
	`, capability, workflowName).Scan(&id, &name, &risk, &stepsRaw, &enabled)
	if errors.Is(err, sql.ErrNoRows) || !enabled {
		return ToolWorkflow{}, "", ErrPolicyDenied
	}
	if err != nil {
		return ToolWorkflow{}, "", err
	}
	steps := []ToolWorkflowStep{}
	if len(stepsRaw) > 0 && strings.TrimSpace(string(stepsRaw)) != "" {
		if err := json.Unmarshal(stepsRaw, &steps); err != nil {
			return ToolWorkflow{}, "", err
		}
	}
	for i := range steps {
		steps[i].Tool = strings.TrimSpace(steps[i].Tool)
		steps[i].RiskLevel = normalizedRisk(steps[i].RiskLevel)
	}
	return ToolWorkflow{WorkflowName: name, Capability: capability, RiskLevel: normalizedRisk(risk), Steps: steps}, id, nil
}

func enabledToolRisk(ctx context.Context, tx capabilityCompilerTx, tool string) (string, error) {
	if strings.TrimSpace(tool) == "" {
		return "", ErrPolicyDenied
	}
	var risk string
	var enabled bool
	err := tx.QueryRowContext(ctx, `SELECT risk_level, enabled FROM tools WHERE id=$1`, tool).Scan(&risk, &enabled)
	if errors.Is(err, sql.ErrNoRows) || !enabled {
		return "", ErrPolicyDenied
	}
	if err != nil {
		return "", err
	}
	return normalizedRisk(risk), nil
}

func createCapabilityConfirmation(ctx context.Context, tx capabilityCompilerTx, request CapabilityRequest) error {
	confirmationID, err := NewID("confirm_")
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO confirmation_requests (id, run_id, capability_id, requested_action, risk_level, input)
		VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6)
	`, confirmationID, request.RunID, request.Capability, request.Goal, request.Risk, mustJSON(SanitizeForTrace(request.Inputs)))
	return err
}

func riskNeedsConfirmationOrReject(ctx context.Context, tx capabilityCompilerTx, request CapabilityRequest, actualRisk string) bool {
	actualRisk = normalizedRisk(actualRisk)
	switch actualRisk {
	case "destructive", "unsafe":
		return true
	case "state_change":
		_ = createCapabilityConfirmation(ctx, tx, request)
		return true
	default:
		return riskRank(actualRisk) > riskRank(request.Risk)
	}
}

func defaultWorkflowName(capability string) string {
	switch CanonicalCapabilityName(capability) {
	case "web_research":
		return "web_research_v2"
	case "browser_read":
		return "browser_read_v1"
	default:
		return CanonicalCapabilityName(capability) + "_v1"
	}
}

func normalizedRisk(risk string) string {
	risk = strings.ToLower(strings.TrimSpace(risk))
	switch risk {
	case "", "readonly":
		return "read_only"
	default:
		return risk
	}
}

func riskRank(risk string) int {
	switch normalizedRisk(risk) {
	case "read_only":
		return 0
	case "write_candidate":
		return 1
	case "state_change":
		return 2
	case "destructive":
		return 3
	case "unsafe":
		return 4
	default:
		return 5
	}
}
