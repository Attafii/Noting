import type { VercelRequest, VercelResponse } from '@vercel/node';
import { hashToken, isValidSessionId } from './_auth';
import { enforceRateLimit } from './_ratelimit';
import { isColdStartError, withQueryTimeout } from './_timeout';
import { getSql } from '../src/lib/db';

/**
 * Step 1 of login (unauthenticated, rate-limited): given a token, return its
 * security question so the client can prompt for the answer. Also reports
 * whether a hint is still available for this client session (no grant yet).
 * Unknown tokens get a generic 404 with a constant message (no enumeration
 * oracle beyond the status itself).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!(await enforceRateLimit(req, res, { limit: 20 }))) return;

  const { token, session_id } = (req.body ?? {}) as { token?: unknown; session_id?: unknown };
  if (typeof token !== 'string' || token.length === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  let sql: ReturnType<typeof getSql>;
  try {
    sql = getSql();
  } catch (e) {
    // Same DB-unavailable contract as POST /api/tokens: a missing/dead
    // NEON_CONNECTION_STRING surfaces as 503 (config outage), never as a
    // generic 500 that looks like an auth failure.
    console.error('token-question: database unavailable (NEON_CONNECTION_STRING)', e);
    res.status(503).json({ error: 'Database unavailable — try again in a moment' });
    return;
  }

  try {
    const rows = await withQueryTimeout(
      sql.query('SELECT id, question FROM access_tokens WHERE token_hash = $1', [
        hashToken(token),
      ]),
      8000,
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    let hint_available = true;
    if (isValidSessionId(session_id)) {
      const grants = await withQueryTimeout(
        sql.query('SELECT 1 FROM hint_grants WHERE token_id = $1 AND session_id = $2', [
          (rows[0] as { id: string }).id,
          session_id,
        ]),
        8000,
      ).catch(() => []);
      hint_available = grants.length === 0;
    }
    res.status(200).json({ question: (rows[0] as { question: string }).question, hint_available });
  } catch (e) {
    console.error('token-question error', e);
    if (isColdStartError(e)) {
      res.status(503).json({ error: 'Database unavailable — try again in a moment' });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
}
