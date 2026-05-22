package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	internal "github.com/hao/agent-os/services/orchestrator-core/internal/appcore"
	"github.com/hao/agent-os/services/orchestrator-core/internal/store"
	"github.com/hao/agent-os/services/orchestrator-core/pkg/runtimeconfig"
)

func main() {
	root, err := os.MkdirTemp("", "joi-worker-gateway-security-*")
	if err != nil {
		fail(err)
	}
	defer os.RemoveAll(root)

	mustSet("APP_MODE", "desktop")
	mustSet("DATA_STORE", "sqlite")
	mustSet("TASK_QUEUE_DRIVER", "sqlite")
	mustSet("SQLITE_PATH", filepath.Join(root, "joi.db"))
	mustSet("SQLITE_SCHEMA_PATH", filepath.Join(repoRoot(), "database", "sqlite", "001_init_schema.sql"))
	mustSet("WORKER_TOKEN", "token-one")
	mustSet("WORKER_ALLOWED_NODE_IDS", "allowed-node")
	mustSet("MODEL_PROVIDER", "mock_provider")
	mustSet("ALLOW_MOCK_PROVIDER", "true")

	ctx := context.Background()
	cfg := runtimeconfig.Load()
	core, err := internal.NewAppCore(ctx, cfg, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err != nil {
		fail(err)
	}
	defer core.Shutdown(ctx)
	if err := core.Start(ctx); err != nil {
		fail(err)
	}
	gateway, err := internal.StartWorkerGateway(ctx, internal.WorkerGatewayConfig{Core: core, Addr: "127.0.0.1:0", Token: "token-one", Logger: slog.New(slog.NewJSONHandler(io.Discard, nil))})
	if err != nil {
		fail(err)
	}
	defer gateway.Shutdown(ctx)
	baseURL := "http://" + gateway.Addr()
	client := &http.Client{Timeout: 5 * time.Second}

	if status, _ := workerGatewayRequest(client, baseURL, "allowed-node", "wrong-token", "/worker/register", map[string]any{"node_id": "allowed-node"}, nil); status != http.StatusUnauthorized {
		fail(fmt.Errorf("wrong token status = %d, want 401", status))
	}
	if status, body := workerGatewayRequest(client, baseURL, "forged-node", "token-one", "/worker/register", map[string]any{"node_id": "forged-node"}, nil); status != http.StatusForbidden {
		fail(fmt.Errorf("forged node status = %d body=%s, want 403", status, body))
	}
	if status, body := workerGatewayRequest(client, baseURL, "allowed-node", "token-one", "/worker/register", map[string]any{"node_id": "allowed-node", "name": "Allowed Node", "capabilities": []string{"web_research_v1"}}, nil); status != http.StatusOK {
		fail(fmt.Errorf("register status = %d body=%s, want 200", status, body))
	}
	replayNonce := randomNonce()
	if status, body := workerGatewayRequestWithNonce(client, baseURL, "allowed-node", "token-one", "/worker/heartbeat", map[string]any{"node_id": "allowed-node"}, replayNonce, nil); status != http.StatusOK {
		fail(fmt.Errorf("first nonce heartbeat status = %d body=%s, want 200", status, body))
	}
	if status, _ := workerGatewayRequestWithNonce(client, baseURL, "allowed-node", "token-one", "/worker/heartbeat", map[string]any{"node_id": "allowed-node"}, replayNonce, nil); status != http.StatusUnauthorized {
		fail(fmt.Errorf("duplicate nonce heartbeat status = %d, want 401", status))
	}
	taskID := "task_security_check"
	if err := core.Queue.Enqueue(ctx, store.Task{ID: taskID, CapabilityID: "web_research_v1", AssignedNodeID: "allowed-node", Payload: map[string]any{"url": "https://example.com"}}); err != nil {
		fail(err)
	}
	var claim struct {
		OK   bool        `json:"ok"`
		Task *store.Task `json:"task"`
	}
	if status, body := workerGatewayRequest(client, baseURL, "allowed-node", "token-one", "/worker/tasks/claim", map[string]any{"node_id": "allowed-node"}, &claim); status != http.StatusOK || claim.Task == nil {
		fail(fmt.Errorf("claim status = %d body=%s, task=%v, want task", status, body, claim.Task))
	}
	if status, body := workerGatewayRequest(client, baseURL, "allowed-node", "token-one", "/worker/tasks/"+taskID+"/ack", map[string]any{"output": map[string]any{"fetch_status": "succeeded"}}, nil); status != http.StatusOK {
		fail(fmt.Errorf("ack status = %d body=%s, want 200", status, body))
	}
	if status, _ := workerGatewayRequest(client, baseURL, "allowed-node", "token-one", "/worker/tasks/"+taskID+"/ack", map[string]any{"output": map[string]any{"fetch_status": "succeeded"}}, nil); status == http.StatusOK {
		fail(errors.New("duplicate ack unexpectedly succeeded"))
	}
	mustSet("WORKER_TOKEN", "token-two")
	if status, _ := workerGatewayRequest(client, baseURL, "allowed-node", "token-one", "/worker/heartbeat", map[string]any{"node_id": "allowed-node"}, nil); status != http.StatusUnauthorized {
		fail(fmt.Errorf("old rotated token status = %d, want 401", status))
	}
	if status, body := workerGatewayRequest(client, baseURL, "allowed-node", "token-two", "/worker/heartbeat", map[string]any{"node_id": "allowed-node"}, nil); status != http.StatusOK {
		fail(fmt.Errorf("new token heartbeat status = %d body=%s, want 200", status, body))
	}
	if err := core.DisableNode(ctx, "allowed-node"); err != nil {
		fail(err)
	}
	if status, _ := workerGatewayRequest(client, baseURL, "allowed-node", "token-two", "/worker/tasks/claim", map[string]any{"node_id": "allowed-node"}, nil); status != http.StatusForbidden {
		fail(fmt.Errorf("disabled node claim status = %d, want 403", status))
	}
	audit, err := core.ListWorkerGatewayAuditLogs(ctx, 100)
	if err != nil {
		fail(err)
	}
	result := map[string]any{
		"ok":                         true,
		"wrong_token_rejected":       true,
		"forged_node_rejected":       true,
		"old_token_rejected":         true,
		"disabled_node_claim_denied": true,
		"duplicate_ack_ineffective":  true,
		"duplicate_nonce_rejected":   true,
		"audit_events":               len(audit.Items),
	}
	raw, _ := json.MarshalIndent(result, "", "  ")
	fmt.Println(string(raw))
}

func workerGatewayRequest(client *http.Client, baseURL string, nodeID string, token string, path string, payload any, response any) (int, string) {
	return workerGatewayRequestWithNonce(client, baseURL, nodeID, token, path, payload, randomNonce(), response)
}

func workerGatewayRequestWithNonce(client *http.Client, baseURL string, nodeID string, token string, path string, payload any, nonce string, response any) (int, string) {
	raw, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return 0, err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Worker-Node-ID", nodeID)
	req.Header.Set("X-Worker-Timestamp", time.Now().UTC().Format(time.RFC3339))
	req.Header.Set("X-Worker-Nonce", nonce)
	resp, err := client.Do(req)
	if err != nil {
		return 0, err.Error()
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if response != nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
		_ = json.Unmarshal(body, response)
	}
	return resp.StatusCode, string(body)
}

func randomNonce() string {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(raw)
}

func mustSet(key string, value string) {
	if err := os.Setenv(key, value); err != nil {
		fail(err)
	}
}

func repoRoot() string {
	wd, _ := os.Getwd()
	for {
		if _, err := os.Stat(filepath.Join(wd, "database", "sqlite", "001_init_schema.sql")); err == nil {
			return wd
		}
		next := filepath.Dir(wd)
		if next == wd {
			return "."
		}
		wd = next
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
