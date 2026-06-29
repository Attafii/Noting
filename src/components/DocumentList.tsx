import { useQuery } from '@tanstack/react-query';
import { bridgeHeaders, getToken } from '../lib/token';

interface Document {
  id: number;
  file_name: string;
  file_type: string;
  uploaded_at: string;
}

export default function DocumentList() {
  const { data, isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: async () => {
      const res = await fetch('/api/documents', { headers: bridgeHeaders() });
      if (!res.ok) throw new Error('Failed to load documents');
      return res.json() as Promise<Document[]>;
    },
  });

  if (isLoading) {
    return (
      <div className="flex-1 bg-zinc-900/50 rounded-xl border border-zinc-800/60 flex items-center justify-center">
        <span className="text-sm text-zinc-500">Loading...</span>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex-1 bg-zinc-900/50 rounded-xl border border-zinc-800/60 flex items-center justify-center">
        <span className="text-sm text-zinc-500">No documents</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-2 overflow-y-auto max-h-[50vh]">
      {data.map((doc) => (
        <div
          key={doc.id}
          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/60 hover:border-zinc-700/60 transition-colors"
        >
          <span className="inline-flex h-8 w-8 items-center justify-center text-zinc-500">
            {/* Inline SVG file icon */}
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-zinc-200 truncate font-mono">{doc.file_name}</div>
            <div className="text-xs text-zinc-500">{doc.file_type}</div>
          </div>
          <a
            href={`/api/download?id=${doc.id}&token=${getToken()}`}
            download={doc.file_name}
            className="inline-flex h-8 w-8 items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {/* Inline SVG download icon */}
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
          </a>
        </div>
      ))}
    </div>
  );
}
