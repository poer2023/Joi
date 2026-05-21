CREATE TABLE IF NOT EXISTS confirmation_requests (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  capability_id TEXT REFERENCES capabilities(id),
  requested_action TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_by TEXT,
  rejected_by TEXT,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_confirmation_requests_status
ON confirmation_requests(status, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('007_confirmation_requests')
ON CONFLICT (version) DO NOTHING;
