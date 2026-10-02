import type { VercelRequest, VercelResponse } from '@vercel/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query, rateLimit, hashToken } = vi.hoisted(() => ({
  query: vi.fn(),
  rateLimit: vi.fn(),
  hashToken: vi.fn((token: string) => `h:${token}`),
}));

vi.mock('../src/lib/db', () => ({ getSql: () => ({ query }) }));
vi.mock('./_auth', () => ({ hashToken }));
vi.mock('./_ratelimit', () => ({ enforceRateLimit: rateLimit }));

import handler from './_route-share';

function request(method: string, queryParams: Record<string, string> = {}) {
  return { method, query: queryParams, body: undefined, headers: {} } as unknown as VercelRequest;
}

function response() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    headersSent: false,
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

const VALID_TOKEN = 'a'.repeat(32);
const sharedRow = {
  title: 'Shared note',
  content: '# Hello',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  tags: ['meta'],
};

beforeEach(() => {
  query.mockReset();
  rateLimit.mockReset();
  rateLimit.mockResolvedValue(true);
  hashToken.mockClear();
});

describe('public share route', () => {
  it('rejects non-GET methods', async () => {
    const res = response();
    await handler(request('DELETE'), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(405);
    expect(query).not.toHaveBeenCalled();
  });

  it('rate-limits with a strict anon scope before any query', async () => {
    rateLimit.mockResolvedValue(false);
    const res = response();
    await handler(request('GET', { t: VALID_TOKEN }), res as unknown as VercelResponse);
    expect(rateLimit).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      limit: 30,
      scope: 'share',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('404s malformed tokens without touching the database', async () => {
    const res = response();
    await handler(request('GET', { t: 'short' }), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });

  it('looks up the sha256 of the token and returns the note', async () => {
    query.mockResolvedValueOnce([sharedRow]);
    const res = response();
    await handler(request('GET', { t: VALID_TOKEN }), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(200);
    expect(hashToken).toHaveBeenCalledWith(VALID_TOKEN);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('s.revoked_at IS NULL');
    expect(sql).toContain('s.expires_at > NOW()');
    expect(sql).toContain('n.enc = FALSE');
    expect(params).toEqual([`h:${VALID_TOKEN}`]);
    expect(res.body).toEqual({
      title: 'Shared note',
      content: '# Hello',
      created_at: sharedRow.created_at,
      updated_at: sharedRow.updated_at,
      tags: ['meta'],
    });
  });

  it('answers unknown, expired, and revoked links with the same 404', async () => {
    query.mockResolvedValueOnce([]);
    const res = response();
    await handler(request('GET', { t: VALID_TOKEN }), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('maps database failures to a 500', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    const res = response();
    await handler(request('GET', { t: VALID_TOKEN }), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(500);
  });
});
