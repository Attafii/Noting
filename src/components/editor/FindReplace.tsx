import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

export function FindReplace({
  open,
  matchCount,
  matchIndex,
  onQuery,
  onNext,
  onPrev,
  onReplace,
  onReplaceAll,
  onClose,
}: {
  open: boolean;
  matchCount: number;
  matchIndex: number;
  onQuery: (q: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onReplace: (replacement: string) => void;
  onReplaceAll: (replacement: string) => void;
  onClose: () => void;
}) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.select(), 30);
    }
  }, [open]);

  function updateFind(value: string) {
    setFind(value);
    onQuery(value);
  }

  function handleClose() {
    setFind('');
    setReplace('');
    onQuery('');
    onClose();
  }

  if (!open) return null;

  return (
    <div
      role="search"
      aria-label="Find and replace in note"
      className="absolute top-2 right-3 z-20 w-72 rounded-xl border border-zinc-700/70 bg-zinc-900 p-2 shadow-[0_16px_50px_-12px_rgb(0_0_0/0.8)]"
    >
      <div className="flex items-center gap-1.5">
        <Input
          ref={inputRef}
          value={find}
          onChange={(e) => updateFind(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) onNext();
            if (e.key === 'Enter' && e.shiftKey) onPrev();
            if (e.key === 'Escape') handleClose();
          }}
          placeholder="Find in note…"
          aria-label="Find in note"
          className="h-7 text-xs"
        />
        <span className="shrink-0 font-mono text-[11px] text-zinc-500">
          {find ? `${matchCount === 0 ? 0 : matchIndex + 1}/${matchCount}` : '—'}
        </span>
        <button
          onClick={onPrev}
          title="Previous match (Shift+Enter)"
          aria-label="Previous match"
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <ChevronUp className="size-3.5" />
        </button>
        <button
          onClick={onNext}
          title="Next match (Enter)"
          aria-label="Next match"
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <ChevronDown className="size-3.5" />
        </button>
        <button
          onClick={handleClose}
          title="Close find (Esc)"
          aria-label="Close find"
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Input
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onReplace(replace);
            if (e.key === 'Escape') handleClose();
          }}
          placeholder="Replace with…"
          aria-label="Replace with"
          className="h-7 text-xs"
        />
        <Button size="sm" variant="ghost" onClick={() => onReplace(replace)} disabled={!find}>
          Replace
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onReplaceAll(replace)} disabled={!find}>
          All
        </Button>
      </div>
    </div>
  );
}
