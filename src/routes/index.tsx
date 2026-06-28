import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: IndexComponent,
});

function IndexComponent() {
  return (
    <div className="p-6">
      <p className="text-zinc-500">Dashboard placeholder</p>
    </div>
  );
}
