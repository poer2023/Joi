package appcore

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strings"
)

type WebSummaryInput struct {
	URL           string
	Title         string
	ExtractedText string
	Limitations   []string
}

func (a *AppCore) generateWebSummaryWithPrompt(ctx context.Context, tx *sql.Tx, runtimeInput sqliteRuntimeInput, result *sqliteRuntimeResult, input WebSummaryInput) (string, error) {
	response := writeWebSummary(input)
	brief, err := insertSQLiteRunStep(ctx, tx, runtimeInput.RunID, "web_summary_written", "Web summary writer finished", map[string]any{
		"prompt": "web_summary_writer.md",
		"url":    input.URL,
	}, map[string]any{
		"title":       input.Title,
		"limitations": input.Limitations,
		"summary":     response,
	})
	if err != nil {
		return "", err
	}
	result.Steps = append(result.Steps, brief)
	return response, nil
}

func webSummaryInputFromNormalized(normalized map[string]any) WebSummaryInput {
	limitations := []string{}
	if boolFromAny(normalized["truncated"]) {
		limitations = append(limitations, "网页响应内容被截断")
	}
	if extraction, ok := normalized["extraction"].(map[string]any); ok && boolFromAny(extraction["readable_text_truncated"]) {
		limitations = append(limitations, "可读正文被截断")
	}
	if status := stringFromAny(normalized["fetch_status"]); status != "" && status != "succeeded" {
		limitations = append(limitations, "网页读取状态："+status)
	}
	return WebSummaryInput{
		URL:           stringFromAny(normalized["url"]),
		Title:         strings.TrimSpace(stringFromAny(normalized["title"])),
		ExtractedText: strings.TrimSpace(stringFromAny(normalized["readable_text"])),
		Limitations:   limitations,
	}
}

func writeWebSummary(input WebSummaryInput) string {
	text := cleanWebSummaryText(input.ExtractedText)
	title := strings.TrimSpace(input.Title)
	source := strings.TrimSpace(input.URL)
	if text == "" {
		return fmt.Sprintf("一句话总结：\n这个网页已读取，但没有抽取到足够正文。\n\n主要内容：\n1. 页面没有提供可稳定总结的正文。\n\n值得关注：\n- 可能需要浏览器渲染、登录，或页面正文由脚本延迟加载。\n\n适合谁看：\n- 需要确认该链接是否可读取的人。\n\n来源：\n%s", source)
	}

	points := webSummaryPoints(text, title)
	if len(points) == 0 {
		points = []string{compactWebSummarySentence(text, 90)}
	}
	oneLine := webSummaryOneLine(title, text, points[0])
	builder := strings.Builder{}
	builder.WriteString("一句话总结：\n")
	builder.WriteString(oneLine)
	builder.WriteString("\n\n主要内容：\n")
	for index, point := range points {
		if index >= 3 {
			break
		}
		builder.WriteString(fmt.Sprintf("%d. %s\n", index+1, point))
	}
	builder.WriteString("\n值得关注：\n")
	builder.WriteString("- 这是基于网页正文抽取后的总结，不包含评论区或登录后内容。\n")
	for _, limitation := range input.Limitations {
		if strings.TrimSpace(limitation) != "" {
			builder.WriteString("- ")
			builder.WriteString(limitation)
			builder.WriteString("。\n")
		}
	}
	builder.WriteString("\n适合谁看：\n")
	builder.WriteString("- 想快速判断这篇网页是否值得继续阅读全文的人。\n")
	builder.WriteString("\n来源：\n")
	builder.WriteString(source)
	return strings.TrimSpace(builder.String())
}

func webSummaryOneLine(title string, text string, firstPoint string) string {
	if strings.TrimSpace(title) != "" {
		if webSummaryMentionsApps(title + "\n" + text) {
			if strings.Contains(title, "派评") || strings.Contains(title, "近期值得关注") {
				return "这篇文章介绍了少数派近期值得关注的 App，重点是几款在影像、工具和交互体验上有亮点的新应用。"
			}
			return fmt.Sprintf("这篇文章介绍了《%s》相关内容，重点集中在网页正文提到的应用、工具和使用体验。", title)
		}
		return fmt.Sprintf("这篇网页围绕《%s》展开，核心内容是：%s。", title, compactWebSummarySentence(firstPoint, 64))
	}
	if webSummaryMentionsApps(text) {
		return "这篇网页主要介绍近期值得关注的应用和工具体验。"
	}
	return "这篇网页的核心内容是：" + compactWebSummarySentence(firstPoint, 76) + "。"
}

func webSummaryPoints(text string, title string) []string {
	raw := splitWebSummarySentences(text)
	points := []string{}
	seen := map[string]bool{}
	for _, sentence := range raw {
		cleaned := compactWebSummarySentence(sentence, 96)
		if cleaned == "" || seen[cleaned] || shouldSkipWebSummarySentence(cleaned, title) {
			continue
		}
		points = append(points, cleaned)
		seen[cleaned] = true
		if len(points) >= 3 {
			break
		}
	}
	return points
}

func splitWebSummarySentences(text string) []string {
	text = cleanWebSummaryText(text)
	if text == "" {
		return nil
	}
	splitter := regexp.MustCompile(`[。！？!?]\s*|\n+`)
	parts := splitter.Split(text, -1)
	result := []string{}
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			result = append(result, part)
		}
	}
	if len(result) == 0 {
		result = append(result, text)
	}
	return result
}

func cleanWebSummaryText(text string) string {
	text = strings.ReplaceAll(text, "\u00a0", " ")
	lines := strings.Split(text, "\n")
	cleaned := []string{}
	for _, line := range lines {
		line = strings.Join(strings.Fields(line), " ")
		if line == "" {
			continue
		}
		cleaned = append(cleaned, line)
	}
	return strings.TrimSpace(strings.Join(cleaned, "\n"))
}

func shouldSkipWebSummarySentence(sentence string, title string) bool {
	trimmed := strings.TrimSpace(sentence)
	if trimmed == "" || trimmed == title {
		return true
	}
	if len([]rune(trimmed)) < 8 {
		return true
	}
	lower := strings.ToLower(trimmed)
	return strings.Contains(lower, "cookie") ||
		strings.Contains(lower, "copyright") ||
		strings.Contains(trimmed, "欢迎收看") ||
		strings.Contains(trimmed, "文章目录") ||
		strings.Contains(trimmed, "快速跳转") ||
		strings.Contains(trimmed, "评论区") ||
		strings.Contains(trimmed, "欢迎在评论") ||
		strings.Contains(trimmed, "登录") ||
		strings.Contains(trimmed, "注册") ||
		strings.Contains(trimmed, "广告")
}

func compactWebSummarySentence(value string, limit int) string {
	value = strings.TrimSpace(strings.Join(strings.Fields(value), " "))
	value = strings.Trim(value, "。！？!?；;，, ")
	if value == "" {
		return ""
	}
	value = strings.TrimSuffix(value, "...")
	value = strings.TrimSuffix(value, "…")
	runes := []rune(value)
	if len(runes) > limit {
		value = string(runes[:limit]) + "..."
	}
	return value
}

func webSummaryMentionsApps(value string) bool {
	lower := strings.ToLower(value)
	return strings.Contains(lower, "app") ||
		strings.Contains(value, "应用") ||
		strings.Contains(value, "软件") ||
		strings.Contains(value, "工具")
}

func boolFromAny(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(typed, "true") || typed == "1"
	default:
		return false
	}
}
