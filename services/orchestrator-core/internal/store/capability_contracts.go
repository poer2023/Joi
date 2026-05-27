package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

type CapabilityContract struct {
	ID               string         `json:"id"`
	Version          string         `json:"version"`
	Source           string         `json:"source"`
	IntentDomain     string         `json:"intent_domain"`
	Description      string         `json:"description"`
	PositiveExamples []string       `json:"positive_examples"`
	NegativeExamples []string       `json:"negative_examples"`
	InputSchema      map[string]any `json:"input_schema"`
	OutputSchema     map[string]any `json:"output_schema"`
	RiskLevel        string         `json:"risk_level"`
	PrivacyLevel     string         `json:"privacy_level"`
	WorkflowID       string         `json:"workflow_id"`
	UIVisibility     string         `json:"ui_visibility"`
}

type CapabilityValidationResult struct {
	OK              bool                `json:"ok"`
	Code            string              `json:"code"`
	MatchedContract *CapabilityContract `json:"matched_contract,omitempty"`
	Message         string              `json:"message"`
	Expected        string              `json:"expected_capability,omitempty"`
}

type CapabilityValidationError struct {
	Result CapabilityValidationResult
	Err    error
}

func (e *CapabilityValidationError) Error() string {
	if strings.TrimSpace(e.Result.Message) != "" {
		return e.Result.Message
	}
	if e.Err != nil {
		return e.Err.Error()
	}
	return "capability validation failed"
}

func (e *CapabilityValidationError) Unwrap() error {
	return e.Err
}

func CapabilityValidationResultFromError(err error) (CapabilityValidationResult, bool) {
	var validation *CapabilityValidationError
	if AsCapabilityValidationError(err, &validation) {
		return validation.Result, true
	}
	return CapabilityValidationResult{}, false
}

func AsCapabilityValidationError(err error, target **CapabilityValidationError) bool {
	for err != nil {
		if typed, ok := err.(*CapabilityValidationError); ok {
			*target = typed
			return true
		}
		type unwrapper interface {
			Unwrap() error
		}
		unwrapped, ok := err.(unwrapper)
		if !ok {
			return false
		}
		err = unwrapped.Unwrap()
	}
	return false
}

func CapabilityContracts() []CapabilityContract {
	items := []CapabilityContract{}
	for _, id := range []string{
		"memory_search",
		"server_diagnose",
		"system_health_check",
		"web_research",
		"workspace_search",
		"file_analyze",
		"desktop_app_list",
		"desktop_app_inspect",
		"browser_read",
		"computer_observe",
	} {
		if contract, ok := CapabilityContractFor(id); ok {
			items = append(items, contract)
		}
	}
	return items
}

func CapabilityContractFor(capability string) (CapabilityContract, bool) {
	capability = CanonicalCapabilityName(capability)
	contract, ok := defaultCapabilityContracts()[capability]
	return contract, ok
}

func CapabilityContractMetadata(capability string) map[string]any {
	contract, ok := CapabilityContractFor(capability)
	if !ok {
		return map[string]any{}
	}
	return map[string]any{
		"contract":          contract,
		"source":            contract.Source,
		"intent_domain":     contract.IntentDomain,
		"positive_examples": contract.PositiveExamples,
		"negative_examples": contract.NegativeExamples,
		"input_schema":      contract.InputSchema,
		"output_schema":     contract.OutputSchema,
		"privacy_level":     contract.PrivacyLevel,
		"workflow_id":       contract.WorkflowID,
		"ui_visibility":     contract.UIVisibility,
	}
}

func mergeCapabilityContractMetadata(capability string, metadata map[string]any) map[string]any {
	merged := map[string]any{}
	for key, value := range metadata {
		merged[key] = value
	}
	for key, value := range CapabilityContractMetadata(capability) {
		merged[key] = value
	}
	return merged
}

func ValidateCapabilityRequest(request CapabilityRequest) (CapabilityValidationResult, error) {
	request.Capability = CanonicalCapabilityName(request.Capability)
	contract, ok := CapabilityContractFor(request.Capability)
	if !ok {
		result := CapabilityValidationResult{
			OK:      false,
			Code:    "CAPABILITY_MISSING",
			Message: fmt.Sprintf("Joi has no capability contract for %q.", request.Capability),
		}
		return result, &CapabilityValidationError{Result: result, Err: ErrCapabilityMissing}
	}
	return validateCapabilityRequestAgainstContract(request, contract)
}

