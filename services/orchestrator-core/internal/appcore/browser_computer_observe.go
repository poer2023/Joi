package appcore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

const (
	defaultObserveTextBytes = 12000
	maxObserveTextBytes     = 48000
	observeFieldSeparator   = "\x1f"
)

type computerSnapshot struct {
	Status        string
	FrontApp      string
	BundleID      string
	WindowTitle   string
	VisibleText   string
	TextStatus    string
	Error         string
	ScreenshotRef string
	ScreenshotErr string
}

type browserSnapshot struct {
	Status        string
	BrowserApp    string
	Title         string
	URL           string
	VisibleText   string
	TextStatus    string
	FrontApp      string
	Error         string
	ScreenshotRef string
	ScreenshotErr string
}

type browserNavigation struct {
	Status     string
	BrowserApp string
	URL        string
	Method     string
	FrontApp   string
	Error      string
}

type browserInteraction struct {
	Status     string
	Action     string
	BrowserApp string
	FrontApp   string
	Selector   string
	Method     string
	Result     map[string]any
	Error      string
}

var observeComputerSnapshot = observeComputerSnapshotMac
var observeBrowserSnapshot = observeBrowserSnapshotMac
var navigateBrowserURL = navigateBrowserURLMac
var interactBrowserDOM = interactBrowserDOMMac

func (a *AppCore) executeSQLiteComputerObserve(ctx context.Context, tx *sql.Tx, request store.CapabilityRequest, workflow store.ToolWorkflow, policy map[string]any) (*store.CapabilityExecutionResult, error) {
	target := strings.TrimSpace(stringFromAny(request.Inputs["target"]))
	if target == "" {
		target = "frontmost_window"
	}
	if target != "frontmost_window" && target != "joi_current_window" {
		return nil, store.ErrPolicyDenied
	}
	maxBytes := boundedObserveTextBytes(request.Inputs["max_text_bytes"])
	snapshot := observeComputerSnapshot(ctx, observeOptions{
		Target:            target,
		IncludeText:       boolFromAny(request.Inputs["include_text"]),
		IncludeScreenshot: boolFromAny(request.Inputs["include_screenshot"]),
		MaxTextBytes:      maxBytes,
	})
	text, truncated := truncateObserveTextBytes(store.RedactSensitiveText(snapshot.VisibleText), maxBytes)
	status := valueOrDefault(snapshot.Status, "completed")
	if snapshot.Error != "" && snapshot.FrontApp == "" {
		status = "failed"
	}
	normalized := map[string]any{
		"status":               status,
		"target":               target,
		"frontmost_app":        snapshot.FrontApp,
		"bundle_id":            snapshot.BundleID,
		"window_title":         snapshot.WindowTitle,
		"visible_text":         text,
		"visible_text_summary": observeTextSummary(text, snapshot.WindowTitle),
		"text_status":          snapshot.TextStatus,
		"text_truncated":       truncated,
		"max_text_bytes":       maxBytes,
		"screenshot_ref":       snapshot.ScreenshotRef,
		"screenshot_error":     snapshot.ScreenshotErr,
		"privacy_level":        "private_content",
		"interaction_allowed":  false,
		"error":                snapshot.Error,
		"mode":                 "computer_observe_v2_macos_snapshot",
	}
	return &store.CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    policy,
		Workflow:          workflow,
		SelectedNodeID:    "main-node",
		NormalizedResult:  normalized,
	}, nil
}

