import { Suspense, lazy, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { FileText, Loader2, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, askQuestion, type AskResult, type AskSource } from '../lib/api';
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
}

interface QAItem {
  id: number;
  question: string;
  result: AskResult;
}

let nextId = 0;

export function AskPanel({ onUnauthorized, onOpenDocument }: AskPanelProps) {
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<QAItem[]>([]);

  const ask = useMutation({
    mutationFn: askQuestion,
    onSuccess: (result, asked) => {
      nextId += 1;
      setHistory((prev) => [{ id: nextId, question: asked, result }, ...prev]);
      if (result.fallback && result.warning) toast.warning(result.warning);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
        onUnauthorized();
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Question failed');
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || ask.isPending) return;
    setQuestion('');
    ask.mutate(trimmed);
  }

  return (
    <Card className="flex min-h-[320px] flex-1 flex-col overflow-hidden">
      <CardHeader>
        <CardTitle>ask documents</CardTitle>
        <span className="font-mono text-[11px] text-zinc-600">semantic search</span>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <form onSubmit={handleSubmit} className="flex gap-1.5">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about your files…"
            aria-label="Ask about your documents"
            disabled={ask.isPending}
          />
          <Button type="submit" variant="accent" disabled={ask.isPending || !question.trim()}>
            {ask.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            <span className="hidden sm:inline">Ask</span>
          </Button>
        </form>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-0.5">
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
              <p className="text-sm text-zinc-400">Ask anything in your files</p>
              <p className="max-w-[240px] text-xs text-zinc-600">
                Answers cite their sources. Encrypted files are never indexed or searched.
              </p>
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
                {item.result.fallback ? (
                  <p className="text-xs text-amber-300">
                    {item.result.warning ?? 'No answer available.'}
                  </p>
                ) : (
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
                        {item.result.sources.map((source) => (
                          <SourceChip
                            key={source.document_id}
                            source={source}
                            onOpen={() => onOpenDocument(source.document_id)}
                          />
                        ))}
                      </div>
                    )}
                  </>
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
  return (
    <button
      onClick={onOpen}
      title={`Open ${source.file_name}`}
      className={cn(
        'flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-zinc-700/70',
        'bg-zinc-800/60 px-2.5 py-1 font-mono text-[11px] text-zinc-300',
        'transition-colors duration-150 hover:border-zinc-600 hover:text-zinc-100',
      )}
    >
      <FileText className="size-3 shrink-0 text-zinc-500" />
      <span className="truncate">{source.file_name}</span>
    </button>
  );
}
