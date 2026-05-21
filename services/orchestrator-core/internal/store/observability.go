package store

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
)

type SystemHealthRecord struct {
	ServiceStatus   map[string]any   `json:"service_status"`
	QueueStatus     map[string]any   `json:"queue_status"`
	WorkerStatus    []NodeRecord     `json:"worker_status"`
	RecentErrors    []map[string]any `json:"recent_errors"`
	ModelLatency    map[string]any   `json:"model_latency"`
	ToolFailureRate map[string]any   `json:"tool_failure_rate"`
	TokenCostToday  map[string]any   `json:"token_cost_today"`
	Warnings        []map[string]any `json:"warnings"`
}

func (db *DB) SystemHealth(ctx context.Context) (*SystemHealthRecord, error) {
	nodes, _ := db.ListNodes(ctx)
	health := &SystemHealthRecord{
		ServiceStatus:   map[string]any{"orchestrator": "ok", "postgres": db.Ping(ctx) == nil},
		QueueStatus:     map[string]any{},
		WorkerStatus:    nodes,
		RecentErrors:    []map[string]any{},
		ModelLatency:    map[string]any{},
		ToolFailureRate: map[string]any{},
		TokenCostToday:  map[string]any{},
		Warnings:        []map[string]any{},
	}
	var activeTasks, deadTasks, stuckRunningTasks, inputTokens, outputTokens, cachedTokens, failedTools, modelCalls, modelErrors int
	var avgLatency float64
	_ = db.sql.QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks WHERE status IN ('pending','running','retrying')`).Scan(&activeTasks)
	_ = db.sql.QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks WHERE status='dead'`).Scan(&deadTasks)
	_ = db.sql.QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks WHERE status='running' AND started_at < NOW() - INTERVAL '10 minutes'`).Scan(&stuckRunningTasks)
	_ = db.sql.QueryRowContext(ctx, `SELECT COALESCE(AVG(latency_ms),0) FROM model_calls WHERE created_at >= CURRENT_DATE`).Scan(&avgLatency)
	_ = db.sql.QueryRowContext(ctx, `SELECT COUNT(*), COUNT(*) FILTER (WHERE status <> 'succeeded' AND status <> 'fallback_to_mock') FROM model_calls WHERE created_at >= CURRENT_DATE`).Scan(&modelCalls, &modelErrors)
	_ = db.sql.QueryRowContext(ctx, `SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cached_input_tokens),0) FROM model_calls WHERE created_at >= CURRENT_DATE`).Scan(&inputTokens, &outputTokens, &cachedTokens)
	_ = db.sql.QueryRowContext(ctx, `SELECT COUNT(*) FROM tool_runs WHERE status <> 'succeeded' AND created_at >= CURRENT_DATE`).Scan(&failedTools)
	cost := 0.0
	if summary, err := db.ModelUsageSummary(ctx); err == nil {
		if items, ok := summary["items"].([]map[string]any); ok {
			for _, item := range items {
				if estimated, ok := item["estimated_cost"].(float64); ok {
					cost += estimated
				}
			}
		}
	}
	errorRate := 0.0
	if modelCalls > 0 {
		errorRate = float64(modelErrors) / float64(modelCalls)
	}
	health.QueueStatus["active_tasks"] = activeTasks
	health.QueueStatus["dead_tasks"] = deadTasks
	health.QueueStatus["stuck_running_tasks"] = stuckRunningTasks
	health.ModelLatency["avg_latency_ms_today"] = avgLatency
	health.ModelLatency["model_calls_today"] = modelCalls
	health.ModelLatency["model_errors_today"] = modelErrors
	health.ModelLatency["model_error_rate_today"] = errorRate
	health.TokenCostToday["input_tokens"] = inputTokens
	health.TokenCostToday["output_tokens"] = outputTokens
	health.TokenCostToday["cached_input_tokens"] = cachedTokens
	health.TokenCostToday["estimated_cost"] = cost
	health.ToolFailureRate["failed_tools_today"] = failedTools
	health.Warnings = evaluateThresholds(loadRuntimeThresholds(), modelCalls, cost, avgLatency, errorRate, deadTasks)
	return health, nil
}

type runtimeThresholds struct {
	DailyModelCallLimit      int
	DailyEstimatedCostLimit  float64
	ModelP95LatencyWarningMS int
	ModelErrorRateWarning    float64
	DeadTaskWarning          int
}

func evaluateThresholds(thresholds runtimeThresholds, calls int, cost float64, avgLatency float64, errorRate float64, deadTasks int) []map[string]any {
	warnings := []map[string]any{}
	if thresholds.DailyModelCallLimit > 0 && calls >= thresholds.DailyModelCallLimit {
		warnings = append(warnings, map[string]any{"code": "daily_model_call_limit", "value": calls, "limit": thresholds.DailyModelCallLimit})
	}
	if thresholds.DailyEstimatedCostLimit > 0 && cost >= thresholds.DailyEstimatedCostLimit {
		warnings = append(warnings, map[string]any{"code": "daily_estimated_cost_limit", "value": cost, "limit": thresholds.DailyEstimatedCostLimit})
	}
	if thresholds.ModelP95LatencyWarningMS > 0 && int(avgLatency) >= thresholds.ModelP95LatencyWarningMS {
		warnings = append(warnings, map[string]any{"code": "model_p95_latency_warning_ms", "value": int(avgLatency), "limit": thresholds.ModelP95LatencyWarningMS, "basis": "avg_latency_until_p95_histogram_exists"})
	}
	if thresholds.ModelErrorRateWarning > 0 && errorRate >= thresholds.ModelErrorRateWarning {
		warnings = append(warnings, map[string]any{"code": "model_error_rate_warning", "value": errorRate, "limit": thresholds.ModelErrorRateWarning})
	}
	if thresholds.DeadTaskWarning >= 0 && deadTasks > thresholds.DeadTaskWarning {
		warnings = append(warnings, map[string]any{"code": "dead_task_warning", "value": deadTasks, "limit": thresholds.DeadTaskWarning})
	}
	return warnings
}

func loadRuntimeThresholds() runtimeThresholds {
	thresholds := runtimeThresholds{
		DailyModelCallLimit:      intEnvValue("DAILY_MODEL_CALL_LIMIT", 0),
		DailyEstimatedCostLimit:  floatEnvValue("DAILY_ESTIMATED_COST_LIMIT", 0),
		ModelP95LatencyWarningMS: intEnvValue("MODEL_P95_LATENCY_WARNING_MS", 0),
		ModelErrorRateWarning:    floatEnvValue("MODEL_ERROR_RATE_WARNING", 0),
		DeadTaskWarning:          intEnvValue("DEAD_TASK_WARNING", 0),
	}
	raw := []byte(nil)
	for _, path := range thresholdCandidates() {
		if path == "" {
			continue
		}
		content, err := os.ReadFile(path)
		if err == nil {
			raw = content
			break
		}
	}
	if raw == nil {
		return thresholds
	}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, ":") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		key := strings.TrimSpace(parts[0])
		value := strings.Trim(strings.TrimSpace(parts[1]), `"'`)
		switch key {
		case "daily_model_call_limit":
			thresholds.DailyModelCallLimit = intFromString(value, thresholds.DailyModelCallLimit)
		case "daily_estimated_cost_limit":
			thresholds.DailyEstimatedCostLimit = floatFromString(value, thresholds.DailyEstimatedCostLimit)
		case "model_p95_latency_warning_ms":
			thresholds.ModelP95LatencyWarningMS = intFromString(value, thresholds.ModelP95LatencyWarningMS)
		case "model_error_rate_warning":
			thresholds.ModelErrorRateWarning = floatFromString(value, thresholds.ModelErrorRateWarning)
		case "dead_task_warning":
			thresholds.DeadTaskWarning = intFromString(value, thresholds.DeadTaskWarning)
		}
	}
	return thresholds
}

