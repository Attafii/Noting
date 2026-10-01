import type { VercelRequest, VercelResponse } from '@vercel/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../src/lib/db', () => ({ getSql: () => ({ query }) }));

import handler from './_route-cron-purge';

const SECRET = 'c'.repeat(64);

function request(method: string, authorization?: string) {
  return {
    method,
    headers: authorization ? { authorization } : {},
  } as unknown as VercelRequest;
}

function response() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    setHeader() {},
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(value: unknown) {
      res.body = value;
      return res;
    },
    end() {
      return res;
    },
  };
  return res;
}

async function get(authorization?: string) {
  const res = response();
  await handler(request('GET', authorization), res as unknown as VercelResponse);
  return res;
}

const originalSecret = process.env.CRON_SECRET;

beforeEach(() => {
  query.mockReset();
  process.env.CRON_SECRET = SECRET;
  // Each DELETE RETURNs its rows (neon query() resolves to the row array);
  // lengths become the reported counts.
  query.mockResolvedValue([{ '?column?': 1 }, { '?column?': 1 }, { '?column?': 1 }]);
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe('cron purge route', () => {
  it('rejects non-GET methods', async () => {
    const res = response();
    await handler(request('POST', `Bearer ${SECRET}`), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(405);
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed with 503 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await get(`Bearer ${SECRET}`);
    expect(res.statusCode).toBe(503);
    expect(query).not.toHaveBeenCalled();
  });

  it('401s a missing bearer header', async () => {
    const res = await get();
    expect(res.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('401s a wrong bearer token', async () => {
    const res = await get('Bearer not-the-secret');
    expect(res.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('401s a non-Bearer scheme even with the right value', async () => {
    const res = await get(SECRET);
    expect(res.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('purges every retention table and reports row counts', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValue([{}, {}]);
    const res = await get(`Bearer ${SECRET}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      purged: {
        notes: 0,
        documents: 2,
        hint_grants: 2,
        rate_limit_buckets: 2,
        auth_sessions: 2,
        workspace_invites: 2,
      },
    });
    expect(query).toHaveBeenCalledTimes(6);
  });

  it('uses the documented retention windows (keep in sync with purge-retention.cjs)', async () => {
    await get(`Bearer ${SECRET}`);
    const statements = query.mock.calls.map((call) => String(call[0]));
    expect(statements.filter((s) => s.includes("INTERVAL '30 days'"))).toHaveLength(3);
    expect(statements.filter((s) => s.includes("INTERVAL '2 hours'"))).toHaveLength(1);
    expect(statements.filter((s) => s.includes("INTERVAL '1 day'"))).toHaveLength(2);
    for (const statement of statements) expect(statement).toContain('RETURNING 1');
  });

  it('maps a database failure to 503', async () => {
    query.mockRejectedValue(new Error('db down'));
    const res = await get(`Bearer ${SECRET}`);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ error: 'Retention purge failed' });
  });
});
