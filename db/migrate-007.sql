-- Migration 007: drop the empty `secure_bridges` scaffold.
-- Run once: psql $NEON_CONNECTION_STRING -f db/migrate-007.sql
-- Safe to re-run.
--
-- Auth is env-token based (`GLOBAL_SECRET_TOKEN` vs `x-bridge-token` header);
-- no code ever queried this table, so dropping is safe.
DROP TABLE IF EXISTS secure_bridges;