func thresholdCandidates() []string {
	if path := os.Getenv("COST_THRESHOLDS_CONFIG"); path != "" {
		return []string{path}
	}
	configDir := os.Getenv("CONFIG_DIR")
	return []string{
		configDir + "/thresholds.yaml",
		configDir + "/thresholds.example.yaml",
		"configs/thresholds.yaml",
		"configs/thresholds.example.yaml",
		"../../configs/thresholds.yaml",
		"../../configs/thresholds.example.yaml",
	}
}

func intEnvValue(key string, fallback int) int {
	return intFromString(os.Getenv(key), fallback)
}

func floatEnvValue(key string, fallback float64) float64 {
	return floatFromString(os.Getenv(key), fallback)
}

func intFromString(value string, fallback int) int {
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func floatFromString(value string, fallback float64) float64 {
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func (db *DB) MetricsText(ctx context.Context) string {
	health, _ := db.SystemHealth(ctx)
	return fmt.Sprintf("joi_active_tasks %v\njoi_dead_tasks %v\njoi_model_input_tokens_today %v\njoi_model_output_tokens_today %v\njoi_tool_failures_today %v\n",
		health.QueueStatus["active_tasks"], health.QueueStatus["dead_tasks"], health.TokenCostToday["input_tokens"], health.TokenCostToday["output_tokens"], health.ToolFailureRate["failed_tools_today"])
}

func (db *DB) ModelUsageSummary(ctx context.Context) (map[string]any, error) {
	rows, err := db.sql.QueryContext(ctx, `
		SELECT provider, model_name, COALESCE(agent_id, ''), COUNT(*),
		       COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cached_input_tokens),0),
		       COALESCE(AVG(latency_ms),0),
		       COUNT(*) FILTER (WHERE status='fallback_to_mock'),
		       COUNT(*) FILTER (WHERE status <> 'succeeded' AND status <> 'fallback_to_mock')
		FROM model_calls
		GROUP BY provider, model_name, COALESCE(agent_id, '')
		ORDER BY SUM(input_tokens + output_tokens) DESC
		LIMIT 100
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var provider, model, agent string
		var calls, inTok, outTok, cached, fallback, errors int
		var latency float64
		if err := rows.Scan(&provider, &model, &agent, &calls, &inTok, &outTok, &cached, &latency, &fallback, &errors); err != nil {
			return nil, err
		}
		hit := 0.0
		if inTok > 0 {
			hit = float64(cached) / float64(inTok)
		}
		items = append(items, map[string]any{"provider": provider, "model": model, "agent": agent, "calls": calls, "input_tokens": inTok, "output_tokens": outTok, "cached_input_tokens": cached, "cache_hit_ratio": hit, "avg_latency_ms": latency, "fallback_calls": fallback, "error_calls": errors, "estimated_cost": estimateModelCost(provider, model, inTok, outTok, cached)})
	}
	return map[string]any{"items": items}, rows.Err()
}

type modelPrice struct {
	InputPer1M       float64
	OutputPer1M      float64
	CachedInputPer1M float64
}

func estimateModelCost(provider string, model string, inputTokens int, outputTokens int, cachedInputTokens int) float64 {
	prices := loadModelPricing()
	price, ok := prices[provider+"/"+model]
	if !ok {
		price, ok = prices[provider+"/*"]
	}
	if !ok {
		return 0
	}
	nonCachedInput := inputTokens - cachedInputTokens
	if nonCachedInput < 0 {
		nonCachedInput = 0
	}
	return (float64(nonCachedInput)*price.InputPer1M + float64(cachedInputTokens)*price.CachedInputPer1M + float64(outputTokens)*price.OutputPer1M) / 1_000_000
}

func loadModelPricing() map[string]modelPrice {
	raw := []byte(nil)
	for _, path := range modelPricingCandidates() {
		if path == "" {
			continue
		}
		content, err := os.ReadFile(path)
		if err == nil {
			raw = content
			break
		}
	}
	if raw == nil {
		return map[string]modelPrice{}
	}
	prices := map[string]modelPrice{}
	currentProvider := ""
	currentModel := ""
	current := modelPrice{}
	flush := func() {
		if currentProvider != "" && currentModel != "" {
			prices[currentProvider+"/"+currentModel] = current
		}
	}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "- "))
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, ":") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		key := strings.TrimSpace(parts[0])
		value := strings.Trim(strings.TrimSpace(parts[1]), `"'`)
		if key == "provider" {
			flush()
			currentProvider = value
			currentModel = ""
			current = modelPrice{}
			continue
		}
		if key == "model" {
			currentModel = value
			continue
		}
		number, _ := strconv.ParseFloat(value, 64)
		switch key {
		case "input_per_1m":
			current.InputPer1M = number
		case "output_per_1m":
			current.OutputPer1M = number
		case "cached_input_per_1m":
			current.CachedInputPer1M = number
		}
	}
	flush()
	return prices
}

func modelPricingCandidates() []string {
	if path := os.Getenv("MODEL_PRICING_CONFIG"); path != "" {
		return []string{path}
	}
	configDir := os.Getenv("CONFIG_DIR")
	return []string{
		configDir + "/model_pricing.yaml",
		configDir + "/model_pricing.example.yaml",
		"configs/model_pricing.yaml",
		"configs/model_pricing.example.yaml",
		"../../configs/model_pricing.yaml",
		"../../configs/model_pricing.example.yaml",
	}
}
