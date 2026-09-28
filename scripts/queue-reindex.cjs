const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const { neon } = require(path.join(root, 'node_modules', '@neondatabase', 'serverless'));

function loadConnection() {
  if (process.env.NEON_CONNECTION_STRING) return process.env.NEON_CONNECTION_STRING;
  const file = path.join(root, '.env.local');
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index > 0 && line.slice(0, index).trim() === 'NEON_CONNECTION_STRING') {
      return line
        .slice(index + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
    }
  }
  return null;
}

async function main() {
  const connection = loadConnection();
  if (!connection) throw new Error('NEON_CONNECTION_STRING is required');
  const sql = neon(connection);
  const apply = process.argv.includes('--apply');

  const pending = await sql.query(
    `SELECT d.id, d.file_name, d.user_id, d.index_status,
            (SELECT count(*)::int FROM document_chunks c WHERE c.document_id = d.id) AS chunks,
            (SELECT count(*)::int FROM index_jobs j WHERE j.document_id = d.id
               AND j.status IN ('queued', 'processing', 'failed')) AS open_jobs
     FROM documents d
     WHERE d.deleted_at IS NULL
     ORDER BY d.id`,
  );
  const missing = pending.filter((row) => Number(row.chunks) === 0 && Number(row.open_jobs) === 0);
  console.log(
    JSON.stringify(
      { apply, documents: pending.length, missingChunks: missing.length, rows: missing },
      null,
      2,
    ),
  );
  if (!apply || missing.length === 0) return;

  for (const row of missing) {
    if (!row.user_id) {
      console.warn(`skip: document ${row.id} has no owner (run backfill:owner first)`);
      continue;
    }
    await sql.query(
      `UPDATE documents SET index_status = 'queued', index_error = NULL WHERE id = $1`,
      [row.id],
    );
    await sql.query(
      `INSERT INTO index_jobs (user_id, document_id, status) VALUES ($1, $2, 'queued')`,
      [row.user_id, row.id],
    );
    console.log(`queued: document ${row.id}`);
  }
  console.log('re-index jobs queued; they run when the owner opens the Documents page');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
