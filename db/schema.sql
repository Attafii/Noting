-- One-time setup: psql $NEON_CONNECTION_STRING -f db/schema.sql
CREATE EXTENSION IF NOT EXISTS pgvector;

CREATE TABLE secure_bridges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    secret_token VARCHAR(255) UNIQUE NOT NULL
);

CREATE TABLE notes (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    file_data BYTEA NOT NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE note_revisions (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed a single note row for the single-user bridge
INSERT INTO notes (id, content) VALUES (1, '') ON CONFLICT (id) DO NOTHING;
