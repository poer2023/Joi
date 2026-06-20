package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
)

func TestCompileCapabilitySeedsAndPolicy(t *testing.T) {
	ctx := context.Background()
	db := openCapabilityTestDB(t, ctx)
	defer db.Close()

	for _, tc := range []struct {
		capability string
		workflow   string
	}{
		{"memory_search", "memory_search_v1"},
		{"server_diagnose", "server_diagnose_v1"},
		{"system_health_check", "system_health_check_v1"},
		{"web_research", "web_research_v2"},
		{"browser_read", "browser_read_v1"},
		{"browser_observe", "browser_observe_v1"},
		{"workspace_search", "workspace_search_v1"},
		{"file_read", "file_read_v1"},
		{"file_analyze", "file_analyze_v1"},
		{"test_command", "test_command_v1"},
		{"desktop_app_list", "desktop_app_list_v1"},
		{"desktop_app_inspect", "desktop_app_inspect_v1"},
		{"computer_observe", "computer_observe_v1"},
	} {
		t.Run(tc.capability, func(t *testing.T) {
			result, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{Capability: tc.capability, Risk: "read_only"})
			if err != nil {
				t.Fatalf("CompileCapability() error = %v", err)
			}
			if result.Workflow.WorkflowName != tc.workflow {
				t.Fatalf("workflow = %s, want %s", result.Workflow.WorkflowName, tc.workflow)
			}
			if len(result.Workflow.Steps) == 0 {
				t.Fatalf("workflow %s has no steps", tc.workflow)
			}
		})
	}
}

func TestCompileBrowserNavigateCapability(t *testing.T) {
	ctx := context.Background()
	db := openCapabilityTestDB(t, ctx)
	defer db.Close()

	compiled, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{
		Capability: "browser_navigate",
		Goal:       "在当前浏览器打开 https://example.com",
		Evidence:   "用户要求导航前台浏览器到这个 URL",
		Inputs:     map[string]any{"url": "https://example.com"},
		Risk:       "read_only",
	})
	if err != nil {
		t.Fatalf("browser_navigate CompileCapability() error = %v", err)
	}
	if compiled.Workflow.WorkflowName != "browser_navigate_v1" {
		t.Fatalf("workflow = %s, want browser_navigate_v1", compiled.Workflow.WorkflowName)
	}
	if len(compiled.Workflow.Steps) != 1 || compiled.Workflow.Steps[0].Tool != "browser_navigate_url" {
		t.Fatalf("workflow steps = %+v, want browser_navigate_url", compiled.Workflow.Steps)
	}

	_, err = CompileCapability(ctx, db.SQL(), CapabilityRequest{
		Capability: "browser_navigate",
		Goal:       "读取网页 https://example.com 并总结正文",
		Evidence:   "用户要求总结网页内容",
		Inputs:     map[string]any{"url": "https://example.com"},
		Risk:       "read_only",
	})
	if !errors.Is(err, ErrCapabilityMismatch) {
		t.Fatalf("summary-like URL should not route to browser_navigate, got %v", err)
	}
}

func TestCompileBrowserInteractionCapabilities(t *testing.T) {
	ctx := context.Background()
	db := openCapabilityTestDB(t, ctx)
	defer db.Close()

	click, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{
		Capability: "browser_click",
		Goal:       "点击当前浏览器里的提交按钮",
		Evidence:   "click the submit button in the frontmost browser",
		Inputs:     map[string]any{"selector": "#submit"},
		Risk:       "browser_interaction",
	})
	if err != nil {
		t.Fatalf("browser_click CompileCapability() error = %v", err)
	}
	if click.Workflow.WorkflowName != "browser_click_v1" || len(click.Workflow.Steps) != 1 || click.Workflow.Steps[0].Tool != "browser_click_element" {
		t.Fatalf("browser_click workflow = %+v", click.Workflow)
	}

	typed, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{
		Capability: "browser_type",
		Goal:       "在当前浏览器的搜索框输入 hello",
		Evidence:   "type text into input[name=q] in the frontmost browser",
		Inputs:     map[string]any{"selector": "input[name=q]", "text": "hello"},
		Risk:       "browser_interaction",
	})
	if err != nil {
		t.Fatalf("browser_type CompileCapability() error = %v", err)
	}
	if typed.Workflow.WorkflowName != "browser_type_v1" || len(typed.Workflow.Steps) != 1 || typed.Workflow.Steps[0].Tool != "browser_type_text" {
		t.Fatalf("browser_type workflow = %+v", typed.Workflow)
	}

	_, err = CompileCapability(ctx, db.SQL(), CapabilityRequest{
		Capability: "browser_click",
		Goal:       "点击当前浏览器里的提交按钮",
		Evidence:   "click submit",
		Inputs:     map[string]any{"selector": "#submit"},
		Risk:       "read_only",
	})
	if !errors.Is(err, ErrPolicyDenied) {
		t.Fatalf("read-only browser_click error = %v, want ErrPolicyDenied", err)
	}
}

