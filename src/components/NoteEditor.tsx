import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Columns2,
  Copy,
  CopyPlus,
  Download,
  History,
  ListOrdered,
  Loader2,
  Lock,
  PencilLine,
  Printer,
  ScanEye,
  Search,
  Sparkles,
  Target,
  TriangleAlert,
  Expand as FocusIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ApiError,
  createNote,
  formatNoteText,
  getNote,
  listNotes,
  listRevisions,
  saveNote,
  updateNote,
  uploadFile,
  type NotePayload,
  type NoteRevision,
  type NoteSummary,
} from '../lib/api';
import { countWords, timeAgo } from '../lib/format';
import {
  SLASH_COMMANDS,
  applyHeading,
  applyLinePrefix,
  applyWrap,
  extractHeadings,
  extractTags,
  findAllMatches,
  insertCodeBlock,
  insertLink,
  insertSnippet,
  insertTable,
  readingMinutes,
  toggleChecklist,
  type EditResult,
} from '../lib/markdown-ops';
import { exportNoteHtml, exportNoteMarkdown, printNote } from '../lib/single-note-export';
import { getAutosaveMs, getDefaultViewMode, getSpellcheck } from '../lib/prefs';
import { setSaveState } from '../lib/save-status';
import { SHORTCUT_EVENTS } from '../lib/shortcuts';
import { decryptText, encryptText } from '../lib/crypto';
import { getCryptoKey, useE2E } from '../lib/e2e';
import { cn } from '../lib/utils';
import { ConflictDialog } from './ConflictDialog';
import { EditorToolbar, type ToolbarAction } from './editor/Toolbar';
import { SlashMenu } from './editor/SlashMenu';
import { TocPanel } from './editor/TocPanel';
import { FindReplace } from './editor/FindReplace';
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
  onSelectNote?: (id: number) => void;
}

type ViewMode = 'write' | 'preview' | 'split';

