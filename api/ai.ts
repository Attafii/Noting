import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateToken, unauthorizedResponse } from './_auth';

const NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const SYSTEM_PROMPT = 'Clean, format, and structure this scratchpad note efficiently using clean markdown while preserving structural integrity.';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateToken(req)) {
    unauthorizedResponse(res);
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { text } = req.body as { text: string };
  if (typeof text !== 'string' || text.length === 0) {
    res.status(400).json({ error: 'text must be non-empty string' });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(NIM_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'meta/llama3-70b-instruct',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (controller.signal.aborted) {
      res.status(504).json({ error: 'NIM timeout' });
      return;
    }

    if (!response.ok) {
      const status = response.status;
      res.status(502).json({ error: `NIM upstream ${status}` });
      return;
    }

    const body = await response.json() as {
      choices?: [{ message?: { content?: string } }];
    };
    const formatted = body.choices?.[0]?.message?.content;

    if (!formatted) {
      res.status(502).json({ error: 'NIM returned empty content' });
      return;
    }

    res.status(200).json({ formatted });
  } catch (e) {
    clearTimeout(timeout);
    if (e instanceof Error && e.name === 'AbortError') {
      res.status(504).json({ error: 'NIM timeout' });
      return;
    }
    console.error('AI endpoint error', e);
    res.status(500).json({ error: 'AI request failed' });
  }
}