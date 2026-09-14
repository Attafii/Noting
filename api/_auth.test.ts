import type { VercelRequest, VercelResponse } from '@vercel/node';
import { scryptSync, createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../src/lib/db', () => ({
  getSql: () => ({ query: mockQuery }),
}));

import {
  clearAuthCache,
  hashAnswer,
  hashToken,
  isValidSessionId,
  issueChallenge,
  newTokenPlaintext,
  newUserId,
  normalizeAnswer,
  requireUser,
  resolveAuth,
  signChallenge,
  unauthorizedResponse,
  verifyChallenge,
} from './_auth';

function fakeReq(token?: unknown, answer?: unknown): VercelRequest {
  const headers: Record<string, unknown> = {};
  if (token !== undefined) headers['x-bridge-token'] = token;
  if (answer !== undefined) headers['x-bridge-answer'] = answer;
  return { headers } as unknown as VercelRequest;
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

const SALT = '0123456789abcdef0123456789abcdef';
const ANSWER = 'Blue Door';
const TOKEN = 'ntk_test-token-value';

function answerRow() {
  return {
    id: 'u_test123',
    answer_hash: scryptSync(normalizeAnswer(ANSWER), Buffer.from(SALT, 'hex'), 64).toString('hex'),
    answer_salt: SALT,
  };
}

describe('normalizeAnswer', () => {
  it('trims and lowercases (Hello == hello, padded matches)', () => {
    expect(normalizeAnswer('  Hello ')).toBe('hello');
    expect(normalizeAnswer('HELLO')).toBe('hello');
  });
});

describe('resolveAuth', () => {
  const REAL_SECRET = process.env.GLOBAL_SECRET_TOKEN;

  beforeEach(() => {
    process.env.GLOBAL_SECRET_TOKEN = 'secret-123';
    mockQuery.mockReset();
    clearAuthCache();
  });

  afterEach(() => {
    if (REAL_SECRET === undefined) delete process.env.GLOBAL_SECRET_TOKEN;
    else process.env.GLOBAL_SECRET_TOKEN = REAL_SECRET;
  });

  it('accepts a valid token + answer (case-insensitive)', async () => {
    mockQuery.mockResolvedValueOnce([answerRow()]).mockResolvedValueOnce([]);
    const auth = await resolveAuth(fakeReq(TOKEN, '  BLUE door '));
    expect(auth).toEqual({ userId: 'u_test123' });
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT id, answer_hash, answer_salt FROM access_tokens WHERE token_hash = $1',
      [hashToken(TOKEN)],
    );
  });

  it('rejects a wrong answer', async () => {
    mockQuery.mockResolvedValueOnce([answerRow()]);
    await expect(resolveAuth(fakeReq(TOKEN, 'red door'))).resolves.toBeNull();
  });

  it('rejects unknown tokens and caches the negative lookup', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await expect(resolveAuth(fakeReq('ntk_nope', 'whatever'))).resolves.toBeNull();
    // Second attempt hits the 30s negative cache — no second DB query.
    await expect(resolveAuth(fakeReq('ntk_nope', 'whatever'))).resolves.toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('rejects missing headers', async () => {
    await expect(resolveAuth(fakeReq(undefined, undefined))).resolves.toBeNull();
    await expect(resolveAuth(fakeReq(TOKEN, undefined))).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('recognizes the blind admin identity', async () => {
    await expect(resolveAuth(fakeReq('secret-123', 'anything'))).resolves.toEqual({
      admin: true,
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('fails closed when the env var is missing', async () => {
    delete process.env.GLOBAL_SECRET_TOKEN;
    mockQuery.mockResolvedValueOnce([answerRow()]).mockResolvedValueOnce([]);
    // Not admin anymore (no secret configured) → falls through to user path.
    const auth = await resolveAuth(fakeReq(TOKEN, ANSWER));
    expect(auth).toEqual({ userId: 'u_test123' });
  });
});

describe('requireUser (blind admin)', () => {
  beforeEach(() => {
    process.env.GLOBAL_SECRET_TOKEN = 'secret-123';
    mockQuery.mockReset();
    clearAuthCache();
  });

  it('returns the userId for valid credentials', async () => {
    mockQuery.mockResolvedValueOnce([answerRow()]).mockResolvedValueOnce([]);
    const res = fakeRes();
    const userId = await requireUser(fakeReq(TOKEN, ANSWER), res as unknown as VercelResponse);
    expect(userId).toBe('u_test123');
    expect(res.statusCode).toBe(0);
  });

  it('rejects the admin identity with 404 (sees nothing)', async () => {
    const res = fakeRes();
    const userId = await requireUser(
      fakeReq('secret-123', 'anything'),
      res as unknown as VercelResponse,
    );
    expect(userId).toBeNull();
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('rejects bad credentials with 401', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const res = fakeRes();
    const userId = await requireUser(
      fakeReq('ntk_bad', 'nope'),
      res as unknown as VercelResponse,
    );
    expect(userId).toBeNull();
    expect(res.statusCode).toBe(401);
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

describe('challenge (built-in human-check)', () => {
  beforeEach(() => {
    process.env.GLOBAL_SECRET_TOKEN = 'secret-123';
  });

  it('issues a signed challenge that verifies', () => {
    const ch = issueChallenge();
    expect(ch.question).toMatch(/^\d+ \+ \d+ = \?$/);
    const [a, b] = ch.question
      .split('=')[0]
      .split('+')
      .map((s) => parseInt(s.trim(), 10));
    expect(verifyChallenge(ch.nonce, ch.expires_at, ch.sig, a + b)).toBe(true);
  });

  it('rejects wrong answers, tampered sigs, and expiries', () => {
    const ch = issueChallenge();
    expect(verifyChallenge(ch.nonce, ch.expires_at, ch.sig, -999)).toBe(false);
    expect(verifyChallenge(ch.nonce, ch.expires_at, 'deadbeef', 0)).toBe(false);
    expect(verifyChallenge(ch.nonce, Date.now() - 1000, ch.sig, 0)).toBe(false);
    // Signature bound to a different secret fails.
    const other = signChallenge(ch.nonce, 42, ch.expires_at);
    process.env.GLOBAL_SECRET_TOKEN = 'different-secret';
    expect(verifyChallenge(ch.nonce, ch.expires_at, other, 42)).toBe(false);
  });
});

describe('token helpers', () => {
  it('mints unique ntk_ tokens and u_ ids', () => {
    const t1 = newTokenPlaintext();
    const t2 = newTokenPlaintext();
    expect(t1.startsWith('ntk_')).toBe(true);
    expect(t1).not.toBe(t2);
    expect(newUserId().startsWith('u_')).toBe(true);
    expect(hashToken(t1)).toBe(createHash('sha256').update(t1, 'utf8').digest('hex'));
    expect(hashAnswer('hello', SALT)).toBe(
      scryptSync('hello', Buffer.from(SALT, 'hex'), 64).toString('hex'),
    );
  });

  it('validates session-id shape ([A-Za-z0-9_-]{16,64})', () => {
    expect(isValidSessionId('Abc123_-xyzABC45')).toBe(true);
    expect(isValidSessionId('short')).toBe(false);
    expect(isValidSessionId('x'.repeat(65))).toBe(false);
    expect(isValidSessionId('has space here 12345')).toBe(false);
    expect(isValidSessionId(123)).toBe(false);
  });
});
