-- Migration 001: note revision history
-- Run once: psql $NEON_CONNECTION_STRING -f db/migrate-001.sql
-- Safe to re-run (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS note_revisions (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
