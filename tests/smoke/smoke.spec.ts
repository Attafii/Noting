import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { SMOKE_ANSWER, SMOKE_TOKEN } from './env';

/**
 * End-to-end smoke of the happy path: unlock → new note → Write with AI →
 * preview → insert. Runs against the real dev server / Neon, but every
 * /api/ai call is fulfilled with a canned draft (zero OpenRouter spend,
 * deterministic assertions). The note is created fresh and soft-deleted at
 * the end; a start-of-test sweep removes anything a previous failed run left
 * behind (identifiable by the `zz-smoke` title prefix).
 */

const DRAFT = '# Smoke draft\n\nRendered by the mocked AI and inserted by the write modal.';
const STALE_PREFIX = 'zz-smoke';

let createdNoteId: number | null = null;

/** The `request` fixture ships without cookies — log in, then sweep leftovers. */
async function authenticateAndSweep(request: APIRequestContext): Promise<void> {
  const auth: APIResponse = await request.post('/api/session', {
    data: { token: SMOKE_TOKEN, answer: SMOKE_ANSWER },
  });
  if (!auth.ok()) return; // the in-browser unlock below will surface a clearer error
  const list = await request.get(`/api/notes?q=${STALE_PREFIX}`);
  if (!list.ok()) return;
  const rows = (await list.json()) as { id: number; title: string }[];
  for (const row of rows.filter((note) => note.title.startsWith(STALE_PREFIX))) {
    await request.delete(`/api/notes?id=${row.id}`).catch(() => undefined);
  }
}

test.describe('smoke', () => {
  test.beforeEach(async ({ request }) => {
    await authenticateAndSweep(request);
  });

  test.afterEach(async ({ request }) => {
    if (createdNoteId !== null) {
      await request.delete(`/api/notes?id=${createdNoteId}`).catch(() => undefined);
      createdNoteId = null;
    }
  });

  test('unlock, write a draft with AI, and insert it into a fresh note', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('onboarded', '1'));

    // Deterministic AI: canned draft for both the write and format actions.
    await page.route('**/api/ai', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: DRAFT }),
      });
    });

    await page.goto('/');

    // ---- Unlock (token → security answer → workspace) ----
    // A fresh profile opens TokenGate on the "New token" tab — switch first.
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await page.getByLabel('Access token').fill(SMOKE_TOKEN);
    await page.getByRole('button', { name: 'Fetch my question' }).click();
    await page.getByLabel('Security answer').waitFor({ state: 'visible' });
    await page.getByLabel('Security answer').fill(SMOKE_ANSWER);
    await page.getByRole('button', { name: 'Unlock workspace' }).click();

    const editor = page.getByLabel('Note editor');
    await expect(editor).toBeVisible({ timeout: 30_000 });

    // ---- Fresh note so the suite never mutates real content ----
    const created = page.waitForResponse(
      (response) =>
        response.url().includes('/api/notes') &&
        response.request().method() === 'POST' &&
        response.ok(),
    );
    // The editor remounts on the new id and fetches it — wait for that load.
    const loaded = page.waitForResponse(
      (response) => response.url().includes('/api/note?id=') && response.ok(),
    );
    await page.getByRole('button', { name: 'New', exact: true }).click();
    const createdRow = (await (await created).json()) as { id: number };
    createdNoteId = createdRow.id;
    await loaded;
    // Recognizable title: the start-of-test sweep cleans up after failed runs.
    await page.request.patch('/api/notes', {
      data: { id: createdNoteId, title: `${STALE_PREFIX} ${new Date().toISOString()}` },
    });
    // Let the editor's IndexedDB offline-draft check finish before typing, so
    // its final setText cannot wipe what the test enters.
    await page.waitForTimeout(300);

    // Editor must have switched to the new, empty note before we type.
    await expect(editor).toHaveValue('');
    await editor.fill('Seeded by the smoke suite.\n\n');
    await expect(editor).toHaveValue('Seeded by the smoke suite.\n\n');
    await page.screenshot({ path: 'tests/smoke/artifacts/01-workspace.png' });

    // ---- Write with AI: form → preview → insert ----
    await page.getByRole('button', { name: 'Write with AI' }).click();
    const dialog = page.getByRole('dialog', { name: 'Write with AI' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('start with')).toBeVisible();
    await page.screenshot({ path: 'tests/smoke/artifacts/02-write-form.png' });

    await dialog.getByRole('button', { name: 'Casual' }).click();
    await dialog.getByLabel('What should the AI write?').fill('Write a smoke-test draft');
    await dialog.getByRole('button', { name: 'Generate draft' }).click();

    await expect(dialog.getByRole('button', { name: 'Insert at cursor' })).toBeVisible();
    await expect(dialog.getByText('Smoke draft')).toBeVisible();
    await page.screenshot({ path: 'tests/smoke/artifacts/03-write-preview.png' });

    await dialog.getByRole('button', { name: 'Insert at cursor' }).click();
    await expect(dialog).toBeHidden();
    await expect(editor).toHaveValue(/Smoke draft/);
    await page.screenshot({ path: 'tests/smoke/artifacts/04-inserted.png' });

    // The draft must land in the database (autosave) before cleanup runs.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/note?id=${createdNoteId}`);
          if (!res.ok()) return false;
          const note = (await res.json()) as { content?: string };
          return (note.content ?? '').includes('Smoke draft');
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });
});