func (a *AppCore) executeSQLiteBrowserObserve(ctx context.Context, tx *sql.Tx, request store.CapabilityRequest, workflow store.ToolWorkflow, policy map[string]any) (*store.CapabilityExecutionResult, error) {
	target := strings.TrimSpace(stringFromAny(request.Inputs["target"]))
	if target == "" {
		target = "frontmost_browser"
	}
	if target != "frontmost_browser" {
		return nil, store.ErrPolicyDenied
	}
	maxBytes := boundedObserveTextBytes(request.Inputs["max_text_bytes"])
	snapshot := observeBrowserSnapshot(ctx, observeOptions{
		Target:            target,
		IncludeText:       boolFromAny(request.Inputs["include_text"]),
		IncludeScreenshot: boolFromAny(request.Inputs["include_screenshot"]),
		MaxTextBytes:      maxBytes,
	})
	var fallback map[string]any
	if snapshot.Status != "completed" || snapshot.URL == "" {
		fallbackSnapshot := observeComputerSnapshot(ctx, observeOptions{
			Target:            "frontmost_window",
			IncludeText:       boolFromAny(request.Inputs["include_text"]),
			IncludeScreenshot: boolFromAny(request.Inputs["include_screenshot"]),
			MaxTextBytes:      maxBytes,
		})
		fallback = computerSnapshotOutput(fallbackSnapshot, maxBytes)
	}
	text, truncated := truncateObserveTextBytes(store.RedactSensitiveText(snapshot.VisibleText), maxBytes)
	status := valueOrDefault(snapshot.Status, "completed")
	if snapshot.Error != "" && snapshot.URL == "" {
		status = "failed"
	}
	if status != "completed" && len(fallback) > 0 {
		status = "fallback_to_computer"
	}
	normalized := map[string]any{
		"status":                status,
		"target":                target,
		"frontmost_app":         snapshot.FrontApp,
		"browser_app":           snapshot.BrowserApp,
		"title":                 snapshot.Title,
		"url":                   snapshot.URL,
		"visible_text":          text,
		"visible_text_summary":  observeTextSummary(text, snapshot.Title),
		"text_status":           snapshot.TextStatus,
		"text_truncated":        truncated,
		"max_text_bytes":        maxBytes,
		"screenshot_ref":        snapshot.ScreenshotRef,
		"screenshot_error":      snapshot.ScreenshotErr,
		"dynamic_page_observed": true,
		"http_fetch_used":       false,
		"fallback_observe":      fallback,
		"privacy_level":         "private_content",
		"interaction_allowed":   false,
		"error":                 snapshot.Error,
		"mode":                  "browser_observe_v1_macos_snapshot",
	}
	return &store.CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    policy,
		Workflow:          workflow,
		SelectedNodeID:    "main-node",
		NormalizedResult:  normalized,
	}, nil
}

func (a *AppCore) executeSQLiteBrowserNavigate(ctx context.Context, tx *sql.Tx, request store.CapabilityRequest, workflow store.ToolWorkflow, policy map[string]any) (*store.CapabilityExecutionResult, error) {
	settings, err := a.getWorkspaceSettingsFrom(ctx, tx)
	if err != nil {
		return nil, err
	}
	rawURL := strings.TrimSpace(stringFromAny(request.Inputs["url"]))
	if rawURL == "" {
		return nil, errors.New("browser_navigate url is required")
	}
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("%w: browser_navigate invalid URL", store.ErrPolicyDenied)
	}
	normalizedURL := parsedURL.String()
	if blocked, reason := store.BlockedResearchURLWithPolicy(rawURL, store.WebResearchPolicy{
		AllowPrivateHosts: len(settings.BrowserAllowedHosts) > 0,
		AllowedHosts:      settings.BrowserAllowedHosts,
	}); blocked {
		return nil, fmt.Errorf("%w: browser_navigate blocked url: %s", store.ErrPolicyDenied, reason)
	}
	target := strings.TrimSpace(stringFromAny(request.Inputs["target"]))
	if target == "" {
		target = "frontmost_or_default_browser"
	}
	if target != "frontmost_or_default_browser" {
		return nil, store.ErrPolicyDenied
	}
	navigation := navigateBrowserURL(ctx, normalizedURL)
	status := valueOrDefault(navigation.Status, "completed")
	if navigation.Error != "" {
		status = "failed"
	}
	normalized := map[string]any{
		"status":                status,
		"target":                target,
		"url":                   normalizedURL,
		"requested_url":         rawURL,
		"current_url":           navigation.URL,
		"frontmost_app":         navigation.FrontApp,
		"browser_app":           navigation.BrowserApp,
		"method":                navigation.Method,
		"allowed_hosts":         settings.BrowserAllowedHosts,
		"private_hosts_allowed": len(settings.BrowserAllowedHosts) > 0,
		"http_fetch_used":       false,
		"playwright_used":       false,
		"privacy_level":         "private_content",
		"interaction_allowed":   false,
		"error":                 navigation.Error,
		"mode":                  "browser_navigate_v1_macos",
	}
	return &store.CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    policy,
		Workflow:          workflow,
		SelectedNodeID:    "main-node",
		NormalizedResult:  normalized,
	}, nil
}

