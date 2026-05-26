package appcore

import "strings"

type desktopIntent struct {
	Name             string
	MemoryControl    memoryControlIntent
	ArtifactRewrite  bool
	ArtifactFollowup bool
	Proactive        bool
	TaskFollowup     bool
	SeriousTask      bool
	Clarify          bool
}

func classifyDesktopIntent(message string, requestedMode string) desktopIntent {
	if memory := classifyMemoryControlIntent(message); memory.Kind != memoryControlNone {
		return desktopIntent{Name: "memory", MemoryControl: memory}
	}
	if isProactiveInstruction(message, requestedMode) {
		return desktopIntent{Name: "proactive", Proactive: true}
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

func isArtifactFollowupRequest(message string) bool {
	lower := strings.ToLower(message)
	hasArtifact := strings.Contains(message, "Artifact") || strings.Contains(message, "交付物") || strings.Contains(message, "刚才那份") || strings.Contains(message, "这份") || strings.Contains(lower, "artifact")
	hasFollowup := strings.Contains(message, "基于") || strings.Contains(message, "根据") || strings.Contains(message, "继续") || strings.Contains(message, "只做一件事")
	return hasArtifact && hasFollowup
}
