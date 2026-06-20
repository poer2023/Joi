package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/hao/agent-os/services/orchestrator-core/internal/appcore"
	"github.com/hao/agent-os/services/orchestrator-core/internal/runtimeconfig"
	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
)

type desktopCase struct {
	ID                        string   `json:"id"`
	Description               string   `json:"description"`
	Message                   string   `json:"message"`
	InputMode                 string   `json:"input_mode"`
	PreferredNode             string   `json:"preferred_node"`
	AllowWorker               bool     `json:"allow_worker"`
	ExpectAgent               string   `json:"expect_agent"`
	ExpectCapability          string   `json:"expect_capability"`
	ExpectNodeID              string   `json:"expect_node_id"`
	ExpectAssignment          string   `json:"expect_assignment_reason"`
	ExpectStepTypes           []string `json:"expect_step_types"`
	ExpectNoStepTypes         []string `json:"expect_no_step_types"`
	ExpectMinModelCalls       *int     `json:"expect_min_model_calls"`
	ExpectMinAssemblies       *int     `json:"expect_min_prompt_assemblies"`
	ExpectMinMemoryPacks      *int     `json:"expect_min_memory_context_packs"`
	ExpectMinTasks            int      `json:"expect_min_tasks"`
	ExpectToolRun             bool     `json:"expect_tool_run"`
	ExpectMemoryUsage         bool     `json:"expect_memory_usage"`
	ExpectMemoryProposal      bool     `json:"expect_memory_proposal"`
	ExpectProductTask         bool     `json:"expect_product_task"`
	ExpectNoProductTask       bool     `json:"expect_no_product_task"`
	ExpectMinProductTaskSteps int      `json:"expect_min_product_task_steps"`
	ExpectArtifact            bool     `json:"expect_artifact"`
	ExpectOpenLoop            bool     `json:"expect_open_loop"`
	ExpectProactiveDraft      bool     `json:"expect_proactive_draft"`
	ExpectResponseSubstr      string   `json:"expect_response_contains"`
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: desktop-evals <evals/desktop_cases.json>")
		os.Exit(2)
	}
	setDefault("APP_MODE", "desktop")
	setDefault("DATA_STORE", "sqlite")
	setDefault("TASK_QUEUE_DRIVER", "sqlite")
	setDefault("MODEL_PROVIDER", "mock_provider")
	setDefault("ALLOW_MOCK_PROVIDER", "true")

	cases, err := loadCases(os.Args[1])
	must(err)
	ctx := context.Background()
	cfg := runtimeconfig.Load()
	core, err := appcore.NewAppCore(ctx, cfg, slog.New(slog.NewTextHandler(os.Stderr, nil)))
	must(err)
	must(core.Start(ctx))
	defer core.Shutdown(ctx)
	must(seedDesktopEvalData(ctx, core))

	passed := 0
	failures := []string{}
	for _, tc := range cases {
		if err := runCase(ctx, core, tc); err != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", tc.ID, err))
			continue
		}
		passed++
	}
	for _, failure := range failures {
		fmt.Fprintln(os.Stderr, "FAIL", failure)
	}
	fmt.Printf("%d passed / %d failed\n", passed, len(failures))
	if len(failures) > 0 {
		os.Exit(1)
	}
}

func loadCases(path string) ([]desktopCase, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cases []desktopCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		return nil, err
	}
	if len(cases) == 0 {
		return nil, fmt.Errorf("no desktop cases found")
	}
	return cases, nil
}

