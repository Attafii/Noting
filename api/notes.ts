import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateToken, unauthorizedResponse } from './_auth';
import { enforceRateLimit } from './_ratelimit';
import { getSql } from '../src/lib/db';
import type { NeonQueryFunction } from '@neondatabase/serverless';

const LIST_COLUMNS =
  'notes.id, notes.title, notes.pinned, notes.archived, notes.enc, notes.folder_id, notes.favorite, ' +
  'notes.sort_order, notes.updated_at, notes.created_at, LEFT(notes.content, 160) AS preview, ' +
  "(SELECT COALESCE(array_agg(t.tag), '{}') FROM note_tags t WHERE t.note_id = notes.id) AS tags";

type SortKey = 'updated' | 'created' | 'alpha' | 'manual';

function parseSort(value: unknown): SortKey {
  if (value === 'created' || value === 'alpha' || value === 'manual') return value;
  return 'updated';
}

function orderBy(sort: SortKey): string {
  switch (sort) {
    case 'created':
      return 'ORDER BY notes.pinned DESC, notes.favorite DESC, notes.created_at DESC';
    case 'alpha':
      return 'ORDER BY notes.pinned DESC, notes.favorite DESC, notes.title ASC';
    case 'manual':
      return 'ORDER BY notes.pinned DESC, notes.favorite DESC, notes.sort_order ASC, notes.updated_at DESC';
    default:
      return 'ORDER BY notes.pinned DESC, notes.favorite DESC, notes.updated_at DESC';
  }
}

function cleanTag(tag: unknown): string | null {
  if (typeof tag !== 'string') return null;
  const clean = tag.trim().toLowerCase().slice(0, 50);
  return clean ? clean : null;
}

async function setTags(
  sql: NeonQueryFunction<false, false>,
  noteId: number,
  tags: unknown,
): Promise<void> {
  if (!Array.isArray(tags)) return;
  const clean = [...new Set(tags.map(cleanTag).filter((t): t is string => t !== null))].slice(
    0,
    30,
  );
  await sql.query('DELETE FROM note_tags WHERE note_id = $1', [noteId]);
  for (const tag of clean) {
    await sql.query('INSERT INTO note_tags (note_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
      noteId,
      tag,
    ]);
  }
}

