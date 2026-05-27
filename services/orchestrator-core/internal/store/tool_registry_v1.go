package store

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"time"
)

type MCPServerRecord struct {
	ID            string             `json:"id"`
	Name          string             `json:"name"`
	Transport     string             `json:"transport"`
	Command       string             `json:"command,omitempty"`
	Args          []string           `json:"args"`
	EnvSecretRefs map[string]string  `json:"env_secret_refs,omitempty"`
	Enabled       bool               `json:"enabled"`
	Status        string             `json:"status"`
	Trust         string             `json:"trust"`
	LastSyncAt    string             `json:"last_sync_at,omitempty"`
	LastSyncError string             `json:"last_sync_error,omitempty"`
	Tools         []MCPInventoryItem `json:"tools"`
	Resources     []MCPInventoryItem `json:"resources"`
	Prompts       []MCPInventoryItem `json:"prompts"`
	Metadata      map[string]any     `json:"metadata"`
}

type MCPServerRequest struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	Transport     string            `json:"transport"`
	Command       string            `json:"command"`
	Args          []string          `json:"args"`
	EnvSecretRefs map[string]string `json:"env_secret_refs"`
	Enabled       *bool             `json:"enabled,omitempty"`
	Metadata      map[string]any    `json:"metadata"`
}

type MCPInventoryItem struct {
	ID                  string         `json:"id"`
	ServerID            string         `json:"server_id"`
	Kind                string         `json:"kind"`
	Name                string         `json:"name"`
	Description         string         `json:"description"`
	Schema              map[string]any `json:"schema"`
	URI                 string         `json:"uri,omitempty"`
	MimeType            string         `json:"mime_type,omitempty"`
	Arguments           []string       `json:"arguments,omitempty"`
	WrappedCapabilityID string         `json:"wrapped_capability_id,omitempty"`
	Enabled             bool           `json:"enabled"`
	LastSeenAt          string         `json:"last_seen_at,omitempty"`
	Metadata            map[string]any `json:"metadata"`
}

type MCPWrapToolRequest struct {
	CapabilityID     string         `json:"capability_id"`
	Description      string         `json:"description"`
	IntentDomain     string         `json:"intent_domain"`
	PositiveExamples []string       `json:"positive_examples"`
	NegativeExamples []string       `json:"negative_examples"`
	InputSchema      map[string]any `json:"input_schema"`
	OutputSchema     map[string]any `json:"output_schema"`
	RiskLevel        string         `json:"risk_level"`
	PrivacyLevel     string         `json:"privacy_level"`
	UIVisibility     string         `json:"ui_visibility"`
	Enabled          *bool          `json:"enabled,omitempty"`
}

type SkillDefinition struct {
	ID                    string         `json:"id"`
	Version               string         `json:"version"`
	Name                  string         `json:"name"`
	Description           string         `json:"description"`
	TriggerPhrases        []string       `json:"trigger_phrases"`
	RequiredCapabilities  []string       `json:"required_capabilities"`
	ForbiddenCapabilities []string       `json:"forbidden_capabilities"`
	Prompt                string         `json:"prompt"`
	OutputContract        string         `json:"output_contract"`
	Enabled               bool           `json:"enabled"`
	Metadata              map[string]any `json:"metadata"`
	RecentRun             *SkillRun      `json:"recent_run,omitempty"`
}

type SkillRequest struct {
	ID                    string         `json:"id"`
	Version               string         `json:"version"`
	Name                  string         `json:"name"`
	Description           string         `json:"description"`
	TriggerPhrases        []string       `json:"trigger_phrases"`
	RequiredCapabilities  []string       `json:"required_capabilities"`
	ForbiddenCapabilities []string       `json:"forbidden_capabilities"`
	Prompt                string         `json:"prompt"`
	OutputContract        string         `json:"output_contract"`
	Enabled               *bool          `json:"enabled,omitempty"`
	Metadata              map[string]any `json:"metadata"`
}

type SkillPlan struct {
	OutputType         string              `json:"output_type"`
	Summary            string              `json:"summary"`
	Context            map[string]any      `json:"context"`
	CapabilityRequests []CapabilityRequest `json:"capability_requests"`
	Rejected           bool                `json:"rejected,omitempty"`
	RejectionReason    string              `json:"rejection_reason,omitempty"`
}

type SkillRun struct {
	ID                 string              `json:"id"`
	RunID              string              `json:"run_id,omitempty"`
	SkillID            string              `json:"skill_id"`
	Status             string              `json:"status"`
	Input              map[string]any      `json:"input"`
	OutputPlan         SkillPlan           `json:"output_plan"`
	CapabilityRequests []CapabilityRequest `json:"capability_requests"`
	RejectionReason    string              `json:"rejection_reason,omitempty"`
	CreatedAt          string              `json:"created_at,omitempty"`
	FinishedAt         string              `json:"finished_at,omitempty"`
}

type SkillTestRequest struct {
	Message string         `json:"message"`
	Context map[string]any `json:"context"`
}

type SkillTestResult struct {
	Skill SkillDefinition `json:"skill"`
	Plan  SkillPlan       `json:"plan"`
}

