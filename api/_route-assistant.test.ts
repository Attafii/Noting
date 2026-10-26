import type { VercelRequest, VercelResponse } from '@vercel/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  query,
  requireUser,
  rateLimit,
  aiConfigured,
  chatComplete,
  chatStream,
  consumeAiBudget,
  getSql,
} = vi.hoisted(() => {
  // Chat calls take (messages, timeout?, maxTokens?); declared so tests can
  // read mock.calls[i][0] for prompt assertions.
  type Outcome = { text: string } | { failure: 'timeout' | 'upstream' | 'empty' | 'degenerate' };
  const chatFn = (_messages: unknown, _timeout?: number, _maxTokens?: number): Promise<Outcome> =>
    Promise.resolve({ text: 'the answer' });
  const streamFn = (
    _messages: unknown,
    _onDelta?: (text: string) => void,
    _timeout?: number,
    _maxTokens?: number,
  ): Promise<Outcome> => Promise.resolve({ text: 'the answer' });
  return {
    query: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(),
    requireUser: vi.fn(),
    rateLimit: vi.fn(),
    aiConfigured: vi.fn(() => true),
    chatComplete: vi.fn(chatFn),
    chatStream: vi.fn(streamFn),
    consumeAiBudget: vi.fn(() => Promise.resolve(undefined)),
    getSql: vi.fn(() => ({ query })),
  };
});

vi.mock('../src/lib/db', () => ({ getSql }));
vi.mock('./_auth', () => ({ requireUser }));
vi.mock('./_ratelimit', () => ({ enforceRateLimit: rateLimit }));
vi.mock('./_ai', () => ({
  aiConfigured,
  chatComplete,
  chatStream,
  ASSISTANT_MODEL: 'test-assistant-model',
  sanitizeHistory: (raw: unknown) => {
    if (!Array.isArray(raw)) return [];
    const out: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { role, content } = entry as { role?: unknown; content?: unknown };
      if (role !== 'user' && role !== 'assistant') continue;
      if (typeof content !== 'string' || !content.trim()) continue;
      out.push({ role, content: content.trim() });
    }
    return out;
  },
}));
vi.mock('./_quota', () => {
  class QuotaError extends Error {
    status = 429 as const;
    code = 'AI_QUOTA' as const;
  }
  return { QuotaError, consumeAiBudget };
});

import handler from './_route-assistant';

function request(body: unknown, headers: Record<string, string> = {}) {
  return { method: 'POST', body, headers, query: {} } as unknown as VercelRequest;
}

function response() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    headers: {} as Record<string, string>,
    ended: false,
    chunks: [] as string[],
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(value: unknown) {
      res.body = value;
      res.headers['content-type'] = 'application/json';
    },
    setHeader(key: string, value: string) {
      res.headers[key.toLowerCase()] = value;
      return res;
    },
    write(chunk: string) {
      res.chunks.push(chunk);
      return true;
    },
    end() {
      res.ended = true;
    },
  };
  return res;
}

type Res = ReturnType<typeof response>;

async function post(body: unknown): Promise<Res> {
  const res = response();
  await handler(request(body), res as unknown as VercelResponse);
  return res;
}

/** Parse SSE frames the route wrote into typed events. */
function parseEvents(res: Res): { type: string; [key: string]: unknown }[] {
  const events: { type: string; [key: string]: unknown }[] = [];
  for (const chunk of res.chunks) {
    const line = chunk.trim();
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6);
    if (payload === '[DONE]') {
      events.push({ type: 'done-marker' });
      continue;
    }
    events.push(JSON.parse(payload) as { type: string });
  }
  return events;
}

const helpBody = {
  mode: 'help',
  messages: [{ role: 'user', content: 'How do I recur a note?' }],
};

beforeEach(() => {
  query.mockReset();
  requireUser.mockReset();
  rateLimit.mockReset();
  aiConfigured.mockReset();
  chatComplete.mockReset();
  chatStream.mockReset();
  consumeAiBudget.mockReset();
  getSql.mockReset();
  getSql.mockImplementation(() => ({ query }));
  requireUser.mockResolvedValue('u_test');
  rateLimit.mockResolvedValue(true);
  aiConfigured.mockReturnValue(true);
  chatComplete.mockResolvedValue({ text: 'the answer' });
  chatStream.mockResolvedValue({ text: 'the answer' });
  consumeAiBudget.mockResolvedValue(undefined);
});

describe('assistant — auth and validation', () => {
  it('rejects anonymous callers before anything else', async () => {
    // Contract match: the real requireUser writes the 401, then returns null.
    requireUser.mockImplementation(async (_req: unknown, res: Res) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    });
    const res = await post(helpBody);
    expect(res.statusCode).toBe(401);
    expect(chatComplete).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects non-POST methods', async () => {
    const res = response();
    await handler(
      { method: 'GET', body: {}, headers: {}, query: {} } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(405);
  });

  it('enforces the assistant rate-limit bucket', async () => {
    rateLimit.mockResolvedValue(false);
    const res = response();
    await handler(request(helpBody), res as unknown as VercelResponse);
    expect(rateLimit).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      limit: 10,
      scope: 'assistant',
    });
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it('rejects messages with no user turn', async () => {
    const res = await post({ mode: 'help', messages: [] });
    expect(res.statusCode).toBe(400);
    expect(consumeAiBudget).not.toHaveBeenCalled();
  });
});

