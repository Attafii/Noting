import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  hashAnswer,
  hashToken,
  isValidSessionId,
  newSaltHex,
  newTokenPlaintext,
  newUserId,
  normalizeAnswer,
  verifyChallenge,
} from './_auth';
import { enforceRateLimit } from './_ratelimit';
import { getSql } from '../src/lib/db';

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
    challenge?: { nonce?: unknown; expires_at?: unknown; sig?: unknown; answer?: unknown };
  };

  const ch = body.challenge ?? {};
  if (!verifyChallenge(ch.nonce, ch.expires_at, ch.sig, ch.answer)) {
    res.status(400).json({ error: 'Human-check failed — solve a fresh challenge and retry' });
    return;
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

  try {
    const sql = getSql();
    await ensureTables(sql).catch(() => undefined);
    await sql.query(
      'INSERT INTO access_tokens (id, token_hash, label, question, answer_hash, answer_salt, hint) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [userId, hashToken(tokenPlaintext), label, question, answerHash, salt, hint],
    );
  } catch (e) {
    console.error('tokens mint error', e);
    res.status(500).json({ error: 'Could not create token — try again' });
    return;
  }

  res.status(201).json({ token_plaintext: tokenPlaintext, user_id: userId, question });
}

/** Re-exported for tests: session-id shape shared with the hint endpoint. */
export { isValidSessionId };
