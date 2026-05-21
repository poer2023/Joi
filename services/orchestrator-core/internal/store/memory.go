package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

type MemoryRecord struct {
	ID                 string                 `json:"id"`
	Type               string                 `json:"type"`
	Content            string                 `json:"content"`
	Summary            string                 `json:"summary"`
	ScopeType          string                 `json:"scope_type"`
	ScopeID            string                 `json:"scope_id"`
	PrivacyLevel       string                 `json:"privacy_level"`
	Confidence         float64                `json:"confidence"`
	Status             string                 `json:"status"`
	SourceEventIDs     []string               `json:"source_event_ids"`
	Entities           []any                  `json:"entities"`
	SuccessCount       int                    `json:"success_count"`
	FailureCount       int                    `json:"failure_count"`
	UsageCount         int                    `json:"usage_count"`
	PositiveFeedback   int                    `json:"positive_feedback"`
	NegativeFeedback   int                    `json:"negative_feedback"`
	Pinned             bool                   `json:"pinned"`
	DisabledAt         *time.Time             `json:"disabled_at"`
	MergedIntoMemoryID string                 `json:"merged_into_memory_id"`
	ConflictGroupID    string                 `json:"conflict_group_id"`
	ConflictReason     string                 `json:"conflict_reason"`
	RecentUsage        []MemoryUsageLogRecord `json:"recent_usage"`
	Metadata           map[string]any         `json:"metadata"`
	CreatedAt          time.Time              `json:"created_at"`
	UpdatedAt          time.Time              `json:"updated_at"`
	LastUsedAt         *time.Time             `json:"last_used_at"`
}

type MemoryUsageLogRecord struct {
	ID             string         `json:"id"`
	RunID          string         `json:"run_id"`
	AgentID        string         `json:"agent_id"`
	RetrievalScore float64        `json:"retrieval_score"`
	Injected       bool           `json:"injected"`
	UsedInAnswer   bool           `json:"used_in_answer"`
	Outcome        string         `json:"outcome"`
	Metadata       map[string]any `json:"metadata"`
	CreatedAt      time.Time      `json:"created_at"`
}

type MemoryMergeSuggestion struct {
	SourceMemoryID string  `json:"source_memory_id"`
	TargetMemoryID string  `json:"target_memory_id"`
	Score          float64 `json:"score"`
	Reason         string  `json:"reason"`
}

type MemorySearchResult struct {
	Memory MemoryRecord `json:"memory"`
	Score  float64      `json:"score"`
	Reason string       `json:"reason"`
}

type MemoryContextPack struct {
	Profile          []MemorySearchResult `json:"profile"`
	ProjectFacts     []MemorySearchResult `json:"project_facts"`
	EnvironmentFacts []MemorySearchResult `json:"environment_facts"`
	Heuristics       []MemorySearchResult `json:"heuristics"`
	AntiPatterns     []MemorySearchResult `json:"anti_patterns"`
	RecentEpisodes   []MemorySearchResult `json:"recent_episodes"`
	OpenIssues       []MemorySearchResult `json:"open_issues"`
	Conflicts        []MemorySearchResult `json:"conflicts"`
}

type SearchMemoriesParams struct {
	Query   string
	RunID   string
	AgentID string
	Limit   int
}

type SearchMemoriesResponse struct {
	Query       string               `json:"query"`
	Results     []MemorySearchResult `json:"results"`
	ContextPack MemoryContextPack    `json:"context_pack"`
}

type ProposeMemoryParams struct {
	Type           string
	Content        string
	Summary        string
	ScopeType      string
	ScopeID        string
	PrivacyLevel   string
	Confidence     float64
	SourceEventIDs []string
}

type MemoryFeedbackParams struct {
	MemoryID string
	RunID    string
	Feedback string
	Comment  string
}

type UpdateMemoryGovernanceParams struct {
	MemoryID          string
	Pinned            *bool
	Disabled          *bool
	MergeIntoMemoryID string
	ConflictGroupID   string
	ConflictReason    string
	MarkConflict      *bool
	Outcome           string
}

