package store

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type ModelRequest struct {
	Provider        string         `json:"provider"`
	ModelID         string         `json:"model_id"`
	ModelName       string         `json:"model_name"`
	CacheablePrefix string         `json:"cacheable_prefix"`
	DynamicTail     string         `json:"dynamic_tail"`
	PromptCacheKey  string         `json:"prompt_cache_key"`
	PrefixHash      string         `json:"prefix_hash"`
	DynamicTailHash string         `json:"dynamic_tail_hash"`
	Metadata        map[string]any `json:"metadata"`
}

type ModelResponse struct {
	Content           string         `json:"content"`
	InputTokens       int            `json:"input_tokens"`
	OutputTokens      int            `json:"output_tokens"`
	CachedInputTokens int            `json:"cached_input_tokens"`
	LatencyMs         int            `json:"latency_ms"`
	RawResponse       map[string]any `json:"raw_response"`
	Provider          string         `json:"provider"`
	ModelName         string         `json:"model_name"`
	FallbackToMock    bool           `json:"fallback_to_mock"`
	FallbackReason    string         `json:"fallback_reason"`
}

type modelConfig struct {
	ID           string
	Provider     string
	ModelName    string
	BaseURL      string
	BaseURLEnv   string
	APIKeyEnv    string
	SupportsJSON bool
	TimeoutSec   int
	MaxRetries   int
}

func invokeModel(ctx context.Context, tx *sql.Tx, assembly PromptAssemblyRecord) (*ModelResponse, error) {
	config, err := loadModelConfig(ctx, tx, assembly.ModelID)
	if err != nil {
		return nil, err
	}

	request := ModelRequest{
		Provider:        config.Provider,
		ModelID:         config.ID,
		ModelName:       config.ModelName,
		CacheablePrefix: assembly.CacheablePrefix,
		DynamicTail:     assembly.DynamicTail,
		PromptCacheKey:  assembly.PromptCacheKey,
		PrefixHash:      assembly.PrefixHash,
		DynamicTailHash: assembly.DynamicTailHash,
		Metadata: map[string]any{
			"prompt_assembly_id":     assembly.ID,
			"memory_profile_version": assembly.MemoryProfileVersion,
			"tool_schema_version":    assembly.ToolSchemaVersion,
		},
	}

	started := time.Now()
	response, err := dispatchModel(ctx, config, request)
	latencyMs := int(time.Since(started).Milliseconds())
	if response != nil {
		response.LatencyMs = latencyMs
	}
	if err != nil {
		if writeErr := insertModelCall(ctx, tx, assembly, request, nil, "failed", err.Error()); writeErr != nil {
			return nil, writeErr
		}
		return nil, err
	}
	status := "succeeded"
	if response.FallbackToMock {
		status = "fallback_to_mock"
	}
	if err := insertModelCall(ctx, tx, assembly, request, response, status, ""); err != nil {
		return nil, err
	}
	if err := insertProviderCacheStats(ctx, tx, assembly, request, response); err != nil {
		return nil, err
	}
	return response, nil
}

func loadModelConfig(ctx context.Context, tx *sql.Tx, modelID string) (modelConfig, error) {
	var config modelConfig
	var baseURL sql.NullString
	var baseURLEnv sql.NullString
	var apiKeyEnv sql.NullString
	if err := tx.QueryRowContext(ctx, `
		SELECT id, provider, model_name, base_url, base_url_env, api_key_env, supports_json_mode
		FROM models
		WHERE id = $1 AND enabled = TRUE
	`, modelID).Scan(&config.ID, &config.Provider, &config.ModelName, &baseURL, &baseURLEnv, &apiKeyEnv, &config.SupportsJSON); err != nil {
		return modelConfig{}, err
	}
	config.BaseURL = baseURL.String
	config.BaseURLEnv = baseURLEnv.String
	config.APIKeyEnv = apiKeyEnv.String
	config = applyGenericModelEnv(config)
	return config, nil
}

