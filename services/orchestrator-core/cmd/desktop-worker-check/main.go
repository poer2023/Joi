package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/hao/agent-os/services/orchestrator-core/internal/appcore"
	"github.com/hao/agent-os/services/orchestrator-core/internal/runtimeconfig"
)

type summary struct {
	OK               bool   `json:"ok"`
	RunID            string `json:"run_id"`
	NodeID           string `json:"node_id"`
	AssignmentReason string `json:"assignment_reason"`
	TaskID           string `json:"task_id"`
	TaskStatus       string `json:"task_status"`
	Attempts         int    `json:"attempts"`
	ToolRunSucceeded bool   `json:"tool_run_succeeded"`
	WorkerOnline     bool   `json:"worker_online"`
	Message          string `json:"message,omitempty"`
}

type nodeSummary struct {
	OK     bool   `json:"ok"`
	NodeID string `json:"node_id"`
	Status string `json:"status"`
}

func main() {
	setDefault("APP_MODE", "desktop")
	setDefault("DATA_STORE", "sqlite")
	setDefault("TASK_QUEUE_DRIVER", "sqlite")

	nodeID := env("DESKTOP_WORKER_NODE_ID", "vps-la-1")
	message := env("DESKTOP_WORKER_CHECK_MESSAGE", "@research 请读取 https://example.com 并用两句话总结页面内容。")
	timeout := time.Duration(intEnv("DESKTOP_WORKER_CHECK_TIMEOUT_SECONDS", 150)) * time.Second

	ctx := context.Background()
	cfg := runtimeconfig.Load()
	core, err := appcore.NewAppCore(ctx, cfg, slog.New(slog.NewTextHandler(os.Stderr, nil)))
	must(err)
	must(core.Start(ctx))
	defer core.Shutdown(ctx)

	if env("DESKTOP_WORKER_CHECK_MODE", "run") == "node_status" {
		nodes, err := core.ListNodes(ctx)
		must(err)
		for _, node := range nodes.Nodes {
			if node.ID == nodeID {
				writeJSON(nodeSummary{OK: node.Status == env("DESKTOP_WORKER_EXPECT_STATUS", node.Status), NodeID: node.ID, Status: node.Status})
				if expected := env("DESKTOP_WORKER_EXPECT_STATUS", ""); expected != "" && node.Status != expected {
					os.Exit(1)
				}
				return
			}
		}
		writeJSON(nodeSummary{OK: false, NodeID: nodeID, Status: "missing"})
		os.Exit(1)
	}

	chat, err := core.SendChat(ctx, appcore.ChatRequest{
		Channel:       "desktop_check",
		UserID:        "desktop_check",
		Message:       message,
		PreferredNode: nodeID,
		AllowWorker:   true,
	})
	must(err)

	deadline := time.Now().Add(timeout)
	for {
		result, err := inspect(ctx, core, chat.RunID, nodeID)
		must(err)
		if result.TaskID != "" && result.TaskStatus == "succeeded" && result.ToolRunSucceeded {
			result.OK = true
			writeJSON(result)
			return
		}
		if time.Now().After(deadline) {
			result.OK = false
			result.Message = "timed out waiting for remote worker ack"
			writeJSON(result)
			os.Exit(1)
		}
		time.Sleep(2 * time.Second)
	}
}

func inspect(ctx context.Context, core *appcore.AppCore, runID string, nodeID string) (summary, error) {
	out := summary{RunID: runID, NodeID: nodeID, AssignmentReason: "user_selected"}
	db := core.DB().SQL()
	var status sql.NullString
	err := db.QueryRowContext(ctx, `
		SELECT id, status
		FROM tasks
		WHERE run_id=? AND assigned_node_id=?
		ORDER BY created_at DESC
		LIMIT 1
	`, runID, nodeID).Scan(&out.TaskID, &status)
	if err != nil && err != sql.ErrNoRows {
		return out, err
	}
	if status.Valid {
		out.TaskStatus = status.String
	}
	if out.TaskID != "" {
		_ = db.QueryRowContext(ctx, `SELECT COUNT(*) FROM task_attempts WHERE task_id=?`, out.TaskID).Scan(&out.Attempts)
	}
	var toolRuns int
	_ = db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM tool_runs
		WHERE run_id=? AND node_id=? AND status='succeeded' AND assignment_reason='user_selected'
	`, runID, nodeID).Scan(&toolRuns)
	out.ToolRunSucceeded = toolRuns > 0
	var nodeStatus string
	_ = db.QueryRowContext(ctx, `SELECT status FROM nodes WHERE id=?`, nodeID).Scan(&nodeStatus)
	out.WorkerOnline = nodeStatus == "healthy"
	return out, nil
}

func writeJSON(value any) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	_ = encoder.Encode(value)
}

func setDefault(key string, value string) {
	if strings.TrimSpace(os.Getenv(key)) == "" {
		_ = os.Setenv(key, value)
	}
}

func env(key string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func intEnv(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
