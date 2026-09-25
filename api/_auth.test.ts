import type { VercelRequest, VercelResponse } from '@vercel/node';
import { scryptSync, createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../src/lib/db', () => ({
  getSql: () => ({ query: mockQuery }),
}));

import {
  clearAuthCache,
  clearChallengeNonces,
  hashAnswer,
  hashToken,
  isValidSessionId,
  issueChallenge,
  newRecoveryCode,
  newTokenPlaintext,
  newUserId,
  normalizeAnswer,
  requireUser,
  resolveAuth,
  signChallenge,
  unauthorizedResponse,
  verifyChallenge,
  verifyRecoveryCode,
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

describe('recovery codes', () => {
  const recovery = 'rec_example-code';

  beforeEach(() => {
    mockQuery.mockReset();
    clearAuthCache();
  });

  it('creates a high-entropy recovery code', () => {
    const code = newRecoveryCode();
    expect(code).toMatch(/^rec_[A-Za-z0-9_-]{20,}$/);
  });

  it('verifies a recovery code against its stored hash', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 'u_test123',
          recovery_hash: hashAnswer(normalizeAnswer(recovery), SALT),
          recovery_salt: SALT,
        },
      ])
      .mockResolvedValueOnce([]);
    await expect(verifyRecoveryCode(TOKEN, recovery)).resolves.toBe('u_test123');
  });

  it('rejects an incorrect recovery code', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'u_test123',
        recovery_hash: hashAnswer(normalizeAnswer(recovery), SALT),
        recovery_salt: SALT,
      },
    ]);
    await expect(verifyRecoveryCode(TOKEN, 'rec_wrong-code')).resolves.toBeNull();
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
    const userId = await requireUser(fakeReq('ntk_bad', 'nope'), res as unknown as VercelResponse);
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

describe('challenge (visual human-check)', () => {
  beforeEach(() => {
    process.env.GLOBAL_SECRET_TOKEN = 'secret-123';
    clearChallengeNonces();
  });

  /** Recover the HMAC-bound target index without consuming the nonce. */
  function targetOf(ch: { nonce: string; expires_at: number; sig: string }): number {
    for (let i = 0; i < 6; i++) {
      if (signChallenge(ch.nonce, i, ch.expires_at) === ch.sig) return i;
    }
    throw new Error('no target index matches — signer/verifier diverged');
  }

  const human = { elapsedMs: 1500, honeypot: '', interactions: 5 };

  it('issues a 6-tile signed challenge that verifies with the target index', () => {
    const ch = issueChallenge();
    expect(ch.tiles).toHaveLength(6);
    expect(typeof ch.instruction).toBe('string');
    expect(ch.instruction.length).toBeGreaterThan(0);
    expect(ch.question).toBe(ch.instruction);
    const target = targetOf(ch);
    expect(verifyChallenge(ch.nonce, ch.expires_at, ch.sig, target, human)).toBe(true);
  });

  it('rejects wrong indices, tampered sigs, and expiries', () => {
    const ch = issueChallenge();
    const target = targetOf(ch);
    const wrong = (target + 1) % 6;
    expect(verifyChallenge(ch.nonce, ch.expires_at, ch.sig, wrong, human)).toBe(false);
    expect(verifyChallenge(ch.nonce, ch.expires_at, 'deadbeef', target, human)).toBe(false);
    expect(verifyChallenge(ch.nonce, Date.now() - 1000, ch.sig, target, human)).toBe(false);
    expect(verifyChallenge(ch.nonce, ch.expires_at, ch.sig, 99, human)).toBe(false);
    // Signature bound to a different secret fails.
    const other = signChallenge(ch.nonce, target, ch.expires_at);
    process.env.GLOBAL_SECRET_TOKEN = 'different-secret';
    expect(verifyChallenge(ch.nonce, ch.expires_at, other, target, human)).toBe(false);
  });

  it('rejects instant submits, missing timing, honeypots, and zero-interaction speedruns', () => {
    const fast = { elapsedMs: 120, honeypot: '', interactions: 5 };
    const ch1 = issueChallenge();
    expect(verifyChallenge(ch1.nonce, ch1.expires_at, ch1.sig, targetOf(ch1), fast)).toBe(false);

    const ch2 = issueChallenge();
    expect(
      verifyChallenge(ch2.nonce, ch2.expires_at, ch2.sig, targetOf(ch2), {
        honeypot: '',
        interactions: 5,
      }),
    ).toBe(false);

    const ch3 = issueChallenge();
    expect(
      verifyChallenge(ch3.nonce, ch3.expires_at, ch3.sig, targetOf(ch3), {
        ...human,
        honeypot: 'http://spam.example',
      }),
    ).toBe(false);

    const ch4 = issueChallenge();
    expect(
      verifyChallenge(ch4.nonce, ch4.expires_at, ch4.sig, targetOf(ch4), {
        elapsedMs: 900,
        honeypot: '',
        interactions: 0,
      }),
    ).toBe(false);
  });

  it('is single-use: a correct solution cannot be replayed', () => {
    const ch = issueChallenge();
    const target = targetOf(ch);
    expect(verifyChallenge(ch.nonce, ch.expires_at, ch.sig, target, human)).toBe(true);
    expect(verifyChallenge(ch.nonce, ch.expires_at, ch.sig, target, human)).toBe(false);
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
