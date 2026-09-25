import type { VercelRequest, VercelResponse } from '@vercel/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalSelfService = process.env.PUBLIC_SELF_SERVICE_TOKENS;

const { query, rateLimit, verifyChallenge } = vi.hoisted(() => ({
  query: vi.fn(),
  rateLimit: vi.fn(),
  verifyChallenge: vi.fn(),
}));

vi.mock('../src/lib/db', () => ({ getSql: () => ({ query }) }));
vi.mock('./_ratelimit', () => ({ enforceRateLimit: rateLimit }));
vi.mock('./_challenge', () => ({ verifyChallenge }));
vi.mock('./_turnstile', () => ({ verifyTurnstile: vi.fn().mockResolvedValue(false) }));
vi.mock('./_auth', () => ({
  hashAnswer: vi.fn(() => 'answer-hash'),
  hashToken: vi.fn(() => 'token-hash'),
  isValidSessionId: vi.fn(() => true),
  newRecoveryCode: vi.fn(() => 'rec_test_code'),
  newSaltHex: vi.fn(() => '0123456789abcdef0123456789abcdef'),
  newTokenPlaintext: vi.fn(() => 'ntk_test-token'),
  newUserId: vi.fn(() => 'u_test'),
  normalizeAnswer: vi.fn((value: string) => value.trim().toLowerCase()),
  normalizeRecoveryCode: vi.fn((value: string) => value.trim()),
}));

import handler from './_route-tokens';

function request(body: unknown) {
  return { method: 'POST', body, headers: {} } as unknown as VercelRequest;
}

function response() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(value: unknown) {
      res.body = value;
      return res;
    },
  };
  return res;
}

const validBody = {
  question: 'A question?',
  answer: 'An answer',
  challenge: { selected: 0 },
};

afterEach(() => {
  if (originalSelfService === undefined) delete process.env.PUBLIC_SELF_SERVICE_TOKENS;
  else process.env.PUBLIC_SELF_SERVICE_TOKENS = originalSelfService;
});

beforeEach(() => {
  query.mockReset();
  rateLimit.mockReset();
  verifyChallenge.mockReset();
  rateLimit.mockResolvedValue(true);
  verifyChallenge.mockReturnValue(true);
  process.env.PUBLIC_SELF_SERVICE_TOKENS = 'false';
});

describe('invite-only token creation', () => {
  it('rejects creation without an invite code', async () => {
    const res = response();
    await handler(request(validBody), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('consumes an invite and returns the one-time recovery code', async () => {
    query.mockResolvedValueOnce([{ id: 'invite-1' }]).mockResolvedValueOnce([]);
    const res = response();
    await handler(
      request({ ...validBody, invite_code: 'invite-code' }),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({
      token_plaintext: 'ntk_test-token',
      recovery_code: 'rec_test_code',
    });
    expect(query.mock.calls[0][0]).toContain('workspace_invites');
  });
});
