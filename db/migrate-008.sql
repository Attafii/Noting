-- Migration 008: P0 organization — folders, favorites, note trash, tags,
-- manual ordering, SaaS prep columns, and trigram search indexes.
-- Run once: psql $NEON_CONNECTION_STRING -f db/migrate-008.sql
-- Safe to re-run (every statement is IF NOT EXISTS / guarded).

-- SaaS-ready text search (server side only indexes plaintext; E2E
-- ciphertext rows are excluded via partial-index predicates).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS folders (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    user_id TEXT DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE notes ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id TEXT DEFAULT NULL;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id TEXT DEFAULT NULL;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS user_id TEXT DEFAULT NULL;

-- Normalized tags (client derives #tags from text; PATCH replaces the set).
CREATE TABLE IF NOT EXISTS note_tags (
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (note_id, tag)
);

-- Trigram indexes for global search (plaintext rows only — enc rows excluded).
CREATE INDEX IF NOT EXISTS notes_title_trgm_idx ON notes USING gin (title gin_trgm_ops) WHERE enc = FALSE AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS folders_name_idx ON folders (sort_order, name);
CREATE INDEX IF NOT EXISTS notes_folder_idx ON notes (folder_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS notes_deleted_idx ON notes (deleted_at);
CREATE INDEX IF NOT EXISTS note_tags_tag_idx ON note_tags (tag);
