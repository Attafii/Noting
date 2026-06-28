import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { bridgeHeaders } from '../lib/token';

export default function FileDropzone() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: bridgeHeaders(),
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Upload failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setTimeout(() => setError(null), 3000);
    },
  });

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (file.size > 4.5 * 1024 * 1024) {
      setError('File too large (max 4.5MB)');
      setTimeout(() => setError(null), 3000);
      return;
    }
    upload.mutate(file);
  }

  return (
    <div
      className="border-dashed border-2 border-zinc-800 rounded-xl flex flex-col items-center justify-center py-10 transition-colors duration-200 hover:border-zinc-600 cursor-pointer"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleFiles(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {upload.isPending ? (
        <div className="flex flex-col items-center gap-2">
          {/* Inline SVG spinner */}
          <svg className="animate-spin h-6 w-6 text-zinc-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-sm text-zinc-500">Uploading...</span>
        </div>
      ) : error ? (
        <span className="text-sm text-red-400">{error}</span>
      ) : (
        <div className="flex flex-col items-center gap-2">
          {/* Inline SVG upload icon */}
          <svg className="h-6 w-6 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <span className="text-sm text-zinc-500">Drop file or click to browse</span>
        </div>
      )}
    </div>
  );
}
