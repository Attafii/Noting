import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BadgeCheck,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lightbulb,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchChallenge,
  fetchHint,
  fetchQuestion,
  mintToken,
  type Challenge,
  type ChallengeSolution,
} from '../lib/api';
import { getSessionId, getToken, setAnswer, setToken } from '../lib/token';
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
                  transition={{ duration: 0.2 }}
                >
                  <UnlockForm onSaved={onSaved} onGoGenerate={() => setTab('generate')} />
                </motion.div>
              ) : (
                <motion.div
                  key="generate"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <GenerateForm onDone={() => setTab('unlock')} initialToken={null} />
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-zinc-600">
          No email, no tracking, no password resets. Your token + answer never leave this browser
          except to unlock — lose both and your notes are unrecoverable.
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

  function handleUnlock(event: FormEvent) {
    event.preventDefault();
    const cleanToken = token.trim();
    if (!cleanToken) {
      toast.error('Paste your access token first');
      return;
    }
    if (!answer) {
      toast.error('Type your security answer');
      return;
    }
    setUnlocking(true);
    // Persist the token for convenience, keep the answer in memory only.
    setToken(cleanToken);
    setAnswer(answer);
    // Let the workspace verify (wrong answers bounce back to this gate).
    setTimeout(() => {
      onSaved(cleanToken);
      setUnlocking(false);
    }, 60);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[15px] font-semibold text-zinc-100">Welcome back</h1>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
          Your token unlocks the prompt — your answer opens the door. Both are required, every
          visit.
        </p>
      </div>

      <form onSubmit={handleFetchQuestion} className="flex flex-col gap-2">
        <label className="font-mono text-[11px] tracking-[0.14em] text-zinc-500 uppercase">
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
      </form>

      {question && (
        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleUnlock}
          className="flex flex-col gap-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5"
        >
          <div>
            <p className="font-mono text-[11px] tracking-[0.14em] text-zinc-500 uppercase">
              Your security question
            </p>
            <p className="mt-1 text-[13px] font-medium text-zinc-100">“{question}”</p>
          </div>
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

          <Button type="submit" variant="accent" disabled={unlocking || !answer}>
            {unlocking ? <Loader2 className="animate-spin" /> : <BadgeCheck />}
            {unlocking ? 'Unlocking…' : 'Unlock workspace'}
          </Button>
          <p className="text-center font-mono text-[10px] text-zinc-600">
            answer stays in this tab’s memory only — never saved
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
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [challengeLoading, setChallengeLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [challengeFailed, setChallengeFailed] = useState(false);
  const [failCount, setFailCount] = useState(0);
  const [useTurnstile, setUseTurnstile] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [result, setResult] = useState<{ token: string; question: string } | null>(
    initialToken ? { token: initialToken, question: '' } : null,
  );
  const [copied, setCopied] = useState(false);
  const [savedAck, setSavedAck] = useState(false);
  // Timing + interaction signals for the human-check (measured from render).
  const issuedAtRef = useRef(0);
  const interactionsRef = useRef(0);

  const loadChallenge = useCallback(async () => {
    setChallengeLoading(true);
    try {
      const ch = await fetchChallenge();
      setChallenge(Array.isArray(ch.tiles) && ch.tiles.length > 0 ? ch : null);
      if (!Array.isArray(ch.tiles) || ch.tiles.length === 0) {
        setChallengeFailed(true);
      } else {
        setChallengeFailed(false);
      }
      setSelected(null);
      interactionsRef.current = 0;
      issuedAtRef.current = Date.now();
    } catch (e) {
      setChallenge(null);
      setChallengeFailed(true);
      toast.error(
        e instanceof Error ? e.message : 'Could not load the human-check — retry in a moment',
      );
    } finally {
      setChallengeLoading(false);
    }
  }, []);

  useEffect(() => {
    // One-time initial fetch of the human-check (user can refresh manually).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadChallenge();
  }, [loadChallenge]);

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

    let solution: ChallengeSolution | undefined;
    let fallbackToken: string | undefined;
    if (useTurnstile) {
      if (!turnstileToken) {
        toast.error('Complete the alternative check first');
        return;
      }
      fallbackToken = turnstileToken;
    } else {
      if (!challenge || selected === null) {
        toast.error(challenge ? 'Tap the odd tile first' : 'Wait for the human-check to load');
        return;
      }
      solution = {
        nonce: challenge.nonce,
        expires_at: challenge.expires_at,
        sig: challenge.sig,
        selected,
        elapsed_ms: Date.now() - issuedAtRef.current,
        honeypot: '',
        interactions: interactionsRef.current,
      };
    }

    setCreating(true);
    try {
      const res = await mintToken({
        label: label.trim() || undefined,
        question: question.trim(),
        answer: answer.trim(),
        hint: hint.trim() || undefined,
        challenge: solution,
        turnstileToken: fallbackToken,
      });
      // The form answer is wiped immediately — it is never stored.
      setAnswer('');
      setSelected(null);
      setTurnstileToken(null);
      setFailCount(0);
      setResult({ token: res.token_plaintext, question: res.question });
    } catch (err) {
      if (err instanceof Error && err.message.includes('Human-check')) {
        const next = failCount + 1;
        setFailCount(next);
        setSelected(null);
        setTurnstileToken(null);
        if (!useTurnstile) await loadChallenge();
      }
      toast.error(err instanceof Error ? err.message : 'Could not create token');
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
          <p className="font-mono text-[11px] tracking-[0.14em] text-zinc-500 uppercase">
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

        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5 text-xs leading-relaxed text-zinc-300">
          <input
            type="checkbox"
            checked={savedAck}
            onChange={(e) => setSavedAck(e.target.checked)}
            className="mt-0.5 size-4 accent-amber-400"
          />
          <span>
            I saved my token <span className="text-zinc-100">and</span> my answer somewhere safe. I
            understand both are required on every visit and neither can be recovered.
          </span>
        </label>

        <Button
          variant="secondary"
          disabled={!savedAck}
          onClick={() => {
            if (!result) return;
            setToken(result.token);
            onDone(result.token);
            toast.success('Token saved in this browser — now unlock with your answer');
          }}
        >
          I saved it — take me to Unlock
        </Button>
        <button
          onClick={() => {
            setResult(null);
            setSavedAck(false);
            setCopied(false);
            setQuestion('');
            setHint('');
            setLabel('');
            setSelected(null);
            setFailCount(0);
            setUseTurnstile(false);
            setTurnstileToken(null);
            void loadChallenge();
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
        <h1 className="text-[15px] font-semibold text-zinc-100">Create your personal token</h1>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
          Self-service, no email. Your question + answer become the second key to your notes.
        </p>
      </div>

      <form onSubmit={(e) => void handleCreate(e)} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[11px] tracking-[0.14em] text-zinc-500 uppercase">
            Nickname <span className="text-zinc-700 normal-case">(optional)</span>
          </label>
          <Input
            placeholder="e.g. laptop"
            value={label}
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[11px] tracking-[0.14em] text-zinc-500 uppercase">
            Security question
          </label>
          <Input
            placeholder="e.g. What street did I grow up on?"
            value={question}
            maxLength={140}
            onChange={(e) => setQuestion(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[11px] tracking-[0.14em] text-zinc-500 uppercase">
            Answer <span className="text-zinc-700 normal-case">(case doesn’t matter)</span>
          </label>
          <Input
            type="password"
            placeholder="Something only you know"
            value={answer}
            maxLength={100}
            onChange={(e) => setAnswer(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[11px] tracking-[0.14em] text-zinc-500 uppercase">
            Hint{' '}
            <span className="text-zinc-700 normal-case">(optional, shown once per session)</span>
          </label>
          <Input
            placeholder="e.g. the one with the blue door"
            value={hint}
            maxLength={200}
            onChange={(e) => setHint(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-3.5 py-3">
          <div className="flex items-center gap-2">
            <p className="font-mono text-[11px] tracking-[0.14em] text-zinc-500 uppercase">
              {useTurnstile ? 'Alternative check' : 'Quick human-check'}
            </p>
            {!useTurnstile && (
              <button
                type="button"
                onClick={() => void loadChallenge()}
                disabled={challengeLoading}
                aria-label="New challenge"
                title="New challenge"
                className="ml-auto cursor-pointer rounded-lg border border-zinc-800 p-2 text-zinc-500 transition-colors hover:text-zinc-200 disabled:opacity-40"
              >
                <RefreshCw className={cn('size-3.5', challengeLoading && 'animate-spin')} />
              </button>
            )}
          </div>

          {useTurnstile ? (
            <div className="mt-2">
              <TurnstileWidget
                onVerify={setTurnstileToken}
                onExpire={() => setTurnstileToken(null)}
              />
              <button
                type="button"
                onClick={() => {
                  setUseTurnstile(false);
                  setTurnstileToken(null);
                  void loadChallenge();
                }}
                className="mt-2 cursor-pointer text-xs text-zinc-500 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-300"
              >
                Back to the tile puzzle
              </button>
            </div>
          ) : challenge ? (
            <>
              <p className="mt-1 text-[13px] font-medium text-zinc-200">
                {challenge.instruction || challenge.question || 'Tap the odd one out'}
              </p>
              <div
                role="group"
                aria-label={challenge.instruction || 'Human-check: tap the odd tile'}
                className="mt-2.5 grid grid-cols-3 gap-2"
                onPointerMove={() => {
                  interactionsRef.current += 1;
                }}
              >
                {challenge.tiles.map((tile, i) => (
                  <button
                    key={`${challenge.nonce}-${i}`}
                    type="button"
                    onClick={() => {
                      interactionsRef.current += 1;
                      setSelected(i);
                    }}
                    onKeyDown={() => {
                      interactionsRef.current += 1;
                    }}
                    aria-label={`Tile ${i + 1}: ${tile.label}`}
                    aria-pressed={selected === i}
                    className={cn(
                      'flex cursor-pointer items-center justify-center rounded-lg border py-3 text-2xl transition-all',
                      selected === i
                        ? 'border-accent-500/70 bg-accent-500/10 shadow-[0_0_0_1px_rgb(255_255_255/0.06)]'
                        : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-600 hover:bg-zinc-900',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      style={tile.r ? { transform: `rotate(${tile.r}deg)` } : undefined}
                    >
                      {tile.g}
                    </span>
                  </button>
                ))}
              </div>
              {/* Honeypot: invisible to humans, irresistible to autofill bots. */}
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                placeholder="Leave this empty"
                className="pointer-events-none absolute h-px w-px opacity-0"
                onChange={() => undefined}
                value=""
              />
              {(challengeFailed || failCount >= 2) && (
                <button
                  type="button"
                  onClick={() => setUseTurnstile(true)}
                  className="mt-2 cursor-pointer text-xs text-zinc-500 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-300"
                >
                  Having trouble? Use the alternative check
                </button>
              )}
            </>
          ) : (
            <div className="mt-1.5">
              <p className="text-xs text-zinc-600">
                {challengeLoading ? 'loading…' : 'Could not load the human-check.'}
              </p>
              {!challengeLoading && (
                <div className="mt-2 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void loadChallenge()}
                    className="cursor-pointer text-xs text-zinc-300 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-100"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseTurnstile(true)}
                    className="cursor-pointer text-xs text-zinc-300 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-100"
                  >
                    Use the alternative check
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <Button type="submit" variant="accent" disabled={creating || (!useTurnstile && !challenge)}>
          {creating ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {creating ? 'Creating…' : 'Create my token'}
        </Button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Turnstile fallback widget (Cloudflare, free Managed mode). The script is
// injected ONLY when the user opts into the alternative check — the happy
// path loads zero third-party code.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        params: {
          sitekey: string;
          theme?: 'light' | 'dark' | 'auto';
          callback?: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
        },
      ) => string;
      reset?: (widgetId?: string) => void;
      remove?: (widgetId?: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script';
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

function loadTurnstileScript(): Promise<void> {
  if (typeof document === 'undefined') return Promise.reject(new Error('No document'));
  if (window.turnstile) return Promise.resolve();
  const existing = document.getElementById(TURNSTILE_SCRIPT_ID);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load check')), {
        once: true,
      });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load the alternative check'));
    document.head.appendChild(script);
  });
}

function TurnstileWidget({
  onVerify,
  onExpire,
}: {
  onVerify: (token: string) => void;
  onExpire: () => void;
}) {
  const sitekey = import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined;
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!sitekey) return;
    let cancelled = false;
    let widgetId: string | undefined;
    void loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        containerRef.current.innerHTML = '';
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey,
          theme: 'dark',
          callback: (token: string) => {
            if (!cancelled) onVerify(token);
          },
          'expired-callback': () => {
            if (!cancelled) onExpire();
          },
          'error-callback': () => {
            if (!cancelled) setFailed(true);
          },
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      try {
        if (widgetId !== undefined) window.turnstile?.remove?.(widgetId);
      } catch {
        /* ignore cleanup errors */
      }
    };
    // onVerify/onExpire are stable setState wrappers — render once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitekey]);

  if (!sitekey) {
    return (
      <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
        The alternative check isn’t configured on this deployment (missing site key). Please use the
        tile puzzle instead.
      </p>
    );
  }
  if (failed) {
    return (
      <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
        Couldn’t load the alternative check — check your connection and try the tile puzzle.
      </p>
    );
  }
  return <div ref={containerRef} className="cf-turnstile mt-2 min-h-16" />;
}
