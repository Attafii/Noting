import { Suspense, lazy, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { FileText, Loader2, Send, Sparkles, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import {
  ApiError,
  askQuestion,
  type AskResult,
  type AskScope,
  type AskSource,
  type AskTurn,
} from '../lib/api';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Skeleton } from './ui/skeleton';

const MarkdownView = lazy(() =>
  import('./MarkdownView').then((module) => ({ default: module.MarkdownView })),
);

interface AskPanelProps {
  onUnauthorized: () => void;
  onOpenDocument: (documentId: number) => void;
  onOpenNote?: (noteId: number) => void;
}

interface QAItem {
  id: number;
  question: string;
  result: AskResult;
  scope: AskScope;
}

const SCOPE_TABS: { key: AskScope; label: string }[] = [
  { key: 'docs', label: 'Files' },
  { key: 'notes', label: 'Notes' },
  { key: 'all', label: 'All' },
];

const SCOPE_SUBTITLE: Record<AskScope, string> = {
  docs: 'semantic search · keyword fallback',
  notes: 'full-text over unencrypted notes',
  all: 'notes + documents',
};

const SCOPE_PLACEHOLDER: Record<AskScope, string> = {
  docs: 'Ask about your files…',
  notes: 'Ask about your notes…',
  all: 'Ask across notes and files…',
};

const SCOPE_EMPTY: Record<AskScope, { title: string; body: string }> = {
  docs: {
    title: 'Ask anything in your files',
    body: 'Answers cite their sources. Encrypted files are never indexed or searched.',
  },
  notes: {
    title: 'Ask anything in your notes',
    body: 'Answers cite the notes they used. Encrypted notes are never searched.',
  },
  all: {
    title: 'Ask anything — notes and files',
    body: 'Search runs across unencrypted notes and documents together.',
  },
};

let nextId = 0;

/**
 * The panel stores Q/As newest-first; the model needs oldest-first turns.
 * Only answered exchanges count as turns — a warning-only exchange has no
 * assistant reply to condition on.
 */
function toTurns(items: QAItem[]): AskTurn[] {
  const turns: AskTurn[] = [];
  for (const item of [...items].reverse()) {
    if (!item.result.answer) continue;
    turns.push({ role: 'user', content: item.question });
    turns.push({ role: 'assistant', content: item.result.answer });
  }
  return turns;
}

export function AskPanel({ onUnauthorized, onOpenDocument, onOpenNote }: AskPanelProps) {
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<QAItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<AskScope>('docs');

  const ask = useMutation({
    mutationFn: (q: string) => askQuestion(q, toTurns(history), scope),
    onMutate: () => setError(null),
    onSuccess: (result, asked) => {
      nextId += 1;
      setQuestion('');
      setHistory((prev) => [{ id: nextId, question: asked, result, scope }, ...prev]);
      if (result.fallback && result.warning) toast.warning(result.warning);
    },
    onError: (err, asked) => {
      setQuestion(asked);
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
        onUnauthorized();
        return;
      }
      const message = err instanceof Error ? err.message : 'Question failed';
      setError(message);
      toast.error(message);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || ask.isPending) return;
    ask.mutate(trimmed);
  }

  return (
    <Card className="flex min-h-[320px] flex-1 flex-col overflow-hidden">
      <CardHeader>
        <CardTitle>ask</CardTitle>
        <span className="font-mono text-[11px] text-zinc-600">{SCOPE_SUBTITLE[scope]}</span>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <div
          role="tablist"
          aria-label="Search scope"
          className="flex self-start rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5"
        >
          {SCOPE_TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={scope === tab.key}
              disabled={ask.isPending}
              onClick={() => setScope(tab.key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200',
                ask.isPending ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                scope === tab.key
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <form onSubmit={handleSubmit} className="flex gap-1.5">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={SCOPE_PLACEHOLDER[scope]}
            aria-label="Ask a question"
            disabled={ask.isPending}
          />
          <Button type="submit" variant="accent" disabled={ask.isPending || !question.trim()}>
            {ask.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            <span className="hidden sm:inline">Ask</span>
          </Button>
        </form>

        {error && !ask.isPending && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-200">
            <span>{error}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={!question.trim()}
              onClick={() => ask.mutate(question.trim())}
            >
              Retry
            </Button>
          </div>
        )}
        <div
          aria-live="polite"
          className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-0.5"
        >
          {ask.isPending && (
            <div className="flex flex-col gap-2 rounded-xl border border-zinc-800/70 bg-zinc-900/50 p-3.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          )}

          {history.length === 0 && !ask.isPending && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-zinc-800 px-4 py-10 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-500">
                <Sparkles className="size-4" />
              </span>
              <p className="text-sm text-zinc-400">{SCOPE_EMPTY[scope].title}</p>
              <p className="max-w-[240px] text-xs text-zinc-600">{SCOPE_EMPTY[scope].body}</p>
            </div>
          )}

          <AnimatePresence initial={false}>
            {history.map((item) => (
              <motion.article
                key={item.id}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="flex flex-col gap-2 rounded-xl border border-zinc-800/70 bg-zinc-900/50 p-3.5"
              >
                <p className="text-[13px] font-medium text-zinc-100">{item.question}</p>
                {item.result.mode === 'keyword' && item.result.answer && (
                  <span className="inline-flex w-fit items-center rounded-full border border-amber-900/60 bg-amber-950/40 px-2 py-0.5 font-mono text-[10px] tracking-wide text-amber-300 uppercase">
                    keyword mode · no vector index
                  </span>
                )}
                {item.result.mode === 'notes' && item.result.answer && (
                  <span className="inline-flex w-fit items-center rounded-full border border-accent-600/50 bg-accent-500/10 px-2 py-0.5 font-mono text-[10px] tracking-wide text-accent-300 uppercase">
                    notes mode · full-text
                  </span>
                )}
                {item.result.answer ? (
                  <>
                    <div className="markdown-body text-[13px]">
                      <Suspense
                        fallback={
                          <div className="flex flex-col gap-1.5">
                            <Skeleton className="h-3.5 w-full" />
                            <Skeleton className="h-3.5 w-4/5" />
                          </div>
                        }
                      >
                        <MarkdownView text={item.result.answer} />
                      </Suspense>
                    </div>
                    {item.result.sources.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {item.result.sources.map((source, index) => {
                          const isNote = source.kind === 'note' || source.note_id != null;
                          return (
                            <SourceChip
                              key={
                                isNote
                                  ? `note-${source.note_id}`
                                  : `doc-${source.document_id ?? index}`
                              }
                              source={source}
                              onOpen={() => {
                                if (isNote && source.note_id != null) onOpenNote?.(source.note_id);
                                else if (source.document_id != null)
                                  onOpenDocument(source.document_id);
                              }}
                            />
                          );
                        })}
                      </div>
                    )}
                    {item.result.fallback && item.result.warning && (
                      <p className="text-[11px] leading-relaxed text-amber-300/90">
                        {item.result.warning}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-amber-300">
                    {item.result.warning ?? 'No answer available.'}
                  </p>
                )}
              </motion.article>
            ))}
          </AnimatePresence>
        </div>
      </CardContent>
    </Card>
  );
}

function SourceChip({ source, onOpen }: { source: AskSource; onOpen: () => void }) {
  const isNote = source.kind === 'note' || source.note_id != null;
  const label = (isNote ? source.title : source.file_name) ?? 'source';
  return (
    <button
      onClick={onOpen}
      title={`Open ${label}`}
      className={cn(
        'flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-zinc-700/70',
        'bg-zinc-800/60 px-2.5 py-1 font-mono text-[11px] text-zinc-300',
        'transition-colors duration-150 hover:border-zinc-600 hover:text-zinc-100',
      )}
    >
      {isNote ? (
        <StickyNote className="size-3 shrink-0 text-zinc-500" />
      ) : (
        <FileText className="size-3 shrink-0 text-zinc-500" />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}
