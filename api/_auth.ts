import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getSql } from '../src/lib/db';

/**
 * Per-user token auth + blind admin.
 *
 * - Users present `x-bridge-token` (ntk_…) + `x-bridge-answer` on every
 *   request. The answer is verified against scrypt(answer_normalized, salt)
 *   and NEVER persisted anywhere (browser keeps it in memory only).
 * - Answer normalization: `trim().toLowerCase()`. Documented so "Hello" and
 *   "hello" don't lock users out. Unicode edge cases: normalization does NOT
 *   do NFKC folding or locale-aware casing — "ß".toLowerCase() stays "ß",
 *   composed vs decomposed accents are distinct. Keep answers simple ASCII.
 * - Admin: presenting exactly GLOBAL_SECRET_TOKEN yields { admin: true }.
 *   Every data endpoint must reject admin (blind — sees/lists/mints nothing).
 *   Only GET /api/health may accept it (it needs no auth at all).
 * - Plaintext tokens/answers exist only in the user's browser memory and the
 *   one-time POST /api/tokens response. Server stores only hashes + salts.
 */

export type AuthResult = { userId: string } | { admin: true };

export function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase();
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function hashAnswer(normalized: string, saltHex: string): string {
  return scryptSync(normalized, Buffer.from(saltHex, 'hex'), 64).toString('hex');
}

function hashesEqualHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isAdminToken(presented: string): boolean {
  const expected = process.env.GLOBAL_SECRET_TOKEN;
  if (typeof presented !== 'string' || presented.length === 0) return false;
  if (typeof expected !== 'string' || expected.length === 0) return false;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Negative-lookup cache: unknown token hashes are remembered for 30s to
// blunt brute-force probing without adding any persistent audit trail.
const negativeCache = new Map<string, number>();
const NEGATIVE_TTL_MS = 30_000;

function negativeHit(tokenHash: string): boolean {
  const until = negativeCache.get(tokenHash);
  if (until === undefined) return false;
  if (Date.now() > until) {
    negativeCache.delete(tokenHash);
    return false;
  }
  return true;
}

function negativeSet(tokenHash: string): void {
  negativeCache.set(tokenHash, Date.now() + NEGATIVE_TTL_MS);
  if (negativeCache.size > 5000) negativeCache.clear();
}

/** Test helper — resets the negative-lookup cache between cases. */
export function clearAuthCache(): void {
  negativeCache.clear();
}

function header(req: VercelRequest, name: string): string | null {
  const v = req.headers[name];
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

export async function resolveAuth(req: VercelRequest): Promise<AuthResult | null> {
  const presented = header(req, 'x-bridge-token');

  // Blind admin: sees nothing, lists nothing, mints nothing.
  if (presented !== null && isAdminToken(presented)) return { admin: true };

  const answer = header(req, 'x-bridge-answer');
  if (presented === null || answer === null) return null;

  const tokenHash = hashToken(presented);
  if (negativeHit(tokenHash)) return null;

  let sql;
  try {
    sql = getSql();
  } catch {
    return null;
  }
  let rows;
  try {
    rows = await sql.query(
      'SELECT id, answer_hash, answer_salt FROM access_tokens WHERE token_hash = $1',
      [tokenHash],
    );
  } catch {
    // Table missing (migration not run yet) → fail closed, no crash.
    return null;
  }
  if (rows.length === 0) {
    negativeSet(tokenHash);
    return null;
  }
  const row = rows[0] as { id: string; answer_hash: string; answer_salt: string };
  let candidate: string;
  try {
    candidate = hashAnswer(normalizeAnswer(answer), row.answer_salt);
  } catch {
    return null;
  }
  if (!hashesEqualHex(candidate, row.answer_hash)) return null;

  // Idle detection only — no IP/UA logging anywhere.
  void sql
    .query('UPDATE access_tokens SET last_used_at = NOW() WHERE id = $1', [row.id])
    .catch(() => undefined);

  return { userId: row.id };
}

/**
 * Data-endpoint gate. Returns the userId or sends the rejection and returns
 * null (callers must stop there). Admin is blind → 404 (sees nothing, and
 * the shape matches a missing resource rather than an auth oracle).
 */
export async function requireUser(req: VercelRequest, res: VercelResponse): Promise<string | null> {
  const auth = await resolveAuth(req);
  if (auth !== null && 'userId' in auth) return auth.userId;
  if (auth !== null && 'admin' in auth) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  unauthorizedResponse(res);
  return null;
}

export function unauthorizedResponse(res: VercelResponse): void {
  res.status(401).json({ error: 'Unauthorized' });
}

export function notFoundResponse(res: VercelResponse): void {
  res.status(404).json({ error: 'Not found' });
}

// ---------------------------------------------------------------------------
// Built-in human-check lives in ./_challenge (pure, node:crypto only) so the
// standalone api/challenge.ts bundle never pulls in Neon/DB deps. Re-exported
// here so existing imports (routes, tests) keep working unchanged.
// ---------------------------------------------------------------------------
export {
  CHALLENGE_TILE_COUNT,
  CHALLENGE_TTL_MS,
  MIN_HUMAN_MS,
  clearChallengeNonces,
  issueChallenge,
  signChallenge,
  verifyChallenge,
} from './_challenge';
export type { Challenge, ChallengeTile, ChallengeVerifyOptions } from './_challenge';

// ---------------------------------------------------------------------------
// Token minting helpers (used by POST /api/tokens).
// ---------------------------------------------------------------------------

export function newTokenPlaintext(): string {
  return `ntk_${randomBytes(32).toString('base64url')}`;
}

export function newUserId(): string {
  return `u_${randomBytes(12).toString('base64url')}`;
}

export function newSaltHex(): string {
  return randomBytes(16).toString('hex');
}

export function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}
