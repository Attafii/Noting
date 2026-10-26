/**
 * Shared OpenRouter client: chat completions + embeddings (OpenAI-compatible).
 * Model IDs are env-overridable; all failures are explicit — callers decide
 * between hard errors (429/5xx) and graceful fallbacks (the /api/ai contract).
 */

const OR_BASE = 'https://openrouter.ai/api/v1';
const CHAT_MODEL = process.env.OPENROUTER_CHAT_MODEL || 'meta-llama/llama-3.3-70b-instruct';
/**
 * Assistant (Ember) model — may be pointed at a stronger conversational
 * model than format/write without touching their default. Falls back to the
 * shared chat model so a deployment works with zero extra config.
 */
export const ASSISTANT_MODEL = process.env.OPENROUTER_ASSISTANT_MODEL || CHAT_MODEL;
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
 * Clearing the timer as soon as headers arrive (the old behaviour) let a
 * slow body stream indefinitely — measured 12s and 37s — with nothing to
 * bound the request. Callers set their own ceilings (see vercel.json:
 * api/router.ts has maxDuration 30).
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

/** Client history cap: last 6 turns (12 messages). */
const HISTORY_MAX_MESSAGES = 12;
/** Per-turn text cap so a client can't balloon the prompt. */
const HISTORY_MAX_CHARS = 1000;

/**
 * Shape client-supplied conversation history into trusted ChatMessages.
 * Strict allow-list (user/assistant only — 'system' is rejected), strings
 * only, trimmed, per-message truncated, oldest messages dropped past the
 * cap. Anything malformed is silently skipped rather than 400'ing, so
 * older clients that don't send history keep working unchanged.
 */
export function sanitizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatMessage[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== 'user' && role !== 'assistant') continue;
    if (typeof content !== 'string') continue;
    const text = content.trim();
    if (!text) continue;
    turns.push({
      role,
      content: text.length > HISTORY_MAX_CHARS ? text.slice(0, HISTORY_MAX_CHARS) : text,
    });
  }
  return turns.slice(-HISTORY_MAX_MESSAGES);
}

export type ChatFailure = 'timeout' | 'upstream' | 'empty' | 'degenerate';

/** Assistant text on success; a typed failure otherwise (no throws). */
export async function chatComplete(
  messages: ChatMessage[],
  timeoutMs = 15000,
  maxTokens = 2048,
  model = CHAT_MODEL,
): Promise<{ text: string } | { failure: ChatFailure }> {
  const outcome = await postJson(
    '/chat/completions',
    { model, messages, temperature: 0.3, max_tokens: maxTokens },
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
 * Streaming variant of chatComplete for the assistant: POSTs with
 * `stream: true`, forwards each content delta through `onDelta` as it
 * arrives, and still returns the full text at the end (so degeneration
 * checks and logging behave exactly like the non-streaming path).
 *
 * Note: deltas are already flushed to the caller by the time a degenerate
 * final result is detected — the route surfaces that as a stream `error`
 * frame after partial output (the client keeps the partial text and offers
 * a retry).
 */
export async function chatStream(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  timeoutMs = 25000,
  maxTokens = 2048,
  model = CHAT_MODEL,
): Promise<{ text: string } | { failure: ChatFailure }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let full = '';
  try {
    const res = await fetch(`${OR_BASE}/chat/completions`, {
      method: 'POST',
      headers: orHeaders(),
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.6,
        max_tokens: maxTokens,
        stream: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      console.error('OpenRouter stream upstream status', res.status);
      return { failure: 'upstream' };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // OpenAI-style SSE: lines of `data: {...}`, blank-line separated;
      // `data: [DONE]` terminates. Handle partial frames across chunks.
      let sep: number;
      while ((sep = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, sep).trimEnd();
        buffer = buffer.slice(sep + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          buffer = '';
          break;
        }
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onDelta(delta);
          }
        } catch {
          /* skip malformed frame — stream continues */
        }
      }
    }
    if (!full) return { failure: 'empty' };
    if (isDegenerate(full)) {
      console.error('OpenRouter stream degenerate output', full.length);
      return { failure: 'degenerate' };
    }
    return { text: full };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      // A timed-out stream that already produced output is still usable:
      // callers got the deltas; keep the text if it passed quality checks.
      if (full.length > 0 && !isDegenerate(full)) return { text: full };
      console.error('OpenRouter stream timeout', full.length);
      return { failure: 'timeout' };
    }
    console.error('OpenRouter stream network error', e);
    return { failure: 'upstream' };
  } finally {
    clearTimeout(timeout);
  }
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
