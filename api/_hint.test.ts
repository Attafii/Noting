import type { VercelRequest, VercelResponse } from '@vercel/node';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { dataQuery, mockRateLimit } = vi.hoisted(() => ({
  dataQuery: vi.fn(),
  mockRateLimit: vi.fn(),
}));

vi.mock('../src/lib/db', () => ({
  getSql: () => ({ query: dataQuery }),
}));

vi.mock('./_ratelimit', () => ({
  enforceRateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

import hintHandler from './hint';
import questionHandler from './token-question';

const SESSION = 'Abc123_-xyzABC45';

function req(body: unknown): VercelRequest {
  return { method: 'POST', body, headers: {}, query: {} } as unknown as VercelRequest;
}

function res() {
  const r = {
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      r.statusCode = code;
      return r;
    },
    json(body: unknown) {
      r.body = body;
      return r;
    },
  };
  return r;
}

beforeEach(() => {
  dataQuery.mockReset();
  (mockRateLimit as Mock).mockReset();
  (mockRateLimit as Mock).mockResolvedValue(true);
});

describe('POST /api/hint (server-enforced once per session)', () => {
  it('reveals once, then 409 on double-redeem', async () => {
    dataQuery
      .mockResolvedValueOnce([{ id: 'u_1', hint: 'blue door' }]) // token lookup
      .mockResolvedValueOnce([]) // purge
      .mockResolvedValueOnce([{ token_id: 'u_1' }]); // INSERT … RETURNING
    const first = res();
    await hintHandler(req({ token: 'ntk_abc', session_id: SESSION }), first as unknown as VercelResponse);
    expect(first.statusCode).toBe(200);
    expect(first.body).toEqual({ hint: 'blue door' });

    dataQuery.mockReset();
    dataQuery
      .mockResolvedValueOnce([{ id: 'u_1', hint: 'blue door' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]); // ON CONFLICT DO NOTHING → 0 rows
    const second = res();
    await hintHandler(
      req({ token: 'ntk_abc', session_id: SESSION }),
      second as unknown as VercelResponse,
    );
    expect(second.statusCode).toBe(409);
    expect(second.body).toEqual({ error: 'Hint already shown this session' });
  });

  it('empty hints still consume the grant and return { hint: "" }', async () => {
    dataQuery
      .mockResolvedValueOnce([{ id: 'u_1', hint: '' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ token_id: 'u_1' }]);
    const r = res();
    await hintHandler(req({ token: 'ntk_abc', session_id: SESSION }), r as unknown as VercelResponse);
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ hint: '' });
  });

  it('rejects malformed session ids and unknown tokens generically', async () => {
    const bad = res();
    await hintHandler(req({ token: 'ntk_abc', session_id: 'short' }), bad as unknown as VercelResponse);
    expect(bad.statusCode).toBe(400);

    dataQuery.mockResolvedValueOnce([]);
    const unknown = res();
    await hintHandler(
      req({ token: 'ntk_unknown', session_id: SESSION }),
      unknown as unknown as VercelResponse,
    );
    expect(unknown.statusCode).toBe(404);
    expect(unknown.body).toEqual({ error: 'Not found' });
  });
});

describe('POST /api/token-question (enumeration-safe shape)', () => {
  it('returns question + hint_available for known tokens', async () => {
    dataQuery
      .mockResolvedValueOnce([{ id: 'u_1', question: 'What street?' }])
      .mockResolvedValueOnce([]); // no grant yet
    const r = res();
    await questionHandler(
      req({ token: 'ntk_abc', session_id: SESSION }),
      r as unknown as VercelResponse,
    );
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ question: 'What street?', hint_available: true });
  });

  it('reports hint_available: false after the grant, 404 for unknown', async () => {
    dataQuery
      .mockResolvedValueOnce([{ id: 'u_1', question: 'What street?' }])
      .mockResolvedValueOnce([{ '1': 1 }]); // grant exists
    const used = res();
    await questionHandler(
      req({ token: 'ntk_abc', session_id: SESSION }),
      used as unknown as VercelResponse,
    );
    expect(used.body).toEqual({ question: 'What street?', hint_available: false });

    dataQuery.mockReset();
    dataQuery.mockResolvedValueOnce([]);
    const unknown = res();
    await questionHandler(
      req({ token: 'ntk_nope', session_id: SESSION }),
      unknown as unknown as VercelResponse,
    );
    expect(unknown.statusCode).toBe(404);
    expect(unknown.body).toEqual({ error: 'Not found' });
  });
});
