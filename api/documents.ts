import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateToken, unauthorizedResponse } from './_auth';
import { sql } from '../src/lib/db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateToken(req)) {
    unauthorizedResponse(res);
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const rows = await sql.query(
      'SELECT id, file_name, file_type, uploaded_at FROM documents ORDER BY uploaded_at DESC'
    );
    res.status(200).json(rows);
  } catch (e) {
    console.error('documents endpoint error', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}
