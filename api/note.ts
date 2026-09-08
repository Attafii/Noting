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
      const id = parseId(req.query?.id) ?? 1;
      const rows = await sql.query(
        'SELECT id, title, content, pinned, archived, enc, updated_at, created_at FROM notes WHERE id = $1',
        [id],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      res.status(200).json(rows[0]);
      return;
    }

    if (req.method === 'POST') {
      const { id, content, base_updated_at, enc } = req.body as {
        id?: number;
        content: string;
        base_updated_at?: string;
        enc?: boolean;
      };
      const noteId = typeof id === 'number' && Number.isInteger(id) ? id : 1;
      if (typeof content !== 'string') {
        res.status(400).json({ error: 'content must be string' });
        return;
      }
      // Optimistic-concurrency guard: when the client tells us which version
      // it based its edits on, refuse to silently clobber a newer one.
      if (typeof base_updated_at === 'string' && base_updated_at.length > 0) {
        const current = await sql.query(
          'SELECT id, title, content, pinned, archived, enc, updated_at, created_at FROM notes WHERE id = $1',
          [noteId],
        );
        if (current.length === 0) {
          res.status(404).json({ error: 'Note not found' });
          return;
        }
        if (String(current[0].updated_at) !== base_updated_at) {
          res.status(409).json({
            error: 'Note changed on another device',
            server: current[0],
          });
          return;
        }
      }
      const rows = await sql.query(
        `UPDATE notes SET content = $1, enc = COALESCE($3, enc), updated_at = NOW()
         WHERE id = $2
         RETURNING id, title, content, pinned, archived, enc, updated_at, created_at`,
        [content, noteId, typeof enc === 'boolean' ? enc : null],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      // Best-effort history: keep going even if the revisions table
      // doesn't exist yet (migration not run) — the save itself succeeded.
      void recordRevision(sql, noteId, content).catch((e) => console.error('revision error', e));
      res.status(200).json(rows[0]);
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('note endpoint error', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function parseId(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Append a revision only when the content actually differs from the latest
 * one, and cap history at 50 entries per note. Throws when the table is
 * missing — callers treat that as non-fatal.
 */
async function recordRevision(
  sql: NeonQueryFunction<false, false>,
  noteId: number,
  content: string,
): Promise<void> {
  const latest = await sql.query(
    'SELECT content FROM note_revisions WHERE note_id = $1 ORDER BY id DESC LIMIT 1',
    [noteId],
  );
  if (latest.length > 0 && latest[0].content === content) return;
  await sql.query('INSERT INTO note_revisions (note_id, content) VALUES ($1, $2)', [
    noteId,
    content,
  ]);
  await sql.query(
    'DELETE FROM note_revisions WHERE note_id = $1 AND id NOT IN (SELECT id FROM note_revisions WHERE note_id = $1 ORDER BY id DESC LIMIT 50)',
    [noteId],
  );
}
