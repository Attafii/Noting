import type { VercelRequest, VercelResponse } from '@vercel/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unauthorizedResponse, validateToken } from './_auth';

function fakeReq(token: unknown): VercelRequest {
  return { headers: { 'x-bridge-token': token } } as unknown as VercelRequest;
}

function fakeRes() {
  const res = {
    statusCode: 0,
    body: null as unknown,
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

describe('validateToken', () => {
  const REAL_TOKEN = process.env.GLOBAL_SECRET_TOKEN;

  beforeEach(() => {
    process.env.GLOBAL_SECRET_TOKEN = 'secret-123';
  });

  afterEach(() => {
    if (REAL_TOKEN === undefined) delete process.env.GLOBAL_SECRET_TOKEN;
    else process.env.GLOBAL_SECRET_TOKEN = REAL_TOKEN;
  });

  it('accepts the exact configured token', () => {
    expect(validateToken(fakeReq('secret-123'))).toBe(true);
  });

  it('rejects wrong, missing, and empty tokens', () => {
    expect(validateToken(fakeReq('wrong'))).toBe(false);
    expect(validateToken(fakeReq(undefined))).toBe(false);
    expect(validateToken(fakeReq(''))).toBe(false);
  });

  it('fails closed when the env var is missing or empty', () => {
    delete process.env.GLOBAL_SECRET_TOKEN;
    expect(validateToken(fakeReq('anything'))).toBe(false);
    expect(validateToken(fakeReq(undefined))).toBe(false);
    process.env.GLOBAL_SECRET_TOKEN = '';
    expect(validateToken(fakeReq(''))).toBe(false);
  });

  it('rejects near-miss tokens (constant-time compare)', () => {
    expect(validateToken(fakeReq('secret-124'))).toBe(false);
    expect(validateToken(fakeReq('secret-1234'))).toBe(false);
    expect(validateToken(fakeReq('secret-12'))).toBe(false);
  });
});

describe('unauthorizedResponse', () => {
  it('answers 401 with the standard error shape', () => {
    const res = fakeRes();
    unauthorizedResponse(res as unknown as VercelResponse);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });
});
