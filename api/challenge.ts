import type { VercelRequest, VercelResponse } from '@vercel/node';
import { issueChallenge } from './_auth';
import { enforceRateLimit } from './_ratelimit';

/**
 * Built-in human-check issuer. No auth, strict rate limit, no cookies,
 * no IP log, no third party. Returns an arithmetic challenge HMAC-signed
 * with GLOBAL_SECRET_TOKEN (never exposed) — the client solves it and
 * echoes { nonce, expires_at, sig, answer } into POST /api/tokens.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!(await enforceRateLimit(req, res, { limit: 30 }))) return;
  res.status(200).json(issueChallenge());
}
