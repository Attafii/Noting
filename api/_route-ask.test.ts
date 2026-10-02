import type { VercelRequest, VercelResponse } from '@vercel/node';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { query, requireUser, rateLimit, aiConfigured, embedTexts, chatComplete } = vi.hoisted(
  () => ({
    query: vi.fn(),
    requireUser: vi.fn(),
    rateLimit: vi.fn(),
    aiConfigured: vi.fn(() => true),
    embedTexts: vi.fn(async () => [['0.1', '0.2']]),
    chatComplete: vi.fn(async () => ({ text: 'the answer' })),
  }),
);

vi.mock('../src/lib/db', () => ({ getSql: () => ({ query }) }));
vi.mock('./_auth', () => ({ requireUser }));
vi.mock('./_ratelimit', () => ({ enforceRateLimit: rateLimit }));
vi.mock('./_ai', () => ({
  aiConfigured,
  embedTexts,
  chatComplete,
  sanitizeHistory: () => [],
  vectorLiteral: () => '[0.1,0.2]',
  EMBED_MODEL: 'test-model',
}));
vi.mock('./_quota', () => ({
  consumeAiBudget: vi.fn(async () => undefined),
  QuotaError: class QuotaError extends Error {},
}));

import handler from './_route-ask';

function request(body: unknown) {
  return {
    method: 'POST',
    query: {},
    body,
    headers: {},
  } as unknown as VercelRequest;
}

function response() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    headersSent: false,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(value: unknown) {
      res.body = value;
      return res;
    },
  };
  return res;
}

const docRows = [
  { content: 'chunk about postgres', document_id: 3, file_name: 'db.md' },
  { content: 'another chunk', document_id: 4, file_name: 'notes.csv' },
];
const noteRows = [{ id: 11, title: 'Standup', excerpt: 'we shipped reminders' }];

function seedQueries() {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM document_chunks')) return docRows;
    if (sql.includes('FROM notes n')) return noteRows;
    return [];
  });
}

beforeEach(() => {
  query.mockReset();
  (requireUser as Mock).mockReset();
  (requireUser as Mock).mockResolvedValue('u_test');
  (rateLimit as Mock).mockReset();
  (rateLimit as Mock).mockResolvedValue(true);
  (aiConfigured as Mock).mockReset();
  (aiConfigured as Mock).mockReturnValue(true);
  embedTexts.mockClear();
  embedTexts.mockResolvedValue([['0.1', '0.2']]);
  chatComplete.mockClear();
  chatComplete.mockResolvedValue({ text: 'the answer' });
});

describe('ask route scopes', () => {
  it('rejects an empty question', async () => {
    const res = response();
    await handler(request({ question: '  ' }), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('applies the ai rate scope before doing work', async () => {
    rateLimit.mockResolvedValue(false);
    const res = response();
    await handler(request({ question: 'hi' }), res as unknown as VercelResponse);
    expect(rateLimit).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      limit: 10,
      scope: 'ai',
    });
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it('defaults to documents scope (embed + doc retrieval only)', async () => {
    seedQueries();
    const res = response();
    await handler(request({ question: 'postgres?' }), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(200);
    expect(embedTexts).toHaveBeenCalledTimes(1);
    const sqls = (query.mock.calls as [string][]).map((call) => call[0]);
    expect(sqls.some((s) => s.includes('FROM document_chunks'))).toBe(true);
    expect(sqls.some((s) => s.includes('FROM notes'))).toBe(false);
    const body = res.body as { mode: string; sources: { kind: string }[] };
    expect(body.mode).toBe('vector');
    expect(body.sources.every((s) => s.kind === 'document')).toBe(true);
    const system = (chatComplete.mock.calls[0] as [{ content: string }][])[0][0];
    expect(system.content).toContain('ONLY the provided document excerpts');
  });

  it('notes scope skips embeddings and never reads encrypted or archived notes', async () => {
    seedQueries();
    const res = response();
    await handler(
      request({ question: 'what did we ship?', scope: 'notes' }),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(200);
    expect(embedTexts).not.toHaveBeenCalled();
    const noteCall = (query.mock.calls as [string, unknown[]][]).find((call) =>
      call[0].includes('FROM notes n'),
    );
    expect(noteCall).toBeTruthy();
    expect(noteCall?.[0]).toContain('n.enc = FALSE');
    expect(noteCall?.[0]).toContain('n.archived = FALSE');
    expect(noteCall?.[0]).toContain('n.deleted_at IS NULL');
    const body = res.body as {
      mode: string;
      sources: { kind: string; note_id: number; title: string }[];
    };
    expect(body.mode).toBe('notes');
    expect(body.sources).toHaveLength(noteRows.length);
    expect(body.sources[0]).toEqual({ kind: 'note', note_id: 11, title: 'Standup' });
    const system = (chatComplete.mock.calls[0] as [{ content: string }][])[0][0];
    expect(system.content).toContain("user's own notes and documents");
  });

  it('all scope merges both blocks with one continuous numbering', async () => {
    seedQueries();
    const res = response();
    await handler(
      request({ question: 'postgres and standup?', scope: 'all' }),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(200);
    expect(embedTexts).toHaveBeenCalledTimes(1);
    const messages = (
      chatComplete.mock.calls[0] as unknown as [{ role: string; content: string }[]]
    )[0];
    const user = messages.find((m) => m.role === 'user');
    expect(user?.content).toContain('<documents>');
    expect(user?.content).toContain('<notes>');
    expect(user?.content).toContain('[1] (from "db.md")');
    expect(user?.content).toContain('[3] (from note "Standup")');
    const body = res.body as { mode: string; sources: { kind: string }[] };
    expect(body.mode).toBe('vector');
    expect(body.sources.map((s) => s.kind)).toEqual(['document', 'document', 'note']);
  });

  it('notes scope with no matches answers with the notes-only warning', async () => {
    query.mockImplementation(async (sql: string) => (sql.includes('FROM notes') ? [] : docRows));
    const res = response();
    await handler(
      request({ question: 'zzzz unknown', scope: 'notes' }),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(200);
    const body = res.body as { fallback: boolean; mode: string; warning: string };
    expect(body.fallback).toBe(true);
    expect(body.mode).toBe('notes');
    expect(body.warning).toContain('No matching notes found');
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it('returns an unavailable-config answer without searching when no AI key', async () => {
    (aiConfigured as Mock).mockReturnValue(false);
    const res = response();
    await handler(request({ question: 'hi' }), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(200);
    expect(query).not.toHaveBeenCalled();
    const body = res.body as { fallback: boolean; warning: string };
    expect(body.fallback).toBe(true);
    expect(body.warning).toContain('OpenRouter API key');
  });
});
