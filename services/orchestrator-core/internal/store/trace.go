package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

type PromptAssemblyRecord struct {
	ID                   string         `json:"id"`
	RunID                string         `json:"run_id"`
	AgentID              string         `json:"agent_id"`
	ModelID              string         `json:"model_id"`
	PromptTemplateID     string         `json:"prompt_template_id"`
	MemoryContextPackID  string         `json:"memory_context_pack_id"`
	CacheablePrefix      string         `json:"cacheable_prefix"`
	DynamicTail          string         `json:"dynamic_tail"`
	PrefixHash           string         `json:"prefix_hash"`
	DynamicTailHash      string         `json:"dynamic_tail_hash"`
	PromptCacheKey       string         `json:"prompt_cache_key"`
	MemoryProfileVersion string         `json:"memory_profile_version"`
	ToolSchemaVersion    string         `json:"tool_schema_version"`
	Metadata             map[string]any `json:"metadata"`
	CreatedAt            time.Time      `json:"created_at"`
}

type ModelCallRecord struct {
	ID                    string         `json:"id"`
	RunID                 string         `json:"run_id"`
	AgentID               string         `json:"agent_id"`
	ModelID               string         `json:"model_id"`
	PromptAssemblyID      string         `json:"prompt_assembly_id"`
	Provider              string         `json:"provider"`
	ModelName             string         `json:"model_name"`
	PromptCacheKey        string         `json:"prompt_cache_key"`
	PrefixHash            string         `json:"prefix_hash"`
	DynamicTailHash       string         `json:"dynamic_tail_hash"`
	InputTokens           int            `json:"input_tokens"`
	OutputTokens          int            `json:"output_tokens"`
	CacheablePrefixTokens int            `json:"cacheable_prefix_tokens"`
	DynamicTailTokens     int            `json:"dynamic_tail_tokens"`
	CachedInputTokens     int            `json:"cached_input_tokens"`
	LatencyMs             int            `json:"latency_ms"`
	Status                string         `json:"status"`
	ErrorCode             string         `json:"error_code"`
	ErrorMessage          string         `json:"error_message"`
	RawResponse           map[string]any `json:"raw_response"`
	Metadata              map[string]any `json:"metadata"`
	CreatedAt             time.Time      `json:"created_at"`
}

type MemoryContextPackRecord struct {
	ID                   string         `json:"id"`
	RunID                string         `json:"run_id"`
	AgentID              string         `json:"agent_id"`
	MemoryProfileVersion string         `json:"memory_profile_version"`
	Profile              []any          `json:"profile"`
	ProjectFacts         []any          `json:"project_facts"`
	RelevantEpisodes     []any          `json:"relevant_episodes"`
	Heuristics           []any          `json:"heuristics"`
	AntiPatterns         []any          `json:"anti_patterns"`
	OpenIssues           []any          `json:"open_issues"`
	DynamicRetrieval     []any          `json:"dynamic_retrieval"`
	Metadata             map[string]any `json:"metadata"`
	CreatedAt            time.Time      `json:"created_at"`
}

type ProviderCacheStatRecord struct {
	ID                string         `json:"id"`
	Provider          string         `json:"provider"`
	ModelID           string         `json:"model_id"`
	ModelName         string         `json:"model_name"`
	PromptCacheKey    string         `json:"prompt_cache_key"`
	PrefixHash        string         `json:"prefix_hash"`
	DynamicTailHash   string         `json:"dynamic_tail_hash"`
	InputTokens       int            `json:"input_tokens"`
	CachedInputTokens int            `json:"cached_input_tokens"`
	HitRatio          float64        `json:"hit_ratio"`
	LatencyMs         int            `json:"latency_ms"`
	Metadata          map[string]any `json:"metadata"`
	CreatedAt         time.Time      `json:"created_at"`
}

