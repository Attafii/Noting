import type { VercelRequest, VercelResponse } from '@vercel/node';
import { hashToken } from './_auth.js';
import { enforceRateLimit } from './_ratelimit.js';
import { getSql } from '../src/lib/db.js';

/**
 * Public, unauthenticated read of one shared note (read-only link).
 *
 * Security:
 * - The URL carries a high-entropy token (192 bits); only sha256(token) is
 *   stored, so a database leak exposes no usable links.
 * - Uniform 404 for unknown / expired / revoked / trashed / encrypted notes —
 *   the response never distinguishes "never existed" from "no longer shared",
 *   so the endpoint can't be used as an existence oracle.
 * - The mint side refuses encrypted notes; the read side re-checks `enc = FALSE`
 *   (defense in depth if a note is later re-saved encrypted).
 * - Strict anon rate scope keeps token-space probing expensive.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!(await enforceRateLimit(req, res, { limit: 30, scope: 'share' }))) return;

  const token = typeof req.query?.t === 'string' ? req.query.t : '';
  const notFound = () => res.status(404).json({ error: 'Not found' });
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    notFound();
    return;
  }

  try {
    const sql = getSql();
    const rows = await sql.query(
      `SELECT n.title, n.content, n.created_at, n.updated_at,
              (SELECT COALESCE(array_agg(t.tag), '{}') FROM note_tags t WHERE t.note_id = n.id) AS tags
       FROM share_links s
       JOIN notes n ON n.id = s.note_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > NOW()
         AND n.deleted_at IS NULL
         AND n.enc = FALSE
         AND n.user_id = s.user_id`,
      [hashToken(token)],
    );
    if (rows.length === 0) {
      notFound();
      return;
    }
    const row = rows[0] as Record<string, unknown>;
    res.status(200).json({
      title: row.title,
      content: row.content,
      created_at: row.created_at,
      updated_at: row.updated_at,
      tags: Array.isArray(row.tags) ? row.tags : [],
    });
  } catch (e) {
    console.error('share endpoint error', e);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
}
