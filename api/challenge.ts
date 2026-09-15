import type { VercelRequest, VercelResponse } from '@vercel/node';
import { issueChallenge } from './_challenge';

/**
 * Standalone GET /api/challenge — deliberately isolated from api/router.ts.
 *
 * The shared router statically bundles all 15 endpoints (Neon, OpenRouter,
 * busboy); any single import-time failure there surfaced as a module boot
 * crash (Vercel FUNCTION_INVOCATION_FAILED, text/plain) that took down even
 * this DB-free endpoint. This function imports ONLY ./_challenge
 * (node:crypto) plus a tiny inline memory limiter, so it cannot be broken
 * by DB/AI/upload packaging issues.
 *
 * Contract mirrors _route-challenge.ts (kept for ?route=challenge compat):
 * GET → 200 challenge JSON, anything else → 405. Missing
 * GLOBAL_SECRET_TOKEN only logs (issue/verify stay consistent).
 */

const WINDOW_MS = 60_000;
const LIMIT = 30;
const buckets = new Map<string, number[]>();

function rateLimited(): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const recent = (buckets.get('challenge') ?? []).filter((t) => t > cutoff);
  if (recent.length >= LIMIT) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000)) };
  }
  recent.push(now);
  buckets.set('challenge', recent);
  if (buckets.size > 100) buckets.clear();
  return { allowed: true, retryAfterSec: 0 };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    if (!process.env.GLOBAL_SECRET_TOKEN) {
      console.error('challenge misconfigured — GLOBAL_SECRET_TOKEN is not set');
    }
    const rl = rateLimited();
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      res.status(429).json({ error: 'Too many requests — slow down a moment' });
      return;
    }
    // Single-use nonces — must never be cached anywhere.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(issueChallenge());
  } catch (e) {
    console.error('challenge handler failed', e);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Could not issue challenge — try again' });
    }
  }
}
