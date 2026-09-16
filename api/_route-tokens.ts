import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  hashAnswer,
  hashToken,
  isValidSessionId,
  newSaltHex,
  newTokenPlaintext,
  newUserId,
  normalizeAnswer,
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

async function ensureTables(sql: ReturnType<typeof getSql>): Promise<void> {
  await sql.query(
    `CREATE TABLE IF NOT EXISTS access_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL DEFAULT '',
      question TEXT NOT NULL,
      answer_hash TEXT NOT NULL,
      answer_salt TEXT NOT NULL,
      hint TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_used_at TIMESTAMPTZ DEFAULT NULL
    )`,
  );
  await sql.query(
    'CREATE INDEX IF NOT EXISTS access_tokens_hash_idx ON access_tokens (token_hash)',
  );
  await sql.query(
    `CREATE TABLE IF NOT EXISTS hint_grants (
      token_id TEXT NOT NULL REFERENCES access_tokens(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      revealed_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (token_id, session_id)
    )`,
  );
}

/**
 * Self-service token mint. No auth, strict rate limit (~5/min bucket),
 * built-in human-check required. Generates ntk_… + u_… server-side, stores
 * ONLY hashes. Returns the token plaintext ONCE — it is never returnable
 * again. Never returns the answer or hint.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!(await enforceRateLimit(req, res, { limit: 5 }))) return;

  const body = (req.body ?? {}) as {
    label?: unknown;
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

  const tokenPlaintext = newTokenPlaintext();
  const userId = newUserId();
  const salt = newSaltHex();
  const answerHash = hashAnswer(normalizeAnswer(answerRaw), salt);

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
  // Cold-start tolerance: a sleeping Neon project drops the first query.
  // Every query is bounded so a hang becomes a fast 503, never a platform
  // timeout 500. Retry once for connection-class errors only (same ids —
  // a validation error fails fast with no retry).
  const params = [userId, hashToken(tokenPlaintext), label, question, answerHash, salt, hint];
  let minted = false;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await withQueryTimeout(ensureTables(sql).catch(() => undefined), 8000);
      await withQueryTimeout(
        sql.query(
          'INSERT INTO access_tokens (id, token_hash, label, question, answer_hash, answer_salt, hint) VALUES ($1, $2, $3, $4, $5, $6, $7)',
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
    // Unreachable DB (not bad input) → 503 so the client shows "waking up".
    if (isColdStartError(lastError)) {
      res.status(503).json({ error: 'Database unavailable — try again in a moment' });
      return;
    }
    res.status(500).json({ error: 'Could not create token — try again' });
    return;
  }

  res.status(201).json({ token_plaintext: tokenPlaintext, user_id: userId, question });
}

/** Re-exported for tests: session-id shape shared with the hint endpoint. */
export { isValidSessionId };
