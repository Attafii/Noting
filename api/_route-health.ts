import type { VercelRequest, VercelResponse } from '@vercel/node';
import { enforceRateLimit } from './_ratelimit.js';
import { withQueryTimeout } from './_timeout.js';
import { getSql } from '../src/lib/db.js';

/**
 * Unauthenticated liveness probe for uptime monitors. Reveals nothing
 * except that the app and database respond: db_reachable tells whether
 * Neon answers at all; tables_ok tells whether migrations ran.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!(await enforceRateLimit(req, res))) return;

  const started = Date.now();
  const configOk = Boolean(
    process.env.NEON_CONNECTION_STRING &&
    process.env.GLOBAL_SECRET_TOKEN &&
    (process.env.CHALLENGE_SIGNING_SECRET || process.env.GLOBAL_SECRET_TOKEN),
  );
  try {
    const sql = getSql();
    await withQueryTimeout(sql.query('SELECT 1'), QUERY_TIMEOUT_MS);
    let tables_ok = false;
    try {
      const rows = await withQueryTimeout(
        sql.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
           AND tablename IN (
             'access_tokens', 'hint_grants', 'rate_limit_buckets', 'notes', 'documents',
             'note_revisions', 'folders', 'note_tags', 'auth_sessions', 'index_jobs', 'workspace_invites'
           )`,
        ),
        QUERY_TIMEOUT_MS,
      );
      const names = new Set(
        rows
          .map((r) => (r as { tablename?: unknown }).tablename)
          .filter((t) => typeof t === 'string'),
      );
      tables_ok = [
        'access_tokens',
        'hint_grants',
        'rate_limit_buckets',
        'notes',
        'documents',
        'note_revisions',
        'folders',
        'note_tags',
        'auth_sessions',
        'index_jobs',
        'workspace_invites',
      ].every((name) => names.has(name));
    } catch (e) {
      console.error('health tables check failed', e);
    }
    let migrations_ok = false;
    try {
      const rows = await withQueryTimeout(
        sql.query("SELECT 1 FROM schema_migrations WHERE name = 'migrate-011-integrity' LIMIT 1"),
        QUERY_TIMEOUT_MS,
      );
      migrations_ok = rows.length === 1;
    } catch (error) {
      console.error('health migration check failed', error);
    }
    let search_ready = false;
    try {
      const ext = await withQueryTimeout(
        sql.query(`SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pg_trgm')`),
        QUERY_TIMEOUT_MS,
      );
      const names = new Set(
        ext.map((r) => (r as { extname?: unknown }).extname).filter((t) => typeof t === 'string'),
      );
      if (names.has('vector')) {
        const cols = await withQueryTimeout(
          sql.query(`SELECT to_regclass('public.document_chunks') AS tbl`),
          QUERY_TIMEOUT_MS,
        );
        search_ready = (cols[0] as { tbl?: unknown }).tbl !== null;
      }
    } catch (e) {
      console.error('health search check failed', e);
    }
    const ok = configOk && tables_ok && migrations_ok;
    res.status(ok ? 200 : 503).json({
      ok,
      db_reachable: true,
      tables_ok,
      migrations_ok,
      config_ok: configOk,
      search_ready,
      latency_ms: Date.now() - started,
    });
  } catch (e) {
    console.error('health check failed', e);
    res.status(503).json({
      ok: false,
      db_reachable: false,
      tables_ok: false,
      migrations_ok: false,
      config_ok: configOk,
      latency_ms: Date.now() - started,
    });
  }
}

const QUERY_TIMEOUT_MS = 7000;
