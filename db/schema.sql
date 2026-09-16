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

-- Seed a single note row for the single-user bridge
INSERT INTO notes (id, title, content) VALUES (1, 'Scratchpad', '') ON CONFLICT (id) DO NOTHING;
-- Explicit seed ids don't advance SERIAL sequences — align it for new rows.
SELECT setval('notes_id_seq', COALESCE((SELECT MAX(id) FROM notes), 1), true);
