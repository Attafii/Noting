/**
 * Mock data seeder for local visualization.
 *
 *   node scripts/seed-mock-data.cjs          seed demo content + documents
 * node scripts/seed-mock-data.cjs --clean    remove everything this script created
 *
 * Reads the connection string from .env.local (same file the dev server uses).
 * All seeded rows are plaintext (enc = false) and clearly demo-flavored.
 * Safe to re-run: seeding upserts by title/file_name, cleaning is idempotent.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { neon } = require(path.join(root, 'node_modules', '@neondatabase', 'serverless'));

const CLEAN = process.argv.includes('--clean');

const NOTES = [
  {
    title: 'Scratchpad',
    pinned: true,
    archived: false,
    content: [
      '# Scratchpad',
      '',
      'Quick capture for the week. Delete me when done exploring.',
      '',
      '## Today',
      '',
      '- [x] Get the bridge running locally',
      '- [ ] Try **Format with AI** on this note',
      '- [ ] Upload a file and preview it',
      '',
      '## Snippet',
      '',
      '```ts',
      'const bridge = await open(`notes?token=${token}`);',
      '```',
      '',
      '| file | status |',
      '| ---- | ------ |',
      '| demo | ok |',
      '',
      '> Tip: press `Ctrl+K` for the command palette.',
      '',
    ].join('\n'),
  },
  {
    title: 'Project Beacon',
    pinned: true,
    archived: false,
    content: [
      '# Project Beacon',
      '',
      'Personal cross-device bridge. Single token, zero accounts.',
      '',
      '## Milestones',
      '',
      '1. Core sync (notes + files) — done',
      '2. Semantic search over uploads — in progress',
      '3. Mobile install (PWA) — queued',
      '',
      '## Open questions',
      '',
      '- Keep the 4.5MB Vercel cap or move blobs to object storage?',
      '- Per-note sharing links with expiry?',
      '',
    ].join('\n'),
  },
  {
    title: 'Books to read',
    pinned: false,
    archived: false,
    content: [
      '# Books to read',
      '',
      '- Designing Data-Intensive Applications — Kleppmann',
      '- The Design of Everyday Things — Norman',
      '- A Philosophy of Software Design — Ousterhout',
      '',
    ].join('\n'),
  },
  {
    title: 'Old hackathon idea',
    pinned: false,
    archived: true,
    content: [
      '# Old hackathon idea',
      '',
      'Offline-first grocery list with barcode scanning. Parked, not dead.',
      '',
    ].join('\n'),
  },
];

const NOTE_1_DRAFTS = [
  '# Scratchpad\n\nFirst draft — just getting started.',
  '# Scratchpad\n\nQuick capture for the week.\n\n## Today\n\n- [x] Get the bridge running locally',
];

const DOCS = [
  {
    file_name: 'launch-checklist.md',
    file_type: 'text/markdown',
    daysAgo: 0,
    content:
      '# Launch checklist\n\n- [x] Database migrations applied\n- [x] Token provisioned\n- [ ] Enable pgvector for Ask\n- [ ] First real backup\n',
  },
  {
    file_name: 'expenses-q3.csv',
    file_type: 'text/csv',
    daysAgo: 2,
    content:
      'month,category,amount\n2026-07,infra,12.40\n2026-08,infra,12.40\n2026-08,ai-api,3.18\n2026-09,infra,12.40\n',
  },
  {
    file_name: 'config-sample.json',
    file_type: 'application/json',
    daysAgo: 5,
    content:
      JSON.stringify(
        { app: 'noting', theme: 'dark', autosaveMs: 500, features: ['notes', 'files', 'ask'] },
        null,
        2,
      ) + '\n',
  },
  {
    file_name: 'beacon-logo.svg',
    file_type: 'image/svg+xml',
    daysAgo: 7,
    content:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#09090b"/><path d="M150 190 L230 256 L150 322" fill="none" stroke="#14b8a6" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/><line x1="258" y1="330" x2="368" y2="330" stroke="#e4e4e7" stroke-width="34" stroke-linecap="round"/></svg>',
  },
  {
    file_name: 'old-draft.txt',
    file_type: 'text/plain',
    daysAgo: 9,
    trashedDaysAgo: 1,
    content: 'This file was moved to trash to demo the 30-day restore window.\n',
  },
];

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
  }
  return env;
}

async function main() {
  const sql = neon(loadEnv().NEON_CONNECTION_STRING);

  if (CLEAN) {
    const noteTitles = NOTES.map((n) => n.title);
    await sql.query('DELETE FROM documents WHERE file_name = ANY($1)', [
      DOCS.map((d) => d.file_name),
    ]);
    await sql.query('DELETE FROM notes WHERE title = ANY($1) AND id <> 1', [noteTitles]);
    console.log('clean: demo notes + documents removed (note 1 kept, reset below)');
    await sql.query(
      "UPDATE notes SET title = 'Scratchpad', content = '', pinned = FALSE WHERE id = 1",
    );
    await sql.query('DELETE FROM note_revisions WHERE note_id = 1');
    console.log('clean: note 1 reset to empty scratchpad');
    return;
  }

  // The id=1 seed row is inserted with an explicit id, which leaves the
  // SERIAL sequence behind — align it or the first auto-id INSERT fails.
  await sql.query("SELECT setval('notes_id_seq', COALESCE((SELECT MAX(id) FROM notes), 1), true)");

  // Notes (upsert by title; note 1 keeps its id).
  for (const note of NOTES) {
    const existing = await sql.query('SELECT id FROM notes WHERE title = $1', [note.title]);
    if (existing.length > 0) {
      await sql.query(
        'UPDATE notes SET content = $1, pinned = $2, archived = $3, updated_at = NOW() WHERE id = $4',
        [note.content, note.pinned, note.archived, existing[0].id],
      );
      console.log('note kept :', note.title);
    } else if (note.title === 'Scratchpad') {
      await sql.query(
        "UPDATE notes SET title = 'Scratchpad', content = $1, pinned = TRUE, archived = FALSE, updated_at = NOW() WHERE id = 1",
        [note.content],
      );
      console.log('note set : Scratchpad (id 1)');
    } else {
      await sql.query(
        'INSERT INTO notes (title, content, pinned, archived) VALUES ($1, $2, $3, $4)',
        [note.title, note.content, note.pinned, note.archived],
      );
      console.log('note added:', note.title);
    }
  }

  // A little version history on the scratchpad.
  await sql.query('DELETE FROM note_revisions WHERE note_id = 1');
  for (const draft of NOTE_1_DRAFTS) {
    await sql.query('INSERT INTO note_revisions (note_id, content) VALUES (1, $1)', [draft]);
  }
  console.log('history   : 2 revisions on note 1');

  // Documents (re-insert by file_name for a clean, dated set).
  await sql.query('DELETE FROM documents WHERE file_name = ANY($1)', [
    DOCS.map((d) => d.file_name),
  ]);
  for (const doc of DOCS) {
    const uploaded = `NOW() - INTERVAL '${doc.daysAgo} days'`;
    const trashed = doc.trashedDaysAgo ? `NOW() - INTERVAL '${doc.trashedDaysAgo} days'` : 'NULL';
    await sql.query(
      `INSERT INTO documents (file_name, file_type, file_data, uploaded_at, deleted_at) VALUES ($1, $2, $3, ${uploaded}, ${trashed})`,
      [doc.file_name, doc.file_type, Buffer.from(doc.content, 'utf8')],
    );
    console.log(`doc added : ${doc.file_name}${doc.trashedDaysAgo ? ' (trashed)' : ''}`);
  }

  const counts = await sql.query(
    'SELECT (SELECT COUNT(*)::int FROM notes) AS notes, (SELECT COUNT(*)::int FROM documents WHERE deleted_at IS NULL) AS docs, (SELECT COUNT(*)::int FROM documents WHERE deleted_at IS NOT NULL) AS trash',
  );
  console.log('verify    :', JSON.stringify(counts[0]));
  console.log('done — reload the app to visualize');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
