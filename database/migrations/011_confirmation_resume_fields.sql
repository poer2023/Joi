ALTER TABLE confirmation_requests
ADD COLUMN IF NOT EXISTS call_id TEXT;

ALTER TABLE confirmation_requests
ADD COLUMN IF NOT EXISTS turn_id TEXT;

ALTER TABLE confirmation_requests
ADD COLUMN IF NOT EXISTS approval_scope TEXT NOT NULL DEFAULT 'once';

ALTER TABLE confirmation_requests
ADD COLUMN IF NOT EXISTS approval_key TEXT NOT NULL DEFAULT '';

ALTER TABLE confirmation_requests
ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_confirmation_requests_call_id
ON confirmation_requests(call_id);

UPDATE confirmation_requests
SET approval_scope='once'
WHERE approval_scope IS NULL OR approval_scope='';

UPDATE confirmation_requests
SET approval_key=''
WHERE approval_key IS NULL;

INSERT INTO schema_migrations (version) VALUES ('011_confirmation_resume_fields')
ON CONFLICT (version) DO NOTHING;
