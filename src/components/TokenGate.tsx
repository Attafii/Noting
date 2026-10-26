import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lightbulb,
  Loader2,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, createSession, fetchHint, fetchQuestion, mintToken } from '../lib/api';
import { getSessionId, getToken, setAnswer, setSessionActive, setToken } from '../lib/token';
import { HumanCheck, type HumanCheckValue } from './HumanCheck';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Input } from './ui/input';
import { cn } from '../lib/utils';

interface TokenGateProps {
  onSaved: (token: string) => void;
}

type Tab = 'unlock' | 'generate';

export function TokenGate({ onSaved }: TokenGateProps) {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('token')?.trim() || getToken()) return 'unlock';
    } catch {
      /* ignore */
    }
    return 'generate';
  });

  // One-time read of a shared personal link (?token=…): stash it for the
  // Unlock tab and scrub it from the URL. History-only side effect.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const viaLink = params.get('token');
      if (viaLink && viaLink.trim()) {
        setToken(viaLink.trim());
        params.delete('token');
        const clean = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`;
        window.history.replaceState(null, '', clean);
      }
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="flex min-h-[78vh] items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md"
      >
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700/70 bg-zinc-900 text-zinc-300">
            <SquareTerminal className="size-4" />
          </span>
          <span className="font-mono text-xs tracking-[0.22em] text-zinc-300 uppercase">notes</span>
          <span className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-900/60 bg-emerald-950/40 px-2.5 py-1 text-[11px] text-emerald-300">
            <ShieldCheck className="size-3" />
            private by design
          </span>
        </div>

        <Card className="overflow-hidden">
          <div className="grid grid-cols-2 gap-1 border-b border-zinc-800/70 bg-zinc-900/40 p-1.5">
            {(
              [
                { id: 'unlock', label: 'Unlock', icon: KeyRound },
                { id: 'generate', label: 'New token', icon: Sparkles },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all',
                  tab === t.id
                    ? 'bg-zinc-800 text-zinc-100 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]'
                    : 'text-zinc-500 hover:text-zinc-300',
                )}
              >
                <t.icon className="size-3.5" />
                {t.label}
              </button>
            ))}
          </div>
          <CardContent className="p-5 sm:p-6">
            <AnimatePresence mode="wait" initial={false}>
              {tab === 'unlock' ? (
                <motion.div
                  key="unlock"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                >
                  <UnlockForm onSaved={onSaved} onGoGenerate={() => setTab('generate')} />
                </motion.div>
              ) : (
                <motion.div
                  key="generate"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                >
                  <GenerateForm onDone={() => setTab('unlock')} initialToken={null} />
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-zinc-600">
          No email or password resets. Your token + answer stay in this tab; lose both and your
          notes are unrecoverable.{' '}
          <a href="/welcome" className="text-accent-300 underline underline-offset-2">
            Learn more
          </a>
        </p>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unlock: token → fetch question → answer (+ one-time hint) → open workspace.
// The answer is kept in memory only and must be re-typed after every reload.
// ---------------------------------------------------------------------------

function UnlockForm({
  onSaved,
  onGoGenerate,
}: {
  onSaved: (token: string) => void;
  onGoGenerate: () => void;
}) {
  const [token, setTokenValue] = useState(() => getToken() ?? '');
  const [showToken, setShowToken] = useState(false);
  const [question, setQuestion] = useState<string | null>(null);
  const [hintAvailable, setHintAvailable] = useState(true);
  const [answer, setAnswerValue] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [showAnswer, setShowAnswer] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [hintLoading, setHintLoading] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  async function handleFetchQuestion(event?: FormEvent) {
    event?.preventDefault();
    const clean = token.trim();
    if (!clean) {
      toast.error('Paste your access token first');
      return;
    }
    setFetching(true);
    setQuestion(null);
    setHint(null);
    try {
      const res = await fetchQuestion(clean, getSessionId());
      setQuestion(res.question);
      setHintAvailable(res.hint_available);
    } catch (err) {
      setQuestion(null);
      toast.error(err instanceof Error ? err.message : 'Token not recognized');
    } finally {
      setFetching(false);
    }
  }

  async function handleHint() {
    const clean = token.trim();
    if (!clean) return;
    setHintLoading(true);
    try {
      const res = await fetchHint(clean, getSessionId());
      setHint(res.hint);
      setHintAvailable(false);
      if (!res.hint) {
        toast.info('No hint was set for this token — give your answer a try');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reveal the hint');
      if (err instanceof Error && err.message.includes('already shown')) {
        setHintAvailable(false);
      }
    } finally {
      setHintLoading(false);
    }
  }

  async function handleUnlock(event: FormEvent) {
    event.preventDefault();
    const cleanToken = token.trim();
    if (!cleanToken) {
      toast.error('Paste your access token first');
      return;
    }
    if (recoveryMode ? !recoveryCode.trim() : !answer) {
      toast.error(recoveryMode ? 'Enter your recovery code' : 'Type your security answer');
      return;
    }
    setUnlocking(true);
    try {
      await createSession(
        cleanToken,
        recoveryMode ? '' : answer,
        recoveryMode ? recoveryCode.trim() : undefined,
      );
      setToken(cleanToken);
      setAnswer(recoveryMode ? '' : answer);
      setSessionActive(true);
      onSaved(cleanToken);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not unlock workspace');
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[15px] font-semibold text-zinc-100">Welcome back</h1>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
          Your token unlocks the workspace — your answer or recovery code opens the door.
        </p>
      </div>

      <form onSubmit={handleFetchQuestion} className="flex flex-col gap-2">
        <label className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
          Access token
        </label>
        <div className="relative">
          <Input
            type={showToken ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder="ntk_…"
            value={token}
            onChange={(e) => {
              setTokenValue(e.target.value);
              setQuestion(null);
              setHint(null);
            }}
            aria-label="Access token"
            className="pr-10 font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => setShowToken((v) => !v)}
            aria-label={showToken ? 'Hide token' : 'Show token'}
            className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded p-1 text-zinc-500 hover:text-zinc-200"
          >
            {showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </div>
        <Button type="submit" variant="secondary" disabled={fetching}>
          {fetching ? <Loader2 className="animate-spin" /> : <KeyRound />}
          {fetching ? 'Finding your question…' : 'Fetch my question'}
        </Button>
        <button
          type="button"
          onClick={() => setRecoveryMode(true)}
          className="self-start text-xs text-accent-300 underline underline-offset-2"
        >
          I have a recovery code
        </button>
      </form>

      {recoveryMode && !question && (
        <form
          onSubmit={handleUnlock}
          className="flex flex-col gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5"
        >
          <div>
            <label
              htmlFor="recovery-code-direct"
              className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase"
            >
              Recovery code
            </label>
            <Input
              id="recovery-code-direct"
              autoComplete="one-time-code"
              placeholder="rec_…"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              className="mt-1"
            />
          </div>
          <Button type="submit" variant="accent" disabled={unlocking || !recoveryCode.trim()}>
            {unlocking ? <Loader2 className="animate-spin" /> : <BadgeCheck />}
            {unlocking ? 'Unlocking…' : 'Unlock with recovery code'}
          </Button>
        </form>
      )}

      {question && (
        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleUnlock}
          className="flex flex-col gap-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5"
        >
          <div>
            <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
              Your security question
            </p>
            <p className="mt-1 text-[13px] font-medium text-zinc-100">“{question}”</p>
          </div>
          {recoveryMode ? (
            <div>
              <label
                htmlFor="recovery-code"
                className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase"
              >
                Recovery code
              </label>
              <Input
                id="recovery-code"
                autoComplete="one-time-code"
                spellCheck={false}
                placeholder="rec_…"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                className="mt-1"
              />
            </div>
          ) : (
            <div className="relative">
              <Input
                type={showAnswer ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                placeholder="Your answer (case doesn’t matter)"
                value={answer}
                onChange={(e) => setAnswerValue(e.target.value)}
                aria-label="Security answer"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowAnswer((v) => !v)}
                aria-label={showAnswer ? 'Hide answer' : 'Show answer'}
                className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded p-1 text-zinc-500 hover:text-zinc-200"
              >
                {showAnswer ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setRecoveryMode((value) => !value)}
            className="self-start text-xs text-accent-300 underline underline-offset-2"
          >
            {recoveryMode ? 'Use security answer instead' : 'Use recovery code instead'}
          </button>

          {hint === null ? (
            <button
              type="button"
              onClick={() => void handleHint()}
              disabled={!hintAvailable || hintLoading}
              className="flex cursor-pointer items-center gap-1.5 self-start text-xs text-amber-300/90 transition-colors hover:text-amber-200 disabled:cursor-default disabled:opacity-40"
            >
              {hintLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Lightbulb className="size-3.5" />
              )}
              {hintAvailable
                ? 'Forgot? Show hint — once per session'
                : 'Hint already shown this session'}
            </button>
          ) : (
            <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
              {hint ? (
                <>
                  <span className="font-semibold">Hint: </span>
                  {hint}
                </>
              ) : (
                'No hint was saved for this token — trust your memory and try your answer.'
              )}
              <span className="mt-1 block font-mono text-[10px] text-amber-200/50">
                shown once — reload for another look
              </span>
            </div>
          )}

          <Button
            type="submit"
            variant="accent"
            disabled={unlocking || (recoveryMode ? !recoveryCode.trim() : !answer)}
          >
            {unlocking ? <Loader2 className="animate-spin" /> : <BadgeCheck />}
            {unlocking ? 'Unlocking…' : 'Unlock workspace'}
          </Button>
          <p className="text-center font-mono text-[10px] text-zinc-600">
            {recoveryMode
              ? 'Recovery code stays in this tab’s memory only'
              : 'answer stays in this tab’s memory only — never saved'}
          </p>
        </motion.form>
      )}

      <p className="text-center text-xs text-zinc-600">
        No token yet?{' '}
        <button
          onClick={onGoGenerate}
          className="cursor-pointer font-medium text-zinc-300 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-100"
        >
          Create one in seconds
        </button>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generate: label + question + answer + hint + human-check → one-time token.
// ---------------------------------------------------------------------------

function GenerateForm({
  onDone,
  initialToken,
}: {
  onDone: (token: string) => void;
  initialToken: string | null;
}) {
  const [label, setLabel] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [hint, setHint] = useState('');
  // Two calm steps: 1) question + answer, 2) optional details + human-check.
  const [step, setStep] = useState<1 | 2>(1);
  // Human-check proof (tile puzzle or Turnstile) — owned by HumanCheck.
  const [check, setCheck] = useState<HumanCheckValue | null>(null);
  // Bumped after a failed attempt so HumanCheck loads a fresh challenge.
  const [checkResetKey, setCheckResetKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{
    token: string;
    recoveryCode: string;
    question: string;
  } | null>(initialToken ? { token: initialToken, recoveryCode: '', question: '' } : null);
  const [copied, setCopied] = useState(false);
  const [recoveryCopied, setRecoveryCopied] = useState(false);
  const [savedAck, setSavedAck] = useState(false);

  function handleStepOne(event: FormEvent) {
    event.preventDefault();
    if (question.trim().length < 4 || question.trim().length > 140) {
      toast.error('Question must be 4–140 characters');
      return;
    }
    if (answer.trim().length < 2 || answer.trim().length > 100) {
      toast.error('Answer must be 2–100 characters');
      return;
    }
    setStep(2);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (question.trim().length < 4 || question.trim().length > 140) {
      toast.error('Question must be 4–140 characters');
      return;
    }
    if (answer.trim().length < 2 || answer.trim().length > 100) {
      toast.error('Answer must be 2–100 characters');
      return;
    }
    if (hint.trim().length > 200) {
      toast.error('Hint must be 0–200 characters');
      return;
    }
    if (label.trim().length > 40) {
      toast.error('Nickname must be 0–40 characters');
      return;
    }
    if (!check?.challenge && !check?.turnstileToken) {
      toast.error('Complete the human-check first');
      return;
    }

    setCreating(true);
    try {
      const res = await mintToken({
        label: label.trim() || undefined,
        question: question.trim(),
        answer: answer.trim(),
        hint: hint.trim() || undefined,
        challenge: check.challenge,
        turnstileToken: check.turnstileToken,
      });
      // The form answer is wiped immediately — it is never stored.
      setAnswer('');
      setResult({
        token: res.token_plaintext,
        recoveryCode: res.recovery_code,
        question: res.question,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('Human-check')) {
        // Fresh check for the retry: HumanCheck reloads tiles or remounts
        // the Turnstile widget (a spent token can't be reused).
        setCheck(null);
        setCheckResetKey((k) => k + 1);
        toast.error(err instanceof Error ? err.message : 'Could not create token');
      } else if (err instanceof ApiError && err.status === 503) {
        // Sleeping database, not a form/check problem: your inputs are kept,
        // only the human-check is refreshed (its token may be spent).
        setCheck(null);
        setCheckResetKey((k) => k + 1);
        toast.error('Database is waking up — wait ~30 seconds, then retry', {
          duration: 8000,
        });
      } else {
        toast.error(err instanceof Error ? err.message : 'Could not create token');
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed — select the token manually');
    }
  }

  async function handleCopyRecovery() {
    if (!result?.recoveryCode) return;
    try {
      await navigator.clipboard.writeText(result.recoveryCode);
      setRecoveryCopied(true);
      setTimeout(() => setRecoveryCopied(false), 2000);
    } catch {
      toast.error('Copy failed — select the recovery code manually');
    }
  }

  if (result) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-900/60 bg-emerald-950/40 text-emerald-300">
            <BadgeCheck className="size-5" />
          </span>
          <div>
            <h1 className="text-[15px] font-semibold text-zinc-100">Your token is ready</h1>
            <p className="text-xs text-zinc-500">Shown once — it will never appear again.</p>
          </div>
        </div>

        <div className="rounded-xl border border-accent-600/30 bg-accent-500/5 p-3.5">
          <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
            Access token — copy it now
          </p>
          <code className="mt-1.5 block font-mono text-[13px] break-all text-accent-200 select-all">
            {result.token}
          </code>
          <div className="mt-2.5 flex gap-2">
            <Button size="sm" variant="accent" onClick={() => void handleCopy()}>
              {copied ? <Check /> : <Copy />}
              {copied ? 'Copied' : 'Copy token'}
            </Button>
          </div>
        </div>

        {result.recoveryCode && (
          <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-3.5">
            <p className="font-mono text-[11px] tracking-[0.18em] text-emerald-300 uppercase">
              Recovery code — copy it now
            </p>
            <code className="mt-1.5 block font-mono text-[13px] break-all text-emerald-200 select-all">
              {result.recoveryCode}
            </code>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() => void handleCopyRecovery()}
            >
              {recoveryCopied ? <Check /> : <Copy />}
              {recoveryCopied ? 'Copied' : 'Copy recovery code'}
            </Button>
          </div>
        )}

        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5 text-xs leading-relaxed text-zinc-300">
          <input
            type="checkbox"
            checked={savedAck}
            onChange={(e) => setSavedAck(e.target.checked)}
            className="mt-0.5 size-4 accent-amber-400"
          />
          <span>
            I saved my token, recovery code, and answer somewhere safe. I understand they cannot be
            recovered or reset.
          </span>
        </label>

        <Button
          variant="secondary"
          disabled={!savedAck}
          onClick={() => {
            if (!result) return;
            setToken(result.token);
            onDone(result.token);
            toast.success('Token ready — unlock with your answer or recovery code');
          }}
        >
          I saved it — take me to Unlock
        </Button>
        <button
          onClick={() => {
            setResult(null);
            setSavedAck(false);
            setCopied(false);
            setRecoveryCopied(false);
            setQuestion('');
            setHint('');
            setLabel('');
            setStep(1);
            // Fresh human-check for the next token.
            setCheck(null);
            setCheckResetKey((k) => k + 1);
          }}
          className="cursor-pointer text-center text-xs text-zinc-600 hover:text-zinc-300"
        >
          Create another token
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-2" aria-label={`Step ${step} of 2`}>
          <StepDot label="Question" active={step === 1} done={step === 2} />
          <span className="h-px w-6 bg-zinc-800" aria-hidden="true" />
          <StepDot label="Details" active={step === 2} done={false} />
        </div>
        <h1 className="mt-3 text-[15px] font-semibold text-zinc-100">
          {step === 1 ? 'Choose your security question' : 'Almost there'}
        </h1>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
          {step === 1
            ? 'Your question and answer become the key to your notes. No email, no password resets.'
            : 'Optional details, then one human-check to finish.'}
        </p>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {step === 1 ? (
          <motion.form
            key="gen-step1"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            onSubmit={handleStepOne}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="token-question"
                className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase"
              >
                Security question
              </label>
              <Input
                id="token-question"
                placeholder="e.g. What street did I grow up on?"
                value={question}
                maxLength={140}
                onChange={(e) => setQuestion(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="token-answer"
                className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase"
              >
                Answer <span className="text-zinc-700 normal-case">(case doesn’t matter)</span>
              </label>
              <Input
                id="token-answer"
                type="password"
                placeholder="Something only you know"
                value={answer}
                maxLength={100}
                onChange={(e) => setAnswer(e.target.value)}
                autoComplete="off"
              />
            </div>

            <Button type="submit" variant="accent">
              Continue
              <ArrowRight />
            </Button>
          </motion.form>
        ) : (
          <motion.form
            key="gen-step2"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            onSubmit={(e) => void handleCreate(e)}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="token-label"
                className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase"
              >
                Nickname <span className="text-zinc-700 normal-case">(optional)</span>
              </label>
              <Input
                id="token-label"
                placeholder="e.g. laptop"
                value={label}
                maxLength={40}
                onChange={(e) => setLabel(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="token-hint"
                className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase"
              >
                Hint{' '}
                <span className="text-zinc-700 normal-case">
                  (optional, shown once per session)
                </span>
              </label>
              <Input
                id="token-hint"
                placeholder="e.g. the one with the blue door"
                value={hint}
                maxLength={200}
                onChange={(e) => setHint(e.target.value)}
                autoComplete="off"
              />
            </div>

            <HumanCheck onValue={setCheck} resetKey={checkResetKey} />

            <Button
              type="submit"
              variant="accent"
              disabled={creating || (!check?.challenge && !check?.turnstileToken)}
            >
              {creating ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {creating ? 'Creating…' : 'Create my token'}
            </Button>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="cursor-pointer text-center text-xs text-zinc-600 hover:text-zinc-300"
            >
              Back to question
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepDot({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 text-[11px] transition-colors duration-200',
        active ? 'text-accent-300' : done ? 'text-zinc-400' : 'text-zinc-600',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full transition-colors duration-200',
          active ? 'bg-accent-400' : done ? 'bg-zinc-500' : 'bg-zinc-800',
        )}
      />
      {label}
    </span>
  );
}
