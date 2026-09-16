import { Suspense, lazy, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, FileWarning, Loader2, Lock, X } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, fetchDocumentBlob, triggerBlobDownload, type DocumentMeta } from '../lib/api';
import { useFocusTrap } from '../lib/focus-trap';
import { formatBytes } from '../lib/format';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Skeleton } from './ui/skeleton';

const MarkdownView = lazy(() =>
  import('./MarkdownView').then((module) => ({ default: module.MarkdownView })),
);

interface PreviewModalProps {
  doc: DocumentMeta | null;
  onClose: () => void;
  onUnauthorized: () => void;
  /**
   * E2E decryptor (Wave C): turns stored ciphertext bytes into cleartext.
   * Absent → encrypted files show an explanatory notice instead of a preview.
   */
  decrypt?: (data: Uint8Array) => Promise<Uint8Array>;
}

interface LoadedFile {
  url: string;
  blob: Blob;
  text: string | null;
}

export function PreviewModal({ doc, onClose, onUnauthorized, decrypt }: PreviewModalProps) {
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const panelRef = useFocusTrap<HTMLDivElement>(doc !== null);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;

    (async () => {
      try {
        const fetched = await fetchDocumentBlob(doc.id);
        let bytes: Uint8Array = new Uint8Array(await fetched.blob.arrayBuffer());
        if (fetched.enc) {
          if (!decrypt) {
            if (!cancelled) {
              setError('encrypted');
              setLoading(false);
            }
            return;
          }
          bytes = await decrypt(bytes);
        }
        if (cancelled) return;
        // Copy into a fresh ArrayBuffer-backed view (BlobPart requirement).
        const view = new Uint8Array(bytes.length);
        view.set(bytes);
        const clearBlob = new Blob([view], { type: fetched.fileType });
        setFile({
          url: URL.createObjectURL(clearBlob),
          blob: clearBlob,
          text: isTextual(fetched.fileType, fetched.fileName)
            ? new TextDecoder().decode(bytes.slice(0, 200_000))
            : null,
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
          onUnauthorized();
          return;
        }
        setError(err instanceof Error ? err.message : 'Preview failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc, decrypt, onUnauthorized]);

  // Revoke the object URL when the modal closes or the file changes.
  useEffect(() => {
    const url = file?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [file?.url]);

  // Close on Escape.
  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, onClose]);

  function handleDownload() {
    if (!doc || !file) return;
    triggerBlobDownload(file.blob, doc.file_name);
    toast.success('Download started');
  }

  return (
    <AnimatePresence>
      {doc && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${doc.file_name}`}
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
            className="flex max-h-[86vh] w-full max-w-3xl flex-col"
          >
            <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex items-center gap-3 border-b border-zinc-800/70 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[13px] text-zinc-100">{doc.file_name}</p>
                  <p className="text-[11px] text-zinc-500">
                    {formatBytes(Number(doc.file_size) || 0)} · {doc.file_type}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={handleDownload} disabled={!file}>
                  <Download />
                  Download
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={onClose} title="Close preview">
                  <X />
                </Button>
              </div>
              <CardContent className="min-h-0 flex-1 overflow-auto p-0">
                {loading && (
                  <div className="flex flex-col items-center justify-center gap-3 p-14">
                    <Loader2 className="size-5 animate-spin text-zinc-500" />
                    <p className="text-xs text-zinc-500">Loading preview…</p>
                  </div>
                )}
                {!loading && error === 'encrypted' && (
                  <div className="flex flex-col items-center justify-center gap-2.5 p-14 text-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-accent-600/40 bg-accent-500/10 text-accent-300">
                      <Lock className="size-4" />
                    </span>
                    <p className="text-sm text-zinc-300">This file is end-to-end encrypted</p>
                    <p className="max-w-xs text-xs text-zinc-500">
                      Enable decryption in Settings to preview it here. Downloads always carry the
                      original file.
                    </p>
                  </div>
                )}
                {!loading && error && error !== 'encrypted' && (
                  <div className="flex flex-col items-center justify-center gap-2.5 p-14 text-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-red-900/70 bg-red-950/50 text-red-300">
                      <FileWarning className="size-4" />
                    </span>
                    <p className="text-sm text-zinc-300">Preview unavailable</p>
                    <p className="text-xs text-zinc-500">{error}</p>
                  </div>
                )}
                {!loading && !error && file && (
                  <PreviewBody
                    url={file.url}
                    text={file.text}
                    fileType={doc.file_type}
                    fileName={doc.file_name}
                    onDownload={handleDownload}
                  />
                )}
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function isTextual(mime: string, name: string): boolean {
  if (mime.startsWith('text/')) return true;
  if (mime.includes('json') || mime.includes('xml') || mime.includes('javascript')) return true;
  return /\.(md|markdown|txt|csv|tsv|json|jsonl|log|yaml|yml|xml|html?|css|js|ts|tsx|py|rs|go|sh)$/i.test(
    name,
  );
}

function PreviewBody({
  url,
  text,
  fileType,
  fileName,
  onDownload,
}: {
  url: string;
  text: string | null;
  fileType: string;
  fileName: string;
  onDownload: () => void;
}) {
  if (fileType.startsWith('image/')) {
    return (
      <div className="flex items-center justify-center bg-zinc-950/60 p-4">
        <img src={url} alt={fileName} className="max-h-[68vh] rounded-lg object-contain" />
      </div>
    );
  }
  if (fileType === 'application/pdf') {
    return (
      <iframe
        src={url}
        title={fileName}
        sandbox="allow-same-origin"
        loading="lazy"
        className="h-[68vh] w-full bg-zinc-100"
      />
    );
  }
  if (text !== null) {
    if (/\.md$/i.test(fileName) || fileType.includes('markdown')) {
      return (
        <div className="markdown-body max-h-[68vh] overflow-y-auto px-5 py-4">
          <Suspense
            fallback={
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-full" />
              </div>
            }
          >
            <MarkdownView text={text} />
          </Suspense>
        </div>
      );
    }
    return (
      <pre className="max-h-[68vh] overflow-auto px-5 py-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-300">
        {text}
      </pre>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 p-14 text-center">
      <p className="text-sm text-zinc-300">No inline preview for this file type</p>
      <Button size="sm" onClick={onDownload}>
        <Download />
        Download to view
      </Button>
    </div>
  );
}