func seedDesktopEvalData(ctx context.Context, core *appcore.AppCore) error {
	db := core.DB().SQL()
	_, err := db.ExecContext(ctx, `
		INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, pinned, metadata, updated_at)
		VALUES
			  ('mem_desktop_deploy_pref', 'profile', '用户偏好轻量部署，优先 Docker Compose，避免默认推荐 Kubernetes。', '轻量部署偏好', 'global', 'internal', 0.95, 'confirmed', '[]', '["deploy","docker compose"]', 1, '{"seed":"desktop_eval"}', datetime('now')),
			  ('mem_desktop_antipattern_k8s', 'anti_pattern', '除非明确要求，不要把个人本地 App 默认引到 Kubernetes 或复杂运维路径。', '避免复杂运维默认路径', 'global', 'internal', 0.9, 'confirmed', '[]', '["kubernetes","ops"]', 0, '{"seed":"desktop_eval"}', datetime('now')),
			  ('mem_desktop_joi_direction', 'project_fact', '用户希望把 Joi 做成伙伴式前台 + 严肃执行后台：平时陪用户想，严肃任务时能可追踪、可交付、可审计地干活。', 'Joi 的产品方向', 'global', 'internal', 0.96, 'confirmed', '[]', '["Joi","伙伴式前台","严肃执行后台"]', 1, '{"seed":"desktop_eval"}', datetime('now'))
		ON CONFLICT(id) DO UPDATE SET content=excluded.content, summary=excluded.summary, confidence=excluded.confidence, status=excluded.status, pinned=excluded.pinned, updated_at=datetime('now');

		INSERT INTO nodes (id, name, role, status, capabilities, resources, network, assign_policy, auto_assign_enabled, manual_assign_enabled, last_heartbeat_at, version, metadata, updated_at)
		VALUES
		  ('local-worker-1', 'Local Worker 1', 'worker', 'healthy', '["web_research_v1","server_diagnose_v1"]', '{}', '{}', '{}', 1, 1, datetime('now'), '0.1.0', '{"seed":"desktop_eval"}', datetime('now')),
		  ('vps-la-1', 'VPS LA 1', 'worker', 'healthy', '["web_research_v1","fetch_url","server_diagnose_self","system_health_check_self"]', '{}', '{}', '{}', 0, 1, datetime('now'), '0.1.0', '{"seed":"desktop_eval"}', datetime('now'))
		ON CONFLICT(id) DO UPDATE SET status=excluded.status, capabilities=excluded.capabilities, manual_assign_enabled=excluded.manual_assign_enabled, auto_assign_enabled=excluded.auto_assign_enabled, last_heartbeat_at=datetime('now'), updated_at=datetime('now');
	`)
	return err
}