func (a *AppCore) executeSQLiteBrowserInteraction(ctx context.Context, tx *sql.Tx, request store.CapabilityRequest, workflow store.ToolWorkflow, policy map[string]any, action string) (*store.CapabilityExecutionResult, error) {
	profile := normalizedPermissionProfile(stringFromAny(request.Inputs["permission_profile"]))
	if profile != PermissionProfileDangerFullAccess {
		return nil, store.ErrPolicyDenied
	}
	target := strings.TrimSpace(stringFromAny(request.Inputs["target"]))
	if target == "" {
		target = "frontmost_browser"
	}
	if target != "frontmost_browser" {
		return nil, store.ErrPolicyDenied
	}
	selector := strings.TrimSpace(stringFromAny(request.Inputs["selector"]))
	if selector == "" {
		return nil, errors.New(action + " selector is required")
	}
	text := stringFromAny(request.Inputs["text"])
	if action == "type" && strings.TrimSpace(text) == "" {
		return nil, errors.New("browser_type text is required")
	}
	interaction := interactBrowserDOM(ctx, action, selector, text)
	status := valueOrDefault(interaction.Status, "completed")
	if interaction.Error != "" {
		status = "failed"
	}
	normalized := map[string]any{
		"status":               status,
		"action":               action,
		"target":               target,
		"selector":             selector,
		"text_length":          utf8.RuneCountInString(text),
		"frontmost_app":        interaction.FrontApp,
		"browser_app":          interaction.BrowserApp,
		"method":               interaction.Method,
		"result":               interaction.Result,
		"http_fetch_used":      false,
		"playwright_used":      false,
		"privacy_level":        "private_content",
		"interaction_allowed":  true,
		"permission_profile":   string(profile),
		"requires_permission":  string(PermissionProfileDangerFullAccess),
		"confirmation_used":    false,
		"interaction_provider": "frontmost_browser_javascript",
		"error":                interaction.Error,
		"mode":                 "browser_interaction_v1_macos",
	}
	return &store.CapabilityExecutionResult{
		CapabilityRequest: request,
		PolicyDecision:    policy,
		Workflow:          workflow,
		SelectedNodeID:    "main-node",
		NormalizedResult:  normalized,
	}, nil
}

func computerSnapshotOutput(snapshot computerSnapshot, maxBytes int) map[string]any {
	if snapshot.Status == "" && snapshot.FrontApp == "" && snapshot.BundleID == "" && snapshot.WindowTitle == "" && snapshot.Error == "" {
		return nil
	}
	text, truncated := truncateObserveTextBytes(store.RedactSensitiveText(snapshot.VisibleText), maxBytes)
	status := valueOrDefault(snapshot.Status, "completed")
	if snapshot.Error != "" && snapshot.FrontApp == "" {
		status = "failed"
	}
	return map[string]any{
		"status":               status,
		"target":               "frontmost_window",
		"frontmost_app":        snapshot.FrontApp,
		"bundle_id":            snapshot.BundleID,
		"window_title":         snapshot.WindowTitle,
		"visible_text":         text,
		"visible_text_summary": observeTextSummary(text, snapshot.WindowTitle),
		"text_status":          snapshot.TextStatus,
		"text_truncated":       truncated,
		"screenshot_ref":       snapshot.ScreenshotRef,
		"screenshot_error":     snapshot.ScreenshotErr,
		"privacy_level":        "private_content",
		"interaction_allowed":  false,
		"error":                snapshot.Error,
		"mode":                 "computer_observe_v2_macos_snapshot",
	}
}

type observeOptions struct {
	Target            string
	IncludeText       bool
	IncludeScreenshot bool
	MaxTextBytes      int
}

func observeComputerSnapshotMac(ctx context.Context, opts observeOptions) computerSnapshot {
	if runtime.GOOS != "darwin" {
		return computerSnapshot{Status: "unsupported", Error: "computer_observe real snapshot is implemented for macOS"}
	}
	script := `
set sep to ASCII character 31
set appName to ""
set bundleID to ""
set winTitle to ""
set textBlob to ""
set textStatus to "not_requested"
tell application "System Events"
	set frontProc to first application process whose frontmost is true
	set appName to name of frontProc
	try
		set bundleID to bundle identifier of frontProc
	end try
	try
		set winTitle to name of front window of frontProc
	end try
	if __INCLUDE_TEXT__ then
		set textStatus to "empty"
		try
			set textItems to {}
			repeat with itemRef in static texts of front window of frontProc
				try
					set end of textItems to value of itemRef as text
				end try
			end repeat
			set AppleScript's text item delimiters to linefeed
			set textBlob to textItems as text
			if textBlob is not "" then set textStatus to "ok"
		on error errMsg
			set textStatus to errMsg
		end try
	end if
end tell
return appName & sep & bundleID & sep & winTitle & sep & textBlob & sep & textStatus
`
	script = strings.ReplaceAll(script, "__INCLUDE_TEXT__", appleScriptBool(opts.IncludeText))
	output, err := runAppleScript(ctx, script, 4*time.Second)
	snapshot := computerSnapshot{Status: "completed"}
	if err != nil {
		snapshot.Status = "failed"
		snapshot.Error = err.Error()
		return snapshot
	}
	parts := splitObserveFields(output, 5)
	snapshot.FrontApp = parts[0]
	snapshot.BundleID = parts[1]
	snapshot.WindowTitle = parts[2]
	snapshot.VisibleText = parts[3]
	snapshot.TextStatus = parts[4]
	if opts.IncludeScreenshot {
		snapshot.ScreenshotRef, snapshot.ScreenshotErr = captureScreenSnapshot(ctx)
	}
	return snapshot
}

