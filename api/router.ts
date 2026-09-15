import type { VercelRequest, VercelResponse } from '@vercel/node';
import aiHandler from './_route-ai';
import askHandler from './_route-ask';
import challengeHandler from './_route-challenge';
import documentsHandler from './_route-documents';
import downloadHandler from './_route-download';
import foldersHandler from './_route-folders';
import healthHandler from './_route-health';
import hintHandler from './_route-hint';
import noteHandler from './_route-note';
import notesHandler from './_route-notes';
import revisionsHandler from './_route-revisions';
import tokenQuestionHandler from './_route-token-question';
import tokensHandler from './_route-tokens';
import uploadHandler from './_route-upload';
import usageHandler from './_route-usage';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

/**
 * Single-function API router (Vercel Hobby plans allow max 12 Serverless
 * Functions per deployment; the app has 15 endpoints). Production rewrites
 * `/api/<name>` → `/api/router?route=<name>` (see vercel.json); local dev
 * resolves the `_route-*` modules directly via dev-api.ts.
 *
 * Hardening: handlers are STATICALLY imported (bundled into this single
 * function at build time). The previous lazy `import('./_route-…')` without
 * a file extension works under Vite/vitest (`moduleResolution: bundler`)
 * but fails at runtime on Vercel Node ESM (`"type": "module"`), where a
 * relative dynamic import without `.js` throws ERR_MODULE_NOT_FOUND —
 * taking down EVERY route (including DB-free /challenge and /health) with
 * a generic `{"error":"Internal server error"}`. Static imports are
 * resolved by the bundler, so they cannot fail at request time.
 *
 * Heavy/optional deps (busboy, RAG indexer) stay lazily imported INSIDE
 * their handlers (see _route-upload.ts), so a packaging failure there can
 * still only break /api/upload — never challenge/health/everything at once.
 */
const HANDLERS: Record<string, Handler> = {
  ai: aiHandler,
  ask: askHandler,
  challenge: challengeHandler,
  documents: documentsHandler,
  download: downloadHandler,
  folders: foldersHandler,
  health: healthHandler,
  hint: hintHandler,
  note: noteHandler,
  notes: notesHandler,
  revisions: revisionsHandler,
  'token-question': tokenQuestionHandler,
  tokens: tokensHandler,
  upload: uploadHandler,
  usage: usageHandler,
};

/**
 * Resolve the route name. Primary source is `?route=` (set by the vercel.json
 * rewrite). Fallback parses `req.url` so direct hits (`/api/challenge`,
 * `/api/router?route=challenge`) also resolve even if the rewrite query is
 * stripped by a proxy or preview deployment.
 */
function resolveRoute(req: VercelRequest): string | null {
  const raw = req.query.route;
  const fromQuery = Array.isArray(raw) ? raw[0] : raw;
  if (typeof fromQuery === 'string' && HANDLERS[fromQuery]) return fromQuery;

  try {
    const url = String((req as { url?: unknown }).url ?? '');
    // Match the last /api/<name> segment, ignoring any query string.
    const m = url.match(/\/api\/(?:router\/)?([A-Za-z0-9_-]+)/);
    const candidate = m?.[1] ?? null;
    // `router` itself carries the real name in ?route= — already handled
    // above; anything else must be a known route.
    if (candidate && candidate !== 'router' && HANDLERS[candidate]) return candidate;
  } catch {
    /* ignore — caller returns 404 */
  }
  return typeof fromQuery === 'string' && fromQuery.length > 0 ? fromQuery : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = resolveRoute(req);
  const fn = (route && HANDLERS[route]) || null;
  if (!route || !fn) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  try {
    await fn(req, res);
  } catch (e) {
    // A crashing route must never surface as an empty 500: log the route so
    // Vercel function logs identify the culprit immediately.
    console.error(`api router: handler "${route}" threw`, e);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
