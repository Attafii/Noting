import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateToken, unauthorizedResponse } from './_auth';
import { sql } from '../src/lib/db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateToken(req)) {
    unauthorizedResponse(res);
    return;
  }

  try {
    if (req.method === 'GET') {
      const rows = await sql.query('SELECT content, updated_at FROM notes WHERE id = 1');
      if (rows.length === 0) {
        await sql.query("INSERT INTO notes (id, content) VALUES (1, '') ON CONFLICT (id) DO NOTHING");
        const newRows = await sql.query('SELECT content, updated_at FROM notes WHERE id = 1');
        res.status(200).json(newRows[0]);
        return;
      }
      res.status(200).json(rows[0]);
      return;
    }

    if (req.method === 'POST') {
      const { content } = req.body as { content: string };
      if (typeof content !== 'string') {
        res.status(400).json({ error: 'content must be string' });
        return;
      }
      const rows = await sql.query(
        'INSERT INTO notes (id, content) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW() RETURNING content, updated_at',
        [content]
      );
      res.status(200).json(rows[0]);
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('note endpoint error', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}
