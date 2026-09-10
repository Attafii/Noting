import { describe, expect, it } from 'vitest';
import {
  decryptBytes,
  decryptText,
  deriveKey,
  encryptBytes,
  encryptText,
  isEncryptedText,
  keyFingerprint,
} from './crypto';

describe('text envelopes', () => {
  it('round-trips unicode text', async () => {
    const key = await deriveKey('test-token');
    const envelope = await encryptText(key, 'hello wörld — secret');
    expect(isEncryptedText(envelope)).toBe(true);
    expect(isEncryptedText('plain')).toBe(false);
    expect(await decryptText(key, envelope)).toBe('hello wörld — secret');
  });

  it('rejects the wrong key and malformed envelopes', async () => {
    const key = await deriveKey('test-token');
    const envelope = await encryptText(key, 'x');
    const wrong = await deriveKey('other-token');
    await expect(decryptText(wrong, envelope)).rejects.toThrow();
    await expect(decryptText(key, 'ENC1.broken')).rejects.toThrow();
    await expect(decryptText(key, 'plain')).rejects.toThrow();
  });

  it('uses a fresh IV per encryption', async () => {
    const key = await deriveKey('test-token');
    const a = await encryptText(key, 'same');
    const b = await encryptText(key, 'same');
    expect(a).not.toBe(b);
  });
});

describe('byte cipher', () => {
  it('round-trips binary data with 28 bytes of overhead (12 IV + 16 tag)', async () => {
    const key = await deriveKey('test-token');
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 16, 32]);
    const cipher = await encryptBytes(key, bytes);
    expect(cipher.length).toBe(bytes.length + 28);
    expect(await decryptBytes(key, cipher)).toEqual(bytes);
  });

  it('rejects truncated input', async () => {
    const key = await deriveKey('test-token');
    await expect(decryptBytes(key, new Uint8Array(5))).rejects.toThrow();
  });
});

describe('keyFingerprint', () => {
  it('returns a stable grouped hex string', async () => {
    const fp = await keyFingerprint('test-token');
    expect(fp).toMatch(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);
    expect(await keyFingerprint('test-token')).toBe(fp);
    expect(await keyFingerprint('other')).not.toBe(fp);
  });
});
