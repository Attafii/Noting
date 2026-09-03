import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Copy,
  History,
  Loader2,
  PencilLine,
  ScanEye,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ApiError,
  formatNoteText,
  getNote,
  listRevisions,
  saveNote,
  type NotePayload,
  type NoteRevision,
} from '../lib/api';
import { countWords, timeAgo } from '../lib/format';
import { setSaveState } from '../lib/save-status';
import { SHORTCUT_EVENTS } from '../lib/shortcuts';
import { cn } from '../lib/utils';
import { ConflictDialog } from './ConflictDialog';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Skeleton } from './ui/skeleton';

// Split the markdown toolchain into its own chunk — only needed for preview.
const MarkdownView = lazy(() =>
  import('./MarkdownView').then((module) => ({ default: module.MarkdownView })),
);

/** Offline outbox: edits that failed to save due to network loss. */
const PENDING_KEY = 'note-pending';

function readPending(): string | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { content?: unknown };
    return typeof parsed.content === 'string' ? parsed.content : null;
  } catch {
    return null;
  }
}

function stashPending(content: string) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ content, at: Date.now() }));
  } catch {
    /* storage unavailable — nothing to do */
  }
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

interface NoteEditorProps {
  onUnauthorized: () => void;
}

export default function NoteEditor({ onUnauthorized }: NoteEditorProps) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [conflict, setConflict] = useState<NotePayload | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** First-load adoption state; null until server data arrives (replaces an init flag). */
  const [loadState, setLoadState] = useState<{ anchor: string; restored: boolean } | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The `updated_at` this client based its edits on — the conflict-detection anchor. */
  const baseRef = useRef<string | null>(null);
  /** Readiness + latest-text mirrors for event-listener callbacks. Synced in an effect below. */
  const readyRef = useRef(false);
  const textRef = useRef(text);
  const conflictRef = useRef(conflict);

  const noteQuery = useQuery({
    queryKey: ['note'],
    queryFn: getNote,
    retry: false,
  });

  const revisionsQuery = useQuery({
    queryKey: ['revisions'],
    queryFn: listRevisions,
    retry: false,
    enabled: historyOpen,
    staleTime: 30_000,
  });

  // Keep listener mirrors fresh (ref writes belong in effects, not render).
  useEffect(() => {
    readyRef.current = loadState !== null;
    textRef.current = text;
    conflictRef.current = conflict;
  });

  // Adopt the server version on first arrival. This is a guarded render-time
  // adjustment (the sanctioned pattern for init-on-load): it runs once because
  // setLoadState flips the guard, and every write here is idempotent.
  // Refs and toasts stay out of render — the effect below applies them.
  if (noteQuery.data && loadState === null) {
    const serverText = noteQuery.data.content ?? '';
    const pending = readPending();
    const adopted = pending !== null && pending !== serverText;
    setLoadState({ anchor: noteQuery.data.updated_at ?? '', restored: adopted });
    setText(adopted && pending !== null ? pending : serverText);
  }

  // Side effects of the first load live here, not in render.
  useEffect(() => {
    if (!loadState) return;
    baseRef.current = loadState.anchor || null;
    setSaveState('saved', loadState.anchor || undefined);
    if (loadState.restored) toast.info('Restored unsynced edits from offline session');
  }, [loadState]);

  useEffect(() => {
    if (noteQuery.error instanceof ApiError && noteQuery.error.code === 'UNAUTHORIZED') {
      onUnauthorized();
    } else if (noteQuery.error) {
      toast.error(noteQuery.error.message);
    }
  }, [noteQuery.error, onUnauthorized]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const abortRef = useRef<AbortController | null>(null);

  const save = useMutation({
    mutationFn: async (content: string) => {
      // Cancel any in-flight save so rapid keystrokes can't reorder writes.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        return await saveNote(content, controller.signal, baseRef.current);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    onMutate: () => {
      setSaveState('saving');
    },
    onSuccess: (data) => {
      baseRef.current = data.updated_at;
      setSaveState('saved', data.updated_at);
      queryClient.setQueryData(['note'], data);
      clearPending();
      void queryClient.invalidateQueries({ queryKey: ['revisions'] });
    },
    onError: (err, content) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
        setSaveState('error');
        onUnauthorized();
        return;
      }
      if (err instanceof ApiError && err.code === 'CONFLICT' && err.conflict) {
        // Pause here — the dialog resolves it, autosave resumes after.
        setSaveState('idle');
        setConflict(err.conflict);
        return;
      }
      if (err instanceof ApiError && err.status === 0 && typeof content === 'string') {
        // Network failure (likely offline) — queue for reconnect.
        stashPending(content);
        setSaveState('error');
        toast.error('Offline — edits will sync when reconnected', { id: 'offline-queue' });
        return;
      }
      setSaveState('error');
      toast.error(err instanceof Error ? err.message : 'Failed to save note');
    },
  });

  const { mutate: saveMutate } = save;

  // Keyboard shortcuts + reconnect flush. Refs keep callbacks fresh.
  useEffect(() => {
    const onSaveNow = () => {
      if (!readyRef.current || conflictRef.current) return;
      saveMutate(textRef.current);
    };
    const onTogglePreview = () => setPreview((value) => !value);
    const onToggleHistory = () => setHistoryOpen((value) => !value);
    const onReconnect = () => {
      const pending = readPending();
      if (pending === null || !readyRef.current || conflictRef.current) return;
      if (pending !== textRef.current) setText(pending);
      saveMutate(pending);
      toast.success('Back online — synced pending edits');
    };
    window.addEventListener(SHORTCUT_EVENTS.saveNow, onSaveNow);
    window.addEventListener(SHORTCUT_EVENTS.togglePreview, onTogglePreview);
    window.addEventListener(SHORTCUT_EVENTS.toggleHistory, onToggleHistory);
    window.addEventListener('online', onReconnect);
    return () => {
      window.removeEventListener(SHORTCUT_EVENTS.saveNow, onSaveNow);
      window.removeEventListener(SHORTCUT_EVENTS.togglePreview, onTogglePreview);
      window.removeEventListener(SHORTCUT_EVENTS.toggleHistory, onToggleHistory);
      window.removeEventListener('online', onReconnect);
    };
  }, [saveMutate]);

  const format = useMutation({
    mutationFn: formatNoteText,
    onSuccess: (result) => {
      setText(result.formatted);
      if (result.fallback) {
        toast.warning(result.warning ?? 'AI formatting unavailable — original kept.');
      } else {
        toast.success('Note formatted');
      }
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
        onUnauthorized();
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Formatting failed');
    },
  });

  // Debounced autosave. `save.mutate` is referentially stable, so the timer
  // only resets when the text itself changes — never on status re-renders.
  // Paused while a conflict dialog is open.
  useEffect(() => {
    if (!readyRef.current || conflict) return;
    const timer = setTimeout(() => {
      save.mutate(text);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, conflict]);

  function handleKeepMine() {
    if (!conflict) return;
    // Re-anchor onto the server version, then overwrite deliberately.
    baseRef.current = conflict.updated_at;
    setConflict(null);
    save.mutate(text);
  }

  function handleLoadTheirs() {
    if (!conflict) return;
    setText(conflict.content);
    baseRef.current = conflict.updated_at;
    setConflict(null);
    setSaveState('saved', conflict.updated_at);
    queryClient.setQueryData(['note'], conflict);
    toast.success('Loaded the other version');
  }

  function handleRestoreRevision(revision: NoteRevision) {
    const previous = text;
    setHistoryOpen(false);
    setPreview(false);
    setText(revision.content);
    // Autosave persists it within 500ms; Undo reverts before that lands.
    toast.success(`Version from ${timeAgo(revision.created_at)} loaded`, {
      action: {
        label: 'Undo',
        onClick: () => setText(previous),
      },
    });
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Copy failed — select the text manually');
    }
  }

  if (noteQuery.isPending) {
    return (
      <Card className="flex h-full flex-col">
        <CardHeader>
          <CardTitle>scratchpad</CardTitle>
          <Skeleton className="h-6 w-24" />
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-2.5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-4/5" />
        </CardContent>
      </Card>
    );
  }

  if (noteQuery.isError) {
    return (
      <Card className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-red-900/70 bg-red-950/50 text-red-300">
          <TriangleAlert className="size-4" />
        </span>
        <div>
          <p className="text-sm font-medium text-zinc-200">Couldn&apos;t load your note</p>
          <p className="mt-1 text-xs text-zinc-500">
            {noteQuery.error instanceof Error ? noteQuery.error.message : 'Something went wrong'}
          </p>
        </div>
        <Button onClick={() => noteQuery.refetch()}>Try again</Button>
      </Card>
    );
  }

  const words = countWords(text);

  return (
    <>
      <ConflictDialog
        server={conflict}
        localPreview={text}
        busy={save.isPending}
        onKeepMine={handleKeepMine}
        onLoadTheirs={handleLoadTheirs}
      />
      <Card className="flex h-full flex-col overflow-hidden">
        <CardHeader>
          <CardTitle>scratchpad</CardTitle>
          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-[11px] text-zinc-600 sm:inline">
              {words} {words === 1 ? 'word' : 'words'} · {text.length} chars
            </span>
            <div
              role="tablist"
              aria-label="Editor mode"
              title="Toggle with Ctrl+P"
              className="flex rounded-lg border border-zinc-800 bg-zinc-950/70 p-0.5"
            >
              <ModeTab
                active={!preview}
                onClick={() => setPreview(false)}
                icon={<PencilLine className="size-3.5" />}
                label="Write"
              />
              <ModeTab
                active={preview}
                onClick={() => setPreview(true)}
                icon={<ScanEye className="size-3.5" />}
                label="Preview"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="relative flex flex-1 flex-col p-0">
          <AnimatePresence mode="wait" initial={false}>
            {preview ? (
              <motion.div
                key="preview"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
                className="markdown-body max-h-[52vh] min-h-[320px] flex-1 overflow-y-auto px-5 py-4 lg:max-h-none"
              >
                {text.trim() ? (
                  <Suspense
                    fallback={
                      <div className="flex flex-col gap-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-2/3" />
                      </div>
                    }
                  >
                    <MarkdownView text={text} />
                  </Suspense>
                ) : (
                  <p className="text-zinc-600">Nothing to preview yet — switch back to Write.</p>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="editor"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
                className="flex flex-1 flex-col"
              >
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="// scratchpad — autosaves as you type"
                  spellCheck={false}
                  aria-label="Note editor"
                  className="max-h-[52vh] min-h-[320px] flex-1 resize-none bg-transparent px-5 py-4 font-mono text-sm leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:outline-none lg:max-h-none lg:min-h-[440px]"
                />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {historyOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.16 }}
                role="dialog"
                aria-label="Version history"
                className="absolute right-3 bottom-14 z-20 w-80 max-w-[calc(100%-1.5rem)] overflow-hidden rounded-xl border border-zinc-700/70 bg-zinc-900 shadow-[0_16px_50px_-12px_rgb(0_0_0/0.8)]"
              >
                <div className="border-b border-zinc-800/70 px-3.5 py-2">
                  <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
                    version history
                  </p>
                </div>
                <div className="max-h-64 overflow-y-auto p-1.5">
                  {revisionsQuery.isPending && (
                    <div className="flex flex-col gap-1.5 p-1.5">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  )}
                  {revisionsQuery.isSuccess && revisionsQuery.data.length === 0 && (
                    <p className="px-3 py-5 text-center text-xs text-zinc-500">
                      No saved versions yet — they appear after your first edits.
                    </p>
                  )}
                  {revisionsQuery.isSuccess &&
                    revisionsQuery.data.map((revision) => (
                      <button
                        key={revision.id}
                        onClick={() => handleRestoreRevision(revision)}
                        className="flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-zinc-800/70"
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-medium text-zinc-200">
                            {timeAgo(revision.created_at)}
                          </span>
                          <span className="font-mono text-[11px] text-zinc-600">
                            {countWords(revision.content)} words
                          </span>
                        </span>
                        <span className="truncate font-mono text-[11px] text-zinc-500">
                          {revision.content.replace(/\s+/g, ' ').slice(0, 80) || '(empty)'}
                        </span>
                      </button>
                    ))}
                  {revisionsQuery.isError && (
                    <p className="px-3 py-5 text-center text-xs text-zinc-500">
                      Couldn&apos;t load history.
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-between gap-2 border-t border-zinc-800/70 px-4 py-2.5">
            <span className="font-mono text-[11px] text-zinc-600 sm:hidden">
              {words}w · {text.length}c
            </span>
            <span className="hidden font-mono text-[11px] text-zinc-600 sm:inline">
              autosave · 500ms
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setHistoryOpen((open) => !open)}
                title="Version history (Ctrl+H)"
                aria-expanded={historyOpen}
              >
                <History />
                History
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                disabled={text.length === 0}
                title="Copy note to clipboard"
              >
                {copied ? <Check className="text-emerald-400" /> : <Copy />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button
                variant="accent"
                size="sm"
                onClick={() => format.mutate(text)}
                disabled={format.isPending || text.length === 0}
                title="Clean up and structure with AI"
                className={cn(format.isPending && 'opacity-80')}
              >
                {format.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {format.isPending ? 'Formatting…' : 'Format with AI'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-200',
        active ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
