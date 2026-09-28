import { Suspense, lazy, useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import {
  ChevronLeft,
  CornerDownLeft,
  Copy,
  Feather,
  Lightbulb,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Repeat2,
  Replace,
  TriangleAlert,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, writeWithAI, type WriteResult } from '../lib/api';
import { countWords } from '../lib/format';
import { useFocusTrap } from '../lib/focus-trap';
import {
  WRITE_ACTIONS,
  WRITE_LENGTHS,
  WRITE_STYLES,
  WRITE_STRUCTURES,
  type WritingAction,
  type WritingPreset,
} from '../lib/writing-presets';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Skeleton } from './ui/skeleton';

const MarkdownView = lazy(() =>
  import('./MarkdownView').then((module) => ({ default: module.MarkdownView })),
);

export type WritePlacement = 'cursor' | 'append' | 'replace';

interface WriteModalProps {
  open: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
  /** Live note text — sent as context only when the toggle is on and the note isn't encrypted. */
  noteText: string;
  encrypted: boolean;
  onInsert: (content: string, placement: WritePlacement) => void;
}

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const ACTION_ICONS: Record<string, LucideIcon> = {
  draft: Feather,
  continue: Repeat2,
  expand: Maximize2,
  rewrite: Wand2,
  summarize: Minimize2,
  brainstorm: Lightbulb,
};

const panelMotion: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.28, ease: EASE } },
  exit: { opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.18, ease: EASE } },
};

