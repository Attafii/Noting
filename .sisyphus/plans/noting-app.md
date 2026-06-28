# Noting — Secure Cross-Device Text & Document Bridge

## TL;DR

> **Quick Summary**: A zero-auth, stealth-themed single-page bridge app for syncing text notes and documents across devices. Built on Vite + React + TanStack Router/Query + Tailwind, with Vercel Serverless API functions hitting Neon Postgres and NVIDIA NIM for markdown formatting.
> 
> **Deliverables**:
> - Vite + React + TS + Tailwind workspace with TanStack Router file-based routing
> - Token stealth capture (`?token=` → `localStorage` → URL wipe)
> - 5 Vercel Serverless API endpoints: `/api/note.ts` (GET/POST), `/api/upload.ts` (POST multipart), `/api/documents.ts` (GET metadata), `/api/download.ts` (GET binary), `/api/ai.ts` (POST NIM format)
> - Neon Postgres schema (`secure_bridges`, `notes`, `documents` + pgvector extension)
> - Dark `zinc-900`/`zinc-950` split-pane dashboard: monospace editor (left) + drag-drop upload + document list (right)
> - 500ms debounce note save + "Format with NIM" action button
> - `vercel.json` rewrites + `/api/*` passthrough
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: T1 → T2 → T6-T9 (API) → T11 (UI integration) → T12 (vercel.json) → F1-F4

---

## Context

### Original Request
User requested a greenfield build of "Noting" — a secure, zero-auth cross-device text and document bridge. Spec was exceptionally detailed: full SQL DDL provided, exact Tailwind utility classes for the editor and dropzone, exact contract for each of 5 API endpoints, and exact system prompt for the NVIDIA NIM AI formatting step. Stealth factor is paramount: the browser tab must read like a generic developer tool to avoid corporate scrutiny. Token is extracted from `?token=` URL parameter, persisted to `localStorage`, and wiped from the URL via `history.replaceState`.

### Interview Summary
**Key Discussions**:
- Test strategy: Minimum QA — no unit tests. Trust Agent-Executed QA Scenarios (curl for API endpoints, Playwright for UI flows). Keeps dependencies lean per ponytail.
- Multipart parsing: `busboy` (~60KB, battle-tested, standard for multipart in Node serverless).
- Env wiring: Vercel project env vars + `.env.example` committed (no secrets manager).
- App name correction: "Noting" (not "Pipe").
- Skills attached to executing agents: `ponytail` + `design-taste-frontend`.

**Research Findings**:
- Repo is truly greenfield (empty git, no package.json, no vercel.json, no .env).
- Neon Pool via `@neondatabase/serverless` in Vercel Node runtime **requires** `neonConfig.webSocketConstructor = ws` polyfill. Connections MUST be opened and closed per-request (no module singleton, serverless constraint).
- TanStack Router file-based setup requires `@tanstack/router-plugin/vite` in `vite.config.ts` + `tsr.config.json` configuration + auto-generated `routeTree.gen.ts` imported in `main.tsx`.
- Vercel body size 4.5MB is the HARD limit for ALL plans (Hobby AND Pro) — user's spec is accurate.
- Vercel serverless `vercel.json` must disable default body parsing for `/api/upload` route so `busboy` receives the raw multipart stream directly.

### Metis Review
**Identified Gaps** (addressed):
- `secure_bridges` table unused in MVP: Kept as scaffold for multi-bridge future but not queried in MVP. Single env `GLOBAL_SECRET_TOKEN` validates `x-bridge-token` header.
- Note initialization (no seeded row): Use `INSERT...ON CONFLICT (id) DO UPDATE` with hardcoded `id=1` — single-user single-row bridge.
- DB access pattern: `neon()` HTTP function for fast path queries, `Pool` for any multi-statement transactions. For MVP (trivial queries), `neon()` is simpler and avoids `ws` setup. Ponytail choice: prefer fewer deps; use `neon()` for all queries.
- Error format: `{ "error": string }` standard across all endpoints; HTTP status code carries semantic meaning.
- Multipart in Vercel: `vercel.json` config must set `api.bodyParser: false` for `/api/upload` (or cast VercelRequest to IncomingMessage and stream to busboy).
- AI failure modes: AbortController with 8s timeout, fail-safe to return original text + warning on NIM timeout/error.
- Concurrent note save race: chain debounce with AbortController — cancel in-flight save before next debounce triggers.
- Browser localStorage cleared: surface generic "Unauthorized" error; user re-enters token via URL param.
- Download with invalid ID: return 404 JSON `{error: "Not found"}`.

---

## Work Objectives

### Core Objective
Ship a working, stealth-themed personal bridge app: one endpoint URL with `?token=` grants access to a single page where a monospace note autosaves to Neon Postgres and files can be drag-dropped/ downloaded across devices, with an optional AI-format step via NVIDIA NIM.

### Concrete Deliverables
- `package.json` with minimal dependency tree (no ORM, no test framework, no auth lib)
- `vite.config.ts` with TanStack Router plugin
- `tsr.config.json` with file-based routing config
- `tailwind.config.js` + `postcss.config.js`
- `tsconfig.json`
- `vercel.json` with rewrites + `/api/*` passthrough + upload body parse disable
- `.env.example` listing all 3 env vars
- `index.html` with stealth generic title
- `src/main.tsx` with Router + QueryClient providers
- `src/routes/__root.tsx` with root layout + token URL-wipe logic
- `src/routes/index.tsx` dashboard component (left editor, right file ecosystem)
- `src/lib/db.ts` Neon client factory
- `src/lib/token.ts` localStorage token helper + fetch header injection
- `src/components/NoteEditor.tsx`
- `src/components/FileDropzone.tsx`
- `src/components/DocumentList.tsx`
- `api/note.ts`, `api/upload.ts`, `api/documents.ts`, `api/download.ts`, `api/ai.ts`
- `db/schema.sql` (DDL + optional notes seed)
- `.gitignore` with `node_modules`, `.env`, `.sisyphus/evidence/`, etc.

### Definition of Done
- [ ] `npm install && npm run dev` boots with no TS errors
- [ ] `npm run build` completes successfully producing `dist/`
- [ ] TanStack Router route tree auto-generated (`routeTree.gen.ts`)
- [ ] All 5 `/api/*` endpoints return correct HTTP status + JSON/binary
- [ ] Token capture wipes URL within 1 render cycle of root mount
- [ ] Note editor debounces saves at 500ms, shows "Saved" indicator
- [ ] "Format with NIM" button calls `/api/ai` and replaces textarea content
- [ ] Drag-drop upload accepts files ≤4.5MB, rejects larger with 413 + UI indicator
- [ ] Document list shows metadata rows, download button resolves with correct Content-Type + Content-Disposition
- [ ] `curl` black-box tests against all 5 endpoints return expected responses
- [ ] Playwright flow tests pass for token capture, note autosave, format button, upload, download

### Must Have
- Zero-auth token model: `?token=` → localStorage → `x-bridge-token` header on every API call
- URL wipe via `history.replaceState` on root mount
- 500ms debounce note save with AbortController to cancel stale requests
- 4.5MB hard cap on upload (413 before busboy parsing via Content-Length check)
- All endpoints validate `x-bridge-token === process.env.GLOBAL_SECRET_TOKEN` BEFORE parsing body
- Every endpoint uses parameterized Neon queries (no string concat SQL)
- Dark zinc-950 theme throughout, monospace editor, dashed dropzone
- Stealth generic page title ("Notes" or similar — not "Noting Bridge" or "Secure bridge")
- NVIDIA NIM `meta/llama3-70b-instruct` call with exact system prompt: `"Clean, format, and structure this scratchpad note efficiently using clean markdown while preserving structural integrity."`
- AbortController 8s timeout on NIM fetch with graceful fallback
- `/api/download` sets `Content-Type` matching stored `file_type` and `Content-Disposition: attachment; filename="..."`
- `queryClient.invalidateQueries({ queryKey: ['documents'] })` after every successful upload
- `queryClient.invalidateQueries({ queryKey: ['note'] })` after successful "Format with NIM"
- `vercel.json` rewrites client routes → `/index.html`, preserves `/api/*` passthrough

### Must NOT Have (Guardrails)
- NO unit tests or test framework added
- NO ORM (Drizzle/Kysely/Prisma) — raw SQL parameterized queries only
- NO module-level Neon Pool singleton (serverless leak risk) — client created per request, or use `neon()` HTTP function
- NO user accounts, OAuth, or auth flows beyond the single env token
- NO WebSocket/SSE realtime sync
- NO pagination, search, or filtering on documents list
- NO file previews or thumbnails
- NO markdown rendering/preview pane for notes
- NO mobile-specific UI optimization beyond Tailwind's responsive utilities
- NO file type validation/allowlist on upload (any file ≤4.5MB accepted)
- NO `lucide-react` or icon library — use inline SVGs (≤3 icons: file, download, spinner)
- NO console.log in API routes
- NO `@ts-ignore` or `as any` casts
- NO commented-out code in shipped files

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.
> Acceptance criteria requiring "user manually tests/confirms" are FORBIDDEN.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None — rely entirely on Agent-Executed QA Scenarios
- **Framework**: none

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright (playwright skill) - Navigate, interact, assert DOM, screenshot
- **API/Backend**: Use Bash (curl) - Send requests, assert status + response fields
- **TypeScript**: Use Bash (`npm run build` / `tsc --noEmit`) - Asserts compile success

### Global Test Token (use across ALL scenarios)
- `GLOBAL_SECRET_TOKEN=dev-test-token-123`
- Client localStorage key: `bridge-token`
- API header: `x-bridge-token: dev-test-token-123`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - scaffolding + foundation, MAX PARALLEL):
├── Task 1: Vite + React + TS + Tailwind workspace scaffolding [quick]
├── Task 2: TanStack Router + Query wiring + stealth root layout [quick]
├── Task 3: Neon DB client factory + db/schema.sql [quick]
├── Task 4: Token helper + fetch header injection [quick]
└── Task 5: vercel.json + .env.example + .gitignore [quick]

Wave 2 (After Wave 1 - API endpoints, MAX PARALLEL — all independent):
├── Task 6: /api/note.ts GET + POST [quick]
├── Task 7: /api/upload.ts POST multipart [unspecified-high]
├── Task 8: /api/documents.ts GET metadata [quick]
├── Task 9: /api/download.ts GET binary [unspecified-high]
└── Task 10: /api/ai.ts POST NVIDIA NIM [unspecified-high]

Wave 3 (After Wave 1+2 - UI components in parallel, depends on API + scaffolding):
├── Task 11: src/routes/index.tsx dashboard split-pane layout shell [visual-engineering]
├── Task 12: NoteEditor component with 500ms debounce + Format button [visual-engineering]
├── Task 13: FileDropzone + DocumentList components [visual-engineering]
└── Task 14: Dashboard integration (wire editor + file ecosystem into index.tsx) [visual-engineering]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high + playwright)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: T1 → T2 → T11-T14 → F1-F4 → user okay
Max Concurrent: 5 (Wave 1), 5 (Wave 2), 4 (Wave 3), 4 (Wave FINAL)
```

### Dependency Matrix

| Task | Blocked By | Blocks | Notes |
|------|------------|--------|-------|
| 1 | — | 2, 3, 4, 5, 11-14 | All foundation depends on scaffolding |
| 2 | 1 | 11-14 | UI routes need Router providers |
| 3 | 1 | 6-10 | API needs db client factory |
| 4 | 1 | 6-10, 11-14 | Both API and UI need token header |
| 5 | 1 | — | Independent infra config |
| 6 | 3, 4 | 12 | Note editor needs note endpoint contract |
| 7 | 3, 4 | 13 | Dropzone depends on upload contract |
| 8 | 3, 4 | 13, 14 | Doc list contract |
| 9 | 3, 4 | 13, 14 | Download contract |
| 10 | 3, 4 | 12 | AI format endpoint contract |
| 11 | 1, 2 | 14 | Layout shell |
| 12 | 1, 2, 6, 10 | 14 | Editor with API integration |
| 13 | 1, 2, 7, 8, 9 | 14 | Dropzone + doc list with API integration |
| 14 | 11, 12, 13 | F1-F4 | Final glue layer |

### Agent Dispatch Summary

- **Wave 1 (5)**: T1 → `quick`, T2 → `quick`, T3 → `quick`, T4 → `quick`, T5 → `quick`
- **Wave 2 (5)**: T6 → `quick`, T7 → `unspecified-high`, T8 → `quick`, T9 → `unspecified-high`, T10 → `unspecified-high`
- **Wave 3 (4)**: T11-T14 → `visual-engineering`
- **FINAL (4)**: F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high` (+playwright skill), F4 → `deep`

Every executing agent (Wave 1-3) receives load_skills=`["ponytail", "design-taste-frontend"]`.

---

## TODOs

