package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
)

type AgentRecord struct {
	ID              string         `json:"id"`
	Name            string         `json:"name"`
	Description     string         `json:"description"`
	DefaultModelID  string         `json:"default_model_id"`
	FallbackModelID string         `json:"fallback_model_id"`
	CheapModelID    string         `json:"cheap_model_id"`
	Capabilities    []string       `json:"capabilities"`
	ToolPolicy      map[string]any `json:"tool_policy"`
	RouteHints      map[string]any `json:"route_hints"`
	Enabled         bool           `json:"enabled"`
}

type modelSeedFile struct {
	Models []modelSeed `json:"models"`
}

type modelSeed struct {
	ID                  string `json:"id"`
	Provider            string `json:"provider"`
	ModelName           string `json:"model_name"`
	DisplayName         string `json:"display_name"`
	BaseURLEnv          string `json:"base_url_env"`
	APIKeyEnv           string `json:"api_key_env"`
	SupportsJSONMode    bool   `json:"supports_json_mode"`
	SupportsToolCalling bool   `json:"supports_tool_calling"`
	Enabled             bool   `json:"enabled"`
}

type agentSeedFile struct {
	Agents []AgentRecord `json:"agents"`
}

type capabilitySeedFile struct {
	Capabilities []CapabilityRecord `json:"capabilities"`
}

type CapabilityRecord struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	RiskLevel   string         `json:"risk_level"`
	Enabled     bool           `json:"enabled"`
	Metadata    map[string]any `json:"metadata"`
}

