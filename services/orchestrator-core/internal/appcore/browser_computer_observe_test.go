package appcore

import (
	"context"
	"errors"
	"testing"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

func TestBrowserObserveUsesRealSnapshotExecutor(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	oldObserver := observeBrowserSnapshot
	observeBrowserSnapshot = func(ctx context.Context, opts observeOptions) browserSnapshot {
		return browserSnapshot{
			Status:      "completed",
			BrowserApp:  "Google Chrome",
			FrontApp:    "Google Chrome",
			Title:       "Fixture Browser Page",
			URL:         "https://example.test/current",
			VisibleText: "Visible browser text",
			TextStatus:  "ok",
		}
	}
	defer func() { observeBrowserSnapshot = oldObserver }()

	result := executeObserveCapabilityForTest(t, ctx, core, "browser_observe", map[string]any{
		"target":       "frontmost_browser",
		"include_text": true,
	})
	output := result.NormalizedResult
	if output["mode"] != "browser_observe_v1_macos_snapshot" {
		t.Fatalf("unexpected mode: %+v", output)
	}
	if stringValue(output["url"]) != "https://example.test/current" || output["http_fetch_used"] != false {
		t.Fatalf("browser_observe did not return dynamic snapshot metadata: %+v", output)
	}
	if stringValue(output["visible_text"]) != "Visible browser text" {
		t.Fatalf("visible text mismatch: %+v", output)
	}
}

func TestComputerObserveUsesFrontmostSnapshotExecutor(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	oldObserver := observeComputerSnapshot
	observeComputerSnapshot = func(ctx context.Context, opts observeOptions) computerSnapshot {
		return computerSnapshot{
			Status:      "completed",
			FrontApp:    "Joi",
			BundleID:    "com.hao.joi.desktop",
			WindowTitle: "Joi Test Window",
			VisibleText: "Real UI text",
			TextStatus:  "ok",
		}
	}
	defer func() { observeComputerSnapshot = oldObserver }()

	result := executeObserveCapabilityForTest(t, ctx, core, "computer_observe", map[string]any{
		"target":       "frontmost_window",
		"include_text": true,
	})
	output := result.NormalizedResult
	if output["mode"] != "computer_observe_v2_macos_snapshot" {
		t.Fatalf("unexpected mode: %+v", output)
	}
	if stringValue(output["frontmost_app"]) != "Joi" || stringValue(output["window_title"]) != "Joi Test Window" {
		t.Fatalf("computer_observe did not use snapshot executor: %+v", output)
	}
	if stringValue(output["visible_text"]) != "Real UI text" {
		t.Fatalf("visible text mismatch: %+v", output)
	}
}

func TestBrowserObserveFallsBackToComputerSnapshot(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	oldBrowserObserver := observeBrowserSnapshot
	oldComputerObserver := observeComputerSnapshot
	observeBrowserSnapshot = func(ctx context.Context, opts observeOptions) browserSnapshot {
		return browserSnapshot{
			Status:   "not_browser",
			FrontApp: "Joi",
			Error:    "frontmost app is not a supported browser",
		}
	}
	observeComputerSnapshot = func(ctx context.Context, opts observeOptions) computerSnapshot {
		return computerSnapshot{
			Status:      "completed",
			FrontApp:    "Joi",
			BundleID:    "com.hao.joi.desktop",
			WindowTitle: "Joi Visible Fallback",
			VisibleText: "Fallback UI text",
			TextStatus:  "ok",
		}
	}
	defer func() {
		observeBrowserSnapshot = oldBrowserObserver
		observeComputerSnapshot = oldComputerObserver
	}()

	result := executeObserveCapabilityForTest(t, ctx, core, "browser_observe", map[string]any{
		"target":       "frontmost_browser",
		"include_text": true,
	})
	output := result.NormalizedResult
	if output["status"] != "fallback_to_computer" {
		t.Fatalf("expected fallback status, got %+v", output)
	}
	fallback, ok := output["fallback_observe"].(map[string]any)
	if !ok {
		t.Fatalf("missing fallback observe: %+v", output)
	}
	if stringValue(fallback["window_title"]) != "Joi Visible Fallback" || stringValue(fallback["visible_text"]) != "Fallback UI text" {
		t.Fatalf("fallback snapshot mismatch: %+v", fallback)
	}
}

func TestBrowserNavigateUsesNavigatorForPublicURL(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	oldNavigator := navigateBrowserURL
	navigateBrowserURL = func(ctx context.Context, rawURL string) browserNavigation {
		return browserNavigation{
			Status:     "completed",
			BrowserApp: "Google Chrome",
			FrontApp:   "Google Chrome",
			URL:        rawURL,
			Method:     "frontmost_browser_applescript",
		}
	}
	defer func() { navigateBrowserURL = oldNavigator }()

	result := executeObserveCapabilityForTest(t, ctx, core, "browser_navigate", map[string]any{
		"url":    "https://example.com",
		"target": "frontmost_or_default_browser",
	})
	output := result.NormalizedResult
	if output["mode"] != "browser_navigate_v1_macos" || output["playwright_used"] != false || output["http_fetch_used"] != false {
		t.Fatalf("unexpected browser_navigate metadata: %+v", output)
	}
	if stringValue(output["url"]) != "https://example.com" || stringValue(output["method"]) != "frontmost_browser_applescript" {
		t.Fatalf("browser_navigate output mismatch: %+v", output)
	}
}

func TestBrowserNavigateBlocksPrivateHostsByDefault(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	oldNavigator := navigateBrowserURL
	navigateBrowserURL = func(ctx context.Context, rawURL string) browserNavigation {
		t.Fatalf("navigator should not run for blocked URL %s", rawURL)
		return browserNavigation{}
	}
	defer func() { navigateBrowserURL = oldNavigator }()

	_, err := executeObserveCapabilityForTestWithError(t, ctx, core, "browser_navigate", map[string]any{
		"url": "http://127.0.0.1:5173",
	})
	if !errors.Is(err, store.ErrPolicyDenied) {
		t.Fatalf("expected policy denied for localhost, got %v", err)
	}
}

func TestBrowserNavigateAllowsAllowlistedPrivateHost(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	root := t.TempDir()
	if err := core.SaveWorkspaceSettings(ctx, WorkspaceSettingsRequest{
		AllowedRoots:              []string{root},
		DefaultRoot:               root,
		BrowserAllowedHosts:       []string{"127.0.0.1:5173"},
		FileAnalyzeMaxBytes:       1024,
		WorkspaceSearchMaxResults: 10,
	}); err != nil {
		t.Fatal(err)
	}

	navigatedURL := ""
	oldNavigator := navigateBrowserURL
	navigateBrowserURL = func(ctx context.Context, rawURL string) browserNavigation {
		navigatedURL = rawURL
		return browserNavigation{Status: "completed", URL: rawURL, Method: "default_browser_open"}
	}
	defer func() { navigateBrowserURL = oldNavigator }()

	result := executeObserveCapabilityForTest(t, ctx, core, "browser_navigate", map[string]any{
		"url": "http://127.0.0.1:5173",
	})
	output := result.NormalizedResult
	if navigatedURL != "http://127.0.0.1:5173" || output["private_hosts_allowed"] != true {
		t.Fatalf("allowlisted private host did not navigate: url=%q output=%+v", navigatedURL, output)
	}
}

func TestBrowserNavigateBlocksUnsupportedScheme(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	oldNavigator := navigateBrowserURL
	navigateBrowserURL = func(ctx context.Context, rawURL string) browserNavigation {
		t.Fatalf("navigator should not run for blocked URL %s", rawURL)
		return browserNavigation{}
	}
	defer func() { navigateBrowserURL = oldNavigator }()

	_, err := executeObserveCapabilityForTestWithError(t, ctx, core, "browser_navigate", map[string]any{
		"url": "file:///tmp/secret.txt",
	})
	if !errors.Is(err, store.ErrPolicyDenied) {
		t.Fatalf("expected policy denied for file URL, got %v", err)
	}
}

func TestBrowserClickRequiresDangerFullAccess(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	oldInteractor := interactBrowserDOM
	interactBrowserDOM = func(ctx context.Context, action string, selector string, text string) browserInteraction {
		t.Fatalf("browser interaction should not run without permission")
		return browserInteraction{}
	}
	defer func() { interactBrowserDOM = oldInteractor }()

	_, err := executeBrowserInteractionForTestWithError(t, ctx, core, "browser_click", map[string]any{
		"selector":           "#submit",
		"permission_profile": "read_only",
	})
	if !errors.Is(err, store.ErrPolicyDenied) {
		t.Fatalf("expected policy denied, got %v", err)
	}
}

func TestBrowserClickUsesFrontmostBrowserInteractor(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	oldInteractor := interactBrowserDOM
	interactBrowserDOM = func(ctx context.Context, action string, selector string, text string) browserInteraction {
		if action != "click" || selector != "#submit" || text != "" {
			t.Fatalf("unexpected interaction args action=%q selector=%q text=%q", action, selector, text)
		}
		return browserInteraction{
			Status:     "completed",
			Action:     action,
			BrowserApp: "Google Chrome",
			FrontApp:   "Google Chrome",
			Selector:   selector,
			Method:     "frontmost_browser_javascript",
			Result:     map[string]any{"status": "completed", "tag": "BUTTON"},
		}
	}
	defer func() { interactBrowserDOM = oldInteractor }()

	result := executeBrowserInteractionForTest(t, ctx, core, "browser_click", map[string]any{
		"selector":           "#submit",
		"permission_profile": "danger_full_access",
	})
	output := result.NormalizedResult
	if output["mode"] != "browser_interaction_v1_macos" || output["playwright_used"] != false || output["http_fetch_used"] != false {
		t.Fatalf("unexpected interaction metadata: %+v", output)
	}
	if stringValue(output["action"]) != "click" || stringValue(output["selector"]) != "#submit" {
		t.Fatalf("unexpected click output: %+v", output)
	}
}

func TestBrowserTypeRequiresSelectorAndText(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	_, err := executeBrowserInteractionForTestWithError(t, ctx, core, "browser_type", map[string]any{
		"selector":           "input[name=q]",
		"permission_profile": "danger_full_access",
	})
	if !errors.Is(err, store.ErrMissingArgument) {
		t.Fatalf("expected missing text error, got %v", err)
	}
}

func TestBrowserTypeUsesFrontmostBrowserInteractor(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	oldInteractor := interactBrowserDOM
	interactBrowserDOM = func(ctx context.Context, action string, selector string, text string) browserInteraction {
		if action != "type" || selector != "input[name=q]" || text != "hello" {
			t.Fatalf("unexpected interaction args action=%q selector=%q text=%q", action, selector, text)
		}
		return browserInteraction{
			Status:     "completed",
			Action:     action,
			BrowserApp: "Safari",
			FrontApp:   "Safari",
			Selector:   selector,
			Method:     "frontmost_browser_javascript",
			Result:     map[string]any{"status": "completed", "tag": "INPUT", "text_length": 5},
		}
	}
	defer func() { interactBrowserDOM = oldInteractor }()

	result := executeBrowserInteractionForTest(t, ctx, core, "browser_type", map[string]any{
		"selector":           "input[name=q]",
		"text":               "hello",
		"permission_profile": "danger_full_access",
	})
	output := result.NormalizedResult
	if stringValue(output["action"]) != "type" || intValue(output["text_length"]) != 5 {
		t.Fatalf("unexpected type output: %+v", output)
	}
}

func executeObserveCapabilityForTest(t *testing.T, ctx context.Context, core *AppCore, capability string, inputs map[string]any) *store.CapabilityExecutionResult {
	t.Helper()
	result, err := executeObserveCapabilityForTestWithError(t, ctx, core, capability, inputs)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func executeObserveCapabilityForTestWithError(t *testing.T, ctx context.Context, core *AppCore, capability string, inputs map[string]any) (*store.CapabilityExecutionResult, error) {
	t.Helper()
	runID := insertMinimalRun(t, ctx, core.DB().SQL())
	tx, err := core.DB().SQL().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	goal := "observe visible desktop state"
	if capability == "browser_observe" {
		goal = "observe current browser tab"
	}
	if capability == "browser_navigate" {
		goal = "navigate current browser to URL"
	}
	result, err := core.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
		Type:       "capability_request",
		Capability: capability,
		Goal:       goal,
		Inputs:     inputs,
		Risk:       "read_only",
		RunID:      runID,
		Evidence:   goal,
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func executeBrowserInteractionForTest(t *testing.T, ctx context.Context, core *AppCore, capability string, inputs map[string]any) *store.CapabilityExecutionResult {
	t.Helper()
	result, err := executeBrowserInteractionForTestWithError(t, ctx, core, capability, inputs)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func executeBrowserInteractionForTestWithError(t *testing.T, ctx context.Context, core *AppCore, capability string, inputs map[string]any) (*store.CapabilityExecutionResult, error) {
	t.Helper()
	runID := insertMinimalRun(t, ctx, core.DB().SQL())
	tx, err := core.DB().SQL().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	return core.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
		Type:       "capability_request",
		Capability: capability,
		Goal:       "interact with current browser",
		Inputs:     inputs,
		Risk:       "browser_interaction",
		RunID:      runID,
		Evidence:   "click or type in current browser",
	})
}
