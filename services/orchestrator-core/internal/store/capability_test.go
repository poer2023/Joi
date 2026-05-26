package store

import (
	"strings"
	"testing"
)

func TestReadableHTMLTextDropsStyleScriptAndNoscript(t *testing.T) {
	body := `<html>
		<head>
			<style>body{color:red}</style>
			<script>alert("secret")</script>
			<noscript>enable javascript</noscript>
		</head>
		<body>
			<h1>Example Domain</h1>
			<p>This domain is for use in documentation examples.</p>
		</body>
	</html>`

	text := readableHTMLText(body)
	for _, blocked := range []string{"body{", "alert(", "enable javascript"} {
		if strings.Contains(text, blocked) {
			t.Fatalf("readable text leaked non-content block %q: %s", blocked, text)
		}
	}
	if !strings.Contains(text, "Example Domain") || !strings.Contains(text, "documentation examples") {
		t.Fatalf("readable text did not keep body content: %s", text)
	}
}

func TestReadableHTMLTextPrefersArticleBody(t *testing.T) {
	body := `<html>
		<head><title>派评 | 近期值得关注的 App - 少数派</title></head>
		<body>
			<nav>少数派 共创 PRIME Matrix 栏目 Pi Store 无需申请，自由写作</nav>
			<article class="normal-article">
				<header><h1>派评 | 近期值得关注的 App</h1></header>
				<div class="article-body">
					<div class="article__main__wrapper">
						<h2>VWFNDR™ + MBL：Android 独占特色交互相机应用</h2>
						<p>VWFNDR 是一款把取景和胶片模拟放在核心位置的相机应用。</p>
						<h2>Raycast for iOS：手机端快速启动器</h2>
						<p>它把常用搜索、快捷动作和跨端同步放进了移动端。</p>
					</div>
				</div>
			</article>
			<aside class="article-side">分享 收藏 下载 App</aside>
		</body>
	</html>`

	extraction := extractReadableHTML(body)
	if extraction.Source != "article_body" {
		t.Fatalf("expected article body extraction, got %s", extraction.Source)
	}
	if !strings.Contains(extraction.Text, "VWFNDR") || !strings.Contains(extraction.Text, "Raycast for iOS") {
		t.Fatalf("readable text missed article content: %s", extraction.Text)
	}
	for _, blocked := range []string{"无需申请，自由写作", "分享 收藏 下载 App"} {
		if strings.Contains(extraction.Text, blocked) {
			t.Fatalf("readable text leaked chrome text %q: %s", blocked, extraction.Text)
		}
	}
}

func TestSummarizeTextTruncatesByRunes(t *testing.T) {
	text := strings.Repeat("中文内容", 400)

	summary := summarizeText(text)
	if !strings.HasPrefix(summary, "中文内容") {
		t.Fatalf("summary lost content: %s", summary)
	}
	if runeCount(summary) > maxReadableSummaryRunes {
		t.Fatalf("summary exceeded rune limit: %d", runeCount(summary))
	}
}
