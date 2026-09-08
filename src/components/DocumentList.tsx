import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArchiveRestore,
  Check,
  Download,
  Eye,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Loader2,
  Lock,
  PackageOpen,
  Search,
  Trash2,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ApiError,
  deleteDocument,
  fetchDocumentBlob,
  listDocuments,
  listTrash,
  restoreDocument,
  triggerBlobDownload,
  type DocumentMeta,
} from '../lib/api';
import { decryptBytes, toBufferView } from '../lib/crypto';
import { getCryptoKey } from '../lib/e2e';
import { formatBytes, timeAgo } from '../lib/format';
import { SHORTCUT_EVENTS } from '../lib/shortcuts';
import { cn } from '../lib/utils';
import { PreviewModal } from './PreviewModal';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Skeleton } from './ui/skeleton';

interface DocumentListProps {
  onUnauthorized: () => void;
}

function iconForMime(mime: string): LucideIcon {
  if (mime.startsWith('image/')) return FileImage;
  if (mime.startsWith('video/')) return FileVideo;
  if (mime.startsWith('audio/')) return FileAudio;
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('tar') || mime.includes('7z'))
    return FileArchive;
  if (
    mime.includes('pdf') ||
    mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('markdown')
  )
    return FileText;
  return File;
}

export default function DocumentList({ onUnauthorized }: DocumentListProps) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<'files' | 'trash'>('files');
  const [search, setSearch] = useState('');
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocumentMeta | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filesQuery = useQuery({
    queryKey: ['documents'],
    queryFn: listDocuments,
    retry: false,
  });
  const trashQuery = useQuery({
    queryKey: ['trash'],
    queryFn: listTrash,
    retry: false,
    enabled: view === 'trash',
  });

  const activeQuery = view === 'files' ? filesQuery : trashQuery;

  useEffect(() => {
    if (activeQuery.error instanceof ApiError && activeQuery.error.code === 'UNAUTHORIZED') {
      onUnauthorized();
    }
  }, [activeQuery.error, onUnauthorized]);

  // Reset the delete confirmation if it sits untouched.
  useEffect(() => {
    if (confirmId === null) return;
    const timer = setTimeout(() => setConfirmId(null), 3500);
    return () => clearTimeout(timer);
  }, [confirmId]);

  // External preview requests (e.g. citation chips in the Ask panel).
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<number>).detail;
      const cached = queryClient.getQueryData<DocumentMeta[]>(['documents']) ?? [];
      const found = cached.find((doc) => doc.id === id);
      if (found) {
        setView('files');
        setPreviewDoc(found);
      }
    };
    window.addEventListener(SHORTCUT_EVENTS.previewDocument, open);
    return () => window.removeEventListener(SHORTCUT_EVENTS.previewDocument, open);
  }, [queryClient]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['documents'] });
    void queryClient.invalidateQueries({ queryKey: ['trash'] });
  };

  const setCacheRemove = (id: number) => {
    queryClient.setQueryData<DocumentMeta[]>(['documents'], (prev) =>
      prev ? prev.filter((doc) => doc.id !== id) : prev,
    );
    queryClient.setQueryData<DocumentMeta[]>(['trash'], (prev) =>
      prev ? prev.filter((doc) => doc.id !== id) : prev,
    );
  };

  const trash = useMutation({
    mutationFn: (id: number) => deleteDocument(id, false),
    onSuccess: (_data, id) => {
      setCacheRemove(id);
      refresh();
      toast.success('Moved to trash', {
        action: {
          label: 'Undo',
          onClick: () => {
            restoreDocument(id).then(refresh, () => toast.error('Restore failed'));
          },
        },
      });
    },
    onError: (err) => handleMutationError(err, onUnauthorized, 'Delete failed'),
  });

  const destroy = useMutation({
    mutationFn: (id: number) => deleteDocument(id, true),
    onSuccess: (_data, id) => {
      setConfirmId(null);
      setCacheRemove(id);
      refresh();
      toast.success('Permanently deleted');
    },
    onError: (err) => handleMutationError(err, onUnauthorized, 'Delete failed'),
  });

  const restore = useMutation({
    mutationFn: restoreDocument,
    onSuccess: (_data, id) => {
      setCacheRemove(id);
      refresh();
      toast.success('Restored');
    },
    onError: (err) => handleMutationError(err, onUnauthorized, 'Restore failed'),
  });

  async function handleDownload(doc: DocumentMeta) {
    if (busyIds.has(doc.id)) return;
    setBusyIds((prev) => new Set(prev).add(doc.id));
    try {
      const fetched = await fetchDocumentBlob(doc.id);
      let blob = fetched.blob;
      if (fetched.enc) {
        const key = await getCryptoKey();
        if (!key) throw new Error('No encryption key — re-enter your token');
        const cipher = new Uint8Array(await fetched.blob.arrayBuffer());
        blob = new Blob([toBufferView(await decryptBytes(key, cipher))], {
          type: fetched.fileType,
        });
      }
      triggerBlobDownload(blob, fetched.fileName);
      toast.success('Download started');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
        onUnauthorized();
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
    }
  }

  async function decryptForPreview(data: Uint8Array): Promise<Uint8Array> {
    const key = await getCryptoKey();
    if (!key) throw new Error('No encryption key — re-enter your token');
    return decryptBytes(key, data);
  }

  const docs = activeQuery.data ?? [];
  const query = search.trim().toLowerCase();
  const filtered = query ? docs.filter((d) => d.file_name.toLowerCase().includes(query)) : docs;
  const trashCount = trashQuery.data?.length ?? 0;

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader>
        <CardTitle>documents</CardTitle>
        <div
          role="tablist"
          aria-label="Document view"
          className="flex rounded-lg border border-zinc-800 bg-zinc-950/70 p-0.5"
        >
          <ViewTab active={view === 'files'} onClick={() => setView('files')} label="Files" />
          <ViewTab
            active={view === 'trash'}
            onClick={() => setView('trash')}
            label={trashCount > 0 ? `Trash (${trashCount})` : 'Trash'}
          />
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5">
        {(docs.length > 0 || activeQuery.isPending) && (
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-zinc-600" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search files…  ( / )"
              aria-label="Search documents"
              className="pl-8"
            />
          </div>
        )}

        {activeQuery.isPending && (
          <div className="flex flex-col gap-2" aria-label="Loading documents">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-zinc-800/60 px-3 py-2.5"
              >
                <Skeleton className="h-8 w-8 rounded-lg" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-7 w-7" />
              </div>
            ))}
          </div>
        )}

        {activeQuery.isError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-10 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-red-900/70 bg-red-950/50 text-red-300">
              <TriangleAlert className="size-4" />
            </span>
            <div>
              <p className="text-sm font-medium text-zinc-200">Couldn&apos;t load documents</p>
              <p className="mt-1 text-xs text-zinc-500">
                {activeQuery.error instanceof Error
                  ? activeQuery.error.message
                  : 'Something went wrong'}
              </p>
            </div>
            <Button onClick={() => activeQuery.refetch()}>Try again</Button>
          </div>
        )}

        {activeQuery.isSuccess && docs.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-zinc-800 px-4 py-10 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-500">
              <PackageOpen className="size-4" />
            </span>
            <p className="text-sm text-zinc-400">
              {view === 'files' ? 'No documents yet' : 'Trash is empty'}
            </p>
            <p className="max-w-[220px] text-xs text-zinc-600">
              {view === 'files'
                ? 'Drop a file above to sync it to your other devices.'
                : 'Deleted files rest here for 30 days.'}
            </p>
          </div>
        )}

        {activeQuery.isSuccess && docs.length > 0 && filtered.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-800 px-4 py-10 text-center">
            <p className="text-sm text-zinc-400">No files match “{search.trim()}”</p>
            <button
              onClick={() => setSearch('')}
              className="cursor-pointer text-xs text-accent-300 hover:underline"
            >
              Clear search
            </button>
          </div>
        )}

        {filtered.length > 0 && (
          <motion.ul layout className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5">
            <AnimatePresence initial={false}>
              {filtered.map((doc) => {
                const Icon = iconForMime(doc.file_type);
                const busy = busyIds.has(doc.id);
                const confirming = confirmId === doc.id;
                const working =
                  (trash.isPending && trash.variables === doc.id) ||
                  (destroy.isPending && destroy.variables === doc.id) ||
                  (restore.isPending && restore.variables === doc.id);
                return (
                  <motion.li
                    key={doc.id}
                    layout
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 32 }}
                    transition={{ duration: 0.18 }}
                    className={cn(
                      'group flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors duration-200',
                      confirming
                        ? 'border-red-900/60 bg-red-950/25'
                        : 'border-zinc-800/60 bg-zinc-900/40 hover:border-zinc-700/70 hover:bg-zinc-900/70',
                    )}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/60 text-zinc-500">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className="flex items-center gap-1.5 truncate font-mono text-[13px] text-zinc-200"
                        title={doc.file_name}
                      >
                        <span className="truncate">{doc.file_name}</span>
                        {doc.enc && <Lock className="size-3 shrink-0 text-accent-300" />}
                      </p>
                      <p className="truncate text-[11px] text-zinc-500">
                        {formatBytes(Number(doc.file_size) || 0)} ·{' '}
                        {view === 'trash' && doc.deleted_at
                          ? `deleted ${timeAgo(doc.deleted_at)}`
                          : timeAgo(doc.uploaded_at)}
                      </p>
                    </div>
                    {view === 'trash' ? (
                      confirming ? (
                        <span className="flex shrink-0 items-center gap-1">
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={working}
                            onClick={() => destroy.mutate(doc.id)}
                            title="Delete forever"
                          >
                            {working ? <Loader2 className="animate-spin" /> : <Check />}
                            Forever
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => setConfirmId(null)}
                            title="Cancel"
                          >
                            <X />
                          </Button>
                        </span>
                      ) : (
                        <span className="flex shrink-0 items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:duration-200 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => restore.mutate(doc.id)}
                            disabled={working}
                            title={`Restore ${doc.file_name}`}
                          >
                            {working ? <Loader2 className="animate-spin" /> : <ArchiveRestore />}
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => setConfirmId(doc.id)}
                            title={`Delete ${doc.file_name} forever`}
                            className="hover:bg-red-950/50 hover:text-red-300"
                          >
                            <Trash2 />
                          </Button>
                        </span>
                      )
                    ) : (
                      <span className="flex shrink-0 items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:duration-200 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => setPreviewDoc(doc)}
                          title={`Preview ${doc.file_name}`}
                        >
                          <Eye />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => void handleDownload(doc)}
                          disabled={busy}
                          title={`Download ${doc.file_name}`}
                        >
                          {busy ? <Loader2 className="animate-spin" /> : <Download />}
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => trash.mutate(doc.id)}
                          disabled={working}
                          title={`Move ${doc.file_name} to trash`}
                          className="hover:bg-red-950/50 hover:text-red-300"
                        >
                          {working ? <Loader2 className="animate-spin" /> : <Trash2 />}
                        </Button>
                      </span>
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </motion.ul>
        )}
      </CardContent>

      <PreviewModal
        key={previewDoc?.id ?? 'closed'}
        doc={previewDoc}
        onClose={() => setPreviewDoc(null)}
        onUnauthorized={onUnauthorized}
        decrypt={decryptForPreview}
      />
    </Card>
  );
}

function handleMutationError(err: unknown, onUnauthorized: () => void, fallback: string) {
  if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
    onUnauthorized();
    return;
  }
  toast.error(err instanceof Error ? err.message : fallback);
}

function ViewTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-200',
        active ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300',
      )}
    >
      {label}
    </button>
  );
}
