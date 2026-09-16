import type { VercelRequest, VercelResponse } from '@vercel/node';
import { hashToken, isValidSessionId } from './_auth';
import { enforceRateLimit } from './_ratelimit';
import { getSql } from '../src/lib/db';

/**
 * Answer recovery (unauthenticated, rate-limited, token-gated): returns the
 * user-supplied hint text ONCE per (token, session_id) — enforced on the
 * server via hint_grants PK. A second reveal in the same session → 409.
 * Empty-hint users get { hint: '' } and still consume the grant (no probing).
 * Unknown tokens → generic 404.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!(await enforceRateLimit(req, res, { limit: 10 }))) return;

  const { token, session_id } = (req.body ?? {}) as { token?: unknown; session_id?: unknown };
  if (typeof token !== 'string' || token.length === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (!isValidSessionId(session_id)) {
    res.status(400).json({ error: 'session_id must be 16–64 chars [A-Za-z0-9_-]' });
    return;
  }

  let sql: ReturnType<typeof getSql>;
  try {
    sql = getSql();
  } catch (e) {
    // Same DB-unavailable contract as the other public token routes.
    console.error('hint: database unavailable (NEON_CONNECTION_STRING)', e);
    res.status(503).json({ error: 'Database unavailable — try again in a moment' });
    return;
  }

  try {
    const rows = await sql.query('SELECT id, hint FROM access_tokens WHERE token_hash = $1', [
      hashToken(token),
    ]);
    if (rows.length === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const row = rows[0] as { id: string; hint: string };

    // Best-effort purge of stale grants (30-day window).
    await sql
      .query("DELETE FROM hint_grants WHERE revealed_at < NOW() - INTERVAL '30 days'")
      .catch(() => undefined);

    const inserted = await sql.query(
      'INSERT INTO hint_grants (token_id, session_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING token_id',
      [row.id, session_id],
    );
    if (inserted.length === 0) {
      res.status(409).json({ error: 'Hint already shown this session' });
      return;
    }
    res.status(200).json({ hint: row.hint ?? '' });
  } catch (e) {
    console.error('hint error', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}
