import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Download,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Loader2,
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
  downloadDocument,
  listDocuments,
  type DocumentMeta,
} from '../lib/api';
import { formatBytes, timeAgo } from '../lib/format';
import { SHORTCUT_EVENTS } from '../lib/shortcuts';
import { cn } from '../lib/utils';
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
  const [search, setSearch] = useState('');
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Global "/" shortcut focuses search.
  useEffect(() => {
    const focus = () => searchRef.current?.focus();
    window.addEventListener(SHORTCUT_EVENTS.focusSearch, focus);
    return () => window.removeEventListener(SHORTCUT_EVENTS.focusSearch, focus);
  }, []);

  const docsQuery = useQuery({
    queryKey: ['documents'],
    queryFn: listDocuments,
    retry: false,
  });

  useEffect(() => {
    if (docsQuery.error instanceof ApiError && docsQuery.error.code === 'UNAUTHORIZED') {
      onUnauthorized();
    }
  }, [docsQuery.error, onUnauthorized]);

  // Reset the delete confirmation if it sits untouched.
  useEffect(() => {
    if (confirmId === null) return;
    const timer = setTimeout(() => setConfirmId(null), 3500);
    return () => clearTimeout(timer);
  }, [confirmId]);

  const remove = useMutation({
    mutationFn: deleteDocument,
    onSuccess: (_data, id) => {
      setConfirmId(null);
      queryClient.setQueryData<DocumentMeta[]>(['documents'], (prev) =>
        prev ? prev.filter((doc) => doc.id !== id) : prev,
      );
      toast.success('Document deleted');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
        onUnauthorized();
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    },
  });

  async function handleDownload(doc: DocumentMeta) {
    if (busyIds.has(doc.id)) return;
    setBusyIds((prev) => new Set(prev).add(doc.id));
    try {
      await downloadDocument(doc.id, doc.file_name);
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

  const docs = docsQuery.data ?? [];
  const query = search.trim().toLowerCase();
  const filtered = query ? docs.filter((d) => d.file_name.toLowerCase().includes(query)) : docs;

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader>
        <CardTitle>documents</CardTitle>
        {docs.length > 0 && (
          <span className="rounded-full border border-zinc-700/70 bg-zinc-800/60 px-2 py-0.5 font-mono text-[11px] text-zinc-400">
            {docs.length}
          </span>
        )}
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5">
        {(docs.length > 0 || docsQuery.isPending) && (
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

        {docsQuery.isPending && (
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

        {docsQuery.isError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-10 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-red-900/70 bg-red-950/50 text-red-300">
              <TriangleAlert className="size-4" />
            </span>
            <div>
              <p className="text-sm font-medium text-zinc-200">Couldn&apos;t load documents</p>
              <p className="mt-1 text-xs text-zinc-500">
                {docsQuery.error instanceof Error
                  ? docsQuery.error.message
                  : 'Something went wrong'}
              </p>
            </div>
            <Button onClick={() => docsQuery.refetch()}>Try again</Button>
          </div>
        )}

        {docsQuery.isSuccess && docs.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-zinc-800 px-4 py-10 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-500">
              <PackageOpen className="size-4" />
            </span>
            <p className="text-sm text-zinc-400">No documents yet</p>
            <p className="max-w-[220px] text-xs text-zinc-600">
              Drop a file above to sync it to your other devices.
            </p>
          </div>
        )}

        {docsQuery.isSuccess && docs.length > 0 && filtered.length === 0 && (
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
                const deleting = remove.isPending && remove.variables === doc.id;
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
                        className="truncate font-mono text-[13px] text-zinc-200"
                        title={doc.file_name}
                      >
                        {doc.file_name}
                      </p>
                      <p className="truncate text-[11px] text-zinc-500">
                        {formatBytes(Number(doc.file_size) || 0)} · {timeAgo(doc.uploaded_at)}
                      </p>
                    </div>
                    {confirming ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={deleting}
                          onClick={() => remove.mutate(doc.id)}
                          title="Confirm delete"
                        >
                          {deleting ? <Loader2 className="animate-spin" /> : <Check />}
                          Delete
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
                          onClick={() => void handleDownload(doc)}
                          disabled={busy}
                          title={`Download ${doc.file_name}`}
                        >
                          {busy ? <Loader2 className="animate-spin" /> : <Download />}
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => setConfirmId(doc.id)}
                          title={`Delete ${doc.file_name}`}
                          className="hover:bg-red-950/50 hover:text-red-300"
                        >
                          <Trash2 />
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
    </Card>
  );
}