func observeBrowserSnapshotMac(ctx context.Context, opts observeOptions) browserSnapshot {
	if runtime.GOOS != "darwin" {
		return browserSnapshot{Status: "unsupported", Error: "browser_observe real snapshot is implemented for macOS"}
	}
	front := observeComputerSnapshotMac(ctx, observeOptions{Target: "frontmost_window"})
	if front.Error != "" && front.FrontApp == "" {
		return browserSnapshot{Status: "failed", Error: front.Error}
	}
	appName := strings.TrimSpace(front.FrontApp)
	if !browserAppSupported(appName) {
		return browserSnapshot{Status: "not_browser", FrontApp: appName, Error: "frontmost app is not a supported browser"}
	}
	script := browserObserveScript(appName, opts.IncludeText, opts.MaxTextBytes)
	output, err := runAppleScript(ctx, script, 5*time.Second)
	snapshot := browserSnapshot{Status: "completed", BrowserApp: appName, FrontApp: appName}
	if err != nil {
		snapshot.Status = "failed"
		snapshot.Error = err.Error()
		return snapshot
	}
	parts := splitObserveFields(output, 4)
	snapshot.Title = parts[0]
	snapshot.URL = parts[1]
	snapshot.VisibleText = parts[2]
	snapshot.TextStatus = parts[3]
	if opts.IncludeScreenshot {
		snapshot.ScreenshotRef, snapshot.ScreenshotErr = captureScreenSnapshot(ctx)
	}
	return snapshot
}

func navigateBrowserURLMac(ctx context.Context, rawURL string) browserNavigation {
	if runtime.GOOS != "darwin" {
		return browserNavigation{Status: "unsupported", URL: rawURL, Error: "browser_navigate is implemented for macOS"}
	}
	front := observeComputerSnapshotMac(ctx, observeOptions{Target: "frontmost_window"})
	appName := strings.TrimSpace(front.FrontApp)
	if browserAppSupported(appName) {
		output, err := runAppleScript(ctx, browserNavigateScript(appName, rawURL), 5*time.Second)
		navigation := browserNavigation{Status: "completed", BrowserApp: appName, FrontApp: appName, URL: rawURL, Method: "frontmost_browser_applescript"}
		if err != nil {
			navigation.Status = "failed"
			navigation.Error = err.Error()
			if output != "" {
				navigation.Error = output
			}
		}
		return navigation
	}
	runCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(runCtx, "open", rawURL)
	if output, err := cmd.CombinedOutput(); err != nil {
		message := strings.TrimSpace(store.RedactSensitiveText(string(output)))
		if message == "" {
			message = err.Error()
		}
		if runCtx.Err() == context.DeadlineExceeded {
			message = "default browser open timed out"
		}
		return browserNavigation{Status: "failed", URL: rawURL, FrontApp: appName, Method: "default_browser_open", Error: message}
	}
	return browserNavigation{Status: "completed", URL: rawURL, FrontApp: appName, Method: "default_browser_open"}
}

