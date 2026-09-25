const TOKEN_KEY = 'bridge-token';
const SELECTED_KEY = 'selected-note-id';

let memoryToken: string | null = null;
let memoryAnswer: string | null = null;
let sessionActive = false;

export function getToken(): string | null {
  return memoryToken;
}

export function setToken(token: string): void {
  memoryToken = token.trim() || null;
}

export function getAnswer(): string | null {
  return memoryAnswer;
}

export function setAnswer(answer: string): void {
  memoryAnswer = answer;
}

export function setSessionActive(active: boolean): void {
  sessionActive = active;
}

export function isSessionActive(): boolean {
  return sessionActive;
}

export function clearToken(): void {
  memoryToken = null;
  memoryAnswer = null;
  sessionActive = false;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SELECTED_KEY);
  } catch {
    return;
  }
}

export function bridgeHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers();
  if (!sessionActive) {
    const token = getToken();
    if (token) headers.set('x-bridge-token', token);
    if (memoryAnswer) headers.set('x-bridge-answer', memoryAnswer);
  }
  if (!extra) return headers;
  if (extra instanceof Headers) {
    extra.forEach((value, key) => headers.set(key, value));
  } else if (Array.isArray(extra)) {
    for (const [key, value] of extra) headers.set(key, value);
  } else {
    for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  }
  return headers;
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
