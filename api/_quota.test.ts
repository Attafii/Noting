import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../src/lib/db', () => ({ getSql: () => ({ query }) }));

import { checkStorageQuota, consumeAiBudget } from './_quota';

beforeEach(() => {
  query.mockReset();
  delete process.env.MAX_STORAGE_BYTES;
  delete process.env.MAX_FILE_COUNT;
  delete process.env.MAX_AI_CALLS_PER_DAY;
});

describe('workspace quotas', () => {
  it('rejects a file that would exceed storage', async () => {
    process.env.MAX_STORAGE_BYTES = '10';
    query.mockResolvedValue([{ count: 1, bytes: 8 }]);
    await expect(checkStorageQuota('u_test', 4)).rejects.toMatchObject({
      status: 413,
      code: 'STORAGE_QUOTA',
    });
  });

  it('rejects AI calls after the daily budget', async () => {
    process.env.MAX_AI_CALLS_PER_DAY = '1';
    query.mockResolvedValue([]);
    await expect(consumeAiBudget('u_test')).rejects.toMatchObject({
      status: 429,
      code: 'AI_QUOTA',
    });
  });

  it('accepts usage below both limits', async () => {
    process.env.MAX_STORAGE_BYTES = '100';
    process.env.MAX_FILE_COUNT = '10';
    process.env.MAX_AI_CALLS_PER_DAY = '2';
    query.mockResolvedValueOnce([{ count: 1, bytes: 8 }]).mockResolvedValueOnce([{ calls: 1 }]);
    await expect(checkStorageQuota('u_test', 4)).resolves.toBeUndefined();
    await expect(consumeAiBudget('u_test')).resolves.toBeUndefined();
  });
});
