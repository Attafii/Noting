import { aiConfigured, embedTexts, vectorLiteral, EMBED_MODEL } from './_ai.js';
import { getSql } from '../src/lib/db.js';

const MAX_CHARS = 40_000;
const CHUNK_CHARS = 900;
const CHUNK_OVERLAP = 120;
const MAX_CHUNKS = 60;
const EMBED_BATCH = 8;

export function indexableFile(fileName: string, mime: string): boolean {
  if (mime.startsWith('text/')) return true;
  if (
    mime === 'application/json' ||
    mime === 'text/csv' ||
    mime === 'application/csv' ||
    mime === 'text/markdown' ||
    mime.endsWith('+json')
  ) {
    return true;
  }
  return /\.(txt|md|markdown|csv|tsv|json|jsonl|log|yaml|yml|xml|html?)$/i.test(fileName);
}

function splitLongText(value: string): string[] {
  const pieces: string[] = [];
  const step = CHUNK_CHARS - CHUNK_OVERLAP;
  for (let start = 0; start < value.length; start += step) {
    pieces.push(value.slice(start, start + CHUNK_CHARS));
    if (pieces.length >= MAX_CHUNKS) break;
  }
  return pieces;
}

export function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/);
  const raw: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_CHARS) {
      if (current) {
        raw.push(current);
        current = '';
      }
      raw.push(...splitLongText(paragraph));
      continue;
    }
    if ((current + '\n\n' + paragraph).length <= CHUNK_CHARS) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    } else {
      if (current) raw.push(current);
      current = paragraph;
    }
    if (raw.length >= MAX_CHUNKS) break;
  }
  if (current && raw.length < MAX_CHUNKS) raw.push(current);
  return raw
    .slice(0, MAX_CHUNKS)
    .map((chunk, index) =>
      index === 0 ? chunk : `${raw[index - 1].slice(-CHUNK_OVERLAP)}\n\n${chunk}`,
    )
    .filter((chunk) => chunk.length <= CHUNK_CHARS + CHUNK_OVERLAP + 2);
}

async function markStatus(
  documentId: number,
  status: 'processing' | 'ready' | 'failed' | 'skipped',
  error?: string,
): Promise<void> {
  try {
    const sql = getSql();
    await sql.query(
      `UPDATE documents SET index_status = $1, index_error = $2,
       indexed_at = CASE WHEN $1 = 'ready' THEN NOW() ELSE indexed_at END
       WHERE id = $3`,
      [status, error ?? null, documentId],
    );
    await sql.query(
      `UPDATE index_jobs SET status = $1, last_error = $2, updated_at = NOW(),
       next_attempt_at = NOW() WHERE document_id = $3`,
      [status, error ?? null, documentId],
    );
  } catch {
    return;
  }
}

export async function indexDocument(
  documentId: number,
  fileName: string,
  mime: string,
  data: Buffer,
  encrypted: boolean,
  ownerUserId?: string,
): Promise<{ indexed: number }> {
  if (encrypted || !indexableFile(fileName, mime)) {
    await markStatus(documentId, 'skipped');
    return { indexed: 0 };
  }
  if (!aiConfigured()) {
    await markStatus(documentId, 'skipped', 'AI embeddings are not configured');
    return { indexed: 0 };
  }

  try {
    const sql = getSql();
    if (ownerUserId) {
      const owner = await sql.query('SELECT id FROM documents WHERE id = $1 AND user_id = $2', [
        documentId,
        ownerUserId,
      ]);
      if (owner.length === 0) return { indexed: 0 };
    }
    const text = data.toString('utf8').slice(0, MAX_CHARS);
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      await markStatus(documentId, 'skipped');
      return { indexed: 0 };
    }

    await markStatus(documentId, 'processing');
    await sql.query('DELETE FROM document_chunks WHERE document_id = $1', [documentId]);
    let indexed = 0;
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const vectors = await embedTexts(batch);
      if (!vectors) throw new Error('Embedding request failed');
      for (let j = 0; j < batch.length; j++) {
        await sql.query(
          'INSERT INTO document_chunks (document_id, chunk_index, content, embedding, model) VALUES ($1, $2, $3, $4::vector, $5)',
          [documentId, i + j, batch[j], vectorLiteral(vectors[j]), EMBED_MODEL],
        );
        indexed++;
      }
    }
    await markStatus(documentId, 'ready');
    return { indexed };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Indexing failed';
    await markStatus(documentId, 'failed', message.slice(0, 500));
    return { indexed: 0 };
  }
}

function bytesFromDatabase(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') {
    const hex = value.startsWith('\\x') ? value.slice(2) : value;
    if (/^[0-9a-fA-F]*$/.test(hex) && hex.length % 2 === 0) return Buffer.from(hex, 'hex');
    return Buffer.from(value, 'binary');
  }
  throw new Error('Unsupported document bytes');
}

export async function processIndexJobs(userId: string, limit = 3): Promise<number> {
  const sql = getSql();
  const jobs = await sql.query(
    `SELECT j.id, d.id AS document_id, d.file_name, d.file_type, d.file_data, d.enc
     FROM index_jobs j
     JOIN documents d ON d.id = j.document_id
     WHERE j.user_id = $1 AND j.status IN ('queued', 'failed')
       AND j.next_attempt_at <= NOW()
       AND d.deleted_at IS NULL
     ORDER BY j.created_at ASC LIMIT $2`,
    [userId, limit],
  );
  let processed = 0;
  for (const job of jobs) {
    const claimed = await sql.query(
      `UPDATE index_jobs SET status = 'processing', leased_until = NOW() + INTERVAL '2 minutes',
       updated_at = NOW() WHERE id = $1 AND status IN ('queued', 'failed') RETURNING id`,
      [job.id],
    );
    if (claimed.length === 0) continue;
    await indexDocument(
      Number(job.document_id),
      String(job.file_name),
      String(job.file_type),
      bytesFromDatabase(job.file_data),
      Boolean(job.enc),
      userId,
    );
    processed++;
  }
  return processed;
}