func dispatchModel(ctx context.Context, config modelConfig, request ModelRequest) (*ModelResponse, error) {
	baseURL := resolvedBaseURL(config)
	apiKey := resolvedAPIKey(config)
	modelName := resolvedModelName(config)
	allowMock := allowMockProvider()
	if config.Provider == "mock_provider" {
		if !allowMock {
			return nil, errors.New("mock provider is disabled by ALLOW_MOCK_PROVIDER=false")
		}
		return callMockProvider(request), nil
	}
	if config.Provider != "openai_compatible" {
		return nil, fmt.Errorf("unsupported provider: %s", config.Provider)
	}
	if baseURL == "" || apiKey == "" || modelName == "" {
		if !allowMock {
			return nil, errors.New("provider config missing and mock fallback disabled: MODEL_BASE_URL, MODEL_API_KEY, or MODEL_NAME is empty")
		}
		return callFallbackMock(request, "provider config missing: MODEL_BASE_URL, MODEL_API_KEY, or MODEL_NAME is empty"), nil
	}
	response, err := callOpenAICompatible(ctx, baseURL, apiKey, modelName, config.SupportsJSON, request, config.TimeoutSec, config.MaxRetries)
	if err != nil {
		if !allowMock {
			return nil, fmt.Errorf("provider_failed and mock fallback disabled: %s", mapProviderError(err))
		}
		return callFallbackMock(request, "provider_failed: "+mapProviderError(err)), nil
	}
	return response, nil
}

func InvokeModelDirect(ctx context.Context, request ModelRequest) (*ModelResponse, error) {
	config := applyGenericModelEnv(modelConfig{
		ID:           valueOrDefault(request.ModelID, "model_default"),
		Provider:     valueOrDefault(request.Provider, "openai_compatible"),
		ModelName:    request.ModelName,
		BaseURLEnv:   "MODEL_DEFAULT_BASE_URL",
		APIKeyEnv:    "MODEL_DEFAULT_API_KEY",
		SupportsJSON: true,
	})
	started := time.Now()
	response, err := dispatchModel(ctx, config, request)
	if response != nil {
		response.LatencyMs = int(time.Since(started).Milliseconds())
	}
	return response, err
}

func allowMockProvider() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("ALLOW_MOCK_PROVIDER")))
	return value == "" || value == "true" || value == "1" || value == "yes"
}

func callMockProvider(request ModelRequest) *ModelResponse {
	content := mockAgentRuntimeContent(request.DynamicTail)
	return &ModelResponse{
		Content:           content,
		InputTokens:       estimateTokens(request.CacheablePrefix + request.DynamicTail),
		OutputTokens:      estimateTokens(content),
		CachedInputTokens: 0,
		RawResponse: map[string]any{
			"provider": "mock_provider",
			"content":  content,
		},
		Provider:  "mock_provider",
		ModelName: "mock-model",
	}
}

func callFallbackMock(request ModelRequest, reason string) *ModelResponse {
	response := callMockProvider(request)
	response.FallbackToMock = true
	response.FallbackReason = reason
	response.RawResponse["provider_failed"] = true
	response.RawResponse["fallback_to_mock"] = true
	response.RawResponse["fallback_reason"] = reason
	return response
}

