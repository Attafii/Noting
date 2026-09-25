import { bridgeHeaders, getAnswer, getSessionId, getToken, isSessionActive } from './token';

export class ApiError extends Error {
  status: number;
  code: 'UNAUTHORIZED' | 'RATE_LIMITED' | 'CONFLICT' | 'QUOTA' | 'SESSION' | 'REQUEST_FAILED';
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
            : status === 413 || status === 507
              ? 'QUOTA'
              : status === 419
                ? 'SESSION'
                : 'REQUEST_FAILED';
  }
}

export interface NotePayload {
  id: number;
  title: string;
  content: string;
  pinned: boolean;
  archived: boolean;
  enc: boolean;
  content_version: number;
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
  content_version: number;
  folder_id: number | null;
  favorite: boolean;
  sort_order?: number;
  updated_at: string;
  created_at: string;
  preview: string;
  search_text?: string | null;
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
  enc?: boolean;
  source_version?: number;
  created_at: string;
}

export interface DocumentMeta {
  id: number;
  file_name: string;
  file_type: string;
  /** Bytes. Server derives it via octet_length — no schema migration needed. */
  file_size: number;
  enc: boolean;
  content_version: number;
  index_status?: 'queued' | 'processing' | 'ready' | 'failed' | 'skipped';
  index_error?: string | null;
  indexed_at?: string | null;
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
  /** Retrieval mode: vector (full), keyword (DB extension missing), unavailable. */
  mode?: 'vector' | 'keyword' | 'unavailable';
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
    const headers = new Headers(init?.headers);
    headers.set('x-noting-client', getSessionId());
    res = await fetch(path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: bridgeHeaders(headers),
    });
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

export function getNote(id: number): Promise<NotePayload> {
  return request<NotePayload>(`/api/note?id=${id}`);
}

export function listRevisions(noteId: number): Promise<NoteRevision[]> {
  return request<NoteRevision[]>(`/api/revisions?note_id=${noteId}`);
}

export function createRevision(input: {
  noteId: number;
  content: string;
  enc?: boolean;
}): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/revisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note_id: input.noteId, content: input.content, enc: input.enc }),
  });
}

export function updateRevision(input: {
  noteId: number;
  revisionId: number;
  content: string;
  enc?: boolean;
}): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/revisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      note_id: input.noteId,
      revision_id: input.revisionId,
      content: input.content,
      enc: input.enc,
    }),
  });
}

export interface SaveNoteInput {
  id?: number;
  content: string;
  signal?: AbortSignal;
  baseVersion?: number;
  baseUpdatedAt?: string | null;
  mutationId?: string;
  enc?: boolean;
}

export function saveNote(input: SaveNoteInput): Promise<NotePayload> {
  const { id, content, signal, baseVersion, baseUpdatedAt, mutationId, enc } = input;
  return request<NotePayload>('/api/note', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      content,
      base_version: baseVersion,
      base_updated_at: baseUpdatedAt ?? undefined,
      mutation_id: mutationId,
      enc: typeof enc === 'boolean' ? enc : undefined,
    }),
    signal,
  });
}

export function listNotes(): Promise<NoteSummary[]> {
  return listNotesSorted('updated');
}

export function listNotesSorted(sort: NoteSort = 'updated', search = ''): Promise<NoteSummary[]> {
  const params = new URLSearchParams({ sort });
  if (search.trim()) params.set('q', search.trim().slice(0, 200));
  return request<NoteSummary[]>(`/api/notes?${params.toString()}`).then((rows) =>
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

export function formatNoteText(text: string, encrypted = false): Promise<FormatResult> {
  return request<FormatResult>('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, encrypted }),
  });
}

export function listDocuments(): Promise<DocumentMeta[]> {
  return request<DocumentMeta[]>('/api/documents');
}

export function listTrash(): Promise<DocumentMeta[]> {
  return request<DocumentMeta[]>('/api/documents?trash=1');
}

export function reindexDocument(id: number): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, action: 'reindex' }),
  });
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
  replaceId?: number,
  signal?: AbortSignal,
): Promise<DocumentMeta> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.withCredentials = true;
    xhr.setRequestHeader('x-noting-client', getSessionId());
    const abort = () => xhr.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => signal?.removeEventListener('abort', abort);

    if (!isSessionActive()) {
      const token = getToken();
      if (token) xhr.setRequestHeader('x-bridge-token', token);
      const answer = getAnswer();
      if (answer) xhr.setRequestHeader('x-bridge-answer', answer);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      cleanup();
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

    xhr.onerror = () => {
      cleanup();
      reject(new ApiError(0, 'Network error during upload'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new ApiError(0, 'Upload cancelled'));
    };

    const form = new FormData();
    form.append('file', file);
    if (encrypted) form.append('enc', '1');
    if (replaceId !== undefined) form.append('replace_id', String(replaceId));
    if (signal?.aborted) xhr.abort();
    else xhr.send(form);
  });
}

