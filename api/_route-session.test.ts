import type { VercelRequest, VercelResponse } from '@vercel/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query, verify, verifyRecovery, rateLimit, sessionId } = vi.hoisted(() => ({
  query: vi.fn(),
  verify: vi.fn(),
  verifyRecovery: vi.fn(),
  rateLimit: vi.fn(),
  sessionId: vi.fn(),
}));

vi.mock('./_auth', () => ({
  SESSION_COOKIE: 'noting_session',
  SESSION_TTL_MS: 1000,
  getSessionIdFromRequest: sessionId,
  hashSessionId: (value: string) => `hash-${value}`,
  newSessionId: () => 'sess_12345678901234567890123456789012',
  verifyTokenAnswer: verify,
  verifyRecoveryCode: verifyRecovery,
}));
vi.mock('./_ratelimit', () => ({ enforceRateLimit: rateLimit }));
vi.mock('../src/lib/db', () => ({ getSql: () => ({ query }) }));

import handler from './_route-session';

function request(method: string, body?: unknown, cookie?: string) {
  return {
    method,
    body,
    headers: cookie ? { cookie } : {},
  } as unknown as VercelRequest;
}

function response() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    headers: {} as Record<string, string>,
    ended: false,
    setHeader(key: string, value: string) {
      res.headers[key] = value;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(value: unknown) {
      res.body = value;
      return res;
    },
    end() {
      res.ended = true;
      return res;
    },
  };
  return res;
}

beforeEach(() => {
  query.mockReset();
  verify.mockReset();
  verifyRecovery.mockReset();
  rateLimit.mockReset();
  sessionId.mockReset();
  rateLimit.mockResolvedValue(true);
  verify.mockResolvedValue('u_test');
  verifyRecovery.mockResolvedValue('u_test');
});

describe('workspace sessions', () => {
  it('exchanges credentials for an HttpOnly cookie', async () => {
    query.mockResolvedValue([]);
    const res = response();
    await handler(
      request('POST', { token: 'ntk_test', answer: 'answer' }),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['Set-Cookie']).toContain('HttpOnly');
    expect(res.headers['Set-Cookie']).toContain('SameSite=Strict');
    expect(res.body).toMatchObject({ user_id: 'u_test' });
  });

  it('revokes the current session on lock', async () => {
    sessionId.mockReturnValue('sess_12345678901234567890123456789012');
    query.mockResolvedValue([]);
    const res = response();
    await handler(
      request('DELETE', undefined, 'noting_session=sess_12345678901234567890123456789012'),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(res.headers['Set-Cookie']).toContain('Max-Age=0');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('revoked_at'), [
      'hash-sess_12345678901234567890123456789012',
    ]);
  });

  it('accepts a recovery code without exposing the security answer', async () => {
    query.mockResolvedValue([]);
    const res = response();
    await handler(
      request('POST', { token: 'ntk_test', recovery_code: 'rec_test' }),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(200);
    expect(verifyRecovery).toHaveBeenCalledWith('ntk_test', 'rec_test');
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects invalid credentials without creating a session', async () => {
    verify.mockResolvedValue(null);
    const res = response();
    await handler(
      request('POST', { token: 'ntk_test', answer: 'wrong' }),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});
