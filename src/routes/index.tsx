import { useCallback, useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { StickyNote, X } from 'lucide-react';
import NoteEditor from '../components/NoteEditor';
import { CommandPalette } from '../components/CommandPalette';
import { NotesSidebar } from '../components/NotesSidebar';
import { SettingsDialog } from '../components/SettingsDialog';
import { SidePanel } from '../components/SidePanel';
import { TokenGate } from '../components/TokenGate';
import { TopBar } from '../components/TopBar';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { listNotes } from '../lib/api';
import { clearToken, getToken } from '../lib/token';
import { useGlobalShortcuts } from '../lib/shortcuts';

export const Route = createFileRoute('/')({
  component: IndexComponent,
});

const SELECTED_KEY = 'selected-note-id';

function IndexComponent() {
  const [token, setToken] = useState<string | null>(() => getToken());
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const stored = localStorage.getItem(SELECTED_KEY);
    const parsed = stored ? parseInt(stored, 10) : NaN;
    return Number.isNaN(parsed) ? null : parsed;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useGlobalShortcuts();

  const handleUnauthorized = useCallback(() => {
    clearToken();
    setToken(null);
  }, []);

  const handleTokenSaved = useCallback((value: string) => {
    setToken(value);
  }, []);

  const handleSelect = useCallback((id: number) => {
    setSelectedId(id);
    try {
      localStorage.setItem(SELECTED_KEY, String(id));
    } catch {
      /* ignore */
    }
    setSidebarOpen(false);
  }, []);

  if (!token) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <AmbientBackground />
        <TokenGate onSaved={handleTokenSaved} />
      </div>
    );
  }

  return (
    <div key={token} className="min-h-screen bg-zinc-950 text-zinc-100">
      <AmbientBackground />
      <TopBar onMenu={() => setSidebarOpen(true)} onSettings={() => setSettingsOpen(true)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AuthedWorkspace
        selectedId={selectedId}
        onSelect={handleSelect}
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
        onUnauthorized={handleUnauthorized}
      />
    </div>
  );
}

function AuthedWorkspace({
  selectedId,
  onSelect,
  sidebarOpen,
  onCloseSidebar,
  onOpenSettings,
  onUnauthorized,
}: {
  selectedId: number | null;
  onSelect: (id: number) => void;
  sidebarOpen: boolean;
  onCloseSidebar: () => void;
  onOpenSettings: () => void;
  onUnauthorized: () => void;
}) {
  const notesQuery = useQuery({ queryKey: ['notes'], queryFn: listNotes, retry: false });

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

  return (
    <>
      <CommandPalette onSelectNote={onSelect} onOpenSettings={onOpenSettings} />
      <main className="mx-auto grid max-w-7xl grid-cols-1 items-start gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[260px_minmax(0,1.18fr)_minmax(0,1fr)]">
        {/* Sidebar — static column on desktop. */}
        <motion.aside
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="hidden min-h-0 lg:block"
        >
          <Card className="flex max-h-[calc(100vh-6.5rem)] min-h-[480px] flex-col p-2">
            <NotesSidebar
              selectedId={selectedId}
              onSelect={onSelect}
              onUnauthorized={onUnauthorized}
            />
          </Card>
        </motion.aside>

        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
          className="min-h-0"
        >
          {selectedId !== null ? (
            <NoteEditor key={selectedId} noteId={selectedId} onUnauthorized={onUnauthorized} />
          ) : (
            <Card className="flex min-h-[480px] flex-col items-center justify-center gap-3 p-10 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-500">
                <StickyNote className="size-4" />
              </span>
              <p className="text-sm text-zinc-400">Select a note to start writing</p>
            </Card>
          )}
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="flex min-h-0 flex-col gap-4"
        >
          <SidePanel onUnauthorized={onUnauthorized} />
        </motion.section>
      </main>

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

/** Stealth-safe ambience: a faint top glow, no gradients-for-show. */
function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,rgb(63_63_70/0.22),transparent)]" />
    </div>
  );
}
