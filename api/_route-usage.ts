import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_auth.js';
import { enforceRateLimit } from './_ratelimit.js';
import { getSql } from '../src/lib/db.js';

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
    const [notes, trashedNotes, files, trashedFiles] = await Promise.all([
      sql.query(
        'SELECT COUNT(*)::int AS count, COALESCE(SUM(octet_length(content)), 0)::bigint AS bytes FROM notes WHERE user_id = $1 AND deleted_at IS NULL',
        [userId],
      ),
      sql.query(
        'SELECT COUNT(*)::int AS count FROM notes WHERE user_id = $1 AND deleted_at IS NOT NULL',
        [userId],
      ),
      sql.query(
        'SELECT COUNT(*)::int AS count, COALESCE(SUM(octet_length(file_data)), 0)::bigint AS bytes FROM documents WHERE user_id = $1 AND deleted_at IS NULL',
        [userId],
      ),
      sql.query(
        'SELECT COUNT(*)::int AS count FROM documents WHERE user_id = $1 AND deleted_at IS NOT NULL',
        [userId],
      ),
    ]);
    res.status(200).json({
      notes: { count: notes[0].count, bytes: Number(notes[0].bytes) },
      trashedNotes: { count: trashedNotes[0].count },
      files: { count: files[0].count, bytes: Number(files[0].bytes) },
      trashedFiles: { count: trashedFiles[0].count },
    });
  } catch (error) {
    console.error('usage endpoint error', error);
    res.status(503).json({ error: 'Usage is temporarily unavailable' });
  }
}
