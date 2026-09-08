-- Migration 002: multi-note workspace + trash + encryption markers
-- Run once: psql $NEON_CONNECTION_STRING -f db/migrate-002.sql
-- Safe to re-run (IF NOT EXISTS guards).

-- Multi-note columns on notes (existing id=1 row becomes the "Scratchpad").
ALTER TABLE notes ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT 'Untitled';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS enc BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

UPDATE notes SET title = 'Scratchpad', created_at = updated_at
WHERE id = 1 AND title = 'Untitled';

-- Scope revisions to a note.
ALTER TABLE note_revisions ADD COLUMN IF NOT EXISTS note_id INTEGER NOT NULL DEFAULT 1 REFERENCES notes(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_note_revisions_note_id ON note_revisions(note_id);

-- Soft-delete + encryption marker on documents.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS enc BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON documents(deleted_at);
