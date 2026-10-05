import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Link, Link2, Link2Off } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, getNote, listNotes, saveNote, type NoteSummary } from '../lib/api';
import {
  backlinksFor,
  MIN_MENTION_TITLE,
  outgoingLinks,
  unlinkedMentions,
  wrapFirstMention,
  type UnlinkedMention,
} from '../lib/backlinks';
import { Button } from './ui/button';

interface BacklinksPanelProps {
  noteId: number | null;
  onOpenNote: (id: number) => void;
  onUnauthorized: () => void;
}

/** Most-recent unlinked mentions shown before the "+N more" cutoff. */
const MAX_UNLINKED_ROWS = 10;

/**
 * Wikilink graph for the open note: notes that link to it (backlinks), notes
 * that mention it in plain text without a link (one-click to fix), and notes
 * it links to (outgoing). Plaintext only — encrypted bodies are never parsed
 * server- or client-side.
 */
export function BacklinksPanel({ noteId, onOpenNote, onUnauthorized }: BacklinksPanelProps) {
  const queryClient = useQueryClient();
  const notesQuery = useQuery({ queryKey: ['notes'], queryFn: listNotes, retry: false });
  const notes = useMemo(() => notesQuery.data ?? [], [notesQuery.data]);

  const current = useMemo(
    () => (noteId === null ? null : (notes.find((note) => note.id === noteId) ?? null)),
    [notes, noteId],
  );

  const backlinks = useMemo(() => (current ? backlinksFor(current, notes) : []), [current, notes]);
  const outgoing = useMemo(() => (current ? outgoingLinks(current, notes) : []), [current, notes]);
  const unlinked = useMemo(
    () => (current ? unlinkedMentions(current, notes) : []),
    [current, notes],
  );

  const title = current?.title.trim() ?? '';
  const titleTooShort = current !== null && title.length < MIN_MENTION_TITLE;

  // Wrap the first plain mention in [[…]] via a conflict-safe content save.
  const linkMention = useMutation({
    mutationFn: async (mention: UnlinkedMention) => {
      const fresh = await getNote(mention.note.id);
      if (fresh.enc) throw new Error('That note is encrypted — links only resolve in plaintext');
      const next = wrapFirstMention(fresh.content, title);
      if (next === null) throw new Error('The mention is gone — the note changed');
      return saveNote({
        id: mention.note.id,
        content: next,
        baseVersion: fresh.content_version ?? 1,
      });
    },
    onSuccess: (_data, mention) => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      void queryClient.invalidateQueries({ queryKey: ['note', mention.note.id] });
      toast.success(`Linked in ${mention.note.title}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'UNAUTHORIZED') onUnauthorized();
      else if (error instanceof ApiError && error.code === 'CONFLICT')
        toast.error('Note changed on another device — open it to link manually');
      else toast.error(error instanceof Error ? error.message : 'Could not link the mention');
    },
  });

  if (noteId === null) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-4 text-center text-[11px] text-zinc-600">
        Open a note to see what links to it.
      </p>
    );
  }

  if (!current) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-4 text-center text-[11px] text-zinc-600">
        {notesQuery.isPending ? 'Loading links…' : 'This note no longer exists.'}
      </p>
    );
  }

  if (current.enc && backlinks.length === 0 && outgoing.length === 0 && unlinked.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-4 text-center text-[11px] text-zinc-600">
        Encrypted notes keep their links private — wikilinks are only resolved for plaintext notes.
      </p>
    );
  }

  const pendingId = linkMention.isPending ? (linkMention.variables?.note.id ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <LinkSection
        title="Linked mentions"
        hint="Notes that link here"
        icon={<ArrowDownLeft className="size-3" />}
        items={backlinks}
        empty="Nothing links here yet."
        onOpenNote={onOpenNote}
      />
      {unlinked.length > 0 ? (
        <UnlinkedSection
          mentions={unlinked}
          pendingId={pendingId}
          onLink={(mention) => linkMention.mutate(mention)}
          onOpenNote={onOpenNote}
        />
      ) : titleTooShort ? (
        <p className="font-mono text-[10px] leading-relaxed text-zinc-700">
          Titles under {MIN_MENTION_TITLE} characters are skipped for mention matching.
        </p>
      ) : (
        <LinkSection
          title="Unlinked mentions"
          hint="Mentioned without a link"
          icon={<Link2Off className="size-3" />}
          items={[]}
          empty="No plain-text mentions to link."
          onOpenNote={onOpenNote}
        />
      )}
      <LinkSection
        title="Outgoing links"
        hint="This note links to"
        icon={<ArrowUpRight className="size-3" />}
        items={outgoing}
        empty="This note has no [[wikilinks]] yet."
        onOpenNote={onOpenNote}
      />
      <p className="font-mono text-[10px] leading-relaxed text-zinc-700">
        Link with double brackets: <span className="text-zinc-500">[[Note title]]</span>
      </p>
    </div>
  );
}

function SectionHeading({
  title,
  hint,
  icon,
  count,
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  count: number;
}) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <p className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
          {icon}
          {title}
        </p>
        <span className="font-mono text-[10px] text-zinc-600">{count}</span>
      </div>
      <p className="mt-0.5 text-[10px] text-zinc-700">{hint}</p>
    </>
  );
}

function LinkSection({
  title,
  hint,
  icon,
  items,
  empty,
  onOpenNote,
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  items: NoteSummary[];
  empty: string;
  onOpenNote: (id: number) => void;
}) {
  return (
    <section>
      <SectionHeading title={title} hint={hint} icon={icon} count={items.length} />
      {items.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-zinc-800 px-2.5 py-2 text-[11px] text-zinc-600">
          {empty}
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-1">
          {items.map((note) => (
            <button
              key={note.id}
              onClick={() => onOpenNote(note.id)}
              className="group flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-zinc-800/80 hover:bg-zinc-900/60"
            >
              <Link2 className="size-3 shrink-0 text-zinc-700 transition-colors group-hover:text-accent-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-zinc-300 group-hover:text-zinc-100">
                  {note.title}
                </span>
                {note.preview && (
                  <span className="block truncate font-mono text-[10px] text-zinc-700">
                    {note.preview.replace(/\s+/g, ' ').slice(0, 60)}
                  </span>
                )}
              </span>
              {note.archived && (
                <span className="shrink-0 font-mono text-[10px] text-zinc-700">archived</span>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function UnlinkedSection({
  mentions,
  pendingId,
  onLink,
  onOpenNote,
}: {
  mentions: UnlinkedMention[];
  pendingId: number | null;
  onLink: (mention: UnlinkedMention) => void;
  onOpenNote: (id: number) => void;
}) {
  const shown = mentions.slice(0, MAX_UNLINKED_ROWS);
  const hidden = mentions.length - shown.length;
  return (
    <section>
      <SectionHeading
        title="Unlinked mentions"
        hint="Mentioned without a link"
        icon={<Link2Off className="size-3" />}
        count={mentions.length}
      />
      <div className="mt-2 flex flex-col gap-1">
        {shown.map((mention) => (
          <article
            key={mention.note.id}
            data-testid="unlinked-row"
            data-note-id={mention.note.id}
            className="group rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-2 transition-colors hover:border-zinc-700/70"
          >
            <div className="flex items-start justify-between gap-2">
              <button
                onClick={() => onOpenNote(mention.note.id)}
                className="min-w-0 flex-1 cursor-pointer text-left"
              >
                <span className="block truncate text-[12px] font-medium text-zinc-300 group-hover:text-zinc-100">
                  {mention.note.title}
                </span>
                <span className="mt-0.5 line-clamp-2 font-mono text-[10px] leading-relaxed text-zinc-600">
                  {mention.snippet.slice(0, mention.matchStart)}
                  <span className="rounded-sm bg-accent-500/10 px-0.5 text-accent-300">
                    {mention.snippet.slice(
                      mention.matchStart,
                      mention.matchStart + mention.matchLength,
                    )}
                  </span>
                  {mention.snippet.slice(mention.matchStart + mention.matchLength)}
                </span>
              </button>
              <Button
                size="sm"
                variant="secondary"
                data-testid="link-mention"
                aria-label={`Link mention in ${mention.note.title}`}
                disabled={pendingId !== null}
                onClick={() => onLink(mention)}
              >
                <Link />
                Link
              </Button>
            </div>
            {mention.note.archived && (
              <span className="mt-1 inline-block font-mono text-[10px] text-zinc-700">
                archived
              </span>
            )}
          </article>
        ))}
        {hidden > 0 && <p className="px-1 font-mono text-[10px] text-zinc-700">+{hidden} more</p>}
      </div>
    </section>
  );
}
