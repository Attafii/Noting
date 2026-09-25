import { getSql } from '../src/lib/db.js';

export class QuotaError extends Error {
  status: 413 | 429;
  code: 'STORAGE_QUOTA' | 'AI_QUOTA';

  constructor(status: 413 | 429, code: 'STORAGE_QUOTA' | 'AI_QUOTA', message: string) {
    super(message);
    this.name = 'QuotaError';
    this.status = status;
    this.code = code;
  }
}

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export async function checkStorageQuota(userId: string, incomingBytes: number): Promise<void> {
  const maxBytes = envInt('MAX_STORAGE_BYTES', 100 * 1024 * 1024);
  const maxFiles = envInt('MAX_FILE_COUNT', 1000);
  const sql = getSql();
  const rows = await sql.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(octet_length(file_data)), 0)::bigint AS bytes
     FROM documents WHERE user_id = $1`,
    [userId],
  );
  const row = rows[0] as { count?: number; bytes?: number | string } | undefined;
  const count = Number(row?.count ?? 0);
  const bytes = Number(row?.bytes ?? 0);
  if (count >= maxFiles) {
    throw new QuotaError(413, 'STORAGE_QUOTA', `File limit reached (${maxFiles})`);
  }
  if (bytes + incomingBytes > maxBytes) {
    throw new QuotaError(413, 'STORAGE_QUOTA', 'Storage quota reached');
  }
}

export async function checkNoteQuota(userId: string): Promise<void> {
  const maxNotes = envInt('MAX_NOTES', 10_000);
  const sql = getSql();
  const rows = await sql.query('SELECT COUNT(*)::int AS count FROM notes WHERE user_id = $1', [
    userId,
  ]);
  if (Number(rows[0]?.count ?? 0) >= maxNotes) {
    throw new QuotaError(413, 'STORAGE_QUOTA', `Note limit reached (${maxNotes})`);
  }
}

export async function consumeAiBudget(userId: string): Promise<void> {
  const dailyLimit = envInt('MAX_AI_CALLS_PER_DAY', 100);
  const sql = getSql();
  const rows = await sql.query(
    `INSERT INTO workspace_ai_usage (user_id, usage_day, calls)
     VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_id, usage_day) DO UPDATE
       SET calls = workspace_ai_usage.calls + 1
       WHERE workspace_ai_usage.calls < $2
     RETURNING calls`,
    [userId, dailyLimit],
  );
  if (rows.length === 0) {
    throw new QuotaError(429, 'AI_QUOTA', 'Daily AI limit reached');
  }
}