func (db *DB) ListPromptAssemblies(ctx context.Context, runID string) ([]PromptAssemblyRecord, error) {
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, run_id, agent_id, model_id, prompt_template_id, memory_context_pack_id,
		       cacheable_prefix, dynamic_tail, prefix_hash, dynamic_tail_hash, prompt_cache_key,
		       memory_profile_version, tool_schema_version, metadata, created_at
		FROM prompt_assemblies
		WHERE run_id = $1
		ORDER BY created_at ASC
	`, runID)
	if err != nil {
		return []PromptAssemblyRecord{}, nil
	}
	defer rows.Close()

	records := []PromptAssemblyRecord{}
	for rows.Next() {
		var record PromptAssemblyRecord
		var agentID, modelID, promptTemplateID, memoryContextPackID sql.NullString
		var metadataRaw []byte
		if err := rows.Scan(&record.ID, &record.RunID, &agentID, &modelID, &promptTemplateID, &memoryContextPackID, &record.CacheablePrefix, &record.DynamicTail, &record.PrefixHash, &record.DynamicTailHash, &record.PromptCacheKey, &record.MemoryProfileVersion, &record.ToolSchemaVersion, &metadataRaw, &record.CreatedAt); err != nil {
			return nil, err
		}
		record.AgentID = agentID.String
		record.ModelID = modelID.String
		record.PromptTemplateID = promptTemplateID.String
		record.MemoryContextPackID = memoryContextPackID.String
		record.Metadata = decodeObject(metadataRaw)
		records = append(records, record)
	}
	return records, rows.Err()
}

func (db *DB) ListModelCalls(ctx context.Context, runID string) ([]ModelCallRecord, error) {
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name,
		       prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, output_tokens,
		       cacheable_prefix_tokens, dynamic_tail_tokens, cached_input_tokens, latency_ms,
		       status, error_code, error_message, raw_response, metadata, created_at
		FROM model_calls
		WHERE run_id = $1
		ORDER BY created_at ASC
	`, runID)
	if err != nil {
		return []ModelCallRecord{}, nil
	}
	defer rows.Close()
	return scanModelCallRows(rows)
}

func (db *DB) ListRecentModelCalls(ctx context.Context, limit int) ([]ModelCallRecord, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name,
		       prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, output_tokens,
		       cacheable_prefix_tokens, dynamic_tail_tokens, cached_input_tokens, latency_ms,
		       status, error_code, error_message, raw_response, metadata, created_at
		FROM model_calls
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanModelCallRows(rows)
}

func scanModelCallRows(rows *sql.Rows) ([]ModelCallRecord, error) {
	records := []ModelCallRecord{}
	for rows.Next() {
		var record ModelCallRecord
		var runIDValue, agentID, modelID, promptAssemblyID, provider, modelName, promptCacheKey, prefixHash, dynamicTailHash, errorCode, errorMessage sql.NullString
		var inputTokens, outputTokens, cacheablePrefixTokens, dynamicTailTokens, cachedInputTokens, latencyMs sql.NullInt32
		var rawResponseRaw, metadataRaw []byte
		if err := rows.Scan(&record.ID, &runIDValue, &agentID, &modelID, &promptAssemblyID, &provider, &modelName, &promptCacheKey, &prefixHash, &dynamicTailHash, &inputTokens, &outputTokens, &cacheablePrefixTokens, &dynamicTailTokens, &cachedInputTokens, &latencyMs, &record.Status, &errorCode, &errorMessage, &rawResponseRaw, &metadataRaw, &record.CreatedAt); err != nil {
			return nil, err
		}
		record.RunID = runIDValue.String
		record.AgentID = agentID.String
		record.ModelID = modelID.String
		record.PromptAssemblyID = promptAssemblyID.String
		record.Provider = provider.String
		record.ModelName = modelName.String
		record.PromptCacheKey = promptCacheKey.String
		record.PrefixHash = prefixHash.String
		record.DynamicTailHash = dynamicTailHash.String
		record.InputTokens = int(inputTokens.Int32)
		record.OutputTokens = int(outputTokens.Int32)
		record.CacheablePrefixTokens = int(cacheablePrefixTokens.Int32)
		record.DynamicTailTokens = int(dynamicTailTokens.Int32)
		record.CachedInputTokens = int(cachedInputTokens.Int32)
		record.LatencyMs = int(latencyMs.Int32)
		record.ErrorCode = errorCode.String
		record.ErrorMessage = errorMessage.String
		record.RawResponse = decodeObject(rawResponseRaw)
		record.Metadata = decodeObject(metadataRaw)
		records = append(records, record)
	}
	return records, rows.Err()
}