- [x] 1. **Vite + React + TS + Tailwind Workspace Scaffolding**

  **What to do**:
  - Initialize `package.json` with strict minimal dependency tree:
    - `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-query`, `@tanstack/react-query-devtools`, `@neondatabase/serverless`
    - Dev: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`, `@types/node`, `@tanstack/router-plugin`, `tailwindcss`, `postcss`, `autoprefixer`, `busboy`, `@types/busboy`
  - Create `vite.config.ts` with React plugin + `@tanstack/router-plugin/vite` plugin
  - Create `tsconfig.json` with strict mode, `module: ESNext`, `moduleResolution: Bundler`, target ES2022, includes `src` and `api`, types `node`
  - Create `tailwind.config.js` with content globs for `./src/**/*.{ts,tsx}` and `./index.html`; darkMode: `'class'`; minimal theme extensions (font mono family only)
  - Create `postcss.config.js` wiring tailwind + autoprefixer
  - Create `index.html` with stealth generic `<title>Notes</title>` (not "Noting Bridge")
  - Run `npm install` to populate `node_modules`
  - Create `src/styles.css` with `@tailwind base/components/utilities` directives + zinc-950 html/body defaults
  - Run `npm run build` to confirm workspace compiles end-to-end with no errors

  **Must NOT do**:
  - NO test framework (vitest/jest/playwright in deps)
  - NO ORM (drizzle/prisma/kysely)
  - NO icon library (lucide-react, react-icons, heroicons)
  - NO CSS framework beyond tailwind
  - NO `console.log` in index.html or vite.config
  - NO dev server config beyond Vite defaults

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mechanical scaffolding work — no domain logic, just file creation + config wiring.
  - **Skills**: `["ponytail"]`
    - `ponytail`: Radical simplicity in dep selection — strip anything non-essential, avoid over-configuring.
  - **Skills Evaluated but Omitted**:
    - `design-taste-frontend`: UI styling handled in Wave 3, not in scaffolding wave.

  **Parallelization**:
  - **Can Run In Parallel**: NO (foundation task — all other Wave 1 tasks depend on this existing)
  - **Parallel Group**: Wave 1 — all tasks blocked until T1 completes
  - **Blocks**: Tasks 2, 3, 4, 5 (and transitively all Wave 2+ tasks)
  - **Blocked By**: None (can start immediately)

  **References**:

  > The executor has no prior context. References are their only guide.

  **Pattern References** (existing code to follow):
  - None — greenfield project. Look at this plan's "Must Have" / "Must NOT Have" sections for strict requirements.

  **API/Type References** (contracts to implement against):
  - TanStack Router Vite plugin: `@tanstack/router-plugin/vite` MUST be added to `vite.config.ts` `plugins` array. Plugin auto-generates `routeTree.gen.ts` on build.
  - Vite React plugin: standard `@vitejs/plugin-react` invocation.
  - Tailwind config: `content: ["./index.html", "./src/**/*.{ts,tsx}"]`, `darkMode: "class"`, no theme overrides beyond `fontFamily.mono`.

  **Test References** (testing patterns to follow):
  - None — no test framework. QA scenarios below act as primary verification.

  **External References** (libraries and frameworks):
  - TanStack Router Vite plugin: https://tanstack.com/router/v1/docs/framework/react/build-from-scratch/installation — scroll to "File-based routing" / "Vite plugin" section.
  - Vite React template: https://vitejs.dev/guide/ — standard `vite.config.ts` with React plugin.

  **WHY Each Reference Matters**:
  - TanStack Router plugin docs explain exact `vite.config.ts` plugin syntax and `tsr.config.json` shape required for file-based routing to auto-generate route tree.
  - Vite docs confirm standard React + Tailwind wiring pattern (plugins array order matters: React before TanStack Router).

  **Acceptance Criteria**:

  - [ ] `package.json` exists with exactly the deps listed in "What to do"
  - [ ] `npm install` completes with zero errors
  - [ ] `npm run build` exits 0 producing `dist/` folder
  - [ ] `tsc --noEmit` exits 0
  - [ ] `index.html` title is "Notes" (stealth generic — not "Noting", "Noting Bridge", or "Secure Bridge")
  - [ ] `tailwind.config.js` content glob matches `./src/**/*.{ts,tsx}` and `./index.html`
  - [ ] No `vitest`, `jest`, `drizzle`, `prisma`, `lucide-react` entries in package.json
  - [ ] `vite.config.ts` includes `@tanstack/router-plugin/vite` in plugins array

  **QA Scenarios (MANDATORY — task is INCOMPLETE without these):**

  ```
  Scenario: Workspace compiles cleanly
    Tool: Bash
    Preconditions: package.json, vite.config.ts, tsconfig.json, tailwind.config.js, postcss.config.js, index.html, src/styles.css all created
    Steps:
      1. Run `npm install`
      2. Run `npm run build`
      3. Run `tsc --noEmit`
    Expected Result: All three commands exit 0; dist/ folder exists with index.html and assets/
    Failure Indicators: `npm install` exits non-zero (bad dep); `npm run build` errors (missing plugin config); `tsc --noEmit` errors (strict mode violations)
    Evidence: .sisyphus/evidence/task-1-workspace-compile.txt

  Scenario: Stealth title verified
    Tool: Bash + Read
    Preconditions: index.html exists
    Steps:
      1. Read ./index.html
      2. Locate <title> tag content
    Expected Result: <title>Notes</title> (exact match — generic, not "Noting Bridge" or "Secure Bridge")
    Failure Indicators: Title contains "Noting", "Bridge", "Secure", "Pipe", or any branding
    Evidence: .sisyphus/evidence/task-1-stealth-title.txt

  Scenario: Dependency minimalism check
    Tool: Bash + Grep
    Preconditions: package.json exists
    Steps:
      1. Read package.json
      2. List all entries in `dependencies` and `devDependencies`
      3. Grep for forbidden deps: vitest|jest|drizzle|prisma|kysely|lucide|react-icons|heroicons
    Expected Result: Zero matches against forbidden grep; exactly 5 prod deps + 10 dev deps (count listed above)
    Failure Indicators: Any forbidden dep found; dep count exceeds 5 prod / 10 dev
    Evidence: .sisyphus/evidence/task-1-dep-audit.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(scaffold): vite + ts design tokens + tanstack wiring`
  - Pre-commit: `tsc --noEmit && npm run build`

- [x] 2. **TanStack Router + Query Wiring + Stealth Root Layout**

  **What to do**:
  - Create `tsr.config.json` with TanStack Router file-based config:
    - `routesDirectory: "./src/routes"`
    - `generatedRouteTree: "./src/routeTree.gen.ts"`
    - `autoCodeSplitting: true`
  - Add `@tanstack/router-plugin/vite` to `vite.config.ts` plugins (already in J-T1 tsr config — verify plugin load order: React plugin first, then Router plugin)
  - Create `src/main.tsx` with RouterProvider + QueryClientProvider wiring:
    - Import `RouterProvider` from `@tanstack/react-router`
    - Import `router` from `./router` (created below)
    - Construct `QueryClient` with sensible defaults `staleTime: 1000 * 60 * 5` (5min) — keeps API cached
    - Wrap app in `<QueryClientProvider>`
    - Render `<RouterProvider router={router} />`
  - Create `src/router.ts`:
    - Import `createRouter` from `@tanstack/react-router`
    - Import generated route tree from `./routeTree.gen`
    - Create router with `routeTree: routeTree` option
    - Export `router`
  - Create `src/routes/__root.tsx`:
    - Import `createRootRoute` from `@tanstack/react-router`
    - Render `<Outlet />` wrapped in zinc-950 full-screen payer div (`bg-zinc-950 min-h-screen text-zinc-100 font-sans antialiased`)
    - In `beforeLoad`, run token capture logic:
      - Access `search` via `location.search` to extract `?token=` value
      - If token exists, save to `localStorage.setItem('bridge-token', token)`
      - Then immediately call `window.history.replaceState({}, '', window.location.pathname)` to wipe URL
      - Do this synchronously BEFORE first paint to prevent token flicker in URL bar
  - Create placeholder `src/routes/index.tsx` with createFileRoute('/')(() => <div>Dashboard</div>), to be replaced in Wave 3
  - Run `npm run build` to confirm route tree autogenerates (`src/routeTree.gen.ts` appears)
  - Verify no `routeTree.gen.ts` manual edits — file MUST be .gitignored OR committed (decision: COMMIT it — no need to .gitignore, TanStack will overwrite on next build)

  **Must NOT do**:
  - NO `tsr` watch mode in build script — `npm run dev` (vite dev) triggers plugin automatically
  - NO `RouterProvider` wrapping in `__root.tsx` — that's done in `main.tsx`
  - NO `console.log` for token capture — silent operation
  - NO token logged or shown in DOM ever
  - NO `styled-components` or emotion — Tailwind utilities only
  - NO custom `indeterminateLoading` or `defaultPendingComponent` — let TanStack defaults work
  - NO `<html>` or `<body>` tags in root layout — `index.html` owns those

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: TanStack Router file-based pattern is well documented; pure config + minimal root layout, no domain logic.
  - **Skills**: `["ponytail"]`
    - `ponytail`: Avoid over-configuring Router defaults; explicit options only where required for the token wipe behavior.
  - **Skills Evaluated but Omitted**:
    - `design-taste-frontend`: Real UI design lands in Wave 3; this task is plumbing.

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 3, 4, 5) — all depend only on T1
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 11-14 (Wave 3 UI components need router context)
  - **Blocked By**: Task 1 (workspace scaffolding must exist)

  **References**:

  **Pattern References** (existing code to follow):
  - None — greenfield. The plan's "Must Have" + "Must NOT Have" sections are the strict spec.

  **API/Type References** (contracts to implement against):
  - TanStack Router `createRootRoute` returns `RootRoute` — has `beforeLoad`, `component` options
  - `beforeLoad` receives `{ location, params, search }` — use `location.search` for URL query access
  - `createFileRoute` is the file-based macro — argument is route path; for root use `createRootRoute`
  - TanStack Query `QueryClient` constructor accepts config object with `defaultOptions.queries.staleTime`

  **Test References** (testing patterns to follow):
  - None.

  **External References** (libraries and frameworks):
  - TanStack Router file-based setup: https://tanstack.com/router/v1/docs/framework/react/build-from-scratch/file-based-routing — Vite plugin, generated route tree pattern.
  - TanStack Router `beforeLoad`: https://tanstack.com/router/v1/docs/framework/react/guide/after-load — read "Before Load" section for sync token interception pattern.
  - TanStack Query setup: https://tanstack.com/query/v5/docs/framework/react/overview — basic QueryClientProvider wiring.
  - MDN `history.replaceState`: https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState — exact signature for URL wipe.

  **WHY Each Reference Matters**:
  - TanStack Router file-based docs confirm exact `tsr.config.json` schema and plugin invocation.
  - `beforeLoad` docs show when extraction runs — before render, allowing us to wipe URL before user sees token.
  - TanStack Query docs confirm provider wiring and QueryClient defaults shape.
  - MDN `replaceState` confirms second arg is ignored; third arg is target URL — full path without query wipes cleanly.

  **Acceptance Criteria**:

  - [ ] `tsr.config.json` exists with routesDirectory and generatedRouteTree paths
  - [ ] `vite.config.ts` plugins array includes `@tanstack/router-plugin/vite`
  - [ ] `npm run build` produces `src/routeTree.gen.ts` (auto-generated)
  - [ ] `tsc --noEmit` exits 0 with route tree as source
  - [ ] `main.tsx` wraps app in `QueryClientProvider` and renders `RouterProvider`
  - [ ] `__root.tsx` has `beforeLoad` hook extracting `?token=` from location.search
  - [ ] On token presence: token saved to `localStorage.bridge-token`; URL wiped via `history.replaceState({}, '', location.pathname)`

  **QA Scenarios (MANDATORY — task is INCOMPLETE without these):**

  ```
  Scenario: Token capture and URL wipe (happy path)
    Tool: Playwright (playwright skill)
    Preconditions: Vite dev server running on localhost:5173; localStorage cleared before test
    Steps:
      1. Navigate to http://localhost:5173/?token=dev-test-token-123
      2. Wait 500ms for beforeLoad to fire
      3. Read `window.location.href` via page.evaluate
      4. Read `localStorage.getItem('bridge-token')` via page.evaluate
    Expected Result: window.location.href === "http://localhost:5173/" (token stripped); localStorage.bridge-token === "dev-test-token-123"
    Failure Indicators: URL still contains ?token= parameter; localStorage empty; token in `document.documentElement` outerHTML
    Evidence: .sisyphus/evidence/task-2-token-capture-wipe.png (screenshot) + task-2-token-capture.json (page.evaluate output)

  Scenario: Token absence — no wipe, no localStorage write
    Tool: Playwright
    Preconditions: Vite dev server running; localStorage cleared
    Steps:
      1. Navigate to http://localhost:5173/ (no query param)
      2. Read window.location.href
      3. Read localStorage.getItem('bridge-token')
    Expected Result: URL unchanged; localStorage.bridge-token === null
    Failure Indicators: localStorage has stale value; URL modified despite no token
    Evidence: .sisyphus/evidence/task-2-no-token-clean.json
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(router): tanstack router file-based + query client providers + token stealth root`
  - Pre-commit: `tsc --noEmit && npm run build`

- [x] 3. **Neon DB Client Factory + db/schema.sql**

  **What to do**:
  - Create `src/lib/db.ts` exporting a single function:
    ```typescript
    import { neon } from '@neondatabase/serverless';
    export const sql = neon(process.env.NEON_CONNECTION_STRING!);
    ```
    Use `neon()` HTTP client (NOT Pool) per ponytail — avoids `ws` polyfill dependency, guaranteed serverless-safe, fine for single-statement parameterized queries that this app uses exclusively.
  - Create `api/_db.ts` (serverless-side import target) re-exporting from `src/lib/db.ts` — OR place `db.ts` at `api/_db.ts` only and import directly from API routes (preferred: keeps `src/lib/` clean for browser-side code). Decision: keep `db.ts` in `src/lib/db.ts` but it's ONLY imported by `/api/*` files (serverless) — Vite won't bundle it client-side because nothing in `src/` browser code references it.
  - Create `db/schema.sql` containing the EXACT DDL from spec plus a seed row for notes:
    ```sql
    CREATE EXTENSION IF NOT EXISTS pgvector;
    CREATE TABLE secure_bridges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        secret_token VARCHAR(255) UNIQUE NOT NULL
    );
    CREATE TABLE notes (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE documents (
        id SERIAL PRIMARY KEY,
        file_name VARCHAR(255) NOT NULL,
        file_type VARCHAR(100) NOT NULL,
        file_data BYTEA NOT NULL,
        uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO notes (id, content) VALUES (1, '') ON CONFLICT (id) DO NOTHING;
    ```
  - Add `README`-style comment at top of `schema.sql` explaining one-time execution via `psql $NEON_CONNECTION_STRING -f db/schema.sql` — no migration framework needed (ponytail: one row, one table set, no migration tool risk)

  **Must NOT do**:
  - NO `Pool` from `@neondatabase/serverless` (would require `ws` polyfill in Vercel Node runtime — unnecessary dep)
  - NO `neonConfig.webSocketConstructor = ws` (Pool-only config; `neon()` HTTP doesn't need it)
  - NO migration framework (drizzle-kit, prisma migrate, kysely migrate, node-pg-migrate)
  - NO module-level singleton client that persists across serverless requests — `neon()` returns a stateless function, safe to call multiple times
  - NO connection pool management code
  - NO ORM query builder layer wrapping `sql`
  - NO `pgvector` indexing code (extension installed per spec but unused in MVP)
  - NO seeding of `secure_bridges` table — that's env-token-based, not row-token-based

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Two small files — Neon client one-liner + SQL DDL copy-paste from spec. Minimal logic.
  - **Skills**: `["ponytail"]`
    - `ponytail`: Prefer `neon()` over `Pool` to avoid `ws` dep. No migration framework. Raw parameterized SQL only.
  - **Skills Evaluated but Omitted**:
    - `design-taste-frontend`: Pure data layer, no UI surface area.

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 2, 4, 5)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 6-10 (all API endpoints need db client)
  - **Blocked By**: Task 1 (workspace scaffolding for npm install)

  **References**:

  **Pattern References** (existing code to follow):
  - None — greenfield.

  **API/Type References** (contracts to implement against):
  - `@neondatabase/serverless` `neon(connection_string)`: returns tagged template SQL function `sql\`SELECT ...\`` OR `sql(query, params)` form. Prefer `sql(query, params)` form (cleaner with TS).
  - All queries throughout API endpoints will import `{ sql }` from `src/lib/db` and call `sql('SELECT $1', [value])`

  **Test References** (testing patterns to follow):
  - None.

  **External References** (libraries and frameworks):
  - `@neondatabase/serverless` docs: https://neon.tech/docs/serverless/serverless-driver — read sections "neon()" function vs "Pool" class. Confirms `neon()` is HTTP-only, no ws needed, ideal for serverless one-shot queries.
  - Neon Postgres pgvector: https://neon.tech/docs/extensions/pgvector — extension syntax confirmed.

  **WHY Each Reference Matters**:
  - `@neondatabase/serverless` docs settle the `neon()` vs `Pool` decision: `neon()` is HTTP-only (no ws), perfect for single-statement queries, and is serverless-native. Pool requires ws, which adds a dep and lifecycle burden.
  - pgvector docs confirm `CREATE EXTENSION IF NOT EXISTS pgvector` syntax works on Neon free tier.

  **Acceptance Criteria**:

  - [ ] `src/lib/db.ts` exists, exports `sql` function built from `neon(process.env.NEON_CONNECTION_STRING!)`
  - [ ] `db/schema.sql` exists with exact DDL + `notes` seed row
  - [ ] `db/schema.sql` uses `SERIAL`/`UUID`/`BYTEA`/`TIMESTAMP` per spec
  - [ ] `INSERT INTO notes (id, content) VALUES (1, '') ON CONFLICT (id) DO NOTHING;` present
  - [ ] No `Pool` import in `db.ts`
  - [ ] No `ws` package in `package.json` (Pool-free confirmation)
  - [ ] `tsc --noEmit` exits 0

  **QA Scenarios (MANDATORY — task is INCOMPLETE without these):**

  ```
  Scenario: Neon client module loads without runtime error
    Tool: Bash
    Preconditions: Task 1 complete (npm install done); .env.local has NEON_CONNECTION_STRING set (or env var set in shell)
    Steps:
      1. Create one-line Node probe: `import { sql } from './src/lib/db'; console.log(typeof sql)`
      2. Run via `npx tsx src/lib/db.ts` OR `node --experimental-vm-modules -e "import(...).then(m => console.log(typeof m.sql))"`
      3. Assert output is "function"
    Expected Result: stdout contains "function"; exit code 0
    Failure Indicators: Module throws "process.env.NEON_CONNECTION_STRING is undefined"; output is "undefined"
    Evidence: .sisyphus/evidence/task-3-db-client-load.txt

  Scenario: Schema.sql is valid Postgres DDL (syntax lint)
    Tool: Bash
    Preconditions: db/schema.sql exists
    Steps:
      1. Grep schema.sql for required tokens: `CREATE EXTENSION IF NOT EXISTS pgvector`, `CREATE TABLE secure_bridges`, `CREATE TABLE notes`, `CREATE TABLE documents`, `INSERT INTO notes`
      2. Verify file_data column type is BYTEA
    Expected Result: All 5 token patterns match; BYTEA present in documents table
    Failure Indicators: Missing CREATE TABLE statement; file_data declared as TEXT/VARCHAR instead of BYTEA
    Evidence: .sisyphus/evidence/task-3-schema-validation.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(db): neon serverless client + schema.sql with notes seed`
  - Pre-commit: `tsc --noEmit`

- [x] 4. **Token Helper + Fetch Header Injection**

  **What to do**:
  - Create `src/lib/token.ts` with three exports:
    - `getToken(): string | null` — reads `localStorage.getItem('bridge-token')`
    - `setToken(token: string): void` — writes to `localStorage.setItem('bridge-token', token)` (used by `__root.tsx` beforeLoad via direct localStorage call already; helper exists for symmetry/testing)
    - `bridgeHeaders(extra?: HeadersInit): HeadersInit` — returns merged headers object: `{ 'x-bridge-token': getToken() ?? '', ...extra }`. This is the SINGLE source of truth for adding the token header to every fetch call.
  - All TanStack Query `fetch` calls in Wave 3 UI MUST import `bridgeHeaders()` and call `bridgeHeaders({ 'Content-Type': 'application/json' })` (or appropriate base headers) — no direct `localStorage.getItem('bridge-token')` reads scattered in components.
  - All `/api/*` serverless routes will validate via `req.headers['x-bridge-token'] !== process.env.GLOBAL_SECRET_TOKEN` — this is the client counterpart.
  - Create `api/_auth.ts` helper for serverless side:
    - `validateToken(req: VercelRequest): boolean` — returns `req.headers['x-bridge-token'] === process.env.GLOBAL_SECRET_TOKEN`
    - `unauthorizedResponse(): { status: 401, body: { error: 'Unauthorized' } }` — standard rejection
  - These helpers keep token logic in ONE place each side (client + server) — don't duplicate across components or endpoints.

  **Must NOT do**:
  - NO token stored in cookie (cookieless design — stealth over cookies)
  - NO token embedded in URL path (header-only auth, supports clean URLs after wipe)
  - NO token logged in any helper (silent operation)
  - NO expiry tracking — single static token until env var rotation
  - NO `crypto.subtle` hashing of token — direct string equality is fine for personal single-token tool
  - NO token exposed in component state that would render to DOM (return-only, never set in `useState` for display)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Two tiny utility modules with clean contracts. No I/O, no async, no UI surface.
  - **Skills**: `["ponytail"]`
    - `ponytail`: Plain string equality, no hashing layer, no token rotation, no expiry. Helpers are 3 functions total.
  - **Skills Evaluated but Omitted**:
    - `design-taste-frontend`: No UI work.

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 2, 3, 5)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 6-10 (server routes need `api/_auth.ts`), Tasks 12-14 (UI components need `bridgeHeaders`)
  - **Blocked By**: Task 1 (workspace + tsc config)

  **References**:

  **Pattern References** (existing code to follow):
  - None — greenfield.

  **API/Type References** (contracts to implement against):
  - `VercelRequest` from `@vercel/node` package — has `headers` field as plain object (case-insensitive via Node IncomingMessage semantics)
  - `HeadersInit` type from DOM lib — accepted by `fetch()` second argument
  - Cross-file imports: client side uses relative path `../lib/token`; server side uses `../src/lib/token` or `./_auth`

  **Test References** (testing patterns to follow):
  - None.

  **External References** (libraries and frameworks):
  - Vercel Node function types: https://vercel.com/docs/functions/runtimes/node-js — Request/Response shape for `/api/*`.
  - MDN HeadersInit: https://developer.mozilla.org/en-US/docs/Web/API/Headers/Headers — if user passes Headers object, spread it.

  **WHY Each Reference Matters**:
  - Vercel docs confirm `req.headers` is case-insensitive object (Node IncomingMessage) — but access via `req.headers['x-bridge-token']` works because Node lowercases keys.
  - HeadersInit docs confirm merging order: spread user-supplied headers AFTER token so they can override (though they shouldn't).

  **Acceptance Criteria**:

  - [ ] `src/lib/token.ts` exists with `getToken`, `setToken`, `bridgeHeaders` exports
  - [ ] `api/_auth.ts` exists with `validateToken` and `unauthorizedResponse` exports
  - [ ] `bridgeHeaders()` returns object with `x-bridge-token` key set to `localStorage.getItem('bridge-token')` output
  - [ ] `validateToken` returns boolean (not string match, not undefined)
  - [ ] No direct `localStorage.getItem('bridge-token')` reads OUTSIDE `token.ts` (single source of truth)
  - [ ] `tsc --noEmit` exits 0

  **QA Scenarios (MANDATORY — task is INCOMPLETE without these):**

  ```
  Scenario: bridgeHeaders injects token
    Tool: Bash (node probe)
    Preconditions: localStorage unavailable in Node — write a small browser probe via Playwright OR test the function shape in node by stubbing localStorage
    Steps:
      1. Use Playwright: navigate to http://localhost:5173/?token=dev-test-token-123
      2. page.evaluate(() => import('/src/lib/token.ts').then(m => m.bridgeHeaders({ 'Content-Type': 'application/json' })))
      3. Assert returned object has x-bridge-token === "dev-test-token-123" and Content-Type === "application/json"
    Expected Result: Merged object returned with both keys; token value matches what was set via URL
    Failure Indicators: x-bridge-token missing; mismatch between token in storage and in returned headers
    Evidence: .sisyphus/evidence/task-4-bridge-headers-merged.json

  Scenario: validateToken rejects missing/invalid token
    Tool: Bash (node probe with stubbed req)
    Preconditions: api/_auth.ts exists; GLOBAL_SECRET_TOKEN env var set to "dev-test-token-123" in shell
    Steps:
      1. Run node probe: `node -e "import('./api/_auth.ts').then(m => { console.log(m.validateToken({ headers: {} })); console.log(m.validateToken({ headers: { 'x-bridge-token': 'wrong' } })); console.log(m.validateToken({ headers: { 'x-bridge-token': process.env.GLOBAL_SECRET_TOKEN } })) })"`
      2. Assert outputs: false, false, true
    Expected Result: Three lines: false, false, true
    Failure Indicators: validateToken returns truthy non-boolean; first case returns true
    Evidence: .sisyphus/evidence/task-4-validate-token-reject.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(auth): token helper client + server with single source of truth`
  - Pre-commit: `tsc --noEmit`

- [x] 5. **vercel.json + .env.example + .gitignore**

  **What to do**:
  - Create `vercel.json` with this exact config:
    ```json
    {
      "rewrites": [
        { "source": "/api/(.*)", "destination": "/api/$1" },
        { "source": "/((?!api).*)", "destination": "/index.html" }
      ],
      "functions": {
        "api/upload.ts": { "memory": 1024 }
      }
    }
    ```
    The order matters: `/api/(.*)` matches first preserving API passthrough, then non-/api fallthrough rewrites to /index.html for SPA routing.
    Do NOT add `"api": { "bodyParser": false }` global config — instead handle raw stream in `/api/upload.ts` via Vercel-specific handling (when the spec is implemented in T7, set `export const config = { api: { bodyParser: false } }` LOCALLY inside upload.ts).
  - Create `.env.example` with three lines and zero real values:
    ```
    # Vercel project env vars — copy to .env.local for dev, set in Vercel dashboard for prod
    GLOBAL_SECRET_TOKEN=replace-with-your-secure-random-string
    NEON_CONNECTION_STRING=postgresql://user:pass@host/db?sslmode=require
    NVIDIA_API_KEY=replace-with-your-nvidia-nim-api-key
    ```
  - Create `.gitignore` with these entries minimum:
    ```
    node_modules
    dist
    .env
    .env.local
    .vercel
    .sisyphus/evidence/
    *.log
    ```
  - (Optional) Create empty `src/styles.css` if not created in T1 — re-verify it exists. If missing, add `@tailwind base; @tailwind components; @tailwind utilities;`
  - Update `tsconfig.json` if needed to add `"include": ["src", "api", "vercel.json", "tailwind.config.js", "tsr.config.json"]`

  **Must NOT do**:
  - NO `vercel.json` "buildCommand" or "outputDirectory" overrides — Vite defaults are correct
  - NO `vercel.json` "framework" field — Vercel auto-detects Vite
  - NO `.env` (real env file) committed — only `.env.example`
  - NO `.env.local` committed — it's user-local
  - NO `api.bodyParser: false` GLOBAL config — that would break the other 4 JSON-based endpoints; only upload.ts opts out locally via `export const config`
  - NO `vercel clean-install` or `engines.node` overrides — let Vercel defaults ride

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Three small config files. Zero domain logic. Mechanical file creation.
  - **Skills**: `["ponytail"]`
    - `ponytail`: Minimal vercel.json — only rewrites + one function memory override for upload. No global body parser config that would pollute other endpoints.
  - **Skills Evaluated but Omitted**:
    - `design-taste-frontend`: Pure infra config.

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 2, 3, 4)
  - **Parallel Group**: Wave 1
  - **Blocks**: None directly (config files referenced by other tasks but tasks can write their own exports fine without this in place)
  - **Blocked By**: Task 1 (workspace must exist for `include` array editing)

  **References**:

  **Pattern References** (existing code to follow):
  - None — greenfield.

  **API/Type References** (contracts to implement against):
  - `vercel.json` schema: `rewrites` array, `functions` map keyed by route path with `memory`/`maxDuration` overrides
  - Rewrite order: Vercel evaluates top-to-bottom; first match wins
  - `export const config = { api: { bodyParser: false } }` in a route file is per-route body-parser disable (Vercel-specific syntax)

  **Test References** (testing patterns to follow):
  - None.

  **External References** (libraries and frameworks):
  - Vercel rewrites: https://vercel.com/docs/projects/project-configuration#rewrites — exact JSON shape and matching behavior.
  - Vercel Node function config: https://vercel.com/docs/functions/runtimes/node-js#advanced-usage — `export const config` syntax for per-route overrides.
  - Vercel body parser limits: https://vercel.com/docs/limits/limits#serverless-function-payload-size-limit — 4.5MB confirmed.

  **WHY Each Reference Matters**:
  - Vercel rewrites docs confirm first-match-wins ordering; user's spec for `/api/*` passthrough + SPA fallback requires the order in this plan.
  - Vercel Node config docs confirm `export const config = { api: { bodyParser: false } }` is the canonical way to disable body parsing for ONE route only (so other API endpoints keep default JSON parsing).
  - Vercel limits docs lock down the 4.5MB hard cap; upload route validates Content-Length BEFORE busboy parsing to avoid wasted work.

  **Acceptance Criteria**:

  - [ ] `vercel.json` exists with rewrites array (2 entries: `/api/(.*)` and `/((?!api).*)`) in correct order
  - [ ] `vercel.json` does NOT contain global `api.bodyParser: false`
  - [ ] `vercel.json` does NOT contain `buildCommand`, `outputDirectory`, or `framework` overrides
  - [ ] `.env.example` exists with exactly 3 env var names + placeholder values
  - [ ] `.env.example` does NOT contain real secret values
  - [ ] `.gitignore` exists with `node_modules`, `dist`, `.env`, `.env.local`, `.vercel`, `.sisyphus/evidence/`
  - [ ] No `.env` or `.env.local` file committed
  - [ ] `tsc --noEmit` exits 0

  **QA Scenarios (MANDATORY — task is INCOMPLETE without these):**

  ```
  Scenario: vercel.json schema valid
    Tool: Bash + Read
    Preconditions: vercel.json exists
    Steps:
      1. Run `cat vercel.json` and parse as JSON
      2. Assert rewrites array length === 2
      3. Assert first source pattern is "/api/(.*)" and destination is "/api/$1"
      4. Assert second source pattern is "/((?!api).*)" and destination is "/index.html"
      5. Assert functions['api/upload.ts'].memory === 1024
      6. Assert no top-level "api" key (no global bodyParser disable)
    Expected Result: All 6 assertions pass
    Failure Indicators: Missing rewrites; reverse order would send /api/* to /index.html; global api config present
    Evidence: .sisyphus/evidence/task-5-vercel-json-audit.json

  Scenario: env example has 3 keys, no real values
    Tool: Bash
    Preconditions: .env.example exists
    Steps:
      1. Read .env.example
      2. Grep for: ^GLOBAL_SECRET_TOKEN=, ^NEON_CONNECTION_STRING=, ^NVIDIA_API_KEY=
      3. Grep for blacklist patterns: actual UUIDs, real passwords, real API keys (regex heuristics)
    Expected Result: All 3 prefix patterns match; no real secret values detected
    Failure Indicators: Fewer than 3 keys; lines contain what looks like a real key (start with `nvapi-`, 30+ char alphanumeric strings in values)
    Evidence: .sisyphus/evidence/task-5-env-example-audit.txt

  Scenario: gitignore covers evidence + env
    Tool: Bash
    Preconditions: .gitignore exists
    Steps:
      1. Read .gitignore
      2. Grep for: node_modules, dist, .env, .vercel, .sisyphus/evidence/
    Expected Result: All 5 patterns present
    Failure Indicators: Missing entries mean secrets or evidence could leak into git
    Evidence: .sisyphus/evidence/task-5-gitignore-audit.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(infra): vercel.json rewrites + env example + gitignore`
  - Pre-commit: `tsc --noEmit`

- [ ] 6. **/api/note.ts — GET latest + POST upsert**

  **What to do**:
  - Create `api/note.ts` exporting default async handler `(req, res) => { ... }` typed for `VercelRequest`/`VercelResponse`
  - On ANY request (regardless of method), validate token via `validateToken(req)` from `api/_auth.ts` BEFORE any other logic
  - If token invalid: `res.status(401).json({ error: 'Unauthorized' }); return`
  - **GET** branch:
    - Query: `SELECT content, updated_at FROM notes WHERE id = 1`
    - If no row: `INSERT INTO notes (id, content) VALUES (1, '') ON CONFLICT (id) DO NOTHING` then re-query (defensive — seed should already exist via schema.sql)
    - Response: `res.status(200).json({ content: rows[0].content, updated_at: rows[0].updated_at })`
  - **POST** branch:
    - Parse body: `const { content } = req.body as { content: string }`
    - Validate: `typeof content !== 'string'` → `res.status(400).json({ error: 'content must be string' }); return`
    - Query: `INSERT INTO notes (id, content) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW() RETURNING content, updated_at`
    - Response: `res.status(200).json({ content: rows[0].content, updated_at: rows[0].updated_at })`
  - Any other method: `res.status(405).json({ error: 'Method not allowed' }); return`
  - Use `sql('SELECT ...', [])` parameterized form OR `sql\`SELECT ...\`` tagged template — pick one and use consistently across all 5 endpoints. Decision: use `sql('query', [params])` form (cleaner TS generics, more readable).
  - Handle the rare case where Neon throws (`sql` rejects) with try/catch:
    - `catch (e) { console.error('note endpoint error', e); res.status(500).json({ error: 'Internal server error' }); }`
    - DO NOT log the SQL or params (avoids token/content leaking to logs)

  **Must NOT do**:
  - NO `req.body` access before token validation
  - NO string concatenation in SQL — always `sql('...', [params])` form
  - NO `console.log` on happy path (only `console.error` in catch)
  - NO logging of token or note content
  - NO `INSERT` without `ON CONFLICT` — would throw on second call
  - NO multiple rows in notes table — always `WHERE id = 1`
  - NO `LIMIT 1` or `ORDER BY` — single-row table by design
  - NO `updated_at` accepted from client — server sets `NOW()` always
  - NO other notes ID support — hardcoded `1`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single endpoint, two simple branches, well-defined contract. One parameterized query each.
  - **Skills**: `["ponytail"]`
    - `ponytail`: No ORM, no abstraction layer, no middleware chain. Just `if/else` + raw SQL.
  - **Skills Evaluated but Omitted**:
    - `design-taste-frontend`: Backend code, no UI surface.

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 7-10)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 12 (NoteEditor component calls this endpoint)
  - **Blocked By**: Tasks 3 (db client), 4 (token auth helper)

  **References**:

  **Pattern References** (existing code to follow):
  - `api/_auth.ts` (created in T4): `validateToken(req)` shape — call this immediately
  - `src/lib/db.ts` (created in T3): `sql` import — use `sql('...', [params])` form

  **API/Type References** (contracts to implement against):
  - `VercelRequest.body`: parsed JSON object when Content-Type is application/json (Vercel auto-parses)
  - `VercelResponse.status(code).json(obj)`: standard response chain
  - Neon `neon()` tagged template OR `sql(query, params)` form — both return `Promise<Record<string, any>[]>`

  **Test References** (testing patterns to follow):
  - None — no tests. QA scenarios below cover it.

  **External References** (libraries and frameworks):
  - Neon serverless driver: https://neon.tech/docs/serverless/serverless-driver — `sql('query', [params])` vs `sql\`query\`` syntax.
  - Vercel Node function basics: https://vercel.com/docs/functions/runtimes/node-js — Request/Response TypeScript type imports.
  - Postgres `ON CONFLICT ... DO UPDATE`: https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT — exact syntax for upsert.

  **WHY Each Reference Matters**:
  - Neon docs confirm `sql('query', [params])` returns rows array directly; no result.release() or anything for HTTP mode.
  - Postgres docs confirm `ON CONFLICT (id) DO UPDATE SET ... RETURNING ...` syntax for single-statement upsert with returns.
  - Vercel docs confirm `req.body` is auto-parsed for application/json when `bodyParser: true` (default).

  **Acceptance Criteria**:

  - [ ] `api/note.ts` exists with default export typed `(req: VercelRequest, res: VercelResponse) => Promise<void>`
  - [ ] Token validation runs BEFORE req.body access on POST
  - [ ] GET returns `{ content, updated_at }` from notes.id=1
  - [ ] POST accepts `{ content: string }`, persists via INSERT ON CONFLICT DO UPDATE
  - [ ] Non-GET/POST returns 405 with `{ error: "Method not allowed" }`
  - [ ] No string concatenation in SQL queries
  - [ ] `tsc --noEmit` exits 0
  - [ ] Endpoint returns 200 on valid token + payload (curl test below)

  **QA Scenarios (MANDATORY — task is INCOMPLETE without these):**

  ```
  Scenario: Note GET happy path
    Tool: Bash (curl)
    Preconditions: Vite dev server running on localhost:5173; .env.local has GLOBAL_SECRET_TOKEN=dev-test-token-123, NEON_CONNECTION_STRING set; db/schema.sql has been run against neon; localStorage not relevant for curl
    Steps:
      1. curl -s -w "\\n%{http_code}" -H "x-bridge-token: dev-test-token-123" http://localhost:5173/api/note
      2. Parse last line as status, rest as JSON
    Expected Result: HTTP 200; JSON body has "content" (string) and "updated_at" (ISO string)
    Failure Indicators: 401 (token mismatch), 500 (NEON query fails), missing keys
    Evidence: .sisyphus/evidence/task-6-note-get.txt

  Scenario: Note POST happy path
    Tool: Bash (curl)
    Preconditions: same as above
    Steps:
      1. curl -s -w "\\n%{http_code}" -X POST -H "x-bridge-token: dev-test-token-123" -H "Content-Type: application/json" -d '{"content":"hello world"}' http://localhost:5173/api/note
      2. Parse status + JSON
    Expected Result: HTTP 200; JSON body content === "hello world"; updated_at present and ISO 8601
    Failure Indicators: 401, 400 (validation fail), 500 (DB error)
    Evidence: .sisyphus/evidence/task-6-note-post.txt

  Scenario: Note POST persistence across calls
    Tool: Bash (curl)
    Preconditions: as above
    Steps:
      1. POST {content: "first version"} — expect 200
      2. GET — expect content === "first version"
      3. POST {content: "second version"} — expect 200
      4. GET — expect content === "second version" (NOT "first version")
    Expected Result: Each GET reflects prior POST; upsert replaces cleanly
    Failure Indicators: GET still returns old content after new POST (upsert not replacing)
    Evidence: .sisyphus/evidence/task-6-note-persistence.txt

  Scenario: Unauthorized token rejection
    Tool: Bash (curl)
    Preconditions: dev server running
    Steps:
      1. curl -s -w "\\n%{http_code}" http://localhost:5173/api/note (no token header)
      2. curl -s -w "\\n%{http_code}" -H "x-bridge-token: wrong-token" http://localhost:5173/api/note
    Expected Result: Both calls return 401 with {"error":"Unauthorized"}
    Failure Indicators: 200 OK reveals token bypass; 500 from missing token crash
    Evidence: .sisyphus/evidence/task-6-note-unauthorized.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(api): /api/note GET + POST upsert with token auth`
  - Files: `api/note.ts`
  - Pre-commit: `tsc --noEmit`

