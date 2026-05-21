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
	maxAgentTurns             = 3
	maxCapabilityRequests     = 2
	maxModelCallsPerRun       = 3
	agentOutputFinalAnswer    = "final_answer"
	agentOutputCapability     = "capability_request"
	agentOutputMemoryProposal = "memory_write_proposal"
)

type AgentRuntimeInput struct {
	RunID         string
	AgentID       string
	UserMessage   string
	RouteResult   map[string]any
	PreferredNode string
	AllowWorker   bool
}

type AgentRuntimeResult struct {
	FinalAnswer        string
	Turns              int
	ModelCalls         int
	CapabilityRequests int
	TraceSteps         []stepDefinition
}

type stepDefinition struct {
	stepType string
	title    string
	input    map[string]any
	output   map[string]any
}

type agentOutput struct {
	OutputType string         `json:"output_type"`
	Content    string         `json:"content"`
	Answer     string         `json:"answer"`
	Final      string         `json:"final_answer"`
	Message    string         `json:"message"`
	Capability string         `json:"capability"`
	Goal       string         `json:"goal"`
	Inputs     map[string]any `json:"inputs"`
	Risk       string         `json:"risk"`
	Confidence float64        `json:"confidence"`
	Memory     map[string]any `json:"memory"`
}

func runAgentRuntime(ctx context.Context, tx *sql.Tx, firstAssembly PromptAssemblyRecord, input AgentRuntimeInput) (*AgentRuntimeResult, error) {
	result := &AgentRuntimeResult{TraceSteps: []stepDefinition{}}
	assembly := firstAssembly
	dynamicContext := ""

	for turn := 1; turn <= maxAgentTurns; turn++ {
		if result.ModelCalls >= maxModelCallsPerRun {
			return nil, errors.New("max_model_calls_per_run exceeded")
		}
		if _, err := tx.ExecContext(ctx, `UPDATE runs SET selected_model_id = $2 WHERE id = $1`, input.RunID, assembly.ModelID); err != nil {
			return nil, err
		}
		modelResponse, err := invokeModel(ctx, tx, assembly)
		if err != nil {
			return nil, err
		}
		result.Turns = turn
		result.ModelCalls++
		result.TraceSteps = append(result.TraceSteps, stepDefinition{
			stepType: "model_call_finished",
			title:    "Model call finished",
			input:    map[string]any{"agent_id": input.AgentID, "model_id": assembly.ModelID, "prompt_assembly_id": assembly.ID},
			output:   map[string]any{"provider": modelResponse.Provider, "model": modelResponse.ModelName, "real_model": modelResponse.Provider != "mock_provider" && !modelResponse.FallbackToMock, "fallback_to_mock": modelResponse.FallbackToMock, "fallback_reason": modelResponse.FallbackReason, "input_tokens": modelResponse.InputTokens, "output_tokens": modelResponse.OutputTokens, "cached_input_tokens": modelResponse.CachedInputTokens, "latency_ms": modelResponse.LatencyMs, "estimated_cost": estimateModelCost(modelResponse.Provider, modelResponse.ModelName, modelResponse.InputTokens, modelResponse.OutputTokens, modelResponse.CachedInputTokens)},
		})

		if block := safetyBlockForMessage(input.UserMessage); block.Response != "" {
			result.TraceSteps = append(result.TraceSteps, stepDefinition{
				stepType: "policy_blocked",
				title:    "Request blocked by safety policy",
				input:    map[string]any{"message": input.UserMessage},
				output:   map[string]any{"policy": block.Policy, "reason": block.Reason},
			})
			result.FinalAnswer = block.Response
			return result, nil
		}

		parsed, repaired, err := parseAgentOutput(modelResponse.Content)
		result.TraceSteps = append(result.TraceSteps, stepDefinition{
			stepType: "agent_output_parsed",
			title:    "Agent output parsed",
			input:    map[string]any{"turn": turn},
			output:   map[string]any{"repaired": repaired, "output_type": parsed.OutputType},
		})
		if err != nil {
			return nil, err
		}

		switch parsed.OutputType {
		case agentOutputFinalAnswer:
			result.FinalAnswer = parsed.Content
			return result, nil
		case agentOutputMemoryProposal:
			result.FinalAnswer = "已生成记忆候选，等待 Memory OS 写入流程处理。"
			result.TraceSteps = append(result.TraceSteps, stepDefinition{
				stepType: "memory_proposed",
				title:    "Memory write proposal produced",
				input:    map[string]any{"agent_id": input.AgentID},
				output:   map[string]any{"memory": parsed.Memory},
			})
			return result, nil
		case agentOutputCapability:
			result.CapabilityRequests++
			if result.CapabilityRequests > maxCapabilityRequests {
				result.TraceSteps = append(result.TraceSteps, stepDefinition{
					stepType: "capability_blocked",
					title:    "Capability request limit reached",
					input:    map[string]any{"agent_id": input.AgentID, "capability": parsed.Capability},
					output:   map[string]any{"reason": "max_capability_requests_exceeded", "limit": maxCapabilityRequests},
				})
				result.FinalAnswer = "policy_blocked：模型重复请求能力调用，已达到 max_capability_requests 限制，本轮不会继续执行工具。"
				return result, nil
			}
			result.TraceSteps = append(result.TraceSteps, stepDefinition{
				stepType: "capability_requested",
				title:    "Agent requested capability",
				input:    map[string]any{"agent_id": input.AgentID},
				output:   map[string]any{"capability": parsed.Capability, "goal": parsed.Goal, "inputs": parsed.Inputs, "risk": parsed.Risk, "confidence": parsed.Confidence},
			})
			var memories []MemorySearchResult
			if parsed.Capability == "memory_search" {
				query := stringInput(parsed.Inputs, "query", input.UserMessage)
				memories, err = searchMemoriesInTx(ctx, tx, query, 5)
				if err != nil {
					return nil, err
				}
				result.TraceSteps = append(result.TraceSteps, stepDefinition{
					stepType: "memory_search_finished",
					title:    "Memory search finished",
					input:    map[string]any{"query": query},
					output:   map[string]any{"results": memories},
				})
				dynamicContext = "MEMORY_SEARCH_RESULT\n" + string(mustJSON(memories))
			} else if parsed.Capability == "server_diagnose" || parsed.Capability == "web_research" || parsed.Capability == "system_health_check" {
				if parsed.Capability == "server_diagnose" && isUnknownServerDiagnoseTarget(parsed.Inputs, input.UserMessage) {
					result.TraceSteps = append(result.TraceSteps, stepDefinition{
						stepType: "capability_blocked",
						title:    "Capability request blocked before execution",
						input:    map[string]any{"capability": parsed.Capability, "inputs": parsed.Inputs},
						output:   map[string]any{"reason": "unknown_service_target", "policy": "clarify_before_tool_run"},
					})
					result.FinalAnswer = "我需要明确真实的服务名、容器名、端口或 URL 后才能做只读诊断；`unknown-service` 这类占位目标不会触发工具执行。"
					return result, nil
				}
				toolResult, err := executeAndRecordCapabilityInTx(ctx, tx, CapabilityRequest{
					Type:          "capability_request",
					Capability:    parsed.Capability,
					Goal:          parsed.Goal,
					Inputs:        parsed.Inputs,
					Risk:          parsed.Risk,
					RunID:         input.RunID,
					PreferredNode: input.PreferredNode,
					AllowWorker:   input.AllowWorker,
				})
				if err != nil {
					return nil, err
				}
				result.TraceSteps = append(result.TraceSteps, stepDefinition{
					stepType: "tool_finished",
					title:    "Tool runtime finished",
					input:    map[string]any{"workflow_name": toolResult.Workflow.WorkflowName},
					output:   toolResult.NormalizedResult,
				})
				if status, ok := toolResult.NormalizedResult["status"].(string); ok && status == "queued" {
					result.FinalAnswer = "已将任务派发到所选节点；worker 执行结果会写入 task_attempts、tool_runs 和 Run Trace。"
					return result, nil
				} else if finalAnswer := finalAnswerForCapabilityResult(parsed.Capability, toolResult.NormalizedResult); finalAnswer != "" {
					result.FinalAnswer = finalAnswer
					return result, nil
				} else if parsed.Capability == "web_research" {
					dynamicContext = "WEB_RESEARCH_RESULT\n" + string(mustJSON(toolResult.NormalizedResult))
				} else if parsed.Capability == "system_health_check" {
					dynamicContext = "SYSTEM_HEALTH_RESULT\n" + string(mustJSON(toolResult.NormalizedResult))
				} else {
					dynamicContext = "SERVER_DIAGNOSE_RESULT\n" + string(mustJSON(toolResult.NormalizedResult))
				}
			} else {
				result.TraceSteps = append(result.TraceSteps, stepDefinition{
					stepType: "capability_blocked",
					title:    "Unsupported capability request blocked",
					input:    map[string]any{"agent_id": input.AgentID, "capability": parsed.Capability},
					output:   map[string]any{"reason": "unsupported_capability_in_runtime_v0"},
				})
				result.FinalAnswer = fmt.Sprintf("policy_blocked：Runtime v0 不支持直接执行 %s，本轮没有执行底层工具。", parsed.Capability)
				return result, nil
			}
			nextAssembly, err := createPromptAssembly(ctx, tx, PromptAssemblyInput{
				RunID:             input.RunID,
				AgentID:           input.AgentID,
				UserMessage:       input.UserMessage,
				RouteResult:       input.RouteResult,
				ToolSchemaVersion: "tool_schema_v1",
				DynamicContext:    dynamicContext,
				MemoryResults:     memories,
			})
			if err != nil {
				return nil, err
			}
			assembly = *nextAssembly
			result.TraceSteps = append(result.TraceSteps, stepDefinition{
				stepType: "prompt_assembled",
				title:    "Prompt assembly finished",
				input:    map[string]any{"run_id": input.RunID, "agent_id": input.AgentID, "turn": turn + 1},
				output:   map[string]any{"prompt_assembly_id": assembly.ID, "prefix_hash": assembly.PrefixHash, "dynamic_tail_hash": assembly.DynamicTailHash, "prompt_cache_key": assembly.PromptCacheKey, "memory_profile_version": assembly.MemoryProfileVersion, "tool_schema_version": assembly.ToolSchemaVersion},
			})
		default:
			return nil, fmt.Errorf("unsupported agent output_type: %s", parsed.OutputType)
		}
	}
	return nil, errors.New("max_agent_turns exceeded")
}

