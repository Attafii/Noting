import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_auth.js';
import { enforceRateLimit } from './_ratelimit.js';
import { getSql } from '../src/lib/db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (!(await enforceRateLimit(req, res))) return;

  const sql = getSql();

  try {
    if (req.method === 'GET') {
      const rows = await sql.query(
        'SELECT f.id, f.name, f.sort_order, f.created_at, COUNT(n.id)::int AS note_count ' +
          'FROM folders f LEFT JOIN notes n ON n.folder_id = f.id AND n.deleted_at IS NULL AND n.user_id = $1 ' +
          'WHERE f.user_id = $1 GROUP BY f.id ORDER BY f.sort_order ASC, f.name ASC',
        [userId],
      );
      res.status(200).json(rows);
      return;
    }

    if (req.method === 'POST') {
      const { name } = (req.body ?? {}) as { name?: string };
      const clean = typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : null;
      if (!clean) {
        res.status(400).json({ error: 'name must be a non-empty string' });
        return;
      }
      const rows = await sql.query(
        'INSERT INTO folders (name, user_id) VALUES ($1, $2) RETURNING id, name, sort_order, created_at',
        [clean, userId],
      );
      res.status(201).json({ ...rows[0], note_count: 0 });
      return;
    }

    if (req.method === 'PATCH') {
      const { id, name, sort_order } = (req.body ?? {}) as {
        id?: number;
        name?: string;
        sort_order?: number;
      };
      if (typeof id !== 'number' || !Number.isInteger(id)) {
        res.status(400).json({ error: 'id must be an integer' });
        return;
      }
      const rows = await sql.query(
        'UPDATE folders SET name = COALESCE($3, name), sort_order = COALESCE($4, sort_order) WHERE id = $1 AND user_id = $2 RETURNING id, name, sort_order, created_at',
        [
          id,
          userId,
          typeof name === 'string' ? name.trim().slice(0, 120) || null : null,
          typeof sort_order === 'number' && Number.isFinite(sort_order)
            ? Math.trunc(sort_order)
            : null,
        ],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: 'Folder not found' });
        return;
      }
      res.status(200).json(rows[0]);
      return;
    }

    if (req.method === 'DELETE') {
      const raw = req.query?.id;
      const id = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isSafeInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Missing id query parameter' });
        return;
      }
      // Notes survive — they become unfiled (FK is ON DELETE SET NULL where migrated).
      await sql.query('UPDATE notes SET folder_id = NULL WHERE folder_id = $1 AND user_id = $2', [
        id,
        userId,
      ]);
      const rows = await sql.query(
        'DELETE FROM folders WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: 'Folder not found' });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('folders endpoint error', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}