- [ ] 7. **/api/upload.ts — POST multipart via busboy with 4.5MB cap**

  **What to do**:
  - Create `api/upload.ts` with default async handler
  - **CRITICAL**: Add `export const config = { api: { bodyParser: false } }` at module level — Vercel-specific syntax opts this route out of auto body parsing so busboy gets the raw stream
  - Validate token via `validateToken(req)` BEFORE anything else — return 401 if invalid
  - Check `Content-Length` header IMMEDIATELY after token check:
    - `const contentLength = parseInt(req.headers['content-length'] ?? '0', 10)`
    - If `contentLength > 4.5 * 1024 * 1024` → `res.status(413).json({ error: 'File too large. Max 4.5MB.' }); res.end(); return`
    - This fail-fast avoids busboy parsing an oversized payload
  - Setup busboy on `req` stream:
    - `const bb = busboy({ headers: req.headers })`
    - On `bb.on('file', (fieldname, file, info) => { ... })`:
      - If `fieldname !== 'file'` → ignore (or 400); spec implies single file field
      - Read `info.filename` and `info.mimeType`
      - Collect file bytes into Buffer chunks array: push to array on 'data', concat on 'end'
      - Tally bytes as they arrive; if running total exceeds 4.5MB → destroy stream + return 413 (defensive against chunked encoding that lies about Content-Length)
    - On `bb.on('finish', async () => { ... })`:
      - Concatenate chunks → `fileBuffer: Buffer`
      - Compute final size — if > 4.5MB return 413
      - Insert: `INSERT INTO documents (file_name, file_type, file_data) VALUES ($1, $2, $3) RETURNING id, file_name, file_type, uploaded_at` with params `[filename, mimeType, fileBuffer]`
      - Pass Buffer directly to Neon — driver handles BYTEA parameterization
      - Response: `res.status(200).json({ id: rows[0].id, file_name: rows[0].file_name, file_type: rows[0].file_type, uploaded_at: rows[0].uploaded_at })`
    - On `bb.on('error', (err) => { ... })`: `res.status(500).json({ error: 'Upload failed' })`
  - Pipe `req` into `bb`: `req.pipe(bb)`
  - Handle `req` errors separately — `'error'` event on req stream → 500
  - Handle method guard: if `req.method !== 'POST'` → 405 (check after token validation so wrong-method authenticated calls surface 405 not 401)

  **Must NOT do**:
  - NO body parsing via Vercel default — `export const config = { api: { bodyParser: false } }` is mandatory
  - NO writing file to disk — Buffer stays in memory, written to Neon BYTEA directly
  - NO streaming upload to Neon (Neon HTTP driver doesn't support streaming)
  - NO more than ONE file accepted per request — second file event destroys bb + 400
  - NO file type validation (any MIME accepted)
  - NO file name sanitization at upload (download endpoint will use Content-Disposition params encoding for RFC 5987 compliance)
  - NO `fs` module import — buffers are in-memory only
  - NO `console.log` on happy path; `console.error` in catch only, never logging file content
  - NO base64 encoding — Buffer → BYTEA directly via parameterized query
  - NO accepting `fieldname !== 'file'` — reject with 400 if wrong field name

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Stream handling + busboy event wiring + size validation + Vercel-specific `export const config` API + byte tally across chunks. Highest complexity endpoint.
  - **Skills**: `["ponytail"]`
    - `ponytail`: Busboy is the smallest sane multipart parser. No abstraction, file goes Buffer → BYTEA, no encoding layer.
  - **Skills Evaluated but Omitted**:
    - `design-taste-frontend`: Backend stream handling, no UI surface.

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 6, 8, 9, 10)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 13 (FileDropzone integration with upload mutation)
  - **Blocked By**: Tasks 3 (db), 4 (auth)

  **References**:

  **Pattern References** (existing code to follow):
  - `api/_auth.ts` (T4): `validateToken` + unauthorized pattern
  - `src/lib/db.ts` (T3): `sql` import for parameterized query

  **API/Type References** (contracts to implement against):
  - busboy v1.x API: `busboy({ headers })` returns Transform stream; `'file'`, `'field'`, `'finish'`, `'error'` events; `file` is a Readable stream with `info.filename`, `info.mimeType` (newer busboy) OR `info.filename`, `info.mimeType`, `info.transferEncoding` (older API — check version)
  - `req` is `VercelRequest` which extends `IncomingMessage` — pipeable to busboy Transform
  - `export const config = { api: { bodyParser: false } }` is Vercel-specific module-level export disabling JSON body parse so busboy receives raw stream

  **Test References** (testing patterns to follow):
  - None — no test framework. QA scenarios below.

  **External References** (libraries and frameworks):
  - busboy GitHub README: https://github.com/mscdex/busboy — exact API: `bb.on('file', (fieldname, fileStream, info) => ...)`, `info.filename`, `info.mimeType`.
  - Vercel Node body parser config: https://vercel.com/docs/functions/runtimes/node-js#request-body-parsing — `export const config = { api: { bodyParser: false } }` syntax.
  - Vercel serverless payload size limit: https://vercel.com/docs/limits/limits#serverless-function-payload-size-limit — 4.5MB confirmed.

  **WHY Each Reference Matters**:
  - busboy README is the canonical source for the v1.x event signature (it changed between versions); reading prevents writing API that breaks on install.
  - Vercel body parser docs are the ONLY source for the `export const config` pattern — without it, Vercel will try to JSON-parse the multipart body and fail.
  - Vercel limits docs lock the 4.5MB cap as a HARD limit ALL plans; the 413 check is required for correct UX.

  **Acceptance Criteria**:

  - [ ] `api/upload.ts` exports default handler
  - [ ] `export const config = { api: { bodyParser: false } }` present at module level
  - [ ] Token validation runs FIRST, before any other logic
  - [ ] Content-Length > 4.5MB check returns 413 immediately
  - [ ] busboy `'file'` handler accumulates Buffer chunks; running byte tally
  - [ ] `'finish'` handler inserts to Neon with parameterized query (Buffer bound to BYTEA param)
  - [ ] Method guard returns 405 for non-POST
  - [ ] No `fs` import (in-memory only)
  - [ ] No base64 encoding of file contents
  - [ ] `tsc --noEmit` exits 0
  - [ ] `@types/busboy` installed and import resolves

  **QA Scenarios (MANDATORY — task is INCOMPLETE without these):**

  ```
  Scenario: Upload small file happy path
    Tool: Bash (curl)
    Preconditions: dev server; .env.local set; schema.sql applied; create test file: echo "hello noting" > /tmp/test-upload.txt
    Steps:
      1. curl -s -w "\\n%{http_code}" -X POST -H "x-bridge-token: dev-test-token-123" -F "file=@/tmp/test-upload.txt" http://localhost:5173/api/upload
      2. Parse status + JSON
    Expected Result: HTTP 200; JSON body has id (number), file_name === "test-upload.txt", file_type === "text/plain", uploaded_at (ISO string)
    Failure Indicators: 413 (size check wrong); 500 (Neon insert fails); file_data leaked in response (should NOT be present)
    Evidence: .sisyphus/evidence/task-7-upload-small.txt

  Scenario: Oversized upload rejection (413 before parsing)
    Tool: Bash (curl)
    Preconditions: dev server; create 5MB file: dd if=/dev/urandom of=/tmp/huge.bin bs=1M count=5
    Steps:
      1. curl -s -w "\\n%{http_code}" -X POST -H "x-bridge-token: dev-test-token-123" -F "file=@/tmp/huge.bin" http://localhost:5173/api/upload
    Expected Result: HTTP 413; JSON body { error: "File too large. Max 4.5MB." }
    Failure Indicators: 200 OK (size check missing); 500 (size check ran but didn't return 413); took >5s (didn't short-circuit, parsed file anyway)
    Evidence: .sisyphus/evidence/task-7-upload-oversized.txt

  Scenario: Unauthorized upload rejection
    Tool: Bash (curl)
    Preconditions: dev server
    Steps:
      1. curl -s -w "\\n%{http_code}" -X POST -F "file=@/tmp/test-upload.txt" http://localhost:5173/api/upload (no auth header)
    Expected Result: HTTP 401; JSON body { error: "Unauthorized" }
    Failure Indicators: 200 OK (token check skipped); 413 returned instead of 401 (order wrong — token must be first)
    Evidence: .sisyphus/evidence/task-7-upload-unauthorized.txt

  Scenario: Wrong multer field name rejection
    Tool: Bash (curl)
    Preconditions: dev server; test file
    Steps:
      1. curl -s -w "\\n%{http_code}" -X POST -H "x-bridge-token: dev-test-token-123" -F "wrong_field=@/tmp/test-upload.txt" http://localhost:5173/api/upload
    Expected Result: HTTP 400; JSON { error: "File must be uploaded under field name 'file'" } OR similar
    Failure Indicators: 200 OK with no row created (silently accepts wrong field name)
    Evidence: .sisyphus/evidence/task-7-upload-wrong-field.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(api): /api/upload POST multipart via busboy with 4.5MB cap`
  - Files: `api/upload.ts`
  - Pre-commit: `tsc --noEmit`

