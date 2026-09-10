import { describe, expect, it } from 'vitest';
import { chunkText, indexableFile } from './_index';
import { vectorLiteral } from './_ai';
import { sanitizeFileName } from '../src/lib/backup';

describe('indexableFile', () => {
  it('accepts text formats and rejects binaries', () => {
    expect(indexableFile('notes.md', 'text/markdown')).toBe(true);
    expect(indexableFile('data.csv', 'text/csv')).toBe(true);
    expect(indexableFile('config.json', 'application/json')).toBe(true);
    expect(indexableFile('readme.txt', 'application/octet-stream')).toBe(true);
    expect(indexableFile('photo.png', 'image/png')).toBe(false);
    expect(indexableFile('archive.zip', 'application/zip')).toBe(false);
    expect(indexableFile('doc.pdf', 'application/pdf')).toBe(false);
  });
});

describe('chunkText', () => {
  it('returns no chunks for blank input', () => {
    expect(chunkText('   \n  ')).toEqual([]);
  });

  it('keeps short text in one chunk and splits long text', () => {
    expect(chunkText('hello world')).toEqual(['hello world']);
    const long = Array.from({ length: 30 }, (_, i) => `paragraph ${i} ` + 'x'.repeat(100)).join(
      '\n\n',
    );
    const chunks = chunkText(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 1100)).toBe(true);
  });

  it('caps runaway input at 60 chunks', () => {
    const huge = Array.from({ length: 500 }, (_, i) => `para ${i} xxxxxxxxxxxxxxxxxxxx`).join(
      '\n\n',
    );
    expect(chunkText(huge).length).toBeLessThanOrEqual(60);
  });
});

describe('vectorLiteral', () => {
  it('formats pgvector text input', () => {
    expect(vectorLiteral([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]');
  });
});

describe('sanitizeFileName', () => {
  it('strips unsafe characters for zip entries', () => {
    expect(sanitizeFileName('my report: Q3/2026?.md')).toBe('my-report-Q3-2026-.md');
    expect(sanitizeFileName('')).toBe('untitled');
  });
});
