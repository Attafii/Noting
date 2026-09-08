import {
  deleteDocument,
  fetchDocumentBlob,
  getNote,
  listDocuments,
  listNotes,
  saveNote,
  uploadFile,
} from './api';
import { decryptBytes, encryptBytes, encryptText, isEncryptedText, toBufferView } from './crypto';
import { getCryptoKey } from './e2e';

export interface MigrateResult {
  encrypted: number;
  skipped: number;
  failed: number;
}

export type MigrateProgress = (done: number, total: number) => void;

async function requireKey(): Promise<CryptoKey> {
  const key = await getCryptoKey();
  if (!key) throw new Error('No access token — cannot derive the encryption key');
  return key;
}

/**
 * Encrypt every plaintext note in place. Each save carries the note's current
 * `updated_at` as the conflict anchor, so a concurrent edit aborts that note
 * (counted as failed) instead of clobbering it.
 */
export async function encryptExistingNotes(onProgress?: MigrateProgress): Promise<MigrateResult> {
  const key = await requireKey();
  const notes = await listNotes();
  const targets = notes.filter((note) => !note.enc);
  let encrypted = 0;
  let skipped = 0;
  let failed = 0;
  for (let i = 0; i < targets.length; i++) {
    try {
      const full = await getNote(targets[i].id);
      if (full.enc || !full.content || isEncryptedText(full.content)) {
        skipped++;
      } else {
        const cipher = await encryptText(key, full.content);
        await saveNote({
          id: targets[i].id,
          content: cipher,
          baseUpdatedAt: full.updated_at,
          enc: true,
        });
        encrypted++;
      }
    } catch {
      failed++;
    }
    onProgress?.(i + 1, targets.length);
  }
  return { encrypted, skipped, failed };
}

/**
 * Encrypt every plaintext file: download → encrypt → re-upload as ciphertext
 * (original name and MIME preserved) → permanently delete the original.
 * Chunk indexes of deleted originals cascade away in the database.
 */
export async function encryptExistingFiles(onProgress?: MigrateProgress): Promise<MigrateResult> {
  const key = await requireKey();
  const docs = (await listDocuments()).filter((doc) => !doc.enc);
  let encrypted = 0;
  let failed = 0;
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    try {
      const fetched = await fetchDocumentBlob(doc.id);
      const bytes = new Uint8Array(await fetched.blob.arrayBuffer());
      const cipher = await encryptBytes(key, bytes);
      const encFile = new File([toBufferView(cipher)], doc.file_name, {
        type: doc.file_type || 'application/octet-stream',
      });
      await uploadFile(encFile, undefined, true);
      await deleteDocument(doc.id, true);
      encrypted++;
    } catch {
      failed++;
    }
    onProgress?.(i + 1, docs.length);
  }
  return { encrypted, skipped: 0, failed };
}

/** Decrypt stored file bytes with the current token's key. */
export async function decryptFileBytes(data: Uint8Array): Promise<Uint8Array> {
  const key = await requireKey();
  return decryptBytes(key, data);
}
