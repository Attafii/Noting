import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useFocusTrap } from '../lib/focus-trap';
import { Button } from './ui/button';

const STORAGE_KEY = 'onboarded';

export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '1';
  } catch {
    return false;
  }
}

function dismiss() {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* ignore */
  }
}

const STEPS = [
  {
    title: 'Capture without friction',
    body: 'Everything autosaves as you type — even offline. Edits queue locally and sync when you reconnect. Your last note reopens where you left it.',
  },
  {
    title: 'Type / for commands',
    body: 'The toolbar handles headings, checklists, tables, and quotes. Press / for the slash menu, use Split view to watch the preview update live, and open the Outline for long notes.',
  },
  {
    title: 'Connect with tags and links',
    body: 'Write #tags inline and [[link notes]] wiki-style. Ctrl+K finds notes, tags, and files with fuzzy search — typos welcome.',
  },
] as const;

/** First-run coachmarks. Render inside the authed workspace. */
export function OnboardingTour() {
  const [open, setOpen] = useState(shouldShowOnboarding);
  const [step, setStep] = useState(0);
  const dialogRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  function close() {
    dismiss();
    setOpen(false);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Getting started"
          className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/70 p-4 backdrop-blur-sm sm:items-center"
        >
          <motion.div
            ref={dialogRef}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-md rounded-2xl border border-zinc-700/70 bg-zinc-900 p-6 shadow-[0_24px_70px_-12px_rgb(0_0_0/0.9)]"
          >
            <div className="flex items-center justify-between">
              <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
                Getting started · {step + 1} of {STEPS.length}
              </p>
              <Button size="icon-sm" variant="ghost" onClick={close} title="Skip tour">
                <X />
              </Button>
            </div>
            <h2 className="mt-3 text-lg font-semibold text-zinc-100">{STEPS[step].title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{STEPS[step].body}</p>
            <div className="mt-4 flex items-center gap-1.5">
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={
                    i === step
                      ? 'h-1.5 w-6 rounded-full bg-accent-500'
                      : 'h-1.5 w-1.5 rounded-full bg-zinc-700'
                  }
                />
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between">
              <Button
                size="sm"
                variant="ghost"
                disabled={step === 0}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                <ArrowLeft /> Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button size="sm" variant="accent" onClick={() => setStep((s) => s + 1)}>
                  Next <ArrowRight />
                </Button>
              ) : (
                <Button size="sm" variant="accent" onClick={close}>
                  Start writing
                </Button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
