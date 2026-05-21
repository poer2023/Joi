package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	config := loadGatewayConfig(logger)
	if config.Token == "" {
		logger.Error("TELEGRAM_BOT_TOKEN is required")
		os.Exit(1)
	}
	gateway := gateway{
		httpClient: &http.Client{Timeout: 75 * time.Second},
		config:     config,
		logger:     logger,
	}
	if err := gateway.run(context.Background()); err != nil {
		logger.Error("telegram gateway stopped", "error", err)
		os.Exit(1)
	}
}

type config struct {
	Token           string
	AdminToken      string
	AllowedUserIDs  map[int64]bool
	OrchestratorURL string
	ConsoleBaseURL  string
	PollTimeoutSec  int
}

type gateway struct {
	httpClient *http.Client
	config     config
	logger     *slog.Logger
}

type telegramUpdateResponse struct {
	OK          bool             `json:"ok"`
	Description string           `json:"description"`
	Result      []telegramUpdate `json:"result"`
}

type telegramUpdate struct {
	UpdateID int64            `json:"update_id"`
	Message  *telegramMessage `json:"message"`
}

type telegramMessage struct {
	MessageID int64        `json:"message_id"`
	Text      string       `json:"text"`
	Chat      telegramChat `json:"chat"`
	From      telegramUser `json:"from"`
}

type telegramChat struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
}

type telegramUser struct {
	ID int64 `json:"id"`
}

type apiResponse[T any] struct {
	OK      bool      `json:"ok"`
	Data    T         `json:"data"`
	Error   *apiError `json:"error"`
	TraceID string    `json:"trace_id"`
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type chatResult struct {
	RunID           string `json:"run_id"`
	SelectedAgentID string `json:"selected_agent_id"`
	Response        string `json:"response"`
}

type runDetail struct {
	Tasks []struct {
		AssignedNodeID string `json:"assigned_node_id"`
		Status         string `json:"status"`
	} `json:"tasks"`
}

func (g gateway) run(ctx context.Context) error {
	offset := int64(0)
	for {
		updates, err := g.getUpdates(ctx, offset)
		if err != nil {
			g.logger.Warn("getUpdates failed", "error", err)
			time.Sleep(3 * time.Second)
			continue
		}
		for _, update := range updates {
			if update.UpdateID >= offset {
				offset = update.UpdateID + 1
			}
			g.handleUpdate(ctx, update)
		}
	}
}

func (g gateway) handleUpdate(ctx context.Context, update telegramUpdate) {
	if update.Message == nil || strings.TrimSpace(update.Message.Text) == "" {
		return
	}
	message := update.Message
	if message.Chat.Type != "private" {
		_ = g.sendMessage(ctx, message.Chat.ID, "当前 Telegram Gateway v0 只支持私聊文本消息。")
		return
	}
	if len(g.config.AllowedUserIDs) > 0 && !g.config.AllowedUserIDs[message.From.ID] {
		_ = g.sendMessage(ctx, message.Chat.ID, "未授权：当前 Telegram Gateway 只允许白名单用户使用。")
		return
	}
	result, err := g.sendToOrchestrator(ctx, message)
	if err != nil {
		_ = g.sendMessage(ctx, message.Chat.ID, "处理失败："+err.Error())
		return
	}
	nodeID := g.nodeForRun(ctx, result.RunID)
	traceURL := strings.TrimRight(g.config.ConsoleBaseURL, "/") + "/?run_id=" + result.RunID
	reply := fmt.Sprintf("结论：%s\n证据：%s / %s\n建议：需要更多细节时打开 Trace 查看 Run Trace、工具结果和模型调用。\nTrace：%s", compactTelegramText(result.Response), result.SelectedAgentID, nodeID, traceURL)
	_ = g.sendMessage(ctx, message.Chat.ID, reply)
}

func compactTelegramText(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	if len(value) > 360 {
		return value[:360] + "..."
	}
	return value
}

func (g gateway) sendToOrchestrator(ctx context.Context, message *telegramMessage) (*chatResult, error) {
	text := message.Text
	if strings.TrimSpace(strings.ToLower(text)) == "/joi_status" {
		text = "Joi 自检"
	}
	body := map[string]any{
		"channel": "telegram",
		"message": text,
		"options": map[string]any{"allow_tools": true, "preferred_node": "main-node", "allow_worker": false},
	}
	var payload apiResponse[chatResult]
	if err := g.postJSON(ctx, strings.TrimRight(g.config.OrchestratorURL, "/")+"/api/chat/send", body, &payload); err != nil {
		return nil, err
	}
	if !payload.OK {
		if payload.Error != nil {
			return nil, errors.New(payload.Error.Message)
		}
		return nil, errors.New("orchestrator returned an error")
	}
	return &payload.Data, nil
}

func (g gateway) nodeForRun(ctx context.Context, runID string) string {
	var payload apiResponse[runDetail]
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(g.config.OrchestratorURL, "/")+"/api/runs/"+runID, nil)
	if err != nil {
		return "main-node"
	}
	if g.config.AdminToken != "" {
		req.Header.Set("X-Admin-Token", g.config.AdminToken)
	}
	resp, err := g.httpClient.Do(req)
	if err != nil {
		return "main-node"
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return "main-node"
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil || !payload.OK {
		return "main-node"
	}
	for _, task := range payload.Data.Tasks {
		if task.AssignedNodeID != "" {
			return task.AssignedNodeID
		}
	}
	return "main-node"
}

func (g gateway) getUpdates(ctx context.Context, offset int64) ([]telegramUpdate, error) {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/getUpdates?timeout=%d&offset=%d&allowed_updates=[\"message\"]", g.config.Token, g.config.PollTimeoutSec, offset)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := g.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("telegram getUpdates failed: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var payload telegramUpdateResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if !payload.OK {
		return nil, errors.New(valueOrDefault(payload.Description, "telegram returned an error"))
	}
	return payload.Result, nil
}

func (g gateway) sendMessage(ctx context.Context, chatID int64, text string) error {
	body := map[string]any{"chat_id": chatID, "text": text, "disable_web_page_preview": true}
	var payload map[string]any
	return g.postJSON(ctx, fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", g.config.Token), body, &payload)
}

func (g gateway) postJSON(ctx context.Context, url string, body any, target any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if g.config.AdminToken != "" && strings.HasPrefix(url, strings.TrimRight(g.config.OrchestratorURL, "/")) {
		req.Header.Set("X-Admin-Token", g.config.AdminToken)
	}
	resp, err := g.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		rawBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("request failed: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(rawBody)))
	}
	return json.NewDecoder(resp.Body).Decode(target)
}

func valueOrDefault(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
