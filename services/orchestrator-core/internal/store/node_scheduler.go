package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const (
	NodeSchedulerDialectPostgres = "postgres"
	NodeSchedulerDialectSQLite   = "sqlite"
)

type NodeScheduleDecision struct {
	UseWorker        bool   `json:"use_worker"`
	NodeID           string `json:"node_id"`
	AssignmentReason string `json:"assignment_reason"`
	PrivacyLevel     string `json:"privacy_level"`
	RunningTasks     int    `json:"running_tasks"`
	Scheduler        string `json:"scheduler"`
}

type nodeSchedulerTx interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type schedulerNodeCandidate struct {
	ID                  string
	Role                string
	Status              string
	Capabilities        []any
	AssignPolicy        map[string]any
	AutoAssignEnabled   bool
	ManualAssignEnabled bool
	RunningTasks        int
}

func ScheduleWorkerNode(ctx context.Context, tx nodeSchedulerTx, request CapabilityRequest, dialect string) (NodeScheduleDecision, error) {
	request.Capability = CanonicalCapabilityName(request.Capability)
	privacy := capabilityPrivacyLevel(request)
	decision := NodeScheduleDecision{
		UseWorker:        false,
		NodeID:           "main-node",
		AssignmentReason: "default_main_node",
		PrivacyLevel:     privacy,
		Scheduler:        "node_scheduler_v1",
	}

	preferred := strings.TrimSpace(request.PreferredNode)
	if preferred == "" || preferred == "main-node" {
		return decision, nil
	}
	manual := preferred != "auto"
	if !manual && !request.AllowWorker {
		return decision, nil
	}
	if !workerCapabilityPermitted(request.Capability) {
		if manual {
			return decision, fmt.Errorf("node scheduler rejected preferred node %q: capability %s is not allowed on worker in scheduler v1", preferred, request.Capability)
		}
		return decision, nil
	}

	if manual {
		node, err := loadSchedulerNode(ctx, tx, dialect, preferred)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return decision, fmt.Errorf("node scheduler rejected preferred node %q: node not found", preferred)
			}
			return decision, err
		}
		if err := validateManualSchedulerNode(node, request.Capability, privacy); err != nil {
			return decision, fmt.Errorf("node scheduler rejected preferred node %q: %w", preferred, err)
		}
		return NodeScheduleDecision{UseWorker: true, NodeID: node.ID, AssignmentReason: "user_selected", PrivacyLevel: privacy, RunningTasks: node.RunningTasks, Scheduler: "node_scheduler_v1"}, nil
	}

	nodes, err := listAutoSchedulerNodes(ctx, tx, dialect)
	if err != nil {
		return decision, err
	}
	for _, node := range nodes {
		if node.Role != "worker" || node.Status != "healthy" || !node.AutoAssignEnabled {
			continue
		}
		if !WorkerCapabilityMatches(node.Capabilities, request.Capability) {
			continue
		}
		if !privacyAllowedOnNode(node.AssignPolicy, privacy) {
			continue
		}
		return NodeScheduleDecision{UseWorker: true, NodeID: node.ID, AssignmentReason: "auto_allow_worker", PrivacyLevel: privacy, RunningTasks: node.RunningTasks, Scheduler: "node_scheduler_v1"}, nil
	}
	return decision, nil
}

func validateManualSchedulerNode(node schedulerNodeCandidate, capability string, privacy string) error {
	if node.Role != "worker" {
		return fmt.Errorf("role %s is not worker", node.Role)
	}
	if node.Status != "healthy" {
		return fmt.Errorf("status %s is not healthy", node.Status)
	}
	if !node.ManualAssignEnabled {
		return errors.New("manual assignment is disabled")
	}
	if !WorkerCapabilityMatches(node.Capabilities, capability) {
		return fmt.Errorf("capability %s is not registered on node", capability)
	}
	if !privacyAllowedOnNode(node.AssignPolicy, privacy) {
		return fmt.Errorf("privacy level %s is not allowed by node policy", privacy)
	}
	return nil
}

func loadSchedulerNode(ctx context.Context, tx nodeSchedulerTx, dialect string, nodeID string) (schedulerNodeCandidate, error) {
	query := schedulerNodeQuery(dialect)
	var rawCaps, rawPolicy []byte
	var node schedulerNodeCandidate
	err := tx.QueryRowContext(ctx, query, nodeID).Scan(&node.ID, &node.Role, &node.Status, &rawCaps, &rawPolicy, &node.AutoAssignEnabled, &node.ManualAssignEnabled, &node.RunningTasks)
	if err != nil {
		return schedulerNodeCandidate{}, err
	}
	node.Capabilities = decodeArray(rawCaps)
	node.AssignPolicy = decodeObject(rawPolicy)
	return node, nil
}

