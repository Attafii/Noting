import type { VercelRequest, VercelResponse } from '@vercel/node';
import { issueChallenge } from './_challenge';
import { enforceRateLimit, memoryStore } from './_ratelimit';

/**
 * Built-in human-check issuer. No auth, strict rate limit, no cookies,
 * no IP log, no third party. Returns a visual odd-one-out challenge
 * HMAC-signed with GLOBAL_SECRET_TOKEN (never exposed) — the client renders
 * six tiles, the user taps the odd one, and echoes
 * { nonce, expires_at, sig, selected, elapsed_ms } into POST /api/tokens.
 *
 * Deliberately DB-free (in-memory rate limit): the human-check must stay up
 * even when Neon is cold, misconfigured, or down. The limit is approximate
 * across serverless instances — acceptable for a 30/min anti-abuse bucket.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    if (!process.env.GLOBAL_SECRET_TOKEN) {
      // Fail loudly in logs but stay available: issue/verify stay consistent
      // (both use the same secret source), so minting keeps working while
      // the deployer notices the misconfiguration.
      console.error('challenge misconfigured — GLOBAL_SECRET_TOKEN is not set');
    }
    if (!(await enforceRateLimit(req, res, { limit: 30, store: memoryStore }))) return;
    // Single-use nonces — must never be cached anywhere.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(issueChallenge());
  } catch (e) {
    console.error('router route=challenge handler failed', e);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Could not issue challenge — try again' });
    }
  }
}
