package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/nats-io/nats.go"
)

type natsWorkerQueue struct {
	db       *sql.DB
	nc       *nats.Conn
	js       nats.JetStreamContext
	sub      *nats.Subscription
	inFlight map[string]*nats.Msg
}

func newNATSWorkerQueue(ctx context.Context, db *sql.DB, cfg runtimeConfig, nodeID string) (*natsWorkerQueue, error) {
	nc, err := nats.Connect(cfg.TaskQueue.NATSURL)
	if err != nil {
		return nil, err
	}
	js, err := nc.JetStream()
	if err != nil {
		nc.Close()
		return nil, err
	}
	if _, err := js.AddStream(&nats.StreamConfig{Name: cfg.TaskQueue.NATSStream, Subjects: []string{cfg.TaskQueue.NATSTaskSubject}, Storage: nats.FileStorage}); err != nil {
		if _, infoErr := js.StreamInfo(cfg.TaskQueue.NATSStream); infoErr != nil {
			nc.Close()
			return nil, err
		}
	}
	durable := "worker_" + nodeID
	_ = js.DeleteConsumer(cfg.TaskQueue.NATSStream, durable)
	sub, err := js.PullSubscribe(cfg.TaskQueue.NATSTaskSubject, durable, nats.BindStream(cfg.TaskQueue.NATSStream))
	if err != nil {
		nc.Close()
		return nil, err
	}
	_ = ctx
	return &natsWorkerQueue{db: db, nc: nc, js: js, sub: sub, inFlight: map[string]*nats.Msg{}}, nil
}

func (q *natsWorkerQueue) close() {
	if q.nc != nil {
		q.nc.Close()
	}
}

func (q *natsWorkerQueue) claim(ctx context.Context, nodeID string) (*task, error) {
	msgs, err := q.sub.Fetch(1, nats.Context(ctx))
	if errors.Is(err, nats.ErrTimeout) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(msgs) == 0 {
		return nil, nil
	}
	msg := msgs[0]
	var t task
	if err := json.Unmarshal(msg.Data, &t); err != nil {
		_ = msg.Ack()
		return nil, err
	}
	if t.ID == "" {
		_ = msg.Ack()
		return nil, nil
	}
	var payloadRaw []byte
	err = q.db.QueryRowContext(ctx, `
		UPDATE tasks
		SET status='running', started_at=NOW()
		WHERE id=$1 AND assigned_node_id=$2 AND status IN ('pending', 'retrying')
		RETURNING id, COALESCE(run_id, ''), capability_id, payload
	`, t.ID, nodeID).Scan(&t.ID, &t.RunID, &t.CapabilityID, &payloadRaw)
	if errors.Is(err, sql.ErrNoRows) {
		_ = msg.Ack()
		return nil, nil
	}
	if err != nil {
		_ = msg.Nak()
		return nil, err
	}
	_ = json.Unmarshal(payloadRaw, &t.Payload)
	q.inFlight[t.ID] = msg
	return &t, nil
}

func (q *natsWorkerQueue) ack(taskID string) {
	if msg, ok := q.inFlight[taskID]; ok {
		_ = msg.Ack()
		delete(q.inFlight, taskID)
	}
}

func (q *natsWorkerQueue) fail(taskID string) {
	if msg, ok := q.inFlight[taskID]; ok {
		_ = msg.Ack()
		delete(q.inFlight, taskID)
	}
}
