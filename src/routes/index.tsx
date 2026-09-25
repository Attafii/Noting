import { useCallback, useEffect, useRef, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Command, Files, PanelLeft, Plus, Sparkles, StickyNote, X } from 'lucide-react';
import { toast } from 'sonner';
import NoteEditor from '../components/NoteEditor';
import { CommandPalette } from '../components/CommandPalette';
import { NotesSidebar } from '../components/NotesSidebar';
import { OnboardingTour } from '../components/OnboardingTour';
import { SidePanel } from '../components/SidePanel';
import { TokenGate } from '../components/TokenGate';
import { TopBar } from '../components/TopBar';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { createNote, endSession, listNotes } from '../lib/api';
import { clearPendingMemory } from '../lib/outbox';
import { clearToken, getAnswer, getToken } from '../lib/token';
import { SHORTCUT_EVENTS, useGlobalShortcuts } from '../lib/shortcuts';
import { timeAgo } from '../lib/format';
import { cn } from '../lib/utils';

export const Route = createFileRoute('/')({
  component: IndexComponent,
});

const SELECTED_KEY = 'selected-note-id';
const NOTE_QUERY_KEY = 'note';

function initialSelectedId(): number | null {
  try {
    const raw = new URLSearchParams(window.location.search).get(NOTE_QUERY_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
    const stored = localStorage.getItem(SELECTED_KEY);
    const storedId = stored ? Number.parseInt(stored, 10) : Number.NaN;
    return Number.isSafeInteger(storedId) && storedId > 0 ? storedId : null;
  } catch {
    return null;
  }
}

function IndexComponent() {
  useEffect(() => {
    document.title = 'noting-Notes';
  }, []);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The answer lives in memory only: a remembered token alone never unlocks.
  // Every reload lands back on the gate until token + answer are both present.
  const [session, setSession] = useState<string | null>(() => {
    const t = getToken();
    return t && getAnswer() ? t : null;
  });
  const [epoch, setEpoch] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(initialSelectedId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  useGlobalShortcuts();

  const goSettings = useCallback(() => {
    void navigate({ to: '/settings' });
  }, [navigate]);

  const handleMenu = useCallback(() => {
    // Desktop: collapse/expand the sidebar column. Mobile: open the drawer.
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setSideCollapsed((value) => !value);
    } else {
      setSidebarOpen(true);
    }
  }, []);

  const handleUnauthorized = useCallback(() => {
    void endSession();
    clearPendingMemory();
    clearToken();
    try {
      localStorage.removeItem(SELECTED_KEY);
    } catch {
      /* ignore */
    }
    setSelectedId(null);
    queryClient.clear();
    setSession(null);
  }, [queryClient]);

  const handleTokenSaved = useCallback(
    (value: string) => {
      clearPendingMemory();
      setSelectedId(null);
      queryClient.clear();
      setSession(value);
      setEpoch((e) => e + 1);
    },
    [queryClient],
  );

  const handleSelect = useCallback((id: number) => {
    setSelectedId(id);
    try {
      localStorage.setItem(SELECTED_KEY, String(id));
      const params = new URLSearchParams(window.location.search);
      params.set(NOTE_QUERY_KEY, String(id));
      params.delete('token');
      window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    } catch {
      /* ignore */
    }
    setSidebarOpen(false);
  }, []);

  if (!session) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <AmbientBackground />
        <TokenGate onSaved={handleTokenSaved} />
      </div>
    );
  }

  return (
    <div key={`${session}:${epoch}`} className="min-h-screen bg-zinc-950 text-zinc-100">
      <AmbientBackground />
      <TopBar onMenu={handleMenu} onSettings={goSettings} onLock={handleUnauthorized} />
      <AuthedWorkspace
        selectedId={selectedId}
        onSelect={handleSelect}
        sidebarOpen={sidebarOpen}
        sideCollapsed={sideCollapsed}
        onCloseSidebar={() => setSidebarOpen(false)}
        onOpenSidebar={() => setSidebarOpen(true)}
        onOpenSettings={goSettings}
        onUnauthorized={handleUnauthorized}
      />
    </div>
  );
}

