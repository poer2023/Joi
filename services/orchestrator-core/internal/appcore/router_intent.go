package appcore

import "strings"

type desktopIntent struct {
	Name               string
	MemoryControl      memoryControlIntent
	ArtifactRewrite    bool
	ArtifactFollowup   bool
	Proactive          bool
	TaskFollowup       bool
	EvidenceFollowup   bool
	ToolResultFollowup bool
	SeriousTask        bool
	Clarify            bool
}

func classifyDesktopIntent(message string, requestedMode string) desktopIntent {
	if memory := classifyMemoryControlIntent(message); memory.Kind != memoryControlNone {
		return desktopIntent{Name: "memory", MemoryControl: memory}
	}
	if isProactiveInstruction(message, requestedMode) {
		return desktopIntent{Name: "proactive", Proactive: true}
	}
	if isToolEvidenceFollowupRequest(message) {
		return desktopIntent{Name: "tool_result_followup", EvidenceFollowup: true, ToolResultFollowup: true}
	}
	if isTaskFollowupRequest(message) {
		return desktopIntent{Name: "task_followup", TaskFollowup: true}
	}
	if isArtifactRewriteRequest(message) {
		return desktopIntent{Name: "artifact_followup", ArtifactRewrite: true, ArtifactFollowup: true}
	}
	if isArtifactFollowupRequest(message) {
		return desktopIntent{Name: "artifact_followup", ArtifactFollowup: true}
	}
	classification := classifyConversation(message, requestedMode)
	if classification.Mode == "clarify" {
		return desktopIntent{Name: "clarify", Clarify: true}
	}
	if classification.Mode == "serious_task" {
		return desktopIntent{Name: "serious_task", SeriousTask: true}
	}
	return desktopIntent{Name: "chat"}
}

func isProactiveInstruction(message string, requestedMode string) bool {
	if normalizeInputMode(requestedMode) == "background_task" {
		return true
	}
	return containsAnyText(message, []string{"之后提醒", "下次提醒", "提醒我", "明天提醒", "后天提醒", "持续关注", "别忘了提醒"})
}

func isTaskFollowupRequest(message string) bool {
	return containsAnyText(message, []string{"接着刚才", "继续上一个", "继续刚才", "上个任务", "刚才那个任务", "继续把它", "每一步", "读了哪些证据", "有没有遗漏", "到底做了什么"})
}

func isToolEvidenceFollowupRequest(message string) bool {
	trimmed := strings.TrimSpace(message)
	if trimmed == "" {
		return false
	}
	lower := strings.ToLower(trimmed)
	if ordinalFollowupPattern.MatchString(trimmed) && containsAnyText(trimmed, []string{"什么", "是谁", "是哪", "路径", "在哪", "哪里"}) {
		return true
	}
	hasConfirmation := containsAnyText(trimmed, []string{"你确定", "确定", "确认", "是否", "是不是", "存在", "安装"})
	if hasConfirmation && containsAnyText(trimmed, []string{"有", "存在", "安装", "app", "App", "应用", "软件", "程序"}) {
		return true
	}
	hasPreviousEvidenceReference := containsAnyText(trimmed, []string{"刚才", "上一轮", "上一个", "上一条", "工具结果", "列表里", "第"})
	hasEvidenceQuestion := containsAnyText(trimmed, []string{"对吗", "正确", "路径", "在哪", "哪里", "什么", "存在", "有"})
	if hasPreviousEvidenceReference && hasEvidenceQuestion {
		return true
	}
	if containsAnyText(trimmed, []string{"它在哪", "它在哪里", "那个在哪", "那个在哪里"}) {
		return true
	}
	return strings.Contains(lower, "tool result") || strings.Contains(lower, "tool evidence")
}

func isArtifactFollowupRequest(message string) bool {
	lower := strings.ToLower(message)
	hasArtifact := strings.Contains(message, "Artifact") || strings.Contains(message, "交付物") || strings.Contains(message, "刚才那份") || strings.Contains(message, "这份") || strings.Contains(lower, "artifact")
	hasFollowup := strings.Contains(message, "基于") || strings.Contains(message, "根据") || strings.Contains(message, "继续") || strings.Contains(message, "只做一件事")
	return hasArtifact && hasFollowup
}
