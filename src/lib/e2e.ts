import { useSyncExternalStore } from 'react';
import { deriveKey, keyFingerprint } from './crypto';
import { getToken } from './token';

const E2E_KEY = 'e2e-enabled';

let cached: { token: string; key: CryptoKey } | null = null;

/** Workspace-level E2E switch. Governs NEW notes/files; existing enc content stays enc. */
export function isE2EEnabled(): boolean {
  try {
    return localStorage.getItem(E2E_KEY) === '1';
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();

export function setE2EEnabled(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(E2E_KEY, '1');
    else localStorage.removeItem(E2E_KEY);
  } catch {
    /* ignore */
  }
  for (const listener of listeners) listener();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): boolean {
  return isE2EEnabled();
}

/** Reactive E2E toggle for settings UI and upload/editor flows. */
export function useE2E(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** AES key derived from the current access token (cached per token). Null when locked out. */
export async function getCryptoKey(): Promise<CryptoKey | null> {
  const token = getToken();
  if (!token) return null;
  if (cached && cached.token === token) return cached.key;
  const key = await deriveKey(token);
  cached = { token, key };
  return key;
}

/** Key fingerprint for the current token — verify it matches across devices. */
export async function getKeyFingerprint(): Promise<string | null> {
  const token = getToken();
  if (!token) return null;
  try {
    return await keyFingerprint(token);
  } catch {
    return null;
  }
}
