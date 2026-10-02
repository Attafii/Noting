import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy, Link2, Loader2, Lock, X } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, createShare, listShares, revokeShare, shareUrl } from '../lib/api';
import { useFocusTrap } from '../lib/focus-trap';
import { timeAgo } from '../lib/format';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  noteId: number;
  noteTitle: string;
  encrypted: boolean;
  onUnauthorized: () => void;
}

const DAY_OPTIONS = [
  { days: 1, label: '24 hours' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];

type ShareRow = {
  id: string;
  note_id: number;
  note_title?: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

function statusOf(share: ShareRow, now = new Date()): 'active' | 'expired' | 'revoked' {
  if (share.revoked_at) return 'revoked';
  return Date.parse(share.expires_at) > now.getTime() ? 'active' : 'expired';
}

const STATUS_BADGE: Record<string, string> = {
  active: 'border-emerald-900/70 bg-emerald-950/50 text-emerald-300',
  expired: 'border-zinc-700 bg-zinc-800 text-zinc-500',
  revoked: 'border-red-900/70 bg-red-950/50 text-red-300',
};

/**
 * Manage read-only share links for one note. The plaintext token exists only
 * in this component's memory (shown once at mint) — the server keeps sha256.
 *
 * The panel only mounts while `open`, so its state (minted tokens, expiry
 * choice) resets for free when the dialog closes — no reset-in-effect.
 */
export function ShareDialog(props: ShareDialogProps) {
  return <AnimatePresence>{props.open && <SharePanel {...props} />}</AnimatePresence>;
}

function SharePanel({ onClose, noteId, noteTitle, encrypted, onUnauthorized }: ShareDialogProps) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(7);
  // id → plaintext token for links minted this session (memory only).
  const [minted, setMinted] = useState<Record<string, string>>({});
  const [lastId, setLastId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const panelRef = useFocusTrap<HTMLDivElement>(true);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const sharesQuery = useQuery({
    queryKey: ['shares', noteId],
    queryFn: () => listShares(noteId),
    enabled: !encrypted,
    retry: false,
  });

  const mint = useMutation({
    mutationFn: () => createShare(noteId, days),
    onSuccess: (share) => {
      setMinted((prev) => ({ ...prev, [share.id]: share.token }));
      setLastId(share.id);
      void queryClient.invalidateQueries({ queryKey: ['shares', noteId] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') onUnauthorized();
      else toast.error(err instanceof Error ? err.message : 'Could not create the link');
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeShare(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shares', noteId] });
      toast.success('Share link revoked');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') onUnauthorized();
      else toast.error(err instanceof Error ? err.message : 'Could not revoke the link');
    },
  });

  async function copyLink(id: string) {
    const token = minted[id];
    if (!token) return;
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      setCopiedId(id);
      toast.success('Link copied');
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('Could not copy — select the link and copy manually');
    }
  }

  const rows = (sharesQuery.data ?? []) as ShareRow[];
  const lastToken = lastId ? minted[lastId] : undefined;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share note"
      className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/70 p-4 pt-[14vh] backdrop-blur-sm"
    >
      <motion.div
        ref={panelRef}
        tabIndex={-1}
        initial={{ opacity: 0, y: -10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.99 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-zinc-700/70 bg-zinc-900 shadow-[0_24px_70px_-12px_rgb(0_0_0/0.9)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800/70 px-4 py-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
              share read-only link
            </p>
            <p className="mt-0.5 truncate text-sm font-medium text-zinc-100">{noteTitle}</p>
          </div>
          <Button size="icon-sm" variant="ghost" onClick={onClose} title="Close">
            <X />
          </Button>
        </div>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto p-4">
          {encrypted ? (
            <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-zinc-700 px-4 py-8 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-zinc-400">
                <Lock className="size-4" />
              </span>
              <p className="text-sm text-zinc-200">Encrypted notes stay private</p>
              <p className="max-w-[280px] text-xs text-zinc-500">
                The server only ever sees ciphertext for this note, so a read-only link would show
                nothing. Turn off E2E encryption first if you want to share it.
              </p>
            </div>
          ) : (
            <>
              {/* Freshly minted link — the only place the token ever appears. */}
              {lastId && lastToken && (
                <div className="rounded-xl border border-accent-600/40 bg-accent-500/5 p-3">
                  <p className="font-mono text-[11px] tracking-[0.18em] text-accent-300 uppercase">
                    your link
                  </p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <input
                      readOnly
                      value={shareUrl(lastToken)}
                      aria-label="Share link"
                      onFocus={(e) => e.currentTarget.select()}
                      className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 font-mono text-[11px] text-zinc-300"
                    />
                    <Button
                      size="sm"
                      variant="accent"
                      onClick={() => void copyLink(lastId)}
                      title="Copy link"
                    >
                      {copiedId === lastId ? <Check /> : <Copy />}
                    </Button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-500">
                    Anyone with this link can read the note until it expires. The token is shown
                    once — copy it now.
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">Expires in</span>
                <div className="flex gap-1">
                  {DAY_OPTIONS.map((option) => (
                    <button
                      key={option.days}
                      onClick={() => setDays(option.days)}
                      aria-pressed={days === option.days}
                      className={cn(
                        'cursor-pointer rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                        days === option.days
                          ? 'border-accent-600/60 bg-accent-500/10 text-accent-300'
                          : 'border-zinc-700 text-zinc-400 hover:text-zinc-200',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="accent"
                  className="ml-auto"
                  disabled={mint.isPending}
                  onClick={() => mint.mutate()}
                >
                  {mint.isPending ? <Loader2 className="animate-spin" /> : <Link2 />}
                  Create link
                </Button>
              </div>

              <div className="flex flex-col gap-1.5">
                <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
                  links
                </p>
                {sharesQuery.isPending && (
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-11 w-full" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                )}
                {sharesQuery.isSuccess && rows.length === 0 && (
                  <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-600">
                    No links yet — create one above.
                  </p>
                )}
                {sharesQuery.isSuccess &&
                  rows.map((share) => {
                    const status = statusOf(share);
                    return (
                      <div
                        key={share.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                'rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase',
                                STATUS_BADGE[status],
                              )}
                            >
                              {status}
                            </span>
                            <span className="font-mono text-[11px] text-zinc-500">
                              {status === 'active'
                                ? `expires ${timeAgo(share.expires_at)}`
                                : status === 'expired'
                                  ? 'expired'
                                  : 'revoked'}
                            </span>
                          </div>
                          <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
                            created {timeAgo(share.created_at)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {minted[share.id] && status === 'active' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void copyLink(share.id)}
                              title="Copy link"
                            >
                              {copiedId === share.id ? (
                                <Check className="text-emerald-400" />
                              ) : (
                                <Copy />
                              )}
                            </Button>
                          )}
                          {status === 'active' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={revoke.isPending}
                              onClick={() => revoke.mutate(share.id)}
                              title="Revoke this link"
                              className="hover:text-red-300"
                            >
                              Revoke
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                {sharesQuery.isError && (
                  <p className="text-xs text-amber-300">Couldn&apos;t load links.</p>
                )}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
