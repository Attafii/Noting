import { useRef, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { getUsage, triggerBlobDownload } from '../lib/api';
import { formatBytes } from '../lib/format';
import { applyTheme, getTheme, useTheme, type AccentName, type DensityName } from '../lib/theme';
import {
  getAutosaveMs,
  getDefaultViewMode,
  getSpellcheck,
  setAutosaveMs,
  setDefaultViewMode,
  setSpellcheck,
  type DefaultViewMode,
} from '../lib/prefs';
import {
  DEFAULT_BINDINGS,
  SHORTCUT_LABELS,
  formatBinding,
  getBindings,
  resetBindings,
  setBinding,
  type ShortcutBinding,
  type ShortcutId,
} from '../lib/shortcuts';
import { getKeyFingerprint, setE2EEnabled, useE2E } from '../lib/e2e';
import { clearToken, getToken } from '../lib/token';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

const ACCENTS: { key: AccentName; label: string; dot: string }[] = [
  { key: 'gold', label: 'Gold', dot: '#c99a3f' },
  { key: 'emerald', label: 'Emerald', dot: '#10b981' },
  { key: 'cobalt', label: 'Cobalt', dot: '#3b82f6' },
];

function SettingsPage() {
  const token = getToken();
  const theme = useTheme();
  const e2e = useE2E();
  const queryClient = useQueryClient();
  const [autosave, setAutosave] = useState(getAutosaveMs());
  const [defaultMode, setMode] = useState<DefaultViewMode>(getDefaultViewMode());
  const [spell, setSpell] = useState(getSpellcheck());
  const [bindingsVersion, setBindingsVersion] = useState(0);
  const [recording, setRecording] = useState<ShortcutId | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const usageQuery = useQuery({ queryKey: ['usage'], queryFn: getUsage, retry: false });
  const fingerprintQuery = useQuery({
    queryKey: ['fingerprint'],
    queryFn: getKeyFingerprint,
    staleTime: Infinity,
    retry: false,
  });

  if (!token) {
    return (
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-zinc-300">Settings live inside the app — unlock it first.</p>
        <Link to="/" className="text-sm text-accent-300 underline underline-offset-2">
          Back to the app
        </Link>
      </div>
    );
  }

  // Re-read after recorder/reset bumps the version.
  void bindingsVersion;
  const bindings = getBindings();

  function pickAccent(accent: AccentName) {
    applyTheme({ ...getTheme(), accent });
  }

  async function handleExport() {
    setBackupBusy(true);
    try {
      const { exportBackup } = await import('../lib/backup');
      const blob = await exportBackup();
      const date = new Date().toISOString().slice(0, 10);
      triggerBlobDownload(blob, `noting-backup-${date}.zip`);
      toast.success('Backup downloaded — store it somewhere safe');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBackupBusy(true);
    try {
      const { importBackup } = await import('../lib/backup');
      const result = await importBackup(file);
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
          <h1 className="text-base font-semibold text-zinc-100">Settings</h1>
          <p className="font-mono text-[11px] text-zinc-500">
            appearance · editor · shortcuts · storage
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-4 p-5">
            <SectionTitle>Appearance</SectionTitle>
            <Row label="Theme">
              <Segmented
                options={[
                  { key: 'dark', label: 'Dark' },
                  { key: 'light', label: 'Light' },
                ]}
                active={theme.mode}
                onPick={(mode) => applyTheme({ ...getTheme(), mode: mode as 'dark' | 'light' })}
              />
            </Row>
            <Row label="Accent">
              <div className="flex gap-1.5">
                {ACCENTS.map((a) => (
                  <button
                    key={a.key}
                    onClick={() => pickAccent(a.key)}
                    title={a.label}
                    aria-label={`${a.label} accent`}
                    aria-pressed={theme.accent === a.key}
                    className={cn(
                      'flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                      theme.accent === a.key
                        ? 'border-accent-600/60 bg-accent-500/10 text-zinc-100'
                        : 'border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200',
                    )}
                  >
                    <span className="size-2.5 rounded-full" style={{ background: a.dot }} />
                    {a.label}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Density">
              <Segmented
                options={[
                  { key: 'comfortable', label: 'Comfortable' },
                  { key: 'compact', label: 'Compact' },
                ]}
                active={theme.density}
                onPick={(density) => applyTheme({ ...getTheme(), density: density as DensityName })}
              />
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-4 p-5">
            <SectionTitle>Editor</SectionTitle>
            <Row label="Autosave delay">
              <Segmented
                options={[
                  { key: '500', label: '0.5s' },
                  { key: '1000', label: '1s' },
                  { key: '2000', label: '2s' },
                ]}
                active={String(autosave)}
                onPick={(v) => {
                  setAutosaveMs(parseInt(v, 10));
                  setAutosave(parseInt(v, 10));
                }}
              />
            </Row>
            <Row label="Default view">
              <Segmented
                options={[
                  { key: 'write', label: 'Write' },
                  { key: 'split', label: 'Split' },
                  { key: 'preview', label: 'Preview' },
                ]}
                active={defaultMode}
                onPick={(v) => {
                  setDefaultViewMode(v as DefaultViewMode);
                  setMode(v as DefaultViewMode);
                }}
              />
            </Row>
            <Row label="Spellcheck">
              <Toggle
                on={spell}
                label="Spellcheck in editor"
                onFlip={() => {
                  setSpellcheck(!spell);
                  setSpell(!spell);
                }}
              />
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <SectionTitle>Keyboard shortcuts</SectionTitle>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  resetBindings();
                  setBindingsVersion((v) => v + 1);
                  toast.success('Shortcuts reset to defaults');
                }}
              >
                Reset
              </Button>
            </div>
            {(Object.keys(DEFAULT_BINDINGS) as ShortcutId[]).map((id) => (
              <div key={id} className="flex items-center justify-between gap-3">
                <span className="text-xs text-zinc-400">{SHORTCUT_LABELS[id]}</span>
                <button
                  onClick={() => setRecording(id)}
                  onKeyDown={
                    recording === id
                      ? (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const binding: ShortcutBinding = {
                            mod: e.ctrlKey || e.metaKey,
                            key: e.key.toLowerCase(),
                          };
                          setBinding(id, binding);
                          setRecording(null);
                          setBindingsVersion((v) => v + 1);
                        }
                      : undefined
                  }
                  aria-label={`Change shortcut for ${SHORTCUT_LABELS[id]}`}
                  className={cn(
                    'cursor-pointer rounded-md border px-2 py-1 font-mono text-[11px]',
                    recording === id
                      ? 'animate-pulse border-accent-500 text-accent-300'
                      : 'border-zinc-700/70 bg-zinc-900 text-zinc-300 hover:border-zinc-600',
                  )}
                >
                  {recording === id ? 'Press keys…' : formatBinding(bindings[id])}
                </button>
              </div>
            ))}
            <p className="text-[11px] text-zinc-600">
              Click a shortcut, then press the new keys. Ctrl/⌘ counts as a modifier.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <SectionTitle>Storage</SectionTitle>
            {usageQuery.isPending && <p className="text-xs text-zinc-500">Measuring…</p>}
            {usageQuery.isError && (
              <p className="text-xs text-zinc-500">Couldn&apos;t load usage right now.</p>
            )}
            {usageQuery.data && (
              <div className="grid grid-cols-2 gap-2">
                <UsageCell
                  label="Notes"
                  value={`${usageQuery.data.notes.count} · ${formatBytes(usageQuery.data.notes.bytes)}`}
                />
                <UsageCell
                  label="Files"
                  value={`${usageQuery.data.files.count} · ${formatBytes(usageQuery.data.files.bytes)}`}
                />
                <UsageCell
                  label="Notes in trash"
                  value={String(usageQuery.data.trashedNotes.count)}
                />
                <UsageCell
                  label="Files in trash"
                  value={String(usageQuery.data.trashedFiles.count)}
                />
              </div>
            )}
            <p className="text-[11px] text-zinc-600">
              Trash auto-removes items after 30 days. Usage powers future plan limits.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <SectionTitle>Privacy & data</SectionTitle>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium text-zinc-100">End-to-end encryption</p>
                <p className="font-mono text-[11px] text-zinc-500">
                  key fingerprint: {fingerprintQuery.data ?? '…'}
                </p>
              </div>
              <Toggle
                on={e2e}
                label="End-to-end encryption"
                onFlip={() => {
                  setE2EEnabled(!e2e);
                  toast.success(
                    e2e
                      ? 'Encryption off for new content'
                      : 'Encryption on — new content stays private',
                  );
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={backupBusy} onClick={() => void handleExport()}>
                {backupBusy ? <Loader2 className="animate-spin" /> : <Download />}
                Export backup
              </Button>
              <Button size="sm" disabled={backupBusy} onClick={() => importRef.current?.click()}>
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
            </div>
            <button
              onClick={() => {
                clearToken();
                window.location.href = '/';
              }}
              className="cursor-pointer self-start text-xs text-red-300/80 hover:text-red-300"
            >
              Lock workspace (clear token on this device)
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">{children}</h2>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-zinc-300">{label}</span>
      {children}
    </div>
  );
}

function Segmented({
  options,
  active,
  onPick,
}: {
  options: { key: string; label: string }[];
  active: string;
  onPick: (key: string) => void;
}) {
  return (
    <div className="flex rounded-lg border border-zinc-800 bg-zinc-950/70 p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onPick(o.key)}
          aria-pressed={active === o.key}
          className={cn(
            'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-all',
            active === o.key
              ? 'bg-zinc-800 text-zinc-100 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-300',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, label, onFlip }: { on: boolean; label: string; onFlip: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onFlip}
      className={cn(
        'relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors',
        on ? 'bg-accent-500' : 'bg-zinc-700',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-5 rounded-full transition-all',
          on ? 'left-[22px] bg-zinc-950' : 'left-0.5 bg-zinc-200',
        )}
      />
    </button>
  );
}

function UsageCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/50 px-3 py-2.5">
      <p className="font-mono text-[11px] text-zinc-500">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-zinc-100">{value}</p>
    </div>
  );
}
