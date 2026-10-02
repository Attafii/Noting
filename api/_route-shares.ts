import { randomBytes, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { hashToken, requireUser } from './_auth.js';
import { enforceRateLimit } from './_ratelimit.js';
import { getSql } from '../src/lib/db.js';

const MAX_DAYS = 30;
const DEFAULT_DAYS = 7;
const SHARE_COLUMNS =
  's.id, s.note_id, s.expires_at, s.revoked_at, s.created_at, n.title AS note_title';
/** Share ids are random UUIDs — not integers like note ids. */
const SHARE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseId(value: unknown): number | null {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Manage read-only share links for the caller's own notes.
 *
 * - `POST` mints a link: 192-bit token (base64url) returned ONCE; only
 *   sha256(token) is stored. Plaintext notes only — encrypted, trashed and
 *   cross-user notes all answer with the same 404 (no id oracle).
 * - `GET` lists the caller's links (optionally `?note_id=`) for the manage UI.
 * - `DELETE ?id=` revokes (soft: revoked_at); a revoked link is a uniform 404
 *   on the public reader.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (!(await enforceRateLimit(req, res, { limit: 20, scope: 'share' }))) return;

  try {
    const sql = getSql();

    if (req.method === 'GET') {
      const noteId = parseId(req.query?.note_id);
      const rows = noteId
        ? await sql.query(
            `SELECT ${SHARE_COLUMNS} FROM share_links s
             JOIN notes n ON n.id = s.note_id
             WHERE s.user_id = $1 AND s.note_id = $2
             ORDER BY s.created_at DESC LIMIT 50`,
            [userId, noteId],
          )
        : await sql.query(
            `SELECT ${SHARE_COLUMNS} FROM share_links s
             JOIN notes n ON n.id = s.note_id
             WHERE s.user_id = $1
             ORDER BY s.created_at DESC LIMIT 100`,
            [userId],
          );
      res.status(200).json(rows);
      return;
    }

    if (req.method === 'POST') {
      const { note_id, days } = (req.body ?? {}) as { note_id?: unknown; days?: unknown };
      const id = parseId(note_id);
      if (id === null) {
        res.status(400).json({ error: 'note_id must be a positive integer' });
        return;
      }
      const dayCount =
        typeof days === 'number' && Number.isFinite(days) ? Math.trunc(days) : DEFAULT_DAYS;
      if (dayCount < 1 || dayCount > MAX_DAYS) {
        res.status(400).json({ error: `days must be between 1 and ${MAX_DAYS}` });
        return;
      }
      // Ownership + shareability in one query; identical 404 for "not yours",
      // "trashed" and "encrypted" so the response leaks nothing.
      const note = await sql.query(
        'SELECT id FROM notes WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND enc = FALSE',
        [id, userId],
      );
      if (note.length === 0) {
        res
          .status(404)
          .json({ error: 'Note not found — encrypted or trashed notes cannot be shared' });
        return;
      }
      const token = randomBytes(24).toString('base64url');
      const shareId = randomUUID();
      const expiresAt = new Date(Date.now() + dayCount * 24 * 60 * 60 * 1000).toISOString();
      await sql.query(
        'INSERT INTO share_links (id, note_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5)',
        [shareId, id, userId, hashToken(token), expiresAt],
      );
      res.status(201).json({ id: shareId, note_id: id, token, expires_at: expiresAt });
      return;
    }

    if (req.method === 'DELETE') {
      const id = typeof req.query?.id === 'string' ? req.query.id : '';
      if (!SHARE_ID_RE.test(id)) {
        res.status(400).json({ error: 'Missing id query parameter' });
        return;
      }
      const rows = await sql.query(
        'UPDATE share_links SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id',
        [id, userId],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: 'Share link not found' });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('shares endpoint error', e);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
}