func (db *DB) ListProviderCacheStats(ctx context.Context, limit int) ([]ProviderCacheStatRecord, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, provider, model_id, model_name, prompt_cache_key, prefix_hash, dynamic_tail_hash,
		       input_tokens, cached_input_tokens, hit_ratio, latency_ms, metadata, created_at
		FROM provider_cache_stats
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := []ProviderCacheStatRecord{}
	for rows.Next() {
		var record ProviderCacheStatRecord
		var modelID sql.NullString
		var metadataRaw []byte
		if err := rows.Scan(&record.ID, &record.Provider, &modelID, &record.ModelName, &record.PromptCacheKey, &record.PrefixHash, &record.DynamicTailHash, &record.InputTokens, &record.CachedInputTokens, &record.HitRatio, &record.LatencyMs, &metadataRaw, &record.CreatedAt); err != nil {
			return nil, err
		}
		record.ModelID = modelID.String
		record.Metadata = decodeObject(metadataRaw)
		records = append(records, record)
	}
	return records, rows.Err()
}

func (db *DB) ListMemoryContextPacks(ctx context.Context, runID string) ([]MemoryContextPackRecord, error) {
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, run_id, agent_id, memory_profile_version, profile, project_facts,
		       relevant_episodes, heuristics, anti_patterns, open_issues, dynamic_retrieval,
		       metadata, created_at
		FROM memory_context_packs
		WHERE run_id = $1
		ORDER BY created_at ASC
	`, runID)
	if err != nil {
		return []MemoryContextPackRecord{}, nil
	}
	defer rows.Close()

	records := []MemoryContextPackRecord{}
	for rows.Next() {
		var record MemoryContextPackRecord
		var agentID sql.NullString
		var profileRaw, projectFactsRaw, relevantEpisodesRaw, heuristicsRaw, antiPatternsRaw, openIssuesRaw, dynamicRetrievalRaw, metadataRaw []byte
		if err := rows.Scan(&record.ID, &record.RunID, &agentID, &record.MemoryProfileVersion, &profileRaw, &projectFactsRaw, &relevantEpisodesRaw, &heuristicsRaw, &antiPatternsRaw, &openIssuesRaw, &dynamicRetrievalRaw, &metadataRaw, &record.CreatedAt); err != nil {
			return nil, err
		}
		record.AgentID = agentID.String
		record.Profile = decodeArray(profileRaw)
		record.ProjectFacts = decodeArray(projectFactsRaw)
		record.RelevantEpisodes = decodeArray(relevantEpisodesRaw)
		record.Heuristics = decodeArray(heuristicsRaw)
		record.AntiPatterns = decodeArray(antiPatternsRaw)
		record.OpenIssues = decodeArray(openIssuesRaw)
		record.DynamicRetrieval = decodeArray(dynamicRetrievalRaw)
		record.Metadata = decodeObject(metadataRaw)
		records = append(records, record)
	}
	return records, rows.Err()
}

func decodeArray(raw []byte) []any {
	if len(raw) == 0 {
		return []any{}
	}
	var value []any
	if err := json.Unmarshal(raw, &value); err != nil {
		return []any{}
	}
	if value == nil {
		return []any{}
	}
	return value
}
