package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

type SendChatParams struct {
	ConversationID string
	Channel        string
	UserID         string
	Message        string
	PreferredNode  string
	AllowWorker    bool
}

type SendChatResult struct {
	ConversationID     string         `json:"conversation_id"`
	UserMessageID      string         `json:"user_message_id"`
	AssistantMessageID string         `json:"assistant_message_id"`
	RunID              string         `json:"run_id"`
	SelectedAgentID    string         `json:"selected_agent_id"`
	Response           string         `json:"response"`
	Steps              []RunStepBrief `json:"steps"`
}

type RunRecord struct {
	ID                 string                    `json:"id"`
	ConversationID     string                    `json:"conversation_id"`
	UserMessageID      string                    `json:"user_message_id"`
	Status             string                    `json:"status"`
	SelectedAgentID    string                    `json:"selected_agent_id"`
	RouteResult        map[string]any            `json:"route_result"`
	StartedAt          time.Time                 `json:"started_at"`
	FinishedAt         *time.Time                `json:"finished_at"`
	DurationMs         *int                      `json:"duration_ms"`
	ErrorCode          *string                   `json:"error_code"`
	ErrorMessage       *string                   `json:"error_message"`
	Metadata           map[string]any            `json:"metadata"`
	CreatedAt          time.Time                 `json:"created_at"`
	PromptAssemblies   []PromptAssemblyRecord    `json:"prompt_assemblies"`
	ModelCalls         []ModelCallRecord         `json:"model_calls"`
	MemoryContextPacks []MemoryContextPackRecord `json:"memory_context_packs"`
	Events             []RunEventRecord          `json:"events"`
	Steps              []RunStepRecord           `json:"steps"`
	Tasks              []TaskRecord              `json:"tasks"`
}

type RunEventRecord struct {
	ID        string         `json:"id"`
	RunID     string         `json:"run_id"`
	TurnID    string         `json:"turn_id,omitempty"`
	Seq       int            `json:"seq"`
	EventType string         `json:"event_type"`
	Payload   map[string]any `json:"payload"`
	CreatedAt time.Time      `json:"created_at"`
}

type RunStepRecord struct {
	ID         string         `json:"id"`
	RunID      string         `json:"run_id"`
	StepType   string         `json:"step_type"`
	Title      string         `json:"title"`
	Status     string         `json:"status"`
	Input      map[string]any `json:"input"`
	Output     map[string]any `json:"output"`
	Error      map[string]any `json:"error,omitempty"`
	StartedAt  time.Time      `json:"started_at"`
	FinishedAt *time.Time     `json:"finished_at"`
	DurationMs *int           `json:"duration_ms"`
	CreatedAt  time.Time      `json:"created_at"`
}

type TaskRecord struct {
	ID              string              `json:"id"`
	RunID           string              `json:"run_id"`
	CapabilityID    string              `json:"capability_id"`
	PreferredNodeID string              `json:"preferred_node_id"`
	AssignedNodeID  string              `json:"assigned_node_id"`
	PrivacyLevel    string              `json:"privacy_level"`
	Status          string              `json:"status"`
	Payload         map[string]any      `json:"payload"`
	Result          map[string]any      `json:"result"`
	Error           map[string]any      `json:"error,omitempty"`
	CreatedAt       time.Time           `json:"created_at"`
	StartedAt       *time.Time          `json:"started_at"`
	FinishedAt      *time.Time          `json:"finished_at"`
	Attempts        []TaskAttemptRecord `json:"attempts"`
}

type TaskAttemptRecord struct {
	ID            string         `json:"id"`
	TaskID        string         `json:"task_id"`
	NodeID        string         `json:"node_id"`
	Status        string         `json:"status"`
	AttemptNumber int            `json:"attempt_number"`
	Input         map[string]any `json:"input"`
	Output        map[string]any `json:"output"`
	Error         map[string]any `json:"error,omitempty"`
	StartedAt     time.Time      `json:"started_at"`
	FinishedAt    *time.Time     `json:"finished_at"`
}

type RunStepBrief struct {
	ID       string `json:"id"`
	StepType string `json:"step_type"`
	Title    string `json:"title"`
	Status   string `json:"status"`
}