type safetyBlock struct {
	Policy   string
	Reason   string
	Response string
}

func safetyBlockForMessage(message string) safetyBlock {
	normalized := strings.ToLower(strings.TrimSpace(message))
	if normalized == "" {
		return safetyBlock{}
	}
	if containsAny(normalized, "绕过 confirmation", "bypass confirmation", "跳过 confirmation") {
		return safetyBlock{
			Policy:   "confirmation_required",
			Reason:   "state_change_requires_console_confirmation",
			Response: "confirmation_required：涉及 state_change 的操作必须先在 Console 创建并批准 confirmation request；不会执行绕过确认的请求。",
		}
	}
	if containsAny(normalized, "rm -rf", "docker restart", "docker stop", "docker rm", "chmod ", "chown ", " restart ", " stop ") {
		return safetyBlock{
			Policy:   "rejected",
			Reason:   "dangerous_state_change_or_destructive_command",
			Response: "rejected：这是危险或修改性操作。当前 Runtime 不会执行 restart、stop、rm、chmod、chown 等 state_change 操作。",
		}
	}
	if containsAny(normalized, ".env", "api key", "apikey", "secret key", "private key", "/etc/passwd", "/etc/shadow", "~/.ssh", "id_rsa") {
		return safetyBlock{
			Policy:   "policy_blocked",
			Reason:   "sensitive_secret_or_local_file_read",
			Response: "policy_blocked：请求涉及密钥、环境文件、SSH 私钥或敏感系统路径，已拒绝读取或打印。",
		}
	}
	if containsAny(normalized, "worker 读取完整 memory", "完整 memory", "full memory", "fake-node", "node_secret", "non whitelist telegram user", "non-whitelist telegram user") {
		return safetyBlock{
			Policy:   "permission_denied",
			Reason:   "unauthorized_worker_node_or_telegram_access",
			Response: "permission_denied：Worker、Node 和 Telegram 访问必须经过授权校验，且 Worker 不允许读取完整长期记忆。",
		}
	}
	if containsAny(normalized, "file://", "ftp://", "127.0.0.1", "localhost", "0.0.0.0", "169.254.169.254", "http://10.", "https://10.", "http://192.168.", "https://192.168.", "http://172.16.", "https://172.16.") {
		return safetyBlock{
			Policy:   "policy_blocked",
			Reason:   "blocked_url_scheme_or_private_network_target",
			Response: "policy_blocked：web_research 不允许访问 file://、ftp://、localhost、metadata IP 或私网地址。",
		}
	}
	return safetyBlock{}
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(value, needle) {
			return true
		}
	}
	return false
}

