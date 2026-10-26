import { useEffect, useState, type FormEvent } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Lock,
  LockOpen,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminCreateInvite, adminListInvites, ApiError, type InviteInfo } from '../lib/api';
import { timeAgo } from '../lib/format';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';

export const Route = createFileRoute('/admin')({
  component: AdminPage,
});

const VALID_DAYS_OPTIONS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

/**
 * Admin invite console (/admin). Gated by the deployment's
 * GLOBAL_SECRET_TOKEN — the secret stays in this component's memory for the
 * tab's lifetime and is never persisted anywhere.
 */
function AdminPage() {
  useEffect(() => {
    document.title = 'noting — Invite admin';
  }, []);

  // Admin secret — memory only, cleared on unmount/lock.
  const [secret, setSecret] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [secretInput, setSecretInput] = useState('');
  const [validDays, setValidDays] = useState(30);
  const [creating, setCreating] = useState(false);
  const [freshCode, setFreshCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const invitesQuery = useQuery({
    queryKey: ['admin-invites', secret],
    queryFn: () => adminListInvites(secret),
    enabled: unlocked && secret.length > 0,
    retry: false,
  });

  async function handleUnlock(event: FormEvent) {
    event.preventDefault();
    const clean = secretInput.trim();
    if (!clean) {
      toast.error('Paste the admin secret first');
      return;
    }
    setUnlocking(true);
    try {
      await adminListInvites(clean);
      setSecret(clean);
      setUnlocked(true);
      setSecretInput('');
    } catch (err) {
      // adminListInvites maps the invisible-route 404 to a clear message.
      toast.error(err instanceof Error ? err.message : 'Could not verify the secret');
    } finally {
      setUnlocking(false);
    }
  }

  function handleLock() {
    setSecret('');
    setUnlocked(false);
    setFreshCode(null);
    void queryClient.removeQueries({ queryKey: ['admin-invites'] });
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      const res = await adminCreateInvite(secret, validDays);
      setFreshCode(res.code);
      await queryClient.invalidateQueries({ queryKey: ['admin-invites'] });
      toast.success('Invite created — copy the code now, it’s shown only once');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Secret rotated/revoked mid-session — back to the lock screen.
        handleLock();
        toast.error('Admin secret is no longer valid');
      } else {
        toast.error(err instanceof Error ? err.message : 'Could not create the invite');
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    if (!freshCode) return;
    try {
      await navigator.clipboard.writeText(freshCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed — select the code manually');
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center gap-3">
        <Link
          to="/"
          aria-label="Back to notes"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700/70 bg-zinc-900 text-zinc-300 transition-colors hover:bg-zinc-800"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-base font-semibold text-zinc-100">Invite admin</h1>
          <p className="font-mono text-[11px] text-zinc-500">create &amp; track invite codes</p>
        </div>
        {unlocked && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={handleLock}>
            <Lock /> Lock
          </Button>
        )}
      </div>

      {!unlocked ? (
        <Card>
          <CardContent className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700/70 bg-zinc-900 text-zinc-300">
                <Lock className="size-4" />
              </span>
              <div>
                <p className="text-[13px] font-medium text-zinc-100">Admin secret required</p>
                <p className="text-[11px] leading-relaxed text-zinc-500">
                  Paste your deployment&apos;s{' '}
                  <span className="font-mono">GLOBAL_SECRET_TOKEN</span>. It stays in this
                  tab&apos;s memory only.
                </p>
              </div>
            </div>
            <form onSubmit={(e) => void handleUnlock(e)} className="flex flex-col gap-2">
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Admin secret"
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                aria-label="Admin secret"
                className="font-mono text-xs"
              />
              <Button type="submit" variant="accent" disabled={unlocking || !secretInput.trim()}>
                {unlocking ? <Loader2 className="animate-spin" /> : <LockOpen />}
                {unlocking ? 'Verifying…' : 'Unlock'}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col gap-4"
        >
          <Card>
            <CardContent className="flex flex-col gap-4 p-5">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-900/60 bg-emerald-950/40 text-emerald-300">
                  <ShieldCheck className="size-4" />
                </span>
                <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
                  unlocked
                </p>
              </div>

              <form onSubmit={(e) => void handleCreate(e)} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <span className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
                    Valid for
                  </span>
                  <div className="flex gap-1.5">
                    {VALID_DAYS_OPTIONS.map((opt) => (
                      <button
                        key={opt.days}
                        type="button"
                        onClick={() => setValidDays(opt.days)}
                        aria-pressed={validDays === opt.days}
                        className={cn(
                          'cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                          validDays === opt.days
                            ? 'border-accent-600/60 bg-accent-500/10 text-zinc-100'
                            : 'border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Button type="submit" variant="accent" disabled={creating}>
                  {creating ? <Loader2 className="animate-spin" /> : <Plus />}
                  {creating ? 'Creating…' : 'Create invite code'}
                </Button>
              </form>

              {freshCode && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="rounded-xl border border-accent-600/30 bg-accent-500/5 p-3.5"
                >
                  <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
                    Invite code — copy it now
                  </p>
                  <code className="mt-1.5 block font-mono text-[13px] break-all text-accent-200 select-all">
                    {freshCode}
                  </code>
                  <Button
                    size="sm"
                    variant="accent"
                    className="mt-2"
                    onClick={() => void handleCopy()}
                  >
                    {copied ? <Check /> : <Copy />}
                    {copied ? 'Copied' : 'Copy code'}
                  </Button>
                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
                    This is the only time the code appears — only its hash is stored. Share it with
                    whoever should redeem it at{' '}
                    <Link to="/invite" className="text-accent-300 underline underline-offset-2">
                      /invite
                    </Link>
                    .
                  </p>
                </motion.div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
                  Recent invites
                </h2>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={invitesQuery.isFetching}
                  onClick={() => void invitesQuery.refetch()}
                >
                  <RefreshCw className={cn(invitesQuery.isFetching && 'animate-spin')} />
                  Refresh
                </Button>
              </div>

              {invitesQuery.isPending && <p className="text-xs text-zinc-500">Loading…</p>}
              {invitesQuery.isError && (
                <p className="text-xs text-zinc-500">
                  {invitesQuery.error instanceof Error
                    ? invitesQuery.error.message
                    : 'Couldn’t load invites.'}
                </p>
              )}
              {invitesQuery.data &&
                (invitesQuery.data.invites.length === 0 ? (
                  <p className="text-xs text-zinc-600">
                    No invites yet — create the first one above.
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-zinc-800/70">
                    {invitesQuery.data.invites.map((invite) => (
                      <InviteRow key={String(invite.id)} invite={invite} />
                    ))}
                  </ul>
                ))}

              <p className="text-[11px] leading-relaxed text-zinc-600">
                Codes are single-use. Expired or used codes can’t be redeemed again; the daily
                retention cron removes invites older than a week past expiry.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

function InviteRow({ invite }: { invite: InviteInfo }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5 text-[13px] text-zinc-200">
          <KeyRound className="size-3.5 shrink-0 text-zinc-600" />
          <span className="font-mono text-[11px] text-zinc-400">#{String(invite.id)}</span>
        </span>
        <span className="mt-0.5 text-[11px] text-zinc-600">
          created {timeAgo(invite.created_at)} ·{' '}
          {invite.status === 'used'
            ? `redeemed ${timeAgo(invite.used_at)}`
            : `expires ${timeAgo(invite.expires_at)}`}
        </span>
      </div>
      <span
        className={cn(
          'shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase',
          invite.status === 'active'
            ? 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300'
            : invite.status === 'used'
              ? 'border-zinc-800 bg-zinc-900 text-zinc-500'
              : 'border-amber-900/60 bg-amber-950/40 text-amber-300',
        )}
      >
        {invite.status}
      </span>
    </li>
  );
}
