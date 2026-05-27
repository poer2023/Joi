package appcore

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

const (
	recentConversationMessageLimit = 8
	recentToolEvidenceLimit        = 3
	recentToolEvidenceSampleLimit  = 4
)

type conversationContextBundle struct {
	Prompt       string
	MessageCount int
	ToolEvidence []recentToolEvidence
}

type recentConversationMessage struct {
	Role    string
	Content string
	RunID   string
}

type recentToolEvidence struct {
	RunID        string
	ToolRunID    string
	CapabilityID string
	WorkflowName string
	Mode         string
	Total        int
	Matches      []desktopAppEvidenceMatch
	Samples      []string
	Apps         []desktopAppEvidenceMatch
	Summary      map[string]any
}

type desktopAppEvidenceMatch struct {
	Name     string `json:"name"`
	Path     string `json:"path,omitempty"`
	BundleID string `json:"bundle_id,omitempty"`
	Version  string `json:"version,omitempty"`
	Source   string `json:"source,omitempty"`
}

type toolFollowupResolution struct {
	Handled bool
}

var ordinalFollowupPattern = regexp.MustCompile(`第\s*([0-9]+)\s*个`)

func buildSQLiteConversationContextTx(ctx context.Context, tx *sql.Tx, conversationID string, currentMessageID string, currentMessage string) (conversationContextBundle, error) {
	messages, err := recentConversationMessagesTx(ctx, tx, conversationID, currentMessageID, recentConversationMessageLimit)
	if err != nil {
		return conversationContextBundle{}, err
	}
	evidence, err := recentToolEvidenceTx(ctx, tx, conversationID, currentMessage, recentToolEvidenceLimit)
	if err != nil {
		return conversationContextBundle{}, err
	}

	sections := []string{}
	if len(messages) > 0 {
		var builder strings.Builder
		builder.WriteString("RECENT_CONVERSATION\n")
		for _, message := range messages {
			content := store.RedactSensitiveText(truncate(summarizeRecentConversationContent(message.Content), 700))
			if content == "" {
				continue
			}
			builder.WriteString("- ")
			builder.WriteString(message.Role)
			if message.RunID != "" {
				builder.WriteString(" run_id=")
				builder.WriteString(message.RunID)
			}
			builder.WriteString(": ")
			builder.WriteString(strings.ReplaceAll(content, "\n", "\\n"))
			builder.WriteByte('\n')
		}
		if strings.TrimSpace(builder.String()) != "RECENT_CONVERSATION" {
			sections = append(sections, strings.TrimSpace(builder.String()))
		}
	}
	if len(evidence) > 0 {
		sections = append(sections, formatRecentToolEvidencePrompt(evidence))
	}
	return conversationContextBundle{
		Prompt:       strings.TrimSpace(strings.Join(sections, "\n\n")),
		MessageCount: len(messages),
		ToolEvidence: evidence,
	}, nil
}

func summarizeRecentConversationContent(content string) string {
	content = strings.TrimSpace(content)
	if strings.Contains(content, "已读取本机应用列表") && strings.Contains(content, "完整列表：") {
		return "已读取本机应用列表；完整列表正文已省略，请使用 RECENT_TOOL_EVIDENCE 中的结构化工具证据。"
	}
	return content
}

func recentConversationMessagesTx(ctx context.Context, tx *sql.Tx, conversationID string, currentMessageID string, limit int) ([]recentConversationMessage, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT role, content, COALESCE(json_extract(metadata, '$.run_id'), ''), created_at, rowid
		FROM (
			SELECT role, content, metadata, created_at, rowid
			FROM messages
			WHERE conversation_id=?
			  AND id<>?
			ORDER BY datetime(created_at) DESC, rowid DESC
			LIMIT ?
		)
		ORDER BY datetime(created_at) ASC, rowid ASC
	`, conversationID, currentMessageID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := []recentConversationMessage{}
	for rows.Next() {
		var item recentConversationMessage
		var createdAt string
		var rowID int64
		if err := rows.Scan(&item.Role, &item.Content, &item.RunID, &createdAt, &rowID); err != nil {
			return nil, err
		}
		messages = append(messages, item)
	}
	return messages, rows.Err()
}

func recentToolEvidenceTx(ctx context.Context, tx *sql.Tx, conversationID string, currentMessage string, limit int) ([]recentToolEvidence, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT tr.id, tr.run_id, COALESCE(tr.capability_id, ''), COALESCE(tr.workflow_name, ''), tr.output
		FROM tool_runs tr
		JOIN runs r ON r.id=tr.run_id
		WHERE r.conversation_id=?
		  AND tr.status='succeeded'
		ORDER BY datetime(tr.created_at) DESC, tr.rowid DESC
		LIMIT ?
	`, conversationID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	evidence := []recentToolEvidence{}
	for rows.Next() {
		var toolRunID, runID, capabilityID, workflowName, outputRaw string
		if err := rows.Scan(&toolRunID, &runID, &capabilityID, &workflowName, &outputRaw); err != nil {
			return nil, err
		}
		output := map[string]any{}
		if err := json.Unmarshal([]byte(outputRaw), &output); err != nil {
			output = map[string]any{"unparseable_output": true}
		}
		item := summarizeToolEvidence(toolRunID, runID, capabilityID, workflowName, output, currentMessage)
		if item.CapabilityID == "" {
			item.CapabilityID = capabilityID
		}
		evidence = append(evidence, item)
	}
	return evidence, rows.Err()
}

