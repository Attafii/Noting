import type { VercelRequest, VercelResponse } from '@vercel/node';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearMemoryBuckets,
  enforceRateLimit,
  memoryStore,
  type RateLimitStore,
} from './_ratelimit';

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

function check(
  req: VercelRequest,
  res: TestRes,
  limit?: number,
  store?: RateLimitStore,
): Promise<boolean> {
  return enforceRateLimit(req, res as unknown as VercelResponse, {
    limit,
    store: store ?? memoryStore,
  });
}

describe('enforceRateLimit', () => {
  beforeEach(() => clearMemoryBuckets());

  it('allows requests within budget and blocks past it', async () => {
    for (let i = 0; i < 10; i++) {
      await expect(check(fakeReq('1.2.3.4'), fakeRes(), 10)).resolves.toBe(true);
    }
    const res = fakeRes();
    await expect(check(fakeReq('1.2.3.4'), res, 10)).resolves.toBe(false);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(res.body).toEqual({ error: 'Too many requests — slow down a moment' });
  });

  it('isolates buckets per client', async () => {
    await expect(check(fakeReq('9.9.9.9'), fakeRes(), 10)).resolves.toBe(true);
  });

  it('applies the default budget independently', async () => {
    await expect(check(fakeReq('1.2.3.4'), fakeRes())).resolves.toBe(true);
  });

  it('supports an injectable store (offline unit-test path)', async () => {
    const hits: string[] = [];
    const custom: RateLimitStore = {
      async check(key: string, _limit: number, _now: number) {
        hits.push(key);
        return { allowed: true, retryAfterSec: 0 };
      },
    };
    await expect(check(fakeReq('5.6.7.8'), fakeRes(), 10, custom)).resolves.toBe(true);
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain('5.6.7.8');
  });

  it('fails OPEN when the store throws (availability over strictness)', async () => {
    const broken: RateLimitStore = {
      async check() {
        throw new Error('db down');
      },
    };
    const res = fakeRes();
    await expect(check(fakeReq('1.1.1.1'), res, 10, broken)).resolves.toBe(true);
    expect(res.statusCode).toBe(0);
  });
});
