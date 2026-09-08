import { aiConfigured, embedTexts, vectorLiteral, EMBED_MODEL } from './_ai';
import { getSql } from '../src/lib/db';

const MAX_CHARS = 40_000;
const CHUNK_CHARS = 900;
const CHUNK_OVERLAP = 120;
const MAX_CHUNKS = 60;
const EMBED_BATCH = 8;

/** MIME/extension allowlist for RAG indexing (text-extractable only). */
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

function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length <= CHUNK_CHARS) {
      current = current ? current + '\n\n' + para : para;
    } else {
      if (current) chunks.push(current);
      current = para.length > CHUNK_CHARS ? para.slice(0, CHUNK_CHARS) : para;
    }
    if (chunks.length >= MAX_CHUNKS) break;
  }
  if (current && chunks.length < MAX_CHUNKS) chunks.push(current);
  // Sliding overlap so boundaries don't hide answers.
  return chunks.map((chunk, i) =>
    i === 0 ? chunk : chunks[i - 1].slice(-CHUNK_OVERLAP) + '\n\n' + chunk,
  );
}

/**
 * Best-effort RAG indexing for a freshly uploaded document. Never throws —
 * indexing failures must not fail uploads. Skips encrypted files (only
 * ciphertext is visible server-side) and non-text formats.
 */
export async function indexDocument(
  documentId: number,
  fileName: string,
  mime: string,
  data: Buffer,
  encrypted: boolean,
): Promise<{ indexed: number }> {
  if (encrypted || !aiConfigured() || !indexableFile(fileName, mime)) {
    return { indexed: 0 };
  }
  try {
    const text = data.toString('utf8').slice(0, MAX_CHARS);
    if (!text.trim()) return { indexed: 0 };
    const chunks = chunkText(text);
    if (chunks.length === 0) return { indexed: 0 };

    const sql = getSql();
    let indexed = 0;
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const vectors = await embedTexts(batch);
      if (!vectors) break;
      for (let j = 0; j < batch.length; j++) {
        await sql.query(
          'INSERT INTO document_chunks (document_id, chunk_index, content, embedding, model) VALUES ($1, $2, $3, $4::vector, $5)',
          [documentId, i + j, batch[j], vectorLiteral(vectors[j]), EMBED_MODEL],
        );
        indexed++;
      }
    }
    return { indexed };
  } catch (e) {
    console.error('indexing error', e);
    return { indexed: 0 };
  }
}