func (db *DB) ListMCPServers(ctx context.Context) ([]MCPServerRecord, error) {
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, name, transport, command, args, env_secret_refs, enabled, status, trust, COALESCE(last_sync_at, ''), last_sync_error, metadata
		FROM mcp_servers
		ORDER BY name ASC, id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	servers := []MCPServerRecord{}
	for rows.Next() {
		server, err := scanMCPServer(rows)
		if err != nil {
			return nil, err
		}
		servers = append(servers, server)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range servers {
		items, err := db.ListMCPInventory(ctx, servers[i].ID)
		if err != nil {
			return nil, err
		}
		attachMCPInventory(&servers[i], items)
	}
	return servers, nil
}

func (db *DB) GetMCPServer(ctx context.Context, id string) (MCPServerRecord, error) {
	row := db.sql.QueryRowContext(ctx, `
		SELECT id, name, transport, command, args, env_secret_refs, enabled, status, trust, COALESCE(last_sync_at, ''), last_sync_error, metadata
		FROM mcp_servers
		WHERE id=$1
	`, strings.TrimSpace(id))
	server, err := scanMCPServer(row)
	if err != nil {
		return MCPServerRecord{}, err
	}
	items, err := db.ListMCPInventory(ctx, server.ID)
	if err != nil {
		return MCPServerRecord{}, err
	}
	attachMCPInventory(&server, items)
	return server, nil
}

func (db *DB) SaveMCPServer(ctx context.Context, req MCPServerRequest) (MCPServerRecord, error) {
	id := safeRegistryID(firstNonEmpty(req.ID, req.Name), "mcp_server")
	if id == "" {
		return MCPServerRecord{}, errors.New("mcp server id or name is required")
	}
	name := valueOrDefault(strings.TrimSpace(req.Name), id)
	transport := valueOrDefault(strings.TrimSpace(req.Transport), "stdio")
	if transport != "stdio" && transport != "not_configured" {
		return MCPServerRecord{}, errors.New("mcp v1 only supports stdio transport")
	}
	enabled := false
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	metadata := req.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	_, err := db.sql.ExecContext(ctx, `
		INSERT INTO mcp_servers (id, name, transport, command, args, env_secret_refs, enabled, status, trust, metadata, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'inactive', 'untrusted_until_wrapped', $8, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET
			name=EXCLUDED.name,
			transport=EXCLUDED.transport,
			command=EXCLUDED.command,
			args=EXCLUDED.args,
			env_secret_refs=EXCLUDED.env_secret_refs,
			enabled=EXCLUDED.enabled,
			metadata=EXCLUDED.metadata,
			updated_at=CURRENT_TIMESTAMP
	`, id, name, transport, strings.TrimSpace(req.Command), mustJSON(req.Args), mustJSON(req.EnvSecretRefs), enabled, mustJSON(metadata))
	if err != nil {
		return MCPServerRecord{}, err
	}
	return db.GetMCPServer(ctx, id)
}

func (db *DB) ListMCPInventory(ctx context.Context, serverID string) ([]MCPInventoryItem, error) {
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, server_id, kind, name, description, schema, uri, mime_type, arguments, COALESCE(wrapped_capability_id, ''), enabled, COALESCE(last_seen_at, ''), metadata
		FROM mcp_inventory_items
		WHERE server_id=$1
		ORDER BY kind ASC, name ASC
	`, strings.TrimSpace(serverID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []MCPInventoryItem{}
	for rows.Next() {
		item, err := scanMCPInventoryItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (db *DB) SyncMCPServer(ctx context.Context, serverID string) (MCPServerRecord, error) {
	server, err := db.GetMCPServer(ctx, serverID)
	if err != nil {
		return MCPServerRecord{}, err
	}
	if strings.TrimSpace(server.Command) == "" || server.Transport == "not_configured" {
		return db.finishMCPSync(ctx, server.ID, "inactive", "no configured MCP transport", nil, map[string]any{"sync": "skipped"})
	}
	if server.Transport != "stdio" {
		return db.finishMCPSync(ctx, server.ID, "error", "mcp v1 only supports stdio transport", nil, map[string]any{"sync": "rejected"})
	}
	items, syncErr := syncMCPStdioInventory(ctx, server)
	if syncErr != nil {
		return db.finishMCPSync(ctx, server.ID, "error", syncErr.Error(), nil, map[string]any{"sync": "failed"})
	}
	return db.finishMCPSync(ctx, server.ID, "synced", "", items, map[string]any{"sync": "succeeded", "inventory_count": len(items)})
}

func (db *DB) finishMCPSync(ctx context.Context, serverID string, status string, syncError string, items []MCPInventoryItem, audit map[string]any) (MCPServerRecord, error) {
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return MCPServerRecord{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE mcp_servers SET status=$2, last_sync_error=$3, last_sync_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, serverID, status, syncError); err != nil {
		return MCPServerRecord{}, err
	}
	for _, item := range items {
		item.ServerID = serverID
		if item.ID == "" {
			item.ID = "mcpinv_" + hashTextForRegistry(serverID + "\n" + item.Kind + "\n" + item.Name)[:16]
		}
		if item.Schema == nil {
			item.Schema = map[string]any{}
		}
		if item.Metadata == nil {
			item.Metadata = map[string]any{}
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO mcp_inventory_items (id, server_id, kind, name, description, schema, uri, mime_type, arguments, enabled, last_seen_at, metadata, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, CURRENT_TIMESTAMP, $10, CURRENT_TIMESTAMP)
			ON CONFLICT(server_id, kind, name) DO UPDATE SET
				description=EXCLUDED.description,
				schema=EXCLUDED.schema,
				uri=EXCLUDED.uri,
				mime_type=EXCLUDED.mime_type,
				arguments=EXCLUDED.arguments,
				enabled=EXCLUDED.enabled,
				last_seen_at=CURRENT_TIMESTAMP,
				metadata=EXCLUDED.metadata,
				updated_at=CURRENT_TIMESTAMP
		`, item.ID, item.ServerID, item.Kind, item.Name, item.Description, mustJSON(item.Schema), item.URI, item.MimeType, mustJSON(item.Arguments), mustJSON(item.Metadata)); err != nil {
			return MCPServerRecord{}, err
		}
	}
	if err := insertGenericAuditToolRun(ctx, tx, "mcp_inventory_sync", "mcp_inventory_synced", serverID, audit); err != nil {
		return MCPServerRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return MCPServerRecord{}, err
	}
	return db.GetMCPServer(ctx, serverID)
}

