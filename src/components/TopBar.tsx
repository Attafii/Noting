import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  CloudOff,
  Command,
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
import { listDocuments } from '../lib/api';
import { SHORTCUT_EVENTS } from '../lib/shortcuts';
import { timeAgo } from '../lib/format';
import { applyTheme, getTheme, useTheme } from '../lib/theme';
import { useSaveStatus, type SaveState } from '../lib/save-status';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';

const SAVE_LABEL: Record<SaveState, string> = {
  idle: 'Ready',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
};

export function TopBar({
  onMenu,
  onSettings,
  onLock,
}: {
  onMenu?: () => void;
  onSettings?: () => void;
  onLock?: () => void;
}) {
  const save = useSaveStatus();
  const theme = useTheme();
  const docs = useQuery({ queryKey: ['documents'], queryFn: listDocuments, retry: false });
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

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

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800/70 bg-zinc-950/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          {onMenu && (
            <button
              onClick={onMenu}
              aria-label="Open notes"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-zinc-700/70 bg-zinc-900 text-zinc-300 transition-colors hover:bg-zinc-800 lg:hidden"
            >
              <PanelLeft className="size-4" />
            </button>
          )}
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-700/70 bg-zinc-900 text-zinc-300">
            <SquareTerminal className="size-4" />
          </span>
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="font-mono text-xs tracking-[0.22em] text-zinc-300 uppercase">
              notes
            </span>
            <span className="hidden truncate font-mono text-[11px] text-zinc-600 sm:inline">
              cross-device bridge
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!online && (
            <Badge variant="warning" title="No network connection — note edits queue locally">
              <CloudOff className="size-3" />
              Offline
            </Badge>
          )}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.openPalette))}
            title="Command palette (Ctrl+K)"
            aria-label="Open command palette"
            className="flex h-6 cursor-pointer items-center gap-1 rounded-full border border-zinc-700/70 bg-zinc-900 px-2 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
          >
            <Command className="size-3" />
            <kbd className="font-mono text-[10px]">K</kbd>
          </button>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={save.state}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              <Badge
                variant={
                  save.state === 'error' ? 'error' : save.state === 'saved' ? 'success' : 'neutral'
                }
                title={save.updatedAt ? `Last saved ${timeAgo(save.updatedAt)}` : undefined}
              >
                <SaveIcon state={save.state} />
                {SAVE_LABEL[save.state]}
                {save.state === 'saved' && save.updatedAt && (
                  <span className="opacity-70">{timeAgo(save.updatedAt)}</span>
                )}
              </Badge>
            </motion.span>
          </AnimatePresence>

          {typeof docs.data?.length === 'number' && (
            <Badge
              variant="neutral"
              title={`${docs.data.length} documents stored`}
              className="hidden sm:inline-flex"
            >
              {docs.data.length} {docs.data.length === 1 ? 'file' : 'files'}
            </Badge>
          )}

          {(onSettings || onLock) && (
            <span className="flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/80 p-1">
              {onSettings && (
                <button
                  onClick={() => {
                    const next = getTheme();
                    applyTheme({ ...next, mode: next.mode === 'dark' ? 'light' : 'dark' });
                  }}
                  aria-label={
                    theme.mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
                  }
                  title={theme.mode === 'dark' ? 'Light mode' : 'Dark mode'}
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                >
                  {theme.mode === 'dark' ? (
                    <Sun className="size-3.5" />
                  ) : (
                    <Moon className="size-3.5" />
                  )}
                </button>
              )}

              {onSettings && (
                <button
                  onClick={onSettings}
                  aria-label="Settings"
                  title="Settings"
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                >
                  <Settings2 className="size-3.5" />
                </button>
              )}

              {onLock && (
                <button
                  onClick={() => {
                    onLock();
                    toast.success('Workspace locked — token and answer cleared');
                  }}
                  aria-label="Lock workspace"
                  title="Lock workspace (clears the token and the in-memory answer)"
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-red-950/60 hover:text-red-300"
                >
                  <Lock className="size-3.5" />
                </button>
              )}
            </span>
          )}

          <span
            title={docs.isError ? 'Connection error' : 'Connected'}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full border',
              docs.isError
                ? 'border-red-900/70 bg-red-950/50 text-red-400'
                : 'border-emerald-900/70 bg-emerald-950/50 text-emerald-400',
            )}
          >
            <span className="relative flex size-1.5">
              <span
                className={cn(
                  'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
                  docs.isError ? 'bg-red-400' : 'bg-emerald-400',
                )}
              />
              <span
                className={cn(
                  'relative inline-flex size-1.5 rounded-full',
                  docs.isError ? 'bg-red-400' : 'bg-emerald-400',
                )}
              />
            </span>
            <span className="sr-only">{docs.isError ? 'Connection error' : 'Connected'}</span>
          </span>
        </div>
      </div>
    </header>
  );
}

function SaveIcon({ state }: { state: SaveState }) {
  if (state === 'saving') return <Loader2 className="size-3 animate-spin" />;
  if (state === 'saved') return <Check className="size-3" />;
  if (state === 'error') return <TriangleAlert className="size-3" />;
  return <span className="size-1.5 rounded-full bg-zinc-500" />;
}
