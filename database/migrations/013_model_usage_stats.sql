ALTER TABLE models
ADD COLUMN IF NOT EXISTS cached_input_price_per_1m REAL;

ALTER TABLE model_calls
ADD COLUMN IF NOT EXISTS cache_write_input_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE model_calls
ADD COLUMN IF NOT EXISTS reasoning_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE model_calls
ADD COLUMN IF NOT EXISTS total_tokens INTEGER NOT NULL DEFAULT 0;

INSERT INTO schema_migrations (version) VALUES ('013_model_usage_stats')
ON CONFLICT(version) DO NOTHING;
