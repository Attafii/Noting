/**
 * Shared request-body size guards. Single source of truth lives server-side;
 * the client surfaces the 413 message through the existing toast path.
 *
 * Measured with Buffer.byteLength (utf8) before any DB work.
 */

export const MAX_NOTE_BYTES = 512 * 1024;
export const MAX_AI_BYTES = 200 * 1024;

export interface BodySizeCheck {
  bytes: number;
  over: boolean;
}

/** Pure helper — unit-tested in `_limits.test.ts`. */
export function checkBodySize(text: string, maxBytes: number): BodySizeCheck {
  const bytes = Buffer.byteLength(text, 'utf8');
  return { bytes, over: bytes > maxBytes };
}

/** Human-readable 413 message shared by note/ai endpoints. */
export function bodyTooLargeMessage(bytes: number, maxBytes: number): string {
  return `Body too large (${bytes} bytes, max ${maxBytes} bytes)`;
}
