import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ViteDevServer } from 'vite';
import { loadEnv } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

interface VercelLikeResponse extends ServerResponse {
  status: (code: number) => VercelLikeResponse;
  json: (body: unknown) => void;
}

/**
 * Dev-only bridge: executes the Vercel serverless functions in `api/` inside
 * the Vite dev server, so `npm run dev` is fully functional without the
 * Vercel CLI. Never bundled — `apply: 'serve'` plus production uses Vercel.
 *
 * Adapts Node req/res to the shapes the handlers expect:
 * - `req.query` from the URL search params
 * - `req.body` pre-parsed for JSON (multipart streams pass through untouched
 *   so busboy can consume them in /api/upload)
 * - `res.status(code).json(obj)` chained helpers
 */
export function vercelApiBridge(): Plugin {
  return {
    name: 'vercel-api-bridge',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      // Vite does not populate process.env from .env files for SSR/bridge
      // code — load them explicitly so handlers see the same env as Vercel.
      // Existing process vars win (CI/production behavior preserved).
      const env = loadEnv(server.config.mode, rootDir, '');
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
      server.middlewares.use(async (req, res, next) => {
        try {
          if (!req.url || !req.method) return next();
          const url = new URL(req.url, 'http://localhost');
          if (!url.pathname.startsWith('/api/')) return next();

          const route = url.pathname.slice('/api/'.length).split('/')[0];
          if (!route || !/^[a-z0-9_-]+$/i.test(route)) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
          }

          let handler: unknown;
          try {
            const mod = await server.ssrLoadModule(path.join(rootDir, 'api', `${route}.ts`));
            handler = mod.default;
          } catch {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
          }
          if (typeof handler !== 'function') {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
          }

          const query: Record<string, string | string[]> = {};
          url.searchParams.forEach((value, key) => {
            const existing = query[key];
            if (existing === undefined) query[key] = value;
            else if (Array.isArray(existing)) existing.push(value);
            else query[key] = [existing, value];
          });
          (req as IncomingMessage & { query?: unknown }).query = query;

          const contentType = String(req.headers['content-type'] ?? '');
          if (req.method !== 'GET' && contentType.includes('application/json')) {
            const raw = await readBody(req);
            try {
              (req as IncomingMessage & { body?: unknown }).body = raw ? JSON.parse(raw) : {};
            } catch {
              (req as IncomingMessage & { body?: unknown }).body = {};
            }
          } else {
            (req as IncomingMessage & { body?: unknown }).body = {};
          }

          const out = res as VercelLikeResponse;
          out.status = (code: number) => {
            res.statusCode = code;
            return out;
          };
          out.json = (body: unknown) => {
            if (!res.headersSent) res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(body));
          };

          await (handler as (req: unknown, res: unknown) => Promise<void>)(req, res);
          if (!res.writableEnded) {
            // Event-driven handlers (e.g. busboy in /api/upload) respond
            // after the handler returns — wait for completion, don't 500.
            await new Promise<void>((resolve) => {
              let settled = false;
              const done = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                res.off('finish', done);
                res.off('close', done);
                resolve();
              };
              const timer = setTimeout(() => {
                if (!res.writableEnded && !res.headersSent) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'No response from handler' }));
                }
                done();
              }, 25000);
              res.on('finish', done);
              res.on('close', done);
            });
          }
        } catch (err) {
          // API routes always answer JSON — never leak Vite's HTML error page
          // to the client (it surfaces as a cryptic "not valid JSON" error).
          console.error('[api-bridge]', err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Internal server error' }));
          } else {
            next(err);
          }
        }
      });
    },
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
