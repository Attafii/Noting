import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';
import { SMOKE_ANSWER, SMOKE_TOKEN } from './env';

/**
 * End-to-end smoke of the productivity surfaces: Home tabs (calendar + board),
 * drag-rescheduling, board status moves, quick-add, recurrence/snooze metadata
 * round-trips, backlinks, and the command-palette shortcuts. Runs against the
 * real dev server / Neon; every note created here is prefixed `zz-planner` and
 * swept at the start of the run plus after each test.
 */

const PREFIX = 'zz-planner';

interface NoteRow {
  id: number;
  content_version: number;
  due_at?: string | null;
  status?: string;
  recurrence?: string;
  snoozed_until?: string | null;
  updated_at: string;
}

const createdIds: number[] = [];

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** Local-noon ISO for a `YYYY-MM-DD` key — the same anchor the app writes. */
function localNoonIso(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0).toISOString();
}

function localKeyOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return dayKey(parsed);
}

async function authenticateAndSweep(request: APIRequestContext): Promise<void> {
  const auth: APIResponse = await request.post('/api/session', {
    data: { token: SMOKE_TOKEN, answer: SMOKE_ANSWER },
  });
  if (!auth.ok()) return; // the in-browser unlock below will surface a clearer error
  const list = await request.get(`/api/notes?q=${PREFIX}`);
  if (!list.ok()) return;
  const rows = (await list.json()) as { id: number; title: string }[];
  for (const row of rows.filter((note) => note.title.startsWith(PREFIX))) {
    await request.delete(`/api/notes?id=${row.id}`).catch(() => undefined);
  }
}

async function createNote(request: APIRequestContext, title: string): Promise<number> {
  const res = await request.post('/api/notes', { data: { title } });
  if (!res.ok()) throw new Error(`create failed: ${res.status()} ${await res.text()}`);
  const row = (await res.json()) as { id: number };
  createdIds.push(row.id);
  return row.id;
}

