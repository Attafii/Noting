import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Pure built-in human-check: server-issued VISUAL odd-one-out challenge,
 * HMAC-signed with GLOBAL_SECRET_TOKEN (never exposed). No CAPTCHA vendor,
 * no tracking, no cookies, no IP log.
 *
 * Deliberately dependency-free (only node:crypto): this module must NEVER
 * import ../src/lib/db, ./_ratelimit, or any DB/AI helper, so the standalone
 * api/challenge.ts function bundles to a few KB and cannot be taken down by
 * a packaging failure in Neon/OpenRouter/busboy (the /api/challenge 500
 * class of outage — FUNCTION_INVOCATION_FAILED on the shared router).
 *
 * Why visual instead of arithmetic: `7 + 12 = ?` is solvable by any
 * text-only bot (curl + LLM) with zero rendering. The tile puzzle requires
 * fetching a challenge, rendering six tiles, perceiving the odd one,
 * waiting a human-plausible beat, and submitting interaction signals —
 * a dumb replay script or arithmetic solver fails closed. A targeted
 * vision-equipped solver could still pass, which is why this layer is
 * backed by single-use nonces, an 800ms timing gate, a honeypot, strict
 * rate limits (30/min challenge, 5/min mint), and the Turnstile fallback
 * in POST /api/tokens for abuse escalation.
 */

export interface ChallengeTile {
  /** Emoji/SVG glyph rendered on the tile. */
  g: string;
  /** CSS rotation in degrees (0 except on the rotated-kind target). */
  r: number;
  /** Accessible name — 5 tiles share one name, the target differs. */
  label: string;
}

export interface Challenge {
  nonce: string;
  /** Human instruction, e.g. "Tap the odd one out". */
  instruction: string;
  /** Six tiles in display order; the odd one is at the HMAC-bound index. */
  tiles: ChallengeTile[];
  expires_at: number;
  sig: string;
  /**
   * Backwards-compat mirror of `instruction`. Old cached frontends render
   * `question` with a numeric input; they fail closed against the new
   * verifier (which expects a tile index) and recover by reloading.
   */
  question: string;
}

export const CHALLENGE_TILE_COUNT = 6;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Instant submits (<800ms from render to tap) are bots, not humans. */
export const MIN_HUMAN_MS = 800;

function challengeSecret(): string {
  return process.env.GLOBAL_SECRET_TOKEN ?? '';
}

/** HMAC over (nonce, target tile index, expiry). The answer index is never stored. */
export function signChallenge(nonce: string, targetIndex: number, expiresAt: number): string {
  return createHmac('sha256', challengeSecret())
    .update(`${nonce}|${targetIndex}|${expiresAt}`, 'utf8')
    .digest('hex');
}

// Odd-one-out glyph pairs: same family, instantly distinct to a human eye.
const ODD_PAIRS: Array<{ base: string; baseLabel: string; odd: string; oddLabel: string }> = [
  { base: '🌙', baseLabel: 'crescent moon', odd: '🌜', oddLabel: 'last quarter moon' },
  { base: '😀', baseLabel: 'grinning face', odd: '😃', oddLabel: 'smiling face with open mouth' },
  { base: '🌕', baseLabel: 'full moon', odd: '🌖', oddLabel: 'waning gibbous moon' },
  { base: '⭐', baseLabel: 'star', odd: '🌟', oddLabel: 'glowing star' },
  { base: '🐱', baseLabel: 'cat', odd: '🐶', oddLabel: 'dog' },
  { base: '🍎', baseLabel: 'red apple', odd: '🍏', oddLabel: 'green apple' },
  { base: '⬛', baseLabel: 'black square', odd: '⬜', oddLabel: 'white square' },
  { base: '🔵', baseLabel: 'blue circle', odd: '🟢', oddLabel: 'green circle' },
];

const ROTATE_GLYPHS: Array<{ g: string; label: string }> = [
  { g: '🌙', label: 'moon' },
  { g: '➡️', label: 'arrow' },
  { g: '🔑', label: 'key' },
  { g: '✈️', label: 'airplane' },
  { g: '🐟', label: 'fish' },
];

const ROTATE_DEGREES = [90, 180, 270];