export default function NoteEditor({ noteId, onUnauthorized, onSelectNote }: NoteEditorProps) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<ViewMode>(() => getDefaultViewMode());
  const [tocOpen, setTocOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [zen, setZen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goal, setGoal] = useState<number>(() => {
    try {
      return parseInt(localStorage.getItem(`note-goal-${noteId}`) ?? '0', 10) || 0;
    } catch {
      return 0;
    }
  });
  const [cursor, setCursor] = useState(0);
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
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
    onSuccess: (data, variables) => {
      baseRef.current = data.updated_at;
      setSaveState('saved', data.updated_at);
      queryClient.setQueryData(['note', noteId], data);
      clearPending();
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      void queryClient.invalidateQueries({ queryKey: ['revisions', noteId] });
      // Keep the #tag index in sync (server can't derive it for E2E rows).
      // Org-only PATCH leaves updated_at alone, so the anchor above stays valid.
      const summary = queryClient
        .getQueryData<NoteSummary[]>(['notes'])
        ?.find((note) => note.id === noteId);
      const nextTags = extractTags(variables.content);
      const prevTags = [...(summary?.tags ?? [])].sort();
      if (summary && JSON.stringify(prevTags) !== JSON.stringify([...nextTags].sort())) {
        updateNote(noteId, { tags: nextTags })
          .then((updated) => {
            queryClient.setQueryData<NoteSummary[]>(['notes'], (old) =>
              (old ?? []).map((note) =>
                note.id === noteId ? { ...note, tags: updated.tags ?? nextTags } : note,
              ),
            );
          })
          .catch(() => undefined);
      }
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
        // No real conflict when the texts already match (anchor-format skew
        // or a raced autosave): re-anchor and carry on silently instead of
        // trapping the user in the dialog. Only safe for plaintext — an
        // encrypted server blob can't be compared without the key.
        if (!(serverRow.enc ?? noteEnc) && serverRow.content === textRef.current) {
          baseRef.current = serverRow.updated_at;
          setSaveState('saved', serverRow.updated_at);
          queryClient.setQueryData(['note', noteId], serverRow);
          clearPending();
          toast.info('Already in sync with the latest version');
          return;
        }
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
    const onTogglePreview = () => setMode((value) => (value === 'preview' ? 'write' : 'preview'));
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

  // Debounced autosave (delay configurable in Settings). `save.mutate` is
  // referentially stable, so the timer only resets when the text changes.
  // Paused while a conflict dialog is open.
  useEffect(() => {
    if (!readyRef.current || conflict) return;
    const timer = setTimeout(() => {
      save.mutate({ content: text });
    }, getAutosaveMs());
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
    setMode('write');
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

  // ---- P0 editor upgrades: toolbar / slash / find / images / export ----

  const headings = useMemo(() => extractHeadings(text), [text]);
  const findMatches = useMemo(() => findAllMatches(text, findQuery), [text, findQuery]);
  const minutes = readingMinutes(text);

  const slashToken = useMemo(() => {
    const before = text.slice(0, cursor);
    const m = /(^|\n)\/([\w-]*)$/.exec(before);
    return m ? m[2].toLowerCase() : null;
  }, [text, cursor]);

  function selectionOf(): { start: number; end: number } {
    const el = textareaRef.current;
    if (!el) return { start: text.length, end: text.length };
    return { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
  }

  function applyEdit(result: EditResult) {
    setText(result.text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(result.selection.start, result.selection.end);
      setCursor(result.selection.end);
    });
  }

  function handleToolbar(action: ToolbarAction) {
    const sel = selectionOf();
    switch (action) {
      case 'h1':
        applyEdit(applyHeading(text, sel, 1));
        break;
      case 'h2':
        applyEdit(applyHeading(text, sel, 2));
        break;
      case 'h3':
        applyEdit(applyHeading(text, sel, 3));
        break;
      case 'bold':
        applyEdit(applyWrap(text, sel, '**', '**'));
        break;
      case 'italic':
        applyEdit(applyWrap(text, sel, '*', '*'));
        break;
      case 'strike':
        applyEdit(applyWrap(text, sel, '~~', '~~'));
        break;
      case 'checklist':
        applyEdit(toggleChecklist(text, sel));
        break;
      case 'bullet':
        applyEdit(applyLinePrefix(text, sel, '- '));
        break;
      case 'code':
        applyEdit(insertCodeBlock(text, sel));
        break;
      case 'table':
        applyEdit(insertTable(text, sel, 3, 3));
        break;
      case 'quote':
        applyEdit(applyLinePrefix(text, sel, '> '));
        break;
      case 'link':
        applyEdit(insertLink(text, sel));
        break;
    }
  }

  function handleSlashPick(index: number) {
    const cmd = SLASH_COMMANDS[index];
    if (!cmd) return;
    const before = text.slice(0, cursor);
    const m = /\/[\w-]*$/.exec(before);
    const slashStart = m && m.index !== undefined ? cursor - m[0].length : cursor;
    const without = text.slice(0, slashStart) + text.slice(cursor);
    const result = insertSnippet(without, { start: slashStart, end: slashStart }, cmd.snippet);
    applyEdit(result);
  }

  function handleTocJump(heading: (typeof headings)[number]) {
    setTocOpen(false);
    if (mode === 'write') {
      const lines = text.split('\n');
      const offset = lines.slice(0, heading.line).join('\n').length + (heading.line > 0 ? 1 : 0);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(offset, offset + lines[heading.line].length);
        el.scrollTop = Math.max(
          0,
          el.scrollHeight * (heading.line / Math.max(1, lines.length)) - 120,
        );
      });
    } else {
      setMode('preview');
      requestAnimationFrame(() => {
        previewRef.current
          ?.querySelector(`#h-${heading.slug}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  function gotoFindMatch(idx: number) {
    if (findMatches.length === 0) return;
    const wrapped = ((idx % findMatches.length) + findMatches.length) % findMatches.length;
    setFindIndex(wrapped);
    const pos = findMatches[wrapped];
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      if (mode === 'preview') setMode('write');
      el.focus();
      el.setSelectionRange(pos, pos + findQuery.length);
    });
  }

  function handleReplaceOne(replacement: string) {
    if (!findQuery || findMatches.length === 0) return;
    const pos = findMatches[findIndex];
    const next = text.slice(0, pos) + replacement + text.slice(pos + findQuery.length);
    setText(next);
    setFindIndex(Math.min(findIndex, Math.max(0, findMatches.length - 2)));
  }

  function handleReplaceAll(replacement: string) {
    if (!findQuery) return;
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    setText(text.replace(new RegExp(escaped, 'gi'), replacement));
    toast.success('Replaced all matches');
  }

  const persistGoal = useCallback(
    (value: number) => {
      setGoal(value);
      try {
        localStorage.setItem(`note-goal-${noteId}`, String(value));
      } catch {
        /* ignore */
      }
    },
    [noteId],
  );

  async function handleImageFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    for (const file of images) {
      const toastId = toast.loading(`Uploading ${file.name}…`);
      try {
        const meta = await uploadFile(file, undefined, encRef.current);
        const sel = selectionOf();
        const snippet = `![${file.name}](/api/download?id=${meta.id})`;
        const result = insertSnippet(textRef.current, sel, snippet);
        setText(result.text);
        void queryClient.invalidateQueries({ queryKey: ['documents'] });
        toast.success('Image attached', { id: toastId });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Image upload failed', { id: toastId });
      }
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      void handleImageFiles(files);
    }
  }

  function handleDrop(e: React.DragEvent) {
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      void handleImageFiles(files);
    }
  }

  const duplicate = useMutation({
    mutationFn: async () => {
      const created = await createNote(`${noteTitle} (copy)`);
      return saveNote({ id: created.id, content: text, baseUpdatedAt: created.updated_at });
    },
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      toast.success('Note duplicated');
      onSelectNote?.(note.id);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
        onUnauthorized();
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Duplicate failed');
    },
  });

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
              {minutes > 0 && ` · ${minutes} min read`}
              {goal > 0 && (
                <span className={cn(words >= goal ? 'text-emerald-400' : 'text-accent-300')}>
                  {' '}
                  · {Math.min(100, Math.round((words / goal) * 100))}% of {goal}
                </span>
              )}
            </span>
            <div
              role="tablist"
              aria-label="Editor mode"
              title="Toggle Write/Preview with Ctrl+P"
              className="flex rounded-lg border border-zinc-800 bg-zinc-950/70 p-0.5"
            >
              <ModeTab
                active={mode === 'write'}
                onClick={() => setMode('write')}
                icon={<PencilLine className="size-3.5" />}
                label="Write"
              />
              <ModeTab
                active={mode === 'split'}
                onClick={() => setMode('split')}
                icon={<Columns2 className="size-3.5" />}
                label="Split"
              />
              <ModeTab
                active={mode === 'preview'}
                onClick={() => setMode('preview')}
                icon={<ScanEye className="size-3.5" />}
                label="Preview"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="relative flex flex-1 flex-col p-0">
          {mode !== 'preview' && !zen && (
            <EditorToolbar onAction={handleToolbar} disabled={text.length === 0 && false} />
          )}
          <FindReplace
            open={findOpen}
            matchCount={findMatches.length}
            matchIndex={findMatches.length === 0 ? 0 : findIndex}
            onQuery={(q) => {
              setFindQuery(q);
              setFindIndex(0);
            }}
            onNext={() => gotoFindMatch(findIndex + 1)}
            onPrev={() => gotoFindMatch(findIndex - 1)}
            onReplace={handleReplaceOne}
            onReplaceAll={handleReplaceAll}
            onClose={() => setFindOpen(false)}
          />
          <AnimatePresence mode="wait" initial={false}>
            {mode === 'preview' ? (
              <motion.div
                key="preview"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
                ref={previewRef}
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
                    <MarkdownView
                      text={text}
                      noteTitles={(notesQuery.data ?? []).map((n) => ({
                        id: n.id,
                        title: n.title,
                      }))}
                      onOpenNote={onSelectNote}
                    />
                  </Suspense>
                ) : (
                  <p className="text-zinc-600">Nothing to preview yet — switch back to Write.</p>
                )}
              </motion.div>
            ) : mode === 'split' ? (
              <motion.div
                key="split"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
                className="grid flex-1 grid-cols-1 lg:grid-cols-2"
              >
                <div className="relative flex flex-col border-b border-zinc-800/70 lg:border-r lg:border-b-0">
                  {slashToken !== null && (
                    <SlashMenu
                      filter={slashToken}
                      cursor={cursor}
                      onPick={handleSlashPick}
                      onClose={() => setCursor(-1)}
                    />
                  )}
                  <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      setCursor(e.target.selectionStart ?? 0);
                    }}
                    onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
                        e.preventDefault();
                        setFindOpen(true);
                      }
                    }}
                    onPaste={handlePaste}
                    onDrop={handleDrop}
                    placeholder="// scratchpad — autosaves as you type. Type / for commands."
                    spellCheck={getSpellcheck()}
                    aria-label="Note editor"
                    className="max-h-[52vh] min-h-[320px] flex-1 resize-none bg-transparent px-5 py-4 font-mono text-sm leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:outline-none lg:max-h-none lg:min-h-[440px]"
                  />
                </div>
                <div
                  ref={previewRef}
                  className="markdown-body max-h-[52vh] min-h-[320px] overflow-y-auto px-5 py-4 lg:max-h-none"
                >
                  {text.trim() ? (
                    <Suspense
                      fallback={
                        <div className="flex flex-col gap-2">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-4 w-full" />
                        </div>
                      }
                    >
                      <MarkdownView
                        text={text}
                        noteTitles={(notesQuery.data ?? []).map((n) => ({
                          id: n.id,
                          title: n.title,
                        }))}
                        onOpenNote={onSelectNote}
                      />
                    </Suspense>
                  ) : (
                    <p className="text-zinc-600">Live preview appears here as you type.</p>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="editor"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
                className={cn(
                  'relative flex flex-1 flex-col',
                  zen && 'mx-auto w-full max-w-[65ch]',
                )}
              >
                {slashToken !== null && (
                  <SlashMenu
                    filter={slashToken}
                    cursor={cursor}
                    onPick={handleSlashPick}
                    onClose={() => setCursor(-1)}
                  />
                )}
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setCursor(e.target.selectionStart ?? 0);
                  }}
                  onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
                      e.preventDefault();
                      setFindOpen(true);
                    }
                  }}
                  onPaste={handlePaste}
                  onDrop={handleDrop}
                  placeholder="// scratchpad — autosaves as you type. Type / for commands."
                  spellCheck={getSpellcheck()}
                  aria-label="Note editor"
                  className={cn(
                    'max-h-[52vh] min-h-[320px] flex-1 resize-none bg-transparent px-5 py-4 font-mono leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:outline-none lg:max-h-none lg:min-h-[440px]',
                    zen ? 'text-base leading-loose' : 'text-sm',
                  )}
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
          <AnimatePresence>
            {tocOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.16 }}
                role="dialog"
                aria-label="Note outline"
                className="absolute right-3 bottom-14 z-20 w-72 max-w-[calc(100%-1.5rem)] overflow-hidden rounded-xl border border-zinc-700/70 bg-zinc-900 shadow-[0_16px_50px_-12px_rgb(0_0_0/0.8)]"
              >
                <div className="border-b border-zinc-800/70 px-3.5 py-2">
                  <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
                    outline
                  </p>
                </div>
                <TocPanel headings={headings} onJump={handleTocJump} />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {exportOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.16 }}
                role="menu"
                aria-label="Export note"
                className="absolute right-3 bottom-14 z-20 w-60 max-w-[calc(100%-1.5rem)] overflow-hidden rounded-xl border border-zinc-700/70 bg-zinc-900 p-1.5 shadow-[0_16px_50px_-12px_rgb(0_0_0/0.8)]"
              >
                <ExportRow
                  icon={<Download className="size-3.5" />}
                  label="Markdown (.md)"
                  onClick={() => {
                    exportNoteMarkdown(noteTitle, text);
                    setExportOpen(false);
                    toast.success('Note exported as Markdown');
                  }}
                />
                <ExportRow
                  icon={<Download className="size-3.5" />}
                  label="HTML (.html)"
                  onClick={() => {
                    exportNoteHtml(noteTitle, text);
                    setExportOpen(false);
                    toast.success('Note exported as HTML');
                  }}
                />
                <ExportRow
                  icon={<Printer className="size-3.5" />}
                  label="Print / save as PDF"
                  onClick={() => {
                    printNote(noteTitle, text);
                    setExportOpen(false);
                  }}
                />
                <ExportRow
                  icon={<CopyPlus className="size-3.5" />}
                  label="Duplicate note"
                  onClick={() => {
                    setExportOpen(false);
                    duplicate.mutate();
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {goalOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.16 }}
                role="dialog"
                aria-label="Word goal"
                className="absolute right-3 bottom-14 z-20 w-64 max-w-[calc(100%-1.5rem)] rounded-xl border border-zinc-700/70 bg-zinc-900 p-3 shadow-[0_16px_50px_-12px_rgb(0_0_0/0.8)]"
              >
                <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
                  word goal
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    value={goal || ''}
                    onChange={(e) =>
                      persistGoal(Math.max(0, parseInt(e.target.value || '0', 10) || 0))
                    }
                    placeholder="e.g. 500"
                    aria-label="Word goal"
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 focus:outline-none"
                  />
                  {goal > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => persistGoal(0)}>
                      Clear
                    </Button>
                  )}
                </div>
                {goal > 0 && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        words >= goal ? 'bg-emerald-400' : 'bg-accent-500',
                      )}
                      style={{ width: `${Math.min(100, Math.round((words / goal) * 100))}%` }}
                    />
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-zinc-800 px-4 py-2.5">
            <span className="font-mono text-[11px] text-zinc-500 sm:hidden">
              {words}w · {text.length}c
            </span>
            <span className="hidden font-mono text-[11px] text-zinc-500 sm:inline">
              autosave · {Math.round(getAutosaveMs() / 100) / 10}s
            </span>
            <div className="flex min-h-[44px] flex-wrap items-center justify-end gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFindOpen((open) => !open)}
                title="Find and replace in note (Ctrl+F)"
                aria-expanded={findOpen}
              >
                <Search />
                <span className="hidden md:inline">Find</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTocOpen((open) => !open)}
                title="Note outline"
                aria-expanded={tocOpen}
              >
                <ListOrdered />
                <span className="hidden md:inline">Outline</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZen((value) => !value)}
                title={zen ? 'Exit focus mode' : 'Focus mode (centered, distraction-free)'}
                aria-pressed={zen}
              >
                <FocusIcon />
                <span className="hidden md:inline">{zen ? 'Exit focus' : 'Focus'}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setGoalOpen((open) => !open)}
                title="Word goal"
                aria-expanded={goalOpen}
              >
                <Target />
                <span className="hidden md:inline">{goal > 0 ? `${words}/${goal}` : 'Goal'}</span>
              </Button>
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
                variant="ghost"
                size="sm"
                onClick={() => setExportOpen((open) => !open)}
                title="Export, print, or duplicate this note"
                aria-expanded={exportOpen}
              >
                <Download />
                <span className="hidden md:inline">Export</span>
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

function ExportRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
    >
      <span className="text-zinc-500">{icon}</span>
      {label}
    </button>
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
