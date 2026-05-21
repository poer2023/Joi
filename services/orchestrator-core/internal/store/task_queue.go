package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/nats-io/nats.go"
)

type Task struct {
	ID              string         `json:"id"`
	RunID           string         `json:"run_id"`
	CapabilityID    string         `json:"capability_id"`
	PreferredNodeID string         `json:"preferred_node_id"`
	AssignedNodeID  string         `json:"assigned_node_id"`
	PrivacyLevel    string         `json:"privacy_level"`
	Status          string         `json:"status"`
	Payload         map[string]any `json:"payload"`
	TimeoutSeconds  int            `json:"timeout_seconds"`
}

type TaskResult struct {
	Output map[string]any `json:"output"`
}

type TaskError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details"`
}

type TaskQueue interface {
	Enqueue(ctx context.Context, task Task) error
	Claim(ctx context.Context, nodeID string) (*Task, error)
	Ack(ctx context.Context, taskID string, result TaskResult) error
	Fail(ctx context.Context, taskID string, err TaskError) error
	Heartbeat(ctx context.Context, nodeID string) error
}

type sqlTaskExecutor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type PostgresTaskQueue struct {
	exec sqlTaskExecutor
}

func NewPostgresTaskQueue(exec sqlTaskExecutor) *PostgresTaskQueue {
	return &PostgresTaskQueue{exec: exec}
}

func NewTaskQueue(exec sqlTaskExecutor, driver string) (TaskQueue, error) {
	switch valueOrDefault(driver, "postgres") {
	case "postgres":
		return NewPostgresTaskQueue(exec), nil
	case "nats":
		return NewNATSJetStreamTaskQueue(exec)
	default:
		return nil, fmt.Errorf("unsupported TASK_QUEUE_DRIVER: %s", driver)
	}
}

func configuredTaskQueueDriver() string {
	return valueOrDefault(os.Getenv("TASK_QUEUE_DRIVER"), "postgres")
}

func (q *PostgresTaskQueue) Enqueue(ctx context.Context, task Task) error {
	timeout := task.TimeoutSeconds
	if timeout <= 0 {
		timeout = 120
	}
	_, err := q.exec.ExecContext(ctx, `
		INSERT INTO tasks (id, run_id, capability_id, preferred_node_id, assigned_node_id, privacy_level, status, payload, timeout_seconds)
		VALUES ($1, NULLIF($2, ''), $3, NULLIF($4, ''), NULLIF($5, ''), $6, 'pending', $7, $8)
	`, task.ID, task.RunID, task.CapabilityID, task.PreferredNodeID, task.AssignedNodeID, valueOrDefault(task.PrivacyLevel, "internal"), mustJSON(task.Payload), timeout)
	return err
}

func (q *PostgresTaskQueue) Claim(ctx context.Context, nodeID string) (*Task, error) {
	var task Task
	var payloadRaw []byte
	err := q.exec.QueryRowContext(ctx, `
		UPDATE tasks
		SET status='running', started_at=NOW()
		WHERE id = (
			SELECT id
			FROM tasks
			WHERE status='pending' AND assigned_node_id=$1
			ORDER BY created_at ASC
			LIMIT 1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING id, COALESCE(run_id, ''), capability_id, COALESCE(preferred_node_id, ''),
		          COALESCE(assigned_node_id, ''), privacy_level, status, payload, timeout_seconds
	`, nodeID).Scan(&task.ID, &task.RunID, &task.CapabilityID, &task.PreferredNodeID, &task.AssignedNodeID, &task.PrivacyLevel, &task.Status, &payloadRaw, &task.TimeoutSeconds)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	task.Payload = decodeObject(payloadRaw)
	return &task, nil
}

func (q *PostgresTaskQueue) Ack(ctx context.Context, taskID string, result TaskResult) error {
	_, err := q.exec.ExecContext(ctx, `UPDATE tasks SET status='succeeded', result=$2, finished_at=NOW() WHERE id=$1`, taskID, mustJSON(result.Output))
	return err
}

func (q *PostgresTaskQueue) Fail(ctx context.Context, taskID string, taskErr TaskError) error {
	_, err := q.exec.ExecContext(ctx, `UPDATE tasks SET status='failed', error=$2, finished_at=NOW() WHERE id=$1`, taskID, mustJSON(taskErr))
	return err
}

func (q *PostgresTaskQueue) Heartbeat(ctx context.Context, nodeID string) error {
	_, err := q.exec.ExecContext(ctx, `UPDATE nodes SET status='healthy', last_heartbeat_at=NOW(), updated_at=NOW() WHERE id=$1`, nodeID)
	return err
}

type NATSJetStreamTaskQueue struct {
	*PostgresTaskQueue
	nc      *nats.Conn
	js      nats.JetStreamContext
	stream  string
	subject string
}

func NewNATSJetStreamTaskQueue(exec sqlTaskExecutor) (*NATSJetStreamTaskQueue, error) {
	nc, err := nats.Connect(valueOrDefault(os.Getenv("NATS_URL"), "nats://localhost:4222"))
	if err != nil {
		return nil, err
	}
	js, err := nc.JetStream()
	if err != nil {
		nc.Close()
		return nil, err
	}
	stream := valueOrDefault(os.Getenv("NATS_STREAM"), "AGENTOS_TASKS")
	subject := valueOrDefault(os.Getenv("NATS_TASK_SUBJECT"), "agentos.tasks")
	if _, err := js.AddStream(&nats.StreamConfig{Name: stream, Subjects: []string{subject}, Storage: nats.FileStorage}); err != nil && !errors.Is(err, nats.ErrStreamNameAlreadyInUse) {
		if _, infoErr := js.StreamInfo(stream); infoErr != nil {
			nc.Close()
			return nil, err
		}
	}
	return &NATSJetStreamTaskQueue{PostgresTaskQueue: NewPostgresTaskQueue(exec), nc: nc, js: js, stream: stream, subject: subject}, nil
}

func (q *NATSJetStreamTaskQueue) Enqueue(ctx context.Context, task Task) error {
	if err := q.PostgresTaskQueue.Enqueue(ctx, task); err != nil {
		return err
	}
	raw, err := json.Marshal(task)
	if err != nil {
		return err
	}
	_, err = q.js.Publish(q.subject, raw)
	return err
}

func taskErrorFromError(err error) TaskError {
	if err == nil {
		return TaskError{}
	}
	return TaskError{Code: "TASK_FAILED", Message: err.Error(), Details: map[string]any{}}
}

func taskAge(createdAt time.Time) int {
	return int(time.Since(createdAt).Seconds())
}
