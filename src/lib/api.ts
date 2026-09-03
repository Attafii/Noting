import { bridgeHeaders, getToken } from './token';

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
  content: string;
  updated_at: string;
}

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
  uploaded_at: string;
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
    const body = await res.json().catch(() => null);
    const err = new ApiError(res.status, errorFromBody(body, `Request failed (${res.status})`));
    if (res.status === 409) {
      const server = (body as { server?: NotePayload } | null)?.server;
      if (server && typeof server.content === 'string') err.conflict = server;
    }
    throw err;
  }
  return (await res.json()) as T;
}

export function getNote(): Promise<NotePayload> {
  return request<NotePayload>('/api/note');
}

export function listRevisions(): Promise<NoteRevision[]> {
  return request<NoteRevision[]>('/api/revisions');
}

export function saveNote(
  content: string,
  signal?: AbortSignal,
  baseUpdatedAt?: string | null,
): Promise<NotePayload> {
  return request<NotePayload>('/api/note', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(baseUpdatedAt ? { content, base_updated_at: baseUpdatedAt } : { content }),
    signal,
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

export function deleteDocument(id: number): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/documents?id=${id}`, { method: 'DELETE' });
}

/**
 * Upload with real progress. Uses XHR because fetch has no upload-progress API.
 * The promise rejects with ApiError on HTTP or network failure.
 */
export function uploadFile(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<DocumentMeta> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    const token = getToken();
    if (token) xhr.setRequestHeader('x-bridge-token', token);

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
    xhr.send(form);
  });
}

/** Download via authed fetch → blob, so the token never lands in history/logs. */
export async function downloadDocument(id: number, fileName: string): Promise<void> {
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
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
