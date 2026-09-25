import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  hashAnswer,
  hashToken,
  isValidSessionId,
  newRecoveryCode,
  newSaltHex,
  newTokenPlaintext,
  newUserId,
  normalizeAnswer,
  normalizeRecoveryCode,
} from './_auth.js';
import { verifyChallenge } from './_challenge.js';
import { verifyTurnstile } from './_turnstile.js';
import { enforceRateLimit } from './_ratelimit.js';
import { isColdStartError, sleep, withQueryTimeout } from './_timeout.js';
import { getSql } from '../src/lib/db.js';

function cleanStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length > max) return null;
  return t;
}

/**
 * Self-service token mint. No auth, strict rate limit (~5/min bucket),
 * built-in human-check required. Generates ntk_… + u_… server-side, stores
 * only hashes, and returns the token and recovery code once.
 */
function selfServiceEnabled(): boolean {
  const configured = process.env.PUBLIC_SELF_SERVICE_TOKENS;
  if (configured !== undefined) return configured === 'true';
  return process.env.NODE_ENV !== 'production';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!(await enforceRateLimit(req, res, { limit: 5 }))) return;

  const body = (req.body ?? {}) as {
    label?: unknown;
    invite_code?: unknown;
    question?: unknown;
    answer?: unknown;
    hint?: unknown;
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

  // Primary: built-in visual human-check. Fallback: Cloudflare Turnstile
  // (lazy widget, only when the user opts in after the custom check fails).
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

  const question = cleanStr(body.question, 140);
  const answerRaw = typeof body.answer === 'string' ? body.answer : null;
  const hint = cleanStr(body.hint ?? '', 200);
  const label = cleanStr(body.label ?? '', 40);
  if (question === null || question.length < 4) {
    res.status(400).json({ error: 'question must be 4–140 characters' });
    return;
  }
  if (answerRaw === null || answerRaw.trim().length < 2 || answerRaw.trim().length > 100) {
    res.status(400).json({ error: 'answer must be 2–100 characters' });
    return;
  }
  if (hint === null) {
    res.status(400).json({ error: 'hint must be 0–200 characters' });
    return;
  }
  if (label === null) {
    res.status(400).json({ error: 'label must be 0–40 characters' });
    return;
  }
  const inviteCode = cleanStr(body.invite_code ?? '', 200) ?? '';
  const inviteRequired = !selfServiceEnabled();
  if (inviteRequired && !inviteCode) {
    res.status(403).json({ error: 'An invite code is required on this deployment' });
    return;
  }

  const tokenPlaintext = newTokenPlaintext();
  const userId = newUserId();
  const salt = newSaltHex();
  const answerHash = hashAnswer(normalizeAnswer(answerRaw), salt);
  const recoveryCode = newRecoveryCode();
  const recoverySalt = newSaltHex();
  const recoveryHash = hashAnswer(normalizeRecoveryCode(recoveryCode), recoverySalt);

  let sql: ReturnType<typeof getSql>;
  try {
    sql = getSql();
  } catch (e) {
    // Missing/unreadable NEON_CONNECTION_STRING — the only 503 in this
    // handler, so Vercel logs + the client message identify a DB-config
    // outage (not a human-check failure).
    console.error('tokens mint: database unavailable (NEON_CONNECTION_STRING)', e);
    res.status(503).json({ error: 'Database unavailable — try again in a moment' });
    return;
  }
  let inviteReserved = false;
  if (inviteRequired) {
    try {
      const inviteRows = await sql.query(
        `UPDATE workspace_invites SET used_at = NOW()
         WHERE code_hash = $1 AND used_at IS NULL AND expires_at > NOW()
         RETURNING id`,
        [hashToken(inviteCode)],
      );
      if (inviteRows.length === 0) {
        res.status(403).json({ error: 'Invite code is invalid or expired' });
        return;
      }
      inviteReserved = true;
    } catch (error) {
      console.error('tokens mint: invite store unavailable', error);
      res.status(503).json({ error: 'Database unavailable — try again in a moment' });
      return;
    }
  }

  // Cold-start tolerance: a sleeping Neon project drops the first query.
  // Every query is bounded so a hang becomes a fast 503, never a platform
  // timeout 500. Retry once for connection-class errors only (same ids —
  // a validation error fails fast with no retry).
  const params = [
    userId,
    hashToken(tokenPlaintext),
    label,
    question,
    answerHash,
    salt,
    hint,
    recoveryHash,
    recoverySalt,
  ];
  let minted = false;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await withQueryTimeout(
        sql.query(
          'INSERT INTO access_tokens (id, token_hash, label, question, answer_hash, answer_salt, hint, recovery_hash, recovery_salt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          params,
        ),
        8000,
      );
      minted = true;
      break;
    } catch (e) {
      lastError = e;
      console.error(`tokens mint error (attempt ${attempt}/2)`, e);
      if (attempt === 1 && isColdStartError(e)) {
        await sleep(2000);
        continue;
      }
      break;
    }
  }
  if (!minted) {
    if (inviteReserved) {
      await sql
        .query(
          'UPDATE workspace_invites SET used_at = NULL WHERE code_hash = $1 AND used_at IS NOT NULL',
          [hashToken(inviteCode)],
        )
        .catch(() => undefined);
    }
    // Unreachable DB (not bad input) → 503 so the client shows "waking up".
    if (isColdStartError(lastError)) {
      res.status(503).json({ error: 'Database unavailable — try again in a moment' });
      return;
    }
    res.status(500).json({ error: 'Could not create token — try again' });
    return;
  }

  res.status(201).json({
    token_plaintext: tokenPlaintext,
    recovery_code: recoveryCode,
    user_id: userId,
    question,
  });
}

/** Re-exported for tests: session-id shape shared with the hint endpoint. */
export { isValidSessionId };
