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
