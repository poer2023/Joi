package turnruntime

import "context"

type ModelClient interface {
	StreamTurn(ctx context.Context, request ModelTurnRequest) (<-chan ModelEvent, error)
}

type ToolRouter interface {
	ModelVisibleTools(ctx context.Context, runID string, agentID string) ([]ToolSpec, error)
	Dispatch(ctx context.Context, call ToolCall) (*ToolResult, error)
}

type Runtime interface {
	RunTurn(ctx context.Context, input TurnInput) (*TurnResult, error)
	Interrupt(turnID string, reason string) error
	AppendUserInput(turnID string, message string) error
}
