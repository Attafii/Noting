import type { VercelRequest, VercelResponse } from '@vercel/node';
import busboy from 'busboy';
import { validateToken, unauthorizedResponse } from './_auth';
import { enforceRateLimit } from './_ratelimit';
import { indexDocument } from './_index';
import { getSql } from '../src/lib/db';

const MAX_BYTES = 4.5 * 1024 * 1024;

/**
 * NOTE: `export const config = { api: { bodyParser: false } }` is Next.js
 * API-route syntax and has no effect on native Vercel serverless functions,
 * which already receive the raw request stream. It was removed for that
 * reason — busboy consumes `req` directly below.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateToken(req)) {
    unauthorizedResponse(res);
    return;
  }
  if (!(await enforceRateLimit(req, res, { limit: 30 }))) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
  if (contentLength > MAX_BYTES) {
    res.status(413).json({ error: 'File too large. Max 4.5MB.' });
    return;
  }

  const bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_BYTES } });
  let fileBuffer: Buffer | null = null;
  let fileName = '';
  let fileType = '';
  let encrypted = false;
  let hasFile = false;
  let responded = false;

  const fail = (status: number, message: string) => {
    if (!responded && !res.headersSent) {
      responded = true;
      res.status(status).json({ error: message });
    }
  };

  bb.on('field', (fieldname, value) => {
    // Client-side E2E encryption marker: the stored bytes are ciphertext.
    if (fieldname === 'enc' && value === '1') encrypted = true;
  });

  bb.on('file', (fieldname, file, info) => {
    if (fieldname !== 'file') {
      file.resume();
      return;
    }
    hasFile = true;
    fileName = sanitizeFileName(info.filename || 'upload');
    fileType = info.mimeType || 'application/octet-stream';
    const chunks: Buffer[] = [];

    file.on('data', (data: Buffer) => {
      chunks.push(data);
    });

    file.on('limit', () => {
      file.resume();
      fail(413, 'File too large. Max 4.5MB.');
    });

    file.on('end', () => {
      if (!file.truncated) {
        fileBuffer = Buffer.concat(chunks);
      }
    });
  });

  bb.on('finish', async () => {
    if (responded) return;
    if (!hasFile || !fileBuffer || fileBuffer.length === 0) {
      fail(400, 'No file uploaded');
      return;
    }
    if (fileBuffer.length > MAX_BYTES) {
      fail(413, 'File too large. Max 4.5MB.');
      return;
    }
    try {
      const sql = getSql();
      const rows = await sql.query(
        'INSERT INTO documents (file_name, file_type, file_data, enc) VALUES ($1, $2, $3, $4) RETURNING id, file_name, file_type, enc, octet_length(file_data) AS file_size, uploaded_at',
        [fileName, fileType, fileBuffer, encrypted],
      );
      responded = true;
      const doc = rows[0];
      res.status(200).json(doc);
      // RAG indexing is best-effort and runs after the response so uploads
      // stay fast; it no-ops for encrypted or non-text files.
      const docId = doc.id as number;
      void indexDocument(docId, fileName, fileType, fileBuffer, encrypted).catch((e) =>
        console.error('indexing error', e),
      );
    } catch (e) {
      console.error('upload error', e);
      fail(500, 'Upload failed');
    }
  });

  bb.on('error', () => {
    fail(413, 'File too large. Max 4.5MB.');
  });

  req.on('aborted', () => {
    responded = true;
  });

  req.pipe(bb);
}

/** Strip path components and control characters from client-supplied names. */
function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? 'upload';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1F\x7F]/g, '').trim();
  return cleaned.slice(0, 255) || 'upload';
}
