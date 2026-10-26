import type { VercelRequest, VercelResponse } from '@vercel/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { query, rateLimit, resolveAuth } = vi.hoisted(() => ({
  query: vi.fn(),
  rateLimit: vi.fn(),
  resolveAuth: vi.fn(),
}));

vi.mock('../src/lib/db', () => ({ getSql: vi.fn(() => ({ query })) }));
vi.mock('./_ratelimit', () => ({ enforceRateLimit: rateLimit }));
vi.mock('./_auth', () => ({
  hashToken: vi.fn(() => 'invite-hash'),
  resolveAuth,
}));

import handler from './_route-invites';

function request(method: string, body?: unknown, headers: Record<string, string> = {}) {
  return { method, body: body ?? {}, headers } as unknown as VercelRequest;
}

function response() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(value: unknown) {
      res.body = value;
      return res;
    },
    setHeader(key: string, value: string) {
      res.headers[key] = value;
      return res;
    },
  };
  return res;
}

beforeEach(() => {
  query.mockReset();
  rateLimit.mockReset();
  resolveAuth.mockReset();
  rateLimit.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('invite admin (GET/POST /api/invites)', () => {
  it('is invisible to anonymous visitors', async () => {
    resolveAuth.mockResolvedValue(null);
    const res = response();
    await handler(request('GET'), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });

  it('is invisible to regular user sessions', async () => {
    resolveAuth.mockResolvedValue({ userId: 'u_someone' });
    const res = response();
    await handler(request('POST', { valid_days: 7 }), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });

  it('lists invites for the admin without leaking code hashes', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-10T12:00:00Z') });
    resolveAuth.mockResolvedValue({ admin: true });
    query.mockResolvedValueOnce([
      {
        id: 1,
        created_at: '2026-01-01T00:00:00Z',
        expires_at: '2026-02-01T00:00:00Z',
        used_at: null,
      },
      {
        id: 2,
        created_at: '2026-01-01T00:00:00Z',
        expires_at: '2026-01-05T00:00:00Z',
        used_at: null,
      },
      {
        id: 3,
        created_at: '2026-01-01T00:00:00Z',
        expires_at: '2026-02-01T00:00:00Z',
        used_at: '2026-01-02T00:00:00Z',
      },
    ]);
    const res = response();
    await handler(request('GET'), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(200);
    const body = res.body as { invites: Array<{ id: number; status: string }> };
    expect(body.invites.map((i) => i.status)).toEqual(['active', 'expired', 'used']);
    expect(JSON.stringify(res.body)).not.toContain('code_hash');
  });

  it('creates an invite with a default of 30 days and returns the code once', async () => {
    resolveAuth.mockResolvedValue({ admin: true });
    query.mockResolvedValueOnce([{ expires_at: '2026-02-09T12:00:00Z' }]);
    const res = response();
    await handler(request('POST', {}), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(201);
    const body = res.body as { code: string; valid_days: number };
    expect(body.code).toMatch(/^inv_[A-Za-z0-9_-]{10,}$/);
    expect(body.valid_days).toBe(30);
    // Only the hash is stored, never the plaintext code.
    expect(query.mock.calls[0][0]).toContain('INSERT INTO workspace_invites');
    expect(query.mock.calls[0][1]).toEqual(['invite-hash', 30]);
  });

  it('accepts a custom valid_days within bounds', async () => {
    resolveAuth.mockResolvedValue({ admin: true });
    query.mockResolvedValueOnce([{ expires_at: '2026-01-11T12:00:00Z' }]);
    const res = response();
    await handler(request('POST', { valid_days: 7 }), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(201);
    expect(query.mock.calls[0][1]).toEqual(['invite-hash', 7]);
  });

  it('rejects out-of-range or malformed valid_days', async () => {
    resolveAuth.mockResolvedValue({ admin: true });
    for (const validDays of [0, -1, 366, 1.5, 'many', null]) {
      const res = response();
      await handler(request('POST', { valid_days: validDays }), res as unknown as VercelResponse);
      expect(res.statusCode).toBe(400);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects unsupported methods', async () => {
    resolveAuth.mockResolvedValue({ admin: true });
    const res = response();
    await handler(request('DELETE'), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(405);
  });
});
