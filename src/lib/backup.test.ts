import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { planExtraction, sanitizeFileName } from './backup';

function forgeSize(zip: JSZip, name: string, size: number): void {
  const entry = zip.file(name);
  if (!entry) throw new Error(`missing entry ${name}`);
  (entry as unknown as { _data: { uncompressedSize: number } })._data.uncompressedSize = size;
}

describe('sanitizeFileName', () => {
  it('falls back to untitled', () => {
    expect(sanitizeFileName('')).toBe('untitled');
  });
});

describe('planExtraction', () => {
  it('passes a normal file', () => {
    const zip = new JSZip();
    zip.file('notes/1-hello.md', '# hello');
    const plan = planExtraction(zip, ['notes/1-hello.md']);
    expect(plan.allowed.has('notes/1-hello.md')).toBe(true);
    expect(plan.rejected).toBe(0);
  });

  it('rejects a forged uncompressedSize over 25MB before decompression', () => {
    const zip = new JSZip();
    zip.file('files/evil.bin', 'tiny');
    forgeSize(zip, 'files/evil.bin', 26 * 1024 * 1024);
    const plan = planExtraction(zip, ['files/evil.bin']);
    expect(plan.allowed.has('files/evil.bin')).toBe(false);
    expect(plan.rejected).toBe(1);
  });

  it('truncates archives over 2000 entries', () => {
    const zip = new JSZip();
    const files: string[] = [];
    for (let i = 0; i < 2005; i++) {
      const name = `notes/${i}.md`;
      zip.file(name, 'x');
      files.push(name);
    }
    const plan = planExtraction(zip, files);
    expect(plan.allowed.size).toBeLessThanOrEqual(2000);
    expect(plan.rejected).toBeGreaterThanOrEqual(5);
  });

  it('rejects missing entries', () => {
    const zip = new JSZip();
    const plan = planExtraction(zip, ['notes/ghost.md']);
    expect(plan.allowed.has('notes/ghost.md')).toBe(false);
    expect(plan.rejected).toBe(1);
  });
});
