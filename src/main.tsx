/* eslint-disable react-refresh/only-export-components -- app entry point, no components exported */
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import './styles.css';
import { initTheme } from './lib/theme';
import { AppErrorBoundary } from './components/AppErrorBoundary';

// Apply persisted theme before first paint (avoids a dark→light flash).
initTheme();

// Dev-only query inspector — never bundled into production (lazy + DEV gate).
const Devtools = lazy(() =>
  import('@tanstack/react-query-devtools').then((module) => ({
    default: module.ReactQueryDevtools,
  })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <RouterProvider router={router} />
        {import.meta.env.DEV && (
          <Suspense fallback={null}>
            <Devtools initialIsOpen={false} />
          </Suspense>
        )}
      </AppErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
