import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  Archive,
  ArchiveRestore,
  ArrowUpDown,
  Check,
  CheckSquare,
  ChevronDown,
  FileText,
  FolderInput,
  FolderPlus,
  Loader2,
  Lock,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  Square,
  Star,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ApiError,
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  listFolders,
  listNotesSorted,
  listTrashedNotes,
  restoreNote,
  saveNote,
  updateFolder,
  updateNote,
  type Folder,
  type NoteSort,
  type NoteSummary,
} from '../lib/api';
import { encryptText } from '../lib/crypto';
import { getCryptoKey, useE2E } from '../lib/e2e';
import { NOTE_TEMPLATES } from '../lib/note-templates';
import { SHORTCUT_EVENTS } from '../lib/shortcuts';
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

const SORT_KEY = 'notes-sort';

const SORTS: { key: NoteSort; label: string }[] = [
  { key: 'updated', label: 'Recently updated' },
  { key: 'created', label: 'Recently created' },
  { key: 'alpha', label: 'Alphabetical' },
  { key: 'manual', label: 'Manual order' },
];

function handleApiError(err: unknown, onUnauthorized: () => void, fallback: string) {
  if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
    onUnauthorized();
    return;
  }
  toast.error(err instanceof Error ? err.message : fallback);
}

function newMutationId(): string {
  return crypto.randomUUID();
}

