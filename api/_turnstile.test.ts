import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyTurnstile } from './_turnstile';

const REAL_SECRET = process.env.TURNSTILE_SECRET_KEY;
const REAL_HOSTS = process.env.TURNSTILE_ALLOWED_HOSTNAMES;

function siteverify(body: unknown, ok = true) {
  return {
    ok,
    json: () => Promise.resolve(body),
  };
}

beforeEach(() => {
  process.env.TURNSTILE_SECRET_KEY = 'test-secret';
  delete process.env.TURNSTILE_ALLOWED_HOSTNAMES;
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (REAL_SECRET === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = REAL_SECRET;
  if (REAL_HOSTS === undefined) delete process.env.TURNSTILE_ALLOWED_HOSTNAMES;
  else process.env.TURNSTILE_ALLOWED_HOSTNAMES = REAL_HOSTS;
});

describe('verifyTurnstile (fallback branch)', () => {
  it('accepts a fresh success for an allowlisted hostname', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      siteverify({
        success: true,
        hostname: 'noting-notes.vercel.app',
        challenge_ts: new Date().toISOString(),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(verifyTurnstile('valid-client-token')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects upstream failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          siteverify({ success: false, 'error-codes': ['invalid-input-response'] }),
        ),
    );
    await expect(verifyTurnstile('bogus-token')).resolves.toBe(false);
  });

  it('rejects hostname mismatches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        siteverify({
          success: true,
          hostname: 'evil.example',
          challenge_ts: new Date().toISOString(),
        }),
      ),
    );
    await expect(verifyTurnstile('token-for-other-site')).resolves.toBe(false);
  });

  it('rejects stale tokens (replay blunting)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        siteverify({
          success: true,
          hostname: 'localhost',
          challenge_ts: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        }),
      ),
    );
    await expect(verifyTurnstile('old-token')).resolves.toBe(false);
  });

  it('fails closed on network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    await expect(verifyTurnstile('any-token')).resolves.toBe(false);
  });

  it('fails closed when the secret is not configured (no fetch)', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(verifyTurnstile('any-token')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed tokens without calling siteverify', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(verifyTurnstile('')).resolves.toBe(false);
    await expect(verifyTurnstile(undefined)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
