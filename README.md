# Noting

A secure, single-page cross-device bridge: one autosaving scratchpad note plus drag-and-drop document sync, gated by a single shared token. Dark, stealth-luxe UI.

## Stack

- **Frontend:** React 19 + Vite 6 + TypeScript (strict) + Tailwind CSS v4 + TanStack Router (file-based) + TanStack Query + Motion + Sonner
- **Backend:** Vercel serverless functions + Neon Postgres (`@neondatabase/serverless`, raw parameterized SQL — no ORM)
- **AI:** OpenRouter (`meta-llama/llama-3.3-70b-instruct`) for note formatting, with graceful fallback

## Features

- Multi-note workspace: sidebar with pin, favorite, folders, #tags, archive, rename, search, sort (updated/created/alpha/manual drag-reorder), bulk select, per-note history, and 30-day note trash
- Rich editor: markdown toolbar, slash commands (`/h1 /todo /code /table`), Write/Preview/Split views, outline panel, find-and-replace, `[[wikilinks]]`, word goals, reading time, focus mode, per-note export (.md/.html/print/PDF/duplicate), templates, image paste-to-Files
- Global fuzzy search in the command palette (`Ctrl/Cmd+K`) across notes, tags, and files
- Light mode + accent picker (gold/emerald/cobalt) + density, resizable/collapsible layout, mobile bottom bar, Home dashboard, onboarding tour, `/welcome` landing page, full `/settings` page (appearance, editor prefs, shortcut customizer, storage usage)
- Cross-device conflict detection — "Keep mine / Load theirs" dialog instead of silent overwrites
- Version history (last 50 revisions per note) with one-click restore + undo
- Multi-file parallel uploads with progress, file search, sizes, previews, download, trash (30-day restore window)
- "Ask your documents": semantic search (pgvector + OpenRouter embeddings) with cited AI answers
- "Format with AI" button with fallback to original text when the AI backend fails
- End-to-end encryption (AES-GCM, token-derived key) for notes and files, with migration tools
- Command palette (`Ctrl/Cmd+K`), keyboard shortcuts, full backup/restore as `.zip`
- Per-endpoint rate limiting, security headers, health endpoint
- Keyboard shortcuts: `Ctrl/Cmd+S` save now, `Ctrl/Cmd+P` preview toggle, `Ctrl/Cmd+H` history, `Ctrl/Cmd+K` palette, `/` focuses file search
- PWA: installable app shell works offline; note edits queue in the browser and sync on reconnect

## Setup

1. Install: `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   - `GLOBAL_SECRET_TOKEN` — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `NEON_CONNECTION_STRING` — your Neon Postgres connection string
   - `OPENROUTER_API_KEY` — OpenRouter API key (formatting and document Q&A fall back gracefully without it)
   - Turnstile fallback (optional, free): `VITE_TURNSTILE_SITEKEY` + `TURNSTILE_SECRET_KEY` — Cloudflare dashboard → Turnstile → Add widget → Managed mode → hostnames `noting-notes.vercel.app` (+ `localhost` for dev). For local dev you can use the [test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) instead of a real widget.
3. Database (one time, plus each new migration in order):
   - `psql $NEON_CONNECTION_STRING -f db/schema.sql`
   - `psql $NEON_CONNECTION_STRING -f db/migrate-001.sql`
   - `psql $NEON_CONNECTION_STRING -f db/migrate-002.sql`
   - `psql $NEON_CONNECTION_STRING -f db/migrate-003.sql`
   - `psql $NEON_CONNECTION_STRING -f db/migrate-004.sql` (provider swap: drops stale NVIDIA-era chunks; re-upload files to re-index)
   - `psql $NEON_CONNECTION_STRING -f db/migrate-006.sql`
   - `psql $NEON_CONNECTION_STRING -f db/migrate-007.sql`
   - `psql $NEON_CONNECTION_STRING -f db/migrate-008.sql` (P0 organization: folders, favorites, note trash, tags, manual order, `pg_trgm` search indexes, SaaS-prep `user_id` columns)
4. Run: `npm run dev` → open `http://localhost:5173/?token=YOUR_TOKEN`
   - The dev server includes an API bridge that executes the Vercel functions locally — no Vercel CLI needed.
   - The token is captured into `localStorage` and wiped from the URL on first load.
   - Notes and files are read directly from Neon on every load — no demo data is injected at runtime.

## Scripts

| Command                                   | What it does                            |
| ----------------------------------------- | --------------------------------------- |
| `npm run dev`                             | Start the Vite dev server               |
| `npm run build`                           | Typecheck + production build to `dist/` |
| `npm run typecheck`                       | `tsc --noEmit`                          |
| `npm run lint`                            | ESLint (0 errors required)              |
| `npm test`                                | Vitest unit suites                      |
| `npm run format` / `npm run format:check` | Prettier write / check                  |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, format check, and build on every push/PR.

## API

