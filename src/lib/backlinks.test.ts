import { describe, expect, it } from 'vitest';
import type { NoteSummary } from './api';
import {
  backlinksFor,
  extractWikilinks,
  MIN_MENTION_TITLE,
  outgoingLinks,
  resolveLink,
  unlinkedMentions,
  wrapFirstMention,
} from './backlinks';

function note(
  id: number,
  title: string,
  search: string | null = null,
  updatedAt = '2026-10-05T10:00:00.000Z',
): NoteSummary {
  return {
    id,
    title,
    pinned: false,
    archived: false,
    enc: search === null,
    content_version: 1,
    folder_id: null,
    favorite: false,
    due_at: null,
    updated_at: updatedAt,
    created_at: '2026-10-01T10:00:00.000Z',
    preview: '',
    search_text: search,
    tags: [],
  };
}

describe('extractWikilinks', () => {
  it('extracts unique targets in order, trimmed and case-stable', () => {
    const text = 'See [[Project Alpha]] and [[project alpha]] plus [[  Ideas  ]].';
    expect(extractWikilinks(text)).toEqual(['Project Alpha', 'Ideas']);
  });

  it('ignores empty links, skips broken nesting, and handles null text', () => {
    expect(extractWikilinks('[[ ]] [[a[[b]]c]]')).toEqual(['b']);
    expect(extractWikilinks(null)).toEqual([]);
  });
});

describe('graph resolution', () => {
  const alpha = note(1, 'Project Alpha', 'Intro [[Meeting Notes]] end');
  const meeting = note(2, 'Meeting Notes', 'Links back to [[project alpha]] here');
  const encrypted = note(3, 'Secret', null);
  const notes = [alpha, meeting, encrypted];

  it('resolves titles case-insensitively', () => {
    expect(resolveLink('PROJECT ALPHA', notes)?.id).toBe(1);
    expect(resolveLink('Missing', notes)).toBeNull();
  });

  it('finds outgoing links from plaintext bodies', () => {
    expect(outgoingLinks(alpha, notes).map((n) => n.id)).toEqual([2]);
  });

  it('finds backlinks regardless of link casing', () => {
    expect(backlinksFor(alpha, notes).map((n) => n.id)).toEqual([2]);
    expect(backlinksFor(meeting, notes).map((n) => n.id)).toEqual([1]);
  });

  it('never treats encrypted notes as link sources', () => {
    expect(outgoingLinks(encrypted, notes)).toEqual([]);
    expect(backlinksFor(encrypted, notes)).toEqual([]);
  });

  it('excludes self-references', () => {
    const selfLinked = note(4, 'Loop', '[[Loop]]');
    expect(backlinksFor(selfLinked, [selfLinked])).toEqual([]);
    expect(outgoingLinks(selfLinked, [selfLinked])).toEqual([]);
  });
});

describe('unlinkedMentions', () => {
  const alpha = note(1, 'Project Alpha', 'Body of alpha');
  const plain = note(2, 'Notes', 'Mentions Project Alpha in passing.', '2026-10-05T12:00:00.000Z');
  const older = note(3, 'Older', 'Also mentions project alpha.', '2026-10-04T12:00:00.000Z');

  it('finds plain-text mentions, case-insensitively, newest first', () => {
    const found = unlinkedMentions(alpha, [alpha, plain, older]);
    expect(found.map((m) => m.note.id)).toEqual([2, 3]);
    expect(found[0]?.snippet).toContain('Project Alpha');
    const { snippet, matchStart, matchLength } = found[0]!;
    expect(snippet.slice(matchStart, matchStart + matchLength)).toBe('Project Alpha');
  });

  it('requires word boundaries around the title', () => {
    const plan = note(1, 'Plan', 'Body');
    expect(unlinkedMentions(plan, [note(2, 'A', 'we explain things')])).toEqual([]);
    expect(unlinkedMentions(plan, [note(2, 'A', 'the plan is set')])).toHaveLength(1);
    const alphaShort = note(1, 'Alpha', 'Body');
    expect(unlinkedMentions(alphaShort, [note(2, 'A', 'Alphabet soup')])).toEqual([]);
  });

  it('skips titles under the minimum length', () => {
    const tiny = note(1, 'AI', 'Body');
    expect(MIN_MENTION_TITLE).toBeGreaterThan(2);
    expect(unlinkedMentions(tiny, [note(2, 'A', 'AI is neat')])).toEqual([]);
  });

  it('skips self, already-linked notes, and encrypted bodies', () => {
    const self = note(1, 'Project Alpha', 'mentions Project Alpha');
    expect(unlinkedMentions(self, [self])).toEqual([]);
    const linked = note(2, 'Linked', 'See [[Project Alpha]] here');
    expect(unlinkedMentions(alpha, [alpha, linked])).toEqual([]);
    const encrypted = note(3, 'Secret', null);
    expect(unlinkedMentions(alpha, [alpha, encrypted])).toEqual([]);
  });

  it('matches titles with regex-special characters', () => {
    const cpp = note(1, 'C++ notes', 'Body');
    expect(unlinkedMentions(cpp, [note(2, 'A', 'read C++ notes today')])).toHaveLength(1);
    expect(unlinkedMentions(cpp, [note(2, 'A', 'read C notes today')])).toEqual([]);
    const draft = note(1, '(draft)', 'Body');
    expect(unlinkedMentions(draft, [note(2, 'A', 'see (draft) plan')])).toHaveLength(1);
  });
});

describe('wrapFirstMention', () => {
  it('wraps the first plain occurrence, preserving original casing', () => {
    expect(wrapFirstMention('See Project alpha now', 'Project Alpha')).toBe(
      'See [[Project alpha]] now',
    );
  });

  it('never nests inside an existing wikilink, but wraps later plain ones', () => {
    expect(wrapFirstMention('Only [[Alpha]] here', 'Alpha')).toBeNull();
    expect(wrapFirstMention('x [[Alpha]] y Alpha', 'Alpha')).toBe('x [[Alpha]] y [[Alpha]]');
  });

  it('leaves boundaries alone and rejects bracketed titles', () => {
    expect(wrapFirstMention('Alphabet only', 'Alpha')).toBeNull();
    expect(wrapFirstMention('see a[b] here', 'a[b]')).toBeNull();
    expect(wrapFirstMention('nothing to do', 'Missing')).toBeNull();
  });
});