func mockAgentRuntimeContent(dynamicTail string) string {
	userMessage := extractUserMessage(dynamicTail)
	lower := strings.ToLower(userMessage)
	if strings.Contains(lower, ".env") || strings.Contains(lower, "api key") || strings.Contains(lower, "apikey") || strings.Contains(lower, "secret") || strings.Contains(lower, "node_secret") || strings.Contains(lower, "private key") || strings.Contains(lower, "ssh key") || strings.Contains(lower, ".ssh") || strings.Contains(lower, "/etc/passwd") || strings.Contains(lower, "/etc/shadow") || strings.Contains(lower, "密钥") || strings.Contains(lower, "完整 memory") || strings.Contains(lower, "full memory") || strings.Contains(lower, "non whitelist") || strings.Contains(lower, "非白名单") || strings.Contains(lower, "fake-node") || strings.Contains(lower, "伪造 node") || strings.Contains(lower, "注册 fake") || strings.Contains(lower, "file://") || strings.Contains(lower, "ftp://") || strings.Contains(lower, "内网") {
		return `{"output_type":"final_answer","content":"已拒绝该请求：当前安全策略禁止读取密钥、完整长期记忆、伪造节点、非白名单入口、file:// 或内网地址；外部研究只能访问明确允许的公开 HTTP/HTTPS URL。"}`
	}
	if strings.Contains(lower, "restart") || strings.Contains(lower, " stop ") || strings.Contains(lower, " rm ") || strings.Contains(lower, "delete") || strings.Contains(lower, "chmod") || strings.Contains(lower, "chown") || strings.Contains(lower, "file_write") || strings.Contains(lower, "file write") || strings.Contains(lower, "raw shell") || strings.Contains(lower, "shell command") || strings.Contains(lower, "raw sql") || strings.Contains(userMessage, "重启") || strings.Contains(userMessage, "停止") || strings.Contains(userMessage, "删除") || strings.Contains(userMessage, "写入文件") || strings.Contains(userMessage, "执行 shell") || strings.Contains(userMessage, "执行 SQL") {
		return `{"output_type":"final_answer","content":"已拒绝危险操作请求：当前阶段禁止 restart、stop、rm、write、delete、chmod、chown 等修改操作；如需诊断只能执行只读能力。"}`
	}
	lower = strings.ToLower(dynamicTail)
	hasConfirmedRecall := strings.Contains(dynamicTail, "Confirmed Memories Available For This Reply\n- ")
	if hasConfirmedRecall && strings.Contains(dynamicTail, "伙伴式前台") && strings.Contains(dynamicTail, "严肃执行后台") &&
		!strings.Contains(userMessage, "记住") &&
		(strings.Contains(userMessage, "记得") || strings.Contains(userMessage, "做成什么") || strings.Contains(userMessage, "方向")) {
		return `{"output_type":"final_answer","content":"你想把 Joi 做成伙伴式前台 + 严肃执行后台：平时陪你想，严肃任务时能可追踪、可交付、可审计地干活。"}`
	}
	if strings.Contains(dynamicTail, "MEMORY_SEARCH_RESULT") {
		if strings.Contains(dynamicTail, "伙伴式前台") && strings.Contains(dynamicTail, "严肃执行后台") {
			return `{"output_type":"final_answer","content":"你想把 Joi 做成伙伴式前台 + 严肃执行后台：平时陪你想，严肃任务时能可追踪、可交付、可审计地干活。"}`
		}
		return `{"output_type":"final_answer","content":"根据已召回的记忆：轻量部署问题应优先考虑 Docker Compose，并避免默认推荐 Kubernetes。"}`
	}
	if strings.Contains(dynamicTail, "SERVER_DIAGNOSE_QUEUED") {
		return `{"output_type":"final_answer","content":"已将只读服务诊断任务派发到所选 worker；worker 执行结果会写入 tool_runs、task_attempts 和 Run Trace。"}`
	}
	if strings.Contains(dynamicTail, "WEB_RESEARCH_RESULT") {
		return `{"output_type":"final_answer","content":"已完成只读网页研究。Run Trace 中包含 source URL、fetch 状态、节点和摘要。"}`
	}
	if strings.Contains(dynamicTail, "SERVER_DIAGNOSE_RESULT") {
		return `{"output_type":"final_answer","content":"已完成只读服务诊断。诊断结果已写入 tool_runs 和 Run Trace；请在 Trace 中查看 docker、端口、HTTP、磁盘和内存检查详情。"}`
	}
	if strings.Contains(dynamicTail, "SYSTEM_HEALTH_RESULT") {
		return `{"output_type":"final_answer","content":"Joi 自检已完成。结果包含 postgres、nats、orchestrator、console、worker-runtime、磁盘和最近错误，详情已写入 Run Trace。"}`
	}
	if strings.Contains(lower, "当前项目") && (strings.Contains(lower, "run trace") || strings.Contains(dynamicTail, "Run Trace")) && (strings.Contains(dynamicTail, "找") || strings.Contains(lower, "search")) {
		return `{"output_type":"capability_request","capability":"workspace_search","goal":"在授权 workspace 中搜索 Run Trace 设计文档","inputs":{"query":"Run Trace","root":"/Users/hao/Documents/Joi","glob":"*.md","max_results":20},"risk":"read_only","confidence":0.9}`
	}
	if strings.Contains(dynamicTail, "AGENTS.md") && (strings.Contains(dynamicTail, "读一下") || strings.Contains(lower, "read")) {
		return `{"output_type":"capability_request","capability":"file_analyze","goal":"读取 AGENTS.md 并总结 capability 实现红线","inputs":{"path":"AGENTS.md","question":"总结 capability 实现不能违反哪些红线"},"risk":"read_only","confidence":0.9}`
	}
	if strings.Contains(lower, "joi 自检") || strings.Contains(lower, "系统自检") || strings.Contains(lower, "system health") || strings.Contains(lower, "健康检查") {
		return `{"output_type":"capability_request","capability":"system_health_check","goal":"执行 Joi 只读系统自检","inputs":{},"risk":"read_only","confidence":0.9}`
	}
	if strings.Contains(lower, "unknown-service") {
		return `{"output_type":"final_answer","content":"无法确认 unknown-service 的诊断目标。请提供明确的容器名、端口或 URL；当前不会执行任何修改操作。"}`
	}
	if strings.Contains(lower, "cloudflared") || strings.Contains(dynamicTail, "服务是否正常") {
		return `{"output_type":"capability_request","capability":"server_diagnose","goal":"检查服务是否正常","inputs":{"service_name":"cloudflared"},"risk":"read_only","confidence":0.88}`
	}
	if url := firstURL(userMessage); url != "" {
		return `{"output_type":"capability_request","capability":"web_research","goal":"读取并总结用户提供的 URL","inputs":{"url":"` + url + `"},"risk":"read_only","confidence":0.86}`
	}
	if strings.Contains(userMessage, "伙伴式前台") && strings.Contains(userMessage, "严肃执行后台") && strings.Contains(userMessage, "记住") {
		return `{"output_type":"memory_write_proposal","memory":{"type":"project_fact","summary":"Joi 的产品方向","content":"用户希望把 Joi 做成伙伴式前台 + 严肃执行后台：平时陪用户想，严肃任务时能可追踪、可交付、可审计地干活。","confidence":0.92,"entities":["Joi","产品方向","伙伴式前台","严肃执行后台"]}}`
	}
	if strings.Contains(dynamicTail, "记忆") || strings.Contains(dynamicTail, "记住") {
		return `{"output_type":"memory_write_proposal","memory":{"type":"user_preference","content":"用户希望把明确要求记住的偏好写入 Memory OS。","confidence":0.8}}`
	}
	if strings.Contains(dynamicTail, "部署") || strings.Contains(dynamicTail, "kubernetes") || strings.Contains(lower, "docker compose") {
		return `{"output_type":"capability_request","capability":"memory_search","goal":"召回部署相关偏好和反模式","inputs":{"query":"轻量部署 Docker Compose Kubernetes"},"risk":"read_only","confidence":0.85}`
	}
	return `{"output_type":"final_answer","content":"这是通过 Agent Runtime JSON 输出解析后的回答。当前链路已经经过 Prompt Assembly、Model Adapter 和模型调用记录。"}`
}

