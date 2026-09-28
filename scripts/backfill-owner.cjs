const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const root = path.join(__dirname, '..');
const { neon } = require(path.join(root, 'node_modules', '@neondatabase', 'serverless'));

function loadLocalEnv() {
  const file = path.join(root, '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function loadConnection() {
  loadLocalEnv();
  return process.env.NEON_CONNECTION_STRING ?? null;
}

async function resolveOwner(sql) {
  const direct = process.env.OWNER_USER_ID;
  if (direct) return direct;
  const token = process.env.OWNER_TOKEN;
  if (!token) throw new Error('OWNER_USER_ID or OWNER_TOKEN is required');
  const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  const rows = await sql.query('SELECT id FROM access_tokens WHERE token_hash = $1', [tokenHash]);
  if (rows.length !== 1) throw new Error('OWNER_TOKEN did not resolve to exactly one workspace');
  return rows[0].id;
}

async function main() {
  const connection = loadConnection();
  if (!connection) throw new Error('NEON_CONNECTION_STRING is required');
  const sql = neon(connection);
  const owner = await resolveOwner(sql);
  const apply = process.argv.includes('--apply');
  const tables = ['notes', 'documents', 'folders'];
  const counts = {};
  for (const table of tables) {
    const rows = await sql.query(
      `SELECT COUNT(*)::int AS count FROM ${table} WHERE user_id IS NULL`,
      [],
    );
    counts[table] = Number(rows[0]?.count ?? 0);
  }
  console.log(JSON.stringify({ owner, apply, counts }, null, 2));
  if (!apply) return;
  for (const table of tables) {
    await sql.query(`UPDATE ${table} SET user_id = $1 WHERE user_id IS NULL`, [owner]);
  }
  console.log('ownership backfill applied');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
