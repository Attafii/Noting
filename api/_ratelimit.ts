import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { getSql } from '../src/lib/db';

export const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 120;

/**
 * DB-backed sliding-window limiter, keyed by token hash prefix.
 *
 * Privacy: NO IP tracking — the key derives only from sha256(x-bridge-token
 * or x-bridge-answer context). No `x-forwarded-for` is read anywhere.
 *
 * Single source of truth is Postgres (`rate_limit_buckets`), so limits hold
 * across serverless instances and cold starts. The in-memory map is only the
 * offline/test fallback — never a second authority in prod.
 *
 * Failure posture: fail OPEN with console.error (availability over strictness
 * for a personal tool), same as the revisions best-effort handling.
 */

/** Per-user bucket key — sha256 of the presented credential, no IP. Exported for tests. */
export function clientKey(req: VercelRequest): string {
  const token = req.headers['x-bridge-token'];
  const who =
    typeof token === 'string' && token.length > 0
      ? createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16)
      : 'anon';
  return `u:${who}`;
}

export interface RateLimitOptions {
  /** Max requests per minute. Defaults to 120. */
  limit?: number;
  /** Injectable store — memory default keeps unit tests fast and offline. */
  store?: RateLimitStore;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSec: number;
}

export interface RateLimitStore {
  check(key: string, limit: number, now: number): Promise<RateLimitDecision>;
}

const memoryBuckets = new Map<string, number[]>();

/** Test helper — resets the in-memory fallback between cases. */
export function clearMemoryBuckets(): void {
  memoryBuckets.clear();
}

export const memoryStore: RateLimitStore = {
  async check(key: string, limit: number, now: number): Promise<RateLimitDecision> {
    const cutoff = now - WINDOW_MS;
    const recent = (memoryBuckets.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= limit) {
      const retryAfterSec = Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000));
      return { allowed: false, retryAfterSec };
    }
    recent.push(now);
    memoryBuckets.set(key, recent);
    if (memoryBuckets.size > 5000) memoryBuckets.clear();
    return { allowed: true, retryAfterSec: 0 };
  },
};

export const sqlStore: RateLimitStore = {
  async check(key: string, limit: number, now: number): Promise<RateLimitDecision> {
    const cutoff = now - WINDOW_MS;
    try {
      const sql = getSql();
      const rows = await sql.query('SELECT hits FROM rate_limit_buckets WHERE key = $1', [key]);
      const raw = (rows[0]?.hits ?? []) as unknown[];
      const recent = raw
        .map((v) => (typeof v === 'string' ? parseInt(v, 10) : Number(v)))
        .filter((t) => Number.isFinite(t) && (t as number) > cutoff)
        .map((t) => t as number)
        .sort((a, b) => a - b);
      if (recent.length >= limit) {
        const retryAfterSec = Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000));
        return { allowed: false, retryAfterSec };
      }
      recent.push(now);
      // Prune to the newest `limit` entries so the array can't grow unbounded.
      const trimmed = recent.slice(-limit);
      await sql.query(
        `INSERT INTO rate_limit_buckets (key, hits, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET hits = EXCLUDED.hits, updated_at = NOW()`,
        [key, trimmed],
      );
      return { allowed: true, retryAfterSec: 0 };
    } catch (e) {
      console.error('rate limit store error — failing open', e);
      return { allowed: true, retryAfterSec: 0 };
    }
  },
};

function defaultStore(): RateLimitStore {
  // Offline/test default: memory. Prod (Neon configured): DB as single source.
  return process.env.NEON_CONNECTION_STRING ? sqlStore : memoryStore;
}

/**
 * Returns true when the request may continue. When the bucket is exhausted it
 * sends a 429 with `Retry-After` and returns false — callers must stop there.
 */
export async function enforceRateLimit(
  req: VercelRequest,
  res: VercelResponse,
  options?: RateLimitOptions,
): Promise<boolean> {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const store = options?.store ?? defaultStore();
  const now = Date.now();
  const key = clientKey(req);

  let decision: RateLimitDecision;
  try {
    decision = await store.check(key, limit, now);
  } catch (e) {
    console.error('rate limit check failed — failing open', e);
    return true;
  }
  if (!decision.allowed) {
    res.setHeader('Retry-After', String(decision.retryAfterSec));
    res.status(429).json({ error: 'Too many requests — slow down a moment' });
    return false;
  }
  return true;
}
