import type { VercelRequest, VercelResponse } from '@vercel/node';

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 120;

/**
 * In-memory sliding-window limiter, keyed by token prefix + IP.
 *
 * Serverless caveat: state lives per function instance and resets on cold
 * starts, so this is a backstop against accidents and quota burn (notably the
 * paid /api/ai proxy) — not a distributed abuse shield. For a single-user
 * bridge with a 256-bit token, that trade-off is the right size.
 */
const buckets = new Map<string, number[]>();

function clientKey(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip =
    typeof forwarded === 'string' && forwarded.length > 0
      ? forwarded.split(',')[0].trim()
      : 'unknown';
  const token = req.headers['x-bridge-token'];
  const who = typeof token === 'string' && token.length > 0 ? token.slice(0, 12) : 'anon';
  return `${who}:${ip}`;
}

export interface RateLimitOptions {
  /** Max requests per minute. Defaults to 120. */
  limit?: number;
}

/**
 * Returns true when the request may continue. When the bucket is exhausted it
 * sends a 429 with `Retry-After` and returns false — callers must stop there.
 */
export function enforceRateLimit(
  req: VercelRequest,
  res: VercelResponse,
  options?: RateLimitOptions,
): boolean {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const key = clientKey(req);

  const recent = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (recent.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({ error: 'Too many requests — slow down a moment' });
    return false;
  }

  recent.push(now);
  buckets.set(key, recent);

  if (buckets.size > 5000) buckets.clear();
  return true;
}
