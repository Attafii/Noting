import { createHash, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSql } from '../src/lib/db.js';

/**
 * Daily retention purge, invoked by Vercel Cron (vercel.json `crons`) with
 * `Authorization: Bearer ${CRON_SECRET}` — Vercel injects the header
 * automatically when a CRON_SECRET env var is set. Unauthenticated calls
 * stop here; no DB work happens before the check.
 *
 * The statement list mirrors scripts/purge-retention.cjs (kept as the
 * manual/local fallback) — update BOTH when changing retention windows.
 * Each DELETE uses `RETURNING 1` so the purged row count is observable.
 */
const PURGES: [table: string, statement: string][] = [
  ['notes', "DELETE FROM notes WHERE deleted_at < NOW() - INTERVAL '30 days' RETURNING 1"],
  ['documents', "DELETE FROM documents WHERE deleted_at < NOW() - INTERVAL '30 days' RETURNING 1"],
  [
    'hint_grants',
    "DELETE FROM hint_grants WHERE revealed_at < NOW() - INTERVAL '30 days' RETURNING 1",
  ],
  [
    'rate_limit_buckets',
    "DELETE FROM rate_limit_buckets WHERE updated_at < NOW() - INTERVAL '2 hours' RETURNING 1",
  ],
  [
    'auth_sessions',
    "DELETE FROM auth_sessions WHERE expires_at < NOW() - INTERVAL '1 day' RETURNING 1",
  ],
  [
    'workspace_invites',
    "DELETE FROM workspace_invites WHERE expires_at < NOW() - INTERVAL '1 day' RETURNING 1",
  ],
];

/** Constant-time bearer comparison (hash first so lengths never leak). */
function bearerMatches(header: string | string[] | undefined, secret: string): boolean {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string' || !raw.startsWith('Bearer ')) return false;
  const token = raw.slice('Bearer '.length);
  if (token.length === 0) return false;
  const a = createHash('sha256').update(token).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'CRON_SECRET is not configured' });
    return;
  }
  if (!bearerMatches(req.headers.authorization, secret)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const sql = getSql();
    const results = await Promise.all(PURGES.map(([, statement]) => sql.query(statement)));
    const purged = Object.fromEntries(
      PURGES.map(([table], index) => [table, results[index].length]),
    );
    res.status(200).json({ ok: true, purged });
  } catch (error) {
    console.error('cron purge error', error);
    res.status(503).json({ error: 'Retention purge failed' });
  }
}
