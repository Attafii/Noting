import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_auth.js';
import { enforceRateLimit } from './_ratelimit.js';
import { bodyTooLargeMessage, checkBodySize, MAX_NOTE_BYTES } from './_limits.js';
import { getSql } from '../src/lib/db.js';

function parseId(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (!(await enforceRateLimit(req, res))) return;

  try {
    const sql = getSql();
    if (req.method === 'POST') {
      const body = (req.body ?? {}) as {
        note_id?: unknown;
        revision_id?: unknown;
        content?: unknown;
        enc?: unknown;
      };
      const noteId = parseId(body.note_id);
      if (noteId === null || typeof body.content !== 'string') {
        res.status(400).json({ error: 'note_id and content are required' });
        return;
      }
      const size = checkBodySize(body.content, MAX_NOTE_BYTES);
      if (size.over) {
        res.status(413).json({ error: bodyTooLargeMessage(size.bytes, MAX_NOTE_BYTES) });
        return;
      }
      const owner = await sql.query(
        'SELECT content_version FROM notes WHERE id = $1 AND user_id = $2',
        [noteId, userId],
      );
      if (owner.length === 0) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      const revisionId = parseId(body.revision_id);
      if (revisionId !== null) {
        await sql.query(
          'UPDATE note_revisions SET content = $1, enc = $2 WHERE id = $3 AND note_id = $4',
          [body.content, body.enc === true, revisionId, noteId],
        );
        res.status(200).json({ ok: true });
        return;
      }
      await sql.query(
        `INSERT INTO note_revisions (note_id, content, source_version, enc)
         VALUES ($1, $2, $3, $4)`,
        [noteId, body.content, owner[0].content_version ?? 1, body.enc === true],
      );
      await sql.query(
        `DELETE FROM note_revisions WHERE note_id = $1 AND id NOT IN
         (SELECT id FROM note_revisions WHERE note_id = $1 ORDER BY id DESC LIMIT 50)`,
        [noteId],
      );
      res.status(201).json({ ok: true });
      return;
    }

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const noteId = parseId(req.query?.note_id);
    if (noteId === null) {
      res.status(400).json({ error: 'Missing note_id query parameter' });
      return;
    }
    const owner = await sql.query('SELECT id FROM notes WHERE id = $1 AND user_id = $2', [
      noteId,
      userId,
    ]);
    if (owner.length === 0) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    const rows = await sql.query(
      'SELECT id, content, enc, source_version, created_at FROM note_revisions WHERE note_id = $1 ORDER BY id DESC LIMIT 20',
      [noteId],
    );
    res.status(200).json(rows);
  } catch (error) {
    console.error('revisions endpoint error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
