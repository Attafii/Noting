import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { ArrowRight, BadgeCheck, Loader2, SquareTerminal, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import { redeemInvite } from '../lib/api';
import { HumanCheck, type HumanCheckValue } from '../components/HumanCheck';
import { AmbientInk } from '../components/ambient/AmbientInk';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';

export const Route = createFileRoute('/invite')({
  component: InvitePage,
});

/**
 * Public invite redemption (/invite). Standalone by design: entering a valid
 * code simply marks it used and says so — it unlocks nothing and is never
 * required for creating a token (that flow is open to everyone).
 */
function InvitePage() {
  useEffect(() => {
    document.title = 'noting — Redeem invite';
  }, []);

  const [code, setCode] = useState('');
  const [check, setCheck] = useState<HumanCheckValue | null>(null);
  // Bumped after a failed attempt so HumanCheck loads a fresh challenge.
  const [checkResetKey, setCheckResetKey] = useState(0);
  const [redeeming, setRedeeming] = useState(false);
  const [redeemed, setRedeemed] = useState(false);
  const navigate = useNavigate();

  async function handleRedeem(event: FormEvent) {
    event.preventDefault();
    const clean = code.trim();
    if (clean.length < 8) {
      toast.error('Enter the invite code you were given');
      return;
    }
    if (!check?.challenge && !check?.turnstileToken) {
      toast.error('Complete the human-check first');
      return;
    }
    setRedeeming(true);
    try {
      await redeemInvite({
        invite_code: clean,
        challenge: check.challenge,
        turnstileToken: check.turnstileToken,
      });
      setCode('');
      setRedeemed(true);
    } catch (err) {
      // Invalid/expired codes and spent nonces both land here — reset the
      // check so the next attempt starts fresh.
      setCheck(null);
      setCheckResetKey((k) => k + 1);
      toast.error(err instanceof Error ? err.message : 'Could not redeem this invite');
    } finally {
      setRedeeming(false);
    }
  }

  return (
    // `isolate` — see welcome.tsx: keeps the -z-10 shader above the root
    // wrapper's opaque background.
    <div className="grain relative isolate flex min-h-[78vh] items-center justify-center px-4 py-10">
      <Suspense fallback={null}>
        <AmbientInk />
      </Suspense>
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md"
      >
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700/70 bg-zinc-900/80 text-zinc-300">
            <SquareTerminal className="size-4" />
          </span>
          <span className="flex items-center gap-2 font-mono text-xs tracking-[0.22em] text-zinc-300 uppercase">
            <span className="ember-dot size-1.5" aria-hidden />
            notes
          </span>
          <span className="ml-auto flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 px-2.5 py-1 text-[11px] text-zinc-400">
            <Ticket className="size-3" />
            invite
          </span>
        </div>

        <Card className="overflow-hidden">
          <CardContent className="p-5 sm:p-6">
            {redeemed ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col items-center gap-4 text-center"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-900/60 bg-emerald-950/40 text-emerald-300">
                  <BadgeCheck className="size-6" />
                </span>
                <div>
                  <h1 className="font-display text-[17px] font-medium text-zinc-100">
                    Invite redeemed
                  </h1>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                    This code has been marked as used. You can head into the app whenever you’re
                    ready.
                  </p>
                </div>
                <Button variant="accent" onClick={() => void navigate({ to: '/' })}>
                  Open the app <ArrowRight />
                </Button>
              </motion.div>
            ) : (
              <form onSubmit={(e) => void handleRedeem(e)} className="flex flex-col gap-4">
                <div>
                  <h1 className="font-display text-[17px] font-medium text-zinc-100">
                    Redeem an invite
                  </h1>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                    Enter the code you were given. Redeeming marks it as used — it doesn’t create or
                    unlock a token.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="invite-code"
                    className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase"
                  >
                    Invite code
                  </label>
                  <Input
                    id="invite-code"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="inv_…"
                    value={code}
                    maxLength={200}
                    onChange={(e) => setCode(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>

                <HumanCheck onValue={setCheck} resetKey={checkResetKey} />

                <Button
                  type="submit"
                  variant="accent"
                  disabled={
                    redeeming ||
                    code.trim().length < 8 ||
                    (!check?.challenge && !check?.turnstileToken)
                  }
                >
                  {redeeming ? <Loader2 className="animate-spin" /> : <Ticket />}
                  {redeeming ? 'Redeeming…' : 'Redeem invite'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-zinc-600">
          Creating a token doesn’t need an invite —{' '}
          <Link to="/" className="text-accent-300 underline underline-offset-2">
            open the app
          </Link>{' '}
          and choose “New token”.
        </p>
      </motion.div>
    </div>
  );
}
