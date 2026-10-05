-- Productivity: kanban status, due recurrence, reminder snooze (all metadata —
-- never bump updated_at, mirroring due_at in migrate-012).
ALTER TABLE notes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done'));
ALTER TABLE notes ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly'));
ALTER TABLE notes ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMP WITH TIME ZONE NULL;

CREATE INDEX IF NOT EXISTS notes_status_idx
  ON notes (status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS notes_snoozed_idx
  ON notes (snoozed_until)
  WHERE snoozed_until IS NOT NULL AND deleted_at IS NULL;
