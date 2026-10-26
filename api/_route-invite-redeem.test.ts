import type { VercelRequest, VercelResponse } from '@vercel/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query, rateLimit, verifyChallenge } = vi.hoisted(() => ({
  query: vi.fn(),
  rateLimit: vi.fn(),
  verifyChallenge: vi.fn(),
}));

vi.mock('../src/lib/db', () => ({ getSql: vi.fn(() => ({ query })) }));
vi.mock('./_ratelimit', () => ({ enforceRateLimit: rateLimit }));
vi.mock('./_challenge', () => ({ verifyChallenge }));
vi.mock('./_turnstile', () => ({ verifyTurnstile: vi.fn().mockResolvedValue(false) }));
vi.mock('./_auth', () => ({
  hashToken: vi.fn(() => 'invite-hash'),
}));

import handler from './_route-invite-redeem';

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
  invite_code: 'inv_some-valid-code',
  challenge: { selected: 0 },
};

beforeEach(() => {
  query.mockReset();
  rateLimit.mockReset();
  verifyChallenge.mockReset();
  rateLimit.mockResolvedValue(true);
  verifyChallenge.mockReturnValue(true);
});

describe('invite redemption', () => {
  it('rejects non-POST methods', async () => {
    const res = response();
    await handler(
      { method: 'GET', body: {}, headers: {} } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(405);
  });

  it('rejects when the human-check fails', async () => {
    verifyChallenge.mockReturnValue(false);
    const res = response();
    await handler(request(validBody), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a missing or too-short code', async () => {
    for (const code of [undefined, '', 'inv', 'x'.repeat(7)]) {
      const res = response();
      await handler(request({ ...validBody, invite_code: code }), res as unknown as VercelResponse);
      expect(res.statusCode).toBe(400);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('consumes a valid code and acknowledges success', async () => {
    query.mockResolvedValueOnce([{ id: 1 }]);
    const res = response();
    await handler(request(validBody), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // Single-use atomic consume — no code or hash leaks in the response.
    expect(query.mock.calls[0][0]).toContain('UPDATE workspace_invites');
    expect(query.mock.calls[0][0]).toContain('used_at IS NULL');
  });

  it('answers one generic error for unknown, used, and expired codes', async () => {
    query.mockResolvedValueOnce([]); // no row flipped → invalid/used/expired
    const res = response();
    await handler(request(validBody), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Invite code is invalid or expired' });
  });

  it('answers 503 when the invite store is unreachable', async () => {
    query.mockRejectedValueOnce(new Error('connection terminated'));
    const res = response();
    await handler(request(validBody), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(503);
  });

  it('answers 503 when the database is not configured', async () => {
    const { getSql } = await import('../src/lib/db');
    vi.mocked(getSql).mockImplementationOnce(() => {
      throw new Error('NEON_CONNECTION_STRING missing');
    });
    const res = response();
    await handler(request(validBody), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(503);
  });
});
