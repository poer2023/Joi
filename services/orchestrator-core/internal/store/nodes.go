package store

import (
	"context"
	"database/sql"
	"time"
)

type NodeRecord struct {
	ID                   string         `json:"id"`
	Name                 string         `json:"name"`
	Role                 string         `json:"role"`
	Status               string         `json:"status"`
	Capabilities         []any          `json:"capabilities"`
	Resources            map[string]any `json:"resources"`
	Network              map[string]any `json:"network"`
	AssignPolicy         map[string]any `json:"assign_policy"`
	AutoAssignEnabled    bool           `json:"auto_assign_enabled"`
	ManualAssignEnabled  bool           `json:"manual_assign_enabled"`
	FailedHeartbeatCount int            `json:"failed_heartbeat_count"`
	LastFailureAt        *time.Time     `json:"last_failure_at"`
	LastFailureReason    string         `json:"last_failure_reason"`
	LastHeartbeatAt      *time.Time     `json:"last_heartbeat_at"`
	Version              string         `json:"version"`
	Metadata             map[string]any `json:"metadata"`
	CreatedAt            time.Time      `json:"created_at"`
	UpdatedAt            time.Time      `json:"updated_at"`
}

func (db *DB) RegisterMainNode(ctx context.Context) error {
	_, err := db.sql.ExecContext(ctx, `
		INSERT INTO nodes (id, name, role, status, capabilities, resources, network, assign_policy, last_heartbeat_at, version, metadata)
		VALUES ('main-node', 'Main Node', 'main-node', 'healthy', $1, $2, $3, $4, NOW(), '0.1.0', $5)
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name,
			role = EXCLUDED.role,
			status = EXCLUDED.status,
			capabilities = EXCLUDED.capabilities,
			resources = EXCLUDED.resources,
			network = EXCLUDED.network,
			assign_policy = EXCLUDED.assign_policy,
			last_heartbeat_at = NOW(),
			version = EXCLUDED.version,
			metadata = EXCLUDED.metadata,
			updated_at = NOW()
	`, mustJSON([]string{"memory_search", "server_diagnose", "system_health_check", "browser_observe", "browser_navigate", "browser_click", "browser_type", "computer_observe", "file_read", "file_analyze", "apply_patch", "shell_command", "test_command", "memory_write_proposal"}), mustJSON(map[string]any{"execution": "local"}), mustJSON(map[string]any{"scope": "local"}), mustJSON(map[string]any{"manual_assignable": true, "auto_assignable": true, "allow_private_context": true, "allow_secret_context": false}), mustJSON(map[string]any{"registered_by": "orchestrator-core"}))
	return err
}

func (db *DB) HeartbeatMainNode(ctx context.Context) (*NodeRecord, error) {
	if _, err := db.sql.ExecContext(ctx, `
		UPDATE nodes
		SET status = 'healthy', last_heartbeat_at = NOW(), updated_at = NOW()
		WHERE id = 'main-node'
	`); err != nil {
		return nil, err
	}
	nodes, err := db.ListNodes(ctx)
	if err != nil {
		return nil, err
	}
	for _, node := range nodes {
		if node.ID == "main-node" {
			return &node, nil
		}
	}
	return nil, sql.ErrNoRows
}

func (db *DB) ListNodes(ctx context.Context) ([]NodeRecord, error) {
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, name, role, status, capabilities, resources, network, assign_policy,
		       auto_assign_enabled, manual_assign_enabled, failed_heartbeat_count,
		       last_failure_at, COALESCE(last_failure_reason, ''), last_heartbeat_at,
		       version, metadata, created_at, updated_at
		FROM nodes
		ORDER BY id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := []NodeRecord{}
	for rows.Next() {
		var record NodeRecord
		var capabilitiesRaw, resourcesRaw, networkRaw, assignPolicyRaw, metadataRaw []byte
		var lastHeartbeat, lastFailure sql.NullTime
		var version sql.NullString
		if err := rows.Scan(&record.ID, &record.Name, &record.Role, &record.Status, &capabilitiesRaw, &resourcesRaw, &networkRaw, &assignPolicyRaw, &record.AutoAssignEnabled, &record.ManualAssignEnabled, &record.FailedHeartbeatCount, &lastFailure, &record.LastFailureReason, &lastHeartbeat, &version, &metadataRaw, &record.CreatedAt, &record.UpdatedAt); err != nil {
			return nil, err
		}
		record.Capabilities = decodeArray(capabilitiesRaw)
		record.Resources = decodeObject(resourcesRaw)
		record.Network = decodeObject(networkRaw)
		record.AssignPolicy = decodeObject(assignPolicyRaw)
		record.LastFailureAt = nullTimePtr(lastFailure)
		record.LastHeartbeatAt = nullTimePtr(lastHeartbeat)
		record.Version = version.String
		record.Metadata = decodeObject(metadataRaw)
		records = append(records, record)
	}
	return records, rows.Err()
}
