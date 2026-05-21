package main

import (
	"log/slog"
	"os"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

type runtimeConfig struct {
	Telegram struct {
		AllowedUserIDs  string `yaml:"allowed_user_ids"`
		OrchestratorURL string `yaml:"orchestrator_url"`
		ConsoleBaseURL  string `yaml:"console_base_url"`
	} `yaml:"telegram"`
}

func loadGatewayConfig(logger *slog.Logger) config {
	runtime := runtimeConfig{}
	runtime.Telegram.OrchestratorURL = "http://localhost:8080"
	runtime.Telegram.ConsoleBaseURL = "http://localhost:3000"
	path := valueOrDefault(os.Getenv("RUNTIME_CONFIG_PATH"), "../../configs/runtime.yaml")
	if raw, err := os.ReadFile(path); err == nil {
		_ = yaml.Unmarshal(raw, &runtime)
	}
	cfg := config{
		Token:           os.Getenv("TELEGRAM_BOT_TOKEN"),
		AdminToken:      os.Getenv("ADMIN_TOKEN"),
		AllowedUserIDs:  parseAllowedUserIDs(valueOrDefault(os.Getenv("TELEGRAM_ALLOWED_USER_IDS"), runtime.Telegram.AllowedUserIDs)),
		OrchestratorURL: valueOrDefault(os.Getenv("ORCHESTRATOR_URL"), runtime.Telegram.OrchestratorURL),
		ConsoleBaseURL:  valueOrDefault(valueOrDefault(os.Getenv("PUBLIC_CONSOLE_URL"), os.Getenv("CONSOLE_BASE_URL")), runtime.Telegram.ConsoleBaseURL),
		PollTimeoutSec:  50,
	}
	logger.Info("runtime config check",
		"telegram_bot_token_present", cfg.Token != "",
		"admin_token_present", cfg.AdminToken != "",
		"telegram_allowed_user_count", len(cfg.AllowedUserIDs),
		"orchestrator_url", cfg.OrchestratorURL,
		"console_base_url", cfg.ConsoleBaseURL,
	)
	return cfg
}

func parseAllowedUserIDs(value string) map[int64]bool {
	result := map[int64]bool{}
	for _, item := range strings.Split(value, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		id, err := strconv.ParseInt(item, 10, 64)
		if err == nil {
			result[id] = true
		}
	}
	return result
}