func (db *DB) ListMemories(ctx context.Context) ([]MemoryRecord, error) {
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, type, content, summary, scope_type, scope_id, privacy_level, confidence, status,
		       source_event_ids, entities, success_count, failure_count, usage_count, positive_feedback,
		       negative_feedback, metadata, created_at, updated_at, last_used_at, pinned, disabled_at,
		       merged_into_memory_id, conflict_group_id, conflict_reason
		FROM memories
		WHERE status <> 'deleted'
		ORDER BY pinned DESC, updated_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	memories, err := scanMemories(rows)
	if err != nil {
		return nil, err
	}
	for index := range memories {
		memories[index].RecentUsage, _ = db.ListMemoryUsageLogs(ctx, memories[index].ID, 10)
	}
	return memories, nil
}

func (db *DB) SearchMemories(ctx context.Context, params SearchMemoriesParams) (*SearchMemoriesResponse, error) {
	limit := params.Limit
	if limit <= 0 || limit > 20 {
		limit = 10
	}
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, type, content, summary, scope_type, scope_id, privacy_level, confidence, status,
		       source_event_ids, entities, success_count, failure_count, usage_count, positive_feedback,
		       negative_feedback, metadata, created_at, updated_at, last_used_at, pinned, disabled_at,
		       merged_into_memory_id, conflict_group_id, conflict_reason
		FROM memories
		WHERE status IN ('confirmed', 'pending', 'conflicted')
		  AND disabled_at IS NULL
		  AND merged_into_memory_id IS NULL
		ORDER BY pinned DESC, confidence DESC, updated_at DESC
		LIMIT 200
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	memories, err := scanMemories(rows)
	if err != nil {
		return nil, err
	}

	results := make([]MemorySearchResult, 0, len(memories))
	seenContent := map[string]bool{}
	for _, memory := range memories {
		contentKey := strings.TrimSpace(memory.Content)
		if contentKey != "" && seenContent[contentKey] {
			continue
		}
		seenContent[contentKey] = true
		score, reason := memoryRankScore(params.Query, memory, params)
		if score <= 0 {
			continue
		}
		result := MemorySearchResult{Memory: memory, Score: score, Reason: reason}
		results = append(results, result)
		if err := db.writeMemoryUsage(ctx, memory.ID, params.RunID, params.AgentID, score); err != nil {
			return nil, err
		}
		if len(results) >= limit {
			break
		}
	}

	return &SearchMemoriesResponse{
		Query:       params.Query,
		Results:     results,
		ContextPack: buildContextPack(results),
	}, nil
}