func summarizeToolEvidence(toolRunID string, runID string, capabilityID string, workflowName string, output map[string]any, currentMessage string) recentToolEvidence {
	item := recentToolEvidence{
		RunID:        runID,
		ToolRunID:    toolRunID,
		CapabilityID: store.CanonicalCapabilityName(capabilityID),
		WorkflowName: workflowName,
		Mode:         stringFromAny(output["mode"]),
		Total:        intFromAny(output["total"]),
		Summary: map[string]any{
			"status": stringFromAny(output["status"]),
			"mode":   stringFromAny(output["mode"]),
		},
	}
	switch item.CapabilityID {
	case "desktop_app_list":
		apps := desktopAppEvidenceMatchesFromOutput(output["apps"])
		item.Apps = apps
		item.Samples = desktopAppSampleNames(apps, recentToolEvidenceSampleLimit)
		item.Matches = matchDesktopAppEvidence(apps, currentMessage)
	case "desktop_app_inspect":
		matches := desktopAppEvidenceMatchesFromOutput(output["matches"])
		item.Apps = matches
		item.Matches = matchDesktopAppEvidence(matches, currentMessage)
		if len(item.Matches) == 0 {
			item.Matches = matches
		}
		item.Samples = desktopAppSampleNames(matches, recentToolEvidenceSampleLimit)
	default:
		item.Summary["keys"] = sortedMapKeys(output)
		item.Summary["preview"] = truncate(string(mustJSON(store.SanitizeForTrace(output))), 900)
	}
	return item
}

func desktopAppEvidenceMatchesFromOutput(value any) []desktopAppEvidenceMatch {
	items := mapSliceFromAny(value)
	matches := make([]desktopAppEvidenceMatch, 0, len(items))
	for _, item := range items {
		name := strings.TrimSpace(stringFromAny(item["name"]))
		path := strings.TrimSpace(stringFromAny(item["path"]))
		if name == "" && path == "" {
			continue
		}
		matches = append(matches, desktopAppEvidenceMatch{
			Name:     name,
			Path:     path,
			BundleID: strings.TrimSpace(stringFromAny(item["bundle_id"])),
			Version:  strings.TrimSpace(stringFromAny(item["version"])),
			Source:   strings.TrimSpace(stringFromAny(item["source"])),
		})
	}
	return matches
}

func desktopAppSampleNames(apps []desktopAppEvidenceMatch, limit int) []string {
	if len(apps) == 0 || limit <= 0 {
		return nil
	}
	names := []string{}
	for index, app := range apps {
		if index >= limit {
			break
		}
		if app.Name != "" {
			names = append(names, app.Name)
		}
	}
	if len(apps) > limit {
		start := len(apps) - limit
		if start < limit {
			start = limit
		}
		for _, app := range apps[start:] {
			if app.Name != "" {
				names = append(names, app.Name)
			}
		}
	}
	return names
}

func matchDesktopAppEvidence(apps []desktopAppEvidenceMatch, message string) []desktopAppEvidenceMatch {
	if len(apps) == 0 {
		return nil
	}
	messageNorm := normalizeEvidenceText(message)
	target := extractAppFollowupTarget(message)
	targetNorm := normalizeEvidenceText(target)
	targetNumbers := numericTokens(target)
	if targetNorm == "" {
		targetNumbers = numericTokens(message)
	}
	matches := []desktopAppEvidenceMatch{}
	seen := map[string]bool{}
	for _, app := range apps {
		nameNorm := normalizeEvidenceText(app.Name)
		pathNorm := normalizeEvidenceText(app.Path)
		if nameNorm == "" {
			continue
		}
		matched := strings.Contains(messageNorm, nameNorm) ||
			(targetNorm != "" && (strings.Contains(nameNorm, targetNorm) || strings.Contains(targetNorm, nameNorm))) ||
			(pathNorm != "" && strings.Contains(messageNorm, pathNorm)) ||
			sharesSignificantNumericToken(nameNorm, targetNumbers)
		if !matched {
			continue
		}
		key := app.Name + "\x00" + app.Path
		if seen[key] {
			continue
		}
		seen[key] = true
		matches = append(matches, app)
	}
	sort.SliceStable(matches, func(i, j int) bool {
		iExact := normalizeEvidenceText(matches[i].Name) == targetNorm
		jExact := normalizeEvidenceText(matches[j].Name) == targetNorm
		if iExact != jExact {
			return iExact
		}
		return strings.ToLower(matches[i].Name) < strings.ToLower(matches[j].Name)
	})
	return matches
}

