package appcore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	defaultWorkspaceRoot        = "/Users/hao/Documents/Joi"
	defaultFileAnalyzeMaxBytes  = 256 * 1024
	defaultWorkspaceSearchLimit = 50
)

type WorkspaceSettingsResponse struct {
	AllowedRoots                 []string `json:"allowed_roots"`
	DefaultRoot                  string   `json:"default_root"`
	BrowserAllowedHosts          []string `json:"browser_allowed_hosts"`
	WebResearchAllowPrivateHosts bool     `json:"web_research_allow_private_hosts"`
	FileAnalyzeMaxBytes          int      `json:"file_analyze_max_bytes"`
	WorkspaceSearchMaxResults    int      `json:"workspace_search_max_results"`
}

type WorkspaceSettingsRequest = WorkspaceSettingsResponse

type desktopSettingQueryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func (a *AppCore) GetWorkspaceSettings(ctx context.Context) (*WorkspaceSettingsResponse, error) {
	if a.db == nil {
		return nil, errors.New("appcore db is not available")
	}
	return a.getWorkspaceSettingsFrom(ctx, a.db.SQL())
}

func (a *AppCore) getWorkspaceSettingsFrom(ctx context.Context, queryer desktopSettingQueryer) (*WorkspaceSettingsResponse, error) {
	settings := defaultWorkspaceSettings()
	if roots := desktopJSONListSettingFrom(ctx, queryer, "workspace.allowed_roots"); len(roots) > 0 {
		settings.AllowedRoots = roots
	}
	if root := strings.TrimSpace(desktopSettingOrDefaultFrom(ctx, queryer, "workspace.default_root", "")); root != "" {
		settings.DefaultRoot = filepath.Clean(root)
	}
	if hosts := desktopJSONListSettingFrom(ctx, queryer, "browser.allowed_hosts"); len(hosts) > 0 {
		settings.BrowserAllowedHosts = hosts
	}
	settings.WebResearchAllowPrivateHosts = desktopBoolSettingFrom(ctx, queryer, "web_research.allow_private_hosts", settings.WebResearchAllowPrivateHosts)
	settings.FileAnalyzeMaxBytes = desktopIntSettingFrom(ctx, queryer, "file_analyze.max_bytes", settings.FileAnalyzeMaxBytes)
	settings.WorkspaceSearchMaxResults = desktopIntSettingFrom(ctx, queryer, "workspace_search.max_results", settings.WorkspaceSearchMaxResults)
	if err := normalizeWorkspaceSettings(settings); err != nil {
		return nil, err
	}
	return settings, nil
}

func (a *AppCore) SaveWorkspaceSettings(ctx context.Context, req WorkspaceSettingsRequest) error {
	if !a.isSQLite() {
		return errors.New("workspace settings are currently implemented for SQLite desktop mode")
	}
	settings := &req
	if len(settings.AllowedRoots) == 0 {
		settings.AllowedRoots = []string{defaultWorkspaceRoot}
	}
	if strings.TrimSpace(settings.DefaultRoot) == "" {
		settings.DefaultRoot = settings.AllowedRoots[0]
	}
	if settings.FileAnalyzeMaxBytes <= 0 {
		settings.FileAnalyzeMaxBytes = defaultFileAnalyzeMaxBytes
	}
	if settings.WorkspaceSearchMaxResults <= 0 {
		settings.WorkspaceSearchMaxResults = defaultWorkspaceSearchLimit
	}
	if err := normalizeWorkspaceSettings(settings); err != nil {
		return err
	}
	values := map[string]string{
		"workspace.allowed_roots":          string(mustJSON(settings.AllowedRoots)),
		"workspace.default_root":           settings.DefaultRoot,
		"browser.allowed_hosts":            string(mustJSON(settings.BrowserAllowedHosts)),
		"web_research.allow_private_hosts": boolString(settings.WebResearchAllowPrivateHosts),
		"file_analyze.max_bytes":           strconv.Itoa(settings.FileAnalyzeMaxBytes),
		"workspace_search.max_results":     strconv.Itoa(settings.WorkspaceSearchMaxResults),
	}
	for key, value := range values {
		if err := a.setDesktopSetting(ctx, key, value); err != nil {
			return err
		}
	}
	return nil
}

func ResolveWorkspacePath(path string, settings WorkspaceSettingsResponse) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", errors.New("path is required")
	}
	if err := normalizeWorkspaceSettings(&settings); err != nil {
		return "", err
	}
	candidate := filepath.Clean(expandHomePath(path))
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(settings.DefaultRoot, candidate)
	}
	resolved, err := evalPathForBoundary(candidate)
	if err != nil {
		return "", err
	}
	if forbiddenWorkspacePath(resolved) {
		return "", errors.New("path is blocked by workspace safety policy")
	}
	for _, root := range settings.AllowedRoots {
		if pathWithinRoot(resolved, root) {
			return resolved, nil
		}
	}
	return "", errors.New("path is outside workspace.allowed_roots")
}

func defaultWorkspaceSettings() *WorkspaceSettingsResponse {
	return &WorkspaceSettingsResponse{
		AllowedRoots:                 []string{defaultWorkspaceRoot},
		DefaultRoot:                  defaultWorkspaceRoot,
		BrowserAllowedHosts:          []string{},
		WebResearchAllowPrivateHosts: false,
		FileAnalyzeMaxBytes:          defaultFileAnalyzeMaxBytes,
		WorkspaceSearchMaxResults:    defaultWorkspaceSearchLimit,
	}
}

