const TOKEN_KEY = 'bridge-token';
const SELECTED_KEY = 'selected-note-id';

/**
 * Token (ntk_…) is remembered in localStorage for convenience; the SECURITY
 * ANSWER lives only in module memory and is cleared on lock / reload — every
 * return visit re-types the answer, the answer is never persisted.
 */
let memoryAnswer: string | null = null;

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function getAnswer(): string | null {
  return memoryAnswer;
}

export function setAnswer(answer: string): void {
  memoryAnswer = answer;
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  memoryAnswer = null;
  try {
    localStorage.removeItem(SELECTED_KEY);
  } catch {
    /* ignore */
  }
}

export function bridgeHeaders(extra?: HeadersInit): HeadersInit {
  const token = getToken();
  return {
    ...(token ? { 'x-bridge-token': token } : {}),
    ...(memoryAnswer ? { 'x-bridge-answer': memoryAnswer } : {}),
    ...extra,
  };
}

/**
 * Per-page-load session nonce for the one-time hint grant. Stored in
 * sessionStorage so each tab/load gets its own id — the server enforces
 * "hint once per session" on (token_id, session_id). NOT a fingerprint:
 * random only, never derived from device data.
 */
const SESSION_KEY = 'hint-session-id';

function randomSessionId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  return Array.from(bytes, (b) => alphabet[b % 64]).join('');
}

export function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const fresh = randomSessionId();
    sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return randomSessionId();
  }
}
