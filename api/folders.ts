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

  const sql = getSql();

  try {
    await sql
      .query(
        'CREATE TABLE IF NOT EXISTS folders (id SERIAL PRIMARY KEY, name VARCHAR(120) NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, user_id TEXT DEFAULT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP)',
      )
      .catch(() => undefined);

    if (req.method === 'GET') {
      const rows = await sql
        .query(
          'SELECT f.id, f.name, f.sort_order, f.created_at, COUNT(n.id)::int AS note_count ' +
            'FROM folders f LEFT JOIN notes n ON n.folder_id = f.id AND n.deleted_at IS NULL ' +
            'GROUP BY f.id ORDER BY f.sort_order ASC, f.name ASC',
        )
        .catch(() => []);
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
        'INSERT INTO folders (name) VALUES ($1) RETURNING id, name, sort_order, created_at',
        [clean],
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
        'UPDATE folders SET name = COALESCE($2, name), sort_order = COALESCE($3, sort_order) WHERE id = $1 RETURNING id, name, sort_order, created_at',
        [
          id,
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
      const id = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'Missing id query parameter' });
        return;
      }
      // Notes survive — they become unfiled (FK is ON DELETE SET NULL where migrated).
      await sql
        .query('UPDATE notes SET folder_id = NULL WHERE folder_id = $1', [id])
        .catch(() => undefined);
      const rows = await sql.query('DELETE FROM folders WHERE id = $1 RETURNING id', [id]);
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
