-- Migration 009: per-user tokens + self-service Q&A + one-time hint.
-- Run once: node scripts/migrate.cjs db/migrate-009.sql
-- Safe to re-run (every statement is IF NOT EXISTS / guarded).
--
-- Privacy model:
-- - Plaintext tokens and answers are NEVER stored. Only sha256(token),
--   scrypt(answer_normalized, salt), and user-supplied question/hint/label.
-- - No email, no IP/UA logs, no cross-user listing. Admin (GLOBAL_SECRET_TOKEN)
--   is blind: no endpoint lists or mints tokens for it.
-- - Answer normalization is trim().toLowerCase() (documented in api/_auth.ts).
--   This avoids "Hello" vs "hello" lockouts.
-- - hint_grants.session_id is a client-generated random nonce per page load
--   (NOT a fingerprint). Server stores only (token_id, session_id) to enforce
--   "one hint reveal per session" on the server. Purge old rows periodically.

CREATE TABLE IF NOT EXISTS access_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  question TEXT NOT NULL,
  answer_hash TEXT NOT NULL,
  answer_salt TEXT NOT NULL,
  hint TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS access_tokens_hash_idx ON access_tokens (token_hash);

CREATE TABLE IF NOT EXISTS hint_grants (
  token_id TEXT NOT NULL REFERENCES access_tokens(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  revealed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (token_id, session_id)
);

ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES access_tokens(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES access_tokens(id);
ALTER TABLE folders ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES access_tokens(id);

CREATE INDEX IF NOT EXISTS notes_user_idx ON notes (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_user_idx ON documents (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS folders_user_idx ON folders (user_id);

-- Periodic purge for single-use hint grants (run via cron or on hint reads):
-- DELETE FROM hint_grants WHERE revealed_at < NOW() - INTERVAL '30 days';