func TestCompileCapabilityWorkspaceWriteRisk(t *testing.T) {
	ctx := context.Background()
	db := openCapabilityTestDB(t, ctx)
	defer db.Close()

	if _, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{Capability: "apply_patch", Risk: "read_only"}); !errors.Is(err, ErrPolicyDenied) {
		t.Fatalf("read-only apply_patch error = %v, want ErrPolicyDenied", err)
	}
	result, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{Capability: "apply_patch", Risk: "workspace_write"})
	if err != nil {
		t.Fatalf("workspace_write apply_patch CompileCapability() error = %v", err)
	}
	if result.Workflow.WorkflowName != "apply_patch_v1" {
		t.Fatalf("workflow = %s, want apply_patch_v1", result.Workflow.WorkflowName)
	}
}

func TestMCPInventoryWrapCreatesExecutableCapability(t *testing.T) {
	ctx := context.Background()
	db := openCapabilityTestDB(t, ctx)
	defer db.Close()

	if _, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{
		Capability: "mcp_local_mcp_registry_echo",
		Goal:       "use echo",
		Evidence:   "use echo",
		Risk:       "read_only",
	}); !errors.Is(err, ErrCapabilityMissing) {
		t.Fatalf("unwrapped MCP capability error = %v, want ErrCapabilityMissing", err)
	}
	if _, err := db.SQL().ExecContext(ctx, `
		INSERT INTO mcp_inventory_items (id, server_id, kind, name, description, schema, metadata)
		VALUES ('mcpinv_echo', 'local_mcp_registry', 'tool', 'echo', 'Echo input', '{"type":"object","properties":{"text":{"type":"string"}}}', '{}')
	`); err != nil {
		t.Fatal(err)
	}
	capability, err := db.WrapMCPTool(ctx, "local_mcp_registry", "echo", MCPWrapToolRequest{
		CapabilityID:     "mcp_local_mcp_registry_echo",
		Description:      "Echo input through the configured local MCP server.",
		IntentDomain:     "mcp_echo",
		PositiveExamples: []string{"使用 echo", "调用 echo 工具"},
		NegativeExamples: []string{"列出本地所有 app", "检查 Joi 服务健康状态"},
		RiskLevel:        "read_only",
		PrivacyLevel:     "private_content",
		UIVisibility:     "chat",
	})
	if err != nil {
		t.Fatal(err)
	}
	if capability.Metadata["source"] != "mcp_wrapped" {
		t.Fatalf("wrapped source = %v", capability.Metadata["source"])
	}
	compiled, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{
		Capability: capability.ID,
		Goal:       "use echo",
		Evidence:   "use echo",
		Inputs:     map[string]any{"text": "hello"},
		Risk:       "read_only",
	})
	if err != nil {
		t.Fatalf("wrapped CompileCapability() error = %v", err)
	}
	if compiled.Workflow.WorkflowName != capability.ID+"_v1" {
		t.Fatalf("workflow = %s", compiled.Workflow.WorkflowName)
	}
	if len(compiled.Workflow.Steps) != 1 || compiled.Workflow.Steps[0].Tool != "mcp_tool_call" {
		t.Fatalf("workflow steps = %+v, want mcp_tool_call", compiled.Workflow.Steps)
	}
}

func TestSkillGuardAllowsOnlyDeclaredCapabilities(t *testing.T) {
	ctx := context.Background()
	db := openCapabilityTestDB(t, ctx)
	defer db.Close()

	skill, err := db.GetSkillDefinition(ctx, "desktop_inventory_skill")
	if err != nil {
		t.Fatal(err)
	}
	plan := BuildSkillPlan(skill, "帮我列出本地所有 app", nil)
	if len(plan.CapabilityRequests) != 1 || CanonicalCapabilityName(plan.CapabilityRequests[0].Capability) != "desktop_app_list" {
		t.Fatalf("plan requests = %+v, want desktop_app_list", plan.CapabilityRequests)
	}
	if err := ValidateSkillCapabilityRequest(skill, plan.CapabilityRequests[0]); err != nil {
		t.Fatalf("allowed skill request rejected: %v", err)
	}
	err = ValidateSkillCapabilityRequest(skill, CapabilityRequest{Capability: "system_health_check", Goal: "检查服务健康", Evidence: "检查服务健康"})
	if err == nil {
		t.Fatalf("forbidden skill request unexpectedly allowed")
	}
}

