import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_auth';
import { enforceRateLimit } from './_ratelimit';
import { getSql } from '../src/lib/db';

const ACTIVE_COLUMNS =
  'id, file_name, file_type, enc, octet_length(file_data) AS file_size, uploaded_at';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (!(await enforceRateLimit(req, res))) return;

  const sql = getSql();

  // Trash view: trashed docs + lazy purge of anything older than 30 days.
  if (req.method === 'GET' && req.query?.trash === '1') {
    try {
      await sql.query(
        "DELETE FROM documents WHERE user_id = $1 AND deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days'",
        [userId],
      );
      const rows = await sql.query(
        `SELECT ${ACTIVE_COLUMNS}, deleted_at FROM documents WHERE user_id = $1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
        [userId],
      );
      res.status(200).json(rows);
    } catch (e) {
      console.error('documents trash error', e);
      res.status(500).json({ error: 'Internal server error' });
    }
    return;
  }

  if (req.method === 'GET') {
    try {
      const rows = await sql.query(
        `SELECT ${ACTIVE_COLUMNS} FROM documents WHERE user_id = $1 AND deleted_at IS NULL ORDER BY uploaded_at DESC`,
        [userId],
      );
      res.status(200).json(rows);
    } catch (e) {
      console.error('documents endpoint error', e);
      res.status(500).json({ error: 'Internal server error' });
    }
    return;
  }

  if (req.method === 'POST') {
    // Restore action: { id, action: 'restore' }.
    const { id, action } = (req.body ?? {}) as { id?: number; action?: string };
    if (action !== 'restore' || typeof id !== 'number' || !Number.isInteger(id)) {
      res.status(400).json({ error: 'Expected { id, action: "restore" }' });
      return;
    }
    try {
      const rows = await sql.query(
        'UPDATE documents SET deleted_at = NULL WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL RETURNING id',
        [id, userId],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: 'Document not found in trash' });
        return;
      }
      res.status(200).json({ ok: true });
    } catch (e) {
      console.error('documents restore error', e);
      res.status(500).json({ error: 'Internal server error' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    const id = parseId(req.query?.id);
    if (id === null) {
      res.status(400).json({ error: 'Missing id query parameter' });
      return;
    }
    try {
      if (req.query?.permanent === '1') {
        // Hard delete; chunks cascade via FK.
        const rows = await sql.query(
          'DELETE FROM documents WHERE id = $1 AND user_id = $2 RETURNING id',
          [id, userId],
        );
        if (rows.length === 0) {
          res.status(404).json({ error: 'Document not found' });
          return;
        }
      } else {
        const rows = await sql.query(
          'UPDATE documents SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id',
          [id, userId],
        );
        if (rows.length === 0) {
          res.status(404).json({ error: 'Document not found' });
          return;
        }
      }
      res.status(200).json({ ok: true });
    } catch (e) {
      console.error('documents delete error', e);
      res.status(500).json({ error: 'Internal server error' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

function parseId(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}