All endpoints except `/api/health` require the `x-bridge-token: <GLOBAL_SECRET_TOKEN>` header.

| Method                | Endpoint             | Description                                                                                                                                 |
| --------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| GET                   | `/api/health`        | Liveness probe + DB latency (unauthenticated)                                                                                               |
| GET                   | `/api/notes`         | Note list (titles, pins, previews, folders, favorites, tags; `?sort=` updated/created/alpha/manual)                                         |
| POST/PATCH/DELETE     | `/api/notes`         | Create / rename-pin-archive-organize / trash a note (`?trash=1` lists trash, restore via `{id, action:"restore"}`, `&permanent=1` destroys) |
| GET/POST/PATCH/DELETE | `/api/folders`       | Notebooks/folders with note counts (notes survive folder deletes as Unfiled)                                                                |
| GET                   | `/api/usage`         | Storage aggregates (notes/files counts + bytes, trash counts) for Settings and future plan limits                                           |
| GET/POST              | `/api/note`          | Load / save one note (`?id=`); POST accepts optional `base_updated_at` (409 on conflict) and `enc` marker                                   |
| GET                   | `/api/revisions`     | Last 20 revisions of a note (`?note_id=`)                                                                                                   |
| GET                   | `/api/documents`     | Metadata; `?trash=1` lists soft-deleted (auto-purges after 30 days)                                                                         |
| POST                  | `/api/documents`     | `{ id, action: "restore" }` restores from trash                                                                                             |
| DELETE                | `/api/documents?id=` | Soft-delete; `&permanent=1` destroys forever                                                                                                |
| POST                  | `/api/upload`        | Multipart upload, 4.5MB limit; `enc=1` marks ciphertext; text files auto-index for search                                                   |
| GET                   | `/api/download?id=`  | Binary download with Unicode-safe filename (header auth only; legacy `?token=` removed)                                                     |
| POST                  | `/api/ai`            | Format text via OpenRouter; returns original + warning on failure                                                                           |
| POST                  | `/api/ask`           | Semantic Q&A over indexed documents, with cited sources                                                                                     |
| GET                   | `/api/challenge`     | Visual odd-one-out challenge (DB-free, 30/min, HMAC-signed, 5-min expiry)                                                                   |
| POST                  | `/api/tokens`        | Self-service mint (visual human-check OR Turnstile fallback; returns `ntk_…` once)                                                          |

Rate limits: 120 req/min default (DB-backed sliding window), 30/min uploads, 10/min AI, 30/min challenge, 5/min mint.

## Deployment (Vercel)

Set `GLOBAL_SECRET_TOKEN`, `NEON_CONNECTION_STRING`, and `OPENROUTER_API_KEY` in the Vercel project dashboard. For the human-check fallback, also set `TURNSTILE_SECRET_KEY` (server-only) and build with `VITE_TURNSTILE_SITEKEY` (public). `vercel.json` handles SPA rewrites, API passthrough, upload memory, and security headers.

## Security model

Single static bearer token, no accounts. Anyone holding the token has full access — treat it like a password. Rotate by generating a new value and updating every environment; the old token dies immediately.

- Tokens are compared in constant time and validation fails closed when the env var is unset.
- The lock button in the top bar clears the token from the browser (per-device logout).
- Served with `Referrer-Policy: no-referrer`, HSTS, `nosniff`, `frame-ancestors: none`, and a tight CSP.
- Note/AI bodies are capped (512KB notes, 200KB AI → 413); downloads are header-auth only (legacy `?token=` URL removed).
- Rate limits are DB-backed so they survive cold starts; CI blocks committed secrets (`sk-or-v1`, `npg_`, private keys).
- Backup imports are pre-scanned against zip-bomb limits (25MB per file, 100MB total).
- RAG answers are instructed to treat document excerpts as untrusted data, wrapped in `<documents>` tags.
- Token minting is gated by a built-in visual human-check (tap-the-odd-tile, HMAC-signed, single-use nonces, 800ms timing gate, honeypot — no vendor, no tracking). If the custom check can't load or keeps failing, the UI offers a Cloudflare Turnstile (free Managed) fallback that is lazy-loaded only on demand; the happy path loads zero third-party code.

Optional end-to-end encryption (Settings → toggle) encrypts note bodies and file bytes in the browser with AES-GCM-256, using a key derived from the access token (`SHA-256("noting-e2e:" + token)`). The server and Neon then only ever see ciphertext. Threat-model notes:

- File **names** and MIME types stay plaintext so listing, search, and downloads keep working.
- Encrypted content is excluded from AI formatting and document search (the server can't read it).
- Rotating the access token **breaks decryption** of existing encrypted content — export a backup first, rotate, then re-import.
- The `.zip` backup is **not** encrypted — it contains decrypted content, so store it somewhere safe.
- Verify the key fingerprint shown in Settings matches across your devices; a mismatch means the tokens differ and decryption will fail there.
