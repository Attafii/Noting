import { describe, expect, it } from 'vitest';
import {
  applyHeading,
  applyLinePrefix,
  applyWrap,
  extractHeadings,
  extractTags,
  findAllMatches,
  insertTable,
  readingMinutes,
  slugify,
  toggleChecklist,
} from './markdown-ops';

describe('markdown-ops', () => {
  it('wraps selections with formatting markers', () => {
    const r = applyWrap('hello world', { start: 6, end: 11 }, '**', '**');
    expect(r.text).toBe('hello **world**');
    expect(r.selection).toEqual({ start: 8, end: 13 });
  });

  it('uses placeholder when selection is empty', () => {
    const r = applyWrap('', { start: 0, end: 0 }, '**', '**');
    expect(r.text).toBe('**text**');
  });

  it('toggles line prefixes', () => {
    const on = applyLinePrefix('a\nb', { start: 0, end: 3 }, '> ');
    expect(on.text).toBe('> a\n> b');
    const off = applyLinePrefix(on.text, { start: 0, end: on.text.length }, '> ');
    expect(off.text).toBe('a\nb');
  });

  it('applies and toggles headings', () => {
    const h = applyHeading('title', { start: 0, end: 5 }, 1);
    expect(h.text).toBe('# title');
    const off = applyHeading(h.text, { start: 0, end: h.text.length }, 1);
    expect(off.text).toBe('title');
  });

  it('toggles checklists through unchecked/checked/plain states', () => {
    const t = toggleChecklist('task', { start: 0, end: 4 });
    expect(t.text).toBe('- [ ] task');
    const c = toggleChecklist(t.text, { start: 0, end: t.text.length });
    expect(c.text).toBe('- [x] task');
    const u = toggleChecklist(c.text, { start: 0, end: c.text.length });
    expect(u.text).toBe('- [ ] task');
  });

  it('inserts tables with clamped dimensions', () => {
    const r = insertTable('', { start: 0, end: 0 }, 2, 2);
    expect(r.text).toContain('| Header 1 | Header 2 |');
    expect(r.text).toContain('| --- | --- |');
  });

  it('extracts headings while ignoring code fences', () => {
    const text = '# A\n\n```\n# not a heading\n```\n\n## B';
    expect(extractHeadings(text).map((h) => h.text)).toEqual(['A', 'B']);
  });

  it('slugifies headings for preview anchors', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('[[My Note]] Overview')).toBe('my-note-overview');
  });

  it('extracts #tags but not # headings', () => {
    expect(extractTags('# Title\nSome #work and #side/project here')).toEqual([
      'side/project',
      'work',
    ]);
  });

  it('computes reading minutes', () => {
    expect(readingMinutes('')).toBe(0);
    expect(readingMinutes('hello')).toBe(1);
    expect(readingMinutes(Array(401).join('word '))).toBe(2);
  });

  it('finds all case-insensitive matches', () => {
    expect(findAllMatches('Note note NOTE', 'note')).toEqual([0, 5, 10]);
    expect(findAllMatches('abc', '')).toEqual([]);
  });
});
