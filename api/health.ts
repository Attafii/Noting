import type { VercelRequest, VercelResponse } from '@vercel/node';
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
  try {
    const sql = getSql();
    await sql.query('SELECT 1');
    res.status(200).json({ ok: true, latency_ms: Date.now() - started });
  } catch (e) {
    console.error('health check failed', e);
    res.status(503).json({ ok: false });
  }
}
