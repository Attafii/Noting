import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Files, Sparkles } from 'lucide-react';
import { AskPanel } from './AskPanel';
import DocumentList from './DocumentList';
import FileDropzone from './FileDropzone';
import { SHORTCUT_EVENTS } from '../lib/shortcuts';
import { cn } from '../lib/utils';

interface SidePanelProps {
  onUnauthorized: () => void;
}

export function SidePanel({ onUnauthorized }: SidePanelProps) {
  const [tab, setTab] = useState<'files' | 'ask'>('files');

  // External tab requests (e.g. command palette "Go to Ask").
  useEffect(() => {
    const go = (event: Event) => {
      const next = (event as CustomEvent<'files' | 'ask'>).detail;
      if (next === 'files' || next === 'ask') setTab(next);
    };
    window.addEventListener(SHORTCUT_EVENTS.sideTab, go);
    return () => window.removeEventListener(SHORTCUT_EVENTS.sideTab, go);
  }, []);

  function handleOpenDocument(documentId: number) {
    setTab('files');
    // Let the tab switch commit before asking the list to open the preview.
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent<number>(SHORTCUT_EVENTS.previewDocument, { detail: documentId }),
      );
    }, 60);
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div
        role="tablist"
        aria-label="Side panel"
        className="flex self-start rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5"
      >
        <SideTab
          active={tab === 'files'}
          onClick={() => setTab('files')}
          icon={<Files className="size-3.5" />}
          label="Files"
        />
        <SideTab
          active={tab === 'ask'}
          onClick={() => setTab('ask')}
          icon={<Sparkles className="size-3.5" />}
          label="Ask"
        />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {tab === 'files' ? (
          <motion.div
            key="files"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.16 }}
            className="flex min-h-0 flex-col gap-4"
          >
            <FileDropzone onUnauthorized={onUnauthorized} />
            <DocumentList onUnauthorized={onUnauthorized} />
          </motion.div>
        ) : (
          <motion.div
            key="ask"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.16 }}
            className="flex min-h-0 flex-col"
          >
            <AskPanel onUnauthorized={onUnauthorized} onOpenDocument={handleOpenDocument} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SideTab({
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
        'flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200',
        active ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
