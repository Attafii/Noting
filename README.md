# Noting

A secure, single-page personal workspace for notes, files, and document Q&A. It autosaves across devices, keeps organization in one place, and uses a dark, stealth-luxe UI.

## Stack

- **Frontend:** React 19 + Vite 6 + TypeScript (strict) + Tailwind CSS v4 + TanStack Router (file-based) + TanStack Query + Motion + Sonner
- **Backend:** Vercel serverless functions + Neon Postgres (`@neondatabase/serverless`, raw parameterized SQL — no ORM)
- **AI:** OpenRouter (`meta-llama/llama-3.3-70b-instruct`) for note formatting, with graceful fallback

## Features

- Multi-note workspace: sidebar with pin, favorite, folders, #tags, archive, rename, search, sort (updated/created/alpha/manual drag-reorder), bulk select, per-note history, and 30-day note trash
- Rich editor: markdown toolbar, slash commands (`/h1 /todo /code /table`), Write/Preview/Split views, outline panel, find-and-replace, `[[wikilinks]]`, word goals, reading time, focus mode, per-note export (.md/.html/print/PDF/duplicate), templates, image paste-to-Files
- Global fuzzy search in the command palette (`Ctrl/Cmd+K`) across notes, tags, and files
- Light mode + accent picker (gold/emerald/cobalt) + density, resizable/collapsible layout, mobile bottom bar, Home dashboard, onboarding tour, `/welcome` landing page, full `/settings` page (appearance, editor prefs, shortcut customizer, storage usage)
- Cross-device conflict detection — versioned writes, mutation IDs, and a "Keep mine / Load theirs / Keep both" dialog instead of silent overwrites
- Encrypted per-user offline outbox in IndexedDB with reconnect replay and pending-sync protection
- Short-lived HttpOnly workspace sessions, one-time recovery codes, token revocation, and optional invite-only self-service
- Version history (last 50 revisions per note) with one-click restore + undo
- Multi-file parallel uploads with progress, file search, sizes, previews, download, trash (30-day restore window)
- "Ask your documents": semantic search (pgvector + OpenRouter embeddings) with cited AI answers
- "Format with AI" button with fallback to original text when the AI backend fails
- End-to-end encryption (AES-GCM, token-derived key) for notes and files, with migration tools
- Command palette (`Ctrl/Cmd+K`), keyboard shortcuts, full backup/restore as `.zip`
- Per-endpoint rate limiting, security headers, health endpoint
- Keyboard shortcuts: `Ctrl/Cmd+S` save now, `Ctrl/Cmd+P` preview toggle, `Ctrl/Cmd+H` history, `Ctrl/Cmd+K` palette, `/` focuses file search
- PWA: installable app shell works offline; encrypted note edits queue per workspace and sync on reconnect

## Setup

1. Install: `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   - `GLOBAL_SECRET_TOKEN` — blind admin/configuration secret; generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `CHALLENGE_SIGNING_SECRET` — separate HMAC secret for the built-in human-check
   - `NEON_CONNECTION_STRING` — your Neon Postgres connection string
   - `OPENROUTER_API_KEY` — OpenRouter API key (formatting and document Q&A fall back gracefully without it)
   - `PUBLIC_SELF_SERVICE_TOKENS=true` — explicitly enable public token creation; production defaults to invite-only/disabled
   - Optional limits: `MAX_STORAGE_BYTES`, `MAX_FILE_COUNT`, `MAX_NOTES`, and `MAX_AI_CALLS_PER_DAY`
   - Turnstile fallback (optional, free): `VITE_TURNSTILE_SITEKEY` + `TURNSTILE_SECRET_KEY` — Cloudflare dashboard → Turnstile → widget → Settings → Allowed hostnames `noting.attafii.dev` (+ `noting-notes.vercel.app` for the old URL, + `localhost` for dev). For local dev you can use the [test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) instead of a real widget. After any domain move you must add the new hostname in that list AND set `TURNSTILE_ALLOWED_HOSTNAMES` (or rely on the updated defaults) — otherwise the widget shows a hostname error and `/api/tokens` rejects its tokens.
3. Database migrations (the runner records checksums and skips completed files):
   - Fresh database: `npm run migrate -- --all`
   - Existing database: run `npm run migrate -- db/migrate-011-integrity.sql`
   - Verify the applied set with `npm run migrate -- status`
4. For legacy rows with `user_id IS NULL`, preview and apply ownership explicitly:
   - `OWNER_TOKEN=ntk_… npm run backfill:owner`
   - `OWNER_TOKEN=ntk_… npm run backfill:owner -- --apply`
5. For an invite-only deployment, create one-time codes with `npm run create:invite -- <code> [valid-days]`; set `PUBLIC_SELF_SERVICE_TOKENS=false` in production.
6. Run: `npm run dev` → open `http://localhost:5173/`
   - The dev server includes an API bridge that executes the Vercel functions locally — no Vercel CLI needed.
   - Tokens are kept in tab memory; authenticated API calls use a short-lived HttpOnly session cookie.
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
| `npm run migrate -- --all`                | Apply checksummed migrations            |
| `npm run backfill:owner`                  | Preview/apply legacy ownership          |
| `npm run create:invite -- <code>`         | Create a one-time invite code           |
| `npm run purge:retention`                 | Run scheduled trash/session cleanup     |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, format check, unit/API tests, production dependency audit, and build on every push/PR.