export function NotesSidebar({ selectedId, onSelect, onUnauthorized }: NotesSidebarProps) {
  const queryClient = useQueryClient();
  const e2e = useE2E();
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [folderFilter, setFolderFilter] = useState<number | 'all' | 'fav' | 'none'>('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [templateOpen, setTemplateOpen] = useState(false);
  const [folderDraft, setFolderDraft] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<number | null>(null);
  const [folderDeleteId, setFolderDeleteId] = useState<number | null>(null);
  const [bulkFolder, setBulkFolder] = useState('');
  const [sort, setSort] = useState<NoteSort>(() => {
    try {
      const raw = localStorage.getItem(SORT_KEY);
      return raw === 'created' || raw === 'alpha' || raw === 'manual' ? raw : 'updated';
    } catch {
      return 'updated';
    }
  });

  const notesQuery = useQuery({
    queryKey: ['notes', sort, search],
    queryFn: () => listNotesSorted(sort, search),
    retry: false,
  });
  const foldersQuery = useQuery({ queryKey: ['folders'], queryFn: listFolders, retry: false });
  const trashQuery = useQuery({
    queryKey: ['notes-trash'],
    queryFn: listTrashedNotes,
    retry: false,
    enabled: trashOpen,
  });

  useEffect(() => {
    if (notesQuery.error instanceof ApiError && notesQuery.error.code === 'UNAUTHORIZED') {
      onUnauthorized();
    }
  }, [notesQuery.error, onUnauthorized]);

  // External tag filter requests (preview #tag chips, Cmd+K tag jumps).
  useEffect(() => {
    const go = (event: Event) => {
      const tag = (event as CustomEvent<string>).detail;
      if (typeof tag === 'string' && tag) {
        setTagFilter(tag);
        setFolderFilter('all');
      }
    };
    window.addEventListener(SHORTCUT_EVENTS.filterTag, go);
    return () => window.removeEventListener(SHORTCUT_EVENTS.filterTag, go);
  }, []);

  useEffect(() => {
    if (confirmId === null) return;
    const timer = setTimeout(() => setConfirmId(null), 3500);
    return () => clearTimeout(timer);
  }, [confirmId]);

  function changeSort(next: NoteSort) {
    setSort(next);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {
      /* ignore */
    }
    // Prefetch server order so manual drag positions persist across reloads.
    if (next === 'manual') void listNotesSorted('manual');
  }

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
    void queryClient.invalidateQueries({ queryKey: ['notes-trash'] });
    void queryClient.invalidateQueries({ queryKey: ['folders'] });
  };

  const create = useMutation({
    mutationFn: async (opts: { title: string; body: string; folderId?: number | null }) => {
      const note = await createNote(opts.title, opts.folderId ?? undefined);
      if (opts.body) {
        let content = opts.body;
        let enc = false;
        if (e2e) {
          const key = await getCryptoKey();
          if (!key) throw new Error('No encryption key available — re-enter your token');
          content = await encryptText(key, opts.body);
          enc = true;
        }
        await saveNote({
          id: note.id,
          content,
          baseVersion: note.content_version ?? 1,
          mutationId: newMutationId(),
          enc,
        });
      }
      return note;
    },
    onSuccess: (note) => {
      invalidateAll();
      setTemplateOpen(false);
      onSelect(note.id);
    },
    onError: (err) => handleApiError(err, onUnauthorized, 'Could not create note'),
  });

  const patch = useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Parameters<typeof updateNote>[1] }) =>
      updateNote(id, fields),
    onSuccess: invalidateAll,
    onError: (err) => handleApiError(err, onUnauthorized, 'Update failed'),
  });

  const remove = useMutation({
    mutationFn: ({ id, permanent }: { id: number; permanent?: boolean }) =>
      deleteNote(id, permanent),
    onSuccess: (_data, vars) => {
      setConfirmId(null);
      setRenamingId(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(vars.id);
        return next;
      });
      invalidateAll();
      if (selectedId === vars.id && !vars.permanent) {
        const remaining = (queryClient.getQueryData<NoteSummary[]>(['notes']) ?? []).filter(
          (note) => note.id !== vars.id,
        );
        const fallback = remaining.find((note) => !note.archived) ?? remaining[0];
        if (fallback) onSelect(fallback.id);
      }
      toast.success(vars.permanent ? 'Note permanently deleted' : 'Note moved to trash');
    },
    onError: (err) => handleApiError(err, onUnauthorized, 'Delete failed'),
  });

  const restore = useMutation({
    mutationFn: restoreNote,
    onSuccess: invalidateAll,
    onError: (err) => handleApiError(err, onUnauthorized, 'Restore failed'),
  });

  const addFolder = useMutation({
    mutationFn: createFolder,
    onSuccess: () => {
      setFolderDraft(false);
      setFolderName('');
      void queryClient.invalidateQueries({ queryKey: ['folders'] });
    },
    onError: (err) => handleApiError(err, onUnauthorized, 'Could not create folder'),
  });

  const editFolder = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => updateFolder(id, { name }),
    onSuccess: () => {
      setRenamingFolder(null);
      void queryClient.invalidateQueries({ queryKey: ['folders'] });
    },
    onError: (err) => handleApiError(err, onUnauthorized, 'Rename failed'),
  });

  const dropFolder = useMutation({
    mutationFn: deleteFolder,
    onSuccess: () => {
      setFolderDeleteId(null);
      if (typeof folderFilter === 'number') setFolderFilter('all');
      invalidateAll();
      toast.success('Folder deleted — notes moved to Unfiled');
    },
    onError: (err) => handleApiError(err, onUnauthorized, 'Delete failed'),
  });

  const notes = useMemo(() => notesQuery.data ?? [], [notesQuery.data]);
  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes) {
      if (note.archived) continue;
      for (const tag of note.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [notes]);

  const query = search.trim().toLowerCase();
  const matches = (note: NoteSummary) => {
    if (query) {
      const hay =
        `${note.title} ${note.preview ?? ''} ${note.search_text ?? ''} ${(note.tags ?? []).join(' ')}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    if (tagFilter && !(note.tags ?? []).includes(tagFilter)) return false;
    if (folderFilter === 'fav' && !note.favorite) return false;
    if (folderFilter === 'none' && note.folder_id !== null) return false;
    if (typeof folderFilter === 'number' && note.folder_id !== folderFilter) return false;
    return true;
  };

  const sorter = (a: NoteSummary, b: NoteSummary) => {
    // Pinned and favorites always float, regardless of sort mode.
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
    switch (sort) {
      case 'created':
        return b.created_at.localeCompare(a.created_at);
      case 'alpha':
        return a.title.localeCompare(b.title);
      case 'manual':
        return (
          (a.sort_order ?? 0) - (b.sort_order ?? 0) || b.updated_at.localeCompare(a.updated_at)
        );
      default:
        return b.updated_at.localeCompare(a.updated_at);
    }
  };

  const visible = notes.filter((note) => !note.archived && matches(note)).sort(sorter);
  const archived = notes.filter((note) => note.archived && matches(note)).sort(sorter);
  const favorites = notes.filter((note) => !note.archived && note.favorite);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function bulkPatch(fields: Parameters<typeof updateNote>[1]) {
    const ids = [...selected];
    if (ids.length === 0) return;
    void (async () => {
      let failed = 0;
      for (const id of ids) {
        try {
          await updateNote(id, fields);
        } catch {
          failed++;
        }
      }
      setSelected(new Set());
      setSelectMode(false);
      invalidateAll();
      if (failed > 0) toast.warning(`${ids.length - failed} updated, ${failed} failed`);
      else toast.success(`${ids.length} note${ids.length === 1 ? '' : 's'} updated`);
    })();
  }

  function bulkTrash() {
    const ids = [...selected];
    if (ids.length === 0) return;
    void (async () => {
      for (const id of ids) {
        try {
          await deleteNote(id);
        } catch {
          /* reported below */
        }
      }
      setSelected(new Set());
      setSelectMode(false);
      invalidateAll();
      toast.success(`${ids.length} note${ids.length === 1 ? '' : 's'} moved to trash`);
    })();
  }

  function moveNoteToFolder(noteId: number, folderId: number | null) {
    patch.mutate({ id: noteId, fields: { folder_id: folderId } });
  }

  function handleManualDrop(dragId: number, targetId: number) {
    if (sort !== 'manual' || dragId === targetId) return;
    const order = visible.map((n) => n.id);
    const from = order.indexOf(dragId);
    const to = order.indexOf(targetId);
    if (from === -1 || to === -1) return;
    order.splice(from, 1);
    order.splice(to, 0, dragId);
    // Optimistic: persist index*10 so future inserts fit between rows.
    queryClient.setQueryData<NoteSummary[]>(['notes'], (old) =>
      (old ?? []).map((note) => {
        const idx = order.indexOf(note.id);
        return idx === -1 ? note : { ...note, sort_order: idx * 10 };
      }),
    );
    void (async () => {
      for (let i = 0; i < order.length; i++) {
        try {
          await updateNote(order[i], { sort_order: i * 10 });
        } catch {
          /* keep going */
        }
      }
      invalidateAll();
    })();
  }

  const folderNameOf = (id: number | null) => folders.find((f) => f.id === id)?.name ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <span className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
          notes
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
            title={selectMode ? 'Exit selection' : 'Select multiple notes'}
            aria-pressed={selectMode}
            className={cn(
              'flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors',
              selectMode
                ? 'text-accent-300'
                : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200',
            )}
          >
            {selectMode ? <CheckSquare className="size-3.5" /> : <Square className="size-3.5" />}
          </button>
          <div className="relative">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const blank = NOTE_TEMPLATES[0];
                create.mutate({ title: blank.title, body: blank.body(new Date()) });
              }}
              disabled={create.isPending}
              title="New note (Blank template — click the chevron for more)"
            >
              {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              New
            </Button>
            <button
              onClick={() => setTemplateOpen((v) => !v)}
              aria-expanded={templateOpen}
              aria-label="Choose a note template"
              className="cursor-pointer rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            >
              <ChevronDown
                className={cn('size-3.5 transition-transform', templateOpen && 'rotate-180')}
              />
            </button>
            {templateOpen && (
              <div
                role="menu"
                aria-label="Note templates"
                className="absolute top-full right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-zinc-700/70 bg-zinc-900 p-1.5 shadow-[0_16px_50px_-12px_rgb(0_0_0/0.8)]"
              >
                {NOTE_TEMPLATES.map((t) => (
                  <button
                    key={t.key}
                    role="menuitem"
                    onClick={() => create.mutate({ title: t.title, body: t.body(new Date()) })}
                    className="block w-full cursor-pointer rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="relative px-1 pt-2">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-[calc(50%-4px)] text-zinc-600" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search notes, content, tags…"
          aria-label="Search notes"
          className="pl-8"
        />
      </div>

      <div className="flex items-center gap-1.5 px-1 pt-2">
        <ArrowUpDown className="size-3.5 shrink-0 text-zinc-600" />
        <select
          value={sort}
          onChange={(e) => changeSort(e.target.value as NoteSort)}
          aria-label="Sort notes"
          className="w-full cursor-pointer rounded-md border border-zinc-800 bg-zinc-950/60 px-1.5 py-1 text-xs text-zinc-300 "
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* Folder + favorites filter pills (also drag-drop targets). */}
      <div className="flex flex-wrap gap-1 px-1 pt-2" aria-label="Filter by folder">
        <FilterPill
          active={folderFilter === 'all'}
          label="All"
          onClick={() => setFolderFilter('all')}
          onDropNote={(id) => moveNoteToFolder(id, null)}
        />
        <FilterPill
          active={folderFilter === 'fav'}
          label="★ Favorites"
          onClick={() => setFolderFilter('fav')}
        />
        <FilterPill
          active={folderFilter === 'none'}
          label="Unfiled"
          onClick={() => setFolderFilter('none')}
          onDropNote={(id) => moveNoteToFolder(id, null)}
        />
        {folders.map((folder) => (
          <FolderPill
            key={folder.id}
            folder={folder}
            active={folderFilter === folder.id}
            renaming={renamingFolder === folder.id}
            confirmingDelete={folderDeleteId === folder.id}
            onSelect={() => setFolderFilter(folder.id)}
            onDropNote={(id) => moveNoteToFolder(id, folder.id)}
            onRenameStart={() => {
              setFolderDeleteId(null);
              setRenamingFolder(folder.id);
            }}
            onRenameCommit={(name) => {
              if (name.trim() && name.trim() !== folder.name) {
                editFolder.mutate({ id: folder.id, name: name.trim() });
              } else {
                setRenamingFolder(null);
              }
            }}
            onDeleteAsk={() => setFolderDeleteId(folder.id)}
            onDeleteConfirm={() => dropFolder.mutate(folder.id)}
            onDeleteCancel={() => setFolderDeleteId(null)}
          />
        ))}
        {folderDraft ? (
          <span className="flex items-center gap-1">
            <input
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && folderName.trim()) addFolder.mutate(folderName.trim());
                if (e.key === 'Escape') {
                  setFolderDraft(false);
                  setFolderName('');
                }
              }}
              onBlur={() => {
                if (!folderName.trim()) {
                  setFolderDraft(false);
                  setFolderName('');
                }
              }}
              placeholder="Folder name…"
              aria-label="New folder name"
              className="w-24 rounded-md border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-xs text-zinc-100 "
            />
            <button
              onClick={() => folderName.trim() && addFolder.mutate(folderName.trim())}
              aria-label="Create folder"
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-accent-300 hover:bg-zinc-800"
            >
              <Check className="size-3.5" />
            </button>
          </span>
        ) : (
          <button
            onClick={() => setFolderDraft(true)}
            title="New folder"
            aria-label="New folder"
            className="flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <FolderPlus className="size-3.5" />
          </button>
        )}
      </div>

      {/* Tag chips. */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1 pt-2" aria-label="Filter by tag">
          {tagFilter && (
            <button
              onClick={() => setTagFilter(null)}
              className="flex cursor-pointer items-center gap-1 rounded-full border border-accent-600/50 bg-accent-500/15 px-2 py-0.5 text-[11px] text-accent-300"
            >
              #{tagFilter} <X className="size-3" />
            </button>
          )}
          {!tagFilter &&
            allTags.map(([tag, count]) => (
              <button
                key={tag}
                onClick={() => setTagFilter(tag)}
                className="cursor-pointer rounded-full border border-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-500 hover:border-zinc-600 hover:text-zinc-200"
              >
                #{tag} · {count}
              </button>
            ))}
        </div>
      )}

      {selectMode && selected.size > 0 && (
        <div className="mx-1 mt-2 flex flex-wrap items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/70 p-1.5">
          <span className="px-1 font-mono text-[11px] text-zinc-500">{selected.size} selected</span>
          <BulkButton label="Pin" onClick={() => bulkPatch({ pinned: true })} />
          <BulkButton label="Favorite" onClick={() => bulkPatch({ favorite: true })} />
          <BulkButton label="Archive" onClick={() => bulkPatch({ archived: true })} />
          <BulkButton label="Trash" danger onClick={bulkTrash} />
          <select
            value={bulkFolder}
            onChange={(e) => {
              setBulkFolder(e.target.value);
              if (e.target.value !== '') {
                bulkPatch({
                  folder_id: e.target.value === 'none' ? null : parseInt(e.target.value, 10),
                });
                setBulkFolder('');
              }
            }}
            aria-label="Move selected to folder"
            className="cursor-pointer rounded-md border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-[11px] text-zinc-300"
          >
            <option value="">Move to…</option>
            <option value="none">Unfiled</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      )}

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
            {sort === 'manual' && (
              <p className="px-2 pt-1 pb-2 text-[11px] text-zinc-600">
                Drag notes to reorder — positions persist per note.
              </p>
            )}
            {visible.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                folderName={folderNameOf(note.folder_id)}
                selected={note.id === selectedId}
                checked={selected.has(note.id)}
                selectMode={selectMode}
                renaming={renamingId === note.id}
                confirming={confirmId === note.id}
                deleting={remove.isPending && remove.variables?.id === note.id}
                onToggleCheck={() => toggleSelect(note.id)}
                onSelect={() => onSelect(note.id)}
                onPin={() => patch.mutate({ id: note.id, fields: { pinned: !note.pinned } })}
                onFavorite={() =>
                  patch.mutate({ id: note.id, fields: { favorite: !note.favorite } })
                }
                onArchive={() => patch.mutate({ id: note.id, fields: { archived: true } })}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/noting-note', String(note.id));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDropNote={(dragId) => handleManualDrop(dragId, note.id)}
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
                onDeleteConfirm={() => remove.mutate({ id: note.id })}
              />
            ))}
            {visible.length === 0 && (
              <div className="px-2 py-8 text-center">
                <p className="text-xs text-zinc-400">
                  {query || tagFilter || folderFilter !== 'all'
                    ? 'Nothing matches these filters — clear them to see everything.'
                    : 'A blank page. Start your first note above.'}
                </p>
                {(tagFilter || folderFilter !== 'all') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2"
                    onClick={() => {
                      setTagFilter(null);
                      setFolderFilter('all');
                      setSearch('');
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            )}

            {favorites.length > 0 && folderFilter === 'all' && !query && (
              <p className="px-2 py-1 font-mono text-[11px] text-zinc-600">
                {favorites.length} favorite{favorites.length === 1 ? '' : 's'} · {notes.length}{' '}
                notes
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
                          folderName={folderNameOf(note.folder_id)}
                          selected={note.id === selectedId}
                          checked={selected.has(note.id)}
                          selectMode={selectMode}
                          renaming={renamingId === note.id}
                          confirming={confirmId === note.id}
                          deleting={remove.isPending && remove.variables?.id === note.id}
                          dimmed
                          onToggleCheck={() => toggleSelect(note.id)}
                          onSelect={() => onSelect(note.id)}
                          onPin={() =>
                            patch.mutate({ id: note.id, fields: { pinned: !note.pinned } })
                          }
                          onFavorite={() =>
                            patch.mutate({ id: note.id, fields: { favorite: !note.favorite } })
                          }
                          onArchive={() =>
                            patch.mutate({ id: note.id, fields: { archived: false } })
                          }
                          archivedView
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/noting-note', String(note.id));
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDropNote={() => undefined}
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
                          onDeleteConfirm={() => remove.mutate({ id: note.id })}
                        />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Note trash — 30 days, like files. */}
            <div className="mt-1">
              <button
                onClick={() => setTrashOpen((value) => !value)}
                aria-expanded={trashOpen}
                className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-900/60 hover:text-zinc-300"
              >
                <ChevronDown
                  className={cn('size-3.5 transition-transform', !trashOpen && '-rotate-90')}
                />
                Trash ({trashQuery.data?.length ?? '…'})
              </button>
              <AnimatePresence initial={false}>
                {trashOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    {trashQuery.isPending && (
                      <div className="flex flex-col gap-1.5 p-1">
                        <Skeleton className="h-10 w-full" />
                      </div>
                    )}
                    {trashQuery.isSuccess && trashQuery.data.length === 0 && (
                      <p className="px-2 py-4 text-center text-xs text-zinc-600">
                        Trash is empty. Deleted notes rest here for 30 days.
                      </p>
                    )}
                    {trashQuery.data?.map((note) => (
                      <div
                        key={note.id}
                        className="mb-1 rounded-lg border border-transparent px-2.5 py-2 opacity-70 hover:border-zinc-800/80 hover:bg-zinc-900/50"
                      >
                        <p className="truncate text-[13px] font-medium text-zinc-300">
                          {note.title}
                        </p>
                        <p className="font-mono text-[11px] text-zinc-600">
                          deleted {timeAgo(note.updated_at)} · auto-removes after 30 days
                        </p>
                        <span className="mt-1 flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={restore.isPending}
                            onClick={() => restore.mutate(note.id)}
                            title="Restore note"
                          >
                            <RotateCcw /> Restore
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={remove.isPending}
                            onClick={() => {
                              if (window.confirm(`Permanently delete “${note.title}”?`)) {
                                remove.mutate({ id: note.id, permanent: true });
                              }
                            }}
                            title="Delete forever"
                            className="hover:bg-red-950/50 hover:text-red-300"
                          >
                            <Trash2 /> Forever
                          </Button>
                        </span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BulkButton({
  label,
  danger,
  onClick,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'cursor-pointer rounded-md px-1.5 py-0.5 text-[11px] transition-colors',
        danger
          ? 'text-red-300 hover:bg-red-950/50'
          : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100',
      )}
    >
      {label}
    </button>
  );
}

function FilterPill({
  active,
  label,
  onClick,
  onDropNote,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  onDropNote?: (noteId: number) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <button
      onClick={onClick}
      onDragOver={
        onDropNote
          ? (e) => {
              e.preventDefault();
              setOver(true);
            }
          : undefined
      }
      onDragLeave={() => setOver(false)}
      onDrop={
        onDropNote
          ? (e) => {
              e.preventDefault();
              setOver(false);
              const id = parseInt(e.dataTransfer.getData('text/noting-note'), 10);
              if (!Number.isNaN(id)) onDropNote(id);
            }
          : undefined
      }
      className={cn(
        'cursor-pointer rounded-full border px-2 py-0.5 text-[11px] transition-colors',
        active
          ? 'border-accent-600/50 bg-accent-500/15 text-accent-300'
          : 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-200',
        over && 'border-accent-500 bg-accent-500/10',
      )}
    >
      {label}
    </button>
  );
}

function FolderPill({
  folder,
  active,
  renaming,
  confirmingDelete,
  onSelect,
  onDropNote,
  onRenameStart,
  onRenameCommit,
  onDeleteAsk,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  folder: Folder;
  active: boolean;
  renaming: boolean;
  confirmingDelete: boolean;
  onSelect: () => void;
  onDropNote: (noteId: number) => void;
  onRenameStart: () => void;
  onRenameCommit: (name: string) => void;
  onDeleteAsk: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}) {
  const [over, setOver] = useState(false);
  const [draft, setDraft] = useState(folder.name);

  useEffect(() => {
    if (confirmingDelete) {
      const timer = setTimeout(onDeleteCancel, 3500);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmingDelete]);

  if (renaming) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onRenameCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onRenameCommit(draft);
          if (e.key === 'Escape') onRenameCommit(folder.name);
        }}
        aria-label="Folder name"
        className="w-24 rounded-full border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-100 "
      />
    );
  }

  if (confirmingDelete) {
    return (
      <span className="flex items-center gap-1 rounded-full border border-red-900/60 bg-red-950/30 px-1.5 py-0.5 text-[11px] text-red-300">
        Delete {folder.name}?
        <button
          onClick={onDeleteConfirm}
          aria-label="Confirm delete folder"
          className="cursor-pointer hover:text-red-100"
        >
          <Check className="size-3" />
        </button>
        <button
          onClick={onDeleteCancel}
          aria-label="Cancel"
          className="cursor-pointer hover:text-red-100"
        >
          <X className="size-3" />
        </button>
      </span>
    );
  }

  return (
    <span
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = parseInt(e.dataTransfer.getData('text/noting-note'), 10);
        if (!Number.isNaN(id)) onDropNote(id);
      }}
      className={cn(
        'group flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
        active
          ? 'border-accent-600/50 bg-accent-500/15 text-accent-300'
          : 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-200',
        over && 'border-accent-500 bg-accent-500/10',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        title={`Filter by ${folder.name} (${folder.note_count})`}
        className="flex min-w-0 items-center gap-1 text-left"
      >
        <FolderInput className="size-3" />
        <span className="truncate">{folder.name}</span>
        <span className="font-mono text-[10px] opacity-70">{folder.note_count}</span>
      </button>
      <button
        type="button"
        onClick={onRenameStart}
        title="Rename folder"
        aria-label={`Rename ${folder.name}`}
        className="hover-reveal cursor-pointer hover:text-zinc-100"
      >
        <Pencil className="size-3" />
      </button>
      <button
        type="button"
        onClick={onDeleteAsk}
        title="Delete folder (notes become Unfiled)"
        aria-label={`Delete ${folder.name}`}
        className="hover-reveal cursor-pointer hover:text-red-300"
      >
        <Trash2 className="size-3" />
      </button>
    </span>
  );
}

interface NoteRowProps {
  note: NoteSummary;
  folderName: string | null;
  selected: boolean;
  checked: boolean;
  selectMode: boolean;
  renaming: boolean;
  confirming: boolean;
  deleting: boolean;
  dimmed?: boolean;
  archivedView?: boolean;
  onToggleCheck: () => void;
  onSelect: () => void;
  onPin: () => void;
  onFavorite: () => void;
  onArchive: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDropNote: (dragId: number) => void;
  onRenameStart: () => void;
  onRenameCommit: (title: string) => void;
  onRenameCancel: () => void;
  onDeleteAsk: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
}

function NoteRow({
  note,
  folderName,
  selected,
  checked,
  selectMode,
  renaming,
  confirming,
  deleting,
  dimmed,
  archivedView,
  onToggleCheck,
  onSelect,
  onPin,
  onFavorite,
  onArchive,
  onDragStart,
  onDropNote,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onDeleteAsk,
  onDeleteCancel,
  onDeleteConfirm,
}: NoteRowProps) {
  const [draft, setDraft] = useState(note.title);
  const [dropOver, setDropOver] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('text/noting-note')) {
          e.preventDefault();
          setDropOver(true);
        }
      }}
      onDragLeave={() => setDropOver(false)}
      onDrop={(e) => {
        const id = parseInt(e.dataTransfer.getData('text/noting-note'), 10);
        setDropOver(false);
        if (!Number.isNaN(id)) {
          e.stopPropagation();
          onDropNote(id);
        }
      }}
      className={cn(
        'group mb-1 rounded-lg border transition-colors duration-150',
        selected
          ? 'border-zinc-700 bg-zinc-900/80'
          : 'border-transparent hover:border-zinc-800/80 hover:bg-zinc-900/50',
        dimmed && 'opacity-70',
        dropOver && 'border-accent-500/60 bg-accent-500/5',
        checked && 'border-accent-600/50',
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        draggable={!renaming}
        onDragStart={onDragStart}
        className="flex cursor-pointer items-start gap-2 px-2.5 py-2"
      >
        {selectMode && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCheck();
            }}
            aria-label={checked ? 'Deselect note' : 'Select note'}
            aria-pressed={checked}
            className="mt-1 shrink-0 cursor-pointer text-zinc-500 hover:text-zinc-200"
          >
            {checked ? (
              <CheckSquare className="size-4 text-accent-300" />
            ) : (
              <Square className="size-4" />
            )}
          </button>
        )}
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
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[13px] text-zinc-100 "
            />
          ) : (
            <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-zinc-200">
              <span className="truncate">{note.title}</span>
              {note.enc && <Lock className="size-3 shrink-0 text-accent-300" />}
              {note.favorite && (
                <Star className="size-3 shrink-0 fill-accent-400 text-accent-400" />
              )}
            </p>
          )}
          <p className="truncate font-mono text-[11px] text-zinc-600">
            {(note.preview ?? '').replace(/\s+/g, ' ').slice(0, 60) || 'Empty note'} ·{' '}
            {timeAgo(note.updated_at)}
          </p>
          {(folderName || (note.tags ?? []).length > 0) && (
            <p className="mt-0.5 flex flex-wrap items-center gap-1">
              {folderName && (
                <span className="rounded border border-zinc-800 px-1 font-mono text-[10px] text-zinc-500">
                  {folderName}
                </span>
              )}
              {(note.tags ?? []).slice(0, 3).map((tag) => (
                <span key={tag} className="font-mono text-[10px] text-zinc-600">
                  #{tag}
                </span>
              ))}
            </p>
          )}
          {confirming ? (
            <span className="mt-1.5 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="danger" disabled={deleting} onClick={onDeleteConfirm}>
                {deleting ? <Loader2 className="animate-spin" /> : <Check />}
                Trash
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={onDeleteCancel} title="Cancel">
                <X />
              </Button>
            </span>
          ) : (
            <span
              className="hover-reveal mt-1 flex items-center gap-0.5 transition-opacity duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <IconButton
                title={note.pinned ? 'Unpin' : 'Pin'}
                onClick={onPin}
                active={note.pinned}
              >
                {note.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              </IconButton>
              <IconButton
                title={note.favorite ? 'Remove favorite' : 'Favorite'}
                onClick={onFavorite}
                active={note.favorite}
              >
                <Star className={cn('size-3.5', note.favorite && 'fill-accent-400')} />
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
                title="Move to trash"
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
