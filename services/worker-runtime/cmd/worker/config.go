package main

import (
	"log/slog"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type runtimeConfig struct {
	Database struct {
		URL string `yaml:"url"`
	} `yaml:"database"`
	TaskQueue struct {
		Driver          string `yaml:"driver"`
		NATSURL         string `yaml:"nats_url"`
		NATSStream      string `yaml:"nats_stream"`
		NATSTaskSubject string `yaml:"nats_task_subject"`
	} `yaml:"task_queue"`
	Worker struct {
		NodeID            string `yaml:"node_id"`
		Capabilities      string `yaml:"capabilities"`
		AllowAutoAssign   bool   `yaml:"allow_auto_assign"`
		AllowManualAssign bool   `yaml:"allow_manual_assign"`
		AllowedNodeIDs    string `yaml:"allowed_node_ids"`
		GatewayURL        string `yaml:"gateway_url"`
	} `yaml:"worker"`
}

func loadRuntimeConfig() runtimeConfig {
	cfg := defaultRuntimeConfig()
	path := env("RUNTIME_CONFIG_PATH", "../../configs/runtime.yaml")
	if raw, err := os.ReadFile(path); err == nil {
		_ = yaml.Unmarshal(raw, &cfg)
	}
	cfg.Database.URL = env("DATABASE_URL", cfg.Database.URL)
	cfg.TaskQueue.Driver = env("TASK_QUEUE_DRIVER", cfg.TaskQueue.Driver)
	cfg.TaskQueue.NATSURL = env("NATS_URL", cfg.TaskQueue.NATSURL)
	cfg.TaskQueue.NATSStream = env("NATS_STREAM", cfg.TaskQueue.NATSStream)
	cfg.TaskQueue.NATSTaskSubject = env("NATS_TASK_SUBJECT", cfg.TaskQueue.NATSTaskSubject)
	cfg.Worker.NodeID = env("NODE_ID", cfg.Worker.NodeID)
	cfg.Worker.Capabilities = env("WORKER_CAPABILITIES", cfg.Worker.Capabilities)
	cfg.Worker.AllowAutoAssign = boolEnv("WORKER_ALLOW_AUTO_ASSIGN", cfg.Worker.AllowAutoAssign)
	cfg.Worker.AllowManualAssign = boolEnv("WORKER_ALLOW_MANUAL_ASSIGN", cfg.Worker.AllowManualAssign)
	cfg.Worker.AllowedNodeIDs = env("WORKER_ALLOWED_NODE_IDS", cfg.Worker.AllowedNodeIDs)
	cfg.Worker.GatewayURL = env("WORKER_GATEWAY_URL", cfg.Worker.GatewayURL)
	return cfg
}

func defaultRuntimeConfig() runtimeConfig {
	var cfg runtimeConfig
	cfg.Database.URL = "postgres://agentos:agentos_password@localhost:5432/agentos?sslmode=disable"
	cfg.TaskQueue.Driver = "postgres"
	cfg.TaskQueue.NATSURL = "nats://localhost:4222"
	cfg.TaskQueue.NATSStream = "AGENTOS_TASKS"
	cfg.TaskQueue.NATSTaskSubject = "agentos.tasks"
	cfg.Worker.NodeID = "local-worker-1"
	cfg.Worker.Capabilities = "server_diagnose,web_research_v1,simple_http_fetch"
	cfg.Worker.AllowAutoAssign = true
	cfg.Worker.AllowManualAssign = true
	cfg.Worker.AllowedNodeIDs = "local-worker-1,vps-la-1"
	cfg.Worker.GatewayURL = "http://127.0.0.1:18081"
	return cfg
}

func logRuntimeConfig(logger *slog.Logger, cfg runtimeConfig) {
	logger.Info("runtime config check",
		"database_url_configured", cfg.Database.URL != "",
		"task_queue_driver", cfg.TaskQueue.Driver,
		"nats_url_configured", cfg.TaskQueue.NATSURL != "",
		"node_id", cfg.Worker.NodeID,
		"capabilities", cfg.Worker.Capabilities,
		"allow_auto_assign", cfg.Worker.AllowAutoAssign,
		"allow_manual_assign", cfg.Worker.AllowManualAssign,
		"worker_gateway_url_configured", cfg.Worker.GatewayURL != "",
		"node_secret_present", os.Getenv("NODE_SECRET") != "",
		"worker_token_present", os.Getenv("WORKER_TOKEN") != "",
	)
}

func boolEnv(key string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	return value == "1" || value == "true" || value == "yes"
}