export interface FetchedDocument {
  blob: Blob;
  fileName: string;
  fileType: string;
  enc: boolean;
}

/** Authed fetch → blob, so the token never lands in history/logs. */
export async function fetchDocumentBlob(
  id: number,
  includeTrash = false,
): Promise<FetchedDocument> {
  let res: Response;
  try {
    res = await fetch(`/api/download?id=${id}${includeTrash ? '&trash=1' : ''}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: bridgeHeaders({ 'x-noting-client': getSessionId() }),
    });
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

export interface SessionResult {
  user_id: string;
  expires_at: string;
}

export async function createSession(
  token: string,
  answer: string,
  recoveryCode?: string,
): Promise<SessionResult> {
  let res: Response;
  try {
    res = await fetch('/api/session', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-noting-client': getSessionId() },
      body: JSON.stringify({ token, answer, recovery_code: recoveryCode }),
    });
  } catch {
    throw new ApiError(0, 'Network error — check your connection');
  }
  if (!res.ok) {
    const body = await readJson(res).catch(() => null);
    throw new ApiError(res.status, errorFromBody(body, 'Could not unlock workspace'));
  }
  return (await readJson(res)) as SessionResult;
}

export async function endSession(): Promise<void> {
  try {
    await fetch('/api/session', {
      method: 'DELETE',
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    return;
  }
}

// ---------------------------------------------------------------------------
// Self-service tokens + Q&A + hint (public, unauthenticated — token travels
// in the JSON body, never in headers or URLs).
// ---------------------------------------------------------------------------

export interface ChallengeTile {
  g: string;
  r: number;
  label: string;
}

export interface Challenge {
  nonce: string;
  instruction: string;
  tiles: ChallengeTile[];
  expires_at: number;
  sig: string;
  /** Backwards-compat mirror of `instruction` (old cached clients). */
  question: string;
}

export interface ChallengeSolution {
  nonce: string;
  expires_at: number;
  sig: string;
  /** Index of the tapped tile. */
  selected: number;
  /** ms from tile render to tap — server rejects instant (<800ms) submits. */
  elapsed_ms: number;
  /** Honeypot — always sent empty; bots fill it. */
  honeypot?: string;
  /** Pointer/key interaction count — soft bot signal. */
  interactions?: number;
}

export interface MintResult {
  token_plaintext: string;
  recovery_code: string;
  user_id: string;
  question: string;
}

async function publicRequest<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'x-noting-client': getSessionId() },
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
    res = await fetch('/api/challenge', { headers: { 'x-noting-client': getSessionId() } });
  } catch {
    throw new ApiError(0, 'Network error — check your connection');
  }
  if (!res.ok) {
    const parsed = await readJson(res).catch(() => null);
    throw new ApiError(
      res.status,
      errorFromBody(parsed, `Could not load the human-check (${res.status})`),
    );
  }
  return (await readJson(res)) as Challenge;
}

export function mintToken(input: {
  label?: string;
  inviteCode?: string;
  question: string;
  answer: string;
  hint?: string;
  /** Built-in visual check solution (primary). */
  challenge?: ChallengeSolution;
  /** Cloudflare Turnstile client token (fallback only). */
  turnstileToken?: string;
}): Promise<MintResult> {
  return publicRequest<MintResult>('/api/tokens', {
    ...input,
    invite_code: input.inviteCode,
  });
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