func TestComputerObserveTargetPolicy(t *testing.T) {
	ctx := context.Background()
	db := openCapabilityTestDB(t, ctx)
	defer db.Close()

	compiled, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{
		Capability: "computer_observe",
		Goal:       "观察当前窗口 UI",
		Evidence:   "看一下屏幕上 Joi 显示了什么",
		Inputs:     map[string]any{"target": "joi_current_window"},
		Risk:       "read_only",
	})
	if err != nil {
		t.Fatalf("computer_observe CompileCapability() error = %v", err)
	}
	if compiled.Workflow.WorkflowName != "computer_observe_v1" {
		t.Fatalf("workflow = %s", compiled.Workflow.WorkflowName)
	}
	if _, err := ExecuteCapabilityLocally(ctx, CapabilityRequest{Capability: "computer_observe", Inputs: map[string]any{"target": "other_app"}, Risk: "read_only"}); !errors.Is(err, ErrPolicyDenied) {
		t.Fatalf("other app observe error = %v, want ErrPolicyDenied", err)
	}
}

func TestCompileCapabilitySemanticGateRejectsMismatchedAppInventory(t *testing.T) {
	ctx := context.Background()
	db := openCapabilityTestDB(t, ctx)
	defer db.Close()

	_, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{
		Capability: "system_health_check",
		Goal:       "列出本机所有已安装 app",
		Evidence:   "帮我列出本地所有 app",
		Risk:       "read_only",
	})
	if !errors.Is(err, ErrCapabilityMismatch) {
		t.Fatalf("CompileCapability() error = %v, want ErrCapabilityMismatch", err)
	}
	validation, ok := CapabilityValidationResultFromError(err)
	if !ok {
		t.Fatalf("expected validation result from error %v", err)
	}
	if validation.Code != "CAPABILITY_MISMATCH" || validation.Expected != "desktop_app_list" {
		t.Fatalf("validation = %+v, want CAPABILITY_MISMATCH desktop_app_list", validation)
	}
}

func TestCompileCapabilitySemanticGateReportsMissingCapability(t *testing.T) {
	ctx := context.Background()
	db := openCapabilityTestDB(t, ctx)
	defer db.Close()

	_, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{
		Capability: "desktop_window_resize",
		Goal:       "调整当前窗口大小",
		Evidence:   "把这个 app 窗口调小一点",
		Risk:       "read_only",
	})
	if !errors.Is(err, ErrCapabilityMissing) {
		t.Fatalf("CompileCapability() error = %v, want ErrCapabilityMissing", err)
	}
	validation, ok := CapabilityValidationResultFromError(err)
	if !ok {
		t.Fatalf("expected validation result from error %v", err)
	}
	if validation.Code != "CAPABILITY_MISSING" {
		t.Fatalf("validation = %+v, want CAPABILITY_MISSING", validation)
	}
}

func TestCompileCapabilitySemanticGateAllowsDesktopAppListAndHealthCheck(t *testing.T) {
	ctx := context.Background()
	db := openCapabilityTestDB(t, ctx)
	defer db.Close()

	appList, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{
		Capability: "desktop_app_list",
		Goal:       "列出本机所有已安装 app",
		Evidence:   "帮我列出本地所有 app",
		Risk:       "read_only",
	})
	if err != nil {
		t.Fatalf("desktop_app_list CompileCapability() error = %v", err)
	}
	if appList.Workflow.WorkflowName != "desktop_app_list_v1" {
		t.Fatalf("desktop_app_list workflow = %s", appList.Workflow.WorkflowName)
	}

	health, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{
		Capability: "system_health_check",
		Goal:       "检查本地 app 和服务健康状态",
		Evidence:   "帮我检查本地 app/服务健康状态",
		Risk:       "read_only",
	})
	if err != nil {
		t.Fatalf("system_health_check CompileCapability() error = %v", err)
	}
	if health.Workflow.WorkflowName != "system_health_check_v1" {
		t.Fatalf("system_health_check workflow = %s", health.Workflow.WorkflowName)
	}
}

func TestCompileCapabilityRejectsDisabledWorkflowAndTool(t *testing.T) {
	ctx := context.Background()
	db := openCapabilityTestDB(t, ctx)
	defer db.Close()

	if _, err := db.SQL().ExecContext(ctx, `UPDATE tool_workflows SET enabled=0 WHERE name='file_analyze_v1'`); err != nil {
		t.Fatal(err)
	}
	if _, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{Capability: "file_analyze", Risk: "read_only"}); !errors.Is(err, ErrPolicyDenied) {
		t.Fatalf("disabled workflow error = %v, want ErrPolicyDenied", err)
	}

	if _, err := db.SQL().ExecContext(ctx, `UPDATE tool_workflows SET enabled=1 WHERE name='file_analyze_v1'`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.SQL().ExecContext(ctx, `UPDATE tools SET enabled=0 WHERE id='file_read_authorized'`); err != nil {
		t.Fatal(err)
	}
	if _, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{Capability: "file_analyze", Risk: "read_only"}); !errors.Is(err, ErrPolicyDenied) {
		t.Fatalf("disabled tool error = %v, want ErrPolicyDenied", err)
	}
}

