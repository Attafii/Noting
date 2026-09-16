import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withQueryTimeout } from './_timeout';
import { getSql } from '../src/lib/db';

/**
 * Standalone GET /api/health — isolated from api/router.ts so uptime probes
 * stay up even if the shared 15-handler bundle fails to boot (the
 * FUNCTION_INVOCATION_FAILED class of outage that took down /api/challenge).
 * Only dependency beyond Vercel types is the lazy Neon client (created on
 * first use, never at import time).
 */

const WINDOW_MS = 60_000;
const LIMIT = 120;
const buckets = new Map<string, number[]>();

function rateLimited(): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const recent = (buckets.get('health') ?? []).filter((t) => t > cutoff);
  if (recent.length >= LIMIT) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000)) };
  }
  recent.push(now);
  buckets.set('health', recent);
  if (buckets.size > 100) buckets.clear();
  return { allowed: true, retryAfterSec: 0 };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const rl = rateLimited();
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    res.status(429).json({ error: 'Too many requests — slow down a moment' });
    return;
  }

  const started = Date.now();
  // One-glance deployment diagnostics (no secrets): db_reachable tells
  // whether Neon answers at all; tables_ok tells whether migrations ran.
  // Bounded well under maxDuration so a sleeping DB yields JSON, not a hang.
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
