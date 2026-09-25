/**
 * Cloudflare Turnstile fallback verifier (free Managed widget).
 *
 * Used ONLY as the fallback branch in POST /api/tokens when the built-in
 * visual human-check fails or can't load. The happy path never touches a
 * third party — Turnstile JS is lazy-injected client-side only after the
 * user opts into (or the app escalates to) the alternative check.
 *
 * Privacy: the token is sent to Cloudflare's siteverify endpoint and never
 * logged. No client IP is forwarded (remoteip omitted by design).
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 8000;
/** siteverify success must be this fresh (Cloudflare tokens are short-lived). */
const TOKEN_FRESHNESS_MS = 10 * 60 * 1000;

const DEFAULT_HOSTNAMES = [
  'noting.attafii.dev',
  'noting-notes.vercel.app',
  'localhost',
  '127.0.0.1',
];

function allowedHostnames(): string[] {
  const raw = process.env.TURNSTILE_ALLOWED_HOSTNAMES;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
  }
  return DEFAULT_HOSTNAMES;
}

interface SiteverifyResponse {
  success?: boolean;
  hostname?: string;
  challenge_ts?: string;
  'error-codes'?: string[];
}

/**
 * Verify a Turnstile client token server-side. Fail-closed: any network
 * error, misconfiguration, hostname mismatch, or stale token returns false.
 * Callers OR this with the built-in challenge — it never grants anything
 * on its own beyond returning a boolean.
 */
export async function verifyTurnstile(token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || token.length < 8 || token.length > 8192) return false;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error('turnstile misconfigured — TURNSTILE_SECRET_KEY is not set');
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const body = (await res.json()) as SiteverifyResponse;
    if (body.success !== true) return false;
    if (
      typeof body.hostname !== 'string' ||
      !allowedHostnames().includes(body.hostname.toLowerCase())
    ) {
      return false;
    }
    if (typeof body.challenge_ts !== 'string' || body.challenge_ts.length === 0) return false;
    const ts = Date.parse(body.challenge_ts);
    if (!Number.isFinite(ts) || Date.now() - ts > TOKEN_FRESHNESS_MS || ts - Date.now() > 60_000) {
      return false;
    }
    return true;
  } catch {
    // Network/timeout — fail closed (custom check already failed here).
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