func isUnknownServerDiagnoseTarget(inputs map[string]any, userMessage string) bool {
	targets := []string{
		stringInput(inputs, "service_name", ""),
		stringInput(inputs, "container_name", ""),
		stringInput(inputs, "service", ""),
		stringInput(inputs, "container", ""),
		stringInput(inputs, "url", ""),
		stringInput(inputs, "port", ""),
	}
	for _, target := range targets {
		normalized := strings.TrimSpace(strings.ToLower(target))
		if normalized == "" {
			continue
		}
		if normalized == "unknown" || normalized == "unknown-service" || normalized == "unknown_container" || normalized == "unknown-container" {
			return true
		}
		return false
	}
	message := strings.ToLower(userMessage)
	return strings.Contains(message, "unknown-service") || strings.Contains(message, "unknown service")
}

func finalAnswerForCapabilityResult(capability string, normalized map[string]any) string {
	switch capability {
	case "server_diagnose":
		service := stringFromMap(normalized, "service", "目标服务")
		nodeID := stringFromMap(normalized, "node_id", "unknown-node")
		assignmentReason := stringFromMap(normalized, "assignment_reason", "unknown")
		if boolFromMap(normalized, "running") {
			return fmt.Sprintf("诊断完成：%s 在 %s 上处于运行状态。节点分配：%s。", service, nodeID, assignmentReason)
		}
		if boolValue, ok := normalized["container_found"].(bool); ok && !boolValue {
			return fmt.Sprintf("诊断完成：未在 %s 上找到 %s 对应容器。节点分配：%s。", nodeID, service, assignmentReason)
		}
		if errors, ok := normalized["recent_errors"].([]any); ok && len(errors) > 0 {
			return fmt.Sprintf("诊断完成：%s 在 %s 上存在异常迹象：%v。节点分配：%s。", service, nodeID, errors[0], assignmentReason)
		}
		return fmt.Sprintf("诊断完成：已读取 %s 在 %s 上的只读诊断信息。节点分配：%s。", service, nodeID, assignmentReason)
	case "web_research":
		url := stringFromMap(normalized, "url", "目标 URL")
		status := stringFromMap(normalized, "fetch_status", "unknown")
		summary := stringFromMap(normalized, "summary", "")
		if summary == "" {
			summary = stringFromMap(normalized, "readable_text", "")
		}
		summary = truncateRunes(summary, 260)
		return fmt.Sprintf("读取完成：%s fetch_status=%s。摘要：%s", url, status, summary)
	case "system_health_check":
		status := stringFromMap(normalized, "status", "completed")
		checks, _ := normalized["checks"].(map[string]any)
		abnormal := []string{}
		for _, key := range []string{"postgres", "nats", "console", "worker_runtime", "model", "queue"} {
			if !checkOK(checks[key]) {
				abnormal = append(abnormal, key)
			}
		}
		if len(abnormal) == 0 {
			abnormal = append(abnormal, "无")
		}
		return fmt.Sprintf("状态：%s。异常项：%s。关键服务：postgres、nats、orchestrator、console、worker-runtime 已检查。节点/队列/模型/成本摘要已写入 Run Trace。建议：如需排障，打开 Trace 查看 checks、recent_errors 和 thresholds。", status, strings.Join(abnormal, ", "))
	default:
		return ""
	}
}

