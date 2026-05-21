package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"strings"
	"syscall"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

var workerHTMLTagPattern = regexp.MustCompile(`<[^>]+>`)
var workerLinkPattern = regexp.MustCompile(`href=["']([^"']+)["']`)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg := loadRuntimeConfig()
	logRuntimeConfig(logger, cfg)
	nodeID := cfg.Worker.NodeID
	if err := validateWorkerAuthorization(cfg, nodeID); err != nil {
		logger.Error("worker authorization failed", "node_id", nodeID, "error", err)
		os.Exit(1)
	}
	db, err := sql.Open("pgx", cfg.Database.URL)
	if err != nil {
		logger.Error("open database failed", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		logger.Error("ping database failed", "error", err)
		os.Exit(1)
	}
	if err := registerNode(context.Background(), db, nodeID, cfg); err != nil {
		logger.Error("register node failed", "error", err)
		os.Exit(1)
	}
	var natsQueue *natsWorkerQueue
	if cfg.TaskQueue.Driver == "nats" {
		natsQueue, err = newNATSWorkerQueue(context.Background(), db, cfg, nodeID)
		if err != nil {
			logger.Error("nats queue init failed", "error", err)
			os.Exit(1)
		}
		defer natsQueue.close()
	}
	logger.Info("worker-runtime started", "node_id", nodeID, "task_queue_driver", cfg.TaskQueue.Driver)
	rootCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	for {
		select {
		case <-rootCtx.Done():
			logger.Info("worker-runtime shutting down", "node_id", nodeID)
			return
		default:
		}
		ctx, cancel := context.WithTimeout(rootCtx, 30*time.Second)
		_ = heartbeat(ctx, db, nodeID)
		var task *task
		if natsQueue != nil {
			task, err = natsQueue.claim(ctx, nodeID)
		} else {
			task, err = claimTask(ctx, db, nodeID)
		}
		if err != nil {
			logger.Error("claim task failed", "error", err)
		}
		if task != nil {
			logger.Info("claimed task", "task_id", task.ID, "run_id", task.RunID)
			if err := executeTask(ctx, db, nodeID, *task, cfg); err != nil {
				logger.Error("execute task failed", "task_id", task.ID, "error", err)
				_ = failTask(ctx, db, nodeID, *task, err)
				if natsQueue != nil {
					natsQueue.fail(task.ID)
				}
			} else if natsQueue != nil {
				natsQueue.ack(task.ID)
			}
		}
		cancel()
		time.Sleep(2 * time.Second)
	}
}

type task struct {
	ID           string
	RunID        string
	CapabilityID string
	Payload      map[string]any
}

func registerNode(ctx context.Context, db *sql.DB, nodeID string, cfg runtimeConfig) error {
	nodeSecretHash := ""
	if token := os.Getenv("WORKER_TOKEN"); token != "" {
		sum := sha256.Sum256([]byte(token))
		nodeSecretHash = hex.EncodeToString(sum[:])
	}
	_, err := db.ExecContext(ctx, `
		INSERT INTO nodes (id, name, role, status, capabilities, resources, network, assign_policy, last_heartbeat_at, version, metadata, node_secret_hash, auto_assign_enabled, manual_assign_enabled)
		VALUES ($1, $2, 'worker', 'healthy', $3, $4, $5, $6, NOW(), '0.1.0', $7, NULLIF($8, ''), TRUE, TRUE)
		ON CONFLICT (id) DO UPDATE SET
			status='healthy',
			capabilities=EXCLUDED.capabilities,
			resources=EXCLUDED.resources,
			network=EXCLUDED.network,
			assign_policy=EXCLUDED.assign_policy,
			metadata=EXCLUDED.metadata,
			auto_assign_enabled=EXCLUDED.auto_assign_enabled,
			manual_assign_enabled=EXCLUDED.manual_assign_enabled,
			last_heartbeat_at=NOW(),
			updated_at=NOW(),
			node_secret_hash=COALESCE(EXCLUDED.node_secret_hash, nodes.node_secret_hash)
	`, nodeID, nodeDisplayName(nodeID), mustJSON(csvValues(cfg.Worker.Capabilities)), mustJSON(map[string]any{"execution": "worker_process"}), mustJSON(map[string]any{"scope": "public_ssh_tunnel"}), mustJSON(map[string]any{"manual_assignable": cfg.Worker.AllowManualAssign, "auto_assignable": cfg.Worker.AllowAutoAssign, "allow_private_context": false, "allow_secret_context": false}), mustJSON(map[string]any{"registered_by": "worker-runtime", "minimal_payload_only": true}), nodeSecretHash)
	return err
}

func heartbeat(ctx context.Context, db *sql.DB, nodeID string) error {
	_, err := db.ExecContext(ctx, `UPDATE nodes SET status='healthy', last_heartbeat_at=NOW(), updated_at=NOW() WHERE id=$1`, nodeID)
	return err
}

