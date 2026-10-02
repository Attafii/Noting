-- Reminders: per-note due date (metadata only — never bumps updated_at).
ALTER TABLE notes ADD COLUMN IF NOT EXISTS due_at TIMESTAMP WITH TIME ZONE NULL;

CREATE INDEX IF NOT EXISTS notes_due_idx
  ON notes (due_at)
  WHERE due_at IS NOT NULL AND deleted_at IS NULL;
