package appcore

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

func TestApplyPatchCapabilityUpdatesWorkspaceFile(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	root := t.TempDir()
	target := filepath.Join(root, "sample.go")
	if err := os.WriteFile(target, []byte("package demo\n\nfunc Name() string {\n\treturn \"old\"\n}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	saveTestWorkspace(t, ctx, core, root)
	result := executeApplyPatchForTest(t, ctx, core, map[string]any{
		"patch": `*** Begin Patch
*** Update File: sample.go
@@
 func Name() string {
-	return "old"
+	return "new"
 }
*** End Patch
`,
		"permission_profile": "workspace_write",
	}, "workspace_write")
	if result.NormalizedResult["mode"] != "apply_patch_v1_workspace" {
		t.Fatalf("unexpected mode: %+v", result.NormalizedResult)
	}
	changed := mapSliceForTest(t, result.NormalizedResult["changed_files"])
	if len(changed) != 1 || stringValue(changed[0]["operation"]) != "update" {
		t.Fatalf("unexpected changed files: %+v", changed)
	}
	raw, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `return "new"`) || strings.Contains(string(raw), `return "old"`) {
		t.Fatalf("patch did not update file:\n%s", raw)
	}
}

func TestApplyPatchCapabilityRejectsReadOnlyProfile(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	root := t.TempDir()
	target := filepath.Join(root, "sample.txt")
	if err := os.WriteFile(target, []byte("old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	saveTestWorkspace(t, ctx, core, root)
	_, err := executeApplyPatchForTestWithError(t, ctx, core, map[string]any{
		"patch": `*** Begin Patch
*** Update File: sample.txt
@@
-old
+new
*** End Patch
`,
		"permission_profile": "read_only",
	}, "workspace_write")
	if err == nil {
		t.Fatalf("read-only profile allowed apply_patch")
	}
	raw, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "old\n" {
		t.Fatalf("read-only rejected patch should not modify file: %q", raw)
	}
}

func TestApplyPatchCapabilityRejectsPathEscapeAtomically(t *testing.T) {
	ctx := context.Background()
	core := newTestAppCore(t, ctx)
	defer core.Shutdown(ctx)

	root := t.TempDir()
	target := filepath.Join(root, "sample.txt")
	if err := os.WriteFile(target, []byte("old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	saveTestWorkspace(t, ctx, core, root)
	_, err := executeApplyPatchForTestWithError(t, ctx, core, map[string]any{
		"patch": `*** Begin Patch
*** Update File: sample.txt
@@
-old
+new
*** Update File: ../outside.txt
@@
-outside
+changed
*** End Patch
`,
		"permission_profile": "workspace_write",
	}, "workspace_write")
	if err == nil {
		t.Fatalf("path escape patch was allowed")
	}
	raw, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "old\n" {
		t.Fatalf("failed multi-file patch should not modify first file: %q", raw)
	}
}

func saveTestWorkspace(t *testing.T, ctx context.Context, core *AppCore, root string) {
	t.Helper()
	if err := core.SaveWorkspaceSettings(ctx, WorkspaceSettingsRequest{
		AllowedRoots:              []string{root},
		DefaultRoot:               root,
		FileAnalyzeMaxBytes:       1024,
		WorkspaceSearchMaxResults: 10,
	}); err != nil {
		t.Fatal(err)
	}
}

func executeApplyPatchForTest(t *testing.T, ctx context.Context, core *AppCore, inputs map[string]any, risk string) *store.CapabilityExecutionResult {
	t.Helper()
	result, err := executeApplyPatchForTestWithError(t, ctx, core, inputs, risk)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func executeApplyPatchForTestWithError(t *testing.T, ctx context.Context, core *AppCore, inputs map[string]any, risk string) (*store.CapabilityExecutionResult, error) {
	t.Helper()
	runID := insertMinimalRun(t, ctx, core.DB().SQL())
	tx, err := core.DB().SQL().BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	return core.executeAndRecordSQLiteCapability(ctx, tx, store.CapabilityRequest{
		Type:       "capability_request",
		Capability: "apply_patch",
		Goal:       "apply workspace patch",
		Inputs:     inputs,
		Risk:       risk,
		RunID:      runID,
		Evidence:   "apply workspace patch",
	})
}
