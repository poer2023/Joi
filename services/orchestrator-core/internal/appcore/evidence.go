package appcore

import (
	"encoding/json"
	"regexp"
	"strings"
)

type EvidenceLedger struct {
	Refs        []EvidenceRef `json:"refs"`
	Limitations []string      `json:"limitations"`
}

type EvidenceRef struct {
	Type       string `json:"type"`
	SourceID   string `json:"source_id"`
	Capability string `json:"capability"`
	Path       string `json:"path,omitempty"`
	Snippet    string `json:"snippet,omitempty"`
	Summary    string `json:"summary"`
}

var numericClaimPattern = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?\s*(?:%|ms|s|秒|分钟|小时|次|个|条|分|tokens?|kb|mb|gb)|通过率|失败率|critical fail rate|weighted|latency|p95|p99)`)

func hasUnsupportedNumericClaimsWithoutEvidence(text string, ledger EvidenceLedger) bool {
	return len(ledger.Refs) == 0 && numericClaimPattern.MatchString(text)
}

func buildEvidenceLedger(steps []ProductTaskStep, response string) EvidenceLedger {
	ledger := EvidenceLedger{Refs: []EvidenceRef{}, Limitations: []string{}}
	for _, step := range steps {
		if strings.TrimSpace(step.ToolRunID) == "" && strings.TrimSpace(step.CapabilityID) == "" {
			continue
		}
		capability := firstNonEmpty(step.CapabilityID, stringFromAny(step.Output["capability"]))
		if capability == "" {
			continue
		}
		refs := evidenceRefsFromStep(step, capability)
		ledger.Refs = append(ledger.Refs, refs...)
	}
	if len(ledger.Refs) == 0 {
		ledger.Limitations = append(ledger.Limitations, "本次任务没有可引用的 workspace_search/file_read/file_analyze/tool_run 证据，结论只能作为待验证判断。")
	}
	if hasUnsupportedNumericClaimsWithoutEvidence(response, ledger) {
		ledger.Limitations = append(ledger.Limitations, "检测到数字或比例类断言，但没有证据引用；artifact 不应把这些数字当作已验证事实。")
	}
	return ledger
}

func evidenceRefsFromStep(step ProductTaskStep, capability string) []EvidenceRef {
	sourceID := firstNonEmpty(step.ToolRunID, step.ID)
	switch capability {
	case "workspace_search":
		refs := []EvidenceRef{}
		for _, item := range mapSliceFromAny(step.Output["results"]) {
			path := stringFromAny(item["path"])
			snippet := firstNonEmpty(stringFromAny(item["snippet"]), stringFromAny(item["summary"]))
			if path == "" && snippet == "" {
				continue
			}
			refs = append(refs, EvidenceRef{Type: "workspace_search_result", SourceID: sourceID, Capability: capability, Path: path, Snippet: truncate(snippet, 240), Summary: firstNonEmpty(path, truncate(snippet, 80))})
		}
		if len(refs) > 0 {
			return refs
		}
	case "file_read":
		path := stringFromAny(step.Output["path"])
		content := firstNonEmpty(stringFromAny(step.Output["content"]), stringFromAny(step.Output["summary"]))
		if path != "" || content != "" {
			return []EvidenceRef{{Type: "file_read", SourceID: sourceID, Capability: capability, Path: path, Snippet: truncate(content, 240), Summary: firstNonEmpty(path, truncate(content, 80))}}
		}
	case "file_analyze":
		path := stringFromAny(step.Output["path"])
		refs := []EvidenceRef{}
		for _, item := range mapSliceFromAny(step.Output["excerpts"]) {
			snippet := firstNonEmpty(stringFromAny(item["text"]), stringFromAny(item["snippet"]), stringFromAny(item["content"]))
			refs = append(refs, EvidenceRef{Type: "file_excerpt", SourceID: sourceID, Capability: capability, Path: path, Snippet: truncate(snippet, 240), Summary: firstNonEmpty(path, truncate(snippet, 80))})
		}
		if len(refs) > 0 {
			return refs
		}
		if path != "" {
			return []EvidenceRef{{Type: "file_analyze", SourceID: sourceID, Capability: capability, Path: path, Summary: path}}
		}
	}
	return []EvidenceRef{{
		Type:       "tool_run",
		SourceID:   sourceID,
		Capability: capability,
		Summary:    firstNonEmpty(step.Summary, truncate(step.Title, 120)),
	}}
}

func mapSliceFromAny(value any) []map[string]any {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var items []map[string]any
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil
	}
	return items
}

func appendEvidenceLedgerSection(content string, ledger EvidenceLedger) string {
	var builder strings.Builder
	builder.WriteString(strings.TrimSpace(content))
	builder.WriteString("\n\n## 证据与限制\n\n")
	if len(ledger.Refs) == 0 {
		builder.WriteString("- Evidence refs: 无\n")
	} else {
		builder.WriteString("- Evidence refs:\n")
		for _, ref := range ledger.Refs {
			builder.WriteString("  - ")
			builder.WriteString(ref.Capability)
			builder.WriteString(" / ")
			builder.WriteString(ref.SourceID)
			if ref.Path != "" {
				builder.WriteString(" / ")
				builder.WriteString(ref.Path)
			}
			if ref.Summary != "" {
				builder.WriteString("：")
				builder.WriteString(ref.Summary)
			}
			builder.WriteByte('\n')
		}
	}
	if len(ledger.Limitations) == 0 {
		builder.WriteString("- Limitations: 无明显证据缺口。\n")
	} else {
		builder.WriteString("- Limitations:\n")
		for _, limitation := range ledger.Limitations {
			builder.WriteString("  - ")
			builder.WriteString(limitation)
			builder.WriteByte('\n')
		}
	}
	return builder.String()
}