func (db *DB) WrapMCPTool(ctx context.Context, serverID string, toolName string, req MCPWrapToolRequest) (CapabilityRecord, error) {
	serverID = strings.TrimSpace(serverID)
	toolName = strings.TrimSpace(toolName)
	if serverID == "" || toolName == "" {
		return CapabilityRecord{}, errors.New("server_id and tool_name are required")
	}
	item, err := db.getMCPToolInventory(ctx, serverID, toolName)
	if err != nil {
		return CapabilityRecord{}, err
	}
	capabilityID := safeRegistryID(firstNonEmpty(req.CapabilityID, "mcp_"+serverID+"_"+toolName), "mcp_wrapped")
	description := strings.TrimSpace(firstNonEmpty(req.Description, item.Description))
	intentDomain := strings.TrimSpace(req.IntentDomain)
	if description == "" || intentDomain == "" || len(req.PositiveExamples) == 0 || len(req.NegativeExamples) == 0 {
		return CapabilityRecord{}, errors.New("wrapped MCP capability requires description, intent_domain, positive_examples, and negative_examples")
	}
	riskLevel := normalizedRisk(valueOrDefault(req.RiskLevel, "read_only"))
	privacyLevel := valueOrDefault(strings.TrimSpace(req.PrivacyLevel), "private_content")
	uiVisibility := valueOrDefault(strings.TrimSpace(req.UIVisibility), "chat")
	inputSchema := req.InputSchema
	if inputSchema == nil {
		inputSchema = item.Schema
	}
	if inputSchema == nil {
		inputSchema = map[string]any{"type": "object", "additionalProperties": true}
	}
	outputSchema := req.OutputSchema
	if outputSchema == nil {
		outputSchema = map[string]any{"type": "object", "additionalProperties": true}
	}
	contract := CapabilityContract{
		ID: capabilityID, Version: "v1", Source: "mcp_wrapped", IntentDomain: intentDomain,
		Description: description, PositiveExamples: req.PositiveExamples, NegativeExamples: req.NegativeExamples,
		InputSchema: inputSchema, OutputSchema: outputSchema, RiskLevel: riskLevel, PrivacyLevel: privacyLevel,
		WorkflowID: capabilityID + "_v1", UIVisibility: uiVisibility,
	}
	metadata := map[string]any{
		"source":        "mcp_wrapped",
		"mcp_server_id": serverID,
		"mcp_tool_name": toolName,
		"contract":      contract,
		"privacy_level": privacyLevel,
		"workflow_id":   contract.WorkflowID,
		"ui_visibility": uiVisibility,
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return CapabilityRecord{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO tools (id, name, description, risk_level, allowed_nodes, timeout_seconds, enabled, metadata)
		VALUES ('mcp_tool_call', 'MCP Tool Call', 'Call an MCP tool only through a wrapped Joi capability.', 'read_only', '["main-node"]', 30, TRUE, '{"requires_wrapped_capability":true}')
		ON CONFLICT(id) DO UPDATE SET enabled=TRUE, updated_at=CURRENT_TIMESTAMP
	`); err != nil {
		return CapabilityRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO capabilities (id, name, description, risk_level, input_schema, output_schema, enabled, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT(id) DO UPDATE SET
			name=EXCLUDED.name,
			description=EXCLUDED.description,
			risk_level=EXCLUDED.risk_level,
			input_schema=EXCLUDED.input_schema,
			output_schema=EXCLUDED.output_schema,
			enabled=EXCLUDED.enabled,
			metadata=EXCLUDED.metadata,
			updated_at=CURRENT_TIMESTAMP
	`, capabilityID, strings.TrimSpace(firstNonEmpty(item.Name, capabilityID)), description, riskLevel, mustJSON(inputSchema), mustJSON(outputSchema), enabled, mustJSON(metadata)); err != nil {
		return CapabilityRecord{}, err
	}
	steps := []ToolWorkflowStep{{Tool: "mcp_tool_call", Args: map[string]any{"server_id": serverID, "tool_name": toolName}, RiskLevel: riskLevel}}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO tool_workflows (id, capability_id, name, version, risk_level, steps, enabled, metadata)
		VALUES ($1, $2, $3, 'v1', $4, $5, $6, $7)
		ON CONFLICT(id) DO UPDATE SET
			capability_id=EXCLUDED.capability_id,
			name=EXCLUDED.name,
			risk_level=EXCLUDED.risk_level,
			steps=EXCLUDED.steps,
			enabled=EXCLUDED.enabled,
			metadata=EXCLUDED.metadata,
			updated_at=CURRENT_TIMESTAMP
	`, "workflow_"+capabilityID+"_v1", capabilityID, capabilityID+"_v1", riskLevel, mustJSON(steps), enabled, mustJSON(map[string]any{"source": "mcp_wrapped", "mcp_server_id": serverID, "mcp_tool_name": toolName})); err != nil {
		return CapabilityRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE mcp_inventory_items SET wrapped_capability_id=$3, updated_at=CURRENT_TIMESTAMP WHERE server_id=$1 AND kind='tool' AND name=$2`, serverID, toolName, capabilityID); err != nil {
		return CapabilityRecord{}, err
	}
	if err := insertGenericAuditToolRun(ctx, tx, "mcp_tool_wrap", "mcp_tool_wrapped", capabilityID, map[string]any{"server_id": serverID, "tool_name": toolName, "capability_id": capabilityID}); err != nil {
		return CapabilityRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return CapabilityRecord{}, err
	}
	return CapabilityRecord{ID: capabilityID, Name: firstNonEmpty(item.Name, capabilityID), Description: description, RiskLevel: riskLevel, Enabled: enabled, Metadata: metadata}, nil
}

