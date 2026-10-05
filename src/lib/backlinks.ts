/**
 * `[[wikilink]]` graph helpers. Link targets resolve against note titles
 * (case-insensitive exact match). Only plaintext notes participate —
 * `search_text` is null server-side for encrypted notes, so ciphertext never
 * leaks into the graph.
 */

import type { NoteSummary } from './api';

const WIKILINK = /\[\[([^[\]\n]{1,120})\]\]/g;

/** Unique link targets in the order they first appear. */
export function extractWikilinks(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(WIKILINK)) {
    const target = (match[1] ?? '').trim();
    if (!target) continue;
    const key = target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

function sameTitle(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Resolve a link target to a note, or null when the target does not exist. */
export function resolveLink(target: string, notes: NoteSummary[]): NoteSummary | null {
  return notes.find((note) => sameTitle(note.title, target)) ?? null;
}

/** Notes this note links out to (its own `[[targets]]`, resolved). */
export function outgoingLinks(note: NoteSummary, notes: NoteSummary[]): NoteSummary[] {
  const out: NoteSummary[] = [];
  for (const target of extractWikilinks(note.search_text)) {
    const resolved = resolveLink(target, notes);
    if (resolved && resolved.id !== note.id && !out.some((n) => n.id === resolved.id)) {
      out.push(resolved);
    }
  }
  return out;
}

/** Notes whose body links to this note's title. */
export function backlinksFor(note: NoteSummary, notes: NoteSummary[]): NoteSummary[] {
  const title = note.title.trim().toLowerCase();
  if (!title) return [];
  return notes.filter(
    (other) =>
      other.id !== note.id &&
      extractWikilinks(other.search_text).some((target) => sameTitle(target, title)),
  );
}

/** Titles shorter than this are skipped for mention matching (noise guard). */
export const MIN_MENTION_TITLE = 3;

export interface UnlinkedMention {
  note: NoteSummary;
  /** Context around the first plain-text mention (whitespace-collapsed, ellipsized). */
  snippet: string;
  /** Where the matched title starts inside `snippet`. */
  matchStart: number;
  /** Length of the highlighted match inside `snippet`. */
  matchLength: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Case-insensitive mention pattern with word-style boundaries that also work
 * for titles starting/ending in punctuation ("C++", "(draft)"): the neighbors
 * of the title must not be word characters.
 */
function mentionPattern(title: string): RegExp {
  return new RegExp(`(?<![\\w])${escapeRegExp(title)}(?![\\w])`, 'i');
}

function snippetFor(text: string, match: RegExpExecArray): Omit<UnlinkedMention, 'note'> {
  const index = match.index;
  const start = Math.max(0, index - 36);
  const end = Math.min(text.length, index + match[0].length + 44);
  const clean = (value: string) => value.replace(/\s+/g, ' ');
  const before = clean(text.slice(start, index));
  const core = clean(match[0]);
  const after = clean(text.slice(index + match[0].length, end));
  const lead = start > 0 ? '…' : '';
  const trail = end < text.length ? '…' : '';
  return {
    snippet: lead + before + core + after + trail,
    matchStart: lead.length + before.length,
    matchLength: core.length,
  };
}

/**
 * Notes that mention this note's title in plain text *without* wrapping it in
 * `[[…]]` — candidates for one-click linking. Excludes self, already-linked
 * notes, and encrypted bodies (`search_text` is null server-side). Sorted by
 * most-recently-updated first.
 */
export function unlinkedMentions(note: NoteSummary, notes: NoteSummary[]): UnlinkedMention[] {
  const title = note.title.trim();
  if (title.length < MIN_MENTION_TITLE) return [];
  const pattern = mentionPattern(title);
  const out: UnlinkedMention[] = [];
  for (const other of notes) {
    if (other.id === note.id) continue;
    const text = other.search_text;
    if (!text) continue;
    if (extractWikilinks(text).some((target) => sameTitle(target, title))) continue;
    const match = pattern.exec(text);
    if (!match) continue;
    out.push({ note: other, ...snippetFor(text, match) });
  }
  out.sort((a, b) => b.note.updated_at.localeCompare(a.note.updated_at));
  return out;
}

/**
 * Wrap the first plain-text occurrence of `title` in `[[…]]`, preserving the
 * text's original casing (link resolution is case-insensitive). Occurrences
 * inside existing wikilinks are skipped so brackets never nest. Returns null
 * when there is nothing to wrap or the title itself contains brackets.
 */
export function wrapFirstMention(content: string, title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed || trimmed.includes('[') || trimmed.includes(']')) return null;
  const pattern = mentionPattern(trimmed);
  // Mask existing [[wikilinks]] with same-length spaces so boundary checks and
  // the index map stay aligned with the original content.
  let masked = '';
  let cursor = 0;
  for (const match of content.matchAll(WIKILINK)) {
    const at = match.index ?? 0;
    masked += content.slice(cursor, at) + match[0].replace(/[^\n]/g, ' ');
    cursor = at + match[0].length;
  }
  masked += content.slice(cursor);
  const match = pattern.exec(masked);
  if (!match) return null;
  const at = match.index;
  const length = match[0].length;
  return (
    content.slice(0, at) + '[[' + content.slice(at, at + length) + ']]' + content.slice(at + length)
  );
}
