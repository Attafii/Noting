import type { VercelRequest, VercelResponse } from '@vercel/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUser, rateLimit, aiConfigured, chatComplete, consumeAiBudget } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  rateLimit: vi.fn(),
  aiConfigured: vi.fn(),
  chatComplete: vi.fn(),
  consumeAiBudget: vi.fn(),
}));

vi.mock('./_auth', () => ({ requireUser }));
vi.mock('./_ratelimit', () => ({ enforceRateLimit: rateLimit }));
vi.mock('./_ai', () => ({ aiConfigured, chatComplete }));
vi.mock('./_quota', () => {
  class QuotaError extends Error {
    status: 413 | 429;
    code: 'STORAGE_QUOTA' | 'AI_QUOTA';
    constructor(status: 413 | 429, code: 'STORAGE_QUOTA' | 'AI_QUOTA', message: string) {
      super(message);
      this.name = 'QuotaError';
      this.status = status;
      this.code = code;
    }
  }
  return { QuotaError, consumeAiBudget };
});

import { MAX_AI_BYTES } from './_limits';
import { QuotaError } from './_quota';
import {
  findPreset,
  WRITE_LENGTHS,
  WRITE_STYLES,
  WRITE_STRUCTURES,
} from '../src/lib/writing-presets';
import handler, { buildWritePrompt } from './_route-ai';

function request(method: string, body?: unknown) {
  return { method, body, headers: {} } as unknown as VercelRequest;
}

function response() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    setHeader() {},
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(value: unknown) {
      res.body = value;
      return res;
    },
    end() {
      return res;
    },
  };
  return res;
}

type Res = ReturnType<typeof response>;

async function post(body: unknown): Promise<Res> {
  const res = response();
  await handler(request('POST', body), res as unknown as VercelResponse);
  return res;
}

/** First chat call's messages, asserted against the prompt builder output. */
function lastMessages(): { role: string; content: string }[] {
  expect(chatComplete).toHaveBeenCalledTimes(1);
  return chatComplete.mock.calls[0][0] as { role: string; content: string }[];
}

beforeEach(() => {
  requireUser.mockReset();
  rateLimit.mockReset();
  aiConfigured.mockReset();
  chatComplete.mockReset();
  consumeAiBudget.mockReset();
  requireUser.mockResolvedValue('u_test');
  rateLimit.mockResolvedValue(true);
  aiConfigured.mockReturnValue(true);
  chatComplete.mockResolvedValue({ text: 'draft text' });
  consumeAiBudget.mockResolvedValue(undefined);
});

