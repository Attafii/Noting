const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { neon } = require(path.join(root, 'node_modules', '@neondatabase', 'serverless'));

function connectionString() {
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
  const connection = connectionString();
  if (!connection) throw new Error('NEON_CONNECTION_STRING is required');
  const sql = neon(connection);
  await sql.transaction([
    sql.query("DELETE FROM notes WHERE deleted_at < NOW() - INTERVAL '30 days'"),
    sql.query("DELETE FROM documents WHERE deleted_at < NOW() - INTERVAL '30 days'"),
    sql.query("DELETE FROM hint_grants WHERE revealed_at < NOW() - INTERVAL '30 days'"),
    sql.query("DELETE FROM rate_limit_buckets WHERE updated_at < NOW() - INTERVAL '2 hours'"),
    sql.query("DELETE FROM auth_sessions WHERE expires_at < NOW() - INTERVAL '1 day'"),
    sql.query("DELETE FROM workspace_invites WHERE expires_at < NOW() - INTERVAL '1 day'"),
  ]);
  console.log('retention cleanup complete');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
