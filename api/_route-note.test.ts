import type { VercelRequest, VercelResponse } from '@vercel/node';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { query, requireUser, rateLimit } = vi.hoisted(() => ({
  query: vi.fn(),
  requireUser: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('../src/lib/db', () => ({ getSql: () => ({ query }) }));
vi.mock('./_auth', () => ({ requireUser }));
vi.mock('./_ratelimit', () => ({ enforceRateLimit: rateLimit }));

import handler from './_route-note';

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
const row = {
  id: 7,
  title: 'Note',
  content: 'old',
  pinned: false,
  archived: false,
  enc: false,
  content_version: 3,
  folder_id: null,
  favorite: false,
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  query.mockReset();
  (requireUser as Mock).mockReset();
  (requireUser as Mock).mockResolvedValue(userId);
  (rateLimit as Mock).mockReset();
  (rateLimit as Mock).mockResolvedValue(true);
});

describe('note route', () => {
  it('does not default to note 1', async () => {
    const res = response();
    await handler(request('GET'), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires a content version for writes', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([row]);
    const res = response();
    await handler(
      request('POST', {}, { id: 7, content: 'next' }),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(400);
  });

  it('uses an atomic version predicate and returns the new version', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([
        {
          ...row,
          content: 'next',
          content_version: 4,
        },
      ]);
    const res = response();
    await handler(
      request(
        'POST',
        {},
        { id: 7, content: 'next', base_version: 3, mutation_id: 'm_1234567890123456' },
      ),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(200);
    const update = query.mock.calls[2] as [string, unknown[]];
    expect(update[0]).toContain('content_version = current.content_version + 1');
    expect(update[0]).toContain('FOR UPDATE');
    expect(update[1]).toEqual([7, userId, 3, 'next', false, 'm_1234567890123456']);
  });

  it('rejects stale versions without writing', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([row]);
    const res = response();
    await handler(
      request(
        'POST',
        {},
        { id: 7, content: 'next', base_version: 2, mutation_id: 'm_1234567890123456' },
      ),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(409);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('rejects encrypted downgrades', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...row, enc: true }]);
    const res = response();
    await handler(
      request(
        'POST',
        {},
        { id: 7, content: 'plain', base_version: 3, enc: false, mutation_id: 'm_1234567890123456' },
      ),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(409);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
