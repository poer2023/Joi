package appcore

import (
	"strings"
	"testing"
)

func TestWriteWebSummarySkipsArticleChromeAndKeepsAppItems(t *testing.T) {
	summary := writeWebSummary(WebSummaryInput{
		URL:   "https://sspai.com/post/110156",
		Title: "派评 | 近期值得关注的 App - 少数派",
		ExtractedText: `欢迎收看本期《派评》。你可以通过文章目录快速跳转到你感兴趣的内容。如果发现了其它感兴趣的 App 或者关注的话题，也欢迎在评论区和我们讨论。
VWFNDR™ + MBL：Android 独占特色交互相机应用 平台：Android 关键词：相机、第三方、手动控制、交互设计。
Raycast for iOS 把桌面端常用的启动器和自动化体验带到移动端。
另一款工具重点优化跨设备内容整理和交互体验。`,
	})
	if strings.Contains(summary, "欢迎收看") || strings.Contains(summary, "文章目录") {
		t.Fatalf("summary should skip article chrome text: %s", summary)
	}
	if !strings.Contains(summary, "VWFNDR") || !strings.Contains(summary, "近期值得关注的 App") {
		t.Fatalf("summary should keep concrete app content: %s", summary)
	}
}
