import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Copy,
  History,
  Loader2,
  Lock,
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
  listNotes,
  listRevisions,
  saveNote,
  type NotePayload,
  type NoteRevision,
} from '../lib/api';
import { countWords, timeAgo } from '../lib/format';
import { setSaveState } from '../lib/save-status';
import { SHORTCUT_EVENTS } from '../lib/shortcuts';
import { decryptText, encryptText } from '../lib/crypto';
import { getCryptoKey, useE2E } from '../lib/e2e';
import { cn } from '../lib/utils';
import { ConflictDialog } from './ConflictDialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
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
  noteId: number;
  onUnauthorized: () => void;
}

export default function NoteEditor({ noteId, onUnauthorized }: NoteEditorProps) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [conflict, setConflict] = useState<NotePayload | null>(null);
  /** Decrypted server text for the conflict dialog (null while resolving). */
  const [serverPreview, setServerPreview] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** First-load adoption state; null until server data arrives (replaces an init flag). */
  const [loadState, setLoadState] = useState<{ anchor: string; restored: boolean } | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const e2e = useE2E();
  /** The `updated_at` this client based its edits on — the conflict-detection anchor. */
  const baseRef = useRef<string | null>(null);
  /** Readiness + latest-text mirrors for event-listener callbacks. Synced in an effect below. */
  const readyRef = useRef(false);
  const textRef = useRef(text);
  const conflictRef = useRef(conflict);
  /** Whether saves must store ciphertext (note is enc, or E2E just turned on). */
  const encRef = useRef(false);

  const noteQuery = useQuery({
    queryKey: ['note', noteId],
    queryFn: () => getNote(noteId),
    retry: false,
  });

  const notesQuery = useQuery({ queryKey: ['notes'], queryFn: listNotes, retry: false });

  const noteEnc = noteQuery.data?.enc ?? false;

  const revisionsQuery = useQuery({
    queryKey: ['revisions', noteId],
    queryFn: () => listRevisions(noteId),
    retry: false,
    enabled: historyOpen,
    staleTime: 30_000,
  });

  // History entries of encrypted notes are ciphertext server-side — decrypt
  // for display. Failures degrade to a placeholder per entry, never a crash.
  const revisionTextsQuery = useQuery({
    queryKey: [
      'revision-texts',
      noteId,
      (revisionsQuery.data ?? []).map((revision) => revision.id).join(','),
    ],
    queryFn: async () => {
      const items = revisionsQuery.data ?? [];
      if (!noteEnc) return items;
      const key = await getCryptoKey();
      if (!key) throw new Error('No encryption key available');
      return Promise.all(
        items.map(async (revision) => {
          try {
            return { ...revision, content: await decryptText(key, revision.content) };
          } catch {
            return { ...revision, content: '[Could not decrypt this version]' };
          }
        }),
      );
    },
    enabled: historyOpen && revisionsQuery.isSuccess,
    retry: false,
    staleTime: 30_000,
  });

  const visibleRevisions = revisionTextsQuery.data ?? (noteEnc ? [] : (revisionsQuery.data ?? []));

  // Keep listener mirrors fresh (ref writes belong in effects, not render).
  useEffect(() => {
    readyRef.current = loadState !== null;
    textRef.current = text;
    conflictRef.current = conflict;
    encRef.current = noteEnc || e2e;
  });

  // Decrypt-after-load for E2E notes. Plaintext notes resolve immediately;
  // ciphertext needs the token-derived key (failure = token mismatch).
  const decryptedQuery = useQuery({
    queryKey: ['note-text', noteId, noteQuery.data?.updated_at ?? 'pending'],
    queryFn: async () => {
      const raw = noteQuery.data?.content ?? '';
      if (!noteQuery.data?.enc) return raw;
      const key = await getCryptoKey();
      if (!key) throw new Error('No encryption key available');
      return decryptText(key, raw);
    },
    enabled: !!noteQuery.data && loadState === null,
    retry: false,
    staleTime: Infinity,
  });

  // Adopt the server version on first arrival. This is a guarded render-time
  // adjustment (the sanctioned pattern for init-on-load): it runs once because
  // setLoadState flips the guard, and every write here is idempotent.
  // Refs and toasts stay out of render — the effect below applies them.
  if (noteQuery.data && loadState === null && decryptedQuery.data !== undefined) {
    const serverText = decryptedQuery.data;
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
    mutationFn: async (input: { content: string }) => {
      // Cancel any in-flight save so rapid keystrokes can't reorder writes.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        // E2E: ciphertext goes over the wire when the note is (or becomes) encrypted.
        let content = input.content;
        const enc = encRef.current;
        if (enc) {
          const key = await getCryptoKey();
          if (!key) throw new Error('No encryption key available — re-enter your token');
          content = await encryptText(key, input.content);
        }
        return await saveNote({
          id: noteId,
          content,
          signal: controller.signal,
          baseUpdatedAt: baseRef.current,
          enc,
        });
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
      queryClient.setQueryData(['note', noteId], data);
      clearPending();
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      void queryClient.invalidateQueries({ queryKey: ['revisions', noteId] });
    },
    onError: (err, variables) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
        setSaveState('error');
        onUnauthorized();
        return;
      }
      if (err instanceof ApiError && err.code === 'CONFLICT' && err.conflict) {
        // Pause here — the dialog resolves it, autosave resumes after.
        const serverRow = err.conflict;
        setSaveState('idle');
        setConflict(serverRow);
        // Never show ciphertext in the comparison dialog: decrypt the server
        // pane for encrypted notes (async; dialog renders once ready).
        if (serverRow.enc ?? noteEnc) {
          setServerPreview(null);
          void (async () => {
            const key = await getCryptoKey();
            if (!key) {
              setServerPreview('[Locked — re-enter your token to compare]');
              return;
            }
            try {
              setServerPreview(await decryptText(key, serverRow.content));
            } catch {
              setServerPreview('[Could not decrypt — token mismatch?]');
            }
          })();
        } else {
          setServerPreview(serverRow.content);
        }
        return;
      }
      if (err instanceof ApiError && err.status === 0 && typeof variables?.content === 'string') {
        // Network failure (likely offline) — queue for reconnect.
        stashPending(variables.content);
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
      saveMutate({ content: textRef.current });
    };
    const onTogglePreview = () => setPreview((value) => !value);
    const onToggleHistory = () => setHistoryOpen((value) => !value);
    const onReconnect = () => {
      const pending = readPending();
      if (pending === null || !readyRef.current || conflictRef.current) return;
      if (pending !== textRef.current) setText(pending);
      saveMutate({ content: pending });
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
      save.mutate({ content: text });
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, conflict]);

  function handleKeepMine() {
    if (!conflict) return;
    // Re-anchor onto the server version, then overwrite deliberately.
    baseRef.current = conflict.updated_at;
    setConflict(null);
    setServerPreview(null);
    save.mutate({ content: text });
  }

  function handleLoadTheirs() {
    if (!conflict) return;
    const serverRow = conflict;
    const enc = serverRow.enc ?? noteEnc;
    if (!enc) {
      applyTheirs(serverRow.content, serverRow);
      return;
    }
    // Their version is ciphertext — decrypt before adopting.
    void (async () => {
      const key = await getCryptoKey();
      if (!key) {
        toast.error('No encryption key available — re-enter your token');
        return;
      }
      try {
        applyTheirs(await decryptText(key, serverRow.content), serverRow);
      } catch {
        toast.error('Could not decrypt the other version — token mismatch?');
      }
    })();
  }

  function applyTheirs(content: string, serverRow: NotePayload) {
    setText(content);
    baseRef.current = serverRow.updated_at;
    setConflict(null);
    setServerPreview(null);
    setSaveState('saved', serverRow.updated_at);
    queryClient.setQueryData(['note', noteId], serverRow);
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

  function handleFormat() {
    if (noteEnc) {
      toast.warning('Encrypted notes stay private — AI formatting skipped.');
      return;
    }
    format.mutate(text);
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

  if (noteQuery.isPending || (loadState === null && decryptedQuery.isPending)) {
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

  // Ciphertext loaded but the token-derived key can't open it: the token was
  // rotated or differs from the device that encrypted the note.
  if (loadState === null && decryptedQuery.isError) {
    return (
      <Card className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-accent-600/40 bg-accent-500/10 text-accent-300">
          <Lock className="size-4" />
        </span>
        <div>
          <p className="text-sm font-medium text-zinc-200">Couldn&apos;t decrypt this note</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-zinc-500">
            Your current token doesn&apos;t match the encryption key. Compare the key fingerprint in
            Settings across your devices.
          </p>
        </div>
        <Button onClick={() => decryptedQuery.refetch()}>Try again</Button>
      </Card>
    );
  }

  const words = countWords(text);
  const noteTitle = notesQuery.data?.find((note) => note.id === noteId)?.title ?? 'scratchpad';

  return (
    <>
      <ConflictDialog
        server={conflict}
        serverPreview={serverPreview}
        localPreview={text}
        busy={save.isPending}
        onKeepMine={handleKeepMine}
        onLoadTheirs={handleLoadTheirs}
      />
      <Card className="flex h-full flex-col overflow-hidden">
        <CardHeader>
          <CardTitle className="truncate">{noteTitle}</CardTitle>
          <div className="flex items-center gap-2">
            {noteEnc && (
              <Badge
                variant="accent"
                title="End-to-end encrypted — only ciphertext leaves this browser"
              >
                <Lock className="size-3" />
                Encrypted
              </Badge>
            )}
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
                  {(revisionsQuery.isPending || revisionTextsQuery.isPending) && (
                    <div className="flex flex-col gap-1.5 p-1.5">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  )}
                  {revisionsQuery.isSuccess && visibleRevisions.length === 0 && (
                    <p className="px-3 py-5 text-center text-xs text-zinc-500">
                      No saved versions yet — they appear after your first edits.
                    </p>
                  )}
                  {revisionsQuery.isSuccess &&
                    visibleRevisions.map((revision) => (
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
                  {(revisionsQuery.isError || revisionTextsQuery.isError) && (
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
                onClick={handleFormat}
                disabled={format.isPending || text.length === 0 || noteEnc}
                title={
                  noteEnc
                    ? 'Encrypted notes stay private — AI formatting skipped'
                    : 'Clean up and structure with AI'
                }
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
