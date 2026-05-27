package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

type PromptAssemblyInput struct {
	RunID             string
	AgentID           string
	UserMessage       string
	RouteResult       map[string]any
	ToolSchemaVersion string
	DynamicContext    string
	MemoryResults     []MemorySearchResult
}

func createPromptAssembly(ctx context.Context, tx *sql.Tx, input PromptAssemblyInput) (*PromptAssemblyRecord, error) {
	modelID := "model_default"
	var agentName string
	var description string
	var capabilitiesRaw []byte
	var systemPrompt string
	var defaultModelID sql.NullString
	if err := tx.QueryRowContext(ctx, `
		SELECT name, description, system_prompt, default_model_id, capabilities
		FROM agents
		WHERE id = $1
	`, input.AgentID).Scan(&agentName, &description, &systemPrompt, &defaultModelID, &capabilitiesRaw); err != nil {
		return nil, err
	}
	if defaultModelID.Valid && defaultModelID.String != "" {
		modelID = defaultModelID.String
	}

	contextPack, memoryProfileVersion, err := buildMemoryContextPackData(ctx, tx, input.MemoryResults)
	if err != nil {
		return nil, err
	}
	toolSchemaVersion := valueOrDefault(input.ToolSchemaVersion, "tool_schema_v1")
	contextPackID, err := NewID("ctxpack_")
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO memory_context_packs (id, run_id, agent_id, memory_profile_version, profile, project_facts, relevant_episodes, heuristics, anti_patterns, open_issues, dynamic_retrieval, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, contextPackID, input.RunID, input.AgentID, memoryProfileVersion, mustJSON(contextPack.Profile), mustJSON(contextPack.ProjectFacts), mustJSON(contextPack.RelevantEpisodes), mustJSON(contextPack.Heuristics), mustJSON(contextPack.AntiPatterns), mustJSON(contextPack.OpenIssues), mustJSON(contextPack.DynamicRetrieval), mustJSON(map[string]any{"source": "prompt_assembly_v1"})); err != nil {
		return nil, err
	}

	templateID, err := ensurePromptTemplate(ctx, tx, input.AgentID)
	if err != nil {
		return nil, err
	}

	cacheablePrefix := fmt.Sprintf(`Agent OS Runtime Rules
- Orchestrator Core is code, not an LLM.
- Agent is a role; model is an execution engine.
- The model must only output one JSON object with output_type: final_answer, capability_request, or memory_write_proposal.
- final_answer schema: {"output_type":"final_answer","content":"..."}.
- capability_request schema: {"output_type":"capability_request","capability":"memory_search|server_diagnose|system_health_check|web_research|browser_read|workspace_search|file_analyze|desktop_app_list|desktop_app_inspect|computer_observe","goal":"...","inputs":{...},"risk":"read_only","confidence":0.0}.
- memory_write_proposal schema: {"output_type":"memory_write_proposal","memory":{"type":"...","content":"...","confidence":0.0}}.
- The model must not output raw shell, SQL, file_write, service_restart, restart, stop, rm, delete, chmod, or chown for execution.
- Tool access is only through capability_request and deterministic Tool Compiler.
- If the user asks whether a container, service, port, or server is healthy and server_diagnose is available, request server_diagnose instead of answering from memory.
- If the user provides an http/https URL and web_research is available, request web_research with inputs.url.
- If the user asks about prior preferences or deployment memories and memory_search is available, request memory_search.
- If the user asks for Joi self check or system health and system_health_check is available, request system_health_check.

Agent
id: %s
name: %s
description: %s
system_prompt: %s
capabilities: %s

Stable Memory Profile
version: %s
profile: %s
project_facts: %s
heuristics: %s
anti_patterns: %s
open_issues: %s

Tool Schema Version
%s
`, input.AgentID, RedactSensitiveText(agentName), RedactSensitiveText(description), RedactSensitiveText(systemPrompt), string(capabilitiesRaw), memoryProfileVersion, string(mustJSON(SanitizeForTrace(contextPack.Profile))), string(mustJSON(SanitizeForTrace(contextPack.ProjectFacts))), string(mustJSON(SanitizeForTrace(contextPack.Heuristics))), string(mustJSON(SanitizeForTrace(contextPack.AntiPatterns))), string(mustJSON(SanitizeForTrace(contextPack.OpenIssues))), toolSchemaVersion)

	routeRaw, _ := json.Marshal(input.RouteResult)
	dynamicTail := fmt.Sprintf(`Current Run
run_id: %s
agent_id: %s
route_result: %s

User Message
%s

Dynamic Context
%s

Dynamic Memory Retrieval
%s

Return JSON only.
`, input.RunID, input.AgentID, string(routeRaw), RedactSensitiveText(input.UserMessage), RedactSensitiveText(input.DynamicContext), string(mustJSON(SanitizeForTrace(contextPack.DynamicRetrieval))))

	prefixHash := sha256Hex(cacheablePrefix)
	dynamicTailHash := sha256Hex(dynamicTail)
	promptCacheKey := fmt.Sprintf("%s:%s:%s:%s:%s", input.AgentID, modelID, prefixHash, memoryProfileVersion, toolSchemaVersion)

	assemblyID, err := NewID("promptasm_")
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO prompt_assemblies (id, run_id, agent_id, model_id, prompt_template_id, memory_context_pack_id, cacheable_prefix, dynamic_tail, prefix_hash, dynamic_tail_hash, prompt_cache_key, memory_profile_version, tool_schema_version, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
	`, assemblyID, input.RunID, input.AgentID, modelID, templateID, contextPackID, cacheablePrefix, dynamicTail, prefixHash, dynamicTailHash, promptCacheKey, memoryProfileVersion, toolSchemaVersion, mustJSON(map[string]any{"assembly_version": "v0"})); err != nil {
		return nil, err
	}

	return &PromptAssemblyRecord{
		ID:                   assemblyID,
		RunID:                input.RunID,
		AgentID:              input.AgentID,
		ModelID:              modelID,
		PromptTemplateID:     templateID,
		MemoryContextPackID:  contextPackID,
		CacheablePrefix:      cacheablePrefix,
		DynamicTail:          dynamicTail,
		PrefixHash:           prefixHash,
		DynamicTailHash:      dynamicTailHash,
		PromptCacheKey:       promptCacheKey,
		MemoryProfileVersion: memoryProfileVersion,
		ToolSchemaVersion:    toolSchemaVersion,
		Metadata:             map[string]any{"assembly_version": "v0"},
	}, nil
}

func ensurePromptTemplate(ctx context.Context, tx *sql.Tx, agentID string) (string, error) {
	templateID := "prompttpl_agent_runtime_v1_" + agentID
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO prompt_templates (id, name, version, agent_id, template_type, cache_policy, content, enabled, metadata)
		VALUES ($1, 'agent_runtime', 'v1', $2, 'agent_runtime', $3, $4, TRUE, $5)
		ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
	`, templateID, agentID, mustJSON(map[string]any{"split": "cacheable_prefix_dynamic_tail"}), "Agent runtime JSON-only template with cacheable prefix and dynamic tail.", mustJSON(map[string]any{"source": "orchestrator"})); err != nil {
		return "", err
	}
	return templateID, nil
}