func ValidateCapabilityRequestWithRegistry(ctx context.Context, tx capabilityCompilerTx, request CapabilityRequest) (CapabilityValidationResult, error) {
	request.Capability = CanonicalCapabilityName(request.Capability)
	contract, ok, err := CapabilityContractFromRegistry(ctx, tx, request.Capability)
	if err != nil {
		return CapabilityValidationResult{}, err
	}
	if !ok {
		result := CapabilityValidationResult{
			OK:      false,
			Code:    "CAPABILITY_MISSING",
			Message: fmt.Sprintf("Joi has no capability contract for %q.", request.Capability),
		}
		return result, &CapabilityValidationError{Result: result, Err: ErrCapabilityMissing}
	}
	return validateCapabilityRequestAgainstContract(request, contract)
}

func CapabilityContractFromRegistry(ctx context.Context, tx capabilityCompilerTx, capability string) (CapabilityContract, bool, error) {
	capability = CanonicalCapabilityName(capability)
	var metadataRaw []byte
	var enabled bool
	err := tx.QueryRowContext(ctx, `SELECT metadata, enabled FROM capabilities WHERE id=$1`, capability).Scan(&metadataRaw, &enabled)
	if errorsIsNoRows(err) {
		contract, ok := CapabilityContractFor(capability)
		return contract, ok, nil
	}
	if err != nil {
		return CapabilityContract{}, false, err
	}
	if !enabled {
		return CapabilityContract{}, false, nil
	}
	metadata := decodeObject(metadataRaw)
	if contract, ok := capabilityContractFromMetadata(metadata); ok {
		contract.ID = CanonicalCapabilityName(valueOrDefault(contract.ID, capability))
		if !completeCapabilityContract(contract) {
			return CapabilityContract{}, false, nil
		}
		return contract, true, nil
	}
	if source, _ := metadata["source"].(string); source == "mcp_wrapped" || source == "skill" {
		return CapabilityContract{}, false, nil
	}
	contract, ok := CapabilityContractFor(capability)
	return contract, ok, nil
}

func validateCapabilityRequestAgainstContract(request CapabilityRequest, contract CapabilityContract) (CapabilityValidationResult, error) {
	matched := contract
	result := CapabilityValidationResult{
		OK:              true,
		Code:            "OK",
		MatchedContract: &matched,
		Message:         "capability contract matched",
	}

	text := capabilitySemanticText(request)
	if strings.TrimSpace(text) == "" {
		result.Message = "capability contract exists; no semantic evidence supplied"
		return result, nil
	}

	if missing := missingRequiredCapabilityArgumentForContract(request, contract); missing != "" {
		result.OK = false
		result.Code = "MISSING_ARGUMENT"
		result.Message = fmt.Sprintf("%s requires %s.", request.Capability, missing)
		return result, &CapabilityValidationError{Result: result, Err: ErrMissingArgument}
	}

	if expected := expectedCapabilityForSemanticText(text, request.Inputs); expected != "" && expected != request.Capability {
		result.OK = false
		result.Code = "CAPABILITY_MISMATCH"
		result.Expected = expected
		result.Message = fmt.Sprintf("user intent matches %s, not %s", expected, request.Capability)
		return result, &CapabilityValidationError{Result: result, Err: ErrCapabilityMismatch}
	}

	if contract.Source == "native" && !capabilityMatchesSemanticText(request.Capability, text, request.Inputs) {
		result.OK = false
		result.Code = "CAPABILITY_MISMATCH"
		result.Message = fmt.Sprintf("request evidence does not match %s intent domain", request.Capability)
		return result, &CapabilityValidationError{Result: result, Err: ErrCapabilityMismatch}
	}

	return result, nil
}

func capabilityContractFromMetadata(metadata map[string]any) (CapabilityContract, bool) {
	raw, ok := metadata["contract"]
	if !ok || raw == nil {
		return CapabilityContract{}, false
	}
	bytes, err := json.Marshal(raw)
	if err != nil {
		return CapabilityContract{}, false
	}
	var contract CapabilityContract
	if err := json.Unmarshal(bytes, &contract); err != nil {
		return CapabilityContract{}, false
	}
	if strings.TrimSpace(contract.ID) == "" {
		return CapabilityContract{}, false
	}
	return contract, true
}

