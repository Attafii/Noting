import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, Lock, Send, Sparkles, StickyNote, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  ApiError,
  assistantAsk,
  type AssistantMode,
  type AskSource,
  type AskTurn,
} from '../lib/api';
import { HELP_SUGGESTIONS, NOTES_SUGGESTIONS } from '../lib/assistant';
import { cn } from '../lib/utils';

// Markdown arrives mid-stream, so the viewer stays behind a lazy boundary —
// the assistant FAB never blocks the workspace bundle.
const MarkdownView = lazy(() =>
  import('./MarkdownView').then((module) => ({ default: module.MarkdownView })),
);

/**
 * Ember — the in-app assistant (floating button, bottom-right).
 *
 * Appears ONLY inside the unlocked workspace (mounted by AuthedWorkspace):
 * both modes require the session, and nothing here is reachable pre-unlock.
 *
 * Two modes behind one segmented switch:
 * - Help (default): product questions from the static guide — no user data.
 * - My notes: conversational search over plaintext notes (labelled private;
 *   encrypted/archived/trashed notes are excluded server-side).
 *
 * Transports: SSE streaming (the answer types in live) with a JSON fallback.
 * Chat lives in component memory only — it disappears on reload by design.
 */

interface EmberAssistantProps {
  onOpenNote: (noteId: number) => void;
  onUnauthorized: () => void;
}

interface DisplayMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  sources?: AskSource[];
  /** Server-side soft failure (quota-free fallback, no notes found, …). */
  warning?: string;
}

let nextId = 0;

