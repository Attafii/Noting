/** Pure markdown editing helpers — no DOM, no React. Fully unit-tested. */

export interface TextSelection {
  start: number;
  end: number;
}

export interface EditResult {
  text: string;
  selection: TextSelection;
}

function clampSelection(text: string, sel: TextSelection): TextSelection {
  const start = Math.max(0, Math.min(sel.start, text.length));
  const end = Math.max(start, Math.min(sel.end, text.length));
  return { start, end };
}

function selectedOrPlaceholder(text: string, sel: TextSelection, placeholder: string): string {
  const slice = text.slice(sel.start, sel.end);
  return slice || placeholder;
}

/** Wrap selection with before/after (bold, italic, strike, code). */
export function applyWrap(
  text: string,
  sel: TextSelection,
  before: string,
  after: string,
  placeholder = 'text',
): EditResult {
  const s = clampSelection(text, sel);
  const inner = selectedOrPlaceholder(text, s, placeholder);
  const next = text.slice(0, s.start) + before + inner + after + text.slice(s.end);
  const cursor = s.start + before.length;
  return { text: next, selection: { start: cursor, end: cursor + inner.length } };
}

/** Prefix each selected line with `prefix` (headings, quotes, lists). Toggles when all lines already have it. */
export function applyLinePrefix(text: string, sel: TextSelection, prefix: string): EditResult {
  const s = clampSelection(text, sel);
  const lineStart = text.lastIndexOf('\n', s.start - 1) + 1;
  let lineEnd = text.indexOf('\n', Math.max(s.end - 1, 0));
  if (lineEnd === -1) lineEnd = text.length;
  const block = text.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const allHave = lines.every((l) => l.startsWith(prefix) || l.trim() === '');
  const nextLines = lines.map((l) => {
    if (l.trim() === '') return l;
    if (allHave) return l.startsWith(prefix) ? l.slice(prefix.length) : l;
    return l.startsWith(prefix) ? l : prefix + l;
  });
  const next = text.slice(0, lineStart) + nextLines.join('\n') + text.slice(lineEnd);
  const delta = next.length - text.length;
  return { text: next, selection: { start: s.start, end: s.end + delta } };
}