describe('assistant — help mode', () => {
  it('answers from the guide without touching the database', async () => {
    const res = await post(helpBody);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ answer: 'the answer', sources: [] });
    expect(query).not.toHaveBeenCalled(); // help mode never reads user data
    expect(consumeAiBudget).toHaveBeenCalledWith('u_test');
  });

  it('embeds the product guide and persona in the system prompt', async () => {
    await post(helpBody);
    const messages = chatComplete.mock.calls[0][0] as { role: string; content: string }[];
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Ember');
    expect(messages[0].content).toContain('### Organization');
    expect(messages[0].content).toContain('Ctrl/⌘ K');
  });

  it('surfaces a friendly warning when AI is not configured', async () => {
    aiConfigured.mockReturnValue(false);
    const res = await post(helpBody);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ answer: '', fallback: true });
    expect(consumeAiBudget).not.toHaveBeenCalled(); // no budget spent
  });

  it('maps quota exhaustion to 429 without calling the model', async () => {
    const { QuotaError } = await import('./_quota');
    consumeAiBudget.mockRejectedValueOnce(
      new QuotaError(429, 'AI_QUOTA', 'Daily AI limit reached'),
    );
    const res = await post(helpBody);
    expect(res.statusCode).toBe(429);
    expect(chatComplete).not.toHaveBeenCalled();
  });
});

describe('assistant — notes mode', () => {
  const notesBody = {
    mode: 'notes',
    messages: [{ role: 'user', content: 'what did I write about sourdough?' }],
  };

  it('retrieves plaintext notes and cites them', async () => {
    query.mockResolvedValueOnce([
      { id: 7, title: 'Baking', excerpt: 'sourdough needs 80% hydration' },
    ]);
    const res = await post(notesBody);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      answer: 'the answer',
      sources: [{ kind: 'note', note_id: 7, title: 'Baking' }],
    });
    // The retrieval must exclude encrypted/archived/trashed notes by design.
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain('enc = FALSE');
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('archived = FALSE');
  });

  it('wraps excerpts in <notes> tags on the final user turn only', async () => {
    query.mockResolvedValueOnce([{ id: 7, title: 'Baking', excerpt: 'hydration notes' }]);
    await post({
      mode: 'notes',
      messages: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'follow-up' },
      ],
    });
    const messages = chatComplete.mock.calls[0][0] as { role: string; content: string }[];
    const userMessages = messages.filter((m) => m.role === 'user');
    expect(userMessages[0].content).toBe('first question');
    expect(userMessages[1].content).toContain('<notes>');
    expect(userMessages[1].content).toContain('Question: follow-up');
    expect(messages[0].content).toContain('excerpts from the user');
  });

  it('never spends a call when nothing matches', async () => {
    query.mockResolvedValueOnce([]);
    const res = await post(notesBody);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ answer: '', fallback: true });
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it('answers 503 when the database is unavailable', async () => {
    getSql.mockImplementationOnce(() => {
      throw new Error('missing connection string');
    });
    const res = await post(notesBody);
    expect(res.statusCode).toBe(503);
    expect(chatComplete).not.toHaveBeenCalled();
  });
});

describe('assistant — streaming (SSE)', () => {
  it('streams deltas and closes with done + [DONE]', async () => {
    chatStream.mockImplementationOnce(
      async (_messages: unknown, onDelta?: (text: string) => void): Promise<{ text: string }> => {
        onDelta?.('Hel');
        onDelta?.('lo');
        return { text: 'Hello' };
      },
    );
    const res = await post({ ...helpBody, stream: true });
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.ended).toBe(true);
    const events = parseEvents(res);
    expect(events.map((e) => e.type)).toEqual(['delta', 'delta', 'done', 'done-marker']);
    const done = events.find((e) => e.type === 'done') as unknown as {
      answer: string;
      sources: unknown[];
    };
    expect(done.answer).toBe('Hello');
    expect(done.sources).toEqual([]);
    expect(res.chunks.at(-1)).toContain('[DONE]');
  });

  it('emits an error frame when the model fails mid-stream', async () => {
    chatStream.mockResolvedValueOnce({ failure: 'upstream' });
    const res = await post({ ...helpBody, stream: true });
    const events = parseEvents(res);
    expect(events[0].type).toBe('error');
    expect(events.at(-1)?.type).toBe('done-marker');
    expect(res.ended).toBe(true);
  });

  it('falls back to JSON when stream is not requested', async () => {
    const res = await post(helpBody);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.chunks).toEqual([]);
    expect(res.body).toEqual({ answer: 'the answer', sources: [] });
  });

  it('returns quota failures as JSON before any stream starts', async () => {
    const { QuotaError } = await import('./_quota');
    consumeAiBudget.mockRejectedValueOnce(
      new QuotaError(429, 'AI_QUOTA', 'Daily AI limit reached'),
    );
    const res = await post({ ...helpBody, stream: true });
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.statusCode).toBe(429);
    expect(res.chunks).toEqual([]);
  });
});
