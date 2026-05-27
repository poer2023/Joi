package store

import (
	"context"
	"errors"
	"html"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const maxDesktopApps = 1000

var plistStringPattern = regexp.MustCompile(`(?s)<key>([^<]+)</key>\s*<string>([^<]*)</string>`)

func executeDesktopAppList(ctx context.Context, request CapabilityRequest) (*CapabilityExecutionResult, error) {
	if request.Type == "" {
		request.Type = "capability_request"
	}
	if request.Risk == "" {
		request.Risk = "read_only"
	}
	if normalizedRisk(request.Risk) != "read_only" {
		return nil, ErrPolicyDenied
	}
	apps := listDesktopApps(ctx)
	return &CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    map[string]any{"risk": "read_only", "decision": "allow", "reason": "desktop_app_list_v1 reads only local app bundle metadata"},
		Workflow: ToolWorkflow{
			WorkflowName: "desktop_app_list_v1",
			Capability:   "desktop_app_list",
			RiskLevel:    "read_only",
			Steps:        []ToolWorkflowStep{{Tool: "desktop_list_app_bundles", Args: map[string]any{}, RiskLevel: "read_only"}},
		},
		SelectedNodeID: "main-node",
		NormalizedResult: map[string]any{
			"status": "completed",
			"total":  len(apps),
			"apps":   apps,
			"mode":   "desktop_app_list_v1_bundle_scan",
		},
	}, nil
}

func executeDesktopAppInspect(ctx context.Context, request CapabilityRequest) (*CapabilityExecutionResult, error) {
	if request.Type == "" {
		request.Type = "capability_request"
	}
	if request.Risk == "" {
		request.Risk = "read_only"
	}
	if normalizedRisk(request.Risk) != "read_only" {
		return nil, ErrPolicyDenied
	}
	name := strings.ToLower(strings.TrimSpace(stringInput(request.Inputs, "name", "")))
	bundleID := strings.ToLower(strings.TrimSpace(stringInput(request.Inputs, "bundle_id", "")))
	targetPath := strings.TrimSpace(stringInput(request.Inputs, "path", ""))
	if name == "" && bundleID == "" && targetPath == "" {
		return nil, ErrMissingArgument
	}
	apps := listDesktopApps(ctx)
	matches := []map[string]any{}
	for _, app := range apps {
		appName := strings.ToLower(stringInput(app, "name", ""))
		appBundleID := strings.ToLower(stringInput(app, "bundle_id", ""))
		appPath := stringInput(app, "path", "")
		if (name != "" && strings.Contains(appName, name)) ||
			(bundleID != "" && appBundleID == bundleID) ||
			(targetPath != "" && filepath.Clean(appPath) == filepath.Clean(targetPath)) {
			matches = append(matches, app)
		}
	}
	return &CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    map[string]any{"risk": "read_only", "decision": "allow", "reason": "desktop_app_inspect_v1 reads only one app bundle metadata"},
		Workflow: ToolWorkflow{
			WorkflowName: "desktop_app_inspect_v1",
			Capability:   "desktop_app_inspect",
			RiskLevel:    "read_only",
			Steps:        []ToolWorkflowStep{{Tool: "desktop_inspect_app_bundle", Args: map[string]any{}, RiskLevel: "read_only"}},
		},
		SelectedNodeID: "main-node",
		NormalizedResult: map[string]any{
			"status":  "completed",
			"matches": matches,
			"total":   len(matches),
			"mode":    "desktop_app_inspect_v1_bundle_scan",
		},
	}, nil
}

func listDesktopApps(ctx context.Context) []map[string]any {
	roots := desktopAppRoots()
	seen := map[string]bool{}
	apps := []map[string]any{}
	for _, root := range roots {
		if len(apps) >= maxDesktopApps || ctx.Err() != nil {
			break
		}
		info, err := os.Stat(root.path)
		if err != nil || !info.IsDir() {
			continue
		}
		_ = filepath.WalkDir(root.path, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil || ctx.Err() != nil || len(apps) >= maxDesktopApps {
				return nil
			}
			if path != root.path && entry.IsDir() && strings.HasSuffix(entry.Name(), ".app") {
				clean := filepath.Clean(path)
				if !seen[clean] {
					seen[clean] = true
					apps = append(apps, appBundleMetadata(clean, root.source))
				}
				return filepath.SkipDir
			}
			if entry.IsDir() && appSearchDepth(root.path, path) > 3 {
				return filepath.SkipDir
			}
			return nil
		})
	}
	sort.SliceStable(apps, func(i, j int) bool {
		return strings.ToLower(stringInput(apps[i], "name", "")) < strings.ToLower(stringInput(apps[j], "name", ""))
	})
	return apps
}

type desktopAppRoot struct {
	path   string
	source string
}

func desktopAppRoots() []desktopAppRoot {
	roots := []desktopAppRoot{
		{path: "/Applications", source: "applications"},
		{path: "/System/Applications", source: "system"},
	}
	if home, err := os.UserHomeDir(); err == nil && strings.TrimSpace(home) != "" {
		roots = append(roots, desktopAppRoot{path: filepath.Join(home, "Applications"), source: "user"})
	}
	return roots
}

func appSearchDepth(root string, path string) int {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." {
		return 0
	}
	return len(strings.Split(rel, string(filepath.Separator)))
}

func appBundleMetadata(path string, source string) map[string]any {
	infoPath := filepath.Join(path, "Contents", "Info.plist")
	plist := readPlistStrings(infoPath)
	name := strings.TrimSuffix(filepath.Base(path), ".app")
	if displayName := firstNonEmptyString(plist["CFBundleDisplayName"], plist["CFBundleName"]); displayName != "" {
		name = displayName
	}
	return map[string]any{
		"name":             name,
		"path":             path,
		"source":           source,
		"bundle_id":        plist["CFBundleIdentifier"],
		"version":          firstNonEmptyString(plist["CFBundleShortVersionString"], plist["CFBundleVersion"]),
		"executable":       plist["CFBundleExecutable"],
		"metadata_source":  plist["metadata_source"],
		"content_readable": false,
	}
}

func readPlistStrings(path string) map[string]string {
	result := map[string]string{"metadata_source": "bundle_path"}
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) == 0 {
		return result
	}
	if len(raw) > 512*1024 {
		raw = raw[:512*1024]
	}
	if strings.HasPrefix(string(raw[:min(len(raw), 6)]), "bplist") {
		result["metadata_source"] = "binary_plist_unparsed"
		return result
	}
	for _, match := range plistStringPattern.FindAllStringSubmatch(string(raw), -1) {
		if len(match) == 3 {
			result[html.UnescapeString(strings.TrimSpace(match[1]))] = html.UnescapeString(strings.TrimSpace(match[2]))
		}
	}
	result["metadata_source"] = "info_plist"
	return result
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func min(a int, b int) int {
	if a < b {
		return a
	}
	return b
}

func errNoDesktopAppMatch() error {
	return errors.New("desktop app not found")
}
