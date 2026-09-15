import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_auth';
import { enforceRateLimit } from './_ratelimit';
import { getSql } from '../src/lib/db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (!(await enforceRateLimit(req, res))) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const sql = getSql();
    const rawId = req.query?.note_id;
    const noteId =
      typeof rawId === 'string' && !Number.isNaN(parseInt(rawId, 10)) ? parseInt(rawId, 10) : 1;
    // Ownership joins through the parent note: cross-user ids → 404, never 403.
    const owner = await sql
      .query('SELECT id FROM notes WHERE id = $1 AND user_id = $2', [noteId, userId])
      .catch(() => []);
    if (owner.length === 0) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    const rows = await sql.query(
      'SELECT id, content, created_at FROM note_revisions WHERE note_id = $1 ORDER BY id DESC LIMIT 20',
      [noteId],
    );
    res.status(200).json(rows);
  } catch (e) {
    // Missing table (migration not run yet) → empty history, not an error.
    console.error('revisions endpoint error', e);
    res.status(200).json([]);
  }
}