func (db *DB) SeedRegistryFromDir(ctx context.Context, configDir string) error {
	models, err := readJSONFile[modelSeedFile](filepath.Join(configDir, "models.example.json"))
	if err != nil {
		return err
	}
	agents, err := readJSONFile[agentSeedFile](filepath.Join(configDir, "agents.example.json"))
	if err != nil {
		return err
	}
	capabilities, err := readJSONFile[capabilitySeedFile](filepath.Join(configDir, "capabilities.example.json"))
	if err != nil {
		return err
	}

	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, model := range models.Models {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO models (id, provider, model_name, display_name, base_url_env, api_key_env, supports_json_mode, supports_tool_calling, enabled)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT (id) DO UPDATE SET
				provider = EXCLUDED.provider,
				model_name = EXCLUDED.model_name,
				display_name = EXCLUDED.display_name,
				base_url_env = EXCLUDED.base_url_env,
				api_key_env = EXCLUDED.api_key_env,
				supports_json_mode = EXCLUDED.supports_json_mode,
				supports_tool_calling = EXCLUDED.supports_tool_calling,
				enabled = EXCLUDED.enabled,
				updated_at = NOW()
		`, model.ID, model.Provider, model.ModelName, model.DisplayName, model.BaseURLEnv, model.APIKeyEnv, model.SupportsJSONMode, model.SupportsToolCalling, model.Enabled); err != nil {
			return err
		}
	}

	for _, agent := range agents.Agents {
		capabilities := mustJSON(agent.Capabilities)
		toolPolicy := mustJSON(agent.ToolPolicy)
		routeHints := mustJSON(agent.RouteHints)
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO agents (id, name, description, default_model_id, fallback_model_id, cheap_model_id, capabilities, tool_policy, route_hints, enabled)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (id) DO UPDATE SET
				name = EXCLUDED.name,
				description = EXCLUDED.description,
				default_model_id = EXCLUDED.default_model_id,
				fallback_model_id = EXCLUDED.fallback_model_id,
				cheap_model_id = EXCLUDED.cheap_model_id,
				capabilities = EXCLUDED.capabilities,
				tool_policy = EXCLUDED.tool_policy,
				route_hints = EXCLUDED.route_hints,
				enabled = EXCLUDED.enabled,
				updated_at = NOW()
		`, agent.ID, agent.Name, agent.Description, agent.DefaultModelID, agent.FallbackModelID, agent.CheapModelID, capabilities, toolPolicy, routeHints, agent.Enabled); err != nil {
			return err
		}
	}

	for _, capability := range capabilities.Capabilities {
		name := valueOrDefault(capability.Name, capability.ID)
		metadata := mustJSON(mergeCapabilityContractMetadata(capability.ID, capability.Metadata))
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO capabilities (id, name, description, risk_level, enabled, metadata)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (id) DO UPDATE SET
				name = EXCLUDED.name,
				description = EXCLUDED.description,
				risk_level = EXCLUDED.risk_level,
				enabled = EXCLUDED.enabled,
				metadata = EXCLUDED.metadata,
				updated_at = NOW()
		`, capability.ID, name, capability.Description, capability.RiskLevel, metadata); err != nil {
			return err
		}
	}

	if err := seedDefaultCapabilityKernel(ctx, tx); err != nil {
		return err
	}

	return tx.Commit()
}

type toolSeed struct {
	ID             string
	Name           string
	Description    string
	RiskLevel      string
	AllowedNodes   []string
	TimeoutSeconds int
}

type workflowSeed struct {
	ID           string
	CapabilityID string
	Name         string
	Version      string
	RiskLevel    string
	Steps        []ToolWorkflowStep
}

func seedDefaultCapabilityKernel(ctx context.Context, tx *sql.Tx) error {
	for _, capability := range []CapabilityRecord{
		{ID: "memory_search", Name: "Memory Search", Description: "Search local memory context.", RiskLevel: "read_only", Enabled: true, Metadata: map[string]any{"kernel_default": true}},
		{ID: "server_diagnose", Name: "Server Diagnose", Description: "Read-only server diagnostics.", RiskLevel: "read_only", Enabled: true, Metadata: map[string]any{"kernel_default": true}},
		{ID: "system_health_check", Name: "System Health Check", Description: "Read-only Joi self-check.", RiskLevel: "read_only", Enabled: true, Metadata: map[string]any{"kernel_default": true}},
		{ID: "web_research", Name: "Web Research", Description: "Read-only public HTTP/HTTPS research.", RiskLevel: "read_only", Enabled: true, Metadata: map[string]any{"kernel_default": true}},
		{ID: "browser_read", Name: "Browser Read", Description: "Read a URL through browser/web host policy.", RiskLevel: "read_only", Enabled: true, Metadata: map[string]any{"kernel_default": true}},
		{ID: "workspace_search", Name: "Workspace Search", Description: "Search authorized workspace source and documents.", RiskLevel: "read_only", Enabled: true, Metadata: map[string]any{"kernel_default": true}},
		{ID: "file_analyze", Name: "File Analyze", Description: "Analyze an authorized workspace file.", RiskLevel: "read_only", Enabled: true, Metadata: map[string]any{"kernel_default": true}},
		{ID: "desktop_app_list", Name: "Desktop App List", Description: "List installed macOS applications as local metadata.", RiskLevel: "read_only", Enabled: true, Metadata: map[string]any{"kernel_default": true}},
		{ID: "desktop_app_inspect", Name: "Desktop App Inspect", Description: "Inspect one macOS application bundle as local metadata.", RiskLevel: "read_only", Enabled: true, Metadata: map[string]any{"kernel_default": true}},
		{ID: "computer_observe", Name: "Computer Observe", Description: "Read-only visible Joi desktop observation.", RiskLevel: "read_only", Enabled: true, Metadata: map[string]any{"kernel_default": true}},
	} {
		metadata := mergeCapabilityContractMetadata(capability.ID, capability.Metadata)
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO capabilities (id, name, description, risk_level, enabled, metadata)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (id) DO UPDATE SET
				name = EXCLUDED.name,
				description = EXCLUDED.description,
				risk_level = EXCLUDED.risk_level,
				enabled = EXCLUDED.enabled,
				metadata = EXCLUDED.metadata,
				updated_at = NOW()
		`, capability.ID, capability.Name, capability.Description, capability.RiskLevel, capability.Enabled, mustJSON(metadata)); err != nil {
			return err
		}
	}
	for _, tool := range defaultToolSeeds() {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO tools (id, name, description, risk_level, allowed_nodes, timeout_seconds, enabled, metadata)
			VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
			ON CONFLICT (id) DO UPDATE SET
				name = EXCLUDED.name,
				description = EXCLUDED.description,
				risk_level = EXCLUDED.risk_level,
				allowed_nodes = EXCLUDED.allowed_nodes,
				timeout_seconds = EXCLUDED.timeout_seconds,
				enabled = EXCLUDED.enabled,
				metadata = EXCLUDED.metadata,
				updated_at = NOW()
		`, tool.ID, tool.Name, tool.Description, tool.RiskLevel, mustJSON(tool.AllowedNodes), tool.TimeoutSeconds, mustJSON(map[string]any{"kernel_default": true})); err != nil {
			return err
		}
	}
	for _, workflow := range defaultWorkflowSeeds() {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO tool_workflows (id, capability_id, name, version, risk_level, steps, enabled, metadata)
			VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
			ON CONFLICT (id) DO UPDATE SET
				capability_id = EXCLUDED.capability_id,
				name = EXCLUDED.name,
				version = EXCLUDED.version,
				risk_level = EXCLUDED.risk_level,
				steps = EXCLUDED.steps,
				enabled = EXCLUDED.enabled,
				metadata = EXCLUDED.metadata,
				updated_at = NOW()
		`, workflow.ID, workflow.CapabilityID, workflow.Name, workflow.Version, workflow.RiskLevel, mustJSON(workflow.Steps), mustJSON(map[string]any{"kernel_default": true})); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO mcp_servers (id, name, transport, command, args, env_secret_refs, enabled, status, trust, metadata)
		VALUES ('local_mcp_registry', 'Local MCP Registry', 'not_configured', '', '[]', '{}', FALSE, 'inactive', 'untrusted_until_wrapped', '{"policy":"MCP inventory is not executable until wrapped as a Joi capability."}')
		ON CONFLICT(id) DO UPDATE SET
			name=EXCLUDED.name,
			transport=EXCLUDED.transport,
			trust=EXCLUDED.trust,
			metadata=EXCLUDED.metadata,
			updated_at=NOW()
	`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO skill_definitions (id, version, name, description, trigger_phrases, required_capabilities, forbidden_capabilities, prompt, output_contract, enabled, metadata)
		VALUES
		  ('web_summary_skill', 'v1', 'Web Summary', 'Read an explicit URL and produce a concise sourced summary.', '["总结这个网站","读取 URL","web summary"]', '["web_research"]', '["file_analyze","server_diagnose","system_health_check"]', 'Generate a skill_plan that requests web_research for an explicit URL only.', '{"output_type":"skill_plan","capability_requests":["web_research"]}', TRUE, '{"source":"native_skill_seed","intent_domain":"public_web_read"}'),
		  ('desktop_inventory_skill', 'v1', 'Desktop Inventory', 'List local installed applications without reading app content.', '["列出本地所有 app","本机有哪些应用","本地所有应用","installed apps"]', '["desktop_app_list"]', '["system_health_check","server_diagnose","file_analyze"]', 'Generate a skill_plan that requests desktop_app_list only.', '{"output_type":"skill_plan","capability_requests":["desktop_app_list"]}', TRUE, '{"source":"native_skill_seed","intent_domain":"desktop_application_inventory"}')
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
			updated_at=NOW()
	`); err != nil {
		return err
	}
	return nil
}

