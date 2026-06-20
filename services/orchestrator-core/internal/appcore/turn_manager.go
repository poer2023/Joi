package appcore

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"
)

type ActiveTurn struct {
	RunID          string
	TurnID         string
	ConversationID string
	Cancel         context.CancelFunc
	StartedAt      time.Time
}

type TurnManager struct {
	mu             sync.Mutex
	activeByRunID  map[string]*ActiveTurn
	activeByConvID map[string]string
}

func NewTurnManager() *TurnManager {
	return &TurnManager{
		activeByRunID:  map[string]*ActiveTurn{},
		activeByConvID: map[string]string{},
	}
}

func (m *TurnManager) Start(runID string, turnID string, conversationID string, cancel context.CancelFunc) error {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return errors.New("run_id is required")
	}
	if cancel == nil {
		return errors.New("cancel func is required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.activeByRunID[runID]; ok && existing.Cancel != nil {
		return errors.New("run already has an active turn")
	}
	item := &ActiveTurn{RunID: runID, TurnID: strings.TrimSpace(turnID), ConversationID: strings.TrimSpace(conversationID), Cancel: cancel, StartedAt: time.Now()}
	m.activeByRunID[runID] = item
	if item.ConversationID != "" {
		m.activeByConvID[item.ConversationID] = runID
	}
	return nil
}

func (m *TurnManager) UpdateTurnID(runID string, turnID string) {
	runID = strings.TrimSpace(runID)
	turnID = strings.TrimSpace(turnID)
	if runID == "" || turnID == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if item, ok := m.activeByRunID[runID]; ok {
		item.TurnID = turnID
	}
}

func (m *TurnManager) Interrupt(runID string, reason string) (ActiveTurn, bool) {
	_ = reason
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return ActiveTurn{}, false
	}
	m.mu.Lock()
	item, ok := m.activeByRunID[runID]
	if !ok {
		if mappedRunID, mapped := m.activeByConvID[runID]; mapped {
			item, ok = m.activeByRunID[mappedRunID]
		}
	}
	if !ok || item == nil {
		m.mu.Unlock()
		return ActiveTurn{}, false
	}
	snapshot := *item
	cancel := item.Cancel
	m.mu.Unlock()
	cancel()
	return snapshot, true
}

func (m *TurnManager) Finish(runID string) {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	item, ok := m.activeByRunID[runID]
	if !ok {
		return
	}
	delete(m.activeByRunID, runID)
	if item.ConversationID != "" {
		delete(m.activeByConvID, item.ConversationID)
	}
}

func (m *TurnManager) Get(runID string) (ActiveTurn, bool) {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return ActiveTurn{}, false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	item, ok := m.activeByRunID[runID]
	if !ok || item == nil {
		return ActiveTurn{}, false
	}
	return *item, true
}