func TestCompileCapabilityRiskPolicy(t *testing.T) {
	ctx := context.Background()
	db := openCapabilityTestDB(t, ctx)
	defer db.Close()

	if _, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{Capability: "server_diagnose", Risk: "state_change", Goal: "restart service"}); !errors.Is(err, ErrPolicyDenied) {
		t.Fatalf("state_change error = %v, want ErrPolicyDenied", err)
	}
	var confirmations int
	if err := db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM confirmation_requests WHERE risk_level='state_change'`).Scan(&confirmations); err != nil {
		t.Fatal(err)
	}
	if confirmations != 1 {
		t.Fatalf("state_change confirmations = %d, want 1", confirmations)
	}

	if _, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{Capability: "server_diagnose", Risk: "destructive", Goal: "delete service"}); !errors.Is(err, ErrPolicyDenied) {
		t.Fatalf("destructive error = %v, want ErrPolicyDenied", err)
	}
	if err := db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM confirmation_requests`).Scan(&confirmations); err != nil {
		t.Fatal(err)
	}
	if confirmations != 1 {
		t.Fatalf("destructive risk should not create confirmation, got %d confirmations", confirmations)
	}

	if _, err := db.SQL().ExecContext(ctx, `UPDATE tool_workflows SET risk_level='state_change' WHERE name='server_diagnose_v1'`); err != nil {
		t.Fatal(err)
	}
	if _, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{Capability: "server_diagnose", Risk: "read_only", Goal: "diagnose service"}); !errors.Is(err, ErrPolicyDenied) {
		t.Fatalf("workflow risk escalation error = %v, want ErrPolicyDenied", err)
	}
	if err := db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM confirmation_requests`).Scan(&confirmations); err != nil {
		t.Fatal(err)
	}
	if confirmations != 2 {
		t.Fatalf("state_change workflow confirmations = %d, want 2", confirmations)
	}
}

func TestCompileCapabilityRecordsConfirmationResumeAnchor(t *testing.T) {
	ctx := context.Background()
	db := openCapabilityTestDB(t, ctx)
	defer db.Close()

	if _, err := db.SQL().ExecContext(ctx, `
		INSERT INTO conversations (id, channel) VALUES ('conv_confirm_resume', 'desktop');
		INSERT INTO messages (id, conversation_id, role, content) VALUES ('msg_confirm_resume', 'conv_confirm_resume', 'user', 'restart service');
		INSERT INTO runs (id, conversation_id, user_message_id, status) VALUES ('run_confirm_resume', 'conv_confirm_resume', 'msg_confirm_resume', 'running');
		INSERT INTO turns (id, run_id, turn_index, status) VALUES ('turn_confirm_resume', 'run_confirm_resume', 1, 'running');
	`); err != nil {
		t.Fatal(err)
	}

	_, err := CompileCapability(ctx, db.SQL(), CapabilityRequest{
		Capability:    "server_diagnose",
		Risk:          "state_change",
		Goal:          "restart service",
		RunID:         "run_confirm_resume",
		CallID:        "call_confirm_resume",
		TurnID:        "turn_confirm_resume",
		ApprovalScope: "once",
		ApprovalKey:   "call_confirm_resume",
	})
	if !errors.Is(err, ErrPolicyDenied) {
		t.Fatalf("state_change error = %v, want ErrPolicyDenied", err)
	}

	var callID, turnID, scope, key string
	if err := db.SQL().QueryRowContext(ctx, `
		SELECT COALESCE(call_id, ''), COALESCE(turn_id, ''), approval_scope, approval_key
		FROM confirmation_requests
		WHERE run_id='run_confirm_resume'
	`).Scan(&callID, &turnID, &scope, &key); err != nil {
		t.Fatal(err)
	}
	if callID != "call_confirm_resume" || turnID != "turn_confirm_resume" || scope != "once" || key != "call_confirm_resume" {
		t.Fatalf("confirmation resume anchor = (%q, %q, %q, %q), want call/turn/scope/key", callID, turnID, scope, key)
	}
}

func openCapabilityTestDB(t *testing.T, ctx context.Context) *DB {
	t.Helper()
	db, err := OpenSQLite(ctx, filepath.Join(t.TempDir(), "joi.db"))
	if err != nil {
		t.Fatal(err)
	}
	schemaPath := filepath.Join("..", "..", "..", "..", "database", "sqlite", "001_init_schema.sql")
	if err := db.ApplySQLiteSchema(ctx, schemaPath); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.SeedSQLiteDefaults(ctx); err != nil {
		db.Close()
		t.Fatal(err)
	}
	return db
}
