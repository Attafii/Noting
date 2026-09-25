import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { getSql } from '../src/lib/db.js';
import { enforceRateLimit } from './_ratelimit.js';

/**
 * Per-user token auth + blind admin.
 *
 * - Users exchange a token + answer or recovery code for a short-lived
 *   HttpOnly session. Legacy header credentials remain supported for older
 *   clients and are verified against scrypt(answer_normalized, salt).
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

export function normalizeRecoveryCode(code: string): string {
  return code.trim();
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function hashAnswer(normalized: string, saltHex: string): string {
  return scryptSync(normalized, Buffer.from(saltHex, 'hex'), 64).toString('hex');
}

function hashAnswerAsync(normalized: string, saltHex: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(normalized, Buffer.from(saltHex, 'hex'), 64, (error, derived) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derived.toString('hex'));
    });
  });
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

export const SESSION_COOKIE =
  process.env.NODE_ENV === 'production' ? '__Host-noting_session' : 'noting_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function newSessionId(): string {
  return `sess_${randomBytes(32).toString('base64url')}`;
}

export function hashSessionId(sessionId: string): string {
  return createHash('sha256').update(sessionId, 'utf8').digest('hex');
}

function cookieValue(req: VercelRequest, name: string): string | null {
  const raw = req.headers.cookie;
  if (typeof raw !== 'string') return null;
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name && rest.length > 0) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function getSessionIdFromRequest(req: VercelRequest): string | null {
  return cookieValue(req, SESSION_COOKIE);
}

async function resolveSession(req: VercelRequest): Promise<string | null> {
  const sessionId = cookieValue(req, SESSION_COOKIE);
  if (!sessionId || !/^sess_[A-Za-z0-9_-]{32,128}$/.test(sessionId)) return null;
  let sql;
  try {
    sql = getSql();
    const rows = await sql.query(
      `SELECT user_id FROM auth_sessions
       WHERE session_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [hashSessionId(sessionId)],
    );
    if (rows.length === 0) return null;
    void sql
      .query('UPDATE auth_sessions SET last_used_at = NOW() WHERE session_hash = $1', [
        hashSessionId(sessionId),
      ])
      .catch(() => undefined);
    return (rows[0] as { user_id: string }).user_id;
  } catch {
    return null;
  }
}

export async function verifyTokenAnswer(token: string, answer: string): Promise<string | null> {
  if (!token || !answer) return null;
  const tokenHash = hashToken(token);
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
    return null;
  }
  if (rows.length === 0) {
    negativeSet(tokenHash);
    return null;
  }
  const row = rows[0] as { id: string; answer_hash: string; answer_salt: string };
  let candidate: string;
  try {
    candidate = await hashAnswerAsync(normalizeAnswer(answer), row.answer_salt);
  } catch {
    return null;
  }
  if (!hashesEqualHex(candidate, row.answer_hash)) return null;
  void sql
    .query('UPDATE access_tokens SET last_used_at = NOW() WHERE id = $1', [row.id])
    .catch(() => undefined);
  return row.id;
}

export async function resolveAuth(req: VercelRequest): Promise<AuthResult | null> {
  const presented = header(req, 'x-bridge-token');

  if (presented !== null && isAdminToken(presented)) return { admin: true };

  const sessionUserId = await resolveSession(req);
  if (sessionUserId) return { userId: sessionUserId };

  const answer = header(req, 'x-bridge-answer');
  if (presented === null || answer === null) return null;

  const userId = await verifyTokenAnswer(presented, answer);
  return userId ? { userId } : null;
}

/**
 * Data-endpoint gate. Returns the userId or sends the rejection and returns
 * null (callers must stop there). Admin is blind → 404 (sees nothing, and
 * the shape matches a missing resource rather than an auth oracle).
 */
export async function requireUser(req: VercelRequest, res: VercelResponse): Promise<string | null> {
  if (!(await enforceRateLimit(req, res, { limit: 20 }))) return null;
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
// Built-in human-check lives in ./_challenge.js (pure, node:crypto only).
// Re-exported here so existing imports (routes, tests) keep working unchanged.
// ---------------------------------------------------------------------------
export {
  CHALLENGE_TILE_COUNT,
  CHALLENGE_TTL_MS,
  MIN_HUMAN_MS,
  clearChallengeNonces,
  issueChallenge,
  signChallenge,
  verifyChallenge,
} from './_challenge.js';
export type { Challenge, ChallengeTile, ChallengeVerifyOptions } from './_challenge.js';

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

export function newRecoveryCode(): string {
  return `rec_${randomBytes(24).toString('base64url')}`;
}

export async function verifyRecoveryCode(token: string, code: string): Promise<string | null> {
  if (!token || !code) return null;
  const tokenHash = hashToken(token);
  if (negativeHit(tokenHash)) return null;
  let sql;
  try {
    sql = getSql();
    const rows = await sql.query(
      'SELECT id, recovery_hash, recovery_salt FROM access_tokens WHERE token_hash = $1',
      [tokenHash],
    );
    if (rows.length === 0) {
      negativeSet(tokenHash);
      return null;
    }
    const row = rows[0] as {
      id: string;
      recovery_hash: string | null;
      recovery_salt: string | null;
    };
    if (!row.recovery_hash || !row.recovery_salt) return null;
    const candidate = await hashAnswerAsync(normalizeRecoveryCode(code), row.recovery_salt);
    if (!hashesEqualHex(candidate, row.recovery_hash)) return null;
    void sql
      .query('UPDATE access_tokens SET last_used_at = NOW() WHERE id = $1', [row.id])
      .catch(() => undefined);
    return row.id;
  } catch {
    return null;
  }
}

export function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}
