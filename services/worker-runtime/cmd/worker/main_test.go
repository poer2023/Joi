package main

import (
	"context"
	"strings"
	"testing"
)

func TestWorkerReadableHTMLTextDropsStyleScriptAndNoscript(t *testing.T) {
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

	text := workerReadableHTMLText(body)
	for _, blocked := range []string{"body{", "alert(", "enable javascript"} {
		if strings.Contains(text, blocked) {
			t.Fatalf("readable text leaked non-content block %q: %s", blocked, text)
		}
	}
	if !strings.Contains(text, "Example Domain") || !strings.Contains(text, "documentation examples") {
		t.Fatalf("readable text did not keep body content: %s", text)
	}
}

func TestWorkerReadableHTMLTextPrefersArticleBody(t *testing.T) {
	body := `<html>
		<body>
			<nav>少数派 共创 PRIME Matrix 栏目 Pi Store 无需申请，自由写作</nav>
			<article class="normal-article">
				<div class="article-body">
					<h2>VWFNDR™ + MBL：Android 独占特色交互相机应用</h2>
					<p>VWFNDR 是一款把取景和胶片模拟放在核心位置的相机应用。</p>
					<h2>Raycast for iOS：手机端快速启动器</h2>
					<p>它把常用搜索、快捷动作和跨端同步放进了移动端。</p>
				</div>
			</article>
			<aside class="article-side">分享 收藏 下载 App</aside>
		</body>
	</html>`

	text := workerReadableHTMLText(body)
	if !strings.Contains(text, "VWFNDR") || !strings.Contains(text, "Raycast for iOS") {
		t.Fatalf("readable text missed article content: %s", text)
	}
	for _, blocked := range []string{"无需申请，自由写作", "分享 收藏 下载 App"} {
		if strings.Contains(text, blocked) {
			t.Fatalf("readable text leaked chrome text %q: %s", blocked, text)
		}
	}
}

func TestExecuteWorkerCapabilityAcceptsWebResearchAliases(t *testing.T) {
	for _, capability := range []string{"web_research", "web_research_v1", "web_research_v2", "fetch_url"} {
		t.Run(capability, func(t *testing.T) {
			result := executeWorkerCapability(context.Background(), task{
				CapabilityID: capability,
				Payload:      map[string]any{"inputs": map[string]any{}},
			})
			if result["fetch_status"] != "failed" {
				t.Fatalf("expected %s to route to workerFetchURL, got %#v", capability, result)
			}
		})
	}
}
