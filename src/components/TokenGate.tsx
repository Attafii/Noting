import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { KeyRound, SquareTerminal } from 'lucide-react';
import { toast } from 'sonner';
import { setToken } from '../lib/token';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Input } from './ui/input';

interface TokenGateProps {
  onSaved: (token: string) => void;
}

export function TokenGate({ onSaved }: TokenGateProps) {
  const [value, setValue] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const token = value.trim();
    if (!token) {
      toast.error('Paste your access token first');
      return;
    }
    setToken(token);
    onSaved(token);
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm"
      >
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700/70 bg-zinc-900 text-zinc-300">
            <SquareTerminal className="size-4" />
          </span>
          <span className="font-mono text-xs tracking-[0.22em] text-zinc-300 uppercase">notes</span>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-accent-600/40 bg-accent-500/10 text-accent-300">
                <KeyRound className="size-4" />
              </span>
              <div>
                <h1 className="text-sm font-semibold text-zinc-100">Access required</h1>
                <p className="text-xs text-zinc-500">This workspace is token-gated.</p>
              </div>
            </div>
            <p className="text-[13px] leading-relaxed text-zinc-400">
              Open your personal link ending in{' '}
              <code className="rounded bg-zinc-800 px-1 font-mono text-xs text-zinc-200">
                ?token=…
              </code>{' '}
              and you&apos;ll pass through automatically — or paste the token below.
            </p>
            <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste access token"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-label="Access token"
              />
              <Button type="submit" variant="accent">
                Unlock workspace
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
