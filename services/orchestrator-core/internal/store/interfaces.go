package store

type Store interface {
	Agents() AgentStore
	Runs() RunStore
	Memories() MemoryStore
	Tasks() TaskStore
	Nodes() NodeStore
	Models() ModelStore
	Confirmations() ConfirmationStore
	Close() error
}

type AgentStore interface{}
type RunStore interface{}
type MemoryStore interface{}
type TaskStore interface{}
type NodeStore interface{}
type ModelStore interface{}
type ConfirmationStore interface{}

func (db *DB) Agents() AgentStore {
	return db
}

func (db *DB) Runs() RunStore {
	return db
}

func (db *DB) Memories() MemoryStore {
	return db
}

func (db *DB) Tasks() TaskStore {
	return db
}

func (db *DB) Nodes() NodeStore {
	return db
}

func (db *DB) Models() ModelStore {
	return db
}

func (db *DB) Confirmations() ConfirmationStore {
	return db
}
