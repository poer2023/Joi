package backup

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Manager struct {
	AppDir     string
	SQLitePath string
	ConfigDir  string
	PromptsDir string
	BackupDir  string
	Now        func() time.Time
}

type Manifest struct {
	Version       string   `json:"version"`
	CreatedAt     string   `json:"created_at"`
	Includes      []string `json:"includes"`
	SecretsPolicy string   `json:"secrets_policy"`
}

func (m Manager) CreateManualBackup(ctx context.Context) (string, error) {
	_ = ctx
	now := time.Now
	if m.Now != nil {
		now = m.Now
	}
	backupDir := m.BackupDir
	if backupDir == "" {
		backupDir = filepath.Join(m.AppDir, "backups")
	}
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(backupDir, "joi-backup-"+now().Format("20060102-150405")+".joibak")
	file, err := os.Create(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	zw := zip.NewWriter(file)
	defer zw.Close()

	manifest := Manifest{Version: "1", CreatedAt: now().UTC().Format(time.RFC3339), SecretsPolicy: "secrets are intentionally excluded; reconfigure MODEL_API_KEY, TELEGRAM_BOT_TOKEN, WORKER_TOKEN, NODE_SECRET after restore"}
	if m.SQLitePath != "" {
		if err := addFile(zw, m.SQLitePath, "sqlite/joi.db"); err == nil {
			manifest.Includes = append(manifest.Includes, "sqlite/joi.db")
		}
		for _, suffix := range []string{"-wal", "-shm"} {
			if err := addFile(zw, m.SQLitePath+suffix, "sqlite/joi.db"+suffix); err == nil {
				manifest.Includes = append(manifest.Includes, "sqlite/joi.db"+suffix)
			}
		}
	}
	for _, dir := range []struct {
		path   string
		prefix string
	}{
		{m.ConfigDir, "configs"},
		{m.PromptsDir, "prompts"},
	} {
		if dir.path != "" {
			includes, err := addDir(zw, dir.path, dir.prefix)
			if err != nil {
				return "", err
			}
			manifest.Includes = append(manifest.Includes, includes...)
		}
	}
	raw, _ := json.MarshalIndent(manifest, "", "  ")
	writer, err := zw.Create("manifest.json")
	if err != nil {
		return "", err
	}
	if _, err := writer.Write(raw); err != nil {
		return "", err
	}
	return path, nil
}

func (m Manager) Restore(ctx context.Context, backupPath string) error {
	_ = ctx
	if strings.TrimSpace(backupPath) == "" {
		return errors.New("backup path is required")
	}
	reader, err := zip.OpenReader(backupPath)
	if err != nil {
		return err
	}
	defer reader.Close()

	appDir := m.AppDir
	if appDir == "" && m.SQLitePath != "" {
		appDir = filepath.Dir(m.SQLitePath)
	}
	if appDir == "" {
		return errors.New("restore requires app dir or sqlite path")
	}
	if err := os.MkdirAll(appDir, 0o700); err != nil {
		return err
	}
	for _, file := range reader.File {
		if file.FileInfo().IsDir() || strings.Contains(strings.ToLower(file.Name), "secret") || strings.HasSuffix(strings.ToLower(file.Name), ".env") {
			continue
		}
		target, ok := restoreTarget(appDir, m.ConfigDir, m.PromptsDir, m.SQLitePath, file.Name)
		if !ok {
			continue
		}
		if err := extractZipFile(file, target); err != nil {
			return err
		}
	}
	return nil
}

func (m Manager) StartDailyScheduler(ctx context.Context, run func(string, error)) {
	ticker := time.NewTicker(24 * time.Hour)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				path, err := m.CreateManualBackup(ctx)
				if run != nil {
					run(path, err)
				}
			}
		}
	}()
}

func addDir(zw *zip.Writer, dir string, prefix string) ([]string, error) {
	includes := []string{}
	if _, err := os.Stat(dir); err != nil {
		return includes, nil
	}
	err := filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		name := strings.ToLower(entry.Name())
		if strings.Contains(name, "secret") || strings.HasSuffix(name, ".env") || strings.Contains(name, "local.env") {
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		archivePath := filepath.ToSlash(filepath.Join(prefix, rel))
		if err := addFile(zw, path, archivePath); err != nil {
			return err
		}
		includes = append(includes, archivePath)
		return nil
	})
	return includes, err
}

func addFile(zw *zip.Writer, source string, archivePath string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	info, err := input.Stat()
	if err != nil {
		return err
	}
	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return err
	}
	header.Name = filepath.ToSlash(archivePath)
	header.Method = zip.Deflate
	writer, err := zw.CreateHeader(header)
	if err != nil {
		return err
	}
	_, err = io.Copy(writer, input)
	return err
}

func restoreTarget(appDir string, configDir string, promptsDir string, sqlitePath string, name string) (string, bool) {
	clean := filepath.Clean(name)
	if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return "", false
	}
	switch {
	case clean == "sqlite/joi.db":
		if sqlitePath == "" {
			return filepath.Join(appDir, "joi.db"), true
		}
		return sqlitePath, true
	case strings.HasPrefix(clean, "sqlite/joi.db-"):
		base := filepath.Join(appDir, strings.TrimPrefix(clean, "sqlite/"))
		if sqlitePath != "" {
			base = sqlitePath + strings.TrimPrefix(clean, "sqlite/joi.db")
		}
		return base, true
	case strings.HasPrefix(clean, "configs/") && configDir != "":
		return filepath.Join(configDir, strings.TrimPrefix(clean, "configs/")), true
	case strings.HasPrefix(clean, "prompts/") && promptsDir != "":
		return filepath.Join(promptsDir, strings.TrimPrefix(clean, "prompts/")), true
	default:
		return "", false
	}
}

func extractZipFile(file *zip.File, target string) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	reader, err := file.Open()
	if err != nil {
		return err
	}
	defer reader.Close()
	output, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer output.Close()
	_, err = io.Copy(output, reader)
	return err
}
