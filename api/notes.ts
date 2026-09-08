import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateToken, unauthorizedResponse } from './_auth';
import { enforceRateLimit } from './_ratelimit';
import { getSql } from '../src/lib/db';

const LIST_COLUMNS =
  'id, title, pinned, archived, enc, updated_at, created_at, LEFT(content, 160) AS preview';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateToken(req)) {
    unauthorizedResponse(res);
    return;
  }
  if (!enforceRateLimit(req, res)) return;

  const sql = getSql();

  try {
    if (req.method === 'GET') {
      const rows = await sql.query(
        `SELECT ${LIST_COLUMNS} FROM notes ORDER BY pinned DESC, updated_at DESC`,
      );
      res.status(200).json(rows);
      return;
    }

    if (req.method === 'POST') {
      const { title } = (req.body ?? {}) as { title?: string };
      const clean =
        typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'Untitled';
      const rows = await sql.query(
        `INSERT INTO notes (title, content) VALUES ($1, '') RETURNING id, title, content, pinned, archived, enc, updated_at, created_at`,
        [clean],
      );
      res.status(201).json(rows[0]);
      return;
    }

    if (req.method === 'PATCH') {
      const { id, title, pinned, archived } = (req.body ?? {}) as {
        id?: number;
        title?: string;
        pinned?: boolean;
        archived?: boolean;
      };
      if (typeof id !== 'number' || !Number.isInteger(id)) {
        res.status(400).json({ error: 'id must be an integer' });
        return;
      }
      const rows = await sql.query(
        `UPDATE notes SET
           title = COALESCE($2, title),
           pinned = COALESCE($3, pinned),
           archived = COALESCE($4, archived),
           updated_at = NOW()
         WHERE id = $1
         RETURNING id, title, content, pinned, archived, enc, updated_at, created_at`,
        [
          id,
          typeof title === 'string' ? title.trim().slice(0, 120) || null : null,
          typeof pinned === 'boolean' ? pinned : null,
          typeof archived === 'boolean' ? archived : null,
        ],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      res.status(200).json(rows[0]);
      return;
    }

    if (req.method === 'DELETE') {
      const id = parseId(req.query?.id);
      if (id === null) {
        res.status(400).json({ error: 'Missing id query parameter' });
        return;
      }
      const count = await sql.query('SELECT COUNT(*)::int AS n FROM notes');
      if (count[0].n <= 1) {
        res.status(400).json({ error: 'Cannot delete the last note' });
        return;
      }
      // Revisions and future dependents cascade via FK.
      const rows = await sql.query('DELETE FROM notes WHERE id = $1 RETURNING id', [id]);
      if (rows.length === 0) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('notes endpoint error', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function parseId(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}
