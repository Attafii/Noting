import { useCallback, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { motion } from 'motion/react';
import DocumentList from '../components/DocumentList';
import FileDropzone from '../components/FileDropzone';
import NoteEditor from '../components/NoteEditor';
import { TokenGate } from '../components/TokenGate';
import { TopBar } from '../components/TopBar';
import { clearToken, getToken } from '../lib/token';
import { useGlobalShortcuts } from '../lib/shortcuts';

export const Route = createFileRoute('/')({
  component: IndexComponent,
});

function IndexComponent() {
  const [token, setToken] = useState<string | null>(() => getToken());
  useGlobalShortcuts();

  const handleUnauthorized = useCallback(() => {
    clearToken();
    setToken(null);
  }, []);

  const handleTokenSaved = useCallback((value: string) => {
    setToken(value);
  }, []);

  if (!token) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <AmbientBackground />
        <TokenGate onSaved={handleTokenSaved} />
      </div>
    );
  }

  return (
    <div key={token} className="min-h-screen bg-zinc-950 text-zinc-100">
      <AmbientBackground />
      <TopBar />
      <main className="mx-auto grid max-w-6xl grid-cols-1 items-start gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[1.12fr_1fr]">
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="min-h-0"
        >
          <NoteEditor onUnauthorized={handleUnauthorized} />
        </motion.section>
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.09, ease: [0.22, 1, 0.36, 1] }}
          className="flex min-h-0 flex-col gap-4"
        >
          <FileDropzone onUnauthorized={handleUnauthorized} />
          <DocumentList onUnauthorized={handleUnauthorized} />
        </motion.section>
      </main>
    </div>
  );
}

/** Stealth-safe ambience: a faint top glow, no gradients-for-show. */
function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,rgb(63_63_70/0.22),transparent)]" />
    </div>
  );
}
