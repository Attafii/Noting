import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  CloudOff,
  Command,
  Files,
  Loader2,
  Lock,
  Moon,
  PanelLeft,
  Settings2,
  SquareTerminal,
  Sun,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { endSession, listDocuments } from '../lib/api';
import { SHORTCUT_EVENTS, type SideTab } from '../lib/shortcuts';
import { applyTheme, getTheme, useTheme } from '../lib/theme';
import { useSaveStatus, type SaveState } from '../lib/save-status';
import { hasPendingMutations } from '../lib/outbox';
import { cn } from '../lib/utils';

const SAVE_TITLE: Record<SaveState, string> = {
  idle: 'Ready',
  saving: 'Saving…',
  saved: 'All changes saved',
  error: 'Save failed — retrying',
};

export function TopBar({
  onMenu,
  onSettings,
  onLock,
  onHome,
}: {
  onMenu?: () => void;
  onSettings?: () => void;
  onLock?: () => void;
  onHome?: () => void;
}) {
  const save = useSaveStatus();
  const theme = useTheme();
  const docs = useQuery({ queryKey: ['documents'], queryFn: listDocuments, retry: false });
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [pendingEdits, setPendingEdits] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const refreshPending = () => {
      void hasPendingMutations().then(setPendingEdits);
    };
    refreshPending();
    const timer = window.setInterval(refreshPending, 3000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Close the overflow menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // One connection pill: offline and queued edits beat a healthy connection
  // (which stays silent) so the bar reads calm by default.
  const connection = !online
    ? { label: 'Offline', tone: 'text-zinc-400' }
    : pendingEdits
      ? { label: 'Syncing', tone: 'text-accent-300' }
      : docs.isError
        ? { label: 'Reconnecting', tone: 'text-amber-300' }
        : null;

  const brand = (
    <>
      <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-700/70 bg-zinc-900 text-zinc-300">
        <SquareTerminal className="size-4" />
      </span>
      <span className="font-mono text-xs tracking-[0.22em] text-zinc-300 uppercase">notes</span>
    </>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800/70 bg-zinc-950/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          {onMenu && (
            <button
              onClick={onMenu}
              aria-label="Toggle notes sidebar"
              title="Toggle notes sidebar"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-zinc-700/70 bg-zinc-900 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              <PanelLeft className="size-4" />
            </button>
          )}
          {onHome ? (
            <button
              onClick={onHome}
              title="Home"
              aria-label="Go home"
              className="flex min-w-0 cursor-pointer items-center gap-2.5 transition-opacity hover:opacity-80"
            >
              {brand}
            </button>
          ) : (
            <div className="flex min-w-0 items-center gap-2.5">{brand}</div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.openPalette))}
            title="Search & commands (Ctrl+K)"
            aria-label="Open command palette"
            className="flex h-6 cursor-pointer items-center gap-1 rounded-full border border-zinc-700/70 bg-zinc-900 px-2 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
          >
            <Command className="size-3" />
            <kbd className="font-mono text-[10px]">K</kbd>
          </button>

          {/* Single save indicator — icon only, details live in the tooltip. */}
          <span
            title={SAVE_TITLE[save.state]}
            className="flex h-6 w-6 items-center justify-center"
            aria-hidden="true"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={save.state}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  save.state === 'saved' && 'text-emerald-400',
                  save.state === 'error' && 'text-red-400',
                  (save.state === 'saving' || save.state === 'idle') && 'text-zinc-500',
                )}
              >
                <SaveIcon state={save.state} />
              </motion.span>
            </AnimatePresence>
          </span>
          <span className="sr-only" aria-live="polite">
            {SAVE_TITLE[save.state]}
          </span>

          {/* One connection pill — only shown when the status is not normal. */}
          <AnimatePresence initial={false}>
            {connection && (
              <motion.span
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  'flex items-center gap-1 rounded-full border border-zinc-700/70 bg-zinc-900 px-2 py-0.5 font-mono text-[10px]',
                  connection.tone,
                )}
                title="Workspace status"
              >
                <CloudOff className="size-3" />
                {connection.label}
              </motion.span>
            )}
          </AnimatePresence>

          {(onSettings || onLock) && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="More actions"
                aria-expanded={menuOpen}
                title="More"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
              >
                <span className="flex gap-0.5" aria-hidden="true">
                  <span className="size-1 rounded-full bg-current" />
                  <span className="size-1 rounded-full bg-current" />
                  <span className="size-1 rounded-full bg-current" />
                </span>
              </button>
              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    role="menu"
                    aria-label="Workspace actions"
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute top-full right-0 z-30 mt-2 w-44 overflow-hidden rounded-xl border border-zinc-700/70 bg-zinc-900 p-1.5 shadow-[0_16px_50px_-12px_rgb(0_0_0/0.8)]"
                  >
                    <MenuItem
                      icon={<Files className="size-3.5" />}
                      label="Files & AI"
                      onClick={() => {
                        setMenuOpen(false);
                        window.dispatchEvent(
                          new CustomEvent<SideTab>(SHORTCUT_EVENTS.sideTab, {
                            detail: 'files',
                          }),
                        );
                      }}
                    />
                    <MenuItem
                      icon={theme.mode === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                      label={theme.mode === 'dark' ? 'Light mode' : 'Dark mode'}
                      onClick={() => {
                        const next = getTheme();
                        applyTheme({ ...next, mode: next.mode === 'dark' ? 'light' : 'dark' });
                        setMenuOpen(false);
                      }}
                    />
                    {onSettings && (
                      <MenuItem
                        icon={<Settings2 className="size-3.5" />}
                        label="Settings"
                        onClick={() => {
                          setMenuOpen(false);
                          onSettings();
                        }}
                      />
                    )}
                    {onLock && (
                      <MenuItem
                        icon={<Lock className="size-3.5" />}
                        label="Lock workspace"
                        danger
                        onClick={() => {
                          setMenuOpen(false);
                          void endSession();
                          onLock();
                          toast.success('Workspace locked — token and answer cleared');
                        }}
                      />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-zinc-800',
        danger ? 'text-red-300 hover:text-red-200' : 'text-zinc-300 hover:text-zinc-100',
      )}
    >
      <span className={danger ? 'text-red-400/80' : 'text-zinc-500'}>{icon}</span>
      {label}
    </button>
  );
}

function SaveIcon({ state }: { state: SaveState }) {
  if (state === 'saving') return <Loader2 className="size-3.5 animate-spin" />;
  if (state === 'saved') return <Check className="size-3.5" />;
  if (state === 'error') return <TriangleAlert className="size-3.5" />;
  return <span className="size-1.5 rounded-full bg-zinc-500" />;
}