func interactBrowserDOMMac(ctx context.Context, action string, selector string, text string) browserInteraction {
	if runtime.GOOS != "darwin" {
		return browserInteraction{Status: "unsupported", Action: action, Selector: selector, Error: "browser interaction is implemented for macOS"}
	}
	front := observeComputerSnapshotMac(ctx, observeOptions{Target: "frontmost_window"})
	appName := strings.TrimSpace(front.FrontApp)
	if !browserAppSupported(appName) {
		return browserInteraction{Status: "not_browser", Action: action, Selector: selector, FrontApp: appName, Error: "frontmost app is not a supported browser"}
	}
	output, err := runAppleScript(ctx, browserInteractionScript(appName, action, selector, text), 5*time.Second)
	interaction := browserInteraction{Status: "completed", Action: action, BrowserApp: appName, FrontApp: appName, Selector: selector, Method: "frontmost_browser_javascript"}
	if err != nil {
		interaction.Status = "failed"
		interaction.Error = err.Error()
		if output != "" {
			interaction.Error = output
		}
		return interaction
	}
	result := map[string]any{}
	if output != "" {
		if err := json.Unmarshal([]byte(output), &result); err != nil {
			interaction.Status = "failed"
			interaction.Error = "browser interaction returned invalid JSON"
			interaction.Result = map[string]any{"raw_output": output}
			return interaction
		}
	}
	interaction.Result = result
	if resultStatus := strings.TrimSpace(stringFromAny(result["status"])); resultStatus != "" {
		interaction.Status = resultStatus
	}
	if resultError := strings.TrimSpace(stringFromAny(result["error"])); resultError != "" {
		interaction.Error = resultError
	}
	return interaction
}

func browserObserveScript(appName string, includeText bool, maxTextBytes int) string {
	js := fmt.Sprintf("document.body ? document.body.innerText.slice(0, %d) : ''", maxTextBytes)
	quotedApp := appleScriptQuoted(appName)
	quotedJS := appleScriptQuoted(js)
	if appName == "Safari" {
		return fmt.Sprintf(`
set sep to ASCII character 31
set tabTitle to ""
set tabURL to ""
set textBlob to ""
set textStatus to "not_requested"
tell application %s
	if (count of windows) is 0 then error "no browser windows"
	set tabTitle to name of current tab of front window
	set tabURL to URL of current tab of front window
	if %s then
		try
			set textBlob to do JavaScript %s in current tab of front window
			set textStatus to "ok"
		on error errMsg
			set textStatus to errMsg
		end try
	end if
end tell
return tabTitle & sep & tabURL & sep & textBlob & sep & textStatus
`, quotedApp, appleScriptBool(includeText), quotedJS)
	}
	return fmt.Sprintf(`
set sep to ASCII character 31
set tabTitle to ""
set tabURL to ""
set textBlob to ""
set textStatus to "not_requested"
tell application %s
	if (count of windows) is 0 then error "no browser windows"
	set tabTitle to title of active tab of front window
	set tabURL to URL of active tab of front window
	if %s then
		try
			set textBlob to execute active tab of front window javascript %s
			set textStatus to "ok"
		on error errMsg
			set textStatus to errMsg
		end try
	end if
end tell
return tabTitle & sep & tabURL & sep & textBlob & sep & textStatus
`, quotedApp, appleScriptBool(includeText), quotedJS)
}

func browserInteractionScript(appName string, action string, selector string, text string) string {
	quotedApp := appleScriptQuoted(appName)
	quotedJS := appleScriptQuoted(browserInteractionJS(action, selector, text))
	if appName == "Safari" {
		return fmt.Sprintf(`
tell application %s
	if (count of windows) is 0 then error "no browser windows"
	return do JavaScript %s in current tab of front window
end tell
`, quotedApp, quotedJS)
	}
	return fmt.Sprintf(`
tell application %s
	if (count of windows) is 0 then error "no browser windows"
	return execute active tab of front window javascript %s
end tell
`, quotedApp, quotedJS)
}

