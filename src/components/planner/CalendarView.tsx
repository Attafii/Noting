import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, CalendarDays, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, updateNote, type NoteSummary } from '../../lib/api';
import { dueDayKey, dueFromInput, dueLabel, dueTone, type DueTone } from '../../lib/due';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

interface CalendarViewProps {
  notes: NoteSummary[];
  onSelect: (id: number) => void;
  onUnauthorized: () => void;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const CHIP_TONE: Record<DueTone, string> = {
  overdue: 'border-red-900/70 bg-red-950/60 text-red-300 hover:border-red-800',
  today: 'border-amber-900/70 bg-amber-950/60 text-amber-300 hover:border-amber-800',
  soon: 'border-accent-600/50 bg-accent-500/10 text-accent-300 hover:border-accent-500/70',
  later: 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
};

const DOT_TONE: Record<DueTone, string> = {
  overdue: 'bg-red-400',
  today: 'bg-amber-400',
  soon: 'bg-accent-400',
  later: 'bg-zinc-500',
};

function dayKeyOf(year: number, month: number, day: number): string {
  const key = dueDayKey(new Date(year, month, day));
  return key ?? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function CalendarView({ notes, onSelect, onUnauthorized }: CalendarViewProps) {
  const queryClient = useQueryClient();
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<string, NoteSummary[]>();
    for (const note of notes) {
      if (note.archived) continue;
      const key = dueDayKey(note.due_at);
      if (!key) continue;
      const list = map.get(key);
      if (list) list.push(note);
      else map.set(key, [note]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }
    return map;
  }, [notes]);

  const unscheduled = useMemo(
    () =>
      notes
        .filter((note) => !note.archived && !note.due_at)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 30),
    [notes],
  );

