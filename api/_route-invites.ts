import { randomBytes } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { hashToken, resolveAuth } from './_auth.js';
import { enforceRateLimit } from './_ratelimit.js';
import { withQueryTimeout } from './_timeout.js';
import { getSql } from '../src/lib/db.js';

/**
 * Admin invite management (GET/POST /api/invites).
 *
 * This is the one endpoint that intentionally accepts the blind admin
 * credential (GLOBAL_SECRET_TOKEN via x-bridge-token) — invite codes are a
 * deployment-level concern, not user data. Regular user sessions get 404 so
 * the route doesn't exist for them, matching the blind-admin posture used
 * everywhere else (see _auth.ts).
 *
 * - POST creates a code server-side (inv_…, 24 random bytes) and returns it
 *   exactly once — only sha256(code) is stored. `valid_days` clamps to 1–365.
 * - GET lists codes' metadata (status/expiry) and never returns code_hash,
 *   so a leaked admin read still can't redeem anything.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await enforceRateLimit(req, res, { limit: 30, scope: 'invites-admin' }))) return;

  const auth = await resolveAuth(req);
  if (auth === null || !('admin' in auth)) {
    // Not admin (missing/wrong secret, or a regular user session) — the
    // route is invisible, same as every other data endpoint for admin.
    res.status(404).json({ error: 'Not found' });
    return;
  }

  if (req.method === 'POST') {
    await createInvite(req, res);
    return;
  }
  if (req.method === 'GET') {
    await listInvites(res);
    return;
  }
  res.status(405).json({ error: 'Method not allowed' });
}

function newInviteCode(): string {
  return `inv_${randomBytes(18).toString('base64url')}`;
}

async function createInvite(req: VercelRequest, res: VercelResponse): Promise<void> {
  const body = (req.body ?? {}) as { valid_days?: unknown };
  const raw = 'valid_days' in body ? body.valid_days : 30;
  const days =
    typeof raw === 'number' && Number.isInteger(raw)
      ? raw
      : typeof raw === 'string' && /^\d+$/.test(raw.trim())
        ? parseInt(raw.trim(), 10)
        : NaN;
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    res.status(400).json({ error: 'valid_days must be an integer between 1 and 365' });
    return;
  }

  let sql: ReturnType<typeof getSql>;
  try {
    sql = getSql();
  } catch (e) {
    console.error('invite create: database unavailable (NEON_CONNECTION_STRING)', e);
    res.status(503).json({ error: 'Database unavailable — try again in a moment' });
    return;
  }

  const code = newInviteCode();
  let rows: unknown[];
  try {
    rows = await withQueryTimeout(
      sql.query(
        `INSERT INTO workspace_invites (code_hash, expires_at)
         VALUES ($1, NOW() + ($2 * INTERVAL '1 day'))
         RETURNING expires_at`,
        [hashToken(code), days],
      ),
      8000,
    );
  } catch (error) {
    console.error('invite create: insert failed', error);
    res.status(503).json({ error: 'Database unavailable — try again in a moment' });
    return;
  }

  // The code is returned exactly once — it can never be recovered later.
  res.status(201).json({
    code,
    valid_days: days,
    expires_at: (rows[0] as { expires_at: unknown } | undefined)?.expires_at ?? null,
  });
}

async function listInvites(res: VercelResponse): Promise<void> {
  let sql: ReturnType<typeof getSql>;
  try {
    sql = getSql();
  } catch (e) {
    console.error('invite list: database unavailable (NEON_CONNECTION_STRING)', e);
    res.status(503).json({ error: 'Database unavailable — try again in a moment' });
    return;
  }

  let rows: unknown[];
  try {
    rows = await withQueryTimeout(
      sql.query(
        `SELECT id, created_at, expires_at, used_at
         FROM workspace_invites
         ORDER BY created_at DESC
         LIMIT 100`,
      ),
      8000,
    );
  } catch (error) {
    console.error('invite list: query failed', error);
    res.status(503).json({ error: 'Database unavailable — try again in a moment' });
    return;
  }

  const now = Date.now();
  const invites = rows.map((entry) => {
    const row = entry as {
      id: unknown;
      created_at: unknown;
      expires_at: unknown;
      used_at: unknown;
    };
    const usedAt = row.used_at ? new Date(String(row.used_at)).getTime() : null;
    const expiresAt = new Date(String(row.expires_at)).getTime();
    const status = usedAt !== null ? 'used' : expiresAt <= now ? 'expired' : 'active';
    return {
      id: row.id,
      status,
      created_at: row.created_at,
      expires_at: row.expires_at,
      used_at: row.used_at,
    };
  });

  res.status(200).json({ invites });
}
