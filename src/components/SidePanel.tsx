import { useCallback, useEffect, useState } from 'react';
import { Files, Sparkles } from 'lucide-react';
import { AskPanel } from './AskPanel';
import DocumentList from './DocumentList';
import FileDropzone from './FileDropzone';
import { SHORTCUT_EVENTS } from '../lib/shortcuts';
import { cn } from '../lib/utils';

interface SidePanelProps {
  onUnauthorized: () => void;
  onTabChange?: (tab: 'files' | 'ask') => void;
}

export function SidePanel({ onUnauthorized, onTabChange }: SidePanelProps) {
  const [tab, setTab] = useState<'files' | 'ask'>('files');

  const selectTab = useCallback(
    (next: 'files' | 'ask') => {
      setTab(next);
      onTabChange?.(next);
    },
    [onTabChange],
  );

  // External tab requests (e.g. command palette "Go to Ask").
  useEffect(() => {
    const go = (event: Event) => {
      const next = (event as CustomEvent<'files' | 'ask'>).detail;
      if (next === 'files' || next === 'ask') selectTab(next);
    };
    window.addEventListener(SHORTCUT_EVENTS.sideTab, go);
    return () => window.removeEventListener(SHORTCUT_EVENTS.sideTab, go);
  }, [selectTab]);

  function handleOpenDocument(documentId: number) {
    selectTab('files');
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
          onClick={() => selectTab('files')}
          icon={<Files className="size-3.5" />}
          label="Files"
        />
        <SideTab
          active={tab === 'ask'}
          onClick={() => selectTab('ask')}
          icon={<Sparkles className="size-3.5" />}
          label="Ask"
        />
      </div>

      <div className={cn('flex min-h-0 flex-col gap-4', tab !== 'files' && 'hidden')}>
        <FileDropzone onUnauthorized={onUnauthorized} />
        <DocumentList onUnauthorized={onUnauthorized} />
      </div>
      <div className={cn('flex min-h-0 flex-col', tab !== 'ask' && 'hidden')}>
        <AskPanel onUnauthorized={onUnauthorized} onOpenDocument={handleOpenDocument} />
      </div>
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