func browserInteractionJS(action string, selector string, text string) string {
	selectorJSON, _ := json.Marshal(selector)
	textJSON, _ := json.Marshal(text)
	actionJSON, _ := json.Marshal(action)
	return fmt.Sprintf(`(function() {
  const action = %s;
  const selector = %s;
  const text = %s;
  function result(value) { return JSON.stringify(value); }
  let element;
  try {
    element = document.querySelector(selector);
  } catch (error) {
    return result({status: "invalid_selector", action, selector, error: String(error)});
  }
  if (!element) return result({status: "not_found", action, selector});
  try {
    element.scrollIntoView({block: "center", inline: "center"});
    element.focus && element.focus();
    const rect = element.getBoundingClientRect();
    const eventOptions = {bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2};
    if (action === "click") {
      element.dispatchEvent(new MouseEvent("mouseover", eventOptions));
      element.dispatchEvent(new MouseEvent("mousedown", eventOptions));
      element.dispatchEvent(new MouseEvent("mouseup", eventOptions));
      if (typeof element.click === "function") element.click();
      else element.dispatchEvent(new MouseEvent("click", eventOptions));
      return result({status: "completed", action, selector, tag: element.tagName, text_preview: (element.innerText || element.value || "").slice(0, 80)});
    }
    if (action === "type") {
      if (element.isContentEditable) {
        element.textContent = text;
      } else if ("value" in element) {
        const prototype = Object.getPrototypeOf(element);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        if (descriptor && descriptor.set) descriptor.set.call(element, text);
        else element.value = text;
      } else {
        return result({status: "unsupported_element", action, selector, tag: element.tagName});
      }
      element.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: text}));
      element.dispatchEvent(new Event("change", {bubbles: true}));
      return result({status: "completed", action, selector, tag: element.tagName, text_length: text.length});
    }
    return result({status: "unsupported_action", action, selector});
  } catch (error) {
    return result({status: "failed", action, selector, error: String(error)});
  }
})()`, string(actionJSON), string(selectorJSON), string(textJSON))
}

func browserNavigateScript(appName string, rawURL string) string {
	quotedApp := appleScriptQuoted(appName)
	quotedURL := appleScriptQuoted(rawURL)
	if appName == "Safari" {
		return fmt.Sprintf(`
tell application %s
	if (count of windows) is 0 then make new document
	set URL of current tab of front window to %s
	activate
end tell
return "ok"
`, quotedApp, quotedURL)
	}
	return fmt.Sprintf(`
tell application %s
	if (count of windows) is 0 then make new window
	set URL of active tab of front window to %s
	activate
end tell
return "ok"
`, quotedApp, quotedURL)
}

func runAppleScript(ctx context.Context, script string, timeout time.Duration) (string, error) {
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(runCtx, "osascript", "-e", script)
	output, err := cmd.CombinedOutput()
	text := strings.TrimSpace(store.RedactSensitiveText(string(output)))
	if runCtx.Err() == context.DeadlineExceeded {
		return text, errors.New("osascript timed out")
	}
	if err != nil {
		if text != "" {
			return text, fmt.Errorf("%w: %s", err, text)
		}
		return text, err
	}
	return text, nil
}

func captureScreenSnapshot(ctx context.Context) (string, string) {
	if runtime.GOOS != "darwin" {
		return "", "screenshot capture is implemented for macOS"
	}
	file, err := os.CreateTemp("", "joi-observe-*.png")
	if err != nil {
		return "", err.Error()
	}
	path := file.Name()
	_ = file.Close()
	runCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(runCtx, "screencapture", "-x", path)
	if output, err := cmd.CombinedOutput(); err != nil {
		_ = os.Remove(path)
		text := strings.TrimSpace(string(output))
		if runCtx.Err() == context.DeadlineExceeded {
			return "", "screencapture timed out"
		}
		if text != "" {
			return "", text
		}
		return "", err.Error()
	}
	return path, ""
}

func browserAppSupported(appName string) bool {
	switch strings.TrimSpace(appName) {
	case "Google Chrome", "Chromium", "Microsoft Edge", "Brave Browser", "Arc", "Safari":
		return true
	default:
		return false
	}
}

func splitObserveFields(output string, count int) []string {
	parts := strings.Split(output, observeFieldSeparator)
	for len(parts) < count {
		parts = append(parts, "")
	}
	if len(parts) > count {
		parts = append(parts[:count-1], strings.Join(parts[count-1:], observeFieldSeparator))
	}
	return parts
}

func observeTextSummary(text string, fallback string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return strings.TrimSpace(fallback)
	}
	summary, _ := truncateObserveTextBytes(text, 900)
	return summary
}

func truncateObserveTextBytes(value string, limit int) (string, bool) {
	if limit <= 0 || len(value) <= limit {
		return value, false
	}
	if limit > len(value) {
		limit = len(value)
	}
	for limit > 0 && !utf8.ValidString(value[:limit]) {
		limit--
	}
	return value[:limit], true
}

func boundedObserveTextBytes(value any) int {
	limit := intFromAny(value)
	if limit <= 0 {
		limit = defaultObserveTextBytes
	}
	if limit > maxObserveTextBytes {
		limit = maxObserveTextBytes
	}
	return limit
}

func appleScriptBool(value bool) string {
	if value {
		return "true"
	}
	return "false"
}

func appleScriptQuoted(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `"`, `\"`)
	return `"` + replacer.Replace(value) + `"`
}
