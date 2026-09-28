/**
 * Shared definitions for the "Write with AI" feature.
 *
 * One source of truth for both sides: the modal renders `label`/`hint`, the
 * server turns `prompt` into the generation directives. Because the server
 * validates ids against these same lists, a client can never smuggle its own
 * prose into the prompt — only the instruction/context text it controls
 * anyway.
 */

export interface WritingPreset {
  id: string;
  label: string;
  /** UI hint shown next to the label (word budget, etc). */
  hint?: string;
  /** Server-side fragment placed into the prompt. Never rendered as-is. */
  prompt: string;
}

export const WRITE_STYLES: WritingPreset[] = [
  {
    id: 'professional',
    label: 'Professional',
    prompt: 'Polished, confident business prose — clear, neutral, and to the point.',
  },
  {
    id: 'casual',
    label: 'Casual',
    prompt:
      'A relaxed conversational voice — contractions welcome, approachable, zero corporate stiffness.',
  },
  {
    id: 'academic',
    label: 'Academic',
    prompt: 'Formal analytical prose — precise terminology, measured claims, no filler.',
  },
  {
    id: 'creative',
    label: 'Creative',
    prompt: 'Vivid imaginative prose — sensory detail, original metaphors, rhythmic sentences.',
  },
  {
    id: 'persuasive',
    label: 'Persuasive',
    prompt: 'Argument-first copy — a sharp thesis, concrete reasons, and a closing call to action.',
  },
  {
    id: 'technical',
    label: 'Technical',
    prompt: 'Exact engineering prose — unambiguous steps, correct jargon, no hand-waving.',
  },
  {
    id: 'journalistic',
    label: 'Journalistic',
    prompt: 'Inverted-pyramid journalism — lead with the key fact, tight and neutral.',
  },
  {
    id: 'storytelling',
    label: 'Storytelling',
    prompt: 'Narrative prose — scene, character, and momentum pulling the reader forward.',
  },
];

export const WRITE_STRUCTURES: WritingPreset[] = [
  {
    id: 'paragraphs',
    label: 'Paragraphs',
    prompt: 'Flowing prose in well-proportioned paragraphs.',
  },
  {
    id: 'bullets',
    label: 'Bulleted list',
    prompt: 'A tight markdown bullet list — one idea per bullet, no fluff.',
  },
  {
    id: 'steps',
    label: 'Numbered steps',
    prompt: 'A numbered sequence of concrete, actionable steps.',
  },
  {
    id: 'outline',
    label: 'Outline',
    prompt: 'A hierarchical outline built from nested markdown bullets.',
  },
  {
    id: 'sections',
    label: 'Sections',
    prompt: 'Markdown sections under ## headings with short paragraphs beneath each.',
  },
  {
    id: 'table',
    label: 'Table',
    prompt:
      'A markdown table for comparative content; fall back to sections when a table would not fit.',
  },
];

export const WRITE_LENGTHS: WritingPreset[] = [
  { id: 'short', label: 'Short', hint: '~150 words', prompt: 'roughly 150 words' },
  { id: 'medium', label: 'Medium', hint: '~400 words', prompt: 'roughly 400 words' },
  { id: 'long', label: 'Long', hint: '~800 words', prompt: 'roughly 800 words' },
];

export interface WritingAction {
  id: string;
  label: string;
  /** Text the chip drops into the instruction box for the user to finish. */
  prefill: string;
  /** Chips about the existing note auto-enable the context toggle. */
  usesContext?: boolean;
}

export const WRITE_ACTIONS: WritingAction[] = [
  {
    id: 'draft',
    label: 'Draft from scratch',
    prefill: 'Write a compelling first draft about: ',
  },
  {
    id: 'continue',
    label: 'Continue writing',
    usesContext: true,
    prefill:
      "Continue this note naturally from where it stops — match the existing voice and don't repeat what is already there.",
  },
  {
    id: 'expand',
    label: 'Expand these points',
    usesContext: true,
    prefill:
      'Expand the note below into fuller prose: keep every point, add brief detail, and improve the flow.',
  },
  {
    id: 'rewrite',
    label: 'Rewrite in new style',
    usesContext: true,
    prefill: 'Rewrite the note in the selected style — same meaning and facts, fresh phrasing.',
  },
  {
    id: 'summarize',
    label: 'Summarize',
    usesContext: true,
    prefill: 'Summarize the note into a short, scannable brief with the key points only.',
  },
  {
    id: 'brainstorm',
    label: 'Brainstorm ideas',
    prefill: 'Brainstorm a list of distinct ideas and angles for: ',
  },
];

/** Allow-listed id lookup — `null` for anything not defined above. */
export function findPreset(list: WritingPreset[], id: string | undefined): WritingPreset | null {
  if (!id) return null;
  return list.find((preset) => preset.id === id) ?? null;
}
