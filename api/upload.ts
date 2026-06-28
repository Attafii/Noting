import type { VercelRequest, VercelResponse } from '@vercel/node';
import busboy from 'busboy';
import { validateToken, unauthorizedResponse } from './_auth';
import { sql } from '../src/lib/db';

export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateToken(req)) {
    unauthorizedResponse(res);
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
  if (contentLength > 4.5 * 1024 * 1024) {
    res.status(413).json({ error: 'File too large. Max 4.5MB.' });
    return;
  }

  const bb = busboy({ headers: req.headers });
  let fileBuffer: Buffer | null = null;
  let fileName = '';
  let fileType = '';
  let byteTally = 0;
  let hasFile = false;

  bb.on('file', (fieldname, file, info) => {
    if (fieldname !== 'file') {
      file.resume();
      return;
    }
    hasFile = true;
    fileName = info.filename;
    fileType = info.mimeType;
    const chunks: Buffer[] = [];

    file.on('data', (data: Buffer) => {
      chunks.push(data);
      byteTally += data.length;
      if (byteTally > 4.5 * 1024 * 1024) {
        file.resume();
        bb.emit('error', new Error('File too large'));
      }
    });

    file.on('end', () => {
      fileBuffer = Buffer.concat(chunks);
    });
  });

  bb.on('finish', async () => {
    if (!hasFile || !fileBuffer) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    if (fileBuffer.length > 4.5 * 1024 * 1024) {
      res.status(413).json({ error: 'File too large. Max 4.5MB.' });
      return;
    }
    try {
      const rows = await sql.query(
        'INSERT INTO documents (file_name, file_type, file_data) VALUES ($1, $2, $3) RETURNING id, file_name, file_type, uploaded_at',
        [fileName, fileType, fileBuffer]
      );
      res.status(200).json(rows[0]);
    } catch (e) {
      console.error('upload error', e);
      res.status(500).json({ error: 'Upload failed' });
    }
  });

  bb.on('error', () => {
    if (!res.headersSent) {
      res.status(413).json({ error: 'File too large. Max 4.5MB.' });
    }
  });

  req.pipe(bb);
}