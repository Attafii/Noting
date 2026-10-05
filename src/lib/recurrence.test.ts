import { describe, expect, it } from 'vitest';
import { isRecurring, nextOccurrence } from './recurrence';

function localNoon(y: number, m: number, d: number): string {
  return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString();
}

describe('nextOccurrence', () => {
  const now = new Date(2026, 9, 5, 15, 30); // Oct 5 2026, local afternoon

  it('returns null for non-recurring notes', () => {
    expect(nextOccurrence(localNoon(2026, 10, 5), 'none', now)).toBeNull();
  });

  it('rolls a note due today to tomorrow', () => {
    const next = nextOccurrence(localNoon(2026, 10, 5), 'daily', now);
    expect(next).toBe(localNoon(2026, 10, 6));
  });

  it('fast-forwards an overdue daily note to today', () => {
    const next = nextOccurrence(localNoon(2026, 10, 2), 'daily', now);
    expect(next).toBe(localNoon(2026, 10, 5));
  });

  it('keeps a future due date moving one step', () => {
    const next = nextOccurrence(localNoon(2026, 10, 9), 'weekly', now);
    expect(next).toBe(localNoon(2026, 10, 16));
  });

  it('adds exactly seven days for weekly', () => {
    const next = nextOccurrence(localNoon(2026, 10, 5), 'weekly', now);
    expect(next).toBe(localNoon(2026, 10, 12));
  });

  it('clamps monthly rollovers to the month length', () => {
    const next = nextOccurrence(localNoon(2027, 1, 31), 'monthly', now);
    expect(next).toBe(localNoon(2027, 2, 28));
  });

  it('lands on Feb 29 in a leap year', () => {
    const next = nextOccurrence(localNoon(2028, 1, 31), 'monthly', new Date(2027, 11, 1));
    expect(next).toBe(localNoon(2028, 2, 29));
  });

  it('schedules an undated recurring note from tomorrow', () => {
    const next = nextOccurrence(null, 'daily', now);
    expect(next).toBe(localNoon(2026, 10, 6));
  });
});

describe('isRecurring', () => {
  it('treats none/undefined as non-recurring', () => {
    expect(isRecurring('none')).toBe(false);
    expect(isRecurring(undefined)).toBe(false);
    expect(isRecurring('daily')).toBe(true);
  });
});
