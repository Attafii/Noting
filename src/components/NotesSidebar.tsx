import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  FileText,
  Loader2,
  Lock,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ApiError,
  createNote,
  deleteNote,
  listNotes,
  updateNote,
  type NoteSummary,
} from '../lib/api';
import { timeAgo } from '../lib/format';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Skeleton } from './ui/skeleton';

interface NotesSidebarProps {
  selectedId: number | null;
  onSelect: (id: number) => void;
  onUnauthorized: () => void;
}

function handleApiError(err: unknown, onUnauthorized: () => void, fallback: string) {
  if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
    onUnauthorized();
    return;
  }
  toast.error(err instanceof Error ? err.message : fallback);
}

export function NotesSidebar({ selectedId, onSelect, onUnauthorized }: NotesSidebarProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);

  const notesQuery = useQuery({ queryKey: ['notes'], queryFn: listNotes, retry: false });

  useEffect(() => {
    if (notesQuery.error instanceof ApiError && notesQuery.error.code === 'UNAUTHORIZED') {
      onUnauthorized();
    }
  }, [notesQuery.error, onUnauthorized]);

  useEffect(() => {
    if (confirmId === null) return;
    const timer = setTimeout(() => setConfirmId(null), 3500);
    return () => clearTimeout(timer);
  }, [confirmId]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notes'] });

  const create = useMutation({
    mutationFn: () => createNote('Untitled'),
    onSuccess: (note) => {
      invalidate();
      onSelect(note.id);
    },
    onError: (err) => handleApiError(err, onUnauthorized, 'Could not create note'),
  });

  const patch = useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Parameters<typeof updateNote>[1] }) =>
      updateNote(id, fields),
    onSuccess: invalidate,
    onError: (err) => handleApiError(err, onUnauthorized, 'Update failed'),
  });

  const remove = useMutation({
    mutationFn: deleteNote,
    onSuccess: (_data, id) => {
      setConfirmId(null);
      setRenamingId(null);
      const remaining = (queryClient.getQueryData<NoteSummary[]>(['notes']) ?? []).filter(
        (note) => note.id !== id,
      );
      invalidate();
      if (selectedId === id) {
        const fallback = remaining.find((note) => !note.archived) ?? remaining[0];
        if (fallback) onSelect(fallback.id);
      }
      toast.success('Note deleted');
    },
    onError: (err) => handleApiError(err, onUnauthorized, 'Delete failed'),
  });

  const notes = notesQuery.data ?? [];
  const query = search.trim().toLowerCase();
  const matches = (note: NoteSummary) =>
    !query ||
    note.title.toLowerCase().includes(query) ||
    (note.preview ?? '').toLowerCase().includes(query);
  const active = notes.filter((note) => !note.archived && matches(note));
  const archived = notes.filter((note) => note.archived && matches(note));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <span className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
          notes
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => create.mutate()}
          disabled={create.isPending}
          title="New note"
        >
          {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
          New
        </Button>
      </div>

      <div className="relative px-1 pt-2">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-[calc(50%-4px)] text-zinc-600" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search notes…"
          aria-label="Search notes"
          className="pl-8"
        />
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {notesQuery.isPending && (
          <div className="flex flex-col gap-1.5 pt-1" aria-label="Loading notes">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}

        {notesQuery.isError && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-red-900/50 bg-red-950/20 px-3 py-8 text-center">
            <TriangleAlert className="size-4 text-red-300" />
            <p className="text-xs text-zinc-400">Couldn&apos;t load notes</p>
            <Button size="sm" onClick={() => notesQuery.refetch()}>
              Try again
            </Button>
          </div>
        )}

        {notesQuery.isSuccess && (
          <>
            {active.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                selected={note.id === selectedId}
                renaming={renamingId === note.id}
                confirming={confirmId === note.id}
                deleting={remove.isPending && remove.variables === note.id}
                onSelect={() => onSelect(note.id)}
                onPin={() => patch.mutate({ id: note.id, fields: { pinned: !note.pinned } })}
                onArchive={() => patch.mutate({ id: note.id, fields: { archived: true } })}
                onRenameStart={() => {
                  setConfirmId(null);
                  setRenamingId(note.id);
                }}
                onRenameCommit={(title) => {
                  setRenamingId(null);
                  if (title.trim() && title.trim() !== note.title) {
                    patch.mutate({ id: note.id, fields: { title: title.trim() } });
                  }
                }}
                onRenameCancel={() => setRenamingId(null)}
                onDeleteAsk={() => setConfirmId(note.id)}
                onDeleteCancel={() => setConfirmId(null)}
                onDeleteConfirm={() => remove.mutate(note.id)}
              />
            ))}
            {active.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-zinc-600">
                {query ? `No notes match “${search.trim()}”` : 'No notes yet — create one above.'}
              </p>
            )}

            {archived.length > 0 && (
              <div className="mt-1">
                <button
                  onClick={() => setShowArchived((value) => !value)}
                  aria-expanded={showArchived}
                  className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-900/60 hover:text-zinc-300"
                >
                  <ChevronDown
                    className={cn('size-3.5 transition-transform', !showArchived && '-rotate-90')}
                  />
                  Archived ({archived.length})
                </button>
                <AnimatePresence initial={false}>
                  {showArchived && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      {archived.map((note) => (
                        <NoteRow
                          key={note.id}
                          note={note}
                          selected={note.id === selectedId}
                          renaming={renamingId === note.id}
                          confirming={confirmId === note.id}
                          deleting={remove.isPending && remove.variables === note.id}
                          dimmed
                          onSelect={() => onSelect(note.id)}
                          onPin={() =>
                            patch.mutate({ id: note.id, fields: { pinned: !note.pinned } })
                          }
                          onArchive={() =>
                            patch.mutate({ id: note.id, fields: { archived: false } })
                          }
                          archivedView
                          onRenameStart={() => {
                            setConfirmId(null);
                            setRenamingId(note.id);
                          }}
                          onRenameCommit={(title) => {
                            setRenamingId(null);
                            if (title.trim() && title.trim() !== note.title) {
                              patch.mutate({ id: note.id, fields: { title: title.trim() } });
                            }
                          }}
                          onRenameCancel={() => setRenamingId(null)}
                          onDeleteAsk={() => setConfirmId(note.id)}
                          onDeleteCancel={() => setConfirmId(null)}
                          onDeleteConfirm={() => remove.mutate(note.id)}
                        />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface NoteRowProps {
  note: NoteSummary;
  selected: boolean;
  renaming: boolean;
  confirming: boolean;
  deleting: boolean;
  dimmed?: boolean;
  archivedView?: boolean;
  onSelect: () => void;
  onPin: () => void;
  onArchive: () => void;
  onRenameStart: () => void;
  onRenameCommit: (title: string) => void;
  onRenameCancel: () => void;
  onDeleteAsk: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
}

function NoteRow({
  note,
  selected,
  renaming,
  confirming,
  deleting,
  dimmed,
  archivedView,
  onSelect,
  onPin,
  onArchive,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onDeleteAsk,
  onDeleteCancel,
  onDeleteConfirm,
}: NoteRowProps) {
  const [draft, setDraft] = useState(note.title);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
      className={cn(
        'group mb-1 rounded-lg border transition-colors duration-150',
        selected
          ? 'border-zinc-700 bg-zinc-900/80'
          : 'border-transparent hover:border-zinc-800/80 hover:bg-zinc-900/50',
        dimmed && 'opacity-70',
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSelect();
        }}
        className="flex cursor-pointer items-start gap-2 px-2.5 py-2"
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950/60 text-zinc-500">
          <FileText className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => onRenameCommit(draft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRenameCommit(draft);
                if (e.key === 'Escape') onRenameCancel();
              }}
              aria-label="Note title"
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[13px] text-zinc-100 focus:outline-none"
            />
          ) : (
            <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-zinc-200">
              <span className="truncate">{note.title}</span>
              {note.enc && <Lock className="size-3 shrink-0 text-accent-300" />}
            </p>
          )}
          <p className="truncate font-mono text-[11px] text-zinc-600">
            {(note.preview ?? '').replace(/\s+/g, ' ').slice(0, 60) || 'Empty note'} ·{' '}
            {timeAgo(note.updated_at)}
          </p>
          {confirming ? (
            <span className="mt-1.5 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="danger" disabled={deleting} onClick={onDeleteConfirm}>
                {deleting ? <Loader2 className="animate-spin" /> : <Check />}
                Delete
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={onDeleteCancel} title="Cancel">
                <X />
              </Button>
            </span>
          ) : (
            <span
              className="mt-1 flex items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:duration-150 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <IconButton
                title={note.pinned ? 'Unpin' : 'Pin'}
                onClick={onPin}
                active={note.pinned}
              >
                {note.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              </IconButton>
              <IconButton title="Rename" onClick={onRenameStart}>
                <Pencil className="size-3.5" />
              </IconButton>
              <IconButton title={archivedView ? 'Unarchive' : 'Archive'} onClick={onArchive}>
                {archivedView ? (
                  <ArchiveRestore className="size-3.5" />
                ) : (
                  <Archive className="size-3.5" />
                )}
              </IconButton>
              <IconButton
                title="Delete note"
                onClick={onDeleteAsk}
                className="hover:bg-red-950/50 hover:text-red-300"
              >
                <Trash2 className="size-3.5" />
              </IconButton>
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function IconButton({
  title,
  onClick,
  active,
  className,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors',
        active ? 'text-accent-300' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200',
        className,
      )}
    >
      {children}
    </button>
  );
}
