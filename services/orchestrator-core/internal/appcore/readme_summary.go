package appcore

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

func isReadmeStartupRequest(message string) bool {
	lower := strings.ToLower(message)
	mentionsReadme := strings.Contains(lower, "readme")
	asksStartup := containsAnyText(message, []string{"启动", "运行", "怎么启动", "如何启动", "怎么跑", "如何运行"}) ||
		containsAnyText(lower, []string{"start", "run", "launch", "dev server"})
	return mentionsReadme && asksStartup
}

func (a *AppCore) runSQLiteReadmeStartupSummary(ctx context.Context, tx *sql.Tx, input sqliteRuntimeInput, result *sqliteRuntimeResult) error {
	settings, err := a.getWorkspaceSettingsFrom(ctx, tx)
	if err != nil {
		return err
	}
	readmePath := filepath.Join(settings.DefaultRoot, "README.md")
	inputs := map[string]any{"path": readmePath, "question": input.Message}
	brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "capability_requested", "Agent requested capability", map[string]any{"agent_id": input.AgentID, "deterministic": true}, map[string]any{"capability": "file_analyze", "goal": "读取 README 并回答项目启动方式", "inputs": inputs, "risk": "read_only", "confidence": 1.0})
	if err != nil {
		return err
	}
	result.Steps = append(result.Steps, brief)

	capabilityResult, err := a.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
		Type:          "capability_request",
		Capability:    "file_analyze",
		Goal:          "读取 README 并回答项目启动方式",
		Inputs:        inputs,
		Risk:          "read_only",
		RunID:         input.RunID,
		PreferredNode: input.PreferredNode,
		AllowWorker:   input.AllowWorker,
	})
	if err != nil {
		return err
	}
	brief, err = insertSQLiteRunStep(ctx, tx, input.RunID, "tool_finished", "Tool runtime finished", map[string]any{"workflow_name": capabilityResult.Workflow.WorkflowName, "tool_run_id": capabilityResult.ToolRunID}, capabilityResult.NormalizedResult)
	if err != nil {
		return err
	}
	result.Steps = append(result.Steps, brief)

	readmeText := ""
	if resolved, err := ResolveWorkspacePath(readmePath, *settings); err == nil {
		if raw, _, err := readBoundedFile(resolved, settings.FileAnalyzeMaxBytes); err == nil {
			readmeText = string(raw)
		}
	}
	response := writeReadmeStartupSummary(readmeText, capabilityResult.NormalizedResult)
	return a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, "", response, result)
}

func writeReadmeStartupSummary(readmeText string, normalized map[string]any) string {
	path := stringFromAny(normalized["path"])
	if path == "" {
		path = "README.md"
	}
	commands := extractLikelyStartupCommands(readmeText)
	builder := strings.Builder{}
	builder.WriteString("README 里没有直接给出完整启动命令。\n\n")
	builder.WriteString("它主要说明这个仓库是 Local-first Personal Agent OS 的工程文档包，并给 AI 编码助手的阅读顺序：`AI_START_HERE.md`、`AGENTS.md`、MVP 范围、系统架构、数据模型、Memory OS、Capability/Tool 协议等。\n\n")
	if len(commands) > 0 {
		builder.WriteString("README 中可见的相关命令线索：\n")
		for _, command := range commands {
			builder.WriteString(fmt.Sprintf("- `%s`\n", command))
		}
		builder.WriteString("\n")
	}
	builder.WriteString("结论：只看 README，不能得出 app 的准确启动命令；它更像项目入口说明。要启动 Joi 桌面端，需要继续看 `apps/joi-desktop` 的构建配置或当前本地构建脚本。\n\n")
	builder.WriteString("来源：\n")
	builder.WriteString(path)
	return strings.TrimSpace(builder.String())
}

func extractLikelyStartupCommands(text string) []string {
	lines := strings.Split(text, "\n")
	commands := []string{}
	seen := map[string]bool{}
	for _, line := range lines {
		trimmed := strings.TrimSpace(strings.Trim(line, "`"))
		lower := strings.ToLower(trimmed)
		if !(strings.HasPrefix(lower, "npm ") ||
			strings.HasPrefix(lower, "pnpm ") ||
			strings.HasPrefix(lower, "yarn ") ||
			strings.HasPrefix(lower, "go run ") ||
			strings.HasPrefix(lower, "wails ")) {
			continue
		}
		if seen[trimmed] {
			continue
		}
		seen[trimmed] = true
		commands = append(commands, trimmed)
		if len(commands) >= 5 {
			break
		}
	}
	return commands
}
