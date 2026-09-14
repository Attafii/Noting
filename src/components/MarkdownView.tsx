import { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { slugify } from '../lib/markdown-ops';
import { fetchDocumentBlob } from '../lib/api';

/**
 * Markdown preview with heading anchors (for the TOC), [[wikilink]] notes
 * resolution, and #tag chips. Wikilinks/tags degrade to plain text when no
 * resolver is provided (exports, tests).
 */
export function MarkdownView({
  text,
  noteTitles,
  onOpenNote,
  onOpenTag,
}: {
  text: string;
  noteTitles?: { id: number; title: string }[];
  onOpenNote?: (id: number) => void;
  onOpenTag?: (tag: string) => void;
}) {
  const lookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of noteTitles ?? []) map.set(n.title.toLowerCase(), n.id);
    return map;
  }, [noteTitles]);

  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <HWithAnchor level={1} text={textOf(children)}>
            {children}
          </HWithAnchor>
        ),
        h2: ({ children }) => (
          <HWithAnchor level={2} text={textOf(children)}>
            {children}
          </HWithAnchor>
        ),
        h3: ({ children }) => (
          <HWithAnchor level={3} text={textOf(children)}>
            {children}
          </HWithAnchor>
        ),
        p: ({ children }) => (
          <p>
            <InlineRich
              text={children}
              lookup={lookup}
              onOpenNote={onOpenNote}
              onOpenTag={onOpenTag}
            />
          </p>
        ),
        li: ({ children }) => (
          <li>
            <InlineRich
              text={children}
              lookup={lookup}
              onOpenNote={onOpenNote}
              onOpenTag={onOpenTag}
            />
          </li>
        ),
        img: ({ src, alt }) => <NoteImage src={typeof src === 'string' ? src : ''} alt={alt} />,
      }}
    >
      {text}
    </Markdown>
  );
}

/** Images pasted into notes embed as `/api/download?id=N` — fetch with the auth header so preview works. */
function NoteImage({ src, alt }: { src: string; alt?: string }) {
  const match = /\/api\/download\?id=(\d+)/.exec(src);
  const docId = match ? parseInt(match[1], 10) : null;
  const [url, setUrl] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (docId === null) return;
    let live = true;
    let objectUrl: string | null = null;
    fetchDocumentBlob(docId)
      .then((doc) => {
        if (!live) return;
        if (doc.enc) {
          setLocked(true);
          return;
        }
        objectUrl = URL.createObjectURL(doc.blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (live) setLocked(true);
      });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [docId]);

  if (docId === null) {
    // External image — render directly.
    return <img src={src} alt={alt} loading="lazy" className="max-w-full rounded-lg" />;
  }
  if (locked) {
    return (
      <span className="block rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-500">
        {alt || 'Attached image'} — open it in Files to view.
      </span>
    );
  }
  if (!url) {
    return (
      <span
        className="block h-16 animate-pulse rounded-lg bg-zinc-800/60"
        aria-label="Loading image"
      />
    );
  }
  return <img src={url} alt={alt} loading="lazy" className="max-w-full rounded-lg" />;
}

function textOf(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children))
    return children.map((c) => (typeof c === 'string' ? c : '')).join('');
  return '';
}

function HWithAnchor({
  level,
  text,
  children,
}: {
  level: 1 | 2 | 3;
  text: string;
  children: React.ReactNode;
}) {
  const id = `h-${slugify(text)}`;
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3';
  return <Tag id={id}>{children}</Tag>;
}

const INLINE_PATTERN = '\\[\\[([^\\]]+)\\]\\]|(^|\\s)#([A-Za-z0-9][\\w/-]{0,48})';

function InlineRich({
  text,
  lookup,
  onOpenNote,
  onOpenTag,
}: {
  text: React.ReactNode;
  lookup: Map<string, number>;
  onOpenNote?: (id: number) => void;
  onOpenTag?: (tag: string) => void;
}) {
  const flat = textOf(text);
  if (!flat || (!flat.includes('[[') && !flat.includes('#'))) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(INLINE_PATTERN, 'g');
  let k = 0;
  while ((m = re.exec(flat)) !== null) {
    const start = m.index + (m[1] ? 0 : (m[2]?.length ?? 0));
    if (start > last) parts.push(flat.slice(last, start));
    if (m[1]) {
      const title = m[1];
      const id = lookup.get(title.toLowerCase());
      parts.push(
        id !== undefined && onOpenNote ? (
          <button
            key={k++}
            onClick={() => onOpenNote(id)}
            className="cursor-pointer rounded bg-accent-500/15 px-1 text-accent-300 underline decoration-accent-600/60 underline-offset-2 hover:bg-accent-500/25"
          >
            {title}
          </button>
        ) : (
          <span key={k++} className="text-zinc-400">
            [[{title}]]
          </span>
        ),
      );
    } else if (m[3]) {
      const tag = m[3].toLowerCase();
      parts.push(' ');
      parts.push(
        onOpenTag ? (
          <button
            key={k++}
            onClick={() => onOpenTag(tag)}
            className="cursor-pointer rounded-full border border-zinc-700 bg-zinc-800/60 px-1.5 text-[0.85em] text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
          >
            #{tag}
          </button>
        ) : (
          <span key={k++} className="text-zinc-400">
            #{tag}
          </span>
        ),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < flat.length) parts.push(flat.slice(last));
  return <>{parts}</>;
}
