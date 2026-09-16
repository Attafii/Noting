import type { VercelRequest, VercelResponse } from '@vercel/node';
import { enforceRateLimit } from './_ratelimit';
import { withQueryTimeout } from './_timeout';
import { getSql } from '../src/lib/db';

/**
 * Unauthenticated liveness probe for uptime monitors. Reveals nothing
 * except that the app and database respond: db_reachable tells whether
 * Neon answers at all; tables_ok tells whether migrations ran.
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
    await withQueryTimeout(sql.query('SELECT 1'), QUERY_TIMEOUT_MS);
    let tables_ok = false;
    try {
      const rows = await withQueryTimeout(
        sql.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
           AND tablename IN ('access_tokens', 'hint_grants', 'rate_limit_buckets')`,
        ),
        QUERY_TIMEOUT_MS,
      );
      const names = new Set(
        rows.map((r) => (r as { tablename?: unknown }).tablename).filter((t) => typeof t === 'string'),
      );
      tables_ok =
        names.has('access_tokens') && names.has('hint_grants') && names.has('rate_limit_buckets');
    } catch (e) {
      console.error('health tables check failed', e);
    }
    const ok = tables_ok;
    res
      .status(ok ? 200 : 503)
      .json({ ok, db_reachable: true, tables_ok, latency_ms: Date.now() - started });
  } catch (e) {
    console.error('health check failed', e);
    res
      .status(503)
      .json({ ok: false, db_reachable: false, tables_ok: false, latency_ms: Date.now() - started });
  }
}

const QUERY_TIMEOUT_MS = 7000;