- [ ] 8. **/api/documents.ts — GET metadata list (no file_data)**

  **What to do**:
  - Create `api/documents.ts` default async handler
  - Token validation FIRST, return 401 if invalid
  - Method guard: only GET allowed, otherwise 405
  - Query: `SELECT id, file_name, file_type, uploaded_at FROM documents ORDER BY uploaded_at DESC`
    - CRITICAL: explicitly EXCLUDE `file_data` column — lightweight response, all transfer overhead avoided
  - Response: `res.status(200).json(rows)` — array of `{ id, file_name, file_type, uploaded_at }` objects
  - Empty list is valid — return `[]` not 404
  - Error: try/catch with `console.error`, return 500

  **Must NOT do**:
  - NO `SELECT *` — must explicitly list columns to guarantee `file_data` stays out
  - NO file_data in response shape even by accident (audit via tsc and curl)
  - NO pagination, NO limit, NO offset, NO total-count header
  - NO search, NO filter, NO sort customization — server-side fixed `ORDER BY uploaded_at DESC`
  - NO JOIN with `secure_bridges` (token is env-only)
  - NO `console.log` of file contents (none fetched anyway)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: One query, no params, simple GET. Smallest endpoint.
  - **Skills**: `["ponytail"]`
    - `ponytail`: No pagination wrapper class, no DTO mapper, just `res.json(rows)`.

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 6, 7, 9, 10)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 13 (DocumentList reads this endpoint via TanStack Query)
  - **Blocked By**: Tasks 3, 4

  **References**:

  **Pattern References** (existing code to follow):
  - `api/_auth.ts` (T4), `src/lib/db.ts` (T3) — same as task 6.

  **API/Type References**:
  - Output shape: `Array<{ id: number; file_name: string; file_type: string; uploaded_at: string }>`

  **External References**:
  - Postgres `SELECT ... ORDER BY col DESC`: https://www.postgresql.org/docs/current/sql-select.html

  **WHY Each Reference Matters**:
  - Pins exact SELECT column list (avoids accidental `file_data` leak).

  **Acceptance Criteria**:

  - [ ] `api/documents.ts` exists with default export handler
  - [ ] Token validation first
  - [ ] Method guard returns 405 for non-GET
  - [ ] SELECT statement explicitly excludes `file_data`
  - [ ] Empty result returns `[]` (200)
  - [ ] `ORDER BY uploaded_at DESC` ensures newest-first listing

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Documents GET returns metadata only
    Tool: Bash (curl)
    Preconditions: dev server; at least one upload exists (run T7's curl first to create test-upload.txt); token valid
    Steps:
      1. curl -s -w "\\n%{http_code}" -H "x-bridge-token: dev-test-token-123" http://localhost:5173/api/documents
      2. Parse status + JSON
    Expected Result: HTTP 200; JSON is array with at least one object containing keys id, file_name, file_type, uploaded_at; NO "file_data" key in any element
    Failure Indicators: 401; 500; "file_data" key present anywhere in response (critical leak)
    Evidence: .sisyphus/evidence/task-8-documents-get.txt

  Scenario: Documents empty state
    Tool: Bash (curl)
    Preconditions: dev server; fresh Neon DB (no rows in documents); token valid
    Steps:
      1. curl -s -w "\\n%{http_code}" -H "x-bridge-token: dev-test-token-123" http://localhost:5173/api/documents
    Expected Result: HTTP 200; body is `[]`
    Failure Indicators: 404; null; 500
    Evidence: .sisyphus/evidence/task-8-documents-empty.txt

  Scenario: Documents unauthorized
    Tool: Bash (curl)
    Preconditions: dev server
    Steps:
      1. curl -s -w "\\n%{http_code}" http://localhost:5173/api/documents
    Expected Result: HTTP 401; JSON { error: "Unauthorized" }
    Failure Indicators: 200; 500
    Evidence: .sisyphus/evidence/task-8-documents-unauthorized.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(api): /api/documents GET metadata list only`
  - Files: `api/documents.ts`
  - Pre-commit: `tsc --noEmit`

- [ ] 9. **/api/download.ts — GET binary with proper headers**

  **What to do**:
  - Create `api/download.ts` default async handler
  - Token validation FIRST, return 401 if invalid
  - Method guard: GET only, otherwise 405
  - Parse query: `const id = req.query?.id` — validate as integer:
    - If `id` missing or `Number.isNaN(parseInt(id, 10))` → 400 `{ error: "Missing id query parameter" }`
  - Query: `SELECT file_name, file_type, file_data FROM documents WHERE id = $1` with `[parseInt(id, 10)]`
  - If no row matches: 404 `{ error: "Document not found" }`
  - If row found:
    - `const buffer = Buffer.from(rows[0].file_data)` (already a Buffer from Neon driver, but defensively cast)
    - Set headers:
      - `'Content-Type': rows[0].file_type`
      - `'Content-Disposition': attachment; filename="..."` — if filename has non-ASCII or special chars, use RFC 5987 encoding: `Content-Disposition: attachment; filename*=UTF-8''<percent-encoded>`
      - `'Content-Length': buffer.length`
    - `res.status(200).end(buffer)` — VercelResponse `.end(Buffer)` streams raw binary
  - Design: simple ASCII filename safe path for `filename="..."` portion; for non-ASCII, use only the `filename*=UTF-8''...` form to avoid broken quoting
  - Error: try/catch, 500 on unexpected

  **Must NOT do**:
  - NO returning file_data from download to wrong user — token gate is absolute
  - NO streaming cursor from Neon (HTTP driver doesn't support; buffer is fine for 4.5MB max)
  - NO `res.send(buffer)` (string coercion risk); use `res.end(buffer)`
  - NO setting `Content-Disposition: inline` (spec requires attachment to trigger download on mobile)
  - NO logging buffer contents
  - NO accepting non-integer id (must parseInt + re-validate)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Binary response + RFC 5987 filename encoding + VercelResponse buffer streaming nuance. Medium complexity.
  - **Skills**: `["ponytail"]`
    - `ponytail`: One query, one buffer, one trio of headers. No streaming abstraction.

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 6, 7, 8, 10)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 13 (DocumentList download buttons hit this endpoint)
  - **Blocked By**: Tasks 3, 4

  **References**:

  **Pattern References** (existing code to follow):
  - `api/_auth.ts`, `src/lib/db.ts` — same as other endpoints.

  **API/Type References**:
  - `VercelResponse.end(buffer: Buffer)` streams raw bytes — equivalent to Node `res.end(buffer)`
  - `req.query.id` is string (from URL query string); parseInt + validate
  - `Buffer.from(row.file_data)` — Neon BYTEA returns Uint8Array in HTTP mode OR Buffer in Node mode; cast defensively

  **External References** (libraries and frameworks):
  - RFC 5987: https://datatracker.ietf.org/doc/html/rfc5987 — `Content-Disposition: attachment; filename*=UTF-8''<percent-encoded>` syntax for non-ASCII filenames.
  - VercelResponse.end: https://vercel.com/docs/functions/runtimes/node-js — confirms `.end(buffer)` binary response pattern.
  - MDN Content-Disposition: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Disposition — confirms `attachment` triggers download.

  **WHY Each Reference Matters**:
  - RFC 5987 is the ONLY correct way to handle non-ASCII filenames in Content-Disposition; jumping straight to `filename="..."` breaks unicode and forces filename truncation.
  - VercelResponse.end docs confirm `buffer` arg streams binary without UTF-8 string coercion.
  - MDN confirms `attachment` disposition triggers download on iOS Safari, Android Chrome (spec target).

  **Acceptance Criteria**:

  - [ ] `api/download.ts` exists
  - [ ] Token validation first
  - [ ] Method guard 405 for non-GET
  - [ ] Missing id → 400
  - [ ] Nonexistent id → 404 `{ error: "Document not found" }`
  - [ ] Valid id → 200 with Content-Type matching stored file_type, Content-Disposition attachment, Content-Length correct
  - [ ] Non-ASCII filename uses RFC 5987 `filename*=UTF-8''...` form
  - [ ] Response is binary (buffer streamed via `.end(buffer)`)
  - [ ] `tsc --noEmit` exits 0

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Download binary happy path
    Tool: Bash (curl)
    Preconditions: an upload exists (run T7's curl first); record its id from T8 GET response
    Steps:
      1. curl -s -o /tmp/downloaded.bin -w "%{http_code}|%{content_type}" -H "x-bridge-token: dev-test-token-123" "http://localhost:5173/api/download?id=<id>"
      2. Diff /tmp/downloaded.bin against original /tmp/test-upload.txt
    Expected Result: HTTP 200; Content-Type "text/plain"; files identical byte-for-byte
    Failure Indicators: 401; 404; 500; Content-Type missing; downloaded content differs
    Evidence: .sisyphus/evidence/task-9-download-binary.txt

  Scenario: Download with non-ASCII filename (RFC 5987)
    Tool: Bash (curl)
    Preconditions: upload a file named "café-notes.txt" — curl -F "file=@/tmp/café-notes.txt"
    Steps:
      1. curl -s -I -H "x-bridge-token: dev-test-token-123" "http://localhost:5173/api/download?id=<id>"
      2. Inspect Content-Disposition header
    Expected Result: HTTP 200; Content-Disposition contains `filename*=UTF-8''caf%C3%A9-notes.txt` (URL-encoded UTF-8)
    Failure Indicators: `filename="café-notes.txt"` only (would truncate or corrupt); 500 on insert
    Evidence: .sisyphus/evidence/task-9-download-utf8.txt

  Scenario: Download nonexistent ID
    Tool: Bash (curl)
    Preconditions: dev server
    Steps:
      1. curl -s -w "\\n%{http_code}" -H "x-bridge-token: dev-test-token-123" "http://localhost:5173/api/download?id=999999"
    Expected Result: HTTP 404; JSON { error: "Document not found" }
    Failure Indicators: 200 with empty body; 500
    Evidence: .sisyphus/evidence/task-9-download-404.txt

  Scenario: Download missing id
    Tool: Bash (curl)
    Preconditions: dev server
    Steps:
      1. curl -s -w "\\n%{http_code}" -H "x-bridge-token: dev-test-token-123" "http://localhost:5173/api/download"
    Expected Result: HTTP 400; JSON { error: "Missing id query parameter" }
    Failure Indicators: 500; 200
    Evidence: .sisyphus/evidence/task-9-download-missing-id.txt

  Scenario: Unauthorized download
    Tool: Bash (curl)
    Preconditions: dev server
    Steps:
      1. curl -s -w "\\n%{http_code}" "http://localhost:5173/api/download?id=1"
    Expected Result: HTTP 401; JSON { error: "Unauthorized" }
    Failure Indicators: 200 leaking bytes without token; 500
    Evidence: .sisyphus/evidence/task-9-download-unauthorized.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(api): /api/download GET binary with RFC 5987 filename`
  - Files: `api/download.ts`
  - Pre-commit: `tsc --noEmit`

- [ ] 10. **/api/ai.ts — POST to NVIDIA NIM with 8s AbortController**

  **What to do**:
  - Create `api/ai.ts` default async handler
  - Token validation FIRST, return 401 if invalid
  - Method guard: POST only, otherwise 405
  - Parse body: `const { text } = req.body as { text: string }`
  - Validate: `typeof text !== 'string' || text.length === 0` → 400 `{ error: "text must be non-empty string" }`
  - Define `NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions"`
  - Define `SYSTEM_PROMPT = "Clean, format, and structure this scratchpad note efficiently using clean markdown while preserving structural integrity."`
  - Construct AbortController with 8s timeout: `const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 8000)`
  - Use global `fetch()` (Node 18+ in Vercel has built-in fetch; no `node-fetch` dep):
    ```typescript
    const response = await fetch(NIM_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'meta/llama3-70b-instruct',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });
    ```
  - Clear timeout after fetch resolves: `clearTimeout(timeout)` (always, success or fail)
  - If `controller.signal.aborted` (or AbortError caught) → return 504 `{ error: "NIM timeout" }`
  - If `!response.ok`:
    - For 4xx: passthrough the NIM error status + body if it's JSON, otherwise return `res.status(502).json({ error: "NIM upstream " + response.status })`
    - For 5xx: return 502 with same upstream error marker
  - Parse NIM JSON: `{ choices: [{ message: { content: string } }] }`
  - Extract formatted text: `const formatted = body.choices?.[0]?.message?.content`
  - If `formatted` missing: 502 `{ error: "NIM returned empty content" }`
  - Otherwise: `res.status(200).json({ formatted })`
  - Error catch-all for network/parse errors: `res.status(500).json({ error: "AI request failed" })`
  - DO NOT log `text` content anywhere

  **Must NOT do**:
  - NO streaming NIM response back to client (single JSON round-trip only)
  - NO `temperature` tweaking magic — fix at 0.3 (low for deterministic formatting)
  - NO `max_tokens` higher than 2048 (NIM llama3-70b supports more but we're formatting notes, not writing essays)
  - NO logging the user's note text
  - NO request retry logic (one shot — if NIM is down, surface the error)
  - NO `node-fetch` dep — use built-in fetch (Vercel Node 18+ has it)
  - NO token in any header sent to NVIDIA — only `Authorization: Bearer NVIDIA_API_KEY`
  - NO sending `x-bridge-token` to NVIDIA — only to internal endpoints
  - NO caching layer — single round-trip per call

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: External API integration + timeout + error passthrough + JSON shape parsing.
  - **Skills**: `["ponytail"]`
    - `ponytail`: Native fetch, no SDK, no client library, no retry/backoff wrapper. Single timeout, single call.

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 6, 7, 8, 9)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 12 (NoteEditor "Format with NIM" button)
  - **Blocked By**: Tasks 3 (db not strictly needed, but for consistency), 4 (auth)

  **References**:

  **Pattern References** (existing code to follow):
  - `api/_auth.ts`, `src/lib/db.ts` — auth pattern; db not used in this endpoint (AI only) but import for type consistency is OPTIONAL — DO NOT import db.ts if unused (ponytail: dead import).

  **API/Type References**:
  - NVIDIA NIM OpenAI-compatible chat completions: `POST /v1/chat/completions` with body `{ model, messages, temperature, max_tokens }`, response `{ choices: [{ message: { role, content } }] }`
  - AbortController API: `controller.abort()` triggers `AbortError` in await fetch; catch by name

  **External References** (libraries and frameworks):
  - NVIDIA NIM OpenAI-compatible API: https://docs.nvidia.com/nim/large-language-models/latest/getting-started.html — endpoint URL + body shape.
  - Node 18 fetch: https://nodejs.org/api/globals.html#fetch — confirms built-in `fetch()` is available in Node 18+.
  - AbortController: https://developer.mozilla.org/en-US/docs/Web/API/AbortController — signal pattern.

  **WHY Each Reference Matters**:
  - NVIDIA NIM docs confirm `/v1/chat/completions` is OpenAI-compatible (no NIM-specific SDK needed) — ponytail win.
  - Node 18 fetch reference confirms no `node-fetch` dep required for Vercel Node serverless.
  - AbortController reference confirms `controller.abort()` triggers `AbortError` in fetch promise rejection.

  **Acceptance Criteria**:

  - [ ] `api/ai.ts` exists with default export
  - [ ] Token validation first
  - [ ] Method guard 405 for non-POST
  - [ ] Request body validation: 400 if text missing or non-string
  - [ ] Fetch to `https://integrate.api.nvidia.com/v1/chat/completions` with `Authorization: Bearer NVIDIA_API_KEY`
  - [ ] Body uses `model: 'meta/llama3-70b-instruct'` exactly
  - [ ] System prompt is EXACTLY: `"Clean, format, and structure this scratchpad note efficiently using clean markdown while preserving structural integrity."`
  - [ ] AbortController with 8s timeout; cleared after fetch resolves
  - [ ] On abort: 504 `{ error: "NIM timeout" }`
  - [ ] On non-2xx upstream: 502 with status
  - [ ] On empty content: 502
  - [ ] Happy path: 200 `{ formatted: string }`
  - [ ] No `node-fetch` import
  - [ ] `tsc --noEmit` exits 0

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: AI format happy path
    Tool: Bash (curl)
    Preconditions: dev server; NVIDIA_API_KEY env set; sample messy text ready
    Steps:
      1. curl -s -w "\\n%{http_code}" -X POST -H "x-bridge-token: dev-test-token-123" -H "Content-Type: application/json" -d '{"text":"meeting notes - design review 10am   talked about new auth flow - john wants oauth   ACTION  item- sara to draft schema by friday"}' http://localhost:5173/api/ai
      2. Parse status + JSON
    Expected Result: HTTP 200; JSON has "formatted" key with multi-line markdown content; text contains markdown markers (e.g., "## ", "- ", "**")
    Failure Indicators: 401; 400; 504 (timeout); 502 (NIM error); formatted empty string
    Evidence: .sisyphus/evidence/task-10-ai-happy.txt

  Scenario: AI format empty text rejected
    Tool: Bash (curl)
    Preconditions: dev server
    Steps:
      1. curl -s -w "\\n%{http_code}" -X POST -H "x-bridge-token: dev-test-token-123" -H "Content-Type: application/json" -d '{"text":""}' http://localhost:5173/api/ai
    Expected Result: HTTP 400; JSON { error: "text must be non-empty string" }
    Failure Indicators: 200 with empty formatted; 500
    Evidence: .sisyphus/evidence/task-10-ai-empty.txt

  Scenario: AI format unauthorized
    Tool: Bash (curl)
    Preconditions: dev server
    Steps:
      1. curl -s -w "\\n%{http_code}" -X POST -d '{"text":"test"}' http://localhost:5173/api/ai
    Expected Result: HTTP 401; { error: "Unauthorized" }
    Failure Indicators: 200; 400 (token check must come BEFORE body validation); 504
    Evidence: .sisyphus/evidence/task-10-ai-unauthorized.txt

  Scenario: AI upstream failure (NIM unavailable)
    Tool: Bash (curl)
    Preconditions: Set NVIDIA_API_KEY to an invalid value like "nvapi-INVALID" to force NIM to 401
    Steps:
      1. curl -s -w "\\n%{http_code}" -X POST -H "x-bridge-token: dev-test-token-123" -d '{"text":"test"}' http://localhost:5173/api/ai
    Expected Result: HTTP 502; JSON body mentions "NIM upstream" + status code
    Failure Indicators: 500 (too generic); 401 (NIM's error leaking as our 401 — could be confused with token error)
    Evidence: .sisyphus/evidence/task-10-ai-upstream-fail.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(api): /api/ai POST to NVIDIA NIM llama3-70b with 8s timeout`
  - Files: `api/ai.ts`
  - Pre-commit: `tsc --noEmit`

- [ ] 11. **Dashboard Layout Shell (src/routes/index.tsx + base layout)**

  **What to do**:
  - Replace placeholder `src/routes/index.tsx` with real dashboard shell:
    - `createFileRoute('/')` import already exists from T2
    - Component returns a `div` with grid layout:
      ```tsx
      <div className="min-h-screen bg-zinc-950 text-zinc-100 grid grid-cols-1 lg:grid-cols-2 gap-px bg-zinc-900/40">
        <div className="..."><NoteEditor /></div>
        <div className="..."><FileDropzone /><DocumentList /></div>
      </div>
      ```
    - Use `grid-cols-2` on `lg+` for true 50/50 split; stack vertically on mobile (`grid-cols-1`)
    - Gap is `gap-px` with `bg-zinc-900/40` parent — creates a hairline divider line between panes (subtle, premium)
    - Do NOT render NoteEditor / FileDropzone / DocumentList yet — leave TODO comments referencing which task implements each; OR render with minimal placeholder divs if components from T12/T13 don't exist yet. Decision: render minimal inline placeholders here, replace with real components in T14 integration task.
    - Top-of-page minimal header bar: `<header className="px-6 py-4 text-xs uppercase tracking-widest text-zinc-500 font-mono">notes</header>` (stealth generic label)
  - This task is the SHELL only — actual editor and file ecosystem functional wiring lands in T14.

  **Must NOT do**:
  - NO full app chrome (no nav, no sidebar, no breadcrumbs) — single page utility
  - NO title larger than `text-xs` in header — stealth > aesthetics
  - NO "Noting" branding anywhere in DOM
  - NO logo or favicon configuration here
  - NO theme toggle (dark only, per spec)
  - NO settings menu, NO profile, NO logout button

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Layout + dark theme + hairline divider aesthetic requires taste skill discipline.
  - **Skills**: `["ponytail", "design-taste-frontend"]`
    - `ponytail`: Minimal grid, no nav, no chrome, no theme toggle.
    - `design-taste-frontend`: Premium dark zinc-950 aesthetic, hairline dividers via grid gap.
  - **Skills Evaluated but Omitted**: None — both relevant.

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 12, 13) — shell independent of component internals
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 14 (integration wires real components into this shell)
  - **Blocked By**: Task 2 (router providers), Task 1 (workspace)

  **References**:

  **Pattern References**:
  - `src/routes/__root.tsx` (T2) — provides overall `bg-zinc-950 text-zinc-100` wrapper; index route only fills the body.

  **API/Type References**:
  - TanStack Router `createFileRoute('/')` — returned hook gives route object; component renders via `() => JSX`

  **External References**:
  - Tailwind grid utilities: https://tailwindcss.com/docs/grid-template-columns — `grid-cols-1 lg:grid-cols-2` pattern for responsive 50/50.

  **WHY Each Reference Matters**:
  - Tailwind grid docs confirm `lg:grid-cols-2` breakpoint (1024px) — below that, stack vertically. Matches ponytail + stealth.

  **Acceptance Criteria**:

  - [ ] `src/routes/index.tsx` renders two-pane grid at lg+ breakpoint
  - [ ] At default viewport, layout is single column (stacked)
  - [ ] Header present with text "notes" (lowercase, text-xs, uppercase tracking-widest)
  - [ ] Two side-by-side placeholders with hairline divider (`gap-px bg-zinc-900/40`)
  - [ ] `tsc --noEmit` exits 0
  - [ ] `npm run build` succeeds
  - [ ] No "Noting", "Bridge", "Pipe" branding in DOM

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Two-pane layout at desktop viewport
    Tool: Playwright (playwright skill)
    Preconditions: Vite dev server running; token/localStorage seeded via URL navigation first
    Steps:
      1. Navigate to http://localhost:5173/?token=dev-test-token-123
      2. Set viewport to 1280x800
      3. Read bounding box of left pane (first child of grid) and right pane (second child)
      4. Assert: widths approximately equal (each ~49-51% of viewport width)
    Expected Result: Two panes side-by-side, equal widths
    Failure Indicators: Single column at desktop; uneven pane widths (60/40 unwanted)
    Evidence: .sisyphus/evidence/task-11-layout-desktop.png (screenshot)

  Scenario: Stacked layout at mobile viewport
    Tool: Playwright
    Preconditions: dev server; token seeded
    Steps:
      1. Navigate to http://localhost:5173/
      2. Set viewport to 375x800 (mobile)
      3. Read child positions
    Expected Result: Both panes stacked vertically, full-width each
    Failure Indicators: Horizontally side-by-side at mobile breakpoints
    Evidence: .sisyphus/evidence/task-11-layout-mobile.png

  Scenario: Stealth header verified
    Tool: Playwright
    Preconditions: dev server
    Steps:
      1. Navigate to http://localhost:5173/
      2. Read document.title
      3. Read text content of <header> first element
    Expected Result: title is "Notes" (generic); header text is "notes"
    Failure Indicators: Title contains "Noting", "Bridge", "Pipe", "Secure"
    Evidence: .sisyphus/evidence/task-11-stealth-header.json
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(ui): dashboard 50/50 split-pane shell with stealth header`
  - Files: `src/routes/index.tsx`
  - Pre-commit: `tsc --noEmit && npm run build`

- [ ] 12. **NoteEditor Component with 500ms Debounce + Format with NIM**

  **What to do**:
  - Create `src/components/NoteEditor.tsx`
  - TanStack Query hooks:
    - `useQuery({ queryKey: ['note'], queryFn: () => fetch('/api/note', { headers: bridgeHeaders() }).then(r => r.json()) })` — loads latest note content on mount
    - Local state: `const [text, setText] = useState<string>('')` initializes from query data via `useEffect` watching `data?.content`
    - `useMutation` for save: `postNote = useMutation({ mutationFn: (content: string) => fetch('/api/note', { method: 'POST', headers: bridgeHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ content }) }).then(r => r.json()) })`
    - `useMutation` for AI format: `formatNote = useMutation({ mutationFn: (text: string) => fetch('/api/ai', { method: 'POST', headers: bridgeHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ text }) }).then(r => r.json()) })`
  - Debounce logic (500ms):
    - `useEffect(() => { if (!hasInitializedFromQuery) return; const t = setTimeout(() => { postNote.mutate(text) }, 500); return () => clearTimeout(t) }, [text])`
    - Initialize `hasInitializedFromQuery = true` once query loads to avoid firing mutation on initial empty text
    - Track in-flight save with `useRef<AbortController | null>(null)` pattern OR simpler: use TanStack Query `isPending` flag to disable further triggers — ponytail: skip AbortController, check `postNote.isPending` before triggering. Decision: ponytail — just check `isPending` and last-write-wins.
  - Save indicator: small absolutely-positioned pill top-right (`absolute top-3 right-3`): show "Saving…" when `postNote.isPending`, "Saved" when settled success, hidden otherwise. Use `text-xs text-zinc-500`.
  - Format with NIM button: absolutely positioned bottom-right of editor pane:
    - `<button className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg text-xs font-mono text-zinc-300 bg-zinc-900/80 border border-zinc-800 hover:border-zinc-600 transition-colors">Format with NIM</button>`
    - On click: `formatNote.mutate(text)`; on success: `setText(formatted)` and `queryClient.invalidateQueries({ queryKey: ['note'] })` to re-sync server
    - Show loading state on button: `formatNote.isPending ? "Formatting..." : "Format with NIM"`
  - Textarea:
    ```tsx
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      className="absolute inset-0 w-full h-full bg-transparent p-6 font-mono text-sm text-zinc-200 resize-none focus:outline-none border-0 placeholder:text-zinc-600"
      placeholder="// scratchpad — autosaves every 500ms"
      spellCheck={false}
    />
    ```
  - Container wraps editor in `relative` div with above textarea + save pill + format button
  - Apply spec's exact editor styles via wrapper:
    ```tsx
    <div className="relative h-full bg-zinc-900/50 rounded-xl border border-zinc-800/60">
      <textarea ... className="absolute inset-0 bg-transparent p-6 font-mono text-sm text-zinc-200 resize-none focus:outline-none placeholder:text-zinc-600 rounded-xl focus:border-zinc-700/80 transition-colors" />
    </div>
    ```
    Note: spec wanted `border border-zinc-800/60 p-6 focus:outline-none focus:border-zinc-700/80 resize-none` on the textarea directly — incorporate those into textarea className. Reconcile by putting the rounded-xl border container around the textarea, the textarea fills inset-0.

  **Must NOT do**:
  - NO markdown preview pane (spec forbids)
  - NO toolbar (bold/italic/etc) — plain textarea only
  - NO spellcheck true (would mess with monospace scratchpad aesthetic)
  - NO empty autosave firing on initial mount — hasInitializedFromQuery gate
  - NO `console.log` of text content
  - NO more than ONE format button (single "Format with NIM")
  - NO retry logic on save failure — Let TanStack Query show error state in pill text
  - NO simultaneous save + format firing — when format is pending, skip debounce save trigger

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Component composition + dark theme aesthetics + precise debounce state machine + absolute positioning.
  - **Skills**: `["ponytail", "design-taste-frontend"]`
    - `ponytail`: Plain textarea, native onChange, single setTimeout for debounce. No debounce lib.
    - `design-taste-frontend`: Exact Tailwind classes from spec, save pill aesthetic, format button micro-shadow.

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 11, 13)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 14 (integration)
  - **Blocked By**: Tasks 1, 2, 6 (note API contract), 10 (AI API contract)

  **References**:

  **Pattern References**:
  - Spec's exact editor styles: `font-mono text-zinc-200 bg-zinc-900/50 rounded-xl border border-zinc-800/60 p-6 focus:outline-none focus:border-zinc-700/80 resize-none`
  - T6 endpoint contract: GET returns `{ content, updated_at }`, POST accepts `{ content: string }` returns same shape
  - T10 endpoint contract: POST accepts `{ text: string }`, returns `{ formatted: string }`

  **API/Type References**:
  - TanStack Query v5: `useQuery({ queryKey, queryFn })`, `useMutation({ mutationFn, onSuccess })`, `queryClient.invalidatequeries({ queryKey })`
  - `bridgeHeaders({ 'Content-Type': 'application/json' })` — token helper from T4

  **External References**:
  - TanStack Query v5 mutations: https://tanstack.com/query/v5/docs/framework/react/guides/mutations — `mutate(data)` signature.
  - React useEffect cleanup pattern for debounce: https://react.dev/reference/react/useEffect#specifying-the-dependencies-cleanup-from-an-effect

  **WHY Each Reference Matters**:
  - TanStack Query v5 mutation docs confirm `mutate` is synchronous call to start async; `isPending` flips true synchronously. Perfect for save pill UI.
  - React useEffect cleanup confirms `return () => clearTimeout(t)` runs on next state change — standard debounce pattern.

  **Acceptance Criteria**:

  - [ ] `src/components/NoteEditor.tsx` exists
  - [ ] Loads existing note on mount via `useQuery(['note'])`
  - [ ] Text changes fire `useMutation` after 500ms of no input
  - [ ] Save pill shows "Saving…" / "Saved" / hidden states
  - [ ] "Format with NIM" button visible, calls `/api/ai`, replaces editor text with `formatted` on success
  - [ ] `queryClient.invalidateQueries({ queryKey: ['note'] })` runs after format success
  - [ ] Initial mount does NOT fire save mutation for empty default text
  - [ ] Editor has exact Tailwind classes from spec (or equivalent visually)
  - [ ] `tsc --noEmit` exits 0
  - [ ] `npm run build` succeeds

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Note loads on mount
    Tool: Playwright
    Preconditions: dev server; token seeded; note has content "first save" via curl POST in T6 tests
    Steps:
      1. Navigate to http://localhost:5173/?token=dev-test-token-123
      2. Wait 1s for query to load
      3. Read textarea value via page.locator('textarea').inputValue()
    Expected Result: textarea value contains "first save" (or last saved content)
    Failure Indicators: textarea empty though save has been done; textarea shows "undefined"
    Evidence: .sisyphus/evidence/task-12-note-loads.png

  Scenario: Debounced save on type
    Tool: Playwright
    Preconditions: dev server; token seeded; intercept /api/note POST via route intercept
    Steps:
      1. Navigate to http://localhost:5173/
      2. Locate textarea, type "hello noting"
      3. Wait 700ms (above debounce)
      4. Assert POST to /api/note was made with body { content: "hello noting" }
      5. Save pill should show "Saved" after response
    Expected Result: One POST fired (not per-keystroke); payload content matches
    Failure Indicators: Multiple POSTs during typing; no POST after 500ms; stale content
    Evidence: .sisyphus/evidence/task-12-debounce-save.txt

  Scenario: Format with NIM button
    Tool: Playwright
    Preconditions: dev server; token seeded; NVIDIA_API_KEY set; textarea has some messy text
    Steps:
      1. Navigate to http://localhost:5173/
      2. Type "   messy  meeting   notes    " in textarea
      3. Click "Format with NIM" button
      4. Wait for button text to show "Formatting..." then return to "Format with NIM"
      5. Read textarea value
    Expected Result: Button cycles through "Formatting..." state; textarea value updated to formatted markdown from NIM
    Failure Indicators: Button stays "Formatting..." forever (timeout); textarea unchanged on completion; 504 shown without recovery
    Evidence: .sisyphus/evidence/task-12-format-nim.png

  Scenario: No autosave trigger on empty initial mount
    Tool: Playwright + curl
    Preconditions: dev server; SET note content to expected via curl first; localStorage fresh; capture /api/note POST count
    Steps:
      1. POST /api/note with { content: "preserve me" }
      2. Navigate to http://localhost:5173/?token=dev-test-token-123 (fresh)
      3. Wait 1s — DO NOT type
      4. Count POST requests to /api/note from browser
    Expected Result: Zero POSTs made by browser on initial load (before user types)
    Failure Indicators: 1+ POST requests trigger empty body on mount — overwrites "preserve me" with ""
    Evidence: .sisyphus/evidence/task-12-no-spurious-save.txt
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(ui): NoteEditor with 500ms debounce save and Format with NIM`
  - Files: `src/components/NoteEditor.tsx`
  - Pre-commit: `tsc --noEmit && npm run build`

- [ ] 13. **FileDropzone + DocumentList Components**

  **What to do**:
  - Create `src/components/FileDropzone.tsx`:
    - Outer div with exact spec classes: `border-dashed border-2 border-zinc-800 rounded-xl flex flex-col items-center justify-center py-10 transition-colors duration-200 hover:border-zinc-600 cursor-pointer`
    - Drag handlers: `onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}` `onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}`
    - Also: hidden file input via `<input type="file" className="hidden" onChange={(e) => handleFiles(e.target.files)} />` — click on dropzone triggers input
    - `handleFiles`:
      - Validate size client-side: `if (file.size > 4.5 * 1024 * 1024)` show inline error "File too large (max 4.5MB)" and abort
      - Otherwise call `uploadMutation.mutate(file)`
    - Upload mutation: `useMutation({ mutationFn: (file: File) => { const fd = new FormData(); fd.append('file', file); return fetch('/api/upload', { method: 'POST', headers: bridgeHeaders(), body: fd }).then(r => r.json()) }, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }) })`
      - NOTE: do NOT set `Content-Type: multipart/form-data` manually — browser sets the boundary automatically. `bridgeHeaders()` returns only `x-bridge-token`.
    - State indicators:
      - Default: "Drop file or click to browse" centered icon (inline SVG upload arrow, 24x24, stroke-zinc-500)
      - Pending: spinner SVG replacing icon + text "Uploading..."
      - Error: red-tinted text for ~2s then reverts
    - Inline SVG spinner (~15-line SVG path, simple stroke rotation), NO `lucide-react`
  - Create `src/components/DocumentList.tsx`:
    - `useQuery({ queryKey: ['documents'], queryFn: () => fetch('/api/documents', { headers: bridgeHeaders() }).then(r => r.json()) })`
    - Empty state: `documents?.length === 0` → "No documents" in muted zinc-500
    - List container: `flex flex-col gap-2 overflow-y-auto max-h-[50vh]`
    - Row pattern (one per document):
      ```tsx
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/60 hover:border-zinc-700/60 transition-colors">
        <span className="inline-flex h-8 w-8 items-center justify-center text-zinc-500">
          <svg width="16" height="16" ...> {/* file icon inline svg */}</svg>
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-zinc-200 truncate font-mono">{doc.file_name}</div>
          <div className="text-xs text-zinc-500">{doc.file_type}</div>
        </div>
        <a href={`/api/download?id=${doc.id}`} download={doc.file_name} className="...">
          {/* download svg icon */}
        </a>
      </div>
      ```
    - Use `<a href="...">` not `<button onClick={fetch}>` — native download attribute triggers download dialog directly
    - Auto-refreshes when `queryClient.invalidateQueries(['documents'])` fires (after upload in FileDropzone)

  **Must NOT do**:
  - NO `lucide-react` or icon library — inline SVG for file icon and download icon and spinner
  - NO filesize display in row (T8 endpoint doesn't include size; avoid scope creep)
  - NO file preview/thumbnail
  - NO delete button (out of scope — only download in spec)
  - NO pagination (single list)
  - NO search/filter input
  - NO drag-drop sort order — server ORDER BY uploaded_at DESC locked
  - NO `react-dropzone` lib — vanilla onDragOver/onDrop

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Drag-drop UX + list row composition + inline SVG icons + dark theme polish.
  - **Skills**: `["ponytail", "design-taste-frontend"]`
    - `ponytail`: Vanilla React event handlers, no dropzone lib. Inline SVGs over icon packages.
    - `design-taste-frontend`: Subtle hover transitions, hairline row borders, monospace filename alignment.

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 11, 12)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 14 (integration)
  - **Blocked By**: Tasks 1, 2, 7, 8, 9 (API contracts for upload, documents, download)

  **References**:

  **Pattern References**:
  - Spec's exact dropzone classes: `border-dashed border-2 border-zinc-800 rounded-xl flex flex-col items-center justify-center py-10 transition-colors duration-200 hover:border-zinc-600 cursor-pointer`
  - T7 endpoint: POST multipart with field `file=`, returns `{ id, file_name, file_type, uploaded_at }`
  - T8 endpoint: GET documents, returns array of `{ id, file_name, file_type, uploaded_at }`
  - T9 endpoint: GET download?id=, returns binary with Content-Type + Content-Disposition attachment

  **API/Type References**:
  - TanStack Query v5 `useMutation` + `queryClient.invalidateQueries` pattern
  - Browser FormData API: `fd.append('file', file)` — browser sets multipart boundary auto
  - HTMLAnchorElement `download` attribute: triggers download from binary response when Content-Disposition is attachment

  **External References**:
  - TanStack Query invalidation: https://tanstack.com/query/v5/docs/framework/react/guides/invalidating-queries
  - HTMLAnchorElement download attr: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a#attr-download — confirms anchor with `download` attribute on binary blob response.

  **WHY Each Reference Matters**:
  - TanStack invalidation docs confirm `queryClient.invalidateQueries({ queryKey: ['documents'] })` marks query stale + refetches — standard cross-component cache invalidation after upload.
  - MDN anchor download docs confirm `<a href="/api/download?id=X" download="filename">` works with binary blob response when server returns Content-Disposition attachment (doubles up).

  **Acceptance Criteria**:

  - [ ] `src/components/FileDropzone.tsx` exists
  - [ ] Dropzone has exact spec Tailwind classes
  - [ ] Drag over + drop handlers attached; `preventDefault()` called
  - [ ] Click on dropzone triggers hidden file input
  - [ ] Client-side 4.5MB check rejects large files before upload
  - [ ] Upload mutation calls `/api/upload` with FormData containing `file` field
  - [ ] `onSuccess` calls `queryClient.invalidateQueries({ queryKey: ['documents'] })`
  - [ ] Loading spinner shown during upload (inline SVG, no lucide)
  - [ ] `src/components/DocumentList.tsx` exists
  - [ ] List queries `/api/documents` on mount and on invalidation
  - [ ] Empty state when list is empty
  - [ ] Row renders file_name (mono font) + file_type + download anchor
  - [ ] Download anchor uses `href="/api/download?id=${doc.id}" download={doc.file_name}`
  - [ ] No `lucide-react`, no `react-dropzone` in package.json — verify these deps are NOT present

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Dropzone accepts drag-drop file
    Tool: Playwright
    Preconditions: dev server; token seeded; small test file at ./fixtures/sample.txt (agent creates this); DB cleared documents first
    Steps:
      1. Navigate to http://localhost:5173/?token=dev-test-token-123
      2. Locate dropzone (class .border-dashed or via text "Drop file")
      3. dispatchEvent on dropzone with synthetic DataTransfer containing sample.txt
      4. Wait for DocumentList to update (poll for text "sample.txt")
    Expected Result: "sample.txt" appears in document list within 3s; spinner shows during upload then disappears
    Failure Indicators: 413 shown (size check wrong); 401 (token not in headers); DocumentList doesn't refresh
    Evidence: .sisyphus/evidence/task-13-dropzone-upload.png

  Scenario: Dropzone rejects oversized file client-side
    Tool: Playwright
    Preconditions: dev server; create 5MB file in fixtures
    Steps:
      1. Navigate to http://localhost:5173/
      2. Attempt to drop 5MB test file on dropzone (via synthetic DataTransfer)
      3. Wait 1s
      4. Read dropzone text content
    Expected Result: Error visible like "File too large (max 4.5MB)"; no POST to /api/upload fired
    Failure Indicators: POST to /api/upload fired (client check missing); errors clear instantly without timer
    Evidence: .sisyphus/evidence/task-13-dropzone-oversized.txt

  Scenario: Document list items show metadata + download link
    Tool: Playwright
    Preconditions: dev server; at least one document exists (via prior upload)
    Steps:
      1. Navigate to http://localhost:5173/
      2. Wait for DocumentList to load
      3. Get all anchor elements with href starting "/api/download?"
      4. Assert at least 1 anchor, each has href contain "id=" pattern
      5. Click first anchor — assert trigger of download (via response having Content-Disposition attachment)
    Expected Result: 1+ anchor present; click on anchor triggers download via native anchor behavior; response Content-Type set
    Failure Indicators: No anchors (DocumentList empty); anchor click navigates away instead of downloading
    Evidence: .sisyphus/evidence/task-13-doc-list.png

  Scenario: DocumentList invalidates cache after upload
    Tool: Playwright
    Preconditions: dev server; upload ONE file via curl to /api/upload (creates row); clear cache
    Steps:
      1. Navigate to http://localhost:5173/
      2. Wait 1s for initial fetch — list has 1 item (the seeded file)
      3. Upload another file via curl POST (DOM not triggered, just server)
      4. The list still shows 1 item (no invalidation via server-side change directly)
      5. Now drag-drop ANOTHER file via dropzone in browser
      6. After upload resolves, list should show now updated entries (invalidation refetch)
    Expected Result: List updates after the in-app drag-drop (no extra files from curl appear unless we use the same DB); the in-app upload triggers refetch
    Failure Indicators: List doesn't update after upload (invalidation not firing)
    Evidence: .sisyphus/evidence/task-13-invalidation.txt
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(ui): FileDropzone + DocumentList with cache invalidation`
  - Files: `src/components/FileDropzone.tsx`, `src/components/DocumentList.tsx`
  - Pre-commit: `tsc --noEmit && npm run build`

