import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateToken, unauthorizedResponse } from './_auth';
import { enforceRateLimit } from './_ratelimit';
import { getSql } from '../src/lib/db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateToken(req)) {
    unauthorizedResponse(res);
    return;
  }
  if (!enforceRateLimit(req, res)) return;

  const sql = getSql();

  if (req.method === 'GET') {
    try {
      const rows = await sql.query(
        'SELECT id, file_name, file_type, octet_length(file_data) AS file_size, uploaded_at FROM documents ORDER BY uploaded_at DESC',
      );
      res.status(200).json(rows);
    } catch (e) {
      console.error('documents endpoint error', e);
      res.status(500).json({ error: 'Internal server error' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    const id = req.query?.id;
    const parsed = typeof id === 'string' ? parseInt(id, 10) : NaN;
    if (!id || Number.isNaN(parsed)) {
      res.status(400).json({ error: 'Missing id query parameter' });
      return;
    }
    try {
      const rows = await sql.query('DELETE FROM documents WHERE id = $1 RETURNING id', [parsed]);
      if (rows.length === 0) {
        res.status(404).json({ error: 'Document not found' });
        return;
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
