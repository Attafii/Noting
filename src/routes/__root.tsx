import { createRootRoute, Outlet } from '@tanstack/react-router';
import { MotionConfig } from 'motion/react';
import { Toaster } from 'sonner';

export const Route = createRootRoute({
  component: RootComponent,
  beforeLoad: () => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('token');
    if (token) {
      localStorage.setItem('bridge-token', token);
      window.history.replaceState({}, '', window.location.pathname);
    }
  },
});

function RootComponent() {
  return (
    // Honor the OS reduced-motion preference across all animations.
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-zinc-950 font-sans text-zinc-100 antialiased">
        <Outlet />
        <Toaster
          theme="dark"
          position="bottom-right"
          gap={8}
          toastOptions={{
            style: {
              background: '#18181b',
              border: '1px solid #3f3f46',
              color: '#f4f4f5',
            },
          }}
        />
      </div>
    </MotionConfig>
  );
}