export function WriteModal({
  open,
  onClose,
  onUnauthorized,
  noteText,
  encrypted,
  onInsert,
}: WriteModalProps) {
  const [stage, setStage] = useState<'form' | 'preview'>('form');
  const [instruction, setInstruction] = useState('');
  const [style, setStyle] = useState('professional');
  const [structure, setStructure] = useState('paragraphs');
  const [length, setLength] = useState('medium');
  const [useContext, setUseContext] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [result, setResult] = useState<WriteResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const panelRef = useFocusTrap<HTMLDivElement>(open);

  const generate = useMutation({
    mutationFn: () =>
      writeWithAI({
        instruction: instruction.trim(),
        style,
        structure,
        length,
        context: useContext && !encrypted && noteText.trim() ? noteText : undefined,
        encrypted,
      }),
    onSuccess: (draft) => {
      if (!draft.text) {
        setFailure(draft.warning ?? 'AI returned no content — try again.');
        return;
      }
      setFailure(null);
      setResult(draft);
      setStage('preview');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
        onUnauthorized();
        return;
      }
      setFailure(err instanceof Error ? err.message : 'Writing failed');
    },
  });

  const busy = generate.isPending;

  // Fresh stage each time the modal (re)opens — render-phase adjustment
  // (React's documented alternative to a reset effect). Instruction and
  // presets intentionally persist across opens so tweaks stay in place.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStage('form');
      setFailure(null);
    }
  }

  // Escape closes — but never mid-generation (the call is already paid for).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  function handleActionChip(action: WritingAction) {
    setInstruction(action.prefill);
    setUseContext(action.usesContext === true && !encrypted);
    setActiveAction(action.id);
    setFailure(null);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!instruction.trim() || busy) return;
    generate.mutate();
  }

  function handleApply(placement: WritePlacement) {
    if (!result?.text) return;
    onInsert(result.text, placement);
  }

  async function handleCopy() {
    if (!result?.text) return;
    try {
      await navigator.clipboard.writeText(result.text);
      toast.success('Draft copied');
    } catch {
      toast.error('Copy failed — select the text manually');
    }
  }

  const styleLabel = WRITE_STYLES.find((p) => p.id === style)?.label ?? '';
  const structureLabel = WRITE_STRUCTURES.find((p) => p.id === structure)?.label ?? '';

  const failureBanner = failure && (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs leading-relaxed text-amber-200/90"
    >
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span>{failure}</span>
    </div>
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="dialog"
          aria-modal="true"
          aria-label="Write with AI"
          onClick={() => {
            if (!busy) onClose();
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm"
        >
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            variants={panelMotion}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88vh] w-full max-w-2xl flex-col"
          >
            <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle>{stage === 'form' ? 'write with ai' : 'your draft'}</CardTitle>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-600">
                    {stage === 'form'
                      ? 'draft · style · structure'
                      : `${countWords(result?.text ?? '')} words · ${styleLabel} · ${structureLabel}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {stage === 'preview' && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setStage('form')}
                      title="Back to options"
                    >
                      <ChevronLeft />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onClose}
                    disabled={busy}
                    title="Close"
                  >
                    <X />
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                <AnimatePresence mode="wait" initial={false}>
                  {stage === 'form' ? (
                    <motion.form
                      key="form"
                      onSubmit={handleSubmit}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -12 }}
                      transition={{ duration: 0.22, ease: EASE }}
                      className="flex min-h-0 flex-1 flex-col gap-4"
                    >
                      <section className="flex flex-col gap-2">
                        <Eyebrow>start with</Eyebrow>
                        <div className="flex flex-wrap gap-1.5">
                          {WRITE_ACTIONS.map((action, index) => {
                            const Icon = ACTION_ICONS[action.id] ?? Feather;
                            return (
                              <Chip
                                key={action.id}
                                selected={activeAction === action.id}
                                delay={index * 0.03}
                                onClick={() => handleActionChip(action)}
                              >
                                <Icon className="size-3" />
                                {action.label}
                              </Chip>
                            );
                          })}
                        </div>
                      </section>

                      <section className="flex flex-col gap-1.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <Eyebrow>instruction</Eyebrow>
                          <span
                            className={cn(
                              'font-mono text-[10px]',
                              instruction.length > 1800 ? 'text-amber-400' : 'text-zinc-600',
                            )}
                          >
                            {instruction.length}/2000
                          </span>
                        </div>
                        <textarea
                          value={instruction}
                          onChange={(e) => {
                            setInstruction(e.target.value);
                            setActiveAction(null);
                            if (failure) setFailure(null);
                          }}
                          maxLength={2000}
                          rows={4}
                          autoFocus
                          placeholder="What should the AI write? e.g. “an intro paragraph for a newsletter about our product launch”"
                          aria-label="What should the AI write?"
                          className="min-h-[104px] w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-2.5 text-[13px] leading-relaxed text-zinc-100 transition-all duration-200 outline-none placeholder:text-zinc-500 hover:border-zinc-700 focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/20 ease-[cubic-bezier(0.32,0.72,0,1)]"
                        />
                      </section>

                      <PresetGroup
                        eyebrow="style"
                        options={WRITE_STYLES}
                        value={style}
                        onChange={setStyle}
                      />
                      <PresetGroup
                        eyebrow="structure"
                        options={WRITE_STRUCTURES}
                        value={structure}
                        onChange={setStructure}
                      />
                      <PresetGroup
                        eyebrow="length"
                        options={WRITE_LENGTHS}
                        value={length}
                        onChange={setLength}
                        showHint
                      />

                      {encrypted ? (
                        <p className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 px-3 py-2 text-[11px] leading-relaxed text-zinc-500">
                          Encrypted notes stay in your browser — context is disabled, only your
                          instruction is sent.
                        </p>
                      ) : (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={useContext}
                          onClick={() => setUseContext((v) => !v)}
                          className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-zinc-800/70 bg-zinc-950/40 px-3.5 py-2.5 text-left transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-zinc-700/80 active:scale-[0.99]"
                        >
                          <span className="min-w-0">
                            <span className="block text-xs font-medium text-zinc-200">
                              Use current note as context
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                              Lets the AI continue, expand, or rewrite what&apos;s already written.
                            </span>
                          </span>
                          <span
                            className={cn(
                              'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
                              useContext ? 'bg-accent-500' : 'bg-zinc-700',
                            )}
                          >
                            <span
                              className={cn(
                                'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-zinc-100 shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
                                useContext && 'translate-x-4',
                              )}
                            />
                          </span>
                        </button>
                      )}

                      {failureBanner}

                      <div className="flex items-center justify-between gap-3 pt-0.5">
                        <p className="text-[11px] text-zinc-600">
                          Uses one AI call from the daily budget.
                        </p>
                        <Button
                          type="submit"
                          variant="accent"
                          disabled={!instruction.trim() || busy}
                        >
                          {busy ? <Loader2 className="animate-spin" /> : <Feather />}
                          {busy ? 'Writing…' : 'Generate draft'}
                        </Button>
                      </div>
                    </motion.form>
                  ) : (
                    <motion.div
                      key="preview"
                      initial={{ opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 12 }}
                      transition={{ duration: 0.22, ease: EASE }}
                      className="flex min-h-0 flex-1 flex-col gap-3"
                    >
                      {failureBanner}
                      <div className="markdown-body min-h-[120px] flex-1 overflow-y-auto rounded-xl border border-zinc-800/70 bg-zinc-950/50 px-4 py-3.5 text-[13px] leading-relaxed">
                        <Suspense
                          fallback={
                            <div className="flex flex-col gap-2">
                              <Skeleton className="h-3.5 w-3/4" />
                              <Skeleton className="h-3.5 w-full" />
                              <Skeleton className="h-3.5 w-5/6" />
                            </div>
                          }
                        >
                          <MarkdownView text={result?.text ?? ''} />
                        </Suspense>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1.5">
                          <Button variant="ghost" size="sm" onClick={() => setStage('form')}>
                            <ChevronLeft />
                            Edit options
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => generate.mutate()}
                            disabled={busy}
                          >
                            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                            Regenerate
                          </Button>
                          <Button variant="ghost" size="sm" onClick={handleCopy}>
                            <Copy />
                            Copy
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleApply('replace')}
                            title="Replace the whole note with this draft"
                          >
                            <Replace />
                            Replace
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleApply('append')}
                            title="Add the draft to the end of the note"
                          >
                            <Plus />
                            Append
                          </Button>
                          <Button
                            variant="accent"
                            size="sm"
                            onClick={() => handleApply('cursor')}
                            title="Insert the draft at the cursor"
                          >
                            <CornerDownLeft />
                            Insert at cursor
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] tracking-[0.18em] text-zinc-500 uppercase">
      {children}
    </span>
  );
}

function PresetGroup({
  eyebrow,
  options,
  value,
  onChange,
  showHint = false,
}: {
  eyebrow: string;
  options: WritingPreset[];
  value: string;
  onChange: (id: string) => void;
  showHint?: boolean;
}) {
  return (
    <section className="flex flex-col gap-2">
      <Eyebrow>{eyebrow}</Eyebrow>
      <div className="flex flex-wrap gap-1.5">
        {options.map((preset, index) => (
          <Chip
            key={preset.id}
            selected={value === preset.id}
            delay={index * 0.03}
            onClick={() => onChange(preset.id)}
          >
            {preset.label}
            {showHint && preset.hint && <span className="text-zinc-500">· {preset.hint}</span>}
          </Chip>
        ))}
      </div>
    </section>
  );
}

function Chip({
  selected,
  delay = 0,
  onClick,
  children,
}: {
  selected: boolean;
  delay?: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3, ease: EASE }}
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 active:scale-[0.97]',
        selected
          ? 'border-accent-500/50 bg-accent-500/15 text-accent-200 shadow-[0_0_16px_-6px_rgb(20115463/0.6)]'
          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-200',
      )}
    >
      {children}
    </motion.button>
  );
}
