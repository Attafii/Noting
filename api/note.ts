import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateToken, unauthorizedResponse } from './_auth';
import { enforceRateLimit } from './_ratelimit';
import { getSql } from '../src/lib/db';
import type { NeonQueryFunction } from '@neondatabase/serverless';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateToken(req)) {
    unauthorizedResponse(res);
    return;
  }
  if (!enforceRateLimit(req, res)) return;

  const sql = getSql();

  try {
    if (req.method === 'GET') {
      const rows = await sql.query('SELECT content, updated_at FROM notes WHERE id = 1');
      if (rows.length === 0) {
        await sql.query(
          "INSERT INTO notes (id, content) VALUES (1, '') ON CONFLICT (id) DO NOTHING",
        );
        const newRows = await sql.query('SELECT content, updated_at FROM notes WHERE id = 1');
        res.status(200).json(newRows[0]);
        return;
      }
      res.status(200).json(rows[0]);
      return;
    }

    if (req.method === 'POST') {
      const { content, base_updated_at } = req.body as {
        content: string;
        base_updated_at?: string;
      };
      if (typeof content !== 'string') {
        res.status(400).json({ error: 'content must be string' });
        return;
      }
      // Optimistic-concurrency guard: when the client tells us which version
      // it based its edits on, refuse to silently clobber a newer one.
      if (typeof base_updated_at === 'string' && base_updated_at.length > 0) {
        const current = await sql.query('SELECT content, updated_at FROM notes WHERE id = 1');
        if (current.length > 0 && String(current[0].updated_at) !== base_updated_at) {
          res.status(409).json({
            error: 'Note changed on another device',
            server: { content: current[0].content, updated_at: current[0].updated_at },
          });
          return;
        }
      }
      const rows = await sql.query(
        'INSERT INTO notes (id, content) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW() RETURNING content, updated_at',
        [content],
      );
      // Best-effort history: keep going even if the revisions table
      // doesn't exist yet (migration not run) — the save itself succeeded.
      void recordRevision(sql, content).catch((e) => console.error('revision error', e));
      res.status(200).json(rows[0]);
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('note endpoint error', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Append a revision only when the content actually differs from the latest
 * one, and cap history at 50 entries. Throws when the table is missing —
 * callers treat that as non-fatal.
 */
async function recordRevision(
  sql: NeonQueryFunction<false, false>,
  content: string,
): Promise<void> {
  const latest = await sql.query('SELECT content FROM note_revisions ORDER BY id DESC LIMIT 1');
  if (latest.length > 0 && latest[0].content === content) return;
  await sql.query('INSERT INTO note_revisions (content) VALUES ($1)', [content]);
  await sql.query(
    'DELETE FROM note_revisions WHERE id NOT IN (SELECT id FROM note_revisions ORDER BY id DESC LIMIT 50)',
  );
}
