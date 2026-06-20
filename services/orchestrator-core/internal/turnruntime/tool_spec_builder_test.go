package turnruntime

import (
	"context"
	"testing"
)

func TestBuildToolSpecsUsesAgentCapabilitiesAndEnabledWorkflows(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t, ctx)
	if err := db.SeedSQLiteDefaults(ctx); err != nil {
		t.Fatalf("SeedSQLiteDefaults() error = %v", err)
	}

	specs, err := BuildToolSpecs(ctx, db.SQL(), "general_agent")
	if err != nil {
		t.Fatalf("BuildToolSpecs() error = %v", err)
	}
	if !hasToolSpec(specs, "workspace_search") || !hasToolSpec(specs, "file_read") || !hasToolSpec(specs, "file_analyze") || !hasToolSpec(specs, "test_command") {
		t.Fatalf("specs missing workspace/file tools: %+v", specs)
	}
	if hasToolSpec(specs, "desktop_app_list") {
		t.Fatalf("general_agent should not expose undeclared desktop_app_list: %+v", specs)
	}
	if hasToolSpec(specs, "apply_patch") {
		t.Fatalf("apply_patch should not be visible in read-only specs: %+v", specs)
	}
	if hasToolSpec(specs, "browser_click") || hasToolSpec(specs, "browser_type") {
		t.Fatalf("browser interaction tools should not be visible in read-only specs: %+v", specs)
	}
	fileSpec := toolSpecByName(specs, "file_analyze")
	if fileSpec.Parameters["type"] != "object" {
		t.Fatalf("file_analyze schema = %+v, want object schema", fileSpec.Parameters)
	}
	required, ok := fileSpec.Parameters["required"].([]any)
	if !ok || len(required) == 0 || required[0] != "path" {
		t.Fatalf("file_analyze required schema = %+v", fileSpec.Parameters["required"])
	}
	readSpec := toolSpecByName(specs, "file_read")
	required, ok = readSpec.Parameters["required"].([]any)
	if !ok || len(required) == 0 || required[0] != "path" {
		t.Fatalf("file_read required schema = %+v", readSpec.Parameters["required"])
	}

	if _, err := db.SQL().ExecContext(ctx, `UPDATE tool_workflows SET enabled=0 WHERE name='workspace_search_v1'`); err != nil {
		t.Fatalf("disable workflow error = %v", err)
	}
	specs, err = BuildToolSpecs(ctx, db.SQL(), "general_agent")
	if err != nil {
		t.Fatalf("BuildToolSpecs(disabled workflow) error = %v", err)
	}
	if hasToolSpec(specs, "workspace_search") {
		t.Fatalf("disabled workspace_search workflow should hide tool: %+v", specs)
	}
}

func TestBuildToolSpecsDangerFullAccessExposesBrowserInteraction(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t, ctx)
	if err := db.SeedSQLiteDefaults(ctx); err != nil {
		t.Fatalf("SeedSQLiteDefaults() error = %v", err)
	}

	specs, err := BuildToolSpecsForRisk(ctx, db.SQL(), "general_agent", "browser_interaction")
	if err != nil {
		t.Fatalf("BuildToolSpecsForRisk() error = %v", err)
	}
	if !hasToolSpec(specs, "browser_click") || !hasToolSpec(specs, "browser_type") {
		t.Fatalf("browser interaction specs missing: %+v", specs)
	}
	if toolSpecByName(specs, "browser_click").Risk != "browser_interaction" {
		t.Fatalf("browser_click risk = %s, want browser_interaction", toolSpecByName(specs, "browser_click").Risk)
	}
	required, ok := toolSpecByName(specs, "browser_type").Parameters["required"].([]any)
	if !ok || len(required) < 2 || required[0] != "selector" || required[1] != "text" {
		t.Fatalf("browser_type required schema = %+v", toolSpecByName(specs, "browser_type").Parameters["required"])
	}
}

func TestBuildToolSpecsWorkspaceWriteExposesApplyPatch(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t, ctx)
	if err := db.SeedSQLiteDefaults(ctx); err != nil {
		t.Fatalf("SeedSQLiteDefaults() error = %v", err)
	}

	specs, err := BuildToolSpecsForRisk(ctx, db.SQL(), "general_agent", "workspace_write")
	if err != nil {
		t.Fatalf("BuildToolSpecsForRisk() error = %v", err)
	}
	if !hasToolSpec(specs, "apply_patch") {
		t.Fatalf("workspace_write specs missing apply_patch: %+v", specs)
	}
	patchSpec := toolSpecByName(specs, "apply_patch")
	if patchSpec.Risk != "workspace_write" {
		t.Fatalf("apply_patch risk = %s, want workspace_write", patchSpec.Risk)
	}
	required, ok := patchSpec.Parameters["required"].([]any)
	if !ok || len(required) == 0 || required[0] != "patch" {
		t.Fatalf("apply_patch required schema = %+v", patchSpec.Parameters["required"])
	}
}

func hasToolSpec(specs []ToolSpec, name string) bool {
	return toolSpecByName(specs, name).Name != ""
}

func toolSpecByName(specs []ToolSpec, name string) ToolSpec {
	for _, spec := range specs {
		if spec.Name == name {
			return spec
		}
	}
	return ToolSpec{}
}
