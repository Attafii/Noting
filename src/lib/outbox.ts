import { getCryptoKey } from './e2e';
import { getToken } from './token';
import { decryptBytes, encryptBytes, toBufferView } from './crypto';

const DB_NAME = 'noting-secure-store';
const STORE_NAME = 'outbox';
const DB_VERSION = 1;

export interface PendingNoteMutation {
  workspaceId: string;
  noteId: number;
  content: string;
  baseVersion: number;
  mutationId: string;
  createdAt: number;
}

const memory = new Map<string, PendingNoteMutation>();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function recordKey(workspaceId: string, noteId: number): string {
  return `${workspaceId}:${noteId}`;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      resolve(null);
    };
  });
}

export async function getWorkspaceId(): Promise<string | null> {
  const token = getToken();
  if (!token) return null;
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function encryptRecord(value: PendingNoteMutation): Promise<string> {
  const key = await getCryptoKey();
  if (!key) throw new Error('No encryption key available');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(JSON.stringify(value)),
    ),
  );
  return `outbox1.${bytesToBase64(iv)}.${bytesToBase64(ciphertext)}`;
}

async function decryptRecord(value: string): Promise<PendingNoteMutation | null> {
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== 'outbox1') return null;
  const key = await getCryptoKey();
  if (!key) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(parts[1]) },
      key,
      base64ToBytes(parts[2]),
    );
    const parsed = JSON.parse(decoder.decode(plaintext)) as PendingNoteMutation;
    if (
      typeof parsed.workspaceId !== 'string' ||
      typeof parsed.noteId !== 'number' ||
      typeof parsed.content !== 'string' ||
      typeof parsed.baseVersion !== 'number' ||
      typeof parsed.mutationId !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingMemory(): void {
  memory.clear();
}

export async function putPending(
  input: Omit<PendingNoteMutation, 'workspaceId' | 'createdAt'>,
): Promise<boolean> {
  const workspaceId = await getWorkspaceId();
  if (!workspaceId) return false;
  const value: PendingNoteMutation = { ...input, workspaceId, createdAt: Date.now() };
  const key = recordKey(workspaceId, input.noteId);
  memory.set(key, value);
  const encrypted = await encryptRecord(value).catch(() => null);
  if (!encrypted) return false;
  const stored = await withStore<{ key: string; value: string }>('readwrite', (store) =>
    store.put({ key, value: encrypted }),
  );
  return stored !== null || typeof indexedDB === 'undefined';
}

export async function getPending(
  workspaceId: string,
  noteId: number,
): Promise<PendingNoteMutation | null> {
  const key = recordKey(workspaceId, noteId);
  const local = memory.get(key);
  if (local) return local;
  const stored = await withStore<{ key: string; value: string }>('readonly', (store) =>
    store.get(key),
  );
  if (!stored) return null;
  return decryptRecord(stored.value);
}

export async function hasPendingMutations(): Promise<boolean> {
  if (memory.size > 0) return true;
  const records = await withStore<Array<{ key: string; value: string }>>('readonly', (store) =>
    store.getAll(),
  );
  return Array.isArray(records) && records.length > 0;
}

export async function removePending(workspaceId: string, noteId: number): Promise<void> {
  const key = recordKey(workspaceId, noteId);
  memory.delete(key);
  await withStore('readwrite', (store) => store.delete(key));
}

export function clearLegacyPending(): boolean {
  try {
    const existed = localStorage.getItem('note-pending') !== null;
    localStorage.removeItem('note-pending');
    return existed;
  } catch {
    return false;
  }
}

export async function encryptOutboxBytes(value: PendingNoteMutation): Promise<Uint8Array> {
  const key = await getCryptoKey();
  if (!key) throw new Error('No encryption key available');
  return encryptBytes(key, encoder.encode(JSON.stringify(value)));
}

export async function decryptOutboxBytes(value: Uint8Array): Promise<PendingNoteMutation> {
  const key = await getCryptoKey();
  if (!key) throw new Error('No encryption key available');
  const plain = await decryptBytes(key, value);
  return JSON.parse(decoder.decode(plain)) as PendingNoteMutation;
}

export function pendingMemoryValue(key: string): PendingNoteMutation | undefined {
  return memory.get(key);
}

export function pendingKey(workspaceId: string, noteId: number): string {
  return recordKey(workspaceId, noteId);
}

export function asBuffer(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return toBufferView(value);
}
