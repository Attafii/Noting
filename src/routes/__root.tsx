import { createRootRoute, Outlet } from '@tanstack/react-router';

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
    <div className="bg-zinc-950 min-h-screen text-zinc-100 font-sans antialiased">
      <Outlet />
    </div>
  );
}
