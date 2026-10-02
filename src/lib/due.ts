/**
 * Reminder (due date) helpers — calendar-day semantics in the user's local
 * timezone. The server stores a timestamptz; every comparison here reduces it
 * to a local `YYYY-MM-DD` key first, so "due today" means the user's today.
 */

export type DueTone = 'overdue' | 'today' | 'soon' | 'later';

function dayKeyOf(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Parse any due value (ISO string or Date) → local calendar-day key, or null. */
export function dueDayKey(dueAt: string | Date | null | undefined): string | null {
  if (dueAt === null || dueAt === undefined || dueAt === '') return null;
  return dayKeyOf(typeof dueAt === 'string' ? new Date(dueAt) : dueAt);
}

export function isOverdue(dueAt: string | Date | null | undefined, now = new Date()): boolean {
  const due = dueDayKey(dueAt);
  const today = dayKeyOf(now);
  return due !== null && today !== null && due < today;
}

export function isDueToday(dueAt: string | Date | null | undefined, now = new Date()): boolean {
  const due = dueDayKey(dueAt);
  const today = dayKeyOf(now);
  return due !== null && today !== null && due === today;
}

/** Whole-day difference (positive = future), computed on local midnight keys. */
export function dueDayDelta(dueAt: string | Date, now = new Date()): number | null {
  const due = dueDayKey(dueAt);
  const today = dayKeyOf(now);
  if (due === null || today === null) return null;
  const [dy, dm, dd] = due.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const dueMs = Date.UTC(dy, dm - 1, dd);
  const todayMs = Date.UTC(ty, tm - 1, td);
  return Math.round((dueMs - todayMs) / 86_400_000);
}

/** Compact label: Today / Tomorrow / Yesterday / Oct 5 / Oct 5, 2027. */
export function dueLabel(dueAt: string | Date, now = new Date()): string {
  const delta = dueDayDelta(dueAt, now);
  if (delta === null) return '';
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  const date = typeof dueAt === 'string' ? new Date(dueAt) : dueAt;
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function dueTone(dueAt: string | Date | null | undefined, now = new Date()): DueTone {
  if (dueAt === null || dueAt === undefined || dueAt === '') return 'later';
  if (isOverdue(dueAt, now)) return 'overdue';
  if (isDueToday(dueAt, now)) return 'today';
  const delta = dueDayDelta(dueAt, now);
  return delta !== null && delta <= 7 ? 'soon' : 'later';
}

/** `YYYY-MM-DD` for `<input type="date">` (local day, not UTC day). */
export function dueInputValue(dueAt: string | Date | null | undefined): string {
  return dueDayKey(dueAt) ?? '';
}

/**
 * `<input type="date">` value → ISO-8601 to store. Anchored at local noon so
 * the calendar day is stable regardless of timezone offsets.
 */
export function dueFromInput(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  // Reject roll-overs (e.g. 2026-02-31 → March) that `Date` silently allows.
  if (Number.isNaN(date.getTime()) || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date.toISOString();
}