func completeCapabilityContract(contract CapabilityContract) bool {
	return strings.TrimSpace(contract.ID) != "" &&
		strings.TrimSpace(contract.Version) != "" &&
		strings.TrimSpace(contract.Source) != "" &&
		strings.TrimSpace(contract.IntentDomain) != "" &&
		strings.TrimSpace(contract.Description) != "" &&
		strings.TrimSpace(contract.RiskLevel) != "" &&
		strings.TrimSpace(contract.PrivacyLevel) != "" &&
		strings.TrimSpace(contract.WorkflowID) != "" &&
		strings.TrimSpace(contract.UIVisibility) != "" &&
		len(contract.PositiveExamples) > 0 &&
		len(contract.NegativeExamples) > 0 &&
		contract.InputSchema != nil &&
		contract.OutputSchema != nil
}

func errorsIsNoRows(err error) bool {
	return err == sql.ErrNoRows
}

func defaultCapabilityContracts() map[string]CapabilityContract {
	readObject := map[string]any{"type": "object", "additionalProperties": true}
	return map[string]CapabilityContract{
		"memory_search": {
			ID: "memory_search", Version: "v1", Source: "native", IntentDomain: "memory_recall",
			Description:      "Search confirmed local memories and return bounded context.",
			PositiveExamples: []string{"之前我说过什么偏好", "召回部署相关记忆"},
			NegativeExamples: []string{"列出本机所有应用", "读取网页"},
			InputSchema:      map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}}, "required": []string{"query"}},
			OutputSchema:     readObject, RiskLevel: "read_only", PrivacyLevel: "private_content", WorkflowID: "memory_search_v1", UIVisibility: "chat",
		},
		"server_diagnose": {
			ID: "server_diagnose", Version: "v1", Source: "native", IntentDomain: "service_diagnostics",
			Description:      "Read-only diagnostics for a named service, container, port, or URL.",
			PositiveExamples: []string{"诊断 cloudflared 服务", "检查 8080 端口和容器日志"},
			NegativeExamples: []string{"列出本地所有 app", "总结一个网页"},
			InputSchema:      readObject, OutputSchema: readObject, RiskLevel: "read_only", PrivacyLevel: "local_metadata", WorkflowID: "server_diagnose_v1", UIVisibility: "chat",
		},
		"system_health_check": {
			ID: "system_health_check", Version: "v1", Source: "native", IntentDomain: "joi_runtime_health",
			Description:      "Read-only Joi runtime health check across local service status, queue, model, and worker summaries.",
			PositiveExamples: []string{"检查 Joi 是否健康", "系统自检", "检查本地 app 是否健康"},
			NegativeExamples: []string{"列出本地所有 app", "有哪些已安装应用"},
			InputSchema:      readObject, OutputSchema: readObject, RiskLevel: "read_only", PrivacyLevel: "local_metadata", WorkflowID: "system_health_check_v1", UIVisibility: "chat",
		},
		"web_research": {
			ID: "web_research", Version: "v2", Source: "native", IntentDomain: "public_web_read",
			Description:      "Fetch and summarize an explicit public HTTP or HTTPS URL.",
			PositiveExamples: []string{"总结 https://example.com", "读取这个网页链接"},
			NegativeExamples: []string{"列出本机应用", "读取本地私有文件"},
			InputSchema:      map[string]any{"type": "object", "properties": map[string]any{"url": map[string]any{"type": "string"}}, "required": []string{"url"}},
			OutputSchema:     readObject, RiskLevel: "read_only", PrivacyLevel: "public", WorkflowID: "web_research_v2", UIVisibility: "chat",
		},
		"browser_read": {
			ID: "browser_read", Version: "v1", Source: "native", IntentDomain: "browser_page_read",
			Description:      "Read a page by URL through the same host policy as web research.",
			PositiveExamples: []string{"读取这个浏览器页面 URL", "打开链接并总结"},
			NegativeExamples: []string{"列出本机应用", "点击本地 app 按钮"},
			InputSchema:      map[string]any{"type": "object", "properties": map[string]any{"url": map[string]any{"type": "string"}}, "required": []string{"url"}},
			OutputSchema:     readObject, RiskLevel: "read_only", PrivacyLevel: "public", WorkflowID: "browser_read_v1", UIVisibility: "chat",
		},
		"workspace_search": {
			ID: "workspace_search", Version: "v1", Source: "native", IntentDomain: "workspace_search",
			Description:      "Search authorized workspace files by query without shell access.",
			PositiveExamples: []string{"在当前项目里找 Run Trace", "搜索 workspace 中的配置"},
			NegativeExamples: []string{"列出本机所有应用", "读取 URL"},
			InputSchema:      map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}, "root": map[string]any{"type": "string"}}},
			OutputSchema:     readObject, RiskLevel: "read_only", PrivacyLevel: "private_content", WorkflowID: "workspace_search_v1", UIVisibility: "chat",
		},
		"file_analyze": {
			ID: "file_analyze", Version: "v1", Source: "native", IntentDomain: "authorized_file_read",
			Description:      "Read and summarize one authorized workspace file.",
			PositiveExamples: []string{"读一下 AGENTS.md", "分析这个项目文件"},
			NegativeExamples: []string{"列出本机所有应用", "做系统健康检查"},
			InputSchema:      map[string]any{"type": "object", "properties": map[string]any{"path": map[string]any{"type": "string"}}, "required": []string{"path"}},
			OutputSchema:     readObject, RiskLevel: "read_only", PrivacyLevel: "private_content", WorkflowID: "file_analyze_v1", UIVisibility: "chat",
		},
		"desktop_app_list": {
			ID: "desktop_app_list", Version: "v1", Source: "native", IntentDomain: "desktop_application_inventory",
			Description:      "List installed macOS applications as local metadata only.",
			PositiveExamples: []string{"列出本地所有 app", "本机安装了哪些应用"},
			NegativeExamples: []string{"检查 Joi 服务健康", "诊断 Docker 容器"},
			InputSchema:      readObject, OutputSchema: readObject, RiskLevel: "read_only", PrivacyLevel: "local_metadata", WorkflowID: "desktop_app_list_v1", UIVisibility: "chat",
		},
		"desktop_app_inspect": {
			ID: "desktop_app_inspect", Version: "v1", Source: "native", IntentDomain: "desktop_application_metadata",
			Description:      "Inspect one known app bundle by name, bundle id, or path.",
			PositiveExamples: []string{"检查 Joi.app 的版本", "查看 Safari 是否在应用目录里", "你确定有 TextEdit 吗"},
			NegativeExamples: []string{"列出所有 app", "检查数据库健康"},
			InputSchema:      map[string]any{"type": "object", "properties": map[string]any{"name": map[string]any{"type": "string"}, "bundle_id": map[string]any{"type": "string"}, "path": map[string]any{"type": "string"}}},
			OutputSchema:     readObject, RiskLevel: "read_only", PrivacyLevel: "local_metadata", WorkflowID: "desktop_app_inspect_v1", UIVisibility: "chat",
		},
		"computer_observe": {
			ID: "computer_observe", Version: "v1", Source: "native", IntentDomain: "visible_desktop_observation",
			Description:      "Observe visible desktop UI state; direct clicks and typing remain outside this read-only capability.",
			PositiveExamples: []string{"观察当前窗口 UI", "看一下屏幕上 Joi 显示了什么"},
			NegativeExamples: []string{"列出已安装 app", "提交表单"},
			InputSchema:      map[string]any{"type": "object", "properties": map[string]any{"target": map[string]any{"type": "string", "enum": []string{"joi_current_window"}}}},
			OutputSchema:     readObject, RiskLevel: "read_only", PrivacyLevel: "private_content", WorkflowID: "computer_observe_v1", UIVisibility: "chat",
		},
	}
}

