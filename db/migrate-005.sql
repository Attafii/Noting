-- Migration 005: align the notes id sequence with the seeded id=1 row.
-- Run once: psql $NEON_CONNECTION_STRING -f db/migrate-005.sql
-- Safe to re-run.
--
-- Background: the schema seeds notes.id = 1 explicitly, which does not
-- advance the SERIAL sequence — the first auto-id note INSERT then fails
-- with a duplicate-key error. This moves the sequence past MAX(id).
SELECT setval('notes_id_seq', COALESCE((SELECT MAX(id) FROM notes), 1), true);
