import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_auth';
import { enforceRateLimit } from './_ratelimit';
import { bodyTooLargeMessage, checkBodySize, MAX_AI_BYTES } from './_limits';
import { aiConfigured, chatComplete } from './_ai';

const SYSTEM_PROMPT =
  'Clean, format, and structure this scratchpad note efficiently using clean markdown while preserving structural integrity.';

const FAILURE_WARNINGS = {
  timeout: 'AI formatting timed out — original text kept.',
  upstream: 'AI formatting is temporarily unavailable — original text kept.',
  empty: 'AI returned empty content — original text kept.',
} as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  // Tight budget: each call spends paid OpenRouter quota.
  if (!(await enforceRateLimit(req, res, { limit: 10 }))) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { text } = req.body as { text: string };
  if (typeof text !== 'string' || text.length === 0) {
    res.status(400).json({ error: 'text must be non-empty string' });
    return;
  }
  // Unbounded-body guard: measure utf8 bytes before spending paid quota.
  const size = checkBodySize(text, MAX_AI_BYTES);
  if (size.over) {
    res.status(413).json({ error: bodyTooLargeMessage(size.bytes, MAX_AI_BYTES) });
    return;
  }

  if (!aiConfigured()) {
    res.status(200).json({
      formatted: text,
      fallback: true,
      warning: 'AI formatting is not configured — original text kept.',
    });
    return;
  }

  const result = await chatComplete([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: text },
  ]);

  if ('failure' in result) {
    res.status(200).json({
      formatted: text,
      fallback: true,
      warning: FAILURE_WARNINGS[result.failure],
    });
    return;
  }

  res.status(200).json({ formatted: result.text });
}
