import { useCallback, useEffect, useRef, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  CalendarClock,
  Command,
  Files,
  PanelLeft,
  Plus,
  Sparkles,
  Star,
  StickyNote,
  X,
} from 'lucide-react';
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
import { createNote, endSession, getUsage, listNotes, saveNote } from '../lib/api';
import { encryptText } from '../lib/crypto';
import { useE2E, getCryptoKey } from '../lib/e2e';
import { dueLabel, dueTone } from '../lib/due';
import { clearPendingMemory } from '../lib/outbox';
import { clearToken, getAnswer, getToken } from '../lib/token';
import { SHORTCUT_EVENTS, useGlobalShortcuts } from '../lib/shortcuts';
import { formatBytes, timeAgo } from '../lib/format';
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
  // Home (dashboard) intent: explicit via ?home=1 or the Home button. While
  // active the first-note fallback stays away, so the dashboard is reachable
  // even though a previous note id lives in storage.
  const [homeView, setHomeView] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('home') === '1';
    } catch {
      return false;
    }
  });
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
    setHomeView(false);
    try {
      localStorage.setItem(SELECTED_KEY, String(id));
      const params = new URLSearchParams(window.location.search);
      params.set(NOTE_QUERY_KEY, String(id));
      params.delete('home');
      params.delete('token');
      window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    } catch {
      /* ignore */
    }
    setSidebarOpen(false);
  }, []);

  const handleHome = useCallback(() => {
    setSelectedId(null);
    setHomeView(true);
    setSidebarOpen(false);
    try {
      const params = new URLSearchParams(window.location.search);
      params.delete(NOTE_QUERY_KEY);
      params.delete('token');
      params.set('home', '1');
      window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    } catch {
      /* ignore */
    }
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
      <TopBar
        onMenu={handleMenu}
        onSettings={goSettings}
        onLock={handleUnauthorized}
        onHome={handleHome}
      />
      <AuthedWorkspace
        selectedId={selectedId}
        homeView={homeView}
        onSelect={handleSelect}
        onHome={handleHome}
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
  homeView,
  onSelect,
  onHome,
  sidebarOpen,
  sideCollapsed,
  onCloseSidebar,
  onOpenSidebar,
  onOpenSettings,
  onUnauthorized,
}: {
  selectedId: number | null;
  homeView: boolean;
  onSelect: (id: number) => void;
  onHome: () => void;
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
  // While a refetch is in flight (e.g. right after creating a note), the cached
  // list may not contain the freshly selected id yet — falling back there would
  // bounce the user off the note they just created, so wait for the response.
  // Home view opts out entirely: the dashboard must stay put on reload.
  useEffect(() => {
    const notes = notesQuery.data;
    if (!notes || notes.length === 0 || homeView) return;
    const valid = selectedId !== null && notes.some((note) => note.id === selectedId);
    if (!valid && !notesQuery.isFetching) {
      const fallback = notes.find((note) => !note.archived) ?? notes[0];
      onSelect(fallback.id);
    }
  }, [notesQuery.data, notesQuery.isFetching, selectedId, onSelect, homeView]);

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

  // Mobile quick-create (bottom bar): same create-then-select contract as the
  // dashboard — invalidate first so the fallback effect sees the new id.
  const [creating, setCreating] = useState(false);
  async function quickCreate() {
    if (creating) return;
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
    <>
      <CommandPalette onSelectNote={onSelect} onOpenSettings={onOpenSettings} onHome={onHome} />
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
          {selectedId !== null && !homeView ? (
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
          <SidePanel
            onUnauthorized={onUnauthorized}
            onTabChange={setSideTab}
            onOpenNote={onSelect}
          />
        </motion.section>
      </main>

      {/* Mobile bottom bar. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-800/70 bg-zinc-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <div className="grid grid-cols-5">
          <BottomTab
            icon={<Plus className="size-4" />}
            label="New"
            onClick={() => void quickCreate()}
          />
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

/** Due-date badge tones shared by the dashboard rows. */
const DUE_BADGE: Record<string, string> = {
  overdue: 'border-red-900/70 bg-red-950/50 text-red-300',
  today: 'border-amber-900/70 bg-amber-950/50 text-amber-300',
  soon: 'border-accent-600/50 bg-accent-500/10 text-accent-300',
  later: 'border-zinc-700 bg-zinc-800 text-zinc-300',
};

/** Home dashboard: quick capture, due-soon reminders, stats, continue list. */
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
  const e2e = useE2E();
  const [creating, setCreating] = useState(false);
  const [capture, setCapture] = useState('');
  const notes = (notesQuery.data ?? []).filter((n) => !n.archived);
  const recent = [...notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);
  const favorites = notes.filter((n) => n.favorite);
  const now = new Date();
  const dueSoon = notes
    .filter((n) => n.due_at && dueTone(n.due_at, now) !== 'later')
    .sort((a, b) => (String(a.due_at) < String(b.due_at) ? -1 : 1))
    .slice(0, 5);
  const usageQuery = useQuery({ queryKey: ['usage'], queryFn: getUsage, retry: false });

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

  // Quick capture: first line becomes the title, the rest the body (encrypted
  // when E2E is on, mirroring the sidebar's create flow). Create → save →
  // invalidate → select, so the fallback effect never reverts the selection.
  async function handleCapture() {
    if (creating || !capture.trim()) return;
    const lines = capture.split('\n');
    const title = (lines[0] ?? '').trim().slice(0, 120) || 'Untitled';
    const body = lines.slice(1).join('\n').trim();
    setCreating(true);
    try {
      const note = await createNote(title);
      if (body) {
        let content = body;
        let enc = false;
        if (e2e) {
          const key = await getCryptoKey();
          if (!key) throw new Error('No encryption key available — re-enter your token');
          content = await encryptText(key, body);
          enc = true;
        }
        await saveNote({ id: note.id, content, baseVersion: note.content_version ?? 1, enc });
      }
      await queryClient.invalidateQueries({ queryKey: ['notes'] });
      setCapture('');
      onSelect(note.id);
    } catch (err) {
      if (err instanceof Error && err.message.includes('Invalid or missing token'))
        onUnauthorized();
      else toast.error(err instanceof Error ? err.message : 'Could not capture a note');
    } finally {
      setCreating(false);
    }
  }

  function onCaptureKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleCapture();
    }
  }

  const usage = usageQuery.data;
  const stats = [
    { k: 'Notes', v: usage ? String(usage.notes.count) : '…' },
    { k: 'Files', v: usage ? String(usage.files.count) : '…' },
    {
      k: 'Storage',
      v: usage ? formatBytes(usage.notes.bytes + usage.files.bytes) : '…',
      title: 'Notes + files against the 100 MB workspace quota',
    },
    { k: 'AI today', v: usage ? `${usage.ai.calls}/${usage.ai.limit}` : '…' },
  ];

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
            {dueSoon.length > 0 && ` · ${dueSoon.length} due`}
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

      {/* Quick capture — first line is the title, the rest the body. */}
      <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
            quick capture
          </p>
          <p className="font-mono text-[10px] text-zinc-600">Enter saves · first line = title</p>
        </div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <textarea
            rows={2}
            value={capture}
            onChange={(e) => setCapture(e.target.value)}
            onKeyDown={onCaptureKeyDown}
            placeholder="Jot it down — title, then details…"
            aria-label="Quick capture a note"
            className="min-h-[62px] w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent-600/60 focus:outline-none"
          />
          <Button
            variant="accent"
            size="sm"
            disabled={creating || !capture.trim()}
            onClick={() => void handleCapture()}
            className="sm:mb-0.5"
          >
            <Plus /> Capture
          </Button>
        </div>
      </div>

      {/* Due soon / overdue reminders. */}
      {dueSoon.length > 0 && (
        <div>
          <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
            due soon
          </p>
          <div className="mt-2 flex flex-col gap-1">
            {dueSoon.map((note) => (
              <button
                key={note.id}
                onClick={() => onSelect(note.id)}
                className="group flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-zinc-800/80 hover:bg-zinc-900/50"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px]',
                      DUE_BADGE[dueTone(note.due_at, now)],
                    )}
                  >
                    <CalendarClock className="size-3" />
                    {dueLabel(String(note.due_at), now)}
                  </span>
                  <span className="min-w-0 truncate text-[13px] font-medium text-zinc-200">
                    {note.title}
                  </span>
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-zinc-700 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-400" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Favorites chips. */}
      {favorites.length > 0 && (
        <div>
          <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
            favorites
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {favorites.slice(0, 8).map((note) => (
              <button
                key={note.id}
                onClick={() => onSelect(note.id)}
                className="flex max-w-[14rem] cursor-pointer items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
              >
                <Star className="size-3 shrink-0 fill-amber-400/80 text-amber-400/80" />
                <span className="truncate">{note.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

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
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div>
            <p className="text-sm text-zinc-300">A blank page, no noise.</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-zinc-500">
              Capture something above, press Ctrl+K to jump anywhere, and paste images straight into
              the editor — they land in Files automatically.
            </p>
          </div>
          <Button size="sm" variant="accent" disabled={creating} onClick={() => void handleNew()}>
            <Plus /> Create your first note
          </Button>
        </div>
      )}

      {/* Workspace stats. */}
      <div className="grid grid-cols-2 gap-2 border-t border-zinc-800/70 pt-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.k}
            className="rounded-lg bg-zinc-900/50 px-2 py-2.5 text-center"
            title={s.title}
          >
            <p className="font-mono text-[13px] text-zinc-200">{s.v}</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">{s.k}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
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
