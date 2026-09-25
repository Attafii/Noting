-- Migration 003: RAG document chunks (pgvector)
-- Run once: psql $NEON_CONNECTION_STRING -f db/migrate-003.sql
-- Safe to re-run. Requires the pgvector extension (enabled in schema.sql).
-- Embeddings come from nvidia/embed-qa-4 → native 1024 dimensions.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_chunks (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1024),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);