async function ensureOrgColumns(sql: NeonQueryFunction<false, false>): Promise<void> {
  // Best-effort: fresh checkouts that haven't run migrate-008 yet keep working
  // (new columns simply read as null/false). Runs once per cold start at most
  // in practice; failures are swallowed by callers.
  await sql.query('ALTER TABLE notes ADD COLUMN IF NOT EXISTS folder_id INTEGER');
  await sql.query(
    'ALTER TABLE notes ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE',
  );
  await sql.query(
    'ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL',
  );
  await sql.query(
    'ALTER TABLE notes ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0',
  );
  await sql.query(
    'CREATE TABLE IF NOT EXISTS note_tags (note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY (note_id, tag))',
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateToken(req)) {
    unauthorizedResponse(res);
    return;
  }
  if (!(await enforceRateLimit(req, res))) return;

  const sql = getSql();

  try {
    if (req.method === 'GET') {
      await ensureOrgColumns(sql).catch(() => undefined);
      const trash = req.query?.trash === '1';
      const sort = parseSort(typeof req.query?.sort === 'string' ? req.query.sort : undefined);
      const where = trash ? 'WHERE notes.deleted_at IS NOT NULL' : 'WHERE notes.deleted_at IS NULL';
      const rows = await sql.query(`SELECT ${LIST_COLUMNS} FROM notes ${where} ${orderBy(sort)}`);
      res.status(200).json(rows);
      return;
    }

    if (req.method === 'POST') {
      const { title, folder_id, action, id } = (req.body ?? {}) as {
        title?: string;
        folder_id?: number | null;
        action?: string;
        id?: number;
      };
      // Restore from trash (mirrors the documents endpoint convention).
      if (action === 'restore' && typeof id === 'number' && Number.isInteger(id)) {
        await ensureOrgColumns(sql).catch(() => undefined);
        const rows = await sql.query(
          'UPDATE notes SET deleted_at = NULL, updated_at = NOW() WHERE id = $1 RETURNING id',
          [id],
        );
        if (rows.length === 0) {
          res.status(404).json({ error: 'Note not found' });
          return;
        }
        res.status(200).json({ ok: true });
        return;
      }
      const clean =
        typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'Untitled';
      const folder =
        typeof folder_id === 'number' && Number.isInteger(folder_id) ? folder_id : null;
      const rows = await sql.query(
        `INSERT INTO notes (title, content, folder_id) VALUES ($1, '', $2)
         RETURNING id, title, content, pinned, archived, enc, folder_id, favorite, updated_at, created_at`,
        [clean, folder],
      );
      res.status(201).json({ ...rows[0], tags: [] });
      return;
    }

    if (req.method === 'PATCH') {
      const { id, title, pinned, archived, folder_id, favorite, sort_order, tags } = (req.body ??
        {}) as {
        id?: number;
        title?: string;
        pinned?: boolean;
        archived?: boolean;
        folder_id?: number | null;
        favorite?: boolean;
        sort_order?: number;
        tags?: unknown;
      };
      if (typeof id !== 'number' || !Number.isInteger(id)) {
        res.status(400).json({ error: 'id must be an integer' });
        return;
      }
      await ensureOrgColumns(sql).catch(() => undefined);
      const folderSet =
        folder_id === null || (typeof folder_id === 'number' && Number.isInteger(folder_id));
      // Org-only edits (folder/favorite/order/tags) must not move updated_at:
      // the editor's conflict anchor compares it, and a bump without a content
      // change would manufacture a false 409 on the next autosave.
      const rows = await sql.query(
        `UPDATE notes SET
           title = COALESCE($2, title),
           pinned = COALESCE($3, pinned),
           archived = COALESCE($4, archived),
           folder_id = CASE WHEN $5 THEN $6 ELSE folder_id END,
           favorite = COALESCE($7, favorite),
           sort_order = COALESCE($8, sort_order),
           updated_at = CASE WHEN $2 IS NOT NULL OR $3 IS NOT NULL OR $4 IS NOT NULL THEN NOW() ELSE updated_at END
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, title, content, pinned, archived, enc, folder_id, favorite, updated_at, created_at`,
        [
          id,
          typeof title === 'string' ? title.trim().slice(0, 120) || null : null,
          typeof pinned === 'boolean' ? pinned : null,
          typeof archived === 'boolean' ? archived : null,
          folderSet,
          folderSet ? (typeof folder_id === 'number' ? folder_id : null) : null,
          typeof favorite === 'boolean' ? favorite : null,
          typeof sort_order === 'number' && Number.isFinite(sort_order)
            ? Math.trunc(sort_order)
            : null,
        ],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      if (tags !== undefined) {
        await setTags(sql, id, tags).catch(() => undefined);
      }
      const tagRows = await sql
        .query('SELECT tag FROM note_tags WHERE note_id = $1', [id])
        .catch(() => []);
      res.status(200).json({ ...rows[0], tags: tagRows.map((r) => r.tag) });
      return;
    }

    if (req.method === 'DELETE') {
      const id = parseId(req.query?.id);
      if (id === null) {
        res.status(400).json({ error: 'Missing id query parameter' });
        return;
      }
      await ensureOrgColumns(sql).catch(() => undefined);
      const permanent = req.query?.permanent === '1';
      if (permanent) {
        const count = await sql.query(
          'SELECT COUNT(*)::int AS n FROM notes WHERE deleted_at IS NULL',
        );
        if (count[0].n <= 1) {
          const trashed = await sql.query(
            'SELECT COUNT(*)::int AS n FROM notes WHERE deleted_at IS NOT NULL',
          );
          if (trashed[0].n === 0) {
            res.status(400).json({ error: 'Cannot delete the last note' });
            return;
          }
        }
        // Revisions, tags and future dependents cascade via FK.
        const rows = await sql.query('DELETE FROM notes WHERE id = $1 RETURNING id', [id]);
        if (rows.length === 0) {
          res.status(404).json({ error: 'Note not found' });
          return;
        }
        res.status(200).json({ ok: true });
        return;
      }
      // Soft-delete → 30-day trash (auto-purge runs on trash reads).
      const rows = await sql.query(
        'UPDATE notes SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
        [id],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      await sql
        .query(
          "DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days'",
        )
        .catch(() => undefined);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('notes endpoint error', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function parseId(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}
