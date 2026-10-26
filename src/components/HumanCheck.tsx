import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { fetchChallenge, type Challenge, type ChallengeSolution } from '../lib/api';
import { cn } from '../lib/utils';

// ---------------------------------------------------------------------------
// Shared human-check widget (tile puzzle primary, Cloudflare Turnstile
// fallback). Extracted from the token generator so every public form —
// token mint and invite redemption — runs the identical check stack.
//
// The component owns ALL check state (challenge fetch, tile selection,
// timing/interaction signals, honeypot, Turnstile opt-in after repeated
// failures) and reports the finished proof upward. Parents enable their
// submit button when a value is present and spread it into their request.
// ---------------------------------------------------------------------------

/** What the form must send with its request to pass the human-check. */
export interface HumanCheckValue {
  /** Built-in tile-puzzle solution (primary path). */
  challenge?: ChallengeSolution;
  /** Cloudflare Turnstile token (fallback path only). */
  turnstileToken?: string;
}

interface HumanCheckProps {
  /** Receives the current proof, or null while the check is unsolved/reset. */
  onValue: (value: HumanCheckValue | null) => void;
  /**
   * Bump after a failed submit to discard the current check (its nonce may
   * already be spent) and load a fresh one.
   */
  resetKey?: number;
}

export function HumanCheck({ onValue, resetKey = 0 }: HumanCheckProps) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [challengeLoading, setChallengeLoading] = useState(false);
  const [challengeFailed, setChallengeFailed] = useState(false);
  // Shown after repeated resets — invites the Turnstile escape hatch.
  const [failCount, setFailCount] = useState(0);
  // Cloudflare-first: when the sitekey is configured the Turnstile widget is
  // the primary human-check (the tile puzzle stays as fallback). Starting in
  // Turnstile mode also means a broken /api/challenge can no longer block
  // the form — no challenge is fetched until the user opts back.
  const [useTurnstile, setUseTurnstile] = useState<boolean>(
    () => Boolean(import.meta.env.VITE_TURNSTILE_SITEKEY) === true,
  );
  // Bumped to remount the widget (fresh token) after a failed/used attempt.
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Timing + interaction signals for the human-check (measured from render).
  const issuedAtRef = useRef(0);
  const interactionsRef = useRef(0);
  // Keep the latest callback without re-triggering the load effect.
  const onValueRef = useRef(onValue);
  useEffect(() => {
    onValueRef.current = onValue;
  }, [onValue]);

  const loadChallenge = useCallback(async () => {
    setChallengeLoading(true);
    try {
      const ch = await fetchChallenge();
      const ok = Array.isArray(ch.tiles) && ch.tiles.length > 0;
      setChallenge(ok ? ch : null);
      setChallengeFailed(!ok);
      setSelected(null);
      onValueRef.current(null);
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
    // Only fetch the tile puzzle when it is actually shown. In Turnstile
    // mode no /api/challenge request fires at all.
    if (useTurnstile) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadChallenge();
  }, [loadChallenge, useTurnstile]);

  // Reset the check when the caller bumps resetKey (fresh attempt). The
  // bumped count drives the "alternative check" escape hatch below. Guarded
  // by the last-handled key so mode toggles ("Back to the tile puzzle") don't
  // re-run the reset and double-fetch a challenge.
  const lastResetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (resetKey === lastResetKeyRef.current) return;
    lastResetKeyRef.current = resetKey;
    /* eslint-disable react-hooks/set-state-in-effect */
    // Intentional prop-driven reset (same pattern as the load effect above).
    setFailCount((count) => count + 1);
    setSelected(null);
    setTurnstileToken(null);
    onValueRef.current(null);
    if (useTurnstile) setTurnstileKey((k) => k + 1);
    else void loadChallenge();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [resetKey, useTurnstile, loadChallenge]);

  // Report the Turnstile proof upward (the tile path reports on tap).
  useEffect(() => {
    if (!useTurnstile) return;
    onValueRef.current(turnstileToken ? { turnstileToken } : null);
  }, [useTurnstile, turnstileToken]);

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
          {useTurnstile ? 'Human-check' : 'Tile puzzle (fallback)'}
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
            key={turnstileKey}
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
                  onValueRef.current({
                    challenge: {
                      nonce: challenge.nonce,
                      expires_at: challenge.expires_at,
                      sig: challenge.sig,
                      selected: i,
                      elapsed_ms: Date.now() - issuedAtRef.current,
                      honeypot: '',
                      interactions: interactionsRef.current,
                    },
                  });
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
  );
}