async function getNote(request: APIRequestContext, id: number): Promise<NoteRow> {
  const res = await request.get(`/api/note?id=${id}`);
  if (!res.ok()) throw new Error(`get failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as NoteRow;
}

async function setBody(request: APIRequestContext, id: number, content: string): Promise<void> {
  const current = await getNote(request, id);
  const res = await request.post('/api/note', {
    data: { id, content, base_version: current.content_version },
  });
  if (!res.ok()) throw new Error(`content save failed: ${res.status()} ${await res.text()}`);
}

/** Simulate an HTML5 drag-and-drop onto `selector` carrying the note id. */
async function dispatchDrop(page: Page, selector: string, noteId: number): Promise<void> {
  await page.evaluate(
    ({ selector: target, id }) => {
      const el = document.querySelector<HTMLElement>(target);
      if (!el) throw new Error(`drop target missing: ${target}`);
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', String(id));
      for (const type of ['dragenter', 'dragover']) {
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
      }
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    },
    { selector, id: noteId },
  );
}

async function unlock(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByLabel('Access token').fill(SMOKE_TOKEN);
  await page.getByRole('button', { name: 'Fetch my question' }).click();
  await page.getByLabel('Security answer').waitFor({ state: 'visible' });
  await page.getByLabel('Security answer').fill(SMOKE_ANSWER);
  await page.getByRole('button', { name: 'Unlock workspace' }).click();
  await expect(page.getByLabel('Note editor')).toBeVisible({ timeout: 30_000 });
}

test.describe('planner', () => {
  test.beforeEach(async ({ request }) => {
    await authenticateAndSweep(request);
  });

  test.afterEach(async ({ request }) => {
    for (const id of createdIds.splice(0)) {
      await request.delete(`/api/notes?id=${id}`).catch(() => undefined);
    }
  });

  test('calendar, board, metadata, and backlinks work end to end', async ({ page, request }) => {
    await page.addInitScript(() => localStorage.setItem('onboarded', '1'));

    // ---- API setup: linked + plain-mentioned notes, metadata on alpha ----
    const alphaId = await createNote(request, `${PREFIX} alpha`);
    const betaId = await createNote(request, `${PREFIX} beta`);
    await setBody(request, betaId, `The full plan lives in [[${PREFIX} alpha]].`);
    const mentionId = await createNote(request, `${PREFIX} unlinked`);
    await setBody(request, mentionId, `See ${PREFIX} alpha for the plan — no brackets yet.`);

    const now = new Date();
    const todayKey = dayKey(now);
    const inTwoDays = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    const targetKey =
      dayKey(inTwoDays) === todayKey || inTwoDays.getMonth() !== now.getMonth()
        ? dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2))
        : dayKey(inTwoDays);
    const tomorrowKey = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

    const before = await getNote(request, alphaId);
    const patch = await request.patch('/api/notes', {
      data: {
        id: alphaId,
        due_at: localNoonIso(todayKey),
        recurrence: 'weekly',
        snoozed_until: localNoonIso(tomorrowKey),
      },
    });
    if (!patch.ok()) throw new Error(`patch failed: ${patch.status()} ${await patch.text()}`);

    const afterMeta = await getNote(request, alphaId);
    expect(localKeyOf(afterMeta.due_at)).toBe(todayKey);
    expect(afterMeta.recurrence).toBe('weekly');
    expect(afterMeta.snoozed_until).toBeTruthy();
    expect(afterMeta.status).toBe('todo');
    // Metadata edits never bump the conflict anchor.
    expect(afterMeta.updated_at).toBe(before.updated_at);

    // ---- Unlock and open Home ----
    await page.goto('/');
    await unlock(page);

    await page.getByRole('button', { name: 'Go home' }).click();
    await page.getByRole('tab', { name: 'Board' }).click();
    const card = page.locator(`[data-testid="board-card"][data-note-id="${alphaId}"]`);
    await expect(card).toBeVisible();
    await page.screenshot({ path: 'tests/smoke/artifacts/planner-board.png' });

    // Drag alpha from To do into In progress.
    await dispatchDrop(page, '[data-testid="board-column"][data-status="doing"]', alphaId);
    await expect.poll(async () => (await getNote(request, alphaId)).status).toBe('doing');
    expect((await getNote(request, alphaId)).updated_at).toBe(before.updated_at);

    // Quick-add creates a note straight into Done (create + status metadata).
    const created = page.waitForResponse(
      (response) =>
        response.url().includes('/api/notes') &&
        response.request().method() === 'POST' &&
        response.ok(),
    );
    await page.getByRole('button', { name: 'New note in Done' }).click();
    const quickId = ((await (await created).json()) as { id: number }).id;
    createdIds.push(quickId);
    await expect(page.getByLabel('Note editor')).toBeVisible();
    await expect.poll(async () => (await getNote(request, quickId)).status).toBe('done');

    // ---- Calendar: grid, due chip, drag-reschedule to another day ----
    await page.getByRole('button', { name: 'Go home' }).click();
    await page.getByRole('tab', { name: 'Calendar' }).click();
    const cells = page.locator('[data-testid="day-cell"]');
    expect(await cells.count()).toBeGreaterThanOrEqual(28);
    await expect(page.locator(`button[title^="${PREFIX} alpha"]`).first()).toBeVisible();

    await dispatchDrop(page, `[data-testid="day-cell"][data-day="${targetKey}"]`, alphaId);
    await expect
      .poll(async () => localKeyOf((await getNote(request, alphaId)).due_at))
      .toBe(targetKey);
    await page.screenshot({ path: 'tests/smoke/artifacts/planner-calendar.png' });

    // ---- Overview: writing card + reminder bell ----
    await page.getByRole('tab', { name: 'Overview' }).click();
    // The writing card sits in a collapsed section — expand it first.
    await page.getByRole('button', { name: 'Writing' }).click();
    await expect(page.getByLabel('Daily word goal')).toBeVisible();
    await expect(page.getByRole('button', { name: /due-note reminders/ })).toBeVisible();

    // ---- Backlinks: alpha's Links tab lists beta as a linked mention ----
    // Anchor the match to the row title — beta's preview also contains
    // `[[zz-planner alpha]]`, and beta sorts first by updated_at.
    await page
      .getByRole('button', { name: new RegExp(`^${PREFIX} alpha`) })
      .first()
      .click();
    await expect(page.getByLabel('Note editor')).toBeVisible();
    // The right panel is collapsed by default — open it from the TopBar menu.
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Files & AI' }).click();
    await page.locator('#side-panel').getByRole('tab', { name: 'Links' }).click();
    await expect(
      page.locator('#side-panel').getByText('Linked mentions', { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('#side-panel').getByRole('button', { name: new RegExp(`${PREFIX} beta`) }),
    ).toBeVisible();
    await page.screenshot({ path: 'tests/smoke/artifacts/planner-links.png' });

    // Unlinked mentions: the plain-text mention shows with a one-click Link
    // action; linking wraps the first occurrence conflict-safely.
    const unlinkedRow = page.locator(`[data-testid="unlinked-row"][data-note-id="${mentionId}"]`);
    await expect(unlinkedRow).toBeVisible();
    await page.screenshot({ path: 'tests/smoke/artifacts/planner-unlinked.png' });
    await unlinkedRow.getByTestId('link-mention').click();
    await expect
      .poll(async () => {
        const list = await request.get(`/api/notes?q=${PREFIX}`);
        if (!list.ok()) return false;
        const rows = (await list.json()) as { id: number; search_text?: string | null }[];
        const target = rows.find((row) => row.id === mentionId);
        return (target?.search_text ?? '').includes(`[[${PREFIX} alpha]]`);
      })
      .toBe(true);
    // The row moves out of Unlinked and into Linked mentions.
    await expect(unlinkedRow).toBeHidden();
    await expect(
      page.locator('#side-panel').getByRole('button', { name: new RegExp(`^${PREFIX} unlinked`) }),
    ).toBeVisible();

    // ---- Palette shortcut lands on the calendar tab and closes ----
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill('calendar');
    await page.getByRole('option', { name: 'Open calendar' }).click();
    await expect(palette).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Calendar' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
