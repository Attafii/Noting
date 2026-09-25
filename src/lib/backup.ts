import JSZip, { type JSZipObject } from 'jszip';
import {
  createFolder,
  createNote,
  createRevision,
  deleteDocument,
  deleteNote,
  fetchDocumentBlob,
  getNote,
  listDocuments,
  listFolders,
  listNotes,
  listRevisions,
  listTrash,
  listTrashedNotes,
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
  version: 2;
  exported_at: string;
  folders: {
    source_id: number;
    name: string;
    sort_order: number;
  }[];
  notes: {
    source_id: number;
    file: string;
    title: string;
    pinned: boolean;
    archived: boolean;
    favorite: boolean;
    folder_id: number | null;
    sort_order: number;
    tags: string[];
    created_at: string;
    updated_at: string;
    deleted: boolean;
    enc: boolean;
    revisions: { content: string; created_at: string; enc: boolean }[];
  }[];
  documents: {
    source_id: number;
    file: string;
    name: string;
    type: string;
    enc: boolean;
    deleted: boolean;
    uploaded_at: string;
  }[];
}

/** Exported for unit tests. */
export function sanitizeFileName(name: string): string {
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

async function getCryptoKeyOrThrow(): Promise<CryptoKey> {
  const key = await getCryptoKey();
  if (!key) throw new Error('No encryption key');
  return key;
}

/**
 * Full workspace backup as a .zip: plaintext note markdown files, original
 * document bytes (decrypted on the fly), and a manifest describing both.
 * Encrypted content is decrypted in-browser first — the zip itself is NOT
 * encrypted, so store it somewhere safe.
 */
export async function exportBackup(onProgress?: (progress: BackupProgress) => void): Promise<Blob> {
  const zip = new JSZip();
  const folders = await listFolders();
  const activeNotes = await listNotes();
  const trashedNotes = await listTrashedNotes();
  const trashedNoteIds = new Set(trashedNotes.map((note) => note.id));
  const notes = [...activeNotes, ...trashedNotes];
  const documents = [...(await listDocuments()), ...(await listTrash())];
  const manifest: BackupManifest = {
    app: 'noting',
    version: 2,
    exported_at: new Date().toISOString(),
    folders: folders.map((folder) => ({
      source_id: folder.id,
      name: folder.name,
      sort_order: folder.sort_order,
    })),
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
    const revisions = await listRevisions(summary.id);
    manifest.notes.push({
      source_id: summary.id,
      file,
      title: summary.title,
      pinned: summary.pinned,
      archived: summary.archived,
      favorite: summary.favorite,
      folder_id: summary.folder_id,
      sort_order: summary.sort_order ?? 0,
      tags: summary.tags ?? [],
      created_at: summary.created_at,
      updated_at: summary.updated_at,
      deleted: trashedNoteIds.has(summary.id),
      enc: summary.enc,
      revisions: await Promise.all(
        revisions.map(async (revision) => ({
          content: revision.enc ? await notePlaintext(revision.content) : revision.content,
          created_at: revision.created_at,
          enc: revision.enc ?? false,
        })),
      ),
    });
  }
  onProgress?.({ phase: 'notes', done: notes.length, total: notes.length });

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    onProgress?.({ phase: 'files', done: i, total: documents.length });
    const isDeleted = typeof doc.deleted_at === 'string';
    const fetched = await fetchDocumentBlob(doc.id, isDeleted);
    const bytes = new Uint8Array(await fetched.blob.arrayBuffer());
    const clear = await maybeDecryptBytes(bytes, fetched.enc);
    const file = `files/${doc.id}-${sanitizeFileName(doc.file_name)}`;
    zip.file(file, toBufferView(clear));
    manifest.documents.push({
      source_id: doc.id,
      file,
      name: doc.file_name,
      type: fetched.fileType,
      enc: doc.enc,
      deleted: isDeleted,
      uploaded_at: doc.uploaded_at,
    });
  }
  onProgress?.({ phase: 'files', done: documents.length, total: documents.length });

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: 'blob' });
}

export interface ImportResult {
  notes: number;
  files: number;
  failed: number;
}

/** Zip-bomb backstops: hostile archives decompress to gigabytes from kilobytes. */
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_ENTRIES = 2000;

/** Declared uncompressed size from the zip central directory (null if unknown). */
function declaredSize(entry: JSZipObject): number | null {
  const internal = entry as unknown as { _data?: { uncompressedSize?: unknown } };
  const size = internal._data?.uncompressedSize;
  return typeof size === 'number' && size >= 0 ? size : null;
}

/** Pre-scan every file we intend to extract before decompression. */
export function planExtraction(
  zip: JSZip,
  files: string[],
): { allowed: Set<string>; rejected: number; total: number } {
  const allowed = new Set<string>();
  let rejected = 0;
  let total = 0;
  const names = files.slice(0, MAX_ENTRIES);
  rejected += Math.max(0, files.length - names.length);
  for (const name of names) {
    const entry = zip.file(name);
    if (!entry || entry.dir) {
      rejected++;
      continue;
    }
    const size = declaredSize(entry);
    if (size !== null && (size > MAX_ENTRY_BYTES || total + size > MAX_TOTAL_BYTES)) {
      rejected++;
      continue;
    }
    allowed.add(name);
    total += size ?? 0;
  }
  return { allowed, rejected, total };
}

