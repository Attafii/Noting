import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getSessionIdFromRequest,
  hashSessionId,
  newSessionId,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  verifyRecoveryCode,
  verifyTokenAnswer,
} from './_auth.js';
import { enforceRateLimit } from './_ratelimit.js';
import { getSql } from '../src/lib/db.js';

function cookieHeader(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function body(req: VercelRequest): { token?: unknown; answer?: unknown; recovery_code?: unknown } {
  return (req.body ?? {}) as { token?: unknown; answer?: unknown; recovery_code?: unknown };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'DELETE') {
    const sessionId = getSessionIdFromRequest(req);
    if (sessionId) {
      try {
        const sql = getSql();
        await sql.query(
          'UPDATE auth_sessions SET revoked_at = NOW() WHERE session_hash = $1 AND revoked_at IS NULL',
          [hashSessionId(sessionId)],
        );
      } catch {
        return;
      }
    }
    res.setHeader('Set-Cookie', cookieHeader('', 0));
    res.status(204).end();
    return;
  }

  if (req.method === 'GET') {
    const sessionId = getSessionIdFromRequest(req);
    if (!sessionId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const sql = getSql();
      const rows = await sql.query(
        'SELECT user_id, expires_at FROM auth_sessions WHERE session_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()',
        [hashSessionId(sessionId)],
      );
      if (rows.length === 0) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      res.status(200).json({ user_id: rows[0].user_id, expires_at: rows[0].expires_at });
    } catch {
      res.status(503).json({ error: 'Database unavailable' });
    }
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!(await enforceRateLimit(req, res, { limit: 10 }))) return;

  const input = body(req);
  if (typeof input.token !== 'string') {
    res.status(400).json({ error: 'token is required' });
    return;
  }
  const userId =
    typeof input.recovery_code === 'string'
      ? await verifyRecoveryCode(input.token, input.recovery_code)
      : typeof input.answer === 'string'
        ? await verifyTokenAnswer(input.token, input.answer)
        : null;
  if (!userId) {
    res.status(401).json({ error: 'Invalid token or answer' });
    return;
  }

  const sessionId = newSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  try {
    const sql = getSql();
    await sql.query("DELETE FROM auth_sessions WHERE expires_at < NOW() - INTERVAL '7 days'");
    await sql.query(
      'INSERT INTO auth_sessions (id, session_hash, user_id, expires_at) VALUES ($1, $2, $3, $4)',
      [sessionId, hashSessionId(sessionId), userId, expiresAt.toISOString()],
    );
    res.setHeader('Set-Cookie', cookieHeader(sessionId, Math.floor(SESSION_TTL_MS / 1000)));
    res.status(200).json({ user_id: userId, expires_at: expiresAt.toISOString() });
  } catch {
    res.status(503).json({ error: 'Database unavailable' });
  }
}