func runCase(ctx context.Context, core *appcore.AppCore, tc desktopCase) error {
	chat, err := core.SendChat(ctx, appcore.ChatRequest{
		Channel:       "desktop_eval",
		UserID:        "desktop_eval",
		Message:       tc.Message,
		InputMode:     tc.InputMode,
		PreferredNode: tc.PreferredNode,
		AllowWorker:   tc.AllowWorker,
	})
	if err != nil {
		return err
	}
	trace, err := core.GetRunTrace(ctx, chat.RunID)
	if err != nil {
		return err
	}
	if tc.ExpectAgent != "" && chat.SelectedAgentID != tc.ExpectAgent {
		return fmt.Errorf("selected_agent got %s want %s", chat.SelectedAgentID, tc.ExpectAgent)
	}
	if tc.ExpectResponseSubstr != "" && !strings.Contains(chat.Response, tc.ExpectResponseSubstr) {
		return fmt.Errorf("response %q does not contain %q", chat.Response, tc.ExpectResponseSubstr)
	}
	if tc.ExpectMinModelCalls != nil && len(trace.ModelCalls) < *tc.ExpectMinModelCalls {
		return fmt.Errorf("model_calls got %d want at least %d", len(trace.ModelCalls), *tc.ExpectMinModelCalls)
	}
	if tc.ExpectMinAssemblies != nil && len(trace.PromptAssemblies) < *tc.ExpectMinAssemblies {
		return fmt.Errorf("prompt_assemblies got %d want at least %d", len(trace.PromptAssemblies), *tc.ExpectMinAssemblies)
	}
	if tc.ExpectMinMemoryPacks != nil && len(trace.MemoryContextPacks) < *tc.ExpectMinMemoryPacks {
		return fmt.Errorf("memory_context_packs got %d want at least %d", len(trace.MemoryContextPacks), *tc.ExpectMinMemoryPacks)
	}
	for _, stepType := range tc.ExpectStepTypes {
		if !hasStep(trace.Steps, stepType) {
			return fmt.Errorf("missing step_type %s", stepType)
		}
	}
	for _, stepType := range tc.ExpectNoStepTypes {
		if hasStep(trace.Steps, stepType) {
			return fmt.Errorf("unexpected step_type %s", stepType)
		}
	}
	if tc.ExpectCapability != "" && !hasCapability(trace.Steps, tc.ExpectCapability) {
		return fmt.Errorf("missing capability %s", tc.ExpectCapability)
	}
	if tc.ExpectNodeID != "" && !hasNodeAssignment(trace.Steps, tc.ExpectNodeID, tc.ExpectAssignment) {
		return fmt.Errorf("missing node assignment node_id=%s reason=%s", tc.ExpectNodeID, tc.ExpectAssignment)
	}
	if len(trace.Tasks) < tc.ExpectMinTasks {
		return fmt.Errorf("tasks got %d want at least %d", len(trace.Tasks), tc.ExpectMinTasks)
	}
	if tc.ExpectToolRun {
		var count int
		if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM tool_runs WHERE run_id=?`, chat.RunID).Scan(&count); err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("expected tool_run")
		}
	}
	if tc.ExpectMemoryUsage {
		var count int
		if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM memory_usage_logs WHERE run_id=?`, chat.RunID).Scan(&count); err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("expected memory_usage_logs")
		}
	}
	if tc.ExpectMemoryProposal {
		var count int
		if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM memories WHERE status='pending'`).Scan(&count); err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("expected pending memory proposal")
		}
	}
	if tc.ExpectProductTask || tc.ExpectNoProductTask || tc.ExpectMinProductTaskSteps > 0 {
		var productTaskID string
		err := core.DB().SQL().QueryRowContext(ctx, `SELECT id FROM product_tasks WHERE latest_run_id=? ORDER BY created_at DESC LIMIT 1`, chat.RunID).Scan(&productTaskID)
		if tc.ExpectNoProductTask {
			if err == nil {
				return fmt.Errorf("unexpected product_task %s", productTaskID)
			}
			if err != nil && !strings.Contains(err.Error(), "no rows") {
				return err
			}
		} else {
			if err != nil {
				return fmt.Errorf("expected product_task: %w", err)
			}
			if tc.ExpectMinProductTaskSteps > 0 {
				var stepCount int
				if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM product_task_steps WHERE product_task_id=?`, productTaskID).Scan(&stepCount); err != nil {
					return err
				}
				if stepCount < tc.ExpectMinProductTaskSteps {
					return fmt.Errorf("product_task_steps got %d want at least %d", stepCount, tc.ExpectMinProductTaskSteps)
				}
			}
		}
	}
	if tc.ExpectArtifact {
		var count int
		if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM artifacts WHERE source_run_id=?`, chat.RunID).Scan(&count); err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("expected artifact linked to run")
		}
	}
	if tc.ExpectOpenLoop {
		var count int
		if err := core.DB().SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM open_loops WHERE source_run_id=?`, chat.RunID).Scan(&count); err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("expected open_loop linked to run")
		}
	}
	if tc.ExpectProactiveDraft {
		var count int
		if err := core.DB().SQL().QueryRowContext(ctx, `
			SELECT COUNT(*)
			FROM proactive_messages p
			LEFT JOIN open_loops o ON o.id=p.source_open_loop_id
			WHERE p.status='draft'
			  AND (o.source_run_id=? OR p.source_product_task_id IN (SELECT id FROM product_tasks WHERE latest_run_id=?))
		`, chat.RunID, chat.RunID).Scan(&count); err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("expected proactive draft linked to run")
		}
	}
	return nil
}

func hasStep(steps []store.RunStepRecord, stepType string) bool {
	for _, step := range steps {
		if step.StepType == stepType {
			return true
		}
	}
	return false
}

func hasCapability(steps []store.RunStepRecord, capability string) bool {
	capability = store.CanonicalCapabilityName(capability)
	for _, step := range steps {
		if step.StepType != "capability_requested" {
			continue
		}
		if got, _ := step.Output["capability"].(string); store.CanonicalCapabilityName(got) == capability {
			return true
		}
	}
	return false
}

func hasNodeAssignment(steps []store.RunStepRecord, nodeID string, reason string) bool {
	for _, step := range steps {
		if step.StepType != "node_selected" {
			continue
		}
		gotNode, _ := step.Output["node_id"].(string)
		gotReason, _ := step.Output["assignment_reason"].(string)
		if gotNode == nodeID && (reason == "" || gotReason == reason) {
			return true
		}
	}
	return false
}

func setDefault(key string, value string) {
	if os.Getenv(key) == "" {
		_ = os.Setenv(key, value)
	}
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
