import type { VercelRequest, VercelResponse } from '@vercel/node';

export function validateToken(req: VercelRequest): boolean {
  return req.headers['x-bridge-token'] === process.env.GLOBAL_SECRET_TOKEN;
}

export function unauthorizedResponse(res: VercelResponse): void {
  res.status(401).json({ error: 'Unauthorized' });
}
