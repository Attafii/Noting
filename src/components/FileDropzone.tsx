import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Check, FileUp, Loader2, Lock, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, uploadFile } from '../lib/api';
import { encryptBytes, toBufferView } from '../lib/crypto';
import { getCryptoKey, useE2E } from '../lib/e2e';
import { formatBytes } from '../lib/format';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

const MAX_BYTES = 4.5 * 1024 * 1024;

interface QueueItem {
  id: number;
  name: string;
  size: number;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
  file: File;
}

interface FileDropzoneProps {
  onUnauthorized: () => void;
}

export default function FileDropzone({ onUnauthorized }: FileDropzoneProps) {
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const idRef = useRef(0);
  const e2e = useE2E();
  const maxPlaintextBytes = e2e ? MAX_BYTES - 1024 : MAX_BYTES;
  const controllers = useRef(new Map<number, AbortController>());
  useEffect(() => {
    const activeControllers = controllers.current;
    return () => activeControllers.forEach((controller) => controller.abort());
  }, []);

  const patchItem = useCallback((id: number, patch: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const removeItem = useCallback((id: number) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const startUpload = useCallback(
    (id: number, file: File) => {
      patchItem(id, { status: 'uploading', progress: 0, error: undefined });
      void (async () => {
        const controller = new AbortController();
        controllers.current.set(id, controller);
        // E2E: encrypt bytes in-browser; the server stores opaque ciphertext
        // under the original name and MIME type.
        let payload = file;
        let encrypted = false;
        if (e2e) {
          const key = await getCryptoKey();
          if (!key) {
            patchItem(id, { status: 'error', error: 'No encryption key — re-enter token' });
            controllers.current.delete(id);
            return;
          }
          try {
            const plain = new Uint8Array(await file.arrayBuffer());
            const cipher = await encryptBytes(key, plain);
            payload = new File([toBufferView(cipher)], file.name, {
              type: file.type || 'application/octet-stream',
            });
            encrypted = true;
          } catch {
            patchItem(id, { status: 'error', error: 'Encryption failed' });
            controllers.current.delete(id);
            return;
          }
        }
        try {
          await uploadFile(
            payload,
            (progress) => patchItem(id, { progress }),
            encrypted,
            undefined,
            controller.signal,
          );
        } catch (err: unknown) {
          if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
            removeItem(id);
            onUnauthorized();
            controllers.current.delete(id);
            return;
          }
          const message = err instanceof Error ? err.message : 'Upload failed';
          patchItem(id, { status: 'error', error: message });
          toast.error(message);
          controllers.current.delete(id);
          return;
        }
        patchItem(id, { status: 'done', progress: 100 });
        controllers.current.delete(id);
        void queryClient.invalidateQueries({ queryKey: ['documents'] });
        setTimeout(() => removeItem(id), 1800);
      })();
    },
    [e2e, onUnauthorized, patchItem, queryClient, removeItem],
  );

  const onDrop = useCallback(
    (files: File[]) => {
      for (const file of files) {
        idRef.current += 1;
        const id = idRef.current;
        if (file.size > maxPlaintextBytes) {
          setQueue((prev) => [
            ...prev,
            {
              id,
              name: file.name,
              size: file.size,
              progress: 0,
              status: 'error',
              error: `Too large — max ${formatBytes(maxPlaintextBytes)}`,
              file,
            },
          ]);
          continue;
        }
        setQueue((prev) => [
          ...prev,
          { id, name: file.name, size: file.size, progress: 0, status: 'uploading', file },
        ]);
        startUpload(id, file);
      }
    },
    [maxPlaintextBytes, startUpload],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>upload</CardTitle>
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-600">
          {e2e && <Lock className="size-3 text-accent-300" />}
          max {formatBytes(maxPlaintextBytes)} each{e2e ? ' · encrypted' : ''}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <motion.div
          animate={isDragActive ? { scale: 1.01 } : { scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 28 }}
        >
          <div
            {...getRootProps()}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors duration-200',
              isDragActive
                ? 'border-accent-400/70 bg-accent-500/[0.06]'
                : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-600 hover:bg-zinc-900/40',
            )}
          >
            <input {...getInputProps()} aria-label="Upload files" />
            <motion.span
              animate={isDragActive ? { y: -3, scale: 1.08 } : { y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full border transition-colors duration-200',
                isDragActive
                  ? 'border-accent-500/50 bg-accent-500/10 text-accent-300'
                  : 'border-zinc-700/70 bg-zinc-900 text-zinc-400',
              )}
            >
              <FileUp className="size-4" />
            </motion.span>
            <div>
              <p className="text-sm text-zinc-300">
                {isDragActive ? 'Drop files to upload' : 'Drop files or click to browse'}
              </p>
              <p className="mt-0.5 text-xs text-zinc-600">Multiple files upload in parallel</p>
            </div>
          </div>
        </motion.div>

        <AnimatePresence initial={false}>
          {queue.length > 0 && (
            <motion.ul
              key="queue"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              aria-live="polite"
              className="flex flex-col gap-1.5 overflow-hidden"
            >
              <AnimatePresence initial={false}>
                {queue.map((item) => (
                  <motion.li
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 24 }}
                    transition={{ duration: 0.18 }}
                    className={cn(
                      'relative overflow-hidden rounded-lg border px-3 py-2',
                      item.status === 'error'
                        ? 'border-red-900/60 bg-red-950/30'
                        : 'border-zinc-800/80 bg-zinc-900/60',
                    )}
                  >
                    {item.status === 'uploading' && (
                      <motion.span
                        className="absolute inset-y-0 left-0 bg-accent-500/15"
                        initial={false}
                        animate={{ width: `${item.progress}%` }}
                        transition={{ ease: 'easeOut', duration: 0.2 }}
                      />
                    )}
                    <div className="relative flex items-center gap-2.5">
                      <StatusIcon status={item.status} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs text-zinc-200">{item.name}</p>
                        <p className="text-[11px] text-zinc-500">
                          {item.status === 'error' ? (
                            <span className="text-red-300">{item.error}</span>
                          ) : item.status === 'done' ? (
                            <span className="text-emerald-300">Uploaded</span>
                          ) : (
                            `${formatBytes(item.size)} · ${item.progress}%`
                          )}
                        </p>
                      </div>
                      {item.status === 'uploading' && (
                        <button
                          onClick={() => controllers.current.get(item.id)?.abort()}
                          aria-label={`Cancel upload of ${item.name}`}
                          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                      {item.status === 'error' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startUpload(item.id, item.file)}
                          title={`Retry ${item.name}`}
                        >
                          Retry
                        </Button>
                      )}
                      {item.status !== 'uploading' && (
                        <button
                          onClick={() => removeItem(item.id)}
                          aria-label={`Dismiss ${item.name}`}
                          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </motion.ul>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

function StatusIcon({ status }: { status: QueueItem['status'] }) {
  if (status === 'uploading')
    return <Loader2 className="size-4 shrink-0 animate-spin text-accent-300" />;
  if (status === 'done') return <Check className="size-4 shrink-0 text-emerald-400" />;
  return <TriangleAlert className="size-4 shrink-0 text-red-300" />;
}