- [ ] 14. **Dashboard Integration (wire editor + file ecosystem into index.tsx)**

  **What to do**:
  - Edit `src/routes/index.tsx` (created in T11) to replace placeholder divs with real component imports:
    - Import `NoteEditor` from `./components/NoteEditor`
    - Import `FileDropzone` and `DocumentList` from `./components/FileDropzone` and `./components/DocumentList` OR barrel — ponytail: import directly, no barrel file
  - Render layout:
    ```tsx
    <main className="min-h-screen bg-zinc-950 text-zinc-100 grid grid-cols-1 lg:grid-cols-2 gap-px bg-zinc-900/40">
      <section className="relative p-6 bg-zinc-950">
        <NoteEditor />
      </section>
      <section className="flex flex-col gap-6 p-6 bg-zinc-950">
        <FileDropzone />
        <DocumentList />
      </section>
    </main>
    ```
  - Adjust header + grid wrapper — header might already be at root layout, remove duplicate header from index.tsx if present (decision: keep single header in __root.tsx)
  - Remove any leftover placeholder code from T11
  - Run `npm run dev` + manual visual smoke test via Playwright screenshot
  - Run `npm run build` to verify production build success
  - Verify TanStack Query compiles correctly with all mutation/query hooks active simultaneously

  **Must NOT do**:
  - NO additional UI chrome added in this task
  - NO new state lifted to dashboard component — each child manages own state via TanStack Query
  - NO barrel export file (`components/index.ts`)
  - NO context provider added — TanStack Query provider already at main.tsx
  - NO `useState` for selected document or current note — all via TanStack Query cache
  - NO layout overrides that would change T11's 50/50 split

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Integration task requiring layout finalization + visual polish + build verification.
  - **Skills**: `["ponytail", "design-taste-frontend"]`
    - `ponytail`: Drop-in imports; no new state shape, no context, no barrel.
    - `design-taste-frontend`: Final visual balance pass on spacing and divider aesthetic.

  **Parallelization**:
  - **Can Run In Parallel**: NO — depends on T11, T12, T13 complete
  - **Parallel Group**: Wave 3 (after T11/T12/T13)
  - **Blocks**: Final Verification Wave (F1-F4)
  - **Blocked By**: Tasks 11, 12, 13 (need the actual components)

  **References**:

  **Pattern References**:
  - T11 shell layout
  - T12 NoteEditor signature: exports default function `() => JSX`
  - T13 FileDropzone / DocumentList signatures: default function each

  **API/Type References**:
  - TanStack Query query keys: `['note']` (used by NoteEditor GET + invalidate), `['documents']` (used by DocumentList GET + FileDropzone onSuccess invalidate)

  **External References**: None — internal wiring only.

  **WHY Each Reference Matters**:
  - QueryKey conventions from T12/T13 must match exactly — `['note']` vs `['notes']` typo would break invalidation. Double-check via grep before closing task.

  **Acceptance Criteria**:

  - [ ] `src/routes/index.tsx` imports `NoteEditor`, `FileDropzone`, `DocumentList`
  - [ ] Layout renders all three in proper grid placement (editor left, dropzone+list right, stacked vertically on right)
  - [ ] `npm run dev` starts cleanly without console errors
  - [ ] `npm run build` succeeds producing `dist/index.html`
  - [ ] `tsc --noEmit` exits 0
  - [ ] All TanStack Query hooks fire correctly on initial page load (note loads, documents load)
  - [ ] End-to-end smoke: type note → saves → upload file → appears in list → download file → click Format with NIM → note text changes
  - [ ] No leftover placeholder divs from T11

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: End-to-end smoke (happy path flow)
    Tool: Playwright (playwright skill)
    Preconditions: dev server; token seeded; NVIDIA_API_KEY set; NEON_CONNECTION_STRING set; db/schema.sql run; clear documents table first
    Steps:
      1. Navigate to http://localhost:5173/?token=dev-test-token-123
      2. Wait 1s for queries to load
      3. Type "  testing  noting  " in textarea
      4. Wait 700ms for autosave
      5. Reload page — assert textarea value === "  testing  noting  " (persisted)
      6. Locate dropzone, drop sample.txt
      7. Wait for DocumentList to show "sample.txt"
      8. Click download anchor for "sample.txt"
      9. Wait for browser download to trigger (verify response Content-Disposition header via route intercept)
      10. Click "Format with NIM" button
      11. Wait for button to cycle "Formatting..." → "Format with NIM"
      12. Read textarea value
    Expected Result: After step 5 textarea value persists; after step 7 file in list; after step 9 download triggered; after step 12 textarea text formatted (no longer "  testing  noting  ")
    Failure Indicators: ANY of these steps fail — note doesn't persist, file not appearing, download not triggering, format not changing text
    Evidence: .sisyphus/evidence/task-14-e2e-smoke.png + task-14-e2e-flow.txt

  Scenario: Visual layout final polish screenshot
    Tool: Playwright
    Preconditions: dev server
    Steps:
      1. Navigate to http://localhost:5173/?token=dev-test-token-123
      2. Set viewport 1440x900
      3. Wait 2s for full load
      4. Capture full-page screenshot
    Expected Result: Screenshot shows dark zinc-950 background, 50/50 layout, hairline vertical divider, header "notes" generic, save pill top-right of editor, "Format with NIM" button bottom-right of editor, dropzone visible upper right, documents list (empty state OK) lower right
    Failure Indicators: Layout broken (single column at desktop); visible white flashes; "Noting" branding anywhere; no monospace font in editor
    Evidence: .sisyphus/evidence/task-14-visual-final.png

  Scenario: Production build runs without type errors
    Tool: Bash
    Preconditions: All components and routes implemente
    Steps:
      1. Run `npm run build`
      2. Check dist/index.html exists
      3. Check dist/assets/ contains JS bundles
    Expected Result: exit 0; dist/ populated with index.html and assets
    Failure Indicators: tsc errors shown; build aborts partway; chunks missing
    Evidence: .sisyphus/evidence/task-14-build.txt
  ```

  **Commit**: YES (separately, final implementation commit)
  - Message: `feat(ui): wire components into dashboard and verify build`
  - Files: `src/routes/index.tsx`
  - Pre-commit: `tsc --noEmit && npm run build`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + `npm run build`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in `/api/*`, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names. Verify no `lucide-react`, no ORM in `package.json`.
  Output: `Build [PASS/FAIL] | TS [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration: token-wipe → load note → type → autosave → upload file → see in list → download → format note. Focus on: stealth factor (URL bar clean, page title generic), dark theme visual quality (screenshot), race conditions (rapid typing + save), oversized file rejection. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination (Task N touching Task M's files). Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `feat(scaffold): vite + ts design tokens + tanstack wiring + db client + token helper + vercel config`
  Files: `package.json`, `vite.config.ts`, `tsr.config.json`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, `src/main.tsx`, `src/routes/__root.tsx`, `src/lib/db.ts`, `src/lib/token.ts`, `vercel.json`, `.env.example`, `.gitignore`
  Pre-commit: `tsc --noEmit && npm run build`
- **Wave 2**: `feat(api): note + upload + documents + download + ai serverless routes`
  Files: `api/*.ts`
  Pre-commit: `tsc --noEmit`
- **Wave 3 (one commit per task or one grouped commit)**: `feat(ui): dashboard layout + note editor + file dropzone + document list`
  Files: `src/routes/index.tsx`, `src/components/*.tsx`
  Pre-commit: `tsc --noEmit && npm run build`
- **FINAL**: `chore: cleanup evidence + final polish` (only if reviewer flagged issues warrant fixes)

---

## Success Criteria

### Verification Commands
```bash
npm install                                      # Expected: clean install
npm run dev                                      # Expected: Vite dev server starts on localhost:5173
npm run build                                    # Expected: produces dist/ with no errors
tsc --noEmit                                     # Expected: 0 errors

# Token missing (should 401)
curl localhost:5173/api/note                     # Expected: 401 {"error":"Unauthorized"}

# Token valid (should return saved note content)
curl -H "x-bridge-token: dev-test-token-123" localhost:5173/api/note
# Expected: 200 {"content": "...", "updated_at": "..."}

# Stealth check
# Open localhost:5173/?token=dev-test-token-123 in browser
# Expected: URL becomes localhost:5173/ within 1 render cycle
# Expected: localStorage has bridge-token=dev-test-token-123
# Expected: document.title is "Notes" (or generic, not "Noting Secure Bridge")
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] `npm run build` succeeds
- [ ] All 5 `/api/*` endpoints reachable
- [ ] URL wipe on token capture verified
- [ ] 500ms debounce note save verified
- [ ] 4.5MB upload rejection verified (413)
- [ ] Download sets correct Content-Type + Content-Disposition
- [ ] Format with NIM replaces editor content
- [ ] `queryClient.invalidateQueries` fires after upload + format
- [ ] Dark zinc-950 theme throughout
- [ ] Page title is stealth generic