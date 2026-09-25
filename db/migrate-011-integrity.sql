CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE notes ADD COLUMN IF NOT EXISTS content_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE note_revisions ADD COLUMN IF NOT EXISTS source_version BIGINT;
ALTER TABLE note_revisions ADD COLUMN IF NOT EXISTS enc BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE access_tokens ADD COLUMN IF NOT EXISTS recovery_hash TEXT;
ALTER TABLE access_tokens ADD COLUMN IF NOT EXISTS recovery_salt TEXT;
CREATE INDEX IF NOT EXISTS note_revisions_note_version_idx ON note_revisions (note_id, source_version DESC);

CREATE TABLE IF NOT EXISTS note_mutations (
  user_id TEXT NOT NULL REFERENCES access_tokens(id) ON DELETE CASCADE,
  mutation_id TEXT NOT NULL,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  applied_version BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, mutation_id)
);
CREATE INDEX IF NOT EXISTS note_mutations_note_idx ON note_mutations (user_id, note_id, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES access_tokens(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS workspace_ai_usage (
  user_id TEXT NOT NULL REFERENCES access_tokens(id) ON DELETE CASCADE,
  usage_day DATE NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_day)
);

CREATE TABLE IF NOT EXISTS workspace_invites (
  id BIGSERIAL PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS index_status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS index_error TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMP WITH TIME ZONE;
UPDATE documents SET index_status = 'ready' WHERE index_status IS NULL;

CREATE TABLE IF NOT EXISTS index_jobs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES access_tokens(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  leased_until TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS index_jobs_ready_idx ON index_jobs (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS index_jobs_document_idx ON index_jobs (document_id, created_at DESC);

-- Existing uploads have no chunks on databases that predate the RAG tables.
-- Mark them queued and enqueue a job so Ask re-indexes them on first use.
UPDATE documents d
SET index_status = 'queued'
WHERE d.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM document_chunks c WHERE c.document_id = d.id);

INSERT INTO index_jobs (user_id, document_id, status)
SELECT d.user_id, d.id, 'queued'
FROM documents d
WHERE d.deleted_at IS NULL
  AND d.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM document_chunks c WHERE c.document_id = d.id)
  AND NOT EXISTS (
    SELECT 1 FROM index_jobs j WHERE j.document_id = d.id AND j.status IN ('queued', 'running')
  );

CREATE INDEX IF NOT EXISTS notes_content_trgm_idx
  ON notes USING gin (content gin_trgm_ops)
  WHERE enc = FALSE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx
  ON document_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
