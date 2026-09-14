import { createFileRoute, Link } from '@tanstack/react-router';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Command,
  FolderHeart,
  Lock,
  Search,
  SplitSquareHorizontal,
  Tags,
} from 'lucide-react';

export const Route = createFileRoute('/welcome')({
  component: WelcomePage,
});

const EASE = [0.22, 1, 0.36, 1] as const;

function WelcomePage() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5 sm:px-6">
        <span className="font-mono text-xs tracking-[0.22em] text-zinc-300 uppercase">notes</span>
        <Link
          to="/"
          className="flex items-center gap-1.5 rounded-lg bg-accent-500 px-3.5 py-2 text-sm font-medium text-zinc-950 transition-transform hover:brightness-110 active:translate-y-px"
        >
          Open the app <ArrowRight className="size-4" />
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="pt-10"
        >
          <h1 className="max-w-xl text-4xl leading-[1.05] font-semibold tracking-tight text-zinc-100 md:text-5xl">
            A quiet place for loud thoughts.
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-zinc-400">
            Autosaving notes, files, and answers in one private workspace. No feeds, no streaks
            shouting at you — just capture and continue.
          </p>
          <div className="mt-6 flex items-center gap-2">
            <Link
              to="/"
              className="flex items-center gap-1.5 rounded-lg bg-accent-500 px-4 py-2.5 text-sm font-medium text-zinc-950 transition-transform hover:brightness-110 active:translate-y-px"
            >
              Start writing <ArrowRight className="size-4" />
            </Link>
            <a
              href="#how"
              className="rounded-lg border border-zinc-800 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
            >
              How it works
            </a>
          </div>
        </motion.div>

        <div id="how" className="mt-16 flex scroll-mt-8 flex-col gap-3">
          <Feature
            index={0}
            icon={<Command className="size-4" />}
            title="Jump anywhere with Ctrl+K"
            body="Fuzzy search across notes, tags, and files. Titles, previews, and #tags are one keystroke away — even with typos."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Feature
              index={1}
              icon={<SplitSquareHorizontal className="size-4" />}
              title="Write and preview side by side"
              body="Toolbar, slash commands, outline, find-and-replace, word goals, and a focus mode that gets out of the way."
            />
            <Feature
              index={2}
              icon={<FolderHeart className="size-4" />}
              title="Folders, favorites, and trash"
              body="File notes into folders, star what matters, drag to reorder. Deleted notes rest in trash for 30 days."
            />
            <Feature
              index={3}
              icon={<Tags className="size-4" />}
              title="#Tags and [[links]]"
              body="Tag inline, link notes wiki-style, and hop between them from the preview or the palette."
            />
            <Feature
              index={4}
              icon={<Search className="size-4" />}
              title="Ask your documents"
              body="Upload files and ask questions with cited answers. Private by default."
            />
            <Feature
              index={5}
              icon={<Lock className="size-4" />}
              title="Encrypted when it counts"
              body="Optional end-to-end encryption keeps note bodies and file bytes readable only in your browser."
            />
          </div>
        </div>

        <footer className="mt-16 flex items-center justify-between border-t border-zinc-800/70 pt-5 font-mono text-[11px] text-zinc-600">
          <span>notes · cross-device bridge</span>
          <Link to="/" className="hover:text-zinc-300">
            Open the app →
          </Link>
        </footer>
      </main>
    </div>
  );
}

function Feature({
  index,
  icon,
  title,
  body,
}: {
  index: number;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.45, delay: Math.min(index * 0.05, 0.2), ease: EASE }}
      className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-5"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700/70 bg-zinc-900 text-accent-300">
        {icon}
      </span>
      <h2 className="mt-3 text-[15px] font-semibold text-zinc-100">{title}</h2>
      <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-zinc-400">{body}</p>
    </motion.div>
  );
}
