import type { VercelRequest, VercelResponse } from '@vercel/node';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { dataQuery, mockRequireUser, mockRateLimit } = vi.hoisted(() => ({
  dataQuery: vi.fn(),
  mockRequireUser: vi.fn(),
  mockRateLimit: vi.fn(),
}));

vi.mock('../src/lib/db', () => ({
  getSql: () => ({ query: dataQuery }),
}));

vi.mock('./_ratelimit', () => ({
  enforceRateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

vi.mock('./_auth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./_auth')>();
  return { ...mod, requireUser: mockRequireUser };
});

import notesHandler from './_route-notes';
import noteHandler from './_route-note';
import foldersHandler from './_route-folders';
import documentsHandler from './_route-documents';
import downloadHandler from './_route-download';
import revisionsHandler from './_route-revisions';
import usageHandler from './_route-usage';

function req(
  method: string,
  opts: { query?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {},
): VercelRequest {
  return {
    method,
    query: opts.query ?? {},
    body: opts.body,
    headers: opts.headers ?? { 'x-bridge-token': 'ntk_A', 'x-bridge-answer': 'answer-a' },
  } as unknown as VercelRequest;
}

function res() {
  const r = {
    statusCode: 0,
    body: null as unknown,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      r.headers[k] = v;
    },
    status(code: number) {
      r.statusCode = code;
      return r;
    },
    json(body: unknown) {
      r.body = body;
      return r;
    },
    end(_body?: unknown) {
      return r;
    },
  };
  return r;
}

const USER_A = 'u_aaaaaaaaaaaaaaaaaaaaaa';

beforeEach(() => {
  dataQuery.mockReset();
  (mockRequireUser as Mock).mockReset();
  (mockRequireUser as Mock).mockResolvedValue(USER_A);
  (mockRateLimit as Mock).mockReset();
  (mockRateLimit as Mock).mockResolvedValue(true);
});

describe('per-user isolation: every query is scoped to the caller', () => {
  it('notes GET scopes to user_id', async () => {
    dataQuery.mockResolvedValue([]);
    const r = res();
    await notesHandler(req('GET'), r as unknown as VercelResponse);
    expect(r.statusCode).toBe(200);
    const lastCall = dataQuery.mock.calls[dataQuery.mock.calls.length - 1] as [string, unknown[]];
    expect(String(lastCall[0])).toContain('user_id');
    expect(lastCall[1]).toContain(USER_A);
  });

  it("A cannot PATCH B's note → 404 (never 403)", async () => {
    dataQuery.mockResolvedValue([]); // ensure cols + UPDATE … WHERE id AND user_id → 0 rows
    const r = res();
    await notesHandler(
      req('PATCH', { body: { id: 99, title: 'hijack' } }),
      r as unknown as VercelResponse,
    );
    expect(r.statusCode).toBe(404);
    expect(r.body).toEqual({ error: 'Note not found' });
  });

  it("A cannot GET B's note → 404", async () => {
    dataQuery.mockResolvedValueOnce([]);
    const r = res();
    await noteHandler(req('GET', { query: { id: '7' } }), r as unknown as VercelResponse);
    expect(r.statusCode).toBe(404);
    const [, params] = dataQuery.mock.calls[0];
    expect(params).toEqual([7, USER_A]);
  });

  it('folders GET counts only the caller’s notes', async () => {
    dataQuery.mockResolvedValue([]);
    const r = res();
    await foldersHandler(req('GET'), r as unknown as VercelResponse);
    expect(r.statusCode).toBe(200);
    const lastCall = dataQuery.mock.calls[dataQuery.mock.calls.length - 1] as [string, unknown[]];
    expect(String(lastCall[0])).toContain('f.user_id');
    expect(lastCall[1]).toContain(USER_A);
  });

  it("A cannot DELETE B's folder → 404", async () => {
    dataQuery
      .mockResolvedValueOnce([]) // CREATE TABLE (best-effort)
      .mockResolvedValueOnce([]) // ALTER TABLE
      .mockResolvedValueOnce([]) // UPDATE notes (unfile)
      .mockResolvedValueOnce([]); // DELETE … WHERE id AND user_id → 0 rows
    const r = res();
    await foldersHandler(req('DELETE', { query: { id: '3' } }), r as unknown as VercelResponse);
    expect(r.statusCode).toBe(404);
  });

  it('documents GET scopes to user_id', async () => {
    dataQuery.mockResolvedValueOnce([]);
    const r = res();
    await documentsHandler(req('GET'), r as unknown as VercelResponse);
    expect(r.statusCode).toBe(200);
    const [text, params] = dataQuery.mock.calls[0];
    expect(String(text)).toContain('user_id');
    expect(params).toContain(USER_A);
  });

  it("A cannot download B's file → 404", async () => {
    dataQuery.mockResolvedValueOnce([]);
    const r = res();
    await downloadHandler(req('GET', { query: { id: '5' } }), r as unknown as VercelResponse);
    expect(r.statusCode).toBe(404);
  });

  it("A cannot read B's revisions → 404 (owner join)", async () => {
    dataQuery.mockResolvedValueOnce([]); // owner check → 0 rows
    const r = res();
    await revisionsHandler(
      req('GET', { query: { note_id: '9' } }),
      r as unknown as VercelResponse,
    );
    expect(r.statusCode).toBe(404);
    const [text, params] = dataQuery.mock.calls[0];
    expect(String(text)).toContain('user_id');
    expect(params).toEqual([9, USER_A]);
  });

  it('usage aggregates are all scoped to the caller', async () => {
    dataQuery
      .mockResolvedValueOnce([{ count: 0, bytes: 0 }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ count: 0, bytes: 0 }])
      .mockResolvedValueOnce([{ count: 0 }]);
    const r = res();
    await usageHandler(req('GET'), r as unknown as VercelResponse);
    expect(r.statusCode).toBe(200);
    expect(dataQuery).toHaveBeenCalledTimes(4);
    for (const [text, params] of dataQuery.mock.calls) {
      expect(String(text)).toContain('user_id');
      expect(params).toEqual([USER_A]);
    }
  });

  it('blind admin never reaches data (requireUser gate)', async () => {
    (mockRequireUser as Mock).mockResolvedValueOnce(null);
    const r = res();
    await notesHandler(req('GET'), r as unknown as VercelResponse);
    // Handler stops when requireUser returns null (it already sent 404/401).
    expect(dataQuery).not.toHaveBeenCalled();
  });
});
