import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearMemoryBuckets,
  clientKey,
  enforceRateLimit,
  memoryStore,
  type RateLimitStore,
} from './_ratelimit';

function fakeReq(token = 'test-token-abc'): VercelRequest {
  return {
    headers: { 'x-bridge-token': token },
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

describe('clientKey (per-user buckets, no IP tracking)', () => {
  it('derives the key from sha256(token) only', () => {
    const expected = `u:${createHash('sha256').update('test-token-abc', 'utf8').digest('hex').slice(0, 16)}`;
    expect(clientKey(fakeReq('test-token-abc'))).toBe(expected);
  });

  it('ignores x-forwarded-for entirely', () => {
    const withIp = {
      headers: { 'x-bridge-token': 'tok', 'x-forwarded-for': '1.2.3.4' },
    } as unknown as VercelRequest;
    const withoutIp = { headers: { 'x-bridge-token': 'tok' } } as unknown as VercelRequest;
    expect(clientKey(withIp)).toBe(clientKey(withoutIp));
  });

  it('separates users and anonymous callers', () => {
    expect(clientKey(fakeReq('user-A-token'))).not.toBe(clientKey(fakeReq('user-B-token')));
    expect(clientKey(fakeReq(''))).toBe('u:anon');
  });
});

describe('enforceRateLimit', () => {
  beforeEach(() => clearMemoryBuckets());

  it('allows requests within budget and blocks past it', async () => {
    for (let i = 0; i < 10; i++) {
      await expect(check(fakeReq('budget-token'), fakeRes(), 10)).resolves.toBe(true);
    }
    const res = fakeRes();
    await expect(check(fakeReq('budget-token'), res, 10)).resolves.toBe(false);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(res.body).toEqual({ error: 'Too many requests — slow down a moment' });
  });

  it('isolates buckets per user (same IP, different tokens)', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(check(fakeReq('user-A-token'), fakeRes(), 5)).resolves.toBe(true);
    }
    const res = fakeRes();
    await expect(check(fakeReq('user-A-token'), res, 5)).resolves.toBe(false);
    expect(res.statusCode).toBe(429);
    // User B is unaffected.
    await expect(check(fakeReq('user-B-token'), fakeRes(), 5)).resolves.toBe(true);
  });

  it('applies the default budget independently', async () => {
    await expect(check(fakeReq('fresh-token'), fakeRes())).resolves.toBe(true);
  });

  it('supports an injectable store (offline unit-test path)', async () => {
    const hits: string[] = [];
    const custom: RateLimitStore = {
      async check(key: string, _limit: number, _now: number) {
        hits.push(key);
        return { allowed: true, retryAfterSec: 0 };
      },
    };
    await expect(check(fakeReq('store-token'), fakeRes(), 10, custom)).resolves.toBe(true);
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain('u:');
    expect(hits[0]).not.toContain('5.6.7.8');
  });

  it('fails OPEN when the store throws (availability over strictness)', async () => {
    const broken: RateLimitStore = {
      async check() {
        throw new Error('db down');
      },
    };
    const res = fakeRes();
    await expect(check(fakeReq('any-token'), res, 10, broken)).resolves.toBe(true);
    expect(res.statusCode).toBe(0);
  });
});
