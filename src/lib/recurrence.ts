/**
 * Due-date recurrence rollovers. Dates keep the same local-noon anchor the
 * reminder inputs use (`dueFromInput`), so a rolled due date stays on the
 * intended calendar day regardless of DST or timezone offsets.
 */

import type { NoteRecurrence } from './api';
import { dueDayKey } from './due';

export const RECURRENCE_LABELS: Record<NoteRecurrence, string> = {
  none: 'Does not repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

function atLocalNoon(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** One calendar step from a local-noon date (monthly clamps to month length). */
function advance(base: Date, recurrence: NoteRecurrence): Date {
  const year = base.getFullYear();
  const month = base.getMonth();
  const day = base.getDate();
  switch (recurrence) {
    case 'daily':
      return new Date(year, month, day + 1, 12, 0, 0, 0);
    case 'weekly':
      return new Date(year, month, day + 7, 12, 0, 0, 0);
    case 'monthly': {
      const targetMonth = month + 1;
      const clamped = Math.min(day, daysInMonth(year, targetMonth));
      return new Date(year, targetMonth, clamped, 12, 0, 0, 0);
    }
    default:
      return base;
  }
}

function dayIndexOf(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

/**
 * Next due instant after completing a recurring note: one step past the
 * current due day, then fast-forwarded until the result lands on today or
 * later (so an overdue daily note comes back due today, not days ago).
 * Returns null when the note does not recur.
 */
export function nextOccurrence(
  dueAt: string | Date | null | undefined,
  recurrence: NoteRecurrence,
  now = new Date(),
): string | null {
  if (recurrence === 'none') return null;
  const parsed =
    dueAt === null || dueAt === undefined || dueAt === ''
      ? null
      : typeof dueAt === 'string'
        ? new Date(dueAt)
        : dueAt;
  const anchor = parsed && !Number.isNaN(parsed.getTime()) ? atLocalNoon(parsed) : atLocalNoon(now);

  let next = advance(anchor, recurrence);
  const today = dayIndexOf(atLocalNoon(now));
  let guard = 0;
  while (dayIndexOf(next) < today && guard++ < 3660) {
    next = advance(next, recurrence);
  }
  return next.toISOString();
}

/** True when completing this note should roll its due date instead of parking it. */
export function isRecurring(recurrence: NoteRecurrence | undefined | null): boolean {
  return recurrence !== undefined && recurrence !== null && recurrence !== 'none';
}

/** Day key the note is currently due on (null when undated). */
export function dueDayOf(dueAt: string | Date | null | undefined): string | null {
  return dueDayKey(dueAt);
}
