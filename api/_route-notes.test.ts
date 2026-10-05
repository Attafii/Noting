import type { VercelRequest, VercelResponse } from '@vercel/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query, requireUser, rateLimit } = vi.hoisted(() => ({
  query: vi.fn(),
  requireUser: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('../src/lib/db', () => ({ getSql: () => ({ query }) }));
vi.mock('./_auth', () => ({ requireUser }));
vi.mock('./_ratelimit', () => ({ enforceRateLimit: rateLimit }));
vi.mock('./_quota', () => ({
  checkNoteQuota: vi.fn(),
  QuotaError: class QuotaError extends Error {},
}));

import handler from './_route-notes';

function request(method: string, body?: unknown) {
  return { method, query: {}, body, headers: {} } as unknown as VercelRequest;
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

const updatedRow = {
  id: 7,
  title: 'Note',
  content: '',
  pinned: false,
  archived: false,
  enc: false,
  content_version: 1,
  folder_id: null,
  favorite: false,
  due_at: null,
  status: 'doing',
  recurrence: 'weekly',
  snoozed_until: null,
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  query.mockReset();
  requireUser.mockReset();
  requireUser.mockResolvedValue('u_test');
  rateLimit.mockReset();
  rateLimit.mockResolvedValue(true);
});

describe('PATCH /api/notes productivity fields', () => {
  it('rejects an unknown status without touching the database', async () => {
    const res = response();
    await handler(request('PATCH', { id: 7, status: 'blocked' }), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an unknown recurrence without touching the database', async () => {
    const res = response();
    await handler(
      request('PATCH', { id: 7, recurrence: 'hourly' }),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a malformed snoozed_until', async () => {
    const res = response();
    await handler(
      request('PATCH', { id: 7, snoozed_until: 'tomorrow-ish' }),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('persists status, recurrence, and snooze as metadata params', async () => {
    query.mockResolvedValueOnce([updatedRow]).mockResolvedValueOnce([]); // tag reload
    const res = response();
    await handler(
      request('PATCH', {
        id: 7,
        status: 'doing',
        recurrence: 'weekly',
        snoozed_until: '2026-10-06T09:00:00.000Z',
      }),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(200);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('status = CASE WHEN $12');
    expect(sql).toContain('recurrence = CASE WHEN $14');
    expect(sql).toContain('snoozed_until = CASE WHEN $16');
    // updated_at only moves for title/pinned/archived ($3/$4/$5) — never here.
    expect(sql).toContain(
      'updated_at = CASE WHEN $3 IS NOT NULL OR $4 IS NOT NULL OR $5 IS NOT NULL THEN NOW() ELSE updated_at END',
    );
    expect(params.slice(11, 17)).toEqual([
      true,
      'doing',
      true,
      'weekly',
      true,
      '2026-10-06T09:00:00.000Z',
    ]);
  });

  it('clears a snooze with null', async () => {
    query.mockResolvedValueOnce([updatedRow]).mockResolvedValueOnce([]);
    const res = response();
    await handler(
      request('PATCH', { id: 7, snoozed_until: null }),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(200);
    const [, params] = query.mock.calls[0];
    expect(params[15]).toBe(true);
    expect(params[16]).toBeNull();
  });
});
