import JSZip from 'jszip';
import {
  createNote,
  fetchDocumentBlob,
  getNote,
  listDocuments,
  listNotes,
  saveNote,
  updateNote,
  uploadFile,
} from './api';
import {
  decryptBytes,
  decryptText,
  encryptBytes,
  encryptText,
  isEncryptedText,
  toBufferView,
} from './crypto';
import { getCryptoKey, isE2EEnabled } from './e2e';

export interface BackupProgress {
  phase: 'notes' | 'files';
  done: number;
  total: number;
}

interface BackupManifest {
  app: 'noting';
  version: 1;
  exported_at: string;
  notes: { file: string; title: string; pinned: boolean; archived: boolean; enc: boolean }[];
  documents: { file: string; name: string; type: string; enc: boolean }[];
}

function sanitizeFileName(name: string): string {
  const clean = name
    .replace(/[\\/:*?"<>|#%&\s]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
  return clean.replace(/^-+|-+$/g, '') || 'untitled';
}

async function maybeDecryptBytes(data: Uint8Array, enc: boolean): Promise<Uint8Array> {
  if (!enc) return data;
  const key = await getCryptoKey();
  if (!key) throw new Error('No encryption key — cannot back up encrypted content');
  return decryptBytes(key, data);
}

/** Notes use the ENC1 text envelope; tolerate a flag/content mismatch gracefully. */
async function notePlaintext(content: string): Promise<string> {
  if (!isEncryptedText(content)) return content;
  const key = await getCryptoKey();
  if (!key) throw new Error('No encryption key — cannot back up encrypted content');
  return decryptText(key, content);
}

/**
 * Full workspace backup as a .zip: plaintext note markdown files, original
 * document bytes (decrypted on the fly), and a manifest describing both.
 * Encrypted content is decrypted in-browser first — the zip itself is NOT
 * encrypted, so store it somewhere safe.
 */
export async function exportBackup(onProgress?: (progress: BackupProgress) => void): Promise<Blob> {
  const zip = new JSZip();
  const notes = await listNotes();
  const manifest: BackupManifest = {
    app: 'noting',
    version: 1,
    exported_at: new Date().toISOString(),
    notes: [],
    documents: [],
  };

  for (let i = 0; i < notes.length; i++) {
    const summary = notes[i];
    onProgress?.({ phase: 'notes', done: i, total: notes.length });
    const full = await getNote(summary.id);
    const text = await notePlaintext(full.content);
    const file = `notes/${summary.id}-${sanitizeFileName(summary.title)}.md`;
    zip.file(file, text);
    manifest.notes.push({
      file,
      title: summary.title,
      pinned: summary.pinned,
      archived: summary.archived,
      enc: summary.enc,
    });
  }
  onProgress?.({ phase: 'notes', done: notes.length, total: notes.length });

  const docs = await listDocuments();
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    onProgress?.({ phase: 'files', done: i, total: docs.length });
    const fetched = await fetchDocumentBlob(doc.id);
    const bytes = new Uint8Array(await fetched.blob.arrayBuffer());
    const clear = await maybeDecryptBytes(bytes, fetched.enc);
    const file = `files/${doc.id}-${sanitizeFileName(doc.file_name)}`;
    zip.file(file, toBufferView(clear));
    manifest.documents.push({ file, name: doc.file_name, type: fetched.fileType, enc: doc.enc });
  }
  onProgress?.({ phase: 'files', done: docs.length, total: docs.length });

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: 'blob' });
}

export interface ImportResult {
  notes: number;
  files: number;
  failed: number;
}

/**
 * Restore a backup zip. Notes are recreated with their titles/pins; files are
 * re-uploaded (and re-encrypted when E2E is currently on). Idempotent-safe to
 * run twice — it just creates duplicates, so the summary toast says as much.
 */
export async function importBackup(
  file: File,
  onProgress?: (progress: BackupProgress) => void,
): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('Not a Noting backup (manifest.json missing)');
  const manifest = JSON.parse(await manifestFile.async('string')) as BackupManifest;
  if (manifest.app !== 'noting' || !Array.isArray(manifest.notes)) {
    throw new Error('Unrecognized backup format');
  }

  const e2e = isE2EEnabled();
  let notes = 0;
  let files = 0;
  let failed = 0;

  for (let i = 0; i < manifest.notes.length; i++) {
    const entry = manifest.notes[i];
    onProgress?.({ phase: 'notes', done: i, total: manifest.notes.length });
    try {
      const text = await zip.file(entry.file)?.async('string');
      if (typeof text !== 'string') throw new Error('missing entry');
      const created = await createNote(entry.title);
      const key = entry.enc || e2e ? await getCryptoKey() : null;
      const content = key ? await encryptText(key, text) : text;
      await saveNote({
        id: created.id,
        content,
        baseUpdatedAt: created.updated_at,
        enc: !!key,
      });
      if (entry.pinned || entry.archived) {
        await updateNote(created.id, { pinned: entry.pinned, archived: entry.archived });
      }
      notes++;
    } catch {
      failed++;
    }
  }

  for (let i = 0; i < (manifest.documents ?? []).length; i++) {
    const entry = manifest.documents[i];
    onProgress?.({ phase: 'files', done: i, total: manifest.documents.length });
    try {
      const data = await zip.file(entry.file)?.async('uint8array');
      if (!data) throw new Error('missing entry');
      let payload = new File([toBufferView(data)], entry.name, { type: entry.type });
      let encrypted = false;
      if (e2e) {
        const key = await getCryptoKey();
        if (!key) throw new Error('No encryption key');
        payload = new File([toBufferView(await encryptBytes(key, data))], entry.name, {
          type: entry.type,
        });
        encrypted = true;
      }
      await uploadFile(payload, undefined, encrypted);
      files++;
    } catch {
      failed++;
    }
  }

  return { notes, files, failed };
}