export function EmberAssistant({ onOpenNote, onUnauthorized }: EmberAssistantProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AssistantMode>('help');
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  /** Where focus should return when the panel closes. */
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  // Ctrl/Cmd + / toggles the panel (workspace-scoped, so unlock-only).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === '/') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Focus into the composer on open; restore focus to the FAB on close.
  useEffect(() => {
    if (open) {
      lastFocusedRef.current = document.activeElement as HTMLElement | null;
      const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(timer);
    }
    (lastFocusedRef.current ?? fabRef.current)?.focus?.();
  }, [open]);

  // Keep the newest message in view while streaming.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  // Escape closes; Tab stays trapped inside the panel (dialog semantics).
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea, input, [href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  /** Switching modes starts a fresh thread — history never crosses modes. */
  const switchMode = (next: AssistantMode) => {
    if (next === mode) return;
    setMode(next);
    setMessages([]);
  };

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;

      const userMsg: DisplayMessage = { id: ++nextId, role: 'user', content: question };
      const pendingId = ++nextId;
      const history: AskTurn[] = [...messages, userMsg]
        .filter((m) => m.content && !m.warning)
        .map((m) => ({ role: m.role, content: m.content }));

      setInput('');
      setBusy(true);
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: pendingId, role: 'assistant', content: '', sources: [] },
      ]);

      const appendDelta = (delta: string) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === pendingId ? { ...m, content: m.content + delta } : m)),
        );
      };

      try {
        const result = await assistantAsk({ mode, messages: history }, { onDelta: appendDelta });
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== pendingId) return m;
            if (!result.answer && result.warning) {
              // Soft server fallback (no matching notes, AI off, …): rendered
              // as the assistant's reply instead of an empty bubble.
              return { ...m, content: '', warning: result.warning };
            }
            return { ...m, content: result.answer, sources: result.sources };
          }),
        );
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorized();
          return;
        }
        const message = err instanceof Error ? err.message : 'The assistant is unavailable';
        setMessages((prev) => {
          const kept = prev.filter((m) => m.id !== pendingId);
          const last = kept[kept.length - 1];
          // Keep a partial stream if the connection died mid-answer;
          // otherwise hand the question back so retry is one keystroke.
          if (last && last.role === 'assistant' && last.content) {
            return [...kept, { id: ++nextId, role: 'assistant', content: '', warning: message }];
          }
          setInput(question);
          return [...kept, { id: ++nextId, role: 'assistant', content: '', warning: message }];
        });
        if (!(err instanceof ApiError && err.status === 401)) {
          toast.error(message);
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, messages, mode, onUnauthorized],
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function handleComposerKey(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  }

  function openSource(source: AskSource) {
    if (source.kind === 'note' && source.note_id != null) {
      onOpenNote(source.note_id);
      // On mobile the note sits behind the sheet — dismiss it.
      if (window.matchMedia('(max-width: 639px)').matches) setOpen(false);
    }
  }

  const suggestions = mode === 'help' ? HELP_SUGGESTIONS : NOTES_SUGGESTIONS;

  return (
    <>
      {/* Floating action button — the breathing ember. */}
      <motion.button
        ref={fabRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open assistant (Ctrl + /)"
        title="Assistant · Ctrl + /"
        aria-expanded={open}
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        className={cn(
          'ember-fab fixed right-4 z-40 flex size-13 cursor-pointer items-center justify-center rounded-full',
          'bg-accent-500 text-zinc-950 shadow-[0_8px_28px_-8px_rgb(232_116_59/0.55),0_0_0_1px_rgb(232_116_59/0.35)]',
          'transition-[opacity,transform] duration-200 hover:brightness-110',
          // Clear the mobile bottom bar (≈56px + safe area) on small screens.
          'bottom-[calc(4.75rem+env(safe-area-inset-bottom))] sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))]',
          open && 'pointer-events-none opacity-0',
        )}
      >
        <Sparkles className="size-5" />
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            {/* Scrim: click-away close (desktop only — mobile keeps the sheet modal-ish). */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
              aria-hidden
              className="fixed inset-0 z-40 bg-zinc-950/50 backdrop-blur-[2px] sm:bg-transparent sm:backdrop-blur-none"
            />

            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Ember assistant"
              onKeyDown={onKeyDown}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                'fixed z-50 flex flex-col overflow-hidden',
                'border border-zinc-800 bg-zinc-900/95 shadow-[0_24px_64px_-24px_rgb(0_0_0/0.8)] backdrop-blur-xl',
                // Mobile: bottom sheet above the safe area. Desktop: side card.
                'inset-x-0 bottom-0 max-h-[82vh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]',
                'sm:inset-x-auto sm:right-6 sm:bottom-20 sm:w-[380px] sm:max-h-[min(600px,calc(100vh-8rem))] sm:rounded-2xl sm:pb-0',
              )}
            >
              <EmberHeader mode={mode} onModeChange={switchMode} onClose={() => setOpen(false)} />

              <div
                ref={scrollRef}
                aria-live="polite"
                className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
              >
                {messages.length === 0 && (
                  <EmptyState
                    mode={mode}
                    suggestions={suggestions}
                    onPick={(text) => void send(text)}
                  />
                )}

                {messages.map((message, index) => (
                  <Message
                    key={message.id}
                    message={message}
                    streaming={
                      busy && index === messages.length - 1 && message.role === 'assistant'
                    }
                    onOpenSource={openSource}
                  />
                ))}
              </div>

              <form
                onSubmit={handleSubmit}
                className="flex items-end gap-2 border-t border-zinc-800/80 bg-zinc-950/40 px-3 py-3"
              >
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleComposerKey}
                  maxLength={2000}
                  placeholder={
                    mode === 'help' ? 'Ask about Noting…' : 'Ask your notes… (Enter to send)'
                  }
                  aria-label="Message the assistant"
                  className="max-h-28 min-h-9 flex-1 resize-none rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-[13px] leading-relaxed text-zinc-100 transition-colors placeholder:text-zinc-500 hover:border-zinc-700 focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/20 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={busy || !input.trim()}
                  aria-label="Send message"
                  className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-accent-500 text-zinc-950 transition-all hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </button>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function EmberHeader({
  mode,
  onModeChange,
  onClose,
}: {
  mode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-zinc-800/80 bg-zinc-950/50 px-4 py-3">
      <span className="ember-dot size-2 shrink-0" aria-hidden />
      <span className="text-[13px] font-semibold text-zinc-100">Ember</span>

      <div
        role="tablist"
        aria-label="Assistant mode"
        className="ml-auto flex rounded-lg border border-zinc-800 bg-zinc-950/60 p-0.5"
      >
        <ModeTab active={mode === 'help'} onClick={() => onModeChange('help')} label="Help" />
        <ModeTab
          active={mode === 'notes'}
          onClick={() => onModeChange('notes')}
          label="My notes"
          icon={<Lock className="size-3" />}
        />
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close assistant"
        className="cursor-pointer rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all duration-200',
        active ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState({
  mode,
  suggestions,
  onPick,
}: {
  mode: AssistantMode;
  suggestions: readonly string[];
  onPick: (text: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 py-4">
      <div className="text-center">
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-accent-600/40 bg-accent-500/10 text-accent-300">
          <Sparkles className="size-4" />
        </span>
        <p className="font-display mt-3 text-[15px] font-medium text-zinc-100">
          {mode === 'help' ? 'How can I help?' : 'Ask your notes'}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          {mode === 'help'
            ? 'Questions about Noting — features, shortcuts, settings.'
            : 'Search over your plaintext notes. Encrypted, archived, and trashed notes are never read.'}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {suggestions.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-left text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function Message({
  message,
  streaming,
  onOpenSource,
}: {
  message: DisplayMessage;
  /** True while this assistant message is still receiving stream deltas. */
  streaming: boolean;
  onOpenSource: (source: AskSource) => void;
}) {
  if (message.role === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="self-end rounded-2xl rounded-br-md bg-accent-500/15 px-3.5 py-2 text-[13px] leading-relaxed text-zinc-100"
        style={{ maxWidth: '85%' }}
      >
        {message.content}
      </motion.div>
    );
  }

  const hasNoteSources = (message.sources?.length ?? 0) > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-2"
    >
      {message.warning ? (
        <div className="rounded-xl border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
          {message.warning}
        </div>
      ) : message.content ? (
        <div className="markdown-body text-[13px]">
          <Suspense
            fallback={<span className="inline-block h-3.5 w-1.5 animate-pulse bg-accent-500" />}
          >
            <MarkdownView text={message.content} />
          </Suspense>
          {streaming && streamCaret()}
        </div>
      ) : (
        // First deltas haven't arrived yet — a quiet pulse instead of blank.
        streaming && <StreamPlaceholder />
      )}

      {hasNoteSources && (
        <div className="flex flex-wrap gap-1.5">
          {message.sources!.map((source, index) => (
            <button
              key={`note-${source.note_id ?? index}`}
              type="button"
              onClick={() => onOpenSource(source)}
              title={`Open note “${source.title ?? ''}”`}
              className="flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-zinc-700/70 bg-zinc-800/60 px-2.5 py-1 font-mono text-[11px] text-zinc-300 transition-colors duration-150 hover:border-zinc-600 hover:text-zinc-100"
            >
              <StickyNote className="size-3 shrink-0 text-zinc-500" />
              <span className="truncate">{source.title ?? 'note'}</span>
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/** Blinking ember caret appended while the stream is still arriving. */
function streamCaret() {
  return (
    <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-accent-500 align-baseline" />
  );
}

/** Three-dot ember pulse before the first delta lands. */
function StreamPlaceholder() {
  return (
    <div className="flex items-center gap-1 py-1" aria-hidden>
      <span className="ember-dot size-1.5" />
      <span className="ember-dot size-1.5 [animation-delay:0.4s]" />
      <span className="ember-dot size-1.5 [animation-delay:0.8s]" />
    </div>
  );
}
