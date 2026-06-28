import { createFileRoute } from '@tanstack/react-router';
import NoteEditor from '../components/NoteEditor';
import FileDropzone from '../components/FileDropzone';
import DocumentList from '../components/DocumentList';

export const Route = createFileRoute('/')({
  component: IndexComponent,
});

function IndexComponent() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="px-6 py-4">
        <span className="text-xs uppercase tracking-widest text-zinc-500 font-mono">notes</span>
      </header>
      <main className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-zinc-900/40">
        <section className="relative p-6 bg-zinc-950 min-h-[calc(100vh-4rem)]">
          <NoteEditor />
        </section>
        <section className="flex flex-col gap-6 p-6 bg-zinc-950 min-h-[calc(100vh-4rem)]">
          <FileDropzone />
          <DocumentList />
        </section>
      </main>
    </div>
  );
}
