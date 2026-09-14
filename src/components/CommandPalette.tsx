import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import Fuse from 'fuse.js';
import {
  Download,
  FileText,
  Files,
  Hash,
  History,
  Plus,
  Save,
  ScanEye,
  Settings2,
  Sparkles,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { createNote, listDocuments, listNotes, triggerBlobDownload } from '../lib/api';
import { useFocusTrap } from '../lib/focus-trap';
import { SHORTCUT_EVENTS } from '../lib/shortcuts';
import { cn } from '../lib/utils';
import { Input } from './ui/input';

interface CommandPaletteProps {
  onSelectNote: (id: number) => void;
  onOpenSettings: () => void;
}

interface PaletteItem {
  key: string;
  section: 'Notes' | 'Tags' | 'Files' | 'Actions';
  label: string;
  sub?: string;
  icon: LucideIcon;
  run: () => void;
}

export function CommandPalette({ onSelectNote, onOpenSettings }: CommandPaletteProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    const toggle = () => {
      setOpen((value) => {
        if (!value) {
          setQuery('');
          setCursor(0);
        }
        return !value;
      });
    };
    window.addEventListener(SHORTCUT_EVENTS.openPalette, toggle);
    return () => window.removeEventListener(SHORTCUT_EVENTS.openPalette, toggle);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const notesQuery = useQuery({ queryKey: ['notes'], queryFn: listNotes, enabled: open });
  const docsQuery = useQuery({ queryKey: ['documents'], queryFn: listDocuments, enabled: open });

  const create = useMutation({
    mutationFn: () => createNote('Untitled'),
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      close();
      onSelectNote(note.id);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Could not create note');
    },
  });

  function close() {
    setOpen(false);
  }

  function goTab(tab: 'files' | 'ask') {
    window.dispatchEvent(
      new CustomEvent<'files' | 'ask'>(SHORTCUT_EVENTS.sideTab, { detail: tab }),
    );
  }

  function fire(event: string) {
    window.dispatchEvent(new CustomEvent(event));
  }

  async function runExport() {
    close();
    const toastId = toast.loading('Building backup…');
    try {
      const { exportBackup } = await import('../lib/backup');
      const blob = await exportBackup();
      const date = new Date().toISOString().slice(0, 10);
      triggerBlobDownload(blob, `noting-backup-${date}.zip`);
      toast.success('Backup downloaded', { id: toastId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed', { id: toastId });
    }
  }

  // Fuzzy indexes (rebuilt when the underlying lists change). Encrypted notes
  // expose titles/previews/tags only — ciphertext never enters the index.
  const notesFuse = useMemo(
    () =>
      new Fuse(notesQuery.data ?? [], {
        keys: [
          { name: 'title', weight: 2 },
          { name: 'tags', weight: 1.5 },
          { name: 'preview', weight: 1 },
        ],
        threshold: 0.4,
        ignoreLocation: true,
        includeScore: false,
      }),
    [notesQuery.data],
  );
  const docsFuse = useMemo(
    () =>
      new Fuse(docsQuery.data ?? [], {
        keys: [{ name: 'file_name', weight: 1 }],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [docsQuery.data],
  );
  const tagList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notesQuery.data ?? []) {
      if (note.archived) continue;
      for (const tag of note.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].map(([tag, count]) => ({ tag, count }));
  }, [notesQuery.data]);
  const tagsFuse = useMemo(
    () =>
      new Fuse(tagList, {
        keys: [{ name: 'tag', weight: 1 }],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [tagList],
  );

  const items: PaletteItem[] = useMemo(() => {
    const q = query.trim();
    const match = (text: string) => !q || text.toLowerCase().includes(q.toLowerCase());

    const liveNotes = (notesQuery.data ?? []).filter((note) => !note.archived);
    const noteHits = q
      ? notesFuse
          .search(q)
          .map((r) => r.item)
          .filter((note) => !note.archived)
          .slice(0, 8)
      : liveNotes.slice(0, 6);
    const notes: PaletteItem[] = noteHits.map((note) => {
      const tags = (note.tags ?? []).slice(0, 3);
      return {
        key: `note-${note.id}`,
        section: 'Notes',
        label: note.title,
        sub: [
          note.preview?.replace(/\s+/g, ' ').slice(0, 60),
          tags.length > 0 ? tags.map((t) => `#${t}`).join(' ') : undefined,
          note.enc ? 'Encrypted' : undefined,
        ]
          .filter(Boolean)
          .join(' · '),
        icon: StickyNote,
        run: () => {
          close();
          onSelectNote(note.id);
        },
      };
    });

    const tagHits = q
      ? tagsFuse
          .search(q)
          .map((r) => r.item)
          .slice(0, 4)
      : [];
    const tags: PaletteItem[] = tagHits.map(({ tag, count }) => ({
      key: `tag-${tag}`,
      section: 'Tags',
      label: `#${tag}`,
      sub: `${count} note${count === 1 ? '' : 's'}`,
      icon: Hash,
      run: () => {
        close();
        window.dispatchEvent(new CustomEvent<string>(SHORTCUT_EVENTS.filterTag, { detail: tag }));
      },
    }));

    const docHits = q
      ? docsFuse
          .search(q)
          .map((r) => r.item)
          .slice(0, 6)
      : (docsQuery.data ?? []).slice(0, 3);
    const files: PaletteItem[] = docHits.map((doc) => ({
      key: `doc-${doc.id}`,
      section: 'Files',
      label: doc.file_name,
      sub: doc.enc ? 'Encrypted' : undefined,
      icon: FileText,
      run: () => {
        close();
        window.dispatchEvent(
          new CustomEvent<number>(SHORTCUT_EVENTS.previewDocument, { detail: doc.id }),
        );
      },
    }));

    const actions: PaletteItem[] = (
      [
        {
          key: 'new-note',
          label: 'New note',
          icon: Plus,
          run: () => create.mutate(),
          match: match('new note create'),
        },
        {
          key: 'save',
          label: 'Save note now',
          icon: Save,
          run: () => fire(SHORTCUT_EVENTS.saveNow),
          match: match('save note now'),
        },
        {
          key: 'preview',
          label: 'Toggle Write / Preview',
          icon: ScanEye,
          run: () => fire(SHORTCUT_EVENTS.togglePreview),
          match: match('toggle preview write markdown'),
        },
        {
          key: 'history',
          label: 'Toggle version history',
          icon: History,
          run: () => fire(SHORTCUT_EVENTS.toggleHistory),
          match: match('toggle version history'),
        },
        {
          key: 'files-tab',
          label: 'Go to Files',
          icon: Files,
          run: () => goTab('files'),
          match: match('go to files uploads documents'),
        },
        {
          key: 'ask-tab',
          label: 'Ask your documents',
          icon: Sparkles,
          run: () => goTab('ask'),
          match: match('ask documents questions search ai'),
        },
        {
          key: 'export',
          label: 'Export backup (.zip)',
          icon: Download,
          run: () => void runExport(),
          match: match('export backup download zip'),
        },
        {
          key: 'settings',
          label: 'Open settings',
          icon: Settings2,
          run: () => {
            close();
            onOpenSettings();
          },
          match: match('open settings encryption shortcuts'),
        },
      ] as const
    )
      .filter((action) => action.match)
      .map((action) => ({ ...action, section: 'Actions' as const }));

    return [...notes, ...tags, ...files, ...actions];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, notesQuery.data, docsQuery.data, notesFuse, docsFuse, tagsFuse]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        items[cursor]?.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, cursor]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  let lastSection = '';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/70 p-4 pt-[14vh] backdrop-blur-sm"
        >
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg overflow-hidden rounded-xl border border-zinc-700/70 bg-zinc-900 shadow-[0_24px_70px_-12px_rgb(0_0_0/0.9)]"
          >
            <div className="border-b border-zinc-800/70 p-2">
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                placeholder="Type a command or search…"
                aria-label="Command palette"
                className="border-0 bg-transparent text-sm focus:border-0"
              />
            </div>
            <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
              {items.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-zinc-500">
                  {notesQuery.isPending || docsQuery.isPending ? 'Loading…' : 'No matches'}
                </p>
              )}
              {items.map((item, index) => {
                const header = item.section !== lastSection ? item.section : null;
                lastSection = item.section;
                const Icon = item.icon;
                return (
                  <div key={item.key}>
                    {header && (
                      <p className="px-2.5 pt-2 pb-0.5 font-mono text-[10px] tracking-[0.18em] text-zinc-600 uppercase">
                        {header}
                      </p>
                    )}
                    <button
                      data-index={index}
                      onClick={() => item.run()}
                      onMouseMove={() => setCursor(index)}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-100',
                        index === cursor ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300',
                      )}
                    >
                      <Icon className="size-4 shrink-0 text-zinc-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{item.label}</span>
                        {item.sub && (
                          <span className="block truncate font-mono text-[11px] text-zinc-600">
                            {item.sub}
                          </span>
                        )}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-3 border-t border-zinc-800/70 px-3.5 py-2 text-[11px] text-zinc-600">
              <span>
                <Kbd>↑↓</Kbd> navigate
              </span>
              <span>
                <Kbd>↵</Kbd> run
              </span>
              <span>
                <Kbd>esc</Kbd> close
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-700/70 bg-zinc-950 px-1 font-mono text-[10px] text-zinc-400">
      {children}
    </kbd>
  );
}
