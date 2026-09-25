const crypto = require('crypto');
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
  const code = process.argv[2];
  const days = Number(process.argv[3] ?? 30);
  if (!code || code.length < 20 || !Number.isFinite(days) || days <= 0) {
    throw new Error('Usage: node scripts/create-invite.cjs <code> [valid-days]');
  }
  const connection = connectionString();
  if (!connection) throw new Error('NEON_CONNECTION_STRING is required');
  const sql = neon(connection);
  const hash = crypto.createHash('sha256').update(code, 'utf8').digest('hex');
  await sql.query(
    `INSERT INTO workspace_invites (code_hash, expires_at)
     VALUES ($1, NOW() + ($2 * INTERVAL '1 day'))`,
    [hash, days],
  );
  console.log('invite created; the code is not recoverable from the database');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
