/**
 * SQL migration runner (no psql required).
 *
 *   node scripts/migrate.cjs db/migrate-008.sql
 *   node scripts/migrate.cjs db/schema.sql
 *
 * Reads the connection string from .env.local (same file the dev server uses)
 * and executes the file statement-by-statement through @neondatabase/serverless.
 * Migrations in db/ are written to be safe to re-run.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { neon } = require(path.join(root, 'node_modules', '@neondatabase', 'serverless'));

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
  }
  return env;
}

/** Strip -- comments, then split on semicolons at end of line. */
function splitStatements(sqlText) {
  const noComments = sqlText
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  return noComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/migrate.cjs <sql-file>');
    process.exit(1);
  }
  const full = path.isAbsolute(file) ? file : path.join(root, file);
  const sqlText = fs.readFileSync(full, 'utf8');
  const statements = splitStatements(sqlText);
  const sql = neon(loadEnv().NEON_CONNECTION_STRING);

  let ok = 0;
  for (const stmt of statements) {
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 90);
    try {
      await sql.query(stmt);
      ok++;
      console.log(`ok: ${preview}${stmt.length > 90 ? '…' : ''}`);
    } catch (err) {
      console.error(`FAILED: ${preview}`);
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }
  console.log(`done: ${ok}/${statements.length} statements from ${file}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
