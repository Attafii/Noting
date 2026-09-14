-- Migration 006: DB-backed rate-limit buckets (single source across instances).
-- Run once: psql $NEON_CONNECTION_STRING -f db/migrate-006.sql
-- Safe to re-run.
--
-- The previous in-memory limiter reset on every serverless cold start.
-- This table holds sliding-window hit timestamps (epoch ms) per client key
-- (token prefix + IP). Rows are pruned on every check; the API fails OPEN
-- when this table is unreachable (personal-tool availability posture).

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    key TEXT PRIMARY KEY,
    hits BIGINT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