func missingRequiredCapabilityArgument(request CapabilityRequest) string {
	switch request.Capability {
	case "web_research", "browser_read":
		if strings.TrimSpace(stringInput(request.Inputs, "url", "")) == "" {
			return "inputs.url"
		}
	case "file_analyze":
		if strings.TrimSpace(stringInput(request.Inputs, "path", "")) == "" {
			return "inputs.path"
		}
	case "desktop_app_inspect":
		if strings.TrimSpace(stringInput(request.Inputs, "name", "")) == "" &&
			strings.TrimSpace(stringInput(request.Inputs, "bundle_id", "")) == "" &&
			strings.TrimSpace(stringInput(request.Inputs, "path", "")) == "" {
			return "inputs.name, inputs.bundle_id, or inputs.path"
		}
	}
	return ""
}

func missingRequiredCapabilityArgumentForContract(request CapabilityRequest, contract CapabilityContract) string {
	if missing := missingRequiredCapabilityArgument(request); missing != "" {
		return missing
	}
	requiredRaw, ok := contract.InputSchema["required"]
	if !ok {
		return ""
	}
	required := []string{}
	switch typed := requiredRaw.(type) {
	case []string:
		required = typed
	case []any:
		for _, item := range typed {
			if text := strings.TrimSpace(fmt.Sprint(item)); text != "" {
				required = append(required, text)
			}
		}
	}
	for _, name := range required {
		if strings.TrimSpace(fmt.Sprint(request.Inputs[name])) == "" || request.Inputs[name] == nil {
			return "inputs." + name
		}
	}
	return ""
}