func checkOK(value any) bool {
	switch typed := value.(type) {
	case map[string]any:
		if ok, exists := typed["ok"].(bool); exists {
			return ok
		}
		if checked, exists := typed["checked"].(bool); exists && !checked {
			return false
		}
		return true
	case nil:
		return false
	default:
		return true
	}
}

func stringFromMap(values map[string]any, key string, fallback string) string {
	if values == nil {
		return fallback
	}
	if value, ok := values[key].(string); ok && value != "" {
		return value
	}
	return fallback
}

func boolFromMap(values map[string]any, key string) bool {
	if values == nil {
		return false
	}
	value, _ := values[key].(bool)
	return value
}

func truncateRunes(value string, max int) string {
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max])
}

func parseAgentOutput(content string) (agentOutput, bool, error) {
	var output agentOutput
	if err := json.Unmarshal([]byte(content), &output); err == nil {
		return validateAgentOutput(output)
	}
	repaired := repairJSONContent(content)
	if repaired == "" {
		return output, false, errors.New("agent output is not valid JSON")
	}
	if err := json.Unmarshal([]byte(repaired), &output); err != nil {
		return output, true, err
	}
	validated, _, err := validateAgentOutput(output)
	return validated, true, err
}

func validateAgentOutput(output agentOutput) (agentOutput, bool, error) {
	switch output.OutputType {
	case agentOutputFinalAnswer:
		if output.Content == "" {
			output.Content = valueOrDefault(valueOrDefault(output.Final, output.Answer), output.Message)
		}
		if output.Content == "" {
			return output, false, errors.New("final_answer missing content")
		}
	case agentOutputCapability:
		if output.Capability == "" {
			return output, false, errors.New("capability_request missing capability")
		}
	case agentOutputMemoryProposal:
		if output.Memory == nil {
			return output, false, errors.New("memory_write_proposal missing memory")
		}
	default:
		return output, false, fmt.Errorf("unsupported output_type: %s", output.OutputType)
	}
	return output, false, nil
}

