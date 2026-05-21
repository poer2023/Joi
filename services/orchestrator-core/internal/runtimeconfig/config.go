package runtimeconfig

import (
	"log/slog"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server struct {
		Port          string `yaml:"port"`
		ConfigDir     string `yaml:"config_dir"`
		MigrationsDir string `yaml:"migrations_dir"`
	} `yaml:"server"`
	Database struct {
		URL string `yaml:"url"`
	} `yaml:"database"`
	Model struct {
		Provider       string `yaml:"provider"`
		BaseURL        string `yaml:"base_url"`
		Name           string `yaml:"name"`
		TimeoutSeconds int    `yaml:"timeout_seconds"`
		MaxRetries     int    `yaml:"max_retries"`
	} `yaml:"model"`
	Telegram struct {
		AllowedUserIDs  string `yaml:"allowed_user_ids"`
		OrchestratorURL string `yaml:"orchestrator_url"`
		ConsoleBaseURL  string `yaml:"console_base_url"`
	} `yaml:"telegram"`
	TaskQueue struct {
		Driver          string `yaml:"driver"`
		NATSURL         string `yaml:"nats_url"`
		NATSStream      string `yaml:"nats_stream"`
		NATSTaskSubject string `yaml:"nats_task_subject"`
	} `yaml:"task_queue"`
	Node struct {
		NodeID        string `yaml:"node_id"`
		PublicBaseURL string `yaml:"public_base_url"`
	} `yaml:"node"`
	Worker struct {
		NodeID            string `yaml:"node_id"`
		Capabilities      string `yaml:"capabilities"`
		AllowAutoAssign   bool   `yaml:"allow_auto_assign"`
		AllowManualAssign bool   `yaml:"allow_manual_assign"`
	} `yaml:"worker"`
}

func Load() Config {
	cfg := defaults()
	path := env("RUNTIME_CONFIG_PATH", "../../configs/runtime.yaml")
	raw, err := os.ReadFile(path)
	if err == nil {
		_ = yaml.Unmarshal(raw, &cfg)
	}
	applyEnv(&cfg)
	seedProcessEnv(cfg)
	return cfg
}

func LogCheck(logger *slog.Logger, cfg Config) {
	logger.Info("runtime config check",
		"database_url_configured", cfg.Database.URL != "",
		"model_provider", cfg.Model.Provider,
		"model_name", cfg.Model.Name,
		"model_base_url_configured", cfg.Model.BaseURL != "",
		"model_api_key_present", os.Getenv("MODEL_API_KEY") != "" || os.Getenv("MODEL_DEFAULT_API_KEY") != "" || os.Getenv("DEEPSEEK_API_KEY") != "",
		"task_queue_driver", cfg.TaskQueue.Driver,
		"nats_url_configured", cfg.TaskQueue.NATSURL != "",
		"node_id", cfg.Node.NodeID,
		"public_base_url", cfg.Node.PublicBaseURL,
		"telegram_allowed_user_count", countCSV(cfg.Telegram.AllowedUserIDs),
		"telegram_bot_token_present", os.Getenv("TELEGRAM_BOT_TOKEN") != "",
		"admin_token_present", os.Getenv("ADMIN_TOKEN") != "",
	)
}

func defaults() Config {
	var cfg Config
	cfg.Server.Port = "8080"
	cfg.Server.ConfigDir = "../../configs"
	cfg.Server.MigrationsDir = "../../database/migrations"
	cfg.Database.URL = "postgres://agentos:agentos_password@localhost:5432/agentos?sslmode=disable"
	cfg.Model.Provider = "mock_provider"
	cfg.Model.Name = "mock-model"
	cfg.Model.TimeoutSeconds = 60
	cfg.Model.MaxRetries = 1
	cfg.TaskQueue.Driver = "postgres"
	cfg.TaskQueue.NATSURL = "nats://localhost:4222"
	cfg.TaskQueue.NATSStream = "AGENTOS_TASKS"
	cfg.TaskQueue.NATSTaskSubject = "agentos.tasks"
	cfg.Node.NodeID = "main-node"
	cfg.Node.PublicBaseURL = "http://localhost:3000"
	cfg.Telegram.OrchestratorURL = "http://localhost:8080"
	cfg.Telegram.ConsoleBaseURL = "http://localhost:3000"
	cfg.Worker.NodeID = "local-worker-1"
	cfg.Worker.Capabilities = "server_diagnose,web_research_v1,simple_http_fetch"
	cfg.Worker.AllowAutoAssign = true
	cfg.Worker.AllowManualAssign = true
	return cfg
}

