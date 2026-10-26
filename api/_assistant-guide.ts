import { DEFAULT_BINDINGS, SHORTCUT_LABELS, formatBinding } from '../src/lib/shortcuts-core.js';

/**
 * Noting's product guide — the ground truth the assistant's HELP mode is
 * prompted with. Pure data + one builder (unit-tested in
 * `assistant-guide.test.ts`): no DB, no model, no user data.
 *
 * Accuracy rules for the model are enforced in `_route-assistant.ts`; this
 * module only guarantees the guide itself stays current with the shortcut
 * table (`shortcuts-core.ts`) so the assistant can never invent a wrong
 * keybinding.
 */

const FEATURES: Array<{ area: string; facts: string[] }> = [
  {
    area: 'Notes & editor',
    facts: [
      'Markdown editor with Write / Preview / Split views (toggle with the preview shortcut).',
      'Slash commands: /h1 /h2 /h3 /todo /code /quote /hr /table.',
      'Toolbar, outline panel, find-and-replace, word goals, reading time, and focus mode.',
      'Autosave (0.5s / 1s / 2s configurable in Settings); force a save with the save shortcut.',
      'Version history keeps the last 50 revisions per note; one-click restore.',
      'Templates and per-note export (.md / .html / print / PDF / duplicate).',
    ],
  },
  {
    area: 'Organization',
    facts: [
      'Folders with note counts; deleting a folder leaves its notes Unfiled, never deleted.',
      'Inline #tags and [[wikilinks]]; links panel shows backlinks and unlinked mentions.',
      'Favorites, pins, drag-to-reorder, and a 30-day trash with restore.',
      'Global fuzzy search via the command palette — titles, previews, and tags, typo-tolerant.',
    ],
  },
  {
    area: 'Planner & reminders',
    facts: [
      'Home tabs: overview dashboard, calendar (drag to reschedule), kanban board (To do / In progress / Done).',
      'Per-note due dates, recurrence (daily / weekly / monthly), 1d / 7d snooze, due badges.',
      'Browser notifications are opt-in (Settings); an in-app toast always fires.',
      'Writing streak and daily word goal live on the Home dashboard.',
    ],
  },
  {
    area: 'Files & AI',
    facts: [
      'Upload files (4.5 MB each); text/markdown/CSV/JSON are indexed for search.',
      'Ask tab: questions over files, notes, or both, with cited sources.',
      'Format with AI and Write with AI (presets for style/structure/length).',
      'A daily AI call budget exists; hitting it returns a friendly limit message.',
    ],
  },
  {
    area: 'Privacy & sharing',
    facts: [
      'Optional end-to-end encryption (AES-GCM) for note bodies and file bytes — encrypted content never leaves the browser plaintext.',
      'Encrypted notes/files are excluded from search, Ask, AI, and this assistant by design.',
      'Read-only share links (/s?t=…) for plaintext notes: 1–30 days, revocable, only hashes stored.',
      'Sessions are short-lived HttpOnly cookies; tokens and answers live in tab memory only.',
      'Recovery codes are one-time; there is no email reset — losing token + answer loses the data.',
    ],
  },
  {
    area: 'Interface',
    facts: [
      'Themes: dark / light; accents: ember (default), gold, emerald, cobalt; comfortable / compact density.',
      'Ambient motion (Settings → Appearance) controls the ink-and-ember shader on welcome/unlock/invite.',
      'Mobile: bottom bar navigation; desktop: collapsible sidebar.',
      'Installable PWA; encrypted edits queue offline and replay on reconnect.',
    ],
  },
];

function shortcutLines(): string[] {
  return (Object.keys(DEFAULT_BINDINGS) as Array<keyof typeof DEFAULT_BINDINGS>).map((id) => {
    const binding = DEFAULT_BINDINGS[id];
    return `- ${formatBinding(binding)} — ${SHORTCUT_LABELS[id]}`;
  });
}

/** Full help-mode guide text, embedded into the system prompt. */
export function buildHelpGuide(): string {
  const sections = FEATURES.map((f) => `### ${f.area}\n${f.facts.map((x) => `- ${x}`).join('\n')}`);
  return [...sections, `### Default keyboard shortcuts\n${shortcutLines().join('\n')}`].join(
    '\n\n',
  );
}

/**
 * Starter prompts shown on the assistant's empty state (kept tiny and
 * representative — they must be answerable from the guide or note search).
 */
export const SUGGESTED_PROMPTS: readonly string[] = [
  'How do I make a note recur every week?',
  'What does Ctrl+K do?',
  'How does end-to-end encryption work here?',
  'Where can I see my writing streak?',
] as const;