func formatRecentToolEvidencePrompt(evidence []recentToolEvidence) string {
	var builder strings.Builder
	builder.WriteString("RECENT_TOOL_EVIDENCE\n")
	builder.WriteString("Use this as stronger evidence than model memory or general knowledge. Cite run_id/tool_run_id when answering follow-ups.\n")
	for _, item := range evidence {
		builder.WriteString("- run_id=")
		builder.WriteString(item.RunID)
		builder.WriteString(" tool_run_id=")
		builder.WriteString(item.ToolRunID)
		builder.WriteString(" capability_id=")
		builder.WriteString(item.CapabilityID)
		if item.WorkflowName != "" {
			builder.WriteString(" workflow=")
			builder.WriteString(item.WorkflowName)
		}
		if item.Total > 0 {
			builder.WriteString(" total=")
			builder.WriteString(strconv.Itoa(item.Total))
		}
		if item.Mode != "" {
			builder.WriteString(" mode=")
			builder.WriteString(item.Mode)
		}
		builder.WriteByte('\n')
		if len(item.Matches) > 0 {
			builder.WriteString("  matched_current_message:\n")
			for _, match := range item.Matches {
				builder.WriteString("  - name=")
				builder.WriteString(store.RedactSensitiveText(match.Name))
				if match.Path != "" {
					builder.WriteString(" path=")
					builder.WriteString(store.RedactSensitiveText(match.Path))
				}
				if match.BundleID != "" {
					builder.WriteString(" bundle_id=")
					builder.WriteString(store.RedactSensitiveText(match.BundleID))
				}
				if match.Version != "" {
					builder.WriteString(" version=")
					builder.WriteString(store.RedactSensitiveText(match.Version))
				}
				builder.WriteByte('\n')
			}
		}
		if len(item.Samples) > 0 {
			builder.WriteString("  samples=")
			builder.WriteString(store.RedactSensitiveText(strings.Join(item.Samples, ", ")))
			builder.WriteByte('\n')
		}
		if len(item.Summary) > 0 && item.CapabilityID != "desktop_app_list" && item.CapabilityID != "desktop_app_inspect" {
			builder.WriteString("  summary=")
			builder.WriteString(store.RedactSensitiveText(truncate(string(mustJSON(item.Summary)), 900)))
			builder.WriteByte('\n')
		}
	}
	return strings.TrimSpace(builder.String())
}

func (a *AppCore) resolveSQLiteFollowupGrounding(ctx context.Context, tx *sql.Tx, input sqliteRuntimeInput, result *sqliteRuntimeResult, bundle conversationContextBundle) (toolFollowupResolution, error) {
	if !isToolEvidenceFollowupRequest(input.Message) {
		return toolFollowupResolution{}, nil
	}
	if index := extractOrdinalFollowupIndex(input.Message); index > 0 {
		if evidence, app, ok := findDesktopAppByOrdinal(bundle.ToolEvidence, index); ok {
			response := formatDesktopAppEvidenceResponse(input.Message, evidence, []desktopAppEvidenceMatch{app}, "ordinal")
			if err := a.recordFollowupGroundedAndFinish(ctx, tx, input, result, evidence, []desktopAppEvidenceMatch{app}, "ordinal", response); err != nil {
				return toolFollowupResolution{}, err
			}
			return toolFollowupResolution{Handled: true}, nil
		}
	}
	for _, evidence := range bundle.ToolEvidence {
		if evidence.CapabilityID != "desktop_app_list" && evidence.CapabilityID != "desktop_app_inspect" {
			continue
		}
		matches := evidence.Matches
		if len(matches) == 0 {
			matches = matchDesktopAppEvidence(evidence.Apps, input.Message)
		}
		if len(matches) == 0 {
			continue
		}
		response := formatDesktopAppEvidenceResponse(input.Message, evidence, matches, "app_name")
		if err := a.recordFollowupGroundedAndFinish(ctx, tx, input, result, evidence, matches, "app_name", response); err != nil {
			return toolFollowupResolution{}, err
		}
		return toolFollowupResolution{Handled: true}, nil
	}

	target := extractAppFollowupTarget(input.Message)
	if strings.TrimSpace(target) == "" {
		return toolFollowupResolution{}, nil
	}
	if err := a.runSQLiteDesktopAppInspectFollowup(ctx, tx, input, result, target); err != nil {
		return toolFollowupResolution{}, err
	}
	return toolFollowupResolution{Handled: true}, nil
}

