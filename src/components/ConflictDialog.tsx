import { AnimatePresence, motion } from 'motion/react';
import { GitCompareArrows } from 'lucide-react';
import { useEffect } from 'react';
import { timeAgo } from '../lib/format';
import { useFocusTrap } from '../lib/focus-trap';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

interface ConflictDialogProps {
  /** The server's newer version. Null hides the dialog. */
  server: { content: string; updated_at: string } | null;
  /**
   * Decrypted server text for the comparison pane. The raw `server.content`
   * may be ciphertext (E2E notes) — this prop carries the safe display text,
   * or null while it resolves.
   */
  serverPreview: string | null;
  localPreview: string;
  busy: boolean;
  onKeepMine: () => void;
  onKeepBoth: () => void;
  onLoadTheirs: () => void;
}

export function ConflictDialog({
  server,
  serverPreview,
  localPreview,
  busy,
  onKeepMine,
  onKeepBoth,
  onLoadTheirs,
}: ConflictDialogProps) {
  // Lock background scroll while the conflict is unresolved.
  // No Esc to dismiss by design — autosave is paused until the user chooses.
  const panelRef = useFocusTrap<HTMLDivElement>(server !== null);
  useEffect(() => {
    if (!server) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [server]);

  return (
    <AnimatePresence>
      {server && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="conflict-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm"
        >
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-3xl"
          >
            <Card className="border-amber-900/50">
              <CardContent className="flex flex-col gap-4 p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-900/70 bg-amber-950/50 text-amber-300">
                    <GitCompareArrows className="size-4" />
                  </span>
                  <div>
                    <h2 id="conflict-title" className="text-sm font-semibold text-zinc-100">
                      Changed on another device
                    </h2>
                    <p className="text-xs text-zinc-500">
                      Their version saved {timeAgo(server.updated_at)} — autosave is paused until
                      you choose.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <VersionPane label="My version (unsaved)" text={localPreview} accent />
                  {serverPreview === null ? (
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60">
                      <p className="border-b border-zinc-800/70 px-3 py-1.5 font-mono text-[11px] tracking-wide text-zinc-500 uppercase">
                        Their version ({timeAgo(server.updated_at)})
                      </p>
                      <div className="flex min-h-24 flex-col justify-center gap-1.5 px-3 py-2.5">
                        <span className="h-3 w-3/4 animate-pulse rounded bg-zinc-800" />
                        <span className="h-3 w-full animate-pulse rounded bg-zinc-800" />
                        <span className="h-3 w-2/3 animate-pulse rounded bg-zinc-800" />
                      </div>
                    </div>
                  ) : (
                    <VersionPane
                      label={`Their version (${timeAgo(server.updated_at)})`}
                      text={serverPreview}
                    />
                  )}
                </div>

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button variant="secondary" onClick={onLoadTheirs} disabled={busy}>
                    Load theirs
                  </Button>
                  <Button variant="secondary" onClick={onKeepBoth} disabled={busy}>
                    Keep both
                  </Button>
                  <Button variant="accent" onClick={onKeepMine} disabled={busy}>
                    {busy ? 'Saving…' : 'Keep mine'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function VersionPane({ label, text, accent }: { label: string; text: string; accent?: boolean }) {
  return (
    <div
      className={
        accent
          ? 'rounded-lg border border-accent-600/30 bg-accent-500/[0.04]'
          : 'rounded-lg border border-zinc-800 bg-zinc-950/60'
      }
    >
      <p className="border-b border-zinc-800/70 px-3 py-1.5 font-mono text-[11px] tracking-wide text-zinc-500 uppercase">
        {label}
      </p>
      <pre className="max-h-56 min-h-24 overflow-y-auto px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-300">
        {text.trim() ? text : <span className="text-zinc-600">(empty)</span>}
      </pre>
    </div>
  );
}