func defaultToolSeeds() []toolSeed {
	return []toolSeed{
		{ID: "memory_search_index", Name: "Memory Search Index", Description: "Read memory FTS index and build context excerpts.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 10},
		{ID: "docker_list_containers", Name: "Docker List Containers", Description: "List containers with fixed read-only arguments.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 5},
		{ID: "docker_inspect_container", Name: "Docker Inspect Container", Description: "Inspect a named container read-only.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 5},
		{ID: "docker_read_logs", Name: "Docker Read Logs", Description: "Read bounded container logs.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 5},
		{ID: "check_port", Name: "Check Port", Description: "Probe a TCP port without state changes.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 3},
		{ID: "http_probe", Name: "HTTP Probe", Description: "Probe a URL with a bounded GET request.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 5},
		{ID: "system_disk_usage", Name: "System Disk Usage", Description: "Read filesystem usage metadata.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 3},
		{ID: "system_memory_usage", Name: "System Memory Usage", Description: "Read process memory metadata.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 3},
		{ID: "postgres_ping", Name: "Postgres Ping", Description: "Read database health status.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 5},
		{ID: "nats_port_check", Name: "NATS Port Check", Description: "Read NATS port reachability.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 3},
		{ID: "console_http_probe", Name: "Console HTTP Probe", Description: "Probe console health endpoint.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 5},
		{ID: "fetch_url", Name: "Fetch URL", Description: "Fetch a public HTTP/HTTPS URL with bounded redirects and response size.", RiskLevel: "read_only", AllowedNodes: []string{"main-node", "local-worker-1"}, TimeoutSeconds: 15},
		{ID: "extract_readable_text", Name: "Extract Readable Text", Description: "Extract bounded readable text from fetched content.", RiskLevel: "read_only", AllowedNodes: []string{"main-node", "local-worker-1"}, TimeoutSeconds: 5},
		{ID: "extract_links", Name: "Extract Links", Description: "Extract bounded links from fetched content.", RiskLevel: "read_only", AllowedNodes: []string{"main-node", "local-worker-1"}, TimeoutSeconds: 5},
		{ID: "summarize_sources", Name: "Summarize Sources", Description: "Summarize fetched public content.", RiskLevel: "read_only", AllowedNodes: []string{"main-node", "local-worker-1"}, TimeoutSeconds: 5},
		{ID: "desktop_list_app_bundles", Name: "Desktop List App Bundles", Description: "List installed macOS .app bundles as bounded local metadata.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 10},
		{ID: "desktop_inspect_app_bundle", Name: "Desktop Inspect App Bundle", Description: "Inspect one installed macOS .app bundle as local metadata.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 10},
		{ID: "workspace_walk_search", Name: "Workspace Walk Search", Description: "Search authorized workspace paths without arbitrary shell flags.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 10},
		{ID: "file_read_authorized", Name: "File Read Authorized", Description: "Read a bounded authorized workspace file.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 10},
		{ID: "file_summarize_excerpts", Name: "File Summarize Excerpts", Description: "Summarize bounded file excerpts.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 10},
		{ID: "computer_observe_visible_ui", Name: "Computer Observe Visible UI", Description: "Read visible Joi desktop UI state without interaction.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 5},
		{ID: "mcp_tool_call", Name: "MCP Tool Call", Description: "Call an MCP tool only through a wrapped Joi capability.", RiskLevel: "read_only", AllowedNodes: []string{"main-node"}, TimeoutSeconds: 30},
	}
}

func defaultWorkflowSeeds() []workflowSeed {
	return []workflowSeed{
		{ID: "workflow_memory_search_v1", CapabilityID: "memory_search", Name: "memory_search_v1", Version: "v1", RiskLevel: "read_only", Steps: []ToolWorkflowStep{{Tool: "memory_search_index", Args: map[string]any{}, RiskLevel: "read_only"}}},
		{ID: "workflow_server_diagnose_v1", CapabilityID: "server_diagnose", Name: "server_diagnose_v1", Version: "v1", RiskLevel: "read_only", Steps: []ToolWorkflowStep{{Tool: "docker_list_containers", Args: map[string]any{}, RiskLevel: "read_only"}, {Tool: "docker_inspect_container", Args: map[string]any{}, RiskLevel: "read_only"}, {Tool: "docker_read_logs", Args: map[string]any{"tail": 200}, RiskLevel: "read_only"}, {Tool: "check_port", Args: map[string]any{}, RiskLevel: "read_only"}, {Tool: "http_probe", Args: map[string]any{}, RiskLevel: "read_only"}, {Tool: "system_disk_usage", Args: map[string]any{}, RiskLevel: "read_only"}, {Tool: "system_memory_usage", Args: map[string]any{}, RiskLevel: "read_only"}}},
		{ID: "workflow_system_health_check_v1", CapabilityID: "system_health_check", Name: "system_health_check_v1", Version: "v1", RiskLevel: "read_only", Steps: []ToolWorkflowStep{{Tool: "postgres_ping", Args: map[string]any{}, RiskLevel: "read_only"}, {Tool: "nats_port_check", Args: map[string]any{}, RiskLevel: "read_only"}, {Tool: "console_http_probe", Args: map[string]any{}, RiskLevel: "read_only"}, {Tool: "system_disk_usage", Args: map[string]any{}, RiskLevel: "read_only"}}},
		{ID: "workflow_web_research_v2", CapabilityID: "web_research", Name: "web_research_v2", Version: "v2", RiskLevel: "read_only", Steps: []ToolWorkflowStep{{Tool: "fetch_url", Args: map[string]any{}, RiskLevel: "read_only"}, {Tool: "extract_readable_text", Args: map[string]any{}, RiskLevel: "read_only"}, {Tool: "extract_links", Args: map[string]any{}, RiskLevel: "read_only"}, {Tool: "summarize_sources", Args: map[string]any{}, RiskLevel: "read_only"}}},
		{ID: "workflow_browser_read_v1", CapabilityID: "browser_read", Name: "browser_read_v1", Version: "v1", RiskLevel: "read_only", Steps: []ToolWorkflowStep{{Tool: "fetch_url", Args: map[string]any{}, RiskLevel: "read_only"}, {Tool: "extract_readable_text", Args: map[string]any{}, RiskLevel: "read_only"}, {Tool: "extract_links", Args: map[string]any{}, RiskLevel: "read_only"}}},
		{ID: "workflow_desktop_app_list_v1", CapabilityID: "desktop_app_list", Name: "desktop_app_list_v1", Version: "v1", RiskLevel: "read_only", Steps: []ToolWorkflowStep{{Tool: "desktop_list_app_bundles", Args: map[string]any{}, RiskLevel: "read_only"}}},
		{ID: "workflow_desktop_app_inspect_v1", CapabilityID: "desktop_app_inspect", Name: "desktop_app_inspect_v1", Version: "v1", RiskLevel: "read_only", Steps: []ToolWorkflowStep{{Tool: "desktop_inspect_app_bundle", Args: map[string]any{}, RiskLevel: "read_only"}}},
		{ID: "workflow_workspace_search_v1", CapabilityID: "workspace_search", Name: "workspace_search_v1", Version: "v1", RiskLevel: "read_only", Steps: []ToolWorkflowStep{{Tool: "workspace_walk_search", Args: map[string]any{}, RiskLevel: "read_only"}}},
		{ID: "workflow_file_analyze_v1", CapabilityID: "file_analyze", Name: "file_analyze_v1", Version: "v1", RiskLevel: "read_only", Steps: []ToolWorkflowStep{{Tool: "file_read_authorized", Args: map[string]any{}, RiskLevel: "read_only"}, {Tool: "file_summarize_excerpts", Args: map[string]any{}, RiskLevel: "read_only"}}},
		{ID: "workflow_computer_observe_v1", CapabilityID: "computer_observe", Name: "computer_observe_v1", Version: "v1", RiskLevel: "read_only", Steps: []ToolWorkflowStep{{Tool: "computer_observe_visible_ui", Args: map[string]any{"target": "joi_current_window"}, RiskLevel: "read_only"}}},
	}
}

func (db *DB) ListAgents(ctx context.Context) ([]AgentRecord, error) {
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, name, description, default_model_id, fallback_model_id, cheap_model_id,
		       capabilities, tool_policy, route_hints, enabled
		FROM agents
		ORDER BY id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var agents []AgentRecord
	for rows.Next() {
		var agent AgentRecord
		var capabilitiesRaw []byte
		var toolPolicyRaw []byte
		var routeHintsRaw []byte
		var defaultModelID sql.NullString
		var fallbackModelID sql.NullString
		var cheapModelID sql.NullString

		if err := rows.Scan(
			&agent.ID,
			&agent.Name,
			&agent.Description,
			&defaultModelID,
			&fallbackModelID,
			&cheapModelID,
			&capabilitiesRaw,
			&toolPolicyRaw,
			&routeHintsRaw,
			&agent.Enabled,
		); err != nil {
			return nil, err
		}

		agent.DefaultModelID = defaultModelID.String
		agent.FallbackModelID = fallbackModelID.String
		agent.CheapModelID = cheapModelID.String
		_ = json.Unmarshal(capabilitiesRaw, &agent.Capabilities)
		agent.ToolPolicy = decodeObject(toolPolicyRaw)
		agent.RouteHints = decodeObject(routeHintsRaw)
		agents = append(agents, agent)
	}

	return agents, rows.Err()
}

func readJSONFile[T any](path string) (*T, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var value T
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	return &value, nil
}

func (db *DB) ListCapabilities(ctx context.Context) ([]CapabilityRecord, error) {
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, name, description, risk_level, enabled, metadata
		FROM capabilities
		ORDER BY id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var capabilities []CapabilityRecord
	for rows.Next() {
		var capability CapabilityRecord
		var metadataRaw []byte
		if err := rows.Scan(&capability.ID, &capability.Name, &capability.Description, &capability.RiskLevel, &capability.Enabled, &metadataRaw); err != nil {
			return nil, err
		}
		capability.Metadata = mergeCapabilityContractMetadata(capability.ID, decodeObject(metadataRaw))
		capabilities = append(capabilities, capability)
	}
	return capabilities, rows.Err()
}

func nullableAgentID(ctx context.Context, tx *sql.Tx, agentID string) any {
	var existing string
	if err := tx.QueryRowContext(ctx, `SELECT id FROM agents WHERE id = $1 AND enabled = TRUE`, agentID).Scan(&existing); err != nil {
		return nil
	}
	return existing
}
