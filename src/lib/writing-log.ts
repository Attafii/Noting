/**
 * Local writing log: net words added while editing, bucketed per local day.
 * Powers the Home "writing" card (today's words, streak, daily goal) — it
 * lives in localStorage only, so it never syncs or leaves the device.
 */

import { dueDayKey } from './due';

const LOG_KEY = 'writing-log';
const GOAL_KEY = 'writing-goal';
const LOG_CAP = 400;
const DEFAULT_GOAL = 300;

/** Broadcast whenever today's bucket changes (Home listens to refresh). */
export const WRITING_LOG_EVENT = 'noting:writing-log';

export interface WritingDay {
  day: string;
  words: number;
}

export function getWritingLog(): WritingDay[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is WritingDay =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as WritingDay).day === 'string' &&
          typeof (entry as WritingDay).words === 'number' &&
          /^\d{4}-\d{2}-\d{2}$/.test((entry as WritingDay).day) &&
          Number.isFinite((entry as WritingDay).words) &&
          (entry as WritingDay).words > 0,
      )
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-LOG_CAP);
  } catch {
    return [];
  }
}

/** Add a positive word delta to today's bucket (no-ops on zero/negative). */
export function logWords(delta: number): void {
  if (!Number.isFinite(delta) || delta <= 0) return;
  const day = dueDayKey(new Date());
  if (!day) return;
  try {
    const log = getWritingLog();
    const existing = log.find((entry) => entry.day === day);
    if (existing) existing.words = Math.round(existing.words + delta);
    else log.push({ day, words: Math.round(delta) });
    const trimmed = log.slice(-LOG_CAP);
    localStorage.setItem(LOG_KEY, JSON.stringify(trimmed));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(WRITING_LOG_EVENT));
    }
  } catch {
    /* ignore quota/serialization failures */
  }
}

export function wordsToday(log: WritingDay[] = getWritingLog()): number {
  const day = dueDayKey(new Date());
  return log.find((entry) => entry.day === day)?.words ?? 0;
}

/**
 * Consecutive active days ending today. A still-empty today does not break
 * the streak — it counts back from yesterday until a gap appears.
 */
export function writingStreak(log: WritingDay[] = getWritingLog()): number {
  const active = new Set(log.filter((entry) => entry.words > 0).map((entry) => entry.day));
  if (active.size === 0) return 0;
  const cursor = new Date();
  if (!active.has(dueDayKey(cursor) ?? '')) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  for (let i = 0; i < 3660; i++) {
    const key = dueDayKey(cursor);
    if (!key || !active.has(key)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function getDailyGoal(): number {
  try {
    const raw = parseInt(localStorage.getItem(GOAL_KEY) ?? '', 10);
    if (Number.isFinite(raw) && raw >= 0 && raw <= 100_000) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_GOAL;
}

export function setDailyGoal(goal: number): void {
  try {
    const clean = Number.isFinite(goal) ? Math.min(100_000, Math.max(0, Math.round(goal))) : 0;
    localStorage.setItem(GOAL_KEY, String(clean));
  } catch {
    /* ignore */
  }
}
