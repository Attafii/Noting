import { bridgeHeaders, getAnswer, getToken } from './token';

export class ApiError extends Error {
  status: number;
  code: 'UNAUTHORIZED' | 'RATE_LIMITED' | 'CONFLICT' | 'REQUEST_FAILED';
  /** Present on 409: the server's current version of the resource. */
  conflict?: NotePayload;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code =
      status === 401
        ? 'UNAUTHORIZED'
        : status === 429
          ? 'RATE_LIMITED'
          : status === 409
            ? 'CONFLICT'
            : 'REQUEST_FAILED';
  }
}

export interface NotePayload {
  id: number;
  title: string;
  content: string;
  pinned: boolean;
  archived: boolean;
  /** True when the stored content is client-side ciphertext (E2E). */
  enc: boolean;
  folder_id: number | null;
  favorite: boolean;
  updated_at: string;
  created_at: string;
  tags?: string[];
}

export interface NoteSummary {
  id: number;
  title: string;
  pinned: boolean;
  archived: boolean;
  enc: boolean;
  folder_id: number | null;
  favorite: boolean;
  sort_order?: number;
  updated_at: string;
  created_at: string;
  preview: string;
  tags: string[];
}

export interface Folder {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
  note_count: number;
}

export interface UsageStats {
  notes: { count: number; bytes: number };
  trashedNotes: { count: number };
  files: { count: number; bytes: number };
  trashedFiles: { count: number };
}

export type NoteSort = 'updated' | 'created' | 'alpha' | 'manual';

export interface NoteRevision {
  id: number;
  content: string;
  created_at: string;
}

export interface DocumentMeta {
  id: number;
  file_name: string;
  file_type: string;
  /** Bytes. Server derives it via octet_length — no schema migration needed. */
  file_size: number;
  enc: boolean;
  uploaded_at: string;
  deleted_at?: string | null;
}

export interface AskSource {
  document_id: number;
  file_name: string;
}

export interface AskResult {
  answer: string;
  sources: AskSource[];
  fallback?: boolean;
  warning?: string;
}

export interface FormatResult {
  formatted: string;
  /** True when the AI backend failed and the original text was returned untouched. */
  fallback?: boolean;
  warning?: string;
}

interface ErrorBody {
  error?: string;
}

function errorFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && typeof (body as ErrorBody).error === 'string') {
    return (body as ErrorBody).error as string;
  }
  return fallback;
}

/**
 * Parse a JSON response, failing with a human-readable error when the backend
 * answers with anything else (e.g. raw source or an HTML fallback page because
 * the serverless functions aren't executing where the app is hosted).
 */
async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    throw new ApiError(
      res.status,
      'API did not return JSON — the backend may not be running. ' +
        'Run `npm run dev` for local development, or deploy the Vercel functions.',
    );
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: bridgeHeaders(init?.headers) });
  } catch {
    throw new ApiError(0, 'Network error — check your connection');
  }
  if (res.status === 401) {
    throw new ApiError(401, 'Invalid or missing token');
  }
  if (res.status === 409 || res.status === 429 || !res.ok) {
    const body = await readJson(res).catch(() => null);
    const err = new ApiError(res.status, errorFromBody(body, `Request failed (${res.status})`));
    if (res.status === 409) {
      const server = (body as { server?: NotePayload } | null)?.server;
      if (server && typeof server.content === 'string') err.conflict = server;
    }
    throw err;
  }
  return (await readJson(res)) as T;
}

export function getNote(id = 1): Promise<NotePayload> {
  return request<NotePayload>(`/api/note?id=${id}`);
}

export function listRevisions(noteId = 1): Promise<NoteRevision[]> {
  return request<NoteRevision[]>(`/api/revisions?note_id=${noteId}`);
}

export interface SaveNoteInput {
  id?: number;
  content: string;
  signal?: AbortSignal;
  baseUpdatedAt?: string | null;
  /** Marks stored content as client-side ciphertext. */
  enc?: boolean;
}

export function saveNote(input: SaveNoteInput): Promise<NotePayload> {
  const { id, content, signal, baseUpdatedAt, enc } = input;
  return request<NotePayload>('/api/note', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      content,
      base_updated_at: baseUpdatedAt ?? undefined,
      enc: typeof enc === 'boolean' ? enc : undefined,
    }),
    signal,
  });
}

export function listNotes(): Promise<NoteSummary[]> {
  return listNotesSorted('updated');
}

export function listNotesSorted(sort: NoteSort = 'updated'): Promise<NoteSummary[]> {
  return request<NoteSummary[]>(`/api/notes?sort=${sort}`).then((rows) =>
    rows.map((row) => ({ ...row, tags: Array.isArray(row.tags) ? row.tags : [] })),
  );
}

export function listTrashedNotes(): Promise<NoteSummary[]> {
  return request<NoteSummary[]>('/api/notes?trash=1').then((rows) =>
    rows.map((row) => ({ ...row, tags: Array.isArray(row.tags) ? row.tags : [] })),
  );
}

export function restoreNote(id: number): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, action: 'restore' }),
  });
}

export function createNote(title?: string, folderId?: number | null): Promise<NotePayload> {
  return request<NotePayload>('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, folder_id: folderId ?? undefined }),
  });
}

export function updateNote(
  id: number,
  patch: {
    title?: string;
    pinned?: boolean;
    archived?: boolean;
    folder_id?: number | null;
    favorite?: boolean;
    sort_order?: number;
    tags?: string[];
  },
): Promise<NotePayload> {
  return request<NotePayload>('/api/notes', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...patch }),
  });
}

