import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateToken, unauthorizedResponse } from './_auth';
import { enforceRateLimit } from './_ratelimit';
import { getSql } from '../src/lib/db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateToken(req)) {
    unauthorizedResponse(res);
    return;
  }
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
