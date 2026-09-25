-- One-time setup: psql $NEON_CONNECTION_STRING -f db/schema.sql
-- NOTE: the upstream extension name is `vector` (not `pgvector`).
-- `CREATE EXTENSION pgvector` throws on Neon even with IF NOT EXISTS.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE notes (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'Untitled',
    content TEXT NOT NULL DEFAULT '',
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    enc BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    file_data BYTEA NOT NULL,
    enc BOOLEAN NOT NULL DEFAULT FALSE,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

CREATE TABLE note_revisions (
    id SERIAL PRIMARY KEY,
    note_id INTEGER NOT NULL DEFAULT 1 REFERENCES notes(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE document_chunks (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1024),
    model TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    key TEXT PRIMARY KEY,
    hits BIGINT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Per-user tokens (migration 009). Plaintext tokens/answers are never stored:
-- only sha256(token), scrypt(answer_normalized, salt), plus user-supplied
-- question/hint/label. hint_grants enforces one hint reveal per session
-- on the server. Purge with:
--   DELETE FROM hint_grants WHERE revealed_at < NOW() - INTERVAL '30 days';
CREATE TABLE IF NOT EXISTS access_tokens (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL DEFAULT '',
    question TEXT NOT NULL,
    answer_hash TEXT NOT NULL,
    answer_salt TEXT NOT NULL,
    hint TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS access_tokens_hash_idx ON access_tokens (token_hash);

CREATE TABLE IF NOT EXISTS hint_grants (
    token_id TEXT NOT NULL REFERENCES access_tokens(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    revealed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (token_id, session_id)
);

-- Per-user scoping for notes / files / folders (legacy rows keep NULL
-- until the owner backfills them once via SQL after self-generating a token).
ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES access_tokens(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES access_tokens(id);

CREATE INDEX IF NOT EXISTS notes_user_idx ON notes (user_id);
CREATE INDEX IF NOT EXISTS documents_user_idx ON documents (user_id);

CREATE TABLE IF NOT EXISTS folders (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  user_id TEXT REFERENCES access_tokens(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE notes ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS note_tags (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);
CREATE INDEX IF NOT EXISTS notes_folder_idx ON notes (folder_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS notes_deleted_idx ON notes (deleted_at);
CREATE INDEX IF NOT EXISTS note_tags_tag_idx ON note_tags (tag);

ALTER TABLE notes ADD COLUMN IF NOT EXISTS content_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE note_revisions ADD COLUMN IF NOT EXISTS source_version BIGINT;
ALTER TABLE note_revisions ADD COLUMN IF NOT EXISTS enc BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE access_tokens ADD COLUMN IF NOT EXISTS recovery_hash TEXT;
ALTER TABLE access_tokens ADD COLUMN IF NOT EXISTS recovery_salt TEXT;

CREATE TABLE IF NOT EXISTS note_mutations (
  user_id TEXT NOT NULL REFERENCES access_tokens(id) ON DELETE CASCADE,
  mutation_id TEXT NOT NULL,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  applied_version BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, mutation_id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES access_tokens(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

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

CREATE INDEX IF NOT EXISTS notes_content_trgm_idx
  ON notes USING gin (content gin_trgm_ops)
  WHERE enc = FALSE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx
  ON document_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
