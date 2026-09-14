import { describe, expect, it } from 'vitest';
import { bodyTooLargeMessage, checkBodySize, MAX_AI_BYTES, MAX_NOTE_BYTES } from './_limits';

describe('checkBodySize', () => {
  it('accepts small bodies', () => {
    const result = checkBodySize('hello', MAX_NOTE_BYTES);
    expect(result.over).toBe(false);
    expect(result.bytes).toBe(5);
  });

  it('rejects note bodies over 512 KiB', () => {
    const big = 'a'.repeat(MAX_NOTE_BYTES + 1);
    expect(checkBodySize(big, MAX_NOTE_BYTES).over).toBe(true);
  });

  it('rejects AI bodies over 200 KiB', () => {
    const big = 'b'.repeat(MAX_AI_BYTES + 1);
    expect(checkBodySize(big, MAX_AI_BYTES).over).toBe(true);
  });

  it('measures multibyte utf8 correctly', () => {
    // 'é' is 2 bytes in utf8; 3 chars = 6 bytes.
    const result = checkBodySize('ééé', 5);
    expect(result.bytes).toBe(6);
    expect(result.over).toBe(true);
  });

  it('accepts bodies exactly at the limit', () => {
    const exact = 'a'.repeat(10);
    expect(checkBodySize(exact, 10).over).toBe(false);
  });

  it('formats a 413 message', () => {
    expect(bodyTooLargeMessage(600_000, MAX_NOTE_BYTES)).toContain('Body too large');
  });
});
