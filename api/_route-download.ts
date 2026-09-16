import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_auth.js';
import { enforceRateLimit } from './_ratelimit.js';
import { getSql } from '../src/lib/db.js';

function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * Convert a BYTEA column value to a Buffer. Exported for unit testing.
 *
 * The Neon serverless driver returns BYTEA over HTTP as a `\x`-prefixed
 * hex string (not a Buffer like node-postgres). Passing that string straight
 * into `Buffer.from(value)` would download a corrupted file containing the
 * literal hex characters — so both shapes are handled here.
 */
export function byteaToBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') {
    const hex = value.startsWith('\\x') ? value.slice(2) : value;
    if (hex.length > 0 && hex.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(hex)) {
      return Buffer.from(hex, 'hex');
    }
    // Non-hex string (e.g. base64 or escaped bytea) — best-effort fallbacks.
    if (value.startsWith('base64:')) return Buffer.from(value.slice(7), 'base64');
    return Buffer.from(value, 'binary');
  }
  throw new Error('Unsupported BYTEA value type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Header-only auth, like every other endpoint. The UI downloads via authed
  // fetch → blob, so the token stays out of URLs, history, and server logs.
  // Legacy `?token=` query-param auth was removed (now 401s).
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (!(await enforceRateLimit(req, res))) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const id = req.query?.id;
  if (!id || Number.isNaN(parseInt(id as string, 10))) {
    res.status(400).json({ error: 'Missing id query parameter' });
    return;
  }

  const sql = getSql();

  try {
    const rows = await sql.query(
      'SELECT file_name, file_type, file_data, enc FROM documents WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [parseInt(id as string, 10), userId],
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    let buffer: Buffer;
    try {
      buffer = byteaToBuffer(rows[0].file_data);
    } catch (e) {
      console.error('download decode error', e);
      res.status(500).json({ error: 'Could not decode stored file' });
      return;
    }

    const fileName = rows[0].file_name as string;
    const fileType = (rows[0].file_type as string) || 'application/octet-stream';
    const enc = rows[0].enc ? '1' : '0';

    res.setHeader('Content-Type', fileType);
    res.setHeader('Content-Length', buffer.length);
    // Machine-readable metadata for the fetch-based client (RFC 5987 for Unicode).
    res.setHeader('x-file-name', encodeRFC5987(fileName));
    res.setHeader('x-file-type', fileType);
    res.setHeader('x-enc', enc);

    // ASCII-safe filename for basic compatibility
    // eslint-disable-next-line no-control-regex
    const asciiName = fileName.replace(/[^\x00-\x7F]/g, '_');
    // RFC 5987 encoded filename for Unicode support
    const encodedName = encodeRFC5987(fileName);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
    );

    res.status(200).end(buffer);
  } catch (e) {
    console.error('download endpoint error', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}
