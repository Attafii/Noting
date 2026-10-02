-- Read-only share links. Only sha256(token) is stored; the plaintext token is
-- shown once at creation and never persisted. Plaintext notes only: the mint
-- query refuses enc = TRUE notes.
CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES access_tokens(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS share_links_note_idx ON share_links (note_id);
CREATE INDEX IF NOT EXISTS share_links_user_idx ON share_links (user_id);
