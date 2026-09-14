import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';

/** Constant-time string comparison — no early-exit oracle on the token. */
function tokensMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function validateToken(req: VercelRequest): boolean {
  // Explicit non-empty checks on BOTH sides: a missing env var must fail
  // closed, never compare `undefined === undefined` into an open door.
  const presented = req.headers['x-bridge-token'];
  const expected = process.env.GLOBAL_SECRET_TOKEN;
  return (
    typeof presented === 'string' &&
    presented.length > 0 &&
    typeof expected === 'string' &&
    expected.length > 0 &&
    tokensMatch(presented, expected)
  );
}

export function unauthorizedResponse(res: VercelResponse): void {
  res.status(401).json({ error: 'Unauthorized' });
}