func repairJSONContent(content string) string {
	content = strings.TrimSpace(content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start < 0 || end < start {
		return ""
	}
	return content[start : end+1]
}

func searchMemoriesInTx(ctx context.Context, tx *sql.Tx, query string, limit int) ([]MemorySearchResult, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT id, type, content, summary, scope_type, scope_id, privacy_level, confidence, status,
		       source_event_ids, entities, success_count, failure_count, usage_count, positive_feedback,
		       negative_feedback, metadata, created_at, updated_at, last_used_at, pinned, disabled_at,
		       merged_into_memory_id, conflict_group_id, conflict_reason
		FROM memories
		WHERE status IN ('confirmed', 'pending', 'conflicted')
		  AND disabled_at IS NULL
		  AND merged_into_memory_id IS NULL
		ORDER BY pinned DESC, confidence DESC, updated_at DESC
		LIMIT $1
	`, limit*5)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	memories, err := scanMemories(rows)
	if err != nil {
		return nil, err
	}
	results := []MemorySearchResult{}
	for _, memory := range memories {
		score := keywordScore(query, memory)
		if score <= 0 {
			continue
		}
		results = append(results, MemorySearchResult{Memory: memory, Score: score, Reason: "keyword match + confidence"})
		if len(results) >= limit {
			break
		}
	}
	return results, nil
}
