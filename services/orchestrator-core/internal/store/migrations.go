package store

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func (db *DB) ApplyMigrations(ctx context.Context, migrationsDir string) error {
	if _, err := db.sql.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
		  version TEXT PRIMARY KEY,
		  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`); err != nil {
		return err
	}

	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	sort.Slice(entries, func(i int, j int) bool { return entries[i].Name() < entries[j].Name() })

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		version := strings.TrimSuffix(entry.Name(), ".sql")
		var alreadyApplied bool
		if err := db.sql.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, version).Scan(&alreadyApplied); err != nil {
			return err
		}
		if alreadyApplied {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(migrationsDir, entry.Name()))
		if err != nil {
			return err
		}
		if _, err := db.sql.ExecContext(ctx, string(raw)); err != nil {
			return err
		}
		if _, err := db.sql.ExecContext(ctx, `INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING`, version); err != nil {
			return err
		}
	}

	return nil
}
