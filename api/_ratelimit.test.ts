import type { VercelRequest, VercelResponse } from '@vercel/node';
import { describe, expect, it } from 'vitest';
import { enforceRateLimit } from './_ratelimit';

function fakeReq(ip: string, token = 'test-token-abc'): VercelRequest {
  return {
    headers: { 'x-bridge-token': token, 'x-forwarded-for': ip },
  } as unknown as VercelRequest;
}

interface TestRes {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  setHeader: (key: string, value: string) => void;
  status: (code: number) => TestRes;
  json: (body: unknown) => TestRes;
}

function fakeRes(): TestRes {
  const res: TestRes = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(key: string, value: string) {
      res.headers[key] = value;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

function check(req: VercelRequest, res: TestRes, limit?: number): boolean {
  return enforceRateLimit(req, res as unknown as VercelResponse, { limit });
}

describe('enforceRateLimit', () => {
  it('allows requests within budget and blocks past it', () => {
    for (let i = 0; i < 10; i++) {
      expect(check(fakeReq('1.2.3.4'), fakeRes(), 10)).toBe(true);
    }
    const res = fakeRes();
    expect(check(fakeReq('1.2.3.4'), res, 10)).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(res.body).toEqual({ error: 'Too many requests — slow down a moment' });
  });

  it('isolates buckets per client', () => {
    expect(check(fakeReq('9.9.9.9'), fakeRes(), 10)).toBe(true);
  });

  it('applies the default budget independently', () => {
    expect(check(fakeReq('1.2.3.4'), fakeRes())).toBe(true);
  });
});
