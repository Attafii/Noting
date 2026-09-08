-- Migration 004: OpenRouter embedding space (mistral-embed, 1024 dims)
-- Run once: psql $NEON_CONNECTION_STRING -f db/migrate-004.sql
-- Safe to re-run.
--
-- Vectors from the previous provider (nvidia/embed-qa-4) live in a different
-- semantic space and are NOT comparable to the new ones — even though the
-- dimension matches, mixing them would silently corrupt retrieval. Stale
-- chunks are therefore dropped; re-upload files to re-index them.
-- The new `model` column pins every chunk to its embedding model so future
-- swaps can filter (not mix) vector spaces.

ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT '';
DELETE FROM document_chunks;