func capabilitySemanticText(request CapabilityRequest) string {
	parts := []string{request.Goal, request.Evidence}
	for key, value := range request.Inputs {
		parts = append(parts, key, fmt.Sprint(value))
	}
	return strings.ToLower(strings.Join(parts, " "))
}

func expectedCapabilityForSemanticText(text string, inputs map[string]any) string {
	switch {
	case isDesktopAppListIntent(text):
		return "desktop_app_list"
	case hasExplicitURL(text) && !strings.Contains(text, "本机所有") && !strings.Contains(text, "installed app"):
		return "web_research"
	}
	return ""
}

func capabilityMatchesSemanticText(capability string, text string, inputs map[string]any) bool {
	switch capability {
	case "memory_search":
		return strings.TrimSpace(stringInput(inputs, "query", "")) != "" || containsAnyText(text, "记忆", "remember", "memory", "之前", "偏好")
	case "server_diagnose":
		return containsAnyText(text, "服务", "容器", "docker", "端口", "日志", "diagnose", "diagnostic", "service", "container", "port")
	case "system_health_check":
		return containsAnyText(text, "健康", "自检", "health", "status", "状态", "异常", "queue", "worker", "postgres", "nats", "检查本地 app", "检查本地的 app")
	case "web_research", "browser_read":
		return hasExplicitURL(text) || containsAnyText(text, "网页", "网站", "链接", "url", "browser", "page")
	case "workspace_search":
		return strings.TrimSpace(stringInput(inputs, "query", "")) != "" || containsAnyText(text, "workspace", "当前项目", "项目里", "搜索", "查找", "找 ")
	case "file_analyze":
		return strings.TrimSpace(stringInput(inputs, "path", "")) != "" || containsAnyText(text, "读一下", "读取文件", "分析文件", ".md", ".go", ".ts", ".tsx")
	case "desktop_app_list":
		return isDesktopAppListIntent(text)
	case "desktop_app_inspect":
		return strings.TrimSpace(stringInput(inputs, "name", "")) != "" ||
			strings.TrimSpace(stringInput(inputs, "bundle_id", "")) != "" ||
			strings.TrimSpace(stringInput(inputs, "path", "")) != "" ||
			(containsAnyText(text, "确定", "确认", "是否", "是不是", "存在", "安装", "有") &&
				containsAnyText(text, "app", "应用", "软件", "程序"))
	case "computer_observe":
		return containsAnyText(text, "当前窗口", "屏幕", "界面", "ui", "observe", "screenshot")
	default:
		return false
	}
}

func isDesktopAppListIntent(text string) bool {
	return containsAnyText(text, "列出", "所有", "有哪些", "安装了", "installed", "list") &&
		containsAnyText(text, "本地", "本机", "mac", "desktop", "local") &&
		containsAnyText(text, " app", "app ", "应用", "软件", "程序", "applications", "apps")
}

func hasExplicitURL(text string) bool {
	return strings.Contains(text, "http://") || strings.Contains(text, "https://")
}

func containsAnyText(text string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(text, strings.ToLower(needle)) {
			return true
		}
	}
	return false
}
