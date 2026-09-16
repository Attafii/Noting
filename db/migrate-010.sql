-- Migration 010: fix vector extension name + keyword-search fallback
-- Run once: psql $NEON_CONNECTION_STRING -f db/migrate-010.sql
-- Safe to re-run. Fixes schema.sql using the wrong extension name
-- (`pgvector` instead of upstream `vector`), which left Ask broken with
-- "Document search is not set up in this database".

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS document_chunks (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1024),
    model TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding vector(1024);
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);
-- Trigram index powers the keyword fallback when embeddings are unavailable.
CREATE INDEX IF NOT EXISTS idx_document_chunks_content_trgm ON document_chunks USING gin (content gin_trgm_ops);
