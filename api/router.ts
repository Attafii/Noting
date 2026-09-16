import type { VercelRequest, VercelResponse } from '@vercel/node';
import aiHandler from './_route-ai.js';
import askHandler from './_route-ask.js';
import challengeHandler from './_route-challenge.js';
import documentsHandler from './_route-documents.js';
import downloadHandler from './_route-download.js';
import foldersHandler from './_route-folders.js';
import healthHandler from './_route-health.js';
import hintHandler from './_route-hint.js';
import noteHandler from './_route-note.js';
import notesHandler from './_route-notes.js';
import revisionsHandler from './_route-revisions.js';
import tokenQuestionHandler from './_route-token-question.js';
import tokensHandler from './_route-tokens.js';
import uploadHandler from './_route-upload.js';
import usageHandler from './_route-usage.js';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

/**
 * Single-function API router (Vercel Hobby plans allow max 12 Serverless
 * Functions per deployment; the app has 15 endpoints). Production rewrites
 * `/api/<name>` → `/api/router?route=<name>` (see vercel.json); local dev
 * resolves the `_route-*` modules directly via dev-api.ts.
 *
 * Hardening: handlers are STATICALLY imported (bundled into this single
 * function at build time), and every relative import in the server graph
 * uses an explicit `.js` extension (`./_route-ai.js`, not `./_route-ai`).
 * Vercel transpiles (not bundles) each file, and under `"type": "module"`
 * Node ESM throws ERR_MODULE_NOT_FOUND for extensionless relative imports
 * at boot — taking down EVERY route with a bare 500. TypeScript maps
 * `./x.js` → `./x.ts` at compile time, so local typecheck/tests are
 * unaffected. The same rule applies to dynamic imports (see _route-upload.ts).
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
