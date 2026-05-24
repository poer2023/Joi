package appcore

import (
	"strings"
	"testing"
)

func TestSanitizeWorkerGatewayOutputStripsCSSFromReadableText(t *testing.T) {
	output := sanitizeWorkerGatewayOutput(map[string]any{
		"content_type":  "text/html",
		"mode":          "web_research_v1_readonly_fetch",
		"readable_text": "Example Domain body{background:#eee;width:60vw}h1{font-size:1.5em} Example Domain This domain is for use in documentation examples.",
		"summary":       "Example Domain body{background:#eee;width:60vw}h1{font-size:1.5em} Example Domain",
	})

	text, _ := output["readable_text"].(string)
	summary, _ := output["summary"].(string)
	for _, value := range []string{text, summary} {
		if strings.Contains(value, "body{") || strings.Contains(value, "h1{") {
			t.Fatalf("worker gateway output leaked css: %s", value)
		}
	}
	if !strings.Contains(text, "Example Domain") || !strings.Contains(text, "documentation examples") {
		t.Fatalf("worker gateway output lost body content: %s", text)
	}
}
