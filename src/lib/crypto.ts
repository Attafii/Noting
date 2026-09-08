/**
 * Client-side AES-GCM-256 cryptography for end-to-end encryption.
 * The key is SHA-256(access token) — the server and database only ever see
 * ciphertext. Filenames and MIME types intentionally stay plaintext so the
 * file list, search, and downloads keep working (documented trade-off).
 */

const TEXT_PREFIX = 'ENC1.';
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Copy into a fresh ArrayBuffer-backed view (WebCrypto/BlobPart requirement). */
export function toBufferView(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const view = new Uint8Array(data.length);
  view.set(data);
  return view;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Short human-readable key identifier (first 64 bits of SHA-256, grouped). */
export async function keyFingerprint(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`noting-e2e:${token}`));
  const hex = [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 4)} ${hex.slice(4, 8)} ${hex.slice(8, 12)} ${hex.slice(12, 16)}`;
}

export async function deriveKey(token: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`noting-e2e:${token}`));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function isEncryptedText(value: string): boolean {
  return value.startsWith(TEXT_PREFIX);
}

export async function encryptText(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext)),
  );
  return `${TEXT_PREFIX}${toBase64(iv)}.${toBase64(ciphertext)}`;
}

export async function decryptText(key: CryptoKey, envelope: string): Promise<string> {
  if (!isEncryptedText(envelope)) throw new Error('Not an encrypted envelope');
  const parts = envelope.split('.');
  if (parts.length !== 3) throw new Error('Malformed envelope');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(parts[1]) },
    key,
    fromBase64(parts[2]),
  );
  return decoder.decode(plaintext);
}

/** File format: 12-byte IV prepended to the raw AES-GCM ciphertext. */
export async function encryptBytes(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  // Fresh ArrayBuffer-backed view (WebCrypto BufferSource requirement).
  const view = new Uint8Array(data.length);
  view.set(data);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, view),
  );
  const out = new Uint8Array(IV_BYTES + ciphertext.length);
  out.set(iv, 0);
  out.set(ciphertext, IV_BYTES);
  return out;
}

export async function decryptBytes(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  if (data.length < IV_BYTES + 1) throw new Error('Ciphertext too short');
  const view = new Uint8Array(data.length);
  view.set(data);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: view.slice(0, IV_BYTES) },
    key,
    view.slice(IV_BYTES),
  );
  return new Uint8Array(plain);
}