func listAutoSchedulerNodes(ctx context.Context, tx nodeSchedulerTx, dialect string) ([]schedulerNodeCandidate, error) {
	rows, err := tx.QueryContext(ctx, schedulerAutoNodesQuery(dialect))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	nodes := []schedulerNodeCandidate{}
	for rows.Next() {
		var rawCaps, rawPolicy []byte
		var node schedulerNodeCandidate
		if err := rows.Scan(&node.ID, &node.Role, &node.Status, &rawCaps, &rawPolicy, &node.AutoAssignEnabled, &node.ManualAssignEnabled, &node.RunningTasks); err != nil {
			return nil, err
		}
		node.Capabilities = decodeArray(rawCaps)
		node.AssignPolicy = decodeObject(rawPolicy)
		nodes = append(nodes, node)
	}
	return nodes, rows.Err()
}

func schedulerNodeQuery(dialect string) string {
	placeholder := "?"
	if dialect == NodeSchedulerDialectPostgres {
		placeholder = "$1"
	}
	return `
		SELECT n.id, n.role, n.status, n.capabilities, n.assign_policy,
		       n.auto_assign_enabled, n.manual_assign_enabled,
		       COALESCE((SELECT COUNT(*) FROM tasks t WHERE t.assigned_node_id=n.id AND t.status='running'), 0) AS running_tasks
		FROM nodes n
		WHERE n.id=` + placeholder
}

func schedulerAutoNodesQuery(_ string) string {
	return `
		SELECT n.id, n.role, n.status, n.capabilities, n.assign_policy,
		       n.auto_assign_enabled, n.manual_assign_enabled,
		       COALESCE((SELECT COUNT(*) FROM tasks t WHERE t.assigned_node_id=n.id AND t.status='running'), 0) AS running_tasks
		FROM nodes n
		WHERE n.role='worker' AND n.status='healthy'
		ORDER BY running_tasks ASC, n.id ASC
	`
}

func workerCapabilityPermitted(capability string) bool {
	switch CanonicalCapabilityName(capability) {
	case "web_research", "system_health_check":
		return true
	default:
		return false
	}
}

func WorkerCapabilityMatches(capabilities []any, capability string) bool {
	target := canonicalWorkerCapability(capability)
	if target == "" {
		return false
	}
	for _, item := range capabilities {
		if canonicalWorkerCapability(schedulerStringFromAny(item)) == target {
			return true
		}
	}
	return false
}

func canonicalWorkerCapability(capability string) string {
	capability = strings.TrimSpace(capability)
	switch capability {
	case "system_health_check_self":
		return "system_health_check"
	default:
		return CanonicalCapabilityName(capability)
	}
}

func capabilityPrivacyLevel(request CapabilityRequest) string {
	for _, key := range []string{"privacy_level", "privacy"} {
		if value := strings.ToLower(strings.TrimSpace(schedulerStringFromAny(request.Inputs[key]))); value != "" {
			return value
		}
	}
	return "public"
}

func privacyAllowedOnNode(policy map[string]any, privacy string) bool {
	privacy = strings.ToLower(strings.TrimSpace(privacy))
	switch privacy {
	case "", "public":
		return true
	case "internal", "private":
		return boolPolicyValue(policy, "allow_private_context")
	case "secret", "secrets":
		return boolPolicyValue(policy, "allow_secret_context")
	default:
		return false
	}
}

func boolPolicyValue(policy map[string]any, key string) bool {
	if policy == nil {
		return false
	}
	switch value := policy[key].(type) {
	case bool:
		return value
	case string:
		return strings.EqualFold(value, "true") || value == "1" || strings.EqualFold(value, "yes")
	case float64:
		return value != 0
	case json.Number:
		parsed, err := value.Int64()
		return err == nil && parsed != 0
	default:
		return false
	}
}

func schedulerStringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case json.Number:
		return typed.String()
	case int:
		return fmt.Sprintf("%d", typed)
	case int64:
		return fmt.Sprintf("%d", typed)
	case float64:
		return fmt.Sprintf("%.0f", typed)
	case nil:
		return ""
	default:
		return strings.Trim(string(mustJSON(typed)), `"`)
	}
}