## API

Data endpoints accept the HttpOnly `noting_session` cookie. During the transition, legacy `x-bridge-token` + `x-bridge-answer` headers remain supported for existing clients.

| Method                | Endpoint             | Description                                                                                                                                 |
| --------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| GET/POST/DELETE       | `/api/session`       | Establish, inspect, or revoke the short-lived HttpOnly workspace session                                                                    |
| GET                   | `/api/health`        | Liveness/readiness probe + DB latency (unauthenticated)                                                                                     |
| GET                   | `/api/notes`         | Note list (titles, pins, previews, folders, favorites, tags; `?sort=` and `?q=` full-content search for plaintext notes)                    |
| POST/PATCH/DELETE     | `/api/notes`         | Create / rename-pin-archive-organize / trash a note (`?trash=1` lists trash, restore via `{id, action:"restore"}`, `&permanent=1` destroys) |
| GET/POST/PATCH/DELETE | `/api/folders`       | Notebooks/folders with note counts (notes survive folder deletes as Unfiled)                                                                |
| GET                   | `/api/usage`         | Storage aggregates (notes/files counts + bytes, trash counts) for Settings and future plan limits                                           |
| GET/POST              | `/api/note`          | Load / save one note (`?id=`); POST uses `base_version` and `mutation_id` for atomic conflict-safe saves and accepts an `enc` marker        |
| GET                   | `/api/revisions`     | Last 20 revisions of a note (`?note_id=`)                                                                                                   |
| GET                   | `/api/documents`     | Metadata; `?trash=1` lists soft-deleted (auto-purges after 30 days)                                                                         |
| POST                  | `/api/documents`     | Restore or reindex a document (`{ id, action: "restore" }` / `"reindex"`)                                                                   |
| DELETE                | `/api/documents?id=` | Soft-delete; `&permanent=1` destroys forever                                                                                                |
| POST                  | `/api/upload`        | Multipart upload, 4.5MB limit; `enc=1` marks ciphertext; text files auto-index for search                                                   |
| GET                   | `/api/download?id=`  | Binary download with Unicode-safe filename (header auth only; legacy `?token=` removed)                                                     |
| POST                  | `/api/ai`            | Format text via OpenRouter; returns original + warning on failure                                                                           |
| POST                  | `/api/ask`           | Semantic Q&A over indexed documents, with cited sources                                                                                     |
| GET                   | `/api/challenge`     | Visual odd-one-out challenge (DB-free, 30/min, HMAC-signed, 5-min expiry)                                                                   |
| POST                  | `/api/tokens`        | Invite/self-service mint (human-check OR Turnstile; returns `ntk_…` and `rec_…` once)                                                       |

Rate limits: 120 req/min default (DB-backed sliding window), 30/min uploads, 10/min AI, 30/min challenge, 5/min mint.

## Deployment (Vercel)

Set `GLOBAL_SECRET_TOKEN`, `CHALLENGE_SIGNING_SECRET`, `NEON_CONNECTION_STRING`, and `OPENROUTER_API_KEY` in the Vercel project dashboard. Keep public token creation disabled unless `PUBLIC_SELF_SERVICE_TOKENS=true` is intentionally configured. For the human-check fallback, also set `TURNSTILE_SECRET_KEY` (server-only) and build with `VITE_TURNSTILE_SITEKEY` (public). `vercel.json` handles SPA rewrites, API passthrough, upload memory, and security headers. Run `npm run purge:retention` from a daily scheduler to enforce trash, session, and rate-limit retention.

## Security model

Each workspace is isolated by a high-entropy access token, security answer, and one-time recovery code. After unlock, the browser exchanges them for a short-lived HttpOnly session; the token and answer are not persisted in browser storage. Production token creation is disabled unless explicitly enabled.

- Session cookies are `HttpOnly`, `SameSite=Strict`, scoped to the workspace, and revocable from the lock button.
- Note writes use content versions, mutation IDs, transactional revisions, and conflict recovery; stale devices cannot silently overwrite newer content.
- Offline edits are encrypted per workspace/note in IndexedDB and replayed only after authentication.
- Storage, file-count, and daily AI quotas are enforced server-side.
- Note/AI bodies and uploads are capped; authenticated responses and downloads are `private, no-store`.
- RAG answers treat document excerpts as untrusted data and are wrapped in `<documents>` tags.
- Migrations are checksummed and readiness fails when the schema is incomplete.
- Token minting is disabled by default in production; when explicitly enabled, it requires the built-in human-check or Turnstile.

End-to-end encryption encrypts note bodies and file bytes in the browser with AES-GCM-256. The current vault key is derived from the access token for cross-device compatibility; filenames, MIME types, titles, folders, and tags remain server-visible metadata. Encrypted content is excluded from server AI formatting and document search. Backups decrypt content in the browser and must be stored as sensitive files.