func (a *AppCore) recordFollowupGroundedAndFinish(ctx context.Context, tx *sql.Tx, input sqliteRuntimeInput, result *sqliteRuntimeResult, evidence recentToolEvidence, matches []desktopAppEvidenceMatch, strategy string, response string) error {
	brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "followup_grounded", "Follow-up grounded in recent tool evidence", map[string]any{"message": input.Message, "strategy": strategy}, map[string]any{
		"grounded":      true,
		"source_run_id": evidence.RunID,
		"tool_run_id":   evidence.ToolRunID,
		"capability_id": evidence.CapabilityID,
		"workflow_name": evidence.WorkflowName,
		"matches":       matches,
		"response":      response,
	})
	if err != nil {
		return err
	}
	result.Steps = append(result.Steps, brief)
	return a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, "", response, result)
}

func (a *AppCore) runSQLiteDesktopAppInspectFollowup(ctx context.Context, tx *sql.Tx, input sqliteRuntimeInput, result *sqliteRuntimeResult, target string) error {
	requestInputs := map[string]any{"name": target}
	brief, err := insertSQLiteRunStep(ctx, tx, input.RunID, "capability_requested", "Follow-up requested app inspection", map[string]any{"agent_id": input.AgentID, "message": input.Message}, map[string]any{
		"capability": "desktop_app_inspect",
		"goal":       "确认本机是否存在用户追问的 app",
		"inputs":     requestInputs,
		"risk":       "read_only",
		"source":     "followup_grounding",
	})
	if err != nil {
		return err
	}
	result.Steps = append(result.Steps, brief)
	capabilityResult, err := a.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
		Type:       "capability_request",
		Capability: "desktop_app_inspect",
		Goal:       "确认本机是否存在用户追问的 app",
		Inputs:     requestInputs,
		Risk:       "read_only",
		RunID:      input.RunID,
		Source:     "followup_grounding",
		Evidence:   input.Message,
	})
	if err != nil {
		return err
	}
	brief, err = insertSQLiteRunStep(ctx, tx, input.RunID, "tool_finished", "Tool runtime finished", map[string]any{"workflow_name": capabilityResult.Workflow.WorkflowName, "tool_run_id": capabilityResult.ToolRunID, "source": "followup_grounding"}, capabilityResult.NormalizedResult)
	if err != nil {
		return err
	}
	result.Steps = append(result.Steps, brief)
	response := formatDesktopAppInspectFollowupResponse(target, capabilityResult.ToolRunID, capabilityResult.NormalizedResult)
	return a.finishSQLiteAgentResponse(ctx, tx, input.RunID, input.AgentID, "", response, result)
}

func formatDesktopAppEvidenceResponse(message string, evidence recentToolEvidence, matches []desktopAppEvidenceMatch, strategy string) string {
	target := firstNonEmpty(extractAppFollowupTarget(message), strings.TrimSpace(message))
	if strategy == "ordinal" {
		target = strings.TrimSpace(message)
	}
	var builder strings.Builder
	builder.WriteString("根据上一轮 ")
	builder.WriteString(evidence.CapabilityID)
	builder.WriteString(" 工具结果（run_id=")
	builder.WriteString(evidence.RunID)
	builder.WriteString("，tool_run_id=")
	builder.WriteString(evidence.ToolRunID)
	builder.WriteString("），可以确认")
	if strings.TrimSpace(target) != "" {
		builder.WriteString("和 “")
		builder.WriteString(target)
		builder.WriteString("” 相关的本机 app 条目如下：")
	} else {
		builder.WriteString("本机 app 条目如下：")
	}
	for _, match := range matches {
		builder.WriteString("\n- ")
		builder.WriteString(firstNonEmpty(match.Name, "unknown"))
		if match.Path != "" {
			builder.WriteString("：")
			builder.WriteString(match.Path)
		}
		if match.BundleID != "" {
			builder.WriteString("（Bundle ID：")
			builder.WriteString(match.BundleID)
			builder.WriteString("）")
		}
	}
	return builder.String()
}