export function deleteNote(id: number, permanent = false): Promise<{ ok: true }> {
  return request<{ ok: true }>(
    permanent ? `/api/notes?id=${id}&permanent=1` : `/api/notes?id=${id}`,
    { method: 'DELETE' },
  );
}

export function listFolders(): Promise<Folder[]> {
  return request<Folder[]>('/api/folders');
}

export function createFolder(name: string): Promise<Folder> {
  return request<Folder>('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function updateFolder(
  id: number,
  patch: { name?: string; sort_order?: number },
): Promise<Folder> {
  return request<Folder>('/api/folders', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...patch }),
  });
}

export function deleteFolder(id: number): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/folders?id=${id}`, { method: 'DELETE' });
}

export function getUsage(): Promise<UsageStats> {
  return request<UsageStats>('/api/usage');
}

export function askQuestion(question: string): Promise<AskResult> {
  return request<AskResult>('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
}

export function formatNoteText(text: string): Promise<FormatResult> {
  return request<FormatResult>('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

export function listDocuments(): Promise<DocumentMeta[]> {
  return request<DocumentMeta[]>('/api/documents');
}

export function listTrash(): Promise<DocumentMeta[]> {
  return request<DocumentMeta[]>('/api/documents?trash=1');
}

export function restoreDocument(id: number): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, action: 'restore' }),
  });
}

export function deleteDocument(id: number, permanent = false): Promise<{ ok: true }> {
  return request<{ ok: true }>(
    permanent ? `/api/documents?id=${id}&permanent=1` : `/api/documents?id=${id}`,
    { method: 'DELETE' },
  );
}

/**
 * Upload with real progress. Uses XHR because fetch has no upload-progress API.
 * The promise rejects with ApiError on HTTP or network failure.
 */
export function uploadFile(
  file: File,
  onProgress?: (percent: number) => void,
  encrypted = false,
): Promise<DocumentMeta> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    const token = getToken();
    if (token) xhr.setRequestHeader('x-bridge-token', token);
    const answer = getAnswer();
    if (answer) xhr.setRequestHeader('x-bridge-answer', answer);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as DocumentMeta);
        } catch {
          reject(new ApiError(xhr.status, 'Invalid server response'));
        }
        return;
      }
      let message = `Upload failed (${xhr.status})`;
      try {
        message = errorFromBody(JSON.parse(xhr.responseText), message);
      } catch {
        /* keep default message */
      }
      reject(new ApiError(xhr.status, message));
    };

    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
    xhr.onabort = () => reject(new ApiError(0, 'Upload cancelled'));

    const form = new FormData();
    form.append('file', file);
    if (encrypted) form.append('enc', '1');
    xhr.send(form);
  });
}

export interface FetchedDocument {
  blob: Blob;
  fileName: string;
  fileType: string;
  enc: boolean;
}

/** Authed fetch → blob, so the token never lands in history/logs. */
export async function fetchDocumentBlob(id: number): Promise<FetchedDocument> {
  let res: Response;
  try {
    res = await fetch(`/api/download?id=${id}`, { headers: bridgeHeaders() });
  } catch {
    throw new ApiError(0, 'Network error — check your connection');
  }
  if (res.status === 401) throw new ApiError(401, 'Invalid or missing token');
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, errorFromBody(body, 'Download failed'));
  }
  const rawName = res.headers.get('x-file-name') ?? `document-${id}`;
  let fileName = rawName;
  try {
    fileName = decodeURIComponent(rawName);
  } catch {
    /* keep the raw value */
  }
  return {
    blob: await res.blob(),
    fileName,
    fileType: res.headers.get('x-file-type') ?? 'application/octet-stream',
    enc: res.headers.get('x-enc') === '1',
  };
}

/** Download via authed fetch → blob, so the token never lands in history/logs. */
export async function downloadDocument(id: number, fileName: string): Promise<void> {
  const { blob } = await fetchDocumentBlob(id);
  triggerBlobDownload(blob, fileName);
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------------------------------------------------------------------------
// Self-service tokens + Q&A + hint (public, unauthenticated — token travels
// in the JSON body, never in headers or URLs).
// ---------------------------------------------------------------------------

export interface Challenge {
  nonce: string;
  question: string;
  expires_at: number;
  sig: string;
}

export interface MintResult {
  token_plaintext: string;
  user_id: string;
  question: string;
}

async function publicRequest<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Network error — check your connection');
  }
  if (!res.ok) {
    const parsed = await readJson(res).catch(() => null);
    throw new ApiError(res.status, errorFromBody(parsed, `Request failed (${res.status})`));
  }
  return (await readJson(res)) as T;
}

export async function fetchChallenge(): Promise<Challenge> {
  let res: Response;
  try {
    res = await fetch('/api/challenge');
  } catch {
    throw new ApiError(0, 'Network error — check your connection');
  }
  if (!res.ok) throw new ApiError(res.status, 'Could not load the human-check');
  return (await readJson(res)) as Challenge;
}

export function mintToken(input: {
  label?: string;
  question: string;
  answer: string;
  hint?: string;
  challenge: Challenge & { answer: number };
}): Promise<MintResult> {
  return publicRequest<MintResult>('/api/tokens', input);
}

export function fetchQuestion(
  token: string,
  session_id: string,
): Promise<{ question: string; hint_available: boolean }> {
  return publicRequest('/api/token-question', { token, session_id });
}

export function fetchHint(token: string, session_id: string): Promise<{ hint: string }> {
  return publicRequest('/api/hint', { token, session_id });
}
