package turnruntime

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

var modelVisibleCapabilities = map[string]bool{
	"memory_search":       true,
	"workspace_search":    true,
	"file_read":           true,
	"file_analyze":        true,
	"apply_patch":         true,
	"shell_command":       true,
	"test_command":        true,
	"web_research":        true,
	"browser_observe":     true,
	"browser_navigate":    true,
	"browser_click":       true,
	"browser_type":        true,
	"computer_observe":    true,
	"system_health_check": true,
}

type workflowStepForSpec struct {
	Tool string `json:"tool"`
}

func BuildToolSpecs(ctx context.Context, db SQLStore, agentID string) ([]ToolSpec, error) {
	return BuildToolSpecsForRisk(ctx, db, agentID, "read_only")
}

func BuildToolSpecsForRisk(ctx context.Context, db SQLStore, agentID string, maxRisk string) ([]ToolSpec, error) {
	agentCapabilities, err := loadAgentCapabilities(ctx, db, agentID)
	if err != nil {
		return nil, err
	}
	maxRisk = normalizedSpecRisk(maxRisk)
	specs := []ToolSpec{}
	seen := map[string]bool{}
	for _, capability := range agentCapabilities {
		capability = store.CanonicalCapabilityName(strings.TrimSpace(capability))
		if capability == "" || seen[capability] || !modelVisibleCapabilities[capability] {
			continue
		}
		seen[capability] = true
		spec, ok, err := buildToolSpecForCapability(ctx, db, capability, maxRisk)
		if err != nil {
			return nil, err
		}
		if ok {
			specs = append(specs, spec)
		}
	}
	sort.SliceStable(specs, func(i, j int) bool {
		return specs[i].Name < specs[j].Name
	})
	return specs, nil
}

func loadAgentCapabilities(ctx context.Context, db SQLStore, agentID string) ([]string, error) {
	if strings.TrimSpace(agentID) == "" {
		return nil, nil
	}
	var raw string
	var enabled int
	if err := db.QueryRowContext(ctx, `
		SELECT capabilities, enabled
		FROM agents
		WHERE id=?
	`, agentID).Scan(&raw, &enabled); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if enabled == 0 {
		return nil, nil
	}
	items := []string{}
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return nil, fmt.Errorf("decode agent capabilities: %w", err)
	}
	return items, nil
}

func buildToolSpecForCapability(ctx context.Context, db SQLStore, capability string, maxRisk string) (ToolSpec, bool, error) {
	var name, description, riskLevel, inputSchemaRaw, metadataRaw string
	var enabled int
	if err := db.QueryRowContext(ctx, `
		SELECT name, description, risk_level, input_schema, metadata, enabled
		FROM capabilities
		WHERE id=?
	`, capability).Scan(&name, &description, &riskLevel, &inputSchemaRaw, &metadataRaw, &enabled); err != nil {
		if err == sql.ErrNoRows {
			return ToolSpec{}, false, nil
		}
		return ToolSpec{}, false, err
	}
	riskLevel = normalizedSpecRisk(riskLevel)
	if enabled == 0 || specRiskRank(riskLevel) > specRiskRank(maxRisk) {
		return ToolSpec{}, false, nil
	}
	if ok, err := capabilityWorkflowEnabled(ctx, db, capability); err != nil || !ok {
		return ToolSpec{}, false, err
	}
	parameters := toolParametersFromSchema(inputSchemaRaw, metadataRaw)
	if description == "" {
		description = name
	}
	return ToolSpec{
		Name:        capability,
		Description: description,
		Parameters:  parameters,
		Risk:        riskLevel,
		Capability:  capability,
	}, true, nil
}

func normalizedSpecRisk(risk string) string {
	risk = strings.ToLower(strings.TrimSpace(risk))
	switch risk {
	case "", "readonly":
		return "read_only"
	case "write", "workspace-write":
		return "workspace_write"
	case "browser-interaction", "browser_interaction", "interaction":
		return "browser_interaction"
	default:
		return risk
	}
}

func specRiskRank(risk string) int {
	switch normalizedSpecRisk(risk) {
	case "read_only":
		return 0
	case "write_candidate", "workspace_write":
		return 1
	case "browser_interaction":
		return 2
	case "state_change":
		return 3
	case "destructive":
		return 4
	case "unsafe":
		return 5
	default:
		return 6
	}
}

func capabilityWorkflowEnabled(ctx context.Context, db SQLStore, capability string) (bool, error) {
	var stepsRaw string
	if err := db.QueryRowContext(ctx, `
		SELECT steps
		FROM tool_workflows
		WHERE capability_id=? AND enabled=1
		ORDER BY version DESC, name ASC
		LIMIT 1
	`, capability).Scan(&stepsRaw); err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	steps := []workflowStepForSpec{}
	if err := json.Unmarshal([]byte(stepsRaw), &steps); err != nil {
		return false, fmt.Errorf("decode workflow steps: %w", err)
	}
	for _, step := range steps {
		if strings.TrimSpace(step.Tool) == "" {
			return false, nil
		}
		if ok, err := toolEnabled(ctx, db, step.Tool); err != nil || !ok {
			return false, err
		}
	}
	return true, nil
}

func toolEnabled(ctx context.Context, db SQLStore, toolID string) (bool, error) {
	var enabled int
	if err := db.QueryRowContext(ctx, `SELECT enabled FROM tools WHERE id=?`, toolID).Scan(&enabled); err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return enabled != 0, nil
}

func toolParametersFromSchema(inputSchemaRaw string, metadataRaw string) map[string]any {
	if schema := decodeJSONMap(inputSchemaRaw); len(schema) > 0 && !isEmptyObjectSchema(schema) {
		return schema
	}
	metadata := decodeJSONMap(metadataRaw)
	if schema := nestedJSONMap(metadata, "input_schema"); len(schema) > 0 {
		return schema
	}
	if contract := nestedJSONMap(metadata, "contract"); len(contract) > 0 {
		if schema := nestedJSONMap(contract, "input_schema"); len(schema) > 0 {
			return schema
		}
	}
	return map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false}
}

func decodeJSONMap(raw string) map[string]any {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return map[string]any{}
	}
	value := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return map[string]any{}
	}
	return value
}

func nestedJSONMap(source map[string]any, key string) map[string]any {
	raw, ok := source[key]
	if !ok || raw == nil {
		return map[string]any{}
	}
	bytes, err := json.Marshal(raw)
	if err != nil {
		return map[string]any{}
	}
	value := map[string]any{}
	if err := json.Unmarshal(bytes, &value); err != nil {
		return map[string]any{}
	}
	return value
}

func isEmptyObjectSchema(schema map[string]any) bool {
	if len(schema) == 0 {
		return true
	}
	if len(schema) == 1 {
		if typ, ok := schema["type"].(string); ok && typ == "object" {
			return true
		}
	}
	return false
}
