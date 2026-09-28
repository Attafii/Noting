/**
 * Shared OpenRouter client: chat completions + embeddings (OpenAI-compatible).
 * Model IDs are env-overridable; all failures are explicit — callers decide
 * between hard errors (429/5xx) and graceful fallbacks (the /api/ai contract).
 */

const OR_BASE = 'https://openrouter.ai/api/v1';
const CHAT_MODEL = process.env.OPENROUTER_CHAT_MODEL || 'meta-llama/llama-3.3-70b-instruct';
/** Native 1024 dims — must match document_chunks.embedding. */
export const EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL || 'baai/bge-m3';
export const EMBED_DIMS = 1024;

export function aiConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

function orHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

type PostOutcome = { data: unknown } | { failure: 'timeout' | 'upstream'; status?: number };

/**
 * POST and parse JSON under ONE abort deadline covering headers AND body.
 * Clearing the timer as soon as headers arrive (the old behaviour) lets a
 * slow body stream well past the budget — measured 12s and 37s against the
 * 9s/10s ceilings the callers document (Vercel Hobby kills functions at 10s),
 * which turns a graceful fallback into a dead function.
 */
async function postJson(path: string, body: unknown, timeoutMs: number): Promise<PostOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${OR_BASE}${path}`, {
      method: 'POST',
      headers: orHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return { failure: 'upstream', status: res.status };
    return { data: await res.json() };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return { failure: 'timeout' };
    return { failure: 'upstream' };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Repetition-loop detector for model degeneration (observed as runaway runs
 * of a single character). English prose tops out around 20% for any one
 * character (spaces), so >60% over a non-trivial length only happens when the
 * model has derailed — routes then fall back instead of showing garbage.
 */
export function isDegenerate(text: string): boolean {
  if (text.length < 40) return false;
  const counts = new Map<string, number>();
  let top = 0;
  for (const ch of text) {
    const n = (counts.get(ch) ?? 0) + 1;
    counts.set(ch, n);
    if (n > top) {
      top = n;
      if (top / text.length > 0.6) return true;
    }
  }
  return top / text.length > 0.6;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ChatFailure = 'timeout' | 'upstream' | 'empty' | 'degenerate';

/** Assistant text on success; a typed failure otherwise (no throws). */
export async function chatComplete(
  messages: ChatMessage[],
  timeoutMs = 8000,
  maxTokens = 2048,
): Promise<{ text: string } | { failure: ChatFailure }> {
  const outcome = await postJson(
    '/chat/completions',
    { model: CHAT_MODEL, messages, temperature: 0.3, max_tokens: maxTokens },
    timeoutMs,
  );
  if ('failure' in outcome) {
    if (outcome.failure === 'timeout') console.error('OpenRouter chat timeout');
    else console.error('OpenRouter chat upstream status', outcome.status ?? 'network error');
    return { failure: outcome.failure };
  }
  const body = outcome.data as {
    choices?: [{ message?: { content?: string } }];
  };
  const text = body.choices?.[0]?.message?.content;
  if (!text) return { failure: 'empty' };
  if (isDegenerate(text)) {
    console.error('OpenRouter chat degenerate output', text.length);
    return { failure: 'degenerate' };
  }
  return { text };
}

/**
 * Embed texts for retrieval. Returns null on any failure; validates the
 * native dimension so a misconfigured model fails closed instead of
 * poisoning the index with wrong-shaped vectors.
 */
export async function embedTexts(texts: string[], timeoutMs = 15000): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  const outcome = await postJson(
    '/embeddings',
    { model: EMBED_MODEL, input: texts, encoding_format: 'float' },
    timeoutMs,
  );
  if ('failure' in outcome) {
    console.error('OpenRouter embeddings failed', outcome.status ?? outcome.failure);
    return null;
  }
  const body = outcome.data as {
    data?: [{ embedding?: number[] }];
  };
  const vectors = (body.data ?? [])
    .map((d) => d.embedding)
    .filter((v): v is number[] => Array.isArray(v) && v.length === EMBED_DIMS);
  return vectors.length === texts.length ? vectors : null;
}

/** pgvector text input: '[0.1,0.2,...]'. */
export function vectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