func firstURL(value string) string {
	for _, field := range strings.Fields(value) {
		if strings.HasPrefix(field, "http://") || strings.HasPrefix(field, "https://") {
			return strings.TrimRight(field, "，。,. )]")
		}
	}
	return ""
}

func extractUserMessage(dynamicTail string) string {
	const marker = "\nUser Message\n"
	start := strings.Index(dynamicTail, marker)
	if start < 0 {
		return dynamicTail
	}
	value := dynamicTail[start+len(marker):]
	if end := strings.Index(value, "\n\nDynamic Context"); end >= 0 {
		value = value[:end]
	}
	return strings.TrimSpace(value)
}

func callOpenAICompatible(ctx context.Context, baseURL string, apiKey string, modelName string, jsonMode bool, request ModelRequest, timeoutSec int, maxRetries int) (*ModelResponse, error) {
	if timeoutSec <= 0 {
		timeoutSec = 60
	}
	if maxRetries < 0 {
		maxRetries = 0
	}
	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		response, err := callOpenAICompatibleOnce(ctx, baseURL, apiKey, modelName, jsonMode, request, timeoutSec)
		if err == nil {
			return response, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

func callOpenAICompatibleOnce(ctx context.Context, baseURL string, apiKey string, modelName string, jsonMode bool, request ModelRequest, timeoutSec int) (*ModelResponse, error) {
	endpoint := strings.TrimRight(baseURL, "/")
	if !strings.HasSuffix(endpoint, "/chat/completions") {
		if strings.HasSuffix(endpoint, "/v1") {
			endpoint += "/chat/completions"
		} else {
			endpoint += "/v1/chat/completions"
		}
	}
	body := map[string]any{
		"model": modelName,
		"messages": []map[string]string{
			{"role": "system", "content": request.CacheablePrefix},
			{"role": "user", "content": request.DynamicTail},
		},
		"temperature": 0.2,
	}
	if jsonMode {
		body["response_format"] = map[string]string{"type": "json_object"}
	}
	rawBody, _ := json.Marshal(body)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(rawBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: time.Duration(timeoutSec) * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("model provider returned %s: %s", resp.Status, string(raw))
	}

	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	content, err := openAIContent(payload)
	if err != nil {
		return nil, err
	}
	inputTokens, outputTokens, cachedTokens := openAIUsage(payload)
	return &ModelResponse{
		Content:           content,
		InputTokens:       inputTokens,
		OutputTokens:      outputTokens,
		CachedInputTokens: cachedTokens,
		RawResponse:       payload,
		Provider:          "openai_compatible",
		ModelName:         modelName,
	}, nil
}

func insertModelCall(ctx context.Context, tx *sql.Tx, assembly PromptAssemblyRecord, request ModelRequest, response *ModelResponse, status string, errorMessage string) error {
	modelCallID, err := NewID("modelcall_")
	if err != nil {
		return err
	}
	inputTokens := estimateTokens(request.CacheablePrefix + request.DynamicTail)
	outputTokens := 0
	cachedInputTokens := 0
	latencyMs := 0
	provider := request.Provider
	modelName := request.ModelName
	rawResponse := map[string]any{}
	if response != nil {
		response.Content = RedactSensitiveText(response.Content)
		response.RawResponse = SanitizeForTrace(response.RawResponse).(map[string]any)
		inputTokens = response.InputTokens
		outputTokens = response.OutputTokens
		cachedInputTokens = response.CachedInputTokens
		latencyMs = response.LatencyMs
		provider = response.Provider
		modelName = response.ModelName
		rawResponse = response.RawResponse
		if response.FallbackToMock {
			request.Metadata["provider_failed"] = true
			request.Metadata["fallback_to_mock"] = true
			request.Metadata["fallback_reason"] = response.FallbackReason
		}
	}
	request.Metadata["real_model"] = provider != "" && provider != "mock_provider" && status == "succeeded"
	if _, ok := request.Metadata["fallback_to_mock"]; !ok {
		request.Metadata["fallback_to_mock"] = false
	}
	request.Metadata["estimated_cost"] = estimateModelCost(provider, modelName, inputTokens, outputTokens, cachedInputTokens)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO model_calls (id, run_id, agent_id, model_id, prompt_assembly_id, provider, model_name, input_tokens, output_tokens, latency_ms, status, error_code, error_message, metadata, prompt_cache_key, prefix_hash, dynamic_tail_hash, cacheable_prefix_tokens, dynamic_tail_tokens, cached_input_tokens, raw_response)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
	`, modelCallID, assembly.RunID, assembly.AgentID, assembly.ModelID, assembly.ID, provider, modelName, inputTokens, outputTokens, latencyMs, status, nilIfEmpty(errorMessage), nilIfEmpty(errorMessage), mustJSON(request.Metadata), request.PromptCacheKey, request.PrefixHash, request.DynamicTailHash, estimateTokens(request.CacheablePrefix), estimateTokens(request.DynamicTail), cachedInputTokens, mustJSON(rawResponse))
	return err
}

type ProviderHealth struct {
	Provider          string `json:"provider"`
	Available         bool   `json:"available"`
	DefaultModelID    string `json:"default_model_id"`
	ModelName         string `json:"model_name"`
	BaseURLConfigured bool   `json:"base_url_configured"`
	APIKeyConfigured  bool   `json:"api_key_configured"`
	TimeoutSeconds    int    `json:"timeout_seconds"`
	MaxRetries        int    `json:"max_retries"`
	LastStatus        string `json:"last_status"`
	LastLatencyMs     int    `json:"last_latency_ms"`
	LastInputTokens   int    `json:"last_input_tokens"`
	LastOutputTokens  int    `json:"last_output_tokens"`
	LastCachedTokens  int    `json:"last_cached_input_tokens"`
	LastCacheHitRatio string `json:"last_cache_hit_ratio"`
	LastErrorSummary  string `json:"last_error_summary"`
	FallbackToMock    bool   `json:"fallback_to_mock"`
	FallbackReason    string `json:"fallback_reason"`
}

func (db *DB) ModelProviderHealth(ctx context.Context) ProviderHealth {
	config := applyGenericModelEnv(modelConfig{ID: "model_default", Provider: "openai_compatible", ModelName: "replace", BaseURLEnv: "MODEL_DEFAULT_BASE_URL", APIKeyEnv: "MODEL_DEFAULT_API_KEY", SupportsJSON: true})
	health := ProviderHealth{
		Provider:          config.Provider,
		DefaultModelID:    config.ID,
		ModelName:         resolvedModelName(config),
		BaseURLConfigured: resolvedBaseURL(config) != "",
		APIKeyConfigured:  resolvedAPIKey(config) != "",
		TimeoutSeconds:    config.TimeoutSec,
		MaxRetries:        config.MaxRetries,
	}
	health.Available = health.Provider == "mock_provider" || (health.Provider == "openai_compatible" && health.BaseURLConfigured && health.APIKeyConfigured && health.ModelName != "")
	row := db.sql.QueryRowContext(ctx, `
		SELECT status, latency_ms, input_tokens, output_tokens, cached_input_tokens, error_message, metadata
		FROM model_calls
		ORDER BY created_at DESC
		LIMIT 1
	`)
	var metadataRaw []byte
	var errMsg sql.NullString
	if err := row.Scan(&health.LastStatus, &health.LastLatencyMs, &health.LastInputTokens, &health.LastOutputTokens, &health.LastCachedTokens, &errMsg, &metadataRaw); err == nil {
		health.LastErrorSummary = errMsg.String
		metadata := decodeObject(metadataRaw)
		health.FallbackToMock, _ = metadata["fallback_to_mock"].(bool)
		health.FallbackReason, _ = metadata["fallback_reason"].(string)
		if health.LastInputTokens > 0 {
			health.LastCacheHitRatio = fmt.Sprintf("%.4f", float64(health.LastCachedTokens)/float64(health.LastInputTokens))
		}
	}
	if !health.Available {
		health.FallbackToMock = true
		health.FallbackReason = "provider config missing"
	}
	return health
}

func applyGenericModelEnv(config modelConfig) modelConfig {
	if provider := os.Getenv("MODEL_PROVIDER"); provider != "" {
		config.Provider = provider
	}
	if baseURL := os.Getenv("MODEL_BASE_URL"); baseURL != "" {
		config.BaseURL = baseURL
	}
	if modelName := os.Getenv("MODEL_NAME"); modelName != "" {
		config.ModelName = modelName
	}
	config.TimeoutSec = intEnv("MODEL_TIMEOUT_SECONDS", 60)
	config.MaxRetries = intEnv("MODEL_MAX_RETRIES", 1)
	return config
}

func resolvedBaseURL(config modelConfig) string {
	return valueOrDefault(config.BaseURL, os.Getenv(config.BaseURLEnv))
}

func resolvedAPIKey(config modelConfig) string {
	if apiKey := os.Getenv("MODEL_API_KEY"); apiKey != "" {
		return apiKey
	}
	if strings.Contains(resolvedBaseURL(config), "deepseek.com") {
		if apiKey := os.Getenv("DEEPSEEK_API_KEY"); apiKey != "" {
			return apiKey
		}
	}
	return os.Getenv(config.APIKeyEnv)
}

func resolvedModelName(config modelConfig) string {
	if config.ModelName != "" && config.ModelName != "replace" {
		return config.ModelName
	}
	if modelName := os.Getenv("MODEL_NAME"); modelName != "" {
		return modelName
	}
	return os.Getenv(strings.ToUpper(config.ID) + "_NAME")
}

func intEnv(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	var parsed int
	if _, err := fmt.Sscanf(value, "%d", &parsed); err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func mapProviderError(err error) string {
	text := err.Error()
	if strings.Contains(text, "401") || strings.Contains(text, "403") {
		return "authentication_failed"
	}
	if strings.Contains(text, "429") {
		return "rate_limited"
	}
	if strings.Contains(strings.ToLower(text), "timeout") || strings.Contains(strings.ToLower(text), "deadline") {
		return "timeout"
	}
	if len(text) > 240 {
		return text[:240]
	}
	return text
}

func insertProviderCacheStats(ctx context.Context, tx *sql.Tx, assembly PromptAssemblyRecord, request ModelRequest, response *ModelResponse) error {
	statsID, err := NewID("pcache_")
	if err != nil {
		return err
	}
	hitRatio := 0.0
	if response.InputTokens > 0 {
		hitRatio = float64(response.CachedInputTokens) / float64(response.InputTokens)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO provider_cache_stats (id, provider, model_id, model_name, prompt_cache_key, prefix_hash, dynamic_tail_hash, input_tokens, cached_input_tokens, hit_ratio, latency_ms, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, statsID, response.Provider, assembly.ModelID, response.ModelName, request.PromptCacheKey, request.PrefixHash, request.DynamicTailHash, response.InputTokens, response.CachedInputTokens, hitRatio, response.LatencyMs, mustJSON(map[string]any{"provider_cache_supported": response.CachedInputTokens > 0}))
	return err
}

func openAIContent(payload map[string]any) (string, error) {
	choices, ok := payload["choices"].([]any)
	if !ok || len(choices) == 0 {
		return "", errors.New("model response missing choices")
	}
	choice, ok := choices[0].(map[string]any)
	if !ok {
		return "", errors.New("model response choice malformed")
	}
	message, ok := choice["message"].(map[string]any)
	if !ok {
		return "", errors.New("model response missing message")
	}
	content, ok := message["content"].(string)
	if !ok {
		return "", errors.New("model response content missing")
	}
	return content, nil
}

func openAIUsage(payload map[string]any) (int, int, int) {
	usage, ok := payload["usage"].(map[string]any)
	if !ok {
		return 0, 0, 0
	}
	inputTokens := numberToInt(usage["prompt_tokens"])
	outputTokens := numberToInt(usage["completion_tokens"])
	cachedInputTokens := 0
	if details, ok := usage["prompt_tokens_details"].(map[string]any); ok {
		cachedInputTokens = numberToInt(details["cached_tokens"])
	}
	return inputTokens, outputTokens, cachedInputTokens
}

func numberToInt(value any) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	default:
		return 0
	}
}

func estimateTokens(content string) int {
	runes := len([]rune(content))
	if runes == 0 {
		return 0
	}
	return (runes / 4) + 1
}

func nilIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}
