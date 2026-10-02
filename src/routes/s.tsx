import { Suspense, lazy, useEffect, type ReactNode } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { FileQuestion, Loader2, Unlink } from 'lucide-react';
import { ApiError, fetchSharedNote } from '../lib/api';
import { timeAgo } from '../lib/format';

const MarkdownView = lazy(() =>
  import('../components/MarkdownView').then((module) => ({ default: module.MarkdownView })),
);

export const Route = createFileRoute('/s')({
  validateSearch: (search: Record<string, unknown>): { t?: string } => ({
    t: typeof search.t === 'string' && search.t ? search.t : undefined,
  }),
  component: SharedNotePage,
});

/** Public read-only viewer for `/s?t=…` share links. No session, no gate. */
function SharedNotePage() {
  const { t } = Route.useSearch();

  const query = useQuery({
    queryKey: ['shared-note', t],
    queryFn: () => fetchSharedNote(t as string),
    enabled: Boolean(t),
    retry: false,
    staleTime: 30_000,
  });

  const note = query.data;

  useEffect(() => {
    document.title = note ? `${note.title} · Noting` : 'Shared note · Noting';
  }, [note]);

  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="border-b border-zinc-900">
        <div className="mx-auto flex max-w-[760px] items-center justify-between px-5 py-3.5">
          <Link to="/" className="flex items-center gap-2" aria-label="Noting home">
            <span className="flex size-6 items-center justify-center rounded-md border border-accent-600/50 bg-accent-500/10 font-mono text-[11px] font-semibold text-accent-300">
              N
            </span>
            <span className="font-mono text-[11px] tracking-[0.22em] text-zinc-400 uppercase">
              noting
            </span>
          </Link>
          <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-mono text-[10px] tracking-[0.16em] text-zinc-500 uppercase">
            read only
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-5 py-10">
        {!t ? (
          <EmptyState
            icon={<FileQuestion className="size-5" />}
            title="No share token"
            body="This URL is missing its ?t= token. Ask whoever shared the note for a fresh link."
          />
        ) : query.isPending ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading shared note">
            <div className="h-3 w-24 animate-pulse rounded bg-zinc-900" />
            <div className="h-9 w-3/4 animate-pulse rounded bg-zinc-900" />
            <div className="mt-4 space-y-2.5">
              <div className="h-4 w-full animate-pulse rounded bg-zinc-900" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-zinc-900" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-900" />
            </div>
          </div>
        ) : query.isError ? (
          <EmptyState
            icon={
              query.error instanceof ApiError && query.error.status === 429 ? (
                <Loader2 className="size-5" />
              ) : (
                <Unlink className="size-5" />
              )
            }
            title={
              query.error instanceof ApiError && query.error.status === 429
                ? 'Too many attempts'
                : 'Link unavailable'
            }
            body={
              query.error instanceof Error
                ? query.error.message
                : 'This share link is invalid, expired, or has been revoked'
            }
            action={
              query.error instanceof ApiError && query.error.status === 429
                ? { label: 'Try again', onClick: () => void query.refetch() }
                : { label: 'Open Noting', to: '/' }
            }
          />
        ) : note ? (
          <article>
            <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
              shared note
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50 text-balance">
              {note.title || 'Untitled'}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-zinc-500">
              <span className="font-mono">updated {timeAgo(note.updated_at)}</span>
              {note.tags.length > 0 && (
                <span className="flex flex-wrap gap-1.5">
                  {note.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[10px] text-zinc-400"
                    >
                      #{tag}
                    </span>
                  ))}
                </span>
              )}
            </div>

            <div className="mt-6 border-t border-zinc-900 pt-6">
              <Suspense
                fallback={
                  <div className="space-y-2.5">
                    <div className="h-4 w-full animate-pulse rounded bg-zinc-900" />
                    <div className="h-4 w-5/6 animate-pulse rounded bg-zinc-900" />
                  </div>
                }
              >
                <MarkdownView text={note.content} />
              </Suspense>
            </div>
          </article>
        ) : null}
      </main>

      <footer className="mx-auto max-w-[760px] px-5 pb-10">
        <p className="font-mono text-[11px] text-zinc-600">
          shared read-only · made with{' '}
          <Link
            to="/"
            className="text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
          >
            noting
          </Link>
        </p>
      </footer>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: { label: string; to?: string; onClick?: () => void };
}) {
  return (
    <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-800 px-6 py-12 text-center">
      <span className="flex size-11 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400">
        {icon}
      </span>
      <h1 className="text-lg font-medium text-zinc-100">{title}</h1>
      <p className="text-sm text-zinc-500">{body}</p>
      {action &&
        (action.onClick ? (
          <button
            onClick={action.onClick}
            className="mt-2 cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
          >
            {action.label}
          </button>
        ) : (
          <Link
            to={action.to ?? '/'}
            className="mt-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
          >
            {action.label}
          </Link>
        ))}
    </div>
  );
}
