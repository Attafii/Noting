import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_auth.js';
import { enforceRateLimit } from './_ratelimit.js';
import { bodyTooLargeMessage, checkBodySize, MAX_NOTE_BYTES } from './_limits.js';
import { getSql } from '../src/lib/db.js';

const NOTE_COLUMNS =
  'id, title, content, pinned, archived, enc, content_version, folder_id, favorite, updated_at, created_at';

function parseId(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseVersion(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function mutationId(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value) ? value : randomUUID();
}

async function currentNote(
  sql: ReturnType<typeof getSql>,
  id: number,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await sql.query(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = $1 AND user_id = $2`, [
    id,
    userId,
  ]);
  return rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (!(await enforceRateLimit(req, res))) return;

  try {
    const sql = getSql();
    if (req.method === 'GET') {
      const id = parseId(req.query?.id);
      if (id === null) {
        res.status(400).json({ error: 'Missing id query parameter' });
        return;
      }
      const row = await currentNote(sql, id, userId);
      if (!row) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      res.status(200).json(row);
      return;
    }

    if (req.method === 'POST') {
      const body = (req.body ?? {}) as {
        id?: unknown;
        content?: unknown;
        base_version?: unknown;
        base_updated_at?: unknown;
        mutation_id?: unknown;
        enc?: unknown;
      };
      const noteId = parseId(body.id);
      if (noteId === null) {
        res.status(400).json({ error: 'id must be a positive integer' });
        return;
      }
      if (typeof body.content !== 'string') {
        res.status(400).json({ error: 'content must be string' });
        return;
      }
      const size = checkBodySize(body.content, MAX_NOTE_BYTES);
      if (size.over) {
        res.status(413).json({ error: bodyTooLargeMessage(size.bytes, MAX_NOTE_BYTES) });
        return;
      }

      const requestedMutationId = mutationId(body.mutation_id);
      const receipt = await sql.query(
        'SELECT applied_version FROM note_mutations WHERE user_id = $1 AND mutation_id = $2',
        [userId, requestedMutationId],
      );
      if (receipt.length > 0) {
        const existing = await currentNote(sql, noteId, userId);
        if (!existing) {
          res.status(404).json({ error: 'Note not found' });
          return;
        }
        res.status(200).json(existing);
        return;
      }

      let baseVersion = parseVersion(body.base_version);
      const existing = await currentNote(sql, noteId, userId);
      if (!existing) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      if (baseVersion === null) {
        if (typeof body.base_updated_at === 'string') {
          const currentTime = Date.parse(String(existing.updated_at));
          const baseTime = Date.parse(body.base_updated_at);
          if (!Number.isFinite(currentTime) || !Number.isFinite(baseTime)) {
            res.status(409).json({ error: 'Note changed on another device', server: existing });
            return;
          }
          if (Math.abs(currentTime - baseTime) > 1000) {
            res.status(409).json({ error: 'Note changed on another device', server: existing });
            return;
          }
          baseVersion = parseVersion(existing.content_version) ?? 1;
        } else {
          res.status(400).json({ error: 'base_version is required' });
          return;
        }
      }

      const currentVersion = parseVersion(existing.content_version) ?? 1;
      if (currentVersion !== baseVersion) {
        res.status(409).json({ error: 'Note changed on another device', server: existing });
        return;
      }
      const requestedEnc = typeof body.enc === 'boolean' ? body.enc : Boolean(existing.enc);
      if (existing.enc && !requestedEnc) {
        res.status(409).json({ error: 'Encrypted notes cannot be downgraded to plaintext' });
        return;
      }

      const rows = await sql.query(
        `WITH current AS (
           SELECT id, content, enc, content_version
           FROM notes
           WHERE id = $1 AND user_id = $2 AND content_version = $3
           FOR UPDATE
         ), revision AS (
           INSERT INTO note_revisions (note_id, content, source_version, enc)
           SELECT id, content, content_version, enc
           FROM current
           WHERE content <> $4 AND NOT ($5 AND enc = FALSE)
           RETURNING id
         ), updated AS (
           UPDATE notes n
           SET content = $4,
               enc = current.enc OR $5,
               content_version = current.content_version + 1,
               updated_at = NOW()
           FROM current
           WHERE n.id = current.id
           RETURNING n.id, n.title, n.content, n.pinned, n.archived, n.enc,
                     n.content_version, n.folder_id, n.favorite, n.updated_at, n.created_at
         ), receipt AS (
           INSERT INTO note_mutations (user_id, mutation_id, note_id, applied_version)
           SELECT $2, $6, id, content_version FROM updated
           ON CONFLICT (user_id, mutation_id) DO NOTHING
           RETURNING mutation_id
         )
         SELECT id, title, content, pinned, archived, enc, content_version,
                folder_id, favorite, updated_at, created_at
         FROM updated`,
        [noteId, userId, baseVersion, body.content, requestedEnc, requestedMutationId],
      );
      if (rows.length === 0) {
        const latest = await currentNote(sql, noteId, userId);
        if (!latest) {
          res.status(404).json({ error: 'Note not found' });
          return;
        }
        res.status(409).json({ error: 'Note changed on another device', server: latest });
        return;
      }
      res.status(200).json(rows[0]);
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('note endpoint error', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
}