/** Restore a backup zip, preserving organization, trash state, and document links. */
export async function importBackup(
  file: File,
  onProgress?: (progress: BackupProgress) => void,
): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('Not a Noting backup (manifest.json missing)');
  const parsed = JSON.parse(await manifestFile.async('string')) as Partial<BackupManifest> & {
    version?: number;
  };
  if (parsed.app !== 'noting' || !Array.isArray(parsed.notes)) {
    throw new Error('Unrecognized backup format');
  }
  if (parsed.version !== 2) {
    const legacy = parsed as unknown as {
      notes?: Array<{
        file: string;
        title: string;
        pinned: boolean;
        archived: boolean;
        enc: boolean;
      }>;
      documents?: Array<{ file: string; name: string; type: string; enc: boolean }>;
    };
    parsed.notes = (legacy.notes ?? []).map((entry, index) => ({
      source_id: index + 1,
      file: entry.file,
      title: entry.title,
      pinned: entry.pinned,
      archived: entry.archived,
      favorite: false,
      folder_id: null,
      sort_order: index,
      tags: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted: false,
      enc: entry.enc,
      revisions: [],
    }));
    parsed.documents = (legacy.documents ?? []).map((entry, index) => ({
      source_id: index + 1,
      file: entry.file,
      name: entry.name,
      type: entry.type,
      enc: entry.enc,
      deleted: false,
      uploaded_at: new Date().toISOString(),
    }));
    parsed.folders = [];
    parsed.version = 2;
  }

  const manifest = parsed as BackupManifest;
  const e2e = isE2EEnabled();
  if (manifest.notes.length + manifest.documents.length > MAX_ENTRIES) {
    throw new Error('Backup contains too many entries');
  }
  let notes = 0;
  let files = 0;
  let failed = 0;
  let extractedBytes = 0;
  const plan = planExtraction(zip, [
    ...manifest.notes.map((entry) => entry.file),
    ...manifest.documents.map((entry) => entry.file),
  ]);
  failed += plan.rejected;

  const folderMap = new Map<number, number>();
  for (const folder of manifest.folders ?? []) {
    try {
      const created = await createFolder(folder.name);
      folderMap.set(folder.source_id, created.id);
    } catch {
      failed++;
    }
  }

  const documentMap = new Map<number, number>();
  for (let i = 0; i < manifest.documents.length; i++) {
    const entry = manifest.documents[i];
    onProgress?.({ phase: 'files', done: i, total: manifest.documents.length });
    if (!plan.allowed.has(entry.file)) continue;
    try {
      const data = await zip.file(entry.file)?.async('uint8array');
      if (!data) throw new Error('missing entry');
      extractedBytes += data.byteLength;
      if (data.byteLength > MAX_ENTRY_BYTES || extractedBytes > MAX_TOTAL_BYTES) {
        throw new Error('archive is too large');
      }
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
      const uploaded = await uploadFile(payload, undefined, encrypted);
      documentMap.set(entry.source_id, uploaded.id);
      if (entry.deleted) await deleteDocument(uploaded.id);
      files++;
    } catch {
      failed++;
    }
  }
  onProgress?.({
    phase: 'files',
    done: manifest.documents.length,
    total: manifest.documents.length,
  });

  for (let i = 0; i < manifest.notes.length; i++) {
    const entry = manifest.notes[i];
    onProgress?.({ phase: 'notes', done: i, total: manifest.notes.length });
    if (!plan.allowed.has(entry.file)) continue;
    try {
      const text = await zip.file(entry.file)?.async('string');
      if (typeof text !== 'string') throw new Error('missing entry');
      extractedBytes += new TextEncoder().encode(text).byteLength;
      if (extractedBytes > MAX_TOTAL_BYTES) throw new Error('archive is too large');
      const rewritten = text.replace(/\/api\/download\?id=(\d+)/g, (match, sourceId: string) => {
        const mapped = documentMap.get(Number(sourceId));
        return mapped ? `/api/download?id=${mapped}` : match;
      });
      const created = await createNote(entry.title);
      let content = rewritten;
      let enc = false;
      if (e2e) {
        const key = await getCryptoKey();
        if (!key) throw new Error('No encryption key');
        content = await encryptText(key, rewritten);
        enc = true;
      }
      await saveNote({
        id: created.id,
        content,
        baseVersion: created.content_version ?? 1,
        mutationId: crypto.randomUUID(),
        enc,
      });
      const folderId = entry.folder_id === null ? null : (folderMap.get(entry.folder_id) ?? null);
      await updateNote(created.id, {
        pinned: entry.pinned,
        archived: entry.archived,
        favorite: entry.favorite,
        folder_id: folderId,
        sort_order: entry.sort_order,
        tags: entry.tags,
      });
      for (const revision of entry.revisions ?? []) {
        const revisionContent = e2e
          ? await encryptText(await getCryptoKeyOrThrow(), revision.content)
          : revision.content;
        await createRevision({ noteId: created.id, content: revisionContent, enc: e2e });
      }
      if (entry.deleted) await deleteNote(created.id);
      notes++;
    } catch {
      failed++;
    }
  }
  onProgress?.({ phase: 'notes', done: manifest.notes.length, total: manifest.notes.length });

  return { notes, files, failed };
}