function AuthedWorkspace({
  selectedId,
  onSelect,
  sidebarOpen,
  sideCollapsed,
  onCloseSidebar,
  onOpenSidebar,
  onOpenSettings,
  onUnauthorized,
}: {
  selectedId: number | null;
  onSelect: (id: number) => void;
  sidebarOpen: boolean;
  sideCollapsed: boolean;
  onCloseSidebar: () => void;
  onOpenSidebar: () => void;
  onOpenSettings: () => void;
  onUnauthorized: () => void;
}) {
  const queryClient = useQueryClient();
  const notesQuery = useQuery({ queryKey: ['notes'], queryFn: listNotes, retry: false });
  const [sideTab, setSideTab] = useState<'files' | 'ask'>('files');
  const [sideW, setSideW] = useState(() => {
    try {
      const stored = parseInt(localStorage.getItem('layout-side-w') ?? '', 10);
      return Number.isFinite(stored) ? Math.min(420, Math.max(200, stored)) : 264;
    } catch {
      return 264;
    }
  });
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  // Adopt the first usable note when nothing (valid) is selected.
  useEffect(() => {
    const notes = notesQuery.data;
    if (!notes || notes.length === 0) return;
    const valid = selectedId !== null && notes.some((note) => note.id === selectedId);
    if (!valid) {
      const fallback = notes.find((note) => !note.archived) ?? notes[0];
      onSelect(fallback.id);
    }
  }, [notesQuery.data, selectedId, onSelect]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const next = Math.min(420, Math.max(200, drag.startW + e.clientX - drag.startX));
      setSideW(next);
    }
    function onUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = '';
      try {
        localStorage.setItem('layout-side-w', String(sideW));
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [sideW]);

  function goSideTab(tab: 'files' | 'ask') {
    setSideTab(tab);
    window.dispatchEvent(
      new CustomEvent<'files' | 'ask'>(SHORTCUT_EVENTS.sideTab, { detail: tab }),
    );
    requestAnimationFrame(() => {
      document.getElementById('side-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  return (
    <>
      <CommandPalette onSelectNote={onSelect} onOpenSettings={onOpenSettings} />
      <OnboardingTour />
      <main
        className={cn(
          'mx-auto grid max-w-7xl grid-cols-1 items-start gap-5 px-4 pt-6 pb-24 sm:px-6 lg:gap-6 lg:pb-8',
          sideCollapsed
            ? 'lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]'
            : 'lg:grid-cols-[var(--side-w)_minmax(0,1.15fr)_minmax(0,1fr)]',
        )}
        style={{ '--side-w': `${sideW}px` } as React.CSSProperties}
      >
        {/* Sidebar — resizable, collapsible column on desktop. */}
        {!sideCollapsed && (
          <motion.aside
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="relative hidden min-h-0 lg:block"
          >
            <Card className="flex max-h-[calc(100vh-6.5rem)] min-h-[480px] flex-col p-2">
              <NotesSidebar
                selectedId={selectedId}
                onSelect={onSelect}
                onUnauthorized={onUnauthorized}
              />
            </Card>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              title="Drag to resize"
              onMouseDown={(e) => {
                dragRef.current = { startX: e.clientX, startW: sideW };
                document.body.style.cursor = 'col-resize';
              }}
              className="absolute top-8 -right-1.5 bottom-8 w-3 cursor-col-resize rounded-full transition-colors hover:bg-accent-500/30"
            />
          </motion.aside>
        )}

        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
          className="min-h-0"
        >
          {selectedId !== null ? (
            <NoteEditor
              key={selectedId}
              noteId={selectedId}
              onUnauthorized={onUnauthorized}
              onSelectNote={onSelect}
            />
          ) : (
            <HomeDashboard
              onSelect={onSelect}
              onUnauthorized={onUnauthorized}
              notesQuery={notesQuery}
              queryClient={queryClient}
            />
          )}
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="flex min-h-0 scroll-mt-20 flex-col gap-4"
          id="side-panel"
        >
          <SidePanel onUnauthorized={onUnauthorized} onTabChange={setSideTab} />
        </motion.section>
      </main>

      {/* Mobile bottom bar. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-800/70 bg-zinc-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <div className="grid grid-cols-4">
          <BottomTab
            icon={<PanelLeft className="size-4" />}
            label="Notes"
            onClick={onOpenSidebar}
          />
          <BottomTab
            icon={<Command className="size-4" />}
            label="Search"
            onClick={() => window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.openPalette))}
          />
          <BottomTab
            icon={<Files className="size-4" />}
            label="Files"
            active={sideTab === 'files'}
            onClick={() => goSideTab('files')}
          />
          <BottomTab
            icon={<Sparkles className="size-4" />}
            label="Ask"
            active={sideTab === 'ask'}
            onClick={() => goSideTab('ask')}
          />
        </div>
      </nav>

      {/* Sidebar drawer on mobile. */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={onCloseSidebar}
              className="fixed inset-0 z-40 bg-zinc-950/70 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              className="fixed inset-y-0 left-0 z-50 flex w-80 max-w-[85vw] flex-col bg-zinc-950 lg:hidden"
              aria-label="Notes"
            >
              <div className="flex items-center justify-end border-b border-zinc-800/70 p-2">
                <Button size="icon-sm" variant="ghost" onClick={onCloseSidebar} title="Close">
                  <X />
                </Button>
              </div>
              <div className="min-h-0 flex-1 p-2">
                <NotesSidebar
                  selectedId={selectedId}
                  onSelect={onSelect}
                  onUnauthorized={onUnauthorized}
                />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function BottomTab({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex cursor-pointer flex-col items-center gap-1 py-2.5 text-[11px] transition-colors active:scale-95',
        active ? 'text-accent-300' : 'text-zinc-400 hover:text-zinc-100',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Home dashboard: continue where you left off, workspace stats, quick capture. */
function HomeDashboard({
  onSelect,
  onUnauthorized,
  notesQuery,
  queryClient,
}: {
  onSelect: (id: number) => void;
  onUnauthorized: () => void;
  notesQuery: ReturnType<
    typeof useQuery<typeof listNotes extends () => Promise<infer T> ? T : never>
  >;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [creating, setCreating] = useState(false);
  const notes = (notesQuery.data ?? []).filter((n) => !n.archived);
  const recent = [...notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);
  const favorites = notes.filter((n) => n.favorite);

  async function handleNew() {
    setCreating(true);
    try {
      const note = await createNote('Untitled');
      await queryClient.invalidateQueries({ queryKey: ['notes'] });
      onSelect(note.id);
    } catch (err) {
      if (err instanceof Error && err.message.includes('Invalid or missing token'))
        onUnauthorized();
      else toast.error(err instanceof Error ? err.message : 'Could not create note');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card className="flex min-h-[480px] flex-col gap-5 p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400">
          <StickyNote className="size-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Home</h2>
          <p className="font-mono text-[11px] text-zinc-500">
            {notes.length} note{notes.length === 1 ? '' : 's'}
            {favorites.length > 0 &&
              ` · ${favorites.length} favorite${favorites.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <Button
          size="sm"
          variant="accent"
          className="ml-auto"
          disabled={creating}
          onClick={() => void handleNew()}
        >
          <Plus /> New note
        </Button>
      </div>

      {recent.length > 0 ? (
        <div>
          <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
            Continue where you left off
          </p>
          <div className="mt-2 flex flex-col gap-1">
            {recent.map((note) => (
              <button
                key={note.id}
                onClick={() => onSelect(note.id)}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-zinc-800/80 hover:bg-zinc-900/50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-zinc-200">
                    {note.title}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-zinc-600">
                    {(note.preview ?? '').replace(/\s+/g, ' ').slice(0, 70) || 'Empty note'}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-zinc-600">
                  {timeAgo(note.updated_at)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-sm text-zinc-300">A blank page, no noise.</p>
          <p className="max-w-xs text-xs text-zinc-500">
            Create your first note above, press Ctrl+K to jump anywhere, and paste images straight
            into the editor — they land in Files automatically.
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 border-t border-zinc-800/70 pt-4 text-center">
        {[
          { k: 'Ctrl K', v: 'Jump anywhere' },
          { k: '/ + Enter', v: 'Slash commands' },
          { k: 'Ctrl S', v: 'Save right now' },
        ].map((s) => (
          <div key={s.k} className="rounded-lg bg-zinc-900/50 px-2 py-2.5">
            <p className="font-mono text-[11px] text-zinc-200">{s.k}</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">{s.v}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Stealth-safe ambience: a faint top glow, no gradients-for-show. */
function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,rgb(63_63_70/0.22),transparent)]" />
    </div>
  );
}
