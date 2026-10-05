/**
 * Due-reminder notifications. The browser Notification API is the primary
 * channel; when it is unavailable or denied, callers can fall back to toasts
 * using the same "seen" ledger so each note only ever fires once per due day.
 */

import type { NoteSummary } from './api';
import { dueDayKey, dueLabel } from './due';

const ENABLED_KEY = 'notify-enabled';
const SEEN_KEY = 'notify-seen';
const SEEN_CAP = 400;

/** Fired when the bell preference changes (the Home bell toggles it). */
export const NOTIFY_PREF_EVENT = 'noting:notify-pref';
/** System-notification clicks dispatch this with the note id to open. */
export const OPEN_NOTE_EVENT = 'noting:open-note';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

export async function requestNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export function getNotifyEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setNotifyEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, '1');
    else localStorage.removeItem(ENABLED_KEY);
  } catch {
    /* ignore */
  }
}

type SeenMap = Record<string, string>;

function readSeen(): SeenMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as SeenMap;
  } catch {
    /* ignore */
  }
  return {};
}

function writeSeen(map: SeenMap): void {
  try {
    const entries = Object.entries(map);
    const trimmed =
      entries.length > SEEN_CAP
        ? Object.fromEntries(entries.slice(entries.length - SEEN_CAP))
        : map;
    localStorage.setItem(SEEN_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
}

function seenKey(note: NoteSummary): string {
  return `${note.id}:${dueDayKey(note.due_at) ?? 'unscheduled'}`;
}

export function isNotified(note: NoteSummary): boolean {
  return seenKey(note) in readSeen();
}

export function markNotified(note: NoteSummary): void {
  const map = readSeen();
  map[seenKey(note)] = '1';
  writeSeen(map);
}

/**
 * Notes that should fire right now: due today or earlier, not archived,
 * not snoozed into the future, and not already announced for this due day.
 */
export function pendingDueNotifications(notes: NoteSummary[], now = new Date()): NoteSummary[] {
  const today = dueDayKey(now);
  if (!today) return [];
  return notes.filter((note) => {
    if (note.archived || !note.due_at) return false;
    const due = dueDayKey(note.due_at);
    if (!due || due > today) return false;
    if (note.snoozed_until) {
      const snooze = Date.parse(note.snoozed_until);
      if (!Number.isNaN(snooze) && snooze > now.getTime()) return false;
    }
    return !isNotified(note);
  });
}

/** Fire a system notification for a due note. Returns false when unavailable. */
export function showDueNotification(note: NoteSummary): boolean {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false;
  try {
    const body = note.due_at ? `Due ${dueLabel(note.due_at).toLowerCase()}` : 'Due now';
    const notification = new Notification(note.title || 'Untitled note', {
      body,
      tag: `noting-due-${note.id}`,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
      window.dispatchEvent(new CustomEvent<number>(OPEN_NOTE_EVENT, { detail: note.id }));
    };
    return true;
  } catch {
    return false;
  }
}

/** Notification body shared by the system channel and the toast fallback. */
export function dueNotificationBody(note: NoteSummary): string {
  return note.due_at ? `Due ${dueLabel(note.due_at).toLowerCase()}` : 'Due now';
}
