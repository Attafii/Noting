import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateToken, unauthorizedResponse } from './_auth';
import { enforceRateLimit } from './_ratelimit';
import { getSql } from '../src/lib/db';

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
  // Support token from header OR query param (for legacy <a href> downloads).
  // The UI downloads via authed fetch → blob, so the token stays out of URLs.
  const queryToken = req.query?.token;
  if (!validateToken(req) && queryToken !== process.env.GLOBAL_SECRET_TOKEN) {
    unauthorizedResponse(res);
    return;
  }
  if (!enforceRateLimit(req, res)) return;

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
      'SELECT file_name, file_type, file_data FROM documents WHERE id = $1',
      [parseInt(id as string, 10)],
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

    res.setHeader('Content-Type', fileType);
    res.setHeader('Content-Length', buffer.length);

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