func (db *DB) SendChat(ctx context.Context, params SendChatParams) (*SendChatResult, error) {
	channel := valueOrDefault(params.Channel, "web")
	userID := valueOrDefault(params.UserID, "default_user")
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	routeDecision, err := routeMessage(ctx, tx, params.ConversationID, params.Message)
	if err != nil {
		return nil, err
	}
	selectedAgentID := routeDecision.AgentID

	conversationID := params.ConversationID
	if conversationID == "" {
		conversationID, err = NewID("conv_")
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `
			INSERT INTO conversations (id, channel, user_id, active_agent_id, title)
			VALUES ($1, $2, $3, $4, $5)
		`, conversationID, channel, userID, nullableAgentID(ctx, tx, selectedAgentID), truncateTitle(params.Message)); err != nil {
			return nil, err
		}
	} else {
		if _, err = tx.ExecContext(ctx, `
			UPDATE conversations
			SET active_agent_id = $2, updated_at = NOW()
			WHERE id = $1
		`, conversationID, nullableAgentID(ctx, tx, selectedAgentID)); err != nil {
			return nil, err
		}
	}

	userMessageID, err := NewID("msg_")
	if err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO messages (id, conversation_id, role, content)
		VALUES ($1, $2, 'user', $3)
	`, userMessageID, conversationID, params.Message); err != nil {
		return nil, err
	}

	runID, err := NewID("run_")
	if err != nil {
		return nil, err
	}
	routeResult := map[string]any{
		"intent":         routeDecision.Intent,
		"route_mode":     "single",
		"lead_agent":     selectedAgentID,
		"support_agents": []string{},
		"capabilities":   routeDecision.Capabilities,
		"confidence":     routeDecision.Confidence,
		"reason":         routeDecision.Reason,
		"route_source":   routeDecision.Source,
	}
	routeJSON, err := json.Marshal(routeResult)
	if err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO runs (id, conversation_id, user_message_id, status, selected_agent_id, route_result, finished_at, duration_ms)
		VALUES ($1, $2, $3, 'succeeded', $4, $5, NOW(), 0)
	`, runID, conversationID, userMessageID, nullableAgentID(ctx, tx, selectedAgentID), routeJSON); err != nil {
		return nil, err
	}

	assembly, err := createPromptAssembly(ctx, tx, PromptAssemblyInput{
		RunID:             runID,
		AgentID:           selectedAgentID,
		UserMessage:       params.Message,
		RouteResult:       routeResult,
		ToolSchemaVersion: "tool_schema_v1",
	})
	if err != nil {
		return nil, err
	}
	agentResult, err := runAgentRuntime(ctx, tx, *assembly, AgentRuntimeInput{
		RunID:         runID,
		AgentID:       selectedAgentID,
		UserMessage:   params.Message,
		RouteResult:   routeResult,
		PreferredNode: params.PreferredNode,
		AllowWorker:   params.AllowWorker,
	})
	if err != nil {
		return nil, err
	}
	response := agentResult.FinalAnswer
	if response == "" {
		response = "Agent Runtime did not produce a final answer."
	}

	stepDefs := []stepDefinition{
		{"input_received", "Input received", map[string]any{"message": params.Message, "channel": channel}, map[string]any{"conversation_id": conversationID, "message_id": userMessageID}},
		{"router_selected", "Router selected agent", map[string]any{"message": params.Message, "conversation_id": conversationID}, routeResult},
		{"memory_search_finished", "Memory search finished", map[string]any{"query": params.Message}, map[string]any{"context_pack": []any{}, "retrieved_memory_ids": []any{}}},
		{"prompt_assembled", "Prompt assembly finished", map[string]any{"run_id": runID, "agent_id": selectedAgentID}, map[string]any{"prompt_assembly_id": assembly.ID, "prefix_hash": assembly.PrefixHash, "dynamic_tail_hash": assembly.DynamicTailHash, "prompt_cache_key": assembly.PromptCacheKey, "memory_profile_version": assembly.MemoryProfileVersion, "tool_schema_version": assembly.ToolSchemaVersion}},
		{"agent_call_finished", "Agent runtime finished", map[string]any{"agent_id": selectedAgentID}, map[string]any{"response": response, "turns": agentResult.Turns, "model_calls": agentResult.ModelCalls, "capability_requests": agentResult.CapabilityRequests}},
		{"response_generated", "Response generated", map[string]any{"run_id": runID}, map[string]any{"response": response}},
	}
	stepDefs = append(stepDefs[:4], append(agentResult.TraceSteps, stepDefs[4:]...)...)

	steps := make([]RunStepBrief, 0, len(stepDefs))
	for _, step := range stepDefs {
		stepID, err := NewID("step_")
		if err != nil {
			return nil, err
		}
		inputJSON, err := json.Marshal(step.input)
		if err != nil {
			return nil, err
		}
		outputJSON, err := json.Marshal(step.output)
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `
			INSERT INTO run_steps (id, run_id, step_type, title, status, input, output, finished_at, duration_ms)
			VALUES ($1, $2, $3, $4, 'succeeded', $5, $6, NOW(), 0)
		`, stepID, runID, step.stepType, step.title, inputJSON, outputJSON); err != nil {
			return nil, err
		}
		steps = append(steps, RunStepBrief{ID: stepID, StepType: step.stepType, Title: step.title, Status: "succeeded"})
	}

	assistantMessageID, err := NewID("msg_")
	if err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO messages (id, conversation_id, role, content, metadata)
		VALUES ($1, $2, 'assistant', $3, $4)
	`, assistantMessageID, conversationID, response, mustJSON(map[string]any{"run_id": runID, "agent_id": selectedAgentID})); err != nil {
		return nil, err
	}

	if err = tx.Commit(); err != nil {
		return nil, err
	}

	return &SendChatResult{
		ConversationID:     conversationID,
		UserMessageID:      userMessageID,
		AssistantMessageID: assistantMessageID,
		RunID:              runID,
		SelectedAgentID:    selectedAgentID,
		Response:           response,
		Steps:              steps,
	}, nil
}

func (db *DB) GetRun(ctx context.Context, runID string) (*RunRecord, error) {
	var run RunRecord
	var routeRaw []byte
	var metadataRaw []byte
	var selectedAgentID sql.NullString
	var finishedAt sql.NullTime
	var durationMs sql.NullInt32
	var errorCode sql.NullString
	var errorMessage sql.NullString

	err := db.sql.QueryRowContext(ctx, `
		SELECT id, conversation_id, user_message_id, status, selected_agent_id, route_result,
		       started_at, finished_at, duration_ms, error_code, error_message, metadata, created_at
		FROM runs
		WHERE id = $1
	`, runID).Scan(
		&run.ID,
		&run.ConversationID,
		&run.UserMessageID,
		&run.Status,
		&selectedAgentID,
		&routeRaw,
		&run.StartedAt,
		&finishedAt,
		&durationMs,
		&errorCode,
		&errorMessage,
		&metadataRaw,
		&run.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	run.SelectedAgentID = selectedAgentID.String
	run.FinishedAt = nullTimePtr(finishedAt)
	run.DurationMs = nullIntPtr(durationMs)
	run.ErrorCode = nullStringPtr(errorCode)
	run.ErrorMessage = nullStringPtr(errorMessage)
	run.RouteResult = decodeObject(routeRaw)
	run.Metadata = decodeObject(metadataRaw)
	run.PromptAssemblies, _ = db.ListPromptAssemblies(ctx, runID)
	run.ModelCalls, _ = db.ListModelCalls(ctx, runID)
	run.MemoryContextPacks, _ = db.ListMemoryContextPacks(ctx, runID)
	run.Steps, _ = db.ListRunSteps(ctx, runID)
	run.Tasks, _ = db.ListRunTasks(ctx, runID)
	return &run, nil
}

func (db *DB) ListRunSteps(ctx context.Context, runID string) ([]RunStepRecord, error) {
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, run_id, step_type, title, status, input, output, error,
		       started_at, finished_at, duration_ms, created_at
		FROM run_steps
		WHERE run_id = $1
		ORDER BY created_at ASC
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var steps []RunStepRecord
	for rows.Next() {
		var step RunStepRecord
		var inputRaw []byte
		var outputRaw []byte
		var errorRaw []byte
		var finishedAt sql.NullTime
		var durationMs sql.NullInt32

		if err := rows.Scan(
			&step.ID,
			&step.RunID,
			&step.StepType,
			&step.Title,
			&step.Status,
			&inputRaw,
			&outputRaw,
			&errorRaw,
			&step.StartedAt,
			&finishedAt,
			&durationMs,
			&step.CreatedAt,
		); err != nil {
			return nil, err
		}

		step.Input = decodeObject(inputRaw)
		step.Output = decodeObject(outputRaw)
		step.Error = decodeObject(errorRaw)
		step.FinishedAt = nullTimePtr(finishedAt)
		step.DurationMs = nullIntPtr(durationMs)
		steps = append(steps, step)
	}

	return steps, rows.Err()
}

func (db *DB) ListRunTasks(ctx context.Context, runID string) ([]TaskRecord, error) {
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, COALESCE(run_id, ''), capability_id, COALESCE(preferred_node_id, ''),
		       COALESCE(assigned_node_id, ''), privacy_level, status, payload, result, error,
		       created_at, started_at, finished_at
		FROM tasks
		WHERE run_id = $1
		ORDER BY created_at ASC
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tasks := []TaskRecord{}
	for rows.Next() {
		var task TaskRecord
		var payloadRaw, resultRaw, errorRaw []byte
		var startedAt, finishedAt sql.NullTime
		if err := rows.Scan(&task.ID, &task.RunID, &task.CapabilityID, &task.PreferredNodeID, &task.AssignedNodeID, &task.PrivacyLevel, &task.Status, &payloadRaw, &resultRaw, &errorRaw, &task.CreatedAt, &startedAt, &finishedAt); err != nil {
			return nil, err
		}
		task.Payload = decodeObject(payloadRaw)
		task.Result = decodeObject(resultRaw)
		task.Error = decodeObject(errorRaw)
		task.StartedAt = nullTimePtr(startedAt)
		task.FinishedAt = nullTimePtr(finishedAt)
		task.Attempts, _ = db.ListTaskAttempts(ctx, task.ID)
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func (db *DB) ListTaskAttempts(ctx context.Context, taskID string) ([]TaskAttemptRecord, error) {
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, task_id, COALESCE(node_id, ''), status, attempt_number, input, output, error, started_at, finished_at
		FROM task_attempts
		WHERE task_id = $1
		ORDER BY attempt_number ASC, started_at ASC
	`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	attempts := []TaskAttemptRecord{}
	for rows.Next() {
		var attempt TaskAttemptRecord
		var inputRaw, outputRaw, errorRaw []byte
		var finishedAt sql.NullTime
		if err := rows.Scan(&attempt.ID, &attempt.TaskID, &attempt.NodeID, &attempt.Status, &attempt.AttemptNumber, &inputRaw, &outputRaw, &errorRaw, &attempt.StartedAt, &finishedAt); err != nil {
			return nil, err
		}
		attempt.Input = decodeObject(inputRaw)
		attempt.Output = decodeObject(outputRaw)
		attempt.Error = decodeObject(errorRaw)
		attempt.FinishedAt = nullTimePtr(finishedAt)
		attempts = append(attempts, attempt)
	}
	return attempts, rows.Err()
}