func formatDesktopAppInspectFollowupResponse(target string, toolRunID string, normalized map[string]any) string {
	matches := desktopAppEvidenceMatchesFromOutput(normalized["matches"])
	if len(matches) == 0 {
		return fmt.Sprintf("已执行 desktop_app_inspect 工具确认（tool_run_id=%s）：未在本机应用元数据里找到 “%s”。", toolRunID, target)
	}
	var builder strings.Builder
	builder.WriteString("已执行 desktop_app_inspect 工具确认（tool_run_id=")
	builder.WriteString(toolRunID)
	builder.WriteString("）：找到匹配的本机 app：")
	for _, match := range matches {
		builder.WriteString("\n- ")
		builder.WriteString(firstNonEmpty(match.Name, target))
		if match.Path != "" {
			builder.WriteString("：")
			builder.WriteString(match.Path)
		}
		if match.BundleID != "" {
			builder.WriteString("（Bundle ID：")
			builder.WriteString(match.BundleID)
			builder.WriteString("）")
		}
	}
	return builder.String()
}

func findDesktopAppByOrdinal(evidence []recentToolEvidence, index int) (recentToolEvidence, desktopAppEvidenceMatch, bool) {
	if index <= 0 {
		return recentToolEvidence{}, desktopAppEvidenceMatch{}, false
	}
	for _, item := range evidence {
		if item.CapabilityID != "desktop_app_list" || len(item.Apps) < index {
			continue
		}
		return item, item.Apps[index-1], true
	}
	return recentToolEvidence{}, desktopAppEvidenceMatch{}, false
}

func extractOrdinalFollowupIndex(message string) int {
	matches := ordinalFollowupPattern.FindStringSubmatch(message)
	if len(matches) < 2 {
		return 0
	}
	index, err := strconv.Atoi(matches[1])
	if err != nil {
		return 0
	}
	return index
}

func extractAppFollowupTarget(message string) string {
	text := strings.TrimSpace(message)
	text = strings.Trim(text, " \t\r\n\"'`“”‘’。.!?？")
	replacements := []string{
		"你确定", "", "确定", "", "确认一下", "", "确认", "", "请帮我", "", "帮我", "",
		"刚才那个", "", "刚才的", "", "上一轮", "", "上一个", "", "这个", "", "那个", "",
		"本机", "", "本地", "", "电脑上", "", "电脑", "", "Mac 上", "", "mac 上", "", "Mac", "", "mac", "",
		"是否", "", "是不是", "", "有没有", "", "存在", "", "安装了", "", "安装", "", "有", "",
		"应用程序", "", "应用", "", "软件", "", "程序", "",
		"吗", "", "么", "", "呢", "", "嘛", "", "？", "", "?", "", "：", " ", ":", " ",
		"《", "", "》", "", "“", "", "”", "", "‘", "", "’", "",
	}
	replacer := strings.NewReplacer(replacements...)
	text = replacer.Replace(text)
	text = strings.Join(strings.Fields(text), " ")
	if strings.Contains(text, "第 ") || strings.Contains(text, "第") && strings.Contains(text, "个") {
		return ""
	}
	if len([]rune(text)) > 80 {
		return ""
	}
	return strings.TrimSpace(text)
}

func normalizeEvidenceText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer(
		" ", "", "\t", "", "\n", "", "\r", "",
		"？", "", "?", "", "。", "", ".", "", "，", "", ",", "", "：", "", ":", "",
		"；", "", ";", "", "！", "", "!", "", "《", "", "》", "", "\"", "", "'", "", "`", "",
		"（", "(", "）", ")",
	)
	return replacer.Replace(value)
}

func numericTokens(value string) []string {
	matches := regexp.MustCompile(`[0-9]{2,}`).FindAllString(value, -1)
	seen := map[string]bool{}
	tokens := []string{}
	for _, match := range matches {
		if seen[match] {
			continue
		}
		seen[match] = true
		tokens = append(tokens, match)
	}
	return tokens
}

func sharesSignificantNumericToken(value string, tokens []string) bool {
	if len(tokens) == 0 {
		return false
	}
	for _, token := range tokens {
		if len(token) >= 4 && strings.Contains(value, token) {
			return true
		}
	}
	return false
}

func sortedMapKeys(value map[string]any) []string {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func appendDynamicContext(base string, extra string) string {
	base = strings.TrimSpace(base)
	extra = strings.TrimSpace(extra)
	if base == "" {
		return extra
	}
	if extra == "" {
		return base
	}
	return base + "\n\n" + extra
}