// ---------------------------------------------------------------------------
// Turnstile widget (Cloudflare, free Managed mode). Primary human-check when
// VITE_TURNSTILE_SITEKEY is configured — the script is injected only when
// the widget mounts, and the tile puzzle remains as fallback.
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
          'error-callback'?: (code?: string | number) => void;
        },
      ) => string;
      reset?: (widgetId?: string) => void;
      remove?: (widgetId?: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script';
// render=explicit: the widget is always rendered manually via
// turnstile.render(). This stops api.js from auto-scanning the DOM, which
// caused "Turnstile skipped implicit render because a widget already exists"
// when the explicit render raced the implicit one.
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadTurnstileScript(): Promise<void> {
  if (typeof document === 'undefined') return Promise.reject(new Error('No document'));
  if (window.turnstile) return Promise.resolve();
  const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    // Script tag from an earlier mount that already finished loading — the
    // load event below would never fire again, so resolve immediately.
    if (existing.dataset.loaded === '1') return Promise.resolve();
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
    script.onload = () => {
      script.dataset.loaded = '1';
      resolve();
    };
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
  // Cloudflare passes an error code (e.g. hostname failures after a domain
  // move). Kept verbatim so the message below can name the likely cause.
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!sitekey) return;
    let cancelled = false;
    let widgetId: string | undefined;
    const container = containerRef.current;
    void loadTurnstileScript()
      .then(() => {
        if (cancelled || !container || !window.turnstile) return;
        // StrictMode double-mounts effects: the first mount's widget may
        // still own this container. Tear it down first so render() never
        // no-ops into a blank box.
        try {
          if (widgetId !== undefined) window.turnstile.remove?.(widgetId);
        } catch {
          /* ignore */
        }
        // Belt and braces: if an iframe survived cleanup (stale remount),
        // drop it before the explicit render.
        if (container.querySelector('iframe')) container.replaceChildren();
        else container.innerHTML = '';
        widgetId = window.turnstile.render(container, {
          sitekey,
          theme: 'dark',
          callback: (token: string) => {
            if (!cancelled) onVerify(token);
          },
          'expired-callback': () => {
            if (!cancelled) onExpire();
          },
          'error-callback': (code?: string | number) => {
            if (cancelled) return;
            setErrorCode(code === undefined || code === null ? null : String(code));
            setFailed(true);
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
      // Leave a clean container so the next mount renders fresh instead of
      // hitting "a widget already exists in this container".
      try {
        container?.replaceChildren();
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
    const code = (errorCode ?? '').toLowerCase();
    const looksLikeHostname =
      code.includes('hostname') || code.includes('110200') || code.includes('200100');
    return (
      <div className="mt-1.5 rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
        {looksLikeHostname ? (
          <>
            This domain isn’t allowed for the Turnstile widget — add{' '}
            <code className="font-mono">{window.location.hostname}</code> under Cloudflare dashboard
            → Turnstile → widget → Settings → Allowed hostnames, and include it in{' '}
            <code className="font-mono">TURNSTILE_ALLOWED_HOSTNAMES</code>, then redeploy. The tile
            puzzle below still works.
          </>
        ) : (
          <>
            Couldn’t load the alternative check
            {errorCode ? (
              <>
                {' '}
                (code <code className="font-mono">{errorCode}</code>)
              </>
            ) : null}{' '}
            — check your connection and try the tile puzzle.
          </>
        )}
      </div>
    );
  }
  // NOTE: the container deliberately does NOT use the `cf-turnstile` CSS
  // class — api.js auto-renders those implicitly, which raced our explicit
  // render() and produced blank widgets.
  return <div ref={containerRef} className="turnstile-slot mt-2 min-h-16" />;
}