func (db *DB) ProposeMemory(ctx context.Context, params ProposeMemoryParams) (*MemoryRecord, error) {
	memoryID, err := NewID("mem_")
	if err != nil {
		return nil, err
	}

	memoryType := valueOrDefault(params.Type, inferMemoryType(params.Content))
	scopeType := valueOrDefault(params.ScopeType, "global")
	privacyLevel := valueOrDefault(params.PrivacyLevel, "internal")
	confidence := params.Confidence
	if confidence == 0 {
		confidence = 0.8
	}
	status := "pending"
	if explicitMemoryTrigger(params.Content) {
		status = "confirmed"
	}
	sourceEventIDs := params.SourceEventIDs
	if len(sourceEventIDs) == 0 {
		sourceEventIDs = []string{"manual_propose"}
	}

	sourceRaw := mustJSON(sourceEventIDs)
	entitiesRaw := mustJSON(extractMemoryEntities(params.Content))
	metadataRaw := mustJSON(map[string]any{"source": "memory_propose_api"})

	if _, err := db.sql.ExecContext(ctx, `
		INSERT INTO memories (id, type, content, summary, scope_type, scope_id, privacy_level, confidence, status, source_event_ids, entities, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, memoryID, memoryType, params.Content, params.Summary, scopeType, nullString(params.ScopeID), privacyLevel, confidence, status, sourceRaw, entitiesRaw, metadataRaw); err != nil {
		return nil, err
	}
	_ = db.markConflictsForMemory(ctx, memoryID, params.Content)

	memories, err := db.ListMemories(ctx)
	if err != nil {
		return nil, err
	}
	for _, memory := range memories {
		if memory.ID == memoryID {
			return &memory, nil
		}
	}
	return nil, sql.ErrNoRows
}

func (db *DB) ListMemoryMergeSuggestions(ctx context.Context) ([]MemoryMergeSuggestion, error) {
	memories, err := db.ListMemories(ctx)
	if err != nil {
		return nil, err
	}
	suggestions := []MemoryMergeSuggestion{}
	for i := 0; i < len(memories); i++ {
		for j := i + 1; j < len(memories); j++ {
			score := tokenOverlap(memories[i].Content, memories[j].Content)
			if score >= 0.55 {
				suggestions = append(suggestions, MemoryMergeSuggestion{SourceMemoryID: memories[j].ID, TargetMemoryID: memories[i].ID, Score: score, Reason: "similar content token overlap"})
			}
		}
	}
	return suggestions, nil
}

func (db *DB) markConflictsForMemory(ctx context.Context, memoryID string, content string) error {
	if !(strings.Contains(content, "不要") || strings.Contains(content, "优先")) {
		return nil
	}
	rows, err := db.sql.QueryContext(ctx, `SELECT id, content FROM memories WHERE id <> $1 AND status IN ('confirmed', 'pending') LIMIT 100`, memoryID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, other string
		if err := rows.Scan(&id, &other); err != nil {
			return err
		}
		if tokenOverlap(content, other) > 0.45 && strings.Contains(content, "不要") != strings.Contains(other, "不要") {
			groupID := memoryID
			_, _ = db.sql.ExecContext(ctx, `UPDATE memories SET status='conflicted', conflict_group_id=$2, conflict_reason='automatic conflict detection', updated_at=NOW() WHERE id IN ($1, $3)`, memoryID, groupID, id)
		}
	}
	return rows.Err()
}

func (db *DB) RecordMemoryFeedback(ctx context.Context, params MemoryFeedbackParams) error {
	if params.Feedback == "" {
		params.Feedback = "neutral"
	}
	if params.Feedback != "positive" && params.Feedback != "negative" && params.Feedback != "neutral" {
		return sql.ErrNoRows
	}
	feedbackID, err := NewID("memfb_")
	if err != nil {
		return err
	}
	if _, err := db.sql.ExecContext(ctx, `
		INSERT INTO memory_feedback (id, memory_id, run_id, feedback, comment)
		VALUES ($1, $2, NULLIF($3, ''), $4, $5)
	`, feedbackID, params.MemoryID, params.RunID, params.Feedback, params.Comment); err != nil {
		return err
	}
	switch params.Feedback {
	case "positive":
		_, err = db.sql.ExecContext(ctx, `UPDATE memories SET positive_feedback = positive_feedback + 1, success_count = success_count + 1, updated_at = NOW() WHERE id = $1`, params.MemoryID)
	case "negative":
		_, err = db.sql.ExecContext(ctx, `UPDATE memories SET negative_feedback = negative_feedback + 1, failure_count = failure_count + 1, updated_at = NOW() WHERE id = $1`, params.MemoryID)
	default:
		_, err = db.sql.ExecContext(ctx, `UPDATE memories SET updated_at = NOW() WHERE id = $1`, params.MemoryID)
	}
	return err
}

func (db *DB) UpdateMemoryGovernance(ctx context.Context, params UpdateMemoryGovernanceParams) (*MemoryRecord, error) {
	if params.Pinned != nil {
		if _, err := db.sql.ExecContext(ctx, `UPDATE memories SET pinned=$2, updated_at=NOW() WHERE id=$1`, params.MemoryID, *params.Pinned); err != nil {
			return nil, err
		}
	}
	if params.Disabled != nil {
		if *params.Disabled {
			if _, err := db.sql.ExecContext(ctx, `UPDATE memories SET status='disabled', disabled_at=NOW(), updated_at=NOW() WHERE id=$1`, params.MemoryID); err != nil {
				return nil, err
			}
		} else {
			if _, err := db.sql.ExecContext(ctx, `UPDATE memories SET status='confirmed', disabled_at=NULL, updated_at=NOW() WHERE id=$1`, params.MemoryID); err != nil {
				return nil, err
			}
		}
	}
	if params.MergeIntoMemoryID != "" {
		if _, err := db.sql.ExecContext(ctx, `UPDATE memories SET status='merged', merged_into_memory_id=$2, updated_at=NOW() WHERE id=$1`, params.MemoryID, params.MergeIntoMemoryID); err != nil {
			return nil, err
		}
	}
	if params.MarkConflict != nil {
		if *params.MarkConflict {
			groupID := valueOrDefault(params.ConflictGroupID, params.MemoryID)
			if _, err := db.sql.ExecContext(ctx, `UPDATE memories SET status='conflicted', conflict_group_id=$2, conflict_reason=$3, updated_at=NOW() WHERE id=$1`, params.MemoryID, groupID, params.ConflictReason); err != nil {
				return nil, err
			}
		} else {
			if _, err := db.sql.ExecContext(ctx, `UPDATE memories SET status='confirmed', conflict_group_id=NULL, conflict_reason=NULL, updated_at=NOW() WHERE id=$1`, params.MemoryID); err != nil {
				return nil, err
			}
		}
	}
	if params.Outcome != "" {
		column := "success_count"
		if params.Outcome == "failure" {
			column = "failure_count"
		}
		if _, err := db.sql.ExecContext(ctx, `UPDATE memories SET `+column+` = `+column+` + 1, updated_at=NOW() WHERE id=$1`, params.MemoryID); err != nil {
			return nil, err
		}
	}
	memories, err := db.ListMemories(ctx)
	if err != nil {
		return nil, err
	}
	for _, memory := range memories {
		if memory.ID == params.MemoryID {
			return &memory, nil
		}
	}
	return nil, sql.ErrNoRows
}

func scanMemories(rows *sql.Rows) ([]MemoryRecord, error) {
	var memories []MemoryRecord
	for rows.Next() {
		var memory MemoryRecord
		var summary sql.NullString
		var scopeID sql.NullString
		var sourceRaw []byte
		var entitiesRaw []byte
		var metadataRaw []byte
		var lastUsedAt sql.NullTime
		var disabledAt sql.NullTime
		var mergedIntoMemoryID sql.NullString
		var conflictGroupID sql.NullString
		var conflictReason sql.NullString
		if err := rows.Scan(
			&memory.ID,
			&memory.Type,
			&memory.Content,
			&summary,
			&memory.ScopeType,
			&scopeID,
			&memory.PrivacyLevel,
			&memory.Confidence,
			&memory.Status,
			&sourceRaw,
			&entitiesRaw,
			&memory.SuccessCount,
			&memory.FailureCount,
			&memory.UsageCount,
			&memory.PositiveFeedback,
			&memory.NegativeFeedback,
			&metadataRaw,
			&memory.CreatedAt,
			&memory.UpdatedAt,
			&lastUsedAt,
			&memory.Pinned,
			&disabledAt,
			&mergedIntoMemoryID,
			&conflictGroupID,
			&conflictReason,
		); err != nil {
			return nil, err
		}
		memory.Summary = summary.String
		memory.ScopeID = scopeID.String
		_ = json.Unmarshal(sourceRaw, &memory.SourceEventIDs)
		_ = json.Unmarshal(entitiesRaw, &memory.Entities)
		memory.Metadata = decodeObject(metadataRaw)
		memory.LastUsedAt = nullTimePtr(lastUsedAt)
		memory.DisabledAt = nullTimePtr(disabledAt)
		memory.MergedIntoMemoryID = mergedIntoMemoryID.String
		memory.ConflictGroupID = conflictGroupID.String
		memory.ConflictReason = conflictReason.String
		memories = append(memories, memory)
	}
	return memories, rows.Err()
}

func (db *DB) writeMemoryUsage(ctx context.Context, memoryID string, runID string, agentID string, score float64) error {
	usageID, err := NewID("memuse_")
	if err != nil {
		return err
	}
	if runID == "" {
		runID = "run_000000000000000000000000"
	}
	_, err = db.sql.ExecContext(ctx, `
		UPDATE memories
		SET usage_count = usage_count + 1, last_used_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`, memoryID)
	if err != nil {
		return err
	}
	_, err = db.sql.ExecContext(ctx, `
		INSERT INTO memory_usage_logs (id, memory_id, run_id, agent_id, retrieval_score, injected, used_in_answer, outcome)
		VALUES ($1, $2, NULLIF($3, 'run_000000000000000000000000'), NULLIF($4, ''), $5, TRUE, FALSE, 'retrieved')
	`, usageID, memoryID, runID, agentID, score)
	return err
}

func (db *DB) ListMemoryUsageLogs(ctx context.Context, memoryID string, limit int) ([]MemoryUsageLogRecord, error) {
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	rows, err := db.sql.QueryContext(ctx, `
		SELECT id, COALESCE(run_id, ''), COALESCE(agent_id, ''), COALESCE(retrieval_score, 0),
		       injected, used_in_answer, COALESCE(outcome, ''), metadata, created_at
		FROM memory_usage_logs
		WHERE memory_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, memoryID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	logs := []MemoryUsageLogRecord{}
	for rows.Next() {
		var record MemoryUsageLogRecord
		var metadataRaw []byte
		if err := rows.Scan(&record.ID, &record.RunID, &record.AgentID, &record.RetrievalScore, &record.Injected, &record.UsedInAnswer, &record.Outcome, &metadataRaw, &record.CreatedAt); err != nil {
			return nil, err
		}
		record.Metadata = decodeObject(metadataRaw)
		logs = append(logs, record)
	}
	return logs, rows.Err()
}

func buildContextPack(results []MemorySearchResult) MemoryContextPack {
	pack := MemoryContextPack{
		Profile:          []MemorySearchResult{},
		ProjectFacts:     []MemorySearchResult{},
		EnvironmentFacts: []MemorySearchResult{},
		Heuristics:       []MemorySearchResult{},
		AntiPatterns:     []MemorySearchResult{},
		RecentEpisodes:   []MemorySearchResult{},
		OpenIssues:       []MemorySearchResult{},
		Conflicts:        []MemorySearchResult{},
	}
	for _, result := range results {
		switch result.Memory.Type {
		case "user_preference":
			pack.Profile = append(pack.Profile, result)
		case "project_fact":
			pack.ProjectFacts = append(pack.ProjectFacts, result)
		case "environment_fact":
			pack.EnvironmentFacts = append(pack.EnvironmentFacts, result)
		case "heuristic":
			pack.Heuristics = append(pack.Heuristics, result)
		case "anti_pattern":
			pack.AntiPatterns = append(pack.AntiPatterns, result)
		case "episode", "outcome":
			pack.RecentEpisodes = append(pack.RecentEpisodes, result)
		case "unresolved_issue":
			pack.OpenIssues = append(pack.OpenIssues, result)
		}
		if result.Memory.Status == "conflicted" {
			pack.Conflicts = append(pack.Conflicts, result)
		}
	}
	return pack
}

func keywordScore(query string, memory MemoryRecord) float64 {
	query = strings.ToLower(query)
	content := strings.ToLower(memory.Content + " " + memory.Summary + " " + memory.Type)
	score := 0.0
	for _, token := range searchTerms(query) {
		if strings.Contains(content, token) {
			score += 0.15
		}
	}
	if score == 0 {
		return 0
	}
	score += 0.2 + memory.Confidence*0.5
	if score > 1 {
		return 1
	}
	return score
}

func searchTerms(query string) []string {
	query = strings.ToLower(query)
	terms := strings.Fields(query)
	known := []string{
		"docker compose", "docker", "compose", "kubernetes", "k8s", "tailscale",
		"telegram", "gateway", "私聊文本", "微信", "worker-runtime", "postgres",
		"nats", "轻量", "部署", "发布", "远程", "节点", "网络", "自检", "核心服务",
		"反模式", "偏好", "优先", "入口",
	}
	for _, term := range known {
		if strings.Contains(query, term) {
			terms = append(terms, term)
		}
	}
	if strings.Contains(query, "发布方式") || strings.Contains(query, "轻量发布") {
		terms = append(terms, "docker compose", "部署")
	}
	if strings.Contains(query, "网络") && strings.Contains(query, "远程") {
		terms = append(terms, "tailscale")
	}
	if strings.Contains(query, "telegram") || strings.Contains(query, "入口") {
		terms = append(terms, "telegram", "私聊文本")
	}
	if strings.Contains(query, "自检") || strings.Contains(query, "核心服务") {
		terms = append(terms, "postgres", "nats", "worker-runtime")
	}
	return uniqueStrings(terms)
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func memoryRankScore(query string, memory MemoryRecord, params SearchMemoriesParams) (float64, string) {
	keyword := keywordScore(query, memory)
	entity := entityScore(query, memory)
	typeMatch := typeScore(query, memory)
	scope := scopeScore(memory)
	usageSuccess := usageSuccessScore(memory)
	feedback := feedbackScore(memory)
	recency := recencyScore(memory)
	pinBoost := 0.0
	if memory.Pinned {
		pinBoost = 0.08
	}
	if keyword == 0 && entity == 0 && typeMatch == 0 {
		return 0, "no keyword/entity/type match"
	}
	score := keyword*0.35 + entity*0.12 + typeMatch*0.1 + scope*0.08 + memory.Confidence*0.15 + recency*0.08 + usageSuccess*0.07 + feedback*0.05 + pinBoost
	if score > 1 {
		score = 1
	}
	return score, "scope_match + type_match + entity_match + keyword_match + confidence + recency + usage_success + user_feedback"
}

func entityScore(query string, memory MemoryRecord) float64 {
	lowerQuery := strings.ToLower(query)
	score := 0.0
	for _, entity := range memory.Entities {
		text, ok := entity.(string)
		if ok && text != "" && strings.Contains(lowerQuery, strings.ToLower(text)) {
			score += 0.2
		}
	}
	if score > 1 {
		return 1
	}
	return score
}

func typeScore(query string, memory MemoryRecord) float64 {
	lowerQuery := strings.ToLower(query)
	switch memory.Type {
	case "anti_pattern":
		if strings.Contains(lowerQuery, "不要") || strings.Contains(lowerQuery, "避免") || strings.Contains(lowerQuery, "偏好") || strings.Contains(lowerQuery, "反模式") {
			return 0.4
		}
	case "user_preference":
		if strings.Contains(lowerQuery, "偏好") || strings.Contains(lowerQuery, "喜欢") || strings.Contains(lowerQuery, "优先") {
			return 0.4
		}
	case "unresolved_issue":
		if strings.Contains(lowerQuery, "问题") || strings.Contains(lowerQuery, "todo") || strings.Contains(lowerQuery, "issue") {
			return 0.4
		}
	}
	return 0
}

func scopeScore(memory MemoryRecord) float64 {
	if memory.ScopeType == "global" || memory.ScopeType == "project" {
		return 0.5
	}
	return 0.2
}

func usageSuccessScore(memory MemoryRecord) float64 {
	total := memory.SuccessCount + memory.FailureCount
	if total == 0 {
		return 0.2
	}
	return float64(memory.SuccessCount) / float64(total)
}

func feedbackScore(memory MemoryRecord) float64 {
	total := memory.PositiveFeedback + memory.NegativeFeedback
	if total == 0 {
		return 0.2
	}
	return float64(memory.PositiveFeedback) / float64(total)
}

func recencyScore(memory MemoryRecord) float64 {
	ageHours := time.Since(memory.UpdatedAt).Hours()
	if ageHours < 24 {
		return 1
	}
	if ageHours < 24*7 {
		return 0.7
	}
	if ageHours < 24*30 {
		return 0.4
	}
	return 0.1
}

func extractMemoryEntities(content string) []string {
	known := []string{"Docker", "Docker Compose", "Kubernetes", "k8s", "Telegram", "Gateway", "Orchestrator", "NATS", "VPS", "Tailscale", "Qdrant"}
	entities := []string{}
	lower := strings.ToLower(content)
	for _, entity := range known {
		if strings.Contains(lower, strings.ToLower(entity)) {
			entities = append(entities, entity)
		}
	}
	for _, token := range strings.Fields(content) {
		if strings.HasPrefix(token, "http://") || strings.HasPrefix(token, "https://") || strings.Contains(token, ".com") {
			entities = append(entities, strings.Trim(token, "，。,. "))
		}
	}
	return entities
}

func tokenOverlap(a string, b string) float64 {
	left := tokenSet(a)
	right := tokenSet(b)
	if len(left) == 0 || len(right) == 0 {
		return 0
	}
	intersection := 0
	union := map[string]bool{}
	for token := range left {
		union[token] = true
		if right[token] {
			intersection++
		}
	}
	for token := range right {
		union[token] = true
	}
	return float64(intersection) / float64(len(union))
}

func tokenSet(value string) map[string]bool {
	result := map[string]bool{}
	value = strings.ToLower(value)
	for _, token := range strings.Fields(value) {
		token = strings.Trim(token, "，。,. /:;()[]{}")
		if len([]rune(token)) >= 2 {
			result[token] = true
		}
	}
	return result
}

func inferMemoryType(content string) string {
	if strings.Contains(content, "不要") || strings.Contains(strings.ToLower(content), "kubernetes") || strings.Contains(strings.ToLower(content), "k8s") {
		return "anti_pattern"
	}
	if strings.Contains(content, "偏好") || strings.Contains(content, "优先") {
		return "user_preference"
	}
	return "heuristic"
}

func explicitMemoryTrigger(content string) bool {
	for _, trigger := range []string{"记住", "以后", "从现在开始", "我的偏好", "不要再", "这个项目是"} {
		if strings.Contains(content, trigger) {
			return true
		}
	}
	return false
}

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