func sha256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

type memoryContextPackData struct {
	Profile          []MemorySearchResult
	ProjectFacts     []MemorySearchResult
	RelevantEpisodes []MemorySearchResult
	Heuristics       []MemorySearchResult
	AntiPatterns     []MemorySearchResult
	OpenIssues       []MemorySearchResult
	DynamicRetrieval []MemorySearchResult
}

func buildMemoryContextPackData(ctx context.Context, tx *sql.Tx, dynamic []MemorySearchResult) (memoryContextPackData, string, error) {
	if dynamic == nil {
		dynamic = []MemorySearchResult{}
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT id, type, content, summary, scope_type, scope_id, privacy_level, confidence, status,
		       source_event_ids, entities, success_count, failure_count, usage_count, positive_feedback,
		       negative_feedback, metadata, created_at, updated_at, last_used_at, pinned, disabled_at,
		       merged_into_memory_id, conflict_group_id, conflict_reason
		FROM memories
		WHERE status = 'confirmed'
		  AND disabled_at IS NULL
		  AND merged_into_memory_id IS NULL
		ORDER BY pinned DESC, confidence DESC, updated_at DESC
		LIMIT 30
	`)
	if err != nil {
		return memoryContextPackData{}, "", err
	}
	defer rows.Close()
	memories, err := scanMemories(rows)
	if err != nil {
		return memoryContextPackData{}, "", err
	}

	pack := memoryContextPackData{
		Profile:          []MemorySearchResult{},
		ProjectFacts:     []MemorySearchResult{},
		RelevantEpisodes: []MemorySearchResult{},
		Heuristics:       []MemorySearchResult{},
		AntiPatterns:     []MemorySearchResult{},
		OpenIssues:       []MemorySearchResult{},
		DynamicRetrieval: dynamic,
	}
	var newest time.Time
	for _, memory := range memories {
		result := MemorySearchResult{Memory: memory, Score: memory.Confidence, Reason: "stable profile"}
		if memory.UpdatedAt.After(newest) {
			newest = memory.UpdatedAt
		}
		switch memory.Type {
		case "user_preference":
			pack.Profile = append(pack.Profile, result)
		case "project_fact":
			pack.ProjectFacts = append(pack.ProjectFacts, result)
		case "episode", "outcome":
			pack.RelevantEpisodes = append(pack.RelevantEpisodes, result)
		case "heuristic":
			pack.Heuristics = append(pack.Heuristics, result)
		case "anti_pattern":
			pack.AntiPatterns = append(pack.AntiPatterns, result)
		case "unresolved_issue":
			pack.OpenIssues = append(pack.OpenIssues, result)
		}
	}
	versionSource := fmt.Sprintf("%d:%s", len(memories), newest.UTC().Format(time.RFC3339Nano))
	return pack, "profile_" + sha256Hex(versionSource)[:12], nil
}
