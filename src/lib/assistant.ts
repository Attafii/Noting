/**
 * Client-side assistant constants. The server keeps its own copy in
 * `api/_assistant-guide.ts` (system-prompt ground truth) — this module only
 * feeds UI affordances, so it never imports server code.
 */

/** Starter prompts on the Help-mode empty state. */
export const HELP_SUGGESTIONS: readonly string[] = [
  'How do I make a note recur every week?',
  'What does Ctrl+K do?',
  'How does end-to-end encryption work here?',
  'Where can I see my writing streak?',
] as const;

/** Starter prompts on the My-notes-mode empty state. */
export const NOTES_SUGGESTIONS: readonly string[] = [
  'What have I written about this week?',
  'Find my notes about a trip or travel',
  'Summarize my ideas for a side project',
] as const;
