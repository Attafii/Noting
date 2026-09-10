import { describe, expect, it } from 'vitest';
import { countWords, formatBytes, timeAgo } from './format';

describe('formatBytes', () => {
  it('formats bytes and larger units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(4718592)).toBe('4.5 MB');
  });

  it('handles invalid input', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
  });
});

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('hello')).toBe(1);
    expect(countWords('  hello   world\nnew line ')).toBe(4);
  });
});

describe('timeAgo', () => {
  it('renders relative timestamps', () => {
    expect(timeAgo(new Date().toISOString())).toBe('just now');
    expect(timeAgo(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('5m ago');
    expect(timeAgo(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe('3h ago');
    expect(timeAgo(new Date(Date.now() - 2 * 86_400_000).toISOString())).toBe('2d ago');
  });

  it('handles missing or invalid input', () => {
    expect(timeAgo(null)).toBe('—');
    expect(timeAgo(undefined)).toBe('—');
    expect(timeAgo('garbage')).toBe('—');
  });
});
