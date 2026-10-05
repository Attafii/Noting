import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Plus, Repeat, Star } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, createNote, updateNote, type NoteStatus, type NoteSummary } from '../../lib/api';
import { dueLabel, dueTone, type DueTone } from '../../lib/due';
import { isRecurring, nextOccurrence, RECURRENCE_LABELS } from '../../lib/recurrence';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

interface KanbanViewProps {
  notes: NoteSummary[];
  onSelect: (id: number) => void;
  onUnauthorized: () => void;
}

interface ColumnDef {
  id: NoteStatus;
  label: string;
  dot: string;
}

const COLUMNS: ColumnDef[] = [
  { id: 'todo', label: 'To do', dot: 'bg-zinc-400' },
  { id: 'doing', label: 'In progress', dot: 'bg-amber-400' },
  { id: 'done', label: 'Done', dot: 'bg-emerald-400' },
];

const DUE_BADGE: Record<DueTone, string> = {
  overdue: 'border-red-900/70 bg-red-950/50 text-red-300',
  today: 'border-amber-900/70 bg-amber-950/50 text-amber-300',
  soon: 'border-accent-600/50 bg-accent-500/10 text-accent-300',
  later: 'border-zinc-800 bg-zinc-900 text-zinc-500',
};

function statusOf(note: NoteSummary): NoteStatus {
  return note.status === 'doing' || note.status === 'done' ? note.status : 'todo';
}

export function KanbanView({ notes, onSelect, onUnauthorized }: KanbanViewProps) {
  const queryClient = useQueryClient();
  const [dragOverColumn, setDragOverColumn] = useState<NoteStatus | null>(null);

  const active = useMemo(() => notes.filter((note) => !note.archived), [notes]);
  const grouped = useMemo(() => {
    const map = new Map<NoteStatus, NoteSummary[]>([
      ['todo', []],
      ['doing', []],
      ['done', []],
    ]);
    for (const note of active) map.get(statusOf(note))?.push(note);
    for (const list of map.values()) list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return map;
  }, [active]);

  const move = useMutation({
    mutationFn: async ({ note, status }: { note: NoteSummary; status: NoteStatus }) => {
      const recurring = status === 'done' && isRecurring(note.recurrence) && note.status !== 'done';
      if (recurring) {
        // Completing a recurring note rolls the due date and sends it back to
        // To do — habits never park in Done.
        const next = nextOccurrence(note.due_at, note.recurrence ?? 'none');
        await updateNote(note.id, { status: 'todo', due_at: next });
        return { title: note.title, next };
      }
      await updateNote(note.id, { status });
      return null;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      if (result) {
        toast.success(`${result.title} complete`, {
          description: result.next ? `Next due ${dueLabel(result.next).toLowerCase()}` : undefined,
        });
      }
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'UNAUTHORIZED') onUnauthorized();
      else toast.error(error instanceof Error ? error.message : 'Could not move the note');
    },
  });

  const quickAdd = useMutation({
    mutationFn: async (status: NoteStatus) => {
      const note = await createNote('Untitled');
      await updateNote(note.id, { status });
      return note.id;
    },
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      onSelect(id);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'UNAUTHORIZED') onUnauthorized();
      else toast.error(error instanceof Error ? error.message : 'Could not create a note');
    },
  });

  function handleDrop(event: React.DragEvent, status: NoteStatus) {
    event.preventDefault();
    setDragOverColumn(null);
    const id = Number.parseInt(event.dataTransfer.getData('text/plain'), 10);
    if (!Number.isSafeInteger(id) || id <= 0 || move.isPending) return;
    const note = active.find((candidate) => candidate.id === id);
    if (!note || statusOf(note) === status) return;
    move.mutate({ note, status });
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {COLUMNS.map((column) => {
        const columnNotes = grouped.get(column.id) ?? [];
        const isDropTarget = dragOverColumn === column.id;
        return (
          <section
            key={column.id}
            data-testid="board-column"
            data-status={column.id}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDragOverColumn(column.id);
            }}
            onDragLeave={() =>
              setDragOverColumn((current) => (current === column.id ? null : current))
            }
            onDrop={(event) => handleDrop(event, column.id)}
            className={cn(
              'flex min-h-0 flex-col rounded-2xl border bg-zinc-950/40 p-2 transition-colors duration-150',
              isDropTarget ? 'border-accent-500/70 bg-accent-500/[0.07]' : 'border-zinc-800/70',
            )}
          >
            <header className="flex items-center gap-2 px-1.5 pb-2 pt-1">
              <span className={cn('size-2 rounded-full', column.dot)} aria-hidden />
              <h3 className="font-mono text-[11px] tracking-[0.18em] text-zinc-400 uppercase">
                {column.label}
              </h3>
              <span className="font-mono text-[11px] text-zinc-600">{columnNotes.length}</span>
              <Button
                size="icon-sm"
                variant="ghost"
                className="ml-auto"
                aria-label={`New note in ${column.label}`}
                title={`New note in ${column.label}`}
                disabled={quickAdd.isPending}
                onClick={() => quickAdd.mutate(column.id)}
              >
                <Plus />
              </Button>
            </header>

            <div className="flex min-h-[120px] flex-col gap-2">
              {columnNotes.length === 0 ? (
                <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-zinc-800/80 px-3 py-6 text-center text-[11px] text-zinc-600">
                  {column.id === 'done' ? 'Nothing finished yet' : 'Drag notes here'}
                </div>
              ) : (
                columnNotes.map((note) => (
                  <article
                    key={note.id}
                    data-testid="board-card"
                    data-note-id={note.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', String(note.id));
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => setDragOverColumn(null)}
                    onClick={() => onSelect(note.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect(note.id);
                      }
                    }}
                    className={cn(
                      'group cursor-grab rounded-xl border border-zinc-800 bg-zinc-900/70 p-2.5 transition-colors active:cursor-grabbing',
                      'hover:border-zinc-700 hover:bg-zinc-900 focus-visible:ring-2 focus-visible:ring-accent-500/50 focus-visible:outline-none',
                    )}
                  >
                    <p
                      className="truncate text-[13px] font-medium text-zinc-200"
                      title={note.title}
                    >
                      {note.title}
                    </p>
                    {note.preview && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-zinc-600">
                        {note.preview.replace(/\s+/g, ' ').trim()}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {note.due_at && (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10px]',
                            DUE_BADGE[dueTone(note.due_at)],
                          )}
                        >
                          <CalendarClock className="size-2.5" />
                          {dueLabel(note.due_at)}
                        </span>
                      )}
                      {isRecurring(note.recurrence) && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
                          title={`Repeats ${RECURRENCE_LABELS[note.recurrence ?? 'none'].toLowerCase()}`}
                        >
                          <Repeat className="size-2.5" />
                          {RECURRENCE_LABELS[note.recurrence ?? 'none']}
                        </span>
                      )}
                      {note.favorite && (
                        <Star
                          className="size-2.5 fill-amber-400/80 text-amber-400/80"
                          aria-label="Favorite"
                        />
                      )}
                      {note.tags.slice(0, 2).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
                        >
                          #{tag}
                        </span>
                      ))}
                      {note.tags.length > 2 && (
                        <span className="font-mono text-[10px] text-zinc-600">
                          +{note.tags.length - 2}
                        </span>
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
