import type { VercelRequest, VercelResponse } from '@vercel/node';
import { enforceRateLimit } from './_ratelimit';
import { getSql } from '../src/lib/db';

/**
 * Unauthenticated liveness probe for uptime monitors. Reveals nothing
 * except that the app and database respond.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!(await enforceRateLimit(req, res))) return;

  const started = Date.now();
  try {
    const sql = getSql();
    await sql.query('SELECT 1');
    res.status(200).json({ ok: true, latency_ms: Date.now() - started });
  } catch (e) {
    console.error('health check failed', e);
    res.status(503).json({ ok: false });
  }
}
