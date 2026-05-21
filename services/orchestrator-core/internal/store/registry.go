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
		metadata := mustJSON(capability.Metadata)
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO capabilities (id, name, description, risk_level, enabled, metadata)
			VALUES ($1, $2, $3, $4, TRUE, $5)
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

	return tx.Commit()
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
		capability.Metadata = decodeObject(metadataRaw)
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
