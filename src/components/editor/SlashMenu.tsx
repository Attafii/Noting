import { useEffect, useState } from 'react';
import { SLASH_COMMANDS } from '../../lib/markdown-ops';
import { cn } from '../../lib/utils';

export function SlashMenu({
  filter,
  onPick,
  onClose,
}: {
  filter: string;
  cursor: number;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState(0);
  const [prevFilter, setPrevFilter] = useState(filter);
  const items = SLASH_COMMANDS.filter(
    (c) => !filter || c.key.startsWith(filter) || c.label.toLowerCase().includes(filter),
  );
  const safeActive = Math.min(active, Math.max(0, items.length - 1));

  // Guarded render-time reset (same sanctioned pattern as the editor's
  // first-load adoption): runs only when the filter actually changes.
  if (prevFilter !== filter) {
    setPrevFilter(filter);
    setActive(0);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setActive((a) => Math.min(a + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (items[safeActive]) {
          e.preventDefault();
          e.stopPropagation();
          onPick(SLASH_COMMANDS.indexOf(items[safeActive]));
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, safeActive]);

  if (items.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Slash commands"
      className="absolute bottom-full left-3 z-20 mb-1 w-60 overflow-hidden rounded-xl border border-zinc-700/70 bg-zinc-900 shadow-[0_16px_50px_-12px_rgb(0_0_0/0.8)]"
    >
      <p className="border-b border-zinc-800/70 px-3 py-1.5 font-mono text-[10px] tracking-[0.18em] text-zinc-500 uppercase">
        /{filter} — commands
      </p>
      <div className="max-h-56 overflow-y-auto p-1.5">
        {items.map((item, i) => (
          <button
            key={item.key}
            role="option"
            aria-selected={i === safeActive}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(SLASH_COMMANDS.indexOf(item));
            }}
            className={cn(
              'flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left',
              i === safeActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300',
            )}
          >
            <span className="text-xs font-medium">{item.label}</span>
            <span className="font-mono text-[11px] text-zinc-600">{item.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