func normalizeWorkspaceSettings(settings *WorkspaceSettingsResponse) error {
	roots := make([]string, 0, len(settings.AllowedRoots))
	seen := map[string]bool{}
	for _, root := range settings.AllowedRoots {
		clean, err := normalizeAllowedRoot(root)
		if err != nil {
			return err
		}
		if seen[clean] {
			continue
		}
		seen[clean] = true
		roots = append(roots, clean)
	}
	if len(roots) == 0 {
		return errors.New("workspace.allowed_roots must include at least one root")
	}
	settings.AllowedRoots = roots
	defaultRoot, err := normalizeAllowedRoot(settings.DefaultRoot)
	if err != nil {
		return err
	}
	if !rootAllowed(defaultRoot, roots) {
		return errors.New("workspace.default_root must be inside workspace.allowed_roots")
	}
	settings.DefaultRoot = defaultRoot
	settings.BrowserAllowedHosts = cleanHostList(settings.BrowserAllowedHosts)
	if settings.FileAnalyzeMaxBytes <= 0 {
		settings.FileAnalyzeMaxBytes = defaultFileAnalyzeMaxBytes
	}
	if settings.WorkspaceSearchMaxResults <= 0 {
		settings.WorkspaceSearchMaxResults = defaultWorkspaceSearchLimit
	}
	return nil
}

func normalizeAllowedRoot(root string) (string, error) {
	root = strings.TrimSpace(expandHomePath(root))
	if root == "" {
		return "", errors.New("workspace root is required")
	}
	if !filepath.IsAbs(root) {
		return "", errors.New("workspace root must be absolute")
	}
	clean, err := evalPathForBoundary(root)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(clean)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("workspace root must be a directory")
	}
	if forbiddenWorkspacePath(clean) {
		return "", errors.New("workspace root is blocked by workspace safety policy")
	}
	return clean, nil
}

func evalPathForBoundary(path string) (string, error) {
	clean := filepath.Clean(path)
	if resolved, err := filepath.EvalSymlinks(clean); err == nil {
		return filepath.Clean(resolved), nil
	}
	parent := filepath.Dir(clean)
	base := filepath.Base(clean)
	resolvedParent, err := filepath.EvalSymlinks(parent)
	if err != nil {
		return "", err
	}
	return filepath.Clean(filepath.Join(resolvedParent, base)), nil
}

func forbiddenWorkspacePath(path string) bool {
	clean := filepath.Clean(path)
	lower := strings.ToLower(clean)
	for _, blocked := range []string{
		"/.ssh",
		"/.env",
		"/library/keychains",
		"/library/application support/google/chrome",
		"/library/application support/chromium",
		"/library/application support/firefox/profiles",
		"/system",
		"/private/etc",
		"/etc",
		"/var/db",
	} {
		if lower == blocked || strings.Contains(lower, blocked+"/") || strings.HasSuffix(lower, blocked) {
			return true
		}
	}
	base := strings.ToLower(filepath.Base(clean))
	return base == ".env" || base == "id_rsa" || base == "keychain" || strings.HasSuffix(base, ".keychain-db")
}

func pathWithinRoot(path string, root string) bool {
	if path == root {
		return true
	}
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != "." && !strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel)
}

func rootAllowed(root string, roots []string) bool {
	for _, allowed := range roots {
		if pathWithinRoot(root, allowed) {
			return true
		}
	}
	return false
}

func cleanHostList(values []string) []string {
	hosts := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		host := strings.ToLower(strings.TrimSpace(value))
		if host == "" || seen[host] {
			continue
		}
		seen[host] = true
		hosts = append(hosts, host)
	}
	return hosts
}

func expandHomePath(path string) string {
	if path == "~" || strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil && home != "" {
			if path == "~" {
				return home
			}
			return filepath.Join(home, path[2:])
		}
	}
	return path
}

func (a *AppCore) desktopJSONListSetting(ctx context.Context, key string) []string {
	value := a.desktopSettingOrDefault(ctx, key, "")
	if strings.TrimSpace(value) == "" {
		return nil
	}
	items := []string{}
	_ = json.Unmarshal([]byte(value), &items)
	return items
}

func (a *AppCore) desktopIntSetting(ctx context.Context, key string, fallback int) int {
	value := strings.TrimSpace(a.desktopSettingOrDefault(ctx, key, ""))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func desktopSettingOrDefaultFrom(ctx context.Context, queryer desktopSettingQueryer, key string, fallback string) string {
	if queryer == nil {
		return fallback
	}
	var value string
	if err := queryer.QueryRowContext(ctx, `SELECT value FROM desktop_settings WHERE key=?`, key).Scan(&value); err != nil || strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func desktopJSONListSettingFrom(ctx context.Context, queryer desktopSettingQueryer, key string) []string {
	value := desktopSettingOrDefaultFrom(ctx, queryer, key, "")
	if strings.TrimSpace(value) == "" {
		return nil
	}
	items := []string{}
	_ = json.Unmarshal([]byte(value), &items)
	return items
}

func desktopBoolSettingFrom(ctx context.Context, queryer desktopSettingQueryer, key string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(desktopSettingOrDefaultFrom(ctx, queryer, key, "")))
	if value == "" {
		return fallback
	}
	return value == "1" || value == "true" || value == "yes" || value == "enabled"
}

func desktopIntSettingFrom(ctx context.Context, queryer desktopSettingQueryer, key string, fallback int) int {
	value := strings.TrimSpace(desktopSettingOrDefaultFrom(ctx, queryer, key, ""))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}