func (db *DB) ExecuteMCPWrappedTool(ctx context.Context, capability string, inputs map[string]any) (map[string]any, error) {
	return ExecuteMCPWrappedToolWithTx(ctx, db.sql, capability, inputs)
}

func ExecuteMCPWrappedToolWithTx(ctx context.Context, tx capabilityCompilerTx, capability string, inputs map[string]any) (map[string]any, error) {
	var metadataRaw []byte
	var enabled bool
	err := tx.QueryRowContext(ctx, `SELECT metadata, enabled FROM capabilities WHERE id=$1`, capability).Scan(&metadataRaw, &enabled)
	if errors.Is(err, sql.ErrNoRows) || !enabled {
		return nil, ErrCapabilityMissing
	}
	if err != nil {
		return nil, err
	}
	metadata := decodeObject(metadataRaw)
	if registryStringFromMap(metadata, "source") != "mcp_wrapped" {
		return nil, ErrCapabilityMismatch
	}
	serverID := registryStringFromMap(metadata, "mcp_server_id")
	toolName := registryStringFromMap(metadata, "mcp_tool_name")
	server, err := getMCPServerWithTx(ctx, tx, serverID)
	if err != nil {
		return nil, err
	}
	if !server.Enabled || strings.TrimSpace(server.Command) == "" {
		return nil, ErrPolicyDenied
	}
	result, err := callMCPStdioTool(ctx, server, toolName, inputs)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"status":        "succeeded",
		"capability_id": capability,
		"server_id":     serverID,
		"tool_name":     toolName,
		"result":        SanitizeForTrace(result),
	}, nil
}

func getMCPServerWithTx(ctx context.Context, tx capabilityCompilerTx, id string) (MCPServerRecord, error) {
	row := tx.QueryRowContext(ctx, `
		SELECT id, name, transport, command, args, env_secret_refs, enabled, status, trust, COALESCE(last_sync_at, ''), last_sync_error, metadata
		FROM mcp_servers
		WHERE id=$1
	`, strings.TrimSpace(id))
	return scanMCPServer(row)
}

func (db *DB) ListSkillDefinitions(ctx context.Context) ([]SkillDefinition, error) {
	skills, err := ListSkillDefinitionsWithTx(ctx, db.sql)
	if err != nil {
		return nil, err
	}
	for i := range skills {
		recent, _ := db.latestSkillRun(ctx, skills[i].ID)
		skills[i].RecentRun = recent
	}
	return skills, nil
}

func ListSkillDefinitionsWithTx(ctx context.Context, tx capabilityCompilerTx) ([]SkillDefinition, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT id, version, name, description, trigger_phrases, required_capabilities, forbidden_capabilities, prompt, output_contract, enabled, metadata
		FROM skill_definitions
		ORDER BY enabled DESC, name ASC, id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	skills := []SkillDefinition{}
	for rows.Next() {
		skill, err := scanSkillDefinition(rows)
		if err != nil {
			return nil, err
		}
		skills = append(skills, skill)
	}
	return skills, rows.Err()
}

func (db *DB) GetSkillDefinition(ctx context.Context, id string) (SkillDefinition, error) {
	row := db.sql.QueryRowContext(ctx, `
		SELECT id, version, name, description, trigger_phrases, required_capabilities, forbidden_capabilities, prompt, output_contract, enabled, metadata
		FROM skill_definitions WHERE id=$1
	`, strings.TrimSpace(id))
	return scanSkillDefinition(row)
}

