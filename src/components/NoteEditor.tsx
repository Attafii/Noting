import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bridgeHeaders } from '../lib/token';

export default function NoteEditor() {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const initialized = useRef(false);

  const { data } = useQuery({
    queryKey: ['note'],
    queryFn: async () => {
      const res = await fetch('/api/note', { headers: bridgeHeaders() });
      if (!res.ok) throw new Error('Failed to load note');
      return res.json() as Promise<{ content: string; updated_at: string }>;
    },
  });

  useEffect(() => {
    if (data && !initialized.current) {
      setText(data.content);
      initialized.current = true;
    }
  }, [data]);

  const postNote = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch('/api/note', {
        method: 'POST',
        headers: bridgeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error('Failed to save');
      return res.json();
    },
  });

  const formatNote = useMutation({
    mutationFn: async (input: string) => {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: bridgeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text: input }),
      });
      if (!res.ok) throw new Error('Format failed');
      return res.json() as Promise<{ formatted: string }>;
    },
    onSuccess: (result) => {
      setText(result.formatted);
      queryClient.invalidateQueries({ queryKey: ['note'] });
    },
  });

  useEffect(() => {
    if (!initialized.current) return;
    const t = setTimeout(() => {
      postNote.mutate(text);
    }, 500);
    return () => clearTimeout(t);
  }, [text]);

  return (
    <div className="relative h-full bg-zinc-900/50 rounded-xl border border-zinc-800/60">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="absolute inset-0 w-full h-full bg-transparent p-6 font-mono text-sm text-zinc-200 resize-none focus:outline-none placeholder:text-zinc-600"
        placeholder="// scratchpad — autosaves every 500ms"
        spellCheck={false}
      />
      {/* Save indicator */}
      <div className="absolute top-3 right-3">
        {postNote.isPending && (
          <span className="text-xs text-zinc-500">Saving…</span>
        )}
        {postNote.isSuccess && !postNote.isPending && (
          <span className="text-xs text-zinc-500">Saved</span>
        )}
      </div>
      {/* Format button */}
      <button
        onClick={() => formatNote.mutate(text)}
        disabled={formatNote.isPending || text.length === 0}
        className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg text-xs font-mono text-zinc-300 bg-zinc-900/80 border border-zinc-800 hover:border-zinc-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {formatNote.isPending ? 'Formatting...' : 'Format with NIM'}
      </button>
    </div>
  );
}
