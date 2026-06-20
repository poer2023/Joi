package turnruntime

import "time"

const (
	RuntimeModeLegacyJSON  = "legacy_json"
	RuntimeModeToolCalling = "tool_calling"
)

type TurnInput struct {
	RunID           string
	ConversationID  string
	UserMessageID   string
	AgentID         string
	Message         string
	ModelID         string
	ModelName       string
	Provider        string
	CacheablePrefix string
	DynamicTail     string
	PromptCacheKey  string
	EventSink       func(string, map[string]any)
}

type ToolSpec struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
	Risk        string         `json:"risk"`
	Capability  string         `json:"capability"`
}

type ModelTurnRequest struct {
	ModelName    string
	Instructions string
	Items        []TurnItemRecord
	Tools        []ToolSpec
}

type ModelEvent struct {
	Type      string
	TextDelta string
	Message   string
	ToolCall  *ToolCall
	Usage     *TokenUsage
	Raw       map[string]any
}

type TokenUsage struct {
	InputTokens       int `json:"input_tokens"`
	OutputTokens      int `json:"output_tokens"`
	CachedInputTokens int `json:"cached_input_tokens"`
}

type ToolCall struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

type ToolResult struct {
	CallID    string         `json:"call_id"`
	Name      string         `json:"name"`
	ToolRunID string         `json:"tool_run_id,omitempty"`
	Output    map[string]any `json:"output"`
	Error     string         `json:"error,omitempty"`
}

type TurnResult struct {
	FinalMessage string
	Status       string
	ModelCallIDs []string
	ToolRunIDs   []string
	Usage        TokenUsage
}

type TurnRecord struct {
	ID                string         `json:"id"`
	RunID             string         `json:"run_id"`
	TurnIndex         int            `json:"turn_index"`
	Status            string         `json:"status"`
	ActiveModelCallID string         `json:"active_model_call_id,omitempty"`
	CancellationKey   string         `json:"cancellation_key,omitempty"`
	StartedAt         time.Time      `json:"started_at"`
	FinishedAt        *time.Time     `json:"finished_at,omitempty"`
	Metadata          map[string]any `json:"metadata"`
}

type TurnItemRecord struct {
	ID             string         `json:"id"`
	RunID          string         `json:"run_id"`
	TurnID         string         `json:"turn_id,omitempty"`
	TurnIndex      int            `json:"turn_index"`
	Seq            int            `json:"seq"`
	ItemType       string         `json:"item_type"`
	Role           string         `json:"role,omitempty"`
	CallID         string         `json:"call_id,omitempty"`
	ToolName       string         `json:"tool_name,omitempty"`
	Arguments      map[string]any `json:"arguments"`
	Content        string         `json:"content,omitempty"`
	Output         map[string]any `json:"output"`
	Status         string         `json:"status"`
	ProviderItemID string         `json:"provider_item_id,omitempty"`
	Metadata       map[string]any `json:"metadata"`
	CreatedAt      time.Time      `json:"created_at"`
}

type RunEventRecord struct {
	ID        string         `json:"id"`
	RunID     string         `json:"run_id"`
	TurnID    string         `json:"turn_id,omitempty"`
	Seq       int            `json:"seq"`
	EventType string         `json:"event_type"`
	Payload   map[string]any `json:"payload"`
	CreatedAt time.Time      `json:"created_at"`
}