func (db *DB) SaveSkillDefinition(ctx context.Context, req SkillRequest) (SkillDefinition, error) {
	id := safeRegistryID(firstNonEmpty(req.ID, req.Name), "skill")
	if id == "" {
		return SkillDefinition{}, errors.New("skill id or name is required")
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	metadata := req.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	_, err := db.sql.ExecContext(ctx, `
		INSERT INTO skill_definitions (id, version, name, description, trigger_phrases, required_capabilities, forbidden_capabilities, prompt, output_contract, enabled, metadata, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET
			version=EXCLUDED.version,
			name=EXCLUDED.name,
			description=EXCLUDED.description,
			trigger_phrases=EXCLUDED.trigger_phrases,
			required_capabilities=EXCLUDED.required_capabilities,
			forbidden_capabilities=EXCLUDED.forbidden_capabilities,
			prompt=EXCLUDED.prompt,
			output_contract=EXCLUDED.output_contract,
			enabled=EXCLUDED.enabled,
			metadata=EXCLUDED.metadata,
			updated_at=CURRENT_TIMESTAMP
	`, id, valueOrDefault(req.Version, "v1"), valueOrDefault(req.Name, id), req.Description, mustJSON(req.TriggerPhrases), mustJSON(req.RequiredCapabilities), mustJSON(req.ForbiddenCapabilities), req.Prompt, req.OutputContract, enabled, mustJSON(metadata))
	if err != nil {
		return SkillDefinition{}, err
	}
	return db.GetSkillDefinition(ctx, id)
}

func (db *DB) SelectSkillForMessage(ctx context.Context, message string) (*SkillDefinition, error) {
	return SelectSkillForMessageWithTx(ctx, db.sql, message)
}

func SelectSkillForMessageWithTx(ctx context.Context, tx capabilityCompilerTx, message string) (*SkillDefinition, error) {
	skills, err := ListSkillDefinitionsWithTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	lower := strings.ToLower(message)
	var selected *SkillDefinition
	bestScore := 0
	for i := range skills {
		if !skills[i].Enabled {
			continue
		}
		score := 0
		for _, phrase := range skills[i].TriggerPhrases {
			phrase = strings.TrimSpace(strings.ToLower(phrase))
			if phrase != "" && strings.Contains(lower, phrase) {
				score += len([]rune(phrase))
			}
		}
		if domain := registryStringFromMap(skills[i].Metadata, "intent_domain"); domain != "" && strings.Contains(lower, strings.ReplaceAll(domain, "_", " ")) {
			score += 4
		}
		if score > bestScore {
			bestScore = score
			copySkill := skills[i]
			selected = &copySkill
		}
	}
	return selected, nil
}

func BuildSkillPlan(skill SkillDefinition, message string, contextValues map[string]any) SkillPlan {
	plan := SkillPlan{OutputType: "skill_plan", Context: map[string]any{"message": message}, CapabilityRequests: []CapabilityRequest{}}
	for key, value := range contextValues {
		plan.Context[key] = value
	}
	switch skill.ID {
	case "web_summary_skill":
		url := firstURLInString(message)
		plan.Summary = "Read an explicit URL and summarize the public page."
		if url != "" {
			plan.CapabilityRequests = append(plan.CapabilityRequests, CapabilityRequest{
				Type: "capability_request", Capability: "web_research", Goal: "Read and summarize the explicit URL.", Inputs: map[string]any{"url": url}, Risk: "read_only", Source: "skill", Evidence: message,
			})
		}
	case "desktop_inventory_skill":
		plan.Summary = "List installed local applications as metadata."
		plan.CapabilityRequests = append(plan.CapabilityRequests, CapabilityRequest{
			Type: "capability_request", Capability: "desktop_app_list", Goal: "List installed local applications.", Inputs: map[string]any{}, Risk: "read_only", Source: "skill", Evidence: message,
		})
	default:
		plan.Summary = "Skill selected; no deterministic capability request generated."
	}
	return plan
}

func ValidateSkillCapabilityRequest(skill SkillDefinition, request CapabilityRequest) error {
	capability := CanonicalCapabilityName(request.Capability)
	required := map[string]bool{}
	for _, item := range skill.RequiredCapabilities {
		required[CanonicalCapabilityName(item)] = true
	}
	for _, item := range skill.ForbiddenCapabilities {
		if CanonicalCapabilityName(item) == capability {
			return fmt.Errorf("skill %s forbids capability %s", skill.ID, capability)
		}
	}
	if len(required) > 0 && !required[capability] {
		return fmt.Errorf("skill %s may only request declared capabilities", skill.ID)
	}
	if containsRawToolDirective(request) {
		return fmt.Errorf("skill %s generated a forbidden raw tool directive", skill.ID)
	}
	return nil
}

func (db *DB) RecordSkillRun(ctx context.Context, tx execTx, runID string, skillID string, status string, input map[string]any, plan SkillPlan, rejectionReason string) (*SkillRun, error) {
	runIDArg := any(nil)
	if strings.TrimSpace(runID) != "" {
		runIDArg = runID
	}
	id, err := NewID("skillrun_")
	if err != nil {
		return nil, err
	}
	if input == nil {
		input = map[string]any{}
	}
	finishedExpr := any(nil)
	if status != "pending" {
		finishedExpr = time.Now().UTC().Format(time.RFC3339)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO skill_runs (id, run_id, skill_id, status, input, output_plan, capability_requests, rejection_reason, finished_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, id, runIDArg, skillID, status, mustJSON(input), mustJSON(plan), mustJSON(plan.CapabilityRequests), rejectionReason, finishedExpr)
	if err != nil {
		return nil, err
	}
	return &SkillRun{ID: id, RunID: runID, SkillID: skillID, Status: status, Input: input, OutputPlan: plan, CapabilityRequests: plan.CapabilityRequests, RejectionReason: rejectionReason}, nil
}

func (db *DB) TestSkillDefinition(ctx context.Context, id string, req SkillTestRequest) (SkillTestResult, error) {
	skill, err := db.GetSkillDefinition(ctx, id)
	if err != nil {
		return SkillTestResult{}, err
	}
	plan := BuildSkillPlan(skill, req.Message, req.Context)
	for _, request := range plan.CapabilityRequests {
		if err := ValidateSkillCapabilityRequest(skill, request); err != nil {
			plan.Rejected = true
			plan.RejectionReason = err.Error()
			break
		}
	}
	return SkillTestResult{Skill: skill, Plan: plan}, nil
}

func scanMCPServer(scanner interface {
	Scan(dest ...any) error
}) (MCPServerRecord, error) {
	var server MCPServerRecord
	var argsRaw, envRaw, metadataRaw []byte
	if err := scanner.Scan(&server.ID, &server.Name, &server.Transport, &server.Command, &argsRaw, &envRaw, &server.Enabled, &server.Status, &server.Trust, &server.LastSyncAt, &server.LastSyncError, &metadataRaw); err != nil {
		return MCPServerRecord{}, err
	}
	_ = json.Unmarshal(argsRaw, &server.Args)
	_ = json.Unmarshal(envRaw, &server.EnvSecretRefs)
	if server.Args == nil {
		server.Args = []string{}
	}
	if server.EnvSecretRefs == nil {
		server.EnvSecretRefs = map[string]string{}
	}
	server.Metadata = decodeObject(metadataRaw)
	return server, nil
}

func scanMCPInventoryItem(scanner interface {
	Scan(dest ...any) error
}) (MCPInventoryItem, error) {
	var item MCPInventoryItem
	var schemaRaw, argsRaw, metadataRaw []byte
	if err := scanner.Scan(&item.ID, &item.ServerID, &item.Kind, &item.Name, &item.Description, &schemaRaw, &item.URI, &item.MimeType, &argsRaw, &item.WrappedCapabilityID, &item.Enabled, &item.LastSeenAt, &metadataRaw); err != nil {
		return MCPInventoryItem{}, err
	}
	item.Schema = decodeObject(schemaRaw)
	_ = json.Unmarshal(argsRaw, &item.Arguments)
	if item.Arguments == nil {
		item.Arguments = []string{}
	}
	item.Metadata = decodeObject(metadataRaw)
	return item, nil
}

func scanSkillDefinition(scanner interface {
	Scan(dest ...any) error
}) (SkillDefinition, error) {
	var skill SkillDefinition
	var triggersRaw, requiredRaw, forbiddenRaw, metadataRaw []byte
	if err := scanner.Scan(&skill.ID, &skill.Version, &skill.Name, &skill.Description, &triggersRaw, &requiredRaw, &forbiddenRaw, &skill.Prompt, &skill.OutputContract, &skill.Enabled, &metadataRaw); err != nil {
		return SkillDefinition{}, err
	}
	_ = json.Unmarshal(triggersRaw, &skill.TriggerPhrases)
	_ = json.Unmarshal(requiredRaw, &skill.RequiredCapabilities)
	_ = json.Unmarshal(forbiddenRaw, &skill.ForbiddenCapabilities)
	if skill.TriggerPhrases == nil {
		skill.TriggerPhrases = []string{}
	}
	if skill.RequiredCapabilities == nil {
		skill.RequiredCapabilities = []string{}
	}
	if skill.ForbiddenCapabilities == nil {
		skill.ForbiddenCapabilities = []string{}
	}
	skill.Metadata = decodeObject(metadataRaw)
	return skill, nil
}

func (db *DB) latestSkillRun(ctx context.Context, skillID string) (*SkillRun, error) {
	row := db.sql.QueryRowContext(ctx, `
		SELECT id, COALESCE(run_id, ''), skill_id, status, input, output_plan, capability_requests, rejection_reason, COALESCE(created_at, ''), COALESCE(finished_at, '')
		FROM skill_runs
		WHERE skill_id=$1
		ORDER BY created_at DESC
		LIMIT 1
	`, skillID)
	var run SkillRun
	var inputRaw, planRaw, requestsRaw []byte
	if err := row.Scan(&run.ID, &run.RunID, &run.SkillID, &run.Status, &inputRaw, &planRaw, &requestsRaw, &run.RejectionReason, &run.CreatedAt, &run.FinishedAt); err != nil {
		return nil, err
	}
	run.Input = decodeObject(inputRaw)
	_ = json.Unmarshal(planRaw, &run.OutputPlan)
	_ = json.Unmarshal(requestsRaw, &run.CapabilityRequests)
	return &run, nil
}

func (db *DB) getMCPToolInventory(ctx context.Context, serverID string, toolName string) (MCPInventoryItem, error) {
	row := db.sql.QueryRowContext(ctx, `
		SELECT id, server_id, kind, name, description, schema, uri, mime_type, arguments, COALESCE(wrapped_capability_id, ''), enabled, COALESCE(last_seen_at, ''), metadata
		FROM mcp_inventory_items
		WHERE server_id=$1 AND kind='tool' AND name=$2
	`, serverID, toolName)
	return scanMCPInventoryItem(row)
}

func attachMCPInventory(server *MCPServerRecord, items []MCPInventoryItem) {
	server.Tools = []MCPInventoryItem{}
	server.Resources = []MCPInventoryItem{}
	server.Prompts = []MCPInventoryItem{}
	for _, item := range items {
		switch item.Kind {
		case "tool":
			server.Tools = append(server.Tools, item)
		case "resource":
			server.Resources = append(server.Resources, item)
		case "prompt":
			server.Prompts = append(server.Prompts, item)
		}
	}
}

func insertGenericAuditToolRun(ctx context.Context, tx execTx, capabilityID string, toolName string, target string, output map[string]any) error {
	id, err := NewID("toolrun_")
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO tool_runs (id, capability_id, workflow_name, tool_name, node_id, risk_level, status, input, output, finished_at, duration_ms, assignment_reason)
		VALUES ($1, NULLIF($2, ''), $3, $4, 'main-node', 'read_only', 'succeeded', $5, $6, CURRENT_TIMESTAMP, 0, 'registry_audit')
	`, id, "", toolName, toolName, mustJSON(map[string]any{"capability_id": capabilityID, "target": target}), mustJSON(SanitizeForTrace(output)))
	return err
}

func syncMCPStdioInventory(ctx context.Context, server MCPServerRecord) ([]MCPInventoryItem, error) {
	callCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	client, err := startMCPStdioClient(callCtx, server)
	if err != nil {
		return nil, err
	}
	defer client.close()
	if _, err := client.call("initialize", map[string]any{"protocolVersion": "2024-11-05", "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "Joi", "version": "v1"}}); err != nil {
		return nil, err
	}
	_ = client.notify("notifications/initialized", map[string]any{})
	items := []MCPInventoryItem{}
	if result, err := client.call("tools/list", map[string]any{}); err == nil {
		items = append(items, mcpToolsFromResult(server.ID, result)...)
	}
	if result, err := client.call("resources/list", map[string]any{}); err == nil {
		items = append(items, mcpResourcesFromResult(server.ID, result)...)
	}
	if result, err := client.call("prompts/list", map[string]any{}); err == nil {
		items = append(items, mcpPromptsFromResult(server.ID, result)...)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Kind == items[j].Kind {
			return items[i].Name < items[j].Name
		}
		return items[i].Kind < items[j].Kind
	})
	return items, nil
}

func callMCPStdioTool(ctx context.Context, server MCPServerRecord, toolName string, arguments map[string]any) (map[string]any, error) {
	callCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	client, err := startMCPStdioClient(callCtx, server)
	if err != nil {
		return nil, err
	}
	defer client.close()
	if _, err := client.call("initialize", map[string]any{"protocolVersion": "2024-11-05", "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "Joi", "version": "v1"}}); err != nil {
		return nil, err
	}
	_ = client.notify("notifications/initialized", map[string]any{})
	result, err := client.call("tools/call", map[string]any{"name": toolName, "arguments": arguments})
	if err != nil {
		return nil, err
	}
	return result, nil
}

type mcpStdioClient struct {
	cmd    *exec.Cmd
	reader *bufio.Reader
	stdin  io.WriteCloser
	nextID int
}

func startMCPStdioClient(ctx context.Context, server MCPServerRecord) (*mcpStdioClient, error) {
	command := strings.TrimSpace(server.Command)
	if command == "" {
		return nil, errors.New("mcp command is required")
	}
	cmd := exec.CommandContext(ctx, command, server.Args...)
	cmd.Env = os.Environ()
	keys := make([]string, 0, len(server.EnvSecretRefs))
	for key := range server.EnvSecretRefs {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		ref := strings.TrimSpace(server.EnvSecretRefs[key])
		if ref == "" {
			continue
		}
		cmd.Env = append(cmd.Env, key+"="+os.Getenv(ref))
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &mcpStdioClient{cmd: cmd, reader: bufio.NewReader(stdout), stdin: stdin, nextID: 1}, nil
}

func (c *mcpStdioClient) close() {
	_ = c.stdin.Close()
	if c.cmd != nil && c.cmd.Process != nil {
		_ = c.cmd.Process.Kill()
	}
	if c.cmd != nil {
		_ = c.cmd.Wait()
	}
}

func (c *mcpStdioClient) call(method string, params map[string]any) (map[string]any, error) {
	id := c.nextID
	c.nextID++
	if err := writeMCPMessage(c.stdin, map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}); err != nil {
		return nil, err
	}
	for {
		message, err := readMCPMessage(c.reader)
		if err != nil {
			return nil, err
		}
		var envelope map[string]any
		if err := json.Unmarshal(message, &envelope); err != nil {
			return nil, err
		}
		if intFromAny(envelope["id"]) != id {
			continue
		}
		if errorValue, ok := envelope["error"]; ok && errorValue != nil {
			return nil, fmt.Errorf("mcp %s failed: %v", method, errorValue)
		}
		if result, ok := envelope["result"].(map[string]any); ok {
			return result, nil
		}
		return map[string]any{}, nil
	}
}

func (c *mcpStdioClient) notify(method string, params map[string]any) error {
	return writeMCPMessage(c.stdin, map[string]any{"jsonrpc": "2.0", "method": method, "params": params})
}

func writeMCPMessage(w io.Writer, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "Content-Length: %d\r\n\r\n", len(raw)); err != nil {
		return err
	}
	_, err = w.Write(raw)
	return err
}

func readMCPMessage(r *bufio.Reader) ([]byte, error) {
	contentLength := 0
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) == 2 && strings.EqualFold(strings.TrimSpace(parts[0]), "Content-Length") {
			fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &contentLength)
		}
	}
	if contentLength <= 0 {
		return nil, errors.New("mcp response missing content-length")
	}
	raw := make([]byte, contentLength)
	_, err := io.ReadFull(r, raw)
	return raw, err
}

func mcpToolsFromResult(serverID string, result map[string]any) []MCPInventoryItem {
	items := []MCPInventoryItem{}
	for _, raw := range arrayFromAny(result["tools"]) {
		value, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name := registryStringFromMap(value, "name")
		if name == "" {
			continue
		}
		schema := objectFromAny(value["inputSchema"])
		items = append(items, MCPInventoryItem{ServerID: serverID, Kind: "tool", Name: name, Description: registryStringFromMap(value, "description"), Schema: schema, Enabled: true, Metadata: map[string]any{"mcp_inventory": true}})
	}
	return items
}

func mcpResourcesFromResult(serverID string, result map[string]any) []MCPInventoryItem {
	items := []MCPInventoryItem{}
	for _, raw := range arrayFromAny(result["resources"]) {
		value, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		uri := registryStringFromMap(value, "uri")
		name := firstNonEmpty(registryStringFromMap(value, "name"), uri)
		if name == "" {
			continue
		}
		items = append(items, MCPInventoryItem{ServerID: serverID, Kind: "resource", Name: name, URI: uri, Description: registryStringFromMap(value, "description"), MimeType: registryStringFromMap(value, "mimeType"), Enabled: true, Metadata: map[string]any{"context_resource_only": true}})
	}
	return items
}

func mcpPromptsFromResult(serverID string, result map[string]any) []MCPInventoryItem {
	items := []MCPInventoryItem{}
	for _, raw := range arrayFromAny(result["prompts"]) {
		value, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name := registryStringFromMap(value, "name")
		if name == "" {
			continue
		}
		args := []string{}
		for _, arg := range arrayFromAny(value["arguments"]) {
			if argValue, ok := arg.(map[string]any); ok {
				if argName := registryStringFromMap(argValue, "name"); argName != "" {
					args = append(args, argName)
				}
			}
		}
		items = append(items, MCPInventoryItem{ServerID: serverID, Kind: "prompt", Name: name, Description: registryStringFromMap(value, "description"), Arguments: args, Enabled: true, Metadata: map[string]any{"skill_seed_only": true}})
	}
	return items
}

func safeRegistryID(value string, fallback string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		value = fallback
	}
	re := regexp.MustCompile(`[^a-z0-9_]+`)
	value = re.ReplaceAllString(strings.ReplaceAll(value, "-", "_"), "_")
	value = strings.Trim(value, "_")
	if value == "" {
		return fallback
	}
	if len(value) > 90 {
		value = value[:90]
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func registryStringFromMap(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	switch value := values[key].(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(value)
	case fmt.Stringer:
		return strings.TrimSpace(value.String())
	default:
		return strings.TrimSpace(fmt.Sprint(value))
	}
}

func objectFromAny(value any) map[string]any {
	if object, ok := value.(map[string]any); ok && object != nil {
		return object
	}
	return map[string]any{}
}

func arrayFromAny(value any) []any {
	if array, ok := value.([]any); ok {
		return array
	}
	return []any{}
}

func intFromAny(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		number, _ := typed.Int64()
		return int(number)
	default:
		return 0
	}
}

func firstURLInString(value string) string {
	for _, part := range strings.Fields(value) {
		if strings.HasPrefix(part, "http://") || strings.HasPrefix(part, "https://") {
			return strings.TrimRight(part, "，。,.!)]}")
		}
	}
	return ""
}

func containsRawToolDirective(request CapabilityRequest) bool {
	text := strings.ToLower(request.Goal + " " + request.Evidence + " " + string(mustJSON(request.Inputs)))
	for _, token := range []string{"shell", "sql", "file_write", "service_restart", "rm ", "chmod", "chown"} {
		if strings.Contains(text, token) {
			return true
		}
	}
	return false
}

func hashTextForRegistry(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
