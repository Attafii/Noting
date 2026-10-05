import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { NoteSummary } from '../lib/api';
import {
  NOTIFY_PREF_EVENT,
  OPEN_NOTE_EVENT,
  dueNotificationBody,
  getNotifyEnabled,
  markNotified,
  notificationPermission,
  notificationsSupported,
  pendingDueNotifications,
  showDueNotification,
} from '../lib/notify';

/**
 * Watches the note list for reminders that are due now and announces them
 * once per note per due day — system notification when permitted, an
 * in-app toast otherwise. Renders nothing.
 */
export function ReminderNotifier({
  notes,
  onOpenNote,
}: {
  notes: NoteSummary[];
  onOpenNote: (id: number) => void;
}) {
  const [enabled, setEnabled] = useState(() => getNotifyEnabled());

  useEffect(() => {
    const refresh = () => setEnabled(getNotifyEnabled());
    window.addEventListener(NOTIFY_PREF_EVENT, refresh);
    return () => window.removeEventListener(NOTIFY_PREF_EVENT, refresh);
  }, []);

  const run = useCallback(() => {
    if (!notificationsSupported() || !getNotifyEnabled()) return;
    const pending = pendingDueNotifications(notes);
    if (pending.length === 0) return;
    const systemReady = notificationPermission() === 'granted';
    for (const note of pending) {
      markNotified(note);
      if (systemReady && showDueNotification(note)) continue;
      toast(note.title || 'Untitled note', {
        description: dueNotificationBody(note),
        duration: 20_000,
        action: { label: 'Open', onClick: () => onOpenNote(note.id) },
      });
    }
  }, [notes, onOpenNote]);

  useEffect(() => {
    if (!enabled) return;
    run();
    const timer = window.setInterval(run, 60_000);
    const onFocus = () => {
      if (!document.hidden) run();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [run, enabled]);

  // System-notification clicks land here from any tab state.
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<number>).detail;
      if (Number.isSafeInteger(id) && id > 0) onOpenNote(id);
    };
    window.addEventListener(OPEN_NOTE_EVENT, open);
    return () => window.removeEventListener(OPEN_NOTE_EVENT, open);
  }, [onOpenNote]);

  return null;
}
