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
