import type { VercelRequest, VercelResponse } from '@vercel/node';

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
    presented === expected
  );
}

export function unauthorizedResponse(res: VercelResponse): void {
  res.status(401).json({ error: 'Unauthorized' });
}