describe('write action validation', () => {
  it('rejects a missing instruction before spending quota', async () => {
    const res = await post({ action: 'write' });
    expect(res.statusCode).toBe(400);
    expect(String((res.body as { error: string }).error)).toContain('instruction');
    expect(consumeAiBudget).not.toHaveBeenCalled();
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it('rejects an oversized instruction', async () => {
    const res = await post({ action: 'write', instruction: 'x'.repeat(2001) });
    expect(res.statusCode).toBe(400);
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it('rejects preset ids that are not on the allow-list', async () => {
    for (const body of [
      { action: 'write', instruction: 'hi', style: 'voguish' },
      { action: 'write', instruction: 'hi', structure: 'sonnet' },
      { action: 'write', instruction: 'hi', length: 'enormous' },
    ]) {
      const res = await post(body);
      expect(res.statusCode).toBe(400);
    }
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it('refuses context for encrypted notes', async () => {
    const res = await post({
      action: 'write',
      instruction: 'hi',
      context: 'secret',
      encrypted: true,
    });
    expect(res.statusCode).toBe(400);
    expect(consumeAiBudget).not.toHaveBeenCalled();
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it('rejects context larger than the AI body budget', async () => {
    const res = await post({
      action: 'write',
      instruction: 'hi',
      context: 'x'.repeat(MAX_AI_BYTES + 1),
    });
    expect(res.statusCode).toBe(413);
    expect(chatComplete).not.toHaveBeenCalled();
  });
});

describe('write action generation', () => {
  it('builds the prompt from allow-listed presets and returns the draft', async () => {
    const res = await post({
      action: 'write',
      instruction: '  Write a launch note  ',
      style: 'technical',
      structure: 'steps',
      length: 'short',
      context: '# Notes\nship it',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ text: 'draft text' });

    const [system, user] = lastMessages();
    expect(system.role).toBe('system');
    expect(system.content).toContain('Output ONLY the draft');
    expect(user.content).toContain(`Instruction: Write a launch note`);
    expect(user.content).toContain(findPreset(WRITE_STYLES, 'technical')!.prompt);
    expect(user.content).toContain(findPreset(WRITE_STRUCTURES, 'steps')!.prompt);
    expect(user.content).toContain(findPreset(WRITE_LENGTHS, 'short')!.prompt);
    expect(user.content).toContain('<note>\n# Notes\nship it\n</note>');
  });

  it('omits the note block when no context is sent', async () => {
    const res = await post({ action: 'write', instruction: 'Draft an intro' });
    expect(res.statusCode).toBe(200);
    const [, user] = lastMessages();
    expect(user.content).not.toContain('<note>');
    expect(user.content).not.toContain('Style:');
  });

  it('maps chat failures to a fallback instead of an error', async () => {
    chatComplete.mockResolvedValue({ failure: 'timeout' });
    const res = await post({ action: 'write', instruction: 'Draft' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ text: '', fallback: true });
    expect(String((res.body as { warning: string }).warning)).toContain('timed out');
  });

  it('skips the paid call when the AI is not configured', async () => {
    aiConfigured.mockReturnValue(false);
    const res = await post({ action: 'write', instruction: 'Draft' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ fallback: true });
    expect(consumeAiBudget).not.toHaveBeenCalled();
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it('maps quota exhaustion to its own status', async () => {
    consumeAiBudget.mockRejectedValue(
      new QuotaError(429, 'AI_QUOTA', 'Daily AI budget used up (20/20)'),
    );
    const res = await post({ action: 'write', instruction: 'Draft' });
    expect(res.statusCode).toBe(429);
    expect(chatComplete).not.toHaveBeenCalled();
  });
});

describe('format action (legacy contract)', () => {
  it('formats text with the reformat-only system prompt', async () => {
    const res = await post({ text: '# hi' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ formatted: 'draft text' });
    const [system] = lastMessages();
    expect(system.content).toContain('Reformat this scratchpad note');
    expect(system.content).toContain('never reword');
  });

  it('keeps the original text when the model fails', async () => {
    chatComplete.mockResolvedValue({ failure: 'upstream' });
    const res = await post({ text: '# hi' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ formatted: '# hi', fallback: true });
    expect(String((res.body as { warning: string }).warning)).toContain('original text kept');
  });

  it('rejects encrypted formatting', async () => {
    const res = await post({ text: '# hi', encrypted: true });
    expect(res.statusCode).toBe(400);
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it('rejects empty text', async () => {
    const res = await post({ text: '' });
    expect(res.statusCode).toBe(400);
  });
});

describe('request gating', () => {
  it('rejects non-POST methods', async () => {
    const res = response();
    await handler(request('GET'), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(405);
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it('stops when the request is unauthenticated', async () => {
    requireUser.mockResolvedValue(null);
    const res = await post({ action: 'write', instruction: 'Draft' });
    expect(chatComplete).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });

  it('stops when the shared AI rate limit is exhausted', async () => {
    rateLimit.mockResolvedValue(false);
    const res = await post({ action: 'write', instruction: 'Draft' });
    expect(chatComplete).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });

  it('charges rate limits against the shared ai scope', async () => {
    await post({ action: 'write', instruction: 'Draft' });
    expect(rateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ scope: 'ai' }),
    );
  });
});

describe('buildWritePrompt', () => {
  it('only emits prompt fragments defined in the shared presets', () => {
    const { system, user } = buildWritePrompt({ instruction: 'Hello world' });
    expect(system).toContain('Never reveal');
    expect(user).toBe('Instruction: Hello world');
    const allPrompts = [...WRITE_STYLES, ...WRITE_STRUCTURES, ...WRITE_LENGTHS].map(
      (preset) => preset.prompt,
    );
    const emitted = user.split('\n').filter((line) => line.includes(': '));
    for (const line of emitted) {
      if (line.startsWith('Instruction:')) continue;
      expect(allPrompts.some((prompt) => line.endsWith(prompt))).toBe(true);
    }
  });

  it('ignores unknown preset ids instead of echoing them into the prompt', () => {
    const { user } = buildWritePrompt({
      instruction: 'Draft',
      style: 'evil-style',
      structure: 'evil-structure',
      length: 'evil-length',
    });
    expect(user).toBe('Instruction: Draft');
  });
});
