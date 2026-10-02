import type { VercelRequest, VercelResponse } from '@vercel/node';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { query, requireUser, rateLimit, hashToken } = vi.hoisted(() => ({
  query: vi.fn(),
  requireUser: vi.fn(),
  rateLimit: vi.fn(),
  hashToken: vi.fn((token: string) => `h:${token}`),
}));

vi.mock('../src/lib/db', () => ({ getSql: () => ({ query }) }));
vi.mock('./_auth', () => ({ requireUser, hashToken }));
vi.mock('./_ratelimit', () => ({ enforceRateLimit: rateLimit }));

import handler from './_route-shares';

function request(method: string, queryParams: Record<string, string> = {}, body?: unknown) {
  return {
    method,
    query: queryParams,
    body,
    headers: {},
  } as unknown as VercelRequest;
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

const userId = 'u_test';

beforeEach(() => {
  query.mockReset();
  (requireUser as Mock).mockReset();
  (requireUser as Mock).mockResolvedValue(userId);
  (rateLimit as Mock).mockReset();
  (rateLimit as Mock).mockResolvedValue(true);
  hashToken.mockClear();
});

describe('shares route', () => {
  it('requires authentication before rate limiting', async () => {
    (requireUser as Mock).mockResolvedValue(null);
    const res = response();
    await handler(request('GET'), res as unknown as VercelResponse);
    expect(rateLimit).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('applies the share rate scope', async () => {
    query.mockResolvedValueOnce([]);
    await handler(request('GET'), response() as unknown as VercelResponse);
    expect(rateLimit).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      limit: 20,
      scope: 'share',
    });
  });

  it('lists only the caller links', async () => {
    query.mockResolvedValueOnce([{ id: 's1', note_id: 7 }]);
    const res = response();
    await handler(request('GET'), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(200);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('s.user_id = $1');
    expect(params).toEqual([userId]);
  });

  it('filters the list by note_id when given', async () => {
    query.mockResolvedValueOnce([]);
    await handler(request('GET', { note_id: '7' }), response() as unknown as VercelResponse);
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([userId, 7]);
  });

  it('rejects a malformed note_id on mint', async () => {
    const res = response();
    await handler(request('POST', {}, { note_id: 'x' }), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects days outside 1..30', async () => {
    const res = response();
    await handler(request('POST', {}, { note_id: 7, days: 90 }), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('answers missing, encrypted, and trashed notes with one 404', async () => {
    query.mockResolvedValueOnce([]);
    const res = response();
    await handler(request('POST', {}, { note_id: 7 }), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(404);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toContain('enc = FALSE');
    expect(sql).toContain('deleted_at IS NULL');
  });

  it('mints a link: plaintext token once, sha256 stored', async () => {
    query.mockResolvedValueOnce([{ id: 7 }]).mockResolvedValueOnce([]);
    const res = response();
    await handler(request('POST', {}, { note_id: 7, days: 7 }), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(201);
    const body = res.body as { id: string; token: string; expires_at: string };
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    const insert = query.mock.calls[1] as [string, unknown[]];
    expect(insert[0]).toContain('INSERT INTO share_links');
    expect(insert[1][0]).toBe(body.id);
    expect(insert[1][1]).toBe(7);
    expect(insert[1][2]).toBe(userId);
    expect(insert[1][3]).toBe(`h:${body.token}`);
    // Token never reappears in the list columns.
    const list = query.mock.calls[0] as [string];
    expect(list[0]).not.toContain('token_hash');
  });

  it('requires an id to revoke', async () => {
    const res = response();
    await handler(request('DELETE'), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(400);
  });

  it('404s revoking someone else link (no id oracle)', async () => {
    query.mockResolvedValueOnce([]);
    const res = response();
    const foreignId = '11111111-2222-3333-4444-555555555555';
    await handler(request('DELETE', { id: foreignId }), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(404);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('revoked_at = NOW()');
    expect(params).toEqual([foreignId, userId]);
  });

  it('rejects a non-UUID revoke id', async () => {
    const res = response();
    await handler(request('DELETE', { id: '999' }), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('revokes an owned link', async () => {
    query.mockResolvedValueOnce([{ id: 's1' }]);
    const res = response();
    const shareId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await handler(request('DELETE', { id: shareId }), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('rejects unsupported methods', async () => {
    const res = response();
    await handler(request('PATCH'), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(405);
  });
});