func valueOrDefault(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func truncateTitle(message string) string {
	const limit = 80
	if len([]rune(message)) <= limit {
		return message
	}
	runes := []rune(message)
	return string(runes[:limit])
}

func mustJSON(value any) []byte {
	raw, err := json.Marshal(value)
	if err != nil {
		return []byte(`{}`)
	}
	return raw
}

func decodeObject(raw []byte) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return map[string]any{}
	}
	if value == nil {
		return map[string]any{}
	}
	return value
}

func nullTimePtr(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}

func nullIntPtr(value sql.NullInt32) *int {
	if !value.Valid {
		return nil
	}
	intValue := int(value.Int32)
	return &intValue
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

type routeDecision struct {
	AgentID      string
	Intent       string
	Capabilities []string
	Confidence   float64
	Reason       string
	Source       string
}

func routeMessage(ctx context.Context, tx *sql.Tx, conversationID string, message string) (routeDecision, error) {
	agents, err := listEnabledAgentsForRoute(ctx, tx)
	if err != nil {
		return routeDecision{}, err
	}

	if agentID := explicitAgent(message, agents); agentID != "" {
		return decisionForAgent(agents[agentID], "explicit_agent", 0.99, "用户使用 @agent 显式指定。"), nil
	}

	if agentID := keywordAgent(message, agents); agentID != "" {
		return decisionForAgent(agents[agentID], "keyword_rules", 0.85, "命中 Agent route_hints 关键词。"), nil
	}

	if conversationID != "" {
		activeAgentID, err := activeAgentForConversation(ctx, tx, conversationID)
		if err != nil {
			return routeDecision{}, err
		}
		if activeAgentID != "" {
			if agent, ok := agents[activeAgentID]; ok {
				return decisionForAgent(agent, "session_active_agent", 0.7, "沿用 conversation active_agent。"), nil
			}
		}
	}

	return decisionForAgent(agents["general_agent"], "default", 0.5, "未命中显式路由或关键词，默认选择 general_agent。"), nil
}

func listEnabledAgentsForRoute(ctx context.Context, tx *sql.Tx) (map[string]AgentRecord, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT id, name, description, default_model_id, fallback_model_id, cheap_model_id,
		       capabilities, tool_policy, route_hints, enabled
		FROM agents
		WHERE enabled = TRUE
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	agents := map[string]AgentRecord{}
	for rows.Next() {
		var agent AgentRecord
		var capabilitiesRaw []byte
		var toolPolicyRaw []byte
		var routeHintsRaw []byte
		var defaultModelID sql.NullString
		var fallbackModelID sql.NullString
		var cheapModelID sql.NullString
		if err := rows.Scan(&agent.ID, &agent.Name, &agent.Description, &defaultModelID, &fallbackModelID, &cheapModelID, &capabilitiesRaw, &toolPolicyRaw, &routeHintsRaw, &agent.Enabled); err != nil {
			return nil, err
		}
		agent.DefaultModelID = defaultModelID.String
		agent.FallbackModelID = fallbackModelID.String
		agent.CheapModelID = cheapModelID.String
		_ = json.Unmarshal(capabilitiesRaw, &agent.Capabilities)
		agent.ToolPolicy = decodeObject(toolPolicyRaw)
		agent.RouteHints = decodeObject(routeHintsRaw)
		agents[agent.ID] = agent
	}
	if _, ok := agents["general_agent"]; !ok {
		agents["general_agent"] = AgentRecord{ID: "general_agent", Capabilities: []string{"memory_search", "workspace_search", "file_read", "file_analyze", "apply_patch", "shell_command", "test_command", "browser_observe", "browser_navigate", "browser_click", "browser_type", "computer_observe"}}
	}
	return agents, rows.Err()
}

func explicitAgent(message string, agents map[string]AgentRecord) string {
	aliases := map[string]string{
		"@general":        "general_agent",
		"@general_agent":  "general_agent",
		"@product":        "product_agent",
		"@product_agent":  "product_agent",
		"@devops":         "devops_agent",
		"@devops_agent":   "devops_agent",
		"@research":       "research_agent",
		"@research_agent": "research_agent",
		"@memory":         "memory_agent",
		"@memory_agent":   "memory_agent",
	}
	lowerMessage := strings.ToLower(message)
	for alias, agentID := range aliases {
		if strings.Contains(lowerMessage, alias) {
			if _, ok := agents[agentID]; ok {
				return agentID
			}
		}
	}
	return ""
}

func keywordAgent(message string, agents map[string]AgentRecord) string {
	lowerMessage := strings.ToLower(message)
	if strings.Contains(lowerMessage, "/joi_status") || strings.Contains(lowerMessage, "joi status") || strings.Contains(lowerMessage, "joi 自检") || strings.Contains(lowerMessage, "system health") || strings.Contains(message, "自检") || strings.Contains(message, "健康检查") {
		if _, ok := agents["devops_agent"]; ok {
			return "devops_agent"
		}
	}
	if strings.Contains(lowerMessage, "http://") || strings.Contains(lowerMessage, "https://") {
		if _, ok := agents["research_agent"]; ok {
			return "research_agent"
		}
	}
	if strings.Contains(message, "服务") || strings.Contains(message, "容器") || strings.Contains(message, "是否正常") {
		if _, ok := agents["devops_agent"]; ok {
			return "devops_agent"
		}
	}
	for _, agentID := range []string{"memory_agent", "devops_agent", "product_agent", "research_agent"} {
		agent, ok := agents[agentID]
		if !ok {
			continue
		}
		keywords, ok := agent.RouteHints["keywords"].([]any)
		if !ok {
			continue
		}
		for _, keyword := range keywords {
			keywordText, ok := keyword.(string)
			if ok && keywordText != "" && strings.Contains(lowerMessage, strings.ToLower(keywordText)) {
				return agentID
			}
		}
	}
	return ""
}

func activeAgentForConversation(ctx context.Context, tx *sql.Tx, conversationID string) (string, error) {
	var activeAgentID sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT active_agent_id FROM conversations WHERE id = $1`, conversationID).Scan(&activeAgentID)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", err
	}
	return activeAgentID.String, nil
}

func decisionForAgent(agent AgentRecord, source string, confidence float64, reason string) routeDecision {
	intent := "general_chat"
	if agent.ID == "devops_agent" {
		intent = "server_diagnosis"
	}
	if agent.ID == "product_agent" {
		intent = "product_design"
	}
	if agent.ID == "research_agent" {
		intent = "research"
	}
	if agent.ID == "memory_agent" {
		intent = "memory_management"
	}
	capabilities := agent.Capabilities
	if len(capabilities) == 0 {
		capabilities = []string{"memory_search"}
	}
	return routeDecision{
		AgentID:      agent.ID,
		Intent:       intent,
		Capabilities: capabilities,
		Confidence:   confidence,
		Reason:       reason,
		Source:       source,
	}
}
