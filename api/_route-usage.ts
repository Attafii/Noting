import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_auth.js';
import { enforceRateLimit } from './_ratelimit.js';
import { getSql } from '../src/lib/db.js';

/**
 * Storage usage for the Settings page and future Free/Paid caps.
 * Read-only aggregate scoped to the caller — no PII, no content,
 * no cross-user totals.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (!(await enforceRateLimit(req, res))) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const sql = getSql();
  try {
    const notes = await sql
      .query(
        'SELECT COUNT(*)::int AS count, COALESCE(SUM(octet_length(content)), 0)::int AS bytes FROM notes WHERE user_id = $1 AND deleted_at IS NULL',
        [userId],
      )
      .catch(() => [{ count: 0, bytes: 0 }]);
    const trashedNotes = await sql
      .query('SELECT COUNT(*)::int AS count FROM notes WHERE user_id = $1 AND deleted_at IS NOT NULL', [
        userId,
      ])
      .catch(() => [{ count: 0 }]);
    const files = await sql
      .query(
        'SELECT COUNT(*)::int AS count, COALESCE(SUM(octet_length(file_data)), 0)::int AS bytes FROM documents WHERE user_id = $1 AND deleted_at IS NULL',
        [userId],
      )
      .catch(() => [{ count: 0, bytes: 0 }]);
    const trashedFiles = await sql
      .query('SELECT COUNT(*)::int AS count FROM documents WHERE user_id = $1 AND deleted_at IS NOT NULL', [
        userId,
      ])
      .catch(() => [{ count: 0 }]);
    res.status(200).json({
      notes: { count: notes[0].count, bytes: Number(notes[0].bytes) },
      trashedNotes: { count: trashedNotes[0].count },
      files: { count: files[0].count, bytes: Number(files[0].bytes) },
      trashedFiles: { count: trashedFiles[0].count },
    });
  } catch (e) {
    console.error('usage endpoint error', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}
