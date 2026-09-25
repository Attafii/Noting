import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { hasPendingMutations } from '../lib/outbox';
import { Button } from './ui/button';

export function PwaUpdatePrompt() {
  const [waiting, setWaiting] = useState(false);
  const [update, setUpdate] = useState<(() => void) | null>(null);

  useEffect(() => {
    let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
    const registered = registerSW({
      immediate: true,
      onNeedRefresh() {
        setUpdate(() => () => {
          void applyUpdate?.(true);
        });
        setWaiting(true);
      },
    });
    applyUpdate = registered;
    return () => {
      void registered?.();
    };
  }, []);

  if (!waiting || !update) return null;
  return (
    <div className="fixed right-4 bottom-20 z-40 flex items-center gap-3 rounded-xl border border-accent-600/40 bg-zinc-900 px-3 py-2 shadow-xl">
      <span className="text-xs text-zinc-200">A new version is ready.</span>
      <Button
        size="sm"
        variant="accent"
        onClick={() => {
          void (async () => {
            if (await hasPendingMutations()) {
              const proceed = window.confirm(
                'Pending offline edits are still stored. Update anyway?',
              );
              if (!proceed) return;
            }
            update();
          })();
        }}
      >
        Update
      </Button>
    </div>
  );
}
