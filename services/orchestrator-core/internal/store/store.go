package store

import (
	"context"
	"database/sql"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type DB struct {
	sql *sql.DB
}

func Open(ctx context.Context, databaseURL string) (*DB, error) {
	sqlDB, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, err
	}

	sqlDB.SetMaxOpenConns(10)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)

	db := &DB{sql: sqlDB}
	if err := db.Ping(ctx); err != nil {
		sqlDB.Close()
		return nil, err
	}

	return db, nil
}

func (db *DB) Ping(ctx context.Context) error {
	return db.sql.PingContext(ctx)
}

func (db *DB) Close() error {
	return db.sql.Close()
}

func (db *DB) SQL() *sql.DB {
	return db.sql
}
