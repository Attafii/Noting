-- One-time setup: psql $NEON_CONNECTION_STRING -f db/schema.sql
CREATE EXTENSION IF NOT EXISTS pgvector;

CREATE TABLE secure_bridges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    secret_token VARCHAR(255) UNIQUE NOT NULL
);

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

-- Seed a single note row for the single-user bridge
INSERT INTO notes (id, title, content) VALUES (1, 'Scratchpad', '') ON CONFLICT (id) DO NOTHING;
-- Explicit seed ids don't advance SERIAL sequences — align it for new rows.
SELECT setval('notes_id_seq', COALESCE((SELECT MAX(id) FROM notes), 1), true);

-- Seed a single note row for the single-user bridge
INSERT INTO notes (id, content) VALUES (1, '') ON CONFLICT (id) DO NOTHING;
