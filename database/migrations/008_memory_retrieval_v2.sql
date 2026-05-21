ALTER TABLE memories
ADD COLUMN IF NOT EXISTS search_vector tsvector
GENERATED ALWAYS AS (
  to_tsvector('simple', coalesce(content, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(type, ''))
) STORED;

CREATE INDEX IF NOT EXISTS idx_memories_search_vector
ON memories USING GIN(search_vector);

INSERT INTO schema_migrations (version) VALUES ('008_memory_retrieval_v2')
ON CONFLICT (version) DO NOTHING;