func claimTask(ctx context.Context, db *sql.DB, nodeID string) (*task, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var t task
	var payloadRaw []byte
	err = tx.QueryRowContext(ctx, `
		SELECT id, COALESCE(run_id, ''), capability_id, payload
		FROM tasks
		WHERE status='pending' AND assigned_node_id=$1
		ORDER BY created_at ASC
		LIMIT 1
		FOR UPDATE SKIP LOCKED
	`, nodeID).Scan(&t.ID, &t.RunID, &t.CapabilityID, &payloadRaw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(payloadRaw, &t.Payload)
	_, err = tx.ExecContext(ctx, `UPDATE tasks SET status='running', started_at=NOW() WHERE id=$1`, t.ID)
	if err != nil {
		return nil, err
	}
	return &t, tx.Commit()
}

func executeTask(ctx context.Context, db *sql.DB, nodeID string, t task, cfg runtimeConfig) error {
	if !capabilityAllowed(cfg.Worker.Capabilities, t.CapabilityID) {
		return errors.New("capability is not allowed on this worker")
	}
	attemptID := newID("attempt_")
	_, err := db.ExecContext(ctx, `
		INSERT INTO task_attempts (id, task_id, node_id, status, attempt_number, input, started_at)
		VALUES ($1, $2, $3, 'running', 1, $4, NOW())
	`, attemptID, t.ID, nodeID, mustJSON(t.Payload))
	if err != nil {
		return err
	}
	if t.RunID != "" {
		_, _ = db.ExecContext(ctx, `
			INSERT INTO run_steps (id, run_id, step_type, title, status, input, output, finished_at, duration_ms)
			VALUES ($1, $2, 'worker_started', 'Worker task started', 'succeeded', $3, $4, NOW(), 0)
		`, newID("step_"), t.RunID, mustJSON(map[string]any{"task_id": t.ID}), mustJSON(map[string]any{"node_id": nodeID, "task_attempt_id": attemptID}))
	}
	result := executeWorkerCapability(ctx, t)
	toolRunID := newID("toolrun_")
	_, err = db.ExecContext(ctx, `
		INSERT INTO tool_runs (id, run_id, task_id, capability_id, workflow_name, tool_name, node_id, risk_level, status, input, output, finished_at, duration_ms, assignment_reason)
		VALUES ($1, NULLIF($2, ''), $3, $4, $5, $5, $6, 'read_only', 'succeeded', $7, $8, NOW(), 0, 'user_selected')
	`, toolRunID, t.RunID, t.ID, t.CapabilityID, workflowName(t.CapabilityID), nodeID, mustJSON(t.Payload), mustJSON(result))
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `UPDATE task_attempts SET status='succeeded', output=$2, finished_at=NOW() WHERE id=$1`, attemptID, mustJSON(result))
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `UPDATE tasks SET status='succeeded', result=$2, finished_at=NOW() WHERE id=$1`, t.ID, mustJSON(result))
	if err != nil {
		return err
	}
	if t.RunID != "" {
		_, _ = db.ExecContext(ctx, `
			INSERT INTO run_steps (id, run_id, step_type, title, status, input, output, finished_at, duration_ms)
			VALUES ($1, $2, 'worker_finished', 'Worker task finished', 'succeeded', $3, $4, NOW(), 0)
		`, newID("step_"), t.RunID, mustJSON(map[string]any{"task_id": t.ID, "node_id": nodeID, "task_attempt_id": attemptID}), mustJSON(map[string]any{"result": result}))
		_, _ = db.ExecContext(ctx, `
			INSERT INTO run_steps (id, run_id, step_type, title, status, input, output, finished_at, duration_ms)
			VALUES ($1, $2, 'tool_finished', 'Worker tool runtime finished', 'succeeded', $3, $4, NOW(), 0)
		`, newID("step_"), t.RunID, mustJSON(map[string]any{"task_id": t.ID, "node_id": nodeID, "task_attempt_id": attemptID}), mustJSON(result))
	}
	return nil
}

func failTask(ctx context.Context, db *sql.DB, nodeID string, t task, taskErr error) error {
	_, err := db.ExecContext(ctx, `UPDATE tasks SET status='failed', error=$2, finished_at=NOW() WHERE id=$1`, t.ID, mustJSON(map[string]any{"message": taskErr.Error(), "node_id": nodeID}))
	return err
}

func diagnose(ctx context.Context, service string) map[string]any {
	output, err := exec.CommandContext(ctx, "docker", "ps", "-a", "--filter", "name="+service, "--format", "{{.Names}}|{{.Status}}|{{.Image}}").CombinedOutput()
	lines := nonEmptyLines(string(output))
	return map[string]any{
		"service":         service,
		"mode":            "worker_readonly_runtime",
		"container_found": len(lines) > 0,
		"docker":          map[string]any{"available": err == nil, "containers": lines, "error": errString(err)},
	}
}

func executeWorkerCapability(ctx context.Context, t task) map[string]any {
	inputs, _ := t.Payload["inputs"].(map[string]any)
	switch t.CapabilityID {
	case "web_research":
		url, _ := inputs["url"].(string)
		return workerFetchURL(ctx, url)
	default:
		service := "unknown"
		if value, ok := inputs["service_name"].(string); ok {
			service = value
		}
		return diagnose(ctx, service)
	}
}

