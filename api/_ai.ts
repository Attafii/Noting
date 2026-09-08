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

async function postWithTimeout(path: string, body: unknown, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${OR_BASE}${path}`, {
      method: 'POST',
      headers: orHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ChatFailure = 'timeout' | 'upstream' | 'empty';

/** Assistant text on success; a typed failure otherwise (no throws). */
export async function chatComplete(
  messages: ChatMessage[],
  timeoutMs = 8000,
): Promise<{ text: string } | { failure: ChatFailure }> {
  try {
    const res = await postWithTimeout(
      '/chat/completions',
      { model: CHAT_MODEL, messages, temperature: 0.3, max_tokens: 2048 },
      timeoutMs,
    );
    if (!res.ok) {
      console.error('OpenRouter chat upstream status', res.status);
      return { failure: 'upstream' };
    }
    const body = (await res.json()) as {
      choices?: [{ message?: { content?: string } }];
    };
    const text = body.choices?.[0]?.message?.content;
    return text ? { text } : { failure: 'empty' };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      console.error('OpenRouter chat timeout');
      return { failure: 'timeout' };
    }
    console.error('OpenRouter chat error', e);
    return { failure: 'upstream' };
  }
}

/**
 * Embed texts for retrieval. Returns null on any failure; validates the
 * native dimension so a misconfigured model fails closed instead of
 * poisoning the index with wrong-shaped vectors.
 */
export async function embedTexts(texts: string[], timeoutMs = 15000): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  try {
    const res = await postWithTimeout(
      '/embeddings',
      { model: EMBED_MODEL, input: texts, encoding_format: 'float' },
      timeoutMs,
    );
    if (!res.ok) {
      console.error('OpenRouter embeddings upstream status', res.status);
      return null;
    }
    const body = (await res.json()) as {
      data?: [{ embedding?: number[] }];
    };
    const vectors = (body.data ?? [])
      .map((d) => d.embedding)
      .filter((v): v is number[] => Array.isArray(v) && v.length === EMBED_DIMS);
    return vectors.length === texts.length ? vectors : null;
  } catch (e) {
    console.error('OpenRouter embeddings error', e);
    return null;
  }
}

/** pgvector text input: '[0.1,0.2,...]'. */
export function vectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
