# Noting

A secure, single-page cross-device bridge: one autosaving scratchpad note plus drag-and-drop document sync, gated by a single shared token. Dark, stealth-luxe UI.

## Stack

- **Frontend:** React 19 + Vite 6 + TypeScript (strict) + Tailwind CSS v4 + TanStack Router (file-based) + TanStack Query + Motion + Sonner
- **Backend:** Vercel serverless functions + Neon Postgres (`@neondatabase/serverless`, raw parameterized SQL — no ORM)
- **AI:** NVIDIA NIM (`meta/llama3-70b-instruct`) for note formatting, with graceful fallback

## Features

- Autosaving note editor (500ms debounce, in-flight cancellation) with Write/Preview markdown tabs
- Cross-device conflict detection — "Keep mine / Load theirs" dialog instead of silent overwrites
- Version history (last 50 revisions) with one-click restore + undo
- Multi-file parallel uploads with progress, file search, sizes, download, delete
- "Format with AI" button with fallback to original text when the AI backend fails
- Per-endpoint rate limiting, security headers, health endpoint
- Keyboard shortcuts: `Ctrl/Cmd+S` save now, `Ctrl/Cmd+P` preview toggle, `Ctrl/Cmd+H` history, `/` focuses file search
- PWA: installable app shell works offline; note edits queue in the browser and sync on reconnect

## Setup

1. Install: `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   - `GLOBAL_SECRET_TOKEN` — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `NEON_CONNECTION_STRING` — your Neon Postgres connection string
   - `NVIDIA_API_KEY` — NVIDIA NIM API key (formatting falls back gracefully without it)
3. Database (one time, plus each new migration in order):
   - `psql $NEON_CONNECTION_STRING -f db/schema.sql`
   - `psql $NEON_CONNECTION_STRING -f db/migrate-001.sql`
4. Run: `npm run dev` → open `http://localhost:5173/?token=YOUR_TOKEN`
   - The token is captured into `localStorage` and wiped from the URL on first load.

## Scripts

| Command                                   | What it does                            |
| ----------------------------------------- | --------------------------------------- |
| `npm run dev`                             | Start the Vite dev server               |
| `npm run build`                           | Typecheck + production build to `dist/` |
| `npm run typecheck`                       | `tsc --noEmit`                          |
| `npm run lint`                            | ESLint (0 errors required)              |
| `npm run format` / `npm run format:check` | Prettier write / check                  |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, format check, and build on every push/PR.

## API

All endpoints except `/api/health` require the `x-bridge-token: <GLOBAL_SECRET_TOKEN>` header.

| Method   | Endpoint             | Description                                                                                                     |
| -------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| GET      | `/api/health`        | Liveness probe + DB latency (unauthenticated)                                                                   |
| GET/POST | `/api/note`          | Load / upsert the single note; POST accepts optional `base_updated_at` for conflict detection (409 on mismatch) |
| GET      | `/api/revisions`     | Last 20 note revisions                                                                                          |
| GET      | `/api/documents`     | Document metadata (size via `octet_length`, no migration needed)                                                |
| DELETE   | `/api/documents?id=` | Delete a document                                                                                               |
| POST     | `/api/upload`        | Multipart upload, 4.5MB Vercel limit enforced                                                                   |
| GET      | `/api/download?id=`  | Binary download with Unicode-safe filename                                                                      |
| POST     | `/api/ai`            | Format text via NVIDIA NIM; returns original + warning on failure                                               |

Rate limits: 120 req/min default, 30/min uploads, 10/min AI.

## Deployment (Vercel)

Set `GLOBAL_SECRET_TOKEN`, `NEON_CONNECTION_STRING`, and `NVIDIA_API_KEY` in the Vercel project dashboard. `vercel.json` handles SPA rewrites, API passthrough, upload memory, and security headers.

## Security model

Single static bearer token, no accounts. Anyone holding the token has full access — treat it like a password. Rotate by generating a new value and updating every environment; the old token dies immediately.
