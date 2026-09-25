const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const { neon } = require(path.join(root, 'node_modules', '@neondatabase', 'serverless'));

function loadEnv() {
  const file = path.join(root, '.env.local');
  if (fs.existsSync(file)) {
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
  return process.env.NEON_CONNECTION_STRING;
}

function splitStatements(sqlText) {
  const statements = [];
  let current = '';
  let quote = null;
  let lineComment = false;
  for (let i = 0; i < sqlText.length; i++) {
    const char = sqlText[i];
    const next = sqlText[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      current += char;
      continue;
    }
    if (!quote && char === '-' && next === '-') {
      lineComment = true;
      current += char;
      continue;
    }
    if ((char === "'" || char === '"') && (!quote || quote === char)) {
      quote = quote === char ? null : char;
      current += char;
      continue;
    }
    if (char === ';' && !quote) {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      continue;
    }
    current += char;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function migrationName(file) {
  return path.basename(file).replace(/\.sql$/i, '');
}

function checksum(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

async function ensureLedger(sql) {
  await sql.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )`,
  );
}

async function applyFile(sql, file) {
  const full = path.isAbsolute(file) ? file : path.join(root, file);
  if (!fs.existsSync(full)) throw new Error(`Migration not found: ${file}`);
  const text = fs.readFileSync(full, 'utf8');
  const name = migrationName(full);
  const digest = checksum(text);
  await ensureLedger(sql);
  const applied = await sql.query('SELECT checksum FROM schema_migrations WHERE name = $1', [name]);
  if (applied.length > 0) {
    if (applied[0].checksum !== digest) throw new Error(`Checksum mismatch for ${name}`);
    console.log(`skip: ${name}`);
    return;
  }
  const statements = splitStatements(text);
  await sql.transaction([
    sql.query("SELECT pg_advisory_xact_lock(hashtext('noting:migrations'))"),
    ...statements.map((statement) => sql.query(statement)),
    sql.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, digest]),
  ]);
  console.log(`ok: ${name}`);
}

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === '--help') {
    console.log('Usage: node scripts/migrate.cjs <sql-file|--all|status>');
    return;
  }
  const connection = loadEnv();
  if (!connection) throw new Error('NEON_CONNECTION_STRING is required');
  const sql = neon(connection);
  if (arg === 'status') {
    await ensureLedger(sql);
    const rows = await sql.query(
      'SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name',
    );
    for (const row of rows) console.log(`${row.name} ${row.checksum} ${row.applied_at}`);
    return;
  }
  if (arg === '--all') {
    await applyFile(sql, 'db/schema.sql');
    const files = fs
      .readdirSync(path.join(root, 'db'))
      .filter((name) => /^migrate-\d+.*\.sql$/i.test(name))
      .sort();
    for (const file of files) await applyFile(sql, path.join('db', file));
    return;
  }
  await applyFile(sql, arg);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
