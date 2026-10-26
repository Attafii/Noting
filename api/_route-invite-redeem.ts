import type { VercelRequest, VercelResponse } from '@vercel/node';
import { hashToken } from './_auth.js';
import { verifyChallenge } from './_challenge.js';
import { verifyTurnstile } from './_turnstile.js';
import { enforceRateLimit } from './_ratelimit.js';
import { getSql } from '../src/lib/db.js';

function cleanStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length > max) return null;
  return t;
}

/**
 * Public invite redemption (POST /api/invite-redeem).
 *
 * Deliberately standalone: redeeming a code does NOT mint a token and is
 * NOT required to mint one — /api/tokens is open self-service. A valid code
 * is simply consumed and acknowledged, so invite links can be shared for
 * gating features or onboarding without touching the token flow.
 *
 * Abuse posture (matches POST /api/tokens): strict rate limit (~5/min) and
 * the built-in human-check (Turnstile fallback), so codes can't be
 * brute-forced. Only sha256(code) is ever compared — plaintext codes live
 * in the database never; the admin endpoint returns them exactly once.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!(await enforceRateLimit(req, res, { limit: 5, scope: 'invite' }))) return;

  const body = (req.body ?? {}) as {
    invite_code?: unknown;
    challenge?: {
      nonce?: unknown;
      expires_at?: unknown;
      sig?: unknown;
      selected?: unknown;
      elapsed_ms?: unknown;
      honeypot?: unknown;
      interactions?: unknown;
    };
    turnstileToken?: unknown;
  };

  // Same human-check stack as token mint: tile puzzle primary, Turnstile
  // fallback — redeeming is public and must not become a code oracle.
  const ch = body.challenge ?? {};
  const customOk = verifyChallenge(ch.nonce, ch.expires_at, ch.sig, ch.selected, {
    elapsedMs: ch.elapsed_ms,
    honeypot: ch.honeypot,
    interactions: ch.interactions,
  });
  if (!customOk) {
    const fallbackOk =
      typeof body.turnstileToken === 'string' && body.turnstileToken.length > 0
        ? await verifyTurnstile(body.turnstileToken)
        : false;
    if (!fallbackOk) {
      res.status(400).json({ error: 'Human-check failed — solve a fresh challenge and retry' });
      return;
    }
  }

  const inviteCode = cleanStr(body.invite_code, 200);
  if (!inviteCode || inviteCode.length < 8) {
    res.status(400).json({ error: 'invite_code must be 8–200 characters' });
    return;
  }

  let sql: ReturnType<typeof getSql>;
  try {
    sql = getSql();
  } catch (e) {
    console.error('invite redeem: database unavailable (NEON_CONNECTION_STRING)', e);
    res.status(503).json({ error: 'Database unavailable — try again in a moment' });
    return;
  }

  // Atomic single-use consume: the WHERE clause guarantees two concurrent
  // redemptions of the same code can't both succeed (only one row flips).
  let rows: unknown[];
  try {
    rows = await sql.query(
      `UPDATE workspace_invites SET used_at = NOW()
       WHERE code_hash = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING id`,
      [hashToken(inviteCode)],
    );
  } catch (error) {
    console.error('invite redeem: invite store unavailable', error);
    res.status(503).json({ error: 'Database unavailable — try again in a moment' });
    return;
  }

  if (rows.length === 0) {
    // One message for unknown / used / expired codes — no oracle for
    // probing which codes exist.
    res.status(403).json({ error: 'Invite code is invalid or expired' });
    return;
  }

  res.status(200).json({ ok: true });
}
