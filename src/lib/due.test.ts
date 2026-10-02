import { describe, expect, it } from 'vitest';
import {
  dueDayKey,
  dueFromInput,
  dueInputValue,
  dueLabel,
  dueTone,
  isDueToday,
  isOverdue,
} from './due';

// Fixed "now": local noon on 2026-10-02.
const NOW = new Date(2026, 9, 2, 12, 0, 0, 0);

function at(y: number, m: number, d: number, h = 12): string {
  return new Date(y, m - 1, d, h, 0, 0, 0).toISOString();
}

describe('due helpers', () => {
  it('reduces any hour of the local day to the same key', () => {
    expect(dueDayKey(at(2026, 10, 2, 0))).toBe('2026-10-02');
    expect(dueDayKey(at(2026, 10, 2, 23))).toBe('2026-10-02');
    expect(dueDayKey(NOW)).toBe('2026-10-02');
  });

  it('treats empty values as "no reminder"', () => {
    expect(dueDayKey(null)).toBeNull();
    expect(dueDayKey(undefined)).toBeNull();
    expect(dueDayKey('')).toBeNull();
    expect(dueDayKey('not-a-date')).toBeNull();
    expect(isOverdue(null, NOW)).toBe(false);
    expect(isDueToday(undefined, NOW)).toBe(false);
    expect(dueTone(null, NOW)).toBe('later');
  });

  it('detects overdue and due-today on calendar days, not hours', () => {
    expect(isOverdue(at(2026, 10, 1), NOW)).toBe(true);
    expect(isOverdue(at(2026, 10, 1, 23), NOW)).toBe(true);
    expect(isOverdue(at(2026, 10, 2, 0), NOW)).toBe(false);
    expect(isDueToday(at(2026, 10, 2, 0), NOW)).toBe(true);
    expect(isDueToday(at(2026, 10, 2, 23), NOW)).toBe(true);
    expect(isDueToday(at(2026, 10, 3), NOW)).toBe(false);
  });

  it('labels near days in words and far days as dates', () => {
    expect(dueLabel(at(2026, 10, 2), NOW)).toBe('Today');
    expect(dueLabel(at(2026, 10, 3), NOW)).toBe('Tomorrow');
    expect(dueLabel(at(2026, 10, 1), NOW)).toBe('Yesterday');
    expect(dueLabel(at(2026, 10, 9), NOW)).toMatch(/Oct/);
    expect(dueLabel(at(2027, 1, 9), NOW)).toMatch(/2027/);
  });

  it('buckets tones for badges', () => {
    expect(dueTone(at(2026, 10, 1), NOW)).toBe('overdue');
    expect(dueTone(at(2026, 10, 2), NOW)).toBe('today');
    expect(dueTone(at(2026, 10, 6), NOW)).toBe('soon');
    expect(dueTone(at(2026, 12, 6), NOW)).toBe('later');
  });

  it('round-trips the date input value on the local calendar day', () => {
    expect(dueInputValue(at(2026, 10, 2, 23))).toBe('2026-10-02');
    expect(dueInputValue(null)).toBe('');
    const iso = dueFromInput('2026-10-05');
    expect(iso).not.toBeNull();
    expect(dueDayKey(iso)).toBe('2026-10-05');
    expect(dueFromInput('nope')).toBeNull();
    expect(dueFromInput('2026-13-40')).toBeNull();
  });
});
