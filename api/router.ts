import type { VercelRequest, VercelResponse } from '@vercel/node';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;
type HandlerModule = { default: Handler };
type Loader = () => Promise<HandlerModule>;

/**
 * Single-function API router (Vercel Hobby plans allow max 12 Serverless
 * Functions per deployment; the app has 15 endpoints). Production rewrites
 * `/api/<name>` → `/api/router?route=<name>` (see vercel.json); local dev
 * resolves the `_route-*` modules directly via dev-api.ts.
 *
 * Hardening: handlers are LAZY-loaded per request (dynamic import), never
 * statically imported at the top of this file. A crashing third-party import
 * in one route (e.g. busboy in upload, OpenRouter/pgvector in index) must
 * only break that route — never challenge/health/everything at once. This
 * was the root cause of simultaneous 500s on DB-free (/challenge) and
 * DB-backed (/health) endpoints: one top-level import throwing killed the
 * whole shared bundle.
 */
const LOADERS: Record<string, Loader> = {
  ai: () => import('./_route-ai'),
  ask: () => import('./_route-ask'),
  challenge: () => import('./_route-challenge'),
  documents: () => import('./_route-documents'),
  download: () => import('./_route-download'),
  folders: () => import('./_route-folders'),
  health: () => import('./_route-health'),
  hint: () => import('./_route-hint'),
  note: () => import('./_route-note'),
  notes: () => import('./_route-notes'),
  revisions: () => import('./_route-revisions'),
  'token-question': () => import('./_route-token-question'),
  tokens: () => import('./_route-tokens'),
  upload: () => import('./_route-upload'),
  usage: () => import('./_route-usage'),
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
  if (typeof fromQuery === 'string' && LOADERS[fromQuery]) return fromQuery;

  try {
    const url = String((req as { url?: unknown }).url ?? '');
    // Match the last /api/<name> segment, ignoring any query string.
    const m = url.match(/\/api\/(?:router\/)?([A-Za-z0-9_-]+)/);
    const candidate = m?.[1] ?? null;
    // `router` itself carries the real name in ?route= — already handled
    // above; anything else must be a known route.
    if (candidate && candidate !== 'router' && LOADERS[candidate]) return candidate;
  } catch {
    /* ignore — caller returns 404 */
  }
  return typeof fromQuery === 'string' && fromQuery.length > 0 ? fromQuery : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = resolveRoute(req);
  const load = (route && LOADERS[route]) || null;
  if (!route || !load) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  let fn: Handler;
  try {
    const mod = await load();
    fn = mod.default;
    if (typeof fn !== 'function') throw new Error(`route "${route}" has no default handler`);
  } catch (e) {
    // Import-time crash isolated to this route — everything else stays up.
    console.error(`api router: loader for "${route}" threw`, e);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
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
