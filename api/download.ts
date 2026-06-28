import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateToken, unauthorizedResponse } from './_auth';
import { sql } from '../src/lib/db';

function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(/['()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateToken(req)) {
    unauthorizedResponse(res);
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const id = req.query?.id;
  if (!id || Number.isNaN(parseInt(id as string, 10))) {
    res.status(400).json({ error: 'Missing id query parameter' });
    return;
  }

  try {
    const rows = await sql.query(
      'SELECT file_name, file_type, file_data FROM documents WHERE id = $1',
      [parseInt(id as string, 10)]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const buffer = Buffer.from(rows[0].file_data);
    const fileName = rows[0].file_name as string;
    const fileType = rows[0].file_type as string;

    res.setHeader('Content-Type', fileType);
    res.setHeader('Content-Length', buffer.length);

    // ASCII-safe filename for basic compatibility
    const asciiName = fileName.replace(/[^\x00-\x7F]/g, '_');
    // RFC 5987 encoded filename for Unicode support
    const encodedName = encodeRFC5987(fileName);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`
    );

    res.status(200).end(buffer);
  } catch (e) {
    console.error('download endpoint error', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}