/** Set (or toggle off) a ATX heading level for each selected line. */
export function applyHeading(text: string, sel: TextSelection, level: 1 | 2 | 3): EditResult {
  const s = clampSelection(text, sel);
  const lineStart = text.lastIndexOf('\n', s.start - 1) + 1;
  let lineEnd = text.indexOf('\n', Math.max(s.end - 1, 0));
  if (lineEnd === -1) lineEnd = text.length;
  const block = text.slice(lineStart, lineEnd);
  const prefix = '#'.repeat(level) + ' ';
  const lines = block.split('\n');
  const nextLines = lines.map((l) => {
    if (l.trim() === '') return l;
    const stripped = l.replace(/^#{1,6}\s+/, '');
    // Toggle off when the line already has exactly this level.
    if (l.startsWith(prefix) && !l.startsWith(prefix + '#')) return stripped;
    return prefix + stripped;
  });
  const next = text.slice(0, lineStart) + nextLines.join('\n') + text.slice(lineEnd);
  const delta = next.length - text.length;
  return { text: next, selection: { start: s.start, end: s.end + delta } };
}

/** Toggle `- [ ]` / `- [x]` checklist prefix on selected lines. */
export function toggleChecklist(text: string, sel: TextSelection): EditResult {
  const s = clampSelection(text, sel);
  const lineStart = text.lastIndexOf('\n', s.start - 1) + 1;
  let lineEnd = text.indexOf('\n', Math.max(s.end - 1, 0));
  if (lineEnd === -1) lineEnd = text.length;
  const block = text.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const nextLines = lines.map((l) => {
    if (/^\s*-\s\[ \]/.test(l)) return l.replace(/-\s\[ \]/, '- [x]');
    if (/^\s*-\s\[x\]/i.test(l)) return l.replace(/-\s\[x\]/i, '- [ ]');
    if (/^\s*-\s+/.test(l)) return l.replace(/^(\s*-\s+)/, '$1[ ] ');
    if (l.trim() === '') return l;
    return `- [ ] ${l}`;
  });
  const next = text.slice(0, lineStart) + nextLines.join('\n') + text.slice(lineEnd);
  const delta = next.length - text.length;
  return { text: next, selection: { start: s.start, end: s.end + delta } };
}

/** Insert a fenced code block around the selection (or at cursor). */
export function insertCodeBlock(text: string, sel: TextSelection, lang = ''): EditResult {
  const s = clampSelection(text, sel);
  const inner = text.slice(s.start, s.end) || 'code';
  const block = '```' + lang + '\n' + inner + '\n```';
  const atLineStart = s.start === 0 || text[s.start - 1] === '\n';
  const before = atLineStart ? '' : '\n';
  const next = text.slice(0, s.start) + before + block + '\n' + text.slice(s.end);
  const cursor = s.start + before.length + 3 + lang.length + 1;
  return { text: next, selection: { start: cursor, end: cursor + inner.length } };
}

/** Insert a GFM table at the cursor. */
export function insertTable(text: string, sel: TextSelection, rows = 3, cols = 3): EditResult {
  const s = clampSelection(text, sel);
  const r = Math.max(1, Math.min(rows, 10));
  const c = Math.max(1, Math.min(cols, 6));
  const header = '| ' + Array.from({ length: c }, (_, i) => `Header ${i + 1}`).join(' | ') + ' |';
  const sep = '| ' + Array.from({ length: c }, () => '---').join(' | ') + ' |';
  const body = Array.from(
    { length: r },
    () => '| ' + Array.from({ length: c }, () => ' ').join(' | ') + ' |',
  ).join('\n');
  const table = `\n${header}\n${sep}\n${body}\n`;
  const next = text.slice(0, s.start) + table + text.slice(s.end);
  const cursor = s.start + table.length;
  return { text: next, selection: { start: cursor, end: cursor } };
}

/** Insert a markdown link around the selection. */
export function insertLink(text: string, sel: TextSelection, url = 'https://'): EditResult {
  const s = clampSelection(text, sel);
  const label = text.slice(s.start, s.end) || 'link text';
  const md = `[${label}](${url})`;
  const next = text.slice(0, s.start) + md + text.slice(s.end);
  const urlStart = s.start + label.length + 3;
  return { text: next, selection: { start: urlStart, end: urlStart + url.length } };
}

/** Insert arbitrary snippet at cursor (slash-menu completions). */
export function insertSnippet(text: string, sel: TextSelection, snippet: string): EditResult {
  const s = clampSelection(text, sel);
  const next = text.slice(0, s.start) + snippet + text.slice(s.end);
  const cursor = s.start + snippet.length;
  return { text: next, selection: { start: cursor, end: cursor } };
}

export interface HeadingEntry {
  level: 1 | 2 | 3;
  text: string;
  slug: string;
  line: number;
}

export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[`*_~[\]()#>!|,.;:'"/?\\]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Headings for the outline/TOC panel. */
export function extractHeadings(text: string): HeadingEntry[] {
  const out: HeadingEntry[] = [];
  const lines = text.split('\n');
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const m = /^(#{1,3})\s+(.+)\s*$/.exec(line);
    if (m) {
      const headingText = m[2].trim();
      if (headingText)
        out.push({
          level: m[1].length as 1 | 2 | 3,
          text: headingText,
          slug: slugify(headingText),
          line: i,
        });
    }
  });
  return out;
}

/** Inline #tags (ignores headings, fenced blocks, and URLs with fragments). */
export function extractTags(text: string): string[] {
  const found = new Set<string>();
  const lines = text.split('\n');
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // Strip heading markers so `# Title` is not treated as a tag.
    const body = line.replace(/^\s*#{1,6}\s+/, '');
    const re = /(^|\s)#([A-Za-z0-9][\w/-]{0,48})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      found.add(m[2].toLowerCase());
    }
  }
  return [...found].sort();
}

/** Reading time in whole minutes (200 wpm, minimum 1 when non-empty). */
export function readingMinutes(text: string, wordsPerMinute = 200): number {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  if (words === 0) return 0;
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}

/** Case-insensitive literal matches for find-in-note. */
export function findAllMatches(text: string, query: string): number[] {
  if (!query) return [];
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  const out: number[] = [];
  let from = 0;
  while (from <= hay.length) {
    const idx = hay.indexOf(needle, from);
    if (idx === -1) break;
    out.push(idx);
    from = idx + Math.max(1, needle.length);
  }
  return out;
}

export const SLASH_COMMANDS = [
  { key: 'h1', label: 'Heading 1', hint: '# ', snippet: '# ' },
  { key: 'h2', label: 'Heading 2', hint: '## ', snippet: '## ' },
  { key: 'h3', label: 'Heading 3', hint: '### ', snippet: '### ' },
  { key: 'todo', label: 'Checklist', hint: '- [ ]', snippet: '- [ ] ' },
  { key: 'bullet', label: 'Bullet list', hint: '-', snippet: '- ' },
  { key: 'code', label: 'Code block', hint: '```', snippet: '```\ncode\n```\n' },
  {
    key: 'table',
    label: 'Table 3x3',
    hint: 'GFM',
    snippet:
      '\n| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n|  |  |  |\n',
  },
  { key: 'quote', label: 'Quote', hint: '>', snippet: '> ' },
  { key: 'link', label: 'Link', hint: '[]()', snippet: '[link text](https://)' },
] as const;

export type SlashCommandKey = (typeof SLASH_COMMANDS)[number]['key'];
