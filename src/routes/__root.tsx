import { createRootRoute, Outlet } from '@tanstack/react-router';
import { MotionConfig } from 'motion/react';
import { Toaster } from 'sonner';
import { useTheme } from '../lib/theme';
import { PwaUpdatePrompt } from '../components/PwaUpdatePrompt';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const theme = useTheme();
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-zinc-950 font-sans text-zinc-100 antialiased">
        <Outlet />
        <PwaUpdatePrompt />
        <Toaster
          theme={theme.mode}
          position="bottom-right"
          gap={8}
          toastOptions={{
            style: {
              background: theme.mode === 'dark' ? '#18181b' : '#ffffff',
              border: theme.mode === 'dark' ? '#3f3f46' : '#e7e5e4',
              color: theme.mode === 'dark' ? '#f4f4f5' : '#1c1917',
            },
          }}
        />
      </div>
    </MotionConfig>
  );
}
