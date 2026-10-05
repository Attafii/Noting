import { beforeEach, describe, expect, it } from 'vitest';
import {
  getDailyGoal,
  getWritingLog,
  logWords,
  setDailyGoal,
  wordsToday,
  writingStreak,
} from './writing-log';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  } as Storage;
}

function dayOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = memoryStorage();
});

describe('writing log', () => {
  it('accumulates today’s words across calls', () => {
    logWords(120);
    logWords(80);
    expect(wordsToday()).toBe(200);
    expect(getWritingLog()).toHaveLength(1);
  });

  it('ignores zero and negative deltas', () => {
    logWords(50);
    logWords(0);
    logWords(-30);
    expect(wordsToday()).toBe(50);
  });

  it('computes a streak back from today or yesterday', () => {
    expect(
      writingStreak([
        { day: dayOffset(0), words: 10 },
        { day: dayOffset(1), words: 10 },
        { day: dayOffset(2), words: 10 },
        { day: dayOffset(4), words: 10 },
      ]),
    ).toBe(3);
    // Empty today still counts yesterday's run.
    expect(
      writingStreak([
        { day: dayOffset(1), words: 5 },
        { day: dayOffset(2), words: 5 },
      ]),
    ).toBe(2);
    expect(writingStreak([])).toBe(0);
  });

  it('round-trips the daily goal with clamping', () => {
    expect(getDailyGoal()).toBe(300);
    setDailyGoal(750);
    expect(getDailyGoal()).toBe(750);
    setDailyGoal(-5);
    expect(getDailyGoal()).toBe(0);
  });
});
