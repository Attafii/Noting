import type { HeadingEntry } from '../../lib/markdown-ops';
import { cn } from '../../lib/utils';

export function TocPanel({
  headings,
  onJump,
}: {
  headings: HeadingEntry[];
  onJump: (heading: HeadingEntry) => void;
}) {
  if (headings.length === 0) {
    return (
      <p className="px-3 py-4 text-center text-xs text-zinc-600">
        No headings yet — add a # heading to build an outline.
      </p>
    );
  }
  return (
    <nav aria-label="Note outline" className="max-h-64 overflow-y-auto p-1.5">
      {headings.map((h, i) => (
        <button
          key={`${h.slug}-${i}`}
          onClick={() => onJump(h)}
          title={h.text}
          className={cn(
            'block w-full cursor-pointer truncate rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-zinc-800/70 hover:text-zinc-100',
            h.level === 1 ? 'font-medium text-zinc-200' : 'text-zinc-400',
            h.level === 2 && 'pl-4',
            h.level === 3 && 'pl-7 text-zinc-500',
          )}
        >
          {h.text}
        </button>
      ))}
    </nav>
  );
}