func workerFetchURL(ctx context.Context, url string) map[string]any {
	if url == "" {
		return map[string]any{"fetch_status": "failed", "error": "url is required", "mode": "web_research_v1_readonly_fetch"}
	}
	if blocked, reason := blockedWorkerURL(url); blocked {
		return map[string]any{"url": url, "fetch_status": "policy_blocked", "reason": reason, "mode": "web_research_v1_readonly_fetch"}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return map[string]any{"url": url, "fetch_status": "failed", "error": err.Error(), "mode": "web_research_v1_readonly_fetch"}
	}
	req.Header.Set("User-Agent", "AgentOS-Worker-WebResearch/0.1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return map[string]any{"url": url, "fetch_status": "failed", "error": err.Error(), "mode": "web_research_v1_readonly_fetch"}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return map[string]any{"url": url, "fetch_status": "failed", "status_code": resp.StatusCode, "error": err.Error(), "mode": "web_research_v1_readonly_fetch"}
	}
	body := string(raw)
	text := strings.Join(strings.Fields(workerHTMLTagPattern.ReplaceAllString(body, " ")), " ")
	if len(text) > 1200 {
		text = text[:1200]
	}
	links := []string{}
	for _, match := range workerLinkPattern.FindAllStringSubmatch(body, 20) {
		if len(match) > 1 {
			links = append(links, match[1])
		}
	}
	summary := text
	if len(summary) > 280 {
		summary = summary[:280]
	}
	return map[string]any{"url": url, "fetch_status": "succeeded", "status_code": resp.StatusCode, "content_type": resp.Header.Get("Content-Type"), "readable_text": text, "links": links, "summary": summary, "mode": "web_research_v1_readonly_fetch"}
}

func blockedWorkerURL(rawURL string) (bool, string) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return true, "invalid_url"
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return true, "only_public_http_https_allowed"
	}
	host := parsed.Hostname()
	if host == "" {
		return true, "missing_host"
	}
	lowerHost := strings.ToLower(host)
	if lowerHost == "localhost" || strings.HasSuffix(lowerHost, ".localhost") {
		return true, "localhost_blocked"
	}
	if ip, err := netip.ParseAddr(lowerHost); err == nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return true, "internal_ip_blocked"
		}
	}
	return false, ""
}

func workflowName(capabilityID string) string {
	if capabilityID == "web_research" {
		return "web_research_v1"
	}
	return "server_diagnose_v1"
}

func mustJSON(value any) []byte {
	raw, _ := json.Marshal(value)
	return raw
}

func newID(prefix string) string {
	var bytes [12]byte
	_, _ = rand.Read(bytes[:])
	return prefix + hex.EncodeToString(bytes[:])
}

func nonEmptyLines(value string) []string {
	lines := []string{}
	for _, line := range strings.Split(value, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func env(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

var _ = http.MethodGet

func validateWorkerAuthorization(cfg runtimeConfig, nodeID string) error {
	if !csvContains(cfg.Worker.AllowedNodeIDs, nodeID) {
		return errors.New("node_id is not in WORKER_ALLOWED_NODE_IDS")
	}
	token := os.Getenv("WORKER_TOKEN")
	nodeSecret := os.Getenv("NODE_SECRET")
	if nodeID != "local-worker-1" && token == "" {
		return errors.New("remote worker requires WORKER_TOKEN")
	}
	if nodeSecret != "" && token != nodeSecret {
		return errors.New("WORKER_TOKEN does not match NODE_SECRET")
	}
	return nil
}

func capabilityAllowed(csv string, capabilityID string) bool {
	allowed := csvValues(csv)
	aliases := map[string][]string{
		"web_research":         {"web_research", "web_research_v1", "fetch_url"},
		"server_diagnose":      {"server_diagnose", "server_diagnose_v1", "server_diagnose_self"},
		"system_health_check":  {"system_health_check", "system_health_check_v1", "system_health_check_self"},
		"simple_http_fetch":    {"simple_http_fetch", "fetch_url"},
		"web_research_v1":      {"web_research", "web_research_v1", "fetch_url"},
		"server_diagnose_self": {"server_diagnose", "server_diagnose_self"},
	}
	for _, item := range allowed {
		if item == capabilityID {
			return true
		}
		for _, alias := range aliases[capabilityID] {
			if item == alias {
				return true
			}
		}
	}
	return false
}

func csvValues(csv string) []string {
	result := []string{}
	for _, item := range strings.Split(csv, ",") {
		item = strings.TrimSpace(item)
		if item != "" {
			result = append(result, item)
		}
	}
	return result
}

func csvContains(csv string, value string) bool {
	for _, item := range strings.Split(csv, ",") {
		if strings.TrimSpace(item) == value {
			return true
		}
	}
	return false
}

func nodeDisplayName(nodeID string) string {
	if nodeID == "local-worker-1" {
		return "Local Worker 1"
	}
	return nodeID
}