  const reschedule = useMutation({
    mutationFn: ({ id, dayKey }: { id: number; dayKey: string }) => {
      const iso = dueFromInput(dayKey);
      if (!iso) throw new Error('Invalid calendar day');
      return updateNote(id, { due_at: iso });
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      const iso = dueFromInput(vars.dayKey);
      if (iso) toast.success(`Moved due ${dueLabel(iso).toLowerCase()}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'UNAUTHORIZED') onUnauthorized();
      else toast.error(error instanceof Error ? error.message : 'Could not reschedule the note');
    },
  });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayCells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => dayKeyOf(year, month, index + 1)),
  ];
  while (dayCells.length % 7 !== 0) dayCells.push(null);

  const todayKey = dueDayKey(today) ?? '';
  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const scheduledCount = byDay.size;

  function shiftMonth(delta: number) {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  function handleDrop(event: React.DragEvent, dayKey: string) {
    event.preventDefault();
    setDragOverDay(null);
    const raw = event.dataTransfer.getData('text/plain');
    const id = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(id) || id <= 0 || reschedule.isPending) return;
    if (dayKey === dueDayKey(notes.find((note) => note.id === id)?.due_at)) return;
    reschedule.mutate({ id, dayKey });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Month header. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft />
          </Button>
          <AnimatePresence mode="wait" initial={false}>
            <motion.h3
              key={monthLabel}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
              className="min-w-40 text-center text-sm font-semibold text-zinc-100"
            >
              {monthLabel}
            </motion.h3>
          </AnimatePresence>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
          >
            <ChevronRight />
          </Button>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
        >
          Today
        </Button>
      </div>

      <div className="flex flex-col gap-4 xl:flex-row">
        <div className="min-w-0 flex-1">
          {/* Weekday rail. */}
          <div className="grid grid-cols-7 gap-1 pb-1">
            {WEEKDAYS.map((day) => (
              <span
                key={day}
                className="text-center font-mono text-[10px] tracking-[0.18em] text-zinc-600 uppercase"
              >
                {day}
              </span>
            ))}
          </div>

          {/* Month grid. */}
          <div className="grid grid-cols-7 gap-1">
            {dayCells.map((dayKey, index) => {
              if (dayKey === null) {
                return (
                  <div
                    key={`blank-${index}`}
                    className="min-h-[74px] rounded-xl border border-dashed border-zinc-900/70 sm:min-h-[104px]"
                  />
                );
              }
              const dayNotes = byDay.get(dayKey) ?? [];
              const isToday = dayKey === todayKey;
              const isDropTarget = dragOverDay === dayKey;
              const dayNumber = Number(dayKey.slice(-2));
              return (
                <div
                  key={dayKey}
                  data-testid="day-cell"
                  data-day={dayKey}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDragOverDay(dayKey);
                  }}
                  onDragLeave={() =>
                    setDragOverDay((current) => (current === dayKey ? null : current))
                  }
                  onDrop={(event) => handleDrop(event, dayKey)}
                  className={cn(
                    'flex min-h-[74px] flex-col gap-1 rounded-xl border p-1.5 transition-colors duration-150 sm:min-h-[104px]',
                    isToday
                      ? 'border-accent-600/60 bg-accent-500/[0.06]'
                      : 'border-zinc-800/70 bg-zinc-950/40',
                    isDropTarget &&
                      'border-accent-500/80 bg-accent-500/10 ring-1 ring-accent-500/40',
                  )}
                >
                  <span
                    className={cn(
                      'self-start rounded-md px-1.5 font-mono text-[11px]',
                      isToday ? 'bg-accent-500 font-semibold text-zinc-950' : 'text-zinc-500',
                    )}
                  >
                    {dayNumber}
                  </span>

                  {/* Desktop chips. */}
                  <div className="hidden flex-col gap-1 sm:flex">
                    {dayNotes.slice(0, 3).map((note) => (
                      <button
                        key={note.id}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData('text/plain', String(note.id));
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                        onClick={() => onSelect(note.id)}
                        title={`${note.title} — due ${dueLabel(dayKey)}`}
                        className={cn(
                          'block w-full cursor-grab truncate rounded-md border px-1.5 py-0.5 text-left text-[11px] transition-colors active:cursor-grabbing',
                          CHIP_TONE[dueTone(note.due_at)],
                        )}
                      >
                        {note.title}
                      </button>
                    ))}
                    {dayNotes.length > 3 && (
                      <span className="px-1 font-mono text-[10px] text-zinc-600">
                        +{dayNotes.length - 3} more
                      </span>
                    )}
                  </div>

                  {/* Mobile dots. */}
                  <div className="flex gap-1 sm:hidden">
                    {dayNotes.slice(0, 4).map((note) => (
                      <button
                        key={note.id}
                        onClick={() => onSelect(note.id)}
                        aria-label={`Open ${note.title}`}
                        className={cn('size-1.5 rounded-full', DOT_TONE[dueTone(note.due_at)])}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {scheduledCount === 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-zinc-800 px-3 py-2.5 text-xs text-zinc-500">
              <CalendarDays className="size-4 shrink-0 text-zinc-600" />
              Nothing scheduled yet — drag a note from the tray onto a day, or set a reminder in the
              editor.
            </div>
          )}
        </div>

        {/* Unscheduled tray. */}
        <aside className="flex w-full shrink-0 flex-col gap-2 xl:w-52">
          <p className="font-mono text-[10px] tracking-[0.18em] text-zinc-600 uppercase">
            unscheduled · {unscheduled.length}
          </p>
          {unscheduled.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-3 text-[11px] text-zinc-600">
              Every note has a day — the tray is empty.
            </p>
          ) : (
            <div className="flex max-h-[420px] flex-col gap-1.5 overflow-y-auto pr-0.5">
              {unscheduled.map((note) => (
                <button
                  key={note.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', String(note.id));
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => onSelect(note.id)}
                  title={`${note.title} — drag onto the calendar to schedule`}
                  className="flex cursor-grab items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-left text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 active:cursor-grabbing"
                >
                  <Clock className="size-3 shrink-0 text-zinc-600" />
                  <span className="min-w-0 truncate">{note.title}</span>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
