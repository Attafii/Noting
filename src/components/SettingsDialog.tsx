import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Download, KeyRound, Loader2, Lock, LockOpen, ShieldCheck, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { triggerBlobDownload } from '../lib/api';
import { useFocusTrap } from '../lib/focus-trap';
import { getKeyFingerprint, setE2EEnabled, useE2E } from '../lib/e2e';
import { encryptExistingFiles, encryptExistingNotes, type MigrateResult } from '../lib/e2e-migrate';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const e2e = useE2E();
  const queryClient = useQueryClient();
  const [migrating, setMigrating] = useState<'notes' | 'files' | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupProgress, setBackupProgress] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const panelRef = useFocusTrap<HTMLDivElement>(open);

  const fingerprintQuery = useQuery({
    queryKey: ['fingerprint'],
    queryFn: getKeyFingerprint,
    enabled: open,
    staleTime: Infinity,
    retry: false,
  });

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function report(kind: 'notes' | 'files', result: MigrateResult) {
    const what = kind === 'notes' ? 'notes' : 'files';
    if (result.failed === 0) {
      toast.success(
        result.encrypted === 0
          ? `Nothing to do — all ${what} already encrypted`
          : `Encrypted ${result.encrypted} ${what}`,
      );
    } else {
      toast.warning(
        `Encrypted ${result.encrypted} ${what}, ${result.failed} failed — retry to finish the rest`,
      );
    }
  }

  async function runMigration(kind: 'notes' | 'files') {
    setMigrating(kind);
    setProgress({ done: 0, total: 0 });
    try {
      const result =
        kind === 'notes'
          ? await encryptExistingNotes((done, total) => setProgress({ done, total }))
          : await encryptExistingFiles((done, total) => setProgress({ done, total }));
      report(kind, result);
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['trash'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Migration failed');
    } finally {
      setMigrating(null);
    }
  }

  async function handleExport() {
    setBackupBusy(true);
    setBackupProgress('starting…');
    try {
      // Lazy: jszip ships in its own chunk, loaded only for backups.
      const { exportBackup } = await import('../lib/backup');
      const blob = await exportBackup((progress) =>
        setBackupProgress(`${progress.phase} ${progress.done}/${progress.total}`),
      );
      const date = new Date().toISOString().slice(0, 10);
      triggerBlobDownload(blob, `noting-backup-${date}.zip`);
      toast.success('Backup downloaded — store it somewhere safe');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBackupBusy(false);
      setBackupProgress('');
    }
  }

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBackupBusy(true);
    setBackupProgress('starting…');
    try {
      const { importBackup } = await import('../lib/backup');
      const result = await importBackup(file, (progress) =>
        setBackupProgress(`${progress.phase} ${progress.done}/${progress.total}`),
      );
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['trash'] });
      toast.success(
        `Restored ${result.notes} notes and ${result.files} files` +
          (result.failed > 0 ? ` (${result.failed} failed)` : ''),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBackupBusy(false);
      setBackupProgress('');
    }
  }

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
          aria-label="Settings"
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm"
        >
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md"
          >
            <Card>
              <CardContent className="flex flex-col gap-5 p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-zinc-100">Settings</h2>
                  <Button size="icon-sm" variant="ghost" onClick={onClose} title="Close settings">
                    <X />
                  </Button>
                </div>

                <section className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-accent-600/40 bg-accent-500/10 text-accent-300">
                        {e2e ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
                      </span>
                      <div>
                        <p className="text-[13px] font-medium text-zinc-100">
                          End-to-end encryption
                        </p>
                        <p className="text-xs text-zinc-500">
                          {e2e ? 'On for new notes and files' : 'Off'}
                        </p>
                      </div>
                    </div>
                    <button
                      role="switch"
                      aria-checked={e2e}
                      aria-label="End-to-end encryption"
                      onClick={() => {
                        setE2EEnabled(!e2e);
                        toast.success(
                          e2e
                            ? 'Encryption off for new content'
                            : 'Encryption on — new content stays private',
                        );
                      }}
                      className={
                        e2e
                          ? 'relative h-6 w-11 shrink-0 cursor-pointer rounded-full bg-accent-500 transition-colors'
                          : 'relative h-6 w-11 shrink-0 cursor-pointer rounded-full bg-zinc-700 transition-colors'
                      }
                    >
                      <span
                        className={
                          e2e
                            ? 'absolute top-0.5 left-[22px] size-5 rounded-full bg-zinc-950 transition-all'
                            : 'absolute top-0.5 left-0.5 size-5 rounded-full bg-zinc-200 transition-all'
                        }
                      />
                    </button>
                  </div>
                  <p className="text-xs leading-relaxed text-zinc-500">
                    Content is encrypted in your browser with a key derived from your access token —
                    the server and database only see ciphertext. File names stay readable so search
                    and downloads keep working. Encrypted content is excluded from AI formatting and
                    document search.
                  </p>
                  <p className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-500">
                    <KeyRound className="size-3" />
                    key fingerprint:{' '}
                    <span className="text-zinc-300">{fingerprintQuery.data ?? '…'}</span>
                  </p>
                  <p className="text-[11px] text-zinc-600">
                    If this differs between your devices, decryption will fail there — the tokens
                    don&apos;t match.
                  </p>
                </section>

                <section className="flex flex-col gap-2 border-t border-zinc-800/70 pt-4">
                  <p className="text-[13px] font-medium text-zinc-100">Encrypt existing content</p>
                  <p className="text-xs leading-relaxed text-zinc-500">
                    Already-stored plaintext stays as-is until you migrate it. Already encrypted
                    items are skipped.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={migrating !== null}
                      onClick={() => void runMigration('notes')}
                    >
                      {migrating === 'notes' ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <ShieldCheck />
                      )}
                      {migrating === 'notes' && progress.total > 0
                        ? `${progress.done}/${progress.total}`
                        : 'Encrypt notes'}
                    </Button>
                    <Button
                      size="sm"
                      disabled={migrating !== null}
                      onClick={() => void runMigration('files')}
                    >
                      {migrating === 'files' ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <ShieldCheck />
                      )}
                      {migrating === 'files' && progress.total > 0
                        ? `${progress.done}/${progress.total}`
                        : 'Encrypt files'}
                    </Button>
                  </div>
                </section>

                <section className="flex flex-col gap-1.5 border-t border-zinc-800/70 pt-4">
                  <p className="text-[13px] font-medium text-zinc-100">Backup</p>
                  <p className="text-xs leading-relaxed text-zinc-500">
                    Full workspace as a .zip — notes as markdown, files as originals (decrypted
                    first). The zip itself is NOT encrypted, so store it somewhere safe.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button size="sm" disabled={backupBusy} onClick={() => void handleExport()}>
                      {backupBusy ? <Loader2 className="animate-spin" /> : <Download />}
                      Export backup
                    </Button>
                    <Button
                      size="sm"
                      disabled={backupBusy}
                      onClick={() => importRef.current?.click()}
                    >
                      <Upload />
                      Import
                    </Button>
                    <input
                      ref={importRef}
                      type="file"
                      accept=".zip,application/zip,application/x-zip-compressed"
                      className="hidden"
                      aria-label="Import backup zip"
                      onChange={(e) => void handleImportFile(e)}
                    />
                    {backupProgress && (
                      <span className="font-mono text-[11px] text-zinc-500">{backupProgress}</span>
                    )}
                  </div>
                </section>

                <section className="flex flex-col gap-1.5 border-t border-zinc-800/70 pt-4">
                  <p className="text-[13px] font-medium text-zinc-100">Keyboard shortcuts</p>
                  <ShortcutRow keys="Ctrl/⌘ S" action="Save note now" />
                  <ShortcutRow keys="Ctrl/⌘ P" action="Toggle Write / Preview" />
                  <ShortcutRow keys="Ctrl/⌘ H" action="Toggle version history" />
                  <ShortcutRow keys="/" action="Focus file search" />
                </section>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ShortcutRow({ keys, action }: { keys: string; action: string }) {
  return (
    <p className="flex items-center justify-between text-xs text-zinc-500">
      <span>{action}</span>
      <kbd className="rounded-md border border-zinc-700/70 bg-zinc-900 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
        {keys}
      </kbd>
    </p>
  );
}