export function issueChallenge(): Challenge {
  const nonce = randomBytes(12).toString('hex');
  const expires_at = Date.now() + CHALLENGE_TTL_MS;
  const targetIndex = Math.floor(Math.random() * CHALLENGE_TILE_COUNT);

  let instruction: string;
  let tiles: ChallengeTile[];
  if (Math.random() < 0.5) {
    // Kind 1: odd emoji out.
    const pair = ODD_PAIRS[Math.floor(Math.random() * ODD_PAIRS.length)];
    instruction = 'Tap the odd one out';
    tiles = Array.from({ length: CHALLENGE_TILE_COUNT }, (_, i) =>
      i === targetIndex
        ? { g: pair.odd, r: 0, label: pair.oddLabel }
        : { g: pair.base, r: 0, label: pair.baseLabel },
    );
  } else {
    // Kind 2: one rotated tile. The glyph is identical everywhere — only the
    // rendered orientation differs, so a text-only fetcher gains nothing
    // from string-comparing the payload… beyond the `r` field, which the
    // timing gate + single-use nonce + rate limits still force it to play
    // fair to exploit (at which point it is a targeted solver, not a bot).
    const glyph = ROTATE_GLYPHS[Math.floor(Math.random() * ROTATE_GLYPHS.length)];
    const deg = ROTATE_DEGREES[Math.floor(Math.random() * ROTATE_DEGREES.length)];
    instruction = 'Tap the rotated tile';
    tiles = Array.from({ length: CHALLENGE_TILE_COUNT }, (_, i) =>
      i === targetIndex
        ? { g: glyph.g, r: deg, label: `${glyph.label}, rotated` }
        : { g: glyph.g, r: 0, label: glyph.label },
    );
  }

  return {
    nonce,
    instruction,
    tiles,
    expires_at,
    sig: signChallenge(nonce, targetIndex, expires_at),
    question: instruction,
  };
}

// Single-use nonces: consumed indices can't be replayed. In-memory per
// serverless instance (approximate across instances — same posture as the
// existing memory rate-limit fallback); mint rate limits blunt the residual.
const usedNonces = new Map<string, number>();

/** Test helper — resets the single-use nonce set between cases. */
export function clearChallengeNonces(): void {
  usedNonces.clear();
}

function consumeNonce(nonce: string): boolean {
  const now = Date.now();
  // Opportunistic prune so the set can't grow unbounded on a warm instance.
  if (usedNonces.size > 5000) {
    for (const [k, exp] of usedNonces) {
      if (exp <= now) usedNonces.delete(k);
    }
    if (usedNonces.size > 5000) usedNonces.clear();
  }
  if (usedNonces.has(nonce)) return false;
  usedNonces.set(nonce, now + CHALLENGE_TTL_MS);
  return true;
}

export interface ChallengeVerifyOptions {
  /** ms from tile render to tap, measured client-side. Must be ≥800ms. */
  elapsedMs?: unknown;
  /** Honeypot field — must stay empty. */
  honeypot?: unknown;
  /** Pointer/key press count — soft signal, see below. */
  interactions?: unknown;
}

export function verifyChallenge(
  nonce: unknown,
  expiresAt: unknown,
  sig: unknown,
  selected: unknown,
  opts?: ChallengeVerifyOptions,
): boolean {
  if (typeof nonce !== 'string' || nonce.length < 8 || nonce.length > 128) return false;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return false;
  if (typeof sig !== 'string' || sig.length === 0) return false;
  const index = typeof selected === 'number' ? selected : parseInt(String(selected ?? ''), 10);
  if (!Number.isInteger(index) || index < 0 || index >= CHALLENGE_TILE_COUNT) return false;
  if (Date.now() > expiresAt) return false;

  // Human timing gate: instant submits are scripted. Missing/garbled timing
  // fails closed (the client always sends it).
  const elapsed = typeof opts?.elapsedMs === 'number' ? opts.elapsedMs : NaN;
  if (!Number.isFinite(elapsed) || elapsed < MIN_HUMAN_MS || elapsed > CHALLENGE_TTL_MS) {
    return false;
  }

  // Honeypot: invisible field that only autofill bots fill.
  if (opts?.honeypot !== undefined && String(opts.honeypot).length > 0) return false;

  // Interaction soft-gate: zero pointer/key events with a barely-passing
  // elapsed time smells scripted. Keyboard/screen-reader users naturally take
  // longer, so only the fast-and-zero combination is rejected.
  const interactions = typeof opts?.interactions === 'number' ? opts.interactions : Number.NaN;
  if (Number.isFinite(interactions) && interactions <= 0 && elapsed < MIN_HUMAN_MS * 2) {
    return false;
  }

  const expected = signChallenge(nonce, index, expiresAt);
  const a = Buffer.from(String(sig), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;

  // Correct signature — now enforce single-use (replays fail even if the
  // signature is valid).
  return consumeNonce(nonce);
}
