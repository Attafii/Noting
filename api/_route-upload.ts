import type { VercelRequest, VercelResponse } from '@vercel/node';
import { resolveAuth } from './_auth.js';
import { enforceRateLimit } from './_ratelimit.js';
import { checkStorageQuota, QuotaError } from './_quota.js';
import { getSql } from '../src/lib/db.js';

// NOTE: `busboy` and `./_index` are deliberately NOT statically imported.
// They load lazily inside the handler so a packaging/import failure in the
// multipart parser or the RAG indexer can only break /api/upload — never the
// shared router bundle (challenge/health/tokens stay up).

const MAX_BYTES = 4.5 * 1024 * 1024;

/**
 * NOTE: `export const config = { api: { bodyParser: false } }` is Next.js
 * API-route syntax and has no effect on native Vercel serverless functions,
 * which already receive the raw request stream. It was removed for that
 * reason — busboy consumes `req` directly below.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await enforceRateLimit(req, res, { limit: 10 }))) return;

  // Multipart gate: busboy needs the raw stream, but auth must still run
  // first. Blind admin → 404 (sees nothing); unauthed → 401.
  const auth = await resolveAuth(req);
  if (auth === null || !('userId' in auth)) {
    if (auth !== null) res.status(404).json({ error: 'Not found' });
    else res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const userId = auth.userId;
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

  interface BusboyLike {
    on(event: 'field', listener: (fieldname: string, value: string) => void): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: 'file', listener: (fieldname: string, file: any, info: any) => void): void;
    on(event: 'finish', listener: () => void): void;
    on(event: 'error', listener: () => void): void;
  }
  let bb: BusboyLike;
  try {
    const mod = (await import('busboy')) as unknown as {
      default?: (opts: unknown) => BusboyLike;
    } & ((opts: unknown) => BusboyLike);
    const ctor = typeof mod.default === 'function' ? mod.default : mod;
    if (typeof ctor !== 'function') throw new Error('busboy export is not a constructor');
    bb = (ctor as (opts: unknown) => BusboyLike)({
      headers: req.headers,
      limits: { files: 1, fileSize: MAX_BYTES },
    });
  } catch (e) {
    console.error('upload parser unavailable', e);
    res.status(500).json({ error: 'Upload unavailable — try again' });
    return;
  }
  let fileBuffer: Buffer | null = null;
  let fileName = '';
  let fileType = '';
  let encrypted = false;
  let replaceId: number | null = null;
  let hasFile = false;
  let responded = false;

  const fail = (status: number, message: string) => {
    if (!responded && !res.headersSent) {
      responded = true;
      res.status(status).json({ error: message });
    }
  };

  bb.on('field', (fieldname, value) => {
    if (fieldname === 'enc' && value === '1') encrypted = true;
    if (fieldname === 'replace_id' && /^\d+$/.test(value)) replaceId = Number(value);
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
      const bytes = fileBuffer;
      await checkStorageQuota(userId, bytes.length);
      const sql = getSql();
      const rows = replaceId
        ? await sql.query(
            `UPDATE documents
             SET file_name = $1, file_type = $2, file_data = $3, enc = $4,
                 content_version = content_version + 1, index_status = 'queued',
                 index_error = NULL, indexed_at = NULL, uploaded_at = NOW()
             WHERE id = $5 AND user_id = $6
             RETURNING id, file_name, file_type, enc, content_version, index_status,
                       index_error, indexed_at, octet_length(file_data) AS file_size, uploaded_at`,
            [fileName, fileType, bytes, encrypted, replaceId, userId],
          )
        : await sql.query(
            `INSERT INTO documents (file_name, file_type, file_data, enc, user_id, index_status)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, file_name, file_type, enc, content_version, index_status,
                       index_error, indexed_at, octet_length(file_data) AS file_size, uploaded_at`,
            [fileName, fileType, bytes, encrypted, userId, encrypted ? 'skipped' : 'queued'],
          );
      if (rows.length === 0) {
        fail(404, replaceId ? 'Document not found' : 'Upload failed');
        return;
      }
      const doc = rows[0] as { id: number };
      await sql.query(
        `INSERT INTO index_jobs (user_id, document_id, status)
         VALUES ($1, $2, $3)`,
        [userId, doc.id, encrypted ? 'skipped' : 'queued'],
      );
      responded = true;
      res.status(200).json(doc);
      void import('./_index.js')
        .then((m) => m.indexDocument(doc.id, fileName, fileType, bytes, encrypted, userId))
        .catch((e) => console.error('indexing error', e));
    } catch (e) {
      if (e instanceof QuotaError) {
        fail(e.status, e.message);
        return;
      }
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

  req.pipe(bb as unknown as NodeJS.WritableStream);
}

/** Strip path components and control characters from client-supplied names. */
function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? 'upload';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1F\x7F]/g, '').trim();
  return cleaned.slice(0, 255) || 'upload';
}