func applyEnv(cfg *Config) {
	cfg.Server.Port = env("PORT", cfg.Server.Port)
	cfg.Server.ConfigDir = env("CONFIG_DIR", cfg.Server.ConfigDir)
	cfg.Server.MigrationsDir = env("MIGRATIONS_DIR", cfg.Server.MigrationsDir)
	cfg.Database.URL = env("DATABASE_URL", cfg.Database.URL)
	cfg.Model.Provider = env("MODEL_PROVIDER", cfg.Model.Provider)
	cfg.Model.BaseURL = env("MODEL_BASE_URL", cfg.Model.BaseURL)
	cfg.Model.Name = env("MODEL_NAME", cfg.Model.Name)
	cfg.Model.TimeoutSeconds = intEnv("MODEL_TIMEOUT_SECONDS", cfg.Model.TimeoutSeconds)
	cfg.Model.MaxRetries = intEnv("MODEL_MAX_RETRIES", cfg.Model.MaxRetries)
	cfg.TaskQueue.Driver = env("TASK_QUEUE_DRIVER", cfg.TaskQueue.Driver)
	cfg.TaskQueue.NATSURL = env("NATS_URL", cfg.TaskQueue.NATSURL)
	cfg.TaskQueue.NATSStream = env("NATS_STREAM", cfg.TaskQueue.NATSStream)
	cfg.TaskQueue.NATSTaskSubject = env("NATS_TASK_SUBJECT", cfg.TaskQueue.NATSTaskSubject)
	cfg.Node.NodeID = env("NODE_ID", cfg.Node.NodeID)
	publicConsoleURL := os.Getenv("PUBLIC_CONSOLE_URL")
	cfg.Node.PublicBaseURL = env("PUBLIC_BASE_URL", valueOrDefault(publicConsoleURL, cfg.Node.PublicBaseURL))
	cfg.Telegram.AllowedUserIDs = env("TELEGRAM_ALLOWED_USER_IDS", cfg.Telegram.AllowedUserIDs)
	cfg.Telegram.OrchestratorURL = env("ORCHESTRATOR_URL", cfg.Telegram.OrchestratorURL)
	cfg.Telegram.ConsoleBaseURL = env("CONSOLE_BASE_URL", valueOrDefault(publicConsoleURL, cfg.Telegram.ConsoleBaseURL))
}

func seedProcessEnv(cfg Config) {
	setDefaultEnv("DATABASE_URL", cfg.Database.URL)
	setDefaultEnv("MODEL_PROVIDER", cfg.Model.Provider)
	setDefaultEnv("MODEL_BASE_URL", cfg.Model.BaseURL)
	setDefaultEnv("MODEL_NAME", cfg.Model.Name)
	setDefaultEnv("MODEL_TIMEOUT_SECONDS", itoa(cfg.Model.TimeoutSeconds))
	setDefaultEnv("MODEL_MAX_RETRIES", itoa(cfg.Model.MaxRetries))
	setDefaultEnv("TASK_QUEUE_DRIVER", cfg.TaskQueue.Driver)
	setDefaultEnv("NATS_URL", cfg.TaskQueue.NATSURL)
	setDefaultEnv("NATS_STREAM", cfg.TaskQueue.NATSStream)
	setDefaultEnv("NATS_TASK_SUBJECT", cfg.TaskQueue.NATSTaskSubject)
	setDefaultEnv("PUBLIC_BASE_URL", cfg.Node.PublicBaseURL)
	setDefaultEnv("CONSOLE_BASE_URL", cfg.Telegram.ConsoleBaseURL)
}

func env(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func setDefaultEnv(key string, value string) {
	if value != "" && os.Getenv(key) == "" {
		_ = os.Setenv(key, value)
	}
}

func intEnv(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	n := 0
	for _, ch := range value {
		if ch < '0' || ch > '9' {
			return fallback
		}
		n = n*10 + int(ch-'0')
	}
	return n
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	digits := []byte{}
	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}
	return string(digits)
}

func countCSV(value string) int {
	if strings.TrimSpace(value) == "" {
		return 0
	}
	return len(strings.Split(value, ","))
}

func valueOrDefault(value string, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}
